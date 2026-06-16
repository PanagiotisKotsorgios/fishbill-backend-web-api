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
  let resp;
  try {
    resp = await wrappRequest({
      method:  'POST',
      url:     `${baseUrl}/api/v1/billing_books`,
      data:    { name, series, invoice_type_code: invoiceTypeCode, number: 1 },
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  } catch (err) {
    // Wrapp returns 422 with "Name το έχουν ήδη χρησιμοποιήσει" / "Series το έχουν
    // ήδη χρησιμοποιήσει" when a previous run created a book with the same name
    // and series. That happens after a Wrapp normalisation (e.g. our 1.3 attempt
    // stored as a 1.1 book) — the row exists but with a different type code. In
    // that case, look the existing book up and reuse its id instead of failing.
    const status = err.response?.status;
    const errors = err.response?.data?.errors || [];
    const isInUse = status === 422 && errors.some(e =>
      typeof e.title === 'string' && /ήδη χρησιμοποιήσει|already.*taken|already.*used/i.test(e.title)
    );
    if (isInUse) {
      wWarn('createBillingBook', `Name/series already in use — looking up existing book`, { name, series, invoiceTypeCode });
      const listResp = await wrappRequest({
        method:  'GET',
        url:     `${baseUrl}/api/v1/billing_books`,
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
        timeout: 15000,
      });
      const books = Array.isArray(listResp.data) ? listResp.data : (listResp.data?.data || []);
      const existing = books.find(b =>
        (b.name === name || b.series === series)
      );
      if (existing?.id) {
        wInfo('createBillingBook', `Reusing existing billing book ${existing.id} (type=${existing.invoice_type_code}, series=${existing.series}) for requested type ${invoiceTypeCode}`);
        return existing.id;
      }
      wError('createBillingBook', `Name/series in use but no matching book in list`, { name, series });
    }
    throw err;
  }

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
// Maps the user-facing Greek labels (from the Android dropdown) and any other
// free-text the API might receive to the official myDATA "Σκοπός Διακίνησης"
// codes per the Wrapp API docs.
//
// Valid codes: 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 19, 20
// Forbidden: 6, 15, 16, 17, 18
//
// 1  Πώληση                                          5  Επιστροφή
// 2  Πώληση για Λογαριασμό Τρίτων                    7  Επεξεργασία/Συναρμολόγηση
// 3  Δειγματισμός                                    8  Ενδοδιακίνηση
// 4  Έκθεση                                          9  Αγορά
// 10 Εφοδιασμός πλοίων και αεροσκαφών                11 Δωρεάν διάθεση
// 12 Εγγύηση                                         13 Χρησιδανεισμός
// 14 Αποθήκευση σε Τρίτους                           19 Λοιπές Διακινήσεις
// 20 Μεταφορές – Ταχυμεταφορές
function movementPurposeCode(transportPurpose) {
  const raw = String(transportPurpose || '').trim();
  if (!raw) return '1';

  // Numeric input: accept any valid myDATA code, default to 1 otherwise.
  if (/^\d{1,2}$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 20 && ![6, 15, 16, 17, 18].includes(n)) return String(n);
    return '1';
  }

  // Strip Greek diacritics so user labels match regardless of accents.
  const p = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Order matters: more specific patterns come first so they don't get
  // swallowed by broader keyword matches below.
  if (/δωρε|donat/.test(p))                                          return '11';
  if (/εφοδιασμ|supply.*(ship|aircraft)/.test(p))                    return '10';
  if (/εγγυησ|warrant/.test(p))                                      return '12';
  if (/χρησιδαν|loan/.test(p))                                       return '13';
  if (/αποθηκευ|φυλαξ|storage|warehous/.test(p))                     return '14';
  if (/ενδοδιακιν|μεταξυ\s+εγκατασ|internal\s+transfer/.test(p))     return '8';
  if (/επεξεργ|συναρμολ|αποσυναρμολ|process|assembl/.test(p))        return '7';
  if (/εκθεσ|exhibit/.test(p))                                       return '4';
  if (/δειγμα|sample/.test(p))                                       return '3';
  if (/επιστροφ|return/.test(p))                                     return '5';
  if (/αγορ|purchas/.test(p))                                        return '9';
  if (/τριτων\s+λογαρ|λογαρ\s+τριτων|third[\s-]?party\s+sale/.test(p)) return '2';
  // "Μεταφορά/Διανομή" and "Ενδοκοινοτική Μεταφορά" both belong here (code 20).
  if (/μεταφορ|μεταφ|διανομ|ταχυμεταφ|courier|delivery|transport|transfer/.test(p)) return '20';
  if (/πωλησ|sale/.test(p))                                          return '1';
  // "Ιδιοχρησιμοποίηση", "Παραγωγή", "Ζύγιση" — no exact myDATA codes;
  // 19 (Λοιπές Διακινήσεις) is the umbrella category per the docs.
  if (/ιδιοχρησ|αυτοπαραδ|παραγωγ|ζυγισ|λοιπ|other|misc|self/.test(p)) return '19';

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

// ── myDATA-safe placeholder + address helpers ────────────────────────────────
// myDATA strictly validates counterpart/delivery_detail fields. An em-dash
// '—' or a placeholder like '00000' may pass Wrapp's input check but get
// rejected by AADE on the back-end. These helpers normalise our defaults
// so we always send myDATA-compliant strings.

const SAFE_TEXT_FALLBACK    = 'ΑΓΝΩΣΤΟ';   // unknown / not set
const SAFE_POSTAL_FALLBACK  = '00000';     // numeric, 5 chars — accepted by AADE

/** Coerce a value to a non-empty myDATA-safe string. Strips em-dash placeholders
 *  and trims; if empty after that, returns SAFE_TEXT_FALLBACK. */
function safeText(value, fallback = SAFE_TEXT_FALLBACK) {
  if (value == null) return fallback;
  const s = String(value).trim();
  if (!s) return fallback;
  // em-dash / hyphen-only placeholders are not real text
  if (/^[—–\-]+$/.test(s)) return fallback;
  return s;
}

/** Same as safeText but for numeric postal codes (5 digits in GR). */
function safePostal(value) {
  if (value == null) return SAFE_POSTAL_FALLBACK;
  const s = String(value).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length === 5) return digits;
  // truncate / pad to 5 — never send a postal of unusual length
  if (digits.length > 5) return digits.slice(0, 5);
  return SAFE_POSTAL_FALLBACK;
}

/** Extract a street number from a freeform address string. Handles both
 *  "Ερμού 7" (trailing digit) and "7 Ερμού" (leading digit), with optional
 *  fraction (e.g. "Ερμού 7Α", "Ερμού 7-9"). Falls back to '0' if no number
 *  is found — myDATA requires SOMETHING in this field but accepts '0'. */
function parseStreetNumber(address) {
  if (!address) return '0';
  const s = String(address).trim();
  // Trailing or leading run of digits (with optional Α/Β/Γ/-)
  const trailing = s.match(/\b(\d{1,5}[ΑΒΓΔΕA-Z]?(?:[-/]\d{1,5}[ΑΒΓΔΕA-Z]?)?)\s*$/i);
  if (trailing) return trailing[1].toUpperCase();
  const leading = s.match(/^(\d{1,5}[ΑΒΓΔΕA-Z]?(?:[-/]\d{1,5}[ΑΒΓΔΕA-Z]?)?)\b/i);
  if (leading) return leading[1].toUpperCase();
  return '0';
}

/** Strip the parsed number out of an address string so we don't send the
 *  digit in both `street` and `number` fields. Returns the cleaned street.
 *  Em-dash / hyphen-only placeholders are treated as missing → fallback. */
function stripStreetNumber(address) {
  if (!address) return SAFE_TEXT_FALLBACK;
  const s = String(address).trim();
  if (/^[—–\-]+$/.test(s)) return SAFE_TEXT_FALLBACK;
  let cleaned = s
    .replace(/\b\d{1,5}[ΑΒΓΔΕA-Z]?(?:[-/]\d{1,5}[ΑΒΓΔΕA-Z]?)?\s*$/i, '')
    .replace(/^\d{1,5}[ΑΒΓΔΕA-Z]?(?:[-/]\d{1,5}[ΑΒΓΔΕA-Z]?)?\b\s*/i, '')
    .trim();
  return cleaned || SAFE_TEXT_FALLBACK;
}

// ── Classification type by counterpart kind ──────────────────────────────────
// myDATA classification types per the Wrapp / AADE docs:
//   E3_561_001 → Πωλήσεις Χονδρικές - Επιτηδευματιών (B2B wholesale)
//   E3_561_003 → Πωλήσεις Λιανικές - Ιδιωτική Πελατεία (B2C retail)
// Pick by whether the counterpart has a real (9-digit) AFM.
function classificationTypeFor(afm) {
  const digits = String(afm || '').replace(/\D/g, '');
  return digits.length === 9 ? 'E3_561_001' : 'E3_561_003';
}

// ── Build invoice_lines array for Wrapp ──────────────────────────────────────
function buildLines(lines, counterpartAfm) {
  const classificationType = classificationTypeFor(counterpartAfm);
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
      classification_type:     classificationType,
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

  const wrappLines = buildLines(noteLines, note.recipient_afm);
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

  // Parse street numbers out of the freeform address strings so we send them
  // correctly in `from_number` / `to_number` / `counterpart.number`. myDATA
  // expects the street and the number in separate fields.
  const fromAddressRaw  = biz.address;
  const toAddressRaw    = note.delivery_location || note.recipient_address;
  const recipAddressRaw = note.recipient_address;

  const delivery_detail = {
    dispatch_date:       formatDispatchDate(dispatchDateFmt),
    dispatch_time:       effectiveDispatchTime,
    vehicle_number:      safeText(note.vehicle_plate, 'ΑΓΝΩΣΤΟ'),
    purpose_of_movement: movementPurposeCode(note.transport_purpose),
    issuer_of_movement:  safeText(biz.name),
    from_address:        safeText(stripStreetNumber(fromAddressRaw)),
    from_number:         parseStreetNumber(fromAddressRaw),
    from_city:           safeText(biz.city),
    from_zipcode:        safePostal(biz.postal_code),
    to_address:          safeText(stripStreetNumber(toAddressRaw)),
    to_number:           parseStreetNumber(toAddressRaw),
    to_city:             safeText(note.recipient_city),
    to_zipcode:          safePostal(note.recipient_postal),
  };

  const counterpart = {
    name:         safeText(note.recipient_name),
    country_code: 'GR',
    vat:          safeText(note.recipient_afm, '000000000'),
    city:         safeText(note.recipient_city),
    street:       safeText(stripStreetNumber(recipAddressRaw)),
    number:       parseStreetNumber(recipAddressRaw),
    postal_code:  safePostal(note.recipient_postal),
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

  // Forward free-text DN notes (e.g. extra recipient info) into Wrapp's
  // optional `notes` field.
  const dnNoteStr = safeText(note.notes, '');
  if (dnNoteStr && dnNoteStr !== SAFE_TEXT_FALLBACK) {
    payload.notes = dnNoteStr.slice(0, 1000);
  }

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
  const rawType = invoice.invoice_type || '1.1';

  // ── myDATA credit/cancellation code mapping ────────────────────────────────
  // Per the Wrapp/AADE docs the proper credit codes are:
  //   5.1 → Πιστωτικό Τιμολόγιο / Συσχετιζόμενο     (we have the original MARK)
  //   5.2 → Πιστωτικό Τιμολόγιο / Μη Συσχετιζόμενο (we don't)
  // Earlier versions of this app stored credits as 1.3 (wrong — that's non-EU
  // sales) or 1.5 (wrong — that's third-party-sales settlement). Both pass
  // Wrapp's input check because of the 1.x universal billing-book rule, but at
  // AADE they're filed under the wrong document type. We treat 1.3/1.4/1.5 in
  // our DB as legacy credit aliases and remap on the wire to 5.1 or 5.2.
  const isLegacyCreditCode = (rawType === '1.3' || rawType === '1.4' || rawType === '1.5');
  const isReversal         = isLegacyCreditCode || rawType === '5.1' || rawType === '5.2';

  wInfo('transmitInvoice', `START — invoice id=${invoice.id} rawType=${rawType} business=${invoice.business_id}`, {
    customer:    customer?.name,
    net:         invoice.net_value,
    total:       invoice.total_value,
    lines_count: invoiceLines.length,
    isReversal,
    related_invoice_id: invoice.related_invoice_id || null,
  });

  const settings = await getSettings();
  const jwt      = await getJwt(invoice.business_id);

  // For reversal docs, look up the original invoice's myDATA MARK so we can
  // correlate. This must happen BEFORE we resolve the final typeCode because
  // 5.1 (correlated) vs 5.2 (non-correlated) depends on whether a MARK exists.
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

  // Resolve the final wire type code.
  let typeCode = rawType;
  if (isLegacyCreditCode) {
    typeCode = correlatedMark ? '5.1' : '5.2';
    wInfo('transmitInvoice', `Remapping legacy credit code ${rawType} → ${typeCode}`, { invoice_id: invoice.id, has_mark: !!correlatedMark });
  } else if (rawType === '5.1' && !correlatedMark) {
    // Asked for 5.1 but no MARK is available — fall back to 5.2 (non-correlated)
    // rather than letting AADE reject the document.
    typeCode = '5.2';
    wWarn('transmitInvoice', `Type 5.1 requested but no correlated MARK — falling back to 5.2`, { invoice_id: invoice.id });
  }

  const billingBookId = await getBillingBookId(invoice.business_id, typeCode);

  const lineClassificationType = classificationTypeFor(customer?.afm);
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
      classification_type:     lineClassificationType,
    };
    if (vatRate === 0) line.vat_exemption_code = 27;
    return line;
  });

  const net   = Math.abs(parseFloat(parseFloat(invoice.net_value   || 0).toFixed(2)));
  const vat   = Math.abs(parseFloat(parseFloat(invoice.vat_amount  || 0).toFixed(2)));
  const total = Math.abs(parseFloat(parseFloat(invoice.total_value || 0).toFixed(2)));

  const PM_MAP = { cash: 0, credit_card: 3, card: 3, bank_transfer: 2, check: 4, iris: 7, other: 1 };
  const pm = PM_MAP[invoice.payment_method] ?? 1;

  const customerAddressRaw = customer.address;
  const counterpart = {
    name:         safeText(customer.name),
    country_code: 'GR',
    vat:          safeText(customer.afm, '000000000'),
    city:         safeText(customer.city),
    street:       safeText(stripStreetNumber(customerAddressRaw)),
    number:       parseStreetNumber(customerAddressRaw),
    postal_code:  safePostal(customer.postal_code),
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

  // Forward any free-text notes from our DB into Wrapp's `notes` field — they
  // show up in the customer-facing Wrapp portal and on the official PDF.
  const noteStr = safeText(invoice.notes, '');
  if (noteStr && noteStr !== SAFE_TEXT_FALLBACK) {
    payload.notes = noteStr.slice(0, 1000); // hard cap to be safe
  }

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
//
// Wrapp Invoice API v1.13.0 — INVOICES > CANCEL:
//   DELETE /api/v1/invoices/:id/cancel  (this endpoint is for delivery notes only)
//   Response body fields:
//     id                — the cancelled invoice id
//     my_data_mark      — the ORIGINAL DN's myDATA mark (already in our DB)
//     cancelled_by_mark — the CANCELLATION mark (this is what we need to store)
//     status            — present and equal to "pending" when myDATA is slow
//                         (the real cancelled_by_mark arrives later via webhook)
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

  const isPending = resp.data?.status === 'pending';
  const result = {
    id:                resp.data?.id || resp.data?.invoice_id || null,
    cancellationMark:  resp.data?.cancelled_by_mark || null,
    originalMark:      resp.data?.my_data_mark      || null,
    pending:           isPending,
  };
  wInfo('cancelDeliveryNote',
    `${isPending ? 'PENDING' : 'SUCCESS'} — cancelled wrapp_invoice_id=${wrappInvoiceId} cancellationMark=${result.cancellationMark}`,
    result);
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
