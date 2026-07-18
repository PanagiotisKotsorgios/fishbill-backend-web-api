#!/bin/sh
set -e

echo "[agrotis-entrypoint] Waiting for MySQL at ${DB_HOST:-db}:${DB_PORT:-3306}..."
node -e "
const net = require('net');
const host = process.env.DB_HOST || 'db';
const port = parseInt(process.env.DB_PORT || '3306');
let attempts = 0;
function tryConnect() {
  attempts++;
  const client = new net.Socket();
  client.setTimeout(2000);
  client.connect(port, host, () => {
    client.destroy();
    console.log('[agrotis-entrypoint] MySQL is ready after ' + attempts + ' attempt(s)');
    process.exit(0);
  });
  client.on('error',   () => { client.destroy(); setTimeout(tryConnect, 2000); });
  client.on('timeout', () => { client.destroy(); setTimeout(tryConnect, 2000); });
}
tryConnect();
"

node scripts/run-migrations.js
exec node src/server.js
