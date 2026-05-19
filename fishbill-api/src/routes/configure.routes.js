/**
 * Admin Configure Routes
 * Super-admin–only endpoints for mass-configuring fisherman businesses.
 * Covers: associations CRUD, business listing (grouped), full settings
 * read/write per business, credential management.
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ─── Auth: super_admin only ────────────────────────────────────────────────
router.use(authenticate);
router.use((req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: super_admin required.' });
  }
  next();
});

// ═══════════════════════════════════════════════════════════════════════════
//  ASSOCIATIONS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/configure/associations
router.get('/associations', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.*, COUNT(b.id) AS business_count
       FROM business_associations a
       LEFT JOIN businesses b ON b.association_id = a.id
       GROUP BY a.id
       ORDER BY a.name ASC`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /api/configure/associations
router.post('/associations', async (req, res, next) => {
  try {
    const { name, description, region } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Απαιτείται όνομα συλλόγου.' });

    const [existing] = await pool.execute(
      'SELECT id FROM business_associations WHERE name = ? LIMIT 1',
      [name.trim()]
    );
    if (existing.length) return res.status(409).json({ error: 'Ο σύλλογος υπάρχει ήδη.' });

    await pool.execute(
      'INSERT INTO business_associations (name, description, region) VALUES (?, ?, ?)',
      [name.trim(), description || null, region || null]
    );
    const [newRow] = await pool.execute(
      'SELECT * FROM business_associations WHERE name = ? LIMIT 1',
      [name.trim()]
    );
    res.status(201).json({ data: newRow[0] });
  } catch (err) { next(err); }
});

// PATCH /api/configure/associations/:id
router.patch('/associations/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, region } = req.body;

    const [rows] = await pool.execute(
      'SELECT id FROM business_associations WHERE id = ? LIMIT 1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Δεν βρέθηκε σύλλογος.' });

    const fields = {};
    if (name !== undefined) fields.name = name.trim();
    if (description !== undefined) fields.description = description || null;
    if (region !== undefined) fields.region = region || null;

    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Δεν δόθηκαν πεδία.' });

    const set = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    await pool.execute(
      `UPDATE business_associations SET ${set}, updated_at = NOW() WHERE id = ?`,
      [...Object.values(fields), id]
    );

    const [updated] = await pool.execute('SELECT * FROM business_associations WHERE id = ? LIMIT 1', [id]);
    res.json({ data: updated[0] });
  } catch (err) { next(err); }
});

// DELETE /api/configure/associations/:id
router.delete('/associations/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    // Unlink businesses (FK is SET NULL) before deleting
    await pool.execute(
      'UPDATE businesses SET association_id = NULL WHERE association_id = ?', [id]
    );
    await pool.execute('DELETE FROM business_associations WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  BUSINESSES — list & group
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/configure/businesses
// ?search=  ?association_id=  ?page=  ?per_page=
router.get('/businesses', async (req, res, next) => {
  try {
    const { search, association_id, page = 1, per_page = 100 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(per_page);
    const params = [];
    const where = ['1=1'];

    if (search) {
      where.push('(b.name LIKE ? OR b.trade_name LIKE ? OR b.afm LIKE ? OR b.email LIKE ? OR b.fisherman_code LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    if (association_id === 'none') {
      where.push('b.association_id IS NULL');
    } else if (association_id) {
      where.push('b.association_id = ?');
      params.push(association_id);
    }

    const lim = parseInt(per_page);
    const [rows] = await pool.query(
      `SELECT
         b.id, b.afm, b.name, b.trade_name, b.email, b.phone,
         b.city, b.fisherman_code,
         b.is_active, b.is_suspended, b.plan, b.subscription_active,
         b.association_id,
         a.name AS association_name,
         b.admin_notes,
         b.mydata_user_id, b.mydata_subscription_key, b.provider_name,
         b.gsis_username,
         b.etimologiera_api_key, b.etimologiera_subscription_id,
         b.created_at,
         (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) AS invoice_count,
         (SELECT COUNT(*) FROM users u WHERE u.business_id = b.id) AS user_count
       FROM businesses b
       LEFT JOIN business_associations a ON a.id = b.association_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.name ASC, b.name ASC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM businesses b WHERE ${where.join(' AND ')}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), per_page: parseInt(per_page) });
  } catch (err) { next(err); }
});

// GET /api/configure/businesses/:id — full settings for one business
router.get('/businesses/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [bizRows] = await pool.execute(
      `SELECT b.*, a.name AS association_name
       FROM businesses b
       LEFT JOIN business_associations a ON a.id = b.association_id
       WHERE b.id = ? LIMIT 1`,
      [id]
    );
    if (!bizRows.length) return res.status(404).json({ error: 'Δεν βρέθηκε επιχείρηση.' });

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [id]
    );

    const [userRows] = await pool.execute(
      `SELECT id, full_name, email, role, is_active, created_at
       FROM users WHERE business_id = ? ORDER BY created_at ASC`, [id]
    );

    res.json({
      data: {
        business: bizRows[0],
        settings: settingsRows[0] || {},
        users: userRows,
      }
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PER-BUSINESS CONFIGURATION PATCHES
// ═══════════════════════════════════════════════════════════════════════════

// PATCH /api/configure/businesses/:id/association
router.patch('/businesses/:id/association', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { association_id, admin_notes } = req.body;

    const fields = {};
    if (association_id !== undefined) fields.association_id = association_id || null;
    if (admin_notes !== undefined) fields.admin_notes = admin_notes || null;

    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Δεν δόθηκαν πεδία.' });

    const set = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    await pool.execute(
      `UPDATE businesses SET ${set}, updated_at = NOW() WHERE id = ?`,
      [...Object.values(fields), id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/configure/businesses/:id/mydata
router.patch('/businesses/:id/mydata', async (req, res, next) => {
  try {
    const { id } = req.params;
    const allowed = [
      'mydata_user_id', 'mydata_subscription_key', 'mydata_provider',
      'provider_name', 'provider_api_key', 'provider_api_url',
      'provider_username', 'provider_password',
      'etimologiera_api_key', 'etimologiera_subscription_id', 'etimologiera_api_url',
      'allowed_invoice_types',
    ];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k] || null;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Δεν δόθηκαν πεδία.' });

    const set = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    await pool.execute(
      `UPDATE businesses SET ${set}, updated_at = NOW() WHERE id = ?`,
      [...Object.values(fields), id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/configure/businesses/:id/gsis
router.patch('/businesses/:id/gsis', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { gsis_username, gsis_password } = req.body;
    await pool.execute(
      `UPDATE businesses SET gsis_username = ?, gsis_password = ?, updated_at = NOW() WHERE id = ?`,
      [gsis_username || null, gsis_password || null, id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/configure/businesses/:id/profile
router.patch('/businesses/:id/profile', async (req, res, next) => {
  try {
    const { id } = req.params;
    const allowed = [
      'name', 'trade_name', 'doy', 'address', 'city', 'postal_code',
      'phone', 'email', 'activity_code', 'vat_regime', 'fisherman_code',
      'invoice_series', 'receipt_series',
      'accountant_name', 'accountant_email', 'accountant_phone',
      'is_active', 'is_suspended', 'suspend_reason', 'plan', 'subscription_active',
    ];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }

    // default_vat_rate lives in business_settings, not businesses
    const defaultVatRate = req.body.default_vat_rate;

    if (!Object.keys(fields).length && defaultVatRate === undefined) {
      return res.status(400).json({ error: 'Δεν δόθηκαν πεδία.' });
    }

    if (Object.keys(fields).length) {
      const set = Object.keys(fields).map(k => `${k} = ?`).join(', ');
      await pool.execute(
        `UPDATE businesses SET ${set}, updated_at = NOW() WHERE id = ?`,
        [...Object.values(fields), id]
      );
    }

    if (defaultVatRate !== undefined) {
      const rate = parseInt(defaultVatRate, 10) || 13;
      await pool.execute(
        `INSERT INTO business_settings (business_id, default_vat_rate)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE default_vat_rate = ?, updated_at = NOW()`,
        [id, rate, rate]
      );
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/configure/businesses/:id/status
router.patch('/businesses/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_active, is_suspended, suspend_reason } = req.body;
    const fields = {};
    if (is_active !== undefined) fields.is_active = is_active ? 1 : 0;
    if (is_suspended !== undefined) fields.is_suspended = is_suspended ? 1 : 0;
    if (suspend_reason !== undefined) fields.suspend_reason = suspend_reason || null;

    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Δεν δόθηκαν πεδία.' });

    const set = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    await pool.execute(
      `UPDATE businesses SET ${set}, updated_at = NOW() WHERE id = ?`,
      [...Object.values(fields), id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ASSOCIATION STATISTICS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/configure/association-stats
router.get('/association-stats', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         a.id,
         a.name,
         a.region,
         COUNT(DISTINCT b.id)                                         AS business_count,
         COUNT(DISTINCT u.id)                                         AS user_count,
         SUM(b.subscription_active)                                   AS active_subscriptions,
         COUNT(DISTINCT b.id) - SUM(b.subscription_active)           AS inactive_subscriptions,
         COALESCE(SUM(b.outstanding_balance), 0)                     AS total_outstanding,
         COUNT(DISTINCT i.id)                                         AS total_invoices,
         COUNT(DISTINCT CASE
           WHEN DATE_FORMAT(i.issue_date,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')
           THEN i.id END)                                            AS invoices_this_month
       FROM business_associations a
       LEFT JOIN businesses b        ON b.association_id = a.id
       LEFT JOIN users u             ON u.business_id = b.id
       LEFT JOIN invoices i          ON i.business_id = b.id
       GROUP BY a.id, a.name, a.region
       ORDER BY a.name ASC`
    );

    // Also count unassociated businesses
    const [[unassoc]] = await pool.query(
      `SELECT
         COUNT(DISTINCT b.id)                                         AS business_count,
         COUNT(DISTINCT u.id)                                         AS user_count,
         SUM(b.subscription_active)                                   AS active_subscriptions,
         COUNT(DISTINCT b.id) - SUM(b.subscription_active)           AS inactive_subscriptions,
         COALESCE(SUM(b.outstanding_balance), 0)                     AS total_outstanding,
         COUNT(DISTINCT i.id)                                         AS total_invoices,
         COUNT(DISTINCT CASE
           WHEN DATE_FORMAT(i.issue_date,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')
           THEN i.id END)                                            AS invoices_this_month
       FROM businesses b
       LEFT JOIN users u   ON u.business_id = b.id
       LEFT JOIN invoices i ON i.business_id = b.id
       WHERE b.association_id IS NULL`
    );

    res.json({ data: rows, unassociated: unassoc });
  } catch (err) { next(err); }
});

module.exports = router;
