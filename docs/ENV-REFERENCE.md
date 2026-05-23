# FishBill — Environment Variables Reference

All variables go in `fishbill-api/.env` (copy from `.env.example`).  
For Docker deployments, use `.env.docker` (copy from `.env.docker.example`).

---

## Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | Set to `production` on live servers. Enables stricter validation, disables stack traces in error responses. |
| `PORT` | No | `4000` | Port the Node.js API listens on. Change if 4000 is in use. |

---

## Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_HOST` | Yes | `localhost` | MySQL host. Use `db` for Docker Compose. |
| `DB_PORT` | No | `3306` | MySQL port. |
| `DB_USER` | Yes | `fishbill_user` | MySQL username. |
| `DB_PASSWORD` | Yes | — | MySQL password. Must not be empty in production. |
| `DB_NAME` | Yes | `fishbill_db` | Database name. |

**Generate a strong DB password:**
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

---

## Security — JWT & Encryption

| Variable | Required | Min Length | Description |
|----------|----------|-----------|-------------|
| `JWT_SECRET` | Yes | 32 chars | Signs access tokens. Must be secret and random. |
| `JWT_EXPIRES_IN` | No | — | Access token lifetime. Default: `7d`. Examples: `1h`, `24h`, `30d`. |
| `JWT_REFRESH_SECRET` | Yes | 32 chars | Signs refresh tokens. Must differ from JWT_SECRET. |
| `JWT_REFRESH_EXPIRES_IN` | No | — | Refresh token lifetime. Default: `30d`. |
| `ENCRYPTION_KEY` | Yes | 32 chars | AES-256 key for encrypting sensitive DB fields. **Never change this after first use** — encrypted data will become unreadable. |

**Generate all three at once:**
```bash
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")"
echo "JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")"
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
```

> The app will **refuse to start** in production if these are missing or set to placeholder values.

---

## URLs

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_URL` | Yes (prod) | Public URL of your web app. No trailing slash. Example: `https://fishbill.gr` |
| `API_URL` | Yes (prod) | Public URL of the API. No trailing slash. Example: `https://fishbill.gr/api` |
| `APP_BASE_URL` | Yes (prod) | Used in email links (password reset, etc.). Same as `APP_URL` unless the app is at a subpath. |

---

## CORS

| Variable | Required | Description |
|----------|----------|-------------|
| `CORS_ORIGINS` | Yes (prod) | Comma-separated list of allowed origins. Example: `https://fishbill.gr,https://www.fishbill.gr`. The Android app does not send an Origin header — it is always allowed regardless of this setting. |

**Development example:**
```env
CORS_ORIGINS=http://localhost,http://localhost:3000,http://192.168.1.100
```

**Production example:**
```env
CORS_ORIGINS=https://fishbill.gr,https://www.fishbill.gr
```

---

## Storage

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PDF_STORAGE_PATH` | No | `./pdfs` | Where temporary PDFs are written before being sent. Relative to `fishbill-api/`. |

---

## Email & Admin

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_EMAIL` | Recommended | Fallback email for admin notifications when no email is configured in the DB. |

> The Brevo API key, sender name, and email address are configured through the **Admin Panel → Platform Settings**, not in `.env`. This allows changing them without restarting the server.

---

## External Integrations (Optional)

These are also configurable through Admin Panel → Platform Settings.  
Set them in `.env` only if you need to override the DB setting at the container/process level.

| Variable | Description |
|----------|-------------|
| `ETIMOLOGIERA_DEV_URL` | e-Τιμολόγηση dev API endpoint |
| `ETIMOLOGIERA_PROD_URL` | e-Τιμολόγηση production API endpoint |
| `PLATFORM_GSIS_USERNAME` | TAXISnet username for AFM lookups |
| `PLATFORM_GSIS_PASSWORD` | TAXISnet password |
| `PLATFORM_GSIS_CALLER_AFM` | Your AFM number (required for GSIS API calls) |

---

## Docker-only Variables

These appear in `.env.docker` only:

| Variable | Description |
|----------|-------------|
| `DB_ROOT_PASSWORD` | MySQL root password (used by the `db` container). Different from `DB_PASSWORD`. |
| `WEB_PORT` | Host port for the Nginx web container. Default: `80`. |

---

## Validation Rules

The API checks these on startup and **will not start** if they fail:

| Rule | When it applies |
|------|----------------|
| `JWT_SECRET` must be ≥ 32 chars | Always |
| `JWT_REFRESH_SECRET` must be ≥ 32 chars | Always |
| `ENCRYPTION_KEY` must be ≥ 32 chars | Always |
| None of the above may be placeholder values from `.env.example` | Always |
| `DB_PASSWORD` must not be empty, `root`, or a placeholder | Production only (warning in dev) |
| `NODE_ENV` should be `production` | Warning if unset |
| `APP_BASE_URL`, `CORS_ORIGINS`, `ADMIN_EMAIL` should be set | Warning in production |
