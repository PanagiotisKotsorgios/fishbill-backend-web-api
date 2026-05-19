/**
 * Run this ONCE to set the super admin password in the database.
 * Usage:  node set-admin-password.js
 *
 * It will set admin@fishbill.gr password to: Admin@123
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

(async () => {
  const password = 'Admin@123';
  const hash = await bcrypt.hash(password, 12);
  console.log('Generated hash:', hash);

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fishbill_db',
  });

  const [result] = await conn.execute(
    `UPDATE users SET password_hash = ? WHERE email = 'admin@fishbill.gr'`,
    [hash]
  );

  if (result.affectedRows === 0) {
    // User doesn't exist yet — insert it
    await conn.execute(
      `INSERT INTO users (id, full_name, email, password_hash, role, is_active, email_verified,
         can_view_all, can_manage_users, can_view_logs, can_export)
       VALUES (UUID(), 'Super Admin', 'admin@fishbill.gr', ?, 'super_admin', 1, 1, 1, 1, 1, 1)`,
      [hash]
    );
    console.log('✅ Super admin user created.');
  } else {
    console.log('✅ Admin password updated successfully.');
  }

  await conn.end();
  console.log('Done. You can now log in with:');
  console.log('  Email:    admin@fishbill.gr');
  console.log('  Password: Admin@123');
})().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
