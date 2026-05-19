# FishBill — Setup Guide (Windows 10 + XAMPP + MySQL Workbench)

## Prerequisites
- XAMPP installed and running (Apache + MySQL)
- MySQL Workbench installed
- Node.js 18+ installed (download from nodejs.org)
- Git (optional)

---

## Step 1 — Create the Database

1. Open **MySQL Workbench**
2. Connect to your local MySQL (root or any user)
3. Open `database/fishbill_schema.sql`
4. Click **Run** (lightning bolt icon) to execute the full schema
5. You should see: `FishBill schema created successfully!`

**Default credentials created:**
- Email: `admin@fishbill.gr`
- Password: `Admin@123
- `
- Role: `super_admin`

> Change the password after first login!

---

## Step 2 — Configure the Backend API

1. Open a terminal in `fishbill-api/` folder:
   ```
   cd e:\xaamp\htdocs\fishbill\fishbill-api
   ```

2. Copy `.env.example` to `.env`:
   ```
   copy .env.example .env
   ```

3. Edit `.env` with your MySQL credentials:
   ```
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_mysql_root_password
   DB_NAME=fishbill_db
   ```
   > If you created a dedicated `fishbill_user` in MySQL Workbench, use those credentials instead.

4. Install dependencies:
   ```
   npm install
   ```

5. Start the API:
   ```
   npm start
   ```
   or for development with auto-reload:
   ```
   npm run dev
   ```

6. Test it works — open browser: `http://localhost:4000/health`
   Should return: `{"status":"ok","timestamp":"..."}`

---

## Step 3 — Start the Admin Dashboard

The admin web is pure HTML/JS — served directly by XAMPP Apache.

1. Make sure XAMPP Apache is running
2. Open your browser and go to:
   ```
   http://localhost/fishbill/admin/
   ```
3. Login with:
   - Email: `admin@fishbill.gr`
   - Password: `Admin@123`

---

## Project Structure

```
fishbill/
├── database/
│   └── fishbill_schema.sql      ← Run this in MySQL Workbench
├── fishbill-api/                ← Node.js backend (port 4000)
│   ├── package.json
│   ├── .env                     ← Your local config (gitignored)
│   ├── .env.example             ← Template
│   ├── pdfs/                    ← Generated PDFs stored here
│   └── src/
│       ├── server.js
│       ├── app.js
│       ├── config/
│       ├── middleware/
│       ├── routes/
│       ├── services/
│       └── utils/
├── admin/                       ← Web dashboard (served by XAMPP)
│   ├── index.html               ← Login page
│   ├── dashboard.html
│   ├── invoices.html
│   ├── customers.html
│   ├── products.html
│   ├── users.html
│   ├── businesses.html          ← super_admin only
│   ├── exports.html
│   ├── logs.html
│   ├── backups.html             ← super_admin only
│   └── js/
│       ├── config.js
│       ├── api.js
│       ├── auth.js
│       ├── ui.js
│       └── sidebar.js
└── SETUP.md                     ← This file
```

---

## API Endpoints Reference

All endpoints at `http://localhost:4000/api/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/login | Login |
| POST | /auth/register | Register new business |
| POST | /auth/refresh | Refresh token |
| GET | /businesses | List businesses (super_admin) |
| GET | /customers | List customers |
| POST | /customers | Create customer |
| GET | /products | List products |
| POST | /products | Create product |
| GET | /invoices | List invoices |
| POST | /invoices | Create invoice |
| POST | /invoices/:id/issue | Issue invoice |
| POST | /invoices/:id/transmit | Transmit to provider |
| GET | /invoices/:id/pdf | Download PDF |
| GET | /stats/overview | Dashboard stats |
| GET | /exports/invoices | Export CSV |

---

## User Roles

| Role | Access |
|------|--------|
| `super_admin` | Everything — all businesses |
| `owner` | Own business only — full control |
| `accountant` | Read-only — view, export |
| `captain` | Mobile app only |

---

## Creating Your First Business (via API)

Use Postman, curl, or the register form:

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "business": {
      "name": "Ψαράς Κώστας",
      "afm": "123456789",
      "email": "kostas@example.com",
      "phone": "6912345678",
      "city": "Θεσσαλονίκη"
    },
    "owner": {
      "full_name": "Κώστας Παπαδόπουλος",
      "email": "kostas@example.com",
      "password": "SecurePass123!"
    }
  }'
```

---

## Troubleshooting

**MySQL connection fails:**
- Check XAMPP MySQL is running (green in XAMPP control panel)
- Verify DB_PASSWORD in `.env` matches your MySQL root password
- Try connecting in MySQL Workbench first

**Port 4000 already in use:**
- Change `PORT=4001` in `.env`
- Update `admin/js/config.js`: `API_URL: 'http://localhost:4001/api'`

**CORS errors in browser:**
- Add `http://localhost` to `CORS_ORIGINS` in `.env`
- Restart the API server

**PDF not generating:**
- The `fishbill-api/pdfs/` directory is created automatically on first PDF request
- Check Node.js has write permission to that folder

---

## Next Steps (Android App)

The backend API is ready for the Android app. The Android app will:
- POST /auth/login to get JWT token
- GET /products/favorites for the quick-select list
- GET /customers/recent for quick customer selection
- POST /invoices to create and issue invoices
- GET /invoices/:id/pdf to download PDF

---

## Production Deployment (Papaki VPS)

See Section 18 in `fishbill-complete-guide.md` for full VPS deployment instructions.

Key differences from local:
- Set `NODE_ENV=production` in `.env`
- Use Nginx as reverse proxy
- Use PM2 for process management
- Configure SSL with Let's Encrypt
- Set real JWT secrets (64 random chars)
- Set real ENCRYPTION_KEY (32 hex bytes)
