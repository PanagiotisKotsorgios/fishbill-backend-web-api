const express = require('express');
const router = express.Router();
const Joi = require('joi');
const https = require('https');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../middleware/audit');

router.use(authenticate);

// ---------------------------------------------------------------------------
// ΓΓΠΣ / GSIS AFM lookup helper
// ---------------------------------------------------------------------------
function gsisLookup(username, password, afm) {
  return new Promise((resolve, reject) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://ws.kbl.taxis.gr/">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:rgWsPublic2AfmMethod>
      <RgWsPublic2AfmInput>
        <afm_called_by/>
        <afm_called_for>${afm}</afm_called_for>
      </RgWsPublic2AfmInput>
      <RgWsPublicAaOutput>
        <call_seq_id>0</call_seq_id>
        <error_rec><error_code/><error_descr/></error_rec>
      </RgWsPublicAaOutput>
    </ws:rgWsPublic2AfmMethod>
  </soapenv:Body>
</soapenv:Envelope>`;

    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const opts = {
      hostname: 'www1.gsis.gr',
      port: 443,
      path: '/webtax2/ows/KblService',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(xml, 'utf8'),
        'SOAPAction': '""',
        'Authorization': `Basic ${auth}`,
      },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('GSIS_AUTH_FAILED'));
        // Parse XML fields
        const get = (tag) => { const m = data.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1].trim() : ''; };
        const errorCode = get('error_code') || get('errorCode');
        if (errorCode && errorCode !== '0') {
          return reject(new Error(`GSIS_ERROR:${errorCode}:${get('error_descr') || get('errorDescr')}`));
        }
        const onomasia = get('onomasia') || get('Onomasia');
        const commerTitle = get('commerTitle') || get('CommerTitle');
        const doyDescr = get('doyDescr') || get('DoyDescr');
        const postalAddress = get('postalAddress') || get('PostalAddress');
        const postalAddressNo = get('postalAddressNo') || get('PostalAddressNo');
        const postalZipCode = get('postalZipCode') || get('PostalZipCode');
        const postalAreaDescription = get('postalAreaDescription') || get('PostalAreaDescription');
        if (!onomasia) return reject(new Error('GSIS_NOT_FOUND'));
        resolve({
          name: onomasia,
          trade_name: commerTitle || onomasia,
          doy: doyDescr,
          address: [postalAddress, postalAddressNo].filter(Boolean).join(' '),
          city: postalAreaDescription,
          postal_code: postalZipCode,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('GSIS_TIMEOUT')); });
    req.write(xml);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// GET /api/customers/lookup-afm?afm=123456789
// ---------------------------------------------------------------------------
router.get('/lookup-afm', async (req, res, next) => {
  try {
    const { afm } = req.query;
    if (!afm || !/^\d{9}$/.test(afm)) {
      return res.status(400).json({ error: 'Το ΑΦΜ πρέπει να είναι 9 ψηφία.' });
    }

    const bizId = req.user.business_id;
    const [bizRows] = await pool.execute('SELECT gsis_username, gsis_password FROM businesses WHERE id = ? LIMIT 1', [bizId]);
    const biz = bizRows[0] || {};

    if (!biz.gsis_username || !biz.gsis_password) {
      return res.status(422).json({ error_code: 'NO_GSIS_CREDS', error: 'Τα στοιχεία πρόσβασης ΓΓΠΣ δεν έχουν ρυθμιστεί. Επικοινωνήστε με τον λογιστή σας.' });
    }

    try {
      const data = await gsisLookup(biz.gsis_username, biz.gsis_password, afm);
      return res.json({ data });
    } catch (gsisErr) {
      const msg = gsisErr.message || '';
      if (msg === 'GSIS_AUTH_FAILED') {
        return res.status(502).json({ error: 'Λανθασμένα στοιχεία πρόσβασης ΓΓΠΣ. Ελέγξτε τις ρυθμίσεις.' });
      }
      if (msg === 'GSIS_NOT_FOUND') {
        return res.status(404).json({ error: 'Δεν βρέθηκε επιχείρηση με αυτό το ΑΦΜ.' });
      }
      if (msg === 'GSIS_TIMEOUT') {
        return res.status(504).json({ error: 'Το ΓΓΠΣ δεν απάντησε εγκαίρως. Δοκιμάστε ξανά.' });
      }
      return res.status(502).json({ error: `Σφάλμα ΓΓΠΣ: ${msg}` });
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const customerSchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  afm: Joi.string().max(15).optional().allow('', null),
  doy: Joi.string().max(100).optional().allow('', null),
  address: Joi.string().max(255).optional().allow('', null),
  city: Joi.string().max(100).optional().allow('', null),
  postal_code: Joi.string().max(10).optional().allow('', null),
  phone: Joi.string().max(30).optional().allow('', null),
  email: Joi.string().email().optional().allow('', null),
  contact_person: Joi.string().max(255).optional().allow('', null),
  notes: Joi.string().max(1000).optional().allow('', null),
  payment_terms: Joi.number().integer().min(0).max(365).optional(),
});

const updateCustomerSchema = customerSchema.fork(['name'], (f) => f.optional());

// Utility: resolve business_id based on role
function getBusinessId(req) {
  return req.user.role === 'super_admin' && req.query.business_id
    ? req.query.business_id
    : req.user.business_id;
}

// ---------------------------------------------------------------------------
// GET /api/customers/recent  — must be before /:id
// ---------------------------------------------------------------------------
router.get('/recent', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);

    const [rows] = await pool.execute(
      `SELECT c.id, c.name, c.afm, c.city, c.phone, c.email,
              MAX(i.issue_date) AS last_invoice_date,
              COUNT(i.id) AS invoice_count
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id
       WHERE c.business_id = ? AND c.is_active = 1
       GROUP BY c.id
       HAVING last_invoice_date IS NOT NULL
       ORDER BY last_invoice_date DESC
       LIMIT 10`,
      [businessId]
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/customers/search
// ---------------------------------------------------------------------------
router.get('/search', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const q = req.query.q ? `%${req.query.q}%` : null;

    if (!q) {
      return res.status(400).json({ error: 'Η παράμετρος αναζήτησης απαιτείται.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, name, afm, city, phone, email
       FROM customers
       WHERE business_id = ? AND is_active = 1
         AND (name LIKE ? OR afm LIKE ? OR email LIKE ?)
       ORDER BY name
       LIMIT 50`,
      [businessId, q, q, q]
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/customers
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const q = req.query.q ? `%${req.query.q}%` : null;

    const params = [businessId];
    let searchClause = '';
    if (q) {
      searchClause = 'AND (c.name LIKE ? OR c.afm LIKE ? OR c.email LIKE ? OR c.city LIKE ?)';
      params.push(q, q, q, q);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM customers c
       WHERE c.business_id = ? AND c.is_active = 1 ${searchClause}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT c.*,
              COUNT(i.id) AS invoice_count,
              COALESCE(SUM(i.total_value), 0) AS total_amount
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id
       WHERE c.business_id = ? AND c.is_active = 1 ${searchClause}
       GROUP BY c.id
       ORDER BY c.name
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/customers
// ---------------------------------------------------------------------------
router.post(
  '/',
  validate(customerSchema),
  logAudit('CREATE_CUSTOMER', 'customer'),
  async (req, res, next) => {
    try {
      const businessId = req.user.business_id;
      const {
        name, afm, doy, address, city, postal_code, phone, email,
        contact_person, notes, payment_terms,
      } = req.body;

      const [result] = await pool.execute(
        `INSERT INTO customers
           (business_id, name, afm, doy, address, city, postal_code, phone, email,
            contact_person, notes, payment_terms, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [businessId, name, afm || null, doy || null, address || null, city || null,
         postal_code || null, phone || null, email || null, contact_person || null,
         notes || null, payment_terms || 30]
      );

      const [newCustomer] = await pool.execute(
        'SELECT * FROM customers WHERE business_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1',
        [businessId, name]
      );

      res.status(201).json({ data: newCustomer[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/customers/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = getBusinessId(req);

    const [rows] = await pool.execute(
      'SELECT * FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
      [id, businessId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Ο πελάτης δεν βρέθηκε.' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/customers/:id
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  validate(updateCustomerSchema),
  logAudit('UPDATE_CUSTOMER', 'customer'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = getBusinessId(req);

      const [existing] = await pool.execute(
        'SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!existing.length) {
        return res.status(404).json({ error: 'Ο πελάτης δεν βρέθηκε.' });
      }

      const allowedFields = [
        'name', 'afm', 'doy', 'address', 'city', 'postal_code', 'phone',
        'email', 'contact_person', 'notes', 'payment_terms',
      ];
      const setClauses = [];
      const params = [];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }

      if (!setClauses.length) {
        return res.status(400).json({ error: 'Δεν δόθηκαν δεδομένα για ενημέρωση.' });
      }

      setClauses.push('updated_at = NOW()');
      params.push(id);

      await pool.execute(
        `UPDATE customers SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );

      const [updated] = await pool.execute('SELECT * FROM customers WHERE id = ?', [id]);
      res.json({ data: updated[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/customers/:id  — soft delete
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  logAudit('DELETE_CUSTOMER', 'customer'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = getBusinessId(req);

      const [existing] = await pool.execute(
        'SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!existing.length) {
        return res.status(404).json({ error: 'Ο πελάτης δεν βρέθηκε.' });
      }

      await pool.execute(
        'UPDATE customers SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [id]
      );

      res.json({ data: { message: 'Ο πελάτης απενεργοποιήθηκε.' } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/customers/:id/invoices
// ---------------------------------------------------------------------------
router.get('/:id/invoices', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = getBusinessId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    // Verify customer belongs to this business
    const [custCheck] = await pool.execute(
      'SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
      [id, businessId]
    );
    if (!custCheck.length) {
      return res.status(404).json({ error: 'Ο πελάτης δεν βρέθηκε.' });
    }

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM invoices WHERE customer_id = ? AND business_id = ?',
      [id, businessId]
    );

    const [rows] = await pool.execute(
      `SELECT * FROM invoices
       WHERE customer_id = ? AND business_id = ?
       ORDER BY issue_date DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [id, businessId]
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
