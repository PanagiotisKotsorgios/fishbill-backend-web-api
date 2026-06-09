/**
 * Platform Settings Routes (super_admin only)
 * GET/POST /api/platform/settings   — read & write all platform_settings rows
 * GET/POST /api/platform/provider   — myDATA provider config
 * GET      /api/platform/subscriptions — all businesses with subscription info
 * POST     /api/platform/subscriptions/:bizId/activate — activate subscription
 * POST     /api/platform/subscriptions/:bizId/deactivate
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const { authenticate }     = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/role');
const emailSvc  = require('../services/email.service');

// ── GET /api/platform/status — PUBLIC: maintenance mode check (no auth) ────────
router.get('/status', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('maintenance_mode','maintenance_message')"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    res.json({
      maintenance: map.maintenance_mode === '1' || map.maintenance_mode === 'true',
      message: map.maintenance_message || 'Εκτελούνται εργασίες συντήρησης. Σύντομα θα είμαστε πάλι κοντά σας.',
    });
  } catch (err) { next(err); }
});

// ── GET /api/platform/public-settings — no auth, returns payment details ─────
router.get('/public-settings', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings
       WHERE setting_key LIKE 'bank_%' OR setting_key LIKE 'iris_%'
          OR setting_key LIKE 'payment_%'
          OR setting_key IN ('support_phone','provider_name')`
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    if (map.iris_iban && !map.iris_mobile) map.iris_mobile = map.iris_iban;
    if (map.iris_bank && !map.iris_bank_name) map.iris_bank_name = map.iris_bank;
    res.json(map);
  } catch (err) { next(err); }
});

// ── GET /api/platform/app-config — PUBLIC: mobile app dynamic config ────────
// Returns admin-configurable values the mobile app needs before authentication.
// app_base_url: if set, mobile app switches its API base URL to this value.
// web_base_url: if set, mobile app can open web/admin-managed public links from this base.
router.get('/app-config', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('app_base_url','web_base_url','app_min_version','maintenance_mode','maintenance_message','app_latest_version_code','app_latest_apk_url')"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    res.json({
      app_base_url:             map.app_base_url             || null,
      web_base_url:             map.web_base_url             || null,
      app_min_version:          map.app_min_version           || null,
      maintenance:              map.maintenance_mode === '1' || map.maintenance_mode === 'true',
      maintenance_message:      map.maintenance_message       || null,
      app_latest_version_code:  map.app_latest_version_code ? parseInt(map.app_latest_version_code, 10) : null,
      app_latest_apk_url:       map.app_latest_apk_url       || null,
    });
  } catch (err) { next(err); }
});

// ── GET /api/platform/wrapp-ping — PUBLIC: live Wrapp connectivity diagnostic ─
// No auth required. Does not expose the full partner key (only first 8 chars).
// Use this to verify DB settings are correct and Wrapp API is reachable.
router.get('/wrapp-ping', async (req, res, next) => {
  try {
    const axios = require('axios');
    const server_version = 'v1.0.51';
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('wrapp_partner_api_key','wrapp_base_url','wrapp_webhook_endpoint')"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });

    const partnerKey      = map.wrapp_partner_api_key || '';
    const rawBaseUrl      = map.wrapp_base_url        || '';
    const baseUrl         = (rawBaseUrl || 'https://wrapp.ai').replace(/\/$/, '');
    const webhookEndpoint = map.wrapp_webhook_endpoint || '';

    const info = {
      base_url_in_db:     rawBaseUrl    || '(not set — defaulting to https://wrapp.ai)',
      base_url_used:      baseUrl,
      partner_key_set:    !!partnerKey,
      partner_key_prefix: partnerKey ? (partnerKey.slice(0, 8) + '...') : '(none)',
      webhook_endpoint:   webhookEndpoint || '(not set)',
    };

    if (!partnerKey) {
      return res.json({ ok: false, info, error: 'wrapp_partner_api_key not set in platform_settings' });
    }

    // Helper: make a test call and return a normalised result object
    async function testEndpoint(url, body) {
      const urlObj = new URL(url);
      const cfg = {
        headers: { 'X-PARTNER-API-KEY': partnerKey, 'Content-Type': 'application/json' },
        timeout: 10000,
        validateStatus: () => true,
      };
      if (urlObj.username) {
        cfg.auth = { username: urlObj.username, password: urlObj.password };
        urlObj.username = ''; urlObj.password = '';
      }
      const r = await axios.post(urlObj.toString(), body, cfg);
      const isHtml = typeof r.data === 'string' && r.data.trim().startsWith('<');
      return {
        status:    r.status,
        body_type: isHtml ? 'HTML' : 'JSON',
        body:      isHtml ? r.data.slice(0, 400) : r.data,
        auth_ok:   r.status !== 401 && r.status !== 403,
      };
    }

    let ping_check_user, ping_external_login;
    try {
      ping_check_user = await testEndpoint(
        `${baseUrl}/api/v1/embedded_check_user`,
        { partner_user_id: '__diag__' }
      );
    } catch (e) { ping_check_user = { error: e.message }; }

    // Normalize phone the same way initiateOnboarding does
    function normalizePhone(raw) {
      let p = (raw || '').trim().replace(/[\s\-().+]/g, '');
      if (p.startsWith('0030')) p = p.slice(4);
      else if (p.startsWith('30') && p.length === 12) p = p.slice(2);
      return p;
    }

    try {
      ping_external_login = await testEndpoint(
        `${baseUrl}/api/v1/external_login`,
        {
          email:            'diag-test@fishbill.gr',
          partner_user_id:  '__diag_login__',
          webhook_endpoint: webhookEndpoint || 'https://master-app.gr/api/wrapp/webhook',
          phone:            normalizePhone('+306900000001'), // test normalization in ping too
        }
      );
    } catch (e) { ping_external_login = { error: e.message }; }

    const ok = ping_check_user?.auth_ok === true && ping_external_login?.auth_ok === true;
    res.json({ ok, server_version, info, ping_check_user, ping_external_login });
  } catch (err) { next(err); }
});

// ── POST /api/platform/dev-setup — reset super_admin password (JWT_SECRET auth) ─
router.post('/dev-setup', async (req, res) => {
  try {
    const token = req.headers['x-setup-token'];
    if (!token || token !== process.env.JWT_SECRET) return res.status(403).json({ error: 'Forbidden.' });
    const bcrypt = require('bcrypt');
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) return res.status(500).json({ error: 'ADMIN_PASSWORD not set in env.' });
    const hash = await bcrypt.hash(adminPassword, 12);
    const [r1] = await pool.execute("UPDATE users SET password_hash = ? WHERE role = 'super_admin'", [hash]);
    res.json({ ok: true, super_admin_rows_updated: r1.affectedRows });
  } catch (err) {
    return res.status(500).json({ error: err.message, code: err.code || null });
  }
});

// ── POST /api/platform/dev-cleanup — delete test businesses/users (JWT_SECRET auth) ─
// Deletes by business ID list. Also deletes associated users + business_settings.
router.post('/dev-cleanup', async (req, res) => {
  try {
    const token = req.headers['x-setup-token'];
    if (!token || token !== process.env.JWT_SECRET) return res.status(403).json({ error: 'Forbidden.' });

    // IDs to delete (test businesses created during staging tests)
    const bizIds = (req.body.ids || [
      '5d000557-633e-11f1-958f-0ae58a65029f',  // nolifeprogrammer1+wrapptest
    ]).filter(Boolean);

    const results = [];
    for (const id of bizIds) {
      await pool.execute('DELETE FROM business_settings WHERE business_id = ?', [id]);
      const [ru] = await pool.execute('DELETE FROM users WHERE business_id = ?', [id]);
      const [rb] = await pool.execute('DELETE FROM businesses WHERE id = ?', [id]);
      results.push({ id, users_deleted: ru.affectedRows, business_deleted: rb.affectedRows });
    }
    res.json({ ok: true, results });
  } catch (err) {
    return res.status(500).json({ error: err.message, code: err.code || null });
  }
});

router.use(authenticate, requireSuperAdmin);

// ── Helper: get all platform settings as key→value map ───────────────────────
async function getAllSettings() {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM platform_settings');
  const map = {};
  rows.forEach(r => { map[r.setting_key] = r.setting_value; });
  return map;
}

async function upsertSetting(key, value) {
  await pool.execute(
    `INSERT INTO platform_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
    [key, value, value]
  );
}

// ── GET /api/platform/settings ────────────────────────────────────────────────
router.get('/settings', async (req, res, next) => {
  try {
    res.json({ data: await getAllSettings() });
  } catch (err) { next(err); }
});

// ── POST/PATCH /api/platform/settings ────────────────────────────────────────
async function handleSaveSettings(req, res, next) {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await upsertSetting(k, v === null || v === undefined ? '' : String(v));
    }
    res.json({ data: await getAllSettings() });
  } catch (err) { next(err); }
}
router.post('/settings', handleSaveSettings);
router.patch('/settings', handleSaveSettings);

// ── POST /api/platform/settings/test-email ────────────────────────────────────
router.post('/settings/test-email', async (req, res, next) => {
  try {
    const to = req.body.to;
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: 'Εισάγετε έγκυρο email παραλήπτη.' });
    }
    await emailSvc.sendTestEmail({ to });
    res.json({ data: { message: `Δοκιμαστικό email στάλθηκε στο ${to}` } });
  } catch (err) {
    res.status(500).json({ error: `Σφάλμα αποστολής: ${err.message}` });
  }
});

// ── GET /api/platform/provider ────────────────────────────────────────────────
router.get('/provider', async (req, res, next) => {
  try {
    const s = await getAllSettings();
    res.json({
      data: {
        provider_name:     s.provider_name     || 'direct',
        provider_api_url:  s.provider_api_url  || '',
        provider_api_key:  s.provider_api_key  || '',
        provider_username: s.provider_username || '',
        provider_password: s.provider_password || '',
        provider_test_mode: s.provider_test_mode === '1',
        provider_notes:    s.provider_notes    || '',
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/platform/provider ───────────────────────────────────────────────
router.post('/provider', async (req, res, next) => {
  try {
    const allowed = ['provider_name','provider_api_url','provider_api_key','provider_username','provider_password','provider_test_mode','provider_notes'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) await upsertSetting(k, String(req.body[k]));
    }
    res.json({ data: { message: 'Provider settings saved.' } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/provider/test ─── test connection to active provider ──
router.post('/provider/test', async (req, res, next) => {
  try {
    const [kvRows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key = 'provider_name'`
    );
    const providerName = kvRows[0]?.setting_value || 'direct';

    if (providerName === 'etimologiera') {
      const etim = require('../services/etimologiera.service');
      const result = await etim.testConnection();
      return res.json({ data: result });
    }
    // For other providers just confirm settings exist
    res.json({ data: { ok: true, message: `Provider "${providerName}" configured (no live test available).` } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/etimologiera/resources ─── not available in V4 API ────
router.get('/etimologiera/resources', (_req, res) => {
  res.status(501).json({ error: 'getResources not available in e-timologiera V4 API.' });
});

// ── GET /api/platform/etimologiera/invoices ─── not available in V4 API ──────
router.get('/etimologiera/invoices', (_req, res) => {
  res.status(501).json({ error: 'listInvoices not available in e-timologiera V4 API.' });
});

// ── GET /api/platform/etimologiera/status/:uid ─── not available in V4 API ───
router.get('/etimologiera/status/:uid', (_req, res) => {
  res.status(501).json({ error: 'getInvoiceStatus not available in e-timologiera V4 API.' });
});

// ── GET /api/platform/subscriptions ──────────────────────────────────────────
router.get('/subscriptions', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const offset = (page - 1) * limit;
    const filter = req.query.filter; // 'pending' | 'active' | 'all'
    const search = req.query.search ? `%${req.query.search}%` : null;

    const conditions = [];
    const params = [];
    if (filter === 'pending') { conditions.push("b.plan != 'trial' AND b.subscription_active = 0"); }
    if (filter === 'active')  { conditions.push('b.subscription_active = 1'); }
    if (search) { conditions.push('(b.name LIKE ? OR b.afm LIKE ? OR b.email LIKE ?)'); params.push(search, search, search); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM businesses b ${where}`, params
    );
    let rows;
    try {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
      [rows] = await pool.execute(
        `SELECT b.id, b.name, b.afm, b.city, b.email, b.phone, b.plan, b.subscription_active,
                b.trial_ends_at, b.subscription_ends_at, b.created_at,
                COALESCE(b.billing_cycle, 'monthly') AS billing_cycle,
                COALESCE(b.is_parametrised, 0) AS is_parametrised,
                COALESCE(b.fishing_license, '') AS fishing_license,
                COALESCE(b.outstanding_balance, 0) AS outstanding_balance,
                COALESCE(b.contact_phone, b.phone, '') AS contact_phone,
                (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) AS invoice_count,
                (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id AND i.issue_date >= GREATEST('${monthStart}', COALESCE(DATE_FORMAT(b.billing_cycle_started_at,'%Y-%m-%d'),'${monthStart}')) AND i.status != 'cancelled') AS invoices_this_month,
                (SELECT COUNT(*) FROM delivery_notes dn WHERE dn.business_id = b.id AND dn.issue_date >= GREATEST('${monthStart}', COALESCE(DATE_FORMAT(b.billing_cycle_started_at,'%Y-%m-%d'),'${monthStart}')) AND dn.status != 'cancelled') AS dn_this_month,
                (SELECT u.email FROM users u WHERE u.business_id = b.id AND u.role = 'owner' LIMIT 1) AS owner_email,
                COALESCE((SELECT bs.feature_ospa FROM business_settings bs WHERE bs.business_id = b.id LIMIT 1), 0) AS addon_ospa,
                COALESCE((SELECT bs.feature_weighing_slips FROM business_settings bs WHERE bs.business_id = b.id LIMIT 1), 0) AS addon_weighing
         FROM businesses b
         ${where}
         ORDER BY b.subscription_active ASC, b.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );
    } catch (e) {
      if (!e.message.includes('billing_cycle') && !e.message.includes('is_parametrised') && !e.message.includes('fishing_license')) throw e;
      // Column not yet migrated — fall back without it
      [rows] = await pool.execute(
        `SELECT b.id, b.name, b.afm, b.city, b.email, b.phone, b.plan, b.subscription_active,
                b.trial_ends_at, b.subscription_ends_at, b.created_at,
                'monthly' AS billing_cycle,
                0 AS is_parametrised,
                '' AS fishing_license,
                COALESCE(b.outstanding_balance, 0) AS outstanding_balance,
                COALESCE(b.contact_phone, b.phone, '') AS contact_phone,
                (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) AS invoice_count,
                (SELECT u.email FROM users u WHERE u.business_id = b.id AND u.role = 'owner' LIMIT 1) AS owner_email,
                0 AS addon_ospa,
                0 AS addon_weighing
         FROM businesses b
         ${where}
         ORDER BY b.subscription_active ASC, b.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );
    }
    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/platform/subscriptions/:bizId/activate ─────────────────────────
// Body: { plan, billing_cycle?, months? }
// billing_cycle = 'monthly' | 'semi_annual' | 'annual' — auto-derives months
// months        = explicit override (takes precedence when provided)
router.post('/subscriptions/:bizId/activate', async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const { plan, billing_cycle, months } = req.body;

    const validPlan  = ['basic','pro','enterprise'].includes(plan) ? plan : null;
    const validCycle = ['monthly','semi_annual','annual'].includes(billing_cycle) ? billing_cycle : null;

    // Derive month count: explicit months > billing_cycle > default 1
    const cycleMonths = { monthly: 1, semi_annual: 6, annual: 12 };
    let monthCount = parseInt(months) || cycleMonths[validCycle] || 1;

    // Check if this is the business's first subscription — if so, grant +1 bonus month
    const [[bizRow]] = await pool.execute(
      'SELECT COALESCE(is_first_subscription, 1) AS is_first FROM businesses WHERE id = ? LIMIT 1',
      [bizId]
    );
    const isFirst = bizRow?.is_first === 1;
    if (isFirst) monthCount += 1;

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + monthCount);

    // Ensure billing_cycle_started_at column exists (one-time auto-migration)
    try {
      const [[col]] = await pool.execute(
        "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='businesses' AND COLUMN_NAME='billing_cycle_started_at'"
      );
      if (!col.c) {
        await pool.execute("ALTER TABLE businesses ADD COLUMN billing_cycle_started_at DATE NULL DEFAULT NULL");
      }
    } catch (_) {}

    // Build SET clause dynamically to avoid errors on older schema
    const setClauses = ['subscription_active = 1', 'subscription_ends_at = ?', 'billing_cycle_started_at = CURDATE()', 'updated_at = NOW()'];
    const params     = [endDate];

    if (validPlan) { setClauses.unshift('plan = ?'); params.unshift(plan); }
    if (validCycle) {
      setClauses.push('billing_cycle = ?');
      params.push(validCycle);
    }
    // Mark first-subscription bonus as consumed
    if (isFirst) {
      setClauses.push('is_first_subscription = 0');
    }
    params.push(bizId);

    try {
      await pool.execute(
        `UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );
    } catch (e) {
      if (!e.message.includes('billing_cycle') && !e.message.includes('billing_cycle_started_at')) throw e;
      // Column not yet migrated — retry without the unknown column
      const safeSet    = setClauses.filter(c => !c.includes('billing_cycle'));
      const safeParams = [];
      let pi = 0;
      for (const clause of setClauses) {
        if (clause.includes('billing_cycle')) continue;
        if (clause.includes('?')) safeParams.push(params[pi++]); else pi++;
      }
      safeParams.push(bizId);
      await pool.execute(`UPDATE businesses SET ${safeSet.join(', ')} WHERE id = ?`, safeParams);
    }

    // Auto-enable OSPA + weighing slips — included in every pro plan activation
    try {
      await pool.execute(
        `INSERT INTO business_settings (business_id, feature_ospa, feature_weighing_slips)
         VALUES (?, 1, 1)
         ON DUPLICATE KEY UPDATE feature_ospa = 1, feature_weighing_slips = 1`,
        [bizId]
      );
    } catch (_) {}

    const cycleLabel = { monthly: 'μηνιαία', semi_annual: '6μηνη', annual: 'ετήσια' }[validCycle] || '';
    const bonusNote  = isFirst ? ' (+1 μήνας bonus πρώτης εγγραφής)' : '';
    res.json({ data: { message: `Subscription activated (${cycleLabel || monthCount + 'μ'})${bonusNote}.`, months: monthCount, billing_cycle: validCycle || 'monthly', bonus_applied: isFirst } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/subscriptions/:bizId/extend-trial ─────────────────────
router.post('/subscriptions/:bizId/extend-trial', async (req, res, next) => {
  try {
    const days = parseInt(req.body.days) || 30;
    await pool.execute(
      `UPDATE businesses
         SET trial_ends_at = DATE_ADD(GREATEST(NOW(), COALESCE(trial_ends_at, NOW())), INTERVAL ? DAY),
             updated_at = NOW()
       WHERE id = ?`,
      [days, req.params.bizId]
    );
    res.json({ data: { message: `Trial extended by ${days} days.` } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/subscriptions/:bizId/mark-parametrised ────────────────
router.post('/subscriptions/:bizId/mark-parametrised', async (req, res, next) => {
  try {
    // Ensure column exists (one-time migration)
    try {
      const [[col]] = await pool.execute(
        "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='businesses' AND COLUMN_NAME='is_parametrised'"
      );
      if (!col.c) {
        await pool.execute("ALTER TABLE businesses ADD COLUMN is_parametrised TINYINT(1) NOT NULL DEFAULT 0");
      }
    } catch (_) { /* ignore — column may already exist */ }

    await pool.execute(
      "UPDATE businesses SET is_parametrised = 1, updated_at = NOW() WHERE id = ?",
      [req.params.bizId]
    );
    res.json({ data: { message: 'Marked as parametrised.' } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/subscriptions/:bizId/deactivate ───────────────────────
router.post('/subscriptions/:bizId/deactivate', async (req, res, next) => {
  try {
    await pool.execute(
      "UPDATE businesses SET subscription_active = 0, updated_at = NOW() WHERE id = ?",
      [req.params.bizId]
    );
    res.json({ data: { message: 'Subscription deactivated.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [[subs]]   = await pool.execute("SELECT COUNT(*) AS c FROM businesses WHERE subscription_active = 1");
    const [[total]]  = await pool.execute("SELECT COUNT(*) AS c FROM businesses");
    const [[inv]]    = await pool.execute("SELECT COUNT(*) AS c FROM invoices WHERE status = 'transmitted'");
    const [[users]]  = await pool.execute("SELECT COUNT(*) AS c FROM users WHERE is_active = 1");
    const s = await getAllSettings();
    res.json({ data: {
      active_subscriptions: subs.c,
      total_businesses: total.c,
      total_invoices_transmitted: inv.c,
      active_users: users.c,
      mrr: parseFloat(s.mrr_override || 0) || 0,
    }});
  } catch (err) { next(err); }
});

// ── GET /api/platform/economics ───────────────────────────────────────────────
router.get('/economics', async (req, res, next) => {
  try {
    const period = req.query.period || 'year';

    // Date filter for invoice counts and historical charts
    let invDateFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)';
    if (period === 'month')   invDateFilter = "AND created_at >= DATE_FORMAT(NOW(),'%Y-%m-01')";
    if (period === 'quarter') invDateFilter = 'AND created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)';
    if (period === 'all')     invDateFilter = '';

    const s = await getAllSettings();

    const PLAN_PRICING = {
      basic:      { monthly: 8,   semi_annual: 35,  annual: 60  },
      pro:        { monthly: 12,  semi_annual: 65,  annual: 120 },
      enterprise: { monthly: 30,  semi_annual: 130, annual: 240 },
    };
    const CYCLE_MONTHS = { monthly: 1, semi_annual: 6, annual: 12 };
    const PLAN_NAMES   = { basic: 'Βασικό', pro: 'Προχωρημένο', enterprise: 'Απεριόριστο' };
    const PLAN_COLORS  = { basic: '#3b82f6', pro: '#8b5cf6', enterprise: '#f59e0b' };
    const VAT_RATE     = 0.24;

    // ── 1. Active subscriptions grouped by plan + billing_cycle ──────────────
    let subsRows;
    try {
      [subsRows] = await pool.execute(`
        SELECT plan, COALESCE(billing_cycle,'monthly') AS billing_cycle, COUNT(*) AS cnt
        FROM businesses
        WHERE subscription_active = 1 AND plan NOT IN ('trial','')
        GROUP BY plan, COALESCE(billing_cycle,'monthly')`);
    } catch (_) {
      [subsRows] = await pool.execute(`
        SELECT plan, 'monthly' AS billing_cycle, COUNT(*) AS cnt
        FROM businesses
        WHERE subscription_active = 1 AND plan NOT IN ('trial','')
        GROUP BY plan`);
    }

    // ── 2. Compute MRR, ARR and breakdowns ───────────────────────────────────
    let mrr = 0;
    const cycleTotals  = { monthly: { revenue: 0, count: 0 }, semi_annual: { revenue: 0, count: 0 }, annual: { revenue: 0, count: 0 } };
    const planTotals   = {};
    const cycleDetail  = [];

    for (const row of subsRows) {
      const plan  = row.plan;
      const cycle = row.billing_cycle || 'monthly';
      const count = parseInt(row.cnt) || 0;
      const pricePerCycle = PLAN_PRICING[plan]?.[cycle] || 0;
      const months        = CYCLE_MONTHS[cycle] || 1;
      const monthlyEquiv  = (pricePerCycle / months) * count;
      const cycleRevenue  = pricePerCycle * count;

      mrr += monthlyEquiv;
      if (cycleTotals[cycle]) {
        cycleTotals[cycle].revenue += cycleRevenue;
        cycleTotals[cycle].count   += count;
      }
      planTotals[plan] = (planTotals[plan] || 0) + monthlyEquiv;
      cycleDetail.push({ plan, cycle, count, price_per_cycle: pricePerCycle, cycle_revenue: cycleRevenue, monthly_equiv: parseFloat(monthlyEquiv.toFixed(2)) });
    }

    const arr    = mrr * 12;
    const vatAmt = mrr * VAT_RATE;           // VAT admin owes on net revenue
    const mrrNet = mrr;                      // plan prices are net-of-VAT

    // ── 3. Fixed/recurring expenses from saved list ──────────────────────────
    const savedExpenses = JSON.parse(s.platform_expenses || '[]');
    let monthlyExpenses = 0;
    for (const exp of savedExpenses) {
      if (exp.type === 'monthly')      monthlyExpenses += parseFloat(exp.amount) || 0;
      else if (exp.type === 'annual')  monthlyExpenses += (parseFloat(exp.amount) || 0) / 12;
    }
    monthlyExpenses += parseFloat(s.brevo_monthly_cost || 0);
    monthlyExpenses += parseFloat(s.hosting_monthly_cost || 0);

    // ── 4. Provider fees (per-invoice cost × transmitted invoice count) ───────
    const providerCostPerInv = parseFloat(s.provider_cost_per_invoice || 0);
    const [[invCount]] = await pool.execute(
      `SELECT COUNT(*) AS c FROM invoices WHERE status='transmitted' ${invDateFilter}`);
    const provider_fees = providerCostPerInv * invCount.c;

    // ── 5. Net profit (monthly) ───────────────────────────────────────────────
    const net_profit = mrrNet - vatAmt - provider_fees - monthlyExpenses;

    // ── 6. Monthly subscription revenue chart (last 12 months) ───────────────
    // Approximate: use updated_at of active businesses as activation date
    let histRows = [];
    try {
      [histRows] = await pool.execute(`
        SELECT DATE_FORMAT(updated_at,'%b %y') AS month,
               DATE_FORMAT(updated_at,'%Y-%m') AS ym,
               plan, COALESCE(billing_cycle,'monthly') AS billing_cycle,
               COUNT(*) AS cnt
        FROM businesses
        WHERE subscription_active = 1 AND plan NOT IN ('trial','')
          AND updated_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY DATE_FORMAT(updated_at,'%Y-%m'), plan, COALESCE(billing_cycle,'monthly')
        ORDER BY ym ASC`);
    } catch (_) {}

    const monthMap = {};
    for (const r of histRows) {
      if (!monthMap[r.ym]) monthMap[r.ym] = { month: r.month, revenue: 0, subscriptions: 0 };
      const price  = PLAN_PRICING[r.plan]?.[r.billing_cycle] || 0;
      const months = CYCLE_MONTHS[r.billing_cycle] || 1;
      monthMap[r.ym].revenue       += parseFloat(((price / months) * r.cnt).toFixed(2));
      monthMap[r.ym].subscriptions += parseInt(r.cnt);
    }
    const monthly_revenue = Object.values(monthMap);

    // ── 7. Plan breakdown for UI ──────────────────────────────────────────────
    const plan_breakdown = Object.entries(planTotals).map(([plan, mrrContrib]) => ({
      plan,
      name:       PLAN_NAMES[plan]  || plan,
      color:      PLAN_COLORS[plan] || '#6b7280',
      monthly_mrr: parseFloat(mrrContrib.toFixed(2)),
      count:      subsRows.filter(r => r.plan === plan).reduce((a, r) => a + parseInt(r.cnt), 0),
    }));

    // Health: good = profit > 0, warning = -50..0, bad = < -50
    const health = net_profit > 0 ? 'good' : net_profit > -50 ? 'warning' : 'bad';

    res.json({ data: {
      // Revenue
      mrr:            parseFloat(mrr.toFixed(2)),
      arr:            parseFloat(arr.toFixed(2)),
      vat_amount:     parseFloat(vatAmt.toFixed(2)),
      gross_revenue:  parseFloat(mrr.toFixed(2)),
      net_profit:     parseFloat(net_profit.toFixed(2)),
      health,

      // Cycle breakdown
      cycle_totals: {
        monthly:    { revenue: parseFloat(cycleTotals.monthly.revenue.toFixed(2)),    count: cycleTotals.monthly.count },
        semi_annual:{ revenue: parseFloat(cycleTotals.semi_annual.revenue.toFixed(2)), count: cycleTotals.semi_annual.count },
        annual:     { revenue: parseFloat(cycleTotals.annual.revenue.toFixed(2)),     count: cycleTotals.annual.count },
      },
      cycle_detail: cycleDetail,

      // Plan breakdown
      plan_breakdown,

      // Expenses
      provider_fees:      parseFloat(provider_fees.toFixed(2)),
      monthly_expenses:   parseFloat(monthlyExpenses.toFixed(2)),
      other_expenses:     parseFloat(monthlyExpenses.toFixed(2)),

      // Charts
      monthly_revenue,

      // Misc
      invoices_transmitted: invCount.c,
      brevo_emails_sent: parseInt(s.brevo_emails_sent || 0),
      brevo_cost:        parseFloat(s.brevo_monthly_cost || 0),
      hosting_cost:      parseFloat(s.hosting_monthly_cost || 0),
    }});
  } catch (err) { next(err); }
});

// ── GET/POST /api/platform/expenses ──────────────────────────────────────────
router.get('/expenses', async (req, res, next) => {
  try {
    const s = await getAllSettings();
    const expenses = JSON.parse(s.platform_expenses || '[]');
    res.json({ data: expenses });
  } catch (err) { next(err); }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const s = await getAllSettings();
    const expenses = JSON.parse(s.platform_expenses || '[]');
    const newExp = {
      id: require('crypto').randomUUID(),
      description: req.body.description,
      amount: parseFloat(req.body.amount) || 0,
      category: req.body.category || 'other',
      type: req.body.type || 'one_time',
      date: req.body.date || new Date().toISOString().split('T')[0],
      notes: req.body.notes || '',
      created_at: new Date().toISOString(),
    };
    expenses.unshift(newExp);
    await upsertSetting('platform_expenses', JSON.stringify(expenses));
    res.json({ data: newExp });
  } catch (err) { next(err); }
});

router.delete('/expenses/:expId', async (req, res, next) => {
  try {
    const s = await getAllSettings();
    const expenses = JSON.parse(s.platform_expenses || '[]').filter(e => e.id !== req.params.expId);
    await upsertSetting('platform_expenses', JSON.stringify(expenses));
    res.json({ data: { message: 'Deleted.' } });
  } catch (err) { next(err); }
});

// ── PATCH /api/platform/settings/firebase — store Firebase service account ───
router.patch('/settings/firebase', async (req, res, next) => {
  try {
    const { service_account } = req.body;
    if (!service_account) {
      return res.status(400).json({ error: 'service_account (JSON string) απαιτείται.' });
    }
    // Validate it's valid JSON with required Firebase fields
    let parsed;
    try {
      parsed = typeof service_account === 'string'
        ? JSON.parse(service_account)
        : service_account;
    } catch {
      return res.status(400).json({ error: 'Μη έγκυρο JSON service account.' });
    }
    if (!parsed.project_id || !parsed.private_key || !parsed.client_email) {
      return res.status(400).json({ error: 'Το service account λείπουν υποχρεωτικά πεδία (project_id, private_key, client_email).' });
    }
    await upsertSetting('firebase_service_account', JSON.stringify(parsed));
    // Reset cached firebase app so it reinitializes with new credentials
    try {
      const admin = require('firebase-admin');
      if (admin.apps.length > 0) {
        await admin.app().delete();
      }
    } catch { /* ignore */ }
    res.json({ data: { message: 'Firebase service account αποθηκεύτηκε επιτυχώς.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/settings/firebase — check if Firebase is configured ────
router.get('/settings/firebase', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_value FROM platform_settings WHERE setting_key = 'firebase_service_account' LIMIT 1"
    );
    const configured = rows.length > 0 && !!rows[0].setting_value;
    let projectId = null;
    if (configured) {
      try { projectId = JSON.parse(rows[0].setting_value).project_id; } catch { /* ignore */ }
    }
    res.json({ data: { configured, project_id: projectId } });
  } catch (err) { next(err); }
});

// ── PATCH /api/platform/settings/gsis — store GSIS credentials for AFM lookup
router.patch('/settings/gsis', async (req, res, next) => {
  try {
    const { gsis_username, gsis_password } = req.body;
    if (!gsis_username || !gsis_password) {
      return res.status(400).json({ error: 'gsis_username και gsis_password απαιτούνται.' });
    }
    await upsertSetting('gsis_username', gsis_username.trim());
    await upsertSetting('gsis_password', gsis_password.trim());
    res.json({ data: { message: 'Στοιχεία ΓΣΙΣ αποθηκεύτηκαν επιτυχώς.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/settings/gsis — check GSIS configuration ───────────────
router.get('/settings/gsis', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('gsis_username','gsis_password')"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    res.json({ data: {
      configured: !!(map.gsis_username && map.gsis_password),
      username: map.gsis_username ? map.gsis_username.replace(/./g, (c, i) => i < 3 ? c : '*') : null,
    }});
  } catch (err) { next(err); }
});

// ── GET /api/platform/email/users ─── audience picker list ───────────────────
router.get('/email/users', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.name AS biz_name, b.plan, b.subscription_active,
              (SELECT u.email FROM users u WHERE u.business_id = b.id
               AND u.role IN ('owner','admin') AND u.is_active = 1
               ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1) AS email,
              (SELECT u.full_name FROM users u WHERE u.business_id = b.id
               AND u.role IN ('owner','admin') AND u.is_active = 1
               ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1) AS full_name
       FROM businesses b
       ORDER BY b.name ASC`
    );
    res.json({ data: rows.filter(r => r.email) });
  } catch (err) { next(err); }
});

// ── POST /api/platform/email/send-direct ─── admin sends email to one business
router.post('/email/send-direct', async (req, res, next) => {
  try {
    const { biz_id, subject, message } = req.body;
    if (!biz_id || !subject || !message) {
      return res.status(400).json({ error: 'biz_id, subject, και message απαιτούνται.' });
    }

    const [[biz]] = await pool.execute('SELECT name FROM businesses WHERE id = ? LIMIT 1', [biz_id]);
    const [uRows] = await pool.execute(
      `SELECT email, full_name FROM users
       WHERE business_id = ? AND role IN ('owner','admin') AND is_active = 1
       ORDER BY FIELD(role,'owner','admin') DESC LIMIT 1`,
      [biz_id]
    );
    if (!uRows.length) {
      return res.status(404).json({ error: 'Δεν βρέθηκε ιδιοκτήτης για αυτή την επιχείρηση.' });
    }

    const { email, full_name } = uRows[0];
    const s = await getAllSettings();

    await emailSvc.sendDirectEmail({
      to: email,
      toName: full_name,
      subject,
      messageHtml: message.replace(/\n/g, '<br>'),
      senderName: s.platform_name || 'FishBill',
    });

    res.json({ data: { message: `Email στάλθηκε στο ${email}` } });
  } catch (err) {
    res.status(500).json({ error: `Σφάλμα αποστολής: ${err.message}` });
  }
});

// ── POST /api/platform/email/campaign ─── bulk email to audience ─────────────
router.post('/email/campaign', async (req, res, next) => {
  try {
    const { subject, message, audience } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ error: 'subject και message απαιτούνται.' });
    }

    if (!await emailSvc.isPlatformEmailEnabled('campaigns')) {
      return res.status(403).json({ error: 'Τα campaign emails είναι απενεργοποιημένα από τον διαχειριστή πλατφόρμας.' });
    }

    let whereStr = '';
    const qParams = [];
    if (audience === 'trial')         whereStr = "WHERE b.plan = 'trial'";
    else if (audience === 'active')   whereStr = "WHERE b.subscription_active = 1";
    else if (audience === 'inactive') whereStr = "WHERE b.subscription_active = 0 AND b.plan != 'trial'";
    else if (audience && audience !== 'all') { whereStr = 'WHERE b.id = ?'; qParams.push(audience); }

    const [rows] = await pool.execute(
      `SELECT b.id, b.name AS biz_name,
              (SELECT u.email FROM users u WHERE u.business_id = b.id
               AND u.role IN ('owner','admin') AND u.is_active = 1
               ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1) AS email,
              (SELECT u.full_name FROM users u WHERE u.business_id = b.id
               AND u.role IN ('owner','admin') AND u.is_active = 1
               ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1) AS full_name
       FROM businesses b ${whereStr}
       ORDER BY b.name ASC`,
      qParams
    );

    const targets = rows.filter(r => r.email);
    const s = await getAllSettings();
    const senderName = s.platform_name || 'FishBill';
    let sent = 0, failed = 0;

    for (const row of targets) {
      try {
        await emailSvc.sendDirectEmail({
          to: row.email,
          toName: row.full_name,
          subject,
          messageHtml: message.replace(/\n/g, '<br>'),
          senderName,
        });
        emailSvc.trackEmailSent('campaigns');
        sent++;
      } catch (e) {
        console.error(`[Campaign] Failed for ${row.email}:`, e.message);
        failed++;
      }
    }

    res.json({ data: { sent, failed, total: targets.length } });
  } catch (err) {
    res.status(500).json({ error: `Σφάλμα campaign: ${err.message}` });
  }
});

// ── GET /api/platform/email/stats ─── consumption stats + platform toggles ────
router.get('/email/stats', async (req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const statKeys = [
      'email_stat_total',
      `email_stat_month_${month}`,
      'email_stat_type_invoice_created',
      'email_stat_type_invoice_transmitted',
      'email_stat_type_invoice_failed',
      'email_stat_type_daily_summary',
      'email_stat_type_lifecycle',
      'email_stat_type_campaigns',
      'email_stat_type_direct',
      'email_stat_type_system',
      'platform_email_type_invoice_created',
      'platform_email_type_invoice_transmitted',
      'platform_email_type_invoice_failed',
      'platform_email_type_daily_summary',
      'platform_email_type_lifecycle',
      'platform_email_type_campaigns',
      'platform_email_type_direct',
      'platform_email_type_system',
      'brevo_monthly_cost',
      'brevo_free_tier',
    ];

    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${statKeys.map(() => '?').join(',')})`,
      statKeys
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });

    const n = k => parseInt(map[k] || '0', 10);
    const toggle = k => map[`platform_email_type_${k}`] !== '0'; // default enabled

    res.json({
      data: {
        total: n('email_stat_total'),
        this_month: n(`email_stat_month_${month}`),
        by_type: {
          invoice_created:    n('email_stat_type_invoice_created'),
          invoice_transmitted:n('email_stat_type_invoice_transmitted'),
          invoice_failed:     n('email_stat_type_invoice_failed'),
          daily_summary:      n('email_stat_type_daily_summary'),
          lifecycle:          n('email_stat_type_lifecycle'),
          campaigns:          n('email_stat_type_campaigns'),
          direct:             n('email_stat_type_direct'),
          system:             n('email_stat_type_system'),
        },
        toggles: {
          invoice_created:    toggle('invoice_created'),
          invoice_transmitted:toggle('invoice_transmitted'),
          invoice_failed:     toggle('invoice_failed'),
          daily_summary:      toggle('daily_summary'),
          lifecycle:          toggle('lifecycle'),
          campaigns:          toggle('campaigns'),
          direct:             toggle('direct'),
          system:             toggle('system'),
        },
        brevo_monthly_cost: parseFloat(map.brevo_monthly_cost || '0'),
        brevo_free_tier:    parseInt(map.brevo_free_tier || '9000', 10),
        current_month: month,
      },
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/platform/email/toggles ─── save platform email type on/off ────
router.patch('/email/toggles', async (req, res, next) => {
  try {
    const allowed = ['invoice_created','invoice_transmitted','invoice_failed',
                     'daily_summary','lifecycle','campaigns','direct','system'];
    for (const type of allowed) {
      if (req.body[type] !== undefined) {
        await upsertSetting(`platform_email_type_${type}`, req.body[type] ? '1' : '0');
      }
    }
    // Also allow updating cost/tier settings
    if (req.body.brevo_monthly_cost !== undefined)
      await upsertSetting('brevo_monthly_cost', String(req.body.brevo_monthly_cost));
    if (req.body.brevo_free_tier !== undefined)
      await upsertSetting('brevo_free_tier', String(req.body.brevo_free_tier));

    res.json({ data: { message: 'Ρυθμίσεις αποθηκεύτηκαν.' } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/email/stats/reset ─── reset all counters ──────────────
router.post('/email/stats/reset', async (req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const keysToReset = [
      'email_stat_total',
      `email_stat_month_${month}`,
      'email_stat_type_invoice_created',
      'email_stat_type_invoice_transmitted',
      'email_stat_type_invoice_failed',
      'email_stat_type_daily_summary',
      'email_stat_type_lifecycle',
      'email_stat_type_campaigns',
      'email_stat_type_direct',
      'email_stat_type_system',
    ];
    for (const key of keysToReset) {
      await upsertSetting(key, '0');
    }
    res.json({ data: { message: 'Στατιστικά email μηδενίστηκαν.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/outstanding — businesses with outstanding balance ─────────
router.get('/outstanding', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const onlyDebt = req.query.only_debt === '1';

    const where = onlyDebt ? 'WHERE b.outstanding_balance > 0' : '';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM businesses b ${where}`
    );

    const PRICING = {
      basic:      { monthly: 8,   semi_annual: 35,  annual: 60  },
      pro:        { monthly: 12,  semi_annual: 65,  annual: 120 },
      enterprise: { monthly: 30,  semi_annual: 130, annual: 240 },
    };

    const [rows] = await pool.execute(
      `SELECT b.id, b.name, b.afm, b.city, b.email, b.phone, b.contact_phone,
              b.plan, b.subscription_active, b.billing_cycle, b.subscription_ends_at,
              COALESCE(b.outstanding_balance, 0) AS outstanding_balance,
              b.plan_price_override,
              (SELECT u.email FROM users u WHERE u.business_id=b.id AND u.role='owner' LIMIT 1) AS owner_email,
              (SELECT u.full_name FROM users u WHERE u.business_id=b.id AND u.role='owner' LIMIT 1) AS owner_name,
              (SELECT COUNT(*) FROM payment_calls pc WHERE pc.business_id=b.id) AS call_count,
              (SELECT MAX(pc.called_at) FROM payment_calls pc WHERE pc.business_id=b.id) AS last_call_at,
              (SELECT MIN(pc.follow_up_at) FROM payment_calls pc WHERE pc.business_id=b.id AND pc.follow_up_at > NOW()) AS next_follow_up,
              (SELECT COUNT(*) FROM business_payments bp WHERE bp.business_id=b.id) AS payment_count,
              (SELECT MAX(bp.created_at) FROM business_payments bp WHERE bp.business_id=b.id) AS last_payment_at
       FROM businesses b
       ${where}
       ORDER BY b.outstanding_balance DESC, b.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
    );

    // Attach plan_price for each row (expected monthly)
    const enriched = rows.map(r => {
      const cycle = r.billing_cycle || 'monthly';
      const pricePerCycle = r.plan_price_override != null
        ? parseFloat(r.plan_price_override)
        : (PRICING[r.plan]?.[cycle] ?? 0);
      const months = { monthly: 1, semi_annual: 6, annual: 12 }[cycle] || 1;
      return {
        ...r,
        outstanding_balance: parseFloat(r.outstanding_balance) || 0,
        plan_price_override: r.plan_price_override != null ? parseFloat(r.plan_price_override) : null,
        expected_monthly: parseFloat((pricePerCycle / months).toFixed(2)),
        expected_cycle_price: parseFloat(pricePerCycle.toFixed(2)),
      };
    });

    res.json({ data: enriched, total, page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/platform/subscriptions/:bizId/record-payment ────────────────────
router.post('/subscriptions/:bizId/record-payment', async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const { amount, expected_amount, description, payment_type, billing_period, status, notes, allow_partial } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) < 0)
      return res.status(400).json({ error: 'Έγκυρο ποσό απαιτείται.' });

    const paid = parseFloat(amount);
    const expected = expected_amount != null ? parseFloat(expected_amount) : null;

    const [[biz]] = await pool.execute(
      'SELECT outstanding_balance, plan, billing_cycle, plan_price_override FROM businesses WHERE id = ? LIMIT 1',
      [bizId]
    );
    if (!biz) return res.status(404).json({ error: 'Business not found.' });

    const currentBalance = parseFloat(biz.outstanding_balance) || 0;

    // Determine effective status
    let effectiveStatus = status || 'paid';
    let newBalance = currentBalance;

    if (expected != null && paid < expected) {
      // Partial payment: add the shortfall to outstanding balance
      if (!allow_partial)
        return res.status(400).json({ error: `Ο πελάτης οφείλει €${(expected - paid).toFixed(2)} ακόμα. Ενεργοποιήστε το "Αποδοχή μερικής πληρωμής" για να συνεχίσετε.` });
      effectiveStatus = 'partial';
      newBalance = parseFloat((currentBalance + (expected - paid)).toFixed(2));
    } else if (expected != null && paid >= expected) {
      // Full or overpayment: reduce outstanding balance
      effectiveStatus = 'paid';
      newBalance = parseFloat(Math.max(0, currentBalance - (paid - (expected || 0))).toFixed(2));
    } else {
      // No expected amount set — treat as payment against outstanding balance
      newBalance = parseFloat(Math.max(0, currentBalance - paid).toFixed(2));
    }

    // Record the payment
    const paymentId = require('crypto').randomUUID();
    await pool.execute(
      `INSERT INTO business_payments
         (id, business_id, amount, expected_amount, description, payment_type, billing_period, status, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, bizId, paid, expected || null,
       description || (effectiveStatus === 'partial' ? 'Μερική Πληρωμή' : 'Πληρωμή'),
       payment_type || 'manual', billing_period || null,
       effectiveStatus, notes || null, req.user.id || null]
    );

    // Update outstanding balance on business
    await pool.execute(
      'UPDATE businesses SET outstanding_balance = ?, updated_at = NOW() WHERE id = ?',
      [newBalance, bizId]
    );

    const [[payment]] = await pool.execute('SELECT * FROM business_payments WHERE id = ? LIMIT 1', [paymentId]);
    res.status(201).json({
      data: {
        payment,
        outstanding_balance: newBalance,
        shortfall: expected != null ? parseFloat(Math.max(0, expected - paid).toFixed(2)) : 0,
      }
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/platform/subscriptions/:bizId/set-price ───────────────────────
router.patch('/subscriptions/:bizId/set-price', async (req, res, next) => {
  try {
    const { price } = req.body;
    const val = price === null || price === '' ? null : parseFloat(price);
    if (val !== null && (isNaN(val) || val < 0))
      return res.status(400).json({ error: 'Μη έγκυρη τιμή.' });
    await pool.execute(
      'UPDATE businesses SET plan_price_override = ?, updated_at = NOW() WHERE id = ?',
      [val, req.params.bizId]
    );
    res.json({ data: { plan_price_override: val } });
  } catch (err) { next(err); }
});

// ── PATCH /api/platform/subscriptions/:bizId/contact-phone ───────────────────
router.patch('/subscriptions/:bizId/contact-phone', async (req, res, next) => {
  try {
    const { phone } = req.body;
    await pool.execute(
      'UPDATE businesses SET contact_phone = ?, updated_at = NOW() WHERE id = ?',
      [phone || null, req.params.bizId]
    );
    res.json({ data: { contact_phone: phone || null } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/calls — all calls (paginated) ──────────────────────────
router.get('/calls', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;
    const bizId  = req.query.business_id || null;
    const outcome = req.query.outcome || null;
    const followUp = req.query.follow_up === '1';

    const conds = []; const params = [];
    if (bizId)   { conds.push('pc.business_id = ?'); params.push(bizId); }
    if (outcome) { conds.push('pc.outcome = ?');      params.push(outcome); }
    if (followUp){ conds.push('pc.follow_up_at IS NOT NULL AND pc.follow_up_at > NOW()'); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM payment_calls pc ${where}`, params
    );
    const [rows] = await pool.execute(
      `SELECT pc.*, b.name AS business_name, b.afm AS business_afm, b.outstanding_balance
       FROM payment_calls pc
       JOIN businesses b ON b.id = pc.business_id
       ${where}
       ORDER BY pc.called_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json({ data: rows, total, page, limit });
  } catch (err) { next(err); }
});

// ── GET /api/platform/calls/:bizId — calls for one business ──────────────────
router.get('/calls/:bizId', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT pc.* FROM payment_calls pc
       WHERE pc.business_id = ?
       ORDER BY pc.called_at DESC LIMIT 200`,
      [req.params.bizId]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/platform/calls/:bizId — log a new call ─────────────────────────
router.post('/calls/:bizId', async (req, res, next) => {
  try {
    const { phone_number, called_at, duration_minutes, outcome, reason, notes, follow_up_at } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'Απαιτείται αριθμός τηλεφώνου.' });

    const [[biz]] = await pool.execute('SELECT id, name FROM businesses WHERE id = ? LIMIT 1', [req.params.bizId]);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });

    const id = require('crypto').randomUUID();
    const [[caller]] = await pool.execute('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user.id]).catch(() => [[null]]);

    await pool.execute(
      `INSERT INTO payment_calls
         (id, business_id, phone_number, called_by, called_by_name, called_at,
          duration_minutes, outcome, reason, notes, follow_up_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.bizId, phone_number, req.user.id,
       caller?.full_name || null,
       called_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
       duration_minutes || null,
       outcome || 'answered', reason || 'payment_reminder',
       notes || null, follow_up_at || null]
    );

    const [[call]] = await pool.execute('SELECT * FROM payment_calls WHERE id = ? LIMIT 1', [id]);
    res.status(201).json({ data: call });
  } catch (err) { next(err); }
});

// ── PUT /api/platform/calls/entry/:callId — update a call ────────────────────
router.put('/calls/entry/:callId', async (req, res, next) => {
  try {
    const { duration_minutes, outcome, reason, notes, follow_up_at } = req.body;
    await pool.execute(
      `UPDATE payment_calls SET
         duration_minutes = ?, outcome = ?, reason = ?, notes = ?,
         follow_up_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [duration_minutes || null, outcome || 'answered', reason || 'payment_reminder',
       notes || null, follow_up_at || null, req.params.callId]
    );
    const [[call]] = await pool.execute('SELECT * FROM payment_calls WHERE id = ? LIMIT 1', [req.params.callId]);
    res.json({ data: call });
  } catch (err) { next(err); }
});

// ── DELETE /api/platform/calls/entry/:callId — delete a call ─────────────────
router.delete('/calls/entry/:callId', async (req, res, next) => {
  try {
    await pool.execute('DELETE FROM payment_calls WHERE id = ?', [req.params.callId]);
    res.json({ data: { message: 'Διαγράφηκε.' } });
  } catch (err) { next(err); }
});

// ── SMS REMINDERS ─────────────────────────────────────────────────────────────

// GET /api/platform/reminders/upcoming — businesses with expiring trial or subscription (next 14 days)
router.get('/reminders/upcoming', async (req, res, next) => {
  try {
    const days = Math.min(60, parseInt(req.query.days) || 14);
    const [rows] = await pool.execute(`
      SELECT
        b.id, b.name, b.afm, b.contact_phone,
        b.plan, b.trial_ends_at, b.subscription_ends_at, b.subscription_active,
        CASE
          WHEN b.plan = 'trial' AND b.subscription_active = 0
            THEN DATEDIFF(b.trial_ends_at, NOW())
          WHEN b.subscription_active = 1
            THEN DATEDIFF(b.subscription_ends_at, NOW())
          ELSE NULL
        END AS days_left,
        CASE
          WHEN b.plan = 'trial' AND b.subscription_active = 0 THEN 'trial'
          WHEN b.subscription_active = 1 THEN 'subscription'
          ELSE 'none'
        END AS expiry_type,
        (SELECT COUNT(*) FROM sms_reminders sr WHERE sr.business_id = b.id) AS sms_count,
        (SELECT MAX(sr2.sent_at) FROM sms_reminders sr2 WHERE sr2.business_id = b.id) AS last_sms_at
      FROM businesses b
      WHERE (
        (b.plan = 'trial' AND b.subscription_active = 0
          AND b.trial_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY))
        OR
        (b.subscription_active = 1
          AND b.subscription_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY))
      )
      ORDER BY days_left ASC, b.name ASC
    `, [days, days]);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/platform/reminders/sms — all SMS reminders (paginated)
router.get('/reminders/sms', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 30);
    const offset = (page - 1) * limit;
    const bizId  = req.query.business_id || null;

    const conds = []; const params = [];
    if (bizId) { conds.push('sr.business_id = ?'); params.push(bizId); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM sms_reminders sr ${where}`, params
    );
    const [rows] = await pool.execute(
      `SELECT sr.*, b.name AS business_name, b.afm AS business_afm
       FROM sms_reminders sr
       JOIN businesses b ON b.id = sr.business_id
       ${where}
       ORDER BY sr.sent_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json({ data: rows, total, page, limit });
  } catch (err) { next(err); }
});

// GET /api/platform/reminders/sms/:bizId — SMS reminders for one business
router.get('/reminders/sms/:bizId', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM sms_reminders WHERE business_id = ? ORDER BY sent_at DESC LIMIT 200`,
      [req.params.bizId]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /api/platform/reminders/sms/:bizId — log a manual SMS reminder
router.post('/reminders/sms/:bizId', async (req, res, next) => {
  try {
    const { phone_number, reason, notes, sent_at } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'Απαιτείται αριθμός τηλεφώνου.' });

    const [[biz]] = await pool.execute('SELECT id, name FROM businesses WHERE id = ? LIMIT 1', [req.params.bizId]);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });

    const id = require('crypto').randomUUID();
    const [[caller]] = await pool.execute('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user.id]).catch(() => [[null]]);

    await pool.execute(
      `INSERT INTO sms_reminders (id, business_id, phone_number, sent_by, sent_by_name, sent_at, reason, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.bizId, phone_number, req.user.id,
       caller?.full_name || null,
       sent_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
       reason || 'trial_expiring',
       notes || null]
    );

    const [[sms]] = await pool.execute('SELECT * FROM sms_reminders WHERE id = ? LIMIT 1', [id]);
    res.status(201).json({ data: sms });
  } catch (err) { next(err); }
});

// DELETE /api/platform/reminders/sms/entry/:smsId — delete a logged SMS
router.delete('/reminders/sms/entry/:smsId', async (req, res, next) => {
  try {
    await pool.execute('DELETE FROM sms_reminders WHERE id = ?', [req.params.smsId]);
    res.json({ data: { message: 'Διαγράφηκε.' } });
  } catch (err) { next(err); }
});

// ── MANUAL EPSILON SMART INVOICE PROCESSING ───────────────────────────────────
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const pdfService = require('../services/pdf.service');

const pdfUploadDir = path.join(__dirname, '../../uploads/invoices');
if (!fs.existsSync(pdfUploadDir)) fs.mkdirSync(pdfUploadDir, { recursive: true });

const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pdfUploadDir),
  filename:    (req, file, cb) => {
    const safeId = (req.params.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 36);
    cb(null, `${safeId}.pdf`);
  },
});
const pdfUpload = multer({
  storage:  pdfStorage,
  limits:   { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Μόνο PDF αρχεία επιτρέπονται.'));
  },
});

// POST /api/platform/invoices/:id/upload-pdf — upload manually-processed PDF
router.post('/invoices/:id/upload-pdf', pdfUpload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Δεν επιλέχτηκε αρχείο PDF.' });
    const { id } = req.params;
    const publicPath = `/uploads/invoices/${id}.pdf`;
    await pool.execute(
      'UPDATE invoices SET pdf_path = ?, updated_at = NOW() WHERE id = ?',
      [publicPath, id]
    );
    res.json({ data: { pdf_path: publicPath, message: 'PDF ανέβηκε επιτυχώς.' } });
  } catch (err) { next(err); }
});

// GET /api/platform/invoices/:id/pdf-blob — serve uploaded PDF with no-cache headers (admin)
router.get('/invoices/:id/pdf-blob', async (req, res, next) => {
  try {
    const { id } = req.params;
    const safeId = id.replace(/[^a-f0-9-]/gi, '').slice(0, 36);
    const filePath = path.join(__dirname, '../../uploads/invoices', `${safeId}.pdf`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDF δεν βρέθηκε.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

// GET /api/platform/invoices/users-summary — per-business pending + transmitted counts
router.get('/invoices/users-summary', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         b.id AS business_id,
         b.name AS business_name,
         b.afm AS business_afm,
         b.plan,
         b.subscription_active,
         u.id AS owner_id,
         u.full_name AS owner_name,
         u.email AS owner_email,
         COALESCE(SUM(CASE WHEN i.status NOT IN ('transmitted','cancelled') THEN 1 ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN i.status = 'transmitted' THEN 1 ELSE 0 END), 0) AS transmitted_count,
         COALESCE(SUM(CASE WHEN i.status = 'transmitted' THEN i.total_value ELSE 0 END), 0) AS total_transmitted_value,
         COUNT(i.id) AS total_invoice_count,
         MAX(i.created_at) AS last_invoice_at
       FROM businesses b
       LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
       LEFT JOIN invoices i ON i.business_id = b.id
       GROUP BY b.id, b.name, b.afm, b.plan, b.subscription_active, u.id, u.full_name, u.email
       HAVING (pending_count > 0 OR transmitted_count > 0)
       ORDER BY pending_count DESC, last_invoice_at DESC`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/platform/invoices/pending-mark — invoices awaiting manual MARK (all non-transmitted/cancelled)
router.get('/invoices/pending-mark', async (req, res, next) => {
  try {
    const page         = Math.max(1, parseInt(req.query.page) || 1);
    const limit        = Math.min(100, parseInt(req.query.limit) || 30);
    const offset       = (page - 1) * limit;
    const businessId   = req.query.business_id || null;
    const search       = req.query.search ? `%${req.query.search}%` : null;
    const invoiceType  = req.query.invoice_type || null;
    const month        = req.query.month || null; // YYYY-MM
    const sort         = req.query.sort || 'date_asc'; // date_asc | date_desc | amount_desc | business

    let where  = `WHERE i.status NOT IN ('transmitted', 'cancelled')`;
    const params = [];
    if (businessId)  { where += ` AND i.business_id = ?`; params.push(businessId); }
    if (search)      { where += ` AND (i.full_number LIKE ? OR b.name LIKE ? OR c.name LIKE ? OR i.mydata_mark LIKE ?)`; params.push(search, search, search, search); }
    if (invoiceType) { where += ` AND i.invoice_type = ?`; params.push(invoiceType); }
    if (month)       { where += ` AND DATE_FORMAT(i.issue_date, '%Y-%m') = ?`; params.push(month); }

    const orderMap = {
      date_asc:    'i.created_at ASC',
      date_desc:   'i.created_at DESC',
      amount_desc: 'ABS(i.total_value) DESC',
      business:    'b.name ASC, i.created_at ASC',
    };
    const orderBy = orderMap[sort] || 'i.created_at ASC';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices i
       JOIN businesses b ON b.id = i.business_id
       LEFT JOIN customers c ON c.id = i.customer_id
       ${where}`, params
    );

    const [rows] = await pool.execute(
      `SELECT i.id, i.full_number, i.invoice_type, i.issue_date, i.total_value,
              i.status, i.mydata_mark, i.created_at, i.pdf_path, i.notes,
              b.id AS business_id, b.name AS business_name, b.afm AS business_afm,
              COALESCE(c.name, i.customer_id) AS customer_name, c.afm AS customer_afm
       FROM invoices i
       JOIN businesses b ON b.id = i.business_id
       LEFT JOIN customers c ON c.id = i.customer_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`, params
    );

    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) { next(err); }
});

// GET /api/platform/invoices/transmitted — invoices already processed (have a MARK)
router.get('/invoices/transmitted', async (req, res, next) => {
  try {
    const page         = Math.max(1, parseInt(req.query.page) || 1);
    const limit        = Math.min(100, parseInt(req.query.limit) || 30);
    const offset       = (page - 1) * limit;
    const search       = req.query.search ? `%${req.query.search}%` : null;
    const businessId   = req.query.business_id || null;
    const invoiceType  = req.query.invoice_type || null;
    const month        = req.query.month || null;
    const sort         = req.query.sort || 'date_desc';

    let where = `WHERE i.status = 'transmitted'`;
    const params = [];
    if (businessId)  { where += ` AND i.business_id = ?`; params.push(businessId); }
    if (search)      { where += ` AND (i.full_number LIKE ? OR b.name LIKE ? OR c.name LIKE ? OR i.mydata_mark LIKE ?)`; params.push(search, search, search, search); }
    if (invoiceType) { where += ` AND i.invoice_type = ?`; params.push(invoiceType); }
    if (month)       { where += ` AND DATE_FORMAT(i.issue_date, '%Y-%m') = ?`; params.push(month); }

    const orderMap = {
      date_desc:   'i.transmitted_at DESC, i.created_at DESC',
      date_asc:    'i.transmitted_at ASC,  i.created_at ASC',
      amount_desc: 'ABS(i.total_value) DESC',
      business:    'b.name ASC, i.transmitted_at DESC',
    };
    const orderBy = orderMap[sort] || 'i.transmitted_at DESC, i.created_at DESC';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices i
       JOIN businesses b ON b.id = i.business_id
       LEFT JOIN customers c ON c.id = i.customer_id
       ${where}`, params
    );

    const [rows] = await pool.execute(
      `SELECT i.id, i.full_number, i.invoice_type, i.issue_date, i.total_value,
              i.status, i.mydata_mark, i.mydata_qr, i.created_at, i.transmitted_at, i.pdf_path, i.notes,
              b.id AS business_id, b.name AS business_name, b.afm AS business_afm,
              COALESCE(c.name, i.customer_id) AS customer_name, c.afm AS customer_afm
       FROM invoices i
       JOIN businesses b ON b.id = i.business_id
       LEFT JOIN customers c ON c.id = i.customer_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`, params
    );

    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) { next(err); }
});

// PATCH /api/platform/invoices/:id/mark — set MARK + QR manually (super_admin)
router.patch('/invoices/:id/mark', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { mark, qr_url } = req.body;

    if (!mark || !String(mark).trim()) {
      return res.status(400).json({ error: 'Απαιτείται αριθμός MARK.' });
    }

    const [[inv]] = await pool.execute(
      'SELECT id, business_id, full_number, status FROM invoices WHERE id = ? LIMIT 1', [id]
    );
    if (!inv) return res.status(404).json({ error: 'Παραστατικό δεν βρέθηκε.' });

    await pool.execute(
      `UPDATE invoices
       SET mydata_mark    = ?,
           mydata_qr      = ?,
           status         = 'transmitted',
           transmitted_at = NOW(),
           provider_name  = 'manual_epsilonsmart',
           updated_at     = NOW()
       WHERE id = ?`,
      [String(mark).trim(), qr_url || null, id]
    );

    const [[updated]] = await pool.execute('SELECT * FROM invoices WHERE id = ? LIMIT 1', [id]);
    res.json({ data: { message: 'MARK καταχωρήθηκε επιτυχώς.', invoice: updated } });
  } catch (err) { next(err); }
});

// GET /api/platform/stats — active business count + pending invoice count
router.get('/stats', async (req, res, next) => {
  try {
    const [[{ active_businesses }]] = await pool.execute(
      "SELECT COUNT(*) AS active_businesses FROM businesses WHERE subscription_active = 1"
    );
    const [[{ pending_mark }]] = await pool.execute(
      `SELECT COUNT(*) AS pending_mark FROM invoices
       WHERE status IN ('issued','failed','pending_retry')
         AND (mydata_mark IS NULL OR mydata_mark = '')`
    );
    res.json({ data: { active_businesses, pending_mark } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/businesses/:id/invoices — all invoices for one business ──
router.get('/businesses/:id/invoices', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { search, month, status, page = 1, limit = 30 } = req.query;
    const offset  = (parseInt(page) - 1) * parseInt(limit);
    let where  = 'WHERE i.business_id = ?';
    const params = [id];
    if (search) {
      where += ' AND (i.full_number LIKE ? OR COALESCE(c.name, \'\') LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (month) { where += ' AND DATE_FORMAT(i.issue_date,"%Y-%m") = ?'; params.push(month); }
    if (status === 'transmitted') { where += ' AND i.mydata_mark IS NOT NULL AND i.mydata_mark != ""'; }
    else if (status === 'pending') { where += ' AND (i.mydata_mark IS NULL OR i.mydata_mark = "")'; }
    const [rows] = await pool.execute(
      `SELECT i.id, i.full_number, i.invoice_type, i.status, i.mydata_mark,
              DATE(i.issue_date) AS issue_date, i.total_value, i.payment_method,
              COALESCE(c.name, '') AS customer_name
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       ${where}
       ORDER BY i.issue_date DESC
       LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      params
    );
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id ${where}`,
      params
    );
    res.json({ data: rows, total: parseInt(total), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// ── DELIVERY NOTES PLATFORM ROUTES ───────────────────────────────────────────

const dnUploadDir = path.join(__dirname, '../../uploads/delivery-notes');
if (!fs.existsSync(dnUploadDir)) fs.mkdirSync(dnUploadDir, { recursive: true });

const dnPdfStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dnUploadDir),
  filename:    (req, file, cb) => {
    const safeId = (req.params.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 36);
    cb(null, `${safeId}.pdf`);
  },
});
const dnPdfUpload = multer({
  storage:    dnPdfStorage,
  limits:     { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Μόνο PDF αρχεία επιτρέπονται.'));
  },
});

// GET /api/platform/delivery-notes/users-summary — per-business pending+transmitted counts
router.get('/delivery-notes/users-summary', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         b.id AS business_id,
         b.name AS business_name,
         b.afm AS business_afm,
         b.plan,
         b.subscription_active,
         u.id AS owner_id,
         u.full_name AS owner_name,
         u.email AS owner_email,
         COALESCE(SUM(CASE WHEN dn.status IN ('draft','issued','failed')
                           AND (dn.mydata_mark IS NULL OR dn.mydata_mark = '') THEN 1 ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN dn.mydata_mark IS NOT NULL AND dn.mydata_mark != '' THEN 1 ELSE 0 END), 0) AS transmitted_count,
         COALESCE(SUM(CASE WHEN dn.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
         MAX(dn.created_at) AS last_note_at
       FROM businesses b
       LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
       LEFT JOIN delivery_notes dn ON dn.business_id = b.id
       GROUP BY b.id, b.name, b.afm, b.plan, b.subscription_active, u.id, u.full_name, u.email
       HAVING (pending_count > 0 OR transmitted_count > 0 OR cancelled_count > 0)
       ORDER BY pending_count DESC, last_note_at DESC`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/platform/delivery-notes/pending — delivery notes without MARK
router.get('/delivery-notes/pending', async (req, res, next) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page) || 1);
    const limit      = Math.min(100, parseInt(req.query.limit) || 30);
    const offset     = (page - 1) * limit;
    const businessId = req.query.business_id || null;
    const search     = req.query.search ? `%${req.query.search}%` : null;
    const month      = req.query.month || null;
    const sort       = req.query.sort || 'date_asc';

    let where   = `WHERE dn.status IN ('draft','issued','failed') AND (dn.mydata_mark IS NULL OR dn.mydata_mark = '')`;
    const params = [];
    if (businessId) { where += ` AND dn.business_id = ?`; params.push(businessId); }
    if (search)     { where += ` AND (CONCAT(dn.series, dn.number) LIKE ? OR dn.recipient_name LIKE ? OR b.name LIKE ?)`; params.push(search, search, search); }
    if (month)      { where += ` AND DATE_FORMAT(dn.issue_date, '%Y-%m') = ?`; params.push(month); }

    const orderMap = {
      date_asc:    'dn.created_at ASC',
      date_desc:   'dn.created_at DESC',
      business:    'b.name ASC, dn.created_at ASC',
    };
    const orderBy = orderMap[sort] || 'dn.created_at ASC';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM delivery_notes dn JOIN businesses b ON b.id = dn.business_id ${where}`, params
    );
    const [rows] = await pool.execute(
      `SELECT dn.id, dn.series, dn.number, CONCAT(dn.series, dn.number) AS full_number,
              dn.issue_date, dn.dispatch_date, dn.dispatch_time,
              dn.recipient_name, dn.recipient_afm, dn.recipient_city,
              dn.vehicle_plate, dn.dispatch_location, dn.delivery_location,
              dn.loading_place, dn.transport_purpose, dn.for_weighing,
              dn.notes, dn.status, dn.mydata_mark, dn.mydata_response, dn.pdf_path, dn.created_at,
              b.id AS business_id, b.name AS business_name, b.afm AS business_afm
       FROM delivery_notes dn
       JOIN businesses b ON b.id = dn.business_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`, params
    );
    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) { next(err); }
});

// GET /api/platform/delivery-notes/transmitted — delivery notes with MARK
router.get('/delivery-notes/transmitted', async (req, res, next) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page) || 1);
    const limit      = Math.min(100, parseInt(req.query.limit) || 30);
    const offset     = (page - 1) * limit;
    const businessId = req.query.business_id || null;
    const search     = req.query.search ? `%${req.query.search}%` : null;
    const month      = req.query.month || null;
    const sort       = req.query.sort || 'date_desc';

    let where   = `WHERE dn.mydata_mark IS NOT NULL AND dn.mydata_mark != ''`;
    const params = [];
    if (businessId) { where += ` AND dn.business_id = ?`; params.push(businessId); }
    if (search)     { where += ` AND (CONCAT(dn.series, dn.number) LIKE ? OR dn.recipient_name LIKE ? OR b.name LIKE ? OR dn.mydata_mark LIKE ?)`; params.push(search, search, search, search); }
    if (month)      { where += ` AND DATE_FORMAT(dn.issue_date, '%Y-%m') = ?`; params.push(month); }

    const orderMap = {
      date_desc:   'dn.transmitted_at DESC, dn.created_at DESC',
      date_asc:    'dn.transmitted_at ASC,  dn.created_at ASC',
      business:    'b.name ASC, dn.transmitted_at DESC',
    };
    const orderBy = orderMap[sort] || 'dn.transmitted_at DESC, dn.created_at DESC';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM delivery_notes dn JOIN businesses b ON b.id = dn.business_id ${where}`, params
    );
    const [rows] = await pool.execute(
      `SELECT dn.id, dn.series, dn.number, CONCAT(dn.series, dn.number) AS full_number,
              dn.issue_date, dn.dispatch_date, dn.dispatch_time,
              dn.recipient_name, dn.recipient_afm, dn.recipient_city,
              dn.vehicle_plate, dn.dispatch_location, dn.delivery_location,
              dn.loading_place, dn.transport_purpose, dn.for_weighing,
              dn.notes, dn.status, dn.mydata_mark, dn.mydata_uid, dn.transmitted_at, dn.pdf_path, dn.created_at,
              b.id AS business_id, b.name AS business_name, b.afm AS business_afm
       FROM delivery_notes dn
       JOIN businesses b ON b.id = dn.business_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`, params
    );
    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) { next(err); }
});

// GET /api/platform/delivery-notes/cancelled — cancelled delivery notes
router.get('/delivery-notes/cancelled', async (req, res, next) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page) || 1);
    const limit      = Math.min(100, parseInt(req.query.limit) || 30);
    const offset     = (page - 1) * limit;
    const businessId = req.query.business_id || null;
    const search     = req.query.search ? `%${req.query.search}%` : null;
    const month      = req.query.month || null;
    const sort       = req.query.sort || 'date_desc';

    let where   = `WHERE dn.status = 'cancelled'`;
    const params = [];
    if (businessId) { where += ` AND dn.business_id = ?`; params.push(businessId); }
    if (search)     { where += ` AND (CONCAT(dn.series, dn.number) LIKE ? OR dn.recipient_name LIKE ? OR b.name LIKE ? OR dn.mydata_mark LIKE ?)`; params.push(search, search, search, search); }
    if (month)      { where += ` AND DATE_FORMAT(dn.issue_date, '%Y-%m') = ?`; params.push(month); }

    const orderMap = {
      date_desc: 'dn.updated_at DESC, dn.created_at DESC',
      date_asc:  'dn.updated_at ASC,  dn.created_at ASC',
      business:  'b.name ASC, dn.updated_at DESC',
    };
    const orderBy = orderMap[sort] || 'dn.updated_at DESC, dn.created_at DESC';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM delivery_notes dn JOIN businesses b ON b.id = dn.business_id ${where}`, params
    );
    const [rows] = await pool.execute(
      `SELECT dn.id, dn.series, dn.number, CONCAT(dn.series, dn.number) AS full_number,
              dn.issue_date, dn.dispatch_date, dn.dispatch_time,
              dn.recipient_name, dn.recipient_afm, dn.recipient_city,
              dn.vehicle_plate, dn.dispatch_location, dn.delivery_location,
              dn.loading_place, dn.transport_purpose, dn.for_weighing,
              dn.notes, dn.status, dn.mydata_mark, dn.mydata_uid, dn.mydata_response,
              dn.transmitted_at, dn.pdf_path, dn.created_at, dn.updated_at,
              b.id AS business_id, b.name AS business_name, b.afm AS business_afm
       FROM delivery_notes dn
       JOIN businesses b ON b.id = dn.business_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`, params
    );
    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) { next(err); }
});

// PATCH /api/platform/delivery-notes/:id/mark — set MARK manually (super_admin)
router.patch('/delivery-notes/:id/mark', async (req, res, next) => {
  try {
    const { id }  = req.params;
    const { mark, qr_url } = req.body;
    if (!mark || !String(mark).trim()) {
      return res.status(400).json({ error: 'Απαιτείται αριθμός MARK.' });
    }
    const [[dn]] = await pool.execute(
      'SELECT id, business_id, series, number FROM delivery_notes WHERE id = ? LIMIT 1', [id]
    );
    if (!dn) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    await pool.execute(
      `UPDATE delivery_notes
       SET mydata_mark = ?, mydata_uid = ?,
           status = 'transmitted', transmitted_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [String(mark).trim(), qr_url || null, id]
    );
    res.json({ data: { message: 'MARK καταχωρήθηκε επιτυχώς.' } });
  } catch (err) { next(err); }
});

// POST /api/platform/delivery-notes/:id/transmit — super_admin transmit directly to AADE myDATA
router.post('/delivery-notes/:id/transmit', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[note]] = await pool.execute(
      `SELECT dn.*,
              b.afm, b.name AS biz_name, b.address, b.city, b.postal_code, b.phone, b.email, b.doy
       FROM delivery_notes dn
       JOIN businesses b ON b.id = dn.business_id
       WHERE dn.id = ? LIMIT 1`,
      [id]
    );
    if (!note) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    if (note.status === 'transmitted') return res.status(400).json({ error: 'Ήδη διαβιβάστηκε στην ΑΑΔΕ.' });
    if (note.status === 'cancelled')  return res.status(400).json({ error: 'Ακυρωμένο — δεν μπορεί να διαβιβαστεί.' });

    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order', [note.id]
    );
    const biz = {
      afm:         note.afm,
      name:        note.biz_name,
      address:     note.address,
      city:        note.city,
      postal_code: note.postal_code,
    };
    const customer = {
      name:        note.recipient_name,
      afm:         note.recipient_afm    || '000000000',
      address:     note.recipient_address || '',
      city:        note.recipient_city    || '',
      postal:      note.recipient_postal  || '',
      postal_code: note.recipient_postal  || '',
    };

    const aadeMydata = require('../services/aade-mydata.service');
    const result = await aadeMydata.sendDeliveryNote(note, lines, biz, customer, note.business_id);

    await pool.execute(
      `UPDATE delivery_notes
       SET status = 'transmitted', mydata_mark = ?, mydata_uid = ?,
           mydata_response = ?, transmitted_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [result.mark, result.uid || null, JSON.stringify({ mark: result.mark, uid: result.uid, env: result.testMode ? 'TEST' : 'PROD' }), note.id]
    );
    res.json({ data: { message: `Διαβιβάστηκε επιτυχώς${result.testMode ? ' (TEST)' : ''}.`, mark: result.mark, uid: result.uid } });
  } catch (err) {
    await pool.execute(
      "UPDATE delivery_notes SET status = 'failed', mydata_response = ?, updated_at = NOW() WHERE id = ?",
      [JSON.stringify({ error: err.message }), req.params.id]
    ).catch(() => {});
    next(err);
  }
});

// PATCH /api/platform/delivery-notes/:id/cancel — super_admin cancel
router.patch('/delivery-notes/:id/cancel', async (req, res, next) => {
  try {
    const [[dn]] = await pool.execute('SELECT id, status FROM delivery_notes WHERE id = ? LIMIT 1', [req.params.id]);
    if (!dn) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    if (dn.status === 'cancelled') return res.status(400).json({ error: 'Ήδη ακυρωμένο.' });
    await pool.execute("UPDATE delivery_notes SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [req.params.id]);
    res.json({ data: { message: 'Το Δελτίο Αποστολής ακυρώθηκε.' } });
  } catch (err) { next(err); }
});

// POST /api/platform/delivery-notes/:id/upload-pdf — upload official PDF
router.post('/delivery-notes/:id/upload-pdf', dnPdfUpload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Δεν επιλέχτηκε αρχείο PDF.' });
    const safeId     = (req.params.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 36);
    const publicPath = `/uploads/delivery-notes/${safeId}.pdf`;
    try {
      await pool.execute('UPDATE delivery_notes SET pdf_path = ?, updated_at = NOW() WHERE id = ?', [publicPath, req.params.id]);
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        await pool.execute("ALTER TABLE delivery_notes ADD COLUMN pdf_path VARCHAR(500) NULL DEFAULT NULL");
        await pool.execute('UPDATE delivery_notes SET pdf_path = ?, updated_at = NOW() WHERE id = ?', [publicPath, req.params.id]);
      } else throw e;
    }
    res.json({ data: { pdf_path: publicPath, message: 'PDF ανέβηκε επιτυχώς.' } });
  } catch (err) { next(err); }
});

// GET /api/platform/delivery-notes/:id/pdf — serve uploaded or auto-generated PDF
router.get('/delivery-notes/:id/pdf', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[note]] = await pool.execute(
      `SELECT dn.*, b.name AS business_name, b.afm AS business_afm
       FROM delivery_notes dn
       LEFT JOIN businesses b ON b.id = dn.business_id
       WHERE dn.id = ? LIMIT 1`,
      [id]
    );
    if (!note) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });

    // Serve uploaded PDF via static redirect
    if (note.pdf_path) {
      const uploadedFile = path.join(__dirname, '../../uploads/delivery-notes', `${id}.pdf`);
      if (fs.existsSync(uploadedFile)) {
        return res.redirect(302, `/uploads/delivery-notes/${id}.pdf`);
      }
    }

    // Auto-generate PDF from delivery note data
    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [id]
    );
    note.lines = lines;

    const filePath = await pdfService.generateDeliveryNotePDF(note);
    const fname = `delivery_note_${note.series || 'A'}-${note.number || id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => { if (!res.headersSent) next(err); });
    stream.pipe(res);
    stream.on('end', () => fs.unlink(filePath, () => {}));
  } catch (err) { next(err); }
});

// ── GET /api/platform/online-users — users active within last N minutes ───────
router.get('/online-users', async (req, res, next) => {
  try {
    const minutes = Math.min(60, Math.max(1, parseInt(req.query.minutes) || 15));
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.role, u.last_seen_at, u.last_login_at,
              b.id AS business_id, b.name AS business_name, b.plan
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE u.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
         AND u.is_active = 1
       ORDER BY u.last_seen_at DESC`,
      [minutes]
    );
    res.json({ data: rows, count: rows.length, window_minutes: minutes });
  } catch (err) { next(err); }
});

// ── GET /api/platform/dn-credit-requests — list all extra-credit requests ─────
router.get('/dn-credit-requests', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM dn_credit_requests dcr JOIN businesses b ON b.id = dcr.business_id'
    );
    const [rows] = await pool.execute(`
      SELECT dcr.*, b.name AS business_name, b.afm AS business_afm,
             u.full_name AS resolved_by_name
      FROM dn_credit_requests dcr
      JOIN businesses b ON b.id = dcr.business_id
      LEFT JOIN users u ON u.id = dcr.resolved_by
      ORDER BY dcr.requested_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    res.json({ data: rows, total, page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/platform/dn-credit-requests/:id/grant — approve & add credits ──
router.post('/dn-credit-requests/:id/grant', async (req, res, next) => {
  try {
    const [[req_row]] = await pool.execute(
      "SELECT * FROM dn_credit_requests WHERE id = ? AND status = 'pending' LIMIT 1",
      [req.params.id]
    );
    if (!req_row) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε ή έχει ήδη επεξεργαστεί.' });

    // Grant DN credits
    if (req_row.credits > 0) {
      await pool.execute(
        'UPDATE businesses SET extra_dn_credits = extra_dn_credits + ? WHERE id = ?',
        [req_row.credits, req_row.business_id]
      );
    }
    // Grant invoice credits
    if ((req_row.invoice_credits ?? 0) > 0) {
      await pool.execute(
        'UPDATE businesses SET extra_invoice_credits = COALESCE(extra_invoice_credits, 0) + ? WHERE id = ?',
        [req_row.invoice_credits, req_row.business_id]
      );
    }
    await pool.execute(
      "UPDATE dn_credit_requests SET status='granted', resolved_at=NOW(), resolved_by=? WHERE id=?",
      [req.user.id, req.params.id]
    );

    const [[biz]] = await pool.execute(
      'SELECT name, extra_dn_credits, COALESCE(extra_invoice_credits,0) AS extra_invoice_credits FROM businesses WHERE id = ? LIMIT 1',
      [req_row.business_id]
    );
    const summary = [
      req_row.credits > 0            ? `${req_row.credits} ΔΑ`               : null,
      (req_row.invoice_credits ?? 0) > 0 ? `${req_row.invoice_credits} τιμολόγια` : null,
    ].filter(Boolean).join(', ');
    res.json({ data: { message: `Εγκρίθηκαν ${summary} για ${biz?.name}.`, extra_dn_credits: biz?.extra_dn_credits, extra_invoice_credits: biz?.extra_invoice_credits } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/businesses/:bizId/grant-dn-credits — manual grant ──────
router.post('/businesses/:bizId/grant-dn-credits', async (req, res, next) => {
  try {
    const { credits, invoice_credits } = req.body;
    const dnCredits  = Number(credits ?? 0);
    const invCredits = Number(invoice_credits ?? 0);
    if (dnCredits < 0 || invCredits < 0 || (dnCredits === 0 && invCredits === 0))
      return res.status(400).json({ error: 'Εισάγετε έγκυρο αριθμό πιστώσεων.' });

    if (dnCredits  > 0) await pool.execute('UPDATE businesses SET extra_dn_credits = extra_dn_credits + ? WHERE id = ?', [dnCredits, req.params.bizId]);
    if (invCredits > 0) await pool.execute('UPDATE businesses SET extra_invoice_credits = COALESCE(extra_invoice_credits,0) + ? WHERE id = ?', [invCredits, req.params.bizId]);

    const [[biz]] = await pool.execute(
      'SELECT name, extra_dn_credits, COALESCE(extra_invoice_credits,0) AS extra_invoice_credits FROM businesses WHERE id = ? LIMIT 1', [req.params.bizId]
    );
    res.json({ data: { message: `Χορηγήθηκαν πιστώσεις σε ${biz?.name}.`, extra_dn_credits: biz?.extra_dn_credits, extra_invoice_credits: biz?.extra_invoice_credits } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/dn-credit-requests/:id/reject ─────────────────────────
router.post('/dn-credit-requests/:id/reject', async (req, res, next) => {
  try {
    await pool.execute(
      "UPDATE dn_credit_requests SET status='rejected', resolved_at=NOW(), resolved_by=? WHERE id=? AND status='pending'",
      [req.user.id, req.params.id]
    );
    res.json({ data: { message: 'Αίτημα απορρίφθηκε.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/payment-settings — read payment/bank details (admin) ────
router.get('/payment-settings', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const KEYS = ['payment_bank_name','payment_beneficiary','payment_iban','payment_reference_hint','payment_notes','payment_iris_enabled','payment_iris_phone'];
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${KEYS.map(() => '?').join(',')})`,
      KEYS
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    res.json({ data: map });
  } catch (err) { next(err); }
});

// ── PUT /api/platform/payment-settings — update payment/bank details (admin) ──
router.put('/payment-settings', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const ALLOWED = ['payment_bank_name','payment_beneficiary','payment_iban','payment_reference_hint','payment_notes','payment_iris_enabled','payment_iris_phone'];
    for (const key of ALLOWED) {
      const val = req.body[key];
      if (val === undefined) continue;
      await pool.execute(
        `INSERT INTO platform_settings (setting_key, setting_value)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(val)]
      );
    }
    res.json({ data: { message: 'Στοιχεία πληρωμής αποθηκεύτηκαν.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/wrapp/settings — read Wrapp platform settings ───────────
router.get('/wrapp/settings', async (req, res, next) => {
  try {
    const KEYS = ['wrapp_partner_api_key', 'wrapp_base_url', 'wrapp_webhook_endpoint'];
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${KEYS.map(() => '?').join(',')})`,
      KEYS
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    // Mask partner key — return first 8 chars + bullets so admin can confirm it's set without exposing it
    const rawKey = map.wrapp_partner_api_key || '';
    map.wrapp_partner_api_key = rawKey ? rawKey.slice(0, 8) + '●'.repeat(Math.max(0, rawKey.length - 8)) : '';
    map.has_partner_key = rawKey.length > 0;
    res.json({ data: map });
  } catch (err) { next(err); }
});

// ── PUT /api/platform/wrapp/settings — save Wrapp platform settings ───────────
router.put('/wrapp/settings', async (req, res, next) => {
  try {
    const ALLOWED = ['wrapp_partner_api_key', 'wrapp_base_url', 'wrapp_webhook_endpoint'];
    for (const key of ALLOWED) {
      const val = req.body[key];
      if (val === undefined) continue;
      await pool.execute(
        `INSERT INTO platform_settings (setting_key, setting_value)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(val)]
      );
    }
    res.json({ data: { message: 'Ρυθμίσεις Wrapp αποθηκεύτηκαν.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/wrapp/status/:bizId — check Wrapp subscription status ──
router.get('/wrapp/status/:bizId', async (req, res, next) => {
  try {
    const [[biz]] = await pool.execute(
      `SELECT wrapp_enabled, wrapp_api_key, wrapp_user_id,
              wrapp_billing_book_dn_id, wrapp_billing_book_inv_id
       FROM businesses WHERE id = ? LIMIT 1`,
      [req.params.bizId]
    );
    if (!biz) return res.status(404).json({ error: 'Επιχείρηση δεν βρέθηκε.' });

    let subscriptionActive = null;
    if (biz.wrapp_api_key) {
      try {
        const wrapp = require('../services/wrapp.service');
        const status = await wrapp.checkUserStatus(req.params.bizId);
        subscriptionActive = status.active_subscription;
      } catch (_) {}
    }

    res.json({
      data: {
        wrapp_enabled:             biz.wrapp_enabled === 1,
        has_api_key:               !!biz.wrapp_api_key,
        wrapp_user_id:             biz.wrapp_user_id || null,
        billing_book_dn_id:        biz.wrapp_billing_book_dn_id || null,
        billing_book_inv_id:       biz.wrapp_billing_book_inv_id || null,
        subscription_active:       subscriptionActive,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/platform/wrapp/initiate-onboarding/:bizId ──────────────────────
router.post('/wrapp/initiate-onboarding/:bizId', async (req, res, next) => {
  try {
    const wrapp  = require('../services/wrapp.service');
    const result = await wrapp.initiateOnboarding(req.params.bizId);
    res.json({ data: result });
  } catch (err) { next(err); }
});

// ── PATCH /api/platform/wrapp/toggle/:bizId — enable/disable Wrapp ───────────
router.patch('/wrapp/toggle/:bizId', async (req, res, next) => {
  try {
    const enabled = req.body.enabled ? 1 : 0;
    await pool.execute(
      'UPDATE businesses SET wrapp_enabled = ?, updated_at = NOW() WHERE id = ?',
      [enabled, req.params.bizId]
    );
    if (!enabled) {
      const wrapp = require('../services/wrapp.service');
      wrapp.invalidateCache(req.params.bizId);
    }
    res.json({ data: { message: enabled ? 'Wrapp ενεργοποιήθηκε.' : 'Wrapp απενεργοποιήθηκε.' } });
  } catch (err) { next(err); }
});

// ── PATCH /api/platform/businesses/:bizId/email — set business email (Wrapp override) ─
router.patch('/businesses/:bizId/email', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required.' });
    await pool.execute(
      'UPDATE businesses SET email = ?, updated_at = NOW() WHERE id = ?',
      [email.trim(), req.params.bizId]
    );
    res.json({ data: { message: 'Business email updated.', email: email.trim() } });
  } catch (err) { next(err); }
});

// ── DELETE /api/platform/wrapp/clear-billing-cache/:bizId ────────────────────
router.delete('/wrapp/clear-billing-cache/:bizId', async (req, res, next) => {
  try {
    await pool.execute(
      `UPDATE businesses SET wrapp_billing_book_dn_id = NULL, wrapp_billing_book_inv_id = NULL,
       updated_at = NOW() WHERE id = ?`,
      [req.params.bizId]
    );
    const wrapp = require('../services/wrapp.service');
    wrapp.invalidateCache(req.params.bizId);
    res.json({ data: { message: 'Cache billing books εκκαθαρίστηκε.' } });
  } catch (err) { next(err); }
});

// ── GET /api/platform/wrapp/logs — stream wrapp.log content ──────────────────
// ?tail=N  return last N lines (default 500, max 5000)
// ?from_line=N  return only lines starting at line N (for incremental polling)
router.get('/wrapp/logs', async (req, res, next) => {
  try {
    const LOG_FILE = path.join(__dirname, '../../logs/wrapp.log');
    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ lines: [], total_lines: 0, log_exists: false });
    }

    const tail      = Math.min(5000, Math.max(1, parseInt(req.query.tail) || 500));
    const fromLine  = parseInt(req.query.from_line) || 0;

    const raw    = fs.readFileSync(LOG_FILE, 'utf8');
    const allLines = raw.split('\n').filter(l => l.trim() !== '');
    const total  = allLines.length;

    let lines;
    if (fromLine > 0) {
      lines = allLines.slice(fromLine);
    } else {
      lines = allLines.slice(-tail);
    }

    const size = fs.statSync(LOG_FILE).size;
    res.json({ lines, total_lines: total, log_size_bytes: size, log_exists: true });
  } catch (err) { next(err); }
});

// ── POST /api/platform/wrapp/logs/clear — truncate wrapp.log ─────────────────
router.post('/wrapp/logs/clear', async (req, res, next) => {
  try {
    const LOG_FILE = path.join(__dirname, '../../logs/wrapp.log');
    if (fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');
    res.json({ data: { message: 'Το αρχείο log εκκαθαρίστηκε.' } });
  } catch (err) { next(err); }
});

// ── POST /api/platform/wrapp/transmit-pending — manual trigger ───────────────
router.post('/wrapp/transmit-pending', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { runAutoTransmit } = require('../jobs/autoTransmit');
    // fire-and-forget; response returns immediately
    runAutoTransmit().catch(() => {});
    res.json({ data: { message: 'Η διαβίβαση εκκίνησε. Δείτε τα logs για αποτελέσματα.' } });
  } catch (err) { next(err); }
});

module.exports = router;
