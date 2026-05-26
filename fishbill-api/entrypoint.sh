#!/bin/sh
set -e

echo "[entrypoint] Waiting for MySQL at ${DB_HOST}:${DB_PORT:-3306}..."
node -e "
const net = require('net');
const host = process.env.DB_HOST || '127.0.0.1';
const port = parseInt(process.env.DB_PORT || '3306');
let attempts = 0;
function tryConnect() {
  attempts++;
  const client = new net.Socket();
  client.setTimeout(2000);
  client.connect(port, host, () => {
    client.destroy();
    console.log('[entrypoint] MySQL is ready after ' + attempts + ' attempt(s)');
    process.exit(0);
  });
  client.on('error', () => { client.destroy(); setTimeout(tryConnect, 2000); });
  client.on('timeout', () => { client.destroy(); setTimeout(tryConnect, 2000); });
}
tryConnect();
"

node scripts/migrate.js
node scripts/seed-admin.js
exec node src/server.js
