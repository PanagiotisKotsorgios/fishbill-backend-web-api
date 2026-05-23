# FishBill — Windows Setup

Two scenarios covered here:

- **Local Development** — Windows 10/11 + XAMPP (recommended for development)
- **Windows Server** — IIS or Apache httpd for production

---

## Local Development (Windows 10/11 + XAMPP)

### Prerequisites

- [XAMPP](https://www.apachefriends.org/) — includes Apache + MySQL
- [Node.js 20 LTS](https://nodejs.org/) (choose the Windows installer)
- [Git for Windows](https://git-scm.com/)

---

### Step 1 — Clone the repo

Open Git Bash or PowerShell:

```powershell
cd E:\xaamp\htdocs
git clone https://github.com/PanagiotisKotsorgios/fishbill-backend-web-api.git fishbill
cd fishbill
```

Or copy the project folder to `E:\xaamp\htdocs\fishbill\` manually.

---

### Step 2 — Set up MySQL

1. Start XAMPP and click **Start** next to MySQL
2. Open **phpMyAdmin**: `http://localhost/phpmyadmin`
3. Create database `fishbill_db` (utf8mb4_unicode_ci)
4. Select the database, click **Import**, choose `database/fishbill_schema.sql`

Or via MySQL command line:

```powershell
E:\xaamp\mysql\bin\mysql.exe -u root -p
```
```sql
SOURCE E:/xaamp/htdocs/fishbill/database/fishbill_schema.sql;
EXIT;
```

---

### Step 3 — Configure the API

```powershell
cd E:\xaamp\htdocs\fishbill\fishbill-api
copy .env.example .env
notepad .env
```

Edit these values:

```env
NODE_ENV=development
PORT=4000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=          # blank if XAMPP MySQL has no root password
DB_NAME=fishbill_db

JWT_SECRET=any_long_random_string_at_least_32_chars
JWT_REFRESH_SECRET=another_long_random_string_at_least_32_chars
ENCRYPTION_KEY=a_32_character_hex_string_here_0

APP_URL=http://localhost
API_URL=http://localhost:4000
APP_BASE_URL=http://localhost/fishbill
CORS_ORIGINS=http://localhost,http://localhost:3000
ADMIN_EMAIL=admin@fishbill.gr
```

> **XAMPP MySQL password**: By default XAMPP MySQL has no root password. Leave `DB_PASSWORD=` blank. If you set a password in phpMyAdmin, use it here.

---

### Step 4 — Install and Start the API

```powershell
cd E:\xaamp\htdocs\fishbill\fishbill-api
npm install
npm start
```

Test: open `http://localhost:4000/health` — should return `{"status":"ok",...}`

---

### Step 5 — Access the App

Make sure XAMPP Apache is running, then open:

| URL | What it is |
|-----|-----------|
| `http://localhost/fishbill/` | Landing page |
| `http://localhost/fishbill/admin/` | Admin panel |
| `http://localhost/fishbill/app/` | User web app |
| `http://localhost:4000/health` | API health check |

---

### Start Script

Double-click `start-api.bat` in the project root to start the API in a terminal window. Keep it open while developing.

---

### Android App (Local Testing)

Find your PC's local IP (run `ipconfig` in cmd):

```env
# In fishbill-api/.env (or app/build.gradle.kts):
BASE_URL=http://192.168.1.x:4000/
```

Also add your phone's connection to CORS:

```env
CORS_ORIGINS=http://localhost,http://192.168.1.x,http://192.168.1.x:4000
```

---

## Windows Server (Production)

### Option A: Apache httpd for Windows

1. Download [Apache httpd for Windows](https://www.apachelounge.com/download/)
2. Install Node.js 20 LTS
3. Install PM2: `npm install -g pm2`
4. Copy the project to `C:\inetpub\fishbill\` or similar
5. Set up the Apache `httpd.conf` with `mod_proxy`:

   ```apache
   LoadModule proxy_module modules/mod_proxy.so
   LoadModule proxy_http_module modules/mod_proxy_http.so

   <VirtualHost *:80>
       ServerName your-domain.com
       DocumentRoot "C:/inetpub/fishbill"

       ProxyPreserveHost On
       ProxyPass        /api/     http://127.0.0.1:4000/api/
       ProxyPassReverse /api/     http://127.0.0.1:4000/api/
       ProxyPass        /health   http://127.0.0.1:4000/health
       ProxyPassReverse /health   http://127.0.0.1:4000/health
       ProxyPass        /avatars/ http://127.0.0.1:4000/avatars/
       ProxyPassReverse /avatars/ http://127.0.0.1:4000/avatars/
       ProxyPass        /uploads/ http://127.0.0.1:4000/uploads/
       ProxyPassReverse /uploads/ http://127.0.0.1:4000/uploads/
       ProxyPass        /pdfs/    http://127.0.0.1:4000/pdfs/
       ProxyPassReverse /pdfs/    http://127.0.0.1:4000/pdfs/

       <Directory "C:/inetpub/fishbill">
           Options -Indexes
           AllowOverride All
           Require all granted
       </Directory>
   </VirtualHost>
   ```

6. Start the API with PM2:

   ```powershell
   pm2 start C:\inetpub\fishbill\ecosystem.config.js --env production
   pm2 save
   pm2 startup   # registers PM2 as a Windows service
   ```

### Option B: IIS with iisnode

1. Install [IIS](https://docs.microsoft.com/iis) and [iisnode](https://github.com/Azure/iisnode)
2. Set up a reverse proxy in IIS using the **URL Rewrite** module
3. Point the Node.js app to `fishbill-api/src/server.js`

This is more complex — the Apache httpd approach (Option A) is recommended for Windows Server.

### MySQL on Windows Server

Install [MySQL Community Server](https://dev.mysql.com/downloads/mysql/) and run:

```powershell
mysql -u root -p < C:\inetpub\fishbill\database\fishbill_schema.sql
```

---

## Next Step

See [First Boot Setup](FIRST-BOOT.md) to configure the admin panel after deployment.
