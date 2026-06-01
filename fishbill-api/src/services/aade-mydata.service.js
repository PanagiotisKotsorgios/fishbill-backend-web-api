/**
 * aade-mydata.service.js
 * Direct AADE myDATA API client for delivery notes (type 9.3).
 * Uses platform-level credentials from platform_settings (set via Admin → myDATA).
 * Each fisherman's AFM is placed in issuer.vatNumber — the standard ERP provider model.
 */

const axios = require('axios');
const pool  = require('../config/database');

const AADE_PROD        = 'https://mydatapi.aade.gr/MYDATA/SendInvoices';
const AADE_DEV         = 'https://mydataapidev.aade.gr/MYDATA/SendInvoices';
const AADE_CANCEL_PROD = 'https://mydatapi.aade.gr/MYDATA/CancelInvoice';
const AADE_CANCEL_DEV  = 'https://mydataapidev.aade.gr/MYDATA/CancelInvoice';

async function isTestMode() {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_value FROM platform_settings WHERE setting_key = 'mydata_test_mode' LIMIT 1"
    );
    return rows.length > 0 && (rows[0].setting_value === '1' || rows[0].setting_value === 'true');
  } catch { return false; }
}

async function getCredentials(businessId) {
  const [rows] = await pool.execute(
    'SELECT mydata_user_id, mydata_subscription_key FROM businesses WHERE id = ? LIMIT 1',
    [businessId]
  );
  const biz = rows[0] || {};
  if (!biz.mydata_user_id || !biz.mydata_subscription_key) {
    throw new Error(
      'Δεν έχουν οριστεί τα διαπιστευτήρια myDATA ΑΑΔΕ για αυτή την επιχείρηση. ' +
      'Μεταβείτε στις Ρυθμίσεις → myDATA για να εισάγετε το UserID και το Subscription Key.'
    );
  }
  return { userId: biz.mydata_user_id, subscriptionKey: biz.mydata_subscription_key };
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmt(num) {
  return parseFloat(num || 0).toFixed(2);
}

// MySQL2 returns DATE/DATETIME as JS Date objects when dateStrings is not set.
// Use local getters to avoid UTC-offset shifting the date by one day.
function fmtDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
}

// Greek UI label → AADE myDATA movePurpose integer codes (per AADE technical spec v1.0.9+)
// https://www.aade.gr/sites/default/files/2023-12/myDATA_API_Documentation_v1.0.9_official.pdf
const MOVE_PURPOSE_MAP = {
  'Πώληση':                    1,   // Sale
  'Αγορά':                     2,   // Purchase
  'Επιστροφή':                 3,   // Return
  'Φύλαξη / Αποθήκευση':      9,   // Storage
  'Μεταφορά / Διανομή':       5,   // Distribution
  'Παραγωγή':                  8,   // Production
  'Δωρεά':                     5,   // Distribution / Free of charge
  'Ιδιοχρησιμοποίηση':        10,  // Own use
  'Ενδοκοινοτική Μεταφορά':   6,   // Intra-community transfer
  'Ζύγιση':                    7,   // Weighing
};

// Greek unit label → ISO 3-letter code (UN/CEFACT)
const UNIT_MAP = {
  'kg':    'KGM',
  'κιλά':  'KGM',
  'γρ.':   'GRM',
  'τόν.':  'TNE',
  'lt':    'LTR',
  'τεμ.':  'C62',
  'κιβ.':  'BX',
};

function toIsoUnit(unit) {
  return UNIT_MAP[unit] || UNIT_MAP[(unit || '').toLowerCase()] || 'KGM';
}

function toMovePurpose(purpose) {
  return MOVE_PURPOSE_MAP[purpose] || 'sale';
}

/**
 * Build an AddressType XML block.
 * Returns null if postalCode or city is missing (AADE XSD requires both).
 * street is always optional.
 */
function buildAddressXml(tag, street, postalCode, city) {
  const p = (postalCode || '').trim();
  const c = (city       || '').trim();
  if (!p || !c) return null;  // both required by AADE XSD — omit whole block if either missing
  const streetLine = street ? `\n          <street>${esc(street)}</street>` : '';
  return `<${tag}>${streetLine}
          <postalCode>${esc(p)}</postalCode>
          <city>${esc(c)}</city>
        </${tag}>`;
}

function buildDeliveryNoteXml(note, lines, biz, customer) {
  const issueDate    = fmtDate(note.issue_date);
  const dispatchDate = fmtDate(note.dispatch_date || note.issue_date);
  const dispatchTime = note.dispatch_time || '00:00:00';

  const counterpartAfm = customer.afm && customer.afm !== '000000000' ? customer.afm : null;

  // Counterpart address: only include if postalCode AND city are present
  const counterpartAddrXml = buildAddressXml(
    'address',
    customer.address,
    customer.postal_code || customer.postal,
    customer.city
  );
  const counterpartXml = counterpartAfm
    ? `
    <counterpart>
      <vatNumber>${esc(counterpartAfm)}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
      <name>${esc(customer.name)}</name>
      ${counterpartAddrXml || ''}
    </counterpart>`
    : '';

  const vehicleXml = note.vehicle_plate
    ? `<vehicleNumber>${esc(note.vehicle_plate)}</vehicleNumber>` : '';

  // movePurpose must be integer per AADE spec; default to 1 (Sale) if unrecognised
  const movePurposeCode = toMovePurpose(note.transport_purpose);

  // Address blocks: only rendered when postalCode + city are both present
  const loadingAddrXml  = buildAddressXml('loadingAddress',  biz.address,       biz.postal_code,                     biz.city);
  const deliveryAddrXml = buildAddressXml('deliveryAddress', customer.address,  customer.postal_code || customer.postal, customer.city);

  if (!loadingAddrXml) {
    console.warn('[aade-mydata] loadingAddress omitted — business missing postalCode or city');
  }
  if (!deliveryAddrXml) {
    console.warn('[aade-mydata] deliveryAddress omitted — recipient missing postalCode or city');
  }

  // Type 9.3 lines: description + quantity + unit only (no values/VAT per AADE spec)
  const linesXml = lines.map((l, idx) => `
    <invoiceDetails>
      <lineNumber>${idx + 1}</lineNumber>
      <itemDescription>${esc(l.description || '')}</itemDescription>
      <quantity>${parseFloat(l.quantity || 0)}</quantity>
      <measurementUnit>${toIsoUnit(l.unit)}</measurementUnit>
    </invoiceDetails>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xmlns="https://www.aade.gr/myDATA/invoice/v1.0">
  <invoice>
    <issuer>
      <vatNumber>${esc(biz.afm)}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
    </issuer>${counterpartXml}
    <invoiceHeader>
      <series>${esc(note.series)}</series>
      <aa>${note.number}</aa>
      <issueDate>${issueDate}</issueDate>
      <invoiceType>9.3</invoiceType>
      <currency>EUR</currency>
      <dispatchDate>${dispatchDate}</dispatchDate>
      <dispatchTime>${dispatchTime}</dispatchTime>
      ${vehicleXml}
      <movePurpose>${movePurposeCode}</movePurpose>
      <otherDeliveryNoteHeader>
        ${loadingAddrXml  || ''}
        ${deliveryAddrXml || ''}
        <startShippingBranch>0</startShippingBranch>
        <completeShippingBranch>0</completeShippingBranch>
      </otherDeliveryNoteHeader>
    </invoiceHeader>${linesXml}
    <invoiceSummary>
      <totalNetValue>0.00</totalNetValue>
      <totalVatAmount>0.00</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>0.00</totalGrossValue>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`;
}

function parseMark(xmlStr) {
  // AADE v2.0+ uses <invoiceMark>; older v1.x used <invoiceRegistrationNumber>
  const markMatch   = xmlStr.match(/<invoiceMark>(\d+)<\/invoiceMark>/) ||
                      xmlStr.match(/<invoiceRegistrationNumber>(\d+)<\/invoiceRegistrationNumber>/);
  const uidMatch    = xmlStr.match(/<invoiceUid>([^<]+)<\/invoiceUid>/);
  const statusMatch = xmlStr.match(/<statusCode>([^<]+)<\/statusCode>/);

  const mark   = markMatch   ? markMatch[1]   : null;
  const uid    = uidMatch    ? uidMatch[1]    : null;
  const status = statusMatch ? statusMatch[1] : null;

  if (mark && status === 'Success') {
    return { mark, uid, success: true };
  }

  const errorMessages = [];
  const errorRegex = /<message>([^<]+)<\/message>/g;
  let m;
  while ((m = errorRegex.exec(xmlStr)) !== null) {
    errorMessages.push(m[1]);
  }

  return { mark: null, uid: null, success: false, errors: errorMessages, raw: xmlStr };
}

/**
 * Transmits a delivery note directly to AADE myDATA.
 * Returns { mark, uid, testMode }.
 */
async function sendDeliveryNote(note, lines, biz, customer, businessId) {
  const creds    = await getCredentials(businessId);
  const testMode = await isTestMode();
  const url      = testMode ? AADE_DEV : AADE_PROD;
  const xml      = buildDeliveryNoteXml(note, lines, biz, customer);

  let responseXml;
  try {
    const response = await axios.post(url, xml, {
      headers: {
        'Content-Type':              'text/xml; charset=utf-8',
        'aade-user-id':              creds.userId,
        'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
      },
      timeout:      30000,
      responseType: 'text',
    });
    responseXml = response.data;
  } catch (err) {
    if (err.response) {
      responseXml = typeof err.response.data === 'string' ? err.response.data : '';
      const parsed = parseMark(responseXml);
      const errMsg = parsed.errors?.join(', ') ||
        `ΑΑΔΕ σφάλμα ${err.response.status}: ${responseXml.slice(0, 200)}`;
      throw new Error(errMsg);
    }
    throw new Error(`Αδυναμία σύνδεσης με ΑΑΔΕ myDATA: ${err.message}`);
  }

  const result = parseMark(responseXml);
  if (!result.success) {
    throw new Error(
      result.errors?.join(', ') ||
      `ΑΑΔΕ απόρριψη: ${responseXml.slice(0, 300)}`
    );
  }

  return { mark: result.mark, uid: result.uid, testMode };
}

/**
 * Cancels a previously transmitted delivery note by its AADE MARK.
 * Calls GET /MYDATA/CancelInvoice?mark={MARK}&entityVatNumber={AFM}
 * Returns { success: true, cancellationMark } or throws.
 */
async function cancelDeliveryNote(mark, businessAfm, businessId) {
  if (!mark) throw new Error('Δεν υπάρχει ΜΑΡΚ για ακύρωση στην ΑΑΔΕ.');
  const creds    = await getCredentials(businessId);
  const testMode = await isTestMode();
  const baseUrl  = testMode ? AADE_CANCEL_DEV : AADE_CANCEL_PROD;

  let responseXml;
  try {
    const response = await axios.get(baseUrl, {
      params:  { mark, entityVatNumber: businessAfm },
      headers: {
        'aade-user-id':              creds.userId,
        'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
      },
      timeout:      30000,
      responseType: 'text',
    });
    responseXml = response.data;
  } catch (err) {
    if (err.response) {
      responseXml = typeof err.response.data === 'string' ? err.response.data : '';
      const parsed = parseMark(responseXml);
      throw new Error(parsed.errors?.join(', ') || `ΑΑΔΕ ακύρωση σφάλμα ${err.response.status}`);
    }
    throw new Error(`Αδυναμία σύνδεσης με ΑΑΔΕ myDATA: ${err.message}`);
  }

  // Response contains a cancellationMark (different tag from SendInvoices)
  const cancelMarkMatch = responseXml.match(/<cancellationMark>(\d+)<\/cancellationMark>/);
  const statusMatch     = responseXml.match(/<statusCode>([^<]+)<\/statusCode>/);

  if (cancelMarkMatch && statusMatch?.[1] === 'Success') {
    return { success: true, cancellationMark: cancelMarkMatch[1], testMode };
  }

  const errorMessages = [];
  const errorRegex = /<message>([^<]+)<\/message>/g;
  let m;
  while ((m = errorRegex.exec(responseXml)) !== null) errorMessages.push(m[1]);

  throw new Error(errorMessages.join(', ') || `ΑΑΔΕ απόρριψη ακύρωσης: ${responseXml.slice(0, 300)}`);
}

module.exports = { sendDeliveryNote, cancelDeliveryNote, buildDeliveryNoteXml, getCredentials };
