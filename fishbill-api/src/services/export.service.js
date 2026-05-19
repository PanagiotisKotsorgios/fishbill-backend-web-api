const { format } = require('@fast-csv/format');
const pool = require('../config/database');

/**
 * Query invoices based on filters and write CSV rows to the provided stream.
 * @param {object} filters - { status, from, to, customer_id, q }
 * @param {number|null} businessId
 * @param {boolean} isSuperAdmin
 * @param {import('stream').Writable} outputStream
 */
async function exportInvoicesCSV(filters, businessId, isSuperAdmin, outputStream) {
  const conditions = [];
  const params = [];

  if (!isSuperAdmin) {
    conditions.push('i.business_id = ?');
    params.push(businessId);
  } else if (filters.business_id) {
    conditions.push('i.business_id = ?');
    params.push(filters.business_id);
  }

  if (filters.status) { conditions.push('i.status = ?'); params.push(filters.status); }
  if (filters.from)   { conditions.push('i.issue_date >= ?'); params.push(filters.from); }
  if (filters.to)     { conditions.push('i.issue_date <= ?'); params.push(filters.to); }
  if (filters.q) {
    conditions.push('(i.full_number LIKE ? OR c.name LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.execute(
    `SELECT
       i.id, i.full_number, i.series, i.issue_date, i.due_date,
       i.status, i.payment_method,
       i.net_value, i.vat_amount, i.discount_amount, i.total_value,
       i.mydata_mark, i.last_error, i.retry_count,
       i.cancelled_at, i.created_at,
       c.name AS customer_name, c.afm AS customer_afm, c.city AS customer_city,
       b.name AS business_name, b.afm AS business_afm
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN businesses b ON b.id = i.business_id
     ${where}
     ORDER BY i.issue_date DESC, i.id DESC`,
    params
  );

  const csvStream = format({ headers: true, delimiter: ',' });
  csvStream.pipe(outputStream);

  for (const row of rows) {
    csvStream.write({
      ID: row.id,
      'Invoice Number': row.full_number,
      Series: row.series,
      Date: row.issue_date ? String(row.issue_date).slice(0, 10) : '',
      'Due Date': row.due_date ? String(row.due_date).slice(0, 10) : '',
      Status: row.status,
      'Payment Method': row.payment_method,
      'Customer Name': row.customer_name,
      'Customer AFM': row.customer_afm,
      'Business Name': row.business_name,
      'Business AFM': row.business_afm,
      'Net Value': row.net_value,
      'VAT Amount': row.vat_amount,
      'Discount': row.discount_amount,
      'Total Value': row.total_value,
      MARK: row.mydata_mark || '',
      'Retry Count': row.retry_count,
      'Error': row.last_error || '',
      'Created At': row.created_at ? String(row.created_at).slice(0, 19) : '',
    });
  }

  return new Promise((resolve, reject) => {
    csvStream.end();
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
    csvStream.on('error', reject);
  });
}

/**
 * Query customers and write CSV rows to the provided stream.
 * @param {number} businessId
 * @param {boolean} isSuperAdmin
 * @param {import('stream').Writable} outputStream
 */
async function exportCustomersCSV(businessId, isSuperAdmin, outputStream) {
  const conditions = [];
  const params = [];

  if (!isSuperAdmin) {
    conditions.push('c.business_id = ?');
    params.push(businessId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.execute(
    `SELECT
       c.id, c.name, c.afm, c.doy, c.address, c.city, c.postal_code,
       c.phone, c.email, c.contact_person, c.notes, c.payment_terms,
       c.is_active, c.created_at,
       b.name AS business_name
     FROM customers c
     LEFT JOIN businesses b ON b.id = c.business_id
     ${where}
     ORDER BY c.name`,
    params
  );

  const csvStream = format({ headers: true, delimiter: ',' });
  csvStream.pipe(outputStream);

  for (const row of rows) {
    csvStream.write({
      ID: row.id,
      Name: row.name,
      AFM: row.afm || '',
      DOY: row.doy || '',
      Address: row.address || '',
      City: row.city || '',
      'Postal Code': row.postal_code || '',
      Phone: row.phone || '',
      Email: row.email || '',
      'Contact Person': row.contact_person || '',
      Notes: row.notes || '',
      'Payment Terms (days)': row.payment_terms || '',
      Active: row.is_active ? 'Yes' : 'No',
      Business: row.business_name || '',
      'Created At': row.created_at ? String(row.created_at).slice(0, 19) : '',
    });
  }

  return new Promise((resolve, reject) => {
    csvStream.end();
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
    csvStream.on('error', reject);
  });
}


/**
 * Query products and write CSV rows to the provided stream.
 * @param {number} businessId
 * @param {boolean} isSuperAdmin
 * @param {import('stream').Writable} outputStream
 */
async function exportProductsCSV(businessId, isSuperAdmin, outputStream) {
  const conditions = [];
  const params = [];

  if (!isSuperAdmin) {
    conditions.push('p.business_id = ?');
    params.push(businessId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.execute(
    `SELECT
       p.id, p.name, p.code, p.description, p.unit,
       p.default_price, p.vat_rate, p.income_category,
       p.is_active, p.created_at,
       b.name AS business_name
     FROM products p
     LEFT JOIN businesses b ON b.id = p.business_id
     ${where}
     ORDER BY p.name`,
    params
  );

  const csvStream = format({ headers: true, delimiter: ',' });
  csvStream.pipe(outputStream);

  for (const row of rows) {
    csvStream.write({
      ID: row.id,
      Name: row.name,
      Code: row.code || '',
      Description: row.description || '',
      Unit: row.unit || '',
      'Unit Price': row.default_price != null ? row.default_price : '',
      'VAT Rate (%)': row.vat_rate,
      'Income Category': row.income_category || '',
      Active: row.is_active ? 'Yes' : 'No',
      Business: row.business_name || '',
      'Created At': row.created_at ? String(row.created_at).slice(0, 19) : '',
    });
  }

  return new Promise((resolve, reject) => {
    csvStream.end();
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
    csvStream.on('error', reject);
  });
}

module.exports = { exportInvoicesCSV, exportCustomersCSV, exportProductsCSV };
