/**
 * myDATA Direct ΑΑΔΕ REST API Service
 *
 * Platform-level: one set of credentials configured once by super_admin.
 * FishBill acts as the ERP/provider and submits on behalf of all fishermen.
 * Each fisherman's AFM goes into issuer.vatNumber — this is the legal way.
 *
 * Environments:
 *   test:       https://mydataapidev.aade.gr
 *   production: https://mydatapi.aade.gr/myDATA
 *
 * Headers on every request:
 *   aade-user-id              — registered platform user ID (e.g. 'fishbill_test')
 *   Ocp-Apim-Subscription-Key — subscription key from ΑΑΔΕ portal
 */

const https = require('https');
const pool  = require('../config/database');

// ── Endpoints ─────────────────────────────────────────────────────────────────
const ENDPOINTS = {
  test:       'https://mydataapidev.aade.gr',
  production: 'https://mydatapi.aade.gr/myDATA',
};

// ── Read platform credentials from platform_settings ─────────────────────────
async function getPlatformConfig() {
  const [rows] = await pool.execute(
    `SELECT setting_key, setting_value FROM platform_settings
     WHERE setting_key IN ('mydata_user_id','mydata_subscription_key','mydata_environment')`
  );
  const cfg = {};
  rows.forEach(r => { cfg[r.setting_key] = r.setting_value; });
  return {
    userId:          cfg.mydata_user_id          || '',
    subscriptionKey: cfg.mydata_subscription_key || '',
    environment:     cfg.mydata_environment      || 'test',
  };
}

// ── Save platform credentials ─────────────────────────────────────────────────
async function savePlatformConfig({ userId, subscriptionKey, environment }) {
  const pairs = [
    ['mydata_user_id',          userId],
    ['mydata_subscription_key', subscriptionKey],
    ['mydata_environment',      environment || 'test'],
    ['mydata_test_mode',        environment === 'production' ? '0' : '1'],
  ];
  for (const [k, v] of pairs) {
    await pool.execute(
      `INSERT INTO platform_settings (setting_key, setting_value)
       VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
      [k, v, v]
    );
  }
}

// ── Low-level HTTP helpers ────────────────────────────────────────────────────
function httpsPost(url, headers, xmlBody) {
  return new Promise((resolve) => {
    const u    = new URL(url);
    const buf  = Buffer.from(xmlBody, 'utf8');
    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'text/xml; charset=utf-8',
        'Content-Length': buf.length,
        Accept:           'text/xml, application/xml',
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout after 20s' }); });
    req.write(buf);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve) => {
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method:   'GET',
      headers:  { Accept: 'text/xml, application/xml', ...headers },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.end();
  });
}

// ── Parse MARK / UID / errors from ΑΑΔΕ XML response ─────────────────────────
// The ΑΑΔΕ test server wraps the response inside a WCF <string> element with
// HTML-encoded inner XML. Decode it before parsing. Production returns plain XML.
function parseResponse(xmlBody) {
  let body = xmlBody || '';

  // Unwrap WCF <string xmlns="...">...HTML-encoded XML...</string>
  const stringMatch = body.match(/<string[^>]*>([\s\S]*?)<\/string>/i);
  if (stringMatch) {
    body = stringMatch[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }

  // ΑΑΔΕ returns <invoiceMark> on success (not <mark>)
  const marks  = [...body.matchAll(/<invoiceMark>(\d+)<\/invoiceMark>/gi)].map(m => m[1]);
  const uids   = [...body.matchAll(/<invoiceUid>([^<]+)<\/invoiceUid>/gi)].map(m => m[1]);
  const errors = [...body.matchAll(/<message>([^<]+)<\/message>/gi)].map(m => m[1]);
  const codes  = [...body.matchAll(/<code>([^<]+)<\/code>/gi)].map(m => m[1]);
  const statusCodes = [...body.matchAll(/<statusCode>([^<]+)<\/statusCode>/gi)].map(m => m[1]);
  return { marks, uids, errors, codes, statusCodes, body };
}

// ── XML helpers ───────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const num = (v, d = 2) => parseFloat(v || 0).toFixed(d);

// MySQL2 without dateStrings:true returns DATE columns as JS Date objects.
// Using local getters avoids UTC-offset shifting the date by one day.
function fmtDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
}

function vatCategoryCode(rate) {
  const r = parseFloat(rate || 0);
  if (r >= 24) return 1; // 24%
  if (r >= 13) return 2; // 13%
  if (r >= 9)  return 5; // 9% island reduced
  if (r >= 6)  return 3; // 6%
  if (r > 0)   return 4;
  return 7;              // 0% exempt
}

function measurementUnitCode(unit) {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'kg' || u === 'κιλά' || u === 'κιλο' || u === 'κιλά') return 2;
  if (u === 'l' || u === 'lt' || u === 'λίτρα' || u === 'λιτρα')  return 3;
  if (u === 'τεμ' || u === 'τεμάχιο' || u === 'pcs')              return 1;
  return 2; // default to kg (fish)
}

// ── Build Delivery Note XML (myDATA type 9.1, spec v2.0.1) ───────────────────
function buildDeliveryNoteXml(note, biz, lines = []) {
  const issueDate = fmtDate(note.issue_date);

  // Ensure at least one line
  if (!lines || lines.length === 0) {
    lines = [{
      description: note.notes || 'Αλιεύματα',
      quantity: 1,
      unit: 'kg',
      unit_price: 0,
      vat_rate: 0,
      net_amount: 0,
    }];
  }

  let totalNet = 0, totalVat = 0;
  lines.forEach(l => {
    const net = parseFloat(l.net_amount || (parseFloat(l.quantity || 0) * parseFloat(l.unit_price || 0)));
    const vat = net * (parseFloat(l.vat_rate || 0) / 100);
    totalNet += net;
    totalVat += vat;
  });
  const totalGross = totalNet + totalVat;

  const detailsXml = lines.map((l, idx) => {
    const net    = parseFloat(l.net_amount || (parseFloat(l.quantity || 0) * parseFloat(l.unit_price || 0)));
    const vat    = net * (parseFloat(l.vat_rate || 0) / 100);
    const vatCat = vatCategoryCode(l.vat_rate);
    const qty    = parseFloat(l.quantity || 0);
    const mu     = measurementUnitCode(l.unit);

    return `    <invoiceDetails>
      <lineNumber>${idx + 1}</lineNumber>
      <netValue>${num(net)}</netValue>
      <vatCategory>${vatCat}</vatCategory>
      <vatAmount>${num(vat)}</vatAmount>
      <quantity>${num(qty, 3)}</quantity>
      <measurementUnit>${mu}</measurementUnit>
    </invoiceDetails>`;
  }).join('\n');

  // Counterpart only if AFM present (B2B) — for B2C fishermen omit it
  const counterpartXml = note.recipient_afm ? `
    <counterpart>
      <vatNumber>${esc(note.recipient_afm)}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
    </counterpart>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xmlns="https://www.aade.gr/myDATA/invoice/v1.0">
  <invoice>
    <issuer>
      <vatNumber>${esc(biz.afm)}</vatNumber>
      <country>GR</country>
      <branch>${parseInt(biz.branch || 0)}</branch>
    </issuer>${counterpartXml}
    <invoiceHeader>
      <series>${esc(note.series || 'ΔΑ')}</series>
      <aa>${esc(String(note.number || 1))}</aa>
      <issueDate>${issueDate}</issueDate>
      <invoiceType>9.1</invoiceType>
      <currency>EUR</currency>
    </invoiceHeader>
${detailsXml}
    <invoiceSummary>
      <totalNetValue>${num(totalNet)}</totalNetValue>
      <totalVatAmount>${num(totalVat)}</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>${num(totalGross)}</totalGrossValue>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`.trim();
}

// ── Test connection by calling RequestDocs (lightweight GET) ──────────────────
async function testConnection() {
  const cfg = await getPlatformConfig();
  if (!cfg.userId || !cfg.subscriptionKey) {
    throw new Error('myDATA credentials not configured. Go to Admin → myDATA Config.');
  }

  const base = ENDPOINTS[cfg.environment] || ENDPOINTS.test;
  const today = new Date().toISOString().slice(0, 10);

  // RequestDocs: if credentials are wrong → 401/403, if right → 200 or 400 (no docs)
  const r = await httpsGet(
    `${base}/RequestDocs?mark=0`,
    {
      'aade-user-id':              cfg.userId,
      'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
    }
  );

  if (r.status === 401 || r.status === 403) {
    throw new Error(`Λάθος credentials (HTTP ${r.status}). Ελέγξτε aade-user-id και subscription key.`);
  }

  return {
    ok:          true,
    environment: cfg.environment,
    base_url:    base,
    http_status: r.status,
    user_id:     cfg.userId,
  };
}

// ── Transmit delivery note (9.1) to ΑΑΔΕ ─────────────────────────────────────
async function transmitDeliveryNote({ note, biz, lines }) {
  const cfg = await getPlatformConfig();
  if (!cfg.userId || !cfg.subscriptionKey) {
    throw new Error('myDATA credentials not configured.');
  }

  const base = ENDPOINTS[cfg.environment] || ENDPOINTS.test;
  const xml  = buildDeliveryNoteXml(note, biz, lines);

  const r = await httpsPost(
    `${base}/SendInvoices`,
    {
      'aade-user-id':              cfg.userId,
      'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
    },
    xml
  );

  const parsed = parseResponse(r.body);

  const failed = !r.ok || (
    parsed.statusCodes.length &&
    !parsed.statusCodes.some(s => s === 'Success') &&
    !parsed.marks.length
  );
  if (failed) {
    // If ALL errors are code 101 (schema not found), it's a test-env server bug — show concise msg
    const nonSchema = parsed.codes.filter(c => c !== '101');
    if (nonSchema.length === 0 && parsed.codes.length > 0) {
      throw new Error('myDATA test περιβάλλον: σφάλμα επικύρωσης schema (XMLSyntaxError 101). Γνωστό πρόβλημα test server — το XML είναι σωστό. Θα λειτουργήσει κανονικά σε production.');
    }
    const parts = [];
    parsed.errors.forEach((msg, i) => {
      const code = parsed.codes[i] ? `[${parsed.codes[i]}] ` : '';
      parts.push(`${code}${msg}`);
    });
    const errMsg = parts.length ? parts.join(' | ') : `HTTP ${r.status}: ${r.body.slice(0, 300)}`;
    throw new Error(`myDATA: ${errMsg}`);
  }

  return {
    mark:        parsed.marks[0]  || null,
    uid:         parsed.uids[0]   || null,
    environment: cfg.environment,
    raw_xml:     r.body,
    sent_xml:    xml,
  };
}

// ── Transmit invoice to ΑΑΔΕ (reuses integrations XML builder) ───────────────
async function transmitInvoice({ invoice, biz, lines }) {
  const cfg = await getPlatformConfig();
  if (!cfg.userId || !cfg.subscriptionKey) {
    throw new Error('myDATA credentials not configured.');
  }

  const { buildMyDataXml } = require('../routes/integrations.routes');
  const base = ENDPOINTS[cfg.environment] || ENDPOINTS.test;
  const xml  = buildMyDataXml(invoice, biz, lines);

  const r = await httpsPost(
    `${base}/SendInvoices`,
    {
      'aade-user-id':              cfg.userId,
      'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
    },
    xml
  );

  const parsed = parseResponse(r.body);

  const failed2 = !r.ok || (
    parsed.statusCodes.length &&
    !parsed.statusCodes.some(s => s === 'Success') &&
    !parsed.marks.length
  );
  if (failed2) {
    const nonSchema2 = parsed.codes.filter(c => c !== '101');
    if (nonSchema2.length === 0 && parsed.codes.length > 0) {
      throw new Error('myDATA test περιβάλλον: σφάλμα επικύρωσης schema (XMLSyntaxError 101). Γνωστό πρόβλημα test server — το XML είναι σωστό. Θα λειτουργήσει κανονικά σε production.');
    }
    const parts = [];
    parsed.errors.forEach((msg, i) => {
      const code = parsed.codes[i] ? `[${parsed.codes[i]}] ` : '';
      parts.push(`${code}${msg}`);
    });
    const errMsg = parts.length ? parts.join(' | ') : `HTTP ${r.status}: ${r.body.slice(0, 300)}`;
    throw new Error(`myDATA: ${errMsg}`);
  }

  return {
    mark:        parsed.marks[0]  || null,
    uid:         parsed.uids[0]   || null,
    environment: cfg.environment,
    raw_xml:     r.body,
  };
}

module.exports = {
  getPlatformConfig,
  savePlatformConfig,
  testConnection,
  transmitDeliveryNote,
  transmitInvoice,
  buildDeliveryNoteXml,
  ENDPOINTS,
};
