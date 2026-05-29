/**
 * aade-mydata.service.js
 * Direct AADE myDATA API client for delivery notes (type 9.3).
 * Uses per-business AADE credentials stored in businesses.mydata_user_id + mydata_subscription_key.
 */

const axios = require('axios');
const pool  = require('../config/database');

const AADE_PROD = 'https://mydatapi.aade.gr/MYDATA/SendInvoices';
const AADE_DEV  = 'https://mydataapidev.aade.gr/MYDATA/SendInvoices';

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
  const row = rows[0] || {};
  if (!row.mydata_user_id || !row.mydata_subscription_key) {
    throw new Error(
      'Δεν έχουν οριστεί τα διαπιστευτήρια myDATA ΑΑΔΕ. ' +
      'Μεταβείτε στις Ρυθμίσεις → myDATA για να εισάγετε το UserID και το Subscription Key.'
    );
  }
  return { userId: row.mydata_user_id, subscriptionKey: row.mydata_subscription_key };
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

// Greek UI label → myDATA ENUM (per AADE technical spec)
const MOVE_PURPOSE_MAP = {
  'Πώληση':                    'sale',
  'Αγορά':                     'purchase',
  'Επιστροφή':                 'return',
  'Φύλαξη / Αποθήκευση':      'storage',
  'Μεταφορά / Διανομή':       'distribution',
  'Παραγωγή':                  'production',
  'Δωρεά':                     'donation',
  'Ιδιοχρησιμοποίηση':        'ownUse',
  'Ενδοκοινοτική Μεταφορά':   'intraCommunity',
  'Ζύγιση':                    'weighing',
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

function buildDeliveryNoteXml(note, lines, biz, customer) {
  const issueDate    = (note.issue_date || '').slice(0, 10);
  const dispatchDate = (note.dispatch_date || note.issue_date || '').slice(0, 10);
  const dispatchTime = note.dispatch_time || '00:00:00';

  // Loading address — business premises
  const loadStreet = esc(biz.address || '-');
  const loadPostal = esc(biz.postal_code || '00000');
  const loadCity   = esc(biz.city || '-');

  // Delivery address — recipient
  const delStreet = esc(customer.address || '-');
  const delPostal = esc(customer.postal_code || customer.postal || '00000');
  const delCity   = esc(customer.city || '-');

  const counterpartAfm = customer.afm && customer.afm !== '000000000' ? customer.afm : null;

  const counterpartXml = counterpartAfm
    ? `
    <counterpart>
      <vatNumber>${esc(counterpartAfm)}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
      <name>${esc(customer.name)}</name>
      <address>
        <street>${delStreet}</street>
        <number>-</number>
        <postalCode>${delPostal}</postalCode>
        <city>${delCity}</city>
      </address>
    </counterpart>`
    : '';

  const vehicleXml = note.vehicle_plate
    ? `<vehicleNumber>${esc(note.vehicle_plate)}</vehicleNumber>` : '';

  // Type 9.3 lines: description + quantity + unit only (no values/VAT per AADE spec)
  const linesXml = lines.map((l, idx) => `
    <invoiceDetails>
      <lineNumber>${idx + 1}</lineNumber>
      <itemDescription>${esc(l.description || '')}</itemDescription>
      <quantity>${parseFloat(l.quantity || 0)}</quantity>
      <measurementUnit>${toIsoUnit(l.unit)}</measurementUnit>
    </invoiceDetails>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0_Income/myDATA-invoice-v1.0_Income-schema.xsd">
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
      <movePurpose>${toMovePurpose(note.transport_purpose)}</movePurpose>
      <otherDeliveryNoteHeader>
        <loadingAddress>
          <street>${loadStreet}</street>
          <number>-</number>
          <postalCode>${loadPostal}</postalCode>
          <city>${loadCity}</city>
        </loadingAddress>
        <deliveryAddress>
          <street>${delStreet}</street>
          <number>-</number>
          <postalCode>${delPostal}</postalCode>
          <city>${delCity}</city>
        </deliveryAddress>
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
  const markMatch   = xmlStr.match(/<invoiceRegistrationNumber>(\d+)<\/invoiceRegistrationNumber>/);
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

module.exports = { sendDeliveryNote, buildDeliveryNoteXml, getCredentials };
