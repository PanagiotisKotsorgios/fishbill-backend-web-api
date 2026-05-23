# FishBill — Apache Deployment

Use this guide when your server runs **Apache** (e.g. a classic LAMP VPS, cPanel server, or Debian/Ubuntu with `apache2`).

Apache serves the static HTML frontend and proxies all API traffic to a **Node.js** process kept alive by **PM2**.

---

## Prerequisites

- Ubuntu/Debian VPS (or any Linux with Apache 2.4+)
- Node.js 20 LTS (`sudo apt install nodejs` or use [nvm](https://github.com/nvm-sh/nvm))
- MySQL 8 (already running — `sudo apt install mysql-server`)
- PM2: `sudo npm install -g pm2`

---

## 1 — Clone the repo

```bash
sudo mkdir -p /var/www/fishbill
sudo chown $USER:$USER /var/www/fishbill
git clone https://github.com/PanagiotisKotsorgios/fishbill-backend-web-api.git /var/www/fishbill
cd /var/www/fishbill
```

---

## 2 — Set up the database

```bash
sudo mysql -u root
```
```sql
CREATE DATABASE IF NOT EXISTS fishbill_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'fishbill_user'@'localhost'
  IDENTIFIED BY 'your_strong_password';

GRANT ALL PRIVILEGES ON fishbill_db.* TO 'fishbill_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
```bash
mysql -u fishbill_user -p fishbill_db < /var/www/fishbill/database/fishbill_schema.sql
```

---

## 3 — Configure the API

```bash
cp /var/www/fishbill/fishbill-api/.env.example /var/www/fishbill/fishbill-api/.env
nano /var/www/fishbill/fishbill-api/.env
```

Fill in at minimum:

```env
NODE_ENV=production
PORT=4000

DB_HOST=localhost
DB_PORT=3306
DB_USER=fishbill_user
DB_PASSWORD=your_strong_password
DB_NAME=fishbill_db

# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<64-char hex>
JWT_REFRESH_SECRET=<64-char hex>

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<32-char hex>

APP_URL=http://your-domain.com
API_URL=http://your-domain.com/api
APP_BASE_URL=http://your-domain.com
CORS_ORIGINS=http://your-domain.com
ADMIN_EMAIL=admin@your-domain.com
```

Install API dependencies:
```bash
cd /var/www/fishbill/fishbill-api
npm ci --omit=dev
cd /var/www/fishbill
```

---

## 4 — Start the API with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save          # persist across reboots
pm2 startup       # follow the printed command to register the init script
```

Verify:
```bash
pm2 status
curl http://localhost:4000/health
```

---

## 5 — Configure Apache

Enable required modules:
```bash
sudo a2enmod proxy proxy_http headers rewrite
```

Copy the VirtualHost config and enable it:
```bash
sudo cp /var/www/fishbill/apache/vhost.conf /etc/apache2/sites-available/fishbill.conf
```

Edit `/etc/apache2/sites-available/fishbill.conf`:
- Replace `your-domain.com` with your actual domain
- Replace `/var/www/fishbill` with your actual path (if different)

```bash
sudo a2ensite fishbill
sudo a2dissite 000-default   # disable the default site if you don't need it
sudo apache2ctl configtest   # should print: Syntax OK
sudo systemctl reload apache2
```

The site is now live at **http://your-domain.com**.

---

## 6 — HTTPS with Let's Encrypt (recommended)

```bash
sudo apt install certbot python3-certbot-apache -y
sudo certbot --apache -d your-domain.com -d www.your-domain.com
```

Certbot automatically edits the VirtualHost and sets up auto-renewal.

---

## Useful Commands

```bash
# API logs
pm2 logs fishbill-api

# Restart API after a code change
pm2 restart fishbill-api

# Apache logs
sudo tail -f /var/log/apache2/fishbill-error.log

# MySQL shell
mysql -u fishbill_user -p fishbill_db

# Health check
curl http://localhost:4000/health
```

---

## File Permissions

Make sure Apache can read the static files and the API can write to its directories:
```bash
# Static files — readable by Apache
sudo chown -R $USER:www-data /var/www/fishbill
sudo chmod -R 755 /var/www/fishbill

# API writable directories
mkdir -p /var/www/fishbill/fishbill-api/{uploads/invoices,uploads/delivery-notes,pdfs,public/avatars,public/uploads/weighing-slips,backups,logs}
chmod -R 775 /var/www/fishbill/fishbill-api/{uploads,pdfs,public/avatars,public/uploads,backups,logs}
```

---

## Choosing Between Docker and Apache

| | Docker | Apache (this guide) |
|--|--------|---------------------|
| **Setup** | One command | A few manual steps |
| **Portability** | Any OS with Docker | Linux + Apache only |
| **Shared hosting** | ✗ | ✓ (if Node.js allowed) |
| **Isolation** | Full container isolation | Shared process space |
| **SSL** | Via reverse proxy | Via Certbot directly |
