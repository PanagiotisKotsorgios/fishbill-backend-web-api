/**
 * IRIS Payment routes
 *
 * Business settings IRIS:
 *   GET  /api/iris/settings            → get this business's IRIS config
 *   PATCH /api/iris/settings           → save IRIS config
 *
 * Platform settings (super_admin only):
 *   GET  /api/iris/platform            → get platform IRIS config
 *   PUT  /api/iris/platform            → save platform IRIS config
 *
 * Payment requests:
 *   POST  /api/iris/request            → create IRIS payment request (for an invoice)
 *   GET   /api/iris/requests           → list payment requests for this business
 *   GET   /api/iris/requests/:id       → get single payment request
 *   PATCH /api/iris/requests/:id       → update status (complete/cancel)
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ─── helpers ────────────────────────────────────────────────────────────────

function getBizId(req) {
  return (req.user.role === 'super_admin' && req.query.business_id)
    ? req.query.business_id
    : req.user.business_id;
}

async function getPlatformSetting(key) {
  const [rows] = await pool.execute(
    'SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  return rows.length ? rows[0].setting_value : null;
}

async function setPlatformSetting(key, value) {
  await pool.execute(
    `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
    [key, value, value]
  );
}

// ─── Business IRIS settings ──────────────────────────────────────────────────

// GET /api/iris/settings
router.get('/settings', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    if (!bizId) return res.status(400).json({ error: 'business_id required' });

    const [rows] = await pool.execute(
      `SELECT iris_enabled, iris_iban, iris_beneficiary, iris_bank_name, iris_mobile, iris_bic
       FROM business_settings WHERE business_id = ? LIMIT 1`,
      [bizId]
    );

    res.json({
      data: rows.length ? rows[0] : {
        iris_enabled: 0, iris_iban: '', iris_beneficiary: '',
        iris_bank_name: '', iris_mobile: '', iris_bic: '',
      },
    });
  } catch (err) { next(err); }
});

// PATCH /api/iris/settings
router.patch('/settings', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    if (!bizId) return res.status(400).json({ error: 'business_id required' });

    const allowed = ['iris_enabled','iris_iban','iris_beneficiary','iris_bank_name','iris_mobile','iris_bic'];
    const cols = [], vals = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined) { cols.push(f); vals.push(req.body[f]); }
    }
    if (!cols.length) return res.status(400).json({ error: 'No fields provided.' });

    const setClause = cols.map(c => `${c} = ?`).join(', ');
    await pool.execute(
      `INSERT INTO business_settings (business_id, ${cols.join(', ')})
       VALUES (?, ${cols.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setClause}, updated_at = NOW()`,
      [bizId, ...vals, ...vals]
    );

    const [rows] = await pool.execute(
      'SELECT iris_enabled, iris_iban, iris_beneficiary, iris_bank_name, iris_mobile, iris_bic FROM business_settings WHERE business_id = ? LIMIT 1',
      [bizId]
    );

    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// ─── Platform IRIS settings (super_admin) ────────────────────────────────────

// GET /api/iris/platform
router.get('/platform', async (req, res, next) => {
  try {
    const keys = ['iris_enabled','iris_iban','iris_beneficiary','iris_bank_name','iris_mobile','iris_bic','iris_instructions'];
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
      keys
    );
    const settings = {};
    for (const r of rows) settings[r.setting_key] = r.setting_value;
    res.json({ data: settings });
  } catch (err) { next(err); }
});

// PUT /api/iris/platform  (super_admin only)
router.put('/platform', async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const allowed = ['iris_enabled','iris_iban','iris_beneficiary','iris_bank_name','iris_mobile','iris_bic','iris_instructions'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await setPlatformSetting(key, String(req.body[key]));
      }
    }

    const keys = allowed;
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
      keys
    );
    const settings = {};
    for (const r of rows) settings[r.setting_key] = r.setting_value;
    res.json({ data: settings });
  } catch (err) { next(err); }
});

// ─── Payment requests ────────────────────────────────────────────────────────

// POST /api/iris/request
router.post('/request', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    if (!bizId) return res.status(400).json({ error: 'business_id required' });

    const { invoice_id, amount, description, payer_name, payer_mobile } = req.body;
    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'Απαιτείται έγκυρο ποσό.' });
    }

    // Generate short reference code
    const refCode = 'IRIS-' + Date.now().toString(36).toUpperCase();

    await pool.execute(
      `INSERT INTO iris_payments (business_id, invoice_id, amount, description, payer_name, payer_mobile, reference_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bizId, invoice_id || null, parseFloat(amount), description || null, payer_name || null, payer_mobile || null, refCode]
    );

    // Re-query (UUID pk)
    const [rows] = await pool.execute(
      'SELECT * FROM iris_payments WHERE reference_code = ? LIMIT 1',
      [refCode]
    );

    // Update invoice payment_method if invoice_id provided
    if (invoice_id) {
      await pool.execute(
        "UPDATE invoices SET payment_method = 'iris' WHERE id = ?",
        [invoice_id]
      );
    }

    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/iris/requests
router.get('/requests', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    if (!bizId) return res.status(400).json({ error: 'business_id required' });

    const { status, page = 1, limit = 20 } = req.query;
    const off = (parseInt(page) - 1) * parseInt(limit);
    const params = [bizId];

    let where = 'WHERE ip.business_id = ?';
    if (status) { where += ' AND ip.status = ?'; params.push(status); }

    const [rows] = await pool.execute(
      `SELECT ip.*, i.full_number AS invoice_number, i.total_value AS invoice_total
       FROM iris_payments ip
       LEFT JOIN invoices i ON i.id = ip.invoice_id
       ${where}
       ORDER BY ip.created_at DESC
       LIMIT ${parseInt(limit)} OFFSET ${off}`,
      params
    );

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM iris_payments ip ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// GET /api/iris/requests/:id
router.get('/requests/:id', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const [rows] = await pool.execute(
      `SELECT ip.*, i.full_number AS invoice_number FROM iris_payments ip
       LEFT JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.id = ? AND ip.business_id = ? LIMIT 1`,
      [req.params.id, bizId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/iris/requests/:id
router.patch('/requests/:id', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const { status, notes } = req.body;

    const valid = ['pending','completed','failed','cancelled'];
    if (status && !valid.includes(status)) return res.status(400).json({ error: 'Μη έγκυρη κατάσταση.' });

    const setClauses = ['updated_at = NOW()'];
    const params = [];
    if (status) {
      setClauses.push('status = ?');
      params.push(status);
      if (status === 'completed') {
        setClauses.push('completed_at = NOW()');
      }
    }
    if (notes !== undefined) { setClauses.push('notes = ?'); params.push(notes); }

    params.push(req.params.id, bizId);
    await pool.execute(
      `UPDATE iris_payments SET ${setClauses.join(', ')} WHERE id = ? AND business_id = ?`,
      params
    );

    // If completed, activate subscription if this was a subscription payment
    // (handled at admin level through subscriptions management)

    const [rows] = await pool.execute(
      'SELECT * FROM iris_payments WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
