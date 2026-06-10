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

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const pool   = require('../config/database');

// ── Wrapp-specific logger ─────────────────────────────────────────────────────
// Writes to logs/wrapp.log AND console so both Coolify logs and file are captured.

const LOG_DIR  = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'wrapp.log');

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}

function wlog(level, tag, msg, data) {
  const ts   = new Date().toISOString();
  const line = data !== undefined
    ? `[${ts}] [${level}] [${tag}] ${msg} ${JSON.stringify(data, null, 0)}`
    : `[${ts}] [${level}] [${tag}] ${msg}`;

  // Console (visible in Coolify)
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }

  // File (persistent on disk)
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (writeErr) {
    console.error(`[wlog write FAILED] path=${LOG_FILE} err=${writeErr.message}`);
  }
}

const wInfo  = (tag, msg, data) => wlog('INFO',  tag, msg, data);
const wWarn  = (tag, msg, data) => wlog('WARN',  tag, msg, data);
const wError = (tag, msg, data) => wlog('ERROR', tag, msg, data);
const wDebug = (tag, msg, data) => wlog('DEBUG', tag, msg, data);

// ── Axios helper — logs every outgoing request and incoming response ───────────
async function wrappRequest(config) {
  const method  = (config.method || 'GET').toUpperCase();
  const url     = config.url;
  const reqBody = config.data ? JSON.stringify(config.data) : '(none)';

  // Redact sensitive values for logging
  const safeHeaders = { ...config.headers };
  if (safeHeaders.Authorization) {
    const jwt = safeHeaders.Authorization.replace('Bearer ', '');
    safeHeaders.Authorization = `Bearer ${jwt.slice(0, 20)}...[truncated]`;
  }
  if (safeHeaders['X-PARTNER-API-KEY']) {
    safeHeaders['X-PARTNER-API-KEY'] = safeHeaders['X-PARTNER-API-KEY'].slice(0, 8) + '...[truncated]';
  }

  wInfo('HTTP-OUT', `→ ${method} ${url}`, {
    headers: safeHeaders,
    body:    reqBody.length > 2000 ? reqBody.slice(0, 2000) + '...[truncated]' : reqBody,
  });

  const startMs = Date.now();
  try {
    const resp = await axios(config);
    const ms   = Date.now() - startMs;
    const respBody = JSON.stringify(resp.data);

    wInfo('HTTP-IN', `← ${method} ${url} → HTTP ${resp.status} (${ms}ms)`, {
      status: resp.status,
      body:   respBody.length > 2000 ? respBody.slice(0, 2000) + '...[truncated]' : respBody,
    });

    return resp;
  } catch (err) {
    const ms = Date.now() - startMs;
    if (err.response) {
      const respBody = JSON.stringify(err.response.data);
      wError('HTTP-IN', `← ${method} ${url} → HTTP ${err.response.status} ERROR (${ms}ms)`, {
        status:  err.response.status,
        headers: err.response.headers,
        body:    respBody.length > 2000 ? respBody.slice(0, 2000) + '...[truncated]' : respBody,
      });
    } else {
      wError('HTTP-IN', `← ${method} ${url} → NETWORK ERROR (${ms}ms)`, {
        message: err.message,
        code:    err.code,
      });
    }
    throw err;
  }
}

// ── JWT cache: { [businessId]: { jwt, expiresAt } } ──────────────────────────
const jwtCache = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSettings() {
  wDebug('getSettings', 'Loading Wrapp platform settings from DB');
  const [rows] = await pool.execute(
    "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('wrapp_partner_api_key','wrapp_base_url','wrapp_webhook_endpoint')"
  );
  const map = {};
  rows.forEach(r => { map[r.setting_key] = r.setting_value; });
  const settings = {
    partnerKey:      map.wrapp_partner_api_key || '',
    baseUrl:         (map.wrapp_base_url || 'https://wrapp.ai').replace(/\/$/, ''),
    webhookEndpoint: map.wrapp_webhook_endpoint || '',
  };
  wDebug('getSettings', 'Settings loaded', {
    baseUrl:            settings.baseUrl,
    webhookEndpoint:    settings.webhookEndpoint,
    partnerKeyPrefix:   settings.partnerKey ? settings.partnerKey.slice(0, 8) + '...' : '(not set)',
  });
  return settings;
}

async function getBusinessCredentials(businessId) {
  wDebug('getBusinessCredentials', `Loading credentials for business ${businessId}`);
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
  if (!biz) {
    wError('getBusinessCredentials', `Business ${businessId} not found in DB`);
    throw new Error('Επιχείρηση δεν βρέθηκε.');
  }
  wDebug('getBusinessCredentials', `Business found`, {
    name:                 biz.name,
    email:                biz.email,
    wrapp_enabled:        biz.wrapp_enabled,
    has_api_key:          !!biz.wrapp_api_key,
    api_key_prefix:       biz.wrapp_api_key ? biz.wrapp_api_key.slice(0, 8) + '...' : null,
    wrapp_user_id:        biz.wrapp_user_id,
    billing_book_inv_id:  biz.wrapp_billing_book_inv_id,
    billing_book_dn_id:   biz.wrapp_billing_book_dn_id,
  });
  if (!biz.wrapp_enabled) {
    wWarn('getBusinessCredentials', `Wrapp not enabled for business ${businessId}`);
    throw new Error('Το Wrapp δεν είναι ενεργοποιημένο για αυτή την επιχείρηση.');
  }
  if (!biz.wrapp_api_key) {
    wWarn('getBusinessCredentials', `No api_key for business ${businessId}`);
    throw new Error('Δεν βρέθηκε Wrapp API key. Ολοκληρώστε πρώτα την εγγραφή στο Wrapp.');
  }
  return biz;
}

/** Login with api_key + email → JWT (cached for 23 h) */
async function getJwt(businessId) {
  const cached = jwtCache[businessId];
  if (cached && cached.expiresAt > Date.now()) {
    const remainingMin = Math.round((cached.expiresAt - Date.now()) / 60000);
    wDebug('getJwt', `JWT cache HIT for business ${businessId} (expires in ${remainingMin} min)`);
    return cached.jwt;
  }
  if (cached) {
    wInfo('getJwt', `JWT cache EXPIRED for business ${businessId} — re-authenticating`);
  } else {
    wInfo('getJwt', `No cached JWT for business ${businessId} — authenticating`);
  }

  const biz      = await getBusinessCredentials(businessId);
  const settings = await getSettings();

  // Parse basic auth credentials embedded in baseUrl (used in staging gated envs)
  const urlObj = new URL(`${settings.baseUrl}/api/v1/login`);
  const axiosConfig = { method: 'POST', url: urlObj.toString(), timeout: 15000 };
  if (urlObj.username) {
    axiosConfig.auth = { username: decodeURIComponent(urlObj.username), password: decodeURIComponent(urlObj.password) };
    urlObj.username  = '';
    urlObj.password  = '';
    axiosConfig.url  = urlObj.toString();
    wDebug('getJwt', 'Basic auth extracted from base URL for staging gate');
  }

  // Wrapp login accepts email OR wrapp_user_id — email is simpler and always available
  axiosConfig.data    = { api_key: biz.wrapp_api_key, email: biz.email };
  axiosConfig.headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

  wInfo('getJwt', `POST ${axiosConfig.url} — logging in for business ${businessId} (${biz.email})`);

  const resp = await wrappRequest(axiosConfig);
  const jwt  = resp.data?.data?.attributes?.jwt;
  if (!jwt) {
    wError('getJwt', 'Wrapp login response did not contain JWT', { response: resp.data });
    throw new Error('Αποτυχία σύνδεσης Wrapp: δεν επεστράφη JWT.');
  }

  jwtCache[businessId] = { jwt, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  wInfo('getJwt', `JWT obtained and cached for business ${businessId} (valid 23h)`);
  return jwt;
}

/** Create a billing book in Wrapp for the given invoice type */
async function createBillingBook(baseUrl, jwt, invoiceTypeCode, businessId) {
  const NAMES = {
    '9.3': 'Deltia Apostolis',
    '1.1': 'Timologia Polisis',
    '1.3': 'Pistotika Polisis 13',
    '1.5': 'Pistotika Polisis 15',
    '2.1': 'Timologia Parochis',
    '2.4': 'Pistotika Parochis 24',
    '5.1': 'Pistotika Correlated',
    '5.2': 'Pistotika NonCorrelated',
  };
  // Wrapp rejects duplicate series across books for the same tenant, so use a
  // distinct series letter per reversal type.
  const SERIES = { '1.1': 'A', '1.3': 'C', '1.5': 'E', '2.1': 'P', '2.4': 'Q', '5.1': 'R', '5.2': 'S', '9.3': 'D' };
  const name   = NAMES[invoiceTypeCode]  || `Biblio ${invoiceTypeCode}`;
  const series = SERIES[invoiceTypeCode] || 'A';
  wInfo('createBillingBook', `Creating billing book type=${invoiceTypeCode} for business ${businessId}`, { name });

  // Required fields confirmed via Wrapp staging API test:
  // series must be Latin (not Greek) and number:1 is required (NOT start_number)
  const resp = await wrappRequest({
    method:  'POST',
    url:     `${baseUrl}/api/v1/billing_books`,
    data:    { name, series, invoice_type_code: invoiceTypeCode, number: 1 },
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  const book = resp.data?.id ? resp.data : (resp.data?.data || resp.data);
  if (!book?.id) {
    wError('createBillingBook', 'No id in create response', { response: resp.data });
    throw new Error(`Αποτυχία δημιουργίας billing book τύπου ${invoiceTypeCode} στο Wrapp.`);
  }
  wInfo('createBillingBook', `Billing book created`, { id: book.id, type: invoiceTypeCode, series: book.series });
  return book.id;
}

/** Fetch all billing books from Wrapp and find the one matching invoiceTypeCode. Auto-creates if missing. */
async function fetchBillingBookId(baseUrl, jwt, invoiceTypeCode, businessId) {
  wInfo('fetchBillingBookId', `GET ${baseUrl}/api/v1/billing_books — looking for type ${invoiceTypeCode} (business ${businessId})`);

  const resp  = await wrappRequest({
    method:  'GET',
    url:     `${baseUrl}/api/v1/billing_books`,
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
    timeout: 15000,
  });

  const books = Array.isArray(resp.data) ? resp.data : (resp.data?.data || []);
  wInfo('fetchBillingBookId', `Received ${books.length} billing book(s) from Wrapp`, {
    books: books.map(b => ({ id: b.id, invoice_type_code: b.invoice_type_code, series: b.series })),
  });

  const prefix     = invoiceTypeCode.split('.')[0];
  const isReversal = ['1.3', '1.5', '5.1', '5.2'].includes(invoiceTypeCode);

  let book = books.find(b => b.invoice_type_code === invoiceTypeCode);
  if (book) {
    wInfo('fetchBillingBookId', `Exact billing book match: type=${book.invoice_type_code} id=${book.id}`);
  } else if (!isReversal) {
    // Sales invoices (1.1, 1.2) can fall back to a 1.x book per Wrapp's
    // universalisation rule; reversal docs cannot, so we skip the prefix
    // fallback for them and force auto-creation of an exact-type book.
    book = books.find(b => b.invoice_type_code && b.invoice_type_code.startsWith(prefix + '.'));
    if (book) wWarn('fetchBillingBookId', `Exact match for ${invoiceTypeCode} not found — using prefix match: ${book.invoice_type_code} (id=${book.id})`);
  }

  if (!book) {
    wWarn('fetchBillingBookId', `No billing book found for type ${invoiceTypeCode} — auto-creating`, {
      available_types: books.map(b => b.invoice_type_code),
      isReversal,
    });
    const newId = await createBillingBook(baseUrl, jwt, invoiceTypeCode, businessId);
    return newId;
  }
  return book.id;
}

/** Get billing book ID — cached in businesses table to avoid repeated API calls.
 *  Reversal types (1.3/1.5/5.1/5.2) bypass the cache: Wrapp staging rejects
 *  "1.x covers all" for some of those, so we always look up / auto-create the
 *  exact-type billing book per call. The few extra GETs are negligible vs the
 *  "Invoice Type does not match selected Billing Book Invoice Type" failures. */
async function getBillingBookId(businessId, invoiceTypeCode) {
  const isDn       = invoiceTypeCode === '9.3';
  const isReversal = ['1.3', '1.5', '5.1', '5.2'].includes(invoiceTypeCode);

  if (isReversal) {
    wInfo('getBillingBookId', `Reversal type ${invoiceTypeCode} — bypassing cache, resolving fresh (business ${businessId})`);
    const settings = await getSettings();
    const jwt      = await getJwt(businessId);
    return await fetchBillingBookId(settings.baseUrl, jwt, invoiceTypeCode, businessId);
  }

  const col = isDn ? 'wrapp_billing_book_dn_id' : 'wrapp_billing_book_inv_id';

  const [[biz]] = await pool.execute(
    `SELECT ${col} AS cached_id FROM businesses WHERE id = ? LIMIT 1`, [businessId]
  );

  if (biz?.cached_id) {
    wDebug('getBillingBookId', `Billing book cache HIT — type=${invoiceTypeCode} id=${biz.cached_id} (business ${businessId})`);
    return biz.cached_id;
  }

  wInfo('getBillingBookId', `Billing book not cached for type=${invoiceTypeCode} (business ${businessId}) — fetching from Wrapp`);
  const settings = await getSettings();
  const jwt      = await getJwt(businessId);
  const bookId   = await fetchBillingBookId(settings.baseUrl, jwt, invoiceTypeCode, businessId);

  await pool.execute(
    `UPDATE businesses SET ${col} = ?, updated_at = NOW() WHERE id = ?`,
    [bookId, businessId]
  ).catch(e => wWarn('getBillingBookId', `Failed to cache billing book id in DB: ${e.message}`));

  wInfo('getBillingBookId', `Billing book id ${bookId} cached in DB for type=${invoiceTypeCode} (business ${businessId})`);
  return bookId;
}

// ── Unit code mapping (myDATA quantity_type) ──────────────────────────────────
function unitCode(unit) {
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'τεμ' || u === 'τεμάχιο' || u === 'τεμαχιο' || u === 'pcs') return 1;
  if (u === 'kg' || u === 'κιλό' || u === 'κιλα' || u === 'κιλά') return 2;
  if (u === 'lt' || u === 'λτ' || u === 'λίτρο' || u === 'litre' || u === 'liter') return 3;
  if (u === 'gr' || u === 'γρ' || u === 'γραμμάρια') return 4;
  return 2;
}

// ── Purpose of movement code mapping ─────────────────────────────────────────
function movementPurposeCode(transportPurpose) {
  const p = (transportPurpose || '').toLowerCase().trim();
  if (!p || p === '1') return '1';
  if (/πωλ|sale/.test(p))              return '1';
  if (/επιστρ|return/.test(p))         return '2';
  if (/απόδ|apod/.test(p))             return '3';
  if (/φύλαξ|storage/.test(p))         return '4';
  if (/μεταφ|transfer|transport/.test(p)) return '7';
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

// ── Athens-time helpers ───────────────────────────────────────────────────────
// Wrapp/myDATA validate dispatch_date & dispatch_time in Europe/Athens timezone.
// Our server runs in UTC, so we must compute these explicitly in Athens local time
// or we hit "dispatch time must be >= invoice issue time" (422) during summer.
function athensParts(date = new Date(), offsetMinutes = 0) {
  const d = new Date(date.getTime() + offsetMinutes * 60_000);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    year:   'numeric', month:  '2-digit', day:    '2-digit',
    hour:   '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get   = type => parts.find(p => p.type === type).value;
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return {
    year:   get('year'),
    month:  get('month'),
    day:    get('day'),
    hour,
    minute: get('minute'),
  };
}

// ── Build invoice_lines array for Wrapp ──────────────────────────────────────
function buildLines(lines, isDn) {
  return lines.map((l, idx) => {
    const vatRate = l.vat_rate || 0;
    const qty     = parseFloat(l.quantity) || 1;
    const uPrice  = parseFloat(l.unit_price) || 0;
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
      classification_category: 'category1_1',
      classification_type:     'E3_561_001',
    };
    if (vatRate === 0) line.vat_exemption_code = 27;
    return line;
  });
}

// ── Build totals from lines ───────────────────────────────────────────────────
function buildTotals(lines) {
  let net = 0, vat = 0;
  lines.forEach(l => { net += l.net_total_price; vat += l.vat_total; });
  net = parseFloat(net.toFixed(2));
  vat = parseFloat(vat.toFixed(2));
  return { net, vat, total: parseFloat((net + vat).toFixed(2)) };
}

// ── Transmit delivery note (type 9.3) ────────────────────────────────────────
async function transmitDeliveryNote(note, noteLines, biz) {
  wInfo('transmitDeliveryNote', `START — DN id=${note.id} business=${note.business_id}`, {
    recipient: note.recipient_name,
    dispatch_date: note.dispatch_date,
    lines_count: noteLines.length,
  });

  const settings      = await getSettings();
  const jwt           = await getJwt(note.business_id);
  const billingBookId = await getBillingBookId(note.business_id, '9.3');

  const wrappLines = buildLines(noteLines, true);
  const totals     = buildTotals(wrappLines);

  // Wrapp validates dispatch_date + dispatch_time against the invoice's issue time
  // IN GREEK TIMEZONE (Europe/Athens). Our server runs in UTC, so naive
  // new Date().getHours() is 3 hours behind in summer → 422 "dispatch time must
  // be greater than or equal to invoice issue time". We compute everything in Athens.
  const athensTodayParts = athensParts(new Date());
  const athensTodayStr   = `${athensTodayParts.year}-${athensTodayParts.month}-${athensTodayParts.day}`;
  const athensTodayMs    = new Date(`${athensTodayStr}T00:00:00Z`).getTime();

  const dispatchDateRaw  = note.dispatch_date || note.issue_date;
  const dispatchMs       = dispatchDateRaw ? new Date(dispatchDateRaw).getTime() : 0;
  const isClampedToToday = dispatchMs < athensTodayMs;

  // For the date we want, get its YYYY-MM-DD form in Athens.
  let dispatchDateFmt;
  let effectiveDispatchTime;
  if (isClampedToToday) {
    // Use Athens "now" + 2 minute forward buffer so we beat the Wrapp issue-time check
    // even if processing takes a moment, and the time is always > the historical record.
    const p = athensParts(new Date(), 2);
    dispatchDateFmt       = `${p.year}-${p.month}-${p.day}`;
    effectiveDispatchTime = `${p.hour}:${p.minute}`;
  } else {
    // For future dispatch dates, format the raw date and keep the user's chosen time.
    const d = new Date(dispatchDateRaw);
    dispatchDateFmt       = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    effectiveDispatchTime = note.dispatch_time ? note.dispatch_time.slice(0, 5) : '08:00';
  }

  const delivery_detail = {
    dispatch_date:       formatDispatchDate(dispatchDateFmt),
    dispatch_time:       effectiveDispatchTime,
    vehicle_number:      note.vehicle_plate || 'ΑΓΝΩΣΤΟ',
    purpose_of_movement: movementPurposeCode(note.transport_purpose),
    issuer_of_movement:  biz.name || '',
    from_address:        biz.address || '—',
    from_number:         '1',
    from_city:           biz.city    || '—',
    from_zipcode:        biz.postal_code || '00000',
    to_address:          note.delivery_location || note.recipient_address || '—',
    to_number:           '1',
    to_city:             note.recipient_city   || '—',
    to_zipcode:          note.recipient_postal || '00000',
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
    billing_book_id:      billingBookId,
    invoice_type_code:    '9.3',
    payment_method_type:  1,
    counterpart,
    is_delivery_note:     true,
    delivery_detail,
    net_total_amount:     totals.net,
    vat_total_amount:     totals.vat,
    total_amount:         totals.total,
    payable_total_amount: totals.total,
    invoice_lines:        wrappLines,
  };

  wInfo('transmitDeliveryNote', `POST ${settings.baseUrl}/api/v1/invoices — DN payload built`, {
    billing_book_id:   billingBookId,
    invoice_type_code: '9.3',
    net:               totals.net,
    vat:               totals.vat,
    total:             totals.total,
    lines:             wrappLines.length,
    delivery_detail,
    counterpart,
    server_utc:        new Date().toISOString(),
    athens_now:        `${athensParts(new Date()).hour}:${athensParts(new Date()).minute}`,
    clamped_to_today:  isClampedToToday,
  });

  const resp = await wrappRequest({
    method:  'POST',
    url:     `${settings.baseUrl}/api/v1/invoices`,
    data:    payload,
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const data = resp.data;
  // Wrapp may return { status:"pending", invoice_id:"uuid" } for async processing
  const invoiceId = data?.id || data?.invoice_id;
  if (!invoiceId) {
    wError('transmitDeliveryNote', 'Wrapp did not return invoice id', { response: data });
    throw new Error('Wrapp: δεν επεστράφη invoice id.');
  }

  const isPending = data?.status === 'pending';
  const result = {
    wrapp_invoice_id: invoiceId,
    mark:             data.my_data_mark   || null,
    uid:              data.my_data_uid    || null,
    qrUrl:            data.my_data_qr_url || null,
    pending:          isPending,
  };
  wInfo('transmitDeliveryNote', `${isPending ? 'PENDING' : 'SUCCESS'} — DN id=${note.id} → wrapp_id=${result.wrapp_invoice_id} MARK=${result.mark}`, result);
  return result;
}

// ── Transmit invoice (type 1.1, 2.1, etc.) ───────────────────────────────────
async function transmitInvoice(invoice, invoiceLines, biz, customer) {
  const typeCode = invoice.invoice_type || '1.1';
  // Credit (πιστωτικό 5.1 / 1.5) and cancellation (ακυρωτικό 5.2 / 1.3) are
  // "reversal" docs in myDATA: Wrapp/AADE require POSITIVE amounts here and a
  // `correlated_invoices` array pointing to the original invoice's MARK. Our
  // internal records store negative values for these — we flip them on the wire.
  const isReversal = (typeCode === '1.3' || typeCode === '1.5' || typeCode === '5.1' || typeCode === '5.2');

  wInfo('transmitInvoice', `START — invoice id=${invoice.id} type=${typeCode} business=${invoice.business_id}`, {
    customer:    customer?.name,
    net:         invoice.net_value,
    total:       invoice.total_value,
    lines_count: invoiceLines.length,
    isReversal,
    related_invoice_id: invoice.related_invoice_id || null,
  });

  const settings      = await getSettings();
  const jwt           = await getJwt(invoice.business_id);
  // Wrapp's billing book universalisation: a "1.1" book covers 1.x types, and
  // a "2.1" book covers 2.x. But 1.3/1.5 sometimes hit "Invoice Type does not
  // match selected Billing Book Invoice Type" in practice — try the exact type
  // first, then fall back to the 1.1 / 2.1 universal book on a 422 mismatch.
  const billingBookId = await getBillingBookId(invoice.business_id, typeCode);

  // For reversal docs, look up the original invoice's myDATA MARK so we can
  // correlate. Tries DB column `related_invoice_id` first (our schema).
  let correlatedMark = null;
  if (isReversal && invoice.related_invoice_id) {
    try {
      const [[orig]] = await pool.execute(
        'SELECT mydata_mark, wrapp_mark FROM invoices WHERE id = ? LIMIT 1',
        [invoice.related_invoice_id]
      );
      correlatedMark = orig?.mydata_mark || orig?.wrapp_mark || null;
      wInfo('transmitInvoice', `reversal correlation — original mark=${correlatedMark || '(none)'}`, {
        related_invoice_id: invoice.related_invoice_id,
        has_mark: !!correlatedMark,
      });
    } catch (e) {
      wWarn('transmitInvoice', `could not look up original invoice mark: ${e.message}`);
    }
  }

  const wrappLines = invoiceLines.map((l, idx) => {
    const vatRate  = l.vat_rate  || 13;
    // Reversal docs: flip signs to positive before sending. Internal storage
    // keeps the negative numbers so balance sheets still subtract correctly.
    const qty      = Math.abs(parseFloat(l.quantity) || 1);
    const uPrice   = Math.abs(parseFloat(l.unit_price) || 0);
    const discount = Math.abs(parseFloat(l.discount_amt || l.discount_amount || 0));
    const netPric  = Math.abs(parseFloat(l.net_value   || ((qty * uPrice) - discount).toFixed(2)));
    const vatAmt   = Math.abs(parseFloat(l.vat_amount  || ((netPric * vatRate) / 100).toFixed(2)));
    const subtot   = Math.abs(parseFloat(l.total_value || (netPric + vatAmt).toFixed(2)));

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
      classification_category: 'category1_1',
      classification_type:     'E3_561_001',
    };
    if (vatRate === 0) line.vat_exemption_code = 27;
    return line;
  });

  const net   = Math.abs(parseFloat(parseFloat(invoice.net_value   || 0).toFixed(2)));
  const vat   = Math.abs(parseFloat(parseFloat(invoice.vat_amount  || 0).toFixed(2)));
  const total = Math.abs(parseFloat(parseFloat(invoice.total_value || 0).toFixed(2)));

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

  if (isReversal && correlatedMark) {
    payload.correlated_invoices = [String(correlatedMark)];
  }

  wInfo('transmitInvoice', `POST ${settings.baseUrl}/api/v1/invoices — invoice payload built`, {
    billing_book_id:   billingBookId,
    invoice_type_code: typeCode,
    payment_method:    invoice.payment_method,
    payment_method_type: pm,
    net, vat, total,
    lines:      wrappLines.length,
    counterpart,
    isReversal,
    correlated_mark: correlatedMark,
  });

  const resp = await wrappRequest({
    method:  'POST',
    url:     `${settings.baseUrl}/api/v1/invoices`,
    data:    payload,
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const data = resp.data;
  // Wrapp may return { status:"pending", invoice_id:"uuid" } for async processing
  const invoiceId = data?.id || data?.invoice_id;
  if (!invoiceId) {
    wError('transmitInvoice', 'Wrapp did not return invoice id', { response: data });
    throw new Error('Wrapp: δεν επεστράφη invoice id.');
  }

  const isPending = data?.status === 'pending';
  const result = {
    wrapp_invoice_id: invoiceId,
    mark:             data.my_data_mark   || null,
    uid:              data.my_data_uid    || null,
    qrUrl:            data.my_data_qr_url || null,
    pending:          isPending,
  };
  wInfo('transmitInvoice', `${isPending ? 'PENDING' : 'SUCCESS'} — invoice id=${invoice.id} → wrapp_id=${result.wrapp_invoice_id} MARK=${result.mark}`, result);
  return result;
}

// ── Cancel delivery note via Wrapp ────────────────────────────────────────────
async function cancelDeliveryNote(wrappInvoiceId, businessId) {
  wInfo('cancelDeliveryNote', `START — wrapp_invoice_id=${wrappInvoiceId} business=${businessId}`);

  const settings = await getSettings();
  const jwt      = await getJwt(businessId);
  const url      = `${settings.baseUrl}/api/v1/invoices/${wrappInvoiceId}/cancel`;

  wInfo('cancelDeliveryNote', `DELETE ${url}`);

  const resp = await wrappRequest({
    method:  'DELETE',
    url,
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
    timeout: 15000,
  });

  const result = { id: resp.data?.id, mark: resp.data?.my_data_mark || null };
  wInfo('cancelDeliveryNote', `SUCCESS — cancelled wrapp_invoice_id=${wrappInvoiceId} cancellation_mark=${result.mark}`, result);
  return result;
}

// ── Initiate partner onboarding for a business ────────────────────────────────
async function initiateOnboarding(businessId) {
  wInfo('initiateOnboarding', `START for business ${businessId}`);

  const settings = await getSettings();
  if (!settings.partnerKey) {
    wError('initiateOnboarding', 'Partner API key not set in platform_settings');
    throw new Error('Ο πάροχος ΥΠΑΗΕΣ δεν έχει ρυθμιστεί. Επικοινωνήστε με την υποστήριξη.');
  }
  if (!settings.webhookEndpoint) {
    wError('initiateOnboarding', 'Webhook endpoint not set in platform_settings');
    throw new Error('Το webhook endpoint δεν έχει οριστεί στις ρυθμίσεις πλατφόρμας.');
  }

  const [[biz]] = await pool.execute(
    `SELECT b.name, b.phone,
            COALESCE(NULLIF(TRIM(b.email),''), u.email) AS email
     FROM businesses b
     LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
     WHERE b.id = ? LIMIT 1`,
    [businessId]
  );
  if (!biz) {
    wError('initiateOnboarding', `Business ${businessId} not found`);
    throw new Error('Επιχείρηση δεν βρέθηκε.');
  }
  if (!biz.email) {
    wWarn('initiateOnboarding', `No email for business ${businessId}`);
    throw new Error('Δεν βρέθηκε email για αυτή την επιχείρηση. Συμπληρώστε το email στο προφίλ σας.');
  }
  if (!biz.phone || !biz.phone.trim()) {
    wWarn('initiateOnboarding', `No phone for business ${businessId}`);
    throw new Error('Το τηλέφωνο επιχείρησης είναι υποχρεωτικό για την ενεργοποίηση. Παρακαλώ συμπληρώστε το στις Ρυθμίσεις → Προφίλ Επιχείρησης.');
  }

  let phone = biz.phone.trim().replace(/[\s\-().+]/g, '');
  if (phone.startsWith('0030'))                    phone = phone.slice(4);
  else if (phone.startsWith('30') && phone.length === 12) phone = phone.slice(2);

  const payload = {
    email:            biz.email,
    partner_user_id:  String(businessId),
    webhook_endpoint: settings.webhookEndpoint,
    phone,
  };

  const urlObj      = new URL(`${settings.baseUrl}/api/v1/external_login`);
  const axiosConfig = {
    method:  'POST',
    headers: { 'X-PARTNER-API-KEY': settings.partnerKey, 'Content-Type': 'application/json' },
    timeout: 15000,
    data:    payload,
  };
  if (urlObj.username) {
    axiosConfig.auth = { username: decodeURIComponent(urlObj.username), password: decodeURIComponent(urlObj.password) };
    urlObj.username  = '';
    urlObj.password  = '';
  }
  axiosConfig.url = urlObj.toString();

  wInfo('initiateOnboarding', `POST ${axiosConfig.url}`, {
    email:           payload.email,
    partner_user_id: payload.partner_user_id,
    phone:           payload.phone,
    webhook_endpoint: payload.webhook_endpoint,
    partner_key_prefix: settings.partnerKey.slice(0, 8) + '...',
  });

  try {
    const resp     = await wrappRequest(axiosConfig);
    const loginUrl = resp.data?.login_url;
    if (!loginUrl) {
      wError('initiateOnboarding', 'No login_url in response', { response: resp.data });
      throw new Error('Δεν επεστράφη σύνδεσμος ενεργοποίησης. Δοκιμάστε ξανά.');
    }
    wInfo('initiateOnboarding', `SUCCESS — login_url received for business ${businessId}`);
    return { login_url: loginUrl };
  } catch (err) {
    if (err.response) {
      const status  = err.response.status;
      const d       = err.response.data;
      const isHtml  = typeof d === 'string' && d.trim().startsWith('<');
      const detail  = isHtml
        ? 'Ο διακομιστής ενεργοποίησης δεν ανταποκρίνεται. Δοκιμάστε ξανά σε λίγο.'
        : (d?.message || d?.error || d?.errors?.[0]?.message || d?.errors?.[0] || JSON.stringify(d));
      wError('initiateOnboarding', `HTTP ${status} from Wrapp`, { isHtml, detail, raw: isHtml ? '(html)' : d });
      throw new Error(`Σφάλμα ενεργοποίησης (${status}): ${detail}`);
    }
    wError('initiateOnboarding', `Network error: ${err.message}`);
    throw err;
  }
}

// ── Check partner user subscription status ────────────────────────────────────
async function checkUserStatus(businessId) {
  wDebug('checkUserStatus', `Checking Wrapp subscription status for business ${businessId}`);
  const settings = await getSettings();
  if (!settings.partnerKey) {
    wWarn('checkUserStatus', 'Partner key not set — returning inactive');
    return { active_subscription: false };
  }

  const url = `${settings.baseUrl}/api/v1/embedded_check_user`;
  wInfo('checkUserStatus', `POST ${url} for business ${businessId}`);

  const resp = await wrappRequest({
    method:  'POST',
    url,
    data:    { partner_user_id: String(businessId) },
    headers: { 'X-PARTNER-API-KEY': settings.partnerKey, 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  const result = {
    email:               resp.data?.user || null,
    active_subscription: resp.data?.active_subscription || false,
  };
  wInfo('checkUserStatus', `Result for business ${businessId}`, result);
  return result;
}

// ── Request PDF generation for a Wrapp invoice ───────────────────────────────
// Returns { download_url } if PDF is already generated, or { pending: true } if
// Wrapp queued the generation (webhook will deliver download_url when ready).
async function generatePdf(wrappInvoiceId, businessId) {
  wInfo('generatePdf', `START — wrapp_invoice_id=${wrappInvoiceId} business=${businessId}`);

  const settings = await getSettings();
  const jwt      = await getJwt(businessId);
  const url      = `${settings.baseUrl}/api/v1/invoices/${wrappInvoiceId}/generate_pdf`;

  const resp = await wrappRequest({
    method:  'GET',
    url,
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
    timeout: 30000,
  });

  const downloadUrl = resp.data?.download_url || null;
  if (downloadUrl) {
    wInfo('generatePdf', `PDF already available — returning download_url`, { wrappInvoiceId, downloadUrl });
    return { download_url: downloadUrl, pending: false };
  }

  wInfo('generatePdf', `PDF generation queued — webhook will deliver download_url`, { wrappInvoiceId });
  return { pending: true };
}

// ── Invalidate JWT cache (called when api_key changes) ────────────────────────
function invalidateCache(businessId) {
  if (jwtCache[businessId]) {
    wInfo('invalidateCache', `JWT cache cleared for business ${businessId}`);
    delete jwtCache[businessId];
  }
}

module.exports = {
  transmitDeliveryNote,
  transmitInvoice,
  cancelDeliveryNote,
  initiateOnboarding,
  checkUserStatus,
  invalidateCache,
  generatePdf,
};
