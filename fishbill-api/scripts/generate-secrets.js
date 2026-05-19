#!/usr/bin/env node
/**
 * FishBill — Secret Generator
 * Run once before first production deployment:
 *   node scripts/generate-secrets.js
 *
 * Copy the output into your .env file.
 */

'use strict';

const crypto = require('crypto');

function gen(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

console.log('\n=== FishBill Production Secrets ===');
console.log('Copy these into your .env file.\n');
console.log(`JWT_SECRET=${gen(32)}`);
console.log(`JWT_REFRESH_SECRET=${gen(32)}`);
console.log(`ENCRYPTION_KEY=${gen(32)}`);
console.log(`\n# Run this separately to generate a strong DB password:`);
console.log(`# openssl rand -base64 24`);
console.log('\n=== End of Secrets ===\n');
console.log('IMPORTANT: Never commit these values to version control.');
console.log('Store them in a secrets manager or encrypted vault.\n');
