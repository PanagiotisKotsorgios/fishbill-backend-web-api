# FishBill — Deployment Hub

FishBill is a full-stack fisheries management platform. This document is your starting point for running it anywhere.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser / Android App             │
└────────────────────┬────────────────────────────────┘
                     │ HTTP / HTTPS
         ┌───────────▼───────────┐
         │  Web Server / Proxy   │  Apache · Nginx · Docker
         │  Serves static HTML   │
         │  Proxies /api/* →     │
         └───────────┬───────────┘
                     │ localhost:4000
         ┌───────────▼───────────┐
         │   Node.js API (PM2)   │  Port 4000
         │   fishbill-api/       │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   MySQL 8 Database    │  Port 3306
         └───────────────────────┘
```

## Deployment Options

| Guide | Best for |
|-------|----------|
| [Docker](DOCKER.md) | Any Linux VPS — easiest, most portable |
| [Apache + Linux](APACHE.md) | LAMP VPS, cPanel VPS, Debian/Ubuntu |
| [Nginx + Linux](docs/NGINX.md) | Nginx VPS (DigitalOcean, Hetzner, etc.) |
| [Windows + XAMPP](docs/WINDOWS.md) | Local development, Windows Server |
| [cPanel Hosting](docs/CPANEL.md) | Shared hosting with Node.js support |

## Configuration & Reference

| Guide | Contents |
|-------|----------|
| [Environment Variables](docs/ENV-REFERENCE.md) | Every `.env` variable documented |
| [Database Setup](docs/DATABASE.md) | Schema, migrations, backup, restore |
| [First Boot Setup](docs/FIRST-BOOT.md) | What to do right after deployment |

## Maintenance

| Guide | Contents |
|-------|----------|
| [Upgrading](docs/UPGRADING.md) | How to update to a new version |
| [Backups](docs/BACKUPS.md) | Database and file backup strategies |
| [Security](docs/SECURITY.md) | Hardening checklist |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and fixes |

---

## Quick Decision

```
Do you have Docker installed?
  YES → See DOCKER.md          (docker compose up -d --build)

No Docker — what web server?
  Apache  → See APACHE.md
  Nginx   → See docs/NGINX.md
  Windows → See docs/WINDOWS.md
  cPanel  → See docs/CPANEL.md
```

## Default Admin Credentials

After first boot, log in to `/admin/` with:

```
Email:    admin@fishbill.gr
Password: Admin@123
```

**Change this password immediately after first login.**

---

## Need help?

See [Troubleshooting](docs/TROUBLESHOOTING.md) for the most common issues.
