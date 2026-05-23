# FishBill — Troubleshooting

## Quick Diagnostic

Run these first:

```bash
# Is the API alive?
curl http://localhost:4000/health

# Is it reachable through the web server?
curl http://your-domain.com/health

# API logs
pm2 logs fishbill-api --lines 50   # or: docker compose logs api
```

---

## API Won't Start

### FATAL: JWT_SECRET is not set

**Cause:** `.env` file missing or secret not filled in.  
**Fix:**
```bash
cp fishbill-api/.env.example fishbill-api/.env
# Edit .env and add real values for JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
```

### FATAL: JWT_SECRET is still set to the example placeholder value

**Cause:** You copied `.env.example` but didn't change the placeholder values.  
**Fix:** Generate real secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Error: Cannot find module '...'

**Cause:** `npm install` was not run.  
**Fix:**
```bash
cd fishbill-api && npm install
```

### Port 4000 already in use

**Cause:** Another process is using port 4000.  
**Fix:**
```bash
# Find what's using it
sudo lsof -i :4000     # Linux/Mac
netstat -ano | findstr :4000   # Windows

# Kill it or change the port in .env
PORT=4001
```

---

## Database Connection Errors

### ECONNREFUSED 127.0.0.1:3306

**Cause:** MySQL is not running.  
**Fix:**
```bash
sudo systemctl start mysql    # Linux
# XAMPP: click Start next to MySQL in the XAMPP control panel
```

### Access denied for user 'fishbill_user'@'localhost'

**Cause:** Wrong DB_USER or DB_PASSWORD in `.env`.  
**Fix:** Verify credentials:
```bash
mysql -u fishbill_user -p -e "SELECT 1;" fishbill_db
# Enter the same password as DB_PASSWORD in .env
```

### Plugin caching_sha2_password could not be loaded

**Cause:** Old MySQL client (e.g. XAMPP 3.x ships MySQL 5.7 client) connecting to MySQL 8 server.  
**Fix:** The Node.js `mysql2` driver handles this automatically. This error only appears when using the command-line `mysql` binary from XAMPP. Solutions:
1. Install a standalone MySQL 8 client: `sudo apt install mysql-client-8.0`
2. Or change the MySQL user auth plugin:
   ```sql
   ALTER USER 'fishbill_user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';
   FLUSH PRIVILEGES;
   ```

### Unknown database 'fishbill_db'

**Cause:** Schema not loaded yet.  
**Fix:**
```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS fishbill_db CHARACTER SET utf8mb4;"
mysql -u fishbill_user -p fishbill_db < database/fishbill_schema.sql
```

---

## CORS Errors (Browser Console)

**Symptom:** `Access to fetch at 'http://...' from origin '...' has been blocked by CORS policy`  
**Cause:** Your frontend origin is not in `CORS_ORIGINS`.  
**Fix:**
```env
# In fishbill-api/.env
CORS_ORIGINS=https://your-domain.com,http://localhost,http://localhost:3000
```
Restart the API after changing `.env`.

---

## Nginx / Apache Proxy Not Working

### 502 Bad Gateway

**Cause:** Nginx/Apache can reach port 4000 but Node.js is not running.  
**Fix:**
```bash
pm2 status              # check API is running
pm2 restart fishbill-api
curl http://localhost:4000/health  # must work before nginx can proxy
```

### 404 on /api/ routes

**Cause:** Proxy config is missing or wrong path.  
**Fix:** Check proxy rules in nginx config — the location block must match `/api/` exactly:
```nginx
location ~ ^/(api|health|avatars|uploads|pdfs)(/|$) {
    proxy_pass http://127.0.0.1:4000;
```

**Apache:** Ensure mod_proxy is enabled:
```bash
sudo a2enmod proxy proxy_http && sudo systemctl reload apache2
```

### Apache: AH00526: Syntax error on line X

**Fix:** Test config before reloading:
```bash
sudo apache2ctl configtest   # must say: Syntax OK
```

---

## Android App Issues

### App shows update popup on fresh install

**Cause:** The installed APK's `versionCode` is lower than `app_latest_version_code` in the database.  
**Fix:** The `versionCode` in `app/build.gradle.kts` must equal the value in the DB. If you uploaded a new APK:
1. Bump `versionCode` in `build.gradle.kts`
2. Rebuild and upload the APK
3. Update DB: `UPDATE platform_settings SET setting_value='10' WHERE setting_key='app_latest_version_code';`

### App update download never finishes / spins forever

**Cause:** APK URL is wrong or unreachable from the device.  
**Fix:**
```bash
# Test from a phone browser or curl
curl -I https://github.com/.../fishbill-v10.apk
# Must return HTTP 200 or 302 redirect
```

Check Admin Panel → Platform → App Version URL is correct and publicly accessible.

### Android app gets "Αδύνατη σύνδεση" / Cannot connect

**Cause:** Wrong `BASE_URL` in the Android app, or server not reachable on that IP.  
**Fix:**
1. Check `BuildConfig.BASE_URL` in `app/build.gradle.kts`
2. For local testing, use your PC's LAN IP (e.g. `http://192.168.1.x:4000/`)
3. Ensure port 4000 is open locally (no firewall blocking)

### Android HTTP blocked (cleartext not permitted)

**Cause:** Android 9+ blocks HTTP by default. The app's `network_security_config.xml` allows cleartext only for local IPs.  
**Fix for production:** Use HTTPS (`https://your-domain.com`). For local dev, add your IP to `network_security_config.xml` cleartext exceptions.

---

## Email Not Sending

**Cause:** Brevo API key not configured or wrong sender email.  
**Fix:**
1. Admin Panel → Platform → Settings → Email → verify Brevo API key
2. The sender email must be verified in your Brevo account
3. Click **Send Test Email** button to confirm
4. Check API logs for the exact Brevo error:
   ```bash
   pm2 logs fishbill-api | grep -i brevo
   ```

---

## PDF Generation Failing

### ENOENT: no such file or directory, open '.../pdfs/...'

**Cause:** The `pdfs/` directory doesn't exist.  
**Fix:**
```bash
mkdir -p fishbill-api/pdfs
mkdir -p fishbill-api/uploads/invoices
mkdir -p fishbill-api/uploads/delivery-notes
```

### PDF is corrupt / empty

**Cause:** Node.js process ran out of memory during PDF generation.  
**Fix:** Increase PM2 memory limit:
```js
// ecosystem.config.js
max_memory_restart: '1G',  // increase from 512M
```

---

## Docker-Specific Issues

### Container exits immediately after start

```bash
docker compose logs api   # read the error
```

Common causes:
- Missing `.env.docker` file → `cp .env.docker.example .env.docker`
- Wrong DB password → check `DB_PASSWORD` matches `DB_ROOT_PASSWORD` / `MYSQL_PASSWORD`

### Database container not healthy

```bash
docker compose ps   # check db health status
docker compose logs db
```

Common fix — wait longer (MySQL takes 30-60 seconds on first boot):
```bash
docker compose up -d   # just wait 60 seconds and check again
```

### Changes to code not reflected after `docker compose up`

**Cause:** Docker cached the old image.  
**Fix:**
```bash
docker compose up -d --build api   # force rebuild
```

---

## Login Issues

### "Λάθος email ή κωδικός" with correct credentials

**Cause:** Password may have been changed, or account is for the wrong role.  
**Fix:** Reset admin password:
```bash
cd fishbill-api && node set-admin-password.js
```

Or directly in MySQL:
```sql
UPDATE users
SET password_hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
WHERE email = 'admin@fishbill.gr';
-- This sets the password to: Admin@123
```

### JWT token expired immediately

**Cause:** System clock mismatch between server and client.  
**Fix:** Sync server clock:
```bash
sudo timedatectl set-ntp true
```

---

## Performance Issues

### API responds slowly

1. Check DB query time via health endpoint: `curl /health` → `db_ping_ms` should be < 10ms
2. Check PM2 memory: `pm2 monit`
3. Check MySQL slow query log
4. Ensure indexes exist on `invoices.business_id`, `invoices.status`, `users.email`

### High memory usage

```bash
pm2 restart fishbill-api   # clears memory leaks in long-running process
```

For Docker:
```bash
docker compose restart api
```

---

## Getting More Help

- Check full API logs: `pm2 logs fishbill-api --lines 200`
- Check Nginx/Apache error logs for proxy issues
- Verify `.env` has no typos: `cat fishbill-api/.env`
- Test DB connection manually: `mysql -u fishbill_user -p fishbill_db -e "SELECT 1;"`
