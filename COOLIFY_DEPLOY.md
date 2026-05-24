# FishBill — Coolify v4 Deployment Guide

Complete step-by-step guide for deploying FishBill on a VPS using Coolify v4.

---

## Architecture Overview

```
Internet → Coolify (Traefik) → Nginx container (port 80)
                                    ├── Static files (admin, app, landing)
                                    └── Proxy /api/* → Node.js API (port 4000)
                                                            └── MySQL 8.0
```

All three services run as Docker containers managed by Coolify via `docker-compose.yml`.

---

## Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| RAM | 2 GB | 4 GB |
| CPU | 2 vCPU | 4 vCPU |
| Disk | 20 GB SSD | 40 GB SSD |
| Domain | Required (for SSL) | — |

---

## Part 1 — Prepare the VPS

### 1.1 Connect to your server

```bash
ssh root@YOUR_SERVER_IP
```

### 1.2 Install Coolify

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This installs Docker, Docker Compose v2, and Coolify itself. Takes ~2–3 minutes.

### 1.3 Access Coolify UI

Open your browser: **http://YOUR_SERVER_IP:8000**

- Create your admin account (email + password)
- Complete the initial setup wizard
- Coolify will set up Traefik as the reverse proxy automatically

> **Note**: Port 8000 is the Coolify dashboard. Your app will run on port 80/443 via Traefik.

### 1.4 Point your domain to the server

In your DNS registrar (Cloudflare, GoDaddy, etc.) create an **A record**:

```
Type: A
Name: @          (or subdomain like app)
Value: YOUR_SERVER_IP
TTL: 300
```

Also create a wildcard if you want subdomains:
```
Type: A
Name: *
Value: YOUR_SERVER_IP
TTL: 300
```

Wait for DNS propagation (usually 5–30 minutes). Verify with:
```bash
nslookup your-domain.com
```

---

## Part 2 — Connect GitHub to Coolify

### 2.1 Create a GitHub App (for private repo access)

1. In Coolify UI → **Settings** → **Source** tab → Click **Add GitHub App**
2. Click **Register a GitHub App** — this opens GitHub
3. On GitHub:
   - App name: `Coolify-FishBill` (or any name)
   - Homepage URL: `http://YOUR_SERVER_IP:8000`
   - Webhook URL: auto-filled by Coolify
   - Permissions: **Repository contents → Read**, **Metadata → Read**
   - Repository access: Select **Only select repositories** → pick your FishBill repo
4. Click **Create GitHub App**
5. After creation, click **Install App** on your account
6. Back in Coolify: click **Save** — you should see the app listed as connected

### 2.2 Verify connection

In Coolify → Sources, your GitHub app should show as **Active** with a green dot.

---

## Part 3 — Create the FishBill Project in Coolify

### 3.1 Create a project

1. Coolify UI → **Projects** → **+ Add Project**
2. Name: `FishBill`
3. Click **Create**

### 3.2 Create the environment

Inside the FishBill project:
1. Click **+ Add Environment**
2. Name: `Production`
3. Click **Create**

### 3.3 Add a new service (Docker Compose)

Inside Production environment:
1. Click **+ Add New Resource**
2. Select **Docker Compose**
3. Select your connected **GitHub App** as the source
4. Choose your **FishBill repository**
5. Branch: `main`
6. Docker Compose location: `docker-compose.yml` *(leave as default)*
7. Click **Continue**

---

## Part 4 — Configure Environment Variables

This is the most important step. In the service settings, find the **Environment Variables** section.

Click **+ Add Variable** for each of the following:

### Required — Database

| Variable | Value |
|----------|-------|
| `DB_ROOT_PASSWORD` | A strong random password (min 20 chars) |
| `DB_NAME` | `fishbill_db` |
| `DB_USER` | `fishbill_user` |
| `DB_PASSWORD` | Another strong random password (different from root) |

### Required — App Config

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `WEB_PORT` | `80` |

### Required — URLs (replace with your actual domain)

| Variable | Value |
|----------|-------|
| `APP_URL` | `https://your-domain.com` |
| `API_URL` | `https://your-domain.com/api` |
| `APP_BASE_URL` | `https://your-domain.com` |
| `CORS_ORIGINS` | `https://your-domain.com` |

### Required — Security Secrets

Generate each with this command on your server:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | 64-byte hex string (run the command above) |
| `JWT_REFRESH_SECRET` | Another 64-byte hex string (different from JWT_SECRET) |
| `JWT_EXPIRES_IN` | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` |

Generate encryption key (32 bytes):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | 32-byte hex string |

### Required — Admin

| Variable | Value |
|----------|-------|
| `ADMIN_EMAIL` | Your real email address |

### Optional (configured via Admin Panel after first boot)

These don't need to be set here — you configure them in the Admin Panel UI after the app is running:
- `BREVO_API_KEY` — email sending
- `ETIMOLOGIERA_*` — myDATA integration
- `PLATFORM_GSIS_*` — GSIS credentials

> **Tip**: In Coolify, mark sensitive variables (passwords, secrets) as **Secret** so they are hidden in logs.

---

## Part 5 — Configure the Domain & SSL

### 5.1 Set the domain in Coolify

In your service settings:
1. Find the **Domains** section
2. Add: `https://your-domain.com`
3. Coolify automatically provisions a **Let's Encrypt SSL certificate** via Traefik

### 5.2 Configure Coolify proxy port

Coolify needs to know which container port to route traffic to:

In the service settings → **Proxy** section:
- Set **Port**: `80` (this is the port nginx exposes inside Docker)

Alternatively, under each service in the compose configuration:
- `web` service → exposed port: `80`

---

## Part 6 — Deploy

### 6.1 First deployment

1. In Coolify, click **Deploy** (or **Save and Deploy**)
2. Watch the **Deployment Logs** in real time

What happens during first deploy:
1. Coolify clones your GitHub repo
2. Builds the `api` Docker image (Node.js)
3. Builds the `web` Docker image (Nginx + static files)
4. Pulls `mysql:8.0`
5. Starts MySQL → MySQL runs `database/fishbill_schema.sql` (creates all 32 tables)
6. Starts API → runs `scripts/migrate.js` → starts `server.js`
7. Starts Nginx
8. Traefik routes `your-domain.com` → Nginx → API

Expected time: **3–8 minutes** on first deploy (image build + DB init).

### 6.2 Verify the deployment

```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Check all containers are running
docker ps | grep fishbill

# Check API health
curl https://your-domain.com/health

# Check admin panel
curl -I https://your-domain.com/admin/

# Check API endpoint
curl https://your-domain.com/api/status
```

Expected `/health` response:
```json
{
  "status": "ok",
  "service": "fishbill-api",
  "environment": "production",
  "db_ping_ms": 2
}
```

---

## Part 7 — Post-Deployment Setup

### 7.1 Create the super_admin account

SSH into the server and run:

```bash
# Get the API container name
docker ps --filter "name=api" --format "{{.Names}}"

# Open a shell in the API container
docker exec -it CONTAINER_NAME sh

# Inside the container — run the admin setup script
node set-admin-password.js
```

> If `set-admin-password.js` doesn't exist, create the admin via direct DB insert:

```bash
# Open MySQL shell
docker exec -it $(docker ps --filter "name=db" --format "{{.Names}}") \
  mysql -u fishbill_user -p fishbill_db
```

```sql
-- Replace values below
INSERT INTO users (id, full_name, email, password_hash, role, is_active, is_verified)
VALUES (
  UUID(),
  'Admin',
  'admin@your-domain.com',
  '$2b$12$YOUR_BCRYPT_HASH_HERE',
  'super_admin',
  1,
  1
);
```

To generate a bcrypt hash for your password:
```bash
docker exec -it CONTAINER_NAME node -e "
  const bcrypt = require('bcrypt');
  bcrypt.hash('YourPassword123!', 12).then(h => console.log(h));
"
```

### 7.2 Configure platform settings in Admin Panel

Open `https://your-domain.com/admin/` and log in with your super_admin account.

Go to **Settings** and configure:

**Email (Brevo)**
- Brevo API Key — get from [app.brevo.com](https://app.brevo.com) → API Keys
- Sender email (the email you verified in Brevo)
- Sender name: `FishBill`
- Enable platform emails: ✓

**Platform URLs** (very important — controls all links in emails)
- Web Base URL: `https://your-domain.com`
- App Base URL: `https://your-domain.com`

**Admin notification email**: your email address

**Maintenance mode**: leave off

After saving, send a test email to verify the email integration works.

### 7.3 Upload the Android APK (optional)

```bash
# Copy APK to the running container
docker cp fishbill-v9.apk $(docker ps --filter "name=api" --format "{{.Names}}"):/app/public/apk/

# Verify
curl -I https://your-domain.com/apk/fishbill-v9.apk
```

---

## Part 8 — Automatic Deployments (CI/CD)

### 8.1 Enable auto-deploy on push

In Coolify service settings:
1. **Deployments** section
2. Enable **Auto Deploy** → On
3. Webhook is automatically configured

Now every `git push origin main` will trigger a Coolify redeploy automatically.

### 8.2 Manual redeploy from Coolify UI

In Coolify → Your service → Click **Redeploy** (uses latest commit on `main`).

---

## Part 9 — Maintenance Operations

### View logs

```bash
# All services
docker compose -p fishbill logs -f

# API only
docker compose -p fishbill logs -f api

# Nginx only
docker compose -p fishbill logs -f web
```

Or in Coolify UI → your service → **Logs** tab.

### Run database migrations manually

```bash
docker exec -it $(docker ps --filter "name=api" --format "{{.Names}}") \
  node scripts/migrate.js
```

### Take a manual database backup

```bash
docker exec $(docker ps --filter "name=db" --format "{{.Names}}") \
  mysqldump -u fishbill_user -p"$DB_PASSWORD" fishbill_db \
  | gzip > "fishbill_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
```

### Open a MySQL shell

```bash
docker exec -it $(docker ps --filter "name=db" --format "{{.Names}}") \
  mysql -u fishbill_user -p fishbill_db
```

### Restart a single service

```bash
docker restart $(docker ps --filter "name=api" --format "{{.Names}}")
```

### Update to latest code

Push to GitHub → Coolify auto-deploys. Or in Coolify UI → **Redeploy**.

---

## Part 10 — Upgrading FishBill

When you push new code to `main`:

1. Coolify detects the push (webhook)
2. Pulls latest code
3. Rebuilds Docker images
4. **Zero-downtime**: starts new containers before stopping old ones (if configured)
5. New API container runs `scripts/migrate.js` → applies any new SQL migrations automatically
6. Swap completes

No manual database steps needed — migrations are automatic.

---

## Troubleshooting

### API container keeps restarting

```bash
docker logs $(docker ps -a --filter "name=api" --format "{{.Names}}" | head -1)
```

Common causes:
- Missing env variable (check JWT_SECRET, ENCRYPTION_KEY are set)
- DB not ready yet (wait 30s after MySQL starts)
- Migration failed (check logs for SQL errors)

### Cannot connect to database

```bash
# Check MySQL is healthy
docker inspect $(docker ps --filter "name=db" --format "{{.Names}}") | grep -A 5 Health

# Test connection from API container
docker exec -it $(docker ps --filter "name=api" --format "{{.Names}}") \
  node -e "require('./src/config/database').execute('SELECT 1').then(() => console.log('DB OK')).catch(e => console.error(e.message))"
```

### SSL certificate not issuing

- Make sure DNS is pointing to your server IP (run `nslookup your-domain.com`)
- Make sure port 80 and 443 are open in your server firewall
- Check Traefik logs: `docker logs $(docker ps --filter "name=traefik" --format "{{.Names}}")`

### Nginx 502 Bad Gateway

The API container is not running or not healthy:
```bash
docker ps | grep api
docker logs CONTAINER_NAME --tail=50
```

### Admin panel shows blank / 404

Check that the `web` container is running and that the static files were copied during build:
```bash
docker exec $(docker ps --filter "name=web" --format "{{.Names}}") ls /var/www/fishbill/admin/
```

---

## Security Checklist Before Going Live

- [ ] All `CHANGE_ME` values replaced in env vars
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` are unique 64-byte random strings
- [ ] `ENCRYPTION_KEY` is a unique 32-byte random string
- [ ] `DB_ROOT_PASSWORD` and `DB_PASSWORD` are strong and different
- [ ] `NODE_ENV=production` is set
- [ ] `CORS_ORIGINS` is set to your exact domain (no wildcards)
- [ ] SSL certificate is active (padlock in browser)
- [ ] Admin panel is accessible only via HTTPS
- [ ] Test email sending works (Admin Panel → Settings → Test Email)
- [ ] Platform URLs set in Admin Panel settings match your actual domain

---

## Quick Reference — Important URLs

| URL | Purpose |
|-----|---------|
| `https://your-domain.com/` | Landing / coming-soon page |
| `https://your-domain.com/admin/` | Admin panel (super_admin only) |
| `https://your-domain.com/app/` | Customer-facing app |
| `https://your-domain.com/health` | API health check |
| `https://your-domain.com/api/status` | Maintenance status |
| `http://YOUR_SERVER_IP:8000` | Coolify dashboard |

---

## Environment Variables Reference

Complete list of all environment variables FishBill reads (in priority order: DB setting → env var → default).

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `NODE_ENV` | ✓ | `development` | Must be `production` |
| `PORT` | ✓ | `4000` | API listen port |
| `WEB_PORT` | — | `80` | Host port for nginx |
| `DB_HOST` | — | `localhost` | Set to `db` in Docker (auto-set) |
| `DB_PORT` | — | `3306` | Auto-set in Docker |
| `DB_NAME` | ✓ | `fishbill_db` | — |
| `DB_USER` | ✓ | `fishbill_user` | — |
| `DB_PASSWORD` | ✓ | — | Must be set |
| `DB_ROOT_PASSWORD` | ✓ | — | MySQL root password |
| `JWT_SECRET` | ✓ | — | 64-byte hex, never share |
| `JWT_REFRESH_SECRET` | ✓ | — | 64-byte hex, different from above |
| `JWT_EXPIRES_IN` | — | `7d` | — |
| `JWT_REFRESH_EXPIRES_IN` | — | `30d` | — |
| `ENCRYPTION_KEY` | ✓ | — | 32-byte hex |
| `APP_URL` | ✓ | — | Full URL, no trailing slash |
| `API_URL` | ✓ | — | `APP_URL/api` |
| `APP_BASE_URL` | ✓ | — | Same as `APP_URL` |
| `CORS_ORIGINS` | ✓ | `http://localhost:3000` | Comma-separated allowed origins |
| `ADMIN_EMAIL` | ✓ | `admin@fishbill.gr` | Notification fallback |
| `PDF_STORAGE_PATH` | — | `./pdfs` | Leave as-is for Docker |
