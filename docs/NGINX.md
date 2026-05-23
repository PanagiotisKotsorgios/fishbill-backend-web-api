# FishBill — Nginx Deployment (Linux VPS)

Use this guide for a **Linux VPS** running Nginx without Docker (e.g. DigitalOcean, Hetzner, Vultr, Linode).

## Prerequisites

- Ubuntu 22.04 / Debian 12 (or any modern Linux)
- Root or sudo access
- A domain name pointing to your server IP

---

## 1 — Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MySQL 8
sudo apt install -y mysql-server

# Nginx
sudo apt install -y nginx

# PM2 (process manager for Node.js)
sudo npm install -g pm2

# Certbot for SSL
sudo apt install -y certbot python3-certbot-nginx
```

---

## 2 — Set Up MySQL

```bash
sudo mysql_secure_installation
```

Then create the database and user:

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

---

## 3 — Deploy the Code

```bash
sudo mkdir -p /var/www/fishbill
sudo chown $USER:$USER /var/www/fishbill
git clone https://github.com/PanagiotisKotsorgios/fishbill-backend-web-api.git /var/www/fishbill
cd /var/www/fishbill
```

Load the database schema:

```bash
mysql -u fishbill_user -p fishbill_db < /var/www/fishbill/database/fishbill_schema.sql
```

---

## 4 — Configure the API

```bash
cp /var/www/fishbill/fishbill-api/.env.example /var/www/fishbill/fishbill-api/.env
nano /var/www/fishbill/fishbill-api/.env
```

Minimum required settings:

```env
NODE_ENV=production
PORT=4000

DB_HOST=localhost
DB_USER=fishbill_user
DB_PASSWORD=your_strong_password
DB_NAME=fishbill_db

JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<generate same way>
ENCRYPTION_KEY=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

APP_URL=https://your-domain.com
API_URL=https://your-domain.com/api
APP_BASE_URL=https://your-domain.com
CORS_ORIGINS=https://your-domain.com
ADMIN_EMAIL=admin@your-domain.com
```

Install dependencies:

```bash
cd /var/www/fishbill/fishbill-api
npm ci --omit=dev
```

---

## 5 — Start the API with PM2

```bash
cd /var/www/fishbill
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

Verify:

```bash
pm2 status
curl http://localhost:4000/health
```

---

## 6 — Configure Nginx

Create the site config:

```bash
sudo nano /etc/nginx/sites-available/fishbill
```

Paste the following, replacing `your-domain.com` and the path:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    root /var/www/fishbill;
    index index.html;

    client_max_body_size 20M;

    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;

    add_header X-Content-Type-Options  "nosniff"                        always;
    add_header X-Frame-Options         "SAMEORIGIN"                     always;
    add_header Referrer-Policy         "strict-origin-when-cross-origin" always;

    # Proxy API traffic to Node.js
    location ~ ^/(api|health|apk|avatars|uploads|pdfs)(/|$) {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout    60s;
    }

    # Never cache HTML
    location ~* \.html$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        try_files $uri $uri/ =404;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Block sensitive files
    location ~* \.(env|sh|sql|log|bak|key|pem)$ {
        deny all; return 404;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/fishbill /etc/nginx/sites-enabled/
sudo nginx -t          # must print: syntax is ok
sudo systemctl reload nginx
```

---

## 7 — HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Certbot auto-edits the Nginx config and sets up a renewal cron. Test renewal:

```bash
sudo certbot renew --dry-run
```

---

## File Permissions

```bash
sudo chown -R $USER:www-data /var/www/fishbill
sudo chmod -R 755 /var/www/fishbill

# API needs write access to these directories
mkdir -p /var/www/fishbill/fishbill-api/{uploads/invoices,uploads/delivery-notes,pdfs,public/avatars,public/uploads/weighing-slips,backups,logs}
chmod -R 775 /var/www/fishbill/fishbill-api/{uploads,pdfs,public/avatars,public/uploads,backups,logs}
```

---

## Useful Commands

```bash
# API logs
pm2 logs fishbill-api --lines 100

# Restart API
pm2 restart fishbill-api

# Nginx logs
sudo tail -f /var/log/nginx/error.log

# Health check
curl https://your-domain.com/health
```

---

## Next Step

See [First Boot Setup](FIRST-BOOT.md) to configure the admin panel.
