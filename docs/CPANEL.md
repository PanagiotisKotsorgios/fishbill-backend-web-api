# FishBill — cPanel Hosting Deployment

Use this guide if your host provides **cPanel** with **Node.js App support** (Hostinger Business+, A2 Hosting, Namecheap Stellar Plus, etc.).

> **Important**: Standard shared hosting does **not** allow running persistent Node.js processes. You need a plan that explicitly offers "Node.js App" in cPanel. If your host does not list this feature, use [Docker](../DOCKER.md) or [Apache on a VPS](../APACHE.md) instead.

---

## 1 — Check Node.js Support

Log in to cPanel and look for **"Node.js App"** or **"Setup Node.js App"** in the Software section. If it's not there, your plan does not support this.

---

## 2 — Set Up MySQL via phpMyAdmin

1. In cPanel → **MySQL Databases**
   - Create database: `yourusername_fishbill`
   - Create user: `yourusername_fbuser` with a strong password
   - Add user to database, grant **All Privileges**

2. In cPanel → **phpMyAdmin**
   - Select the `fishbill_db` database
   - Click **Import**
   - Upload `database/fishbill_schema.sql`

---

## 3 — Upload Files

**Option A — Git (if your host supports SSH):**

```bash
ssh yourusername@your-host.com
cd public_html
git clone https://github.com/PanagiotisKotsorgios/fishbill-backend-web-api.git fishbill
```

**Option B — File Manager / FTP:**

1. In cPanel → **File Manager**, navigate to `public_html/`
2. Upload and extract the project zip
3. The folder structure should be: `public_html/fishbill/`

---

## 4 — Create the Node.js App in cPanel

1. cPanel → **Node.js App** → **Create Application**
2. Fill in:

   | Field | Value |
   |-------|-------|
   | Node.js version | 20.x (latest available) |
   | Application mode | Production |
   | Application root | `public_html/fishbill/fishbill-api` |
   | Application URL | `yourdomain.com/api` *(or use a subdomain)* |
   | Application startup file | `src/server.js` |

3. Click **Create**

---

## 5 — Configure Environment Variables

In cPanel → **Node.js App** → click your app → **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` (or leave default) |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_USER` | `yourusername_fbuser` |
| `DB_PASSWORD` | your DB password |
| `DB_NAME` | `yourusername_fishbill` |
| `JWT_SECRET` | 64-char random hex |
| `JWT_REFRESH_SECRET` | 64-char random hex |
| `ENCRYPTION_KEY` | 32-char random hex |
| `APP_URL` | `https://yourdomain.com` |
| `API_URL` | `https://yourdomain.com/api` |
| `APP_BASE_URL` | `https://yourdomain.com` |
| `CORS_ORIGINS` | `https://yourdomain.com` |
| `ADMIN_EMAIL` | `admin@yourdomain.com` |

Generate secrets (run in SSH terminal):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 6 — Install Dependencies

In the Node.js App panel, click **Run NPM Install**, or via SSH:

```bash
cd ~/public_html/fishbill/fishbill-api
npm ci --omit=dev
```

---

## 7 — Set Up the Static Frontend

The HTML files (admin, app, accountant, landing page) need to be served by Apache.

**Option A — Subdomain setup (recommended):**

1. In cPanel → **Subdomains**, create `app.yourdomain.com` pointing to `public_html/fishbill/`
2. The API runs at `yourdomain.com/api` (proxied by Node.js App)

**Option B — Same domain:**

Place the static HTML in `public_html/fishbill/` and Apache will serve them directly. The API proxy is handled by `.htaccess`.

Create `public_html/fishbill/.htaccess`:

```apache
Options -Indexes

# Proxy API requests to Node.js
RewriteEngine On
RewriteRule ^api/(.*)$ http://localhost:4000/api/$1 [P,L]
RewriteRule ^health$   http://localhost:4000/health  [P,L]
RewriteRule ^avatars/(.*)$ http://localhost:4000/avatars/$1 [P,L]
RewriteRule ^uploads/(.*)$ http://localhost:4000/uploads/$1 [P,L]
RewriteRule ^pdfs/(.*)$    http://localhost:4000/pdfs/$1    [P,L]

# Block sensitive files
<FilesMatch "\.(env|sh|sql|log|bak|json|bat)$">
  Require all denied
</FilesMatch>
```

> This requires `mod_proxy` enabled by your host. Not all shared hosts allow this in `.htaccess`.

---

## 8 — Start the Application

In cPanel → **Node.js App** → click **Restart** or **Start** next to your app.

Check it's running:

```bash
curl https://yourdomain.com/health
# Expected: {"status":"ok",...}
```

---

## Limitations on cPanel Shared Hosting

| Feature | Support |
|---------|---------|
| Node.js API | ✓ (if plan supports it) |
| File uploads | ✓ (watch disk quota) |
| PDF generation | ✓ |
| Email sending (Brevo) | ✓ |
| Cron jobs | ✓ (via cPanel Cron Jobs) |
| Custom ports | ✗ (must use 80/443 via proxy) |
| Root MySQL access | ✗ (use cPanel DB tools) |
| Docker | ✗ |

---

## cPanel Cron Job (Auto-restart)

Since cPanel may kill long-running processes, add a cron job to restart if down:

In cPanel → **Cron Jobs**, add (every 5 minutes):

```bash
/usr/bin/pgrep -f "fishbill-api/src/server.js" || cd ~/public_html/fishbill/fishbill-api && node src/server.js >> logs/cron-restart.log 2>&1 &
```

A better alternative: **use a VPS with PM2** (see [Docker](../DOCKER.md) or [Nginx](NGINX.md) guides).

---

## Next Step

See [First Boot Setup](FIRST-BOOT.md) to configure the admin panel.
