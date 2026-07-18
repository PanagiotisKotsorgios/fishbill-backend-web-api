/**
 * Αγρότης Admin API — completely separate from FishBill's /api/admin.
 * All endpoints (except /login) require role in ('admin', 'superadmin').
 */
const express = require('express');
const bcrypt  = require('bcrypt');
const Joi     = require('joi');

const pool = require('../config/database');
const { requireAdmin, signAccess } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Bounded page helpers — clamp user input so pagination never blows up the DB.
function pageParams(req) {
  const page  = Math.max(1, Number(req.query.page  || 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// mysql2 prepared statements don't reliably accept LIMIT/OFFSET as placeholders
// across all server versions. Since `limit` and `offset` are pre-validated
// integers from pageParams(), inlining them is safe (no SQLi surface).
function paged(sql, limit, offset) {
  return `${sql} LIMIT ${limit} OFFSET ${offset}`;
}

// ── POST /admin/login ──────────────────────────────────────────────────────
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

// ── POST /admin/change-password ────────────────────────────────────────────
const pwSchema = Joi.object({
  current_password: Joi.string().min(1).required(),
  new_password:     Joi.string().min(8).max(200).required(),
});

router.post('/change-password', async (req, res, next) => {
  try {
    const { error, value } = pwSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const [[a]] = await pool.execute(
      'SELECT password_hash FROM ag_admins WHERE id = ? LIMIT 1',
      [req.user.sub]
    );
    if (!a) return res.status(404).json({ error: 'Admin not found' });

    const ok = await bcrypt.compare(value.current_password, a.password_hash);
    if (!ok) return res.status(401).json({ error: 'Λάθος τρέχων κωδικός' });

    const newHash = await bcrypt.hash(value.new_password, 12);
    await pool.execute(
      'UPDATE ag_admins SET password_hash = ? WHERE id = ?',
      [newHash, req.user.sub]
    );

    logger.info(`Admin ${req.user.sub} changed their password`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── GET /admin/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [[users]]      = await pool.execute('SELECT COUNT(*) AS n FROM ag_users');
    const [[businesses]] = await pool.execute('SELECT COUNT(*) AS n FROM ag_businesses');
    const [[invoices]]   = await pool.execute(
      'SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS revenue FROM ag_invoices'
    );
    const [[dn]]         = await pool.execute('SELECT COUNT(*) AS n FROM ag_delivery_notes');
    const [[activeSubs]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM ag_subscriptions WHERE status = 'active'"
    );
    const [[wrappLogs]]  = await pool.execute('SELECT COUNT(*) AS n FROM ag_wrapp_logs');
    const [[wrappErrs]]  = await pool.execute(
      "SELECT COUNT(*) AS n FROM ag_wrapp_logs WHERE status_code >= 400 OR error_message IS NOT NULL"
    );

    // Recent activity — last 30 days invoices + DN counts, grouped by day
    const [activity] = await pool.execute(
      `SELECT DATE(created_at) AS day,
              SUM(CASE WHEN t = 'inv' THEN 1 ELSE 0 END) AS invoices,
              SUM(CASE WHEN t = 'dn'  THEN 1 ELSE 0 END) AS delivery_notes
         FROM (
           SELECT created_at, 'inv' AS t FROM ag_invoices
           WHERE created_at >= NOW() - INTERVAL 30 DAY
           UNION ALL
           SELECT created_at, 'dn'  AS t FROM ag_delivery_notes
           WHERE created_at >= NOW() - INTERVAL 30 DAY
         ) tt
         GROUP BY DATE(created_at)
         ORDER BY day DESC`
    );

    res.json({
      data: {
        users:          Number(users.n),
        businesses:     Number(businesses.n),
        invoices:       Number(invoices.n),
        revenue:        Number(invoices.revenue),
        delivery_notes: Number(dn.n),
        active_subs:    Number(activeSubs.n),
        wrapp_calls:    Number(wrappLogs.n),
        wrapp_errors:   Number(wrappErrs.n),
        activity_30d:   activity,
      },
    });
  } catch (e) { next(e); }
});

// ── GET /admin/users ──────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req);
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM ag_users');
    const [rows] = await pool.execute(paged(
      `SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_login_at,
              u.business_id,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_users u
         LEFT JOIN ag_businesses b ON b.id = u.business_id
        ORDER BY u.created_at DESC`,
      limit, offset
    ));
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── DELETE /admin/users/:id ───────────────────────────────────────────────
router.delete('/users/:id', async (req, res, next) => {
  try {
    const [r] = await pool.execute('DELETE FROM ag_users WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found' });
    logger.info(`Admin ${req.user.sub} deleted user ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── GET /admin/businesses ─────────────────────────────────────────────────
router.get('/businesses', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req);
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM ag_businesses');
    const [rows] = await pool.execute(paged(
      `SELECT b.id, b.name, b.afm, b.doy, b.city, b.phone, b.email, b.created_at,
              (SELECT COUNT(*) FROM ag_invoices       WHERE business_id = b.id) AS invoice_count,
              (SELECT COUNT(*) FROM ag_delivery_notes WHERE business_id = b.id) AS dn_count,
              (SELECT plan   FROM ag_subscriptions   WHERE business_id = b.id) AS plan,
              (SELECT status FROM ag_subscriptions   WHERE business_id = b.id) AS sub_status
         FROM ag_businesses b
        ORDER BY b.created_at DESC`,
      limit, offset
    ));
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /admin/businesses/:id — full drill-down ──────────────────────────
router.get('/businesses/:id', async (req, res, next) => {
  try {
    const bid = req.params.id;
    const [[biz]] = await pool.execute(
      'SELECT * FROM ag_businesses WHERE id = ? LIMIT 1', [bid]
    );
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const [users]     = await pool.execute(
      'SELECT id, name, email, role, created_at, last_login_at FROM ag_users WHERE business_id = ? ORDER BY created_at',
      [bid]
    );
    const [invoices]  = await pool.execute(
      'SELECT id, series, num, invoice_type, customer_name, total_amount, my_data_mark, cancelled_by_mark, created_at FROM ag_invoices WHERE business_id = ? ORDER BY created_at DESC LIMIT 50',
      [bid]
    );
    const [dnotes]    = await pool.execute(
      'SELECT id, series, num, customer_name, my_data_mark, cancelled_by_mark, dispatch_date, created_at FROM ag_delivery_notes WHERE business_id = ? ORDER BY created_at DESC LIMIT 50',
      [bid]
    );
    const [[sub]]     = await pool.execute(
      'SELECT plan, status, current_period_end, docs_used_this_period, docs_limit_this_period FROM ag_subscriptions WHERE business_id = ? LIMIT 1',
      [bid]
    );

    res.json({ data: { business: biz, users, invoices, delivery_notes: dnotes, subscription: sub || null } });
  } catch (e) { next(e); }
});

// ── GET /admin/invoices ───────────────────────────────────────────────────
router.get('/invoices', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req);
    const status = String(req.query.status || '').toLowerCase();
    const where  = status === 'issued'    ? "WHERE i.my_data_mark IS NOT NULL AND i.cancelled_by_mark IS NULL"
                 : status === 'cancelled' ? "WHERE i.cancelled_by_mark IS NOT NULL"
                 : status === 'draft'     ? "WHERE i.draft = 1"
                 : '';
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM ag_invoices i ${where}`);
    const [rows] = await pool.execute(paged(
      `SELECT i.id, i.series, i.num, i.invoice_type, i.customer_name,
              i.total_amount, i.my_data_mark, i.cancelled_by_mark, i.draft, i.created_at,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_invoices i
         LEFT JOIN ag_businesses b ON b.id = i.business_id
         ${where}
        ORDER BY i.created_at DESC`,
      limit, offset
    ));
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /admin/invoices/:id ───────────────────────────────────────────────
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const [[inv]] = await pool.execute(
      `SELECT i.*, b.name AS business_name, b.afm AS business_afm
         FROM ag_invoices i
         LEFT JOIN ag_businesses b ON b.id = i.business_id
        WHERE i.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const [lines] = await pool.execute(
      'SELECT * FROM ag_invoice_lines WHERE invoice_id = ? ORDER BY line_number',
      [inv.id]
    );
    res.json({ data: { ...inv, lines } });
  } catch (e) { next(e); }
});

// ── GET /admin/delivery-notes ─────────────────────────────────────────────
router.get('/delivery-notes', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req);
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM ag_delivery_notes');
    const [rows] = await pool.execute(paged(
      `SELECT dn.id, dn.series, dn.num, dn.customer_name, dn.vehicle_number,
              dn.dispatch_date, dn.my_data_mark, dn.cancelled_by_mark, dn.draft, dn.created_at,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_delivery_notes dn
         LEFT JOIN ag_businesses b ON b.id = dn.business_id
        ORDER BY dn.created_at DESC`,
      limit, offset
    ));
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /admin/delivery-notes/:id ─────────────────────────────────────────
router.get('/delivery-notes/:id', async (req, res, next) => {
  try {
    const [[dn]] = await pool.execute(
      `SELECT dn.*, b.name AS business_name, b.afm AS business_afm
         FROM ag_delivery_notes dn
         LEFT JOIN ag_businesses b ON b.id = dn.business_id
        WHERE dn.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!dn) return res.status(404).json({ error: 'Delivery note not found' });
    const [lines] = await pool.execute(
      'SELECT * FROM ag_delivery_note_lines WHERE dn_id = ? ORDER BY line_number',
      [dn.id]
    );
    res.json({ data: { ...dn, lines } });
  } catch (e) { next(e); }
});

// ── GET /admin/weighing-slips ─────────────────────────────────────────────
router.get('/weighing-slips', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req);
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM ag_weighing_slips');
    const [rows] = await pool.execute(paged(
      `SELECT s.id, s.product_type, s.fao_code, s.weight_kg, s.slip_date,
              s.buyer_name, s.photo_url, s.created_at,
              b.name AS business_name
         FROM ag_weighing_slips s
         LEFT JOIN ag_businesses b ON b.id = s.business_id
        ORDER BY s.created_at DESC`,
      limit, offset
    ));
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /admin/wrapp-logs ─────────────────────────────────────────────────
router.get('/wrapp-logs', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req);
    const onlyErr = req.query.only_errors === '1';
    const where   = onlyErr ? 'WHERE status_code >= 400 OR error_message IS NOT NULL' : '';
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM ag_wrapp_logs ${where}`);
    const [rows] = await pool.execute(paged(
      `SELECT l.id, l.business_id, l.event_type, l.direction, l.endpoint,
              l.status_code, l.error_message, l.created_at,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_wrapp_logs l
         LEFT JOIN ag_businesses b ON b.id = l.business_id
         ${where}
        ORDER BY l.created_at DESC`,
      limit, offset
    ));
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /admin/wrapp-logs/:id ─────────────────────────────────────────────
router.get('/wrapp-logs/:id', async (req, res, next) => {
  try {
    const [[log]] = await pool.execute(
      `SELECT l.*, b.name AS business_name, b.afm AS business_afm
         FROM ag_wrapp_logs l
         LEFT JOIN ag_businesses b ON b.id = l.business_id
        WHERE l.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!log) return res.status(404).json({ error: 'Wrapp log not found' });
    res.json({ data: log });
  } catch (e) { next(e); }
});

// ── DELETE /admin/wrapp-logs/purge?days=30 ────────────────────────────────
router.delete('/wrapp-logs/purge', async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days || 30)));
    const [r] = await pool.execute(
      'DELETE FROM ag_wrapp_logs WHERE created_at < NOW() - INTERVAL ? DAY',
      [days]
    );
    logger.info(`Admin ${req.user.sub} purged ${r.affectedRows} wrapp logs older than ${days}d`);
    res.json({ ok: true, deleted: r.affectedRows });
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
