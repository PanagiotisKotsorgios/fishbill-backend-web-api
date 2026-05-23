# FishBill — Upgrading

## How Updates Work

- **Database schema**: The API runs `addColumnIfMissing()` on every startup — new columns are added automatically. You never need to run ALTER TABLE manually.
- **Code**: Pull the latest code and restart the API.
- **No downtime migrations**: All schema changes are additive (new columns with defaults). The API can run briefly against a schema that has slightly older columns without breaking.

---

## Upgrade: Docker

```bash
cd /path/to/fishbill

# Pull latest code
git pull origin main

# Rebuild and restart (db container is untouched — data is in a named volume)
docker compose up -d --build api web

# Verify
docker compose ps
curl http://localhost/health
```

Watch for startup migration logs:

```bash
docker compose logs api | grep -i migration
```

---

## Upgrade: Apache / Nginx (PM2)

```bash
cd /var/www/fishbill

# Pull latest code
git pull origin main

# Install any new dependencies
cd fishbill-api
npm ci --omit=dev
cd ..

# Restart the API (PM2 picks up the new code)
pm2 restart fishbill-api

# Verify
pm2 status
curl http://localhost:4000/health
```

Watch startup migrations:

```bash
pm2 logs fishbill-api --lines 50 | grep -i migration
```

---

## Upgrade: Windows (XAMPP / Development)

```powershell
cd E:\xaamp\htdocs\fishbill
git pull origin main

cd fishbill-api
npm install

# Restart the API (Ctrl+C in the terminal window, then)
npm start
```

---

## Upgrading the Android App

When a new APK is released:

1. Build the new APK with a bumped `versionCode` in `app/build.gradle.kts`
2. Upload it to GitHub Releases
3. Update the DB:

   ```sql
   UPDATE platform_settings SET setting_value = '11'
     WHERE setting_key = 'app_latest_version_code';
   UPDATE platform_settings SET setting_value = 'https://github.com/.../fishbill-v11.apk'
     WHERE setting_key = 'app_latest_apk_url';
   ```

   Or via Admin Panel → **Platform** → **Settings** → App Version.

Devices running an older version will see the update popup on next launch and auto-download the new APK.

**Rule:** The `versionCode` in `build.gradle.kts` must match `app_latest_version_code` in the DB for the installed version to not show the update popup.

---

## Rolling Back

If something breaks after an upgrade:

```bash
# Find the previous commit hash
git log --oneline -10

# Roll back code
git checkout <previous-commit-hash>

# Restart API
pm2 restart fishbill-api   # or: docker compose up -d --build api
```

Column additions from startup migrations cannot be automatically removed. If a new column causes issues in a rollback scenario, remove it manually:

```sql
ALTER TABLE tablename DROP COLUMN columnname;
```

---

## Version History

| Version | versionCode | Key changes |
|---------|------------|-------------|
| 1.0.9 | 10 | Docker + Apache packaging, deployment guides |
| 1.0.8 | 9 | APK auto-updater via HttpURLConnection |
| 1.0.7 | 8 | Subscription expiry lock, billing cycle reset |
| 1.0.6 | 7 | Push notifications (FCM), AFM auto-fill |
| 1.0.5 | 6 | Weighing slips, delivery notes AADE |
| 1.0.4 | 5 | Admin pagination, offline mode fix |
