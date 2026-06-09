/**
 * Delivery Notes Routes — /api/delivery-notes
 * Δελτία Αποστολής (myDATA document type 9.1) for fishermen.
 */

const express = require('express');
const router  = express.Router();
const Joi     = require('joi');
const fs      = require('fs');
const path    = require('path');
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate }     = require('../middleware/validate');

const DN_PLAN_LIMITS = { basic: 15, pro: 30, enterprise: -1, trial: -1 };

const _dnLogFile = path.join(__dirname, '../logs/wrapp.log');
try { fs.mkdirSync(path.dirname(_dnLogFile), { recursive: true }); } catch (_) {}
function dnlog(level, msg, data) {
  const ts   = new Date().toISOString();
  const line = data !== undefined
    ? `[${ts}] [${level}] [DN_TX] ${msg} ${JSON.stringify(data)}`
    : `[${ts}] [${level}] [DN_TX] ${msg}`;
  if (level === 'ERROR') console.error(line); else console.log(line);
  try { fs.appendFileSync(_dnLogFile, line + '\n'); } catch (e) { console.error('[dnlog write FAILED]', e.message); }
}
const emailSvc  = require('../services/email.service');
const pdfService = require('../services/pdf.service');

// ── Self-migrations ───────────────────────────────────────────────────────────
(async () => {
  // Wrapp columns on businesses
  for (const col of [
    `ALTER TABLE businesses ADD COLUMN wrapp_api_key VARCHAR(255) NULL`,
    `ALTER TABLE businesses ADD COLUMN wrapp_user_id VARCHAR(255) NULL`,
    `ALTER TABLE businesses ADD COLUMN wrapp_enabled TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE businesses ADD COLUMN wrapp_billing_book_dn_id VARCHAR(255) NULL`,
    `ALTER TABLE businesses ADD COLUMN wrapp_billing_book_inv_id VARCHAR(255) NULL`,
  ]) {
    await pool.execute(col).catch(e => { if (e.errno !== 1060) console.warn('[DN migration]', e.message); });
  }
  // Wrapp columns on delivery_notes
  for (const col of [
    `ALTER TABLE delivery_notes ADD COLUMN wrapp_invoice_id VARCHAR(255) NULL`,
    `ALTER TABLE delivery_notes ADD COLUMN wrapp_mark VARCHAR(255) NULL`,
    `ALTER TABLE delivery_notes ADD COLUMN wrapp_qr_url TEXT NULL`,
  ]) {
    await pool.execute(col).catch(e => { if (e.errno !== 1060) console.warn('[DN migration]', e.message); });
  }

  try {
    await pool.execute(
      `ALTER TABLE delivery_notes ADD COLUMN client_ref VARCHAR(100) NULL`
    ).catch(e => { if (e.errno !== 1060) throw e; }); // 1060 = duplicate column, already exists
    await pool.execute(
      `ALTER TABLE delivery_notes ADD INDEX idx_dn_client_ref (business_id, client_ref)`
    ).catch(() => {}); // ignore if index already exists
    console.log('[delivery-notes] client_ref migration OK');
  } catch (e) {
    console.warn('[delivery-notes] client_ref migration skipped:', e.message);
  }
  // Extra DN credits column on businesses — retry once on deadlock; ignore 1060 (already exists)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await pool.execute(`ALTER TABLE businesses ADD COLUMN extra_dn_credits INT NOT NULL DEFAULT 0`);
      console.log('[delivery-notes] extra_dn_credits column added');
      break;
    } catch (e) {
      if (e.errno === 1060) break; // already exists, nothing to do
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      else console.warn('[delivery-notes] extra_dn_credits migration failed:', e.message);
    }
  }
  // DN credit purchase requests table
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS dn_credit_requests (
        id              CHAR(36)      NOT NULL PRIMARY KEY,
        business_id     CHAR(36)      NOT NULL,
        credits         INT           NOT NULL DEFAULT 10,
        invoice_credits INT           NOT NULL DEFAULT 0,
        amount_eur      DECIMAL(6,2)  NOT NULL DEFAULT 0,
        status          ENUM('pending','granted','rejected') NOT NULL DEFAULT 'pending',
        notes           TEXT          NULL,
        requested_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at     DATETIME      NULL,
        resolved_by     CHAR(36)      NULL,
        CONSTRAINT fk_dcr_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}
  // Add invoice_credits column if table existed without it
  try {
    await pool.execute(
      `ALTER TABLE dn_credit_requests ADD COLUMN invoice_credits INT NOT NULL DEFAULT 0`
    );
  } catch (e) { if (e.errno !== 1060) console.warn('[delivery-notes] invoice_credits col migration:', e.message); }
})();

// ── Helpers ────────────────────────────────────────────────────────────────────

function bizId(req) {
  return req.user.business_id || req.body.business_id || req.query.business_id || null;
}

// ── Fire-and-forget notification ──────────────────────────────────────────────
function fireNotif(bizIdVal, flag, fn, extraArgs) {
  (async () => {
    try {
      const [bsRows] = await pool.execute(
        'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [bizIdVal]
      );
      const bs = bsRows[0] || {};
      if (!bs[flag]) return;

      const [uRows] = await pool.execute(
        `SELECT u.email, u.full_name, b.name AS biz_name
         FROM users u JOIN businesses b ON b.id = u.business_id
         WHERE u.business_id = ? AND u.role IN ('owner','admin') AND u.is_active = 1
         ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1`,
        [bizIdVal]
      );
      if (!uRows.length) return;
      const { email, full_name, biz_name } = uRows[0];
      await fn({ to: email, toName: full_name, bizName: biz_name, ...extraArgs });
    } catch (e) {
      console.error('[fireNotif] delivery-note notification error:', e.message);
    }
  })();
}

// ── Validation schemas ─────────────────────────────────────────────────────────

const lineSchema = Joi.object({
  description  : Joi.string().max(500).required(),
  quantity     : Joi.number().min(0).precision(4).required(),
  unit         : Joi.string().max(20).optional().default('kg'),
  unit_price   : Joi.number().min(0).precision(4).optional().default(0),
  vat_rate     : Joi.number().valid(0, 6, 13, 24).optional().default(0),
  net_amount   : Joi.number().min(0).precision(4).optional().default(0),
});

const createSchema = Joi.object({
  business_id       : Joi.string().optional().allow(null, ''),
  series            : Joi.string().max(10).optional().default('ΔΑ'),
  issue_date        : Joi.string().isoDate().required(),
  dispatch_date     : Joi.string().isoDate().optional().allow('', null),
  dispatch_time     : Joi.string().max(5).optional().allow('', null),
  recipient_name    : Joi.string().max(255).required(),
  recipient_afm     : Joi.string().max(20).optional().allow('', null),
  recipient_doy     : Joi.string().max(100).optional().allow('', null),
  recipient_address : Joi.string().max(255).optional().allow('', null),
  recipient_city    : Joi.string().max(100).optional().allow('', null),
  recipient_postal  : Joi.string().max(20).optional().allow('', null),
  recipient_phone   : Joi.string().max(30).optional().allow('', null),
  dispatch_location : Joi.string().max(255).optional().allow('', null),
  delivery_location : Joi.string().max(255).optional().allow('', null),
  loading_place     : Joi.string().max(100).optional().allow('', null),
  transport_purpose : Joi.string().max(100).optional().allow('', null),
  vehicle_plate     : Joi.string().max(30).optional().allow('', null),
  for_weighing      : Joi.boolean().optional().default(false),
  notes             : Joi.string().max(2000).optional().allow('', null),
  status            : Joi.string().valid('draft', 'issued').optional().default('draft'),
  lines             : Joi.array().items(lineSchema).min(1).required(),
  client_ref        : Joi.string().max(100).optional().allow('', null),
});

// ── GET /api/delivery-notes ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const business_id = bizId(req);
    if (!business_id) return res.status(400).json({ error: 'business_id απαιτείται.' });

    const { page = 1, limit = 20, status, q } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));
    const lim    = Math.min(100, parseInt(limit));

    let where = 'WHERE dn.business_id = ?';
    const params = [business_id];

    if (status) { where += ' AND dn.status = ?'; params.push(status); }
    if (q) {
      where += ' AND (dn.recipient_name LIKE ? OR dn.number LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM delivery_notes dn ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT dn.id, dn.series, dn.number, dn.issue_date, dn.recipient_name,
              dn.recipient_afm, dn.recipient_city, dn.status, dn.mydata_mark,
              dn.vehicle_plate, dn.client_ref, dn.created_at
       FROM delivery_notes dn ${where}
       ORDER BY dn.created_at DESC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    // Compute limit status so the app can block the create button before the user fills the form
    let atLimit = false;
    let usedThisMonth = 0;
    let monthlyLimit = -1;
    let extraCredits = 0;
    if (req.user.role !== 'super_admin') {
      try {
        const [[biz]] = await pool.execute(
          `SELECT plan, trial_ends_at, subscription_active, subscription_ends_at,
                  COALESCE(extra_dn_credits, 0) AS extra_dn_credits,
                  DATE_FORMAT(billing_cycle_started_at, '%Y-%m-%d') AS billing_cycle_started_at
           FROM businesses WHERE id = ? LIMIT 1`,
          [business_id]
        );
        if (biz) {
          monthlyLimit = DN_PLAN_LIMITS[biz.plan] ?? -1;
          extraCredits = biz.extra_dn_credits;
          if (monthlyLimit !== -1) {
            const now        = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
            const countFrom  = biz.billing_cycle_started_at && biz.billing_cycle_started_at > monthStart
              ? biz.billing_cycle_started_at
              : monthStart;
            const [[{ cnt }]] = await pool.execute(
              `SELECT COUNT(*) AS cnt FROM delivery_notes
               WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
              [business_id, countFrom]
            );
            usedThisMonth = cnt;
            atLimit = cnt >= (monthlyLimit + extraCredits);
          }
        }
      } catch (_) {}
    }

    res.json({
      data: rows,
      meta: {
        total, page: parseInt(page), limit: lim, pages: Math.ceil(total / lim),
        at_limit: atLimit, used_this_month: usedThisMonth,
        monthly_limit: monthlyLimit, extra_credits: extraCredits,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/delivery-notes ───────────────────────────────────────────────────
router.post('/', validate(createSchema), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const business_id = req.user.business_id || req.body.business_id;
    if (!business_id) {
      await conn.rollback();
      return res.status(400).json({ error: 'business_id απαιτείται.' });
    }

    const {
      series, issue_date, dispatch_date, dispatch_time,
      recipient_name, recipient_afm, recipient_doy,
      recipient_address, recipient_city, recipient_postal, recipient_phone,
      dispatch_location, delivery_location, loading_place, transport_purpose,
      vehicle_plate, for_weighing, notes, status, lines, client_ref,
    } = req.body;

    // ── AFM format validation (9 digits, basic regex; "000000000" is allowed) ─
    if (recipient_afm && recipient_afm !== '000000000') {
      if (!/^[0-9]{9}$/.test(recipient_afm)) {
        await conn.rollback();
        return res.status(400).json({
          error: `Μη έγκυρη μορφή ΑΦΜ παραλήπτη: "${recipient_afm}". Το ΑΦΜ πρέπει να αποτελείται από 9 ψηφία.`,
          error_code: 'INVALID_AFM_FORMAT',
        });
      }
    }

    // ── Idempotency check (MUST run before limit check) ───────────────────────
    // If the Android client retried after a network timeout, return the already-
    // created note instead of inserting a duplicate or hitting the monthly limit.
    if (client_ref) {
      try {
        const [[existing]] = await conn.execute(
          'SELECT id FROM delivery_notes WHERE business_id = ? AND client_ref = ? LIMIT 1',
          [business_id, client_ref]
        );
        if (existing) {
          await conn.rollback();
          conn.release();
          const [[note]] = await pool.execute('SELECT * FROM delivery_notes WHERE id = ? LIMIT 1', [existing.id]);
          const [createdLines] = await pool.execute(
            'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
            [existing.id]
          );
          return res.status(201).json({ data: { ...note, lines: createdLines } });
        }
      } catch (_) {
        // client_ref column may not exist yet — proceed without idempotency check
      }
    }

    // ── Monthly delivery-note limit check ─────────────────────────────────────
    if (req.user.role !== 'super_admin') {
      const [[biz]] = await conn.execute(
        `SELECT plan, trial_ends_at, subscription_active, subscription_ends_at,
                DATE_FORMAT(billing_cycle_started_at, '%Y-%m-%d') AS billing_cycle_started_at
         FROM businesses WHERE id = ? LIMIT 1`,
        [business_id]
      );
      if (biz) {
        const now = new Date();
        const trialActive   = biz.trial_ends_at && new Date(biz.trial_ends_at) > now;
        const subActive     = biz.subscription_active === 1;
        const graceUntil    = biz.subscription_ends_at
          ? new Date(new Date(biz.subscription_ends_at).getTime() + 78 * 24 * 60 * 60 * 1000)
          : null;
        const inGracePeriod = graceUntil && graceUntil > now;
        if (!trialActive && !subActive && !inGracePeriod) {
          await conn.rollback();
          return res.status(403).json({ error: 'Η συνδρομή σας έχει λήξει. Επιλέξτε πλάνο για να συνεχίσετε.' });
        }
        const monthlyLimit = DN_PLAN_LIMITS[biz.plan] ?? -1;
        if (monthlyLimit !== -1) {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          const countFrom  = biz.billing_cycle_started_at && biz.billing_cycle_started_at > monthStart
            ? biz.billing_cycle_started_at
            : monthStart;
          const [[{ cnt }]] = await conn.execute(
            `SELECT COUNT(*) AS cnt FROM delivery_notes
             WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
            [business_id, countFrom]
          );
          // Extra credits — separate query so missing column never blocks DN creation
          let extraCredits = 0;
          try {
            const [[credRow]] = await conn.execute(
              'SELECT extra_dn_credits FROM businesses WHERE id = ? LIMIT 1', [business_id]
            );
            extraCredits = credRow?.extra_dn_credits ?? 0;
          } catch (_) {}
          const effectiveLimit = monthlyLimit + extraCredits;
          if (cnt >= effectiveLimit) {
            await conn.rollback();
            return res.status(403).json({
              error: `Έχετε φτάσει το μηνιαίο όριο των ${monthlyLimit} δελτίων αποστολής για το πλάνο σας.`,
              error_code: 'DN_LIMIT_REACHED',
              monthly_limit: monthlyLimit,
              extra_credits: extraCredits,
              used: cnt,
            });
          }
          // Consume one extra credit if past the base monthly limit
          if (cnt >= monthlyLimit && extraCredits > 0) {
            try {
              await conn.execute(
                'UPDATE businesses SET extra_dn_credits = extra_dn_credits - 1 WHERE id = ?',
                [business_id]
              );
            } catch (_) {}
          }
        }
      }
    }

    // Auto-increment number within business+series
    const [[{ maxNum }]] = await conn.execute(
      'SELECT COALESCE(MAX(number), 0) AS maxNum FROM delivery_notes WHERE business_id = ? AND series = ?',
      [business_id, series]
    );
    const number = maxNum + 1;

    // Insert delivery note — try with client_ref first; fall back without it if
    // the migration hasn't been run yet (ER_BAD_FIELD_ERROR).
    // Params without client_ref (22 values)
    const baseParams = [
      business_id, series, number, issue_date.slice(0, 10),
      dispatch_date ? dispatch_date.slice(0, 10) : null, dispatch_time || null,
      recipient_name, recipient_afm || null, recipient_doy || null,
      recipient_address || null, recipient_city || null, recipient_postal || null, recipient_phone || null,
      dispatch_location || null, delivery_location || null, loading_place || null, transport_purpose || null,
      vehicle_plate || null, for_weighing ? 1 : 0, notes || null, status, req.user.id,
    ];
    try {
      await conn.execute(
        `INSERT INTO delivery_notes
           (id, business_id, series, number, issue_date, dispatch_date, dispatch_time,
            recipient_name, recipient_afm, recipient_doy,
            recipient_address, recipient_city, recipient_postal, recipient_phone,
            dispatch_location, delivery_location, loading_place, transport_purpose,
            vehicle_plate, for_weighing, notes, status, client_ref, created_by, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?,
                 ?, ?, ?,
                 ?, ?, ?, ?,
                 ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        // insert client_ref between status and created_by
        [...baseParams.slice(0, 21), client_ref || null, req.user.id]
      );
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR') {
        // client_ref column doesn't exist yet — insert without it
        await conn.execute(
          `INSERT INTO delivery_notes
             (id, business_id, series, number, issue_date, dispatch_date, dispatch_time,
              recipient_name, recipient_afm, recipient_doy,
              recipient_address, recipient_city, recipient_postal, recipient_phone,
              dispatch_location, delivery_location, loading_place, transport_purpose,
              vehicle_plate, for_weighing, notes, status, created_by, created_at, updated_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?,
                   ?, ?, ?,
                   ?, ?, ?, ?,
                   ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, NOW(), NOW())`,
          baseParams
        );
      } else {
        throw insertErr;
      }
    }

    // Fetch the UUID
    const [[note]] = await conn.execute(
      'SELECT id FROM delivery_notes WHERE business_id = ? AND series = ? AND number = ? LIMIT 1',
      [business_id, series, number]
    );
    const noteId = note.id;

    // Insert lines
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const net = l.net_amount || parseFloat((l.quantity * l.unit_price).toFixed(4));
      await conn.execute(
        `INSERT INTO delivery_note_lines
           (id, delivery_note_id, sort_order, description, quantity, unit, unit_price, vat_rate, net_amount)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [noteId, i, l.description, l.quantity, l.unit || 'kg', l.unit_price || 0, l.vat_rate || 0, net]
      );
    }

    await conn.commit();

    const [[created]] = await pool.execute(
      'SELECT * FROM delivery_notes WHERE id = ? LIMIT 1',
      [noteId]
    );
    const [createdLines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [noteId]
    );

    const fullNumber = `${created.series}${created.number}`;

    res.status(201).json({
      data: { ...created, lines: createdLines },
    });

    // Fire-and-forget: notify owner (user) of new delivery note
    fireNotif(business_id, 'notif_invoice_created', emailSvc.sendDeliveryNoteCreatedNotif, {
      note: {
        full_number:    fullNumber,
        issue_date:     created.issue_date,
        recipient_name: created.recipient_name,
      },
    });

    // Fire-and-forget: notify admin to process delivery note manually via timologio.aade.gr
    (async () => {
      try {
        const [[bizRow]] = await pool.execute(
          'SELECT name, afm FROM businesses WHERE id = ? LIMIT 1',
          [business_id]
        );
        if (bizRow) {
          await emailSvc.sendAdminDeliveryNoteReadyEmail({
            note:         { full_number: fullNumber, issue_date: created.issue_date, recipient_name: created.recipient_name },
            businessName: bizRow.name,
            businessAfm:  bizRow.afm,
          });
        }
      } catch (e) {
        console.error('[delivery-notes] admin notification error:', e.message);
      }
    })();
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ── GET /api/delivery-notes/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const business_id = bizId(req);
    const [[note]] = await pool.execute(
      `SELECT * FROM delivery_notes WHERE id = ? AND (business_id = ? OR ? = 'super_admin') LIMIT 1`,
      [req.params.id, business_id, req.user.role]
    );
    if (!note) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });

    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [note.id]
    );

    res.json({ data: { ...note, lines } });
  } catch (err) { next(err); }
});

// ── PATCH /api/delivery-notes/:id/cancel ──────────────────────────────────────
router.patch('/:id/cancel', async (req, res, next) => {
  try {
    const business_id = bizId(req);
    const [[note]] = await pool.execute(
      `SELECT dn.*, b.name AS biz_name, b.afm AS biz_afm
       FROM delivery_notes dn
       LEFT JOIN businesses b ON b.id = dn.business_id
       WHERE dn.id = ? AND dn.business_id = ? LIMIT 1`,
      [req.params.id, business_id]
    );
    if (!note) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    if (note.status === 'cancelled') return res.status(400).json({ error: 'Ήδη ακυρωμένο.' });

    // ── Cancellation: Wrapp or direct AADE ───────────────────────────────────
    let aadeCancelMark = null;
    let aadeCancelError = null;
    if (note.mydata_mark || note.wrapp_invoice_id) {
      const [[bizRow]] = await pool.execute(
        'SELECT wrapp_enabled FROM businesses WHERE id = ? LIMIT 1', [business_id]
      );
      const useWrapp = bizRow?.wrapp_enabled === 1 && note.wrapp_invoice_id;

      try {
        if (useWrapp) {
          const wrapp = require('../services/wrapp.service');
          const cancelResult = await wrapp.cancelDeliveryNote(note.wrapp_invoice_id, business_id);
          aadeCancelMark = cancelResult.mark;
          console.log(`[cancel DN] Wrapp cancellation OK — wrapp_id: ${note.wrapp_invoice_id}, mark: ${aadeCancelMark}`);
        } else if (note.mydata_mark) {
          const aadeMydata = require('../services/aade-mydata.service');
          const cancelResult = await aadeMydata.cancelDeliveryNote(
            note.mydata_mark, note.biz_afm, business_id
          );
          aadeCancelMark = cancelResult.cancellationMark;
          console.log(`[cancel DN] AADE cancellation OK — mark: ${note.mydata_mark}, cancellationMark: ${aadeCancelMark}`);
        }
      } catch (cancelErr) {
        aadeCancelError = cancelErr.message;
        console.error(`[cancel DN] Cancellation failed:`, aadeCancelError);
        // Do NOT block the local cancellation — record the error in mydata_response
      }
    }

    await pool.execute(
      `UPDATE delivery_notes
       SET status = 'cancelled',
           mydata_response = JSON_MERGE_PATCH(COALESCE(mydata_response, '{}'),
             ${aadeCancelMark
               ? `'${JSON.stringify({ cancellationMark: aadeCancelMark })}'`
               : aadeCancelError
               ? `'${JSON.stringify({ cancelError: aadeCancelError })}'`
               : "'{}'"
             }),
           updated_at = NOW()
       WHERE id = ?`,
      [note.id]
    );

    res.json({
      data: {
        message:           'Το Δελτίο Αποστολής ακυρώθηκε.',
        aade_cancelled:    !!aadeCancelMark,
        cancellation_mark: aadeCancelMark,
        aade_error:        aadeCancelError,
      },
    });

    // Fire-and-forget: owner email notification
    (async () => {
      try {
        const cfg = await emailSvc.loadConfig();
        const adminEmail = cfg.admin_notification_email || process.env.ADMIN_EMAIL;
        await emailSvc.sendDeliveryNoteCancelledAdminEmail({
          note: { ...note, full_number: `${note.series}${note.number}` },
          businessName: note.biz_name || '',
          adminEmail,
        });
      } catch (e) {
        console.error('[cancel delivery note] admin email error:', e.message);
      }
    })();
  } catch (err) { next(err); }
});

// ── POST /api/delivery-notes/:id/transmit ─────────────────────────────────────
// Transmits the delivery note directly to ΑΑΔΕ myDATA (type 9.3).
router.post('/:id/transmit', async (req, res, next) => {
  try {
    const business_id = bizId(req);
    dnlog('INFO', 'transmit() called', { dn_id: req.params.id, business_id });

    const [[note]] = await pool.execute(
      `SELECT dn.*,
              b.afm, b.name AS biz_name, b.address, b.city, b.postal_code, b.phone, b.email, b.doy
       FROM delivery_notes dn
       JOIN businesses b ON b.id = dn.business_id
       WHERE dn.id = ? AND dn.business_id = ? LIMIT 1`,
      [req.params.id, business_id]
    );
    if (!note) {
      dnlog('WARN', 'delivery note not found', { dn_id: req.params.id, business_id });
      return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    }
    dnlog('INFO', 'delivery note fetched', { dn_id: note.id, dn_number: note.note_number, status: note.status, recipient: note.recipient_name });
    if (note.status === 'transmitted') {
      dnlog('WARN', 'already transmitted — aborting', { dn_id: note.id });
      return res.status(400).json({ error: 'Ήδη διαβιβάστηκε στην ΑΑΔΕ.' });
    }
    if (note.status === 'cancelled') {
      dnlog('WARN', 'cancelled note — aborting', { dn_id: note.id });
      return res.status(400).json({ error: 'Ακυρωμένο — δεν μπορεί να διαβιβαστεί.' });
    }

    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [note.id]
    );
    dnlog('DEBUG', 'fetched DN lines', { dn_id: note.id, line_count: lines.length });

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

    // ── Choose provider: Wrapp (if enabled) or direct AADE ───────────────────
    const [[bizRow]] = await pool.execute(
      'SELECT wrapp_enabled, wrapp_api_key FROM businesses WHERE id = ? LIMIT 1', [business_id]
    );
    const useWrapp = bizRow?.wrapp_enabled === 1;
    dnlog('INFO', 'provider check', { business_id, wrapp_enabled: bizRow?.wrapp_enabled, has_wrapp_api_key: !!bizRow?.wrapp_api_key, will_use_wrapp: useWrapp });

    if (useWrapp) {
      dnlog('INFO', 'routing to Wrapp provider', { dn_id: note.id });
      const wrapp = require('../services/wrapp.service');
      let result;
      try {
        result = await wrapp.transmitDeliveryNote(note, lines, biz);
        dnlog('INFO', 'wrapp.transmitDeliveryNote() returned', { dn_id: note.id, mark: result.mark, wrapp_invoice_id: result.wrapp_invoice_id, qrUrl: result.qrUrl });
      } catch (wrappErr) {
        dnlog('ERROR', 'wrapp.transmitDeliveryNote() threw', { dn_id: note.id, error: wrappErr.message, stack: wrappErr.stack?.split('\n').slice(0,3).join(' | ') });
        throw wrappErr;
      }

      await pool.execute(
        `UPDATE delivery_notes
         SET status = 'transmitted', mydata_mark = ?, mydata_uid = ?,
             wrapp_invoice_id = ?, wrapp_mark = ?, wrapp_qr_url = ?,
             mydata_response = ?, transmitted_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [
          result.mark, result.uid || null,
          result.wrapp_invoice_id, result.mark, result.qrUrl || null,
          JSON.stringify({ mark: result.mark, uid: result.uid, qr: result.qrUrl, wrapp_id: result.wrapp_invoice_id, provider: 'wrapp' }),
          note.id,
        ]
      );
      dnlog('INFO', 'DN transmission SUCCESS via Wrapp', { dn_id: note.id, mark: result.mark });

      return res.json({
        data: {
          message: 'Διαβιβάστηκε επιτυχώς μέσω Wrapp.',
          mark:    result.mark,
          uid:     result.uid,
        },
      });
    }

    dnlog('INFO', 'routing to AADE direct provider', { dn_id: note.id, biz_afm: biz.afm });
    const aadeMydata = require('../services/aade-mydata.service');
    let result;
    try {
      result = await aadeMydata.sendDeliveryNote(note, lines, biz, customer, business_id);
      dnlog('INFO', 'aadeMydata.sendDeliveryNote() returned', { dn_id: note.id, mark: result.mark, uid: result.uid, testMode: result.testMode });
    } catch (aadeErr) {
      dnlog('ERROR', 'aadeMydata.sendDeliveryNote() threw', { dn_id: note.id, error: aadeErr.message, stack: aadeErr.stack?.split('\n').slice(0,3).join(' | ') });
      throw aadeErr;
    }

    await pool.execute(
      `UPDATE delivery_notes
       SET status = 'transmitted', mydata_mark = ?, mydata_uid = ?,
           mydata_response = ?, transmitted_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [
        result.mark,
        result.uid || null,
        JSON.stringify({ mark: result.mark, uid: result.uid, env: result.testMode ? 'TEST' : 'PROD' }),
        note.id,
      ]
    );

    dnlog('INFO', 'DN transmission SUCCESS via AADE direct', { dn_id: note.id, mark: result.mark, testMode: result.testMode });
    return res.json({
      data: {
        message:  `Διαβιβάστηκε επιτυχώς${result.testMode ? ' (TEST περιβάλλον)' : ''}.`,
        mark:     result.mark,
        uid:      result.uid,
        testMode: result.testMode,
      },
    });
  } catch (err) {
    const msg = err.message || String(err);
    dnlog('ERROR', 'transmit() caught error — marking DN failed', { dn_id: req.params.id, error: msg });
    await pool.execute(
      "UPDATE delivery_notes SET status = 'failed', mydata_response = ?, updated_at = NOW() WHERE id = ?",
      [JSON.stringify({ error: msg }), req.params.id]
    ).catch(() => {});
    next(err);
  }
});

// ── GET /api/delivery-notes/:id/pdf ──────────────────────────────────────────
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId   = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const [rows] = await pool.execute(
      `SELECT dn.*,
              b.name AS business_name, b.afm AS business_afm
       FROM delivery_notes dn
       LEFT JOIN businesses b ON b.id = dn.business_id
       WHERE dn.id = ? AND (${isSuperAdmin ? '1=1' : 'dn.business_id = ?'}) LIMIT 1`,
      isSuperAdmin ? [id] : [id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });

    const note = rows[0];

    // Serve admin-uploaded PDF via redirect to the static file URL.
    // express.static already serves this path correctly; streaming from within
    // the route handler is unnecessary and risks stream-pipe issues.
    if (note.pdf_path) {
      const uploadedFile = path.join(__dirname, '../../uploads/delivery-notes', `${id}.pdf`);
      if (fs.existsSync(uploadedFile)) {
        return res.redirect(302, `/uploads/delivery-notes/${id}.pdf`);
      }
    }

    // Fall back to auto-generated PDF
    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [id]
    );
    note.lines = lines;

    const fname    = `delivery_note_${note.series || 'A'}-${note.number || id}.pdf`;
    const filePath = await pdfService.generateDeliveryNotePDF(note);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => { if (!res.headersSent) next(err); });
    stream.pipe(res);
    stream.on('end', () => fs.unlink(filePath, () => {}));
  } catch (err) { next(err); }
});

// ── POST /api/delivery-notes/request-extra-credits ────────────────────────────
router.post('/request-extra-credits', async (req, res, next) => {
  try {
    // Accept combined credits (dn_credits + invoice_credits) or legacy single `credits` field
    const dnCredits  = Number(req.body.dn_credits  ?? req.body.credits ?? 0);
    const invCredits = Number(req.body.invoice_credits ?? 0);
    const amount_eur = Number(req.body.amount_eur) || 0;
    const { notes }  = req.body;

    const validCombos = [10, 20, 30]; // valid per-type credit amounts
    if (!validCombos.includes(dnCredits) && !validCombos.includes(invCredits))
      return res.status(400).json({ error: 'Επιλέξτε έγκυρο πακέτο πιστώσεων.' });

    const business_id = req.user.business_id;
    if (!business_id)
      return res.status(400).json({ error: 'Δεν βρέθηκε επιχείρηση.' });

    const id = require('crypto').randomUUID();
    await pool.execute(
      `INSERT INTO dn_credit_requests (id, business_id, credits, invoice_credits, amount_eur, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [id, business_id, dnCredits, invCredits, amount_eur, notes || null]
    );

    // Notify admin
    try {
      const [[biz]] = await pool.execute(
        'SELECT name, afm FROM businesses WHERE id = ? LIMIT 1', [business_id]
      );
      const summary = [
        dnCredits  > 0 ? `${dnCredits} δελτία αποστολής` : null,
        invCredits > 0 ? `${invCredits} τιμολόγια`        : null,
      ].filter(Boolean).join(' + ');
      await emailSvc.notifyAdmin(
        `Νέο αίτημα αγοράς επιπλέον πιστώσεων`,
        `<p>Η επιχείρηση <strong>${biz?.name || business_id}</strong> (ΑΦΜ: ${biz?.afm || '—'}) ζητά επιπλέον: <strong>${summary}</strong>.</p>
         <p>Συνδεθείτε στο admin panel για να εγκρίνετε το αίτημα.</p>`
      );
    } catch (_) {}

    res.status(201).json({ data: { id, message: 'Το αίτημά σας καταχωρήθηκε. Ο διαχειριστής θα το επεξεργαστεί σύντομα.' } });
  } catch (err) { next(err); }
});

// ── GET /api/delivery-notes/extra-credits — current extra credits balance ─────
router.get('/extra-credits', async (req, res, next) => {
  try {
    const business_id = req.user.business_id;
    if (!business_id) return res.json({ extra_credits: 0 });
    const [[biz]] = await pool.execute(
      'SELECT extra_dn_credits FROM businesses WHERE id = ? LIMIT 1', [business_id]
    );
    res.json({ extra_credits: biz?.extra_dn_credits ?? 0 });
  } catch (err) { next(err); }
});

module.exports = router;
