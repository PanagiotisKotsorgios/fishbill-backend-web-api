const express = require('express');
const router = express.Router();
const Joi = require('joi');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../middleware/audit');
const invoiceService = require('../services/invoice.service');
const { calculateTotals } = require('../utils/calculateTotals');
const emailSvc = require('../services/email.service');
const pushNotif = require('../jobs/pushNotifications');

// ── Helper: fetch business settings for email sending ────────────────────────
async function getBusinessSettings(bizId) {
  const [sets] = await pool.execute('SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [bizId]);
  return sets[0] || {};
}

// ── Helper: get admin email (owner of business) ───────────────────────────────
async function getAdminEmail(bizId) {
  const [rows] = await pool.execute(
    `SELECT email FROM users WHERE business_id = ? AND role IN ('owner','admin','super_admin') ORDER BY FIELD(role,'super_admin','owner','admin') DESC LIMIT 1`,
    [bizId]
  );
  return rows[0]?.email || null;
}

// ── Helper: fire invoice notification (fire-and-forget) ─────────────────────
function fireNotif(bizId, flag, fn, extraArgs) {
  (async () => {
    try {
      const [bsRows] = await pool.execute(
        'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [bizId]
      );
      const bs = bsRows[0] || {};
      if (!bs[flag]) return; // notification disabled for this business

      const [uRows] = await pool.execute(
        `SELECT u.email, u.full_name, b.name AS biz_name
         FROM users u JOIN businesses b ON b.id = u.business_id
         WHERE u.business_id = ? AND u.role IN ('owner','admin') AND u.is_active = 1
         ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1`,
        [bizId]
      );
      if (!uRows.length) return;
      const { email, full_name, biz_name } = uRows[0];

      await fn({ to: email, toName: full_name, bizName: biz_name, ...extraArgs });
    } catch (e) {
      console.error('[fireNotif] invoice notification error:', e.message);
    }
  })();
}

// ── Self-migration: extra invoice credits + Wrapp columns ────────────────────
(async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await pool.execute(`ALTER TABLE businesses ADD COLUMN extra_invoice_credits INT NOT NULL DEFAULT 0`);
      console.log('[invoices] extra_invoice_credits column added');
      break;
    } catch (e) {
      if (e.errno === 1060) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      else console.warn('[invoices] extra_invoice_credits migration failed:', e.message);
    }
  }
  // Wrapp columns on invoices
  for (const col of [
    `ALTER TABLE invoices ADD COLUMN wrapp_invoice_id VARCHAR(255) NULL`,
    `ALTER TABLE invoices ADD COLUMN wrapp_qr_url TEXT NULL`,
  ]) {
    await pool.execute(col).catch(e => { if (e.errno !== 1060) console.warn('[invoices] migration:', e.message); });
  }
})();

router.use(authenticate);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const lineSchema = Joi.object({
  product_id: Joi.number().integer().optional().allow(null),
  description: Joi.string().max(500).required(),
  unit: Joi.string().max(20).optional().default('kg'),
  quantity: Joi.number().min(0).precision(4).required(),
  unit_price: Joi.number().min(0).precision(4).required(),
  discount_pct: Joi.number().min(0).max(100).precision(2).optional().default(0),
  vat_rate: Joi.number().valid(0, 6, 9, 13, 24).optional().default(13),
});

const createInvoiceSchema = Joi.object({
  // super_admin may specify which business to create for
  business_id: Joi.number().integer().optional().allow(null),
  customer_id: Joi.string().optional().allow(null, ''),
  // Mobile app may send customer_name instead of customer_id
  customer_name: Joi.string().max(255).optional().allow('', null),
  customer_afm: Joi.string().max(20).optional().allow('', null),
  invoice_date: Joi.string().isoDate().optional(),
  due_date: Joi.string().isoDate().optional().allow(null),
  series: Joi.string().max(10).optional().default('A'),
  invoice_type: Joi.string().max(10).optional().allow('', null).default('1.1'),
  payment_method: Joi.string()
    .valid('cash', 'bank_transfer', 'credit_card', 'check', 'other', 'card', 'iris')
    .optional()
    .default('bank_transfer'),
  status: Joi.string().valid('draft', 'issued').optional().default('draft'),
  notes: Joi.string().max(1000).optional().allow('', null),
  lines: Joi.array().items(lineSchema).min(1).required(),
}).or('customer_id', 'customer_name');

// Normalize mobile app request format before Joi validation
function normalizeMobileInvoiceBody(req, res, next) {
  const body = req.body;
  // Map items → lines (mobile sends 'items')
  if (Array.isArray(body.items) && !body.lines) {
    body.lines = body.items;
    delete body.items;
  }
  // Map 'card' → 'credit_card'
  if (body.payment_method === 'card') {
    body.payment_method = 'credit_card';
  }
  next();
}

const updateInvoiceSchema = Joi.object({
  customer_id: Joi.string().optional().allow(null, ''),
  customer_name: Joi.string().max(255).optional().allow('', null),
  customer_afm: Joi.string().max(20).optional().allow('', null),
  invoice_date: Joi.string().isoDate().optional(),
  due_date: Joi.string().isoDate().optional().allow(null),
  invoice_type: Joi.string().max(10).optional().allow('', null),
  payment_method: Joi.string()
    .valid('cash', 'bank_transfer', 'credit_card', 'check', 'other', 'card', 'iris')
    .optional(),
  notes: Joi.string().max(1000).optional().allow('', null),
  lines: Joi.array().items(lineSchema).min(1).optional(),
});

// ---------------------------------------------------------------------------
// Utility: build filter WHERE clause for invoice list
// ---------------------------------------------------------------------------
function buildInvoiceFilters(query, businessId, isSuperAdmin) {
  const conditions = [];
  const params = [];

  if (!isSuperAdmin) {
    conditions.push('i.business_id = ?');
    params.push(businessId);
  } else if (query.business_id) {
    conditions.push('i.business_id = ?');
    params.push(query.business_id);
  }

  if (query.status) {
    conditions.push('i.status = ?');
    params.push(query.status);
  }

  if (query.customer_id) {
    conditions.push('i.customer_id = ?');
    params.push(query.customer_id);
  }

  if (query.from) {
    conditions.push('i.issue_date >= ?');
    params.push(query.from);
  }

  if (query.to) {
    conditions.push('i.issue_date <= ?');
    params.push(query.to);
  }

  if (query.q) {
    conditions.push('(i.full_number LIKE ? OR c.name LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

// ---------------------------------------------------------------------------
// GET /api/invoices/stats  — before /:id
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const bizCondition = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    const [todayCount] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCondition} AND DATE(issue_date) = ?`,
      [...bizParams, today]
    );

    const [weekCount] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCondition} AND issue_date >= ?`,
      [...bizParams, weekAgo]
    );

    const [failedCount] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCondition} AND status = 'failed'`,
      bizParams
    );

    const [monthRevenue] = await pool.execute(
      `SELECT COALESCE(SUM(total_value), 0) AS revenue FROM invoices
       WHERE ${bizCondition} AND issue_date >= ? AND status != 'cancelled'`,
      [...bizParams, monthStart]
    );

    const [totalCount] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCondition}`,
      bizParams
    );

    const [transmittedCount] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCondition} AND status = 'transmitted'`,
      bizParams
    );

    res.json({
      data: {
        todayCount: todayCount[0].cnt,
        weekCount: weekCount[0].cnt,
        failedCount: failedCount[0].cnt,
        totalCount: totalCount[0].cnt,
        transmittedCount: transmittedCount[0].cnt,
        revenueThisMonth: monthRevenue[0].revenue,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/invoices
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { whereClause, params } = buildInvoiceFilters(
      req.query,
      req.user.business_id,
      req.user.role === 'super_admin'
    );

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       ${whereClause}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT i.*,
              c.name AS customer_name, c.afm AS customer_afm
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       ${whereClause}
       ORDER BY i.issue_date DESC, i.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // Attach lines to each invoice
    for (const inv of rows) {
      const [lines] = await pool.execute(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number ASC',
        [inv.id]
      );
      inv.lines = lines;
    }

    // Compute limit status so the app can block the create button proactively
    const INV_PLAN_LIMITS = { basic: 15, pro: 30, enterprise: -1, trial: -1 };
    let atLimit = false;
    let usedThisMonth = 0;
    let monthlyLimit = -1;
    let extraCredits = 0;
    if (req.user.role !== 'super_admin' && req.user.business_id) {
      try {
        const [[biz]] = await pool.execute(
          `SELECT plan, COALESCE(extra_invoice_credits, 0) AS extra_invoice_credits,
                  DATE_FORMAT(billing_cycle_started_at, '%Y-%m-%d') AS billing_cycle_started_at
           FROM businesses WHERE id = ? LIMIT 1`,
          [req.user.business_id]
        );
        if (biz) {
          monthlyLimit = INV_PLAN_LIMITS[biz.plan] ?? -1;
          extraCredits = biz.extra_invoice_credits;
          if (monthlyLimit !== -1) {
            const now        = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
            // Use billing_cycle_started_at if set and after month start (plan renewal mid-month resets counter)
            const countFrom  = biz.billing_cycle_started_at && biz.billing_cycle_started_at > monthStart
              ? biz.billing_cycle_started_at
              : monthStart;
            const [[{ cnt }]] = await pool.execute(
              `SELECT COUNT(*) AS cnt FROM invoices
               WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
              [req.user.business_id, countFrom]
            );
            usedThisMonth = cnt;
            atLimit = cnt >= (monthlyLimit + extraCredits);
          }
        }
      } catch (_) {}
    }

    res.json({
      data: rows,
      total: countRows[0].total,
      page,
      limit,
      at_limit: atLimit,
      used_this_month: usedThisMonth,
      monthly_limit: monthlyLimit,
      extra_credits: extraCredits,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/invoices
// ---------------------------------------------------------------------------
router.post(
  '/',
  normalizeMobileInvoiceBody,
  validate(createInvoiceSchema),
  logAudit('CREATE_INVOICE', 'invoice'),
  async (req, res, next) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // super_admin may pass business_id in body to create for a specific business
      const businessId = (req.user.role === 'super_admin' && req.body.business_id)
        ? req.body.business_id
        : req.user.business_id;

      if (!businessId) {
        await conn.rollback();
        return res.status(400).json({ error: 'Απαιτείται business_id για super_admin.' });
      }

      let {
        customer_id, customer_name, customer_afm,
        invoice_date, due_date, series, invoice_type,
        payment_method, status, notes, lines,
      } = req.body;

      // Normalize payment method alias
      if (payment_method === 'card') payment_method = 'credit_card';

      // Check monthly invoice limit based on subscription plan (super_admin bypasses)
      const PLAN_LIMITS = { basic: 15, pro: 30, enterprise: -1, trial: -1 };
      const [[bizRow]] = await conn.execute(
        `SELECT plan, trial_ends_at, subscription_active, subscription_ends_at,
                COALESCE(extra_invoice_credits, 0) AS extra_invoice_credits,
                DATE_FORMAT(billing_cycle_started_at, '%Y-%m-%d') AS billing_cycle_started_at
         FROM businesses WHERE id = ? LIMIT 1`,
        [businessId]
      );
      if (bizRow && req.user.role !== 'super_admin') {
        const now = new Date();
        const trialActive  = bizRow.trial_ends_at && new Date(bizRow.trial_ends_at) > now;
        const subActive    = bizRow.subscription_active === 1;
        const graceUntil   = bizRow.subscription_ends_at
          ? new Date(new Date(bizRow.subscription_ends_at).getTime() + 78 * 24 * 60 * 60 * 1000)
          : null;
        const inGracePeriod = graceUntil && graceUntil > now;
        if (!trialActive && !subActive && !inGracePeriod) {
          await conn.rollback();
          return res.status(403).json({ error: 'Η συνδρομή σας έχει λήξει. Επιλέξτε πλάνο για να συνεχίσετε.' });
        }
        const monthlyLimit  = PLAN_LIMITS[bizRow.plan] ?? -1;
        const extraCredits  = bizRow.extra_invoice_credits ?? 0;
        if (monthlyLimit !== -1) {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
            .toISOString().slice(0, 10);
          const countFrom  = bizRow.billing_cycle_started_at && bizRow.billing_cycle_started_at > monthStart
            ? bizRow.billing_cycle_started_at
            : monthStart;
          const [[countRow]] = await conn.execute(
            `SELECT COUNT(*) AS cnt FROM invoices
             WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
            [businessId, countFrom]
          );
          const effectiveLimit = monthlyLimit + extraCredits;
          if (countRow.cnt >= effectiveLimit) {
            await conn.rollback();
            return res.status(403).json({
              error: `Έχετε φτάσει το μηνιαίο όριο των ${monthlyLimit} τιμολογίων για το πλάνο σας.`,
              error_code: 'INVOICE_LIMIT_REACHED',
              monthly_limit: monthlyLimit,
              extra_credits: extraCredits,
              used: countRow.cnt,
            });
          }
          // Consume one extra credit if past the base monthly limit
          if (countRow.cnt >= monthlyLimit && extraCredits > 0) {
            try {
              await conn.execute(
                'UPDATE businesses SET extra_invoice_credits = extra_invoice_credits - 1 WHERE id = ?',
                [businessId]
              );
            } catch (_) {}
          }
        }
      }

      // If customer_id not provided, find-or-create by name (mobile app flow)
      if (!customer_id && customer_name) {
        const [existing] = await conn.execute(
          'SELECT id FROM customers WHERE business_id = ? AND name = ? LIMIT 1',
          [businessId, customer_name.trim()]
        );
        if (existing.length) {
          customer_id = existing[0].id;
        } else {
          await conn.execute(
            'INSERT INTO customers (business_id, name, afm, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
            [businessId, customer_name.trim(), customer_afm || null]
          );
          const [[newCust]] = await conn.execute(
            'SELECT id FROM customers WHERE business_id = ? AND name = ? ORDER BY id DESC LIMIT 1',
            [businessId, customer_name.trim()]
          );
          customer_id = newCust.id;
        }
      }

      // Verify customer belongs to this business
      const [custCheck] = await conn.execute(
        'SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
        [customer_id, businessId]
      );
      if (!custCheck.length) {
        await conn.rollback();
        return res.status(400).json({ error: 'Ο πελάτης δεν βρέθηκε ή δεν ανήκει στην επιχείρησή σας.' });
      }

      // Get next invoice number
      const { number, fullNumber } = await invoiceService.getNextNumber(businessId, series || 'A');

      // Calculate totals
      const { lines: calculatedLines, netValue, vatAmount, totalValue, discountAmount } =
        calculateTotals(lines);

      const invoiceStatus = status || 'draft';

      // Insert invoice
      await conn.execute(
        `INSERT INTO invoices
           (business_id, customer_id, created_by, full_number, number, series, invoice_type,
            issue_date, due_date, payment_method, status,
            net_value, vat_amount, total_value, discount_amount,
            notes, retry_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [
          businessId, customer_id, req.user.id, fullNumber, number, series || 'A',
          invoice_type || '1.1',
          invoice_date || new Date().toISOString().slice(0, 10),
          due_date || null, payment_method || 'bank_transfer',
          invoiceStatus, netValue, vatAmount, totalValue, discountAmount,
          notes || null,
        ]
      );
      // UUID tables: insertId returns 0, query back by unique key
      const [[newInvRow]] = await conn.execute(
        'SELECT id FROM invoices WHERE business_id = ? AND series = ? AND number = ? LIMIT 1',
        [businessId, series || 'A', number]
      );
      const invoiceId = newInvRow.id;

      // Insert lines
      for (let i = 0; i < calculatedLines.length; i++) {
        const line = calculatedLines[i];
        await conn.execute(
          `INSERT INTO invoice_lines
             (invoice_id, line_number, product_id, description, unit, quantity, unit_price,
              discount_pct, vat_rate, discount_amt, net_value, vat_amount, total_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId, i + 1, line.product_id || null, line.description,
            line.unit || 'kg', line.quantity, line.unit_price,
            line.discount_pct || 0, line.vat_rate || 13,
            line.discount_amount, line.net_value,
            line.vat_amount, line.total_value,
          ]
        );
      }

      await conn.commit();

      // Fetch complete invoice with customer and lines
      const [invoice] = await pool.execute(
        `SELECT i.*,
                c.name AS customer_name, c.afm AS customer_afm, c.address AS customer_address,
                c.city AS customer_city, c.phone AS customer_phone, c.email AS customer_email,
                b.name AS business_name, b.afm AS business_afm, b.address AS business_address,
                b.city AS business_city, b.phone AS business_phone, b.email AS business_email
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN businesses b ON b.id = i.business_id
         WHERE i.id = ?`,
        [invoiceId]
      );
      const [invLines] = await pool.execute(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
        [invoiceId]
      );
      invoice[0].lines = invLines;

      res.status(201).json({ data: invoice[0] });

      // Fire-and-forget: notify owner if enabled (email + push)
      fireNotif(businessId, 'notif_invoice_created', emailSvc.sendInvoiceCreatedNotif, { invoice: invoice[0] });
      pushNotif.sendPushToAllUsers(pool, businessId,
        'Νέο Παραστατικό Δημιουργήθηκε',
        `Το παραστατικό ${invoice[0].full_number || invoice[0].id} δημιουργήθηκε.`,
        { screen: 'invoices', invoice_id: invoice[0].id }
      ).catch(() => {});

      // Notify admin to process manually in Epsilon Smart
      ;(async () => {
        try {
          const [[provRow]] = await pool.execute(
            "SELECT setting_value FROM platform_settings WHERE setting_key = 'provider_name' LIMIT 1"
          );
          if (provRow?.setting_value === 'manual_epsilonsmart') {
            const [[biz]] = await pool.execute(
              'SELECT name, afm FROM businesses WHERE id = ? LIMIT 1', [businessId]
            );
            const customerName = invoice[0].customer_name ||
              (invoice[0].customer_id
                ? (await pool.execute('SELECT name FROM customers WHERE id = ? LIMIT 1', [invoice[0].customer_id]))[0][0]?.name
                : null);
            await emailSvc.sendAdminInvoiceReadyEmail({
              invoice:      invoice[0],
              businessName: biz?.name || businessId,
              businessAfm:  biz?.afm  || '',
              customerName: customerName || '—',
            });
          }
        } catch (_) { /* non-fatal */ }
      })();

      // Notify assigned employees with edit_invoices privilege
      ;(async () => {
        try {
          const [employees] = await pool.execute(
            `SELECT u.email, u.full_name
             FROM employee_businesses eb
             JOIN users u ON u.id = eb.employee_id AND u.is_active = 1
             JOIN employee_privileges ep ON ep.user_id = u.id
             WHERE eb.business_id = ?
               AND ep.privileges LIKE '%"edit_invoices"%'`,
            [businessId]
          );
          if (!employees.length) return;
          const [[biz]] = await pool.execute('SELECT name, afm FROM businesses WHERE id = ? LIMIT 1', [businessId]).catch(() => [[null]]);
          const bizName = biz?.name || businessId;
          const cfg = await emailSvc.loadConfig();
          const fromName = cfg.platform_name || 'FishBill';
          const now = new Date().toLocaleString('el-GR', { timeZone: 'Europe/Athens' });
          for (const emp of employees) {
            await emailSvc.sendEmail({
              to:      emp.email,
              toName:  emp.full_name,
              subject: `📄 Νέο Παραστατικό — ${bizName}`,
              html: `
                <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;background:#f9fafb;padding:24px 16px">
                  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
                    <div style="background:linear-gradient(135deg,#0A5568,#0B7285);padding:20px 28px">
                      <div style="font-size:20px;font-weight:800;color:#fff">🐟 FishBill</div>
                      <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:2px">${fromName}</div>
                    </div>
                    <div style="padding:28px">
                      <h2 style="color:#0A5568;margin:0 0 12px;font-size:18px">📄 Νέο Παραστατικό</h2>
                      <p style="color:#374151;font-size:14px;margin:0 0 16px">Γεια ${emp.full_name},</p>
                      <p style="color:#374151;font-size:14px;margin:0 0 16px">
                        Η επιχείρηση <strong>${bizName}</strong> δημιούργησε νέο παραστατικό που χρήζει επεξεργασίας.
                      </p>
                      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
                        <tr style="background:#f0f9fc"><td style="padding:8px 14px;color:#666;font-weight:600;border:1px solid #d5edf2;width:130px">Αρ. Παραστατικού</td>
                          <td style="padding:8px 14px;border:1px solid #d5edf2;font-weight:700">${invoice[0].full_number || invoice[0].id}</td></tr>
                        <tr><td style="padding:8px 14px;color:#666;font-weight:600;border:1px solid #d5edf2">Επιχείρηση</td>
                          <td style="padding:8px 14px;border:1px solid #d5edf2">${bizName} (ΑΦΜ: ${biz?.afm || '—'})</td></tr>
                        <tr style="background:#f0f9fc"><td style="padding:8px 14px;color:#666;font-weight:600;border:1px solid #d5edf2">Ώρα</td>
                          <td style="padding:8px 14px;border:1px solid #d5edf2">${now}</td></tr>
                      </table>
                      <p style="color:#6b7280;font-size:13px;margin:0">Συνδεθείτε στο admin panel για επεξεργασία.</p>
                    </div>
                    <div style="background:#f5fbfc;padding:14px 28px;text-align:center;border-top:1px solid #d5edf2">
                      <p style="margin:0;font-size:12px;color:#8aacb4">&copy; 2026 FishBill</p>
                    </div>
                  </div>
                </div>`,
              _type: 'employee_invoice_notif',
            }).catch(() => {});
          }
        } catch (_) { /* non-fatal */ }
      })();
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/invoices/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const bizCondition = isSuperAdmin ? '1=1' : 'i.business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const [rows] = await pool.execute(
      `SELECT i.*,
              c.name AS customer_name, c.afm AS customer_afm,
              c.address AS customer_address, c.city AS customer_city,
              c.postal_code AS customer_postal, c.phone AS customer_phone,
              c.email AS customer_email,
              b.name AS business_name, b.afm AS business_afm, b.doy AS business_doy,
              b.address AS business_address, b.city AS business_city,
              b.postal_code AS business_postal, b.phone AS business_phone,
              b.email AS business_email
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN businesses b ON b.id = i.business_id
       WHERE i.id = ? AND ${bizCondition}
       LIMIT 1`,
      [id, ...bizParams]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });
    }

    const [lines] = await pool.execute(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
      [id]
    );
    rows[0].lines = lines;

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/invoices/:id  — only draft invoices
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  normalizeMobileInvoiceBody,
  validate(updateInvoiceSchema),
  logAudit('UPDATE_INVOICE', 'invoice'),
  async (req, res, next) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const { id } = req.params;
      const businessId = req.user.business_id;

      const [existing] = await conn.execute(
        'SELECT * FROM invoices WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!existing.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });
      }

      if (existing[0].status !== 'draft') {
        await conn.rollback();
        return res.status(400).json({ error: 'Μόνο παραστατικά «Προς Διαβίβαση» μπορούν να επεξεργαστούν.' });
      }

      let { customer_id, customer_name, customer_afm, invoice_date, due_date, invoice_type, payment_method, notes, lines } = req.body;

      // Find-or-create customer by name when customer_name is provided (mobile flow)
      if (!customer_id && customer_name && customer_name.trim()) {
        const [existing_cust] = await conn.execute(
          'SELECT id FROM customers WHERE business_id = ? AND name = ? LIMIT 1',
          [businessId, customer_name.trim()]
        );
        if (existing_cust.length) {
          customer_id = existing_cust[0].id;
          // Update afm if provided and different
          if (customer_afm) {
            await conn.execute(
              'UPDATE customers SET afm = ?, updated_at = NOW() WHERE id = ?',
              [customer_afm.trim(), customer_id]
            );
          }
        } else {
          await conn.execute(
            'INSERT INTO customers (business_id, name, afm, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
            [businessId, customer_name.trim(), customer_afm || null]
          );
          const [[newCust]] = await conn.execute(
            'SELECT id FROM customers WHERE business_id = ? AND name = ? ORDER BY id DESC LIMIT 1',
            [businessId, customer_name.trim()]
          );
          customer_id = newCust.id;
        }
      }

      const setClauses = ['updated_at = NOW()'];
      const params = [];

      if (customer_id !== undefined) { setClauses.push('customer_id = ?'); params.push(customer_id); }
      if (invoice_date !== undefined) { setClauses.push('issue_date = ?'); params.push(invoice_date); }
      if (due_date !== undefined) { setClauses.push('due_date = ?'); params.push(due_date); }
      if (invoice_type !== undefined) { setClauses.push('invoice_type = ?'); params.push(invoice_type); }
      if (payment_method !== undefined) { setClauses.push('payment_method = ?'); params.push(payment_method); }
      if (notes !== undefined) { setClauses.push('notes = ?'); params.push(notes); }

      if (lines && lines.length) {
        const { lines: calculatedLines, netValue, vatAmount, totalValue, discountAmount } =
          calculateTotals(lines);

        setClauses.push('net_value = ?', 'vat_amount = ?', 'total_value = ?', 'discount_amount = ?');
        params.push(netValue, vatAmount, totalValue, discountAmount);

        // Replace lines
        await conn.execute('DELETE FROM invoice_lines WHERE invoice_id = ?', [id]);
        for (let i = 0; i < calculatedLines.length; i++) {
          const line = calculatedLines[i];
          await conn.execute(
            `INSERT INTO invoice_lines
               (invoice_id, line_number, product_id, description, unit, quantity, unit_price,
                discount_pct, vat_rate, discount_amt, net_value, vat_amount, total_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id, i + 1, line.product_id || null, line.description, line.unit || 'kg',
              line.quantity, line.unit_price, line.discount_pct || 0, line.vat_rate || 13,
              line.discount_amount, line.net_value, line.vat_amount, line.total_value,
            ]
          );
        }
      }

      params.push(id);
      await conn.execute(`UPDATE invoices SET ${setClauses.join(', ')} WHERE id = ?`, params);
      await conn.commit();

      const [updated] = await pool.execute(
        `SELECT i.*, c.name AS customer_name FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
        [id]
      );
      const [updatedLines] = await pool.execute(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
        [id]
      );
      updated[0].lines = updatedLines;

      res.json({ data: updated[0] });
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/issue
// ---------------------------------------------------------------------------
router.post(
  '/:id/issue',
  logAudit('ISSUE_INVOICE', 'invoice'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = req.user.business_id;

      const [rows] = await pool.execute(
        'SELECT * FROM invoices WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });

      if (rows[0].status !== 'draft') {
        return res.status(400).json({ error: 'Μόνο παραστατικά «Προς Διαβίβαση» μπορούν να εκδοθούν.' });
      }

      await pool.execute(
        `UPDATE invoices SET status = 'issued', updated_at = NOW() WHERE id = ?`,
        [id]
      );

      res.json({ data: { message: 'Invoice issued successfully.', status: 'issued' } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/transmit
// ---------------------------------------------------------------------------
router.post(
  '/:id/transmit',
  logAudit('TRANSMIT_INVOICE', 'invoice'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = req.user.business_id;

      const [rows] = await pool.execute(
        'SELECT * FROM invoices WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });

      const result = await invoiceService.transmit(rows[0]);

      res.json({ data: { message: result.message, success: result.success } });

      // Fire-and-forget: notify owner of transmission result (email + push)
      if (result.success) {
        // Re-fetch to get updated MARK
        const [[updatedInv]] = await pool.execute('SELECT * FROM invoices WHERE id = ? LIMIT 1', [id]);
        fireNotif(rows[0].business_id, 'notif_invoice_transmitted', emailSvc.sendInvoiceTransmittedNotif, { invoice: updatedInv || rows[0] });
        pushNotif.sendPushToAllUsers(pool, rows[0].business_id,
          'Επιτυχής Αποστολή στο myDATA ✓',
          `Παραστατικό ${rows[0].full_number || rows[0].id} διαβιβάστηκε επιτυχώς.`,
          { screen: 'invoices', invoice_id: id }
        ).catch(() => {});
      } else {
        fireNotif(rows[0].business_id, 'notif_invoice_failed', emailSvc.sendInvoiceFailedNotif, { invoice: rows[0], errorMsg: result.message });
        pushNotif.sendPushToAllUsers(pool, rows[0].business_id,
          'Αποτυχία Αποστολής ⚠️',
          `Παραστατικό ${rows[0].full_number || rows[0].id}: ${result.message}`,
          { screen: 'invoices', invoice_id: id }
        ).catch(() => {});
      }
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/request-cancel
// Generates a 6-digit OTP and emails it to the admin for confirmation.
// ---------------------------------------------------------------------------
router.post(
  '/:id/request-cancel',
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = req.user.business_id
        || (req.user.role === 'super_admin' ? req.query.business_id : null);

      const [rows] = await pool.execute(
        `SELECT i.*, b.name AS business_name
         FROM invoices i
         JOIN businesses b ON b.id = i.business_id
         WHERE i.id = ? ${req.user.role === 'super_admin' ? '' : 'AND i.business_id = ?'}
         LIMIT 1`,
        req.user.role === 'super_admin' ? [id] : [id, businessId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Παραστατικό δεν βρέθηκε.' });

      const inv = rows[0];
      if (inv.status === 'cancelled') {
        return res.status(400).json({ error: 'Το παραστατικό είναι ήδη ακυρωμένο.' });
      }

      // Generate 6-digit OTP valid for 15 minutes
      const otp = String(Math.floor(100000 + crypto.randomInt(900000)));
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const otpKey = `cancel_otp_${id}`;

      await pool.execute(
        `INSERT INTO platform_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
        [
          otpKey,
          JSON.stringify({ otp, expires: expiresAt, requested_by: req.user.id }),
          JSON.stringify({ otp, expires: expiresAt, requested_by: req.user.id }),
        ]
      );

      // Get admin email for OTP delivery via Brevo/platform email
      const adminEmail = await getAdminEmail(inv.business_id);

      let emailSent = false;
      let emailError = null;

      if (adminEmail) {
        try {
          const invoiceNumber = inv.full_number || inv.number || inv.id;
          const html = `
            <div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:32px;background:#f9fafb;border-radius:16px">
              <h2 style="color:#DC2626;margin-bottom:8px">⚠️ Ακύρωση Παραστατικού</h2>
              <p style="color:#374151">Ζητήθηκε <strong>ακύρωση</strong> του παραστατικού:</p>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:16px 0">
                <p style="margin:4px 0"><strong>Αριθμός:</strong> ${invoiceNumber}</p>
                <p style="margin:4px 0"><strong>Επιχείρηση:</strong> ${inv.business_name || ''}</p>
                <p style="margin:4px 0"><strong>Ποσό:</strong> ${parseFloat(inv.total_value || 0).toFixed(2)} €</p>
              </div>
              <p style="color:#374151">Χρησιμοποιήστε τον παρακάτω κωδικό για να επιβεβαιώσετε την ακύρωση στην εφαρμογή:</p>
              <div style="text-align:center;margin:24px 0">
                <div style="display:inline-block;background:#1e293b;color:#f8fafc;font-size:36px;font-weight:800;letter-spacing:10px;padding:18px 32px;border-radius:12px;font-family:monospace">
                  ${otp}
                </div>
              </div>
              <p style="color:#9ca3af;font-size:12px;text-align:center">Ο κωδικός ισχύει για <strong>15 λεπτά</strong>. Αν ΔΕΝ εσύ έκανες αυτήν την ενέργεια, αγνόησε αυτό το email.</p>
            </div>`;

          await emailSvc.sendEmail({
            to: adminEmail,
            subject: `[FishBill] Κωδικός Ακύρωσης Παραστατικού ${invoiceNumber}`,
            html,
          });
          emailSent = true;
        } catch (e) {
          emailError = e.message;
          console.error('[CANCEL OTP] Email error:', e.message);
        }
      }

      res.json({
        data: {
          message: emailSent
            ? `Κωδικός επιβεβαίωσης εστάλη στο ${adminEmail}. Ισχύει 15 λεπτά.`
            : `Email δεν εστάλη (${emailError || 'email provider not configured'}). Χρησιμοποιήστε τον κωδικό απευθείας.`,
          email_sent: emailSent,
          admin_email: adminEmail,
          // Only expose OTP in response when email could not be sent
          otp: emailSent ? undefined : otp,
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/cancel  — now requires OTP from email
// ---------------------------------------------------------------------------
router.post(
  '/:id/cancel',
  logAudit('CANCEL_INVOICE', 'invoice'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { otp } = req.body;
      const businessId = req.user.business_id;

      if (!otp) return res.status(400).json({ error: 'Απαιτείται κωδικός επιβεβαίωσης OTP.' });

      // Verify OTP
      const otpKey = `cancel_otp_${id}`;
      const [otpRows] = await pool.execute(
        'SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1',
        [otpKey]
      );
      if (!otpRows.length) {
        return res.status(400).json({ error: 'Δεν βρέθηκε ενεργός κωδικός. Ξεκινήστε ξανά τη διαδικασία ακύρωσης.' });
      }

      let stored;
      try { stored = JSON.parse(otpRows[0].setting_value); }
      catch { return res.status(400).json({ error: 'Άκυρος κωδικός.' }); }

      if (new Date() > new Date(stored.expires)) {
        await pool.execute('DELETE FROM platform_settings WHERE setting_key = ?', [otpKey]);
        return res.status(400).json({ error: 'Ο κωδικός έχει λήξει. Ξεκινήστε ξανά τη διαδικασία.' });
      }

      if (stored.otp !== String(otp).trim()) {
        return res.status(400).json({ error: 'Λανθασμένος κωδικός επιβεβαίωσης.' });
      }

      // OTP valid — fetch invoice
      const [rows] = await pool.execute(
        `SELECT * FROM invoices WHERE id = ? ${req.user.role === 'super_admin' ? '' : 'AND business_id = ?'} LIMIT 1`,
        req.user.role === 'super_admin' ? [id] : [id, businessId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Παραστατικό δεν βρέθηκε.' });
      if (rows[0].status === 'cancelled') {
        return res.status(400).json({ error: 'Το παραστατικό είναι ήδη ακυρωμένο.' });
      }

      const invoice = rows[0];

      // Soft-delete: mark as cancelled
      await pool.execute(
        `UPDATE invoices SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [id]
      );

      // Create ακυρωτικό record in cancelled_invoices table
      await pool.execute(
        `INSERT INTO cancelled_invoices (invoice_id, business_id, cancelled_by, reason, cancelled_at)
         VALUES (?, ?, ?, 'Ακύρωση από χρήστη μέσω εφαρμογής', NOW())
         ON DUPLICATE KEY UPDATE cancelled_at = NOW()`,
        [id, invoice.business_id, req.user.id]
      ).catch(() => {}); // table may not exist yet — non-fatal

      // Consume OTP so it cannot be reused
      await pool.execute('DELETE FROM platform_settings WHERE setting_key = ?', [otpKey]);

      // Fire-and-forget: notify admin to create ακυρωτικό in Epsilon Smart
      (async () => {
        try {
          const [bizRows] = await pool.execute(
            `SELECT b.name AS biz_name, b.afm FROM businesses b WHERE b.id = ? LIMIT 1`,
            [invoice.business_id]
          );
          const biz = bizRows[0] || {};
          const adminEmail = await getAdminEmail(invoice.business_id);
          await emailSvc.sendInvoiceCancelledAdminEmail({
            invoice,
            businessName: biz.biz_name || '',
            businessAfm:  biz.afm || '',
            adminEmail,
          });
        } catch (e) {
          console.error('[cancel invoice] admin email error:', e.message);
        }
      })();

      res.json({ data: { message: 'Παραστατικό ακυρώθηκε επιτυχώς.', status: 'cancelled' } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/retry
// ---------------------------------------------------------------------------
router.post(
  '/:id/retry',
  logAudit('RETRY_INVOICE', 'invoice'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = req.user.business_id;

      const [rows] = await pool.execute(
        'SELECT * FROM invoices WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });

      // Reset retry state before transmitting
      await pool.execute(
        `UPDATE invoices SET retry_count = 0, last_error = NULL, updated_at = NOW() WHERE id = ?`,
        [id]
      );

      const result = await invoiceService.transmit(rows[0]);

      res.json({ data: { message: result.message, success: result.success } });

      // Fire-and-forget: notify owner of retry result
      if (result.success) {
        const [[updatedInv]] = await pool.execute('SELECT * FROM invoices WHERE id = ? LIMIT 1', [id]);
        fireNotif(rows[0].business_id, 'notif_invoice_transmitted', emailSvc.sendInvoiceTransmittedNotif, { invoice: updatedInv || rows[0] });
      } else {
        fireNotif(rows[0].business_id, 'notif_invoice_failed', emailSvc.sendInvoiceFailedNotif, { invoice: rows[0], errorMsg: result.message });
      }
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/invoices/:id  — only allowed for draft invoices
// ---------------------------------------------------------------------------
router.delete('/:id', logAudit('DELETE_INVOICE', 'invoice'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = req.user.business_id;
    const [rows] = await pool.execute(
      'SELECT id, status FROM invoices WHERE id = ? AND business_id = ? LIMIT 1',
      [id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });
    if (rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Μόνο πρόχειρα τιμολόγια μπορούν να διαγραφούν.' });
    }
    await pool.execute('DELETE FROM invoice_lines WHERE invoice_id = ?', [id]);
    await pool.execute('DELETE FROM invoices WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/pdf
// ---------------------------------------------------------------------------
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const bizCond = isSuperAdmin ? '1=1' : 'i.business_id = ?';
    const bizPar = isSuperAdmin ? [] : [businessId];

    const [rows] = await pool.execute(
      `SELECT i.*,
              c.name AS customer_name, c.afm AS customer_afm,
              c.address AS customer_address, c.city AS customer_city,
              c.postal_code AS customer_postal, c.phone AS customer_phone,
              c.email AS customer_email,
              b.name AS business_name, b.afm AS business_afm, b.doy AS business_doy,
              b.address AS business_address, b.city AS business_city,
              b.postal_code AS business_postal, b.phone AS business_phone,
              b.email AS business_email
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN businesses b ON b.id = i.business_id
       WHERE i.id = ? AND ${bizCond} LIMIT 1`,
      [id, ...bizPar]
    );

    if (!rows.length) return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });

    const invoice = rows[0];

    // ── Determine provider mode up front ─────────────────────────────────────
    // For Wrapp businesses we want STRICT Wrapp PDFs — bypass any local pdf_path
    // (which may be a stale FishBill-branded PDF left over from before strict
    // mode was deployed) and never fall back to local rendering.
    const [[bizWrapp]] = await pool.execute(
      'SELECT wrapp_enabled FROM businesses WHERE id = ? LIMIT 1', [invoice.business_id]
    );
    const wrappEnabled = bizWrapp?.wrapp_enabled === 1;

    // Only serve an existing local pdf_path when Wrapp is NOT enabled (or the
    // file was manually uploaded by an admin and there is no Wrapp counterpart).
    if (invoice.pdf_path && !wrappEnabled) {
      const uploadedPath = path.join(__dirname, '../../uploads/invoices', `${id}.pdf`);
      if (fs.existsSync(uploadedPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoice.full_number || id}.pdf"`);
        return fs.createReadStream(uploadedPath).pipe(res);
      }
    }

    // Auto-cleanup: for Wrapp businesses we never serve pdf_path. If a stale one
    // is still present in the DB (created before strict mode was deployed), purge
    // it now so the DB row matches reality and the on-disk file stops taking up
    // space. Best-effort — never blocks the request.
    if (invoice.pdf_path && wrappEnabled) {
      pool.execute('UPDATE invoices SET pdf_path = NULL, updated_at = NOW() WHERE id = ?', [id])
        .catch(() => {});
      try {
        const stalePath = path.join(__dirname, '../../uploads/invoices', `${id}.pdf`);
        if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
      } catch (_) {}
    }

    if (invoice.wrapp_pdf_url) {
      return res.redirect(302, invoice.wrapp_pdf_url);
    }

    if (invoice.wrapp_invoice_id) {
      try {
        const wrapp = require('../services/wrapp.service');
        const result = await wrapp.generatePdf(invoice.wrapp_invoice_id, invoice.business_id);
        if (result.download_url) {
          await pool.execute(
            'UPDATE invoices SET wrapp_pdf_url=?, updated_at=NOW() WHERE id=?',
            [result.download_url, id]
          );
          return res.redirect(302, result.download_url);
        }
        return res.status(202).json({
          message: 'Το PDF βρίσκεται σε επεξεργασία. Δοκιμάστε ξανά σε λίγα δευτερόλεπτα.',
          pending: true,
        });
      } catch (wrappErr) {
        console.warn(`[wrapp-pdf] Invoice ${id}: ${wrappErr.message}`);
        if (wrappEnabled) {
          return res.status(502).json({
            error: 'Προσωρινή αδυναμία λήψης PDF από το Wrapp. Δοκιμάστε ξανά σε λίγο.',
          });
        }
        // else: fall through to local rendering for non-Wrapp businesses
      }
    }

    // Wrapp-enabled but no wrapp_invoice_id yet → DN/invoice hasn't been transmitted
    if (wrappEnabled) {
      return res.status(409).json({
        error: 'Το παραστατικό δεν έχει διαβιβαστεί ακόμα στο Wrapp. Διαβιβάστε το πρώτα για να εκδοθεί το επίσημο PDF.',
      });
    }

    const [lines] = await pool.execute(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
      [id]
    );
    invoice.lines = lines;

    const filePath = await invoiceService.generatePDF(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice_${invoice.full_number || id}.pdf"`
    );

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(filePath, () => {});
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/xml
// ---------------------------------------------------------------------------
router.get('/:id/xml', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const bizCond = isSuperAdmin ? '1=1' : 'i.business_id = ?';
    const bizPar = isSuperAdmin ? [] : [businessId];

    const [rows] = await pool.execute(
      `SELECT i.*,
              c.name AS customer_name, c.afm AS customer_afm,
              b.name AS business_name, b.afm AS business_afm
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN businesses b ON b.id = i.business_id
       WHERE i.id = ? AND ${bizCond} LIMIT 1`,
      [id, ...bizPar]
    );

    if (!rows.length) return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });

    const [lines] = await pool.execute(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
      [id]
    );
    const inv = rows[0];

    const linesXml = lines.map((l) => `
    <invoiceLine>
      <lineNumber>${l.line_number}</lineNumber>
      <description>${escapeXml(l.description)}</description>
      <quantity>${l.quantity}</quantity>
      <unit>${l.unit || 'kg'}</unit>
      <unitPrice>${l.unit_price}</unitPrice>
      <discountPct>${l.discount_pct || 0}</discountPct>
      <vatRate>${l.vat_rate}</vatRate>
      <netValue>${l.net_value}</netValue>
      <vatAmount>${l.vat_amount}</vatAmount>
      <totalValue>${l.total_value}</totalValue>
    </invoiceLine>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<invoice xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <issuer>
    <vatNumber>${escapeXml(inv.business_afm || '')}</vatNumber>
    <name>${escapeXml(inv.business_name || '')}</name>
  </issuer>
  <counterpart>
    <vatNumber>${escapeXml(inv.customer_afm || '')}</vatNumber>
    <name>${escapeXml(inv.customer_name || '')}</name>
  </counterpart>
  <invoiceHeader>
    <series>${escapeXml(inv.series || 'A')}</series>
    <aa>${escapeXml(inv.full_number || String(inv.id))}</aa>
    <issueDate>${inv.issue_date ? String(inv.issue_date).slice(0, 10) : ''}</issueDate>
    <invoiceType>1.1</invoiceType>
    <currency>EUR</currency>
    <paymentMethod>${escapeXml(inv.payment_method || '')}</paymentMethod>
  </invoiceHeader>
  <invoiceLines>${linesXml}
  </invoiceLines>
  <invoiceSummary>
    <totalNetValue>${inv.net_value}</totalNetValue>
    <totalVatAmount>${inv.vat_amount}</totalVatAmount>
    <totalDiscountAmount>${inv.discount_amount || 0}</totalDiscountAmount>
    <totalGrossValue>${inv.total_value}</totalGrossValue>
  </invoiceSummary>
  ${inv.mydata_mark ? `<mark>${escapeXml(inv.mydata_mark)}</mark>` : '<mark>PENDING</mark>'}
</invoice>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice_${inv.full_number || id}.xml"`
    );
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/logs
// ---------------------------------------------------------------------------
router.get('/:id/logs', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = req.user.business_id;

    // Verify invoice access
    const bizCond = req.user.role === 'super_admin' ? '1=1' : 'business_id = ?';
    const bizPar = req.user.role === 'super_admin' ? [] : [businessId];

    const [invCheck] = await pool.execute(
      `SELECT id FROM invoices WHERE id = ? AND ${bizCond} LIMIT 1`,
      [id, ...bizPar]
    );
    if (!invCheck.length) return res.status(404).json({ error: 'Το παραστατικό δεν βρέθηκε.' });

    const [rows] = await pool.execute(
      'SELECT * FROM transmission_logs WHERE invoice_id = ? ORDER BY attempted_at DESC',
      [id]
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/credit  — create credit/reversal invoice (type 1.3)
// Body (all optional): credit_amount (number), reason (string)
// ---------------------------------------------------------------------------
router.post(
  '/:id/credit',
  logAudit('CREATE_CREDIT_INVOICE', 'invoice'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = req.user.business_id;
      const { credit_amount, reason, invoice_type: req_invoice_type, full_cancel, customer_name, customer_afm } = req.body || {};

      // Fetch original invoice
      const [rows] = await pool.execute(
        `SELECT i.*, b.name AS business_name
         FROM invoices i
         JOIN businesses b ON b.id = i.business_id
         WHERE i.id = ? AND i.business_id = ? LIMIT 1`,
        [id, businessId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Παραστατικό δεν βρέθηκε.' });

      const orig = rows[0];

      // Allow credit if transmitted OR if mydata_mark is set (manual flow)
      const canCredit = orig.status === 'transmitted' || (orig.mydata_mark && orig.mydata_mark.trim() !== '');
      if (!canCredit) {
        return res.status(400).json({
          error: 'Μόνο μεταδοθέντα παραστατικά μπορούν να αντιστραφούν.'
        });
      }

      // Reject crediting an already-credit document. Includes legacy 1.3/1.5
      // aliases plus the proper myDATA codes 5.1 (correlated) and 5.2 (non-correlated).
      if (['1.3', '1.4', '1.5', '5.1', '5.2'].includes(orig.invoice_type)) {
        return res.status(400).json({
          error: 'Δεν είναι δυνατή η έκδοση πιστωτικού/ακυρωτικού για πιστωτικό ή ακυρωτικό παραστατικό.'
        });
      }

      // Per Wrapp/AADE docs the proper credit code is 5.1 when we can correlate
      // to the original's MARK, else 5.2 (non-correlated). 1.5 used to be set
      // here but in myDATA 1.5 is "Εκκαθάριση Πωλήσεων Τρίτων", not a credit.
      const origHasMark        = !!(orig.mydata_mark && String(orig.mydata_mark).trim());
      const creditInvoiceType  = origHasMark ? '5.1' : '5.2';

      // Check if a credit/cancel invoice already exists for this original.
      // Include legacy codes so we don't double-credit historical rows.
      const [existing] = await pool.execute(
        "SELECT id FROM invoices WHERE related_invoice_id = ? AND invoice_type IN ('1.3','1.4','1.5','5.1','5.2') LIMIT 1",
        [id]
      );
      if (existing.length) {
        return res.status(409).json({
          error: 'Υπάρχει ήδη πιστωτικό/ακυρωτικό τιμολόγιο για αυτό το παραστατικό.'
        });
      }

      // Resolve customer_id: if caller sends customer_name override, find-or-create
      let resolvedCustomerId = orig.customer_id;
      if (customer_name && customer_name.trim()) {
        const [custRows] = await pool.execute(
          'SELECT id FROM customers WHERE business_id = ? AND name = ? LIMIT 1',
          [businessId, customer_name.trim()]
        );
        if (custRows.length) {
          resolvedCustomerId = custRows[0].id;
          if (customer_afm) {
            await pool.execute(
              'UPDATE customers SET afm = ?, updated_at = NOW() WHERE id = ?',
              [customer_afm.trim(), resolvedCustomerId]
            );
          }
        } else {
          await pool.execute(
            'INSERT INTO customers (business_id, name, afm, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
            [businessId, customer_name.trim(), customer_afm || null]
          );
          const [[newCust]] = await pool.execute(
            'SELECT id FROM customers WHERE business_id = ? AND name = ? ORDER BY id DESC LIMIT 1',
            [businessId, customer_name.trim()]
          );
          resolvedCustomerId = newCust.id;
        }
      }

      // Determine credit amount (partial or full)
      const origTotal  = parseFloat(orig.total_value)  || 0;
      const origNet    = parseFloat(orig.net_value)     || 0;
      const origVat    = parseFloat(orig.vat_amount)    || 0;
      const requestedAmount = credit_amount ? Math.abs(parseFloat(credit_amount)) : null;
      const isPartial  = requestedAmount !== null && Math.abs(requestedAmount - origTotal) > 0.001;
      const ratio      = isPartial ? requestedAmount / origTotal : 1;

      const creditTotal = -(isPartial ? requestedAmount : origTotal);
      const creditNet   = -(isPartial ? parseFloat((origNet * ratio).toFixed(2)) : origNet);
      const creditVat   = -(isPartial ? parseFloat((origVat * ratio).toFixed(2)) : origVat);

      // Fetch original lines (not needed for partial single-line, but needed for full reversal)
      const [origLines] = await pool.execute(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
        [id]
      );

      // Get next invoice number for this business
      const [seriesRow] = await pool.execute(
        `SELECT series, current_number FROM invoice_series
         WHERE business_id = ? AND is_default = 1 AND is_active = 1 LIMIT 1`,
        [businessId]
      );

      let series = orig.series || 'Α';
      let nextNum = 1;
      if (seriesRow.length) {
        series = seriesRow[0].series;
        nextNum = (seriesRow[0].current_number || 0) + 1;
        await pool.execute(
          'UPDATE invoice_series SET current_number = ? WHERE business_id = ? AND series = ?',
          [nextNum, businessId, series]
        );
      } else {
        const [[lastInv]] = await pool.execute(
          "SELECT MAX(number) AS max_num FROM invoices WHERE business_id = ? AND series = ?",
          [businessId, series]
        );
        nextNum = (lastInv.max_num || 0) + 1;
      }

      const fullNumber = `${series}${nextNum}`;
      const newId = require('crypto').randomUUID();
      // myDATA 1.5 is "Πιστωτικό Τιμολόγιο μη συσχετιζόμενο" — there is no separate
      // «ακυρωτικό» code. A full credit (full_cancel=true) and a partial credit are
      // the same document, just with different amounts. Label them consistently.
      const typeLabel = 'Πιστωτικό τιμολόγιο';
      const creditNotes = reason
        ? `${typeLabel} - ${reason} (Αντιστροφή: ${orig.full_number})`
        : `${typeLabel} - Αντιστροφή: ${orig.full_number}`;

      // Insert credit/cancel invoice header
      await pool.execute(
        `INSERT INTO invoices (
          id, business_id, customer_id, created_by,
          series, number, full_number, invoice_type,
          issue_date, payment_method, status,
          net_value, vat_amount, total_value,
          notes, related_invoice_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, 'draft',
                  ?, ?, ?, ?, ?)`,
        [
          newId, businessId, resolvedCustomerId, req.user.id,
          series, nextNum, fullNumber, creditInvoiceType,
          orig.payment_method || 'bank_transfer',
          creditNet, creditVat, creditTotal,
          creditNotes, id,
        ]
      );

      // Create line items
      if (isPartial) {
        // Single summary line for partial credit
        const vatRate = origLines[0] ? parseFloat(origLines[0].vat_rate) || 13 : 13;
        await pool.execute(
          `INSERT INTO invoice_lines (
            id, invoice_id, line_number, description, unit,
            quantity, unit_price, discount_pct, discount_amt,
            net_value, vat_rate, vat_amount, total_value,
            income_category, income_type
          ) VALUES (?, ?, 1, ?, 'τεμ', 1, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
          [
            require('crypto').randomUUID(), newId,
            reason ? `Μερική επιστροφή - ${reason}` : `Μερική επιστροφή (${orig.full_number})`,
            Math.abs(creditNet),
            creditNet,
            vatRate,
            creditVat,
            creditTotal,
            origLines[0]?.income_category || 'E3_561_001',
            origLines[0]?.income_type || '1.1',
          ]
        );
      } else {
        // Full reversal — mirror all original lines with negative quantities
        for (let i = 0; i < origLines.length; i++) {
          const l = origLines[i];
          await pool.execute(
            `INSERT INTO invoice_lines (
              id, invoice_id, product_id, line_number, description, unit,
              quantity, unit_price, discount_pct, discount_amt,
              net_value, vat_rate, vat_amount, total_value,
              income_category, income_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              require('crypto').randomUUID(), newId, l.product_id, i + 1,
              l.description, l.unit || 'kg',
              -(parseFloat(l.quantity) || 0),
              parseFloat(l.unit_price) || 0,
              parseFloat(l.discount_pct) || 0,
              -(parseFloat(l.discount_amt) || 0),
              -(parseFloat(l.net_value) || 0),
              parseFloat(l.vat_rate) || 13,
              -(parseFloat(l.vat_amount) || 0),
              -(parseFloat(l.total_value) || 0),
              l.income_category || null,
              l.income_type || null,
            ]
          );
        }
      }

      // Fetch created invoice to return
      const [created] = await pool.execute(
        `SELECT i.*,
                c.name AS customer_name, c.afm AS customer_afm
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         WHERE i.id = ? LIMIT 1`,
        [newId]
      );
      const [createdLines] = await pool.execute(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
        [newId]
      );

      res.status(201).json({
        data: { ...created[0], lines: createdLines }
      });
    } catch (err) {
      next(err);
    }
  }
);

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;