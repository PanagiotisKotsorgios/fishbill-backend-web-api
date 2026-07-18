#!/usr/bin/env node
/**
 * Run all agrotis-api migrations against the configured DB.
 * Usage: node scripts/run-migrations.js
 */
require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const bcrypt  = require('bcrypt');
const { v4: uuid } = require('uuid');
const mysql   = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || '127.0.0.1',
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER || 'agrotis',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agrotis',
    multipleStatements: true,
    charset:  'utf8mb4',
  });

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const f of files) {
    console.log(`▶ Running ${f}`);
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    await conn.query(sql);
    console.log(`✓ ${f} done`);
  }

  // Bootstrap the first super-admin if none exists yet.
  const [existing] = await conn.execute('SELECT id FROM ag_admins LIMIT 1');
  if (!existing.length) {
    const email    = process.env.BOOTSTRAP_ADMIN_EMAIL    || 'admin@agrotis.gr';
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'change-me-please';
    const hash     = await bcrypt.hash(password, 12);
    await conn.execute(
      `INSERT INTO ag_admins (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'superadmin')`,
      [uuid(), 'Super Admin', email.toLowerCase(), hash]
    );
    console.log(`✓ Bootstrapped super-admin: ${email} / ${password}`);
    console.log('  → change the password immediately from /admin/change-password');
  }

  await conn.end();
  console.log('All migrations complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
