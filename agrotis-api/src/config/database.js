const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:              process.env.DB_HOST || '127.0.0.1',
  port:              Number(process.env.DB_PORT || 3306),
  user:              process.env.DB_USER || 'agrotis',
  password:          process.env.DB_PASSWORD || '',
  database:          process.env.DB_NAME || 'agrotis',
  waitForConnections: true,
  connectionLimit:    15,
  queueLimit:         0,
  timezone:          '+00:00',
  charset:           'utf8mb4',
  dateStrings:       true,
});

module.exports = pool;
