const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBizId(req) {
  return (req.user.role === 'super_admin' && req.query.business_id)
    ? req.query.business_id
    : req.user.business_id;
}

async function upsertSettings(businessId, fields) {
  const cols = Object.keys(fields);
  const vals = Object.values(fields);
  const setClause = cols.map(c => `${c} = ?`).join(', ');
  await pool.execute(
    `INSERT INTO business_settings (business_id, ${cols.join(', ')})
     VALUES (?, ${cols.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${setClause}, updated_at = NOW()`,
    [businessId, ...vals, ...vals]
  );
}

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    // Super admin with no business_id: return platform-level info
    if (req.user.role === 'super_admin' && !req.query.business_id && !req.user.business_id) {
      return res.json({
        data: {
          business: { role: 'super_admin', platform: 'fishbill' },
          settings: {},
        },
      });
    }

    const businessId = getBizId(req);

    const [bizRows] = await pool.execute(
      'SELECT * FROM businesses WHERE id = ? LIMIT 1',
      [businessId]
    );

    if (!bizRows.length) {
      return res.status(404).json({ error: 'Business not found.' });
    }

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1',
      [businessId]
    );

    res.json({
      data: {
        business: bizRows[0],
        settings: settingsRows.length ? settingsRows[0] : {},
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/profile
// ---------------------------------------------------------------------------
router.patch('/profile', async (req, res, next) => {
  try {
    const businessId = getBizId(req);

    const allowedFields = [
      'name', 'trade_name', 'doy', 'address', 'city', 'postal_code',
      'phone', 'email', 'activity_code', 'vat_regime',
      'accountant_name', 'accountant_email', 'accountant_phone',
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
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    setClauses.push('updated_at = NOW()');
    params.push(businessId);

    await pool.execute(
      `UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    const [updated] = await pool.execute(
      'SELECT * FROM businesses WHERE id = ? LIMIT 1',
      [businessId]
    );

    res.json({ data: updated[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET  /api/settings/gsis/status
// PATCH /api/settings/gsis  — save ΓΓΠΣ credentials for AFM lookup
// ---------------------------------------------------------------------------
router.get('/gsis/status', async (req, res, next) => {
  try {
    const businessId = getBizId(req);
    const [rows] = await pool.execute(
      'SELECT gsis_username, gsis_password FROM businesses WHERE id = ? LIMIT 1',
      [businessId]
    );
    const row = rows[0] || {};
    const configured = !!(row.gsis_username && row.gsis_password);
    res.json({
      data: {
        configured,
        username: configured ? row.gsis_username : null,
        has_password: !!(row.gsis_password),
      },
    });
  } catch (err) { next(err); }
});

router.patch('/gsis', async (req, res, next) => {
  try {
    const businessId = getBizId(req);
    const { gsis_username, gsis_password } = req.body;

    const setClauses = [];
    const params = [];
    if (gsis_username !== undefined) { setClauses.push('gsis_username = ?'); params.push(gsis_username || null); }
    if (gsis_password !== undefined) { setClauses.push('gsis_password = ?'); params.push(gsis_password || null); }

    if (!setClauses.length) return res.status(400).json({ error: 'No fields provided.' });
    setClauses.push('updated_at = NOW()');
    params.push(businessId);
    await pool.execute(`UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`, params);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/mydata
// ---------------------------------------------------------------------------
router.patch('/mydata', async (req, res, next) => {
  try {
    const businessId = getBizId(req);

    const allowedFields = [
      'mydata_user_id', 'mydata_subscription_key',
      'provider_name', 'provider_api_key', 'provider_api_url',
      'provider_username', 'provider_password',
      // Provider-specific
      'mydata_provider',
      'softone_api_key', 'softone_api_url', 'softone_username', 'softone_password', 'softone_company_id',
      'epsilonnet_api_key', 'epsilonnet_api_url', 'epsilonnet_username', 'epsilonnet_password',
      'unidoc_api_key', 'unidoc_api_url', 'unidoc_username', 'unidoc_password',
      'etimologiera_api_key', 'etimologiera_subscription_id', 'etimologiera_api_url',
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
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    setClauses.push('updated_at = NOW()');
    params.push(businessId);

    await pool.execute(
      `UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    const [updated] = await pool.execute(
      'SELECT * FROM businesses WHERE id = ? LIMIT 1',
      [businessId]
    );

    res.json({ data: updated[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/email
// ---------------------------------------------------------------------------
router.patch('/email', async (req, res, next) => {
  try {
    const businessId = getBizId(req);

    const allowedFields = [
      'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass',
      'smtp_from_name', 'smtp_from_email', 'smtp_secure', 'email_enabled',
      'email_provider', 'brevo_api_key', 'brevo_sender_name', 'brevo_sender_email',
      'sendgrid_api_key', 'mailgun_api_key', 'mailgun_domain',
    ];

    const fields = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields[field] = req.body[field];
      }
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    await upsertSettings(businessId, fields);

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1',
      [businessId]
    );

    res.json({ data: settingsRows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/sms
// ---------------------------------------------------------------------------
router.patch('/sms', async (req, res, next) => {
  try {
    const businessId = getBizId(req);

    const allowedFields = [
      'sms_provider', 'sms_api_key', 'sms_api_secret', 'sms_from', 'sms_enabled',
      'sms_provider_type',
      'infobip_api_key', 'infobip_base_url',
      'apifon_api_key', 'apifon_sender',
      'routee_api_key', 'routee_sender_id',
      'vonage_api_key', 'vonage_api_secret',
      'twilio_account_sid', 'twilio_auth_token', 'twilio_from_number',
      'bsms_api_key', 'yuboto_api_key',
    ];

    const fields = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields[field] = req.body[field];
      }
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    await upsertSettings(businessId, fields);

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1',
      [businessId]
    );

    res.json({ data: settingsRows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/notifications
// ---------------------------------------------------------------------------
router.patch('/notifications', async (req, res, next) => {
  try {
    const businessId = getBizId(req);

    const allowedFields = [
      'notif_invoice_created', 'notif_invoice_transmitted',
      'notif_invoice_failed', 'notif_daily_summary',
      'feature_customers',
      'feature_weighing_slips',
      'feature_ospa',
    ];

    const fields = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields[field] = req.body[field];
      }
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    await upsertSettings(businessId, fields);

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1',
      [businessId]
    );

    res.json({ data: settingsRows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/invoice
// ---------------------------------------------------------------------------
router.patch('/invoice', async (req, res, next) => {
  try {
    const businessId = getBizId(req);

    const allowedFields = ['invoice_footer', 'default_due_days', 'auto_transmit', 'default_vat_rate'];

    const fields = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields[field] = req.body[field];
      }
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    await upsertSettings(businessId, fields);

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1',
      [businessId]
    );

    res.json({ data: settingsRows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET  /api/settings/etimologiera/status
// PATCH /api/settings/etimologiera
// ---------------------------------------------------------------------------
router.get('/etimologiera/status', async (req, res, next) => {
  try {
    const businessId = getBizId(req);
    const [rows] = await pool.execute(
      'SELECT etimologiera_username, etimologiera_api_key FROM businesses WHERE id = ? LIMIT 1',
      [businessId]
    );
    const row = rows[0] || {};
    const configured = !!(row.etimologiera_username && row.etimologiera_api_key);
    res.json({
      data: {
        configured,
        username: configured ? row.etimologiera_username : null,
        has_api_key: !!(row.etimologiera_api_key),
      },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/settings/mydata/status — AADE direct credentials status
// ---------------------------------------------------------------------------
router.get('/mydata/status', async (req, res, next) => {
  try {
    const businessId = getBizId(req);
    const [rows] = await pool.execute(
      'SELECT mydata_user_id, mydata_subscription_key FROM businesses WHERE id = ? LIMIT 1',
      [businessId]
    );
    const row = rows[0] || {};
    const configured = !!(row.mydata_user_id && row.mydata_subscription_key);
    res.json({
      data: {
        configured,
        user_id: configured ? row.mydata_user_id : null,
        has_subscription_key: !!(row.mydata_subscription_key),
      },
    });
  } catch (err) { next(err); }
});

router.patch('/etimologiera', async (req, res, next) => {
  try {
    const businessId = getBizId(req);
    const { etimologiera_username, etimologiera_api_key } = req.body;

    const setClauses = [];
    const params = [];
    if (etimologiera_username !== undefined) { setClauses.push('etimologiera_username = ?'); params.push(etimologiera_username || null); }
    if (etimologiera_api_key  !== undefined) { setClauses.push('etimologiera_api_key = ?');  params.push(etimologiera_api_key  || null); }

    if (!setClauses.length) {
      return res.status(400).json({ error: 'Δεν δόθηκαν πεδία.' });
    }

    setClauses.push('updated_at = NOW()');
    params.push(businessId);
    await pool.execute(`UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`, params);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/settings/features — enabled add-ons + monthly cost breakdown
// ---------------------------------------------------------------------------
router.get('/features', async (req, res, next) => {
  try {
    const businessId = getBizId(req);
    if (!businessId) return res.status(400).json({ error: 'business_id απαιτείται.' });

    const FEATURE_DEFS = [
      { key: 'feature_weighing_slips', label: 'Δελτία Ζύγισης', price: 2 },
      { key: 'feature_ospa',           label: 'OSPA',           price: 10 },
    ];
    const PLAN_BASE = { trial: 0, basic: 8, pro: 12, enterprise: 30 };

    const [[biz]] = await pool.execute(
      'SELECT plan FROM businesses WHERE id = ? LIMIT 1', [businessId]
    );
    if (!biz) return res.status(404).json({ error: 'Business not found.' });

    const [[settings]] = await pool.execute(
      'SELECT feature_weighing_slips, feature_ospa FROM business_settings WHERE business_id = ? LIMIT 1',
      [businessId]
    );
    const s = settings || {};

    const addons = FEATURE_DEFS.map(f => ({
      key: f.key, label: f.label, price: f.price, enabled: !!(s[f.key]),
    }));
    const addons_total  = addons.filter(a => a.enabled).reduce((sum, a) => sum + a.price, 0);
    const plan_price    = PLAN_BASE[biz.plan] ?? 0;
    const total_monthly = plan_price + addons_total;

    res.json({ data: { addons, addons_total, plan_price, total_monthly, plan: biz.plan } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/appearance
// ---------------------------------------------------------------------------
router.patch('/appearance', async (req, res, next) => {
  try {
    const businessId = getBizId(req);

    const allowedFields = ['theme_accent'];

    const fields = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields[field] = req.body[field];
      }
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    await upsertSettings(businessId, fields);

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1',
      [businessId]
    );

    res.json({ data: settingsRows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
