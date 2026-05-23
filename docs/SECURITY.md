# FishBill — Security Hardening

## Before Going Live Checklist

```
[ ] Change default admin password (admin@fishbill.gr / Admin@123)
[ ] Generate real JWT_SECRET and JWT_REFRESH_SECRET (≥64 hex chars each)
[ ] Generate real ENCRYPTION_KEY (32 hex chars) — store it safely, never change after first use
[ ] Set strong DB_PASSWORD (not 'root', not blank)
[ ] Set NODE_ENV=production
[ ] Enable HTTPS (Let's Encrypt)
[ ] Set CORS_ORIGINS to your actual domain(s) only
[ ] Restrict MySQL user to minimum permissions
[ ] Enable firewall — block port 4000 from the internet
[ ] Remove or restrict direct database port (3306) access
```

---

## Secrets Management

### Generate secrets

```bash
# JWT secrets (64 bytes = 128 hex chars)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Encryption key (32 bytes = 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Rules

- **Never commit `.env` to git** — it is already in `.gitignore`, keep it that way.
- **Never reuse secrets** across environments (dev, staging, prod).
- **ENCRYPTION_KEY must never change** after first use. Data encrypted with the old key cannot be decrypted with a new one. Store it in a password manager.
- **Rotate JWT secrets** if you suspect a breach. All users will be logged out (tokens invalidated).

---

## Network / Firewall

The Node.js API runs on port 4000 and should **never** be directly exposed to the internet — only the web server (Nginx/Apache on port 80/443) should be public.

### UFW (Ubuntu)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Do NOT open 4000 or 3306 to the internet
sudo ufw enable
```

### iptables

```bash
# Block external access to Node.js API and MySQL
iptables -A INPUT -p tcp --dport 4000 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 4000 -j DROP
iptables -A INPUT -p tcp --dport 3306 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 3306 -j DROP
```

---

## HTTPS

HTTPS is mandatory in production. The Android app uses `BASE_URL` — if it's HTTP, the app's network security config may block the connection.

**Let's Encrypt (Nginx):**
```bash
sudo certbot --nginx -d your-domain.com
```

**Let's Encrypt (Apache):**
```bash
sudo certbot --apache -d your-domain.com
```

**Auto-renewal test:**
```bash
sudo certbot renew --dry-run
```

After enabling HTTPS, update your `.env`:
```env
APP_URL=https://your-domain.com
API_URL=https://your-domain.com/api
APP_BASE_URL=https://your-domain.com
CORS_ORIGINS=https://your-domain.com
```

---

## MySQL Hardening

### Minimum-privilege DB user

```sql
-- Only grant what the app actually needs
GRANT SELECT, INSERT, UPDATE, DELETE, ALTER, CREATE, INDEX
  ON fishbill_db.*
  TO 'fishbill_user'@'localhost'
  IDENTIFIED BY 'strong_random_password';

-- Revoke unnecessary global privileges
REVOKE ALL PRIVILEGES ON *.* FROM 'fishbill_user'@'localhost';
FLUSH PRIVILEGES;
```

### Disable remote MySQL access

In `/etc/mysql/mysql.conf.d/mysqld.cnf`:
```ini
bind-address = 127.0.0.1
```

Restart MySQL: `sudo systemctl restart mysql`

---

## Built-in Rate Limiting

The API has rate limiting already configured:

| Endpoint | Limit |
|----------|-------|
| All `/api/` routes | 1,000 req / 15 min per IP |
| `/api/auth/login` | 30 req / 60 min per IP |
| `/api/auth/admin-login` | 30 req / 60 min per IP |
| `/api/auth/forgot-password` | 5 req / 10 min per IP |
| `/api/auth/owner-recovery` | 5 req / 10 min per IP |

These are set in `fishbill-api/src/app.js` and require no configuration.

---

## File Upload Security

- `multer` restricts upload types and sizes
- Uploaded files are stored in `public/uploads/` (weighing slips) and `public/avatars/`
- These directories are served statically but require knowing the UUID filename — no directory listing
- Block direct `.env`, `.sql`, `.log` file access via Nginx/Apache config (already in the provided configs)

---

## Headers

The API sends these security headers via `helmet`:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | Restrictive — see `src/app.js` |

---

## Regular Maintenance

- **Update Node.js** every LTS release (current: 20.x → next: 22.x)
- **Update npm dependencies** monthly: `npm audit && npm update`
- **Rotate JWT secrets** every 6-12 months (causes all users to re-login)
- **Rotate DB password** every 6-12 months
- **Review access logs** for unusual patterns
