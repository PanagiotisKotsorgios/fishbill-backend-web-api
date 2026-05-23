# FishBill — Database Guide

## Schema & Initial Setup

The full schema is at `database/fishbill_schema.sql`. It is safe to run multiple times (`CREATE TABLE IF NOT EXISTS` throughout).

**Default admin account created by the schema:**
```
Email:    admin@fishbill.gr
Password: Admin@123
Role:     super_admin
```
Change this password immediately after first login.

### Load the schema

**Linux / Mac:**
```bash
mysql -u fishbill_user -p fishbill_db < database/fishbill_schema.sql
```

**Windows (XAMPP):**
```powershell
E:\xaamp\mysql\bin\mysql.exe -u root fishbill_db < E:\xaamp\htdocs\fishbill\database\fishbill_schema.sql
```

**phpMyAdmin:**
Select the database → Import → choose `fishbill_schema.sql`

**Docker:**
Docker automatically runs `database/fishbill_schema.sql` on first start (mounted in `/docker-entrypoint-initdb.d/`). No manual step needed.

---

## Migrations

FishBill uses two migration mechanisms:

### 1. Startup migrations (automatic)

`fishbill-api/src/server.js` runs `addColumnIfMissing()` on every startup. These are **additive-only** (never drop or rename columns) and completely safe to run repeatedly. They ensure that columns added after the initial schema are present in any existing database.

You do not need to run these manually — they happen automatically when the API starts.

### 2. SQL migration files (manual)

`database/migrations/` contains numbered SQL files for reference. These were applied incrementally during development. On a **fresh** deployment using `fishbill_schema.sql`, they are already included — you do not need to run them.

If you are **upgrading an existing** installation to a new version, see [Upgrading](UPGRADING.md).

---

## Backup

### Quick manual backup (mysqldump)

```bash
mysqldump -u fishbill_user -p fishbill_db > backup-$(date +%Y%m%d-%H%M%S).sql
```

### Backup via Admin Panel

Admin Panel → **Backups** creates a JSON snapshot of all critical tables. Useful for data export but not a full SQL dump.

### Automated daily backup (cron)

Add to crontab (`crontab -e`):

```cron
0 2 * * * mysqldump -u fishbill_user -pYOUR_PASSWORD fishbill_db | gzip > /backups/fishbill-$(date +\%Y\%m\%d).sql.gz
# Keep 30 days
0 3 * * * find /backups -name "fishbill-*.sql.gz" -mtime +30 -delete
```

### Docker backup

```bash
# Dump database from running container
docker compose exec db mysqldump -u root -p"$DB_ROOT_PASSWORD" fishbill_db > backup-$(date +%Y%m%d).sql

# Backup all named volumes (user uploads, avatars, etc.)
docker run --rm \
  -v fishbill_api_uploads:/data/uploads \
  -v fishbill_api_avatars:/data/avatars \
  -v $(pwd)/backup:/out \
  alpine tar czf /out/fishbill-files-$(date +%Y%m%d).tar.gz /data
```

---

## Restore

### Restore from SQL dump

```bash
mysql -u fishbill_user -p fishbill_db < backup-20260101.sql
```

If the dump was gzipped:

```bash
gunzip -c backup-20260101.sql.gz | mysql -u fishbill_user -p fishbill_db
```

### Restore in Docker

```bash
# Copy SQL file into the db container and import
docker compose cp backup-20260101.sql db:/tmp/restore.sql
docker compose exec db bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" fishbill_db < /tmp/restore.sql'
```

---

## Common Database Tasks

### Reset admin password

```sql
UPDATE users
SET password_hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi' -- bcrypt of 'Admin@123'
WHERE email = 'admin@fishbill.gr';
```

Or use the included script:

```bash
cd fishbill-api
node set-admin-password.js
```

### View active businesses

```sql
SELECT id, name, afm, plan, subscription_active, subscription_ends_at
FROM businesses
WHERE is_active = 1
ORDER BY created_at DESC;
```

### View platform settings

```sql
SELECT setting_key, setting_value FROM platform_settings ORDER BY setting_key;
```

### Update app version (for auto-update)

```sql
UPDATE platform_settings SET setting_value = '11' WHERE setting_key = 'app_latest_version_code';
UPDATE platform_settings SET setting_value = 'https://github.com/.../fishbill-v11.apk' WHERE setting_key = 'app_latest_apk_url';
```

---

## MySQL User Permissions

For production, the `fishbill_user` should have only the minimum needed permissions:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP
  ON fishbill_db.*
  TO 'fishbill_user'@'localhost';
```

Remove `CREATE` and `ALTER` if you want to lock down after initial deployment (the startup migrations need them temporarily).

---

## Timezone

The API connection pool uses `timezone: '+02:00'` (Greece/EET). If your MySQL server is in a different timezone, this offset ensures dates are stored correctly. Do not change this unless you understand the implications for existing data.
