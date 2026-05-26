'use strict';
const mysql  = require('mysql2/promise');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');

async function seedAdmin() {
  const email    = process.env.ADMIN_EMAIL    || 'pkotsorgios654@gmail.com';
  const password = process.env.ADMIN_PASSWORD;
  const name     = process.env.ADMIN_NAME     || 'Panagiotis Kotsorgios';

  if (!password) {
    console.log('[seed-admin] ADMIN_PASSWORD not set — skipping admin seed');
    return;
  }

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'fishbill_db',
  });

  try {
    const [rows] = await conn.execute(
      "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1"
    );

    if (rows.length > 0) {
      console.log('[seed-admin] super_admin already exists — skipping');
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const id   = uuid();
    await conn.execute(
      'INSERT INTO users (id, email, password_hash, role, is_active, is_verified, full_name) VALUES (?,?,?,?,1,1,?)',
      [id, email, hash, 'super_admin', name]
    );
    console.log(`[seed-admin] super_admin created: ${email}`);
  } finally {
    await conn.end();
  }
}

seedAdmin().catch(err => {
  console.error('[seed-admin] error:', err.message);
});
