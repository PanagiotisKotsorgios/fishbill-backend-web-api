const express = require('express');
const router = express.Router();
const { format } = require('@fast-csv/format');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireOwnerOrAbove } = require('../middleware/role');
const exportService = require('../services/export.service');

router.use(authenticate, requireOwnerOrAbove);

// ---------------------------------------------------------------------------
// GET /api/exports/invoices
// ---------------------------------------------------------------------------
router.get('/invoices', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="invoices_export_${today}.csv"`);

    await exportService.exportInvoicesCSV(
      req.query,
      req.user.business_id,
      req.user.role === 'super_admin',
      res
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/exports/customers
// ---------------------------------------------------------------------------
router.get('/customers', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customers_export_${today}.csv"`);

    await exportService.exportCustomersCSV(
      req.user.business_id,
      req.user.role === 'super_admin',
      res
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/exports/audit-log
// ---------------------------------------------------------------------------
router.get('/audit-log', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const conditions = [];
    const params = [];

    if (!isSuperAdmin) {
      conditions.push('a.business_id = ?');
      params.push(businessId);
    }
    if (req.query.from)    { conditions.push('a.created_at >= ?'); params.push(req.query.from); }
    if (req.query.to)      { conditions.push('a.created_at <= ?'); params.push(req.query.to); }
    if (req.query.action)  { conditions.push('a.action = ?');      params.push(req.query.action); }
    if (req.query.user_id) { conditions.push('a.user_id = ?');     params.push(req.query.user_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT
         a.id, a.action, a.entity_type, a.entity_id, a.description,
         a.ip_address, a.created_at,
         u.full_name AS user_name, u.email AS user_email,
         b.name AS business_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN businesses b ON b.id = a.business_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT 10000`,
      params
    );

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit_log_${today}.csv"`);

    const csvStream = format({ headers: true });
    csvStream.pipe(res);

    for (const row of rows) {
      csvStream.write({
        ID: row.id,
        Action: row.action,
        'Entity Type': row.entity_type,
        'Entity ID': row.entity_id || '',
        Description: row.description || '',
        'IP Address': row.ip_address || '',
        User: row.user_name || '',
        Email: row.user_email || '',
        Business: row.business_name || '',
        'Created At': row.created_at ? String(row.created_at).slice(0, 19) : '',
      });
    }
    csvStream.end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/exports/transmission-log
// ---------------------------------------------------------------------------
router.get('/transmission-log', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const conditions = [];
    const params = [];

    if (!isSuperAdmin) {
      conditions.push('t.business_id = ?');
      params.push(businessId);
    }
    if (req.query.from)   { conditions.push('t.attempted_at >= ?'); params.push(req.query.from); }
    if (req.query.to)     { conditions.push('t.attempted_at <= ?'); params.push(req.query.to); }
    if (req.query.status) { conditions.push('t.status = ?');        params.push(req.query.status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT
         t.id, t.invoice_id, t.status, t.response_code, t.response_message,
         t.mark, t.attempted_at,
         i.full_number AS invoice_number,
         b.name AS business_name
       FROM transmission_logs t
       LEFT JOIN invoices i ON i.id = t.invoice_id
       LEFT JOIN businesses b ON b.id = t.business_id
       ${where}
       ORDER BY t.attempted_at DESC
       LIMIT 10000`,
      params
    );

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="transmission_log_${today}.csv"`
    );

    const csvStream = format({ headers: true });
    csvStream.pipe(res);

    for (const row of rows) {
      csvStream.write({
        ID: row.id,
        'Invoice ID': row.invoice_id,
        'Invoice Number': row.invoice_number || '',
        Status: row.status,
        'Response Code': row.response_code || '',
        Message: row.response_message || '',
        MARK: row.mark || '',
        Business: row.business_name || '',
        'Attempted At': row.attempted_at ? String(row.attempted_at).slice(0, 19) : '',
      });
    }
    csvStream.end();
  } catch (err) {
    next(err);
  }
});


// ---------------------------------------------------------------------------
// GET /api/exports/products
// ---------------------------------------------------------------------------
router.get('/products', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="products_export_${today}.csv"`);

    await exportService.exportProductsCSV(
      req.user.business_id,
      req.user.role === 'super_admin',
      res
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
