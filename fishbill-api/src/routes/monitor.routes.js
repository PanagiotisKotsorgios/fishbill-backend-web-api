/**
 * Monitor Routes — /api/monitor
 * For employees with maintainer privileges scoped to assigned businesses.
 * Super admins bypass all scope checks.
 */
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Only employees and super_admin can use monitor routes
router.use((req, res, next) => {
  if (req.user.role === 'super_admin' || req.user.role === 'employee') return next();
  res.status(403).json({ error: 'Monitor routes are for employees and super admins only.' });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPrivileges(userId) {
  const [[row]] = await db.query('SELECT privileges FROM employee_privileges WHERE user_id = ?', [userId]);
  return row ? JSON.parse(row.privileges || '[]') : [];
}

async function hasPrivilege(userId, priv) {
  const privs = await getPrivileges(userId);
  return privs.includes(priv);
}

async function getAssignedBizIds(userId) {
  const [rows] = await db.query('SELECT business_id FROM employee_businesses WHERE employee_id = ?', [userId]);
  return rows.map(r => r.business_id);
}

async function canAccessBiz(req, bizId) {
  if (req.user.role === 'super_admin') return true;
  const bizIds = await getAssignedBizIds(req.user.id);
  return bizIds.includes(bizId);
}

// ── GET /api/monitor/my-businesses — assigned businesses with full stats ───────
router.get('/my-businesses', async (req, res) => {
  try {
    const isSA = req.user.role === 'super_admin';
    let bizIds;

    if (isSA) {
      const [all] = await db.query('SELECT id FROM businesses WHERE is_active = 1 ORDER BY name LIMIT 200');
      bizIds = all.map(r => r.id);
    } else {
      bizIds = await getAssignedBizIds(req.user.id);
    }

    if (!bizIds.length) return res.json({ data: [] });

    const placeholders = bizIds.map(() => '?').join(',');

    const [businesses] = await db.query(
      `SELECT b.id, b.name, b.afm, b.plan, b.subscription_active,
              b.trial_ends_at, b.subscription_ends_at, b.contact_phone,
              CASE
                WHEN b.plan = 'trial' AND b.subscription_active = 0
                  THEN DATEDIFF(b.trial_ends_at, NOW())
                WHEN b.subscription_active = 1
                  THEN DATEDIFF(b.subscription_ends_at, NOW())
                ELSE NULL
              END AS days_left,
              (SELECT COUNT(*) FROM users u WHERE u.business_id = b.id AND u.is_active = 1) AS user_count,
              (SELECT COUNT(*) FROM users u
                WHERE u.business_id = b.id AND u.role = 'accountant'
                AND (u.is_verified IS NULL OR u.is_verified = 0)) AS unverified_count,
              (SELECT os.status FROM ospa_submissions os
                WHERE os.business_id = b.id ORDER BY os.submission_period DESC LIMIT 1) AS latest_ospa_status,
              (SELECT os.submission_period FROM ospa_submissions os
                WHERE os.business_id = b.id ORDER BY os.submission_period DESC LIMIT 1) AS latest_ospa_period,
              (SELECT COUNT(*) FROM weighing_slips ws
                WHERE ws.business_id = b.id AND ws.slip_date >= DATE_FORMAT(NOW(),'%%Y-%%m-01')) AS slips_this_month,
              (SELECT COUNT(*) FROM invoices i
                WHERE i.business_id = b.id AND DATE(i.created_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS invoices_30d
       FROM businesses b
       WHERE b.id IN (${placeholders})
       ORDER BY b.name ASC`,
      bizIds
    );

    res.json({ data: businesses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/monitor/businesses/:bizId/users ──────────────────────────────────
router.get('/businesses/:bizId/users', async (req, res) => {
  try {
    if (!await canAccessBiz(req, req.params.bizId))
      return res.status(403).json({ error: 'Not assigned to this business.' });

    const [rows] = await db.query(
      `SELECT id, full_name, email, role, is_active, is_verified, created_at, last_login_at
       FROM users WHERE business_id = ? ORDER BY role, full_name`,
      [req.params.bizId]
    );
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/monitor/businesses/:bizId/users/:userId/verify ─────────────────
router.post('/businesses/:bizId/users/:userId/verify', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && !await hasPrivilege(req.user.id, 'verify_users'))
      return res.status(403).json({ error: 'Privilege required: verify_users' });
    if (!await canAccessBiz(req, req.params.bizId))
      return res.status(403).json({ error: 'Not assigned to this business.' });

    const { verified } = req.body; // true or false
    await db.query(
      'UPDATE users SET is_verified = ?, updated_at = NOW() WHERE id = ? AND business_id = ?',
      [verified ? 1 : 0, req.params.userId, req.params.bizId]
    );
    res.json({ data: { verified: !!verified } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/monitor/businesses/:bizId/ospa ──────────────────────────────────
router.get('/businesses/:bizId/ospa', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && !await hasPrivilege(req.user.id, 'monitor_ospa'))
      return res.status(403).json({ error: 'Privilege required: monitor_ospa' });
    if (!await canAccessBiz(req, req.params.bizId))
      return res.status(403).json({ error: 'Not assigned to this business.' });

    const [rows] = await db.query(
      `SELECT * FROM ospa_submissions WHERE business_id = ?
       ORDER BY submission_period DESC LIMIT 24`,
      [req.params.bizId]
    );
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/monitor/businesses/:bizId/weighing-slips ────────────────────────
router.get('/businesses/:bizId/weighing-slips', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && !await hasPrivilege(req.user.id, 'monitor_weighing_slips'))
      return res.status(403).json({ error: 'Privilege required: monitor_weighing_slips' });
    if (!await canAccessBiz(req, req.params.bizId))
      return res.status(403).json({ error: 'Not assigned to this business.' });

    const { page = 1, limit = 30 } = req.query;
    const off = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limit));
    const lim = Math.min(50, parseInt(limit));

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM weighing_slips WHERE business_id = ?', [req.params.bizId]
    );
    const [rows] = await db.query(
      `SELECT * FROM weighing_slips WHERE business_id = ?
       ORDER BY slip_date DESC, created_at DESC LIMIT ${lim} OFFSET ${off}`,
      [req.params.bizId]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: lim });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/monitor/businesses/:bizId/subscription ──────────────────────────
router.get('/businesses/:bizId/subscription', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && !await hasPrivilege(req.user.id, 'view_subscriptions'))
      return res.status(403).json({ error: 'Privilege required: view_subscriptions' });
    if (!await canAccessBiz(req, req.params.bizId))
      return res.status(403).json({ error: 'Not assigned to this business.' });

    const [[biz]] = await db.query(
      `SELECT id, name, plan, subscription_active, trial_ends_at, subscription_ends_at,
              billing_cycle, outstanding_balance, auto_renew
       FROM businesses WHERE id = ? LIMIT 1`,
      [req.params.bizId]
    );
    if (!biz) return res.status(404).json({ error: 'Business not found.' });

    const [payments] = await db.query(
      `SELECT amount, status, description, created_at
       FROM business_payments WHERE business_id = ?
       ORDER BY created_at DESC LIMIT 10`,
      [req.params.bizId]
    );
    res.json({ data: { ...biz, payments } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/monitor/businesses/:bizId/sms-reminder ─────────────────────────
router.post('/businesses/:bizId/sms-reminder', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && !await hasPrivilege(req.user.id, 'manage_reminders'))
      return res.status(403).json({ error: 'Privilege required: manage_reminders' });
    if (!await canAccessBiz(req, req.params.bizId))
      return res.status(403).json({ error: 'Not assigned to this business.' });

    const { phone_number, reason, notes } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number required.' });

    const [[user]] = await db.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user.id]).catch(() => [[null]]);
    const id = require('crypto').randomUUID();
    await db.query(
      `INSERT INTO sms_reminders (id, business_id, phone_number, sent_by, sent_by_name, sent_at, reason, notes)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [id, req.params.bizId, phone_number, req.user.id, user?.full_name || null,
       reason || 'other', notes || null]
    );
    const [[sms]] = await db.query('SELECT * FROM sms_reminders WHERE id = ? LIMIT 1', [id]);
    res.status(201).json({ data: sms });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
