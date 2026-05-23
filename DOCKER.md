# FishBill — Docker Deployment

Three containers, one command:

| Container | Image | Role |
|-----------|-------|------|
| `db`  | `mysql:8.0`   | Database |
| `api` | Node.js 20    | REST API (port 4000, internal) |
| `web` | `nginx:alpine`| Static frontend + reverse proxy (port 80) |

---

## Quick Start

### 1. Prerequisites
- Docker Engine ≥ 24 and Docker Compose v2 (`docker compose` — no hyphen)

### 2. Configure environment
```bash
cp .env.docker.example .env.docker
```
Edit `.env.docker` and fill in:
- `DB_ROOT_PASSWORD` / `DB_PASSWORD` — strong passwords
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- `ENCRYPTION_KEY` — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `APP_URL` / `API_URL` / `APP_BASE_URL` — your server domain or IP
- `CORS_ORIGINS` — your domain

### 3. Build and start
```bash
docker compose up -d --build
```

The web UI is available at **http://localhost** (or your configured domain).  
The API health check: **http://localhost/health**

### 4. First boot
On first start Docker automatically runs `database/fishbill_schema.sql` to create all tables.  
The API then applies any missing column migrations on startup.

Log in to the **Admin Panel** at `/admin/` to configure:
- Platform settings (email API key, payment details, etc.)
- Create the first business/user accounts

---

## Useful Commands

```bash
# View logs
docker compose logs -f api
docker compose logs -f db

# Stop everything
docker compose down

# Stop and wipe the database (fresh start)
docker compose down -v

# Rebuild after code changes
docker compose up -d --build api
docker compose up -d --build web

# Open a MySQL shell
docker compose exec db mysql -uroot -p fishbill_db

# Run a one-off Node.js script inside the API container
docker compose exec api node scripts/generate-secrets.js
```

---

## Persistent Data (Named Volumes)

All user data lives in Docker named volumes — it survives `docker compose down`:

| Volume | Contents |
|--------|----------|
| `db_data` | MySQL database files |
| `api_uploads` | Generated invoice & delivery-note PDFs |
| `api_pdfs` | Temporary PDF output |
| `api_avatars` | User avatar images |
| `api_weighing_slips` | Weighing-slip photos |
| `api_apk` | Self-hosted APK files (optional) |
| `api_backups` | Database backup JSON files |

To back up all volumes:
```bash
docker run --rm \
  -v fishbill_db_data:/data/db \
  -v fishbill_api_uploads:/data/uploads \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/fishbill-$(date +%Y%m%d).tar.gz /data
```

---

## Production with HTTPS (Recommended)

Put a reverse proxy (Nginx, Traefik, Caddy) in front of the `web` container and terminate TLS there.

Example with Caddy (add a `Caddyfile` alongside `docker-compose.yml`):
```
your-domain.com {
    reverse_proxy web:80
}
```
Then in `docker-compose.yml` change the `web` port mapping to `127.0.0.1:8080:80` so only Caddy can reach it.

---

## APK Auto-Updates

The app's update URL is stored in the database (`platform_settings.app_latest_apk_url`).  
By default it points to a GitHub Release.  
If you want to self-host APKs, copy them into the `api_apk` volume:
```bash
docker compose cp /path/to/fishbill-v10.apk api:/app/public/apk/fishbill-v10.apk
```
Then update the URL via **Admin Panel → Platform → App Version** to `http://your-domain.com/apk/fishbill-v10.apk`.
