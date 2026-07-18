/**
 * Αγρότης Admin API — completely separate from FishBill's /api/admin.
 * All endpoints require role in ('admin', 'superadmin').
 */
const express = require('express');
const bcrypt  = require('bcrypt');
const Joi     = require('joi');

const pool = require('../config/database');
const { requireAdmin, signAccess } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ── POST /admin/login — separate admin login (no coupling to /auth/login) ──
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const [rows] = await pool.execute(
      `SELECT id, name, email, password_hash, role
         FROM ag_admins WHERE email = ? LIMIT 1`,
      [email.toLowerCase()]
    );
    const a = rows[0];
    if (!a) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, a.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    await pool.execute('UPDATE ag_admins SET last_login_at = NOW() WHERE id = ?', [a.id]);

    const payload = { sub: a.id, role: a.role };
    res.json({
      data: {
        access_token: signAccess(payload),
        user: { id: a.id, name: a.name, email: a.email, role: a.role },
      },
    });
  } catch (e) { next(e); }
});

// Everything below requires admin
router.use(requireAdmin);

// ── GET /admin/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [[users]]         = await pool.execute('SELECT COUNT(*) AS n FROM ag_users');
    const [[businesses]]    = await pool.execute('SELECT COUNT(*) AS n FROM ag_businesses');
    const [[invoices]]      = await pool.execute('SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS revenue FROM ag_invoices');
    const [[dn]]            = await pool.execute('SELECT COUNT(*) AS n FROM ag_delivery_notes');
    const [[activeSubs]]    = await pool.execute(
      "SELECT COUNT(*) AS n FROM ag_subscriptions WHERE status = 'active'"
    );
    res.json({
      data: {
        users:          users.n,
        businesses:     businesses.n,
        invoices:       invoices.n,
        revenue:        Number(invoices.revenue),
        delivery_notes: dn.n,
        active_subs:    activeSubs.n,
      },
    });
  } catch (e) { next(e); }
});

// ── GET /admin/users ──────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM ag_users');
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_login_at,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_users u
         LEFT JOIN ag_businesses b ON b.id = u.business_id
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /admin/businesses ─────────────────────────────────────────────────
router.get('/businesses', async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM ag_businesses');
    const [rows] = await pool.execute(
      `SELECT b.id, b.name, b.afm, b.doy, b.city, b.phone, b.email, b.created_at,
              (SELECT COUNT(*) FROM ag_invoices       WHERE business_id = b.id) AS invoice_count,
              (SELECT COUNT(*) FROM ag_delivery_notes WHERE business_id = b.id) AS dn_count
         FROM ag_businesses b
        ORDER BY b.created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /admin/invoices ───────────────────────────────────────────────────
router.get('/invoices', async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM ag_invoices');
    const [rows] = await pool.execute(
      `SELECT i.id, i.series, i.num, i.invoice_type, i.customer_name,
              i.total_amount, i.my_data_mark, i.cancelled_by_mark, i.created_at,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_invoices i
         LEFT JOIN ag_businesses b ON b.id = i.business_id
        ORDER BY i.created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── PATCH /admin/subscriptions/:business_id ───────────────────────────────
const subSchema = Joi.object({
  plan:                   Joi.string().valid('trial','agrotis-pro'),
  status:                 Joi.string().valid('trial','active','past_due','cancelled'),
  current_period_end:     Joi.string().isoDate(),
  docs_limit_this_period: Joi.number().integer().min(0),
  docs_used_this_period:  Joi.number().integer().min(0),
}).min(1);

router.patch('/subscriptions/:business_id', async (req, res, next) => {
  try {
    const { error, value } = subSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const fields = [], params = [];
    for (const k of Object.keys(value)) { fields.push(`${k} = ?`); params.push(value[k]); }

    const [existing] = await pool.execute(
      'SELECT business_id FROM ag_subscriptions WHERE business_id = ? LIMIT 1',
      [req.params.business_id]
    );

    if (existing.length) {
      params.push(req.params.business_id);
      await pool.execute(
        `UPDATE ag_subscriptions SET ${fields.join(', ')}, updated_at = NOW() WHERE business_id = ?`,
        params
      );
    } else {
      // Upsert with default plan
      const insertCols = ['business_id', ...Object.keys(value)];
      const insertVals = [req.params.business_id, ...Object.values(value)];
      const placeholders = insertCols.map(() => '?').join(', ');
      await pool.execute(
        `INSERT INTO ag_subscriptions (${insertCols.join(', ')}, created_at) VALUES (${placeholders}, NOW())`,
        insertVals
      );
    }

    logger.info(`Admin ${req.user.sub} updated subscription for business ${req.params.business_id}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
