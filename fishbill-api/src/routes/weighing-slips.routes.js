/**
 * Weighing Slips Routes — /api/weighing-slips
 * Δελτία Ζύγισης — integrated from Deltia Zygisis into FishBill.
 *
 * Table created on first require via self-migration below.
 * Images accepted as base64 in JSON body; decoded and saved under
 * public/uploads/weighing-slips/{businessId}/{uuid}.jpg.
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
const emailService = require('../services/email.service');

async function getAdminEmail() {
  try {
    const cfg = await emailService.loadConfig();
    return cfg.admin_notification_email || process.env.ADMIN_EMAIL || '';
  } catch { return process.env.ADMIN_EMAIL || ''; }
}

const UPLOADS_DIR = path.join(__dirname, '../../public/uploads/weighing-slips');

// ── Self-migration: create tables on first load ───────────────────────────────
(async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS weighing_slips (
        id              CHAR(36)        NOT NULL PRIMARY KEY,
        business_id     CHAR(36)        NOT NULL,
        mobile_id       INT             NULL,
        slip_number     INT             NOT NULL DEFAULT 0,
        slip_date       DATE            NOT NULL,
        fish_type       VARCHAR(100)    NOT NULL,
        weight_kg       DECIMAL(10,4)   NOT NULL DEFAULT 0,
        buyer_name      VARCHAR(255)    NULL,
        price_per_kg    DECIMAL(10,4)   NOT NULL DEFAULT 0,
        total_amount    DECIMAL(10,4)   NOT NULL DEFAULT 0,
        image_path      VARCHAR(500)    NULL,
        notes           TEXT            NULL,
        fao_code        VARCHAR(10)     NULL,
        individual_count INT            NULL,
        presentation_code VARCHAR(10)   NULL DEFAULT 'WHL',
        created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ws_business (business_id),
        INDEX idx_ws_date     (slip_date),
        INDEX idx_ws_fish     (fish_type),
        CONSTRAINT fk_ws_business FOREIGN KEY (business_id)
          REFERENCES businesses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Add new columns to existing tables (idempotent)
    for (const col of [
      `ALTER TABLE weighing_slips ADD COLUMN fao_code VARCHAR(10) NULL`,
      `ALTER TABLE weighing_slips ADD COLUMN individual_count INT NULL`,
      `ALTER TABLE weighing_slips ADD COLUMN presentation_code VARCHAR(10) NULL DEFAULT 'WHL'`,
    ]) {
      try { await pool.execute(col); } catch (_) { /* column already exists */ }
    }
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log('[weighing-slips] table & upload dir ready');
  } catch (e) {
    console.error('[weighing-slips] migration error:', e.message);
  }
})();

router.use(authenticate);

// Feature gate: non-super_admin must have feature_weighing_slips enabled
router.use(async (req, res, next) => {
  if (req.user.role === 'super_admin') return next();
  try {
    const [[s]] = await pool.execute(
      'SELECT feature_weighing_slips FROM business_settings WHERE business_id = ? LIMIT 1',
      [req.user.business_id]
    );
    if (!s || !s.feature_weighing_slips) {
      return res.status(403).json({
        error: 'Η λειτουργία Δελτία Ζύγισης δεν είναι ενεργή για αυτή την επιχείρηση.',
        feature_required: 'feature_weighing_slips',
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

/**
 * Decodes a base64 image string and writes it to disk.
 * Returns the public-facing path (e.g. /uploads/weighing-slips/biz123/uuid.jpg)
 * or null on failure.
 */
function saveBase64Image(base64Data, businessId, slipId) {
  if (!base64Data) return null;
  try {
    const clean  = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length > 15 * 1024 * 1024) {
      console.warn('[weighing-slips] image too large, skipping save');
      return null;
    }
    const bizDir = path.join(UPLOADS_DIR, String(businessId));
    fs.mkdirSync(bizDir, { recursive: true });
    const filename = `${slipId}.jpg`;
    fs.writeFileSync(path.join(bizDir, filename), buffer);
    return `/uploads/weighing-slips/${businessId}/${filename}`;
  } catch (e) {
    console.error('[weighing-slips] image save error:', e.message);
    return null;
  }
}

// ── Validation schemas ─────────────────────────────────────────────────────────

const createSchema = Joi.object({
  business_id       : Joi.string().optional().allow(null, ''),
  mobile_id         : Joi.number().integer().optional().allow(null),
  slip_date         : Joi.string().isoDate().required(),
  fish_type         : Joi.string().max(100).optional().allow('', null).default(''),
  weight_kg         : Joi.number().min(0).precision(4).optional().default(0),
  buyer_name        : Joi.string().max(255).optional().allow('', null),
  price_per_kg      : Joi.number().min(0).precision(4).optional().default(0),
  total_amount      : Joi.number().min(0).precision(4).optional().default(0),
  notes             : Joi.string().max(2000).optional().allow('', null),
  image_data        : Joi.string().optional().allow('', null),
  fao_code          : Joi.string().max(10).optional().allow('', null),
  individual_count  : Joi.number().integer().min(0).optional().allow(null),
  presentation_code : Joi.string().max(10).optional().allow('', null).default('WHL'),
});

const updateSchema = Joi.object({
  slip_date         : Joi.string().isoDate().optional(),
  fish_type         : Joi.string().max(100).optional(),
  weight_kg         : Joi.number().min(0).precision(4).optional(),
  buyer_name        : Joi.string().max(255).optional().allow('', null),
  price_per_kg      : Joi.number().min(0).precision(4).optional(),
  total_amount      : Joi.number().min(0).precision(4).optional(),
  notes             : Joi.string().max(2000).optional().allow('', null),
  image_data        : Joi.string().optional().allow('', null),
  fao_code          : Joi.string().max(10).optional().allow('', null),
  individual_count  : Joi.number().integer().min(0).optional().allow(null),
  presentation_code : Joi.string().max(10).optional().allow('', null),
});

const syncSchema = Joi.object({
  slips: Joi.array().items(Joi.object({
    mobile_id         : Joi.number().integer().required(),
    slip_date         : Joi.string().isoDate().required(),
    fish_type         : Joi.string().max(100).optional().allow('', null).default(''),
    weight_kg         : Joi.number().min(0).precision(4).optional().default(0),
    buyer_name        : Joi.string().max(255).optional().allow('', null),
    price_per_kg      : Joi.number().min(0).precision(4).optional().default(0),
    total_amount      : Joi.number().min(0).precision(4).optional().default(0),
    notes             : Joi.string().max(2000).optional().allow('', null),
    image_data        : Joi.string().optional().allow('', null),
    fao_code          : Joi.string().max(10).optional().allow('', null),
    individual_count  : Joi.number().integer().min(0).optional().allow(null),
    presentation_code : Joi.string().max(10).optional().allow('', null),
  })).min(1).max(50).required(),
});

// ── GET /api/weighing-slips/fish-types/list ───────────────────────────────────
// Must appear before /:id to avoid collision.
router.get('/fish-types/list', async (req, res, next) => {
  try {
    const business_id = bizId(req);
    if (!business_id) return res.status(400).json({ error: 'business_id απαιτείται.' });
    const [rows] = await pool.execute(
      'SELECT DISTINCT fish_type FROM weighing_slips WHERE business_id = ? ORDER BY fish_type',
      [business_id]
    );
    res.json({ data: rows.map(r => r.fish_type) });
  } catch (err) { next(err); }
});

// ── POST /api/weighing-slips/sync ─────────────────────────────────────────────
// Mobile batch sync — must appear before /:id to avoid collision.
router.post('/sync', validate(syncSchema), async (req, res, next) => {
  const business_id = bizId(req);
  if (!business_id) return res.status(400).json({ error: 'business_id απαιτείται.' });

  const results = [];
  let created = 0;
  let failed  = 0;

  for (const item of req.body.slips) {
    try {
      const [[{ maxNum }]] = await pool.execute(
        'SELECT COALESCE(MAX(slip_number), 0) AS maxNum FROM weighing_slips WHERE business_id = ?',
        [business_id]
      );
      const slip_number = maxNum + 1;
      const id          = uuidv4();
      const image_path  = saveBase64Image(item.image_data, business_id, id);

      await pool.execute(
        `INSERT INTO weighing_slips
           (id, business_id, mobile_id, slip_number, slip_date, fish_type, weight_kg,
            buyer_name, price_per_kg, total_amount, image_path, notes,
            fao_code, individual_count, presentation_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, business_id, item.mobile_id, slip_number, item.slip_date.slice(0, 10),
         item.fish_type, item.weight_kg, item.buyer_name || null,
         item.price_per_kg || 0, item.total_amount || 0, image_path, item.notes || null,
         item.fao_code || null, item.individual_count || null, item.presentation_code || 'WHL']
      );

      results.push({ mobile_id: item.mobile_id, server_id: id, slip_number, image_path });
      created++;
    } catch (e) {
      console.error('[weighing-slips/sync] error for mobile_id', item.mobile_id, ':', e.message);
      results.push({ mobile_id: item.mobile_id, error: e.message });
      failed++;
    }
  }

  res.json({ data: { created, failed, results, synced_at: new Date().toISOString() } });
});

// ── GET /api/weighing-slips ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const superAdmin  = isSA(req);
    const business_id = bizId(req);

    if (!business_id && !superAdmin) {
      return res.status(400).json({ error: 'business_id απαιτείται.' });
    }

    const { page = 1, limit = 30, fish_type, buyer, date_from, date_to, q } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));
    const lim    = Math.min(100, parseInt(limit));

    let where  = business_id ? 'WHERE ws.business_id = ?' : '';
    const params = business_id ? [business_id] : [];

    const andOr = where ? ' AND ' : 'WHERE ';
    if (fish_type) { where += andOr + 'ws.fish_type = ?';        params.push(fish_type); }
    if (buyer)     { where += andOr + 'ws.buyer_name LIKE ?';    params.push(`%${buyer}%`); }
    if (date_from) { where += andOr + 'ws.slip_date >= ?';       params.push(date_from); }
    if (date_to)   { where += andOr + 'ws.slip_date <= ?';       params.push(date_to); }
    if (q) {
      where += andOr + '(ws.fish_type LIKE ? OR ws.buyer_name LIKE ? OR CAST(ws.slip_number AS CHAR) LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const bizJoin   = superAdmin ? 'LEFT JOIN businesses b ON b.id = ws.business_id' : '';
    const bizSelect = superAdmin ? ', ws.business_id, b.name AS business_name' : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM weighing_slips ws ${bizJoin} ${where}`, params
    );

    const [rows] = await pool.query(
      `SELECT ws.id, ws.slip_number, ws.slip_date, ws.fish_type,
              ws.weight_kg, ws.buyer_name, ws.price_per_kg, ws.total_amount,
              ws.image_path, ws.notes, ws.fao_code, ws.individual_count, ws.presentation_code,
              ws.created_at, ws.updated_at ${bizSelect}
       FROM weighing_slips ws ${bizJoin} ${where}
       ORDER BY ws.slip_date DESC, ws.slip_number DESC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    res.json({
      data: rows,
      meta: { total, page: parseInt(page), limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err) { next(err); }
});

// ── POST /api/weighing-slips ───────────────────────────────────────────────────
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const business_id = req.user.business_id || req.body.business_id;
    if (!business_id) return res.status(400).json({ error: 'business_id απαιτείται.' });

    const { slip_date, fish_type, weight_kg, buyer_name, price_per_kg,
            total_amount, notes, image_data, mobile_id } = req.body;

    const [[{ maxNum }]] = await pool.execute(
      'SELECT COALESCE(MAX(slip_number), 0) AS maxNum FROM weighing_slips WHERE business_id = ?',
      [business_id]
    );
    const slip_number = maxNum + 1;
    const id          = uuidv4();
    const image_path  = saveBase64Image(image_data, business_id, id);

    const { fao_code, individual_count, presentation_code } = req.body;
    await pool.execute(
      `INSERT INTO weighing_slips
         (id, business_id, mobile_id, slip_number, slip_date, fish_type, weight_kg,
          buyer_name, price_per_kg, total_amount, image_path, notes,
          fao_code, individual_count, presentation_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, business_id, mobile_id || null, slip_number, slip_date.slice(0, 10),
       fish_type, weight_kg, buyer_name || null,
       price_per_kg || 0, total_amount || 0, image_path, notes || null,
       fao_code || null, individual_count || null, presentation_code || 'WHL']
    );

    const [[slip]] = await pool.execute(
      'SELECT * FROM weighing_slips WHERE id = ? LIMIT 1', [id]
    );

    res.status(201).json({ data: slip });
  } catch (err) { next(err); }
});

// ── GET /api/weighing-slips/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const business_id = bizId(req);
    const isSuperAdmin = req.user.role === 'super_admin';
    const [[slip]] = await pool.execute(
      `SELECT * FROM weighing_slips
       WHERE id = ? AND (business_id = ? OR ?)
       LIMIT 1`,
      [req.params.id, business_id, isSuperAdmin]
    );
    if (!slip) return res.status(404).json({ error: 'Δελτίο ζύγισης δεν βρέθηκε.' });
    res.json({ data: slip });
  } catch (err) { next(err); }
});

// ── PATCH /api/weighing-slips/:id ─────────────────────────────────────────────
router.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const superAdmin  = isSA(req);
    const business_id = bizId(req);
    const [[slip]] = superAdmin
      ? await pool.execute('SELECT id, business_id FROM weighing_slips WHERE id = ? LIMIT 1', [req.params.id])
      : await pool.execute('SELECT id, business_id FROM weighing_slips WHERE id = ? AND business_id = ? LIMIT 1', [req.params.id, business_id]);
    if (!slip) return res.status(404).json({ error: 'Δελτίο ζύγισης δεν βρέθηκε.' });

    const { slip_date, fish_type, weight_kg, buyer_name,
            price_per_kg, total_amount, notes, image_data,
            fao_code, individual_count, presentation_code } = req.body;

    const updates = [];
    const vals    = [];

    if (slip_date         !== undefined) { updates.push('slip_date = ?');          vals.push(slip_date.slice(0, 10)); }
    if (fish_type         !== undefined) { updates.push('fish_type = ?');          vals.push(fish_type); }
    if (weight_kg         !== undefined) { updates.push('weight_kg = ?');          vals.push(weight_kg); }
    if (buyer_name        !== undefined) { updates.push('buyer_name = ?');         vals.push(buyer_name || null); }
    if (price_per_kg      !== undefined) { updates.push('price_per_kg = ?');       vals.push(price_per_kg); }
    if (total_amount      !== undefined) { updates.push('total_amount = ?');       vals.push(total_amount); }
    if (notes             !== undefined) { updates.push('notes = ?');              vals.push(notes || null); }
    if (fao_code          !== undefined) { updates.push('fao_code = ?');           vals.push(fao_code || null); }
    if (individual_count  !== undefined) { updates.push('individual_count = ?');   vals.push(individual_count || null); }
    if (presentation_code !== undefined) { updates.push('presentation_code = ?');  vals.push(presentation_code || null); }

    if (image_data) {
      const image_path = saveBase64Image(image_data, business_id, slip.id);
      if (image_path) { updates.push('image_path = ?'); vals.push(image_path); }
    }

    if (!updates.length) return res.status(400).json({ error: 'Δεν δόθηκαν δεδομένα για ενημέρωση.' });

    updates.push('updated_at = NOW()');
    await pool.execute(
      `UPDATE weighing_slips SET ${updates.join(', ')} WHERE id = ?`,
      [...vals, slip.id]
    );

    const [[updated]] = await pool.execute(
      'SELECT * FROM weighing_slips WHERE id = ? LIMIT 1', [slip.id]
    );
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// ── DELETE /api/weighing-slips/:id ────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const superAdmin  = isSA(req);
    const business_id = bizId(req);
    const [[slip]] = superAdmin
      ? await pool.execute('SELECT ws.*, b.name AS business_name FROM weighing_slips ws LEFT JOIN businesses b ON b.id = ws.business_id WHERE ws.id = ? LIMIT 1', [req.params.id])
      : await pool.execute('SELECT ws.*, b.name AS business_name FROM weighing_slips ws LEFT JOIN businesses b ON b.id = ws.business_id WHERE ws.id = ? AND ws.business_id = ? LIMIT 1', [req.params.id, business_id]);
    if (!slip) return res.status(404).json({ error: 'Δελτίο ζύγισης δεν βρέθηκε.' });

    if (slip.image_path) {
      const filePath = path.join(__dirname, '../../public', slip.image_path);
      fs.unlink(filePath, () => {});
    }

    await pool.execute('DELETE FROM weighing_slips WHERE id = ?', [slip.id]);

    // Send admin notification email (fire-and-forget — don't block the response)
    const adminEmail = await getAdminEmail();
    if (adminEmail) emailService.sendEmail({
      to:      adminEmail,
      toName:  'Admin',
      subject: `Διαγραφή Δελτίου Ζύγισης #${slip.slip_number || slip.id.slice(0,8)}`,
      html: `
        <p>Ένας χρήστης ζήτησε <strong>διαγραφή δελτίου ζύγισης</strong>.</p>
        <table style="border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:4px 12px 4px 0;color:#555;">Επιχείρηση:</td><td><strong>${slip.business_name || slip.business_id}</strong></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555;">Αριθμός Δελτίου:</td><td>#${slip.slip_number || '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555;">Αλίευμα:</td><td>${slip.fish_type}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555;">Ημερομηνία:</td><td>${slip.slip_date}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555;">Βάρος:</td><td>${slip.weight_kg} kg</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555;">Αγοραστής:</td><td>${slip.buyer_name || '—'}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:16px;">Το δελτίο διαγράφηκε αυτόματα από τη βάση δεδομένων.</p>
      `,
    }).catch(() => {});

    res.json({ data: { message: 'Το δελτίο ζύγισης διαγράφηκε.' } });
  } catch (err) { next(err); }
});

module.exports = router;
