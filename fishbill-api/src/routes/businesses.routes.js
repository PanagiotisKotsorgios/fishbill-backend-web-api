const express = require('express');
const router = express.Router();
const Joi = require('joi');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin, requireOwnerOrAbove } = require('../middleware/role');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../middleware/audit');
const emailSvc = require('../services/email.service');

// Helper: send delete confirmation email to admin

// Helper: send delete confirmation email to admin (uses configured email provider)
async function sendDeleteConfirmEmail(toEmail, businessName, code) {
  await emailSvc.sendAdminActionEmail({
    adminEmail: toEmail,
    subject: `⚠️ Κωδικός Διαγραφής Επιχείρησης — ${businessName}`,
    bodyHtml: `
      <h1 style="font-size:22px;font-weight:800;color:#991b1b;margin:0 0 16px">⚠️ Αίτημα Διαγραφής Επιχείρησης</h1>
      <p style="font-size:15px;color:#3a5560;margin:0 0 8px">Επιχείρηση: <strong>${businessName}</strong></p>
      <p style="font-size:15px;color:#3a5560;margin:0 0 16px">Κωδικός επιβεβαίωσης:</p>
      <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#dc2626;background:#fef2f2;border:2px solid #fca5a5;padding:24px;border-radius:12px;text-align:center;margin:0 0 20px">${code}</div>
      <div style="background:#f5fbfc;border:1px solid #ceeaee;border-radius:10px;padding:14px 16px;margin-bottom:20px">
        <p style="margin:0;font-size:13px;color:#4a6572">
          <strong>⏱ Ισχύει για 10 λεπτά.</strong><br/>
          Η διαγραφή είναι <strong>μη αναστρέψιμη</strong> — όλα τα δεδομένα της επιχείρησης θα διαγραφούν οριστικά.
        </p>
      </div>
      <p style="font-size:13px;color:#8aacb4;margin:0">Αν δεν ζητήσατε αυτή την ενέργεια, αγνοήστε αυτό το email.</p>
    `,
  });
}

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const businessSchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  afm: Joi.string().length(9).required(),
  doy: Joi.string().max(100).optional().allow('', null),
  address: Joi.string().max(255).optional().allow('', null),
  city: Joi.string().max(100).optional().allow('', null),
  postal_code: Joi.string().max(10).optional().allow('', null),
  phone: Joi.string().max(30).optional().allow('', null),
  email: Joi.string().email().optional().allow('', null),
  website: Joi.string().max(255).optional().allow('', null),
  logo_url: Joi.string().max(512).optional().allow('', null),
  subscription_plan: Joi.string().valid('free', 'basic', 'pro', 'enterprise').optional(),
});

const updateBusinessSchema = businessSchema.fork(
  ['name', 'afm'],
  (field) => field.optional()
);

const suspendSchema = Joi.object({
  suspend_reason: Joi.string().max(500).allow('', null).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/businesses  — super_admin only
// ---------------------------------------------------------------------------
router.get('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    // Support both ?search= and ?q= for backwards compat
    const search = req.query.q || req.query.search;

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(b.name LIKE ? OR b.afm LIKE ? OR b.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (req.query.plan) {
      conditions.push('b.plan = ?');
      params.push(req.query.plan);
    }
    if (req.query.active !== undefined && req.query.active !== '') {
      conditions.push('b.is_active = ?');
      params.push(parseInt(req.query.active));
    }
    if (req.query.suspended !== undefined && req.query.suspended !== '') {
      conditions.push('b.is_suspended = ?');
      params.push(parseInt(req.query.suspended));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM businesses b ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT b.*, COUNT(u.id) AS user_count
       FROM businesses b
       LEFT JOIN users u ON u.business_id = b.id
       ${whereClause}
       GROUP BY b.id
       ORDER BY b.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/businesses  — super_admin only
// ---------------------------------------------------------------------------
router.post(
  '/',
  requireSuperAdmin,
  validate(businessSchema),
  logAudit('CREATE_BUSINESS', 'business'),
  async (req, res, next) => {
    try {
      const {
        name, afm, doy, address, city, postal_code, phone, email,
        website, logo_url, subscription_plan,
      } = req.body;

      const [existing] = await pool.execute(
        'SELECT id FROM businesses WHERE afm = ? LIMIT 1',
        [afm]
      );
      if (existing.length) {
        return res.status(409).json({ error: 'Business with this AFM already exists.' });
      }

      const fishermanCode = Math.floor(100000 + Math.random() * 900000).toString();
      const newBizId = uuidv4();

      await pool.execute(
        `INSERT INTO businesses
           (id, name, afm, doy, address, city, postal_code, phone, email,
            plan, is_active, is_suspended, fisherman_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, NOW(), NOW())`,
        [newBizId, name, afm, doy || null, address || null, city || null, postal_code || null,
         phone || null, email || null,
         subscription_plan || 'trial', fishermanCode]
      );

      // Create default invoice series
      await pool.execute(
        `INSERT INTO invoice_series (business_id, series, current_number, is_default, created_at)
         VALUES (?, 'A', 0, 1, NOW())`,
        [newBizId]
      );

      const [newBiz] = await pool.execute('SELECT * FROM businesses WHERE id = ?', [newBizId]);
      res.status(201).json({ data: newBiz[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Greek myDATA 2026 invoice types available for fishermen (max 5)
// ---------------------------------------------------------------------------
const MYDATA_INVOICE_TYPES = [
  { code: '1.1',  label: 'Τιμολόγιο Πώλησης' },
  { code: '5.1',  label: 'Πιστωτικό Τιμολόγιο / Ακυρωτικό (Συσχετισμένο)' },
  { code: '6.1',  label: 'Στοιχείο Αυτοτιμολόγησης' },
  { code: '11.1', label: 'ΑΠΥ – Λιανική Πώληση / Παροχή Υπηρεσιών' },
  { code: '11.4', label: 'Πιστωτικό Στοιχείο Λιανικής / Ακυρωτικό' },
];

// ---------------------------------------------------------------------------
// GET /api/businesses/invoice-types  — list all available myDATA types
// Must be defined BEFORE /:id routes to avoid match as id='invoice-types'
// ---------------------------------------------------------------------------
router.get('/invoice-types', requireSuperAdmin, (req, res) => {
  res.json({ data: MYDATA_INVOICE_TYPES });
});

// ---------------------------------------------------------------------------
// GET /api/businesses/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Non-super_admin can only see their own business
    if (req.user.role !== 'super_admin' && req.user.business_id != id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM businesses WHERE id = ? LIMIT 1',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Business not found.' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/businesses/:id
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  requireOwnerOrAbove,
  validate(updateBusinessSchema),
  logAudit('UPDATE_BUSINESS', 'business'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Owner can only update their own business
      if (req.user.role !== 'super_admin' && req.user.business_id != id) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const [existing] = await pool.execute('SELECT id FROM businesses WHERE id = ? LIMIT 1', [id]);
      if (!existing.length) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      const fields = req.body;
      const allowedFields = [
        'name', 'afm', 'doy', 'address', 'city', 'postal_code', 'phone',
        'email', 'trade_name', 'activity_code', 'vat_regime', 'plan',
        'accountant_name', 'accountant_email', 'accountant_phone',
      ];

      const setClauses = [];
      const params = [];
      for (const field of allowedFields) {
        if (fields[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          params.push(fields[field]);
        }
      }

      if (!setClauses.length) {
        return res.status(400).json({ error: 'No updatable fields provided.' });
      }

      setClauses.push('updated_at = NOW()');
      params.push(id);

      await pool.execute(
        `UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );

      const [updated] = await pool.execute('SELECT * FROM businesses WHERE id = ?', [id]);
      res.json({ data: updated[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/businesses/:id/delete-request  — super_admin only
// Sends a 6-digit OTP to the admin email to confirm hard deletion
// ---------------------------------------------------------------------------
router.post('/:id/delete-request', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.execute('SELECT id, name FROM businesses WHERE id = ? LIMIT 1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Business not found.' });

    const code = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    const key = `biz_delete_${id}`;
    const val = JSON.stringify({ code, expires: expires.toISOString(), requested_by: req.user.id });

    await pool.execute(
      `INSERT INTO platform_settings (setting_key, setting_value)
       VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
      [key, val, val]
    );

    const adminEmail = req.user.email;
    try {
      await sendDeleteConfirmEmail(adminEmail, existing[0].name, code);
    } catch (emailErr) {
      console.error('[delete-request] email failed:', emailErr.message);
    }

    res.json({ data: { message: `Κωδικός στάλθηκε στο ${adminEmail}` } });
        } catch (err) {
          next(err);
        }
      });

// ---------------------------------------------------------------------------
// DELETE /api/businesses/:id  — super_admin only, hard delete with OTP
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireSuperAdmin,
  logAudit('DELETE_BUSINESS', 'business'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const confirmationCode = req.query.confirmation_code;

      if (!confirmationCode) {
        return res.status(400).json({ error: 'Απαιτείται κωδικός επιβεβαίωσης.' });
      }

      // Validate OTP
      const key = `biz_delete_${id}`;
      const [otpRows] = await pool.execute(
        'SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1',
        [key]
      );
      if (!otpRows.length) {
        return res.status(400).json({ error: 'Δεν βρέθηκε αίτημα διαγραφής. Ζητήστε νέο κωδικό.' });
      }

      let stored;
      try { stored = JSON.parse(otpRows[0].setting_value); } catch {
        return res.status(400).json({ error: 'Μη έγκυρο αίτημα.' });
      }

      if (new Date() > new Date(stored.expires)) {
        return res.status(400).json({ error: 'Ο κωδικός έχει λήξει. Ζητήστε νέο.' });
      }
      if (stored.code !== String(confirmationCode)) {
        return res.status(400).json({ error: 'Λανθασμένος κωδικός επιβεβαίωσης.' });
      }

      const [existing] = await pool.execute('SELECT id FROM businesses WHERE id = ? LIMIT 1', [id]);
      if (!existing.length) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      // Hard delete: cascade through all related tables
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute('DELETE il FROM invoice_lines il JOIN invoices i ON il.invoice_id = i.id WHERE i.business_id = ?', [id]);
        await conn.execute('DELETE FROM invoices WHERE business_id = ?', [id]);
        await conn.execute('DELETE FROM customers WHERE business_id = ?', [id]);
        await conn.execute('DELETE FROM products WHERE business_id = ?', [id]);
        await conn.execute('DELETE FROM invoice_series WHERE business_id = ?', [id]);
        await conn.execute('DELETE FROM accountant_clients WHERE business_id = ?', [id]);
        await conn.execute('DELETE ep FROM employee_privileges ep JOIN users u ON ep.user_id = u.id WHERE u.business_id = ?', [id]);
        await conn.execute('DELETE FROM users WHERE business_id = ?', [id]);
        await conn.execute('DELETE FROM businesses WHERE id = ?', [id]);
        await conn.execute('DELETE FROM platform_settings WHERE setting_key = ?', [key]);
        await conn.commit();
      } catch (deleteErr) {
        await conn.rollback();
        throw deleteErr;
      } finally {
        conn.release();
      }

      res.json({ data: { message: 'Η επιχείρηση και όλα τα δεδομένα της διαγράφηκαν οριστικά.' } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/businesses/:id/suspend  — super_admin only
// ---------------------------------------------------------------------------
router.post(
  '/:id/suspend',
  requireSuperAdmin,
  validate(suspendSchema),
  logAudit('SUSPEND_BUSINESS', 'business'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { suspend_reason } = req.body;

      const [existing] = await pool.execute('SELECT id FROM businesses WHERE id = ? LIMIT 1', [id]);
      if (!existing.length) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      const [bizInfo] = await pool.execute('SELECT name, afm FROM businesses WHERE id = ? LIMIT 1', [id]).catch(() => [[]]);
      await pool.execute(
        `UPDATE businesses SET is_suspended = 1, suspend_reason = ?, updated_at = NOW() WHERE id = ?`,
        [suspend_reason || null, id]
      );

      // Notify admin (action log)
      const biz = bizInfo[0] || {};
      emailSvc.sendAdminActionEmail({
        subject: `Επιχείρηση Ανεστάλη: ${biz.name || id}`,
        bodyHtml: `<h2 style="color:#991b1b">🔒 Αναστολή Επιχείρησης</h2>
          <p><strong>Επιχείρηση:</strong> ${biz.name || id}</p>
          <p><strong>ΑΦΜ:</strong> ${biz.afm || '—'}</p>
          <p><strong>Αιτία:</strong> ${suspend_reason || '—'}</p>
          <p><strong>Χρόνος:</strong> ${new Date().toLocaleString('el-GR')}</p>`,
      }).catch(() => {});

      res.json({ data: { message: 'Business suspended successfully.' } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/businesses/:id/activate  — super_admin only
// ---------------------------------------------------------------------------
router.post(
  '/:id/activate',
  requireSuperAdmin,
  logAudit('ACTIVATE_BUSINESS', 'business'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const [existing] = await pool.execute('SELECT id FROM businesses WHERE id = ? LIMIT 1', [id]);
      if (!existing.length) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      const [bizInfoAct] = await pool.execute('SELECT name, afm FROM businesses WHERE id = ? LIMIT 1', [id]).catch(() => [[]]);
      await pool.execute(
        `UPDATE businesses SET is_suspended = 0, is_active = 1, suspend_reason = NULL, updated_at = NOW() WHERE id = ?`,
        [id]
      );

      // Notify admin (action log)
      const bizAct = bizInfoAct[0] || {};
      emailSvc.sendAdminActionEmail({
        subject: `Επιχείρηση Ενεργοποιήθηκε: ${bizAct.name || id}`,
        bodyHtml: `<h2 style="color:#059669">✅ Ενεργοποίηση Επιχείρησης</h2>
          <p><strong>Επιχείρηση:</strong> ${bizAct.name || id}</p>
          <p><strong>ΑΦΜ:</strong> ${bizAct.afm || '—'}</p>
          <p><strong>Χρόνος:</strong> ${new Date().toLocaleString('el-GR')}</p>`,
      }).catch(() => {});

      res.json({ data: { message: 'Business activated successfully.' } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/businesses/:id/stats
// ---------------------------------------------------------------------------
router.get('/:id/stats', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.role !== 'super_admin' && req.user.business_id != id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const [invoiceStats] = await pool.execute(
      `SELECT
         COUNT(*) AS invoice_count,
         COALESCE(SUM(total_value), 0) AS total_revenue,
         COUNT(CASE WHEN status = 'issued' THEN 1 END) AS issued_count,
         COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
         COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft_count
       FROM invoices
       WHERE business_id = ?`,
      [id]
    );

    const [customerCount] = await pool.execute(
      'SELECT COUNT(*) AS customer_count FROM customers WHERE business_id = ? AND is_active = 1',
      [id]
    );

    res.json({
      data: {
        ...invoiceStats[0],
        customer_count: customerCount[0].customer_count,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/businesses/:id/invoice-types  — get allowed types for a business
// ---------------------------------------------------------------------------
router.get('/:id/invoice-types', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.role !== 'super_admin' && req.user.business_id != id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const [rows] = await pool.execute('SELECT allowed_invoice_types FROM businesses WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Business not found.' });
    let types = [];
    try { types = JSON.parse(rows[0].allowed_invoice_types || '[]'); } catch {}
    res.json({ data: types, all: MYDATA_INVOICE_TYPES });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /api/businesses/:id/invoice-types  — set allowed types (max 5)
// ---------------------------------------------------------------------------
router.put(
  '/:id/invoice-types',
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { types } = req.body;
      if (!Array.isArray(types)) return res.status(400).json({ error: 'types must be an array.' });
      if (types.length > 5) return res.status(400).json({ error: 'Maximum 5 invoice types allowed.' });
      const validCodes = MYDATA_INVOICE_TYPES.map(t => t.code);
      const invalid = types.filter(t => !validCodes.includes(t));
      if (invalid.length) return res.status(400).json({ error: `Invalid types: ${invalid.join(', ')}` });
      await pool.execute(
        'UPDATE businesses SET allowed_invoice_types = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(types), id]
      );
      res.json({ data: { allowed_invoice_types: types } });
    } catch (err) { next(err); }
  }
);

// ---------------------------------------------------------------------------
// Business add-on features & payment history
// ---------------------------------------------------------------------------

// Self-migrate: business_payments table
(async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS business_payments (
        id             CHAR(36)      NOT NULL PRIMARY KEY,
        business_id    CHAR(36)      NOT NULL,
        amount         DECIMAL(10,2) NOT NULL,
        description    VARCHAR(500)  NOT NULL,
        payment_type   ENUM('subscription','addon','manual') NOT NULL DEFAULT 'manual',
        billing_period VARCHAR(10)   NULL COMMENT 'YYYY-MM',
        status         ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'paid',
        notes          TEXT          NULL,
        recorded_by    CHAR(36)      NULL,
        created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bpay_biz (business_id),
        CONSTRAINT fk_bpay_biz FOREIGN KEY (business_id)
          REFERENCES businesses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) {
    if (!e.message.includes('already exists')) console.error('[businesses] payments migration:', e.message);
  }
})();

const FEATURE_DEFS = [
  { key: 'feature_weighing_slips', label: 'Δελτία Ζύγισης', price: 2,  icon: 'fa-scale-balanced',    color: 'teal',   desc: 'Καταγραφή και παρακολούθηση ζυγίσεων αλιευμάτων' },
  { key: 'feature_ospa',           label: 'OSPA',           price: 10, icon: 'fa-file-circle-check', color: 'indigo', desc: 'Υποβολές στον Οργανισμό Συλλογικής Προστασίας Αλιέων' },
];

async function upsertBusinessSettings(businessId, fields) {
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

// GET /api/businesses/:id/features
router.get('/:id/features', requireSuperAdmin, async (req, res, next) => {
  try {
    const [[settings]] = await pool.execute(
      'SELECT feature_weighing_slips, feature_ospa FROM business_settings WHERE business_id = ? LIMIT 1',
      [req.params.id]
    );
    const data = FEATURE_DEFS.map(f => ({
      ...f,
      enabled: settings ? !!settings[f.key] : false,
    }));
    res.json({ data });
  } catch (err) { next(err); }
});

// PATCH /api/businesses/:id/features
router.patch('/:id/features', requireSuperAdmin, async (req, res, next) => {
  try {
    const { feature, enabled } = req.body;
    const def = FEATURE_DEFS.find(f => f.key === feature);
    if (!def) return res.status(400).json({ error: 'Άγνωστο feature.' });
    await upsertBusinessSettings(req.params.id, { [feature]: enabled ? 1 : 0 });
    res.json({ data: { feature, enabled: !!enabled } });
  } catch (err) { next(err); }
});

// GET /api/businesses/:id/payments
router.get('/:id/payments', requireSuperAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM business_payments WHERE business_id = ? ORDER BY created_at DESC LIMIT 200',
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /api/businesses/:id/payments
router.post('/:id/payments', requireSuperAdmin, async (req, res, next) => {
  try {
    const { amount, description, payment_type, billing_period, status, notes } = req.body;
    if (!amount || !description) return res.status(400).json({ error: 'amount και description απαιτούνται.' });
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO business_payments
         (id, business_id, amount, description, payment_type, billing_period, status, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, parseFloat(amount), description,
       payment_type || 'manual', billing_period || null,
       status || 'paid', notes || null, req.user.id || null]
    );
    const [[row]] = await pool.execute('SELECT * FROM business_payments WHERE id = ? LIMIT 1', [id]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /api/businesses/:id/payments/:paymentId
router.delete('/:id/payments/:paymentId', requireSuperAdmin, async (req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      'SELECT id FROM business_payments WHERE id = ? AND business_id = ? LIMIT 1',
      [req.params.paymentId, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Πληρωμή δεν βρέθηκε.' });
    await pool.execute('DELETE FROM business_payments WHERE id = ?', [row.id]);
    res.json({ data: { message: 'Διαγράφηκε.' } });
  } catch (err) { next(err); }
});

module.exports = router;
