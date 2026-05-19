const pool = require('../config/database');
const { calculateTotals } = require('../utils/calculateTotals');

/**
 * Get (and increment) the next invoice number for a given business + series.
 * Uses a transaction with SELECT ... FOR UPDATE to prevent race conditions.
 *
 * @param {number} businessId
 * @param {string} series - series_code e.g. 'A'
 * @returns {Promise<{ number: number, fullNumber: string }>}
 */
async function getNextNumber(businessId, series = 'A') {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the row for update
    const [rows] = await conn.execute(
      `SELECT id, current_number
       FROM invoice_series
       WHERE business_id = ? AND series = ?
       LIMIT 1
       FOR UPDATE`,
      [businessId, series]
    );

    let seriesId, currentNumber;

    if (!rows.length) {
      // Auto-create series if missing
      const [insertResult] = await conn.execute(
        `INSERT INTO invoice_series (business_id, series, current_number, is_default, created_at)
         VALUES (?, ?, 1, 0, NOW())`,
        [businessId, series]
      );
      seriesId = insertResult.insertId;
      currentNumber = 1;
    } else {
      seriesId = rows[0].id;
      currentNumber = rows[0].current_number;
    }

    // Increment
    await conn.execute(
      'UPDATE invoice_series SET current_number = current_number + 1 WHERE id = ?',
      [seriesId]
    );

    await conn.commit();

    return {
      number: currentNumber,
      fullNumber: `${series}-${String(currentNumber).padStart(6, '0')}`,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Recalculate invoice totals from its lines and update the invoice record.
 *
 * @param {number} invoiceId
 */
async function calculateAndSaveInvoice(invoiceId) {
  const [lines] = await pool.execute(
    'SELECT * FROM invoice_lines WHERE invoice_id = ?',
    [invoiceId]
  );

  const { netValue, vatAmount, totalValue, discountAmount } = calculateTotals(lines);

  await pool.execute(
    `UPDATE invoices
     SET net_value = ?, vat_amount = ?, total_value = ?, discount_amount = ?, updated_at = NOW()
     WHERE id = ?`,
    [netValue, vatAmount, totalValue, discountAmount, invoiceId]
  );

  return { netValue, vatAmount, totalValue, discountAmount };
}

/**
 * Transmit an invoice to e-timologiera (V4 API) for AADE myDATA registration.
 * Logs every attempt in transmission_logs.
 *
 * @param {object} invoice - invoice row from the database
 */
async function transmit(invoice) {
  const etim = require('./etimologiera.service');

  try {
    const [lineRows] = await pool.execute(
      `SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number`,
      [invoice.id]
    );
    const [bizRows] = await pool.execute(
      `SELECT b.*, bs.mydata_user_id, bs.mydata_subscription_key
       FROM businesses b
       LEFT JOIN business_settings bs ON bs.business_id = b.id
       WHERE b.id = ? LIMIT 1`,
      [invoice.business_id]
    );
    const biz = bizRows[0] || {};

    // Fetch customer details for the counterpart block
    let customer = {};
    if (invoice.customer_id) {
      const [custRows] = await pool.execute(
        `SELECT name, afm, address, city, postal_code, phone, email, doy
         FROM customers WHERE id = ? LIMIT 1`,
        [invoice.customer_id]
      );
      customer = custRows[0] || {};
    }
    // Fallback: invoice may store customer_name / customer_afm directly
    if (!customer.name && invoice.customer_name) customer.name = invoice.customer_name;
    if (!customer.afm  && invoice.customer_afm)  customer.afm  = invoice.customer_afm;

    const payload = buildEtimPayload(invoice, lineRows, biz, customer);
    const etResult = await etim.sendInvoice(payload, invoice.business_id);

    if (etResult.mark) {
      await pool.execute(
        `UPDATE invoices SET status='transmitted', mydata_mark=?, mydata_qr=?,
         etimologiera_uid=?, last_error=NULL, updated_at=NOW() WHERE id=?`,
        [etResult.mark, etResult.qrUrl || null, etResult.uid || null, invoice.id]
      );
      await pool.execute(
        `INSERT INTO transmission_logs (invoice_id, business_id, status, response_message, attempted_at, created_at)
         VALUES (?, ?, 'success', ?, NOW(), NOW())`,
        [invoice.id, invoice.business_id, `MARK: ${etResult.mark} | UID: ${etResult.uid} | ENV: ${etResult.testMode ? 'TEST' : 'PROD'}`]
      );
      return { success: true, mark: etResult.mark, qrUrl: etResult.qrUrl, uid: etResult.uid, testMode: etResult.testMode };
    } else {
      throw new Error(etResult.errors?.join(', ') || 'No MARK returned from e-timologiera');
    }

  } catch (err) {
    const message = err.message || String(err);
    await pool.execute(
      `INSERT INTO transmission_logs (invoice_id, business_id, status, response_message, attempted_at, created_at)
       VALUES (?, ?, 'failed', ?, NOW(), NOW())`,
      [invoice.id, invoice.business_id, message]
    );
    await pool.execute(
      `UPDATE invoices SET status='failed', last_error=?, retry_count=retry_count+1, updated_at=NOW() WHERE id=?`,
      [message, invoice.id]
    );
    return { success: false, message };
  }
}

// VAT rate (%) → myDATA vatCategory code
function vatRateToCategory(rate) {
  const r = parseFloat(rate || 0);
  if (r >= 24) return 1; // 24%
  if (r >= 13) return 2; // 13%
  if (r >= 9)  return 5; // 9% island reduced
  if (r >= 6)  return 3; // 6%
  return 4;              // 0% / exempt
}

// FishBill payment_method → myDATA payment type
function paymentMethodToType(method) {
  switch ((method || '').toLowerCase()) {
    case 'bank_transfer': return 1;
    case 'cash':          return 3;
    case 'credit':        return 5;
    case 'check':         return 3;
    case 'iris':          return 8;
    case 'credit_card':
    case 'card':          return 7;
    default:              return 3; // μετρητά / default
  }
}

/**
 * Build a V4-format payload for e-timologiera sendInvoice.
 * Handles both invoices (1.1, 1.3, etc.) and delivery notes (9.3).
 */
function buildEtimPayload(invoice, lines, biz, customer = {}) {
  const TYPE_MAP = {
    '1.1':  '1.1',  'sales':         '1.1',  // Τιμολόγιο Πώλησης
    '1.2':  '1.2',                            // Τιμολόγιο Πώλησης Ενδοκοινοτικές
    '1.3':  '1.3',  'sales_return':  '1.3',  // Πιστωτικό Τιμολόγιο
    '1.4':  '1.4',                            // Τιμολόγιο Τρίτων Χωρών
    '2.1':  '2.1',                            // Τιμολόγιο Παροχής
    '5.1':  '5.1',                            // Πιστωτικό Τιμολόγιο Παροχής
    '9.3':  '9.3',  'delivery_note': '9.3',  // Δελτίο Αποστολής
    '11.1': '11.1', 'retail':        '11.1', // Λιανική Απόδειξη
    '11.4': '11.4', 'retail_return': '11.4', // Πιστωτικό Λιανικής
  };
  const invoiceType = TYPE_MAP[invoice.invoice_type] || '1.1';
  const isDeliveryNote = invoiceType === '9.3';

  const issueDate  = (invoice.issue_date || invoice.invoice_date || invoice.created_at || '').split('T')[0];
  const totalGross = parseFloat(invoice.total_value || invoice.total_amount || invoice.gross_total || 0);
  const totalNet   = parseFloat(invoice.net_value   || invoice.net_total    || invoice.subtotal    || 0);
  const totalVat   = parseFloat(invoice.vat_amount  || invoice.vat_total    || invoice.vat         || 0);

  // ── Aggregate VAT analysis across all lines ─────────────────────────────
  const vatMap = {};
  for (const ln of (lines || [])) {
    const rate = parseFloat(ln.vat_rate || 0);
    const cat  = vatRateToCategory(rate);
    if (!vatMap[cat]) vatMap[cat] = { vatCategory: cat, vatPercent: rate, netValuePerVat: 0, vatAmount: 0 };
    vatMap[cat].netValuePerVat += parseFloat(ln.net_value || 0);
    vatMap[cat].vatAmount      += parseFloat(ln.vat_amount || 0);
  }
  const invoiceVatAnalysis = Object.values(vatMap).map(v => ({
    vatCategory:   v.vatCategory,
    vatPercent:    v.vatPercent,
    netValuePerVat: Math.round(v.netValuePerVat * 100) / 100,
    vatAmount:      Math.round(v.vatAmount      * 100) / 100,
  }));

  // ── Invoice lines ────────────────────────────────────────────────────────
  const netTotal = Math.round(totalNet * 100) / 100;
  const invoiceDetails = (lines || []).map((ln, idx) => {
    const net      = Math.round(parseFloat(ln.net_value  || 0) * 100) / 100;
    const vat      = Math.round(parseFloat(ln.vat_amount || 0) * 100) / 100;
    const qty      = parseFloat(ln.quantity   || 1);
    const price    = parseFloat(ln.unit_price || 0);
    const vatRate  = parseFloat(ln.vat_rate   || 0);
    const vatCat   = isDeliveryNote ? 8 : vatRateToCategory(vatRate); // 8 = exempt for delivery notes
    const detail   = {
      name:                    ln.description || ln.name || `Γραμμή ${idx + 1}`,
      lineNumber:              idx + 1,
      quantity:                qty,
      measurementUnit:         1, // 1 = Τεμάχιο
      measurementUnitName:     ln.unit || 'KG',
      netValueBeforeDiscount:  net,
      netValue:                net,
      vatAmount:               isDeliveryNote ? 0 : vat,
      vatCategory:             vatCat,
      price:                   price,
      vatPercent:              isDeliveryNote ? 0 : vatRate,
      priceIncludeVAT:         0,
    };
    if (!isDeliveryNote) {
      // Income classification for domestic fish sales
      detail.incomeClassification = [{
        classificationType:    'E3_561_001',
        classificationCategory:'category1_1',
        amount: net,
        id: idx + 1,
      }];
    } else {
      detail.incomeClassification = [{
        classificationCategory: 'category3',
        amount: 0,
        id: idx + 1,
      }];
    }
    return detail;
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  const invoiceSummary = {
    totalNetValue:         netTotal,
    totalVatAmount:        Math.round(totalVat * 100) / 100,
    totalWithheldAmount:   0,
    totalFeesAmount:       0,
    totalStampDutyAmount:  0,
    totalOtherTaxesAmount: 0,
    totalDeductionsAmount: 0,
    totalGrossValue:       Math.round(totalGross * 100) / 100,
    totalPrintGrossValue:  Math.round(totalGross * 100) / 100,
  };
  if (!isDeliveryNote) {
    invoiceSummary.incomeClassification = [{
      classificationType:    'E3_561_001',
      classificationCategory:'category1_1',
      amount: netTotal,
      id: 1,
    }];
  } else {
    invoiceSummary.incomeClassification = [{ classificationCategory: 'category3', amount: 0, id: 1 }];
  }

  // ── Counterpart (customer) ───────────────────────────────────────────────
  const counterpart = {
    vatNumber: customer.afm || '000000000',
    country:   'GR',
    branch:    0,
    address: {
      postalCode: customer.postal_code || customer.postal || ' ',
      city:       customer.city        || 'ΕΛΛΑΔΑ',
    },
  };
  if (customer.name) counterpart.name = customer.name;

  // ── Extra block (for PDF generation at etimologiera side) ────────────────
  const extra = {
    salerName:     biz.name        || '',
    salerVat:      biz.afm         || '',
    salerActivity: 'ΑΛΙΕΙΑ',
    salerStreetName:            biz.address     || '',
    salerAdditionalStreetName:  '',
    salerTk:       biz.postal_code || '',
    salerCity:     biz.city        || '',
    salerPhone:    biz.phone       || '',
    salerEmail:    biz.email       || '',
    salerDoyCode:  biz.doy_code    || 0,
    salerDoyName:  biz.doy         || '',
    customerName:  customer.name   || '',
    customerVat:   customer.afm    || '',
    customerStreetName: customer.address    || '',
    customerTk:         customer.postal_code || customer.postal || '',
    customerCity:       customer.city       || '',
    customerPhone:      customer.phone      || '',
    customerEmail:      customer.email      || '',
    invoiceTypeName: isDeliveryNote ? 'Δελτίο Αποστολής' : 'Τιμολόγιο Πώλησης',
    paymentMethodName: invoice.payment_method || 'Μετρητά',
  };

  // ── Invoice header ───────────────────────────────────────────────────────
  const invoiceHeader = {
    series:      invoice.series  || 'A',
    aa:          String(invoice.number || invoice.aa || '1'),
    issueDate,
    invoiceType,
    currency:    'EUR',
  };

  // Delivery note extra header fields
  if (isDeliveryNote && invoice.dispatch_date) {
    invoiceHeader.dispatchDate  = invoice.dispatch_date;
    invoiceHeader.dispatchTime  = invoice.dispatch_time || '00:00:00';
    invoiceHeader.vehicleNumber = invoice.vehicle_plate || '';
    invoiceHeader.movePurpose   = 1; // 1 = Πώληση
    invoiceHeader.otherDeliveryNoteHeader = {
      loadingAddress: {
        street:     biz.address     || '',
        number:     '-',
        postalCode: biz.postal_code || '',
        city:       biz.city        || '',
      },
      deliveryAddress: {
        street:     customer.address    || '',
        number:     '-',
        postalCode: customer.postal_code || customer.postal || '',
        city:       customer.city       || '',
      },
      startShippingBranch:    0,
      completeShippingBranch: 0,
    };
    extra.vehicleNumber = invoice.vehicle_plate || '';
    extra.shipmentName  = 'Οδικώς';
  }

  return {
    invoice: [{
      isUnsigned: false,
      issuer: {
        vatNumber: biz.afm || '',
        country:   'GR',
        branch:    0,
      },
      counterpart,
      invoiceHeader,
      paymentMethods: {
        paymentMethodDetails: [{
          type:   paymentMethodToType(invoice.payment_method),
          amount: Math.round(totalGross * 100) / 100,
        }],
      },
      invoiceDetails,
      invoiceSummary,
      invoiceVatAnalysis,
      extra,
    }],
  };
}

/**
 * Generate PDF for an invoice (delegates to pdf.service).
 *
 * @param {object} invoice
 * @returns {Promise<string>} file path to generated PDF
 */
async function generatePDF(invoice) {
  const pdfService = require('./pdf.service');
  return pdfService.generateInvoicePDF(invoice);
}

module.exports = { getNextNumber, calculateAndSaveInvoice, transmit, generatePDF, buildEtimPayload };
