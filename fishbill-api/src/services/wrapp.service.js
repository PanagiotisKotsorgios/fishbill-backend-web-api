/**
 * wrapp.service.js
 * Wrapp Partners API (v2.1) + Invoice API (v1.12.0) integration.
 *
 * Flow:
 *  1. Admin initiates onboarding  → POST /external_login  → returns login_url
 *  2. Fisherman completes Wrapp sign-up
 *  3. Wrapp POSTs webhook to us  → we save wrapp_api_key + wrapp_user_id on business
 *  4. On transmit: login with api_key → get JWT → find billing book → POST /invoices
 *  5. On cancel DN: DELETE /invoices/:wrapp_invoice_id/cancel
 */

const axios  = require('axios');
const pool   = require('../config/database');

// ── JWT cache: { [businessId]: { jwt, expiresAt } } ──────────────────────────
const jwtCache = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSettings() {
  const [rows] = await pool.execute(
    "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('wrapp_partner_api_key','wrapp_base_url','wrapp_webhook_endpoint')"
  );
  const map = {};
  rows.forEach(r => { map[r.setting_key] = r.setting_value; });
  return {
    partnerKey:      map.wrapp_partner_api_key || '',
    baseUrl:         (map.wrapp_base_url || 'https://wrapp.ai').replace(/\/$/, ''),
    webhookEndpoint: map.wrapp_webhook_endpoint || '',
  };
}

async function getBusinessCredentials(businessId) {
  const [[biz]] = await pool.execute(
    `SELECT b.wrapp_api_key, b.wrapp_user_id, b.wrapp_enabled,
            b.wrapp_billing_book_dn_id, b.wrapp_billing_book_inv_id,
            b.name, b.afm, b.address, b.city, b.postal_code, b.phone,
            COALESCE(NULLIF(TRIM(b.email),''), u.email) AS email
     FROM businesses b
     LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
     WHERE b.id = ? LIMIT 1`,
    [businessId]
  );
  if (!biz) throw new Error('Επιχείρηση δεν βρέθηκε.');
  if (!biz.wrapp_enabled) throw new Error('Το Wrapp δεν είναι ενεργοποιημένο για αυτή την επιχείρηση.');
  if (!biz.wrapp_api_key) throw new Error('Δεν βρέθηκε Wrapp API key. Ολοκληρώστε πρώτα την εγγραφή στο Wrapp.');
  return biz;
}

/** Login with api_key + email → JWT (cached for 23 h) */
async function getJwt(businessId) {
  const cached = jwtCache[businessId];
  if (cached && cached.expiresAt > Date.now()) return cached.jwt;

  const biz      = await getBusinessCredentials(businessId);
  const settings = await getSettings();

  // Parse basic auth credentials embedded in baseUrl (used in staging gated envs)
  const urlObj = new URL(`${settings.baseUrl}/api/v1/login`);
  const axiosConfig = { timeout: 15000 };
  if (urlObj.username) {
    axiosConfig.auth = { username: decodeURIComponent(urlObj.username), password: decodeURIComponent(urlObj.password) };
    urlObj.username  = '';
    urlObj.password  = '';
  }

  // Wrapp login accepts email OR wrapp_user_id — email is simpler and always available
  const resp = await axios.post(
    urlObj.toString(),
    { api_key: biz.wrapp_api_key, email: biz.email },
    axiosConfig
  );
  const jwt = resp.data?.data?.attributes?.jwt;
  if (!jwt) throw new Error('Αποτυχία σύνδεσης Wrapp: δεν επεστράφη JWT.');

  jwtCache[businessId] = { jwt, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return jwt;
}

/** Fetch all billing books and return the first matching invoice_type_code */
async function fetchBillingBookId(baseUrl, jwt, invoiceTypeCode) {
  const resp = await axios.get(`${baseUrl}/api/v1/billing_books`, {
    headers: { Authorization: `Bearer ${jwt}` },
    timeout: 15000,
  });
  const books = Array.isArray(resp.data) ? resp.data : (resp.data?.data || []);
  // billing books with code 1.1 cover all 1.x; 2.1 covers all 2.x; 9.3 is exact match
  const prefix = invoiceTypeCode.split('.')[0]; // e.g. "9" from "9.3"
  let book = books.find(b => b.invoice_type_code === invoiceTypeCode);
  if (!book) {
    book = books.find(b => b.invoice_type_code && b.invoice_type_code.startsWith(prefix + '.'));
  }
  if (!book) throw new Error(`Δεν βρέθηκε billing book για τύπο παραστατικού ${invoiceTypeCode} στο Wrapp.`);
  return book.id;
}

/** Get billing book ID — cached in businesses table to avoid repeated API calls */
async function getBillingBookId(businessId, invoiceTypeCode) {
  const isDn  = invoiceTypeCode === '9.3';
  const col   = isDn ? 'wrapp_billing_book_dn_id' : 'wrapp_billing_book_inv_id';
  const [[biz]] = await pool.execute(
    `SELECT ${col} AS cached_id FROM businesses WHERE id = ? LIMIT 1`, [businessId]
  );
  if (biz?.cached_id) return biz.cached_id;

  // Not cached — fetch from Wrapp
  const settings = await getSettings();
  const jwt      = await getJwt(businessId);
  const bookId   = await fetchBillingBookId(settings.baseUrl, jwt, invoiceTypeCode);

  // Cache it
  await pool.execute(
    `UPDATE businesses SET ${col} = ?, updated_at = NOW() WHERE id = ?`,
    [bookId, businessId]
  ).catch(() => {});

  return bookId;
}

// ── Unit code mapping (myDATA quantity_type) ──────────────────────────────────
function unitCode(unit) {
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'τεμ' || u === 'τεμάχιο' || u === 'τεμαχιο' || u === 'pcs') return 1; // Τεμάχια
  if (u === 'kg' || u === 'κιλό' || u === 'κιλα' || u === 'κιλά') return 2;        // Κιλά
  if (u === 'lt' || u === 'λτ' || u === 'λίτρο' || u === 'litre' || u === 'liter') return 3; // Λίτρα
  if (u === 'gr' || u === 'γρ' || u === 'γραμμάρια') return 4;
  return 2; // default: kg
}

// ── Purpose of movement code mapping ─────────────────────────────────────────
function movementPurposeCode(transportPurpose) {
  const p = (transportPurpose || '').toLowerCase().trim();
  if (!p || p === '1') return '1';
  if (/πωλ|sale/.test(p)) return '1';      // Πώληση
  if (/επιστρ|return/.test(p)) return '2'; // Επιστροφή
  if (/απόδ|apod/.test(p)) return '3';     // Απόδοση
  if (/φύλαξ|storage/.test(p)) return '4'; // Φύλαξη
  if (/μεταφ|transfer|transport/.test(p)) return '7'; // Μεταφορά
  // if it's already a number string 1-20
  if (/^[12]?\d$/.test(p)) {
    const n = parseInt(p);
    if (n >= 1 && n <= 20 && ![6, 15, 16, 17, 18].includes(n)) return String(n);
  }
  return '1';
}

// ── Dispatch date formatter: "YYYY-MM-DD" → "DD-MMM-YYYY" ────────────────────
const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDispatchDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${String(d.getDate()).padStart(2,'0')}-${MONTHS_EN[d.getMonth()]}-${d.getFullYear()}`;
}

// ── Build invoice_lines array for Wrapp ──────────────────────────────────────
function buildLines(lines, isDn) {
  return lines.map((l, idx) => {
    const vatRate = l.vat_rate || 0;
    const qty     = parseFloat(l.quantity) || 1;
    const uPrice  = parseFloat(l.unit_price || l.unit_price) || 0;
    const netPric = parseFloat(l.net_amount || l.net_value || (qty * uPrice).toFixed(2));
    const vatAmt  = parseFloat(((netPric * vatRate) / 100).toFixed(2));
    const subtot  = parseFloat((netPric + vatAmt).toFixed(2));

    const line = {
      line_number:             idx + 1,
      name:                    (l.description || 'Προϊόν').slice(0, 200),
      quantity:                qty,
      quantity_type:           unitCode(l.unit || 'kg'),
      unit_price:              parseFloat(uPrice.toFixed(2)),
      net_total_price:         parseFloat(netPric.toFixed(2)),
      vat_rate:                vatRate,
      vat_total:               vatAmt,
      subtotal:                subtot,
      classification_category: 'category1_1', // Έσοδα από Πώληση Εμπορευμάτων (goods/fish)
      classification_type:     'E3_561_001',
    };

    if (vatRate === 0) {
      line.vat_exemption_code = 27; // Λοιπές Εξαιρέσεις ΦΠΑ
    }

    return line;
  });
}

// ── Build totals from lines ───────────────────────────────────────────────────
function buildTotals(lines) {
  let net = 0, vat = 0;
  lines.forEach(l => {
    net += l.net_total_price;
    vat += l.vat_total;
  });
  net = parseFloat(net.toFixed(2));
  vat = parseFloat(vat.toFixed(2));
  return { net, vat, total: parseFloat((net + vat).toFixed(2)) };
}

// ── Transmit delivery note (type 9.3) ────────────────────────────────────────
async function transmitDeliveryNote(note, noteLines, biz) {
  const settings     = await getSettings();
  const jwt          = await getJwt(note.business_id);
  const billingBookId = await getBillingBookId(note.business_id, '9.3');

  const wrappLines = buildLines(noteLines, true);
  const totals     = buildTotals(wrappLines);

  // Build delivery_detail
  const dispatchDate = note.dispatch_date || note.issue_date;
  const delivery_detail = {
    dispatch_date:    formatDispatchDate(dispatchDate),
    dispatch_time:    note.dispatch_time || '08:00',
    vehicle_number:   note.vehicle_plate || 'ΑΓΝΩΣΤΟ',
    purpose_of_movement: movementPurposeCode(note.transport_purpose),
    issuer_of_movement:  biz.name || '',
    from_address:     biz.address || '—',
    from_number:      '1',
    from_city:        biz.city    || '—',
    from_zipcode:     biz.postal_code || '00000',
    to_address:       note.delivery_location || note.recipient_address || '—',
    to_number:        '1',
    to_city:          note.recipient_city   || '—',
    to_zipcode:       note.recipient_postal || '00000',
  };

  const counterpart = {
    name:         note.recipient_name || '—',
    country_code: 'GR',
    vat:          note.recipient_afm || '000000000',
    city:         note.recipient_city    || '—',
    street:       note.recipient_address || '—',
    number:       '1',
    postal_code:  note.recipient_postal  || '00000',
  };

  const payload = {
    billing_book_id:     billingBookId,
    invoice_type_code:   '9.3',
    payment_method_type: 1,           // Credit (ΔΑ is not a cash payment document)
    counterpart,
    is_delivery_note:   true,
    delivery_detail,
    net_total_amount:   totals.net,
    vat_total_amount:   totals.vat,
    total_amount:       totals.total,
    payable_total_amount: totals.total,
    invoice_lines:      wrappLines,
  };

  const resp = await axios.post(
    `${settings.baseUrl}/api/v1/invoices`,
    payload,
    { headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' }, timeout: 30000 }
  );

  const data = resp.data;
  if (!data?.id) throw new Error('Wrapp: δεν επεστράφη invoice id.');
  return {
    wrapp_invoice_id: data.id,
    mark:             data.my_data_mark  || null,
    uid:              data.my_data_uid   || null,
    qrUrl:            data.my_data_qr_url || null,
  };
}

// ── Transmit invoice (type 1.1, 2.1, etc.) ───────────────────────────────────
async function transmitInvoice(invoice, invoiceLines, biz, customer) {
  const settings      = await getSettings();
  const jwt           = await getJwt(invoice.business_id);
  const typeCode      = invoice.invoice_type || '1.1';
  const billingBookId = await getBillingBookId(invoice.business_id, typeCode);

  const wrappLines = invoiceLines.map((l, idx) => {
    const vatRate    = l.vat_rate  || 13;
    const qty        = parseFloat(l.quantity)   || 1;
    const uPrice     = parseFloat(l.unit_price) || 0;
    const discount   = parseFloat(l.discount_amt || l.discount_amount || 0);
    const netPric    = parseFloat(l.net_value   || ((qty * uPrice) - discount).toFixed(2));
    const vatAmt     = parseFloat(l.vat_amount  || ((netPric * vatRate) / 100).toFixed(2));
    const subtot     = parseFloat(l.total_value || (netPric + vatAmt).toFixed(2));

    const line = {
      line_number:             idx + 1,
      name:                    (l.description || 'Είδος').slice(0, 200),
      quantity:                qty,
      quantity_type:           unitCode(l.unit || 'kg'),
      unit_price:              parseFloat(uPrice.toFixed(2)),
      net_total_price:         parseFloat(netPric.toFixed(2)),
      vat_rate:                vatRate,
      vat_total:               vatAmt,
      subtotal:                subtot,
      classification_category: 'category1_1', // goods/fish
      classification_type:     'E3_561_001',
    };
    if (vatRate === 0) line.vat_exemption_code = 27;
    return line;
  });

  const net   = parseFloat((invoice.net_value   || 0).toFixed(2));
  const vat   = parseFloat((invoice.vat_amount   || 0).toFixed(2));
  const total = parseFloat((invoice.total_value  || 0).toFixed(2));

  // Map payment method
  const PM_MAP = { cash: 0, credit_card: 3, card: 3, bank_transfer: 2, check: 4, iris: 7, other: 1 };
  const pm = PM_MAP[invoice.payment_method] ?? 1;

  const counterpart = {
    name:         customer.name || '—',
    country_code: 'GR',
    vat:          customer.afm  || '000000000',
    city:         customer.city || '—',
    street:       customer.address || '—',
    number:       '1',
    postal_code:  customer.postal_code || '00000',
  };

  const payload = {
    billing_book_id:      billingBookId,
    invoice_type_code:    typeCode,
    payment_method_type:  pm,
    counterpart,
    net_total_amount:     net,
    vat_total_amount:     vat,
    total_amount:         total,
    payable_total_amount: total,
    invoice_lines:        wrappLines,
  };

  const resp = await axios.post(
    `${settings.baseUrl}/api/v1/invoices`,
    payload,
    { headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' }, timeout: 30000 }
  );

  const data = resp.data;
  if (!data?.id) throw new Error('Wrapp: δεν επεστράφη invoice id.');
  return {
    wrapp_invoice_id: data.id,
    mark:             data.my_data_mark  || null,
    uid:              data.my_data_uid   || null,
    qrUrl:            data.my_data_qr_url || null,
  };
}

// ── Cancel delivery note via Wrapp ────────────────────────────────────────────
async function cancelDeliveryNote(wrappInvoiceId, businessId) {
  const settings = await getSettings();
  const jwt      = await getJwt(businessId);

  const resp = await axios.delete(
    `${settings.baseUrl}/api/v1/invoices/${wrappInvoiceId}/cancel`,
    { headers: { Authorization: `Bearer ${jwt}` }, timeout: 15000 }
  );
  return {
    id:   resp.data?.id,
    mark: resp.data?.my_data_mark || null,
  };
}

// ── Initiate partner onboarding for a business ────────────────────────────────
async function initiateOnboarding(businessId) {
  const settings  = await getSettings();
  if (!settings.partnerKey) throw new Error('Ο πάροχος ΥΠΑΗΕΣ δεν έχει ρυθμιστεί. Επικοινωνήστε με την υποστήριξη.');
  if (!settings.webhookEndpoint) throw new Error('Το webhook endpoint δεν έχει οριστεί στις ρυθμίσεις πλατφόρμας.');

  const [[biz]] = await pool.execute(
    `SELECT b.name, b.phone,
            COALESCE(NULLIF(TRIM(b.email),''), u.email) AS email
     FROM businesses b
     LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
     WHERE b.id = ? LIMIT 1`,
    [businessId]
  );
  if (!biz) throw new Error('Επιχείρηση δεν βρέθηκε.');
  if (!biz.email) throw new Error('Δεν βρέθηκε email για αυτή την επιχείρηση. Συμπληρώστε το email στο προφίλ σας.');

  // Wrapp requires phone — fail fast with a clear message so the user knows what to fix
  if (!biz.phone || !biz.phone.trim()) {
    throw new Error('Το τηλέφωνο επιχείρησης είναι υποχρεωτικό για την ενεργοποίηση. Παρακαλώ συμπληρώστε το στις Ρυθμίσεις → Προφίλ Επιχείρησης.');
  }

  // Normalize phone: strip spaces/dashes/parens, remove +30 or 0030 country prefix
  // Wrapp staging returns HTML 500 for any format other than plain 10-digit (e.g. 6986788178)
  let phone = biz.phone.trim().replace(/[\s\-().+]/g, '');
  if (phone.startsWith('0030')) phone = phone.slice(4);
  else if (phone.startsWith('30') && phone.length === 12) phone = phone.slice(2);

  const payload = {
    email:            biz.email,
    partner_user_id:  String(businessId),
    webhook_endpoint: settings.webhookEndpoint,
    phone,
  };

  // Build request config — support basic auth embedded in base URL (e.g. staging)
  const urlObj = new URL(`${settings.baseUrl}/api/v1/external_login`);
  const axiosConfig = {
    headers: { 'X-PARTNER-API-KEY': settings.partnerKey, 'Content-Type': 'application/json' },
    timeout: 15000,
  };
  if (urlObj.username) {
    axiosConfig.auth = { username: urlObj.username, password: urlObj.password };
    urlObj.username = '';
    urlObj.password = '';
  }
  const endpoint = urlObj.toString();

  console.log(`[wrapp] initiateOnboarding → ${endpoint} payload=${JSON.stringify({ ...payload, partner_key_prefix: settings.partnerKey.slice(0,8) })}`);

  try {
    const resp = await axios.post(endpoint, payload, axiosConfig);
    const loginUrl = resp.data?.login_url;
    console.log(`[wrapp] initiateOnboarding success, login_url received: ${!!loginUrl}`);
    if (!loginUrl) throw new Error('Δεν επεστράφη σύνδεσμος ενεργοποίησης. Δοκιμάστε ξανά.');
    return { login_url: loginUrl };
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const d = err.response.data;
      const isHtml = typeof d === 'string' && d.trim().startsWith('<');
      const detail = isHtml
        ? 'Ο διακομιστής ενεργοποίησης δεν ανταποκρίνεται. Δοκιμάστε ξανά σε λίγο.'
        : (d?.message || d?.error || d?.errors?.[0]?.message || d?.errors?.[0] || JSON.stringify(d));
      console.error(`[wrapp] initiateOnboarding ${status}:`, isHtml ? `(HTML response, len=${String(d).length})` : JSON.stringify(d));
      throw new Error(`Σφάλμα ενεργοποίησης (${status}): ${detail}`);
    }
    console.error(`[wrapp] initiateOnboarding network error:`, err.message);
    throw err;
  }
}

// ── Check partner user subscription status ────────────────────────────────────
async function checkUserStatus(businessId) {
  const settings = await getSettings();
  if (!settings.partnerKey) return { active_subscription: false };

  const resp = await axios.post(
    `${settings.baseUrl}/api/v1/embedded_check_user`,
    { partner_user_id: String(businessId) },
    { headers: { 'X-PARTNER-API-KEY': settings.partnerKey }, timeout: 15000 }
  );
  return {
    email:               resp.data?.user || null,
    active_subscription: resp.data?.active_subscription || false,
  };
}

// ── Invalidate JWT cache (called when api_key changes) ────────────────────────
function invalidateCache(businessId) {
  delete jwtCache[businessId];
}

module.exports = {
  transmitDeliveryNote,
  transmitInvoice,
  cancelDeliveryNote,
  initiateOnboarding,
  checkUserStatus,
  invalidateCache,
};
