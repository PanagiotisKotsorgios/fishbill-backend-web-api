/**
 * Employee Actions Routes — /api/employee-actions
 * Allows employees with specific admin privileges to work on:
 *   - Delivery Notes  (requires admin_delivery_notes)
 *   - Credentials     (requires admin_credentials)
 * All data is automatically scoped to the employee's assigned businesses.
 * Super admins also have access with no scoping restriction.
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

router.use(authenticate);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getEmployeeBizIds(userId) {
  const [rows] = await pool.execute(
    'SELECT business_id FROM employee_businesses WHERE employee_id = ?', [userId]
  );
  return rows.map(r => r.business_id);
}

async function hasPrivilege(userId, privilege) {
  const [[row]] = await pool.execute(
    'SELECT privileges FROM employee_privileges WHERE user_id = ?', [userId]
  );
  if (!row) return false;
  return JSON.parse(row.privileges || '[]').includes(privilege);
}

// Returns middleware that allows super_admin freely, or employee with the given privilege.
// Sets req.scopedBizIds for employees (null means no restriction for super_admin).
function requirePrivilege(privilege) {
  return async (req, res, next) => {
    if (req.user.role === 'super_admin') {
      req.scopedBizIds = null; // no restriction
      return next();
    }
    if (req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Δεν επιτρέπεται.' });
    }
    const ok = await hasPrivilege(req.user.id, privilege).catch(() => false);
    if (!ok) return res.status(403).json({ error: 'Δεν έχετε πρόσβαση σε αυτή τη λειτουργία.' });
    const bizIds = await getEmployeeBizIds(req.user.id);
    if (!bizIds.length) return res.status(403).json({ error: 'Δεν σας έχουν ανατεθεί επιχειρήσεις.' });
    req.scopedBizIds = bizIds;
    next();
  };
}

// Adds employee scoping clause to an existing WHERE string.
// If super_admin (scopedBizIds === null) and optional business_id param: filter by that.
// If employee: restrict to their bizIds (AND optionally the specific business_id if it's in their set).
function buildBizScope(req, alias, extraBizId) {
  const parts  = [];
  const params = [];
  if (req.scopedBizIds) {
    const ph = req.scopedBizIds.map(() => '?').join(',');
    parts.push(`${alias}.business_id IN (${ph})`);
    params.push(...req.scopedBizIds);
  }
  if (extraBizId && (!req.scopedBizIds || req.scopedBizIds.includes(extraBizId))) {
    parts.push(`${alias}.business_id = ?`);
    params.push(extraBizId);
  }
  return { clause: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

// ── Multer for delivery-note PDF uploads ──────────────────────────────────────

const dnUploadDir = path.join(__dirname, '../../uploads/delivery-notes');
if (!fs.existsSync(dnUploadDir)) fs.mkdirSync(dnUploadDir, { recursive: true });

const dnPdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, dnUploadDir),
    filename:    (req, file, cb) => cb(null, `${req.params.id}.pdf`),
  }),
  limits:     { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Μόνο PDF αρχεία επιτρέπονται.'));
  },
});

// ── DELIVERY NOTES ────────────────────────────────────────────────────────────

const DN_PRIV = 'admin_delivery_notes';

// GET /api/employee-actions/delivery-notes/users-summary
router.get('/delivery-notes/users-summary', requirePrivilege(DN_PRIV), async (req, res, next) => {
  try {
    let whereClause = '';
    const params = [];
    if (req.scopedBizIds) {
      whereClause = `WHERE b.id IN (${req.scopedBizIds.map(() => '?').join(',')})`;
      params.push(...req.scopedBizIds);
    }

    const [rows] = await pool.query(`
      SELECT
        b.id AS business_id, b.name AS business_name, b.afm AS business_afm,
        u.email AS owner_email, b.plan, b.subscription_active,
        SUM(CASE WHEN dn.status IN ('draft','issued','failed') AND (dn.mydata_mark IS NULL OR dn.mydata_mark='') THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN dn.mydata_mark IS NOT NULL AND dn.mydata_mark!='' THEN 1 ELSE 0 END) AS transmitted_count,
        SUM(CASE WHEN dn.status='cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
        MAX(dn.created_at) AS last_note_at
      FROM businesses b
      LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
      LEFT JOIN delivery_notes dn ON dn.business_id = b.id
      ${whereClause}
      GROUP BY b.id, b.name, b.afm, u.email, b.plan, b.subscription_active
      HAVING (pending_count > 0 OR transmitted_count > 0 OR cancelled_count > 0)
      ORDER BY pending_count DESC, last_note_at DESC
    `, params);

    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/employee-actions/delivery-notes/pending
router.get('/delivery-notes/pending', requirePrivilege(DN_PRIV), async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 30);
    const offset = (page - 1) * limit;
    const { search, month, sort, business_id } = req.query;

    let where  = `WHERE dn.status IN ('draft','issued','failed') AND (dn.mydata_mark IS NULL OR dn.mydata_mark='')`;
    const params = [];

    if (req.scopedBizIds) {
      where += ` AND dn.business_id IN (${req.scopedBizIds.map(() => '?').join(',')})`;
      params.push(...req.scopedBizIds);
    }
    if (business_id) { where += ' AND dn.business_id = ?'; params.push(business_id); }
    if (search) {
      where += ' AND (CONCAT(dn.series, dn.number) LIKE ? OR dn.recipient_name LIKE ? OR b.name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (month) { where += " AND DATE_FORMAT(dn.issue_date,'%Y-%m') = ?"; params.push(month); }

    const orderMap = { date_asc:'dn.created_at ASC', date_desc:'dn.created_at DESC', business:'b.name ASC, dn.created_at ASC' };
    const orderBy  = orderMap[sort] || 'dn.created_at ASC';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM delivery_notes dn JOIN businesses b ON b.id=dn.business_id ${where}`, params
    );
    const [rows] = await pool.execute(
      `SELECT dn.id, dn.series, dn.number, CONCAT(dn.series,dn.number) AS full_number,
              dn.issue_date, dn.recipient_name, dn.recipient_afm, dn.recipient_city,
              dn.vehicle_plate, dn.dispatch_location, dn.delivery_location,
              dn.notes, dn.status, dn.mydata_mark, dn.created_at,
              b.id AS business_id, b.name AS business_name, b.afm AS business_afm
       FROM delivery_notes dn JOIN businesses b ON b.id=dn.business_id
       ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params
    );
    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) { next(err); }
});

// GET /api/employee-actions/delivery-notes/transmitted
router.get('/delivery-notes/transmitted', requirePrivilege(DN_PRIV), async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 30);
    const offset = (page - 1) * limit;
    const { search, month, sort, business_id } = req.query;

    let where  = `WHERE dn.mydata_mark IS NOT NULL AND dn.mydata_mark!=''`;
    const params = [];

    if (req.scopedBizIds) {
      where += ` AND dn.business_id IN (${req.scopedBizIds.map(() => '?').join(',')})`;
      params.push(...req.scopedBizIds);
    }
    if (business_id) { where += ' AND dn.business_id = ?'; params.push(business_id); }
    if (search) {
      where += ' AND (CONCAT(dn.series,dn.number) LIKE ? OR dn.recipient_name LIKE ? OR b.name LIKE ? OR dn.mydata_mark LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (month) { where += " AND DATE_FORMAT(dn.issue_date,'%Y-%m') = ?"; params.push(month); }

    const orderMap = {
      date_desc: 'dn.transmitted_at DESC, dn.created_at DESC',
      date_asc:  'dn.transmitted_at ASC,  dn.created_at ASC',
      business:  'b.name ASC, dn.transmitted_at DESC',
    };
    const orderBy = orderMap[sort] || 'dn.transmitted_at DESC, dn.created_at DESC';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM delivery_notes dn JOIN businesses b ON b.id=dn.business_id ${where}`, params
    );
    const [rows] = await pool.execute(
      `SELECT dn.id, dn.series, dn.number, CONCAT(dn.series,dn.number) AS full_number,
              dn.issue_date, dn.recipient_name, dn.recipient_afm, dn.recipient_city,
              dn.vehicle_plate, dn.dispatch_location, dn.delivery_location,
              dn.notes, dn.status, dn.mydata_mark, dn.mydata_uid, dn.transmitted_at, dn.created_at,
              b.id AS business_id, b.name AS business_name, b.afm AS business_afm
       FROM delivery_notes dn JOIN businesses b ON b.id=dn.business_id
       ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params
    );
    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) { next(err); }
});

// PATCH /api/employee-actions/delivery-notes/:id/mark
router.patch('/delivery-notes/:id/mark', requirePrivilege(DN_PRIV), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { mark, qr_url } = req.body;
    if (!mark || !String(mark).trim()) return res.status(400).json({ error: 'Απαιτείται αριθμός MARK.' });

    const [[dn]] = await pool.execute(
      'SELECT id, business_id FROM delivery_notes WHERE id = ? LIMIT 1', [id]
    );
    if (!dn) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    if (req.scopedBizIds && !req.scopedBizIds.includes(dn.business_id))
      return res.status(403).json({ error: 'Δεν έχετε πρόσβαση σε αυτό το δελτίο.' });

    await pool.execute(
      `UPDATE delivery_notes SET mydata_mark=?, mydata_uid=?, status='transmitted', transmitted_at=NOW(), updated_at=NOW() WHERE id=?`,
      [String(mark).trim(), qr_url || null, id]
    );
    res.json({ data: { message: 'MARK καταχωρήθηκε επιτυχώς.' } });
  } catch (err) { next(err); }
});

// POST /api/employee-actions/delivery-notes/:id/transmit
router.post('/delivery-notes/:id/transmit', requirePrivilege(DN_PRIV), async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[note]] = await pool.execute(
      `SELECT dn.*, b.afm, b.name AS biz_name, b.address, b.city, b.postal_code, b.phone, b.email, b.doy
       FROM delivery_notes dn JOIN businesses b ON b.id=dn.business_id WHERE dn.id=? LIMIT 1`, [id]
    );
    if (!note) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    if (req.scopedBizIds && !req.scopedBizIds.includes(note.business_id))
      return res.status(403).json({ error: 'Δεν έχετε πρόσβαση σε αυτό το δελτίο.' });
    if (note.status === 'transmitted') return res.status(400).json({ error: 'Ήδη διαβιβάστηκε.' });
    if (note.status === 'cancelled')  return res.status(400).json({ error: 'Ακυρωμένο.' });

    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id=? ORDER BY sort_order', [note.id]
    );
    const biz      = { afm: note.afm, name: note.biz_name, address: note.address, city: note.city, postal_code: note.postal_code };
    const customer = {
      name: note.recipient_name, afm: note.recipient_afm || '000000000',
      address: note.recipient_address || '', city: note.recipient_city || '',
      postal_code: note.recipient_postal || '',
    };

    const aadeMydata = require('../services/aade-mydata.service');
    const result = await aadeMydata.sendDeliveryNote(note, lines, biz, customer, note.business_id);

    await pool.execute(
      `UPDATE delivery_notes SET status='transmitted', mydata_mark=?, mydata_uid=?, mydata_response=?, transmitted_at=NOW(), updated_at=NOW() WHERE id=?`,
      [result.mark, result.uid || null, JSON.stringify({ mark: result.mark, uid: result.uid, env: result.testMode ? 'TEST' : 'PROD' }), note.id]
    );
    res.json({ data: { message: `Διαβιβάστηκε επιτυχώς${result.testMode ? ' (TEST)' : ''}.`, mark: result.mark, uid: result.uid } });
  } catch (err) {
    await pool.execute(
      "UPDATE delivery_notes SET status='failed', mydata_response=?, updated_at=NOW() WHERE id=?",
      [JSON.stringify({ error: err.message }), req.params.id]
    ).catch(() => {});
    next(err);
  }
});

// PATCH /api/employee-actions/delivery-notes/:id/cancel
router.patch('/delivery-notes/:id/cancel', requirePrivilege(DN_PRIV), async (req, res, next) => {
  try {
    const [[dn]] = await pool.execute('SELECT id, business_id, status FROM delivery_notes WHERE id=? LIMIT 1', [req.params.id]);
    if (!dn) return res.status(404).json({ error: 'Δελτίο αποστολής δεν βρέθηκε.' });
    if (req.scopedBizIds && !req.scopedBizIds.includes(dn.business_id))
      return res.status(403).json({ error: 'Δεν έχετε πρόσβαση σε αυτό το δελτίο.' });
    if (dn.status === 'cancelled') return res.status(400).json({ error: 'Ήδη ακυρωμένο.' });
    await pool.execute("UPDATE delivery_notes SET status='cancelled', updated_at=NOW() WHERE id=?", [req.params.id]);
    res.json({ data: { message: 'Το Δελτίο Αποστολής ακυρώθηκε.' } });
  } catch (err) { next(err); }
});

// POST /api/employee-actions/delivery-notes/:id/upload-pdf
router.post('/delivery-notes/:id/upload-pdf', requirePrivilege(DN_PRIV), dnPdfUpload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Δεν επιλέχτηκε αρχείο PDF.' });

    if (req.scopedBizIds) {
      const [[dn]] = await pool.execute('SELECT business_id FROM delivery_notes WHERE id=? LIMIT 1', [req.params.id]);
      if (!dn || !req.scopedBizIds.includes(dn.business_id))
        return res.status(403).json({ error: 'Δεν έχετε πρόσβαση σε αυτό το δελτίο.' });
    }

    const publicPath = `/uploads/delivery-notes/${req.params.id}.pdf`;
    try {
      await pool.execute('UPDATE delivery_notes SET pdf_path=?, updated_at=NOW() WHERE id=?', [publicPath, req.params.id]);
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        await pool.execute('ALTER TABLE delivery_notes ADD COLUMN pdf_path VARCHAR(500) NULL DEFAULT NULL');
        await pool.execute('UPDATE delivery_notes SET pdf_path=?, updated_at=NOW() WHERE id=?', [publicPath, req.params.id]);
      } else throw e;
    }
    res.json({ data: { pdf_path: publicPath, message: 'PDF ανέβηκε επιτυχώς.' } });
  } catch (err) { next(err); }
});

module.exports = router;
