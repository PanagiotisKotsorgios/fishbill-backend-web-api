const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'fishbill_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fishbill_db',
  charset: 'utf8mb4',
  timezone: '+02:00',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Test connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('[DB] Connected to MySQL database:', process.env.DB_NAME || 'fishbill_db');
    conn.release();
  } catch (err) {
    console.error('[DB] Failed to connect to MySQL:', err.message);
    // Don't exit — let routes fail individually so health check still works
  }
})();

module.exports = pool;
