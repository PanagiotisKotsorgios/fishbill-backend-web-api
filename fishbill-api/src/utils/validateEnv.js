/**
 * Startup environment validation.
 * Throws a hard error if insecure defaults are detected — prevents accidentally
 * deploying the app with example placeholders in production.
 */

'use strict';

const PLACEHOLDER_VALUES = new Set([
  'change_this_to_random_64_char_string_abcdefghijklmnopqrstuvwxyz123456',
  'change_this_too_another_random_64_char_string_abcdefghijklmnop',
  'change_this_32_char_hex_key_here',
  'your_password',
  'password',
  'secret',
  'changeme',
]);

function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';

  // ── Required secrets ────────────────────────────────────────────────────────
  const secrets = [
    { key: 'JWT_SECRET',         minLen: 32 },
    { key: 'JWT_REFRESH_SECRET', minLen: 32 },
    { key: 'ENCRYPTION_KEY',     minLen: 32 },
  ];

  for (const { key, minLen } of secrets) {
    const val = process.env[key];

    if (!val) {
      throw new Error(
        `FATAL: ${key} is not set.\n` +
        `  Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    }

    if (PLACEHOLDER_VALUES.has(val)) {
      throw new Error(
        `FATAL: ${key} is still set to the example placeholder value.\n` +
        `  Generate a real secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    }

    if (val.length < minLen) {
      throw new Error(
        `FATAL: ${key} is too short (${val.length} chars, minimum ${minLen}).\n` +
        `  Generate a real secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    }
  }

  // ── DB password — hard fail in production, warning in dev ──────────────────
  const dbPass = process.env.DB_PASSWORD;
  const weakDbPass = !dbPass || dbPass === 'root' || dbPass === '' || PLACEHOLDER_VALUES.has(dbPass);
  if (weakDbPass) {
    if (isProd) {
      throw new Error(
        'FATAL: DB_PASSWORD is weak or empty. Set a strong database password in production.'
      );
    } else {
      console.warn('\x1b[33m[FishBill] WARNING: DB_PASSWORD is weak or empty — fix before production.\x1b[0m');
    }
  }

  // ── NODE_ENV should be "production" in production ──────────────────────────
  if (!process.env.NODE_ENV) {
    console.warn('\x1b[33m[FishBill] WARNING: NODE_ENV is not set. Defaulting to "development".\x1b[0m');
  }

  // ── Optional but recommended in production ─────────────────────────────────
  if (isProd) {
    const recommended = ['APP_BASE_URL', 'CORS_ORIGINS', 'ADMIN_EMAIL'];
    for (const k of recommended) {
      if (!process.env[k]) {
        console.warn(`\x1b[33m[FishBill] WARNING: ${k} is not set (recommended for production).\x1b[0m`);
      }
    }
  }
}

module.exports = { validateEnv };
