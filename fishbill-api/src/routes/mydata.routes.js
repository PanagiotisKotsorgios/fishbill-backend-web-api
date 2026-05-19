/**
 * myDATA Platform Routes — /api/mydata
 *
 * GET  /api/mydata/config           (super_admin) — read platform myDATA credentials
 * POST /api/mydata/config           (super_admin) — save platform myDATA credentials
 * POST /api/mydata/test             (super_admin) — test ΑΑΔΕ connection
 * GET  /api/mydata/xml/delivery-note/:id          — preview XML that would be sent
 * POST /api/mydata/transmit/delivery-note/:id     — transmit delivery note to ΑΑΔΕ
 * POST /api/mydata/transmit/invoice/:id           — transmit invoice to ΑΑΔΕ
 */

const express  = require('express');
const router   = express.Router();
const pool     = require('../config/database');
const { authenticate }      = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/role');
const mydataSvc = require('../services/mydata.service');

router.use(authenticate);

// ── GET /api/mydata/config ────────────────────────────────────────────────────
router.get('/config', requireSuperAdmin, async (req, res, next) => {
  try {
    const cfg = await mydataSvc.getPlatformConfig();
    // Mask the subscription key except last 4 chars
    const masked = cfg.subscriptionKey
      ? cfg.subscriptionKey.slice(0, -4).replace(/./g, '•') + cfg.subscriptionKey.slice(-4)
      : '';
    res.json({
      data: {
        user_id:          cfg.userId,
        subscription_key: masked,
        has_key:          !!cfg.subscriptionKey,
        environment:      cfg.environment,
        base_url:         mydataSvc.ENDPOINTS[cfg.environment] || mydataSvc.ENDPOINTS.test,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/mydata/config ───────────────────────────────────────────────────
router.post('/config', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, subscription_key, environment } = req.body;

    if (!user_id || !subscription_key) {
      return res.status(400).json({ error: 'user_id και subscription_key απαιτούνται.' });
    }
    if (!['test', 'production'].includes(environment)) {
      return res.status(400).json({ error: 'environment πρέπει να είναι "test" ή "production".' });
    }

    await mydataSvc.savePlatformConfig({
      userId:          user_id.trim(),
      subscriptionKey: subscription_key.trim(),
      environment,
    });

    res.json({
      data: {
        ok:          true,
        environment,
        base_url:    mydataSvc.ENDPOINTS[environment],
        message:     'Τα credentials αποθηκεύτηκαν επιτυχώς.',
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/mydata/test ─────────────────────────────────────────────────────
router.post('/test', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await mydataSvc.testConnection();
    res.json({ data: { ...result, message: `Σύνδεση επιτυχής (${result.environment})!` } });
  } catch (err) {
    // Return structured error instead of 500 so UI can display it nicely
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/mydata/xml/delivery-note/:id ─────────────────────────────────────
// Preview the XML that would be sent — useful for debugging
router.get('/xml/delivery-note/:id', async (req, res, next) => {
  try {
    const bizId = req.user.business_id;
    const isAdmin = req.user.role === 'super_admin';

    const [[note]] = await pool.execute(
      `SELECT dn.*, b.afm, b.name AS biz_name, 0 AS branch
       FROM delivery_notes dn
       JOIN businesses b ON b.id = dn.business_id
       WHERE dn.id = ? AND (dn.business_id = ? OR ?)
       LIMIT 1`,
      [req.params.id, bizId, isAdmin ? 1 : 0]
    );
    if (!note) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });

    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [note.id]
    );

    const xml = mydataSvc.buildDeliveryNoteXml(note, note, lines);
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.send(xml);
  } catch (err) { next(err); }
});

// ── POST /api/mydata/transmit/delivery-note/:id ───────────────────────────────
router.post('/transmit/delivery-note/:id', async (req, res, next) => {
  try {
    const bizId   = req.user.business_id;
    const isAdmin = req.user.role === 'super_admin';

    const [[note]] = await pool.execute(
      `SELECT dn.*, b.afm, b.name AS biz_name, 0 AS branch
       FROM delivery_notes dn
       JOIN businesses b ON b.id = dn.business_id
       WHERE dn.id = ? AND (dn.business_id = ? OR ?)
       LIMIT 1`,
      [req.params.id, bizId, isAdmin ? 1 : 0]
    );
    if (!note) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    if (note.status === 'transmitted') return res.status(400).json({ error: 'Ήδη έχει διαβιβαστεί στην ΑΑΔΕ.' });
    if (note.status === 'cancelled')  return res.status(400).json({ error: 'Ακυρωμένο δελτίο — δεν επιτρέπεται διαβίβαση.' });

    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [note.id]
    );

    // Transmit via platform credentials
    const result = await mydataSvc.transmitDeliveryNote({ note, biz: note, lines });

    // Save MARK + UID to DB
    if (result.mark) {
      await pool.execute(
        `UPDATE delivery_notes
         SET status = 'transmitted', mydata_mark = ?, mydata_uid = ?,
             mydata_response = ?, transmitted_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [result.mark, result.uid || null, JSON.stringify({ mark: result.mark, uid: result.uid, env: result.environment }), note.id]
      );
    }

    // Log
    try {
      await pool.execute(
        `INSERT INTO integration_logs (business_id, service, event_type, status, request_ref, recipient, meta)
         VALUES (?, 'mydata', 'delivery_note_transmitted', 'success', ?, NULL, ?)`,
        [note.business_id, result.mark, JSON.stringify({ dn_id: note.id, mark: result.mark, env: result.environment })]
      );
    } catch (_) {}

    res.json({
      data: {
        ok:          true,
        mark:        result.mark,
        uid:         result.uid,
        environment: result.environment,
        message:     `Το δελτίο διαβιβάστηκε επιτυχώς στην ΑΑΔΕ${result.environment === 'test' ? ' (TEST περιβάλλον)' : ''}.`,
      },
    });
  } catch (err) {
    // Log failure
    try {
      await pool.execute(
        `INSERT INTO integration_logs (business_id, service, event_type, status, error_msg, meta)
         VALUES (?, 'mydata', 'delivery_note_transmitted', 'failed', ?, ?)`,
        [req.user.business_id, err.message, JSON.stringify({ dn_id: req.params.id })]
      );
    } catch (_) {}
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/mydata/transmit/invoice/:id ─────────────────────────────────────
router.post('/transmit/invoice/:id', async (req, res, next) => {
  try {
    const bizId   = req.user.business_id;
    const isAdmin = req.user.role === 'super_admin';

    const [[invoice]] = await pool.execute(
      `SELECT i.*, b.afm, b.name AS biz_name, 0 AS branch,
              c.afm AS customer_afm, c.name AS customer_name, c.country AS customer_country
       FROM invoices i
       JOIN businesses b ON b.id = i.business_id
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.id = ? AND (i.business_id = ? OR ?)
       LIMIT 1`,
      [req.params.id, bizId, isAdmin ? 1 : 0]
    );
    if (!invoice) return res.status(404).json({ error: 'Τιμολόγιο δεν βρέθηκε.' });
    if (invoice.mydata_mark) return res.status(400).json({ error: `Ήδη έχει MARK: ${invoice.mydata_mark}` });
    if (invoice.status === 'cancelled') return res.status(400).json({ error: 'Ακυρωμένο τιμολόγιο.' });

    const [lines] = await pool.execute(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id',
      [invoice.id]
    );

    const result = await mydataSvc.transmitInvoice({ invoice, biz: invoice, lines });

    if (result.mark) {
      await pool.execute(
        `UPDATE invoices
         SET mydata_mark = ?, mydata_uid = ?, status = 'transmitted',
             transmitted_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [result.mark, result.uid || null, invoice.id]
      );
    }

    try {
      await pool.execute(
        `INSERT INTO integration_logs (business_id, service, event_type, status, request_ref, meta)
         VALUES (?, 'mydata', 'invoice_transmitted', 'success', ?, ?)`,
        [invoice.business_id, result.mark, JSON.stringify({ invoice_id: invoice.id, mark: result.mark, env: result.environment })]
      );
    } catch (_) {}

    res.json({
      data: {
        ok:          true,
        mark:        result.mark,
        uid:         result.uid,
        environment: result.environment,
        message:     `Το τιμολόγιο διαβιβάστηκε${result.environment === 'test' ? ' (TEST)' : ''}.`,
      },
    });
  } catch (err) {
    try {
      await pool.execute(
        `INSERT INTO integration_logs (business_id, service, event_type, status, error_msg, meta)
         VALUES (?, 'mydata', 'invoice_transmitted', 'failed', ?, ?)`,
        [req.user.business_id, err.message, JSON.stringify({ invoice_id: req.params.id })]
      );
    } catch (_) {}
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
