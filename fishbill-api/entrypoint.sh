#!/bin/sh
set -e
node scripts/migrate.js
exec node src/server.js
