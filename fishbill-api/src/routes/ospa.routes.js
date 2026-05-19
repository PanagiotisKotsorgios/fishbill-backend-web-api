/**
 * OSPA Submissions Routes — /api/ospa
 * Υποβολές ΟΣΠΑ (Greek fishing authority submissions).
 * Integrated from Deltia Zygisis into FishBill.
 */

const express = require('express');
const router  = express.Router();
const Joi     = require('joi');
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate }     = require('../middleware/validate');

const OSPA_UPLOADS_DIR = path.join(__dirname, '../../public/uploads/ospa');
fs.mkdirSync(OSPA_UPLOADS_DIR, { recursive: true });

function saveBase64Doc(base64Data, businessId, submissionId) {
  if (!base64Data) return null;
  try {
    const clean  = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length > 20 * 1024 * 1024) {
      console.warn('[ospa] document too large, skipping save');
      return null;
    }
    const bizDir = path.join(OSPA_UPLOADS_DIR, String(businessId));
    fs.mkdirSync(bizDir, { recursive: true });
    const filename = `${submissionId}.pdf`;
    fs.writeFileSync(path.join(bizDir, filename), buffer);
    return `/uploads/ospa/${businessId}/${filename}`;
  } catch (e) {
    console.error('[ospa] document save error:', e.message);
    return null;
  }
}

// ── Self-migration ─────────────────────────────────────────────────────────────
(async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS ospa_submissions (
        id                  CHAR(36)    NOT NULL PRIMARY KEY,
        business_id         CHAR(36)    NOT NULL,
        submission_period   VARCHAR(20) NOT NULL COMMENT 'e.g. 2026-04',
        status              ENUM('pending','submitted','needs_correction')
                            NOT NULL DEFAULT 'pending',
        form_path           VARCHAR(500) NULL,
        supporting_docs     JSON         NULL,
        submission_date     DATE         NULL,
        deadline            DATE         NULL,
        notes               TEXT         NULL,
        created_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ospa_business (business_id),
        INDEX idx_ospa_period   (submission_period),
        CONSTRAINT fk_ospa_business FOREIGN KEY (business_id)
          REFERENCES businesses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[ospa] table ready');

    // Add feature flags to business_settings if missing
    for (const col of ['feature_ospa', 'feature_weighing_slips']) {
      try {
        await pool.execute(
          `ALTER TABLE business_settings ADD COLUMN ${col} TINYINT(1) NOT NULL DEFAULT 0`
        );
        console.log(`[ospa] added column business_settings.${col}`);
      } catch (e) {
        if (!e.message.includes('Duplicate column')) {
          console.error(`[ospa] alter error (${col}):`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[ospa] migration error:', e.message);
  }
})();

router.use(authenticate);

// Feature gate: non-super_admin must have feature_ospa enabled
router.use(async (req, res, next) => {
  if (req.user.role === 'super_admin') return next();
  try {
    const [[s]] = await pool.execute(
      'SELECT feature_ospa FROM business_settings WHERE business_id = ? LIMIT 1',
      [req.user.business_id]
    );
    if (!s || !s.feature_ospa) {
      return res.status(403).json({
        error: 'Η λειτουργία OSPA δεν είναι ενεργή για αυτή την επιχείρηση.',
        feature_required: 'feature_ospa',
      });
    }
    next();
  } catch (err) { next(err); }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function bizId(req) {
  if (req.user.role === 'super_admin') {
    return req.body?.business_id || req.query?.business_id || null;
  }
  return req.user.business_id || null;
}

const isSA = req => req.user.role === 'super_admin';

// ── Validation ─────────────────────────────────────────────────────────────────

const createSchema = Joi.object({
  business_id       : Joi.string().optional().allow(null, ''),
  submission_period : Joi.string().pattern(/^\d{4}-\d{2}$/).required()
    .messages({ 'string.pattern.base': 'submission_period πρέπει να είναι της μορφής YYYY-MM.' }),
  status            : Joi.string().valid('pending', 'submitted', 'needs_correction').optional().default('pending'),
  form_path         : Joi.string().max(500).optional().allow('', null),
  form_data_base64  : Joi.string().optional().allow('', null),
  supporting_docs   : Joi.array().optional().allow(null),
  submission_date   : Joi.string().isoDate().optional().allow('', null),
  deadline          : Joi.string().isoDate().optional().allow('', null),
  notes             : Joi.string().max(2000).optional().allow('', null),
});

const updateSchema = Joi.object({
  status           : Joi.string().valid('pending', 'submitted', 'needs_correction').optional(),
  form_path        : Joi.string().max(500).optional().allow('', null),
  form_data_base64 : Joi.string().optional().allow('', null),
  supporting_docs  : Joi.array().optional().allow(null),
  submission_date  : Joi.string().isoDate().optional().allow('', null),
  deadline         : Joi.string().isoDate().optional().allow('', null),
  notes            : Joi.string().max(2000).optional().allow('', null),
});

// ── GET /api/ospa/monthly-summary  (super_admin only) ─────────────────────────
// Per-business OSPA working status for a given month: subscription, feature_ospa,
// OSPA submission status, and weighing-slip image count for that month.
router.get('/monthly-summary', async (req, res, next) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden.' });
  try {
    const month = (req.query.month || new Date().toISOString().slice(0, 7)).slice(0, 7); // YYYY-MM
    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const nextM      = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const [rows] = await pool.query(`
      SELECT
        b.id              AS business_id,
        b.name            AS business_name,
        b.afm,
        b.plan,
        b.subscription_active,
        COALESCE(bs.feature_ospa, 0)            AS feature_ospa,
        COALESCE(bs.feature_weighing_slips, 0)  AS feature_weighing_slips,
        os.id             AS ospa_id,
        os.status         AS ospa_status,
        os.submission_date,
        COUNT(DISTINCT ws.id)                                                  AS total_slips,
        COUNT(DISTINCT CASE WHEN ws.image_path IS NOT NULL THEN ws.id END)    AS images_count
      FROM businesses b
      LEFT JOIN business_settings   bs ON bs.business_id = b.id
      LEFT JOIN ospa_submissions    os ON os.business_id = b.id
                                      AND os.submission_period = ?
      LEFT JOIN weighing_slips      ws ON ws.business_id = b.id
                                      AND ws.slip_date >= ? AND ws.slip_date < ?
      WHERE b.is_active = 1
      GROUP BY b.id, b.name, b.afm, b.plan, b.subscription_active,
               bs.feature_ospa, bs.feature_weighing_slips,
               os.id, os.status, os.submission_date
      ORDER BY
        CASE WHEN COALESCE(bs.feature_ospa, 0) = 1 THEN 0 ELSE 1 END,
        COUNT(DISTINCT CASE WHEN ws.image_path IS NOT NULL THEN ws.id END) DESC,
        b.name
    `, [month, monthStart, nextM]);

    res.json({ data: rows, month });
  } catch (err) { next(err); }
});

// ── GET /api/ospa ──────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const superAdmin  = isSA(req);
    const business_id = bizId(req);

    if (!business_id && !superAdmin) {
      return res.status(400).json({ error: 'business_id απαιτείται.' });
    }

    const { page = 1, limit = 20, status, period, q } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));
    const lim    = Math.min(100, parseInt(limit));

    let where  = business_id ? 'WHERE os.business_id = ?' : '';
    const params = business_id ? [business_id] : [];

    const andOr = where ? ' AND ' : 'WHERE ';
    if (status) { where += andOr + 'os.status = ?';              params.push(status); }
    if (period) { where += andOr + 'os.submission_period = ?';   params.push(period); }
    if (q) {
      where += andOr + '(os.submission_period LIKE ? OR os.notes LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    const bizJoin   = superAdmin ? 'LEFT JOIN businesses b ON b.id = os.business_id' : '';
    const bizSelect = superAdmin ? ', os.business_id, b.name AS business_name' : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ospa_submissions os ${bizJoin} ${where}`, params
    );

    const [rows] = await pool.query(
      `SELECT os.id, os.submission_period, os.status, os.form_path,
              os.submission_date, os.deadline, os.notes, os.created_at, os.updated_at ${bizSelect}
       FROM ospa_submissions os ${bizJoin} ${where}
       ORDER BY os.submission_period DESC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    res.json({
      data: rows,
      meta: { total, page: parseInt(page), limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err) { next(err); }
});

// ── POST /api/ospa ─────────────────────────────────────────────────────────────
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const business_id = req.user.business_id || req.body.business_id;
    if (!business_id) return res.status(400).json({ error: 'business_id απαιτείται.' });

    const { submission_period, status, form_path, form_data_base64,
            supporting_docs, submission_date, deadline, notes } = req.body;
    const id = uuidv4();

    const savedFormPath = form_data_base64
      ? saveBase64Doc(form_data_base64, business_id, id)
      : (form_path || null);

    await pool.execute(
      `INSERT INTO ospa_submissions
         (id, business_id, submission_period, status, form_path, supporting_docs,
          submission_date, deadline, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, business_id, submission_period, status || 'pending',
       savedFormPath,
       supporting_docs ? JSON.stringify(supporting_docs) : null,
       submission_date || null, deadline || null, notes || null]
    );

    const [[sub]] = await pool.execute(
      'SELECT * FROM ospa_submissions WHERE id = ? LIMIT 1', [id]
    );
    res.status(201).json({ data: sub });
  } catch (err) { next(err); }
});

// ── GET /api/ospa/:id ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const business_id = bizId(req);
    const isSuperAdmin = req.user.role === 'super_admin';
    const [[sub]] = await pool.execute(
      `SELECT * FROM ospa_submissions WHERE id = ? AND (business_id = ? OR ?) LIMIT 1`,
      [req.params.id, business_id, isSuperAdmin]
    );
    if (!sub) return res.status(404).json({ error: 'Υποβολή ΟΣΠΑ δεν βρέθηκε.' });
    res.json({ data: sub });
  } catch (err) { next(err); }
});

// ── PATCH /api/ospa/:id ────────────────────────────────────────────────────────
router.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const superAdmin  = isSA(req);
    const business_id = bizId(req);
    const [[sub]] = superAdmin
      ? await pool.execute('SELECT id FROM ospa_submissions WHERE id = ? LIMIT 1', [req.params.id])
      : await pool.execute('SELECT id FROM ospa_submissions WHERE id = ? AND business_id = ? LIMIT 1', [req.params.id, business_id]);
    if (!sub) return res.status(404).json({ error: 'Υποβολή ΟΣΠΑ δεν βρέθηκε.' });

    const { status, form_path, form_data_base64, supporting_docs,
            submission_date, deadline, notes } = req.body;

    const updates = [];
    const vals    = [];

    if (status !== undefined) { updates.push('status = ?'); vals.push(status); }

    if (form_data_base64) {
      const [[subFull]] = await pool.execute(
        'SELECT business_id FROM ospa_submissions WHERE id = ? LIMIT 1', [sub.id]
      );
      const savedPath = saveBase64Doc(form_data_base64, subFull.business_id, sub.id);
      if (savedPath) { updates.push('form_path = ?'); vals.push(savedPath); }
    } else if (form_path !== undefined) {
      updates.push('form_path = ?'); vals.push(form_path || null);
    }

    if (supporting_docs !== undefined) {
      updates.push('supporting_docs = ?');
      vals.push(supporting_docs ? JSON.stringify(supporting_docs) : null);
    }
    if (submission_date !== undefined) { updates.push('submission_date = ?'); vals.push(submission_date || null); }
    if (deadline        !== undefined) { updates.push('deadline = ?');        vals.push(deadline || null); }
    if (notes           !== undefined) { updates.push('notes = ?');           vals.push(notes || null); }

    if (!updates.length) return res.status(400).json({ error: 'Δεν δόθηκαν δεδομένα για ενημέρωση.' });

    updates.push('updated_at = NOW()');
    await pool.execute(
      `UPDATE ospa_submissions SET ${updates.join(', ')} WHERE id = ?`,
      [...vals, sub.id]
    );

    const [[updated]] = await pool.execute(
      'SELECT * FROM ospa_submissions WHERE id = ? LIMIT 1', [sub.id]
    );
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// ── DELETE /api/ospa/:id ───────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    if (!['super_admin', 'owner', 'accountant'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Δεν επιτρέπεται η διαγραφή.' });
    }
    const business_id = bizId(req);
    const isSuperAdmin = req.user.role === 'super_admin';
    const [[sub]] = await pool.execute(
      `SELECT id FROM ospa_submissions WHERE id = ? AND (business_id = ? OR ?) LIMIT 1`,
      [req.params.id, business_id, isSuperAdmin]
    );
    if (!sub) return res.status(404).json({ error: 'Υποβολή ΟΣΠΑ δεν βρέθηκε.' });

    await pool.execute('DELETE FROM ospa_submissions WHERE id = ?', [sub.id]);
    res.json({ data: { message: 'Η υποβολή ΟΣΠΑ διαγράφηκε.' } });
  } catch (err) { next(err); }
});

module.exports = router;
