const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/role');


// ---------------------------------------------------------------------------
// GET /api/backups/:id/download  — token via query param (for window.open)
// ---------------------------------------------------------------------------
router.get('/:id/download', async (req, res, next) => {
  try {
    // Accept token from query param (since this is opened in a new tab)
    const token = req.query.token;
    if (!token) {
      return res.status(401).json({ error: 'Token απαιτείται.' });
    }

    let decoded;
    try {
      const jwt = require('jsonwebtoken');
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Μη έγκυρο ή ληγμένο token.' });
    }

    // Only super_admin can download backups
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({ error: 'Μόνο ο super admin μπορεί να κατεβάσει backups.' });
    }

    const { id } = req.params;
    const [rows] = await pool.execute(
      'SELECT * FROM backup_logs WHERE id = ? LIMIT 1',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Backup not found.' });
    }

    const backup = rows[0];

    if (backup.status !== 'success') {
      return res.status(400).json({ error: 'Το backup δεν είναι διαθέσιμο για λήψη.' });
    }

    if (!backup.file_path || !fs.existsSync(backup.file_path)) {
      return res.status(404).json({ error: 'Το αρχείο backup δεν βρέθηκε στον δίσκο.' });
    }

    const filename = path.basename(backup.file_path);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.resolve(backup.file_path));
  } catch (err) {
    next(err);
  }
});

router.use(authenticate, requireSuperAdmin);

// ---------------------------------------------------------------------------
// GET /api/backups  — list backup logs
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [countRows] = await pool.execute('SELECT COUNT(*) AS total FROM backup_logs', []);

    const [rows] = await pool.execute(
      `SELECT bl.*, u.full_name AS initiated_by_name
       FROM backup_logs bl
       LEFT JOIN users u ON u.id = bl.initiated_by
       ORDER BY bl.started_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      []
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/backups  — run a backup (also aliased as /run for legacy)
// ---------------------------------------------------------------------------
router.post('/', async (req, res, next) => {
  // Insert a record immediately so we can return the job ID
  let backupLogId;
  try {
    const [insertResult] = await pool.execute(
      `INSERT INTO backup_logs
         (status, initiated_by, started_at)
       VALUES ('running', ?, NOW())`,
      [req.user.id]
    );
    backupLogId = insertResult.insertId;
  } catch (err) {
    return next(err);
  }

  // Respond immediately — backup runs asynchronously
  res.status(202).json({
    data: {
      message: 'Backup started.',
      backup_id: backupLogId,
    },
  });

  // Run the actual backup in the background
  setImmediate(async () => {
    try {
      const backupDir = path.resolve('./backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `backup_${timestamp}.json`;
      const filePath = path.join(backupDir, fileName);

      // Export key tables to JSON
      const [businesses] = await pool.execute('SELECT * FROM businesses', []);
      const [users] = await pool.execute(
        'SELECT id, business_id, full_name, email, role, is_active, created_at FROM users',
        []
      );
      const [customers] = await pool.execute('SELECT * FROM customers', []);
      const [products] = await pool.execute('SELECT * FROM products', []);
      const [invoices] = await pool.execute('SELECT * FROM invoices', []);
      const [invoiceLines] = await pool.execute('SELECT * FROM invoice_lines', []);

      const backupData = {
        exported_at: new Date().toISOString(),
        version: '1.0',
        tables: {
          businesses,
          users,
          customers,
          products,
          invoices,
          invoice_lines: invoiceLines,
        },
      };

      fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');

      const stats = fs.statSync(filePath);

      await pool.execute(
        `UPDATE backup_logs
         SET status = 'success', file_path = ?, file_size = ?, completed_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [filePath, stats.size, backupLogId]
      );

      console.log(`[Backup] Backup #${backupLogId} completed: ${filePath}`);
    } catch (err) {
      console.error(`[Backup] Backup #${backupLogId} failed:`, err.message);
      try {
        await pool.execute(
          `UPDATE backup_logs
           SET status = 'failed', error_message = ?, completed_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [err.message, backupLogId]
        );
      } catch (updateErr) {
        console.error('[Backup] Failed to update backup log:', updateErr.message);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/backups/:id/restore  — super admin only
// ---------------------------------------------------------------------------
router.post('/:id/restore', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    const [[backup]] = await pool.execute(
      'SELECT * FROM backup_logs WHERE id = ? LIMIT 1', [id]
    );
    if (!backup)                       return res.status(404).json({ error: 'Backup not found.' });
    if (backup.status !== 'success')   return res.status(400).json({ error: 'Only successful backups can be restored.' });
    if (!backup.file_path || !fs.existsSync(backup.file_path))
      return res.status(400).json({ error: 'Backup file not found on disk.' });

    const raw  = fs.readFileSync(backup.file_path, 'utf-8');
    const data = JSON.parse(raw);
    if (!data?.tables) return res.status(400).json({ error: 'Invalid backup format — missing tables.' });

    const { tables } = data;
    const stats = {};

    // Helper: bulk-insert an array of row objects into a table.
    // Uses chunks of 50 to avoid huge parameter lists.
    async function restoreTable(tableName, rows, strategy = 'truncate') {
      if (!rows?.length) { stats[tableName] = 0; return; }
      if (strategy === 'truncate') {
        await conn.execute(`DELETE FROM \`${tableName}\``);
      }
      const cols = Object.keys(rows[0]);
      const colsSql = cols.map(c => `\`${c}\``).join(', ');
      const ph  = `(${cols.map(() => '?').join(', ')})`;
      let count = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const vals  = chunk.flatMap(r => cols.map(c => r[c] !== undefined ? r[c] : null));
        const allPh = chunk.map(() => ph).join(', ');
        await conn.execute(`INSERT INTO \`${tableName}\` (${colsSql}) VALUES ${allPh}`, vals);
        count += chunk.length;
      }
      stats[tableName] = count;
    }

    await conn.beginTransaction();
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');

    // Restore in reverse-dependency order so FK checks don't block inserts
    await restoreTable('invoice_lines', tables.invoice_lines);
    await restoreTable('invoices',      tables.invoices);
    await restoreTable('products',      tables.products);
    await restoreTable('customers',     tables.customers);
    await restoreTable('businesses',    tables.businesses);

    // Users: preserve passwords — only upsert non-sensitive fields from backup
    if (tables.users?.length) {
      const safeFields = ['id','business_id','full_name','email','role','is_active','created_at'];
      const colsSql    = safeFields.map(c => `\`${c}\``).join(', ');
      const ph         = `(${safeFields.map(() => '?').join(', ')})`;
      const updateSql  = safeFields
        .filter(c => c !== 'id')
        .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
        .join(', ');
      let count = 0;
      for (let i = 0; i < tables.users.length; i += 50) {
        const chunk = tables.users.slice(i, i + 50);
        const vals  = chunk.flatMap(r => safeFields.map(f => r[f] !== undefined ? r[f] : null));
        const allPh = chunk.map(() => ph).join(', ');
        await conn.execute(
          `INSERT INTO users (${colsSql}) VALUES ${allPh}
           ON DUPLICATE KEY UPDATE ${updateSql}`,
          vals
        );
        count += chunk.length;
      }
      stats.users = count;
    }

    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();

    res.json({
      data: {
        message: 'Restore completed successfully.',
        restored_from: path.basename(backup.file_path),
        exported_at:   data.exported_at,
        stats,
      },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
