// PM2 process manager config
// Usage:
//   pm2 start ecosystem.config.js --env production
//   pm2 save && pm2 startup   ← make it survive reboots

module.exports = {
  apps: [
    {
      name:    'fishbill-api',
      script:  './fishbill-api/src/server.js',
      env_file: './fishbill-api/.env',
      env: {
        NODE_ENV: 'development',
        PORT:     4000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT:     4000,
      },
      instances:            1,
      autorestart:          true,
      watch:                false,
      max_memory_restart:   '512M',
      error_file:           './fishbill-api/logs/pm2-error.log',
      out_file:             './fishbill-api/logs/pm2-out.log',
      merge_logs:           true,
      log_date_format:      'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
