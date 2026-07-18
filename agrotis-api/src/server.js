require('dotenv').config();

const app     = require('./app');
const pool    = require('./config/database');
const logger  = require('./utils/logger');

const PORT = process.env.PORT || 4001;

async function main() {
  // Sanity-check DB connection at boot so we crash fast if MySQL is unreachable
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    logger.info('DB connection OK');
  } catch (e) {
    logger.error('DB connection FAILED at boot:', e.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    logger.info(`Agrotis API listening on port ${PORT} (env=${process.env.NODE_ENV || 'development'})`);
    logger.info(`Wrapp base URL: ${process.env.WRAPP_BASE_URL || 'not configured'}`);
  });
}

main().catch(err => {
  logger.error('Startup crash:', err);
  process.exit(1);
});

process.on('unhandledRejection', (r) => logger.error('unhandledRejection', r));
process.on('uncaughtException',  (e) => logger.error('uncaughtException',  e));
