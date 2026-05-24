/**
 * Employee Privilege Management Routes
 * Super Admin grants/revokes specific privileges to system employees.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/role');

router.use(authenticate);

// ── Helpers ───────────────────────────────────────────────────────────────────
function parsePrivileges(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return String(raw).split(',').filter(Boolean); }
}

// ── Valid privilege keys ──────────────────────────────────────────────────────
const VALID_PRIVILEGES = [
  'view_dashboard', 'view_invoices', 'edit_invoices', 'delete_invoices',
  'view_customers', 'edit_customers', 'delete_customers',
  'view_products', 'edit_products',
  'view_users', 'edit_users',
  'view_logs', 'view_reports',
  'view_businesses', 'edit_businesses',
  'view_backups', 'create_backups',
  'view_exports', 'create_exports',
  'manage_settings',
  // Maintainer privileges
  'verify_users',            // verify/unverify user accounts in assigned businesses
  'monitor_ospa',            // view OSPA submissions for assigned businesses
  'monitor_weighing_slips',  // view weighing slips for assigned businesses
  'view_subscriptions',      // view subscription & payment info for assigned businesses
  'manage_reminders',        // log SMS reminders for assigned businesses
  // Admin module access (employee working autonomously in admin panel)
  'admin_credentials',       // Θησαυροφυλάκιο — credentials vault (scoped to assigned businesses)
  'admin_mydata_inbox',      // Εισερχόμενα myDATA
  'admin_delivery_notes',    // Δελτία Αποστολής inbox — transmit, mark, upload PDF
  'admin_charges',           // Χρεώσεις
  'admin_sms',               // Υπενθυμίσεις SMS
  'admin_platform',          // Πλατφόρμα
  'admin_campaigns',         // Email & Campaigns
];


// ── GET /api/employees — list all employees with privileges + biz count ────────
router.get('/', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.full_name AS name, u.email, u.is_active, u.created_at,
              ep.privileges, ep.granted_by, ep.granted_at,
              (SELECT COUNT(*) FROM employee_businesses eb WHERE eb.employee_id = u.id) AS biz_count
       FROM users u
       LEFT JOIN employee_privileges ep ON ep.user_id = u.id
       WHERE u.role = 'employee'
       ORDER BY u.created_at DESC`
    );
    res.json({ employees: rows.map(r => ({
      ...r,
      privileges: parsePrivileges(r.privileges),
      biz_count: parseInt(r.biz_count) || 0,
    })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/employees/:id/businesses — list assigned businesses ───────────────
router.get('/:id/businesses', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.id, b.name, b.afm, b.plan, b.subscription_active, eb.assigned_at
       FROM employee_businesses eb
       JOIN businesses b ON b.id = eb.business_id
       WHERE eb.employee_id = ?
       ORDER BY b.name ASC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/employees/:id/businesses — replace assigned businesses ────────────
router.put('/:id/businesses', requireSuperAdmin, async (req, res) => {
  const { business_ids } = req.body;
  if (!Array.isArray(business_ids)) return res.status(400).json({ error: 'business_ids must be an array.' });

  const [[emp]] = await db.query("SELECT id FROM users WHERE id = ? AND role='employee' LIMIT 1", [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM employee_businesses WHERE employee_id = ?', [req.params.id]);
    if (business_ids.length) {
      const vals = business_ids.map(bid => [require('crypto').randomUUID(), req.params.id, bid, req.user.id]);
      await conn.query(
        'INSERT IGNORE INTO employee_businesses (id, employee_id, business_id, assigned_by) VALUES ?',
        [vals]
      );
    }
    await conn.commit();
    res.json({ data: { assigned: business_ids.length } });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// ── GET /api/employees/:id/privileges ─────────────────────────────────────────
router.get('/:id/privileges', requireSuperAdmin, async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT privileges FROM employee_privileges WHERE user_id = ?',
      [req.params.id]
    );
    res.json({ privileges: row ? parsePrivileges(row.privileges) : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees/:id/privileges — set privileges (super_admin only) ────
router.post('/:id/privileges', requireSuperAdmin, async (req, res) => {
  const { privileges } = req.body;
  const employeeId = req.params.id;

  if (!Array.isArray(privileges))
    return res.status(400).json({ error: 'privileges must be an array' });

  const invalid = privileges.filter(p => !VALID_PRIVILEGES.includes(p));
  if (invalid.length)
    return res.status(400).json({ error: `Άγνωστα δικαιώματα: ${invalid.join(', ')}` });

  try {
    const [[emp]] = await db.query(
      "SELECT id, full_name FROM users WHERE id = ? AND role = 'employee' LIMIT 1",
      [employeeId]
    );
    if (!emp) return res.status(404).json({ error: 'Ο εργαζόμενος δεν βρέθηκε.' });

    const privJson = JSON.stringify(privileges);
    await db.query(
      `INSERT INTO employee_privileges (user_id, privileges, granted_by, granted_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE privileges = ?, granted_by = ?, granted_at = NOW()`,
      [employeeId, privJson, req.user.id, privJson, req.user.id]
    );

    res.json({ message: `Τα δικαιώματα ενημερώθηκαν για ${emp.full_name}`, privileges });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/employees/my-privileges — employee gets their own privileges ─────
router.get('/my-privileges', async (req, res) => {
  if (req.user.role !== 'employee')
    return res.status(403).json({ error: 'Only for employees.' });
  try {
    const [[row]] = await db.query(
      'SELECT privileges FROM employee_privileges WHERE user_id = ?',
      [req.user.id]
    );
    res.json({ privileges: row ? parsePrivileges(row.privileges) : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Valid privilege definitions (for UI) ──────────────────────────────────────
router.get('/privilege-definitions', requireSuperAdmin, (req, res) => {
  res.json({ privileges: VALID_PRIVILEGES });
});

// ── GET /api/employees/associations — list associations for the UI ─────────────
router.get('/associations', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.id, a.name, a.region,
             COUNT(b.id) AS business_count
      FROM business_associations a
      LEFT JOIN businesses b ON b.association_id = a.id
      GROUP BY a.id, a.name, a.region
      ORDER BY a.name ASC
    `);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees/:id/assign-association/:assocId — bulk assign ──────────
router.post('/:id/assign-association/:assocId', requireSuperAdmin, async (req, res) => {
  const { id: empId, assocId } = req.params;
  try {
    const [[emp]] = await db.query("SELECT id FROM users WHERE id=? AND role='employee' LIMIT 1", [empId]);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });

    const [bizRows] = await db.query('SELECT id FROM businesses WHERE association_id = ?', [assocId]);
    if (bizRows.length) {
      const vals = bizRows.map(b => [crypto.randomUUID(), empId, b.id, req.user.id]);
      await db.query('INSERT IGNORE INTO employee_businesses (id, employee_id, business_id, assigned_by) VALUES ?', [vals]);
    }

    const [assigned] = await db.query('SELECT business_id FROM employee_businesses WHERE employee_id = ?', [empId]);
    res.json({ data: { added: bizRows.length, business_ids: assigned.map(r => r.business_id) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/employees/:id/assign-association/:assocId — bulk remove ────────
router.delete('/:id/assign-association/:assocId', requireSuperAdmin, async (req, res) => {
  const { id: empId, assocId } = req.params;
  try {
    const [bizRows] = await db.query('SELECT id FROM businesses WHERE association_id = ?', [assocId]);
    if (bizRows.length) {
      const bizIds = bizRows.map(b => b.id);
      await db.query(
        `DELETE FROM employee_businesses WHERE employee_id = ? AND business_id IN (${bizIds.map(() => '?').join(',')})`,
        [empId, ...bizIds]
      );
    }

    const [assigned] = await db.query('SELECT business_id FROM employee_businesses WHERE employee_id = ?', [empId]);
    res.json({ data: { removed: bizRows.length, business_ids: assigned.map(r => r.business_id) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees — create a new system employee ───────────────────────
router.post('/', requireSuperAdmin, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Ονοματεπώνυμο, email και κωδικός απαιτούνται.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.' });
  }
  try {
    const bcrypt = require('bcrypt');
    const [existing] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'Χρήστης με αυτό το email υπάρχει ήδη.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
      `INSERT INTO users (id, business_id, full_name, email, password_hash, role, is_active, created_at, updated_at)
       VALUES (UUID(), NULL, ?, ?, ?, 'employee', 1, NOW(), NOW())`,
      [name, email, passwordHash]
    );
    res.status(201).json({ data: { message: 'Εργαζόμενος δημιουργήθηκε επιτυχώς.' } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/employees/:id — update name / email ──────────────────────────────
router.put('/:id', requireSuperAdmin, async (req, res) => {
  const { name, email } = req.body;
  if (!name && !email) return res.status(400).json({ error: 'Δώστε τουλάχιστον ένα πεδίο.' });
  try {
    const [[emp]] = await db.query("SELECT id FROM users WHERE id=? AND role='employee' LIMIT 1", [req.params.id]);
    if (!emp) return res.status(404).json({ error: 'Εργαζόμενος δεν βρέθηκε.' });
    const fields = [], vals = [];
    if (name)  { fields.push('full_name=?'); vals.push(name); }
    if (email) {
      const [ex] = await db.query('SELECT id FROM users WHERE email=? AND id!=? LIMIT 1', [email, req.params.id]);
      if (ex.length) return res.status(409).json({ error: 'Το email χρησιμοποιείται ήδη.' });
      fields.push('email=?'); vals.push(email);
    }
    vals.push(req.params.id);
    await db.query(`UPDATE users SET ${fields.join(',')}, updated_at=NOW() WHERE id=?`, vals);
    res.json({ data: { message: 'Τα στοιχεία ενημερώθηκαν.' } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/employees/:id/reset-password ─────────────────────────────────
router.post('/:id/reset-password', requireSuperAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Κωδικός τουλάχιστον 8 χαρακτήρες.' });
  try {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(password, 12);
    const [r] = await db.query("UPDATE users SET password_hash=?, updated_at=NOW() WHERE id=? AND role='employee'", [hash, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Εργαζόμενος δεν βρέθηκε.' });
    res.json({ data: { message: 'Ο κωδικός αλλάχθηκε.' } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/employees/:id/active — toggle is_active ────────────────────
router.patch('/:id/active', requireSuperAdmin, async (req, res) => {
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be boolean.' });
  try {
    await db.query("UPDATE users SET is_active=?, updated_at=NOW() WHERE id=? AND role='employee'", [is_active ? 1 : 0, req.params.id]);
    res.json({ data: { is_active } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/employees/:id ─────────────────────────────────────────────
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const [[emp]] = await db.query("SELECT id, full_name FROM users WHERE id=? AND role='employee' LIMIT 1", [req.params.id]);
    if (!emp) return res.status(404).json({ error: 'Εργαζόμενος δεν βρέθηκε.' });
    await db.query('DELETE FROM employee_privileges WHERE user_id=?', [req.params.id]);
    await db.query('DELETE FROM employee_businesses WHERE employee_id=?', [req.params.id]);
    await db.query('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ data: { message: `${emp.full_name} διαγράφηκε.` } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/employees/:id/impersonate — generate short-lived token ──────
router.post('/:id/impersonate', requireSuperAdmin, async (req, res) => {
  const jwt = require('jsonwebtoken');
  try {
    const [[emp]] = await db.query(
      "SELECT id, full_name, email FROM users WHERE id=? AND role='employee' AND is_active=1 LIMIT 1",
      [req.params.id]
    );
    if (!emp) return res.status(404).json({ error: 'Εργαζόμενος δεν βρέθηκε ή είναι ανενεργός.' });
    const token = jwt.sign(
      { id: emp.id, role: 'employee', name: emp.full_name, full_name: emp.full_name, email: emp.email, impersonated_by: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );
    res.json({ token, name: emp.full_name, email: emp.email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
