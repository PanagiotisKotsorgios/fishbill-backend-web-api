# FishBill — Backup Guide

## What to Back Up

| Data | Location | Priority |
|------|----------|----------|
| MySQL database | `fishbill_db` | Critical |
| User avatars | `fishbill-api/public/avatars/` | High |
| Generated PDFs | `fishbill-api/uploads/` | High |
| Weighing slip photos | `fishbill-api/public/uploads/weighing-slips/` | Medium |
| `.env` file | `fishbill-api/.env` | Critical (config) |
| `ENCRYPTION_KEY` | in `.env` | Critical — back up separately |

---

## Database Backup

### Manual backup

```bash
# Full backup
mysqldump -u fishbill_user -p fishbill_db > fishbill-$(date +%Y%m%d-%H%M%S).sql

# Compressed
mysqldump -u fishbill_user -p fishbill_db | gzip > fishbill-$(date +%Y%m%d).sql.gz
```

### Automated daily backup (cron)

```bash
crontab -e
```

Add:

```cron
# Daily at 02:00 — database backup
0 2 * * * mysqldump -u fishbill_user -pYOUR_PASSWORD fishbill_db | gzip > /var/backups/fishbill/db-$(date +\%Y\%m\%d).sql.gz

# Keep only last 30 days
0 3 * * * find /var/backups/fishbill -name "db-*.sql.gz" -mtime +30 -delete
```

Create the backup directory:

```bash
sudo mkdir -p /var/backups/fishbill
sudo chown $USER:$USER /var/backups/fishbill
```

---

## File Backup

### Uploads and avatars

```bash
tar czf fishbill-files-$(date +%Y%m%d).tar.gz \
  fishbill-api/public/avatars/ \
  fishbill-api/public/uploads/ \
  fishbill-api/uploads/
```

### Automated file backup (cron)

```cron
# Weekly on Sunday at 03:00
0 3 * * 0 tar czf /var/backups/fishbill/files-$(date +\%Y\%m\%d).tar.gz \
  /var/www/fishbill/fishbill-api/public/avatars/ \
  /var/www/fishbill/fishbill-api/public/uploads/ \
  /var/www/fishbill/fishbill-api/uploads/
```

---

## Docker Backup

### Database

```bash
# Dump from the running MySQL container
docker compose exec db mysqldump \
  -u root -p"$DB_ROOT_PASSWORD" fishbill_db | \
  gzip > fishbill-db-$(date +%Y%m%d).sql.gz
```

### Named volumes (files)

```bash
# Backup all persistent file volumes
docker run --rm \
  -v fishbill_api_uploads:/data/uploads:ro \
  -v fishbill_api_avatars:/data/avatars:ro \
  -v fishbill_api_weighing_slips:/data/weighing_slips:ro \
  -v $(pwd)/backup:/out \
  alpine tar czf /out/fishbill-files-$(date +%Y%m%d).tar.gz /data
```

### Docker cron backup script

Create `/opt/fishbill-backup.sh`:

```bash
#!/bin/bash
set -e
BACKUP_DIR="/var/backups/fishbill"
DATE=$(date +%Y%m%d-%H%M%S)
cd /path/to/fishbill

# DB
docker compose exec -T db mysqldump \
  -u root -p"$(grep DB_ROOT_PASSWORD .env.docker | cut -d= -f2)" fishbill_db | \
  gzip > "$BACKUP_DIR/db-$DATE.sql.gz"

# Files
docker run --rm \
  -v fishbill_api_uploads:/data/uploads:ro \
  -v fishbill_api_avatars:/data/avatars:ro \
  -v fishbill_api_weighing_slips:/data/weighing_slips:ro \
  -v $BACKUP_DIR:/out \
  alpine tar czf /out/files-$DATE.tar.gz /data

# Cleanup (keep 30 days)
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete

echo "Backup complete: $DATE"
```

```bash
chmod +x /opt/fishbill-backup.sh
# Add to cron: daily at 02:00
echo "0 2 * * * /opt/fishbill-backup.sh >> /var/log/fishbill-backup.log 2>&1" | crontab -
```

---

## Restore

### Restore database from dump

```bash
# Plain SQL
mysql -u fishbill_user -p fishbill_db < fishbill-20260101.sql

# Gzipped
gunzip -c fishbill-20260101.sql.gz | mysql -u fishbill_user -p fishbill_db
```

### Restore files

```bash
tar xzf fishbill-files-20260101.tar.gz -C /var/www/fishbill/
```

### Restore Docker volumes

```bash
# Stop the stack first
docker compose down

# Restore DB volume
docker compose up -d db
gunzip -c fishbill-db-20260101.sql.gz | \
  docker compose exec -T db mysql -u root -p"$DB_ROOT_PASSWORD" fishbill_db

# Restore file volumes
docker run --rm \
  -v fishbill_api_uploads:/data/uploads \
  -v fishbill_api_avatars:/data/avatars \
  -v $(pwd)/backup:/src \
  alpine tar xzf /src/fishbill-files-20260101.tar.gz -C /

docker compose up -d
```

---

## Built-in Backup via Admin Panel

Admin Panel → **Backups** exports a JSON snapshot of:
- All businesses
- All users
- All invoices
- All customers and products

This is useful for data portability but is **not** a replacement for a full `mysqldump` — it does not capture the full schema or all tables.
