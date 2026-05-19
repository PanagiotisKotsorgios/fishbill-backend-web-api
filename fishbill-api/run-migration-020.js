require('dotenv').config();
const pool = require('./src/config/database');

(async () => {
  const conn = await pool.getConnection();
  try {
    const db = process.env.DB_NAME || 'fishbill_db';

    const [[r1]] = await conn.execute(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'delivery_notes' AND COLUMN_NAME = 'transmitted_at'`,
      [db]
    );
    if (r1.c === 0) {
      await conn.execute(`ALTER TABLE delivery_notes ADD COLUMN transmitted_at DATETIME DEFAULT NULL AFTER mydata_response`);
      console.log('✓ delivery_notes.transmitted_at added');
    } else {
      console.log('– delivery_notes.transmitted_at already exists');
    }

    const [[r2]] = await conn.execute(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'transmitted_at'`,
      [db]
    );
    if (r2.c === 0) {
      await conn.execute(`ALTER TABLE invoices ADD COLUMN transmitted_at DATETIME DEFAULT NULL`);
      console.log('✓ invoices.transmitted_at added');
    } else {
      console.log('– invoices.transmitted_at already exists');
    }

    console.log('Migration 020 complete.');
  } catch (e) {
    console.error('Migration failed:', e.message);
  } finally {
    conn.release();
    process.exit(0);
  }
})();
