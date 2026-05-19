const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireOwnerOrAbove } = require('../middleware/role');

router.use(authenticate, requireOwnerOrAbove);

// ---------------------------------------------------------------------------
// GET /api/logs  — audit logs with filters
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (!isSuperAdmin) {
      conditions.push('a.business_id = ?');
      params.push(businessId);
    } else if (req.query.business_id) {
      conditions.push('a.business_id = ?');
      params.push(req.query.business_id);
    }

    if (req.query.action)  { conditions.push('a.action = ?');       params.push(req.query.action); }
    if (req.query.user_id) { conditions.push('a.user_id = ?');      params.push(req.query.user_id); }
    if (req.query.from)    { conditions.push('a.created_at >= ?');   params.push(req.query.from); }
    if (req.query.to)      { conditions.push('a.created_at <= ?');   params.push(req.query.to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM audit_logs a ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT
         a.id, a.action, a.entity_type, a.entity_id, a.description,
         a.ip_address, a.created_at,
         u.full_name AS user_name, u.email AS user_email,
         b.name AS business_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN businesses b ON b.id = a.business_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/logs/transmission  — transmission logs
// ---------------------------------------------------------------------------
router.get('/transmission', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (!isSuperAdmin) {
      conditions.push('i.business_id = ?');
      params.push(businessId);
    } else if (req.query.business_id) {
      conditions.push('i.business_id = ?');
      params.push(req.query.business_id);
    }

    if (req.query.status === 'success')  { conditions.push('t.success = 1'); }
    else if (req.query.status === 'failed') { conditions.push('t.success = 0'); }
    if (req.query.invoice_id) { conditions.push('t.invoice_id = ?');    params.push(req.query.invoice_id); }
    if (req.query.from)       { conditions.push('t.attempted_at >= ?'); params.push(req.query.from); }
    if (req.query.to)         { conditions.push('t.attempted_at <= ?'); params.push(req.query.to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM transmission_logs t
       LEFT JOIN invoices i ON i.id = t.invoice_id
       ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT
         t.id, t.invoice_id, t.provider, t.attempt_number,
         IF(t.success = 1, 'success', 'failed') AS status,
         t.http_status AS response_code,
         COALESCE(t.error_message, LEFT(t.response_body, 500)) AS response_message,
         t.mydata_mark AS mark,
         t.attempted_at, t.duration_ms,
         i.full_number AS invoice_number,
         b.name AS business_name
       FROM transmission_logs t
       LEFT JOIN invoices i ON i.id = t.invoice_id
       LEFT JOIN businesses b ON b.id = i.business_id
       ${where}
       ORDER BY t.attempted_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
});


// ---------------------------------------------------------------------------
// POST /api/logs/purge  — super_admin only: export then delete old logs
// body: { type: 'audit'|'transmission'|'both', older_than_months: 3|6|12 }
// Returns a JSON summary + base64-encoded CSV content for local download
// ---------------------------------------------------------------------------
router.post('/purge', async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Μόνο ο Super Admin μπορεί να εκτελέσει αυτή την ενέργεια.' });
    }

    const { type = 'both', older_than_months = 6 } = req.body;
    const months = Math.max(1, Math.min(24, parseInt(older_than_months) || 6));
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

    const files = [];

    // ── Export + purge audit_logs ──────────────────────────────────────────
    if (type === 'audit' || type === 'both') {
      const [auditRows] = await pool.execute(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.description,
                a.ip_address, a.created_at,
                u.full_name AS user_name, u.email AS user_email,
                b.name AS business_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN businesses b ON b.id = a.business_id
         WHERE a.created_at < ?
         ORDER BY a.created_at ASC`,
        [cutoffStr]
      );

      if (auditRows.length > 0) {
        const headers = ['ID','Action','Entity Type','Entity ID','Description','IP Address','User','Email','Business','Created At'];
        const csvLines = [headers.join(',')];
        for (const r of auditRows) {
          csvLines.push([
            r.id,
            `"${(r.action||'').replace(/"/g,'""')}"`,
            `"${(r.entity_type||'').replace(/"/g,'""')}"`,
            r.entity_id || '',
            `"${(r.description||'').replace(/"/g,'""')}"`,
            r.ip_address || '',
            `"${(r.user_name||'').replace(/"/g,'""')}"`,
            r.user_email || '',
            `"${(r.business_name||'').replace(/"/g,'""')}"`,
            r.created_at ? String(r.created_at).slice(0,19) : '',
          ].join(','));
        }
        const csv = csvLines.join('\n');
        const label = `audit_logs_before_${cutoff.toISOString().slice(0,10)}`;
        files.push({ filename: `${label}.txt`, content: Buffer.from(csv).toString('base64'), rows: auditRows.length });

        await pool.execute('DELETE FROM audit_logs WHERE created_at < ?', [cutoffStr]);
      } else {
        files.push({ filename: 'audit_logs.txt', content: null, rows: 0 });
      }
    }

    // ── Export + purge transmission_logs ──────────────────────────────────
    if (type === 'transmission' || type === 'both') {
      const [transRows] = await pool.execute(
        `SELECT t.id, t.invoice_id, IF(t.success=1,'success','failed') AS status,
                t.http_status, t.error_message, t.mydata_mark, t.attempted_at,
                i.full_number AS invoice_number, b.name AS business_name
         FROM transmission_logs t
         LEFT JOIN invoices i ON i.id = t.invoice_id
         LEFT JOIN businesses b ON b.id = i.business_id
         WHERE t.attempted_at < ?
         ORDER BY t.attempted_at ASC`,
        [cutoffStr]
      );

      if (transRows.length > 0) {
        const headers = ['ID','Invoice ID','Invoice Number','Status','HTTP Status','Error','MARK','Business','Attempted At'];
        const csvLines = [headers.join(',')];
        for (const r of transRows) {
          csvLines.push([
            r.id,
            r.invoice_id,
            `"${(r.invoice_number||'').replace(/"/g,'""')}"`,
            r.status,
            r.http_status || '',
            `"${(r.error_message||'').replace(/"/g,'""')}"`,
            r.mydata_mark || '',
            `"${(r.business_name||'').replace(/"/g,'""')}"`,
            r.attempted_at ? String(r.attempted_at).slice(0,19) : '',
          ].join(','));
        }
        const csv = csvLines.join('\n');
        const label = `transmission_logs_before_${cutoff.toISOString().slice(0,10)}`;
        files.push({ filename: `${label}.txt`, content: Buffer.from(csv).toString('base64'), rows: transRows.length });

        await pool.execute('DELETE FROM transmission_logs WHERE attempted_at < ?', [cutoffStr]);
      } else {
        files.push({ filename: 'transmission_logs.txt', content: null, rows: 0 });
      }
    }

    res.json({ data: { files, cutoff: cutoffStr, months } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
