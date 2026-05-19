# 🐟 FishBill — Πλήρης Οδηγός Υλοποίησης
### Εφαρμογή Τιμολόγησης Ψαράδων | MySQL · Papaki · Android · Web Dashboard

> **Έκδοση 2.0** — Πλήρης τεχνική τεκμηρίωση για development, hosting, deployment και επιχειρηματικό μοντέλο.

---

## 📋 ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ

1. [Τι Χτίζουμε — Συνολική Εικόνα](#1-τι-χτίζουμε)
2. [Νομικό Μοντέλο](#2-νομικό-μοντέλο)
3. [Αρχιτεκτονική Συστήματος](#3-αρχιτεκτονική)
4. [Hosting στο Papaki.gr](#4-hosting-papaki)
5. [MySQL Βάση Δεδομένων — Πλήρες Schema](#5-mysql-database)
6. [Backend API — Node.js + Express](#6-backend-api)
7. [Web App — Admin Dashboard](#7-admin-dashboard)
8. [Web App — Employee Dashboard](#8-employee-dashboard)
9. [Mobile App — Android Studio](#9-mobile-app)
10. [Σύνδεση με Πάροχο & myDATA](#10-mydata-integration)
11. [PDF Generation](#11-pdf-generation)
12. [Authentication & Security](#12-security)
13. [Email & Notifications](#13-notifications)
14. [Backups & Restore](#14-backups)
15. [Audit Logs](#15-audit-logs)
16. [Exports](#16-exports)
17. [Subscriptions & Payments](#17-payments)
18. [Deployment Step-by-Step σε Papaki](#18-deployment)
19. [Domain & SSL Setup](#19-domain-ssl)
20. [Business Model & Scaling](#20-business-model)
21. [Launch Checklist](#21-checklist)

---

## 1. ΤΙ ΧΤΊΖΟΥΜΕ

### Η Απλή Εικόνα

```
ΨΑΡΑΣ (κινητό)          ΛΟΓΙΣΤΗΣ / ΒΟΗΘΟΣ (web)      ΕΣΥΣ (web)
      │                           │                        │
      │  Android App              │  Employee Dashboard    │  Admin Dashboard
      │  3 κουμπιά                │  Διαχείριση            │  Στατιστικά
      │  → Εκδίδει                │  Πελάτες/Είδη          │  Όλοι οι ψαράδες
      │    παραστατικό            │  Ιστορικό              │  Subscriptions
      │                           │  Exports               │  Backups/Logs
      └──────────────┬────────────┘                        │
                     │                                     │
                     ▼                                     ▼
           ┌─────────────────────────────────────────────────┐
           │        BACKEND API (Node.js)                     │
           │        Hosted on Papaki VPS                      │
           └──────────────┬──────────────────────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
           MySQL DB    Πάροχος    PDF/Storage
           (Papaki)  (SoftOne κλπ)  (local)
              │           │
              │           ▼
              │       myDATA/ΑΑΔΕ ✅
              │
              └── MARK αποθηκεύεται στη βάση
```

### Τι Παραδίδεις

| Τμήμα | Τεχνολογία | Χρήστης |
|-------|-----------|--------|
| Mobile App | Android (Kotlin) | Ψαράς — στο καΐκι |
| Admin Web Dashboard | Next.js | Εσύ — super admin |
| Employee Web Dashboard | Next.js | Λογιστής / βοηθός ψαρά |
| Backend API | Node.js + Express | Εσωτερικό |
| MySQL Database | MySQL 8 | Εσωτερικό |
| Hosting | Papaki.gr VPS | Εσωτερικό |

---

## 2. ΝΟΜΙΚΌ ΜΟΝΤΈΛΟ

### Ρόλος σου στο Σύστημα

Είσαι **Software Vendor / SaaS Provider**. Δεν εκδίδεις τιμολόγια — δίνεις εργαλείο που το κάνει. Η νομική αλυσίδα είναι:

```
Ψαράς → FishBill App → Αδειοδοτημένος Πάροχος (ΥΠΑΗΕΣ) → myDATA/ΑΑΔΕ
```

### Τι Χρειάζεσαι

- ✅ Δική σου εταιρεία (ΙΚΕ ή ατομική επιχείρηση) με ΑΦΜ
- ✅ Σύμβαση B2B με έναν αδειοδοτημένο πάροχο (ΥΠΑΗΕΣ)
- ✅ Πολιτική Απορρήτου (GDPR)
- ✅ Όροι Χρήσης εφαρμογής
- ✅ Ασφαλής αποθήκευση δεδομένων (κρυπτογράφηση)
- ❌ ΔΕΝ χρειάζεσαι άδεια ΥΠΑΗΕΣ
- ❌ ΔΕΝ χρειάζεσαι πιστοποίηση ΑΑΔΕ

### Συνιστώμενοι Πάροχοι

| Πάροχος | Επικοινωνία | Κόστος/invoice | API |
|---------|------------|---------------|-----|
| SoftOne | softone.gr | ~0.05-0.10€ | REST/JSON |
| Epsilon Net | epsilonnet.gr | ~0.05€ | REST/XML |
| UniDoc | unidoc.gr | ~0.08€ | REST |

**Τι να πεις:** "Είμαι software vendor, αναπτύσσω SaaS για ψαράδες, θέλω partner API για διαβίβαση παραστατικών μέσω της πλατφόρμας σας."

### Τύποι Παραστατικών για Ψαράδες

| Κωδικός myDATA | Τύπος | Πότε |
|---------------|-------|------|
| 1.1 | Τιμολόγιο Πώλησης | Πώληση σε επιχείρηση (B2B) |
| 2.1 | Απόδειξη Λιανικής | Πώληση σε ιδιώτη (B2C) |
| 5.1 | Πιστωτικό Τιμολόγιο | Επιστροφή / διόρθωση |
| 11.1 | ΑΛΠ | Απόδειξη Λιανικής Παροχής |

---

## 3. ΑΡΧΙΤΕΚΤΟΝΙΚΉ

### Πλήρης Διάγραμμα

```
┌─────────────────────────────────────────────────────────────────┐
│                        PAPAKI.GR VPS                            │
│                    Ubuntu 22.04 LTS                             │
│                                                                  │
│  ┌─────────────────┐    ┌──────────────────────────────────┐   │
│  │   Nginx (80/443)│    │        PM2 Process Manager        │   │
│  │   Reverse Proxy │    │                                   │   │
│  │                 │    │  ┌──────────────┐                 │   │
│  │  fishbill.gr ───┼────┼─▶│ Next.js :3000│ (Web Dashboards)│  │
│  │  api.fishbill.gr┼────┼─▶│ Node.js :4000│ (Backend API)  │   │
│  └─────────────────┘    │  └──────────────┘                 │   │
│                          └──────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────┐                    │
│  │  MySQL 8.0                              │                    │
│  │  fishbill_db  (παραγωγή)               │                    │
│  │  fishbill_test (testing)               │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐           │
│  │  Redis       │  │  /var/www/   │  │  Cron Jobs │           │
│  │  (Queue/Cache│  │  pdf_storage │  │  Backups   │           │
│  └──────────────┘  └──────────────┘  └────────────┘           │
└─────────────────────────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
   Android App (APK)         Πάροχος → myDATA
   (Google Play /
    Direct Download)
```

### Port Layout

```
80   → Nginx (HTTP, redirect to HTTPS)
443  → Nginx (HTTPS, SSL termination)
3000 → Next.js web app (internal)
4000 → Node.js/Express API (internal)
3306 → MySQL (internal only, NEVER exposed)
6379 → Redis (internal only)
```

### Υποτομείς (Subdomains)

```
fishbill.gr              → Landing page + login (Next.js)
app.fishbill.gr          → Admin + Employee dashboards
api.fishbill.gr          → Backend REST API
```

---

## 4. HOSTING PAPAKI

### Τι Πακέτο να Πάρεις

Για MVP (0-200 ψαράδες):

**VPS Basic ή VPS Standard** από Papaki:
- 2 vCPU / 4GB RAM / 50GB SSD
- ~15-25€/μήνα
- Ubuntu 22.04 LTS
- 1 dedicated IP

Για >200 ψαράδες: αναβάθμισε σε 4 vCPU / 8GB RAM.

### Domain Setup στο Papaki

1. Αγόρασε domain `fishbill.gr` από Papaki (~12€/χρόνο)
2. DNS Management → Πρόσθεσε records:

```
Τύπος   Όνομα          Τιμή
A       @              [VPS IP]
A       www            [VPS IP]
A       app            [VPS IP]
A       api            [VPS IP]
MX      @              mail.papaki.com (για email)
TXT     @              v=spf1 include:papaki.com ~all
```

### Αρχική Ρύθμιση VPS (SSH)

```bash
# Σύνδεση στο VPS
ssh root@[VPS-IP]

# Ενημέρωση συστήματος
apt update && apt upgrade -y

# Εγκατάσταση βασικών εργαλείων
apt install -y curl wget git unzip software-properties-common \
  build-essential ufw fail2ban htop nano

# Firewall setup
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable

# Δημιουργία μη-root χρήστη για ασφάλεια
adduser fishbill
usermod -aG sudo fishbill
# Αντιγραφή SSH key στον νέο χρήστη
rsync --archive --chown=fishbill:fishbill ~/.ssh /home/fishbill
```

### Εγκατάσταση Node.js 20 LTS

```bash
# Εγκατάσταση Node.js 20 LTS μέσω NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# Επαλήθευση
node --version   # v20.x.x
npm --version    # 10.x.x

# PM2 για process management
npm install -g pm2
pm2 startup systemd   # Auto-restart on reboot
```

### Εγκατάσταση MySQL 8

```bash
# Εγκατάσταση MySQL
apt install -y mysql-server

# Ασφαλής ρύθμιση
mysql_secure_installation
# → Set root password: [ΔΥΝΑΤΟΣ_ΚΩΔΙΚΟΣ]
# → Remove anonymous users: YES
# → Disallow root login remotely: YES
# → Remove test database: YES
# → Reload privilege tables: YES

# Σύνδεση ως root
mysql -u root -p

# Δημιουργία βάσης και χρήστη
CREATE DATABASE fishbill_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE fishbill_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'fishbill_user'@'localhost' IDENTIFIED BY '[ΔΥΝΑΤΟΣ_ΚΩΔΙΚΟΣ]';
GRANT ALL PRIVILEGES ON fishbill_db.* TO 'fishbill_user'@'localhost';
GRANT ALL PRIVILEGES ON fishbill_test.* TO 'fishbill_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### Εγκατάσταση Redis

```bash
apt install -y redis-server

# Ρύθμιση Redis
nano /etc/redis/redis.conf
# Άλλαξε:
# supervised no  →  supervised systemd
# bind 127.0.0.1  (κράτα το έτσι - μόνο localhost)
# requirepass [ΔΥΝΑΤΟΣ_ΚΩΔΙΚΟΣ_REDIS]

systemctl restart redis
systemctl enable redis
```

### Εγκατάσταση Nginx

```bash
apt install -y nginx
systemctl enable nginx

# Δοκιμή
nginx -t
curl http://localhost  # Πρέπει να δείξει welcome page
```

---

## 5. MYSQL DATABASE

### Πλήρες Schema (fishbill_db)

Εκτέλεσε τα παρακάτω SQL στη MySQL:

```sql
-- =====================================================================
-- ΠΙΝΑΚΑΣ: businesses
-- Κάθε ψαράς/εταιρεία που εγγράφεται στην πλατφόρμα
-- =====================================================================
CREATE TABLE businesses (
    id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    afm           VARCHAR(9)   NOT NULL UNIQUE COMMENT 'ΑΦΜ επιχείρησης',
    name          VARCHAR(255) NOT NULL COMMENT 'Επωνυμία',
    trade_name    VARCHAR(255) NULL COMMENT 'Διακριτικός τίτλος',
    doy           VARCHAR(100) NULL COMMENT 'ΔΟΥ υπαγωγής',
    address       TEXT         NULL,
    city          VARCHAR(100) NULL,
    postal_code   VARCHAR(5)   NULL,
    phone         VARCHAR(20)  NULL,
    email         VARCHAR(255) NULL,
    -- ΚΑΔ (Κωδικός Αριθμός Δραστηριότητας)
    -- Αλιεία: 03.11, 03.12, 03.21, 03.22
    activity_code VARCHAR(10)  NULL DEFAULT '03.11',
    -- Καθεστώς ΦΠΑ
    vat_regime    ENUM('normal','small_business','exempt') DEFAULT 'normal',
    -- Παραστατικά
    invoice_series    VARCHAR(10) DEFAULT 'Α' COMMENT 'Σειρά παραστατικών',
    invoice_counter   INT         DEFAULT 0,
    receipt_series    VARCHAR(10) DEFAULT 'Β' COMMENT 'Σειρά αποδείξεων',
    receipt_counter   INT         DEFAULT 0,
    -- myDATA credentials (κρυπτογραφημένα)
    mydata_user_id        VARCHAR(100) NULL,
    mydata_subscription_key TEXT NULL COMMENT 'Κρυπτογραφημένο',
    -- Πάροχος
    provider_name         VARCHAR(50)  NULL COMMENT 'softone,epsilon,unidoc',
    provider_api_key      TEXT         NULL COMMENT 'Κρυπτογραφημένο',
    provider_api_url      VARCHAR(255) NULL,
    provider_username     VARCHAR(100) NULL,
    provider_password     TEXT         NULL COMMENT 'Κρυπτογραφημένο',
    -- Subscription
    plan          ENUM('trial','basic','pro','enterprise') DEFAULT 'trial',
    trial_ends_at DATETIME NULL,
    subscription_active TINYINT(1) DEFAULT 0,
    subscription_ends_at DATETIME NULL,
    stripe_customer_id  VARCHAR(100) NULL,
    -- Κατάσταση
    is_active     TINYINT(1) DEFAULT 1,
    is_suspended  TINYINT(1) DEFAULT 0,
    suspend_reason VARCHAR(255) NULL,
    -- Λογιστής
    accountant_name  VARCHAR(255) NULL,
    accountant_email VARCHAR(255) NULL,
    accountant_phone VARCHAR(20)  NULL,
    -- Timestamps
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_afm (afm),
    INDEX idx_plan (plan),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: users
-- Χρήστες: super_admin (εσύ), owner (ψαράς), captain, accountant
-- =====================================================================
CREATE TABLE users (
    id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id   CHAR(36)     NULL REFERENCES businesses(id),
    -- Στοιχεία
    full_name     VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NULL UNIQUE,
    phone         VARCHAR(20)  NULL,
    phone_verified TINYINT(1)  DEFAULT 0,
    -- Auth
    password_hash VARCHAR(255) NOT NULL,
    -- Ρόλος
    role ENUM('super_admin','owner','accountant','captain','employee') NOT NULL DEFAULT 'owner',
    -- Δικαιώματα (override ανά χρήστη αν χρειαστεί)
    can_create_invoice TINYINT(1) DEFAULT 1,
    can_cancel_invoice TINYINT(1) DEFAULT 0,
    can_view_all       TINYINT(1) DEFAULT 0,
    can_export         TINYINT(1) DEFAULT 0,
    can_manage_users   TINYINT(1) DEFAULT 0,
    can_view_logs      TINYINT(1) DEFAULT 0,
    -- Session
    last_login_at   DATETIME NULL,
    last_login_ip   VARCHAR(45) NULL,
    -- Status
    is_active       TINYINT(1) DEFAULT 1,
    email_verified  TINYINT(1) DEFAULT 0,
    -- Password reset
    reset_token          VARCHAR(100) NULL,
    reset_token_expires  DATETIME NULL,
    -- Invite
    invite_token         VARCHAR(100) NULL,
    invite_expires       DATETIME NULL,
    -- Timestamps
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_business (business_id),
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: customers
-- Πελάτες κάθε επιχείρησης
-- =====================================================================
CREATE TABLE customers (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    -- Στοιχεία
    afm         VARCHAR(9)   NULL COMMENT 'ΑΦΜ πελάτη (για B2B)',
    name        VARCHAR(255) NOT NULL,
    trade_name  VARCHAR(255) NULL,
    address     TEXT         NULL,
    city        VARCHAR(100) NULL,
    postal_code VARCHAR(5)   NULL,
    country     CHAR(2)      DEFAULT 'GR',
    phone       VARCHAR(20)  NULL,
    email       VARCHAR(255) NULL,
    -- Προτιμήσεις
    default_payment_method ENUM('cash','bank','check','credit') DEFAULT 'cash',
    is_favorite   TINYINT(1) DEFAULT 0,
    is_active     TINYINT(1) DEFAULT 1,
    -- Στατιστικά (denormalized για ταχύτητα)
    total_invoices   INT         DEFAULT 0,
    total_amount     DECIMAL(12,2) DEFAULT 0.00,
    last_invoice_at  DATETIME NULL,
    -- Timestamps
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    INDEX idx_business (business_id),
    INDEX idx_afm (afm),
    INDEX idx_name (name),
    INDEX idx_favorite (is_favorite)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: products
-- Είδη ψαριών / αλιευμάτων ανά επιχείρηση
-- =====================================================================
CREATE TABLE products (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    -- Στοιχεία
    name        VARCHAR(255) NOT NULL COMMENT 'π.χ. Τσιπούρα, Λαβράκι',
    code        VARCHAR(50)  NULL COMMENT 'Κωδικός προϊόντος',
    description TEXT         NULL,
    unit        VARCHAR(20)  DEFAULT 'KG' COMMENT 'KG, TEM, LT',
    -- Τιμολόγηση
    default_price DECIMAL(10,4) NULL,
    vat_rate      TINYINT     DEFAULT 13 COMMENT '6, 13, 24',
    -- myDATA Classification
    income_category VARCHAR(20) DEFAULT 'E3_561_001'
        COMMENT 'Κατηγορία χαρακτηρισμού εσόδου',
    income_type     VARCHAR(10) DEFAULT '1.1'
        COMMENT 'Τύπος χαρακτηρισμού',
    -- Εμφάνιση
    is_favorite TINYINT(1) DEFAULT 0,
    is_active   TINYINT(1) DEFAULT 1,
    sort_order  INT DEFAULT 0,
    -- Timestamps
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    INDEX idx_business (business_id),
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: invoice_series
-- Σειρές παραστατικών (κάθε επιχείρηση μπορεί να έχει πολλές)
-- =====================================================================
CREATE TABLE invoice_series (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    series      VARCHAR(10)  NOT NULL COMMENT 'π.χ. Α, Β, ΤΠΥ',
    description VARCHAR(100) NULL COMMENT 'π.χ. Τιμολόγια 2026',
    invoice_type VARCHAR(10) DEFAULT '1.1',
    current_number INT DEFAULT 0,
    is_default  TINYINT(1) DEFAULT 0,
    is_active   TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_series (business_id, series)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: invoices
-- Τα παραστατικά — κεντρικός πίνακας
-- =====================================================================
CREATE TABLE invoices (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    customer_id CHAR(36)     NULL,
    created_by  CHAR(36)     NULL COMMENT 'user_id που εξέδωσε',
    -- Αρίθμηση
    series      VARCHAR(10)  NOT NULL,
    number      INT          NOT NULL,
    full_number VARCHAR(50)  NOT NULL COMMENT 'π.χ. Α-0001',
    -- Τύπος
    invoice_type VARCHAR(10) DEFAULT '1.1'
        COMMENT '1.1=ΤΠΥ, 2.1=Απόδειξη, 5.1=Πιστωτικό',
    -- Ημερομηνία
    issue_date  DATE         NOT NULL DEFAULT (CURDATE()),
    issue_time  TIME         NOT NULL DEFAULT (CURTIME()),
    due_date    DATE         NULL,
    -- Τρόπος πληρωμής
    payment_method ENUM('cash','bank','check','credit','other') DEFAULT 'cash',
    -- Σύνολα
    net_value   DECIMAL(12,2) DEFAULT 0.00,
    vat_amount  DECIMAL(12,2) DEFAULT 0.00,
    total_value DECIMAL(12,2) DEFAULT 0.00,
    discount_amount DECIMAL(12,2) DEFAULT 0.00,
    -- Κατάσταση
    status ENUM('draft','issued','pending_retry','transmitted','failed','cancelled')
        DEFAULT 'draft',
    -- myDATA
    mydata_mark       VARCHAR(50)  NULL COMMENT 'MARK από ΑΑΔΕ',
    mydata_uid        VARCHAR(100) NULL COMMENT 'UID από ΑΑΔΕ',
    mydata_cancel_mark VARCHAR(50) NULL COMMENT 'MARK ακύρωσης',
    -- Πάροχος
    provider_name     VARCHAR(50)  NULL,
    provider_reference VARCHAR(100) NULL,
    -- Retry
    retry_count       INT DEFAULT 0,
    next_retry_at     DATETIME NULL,
    last_error        TEXT NULL,
    -- PDF
    pdf_path          VARCHAR(500) NULL,
    pdf_generated_at  DATETIME NULL,
    -- Timestamps
    transmitted_at    DATETIME NULL,
    cancelled_at      DATETIME NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uniq_invoice (business_id, series, number),
    INDEX idx_business (business_id),
    INDEX idx_status (status),
    INDEX idx_date (issue_date),
    INDEX idx_mark (mydata_mark),
    INDEX idx_customer (customer_id),
    INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: invoice_lines
-- Γραμμές κάθε παραστατικού
-- =====================================================================
CREATE TABLE invoice_lines (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    invoice_id  CHAR(36)     NOT NULL,
    product_id  CHAR(36)     NULL,
    line_number INT          NOT NULL DEFAULT 1,
    -- Περιγραφή
    description VARCHAR(500) NOT NULL,
    unit        VARCHAR(20)  DEFAULT 'KG',
    -- Ποσότητα & Τιμή
    quantity    DECIMAL(10,3) NOT NULL,
    unit_price  DECIMAL(10,4) NOT NULL,
    -- Έκπτωση
    discount_pct  DECIMAL(5,2) DEFAULT 0.00,
    discount_amt  DECIMAL(10,2) DEFAULT 0.00,
    -- Σύνολα
    net_value   DECIMAL(12,2) NOT NULL,
    vat_rate    TINYINT      NOT NULL DEFAULT 13,
    vat_amount  DECIMAL(12,2) NOT NULL,
    total_value DECIMAL(12,2) NOT NULL,
    -- myDATA Classification
    income_category VARCHAR(20) DEFAULT 'E3_561_001',
    income_type     VARCHAR(10) DEFAULT '1.1',
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    INDEX idx_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: transmission_logs
-- Κάθε απόπειρα αποστολής στον πάροχο/myDATA
-- =====================================================================
CREATE TABLE transmission_logs (
    id              CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    invoice_id      CHAR(36)    NOT NULL,
    provider        VARCHAR(50) NULL,
    attempt_number  INT         DEFAULT 1,
    -- Request
    request_url     VARCHAR(500) NULL,
    request_payload LONGTEXT    NULL,
    -- Response
    http_status     SMALLINT    NULL,
    response_body   LONGTEXT    NULL,
    -- Αποτέλεσμα
    success         TINYINT(1)  DEFAULT 0,
    mydata_mark     VARCHAR(50) NULL,
    error_message   TEXT        NULL,
    -- Χρόνος
    duration_ms     INT         NULL COMMENT 'milliseconds',
    attempted_at    DATETIME    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    INDEX idx_invoice (invoice_id),
    INDEX idx_success (success),
    INDEX idx_date (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: audit_logs
-- Αμετάβλητο ιστορικό κάθε ενέργειας (append-only)
-- =====================================================================
CREATE TABLE audit_logs (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     CHAR(36)     NULL,
    business_id CHAR(36)     NULL,
    -- Ενέργεια
    action      VARCHAR(50)  NOT NULL
        COMMENT 'CREATE,UPDATE,DELETE,CANCEL,LOGIN,LOGOUT,EXPORT,BACKUP,RETRY',
    entity_type VARCHAR(50)  NULL COMMENT 'invoice,customer,user,product',
    entity_id   CHAR(36)     NULL,
    -- Λεπτομέρειες
    description TEXT         NULL,
    old_values  JSON         NULL COMMENT 'Τιμές πριν αλλαγή',
    new_values  JSON         NULL COMMENT 'Τιμές μετά αλλαγή',
    -- Τεχνικά
    ip_address  VARCHAR(45)  NULL,
    user_agent  VARCHAR(500) NULL,
    -- Timestamps (NO updated_at — append only)
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_business (business_id),
    INDEX idx_action (action),
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: backup_logs
-- Ιστορικό backup
-- =====================================================================
CREATE TABLE backup_logs (
    id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL,
    size_bytes  BIGINT       NULL,
    type        ENUM('auto','manual') DEFAULT 'auto',
    status      ENUM('running','success','failed') DEFAULT 'running',
    error_msg   TEXT         NULL,
    started_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: subscriptions
-- Πλάνα και πληρωμές
-- =====================================================================
CREATE TABLE subscriptions (
    id              CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id     CHAR(36)    NOT NULL UNIQUE,
    plan            ENUM('basic','pro','enterprise') DEFAULT 'basic',
    price_eur       DECIMAL(8,2) DEFAULT 10.00,
    billing_cycle   ENUM('monthly','annual') DEFAULT 'monthly',
    -- Stripe
    stripe_sub_id           VARCHAR(100) NULL,
    stripe_payment_method   VARCHAR(100) NULL,
    -- Κατάσταση
    status ENUM('active','past_due','cancelled','trial') DEFAULT 'trial',
    trial_ends_at   DATETIME NULL,
    current_period_start DATETIME NULL,
    current_period_end   DATETIME NULL,
    cancelled_at    DATETIME NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ΠΙΝΑΚΑΣ: notifications
-- System notifications προς χρήστες
-- =====================================================================
CREATE TABLE notifications (
    id          CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    user_id     CHAR(36)    NOT NULL,
    type        VARCHAR(50) NOT NULL COMMENT 'transmission_failed,subscription_expiry,...',
    title       VARCHAR(255) NOT NULL,
    message     TEXT        NULL,
    is_read     TINYINT(1)  DEFAULT 0,
    action_url  VARCHAR(500) NULL,
    created_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_unread (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- Εισαγωγή default super admin
-- =====================================================================
INSERT INTO users (id, full_name, email, password_hash, role, is_active, email_verified)
VALUES (
    UUID(),
    'Super Admin',
    'admin@fishbill.gr',
    '$2b$12$REPLACE_WITH_BCRYPT_HASH', -- bcrypt('your-password', 12)
    'super_admin',
    1,
    1
);

-- Default myDATA classifications για ψάρια
-- Θα χρησιμοποιηθούν ως default τιμές στα products
-- E3_561_001 = Χονδρικές πωλήσεις αγαθών
-- E3_561_002 = Λιανικές πωλήσεις αγαθών
```

### MySQL Connection (Node.js)

```javascript
// src/config/database.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 3306,
  user:     process.env.DB_USER || 'fishbill_user',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'fishbill_db',
  charset:  'utf8mb4',
  timezone: '+02:00', // Greece timezone
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Reconnect on disconnect
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL connected');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  });

module.exports = pool;
```

### .env File

```bash
# /home/fishbill/fishbill-api/.env

NODE_ENV=production
PORT=4000

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=fishbill_user
DB_PASSWORD=VERY_STRONG_PASSWORD_HERE
DB_NAME=fishbill_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=REDIS_PASSWORD_HERE

# JWT
JWT_SECRET=RANDOM_64_CHAR_STRING_HERE
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=ANOTHER_RANDOM_64_CHAR_STRING
JWT_REFRESH_EXPIRES_IN=30d

# Encryption (για API keys πάροχου)
ENCRYPTION_KEY=32_BYTE_HEX_KEY_HERE

# Provider
PROVIDER_NAME=softone
PROVIDER_API_URL=https://api.softone.gr/einvoice/v1
PROVIDER_API_KEY=YOUR_PROVIDER_KEY

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx
FROM_EMAIL=noreply@fishbill.gr

# PDF Storage
PDF_STORAGE_PATH=/var/www/fishbill/pdfs

# Stripe
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx

# App URL
APP_URL=https://app.fishbill.gr
API_URL=https://api.fishbill.gr
```

---

## 6. BACKEND API

### Project Structure

```
fishbill-api/
├── package.json
├── .env
├── src/
│   ├── app.js                    # Express setup, middleware
│   ├── server.js                 # HTTP server entry point
│   ├── config/
│   │   ├── database.js           # MySQL pool
│   │   ├── redis.js              # Redis client
│   │   └── encryption.js         # AES-256 encrypt/decrypt
│   ├── middleware/
│   │   ├── auth.js               # JWT verify + attach user
│   │   ├── role.js               # Role-based access control
│   │   ├── validate.js           # Joi request validation
│   │   ├── audit.js              # Auto audit logging
│   │   └── rateLimit.js          # Rate limiting
│   ├── routes/
│   │   ├── auth.routes.js        # Login, register, refresh
│   │   ├── businesses.routes.js  # Business CRUD
│   │   ├── users.routes.js       # User management
│   │   ├── customers.routes.js   # Customer CRUD
│   │   ├── products.routes.js    # Product CRUD
│   │   ├── invoices.routes.js    # Invoice CRUD + transmit
│   │   ├── exports.routes.js     # Data exports
│   │   ├── backups.routes.js     # Backup management
│   │   ├── logs.routes.js        # Audit logs
│   │   ├── stats.routes.js       # Dashboard statistics
│   │   └── notifications.routes.js
│   ├── services/
│   │   ├── invoice.service.js    # Invoice business logic
│   │   ├── provider.service.js   # Provider API calls
│   │   ├── mydata.service.js     # XML builder
│   │   ├── pdf.service.js        # PDF generation
│   │   ├── email.service.js      # Email sending
│   │   ├── export.service.js     # CSV/XML exports
│   │   └── backup.service.js     # DB backup
│   ├── jobs/
│   │   ├── transmission.job.js   # Queue worker
│   │   ├── retry.job.js          # Retry failed invoices
│   │   └── backup.job.js         # Cron backup
│   └── utils/
│       ├── calculateTotals.js
│       ├── buildXML.js
│       └── validators.js
```

### package.json Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "mysql2": "^3.6.0",
    "ioredis": "^5.3.2",
    "bull": "^4.12.0",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "joi": "^17.11.0",
    "axios": "^1.6.0",
    "pdfkit": "^0.14.0",
    "xml2js": "^0.6.2",
    "xmlbuilder2": "^3.1.1",
    "fast-csv": "^5.0.1",
    "node-cron": "^3.0.3",
    "resend": "^2.0.0",
    "stripe": "^14.0.0",
    "crypto-js": "^4.2.0",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^7.1.5",
    "morgan": "^1.10.0",
    "dotenv": "^16.3.1",
    "uuid": "^9.0.0"
  }
}
```

### src/app.js

```javascript
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Security headers
app.use(helmet());

// CORS — επιτρέπουμε μόνο το frontend μας
app.use(cors({
  origin: [
    'https://app.fishbill.gr',
    'https://fishbill.gr',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
  ].filter(Boolean),
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 λεπτά
  max: 100,                   // 100 requests per window
  message: { error: 'Too many requests, try again later' }
});
app.use('/api/', limiter);

// Stricter limit για login
const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 ώρα
  max: 10,
  message: { error: 'Too many login attempts' }
});
app.use('/api/auth/login', loginLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('combined'));

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth',          require('./routes/auth.routes'));
app.use('/api/businesses',    require('./routes/businesses.routes'));
app.use('/api/users',         require('./routes/users.routes'));
app.use('/api/customers',     require('./routes/customers.routes'));
app.use('/api/products',      require('./routes/products.routes'));
app.use('/api/invoices',      require('./routes/invoices.routes'));
app.use('/api/exports',       require('./routes/exports.routes'));
app.use('/api/backups',       require('./routes/backups.routes'));
app.use('/api/logs',          require('./routes/logs.routes'));
app.use('/api/stats',         require('./routes/stats.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

module.exports = app;
```

### Βασικά Endpoints (όλα)

```
AUTH
POST   /api/auth/login                  Σύνδεση
POST   /api/auth/register               Εγγραφή νέας επιχείρησης
POST   /api/auth/refresh                Ανανέωση token
POST   /api/auth/logout                 Αποσύνδεση
POST   /api/auth/forgot-password        Email για reset
POST   /api/auth/reset-password         Reset με token
POST   /api/auth/verify-email/:token    Επιβεβαίωση email

BUSINESSES (super admin)
GET    /api/businesses                  Λίστα επιχειρήσεων
POST   /api/businesses                  Νέα επιχείρηση
GET    /api/businesses/:id              Λεπτομέρειες
PUT    /api/businesses/:id              Ενημέρωση
DELETE /api/businesses/:id              Διαγραφή (soft delete)
POST   /api/businesses/:id/suspend      Αναστολή
POST   /api/businesses/:id/activate     Ενεργοποίηση
GET    /api/businesses/:id/invoices     Παραστατικά επιχείρησης
GET    /api/businesses/:id/stats        Στατιστικά επιχείρησης

USERS
GET    /api/users                       Λίστα χρηστών (της επιχείρησης)
POST   /api/users                       Νέος χρήστης
GET    /api/users/:id                   Λεπτομέρειες χρήστη
PUT    /api/users/:id                   Ενημέρωση
DELETE /api/users/:id                   Απενεργοποίηση
POST   /api/users/:id/reset-password    Reset κωδικού
POST   /api/users/invite                Αποστολή πρόσκλησης

CUSTOMERS
GET    /api/customers                   Λίστα (με search & pagination)
POST   /api/customers                   Νέος πελάτης
GET    /api/customers/:id               Λεπτομέρειες
PUT    /api/customers/:id               Ενημέρωση
DELETE /api/customers/:id               Διαγραφή
GET    /api/customers/recent            Τελευταίοι 10
GET    /api/customers/search?q=         Αναζήτηση
GET    /api/customers/:id/invoices      Παραστατικά πελάτη

PRODUCTS
GET    /api/products                    Λίστα ειδών
POST   /api/products                    Νέο είδος
GET    /api/products/:id                Λεπτομέρειες
PUT    /api/products/:id                Ενημέρωση
DELETE /api/products/:id                Διαγραφή
GET    /api/products/favorites          Αγαπημένα (για mobile)

INVOICES
GET    /api/invoices                    Λίστα (filters: date, status, customer)
POST   /api/invoices                    Νέο παραστατικό
GET    /api/invoices/:id                Λεπτομέρειες
PUT    /api/invoices/:id                Ενημέρωση (μόνο draft)
POST   /api/invoices/:id/issue          Έκδοση (draft → issued)
POST   /api/invoices/:id/transmit       Χειροκίνητη αποστολή
POST   /api/invoices/:id/retry          Επανάληψη αποτυχημένης
POST   /api/invoices/:id/cancel         Ακύρωση
GET    /api/invoices/:id/pdf            Download PDF
GET    /api/invoices/:id/xml            Download XML
GET    /api/invoices/:id/logs           Transmission logs
GET    /api/invoices/stats              Ημερήσια/εβδομαδιαία στατιστικά

STATS (dashboard)
GET    /api/stats/overview              Κύριοι αριθμοί
GET    /api/stats/invoices-by-day       Γράφημα 30 ημερών
GET    /api/stats/top-customers         Top 5 πελάτες
GET    /api/stats/revenue               Έσοδα ανά περίοδο

EXPORTS
GET    /api/exports/invoices            CSV/XML παραστατικών
GET    /api/exports/customers           CSV πελατών
GET    /api/exports/audit-log           CSV audit log
GET    /api/exports/transmission-log    CSV transmission log

BACKUPS
GET    /api/backups                     Λίστα backups
POST   /api/backups/run                 Χειροκίνητο backup
POST   /api/backups/:id/restore         Restore (super admin)

LOGS
GET    /api/logs                        Audit logs (filterable)
GET    /api/logs/transmission           Transmission logs

NOTIFICATIONS
GET    /api/notifications               Λίστα notifications χρήστη
POST   /api/notifications/:id/read      Σήμανση ως αναγνωσμένο
POST   /api/notifications/read-all      Όλα αναγνωσμένα
```

---

## 7. ADMIN DASHBOARD (Web App)

### Τεχνολογία & Setup

```bash
# Δημιουργία Next.js project
npx create-next-app@latest fishbill-web --typescript --tailwind --app
cd fishbill-web

# Dependencies
npm install @tanstack/react-table recharts date-fns
npm install axios swr react-hook-form zod
npm install next-auth @next-auth/prisma-adapter
npm install react-hot-toast lucide-react
npm install @radix-ui/react-dialog @radix-ui/react-select
```

### Project Structure

```
fishbill-web/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx           # Sidebar + topbar
│   │   ├── page.tsx             # Redirect to /dashboard
│   │   ├── dashboard/
│   │   │   └── page.tsx         # Κύριο dashboard
│   │   ├── invoices/
│   │   │   ├── page.tsx         # Λίστα παραστατικών
│   │   │   └── [id]/
│   │   │       └── page.tsx     # Λεπτομέρειες + PDF
│   │   ├── customers/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── products/
│   │   │   └── page.tsx
│   │   ├── users/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── businesses/          # ΜΟΝΟ super_admin
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── permissions/
│   │   │   └── page.tsx
│   │   ├── exports/
│   │   │   └── page.tsx
│   │   ├── backups/             # ΜΟΝΟ super_admin
│   │   │   └── page.tsx
│   │   └── logs/
│   │       └── page.tsx
│   ├── api/
│   │   └── auth/
│   │       └── [...nextauth]/
│   │           └── route.ts
│   └── layout.tsx
├── components/
│   ├── ui/                      # shadcn/ui components
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── TopBar.tsx
│   ├── dashboard/
│   │   ├── StatsGrid.tsx
│   │   ├── InvoiceChart.tsx
│   │   ├── ActivityFeed.tsx
│   │   └── TopCustomers.tsx
│   ├── invoices/
│   │   ├── InvoiceTable.tsx
│   │   ├── InvoiceFilters.tsx
│   │   ├── InvoiceDetail.tsx
│   │   └── InvoicePDFViewer.tsx
│   ├── users/
│   │   ├── UserTable.tsx
│   │   ├── UserForm.tsx
│   │   └── UserRoleSelect.tsx
│   └── shared/
│       ├── DataTable.tsx        # Reusable TanStack table
│       ├── Pagination.tsx
│       ├── SearchBar.tsx
│       ├── StatusBadge.tsx
│       └── ConfirmDialog.tsx
├── lib/
│   ├── api.ts                   # Axios instance + API functions
│   ├── auth.ts                  # NextAuth config
│   └── permissions.ts           # Role helpers
├── hooks/
│   ├── useInvoices.ts
│   ├── useUsers.ts
│   └── useStats.ts
└── middleware.ts                 # Route protection
```

### Ρόλοι & Δικαιώματα (Web)

```
super_admin   → Όλα, όλες οι επιχειρήσεις
owner         → Όλα, μόνο η δική του επιχείρηση
accountant    → View + Export, no create/edit/delete
captain       → Mobile only, web login redirect to mobile
```

```typescript
// lib/permissions.ts
export const PERMISSIONS = {
  super_admin: {
    invoices:   ['create','read','update','cancel','delete'],
    customers:  ['create','read','update','delete'],
    users:      ['create','read','update','delete'],
    businesses: ['read','update','suspend'],
    exports:    ['all'],
    backups:    ['read','create','restore'],
    logs:       ['read']
  },
  owner: {
    invoices:   ['create','read','update','cancel'],
    customers:  ['create','read','update','delete'],
    users:      ['create','read','update'],  // μόνο εντός επιχείρησης
    businesses: ['read','update'],           // μόνο η δική τους
    exports:    ['all'],
    backups:    [],
    logs:       ['read']
  },
  accountant: {
    invoices:   ['read'],
    customers:  ['read'],
    users:      [],
    businesses: ['read'],
    exports:    ['all'],
    backups:    [],
    logs:       ['read']
  }
};

export function can(role: string, resource: string, action: string): boolean {
  return PERMISSIONS[role]?.[resource]?.includes(action) ?? false;
}
```

### Dashboard Page (κύριοι αριθμοί)

```typescript
// app/(dashboard)/dashboard/page.tsx
'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';

export default function DashboardPage() {
  const { data: overview } = useSWR('/api/stats/overview', fetcher);
  const { data: chartData } = useSWR('/api/stats/invoices-by-day', fetcher);

  return (
    <div className="p-6 space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Ενεργοί Χρήστες" value={overview?.totalUsers} />
        <StatCard label="Παραστατικά Σήμερα" value={overview?.todayInvoices} />
        <StatCard label="Αποτυχημένα" value={overview?.failedCount} alert />
        <StatCard label="MRR" value={`€${overview?.mrr}`} />
      </div>
      {/* Chart */}
      <InvoiceChart data={chartData} />
      {/* Activity + Top Customers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ActivityFeed />
        <TopCustomers />
      </div>
    </div>
  );
}
```

### Invoice Table με Filters

```typescript
// components/invoices/InvoiceTable.tsx
'use client';
import { useState } from 'react';
import { useReactTable, getCoreRowModel, flexRender } from '@tanstack/react-table';

const columns = [
  { accessorKey: 'full_number', header: 'Αριθμός' },
  { accessorKey: 'customer_name', header: 'Πελάτης' },
  { accessorKey: 'issue_date', header: 'Ημερομηνία' },
  { accessorKey: 'total_value', header: 'Σύνολο',
    cell: ({ row }) => `€${row.original.total_value}` },
  { accessorKey: 'status', header: 'Κατάσταση',
    cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  { accessorKey: 'mydata_mark', header: 'MARK' },
  { id: 'actions', header: 'Ενέργειες',
    cell: ({ row }) => <InvoiceActions invoice={row.original} /> }
];

export function InvoiceTable() {
  const [filters, setFilters] = useState({
    status: '', dateFrom: '', dateTo: '', search: ''
  });

  const { data } = useSWR(
    `/api/invoices?status=${filters.status}&from=${filters.dateFrom}&to=${filters.dateTo}&q=${filters.search}`,
    fetcher
  );

  const table = useReactTable({
    data: data?.invoices ?? [],
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div>
      <InvoiceFilters filters={filters} onChange={setFilters} />
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id}>
              {hg.headers.map(h => (
                <th key={h.id} className="text-left p-3 border-b">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id} className="hover:bg-gray-50 border-b">
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="p-3">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination total={data?.total} />
    </div>
  );
}
```

---

## 8. EMPLOYEE DASHBOARD (Web App)

Το employee dashboard είναι **ίδιο Next.js app** — απλά εμφανίζει λιγότερα μενού ανάλογα με τον ρόλο. Ο `accountant` βλέπει:

### Αυτά Βλέπει ο Λογιστής

| Σελίδα | Δυνατότητες |
|--------|------------|
| Dashboard | Read-only stats της επιχείρησης |
| Invoices | View list, view detail, download PDF, export CSV |
| Customers | View only |
| Products | View only |
| Exports | Όλα τα exports |
| Logs | View audit logs |

**ΔΕΝ βλέπει:** Users, Permissions, Businesses, Backups, Settings

### Αυτά Βλέπει ο Captain (Web — αν συνδεθεί)

Redirect στη σελίδα "Χρησιμοποιήστε την εφαρμογή κινητού". Δεν έχει web access.

### Sidebar Logic

```typescript
// components/layout/Sidebar.tsx
const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid', roles: ['super_admin','owner','accountant'] },
  { href: '/invoices', label: 'Παραστατικά', icon: 'file', roles: ['super_admin','owner','accountant'] },
  { href: '/customers', label: 'Πελάτες', icon: 'users', roles: ['super_admin','owner','accountant'] },
  { href: '/products', label: 'Είδη', icon: 'box', roles: ['super_admin','owner','accountant'] },
  { href: '/users', label: 'Χρήστες', icon: 'user-cog', roles: ['super_admin','owner'] },
  { href: '/businesses', label: 'Επιχειρήσεις', icon: 'building', roles: ['super_admin'] },
  { href: '/permissions', label: 'Δικαιώματα', icon: 'lock', roles: ['super_admin','owner'] },
  { href: '/exports', label: 'Εξαγωγές', icon: 'download', roles: ['super_admin','owner','accountant'] },
  { href: '/backups', label: 'Backups', icon: 'database', roles: ['super_admin'] },
  { href: '/logs', label: 'Audit Log', icon: 'list', roles: ['super_admin','owner'] },
];

export function Sidebar({ userRole }: { userRole: string }) {
  const filtered = navItems.filter(item => item.roles.includes(userRole));
  return (
    <nav className="w-56 bg-white border-r h-full flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b flex items-center gap-2">
        <span className="text-xl">🐟</span>
        <span className="font-semibold">FishBill</span>
      </div>
      {/* Nav items */}
      <div className="flex-1 p-3 space-y-1">
        {filtered.map(item => (
          <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
        ))}
      </div>
    </nav>
  );
}
```

---

## 9. MOBILE APP (Android Studio)

### Setup Project

```
1. Άνοιξε Android Studio (Hedgehog ή νεότερο)
2. File → New Project → Empty Views Activity
3. Name: FishBill
4. Package: gr.fishbill.app
5. Language: Kotlin
6. Min SDK: API 26 (Android 8.0)
7. Build config: Gradle (Kotlin DSL)
```

### build.gradle.kts (app)

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("kotlin-kapt")
}

android {
    namespace = "gr.fishbill.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "gr.fishbill.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "API_BASE_URL",
            "\"https://api.fishbill.gr/\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL",
                "\"http://10.0.2.2:4000/\"") // emulator localhost
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    // Retrofit (HTTP client)
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // ViewModel + LiveData
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-livedata-ktx:2.7.0")
    implementation("androidx.activity:activity-ktx:1.8.2")

    // Room (offline cache)
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")

    // Encrypted SharedPreferences (για JWT token)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // UI
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    // WorkManager (για background sync)
    implementation("androidx.work:work-runtime-ktx:2.9.0")
}
```

### Πλήρης Project Structure

```
app/src/main/
├── java/gr/fishbill/app/
│   ├── FishBillApp.kt           # Application class
│   ├── data/
│   │   ├── api/
│   │   │   ├── ApiService.kt    # Retrofit interface (όλα τα endpoints)
│   │   │   ├── ApiClient.kt     # Retrofit builder + interceptors
│   │   │   └── ApiResponse.kt   # Generic response wrapper
│   │   ├── models/
│   │   │   ├── Invoice.kt
│   │   │   ├── Customer.kt
│   │   │   ├── Product.kt
│   │   │   └── User.kt
│   │   ├── local/
│   │   │   ├── AppDatabase.kt   # Room database
│   │   │   ├── InvoiceDao.kt    # Offline drafts
│   │   │   ├── CustomerDao.kt   # Cached customers
│   │   │   └── ProductDao.kt    # Cached products
│   │   └── repository/
│   │       ├── InvoiceRepository.kt  # Network + offline logic
│   │       └── CustomerRepository.kt
│   ├── ui/
│   │   ├── login/
│   │   │   ├── LoginActivity.kt
│   │   │   └── LoginViewModel.kt
│   │   ├── main/
│   │   │   ├── MainActivity.kt      # Bottom nav host
│   │   │   └── MainViewModel.kt
│   │   ├── newinvoice/
│   │   │   ├── NewInvoiceActivity.kt   # Κύρια οθόνη (3 κουμπιά)
│   │   │   └── NewInvoiceViewModel.kt
│   │   ├── history/
│   │   │   ├── HistoryFragment.kt
│   │   │   └── HistoryViewModel.kt
│   │   ├── customers/
│   │   │   ├── CustomerPickerDialog.kt
│   │   │   └── CustomersFragment.kt
│   │   ├── products/
│   │   │   └── ProductPickerDialog.kt
│   │   └── settings/
│   │       └── SettingsFragment.kt
│   ├── workers/
│   │   └── SyncWorker.kt           # Background sync offline invoices
│   └── utils/
│       ├── TokenManager.kt          # JWT storage (EncryptedSharedPrefs)
│       ├── NetworkUtils.kt          # Check connectivity
│       └── Extensions.kt
└── res/
    ├── layout/
    │   ├── activity_login.xml
    │   ├── activity_main.xml
    │   ├── activity_new_invoice.xml   # Κύρια οθόνη
    │   ├── fragment_history.xml
    │   └── item_invoice.xml
    ├── values/
    │   ├── colors.xml
    │   ├── strings.xml
    │   └── themes.xml
    └── navigation/
        └── nav_graph.xml
```

### ApiService.kt (Πλήρης)

```kotlin
interface ApiService {

    // AUTH
    @POST("auth/login")
    suspend fun login(@Body req: LoginRequest): Response<AuthResponse>

    @POST("auth/logout")
    suspend fun logout(): Response<Unit>

    @POST("auth/refresh")
    suspend fun refreshToken(@Body req: RefreshRequest): Response<AuthResponse>

    // CUSTOMERS
    @GET("customers/recent")
    suspend fun getRecentCustomers(): Response<List<Customer>>

    @GET("customers/search")
    suspend fun searchCustomers(@Query("q") query: String): Response<List<Customer>>

    @GET("customers")
    suspend fun getCustomers(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 50
    ): Response<PaginatedResponse<Customer>>

    @POST("customers")
    suspend fun createCustomer(@Body customer: CreateCustomerRequest): Response<Customer>

    // PRODUCTS
    @GET("products/favorites")
    suspend fun getFavoriteProducts(): Response<List<Product>>

    @GET("products")
    suspend fun getProducts(): Response<List<Product>>

    // INVOICES
    @POST("invoices")
    suspend fun createInvoice(@Body invoice: CreateInvoiceRequest): Response<InvoiceResponse>

    @GET("invoices")
    suspend fun getInvoices(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20,
        @Query("status") status: String? = null
    ): Response<PaginatedResponse<Invoice>>

    @GET("invoices/{id}")
    suspend fun getInvoice(@Path("id") id: String): Response<Invoice>

    @POST("invoices/{id}/retry")
    suspend fun retryInvoice(@Path("id") id: String): Response<InvoiceResponse>

    @GET("invoices/{id}/pdf")
    @Streaming
    suspend fun downloadPDF(@Path("id") id: String): Response<ResponseBody>

    // STATS (για αρχική οθόνη)
    @GET("invoices/stats")
    suspend fun getDailyStats(): Response<DailyStats>
}
```

### NewInvoiceActivity.kt (Πλήρης — Κύρια Οθόνη)

```kotlin
class NewInvoiceActivity : AppCompatActivity() {

    private lateinit var binding: ActivityNewInvoiceBinding
    private val viewModel: NewInvoiceViewModel by viewModels()

    private var selectedCustomer: Customer? = null
    private var selectedProduct: Product? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityNewInvoiceBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupButtons()
        observeViewModel()
        loadInitialData()
    }

    private fun setupButtons() {

        // ΚΟΥΜΠΙ 1: Επιλογή Πελάτη
        binding.btnSelectCustomer.setOnClickListener {
            CustomerPickerDialog(
                customers = viewModel.recentCustomers.value ?: emptyList(),
                onSearch = { q -> viewModel.searchCustomers(q) },
                onSelect = { customer ->
                    selectedCustomer = customer
                    binding.btnSelectCustomer.text = "👤 ${customer.name}"
                    binding.btnSelectCustomer.backgroundTintList =
                        ColorStateList.valueOf(getColor(R.color.green_light))
                    checkReadyToIssue()
                }
            ).show(supportFragmentManager, "customer_picker")
        }

        // ΚΟΥΜΠΙ 2: Επιλογή Ψαριού
        binding.btnSelectProduct.setOnClickListener {
            ProductPickerDialog(
                products = viewModel.products.value ?: emptyList(),
                onSelect = { product ->
                    selectedProduct = product
                    binding.btnSelectProduct.text = "🐠 ${product.name}"
                    binding.btnSelectProduct.backgroundTintList =
                        ColorStateList.valueOf(getColor(R.color.green_light))
                    // Auto-fill τιμή
                    product.defaultPrice?.let {
                        binding.etUnitPrice.setText(it.toString())
                    }
                    checkReadyToIssue()
                }
            ).show(supportFragmentManager, "product_picker")
        }

        // Live υπολογισμός
        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                updateTotal()
            }
            override fun afterTextChanged(s: Editable?) {}
        }
        binding.etQuantity.addTextChangedListener(watcher)
        binding.etUnitPrice.addTextChangedListener(watcher)

        // ΚΟΥΜΠΙ 3: ΕΚΔΟΣΗ
        binding.btnIssue.setOnClickListener { issueInvoice() }
    }

    private fun updateTotal() {
        val qty = binding.etQuantity.text.toString().toDoubleOrNull() ?: 0.0
        val price = binding.etUnitPrice.text.toString().toDoubleOrNull() ?: 0.0
        val vatRate = selectedProduct?.vatRate ?: 13
        val net = qty * price
        val vat = net * vatRate / 100.0
        val total = net + vat
        binding.tvNetValue.text = "Καθαρή: €%.2f".format(net)
        binding.tvVatValue.text = "ΦΠΑ ${vatRate}%: €%.2f".format(vat)
        binding.tvTotal.text = "ΣΥΝΟΛΟ: €%.2f".format(total)
    }

    private fun checkReadyToIssue() {
        val ready = selectedCustomer != null && selectedProduct != null
        binding.btnIssue.isEnabled = ready
        if (ready) {
            binding.btnIssue.backgroundTintList =
                ColorStateList.valueOf(getColor(R.color.green_dark))
        }
    }

    private fun issueInvoice() {
        // Validation
        val qty = binding.etQuantity.text.toString().toDoubleOrNull()
        if (qty == null || qty <= 0) {
            binding.etQuantity.error = "Εισάγετε ποσότητα"
            return
        }
        val price = binding.etUnitPrice.text.toString().toDoubleOrNull()
        if (price == null || price <= 0) {
            binding.etUnitPrice.error = "Εισάγετε τιμή"
            return
        }

        // UI state: loading
        binding.btnIssue.isEnabled = false
        binding.progressBar.isVisible = true
        binding.btnIssue.text = "Αποστολή..."

        // Check connectivity
        if (!NetworkUtils.isOnline(this)) {
            viewModel.saveOfflineDraft(
                customer = selectedCustomer!!,
                product = selectedProduct!!,
                quantity = qty,
                unitPrice = price
            )
            return
        }

        viewModel.createInvoice(
            customerId = selectedCustomer!!.id,
            productId = selectedProduct!!.id,
            quantity = qty,
            unitPrice = price,
            vatRate = selectedProduct!!.vatRate
        )
    }

    private fun observeViewModel() {
        viewModel.invoiceResult.observe(this) { result ->
            binding.progressBar.isVisible = false
            binding.btnIssue.isEnabled = true
            binding.btnIssue.text = "✅ ΕΚΔΟΣΗ"

            when (result) {
                is InvoiceResult.Success -> {
                    showSuccessDialog(result.invoice)
                    resetForm()
                }
                is InvoiceResult.Offline -> {
                    showOfflineToast()
                    resetForm()
                }
                is InvoiceResult.Error -> {
                    showErrorDialog(result.message)
                }
            }
        }
    }

    private fun showSuccessDialog(invoice: InvoiceResponse) {
        MaterialAlertDialogBuilder(this)
            .setTitle("✅ Εκδόθηκε!")
            .setMessage(
                "Παραστατικό: ${invoice.fullNumber}\n" +
                "MARK: ${invoice.mark ?: "Σε αναμονή"}\n" +
                "Σύνολο: €%.2f".format(invoice.totalValue)
            )
            .setPositiveButton("Νέο Παραστατικό") { _, _ -> }
            .setNeutralButton("Προβολή PDF") { _, _ ->
                openPDF(invoice.id)
            }
            .show()
    }

    private fun resetForm() {
        selectedCustomer = null
        selectedProduct = null
        binding.btnSelectCustomer.text = "👤 Επιλογή Πελάτη"
        binding.btnSelectProduct.text = "🐠 Επιλογή Ψαριού"
        binding.btnSelectCustomer.backgroundTintList =
            ColorStateList.valueOf(getColor(R.color.blue_default))
        binding.btnSelectProduct.backgroundTintList =
            ColorStateList.valueOf(getColor(R.color.blue_default))
        binding.etQuantity.setText("")
        binding.etUnitPrice.setText("")
        binding.tvTotal.text = "ΣΥΝΟΛΟ: €0.00"
        binding.btnIssue.isEnabled = false
    }

    private fun loadInitialData() {
        viewModel.loadRecentCustomers()
        viewModel.loadProducts()
    }
}
```

### Offline Support με Room + WorkManager

```kotlin
// workers/SyncWorker.kt
class SyncWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val db = AppDatabase.getInstance(applicationContext)
        val api = ApiClient.apiService

        val drafts = db.invoiceDao().getDraftInvoices()

        for (draft in drafts) {
            try {
                val response = api.createInvoice(draft.toRequest())
                if (response.isSuccessful) {
                    db.invoiceDao().markAsSynced(draft.localId, response.body()!!.id)
                }
            } catch (e: Exception) {
                // Θα ξαναπροσπαθήσει στο επόμενο sync
            }
        }

        return Result.success()
    }
}

// Εκκίνηση sync όταν έρθει internet
fun scheduleSyncWhenOnline(context: Context) {
    val request = OneTimeWorkRequestBuilder<SyncWorker>()
        .setConstraints(
            Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
        )
        .build()

    WorkManager.getInstance(context)
        .enqueueUniqueWork("sync_drafts", ExistingWorkPolicy.REPLACE, request)
}
```

### Διανομή APK

**Επιλογή A: Google Play Store**
```
1. Δημιουργία keystore:
   keytool -genkey -v -keystore fishbill-release.keystore \
     -alias fishbill -keyalg RSA -keysize 2048 -validity 10000

2. Build release APK:
   Build → Generate Signed Bundle/APK
   → Επίλεξε APK
   → Επίλεξε keystore
   → Release

3. Google Play Console (play.google.com/console)
   → $25 εφάπαξ εγγραφή
   → Create app → Upload APK
   → Εσωτερικό testing → Closed testing → Production
```

**Επιλογή B: Direct Download (πιο γρήγορο για αρχή)**
```
1. Build release APK
2. Upload στο server: /var/www/fishbill/downloads/fishbill.apk
3. Nginx route: /download/app → serve APK file
4. Ψαράς κατεβάζει από fishbill.gr/download/app
5. Πρέπει να ενεργοποιήσει "Unknown sources" στο Android
```

---

## 10. myDATA INTEGRATION

### Πλήρης Ροή

```
1. Ψαράς πατάει [ΕΚΔΟΣΗ]
2. Mobile → POST /api/invoices (backend)
3. Backend: αποθηκεύει στη MySQL (status: 'issued')
4. Backend: βάζει job στη Redis queue
5. Queue worker: χτίζει XML payload
6. Worker: POST στον Πάροχο (SoftOne/Epsilon API)
7. Πάροχος: στέλνει στο myDATA
8. myDATA: επικυρώνει, επιστρέφει MARK
9. Πάροχος: επιστρέφει MARK στο worker
10. Worker: UPDATE invoices SET status='transmitted', mydata_mark=MARK
11. Worker: παράγει PDF με MARK
12. Mobile: polling ή push notification → "✅ Εκδόθηκε"
```

### myDATA XML Builder

```javascript
// services/mydata.service.js
const { create } = require('xmlbuilder2');

function buildInvoiceXML(invoice, business, customer, lines) {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('InvoicesDoc', {
      'xmlns': 'https://www.aade.gr/myDATA/invoice/v1.0.6',
      'xmlns:icls': 'https://www.aade.gr/myDATA/incomeClassification/v1.0.3',
      'xmlns:ecls': 'https://www.aade.gr/myDATA/expensesClassification/v1.0.3'
    });

  const inv = doc.ele('invoice');

  // Εκδότης
  inv.ele('issuer')
    .ele('vatNumber').txt(business.afm).up()
    .ele('country').txt('GR').up()
    .ele('branch').txt('0').up();

  // Λήπτης
  if (customer && customer.afm) {
    inv.ele('counterpart')
      .ele('vatNumber').txt(customer.afm).up()
      .ele('country').txt(customer.country || 'GR').up()
      .ele('branch').txt('0').up()
      .ele('name').txt(customer.name).up();
  }

  // Κεφαλίδα
  inv.ele('invoiceHeader')
    .ele('series').txt(invoice.series).up()
    .ele('aa').txt(invoice.number.toString()).up()
    .ele('issueDate').txt(invoice.issue_date).up()
    .ele('invoiceType').txt(invoice.invoice_type).up()
    .ele('currency').txt('EUR').up();

  // Γραμμές
  lines.forEach((line, idx) => {
    inv.ele('invoiceDetails')
      .ele('lineNumber').txt((idx + 1).toString()).up()
      .ele('netValue').txt(line.net_value.toFixed(2)).up()
      .ele('vatCategory').txt(vatCategoryCode(line.vat_rate)).up()
      .ele('vatAmount').txt(line.vat_amount.toFixed(2)).up()
      .ele('icls:incomeClassification')
        .ele('icls:classificationType').txt(line.income_type).up()
        .ele('icls:classificationCategory').txt(line.income_category).up()
        .ele('icls:amount').txt(line.net_value.toFixed(2)).up()
      .up();
  });

  // Σύνολα
  inv.ele('invoiceSummary')
    .ele('totalNetValue').txt(invoice.net_value.toFixed(2)).up()
    .ele('totalVatAmount').txt(invoice.vat_amount.toFixed(2)).up()
    .ele('totalGrossValue').txt(invoice.total_value.toFixed(2)).up()
    .ele('icls:incomeClassificationSummary')
      .ele('icls:classificationType').txt(lines[0]?.income_type || '1.1').up()
      .ele('icls:classificationCategory').txt(lines[0]?.income_category || 'E3_561_001').up()
      .ele('icls:amount').txt(invoice.net_value.toFixed(2)).up()
    .up();

  return doc.end({ prettyPrint: false });
}

function vatCategoryCode(rate) {
  const map = { 24: '1', 13: '2', 6: '3', 17: '4', 9: '5', 4: '6', 0: '7' };
  return map[rate] || '1';
}

module.exports = { buildInvoiceXML };
```

### Queue Worker (Redis Bull)

```javascript
// jobs/transmission.job.js
const Bull = require('bull');
const db = require('../config/database');
const providerService = require('../services/provider.service');
const pdfService = require('../services/pdf.service');
const emailService = require('../services/email.service');

const transmissionQueue = new Bull('invoice-transmission', {
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD
  }
});

// Ρυθμίσεις retry
transmissionQueue.defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000  // 5s → 25s → 125s
  },
  removeOnComplete: false,
  removeOnFail: false
};

// Worker
transmissionQueue.process('transmit', async (job) => {
  const { invoiceId } = job.data;

  // 1. Φόρτωσε παραστατικό
  const [invoiceRows] = await db.execute(`
    SELECT i.*, b.afm as business_afm, b.name as business_name,
           b.provider_name, b.provider_api_key, b.provider_api_url,
           c.afm as customer_afm, c.name as customer_name,
           c.address as customer_address, c.city as customer_city
    FROM invoices i
    JOIN businesses b ON i.business_id = b.id
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.id = ?
  `, [invoiceId]);

  const invoice = invoiceRows[0];
  if (!invoice) throw new Error('Invoice not found');

  // 2. Φόρτωσε γραμμές
  const [lines] = await db.execute(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
    [invoiceId]
  );

  // 3. Αποστολή στον πάροχο
  const result = await providerService.transmit(invoice, lines);

  // 4. Ενημέρωση βάσης
  await db.execute(`
    UPDATE invoices
    SET status = 'transmitted',
        mydata_mark = ?,
        mydata_uid = ?,
        provider_reference = ?,
        transmitted_at = NOW()
    WHERE id = ?
  `, [result.mark, result.uid, result.reference, invoiceId]);

  // 5. Log
  await db.execute(`
    INSERT INTO transmission_logs
      (invoice_id, provider, attempt_number, success, mydata_mark, duration_ms)
    VALUES (?, ?, ?, 1, ?, ?)
  `, [invoiceId, invoice.provider_name, job.attemptsMade + 1,
      result.mark, result.durationMs]);

  // 6. PDF
  await pdfService.generate(invoiceId);

  // 7. Ενημέρωση mobile (SSE ή push)
  // TODO: push notification implementation

  return { success: true, mark: result.mark };
});

// Όταν αποτύχει (μετά από όλα τα retries)
transmissionQueue.on('failed', async (job, err) => {
  const { invoiceId } = job.data;

  await db.execute(`
    UPDATE invoices
    SET status = 'failed',
        last_error = ?,
        retry_count = retry_count + 1
    WHERE id = ?
  `, [err.message, invoiceId]);

  await db.execute(`
    INSERT INTO transmission_logs
      (invoice_id, success, error_message)
    VALUES (?, 0, ?)
  `, [invoiceId, err.message]);

  // Email στον ιδιοκτήτη
  await emailService.sendTransmissionFailed(invoiceId);
});

module.exports = transmissionQueue;
```

---

## 11. PDF GENERATION

```javascript
// services/pdf.service.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const PDF_DIR = process.env.PDF_STORAGE_PATH || '/var/www/fishbill/pdfs';

async function generateInvoicePDF(invoiceId) {
  // Φόρτωσε δεδομένα
  const [rows] = await db.execute(`
    SELECT i.*, b.name as biz_name, b.afm as biz_afm, b.address as biz_address,
           b.city as biz_city, b.phone as biz_phone, b.email as biz_email,
           c.name as cust_name, c.afm as cust_afm, c.address as cust_address
    FROM invoices i
    JOIN businesses b ON i.business_id = b.id
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.id = ?
  `, [invoiceId]);

  const invoice = rows[0];
  const [lines] = await db.execute(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
    [invoiceId]
  );

  // Δημιουργία PDF
  const doc = new PDFDocument({
    size: 'A4', margin: 50,
    info: {
      Title: `Παραστατικό ${invoice.full_number}`,
      Author: 'FishBill'
    }
  });

  // Διαδρομή αρχείου
  const filename = `invoice-${invoice.full_number.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const filepath = path.join(PDF_DIR, invoice.business_id, filename);

  // Δημιουργία φακέλου αν δεν υπάρχει
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  // --- Κεφαλίδα ---
  doc.fontSize(20).font('Helvetica-Bold').text('ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ', 50, 50);
  doc.fontSize(10).font('Helvetica');

  // Αριθμός + Ημερομηνία
  doc.text(`Αριθμός: ${invoice.full_number}`, 400, 50);
  doc.text(`Ημερομηνία: ${invoice.issue_date}`, 400, 65);
  if (invoice.mydata_mark) {
    doc.text(`MARK: ${invoice.mydata_mark}`, 400, 80);
  }

  // --- Στοιχεία Εκδότη ---
  doc.rect(50, 100, 240, 80).stroke();
  doc.fontSize(8).font('Helvetica-Bold').text('ΕΚΔΟΤΗΣ', 55, 105);
  doc.font('Helvetica')
    .text(invoice.biz_name, 55, 118)
    .text(`ΑΦΜ: ${invoice.biz_afm}`, 55, 130)
    .text(invoice.biz_address || '', 55, 142)
    .text(`Τηλ: ${invoice.biz_phone || ''}`, 55, 154);

  // --- Στοιχεία Λήπτη ---
  doc.rect(310, 100, 240, 80).stroke();
  doc.fontSize(8).font('Helvetica-Bold').text('ΛΗΠΤΗΣ', 315, 105);
  doc.font('Helvetica')
    .text(invoice.cust_name || 'ΛΙΑΝΙΚΗ', 315, 118)
    .text(invoice.cust_afm ? `ΑΦΜ: ${invoice.cust_afm}` : '', 315, 130)
    .text(invoice.cust_address || '', 315, 142);

  // --- Πίνακας Γραμμών ---
  let y = 210;
  doc.rect(50, y, 500, 20).fill('#E8E8E8').stroke();
  doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
  doc.text('Περιγραφή', 55, y + 5);
  doc.text('Μον.', 270, y + 5);
  doc.text('Ποσότητα', 310, y + 5);
  doc.text('Τιμή', 370, y + 5);
  doc.text('ΦΠΑ%', 420, y + 5);
  doc.text('Αξία', 460, y + 5);

  y += 20;
  doc.font('Helvetica').fontSize(9);

  lines.forEach(line => {
    doc.text(line.description, 55, y + 5);
    doc.text(line.unit, 270, y + 5);
    doc.text(line.quantity.toString(), 310, y + 5);
    doc.text(`€${parseFloat(line.unit_price).toFixed(2)}`, 370, y + 5);
    doc.text(`${line.vat_rate}%`, 420, y + 5);
    doc.text(`€${parseFloat(line.total_value).toFixed(2)}`, 460, y + 5);
    doc.rect(50, y, 500, 18).stroke();
    y += 18;
  });

  // --- Σύνολα ---
  y += 10;
  doc.fontSize(9);
  doc.text(`Καθαρή Αξία: €${parseFloat(invoice.net_value).toFixed(2)}`, 380, y);
  doc.text(`ΦΠΑ: €${parseFloat(invoice.vat_amount).toFixed(2)}`, 380, y + 14);
  doc.fontSize(11).font('Helvetica-Bold');
  doc.text(`ΣΥΝΟΛΟ: €${parseFloat(invoice.total_value).toFixed(2)}`, 380, y + 28);

  // --- Footer ---
  doc.fontSize(7).font('Helvetica').fillColor('gray')
    .text('Εκδόθηκε μέσω FishBill | fishbill.gr', 50, 780, { align: 'center' });

  doc.end();

  await new Promise((resolve) => stream.on('finish', resolve));

  // Αποθήκευση path στη βάση
  await db.execute(
    'UPDATE invoices SET pdf_path = ?, pdf_generated_at = NOW() WHERE id = ?',
    [filepath, invoiceId]
  );

  return filepath;
}

module.exports = { generateInvoicePDF };
```

---

## 12. AUTHENTICATION & SECURITY

### JWT Authentication Flow

```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/database');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Φόρτωσε χρήστη από βάση (για να ελέγξεις αν είναι ακόμα active)
    const [rows] = await db.execute(
      'SELECT id, role, business_id, is_active FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Role-based middleware
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Business isolation middleware
function requireSameBusiness(req, res, next) {
  if (req.user.role === 'super_admin') return next();
  if (req.params.businessId && req.params.businessId !== req.user.business_id) {
    return res.status(403).json({ error: 'Access denied to this business' });
  }
  next();
}

module.exports = { authenticate, requireRole, requireSameBusiness };
```

### Encryption για API Keys

```javascript
// config/encryption.js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
```

---

## 13. NOTIFICATIONS & EMAIL

```javascript
// services/email.service.js
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTransmissionFailed(invoiceId) {
  const [rows] = await db.execute(`
    SELECT i.full_number, b.email, b.name as biz_name, i.last_error
    FROM invoices i JOIN businesses b ON i.business_id = b.id
    WHERE i.id = ?
  `, [invoiceId]);

  const inv = rows[0];
  await resend.emails.send({
    from: 'FishBill <noreply@fishbill.gr>',
    to: inv.email,
    subject: `⚠️ Αποτυχία αποστολής ${inv.full_number}`,
    html: `
      <h2>Πρόβλημα αποστολής παραστατικού</h2>
      <p>Το παραστατικό <strong>${inv.full_number}</strong> δεν εστάλη στο myDATA.</p>
      <p>Σφάλμα: ${inv.last_error}</p>
      <p>Το σύστημα θα ξαναπροσπαθήσει αυτόματα. Αν το πρόβλημα συνεχιστεί,
         επικοινωνήστε με τον λογιστή σας.</p>
      <a href="https://app.fishbill.gr/invoices">Δείτε το παραστατικό</a>
    `
  });
}

async function sendWelcome(user, business) {
  await resend.emails.send({
    from: 'FishBill <noreply@fishbill.gr>',
    to: user.email,
    subject: '🐟 Καλώς ήρθατε στο FishBill!',
    html: `
      <h2>Η επιχείρησή σας ${business.name} είναι έτοιμη!</h2>
      <p>Κατεβάστε την εφαρμογή FishBill από το Google Play.</p>
      <p>Σύνδεση web: <a href="https://app.fishbill.gr">app.fishbill.gr</a></p>
    `
  });
}

async function sendSubscriptionExpiry(business, daysLeft) {
  await resend.emails.send({
    from: 'FishBill <noreply@fishbill.gr>',
    to: business.email,
    subject: `⚠️ Η συνδρομή σας λήγει σε ${daysLeft} ημέρες`,
    html: `
      <p>Η συνδρομή σας FishBill λήγει σε <strong>${daysLeft} ημέρες</strong>.</p>
      <a href="https://app.fishbill.gr/settings/billing">Ανανέωση τώρα</a>
    `
  });
}

module.exports = { sendTransmissionFailed, sendWelcome, sendSubscriptionExpiry };
```

---

## 14. BACKUPS & RESTORE

### Αυτόματο Daily Backup

```javascript
// jobs/backup.job.js
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const db = require('../config/database');

const BACKUP_DIR = '/var/backups/fishbill';

// Τρέχει κάθε μέρα στις 02:00
cron.schedule('0 2 * * *', () => runBackup('auto'));

async function runBackup(type = 'auto') {
  const date = new Date().toISOString().split('T')[0];
  const filename = `fishbill-${date}-${type}.sql.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  // Log start
  const [result] = await db.execute(
    'INSERT INTO backup_logs (filename, type, status) VALUES (?, ?, "running")',
    [filename, type]
  );
  const logId = result.insertId;

  const cmd = `mysqldump -u${process.env.DB_USER} -p${process.env.DB_PASSWORD} \
    ${process.env.DB_NAME} | gzip > ${filepath}`;

  exec(cmd, async (error, stdout, stderr) => {
    if (error) {
      await db.execute(
        'UPDATE backup_logs SET status="failed", error_msg=?, finished_at=NOW() WHERE id=?',
        [error.message, logId]
      );
      console.error('Backup failed:', error.message);
    } else {
      const { statSync } = require('fs');
      const size = statSync(filepath).size;
      await db.execute(
        'UPDATE backup_logs SET status="success", size_bytes=?, finished_at=NOW() WHERE id=?',
        [size, logId]
      );
      console.log(`Backup OK: ${filename} (${(size/1024/1024).toFixed(1)} MB)`);

      // Διαγραφή backup >30 ημερών
      cleanOldBackups(30);
    }
  });
}

function cleanOldBackups(days) {
  const cmd = `find ${BACKUP_DIR} -name "*.sql.gz" -mtime +${days} -delete`;
  exec(cmd);
}

module.exports = { runBackup };
```

### Backup Folder Setup

```bash
mkdir -p /var/backups/fishbill
chown fishbill:fishbill /var/backups/fishbill
chmod 750 /var/backups/fishbill
```

---

## 15. AUDIT LOGS

```javascript
// middleware/audit.js
const db = require('../config/database');

async function auditLog(req, action, entityType, entityId, description, oldValues, newValues) {
  try {
    await db.execute(`
      INSERT INTO audit_logs
        (user_id, business_id, action, entity_type, entity_id,
         description, old_values, new_values, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user?.id || null,
      req.user?.business_id || null,
      action,
      entityType,
      entityId,
      description,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      req.ip,
      req.headers['user-agent']?.substring(0, 500)
    ]);
  } catch (err) {
    // Ποτέ δεν σπάμε το request για log failure
    console.error('Audit log error:', err.message);
  }
}

// Χρήση σε routes:
// await auditLog(req, 'CREATE', 'invoice', invoice.id, `Created invoice ${invoice.full_number}`);
// await auditLog(req, 'CANCEL', 'invoice', id, 'Invoice cancelled', {status:'transmitted'}, {status:'cancelled'});

module.exports = { auditLog };
```

---

## 16. EXPORTS

```javascript
// services/export.service.js
const { Parser } = require('fast-csv');
const db = require('../config/database');

async function exportInvoicesCSV(businessId, filters, res) {
  let query = `
    SELECT i.full_number, c.name as customer, i.issue_date,
           i.net_value, i.vat_amount, i.total_value, i.status,
           i.mydata_mark, i.transmitted_at, u.full_name as issued_by
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.business_id = ?
  `;
  const params = [businessId];

  if (filters.from) { query += ' AND i.issue_date >= ?'; params.push(filters.from); }
  if (filters.to) { query += ' AND i.issue_date <= ?'; params.push(filters.to); }
  if (filters.status) { query += ' AND i.status = ?'; params.push(filters.status); }

  query += ' ORDER BY i.issue_date DESC, i.number DESC';

  const [rows] = await db.execute(query, params);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invoices-${Date.now()}.csv"`);
  res.write('\uFEFF'); // BOM για σωστή εμφάνιση ελληνικών στο Excel

  const csvStream = require('fast-csv').format({ headers: true, delimiter: ';' });
  csvStream.pipe(res);

  rows.forEach(row => csvStream.write({
    'Αριθμός': row.full_number,
    'Πελάτης': row.customer || 'ΛΙΑΝΙΚΗ',
    'Ημερομηνία': row.issue_date,
    'Καθαρή Αξία': row.net_value,
    'ΦΠΑ': row.vat_amount,
    'Σύνολο': row.total_value,
    'Κατάσταση': row.status,
    'MARK': row.mydata_mark || '',
    'Αποστολή': row.transmitted_at || '',
    'Εκδόθηκε από': row.issued_by
  }));

  csvStream.end();
}

module.exports = { exportInvoicesCSV };
```

---

## 17. SUBSCRIPTIONS & PAYMENTS

### Stripe Integration

```javascript
// routes/subscriptions.routes.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Δημιουργία checkout session
router.post('/create-checkout', authenticate, async (req, res) => {
  const { plan } = req.body;
  const prices = { basic: 'price_basic_monthly', pro: 'price_pro_monthly' };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: req.user.email,
    line_items: [{ price: prices[plan], quantity: 1 }],
    success_url: `${process.env.APP_URL}/settings/billing?success=1`,
    cancel_url: `${process.env.APP_URL}/settings/billing?cancelled=1`,
    metadata: { businessId: req.user.business_id }
  });

  res.json({ url: session.url });
});

// Stripe webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    await db.execute(`
      UPDATE businesses
      SET subscription_active = ?, plan = ?,
          subscription_ends_at = FROM_UNIXTIME(?)
      WHERE stripe_customer_id = ?
    `, [
      sub.status === 'active' ? 1 : 0,
      sub.metadata.plan || 'basic',
      sub.current_period_end,
      sub.customer
    ]);
  }

  res.json({ received: true });
});
```

---

## 18. DEPLOYMENT STEP-BY-STEP ΣΤΟ PAPAKI

### Βήμα 1: Upload κώδικα στο server

```bash
# Στο local machine — build & upload
cd fishbill-api
zip -r fishbill-api.zip . --exclude "node_modules/*" ".git/*"
scp fishbill-api.zip fishbill@[VPS-IP]:/home/fishbill/

# SSH στο server
ssh fishbill@[VPS-IP]
cd /home/fishbill
unzip fishbill-api.zip -d fishbill-api
cd fishbill-api
npm install --production
```

### Βήμα 2: Database Migration

```bash
mysql -u fishbill_user -p fishbill_db < schema.sql
```

### Βήμα 3: PM2 Setup

```bash
# pm2 ecosystem file
cat > /home/fishbill/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'fishbill-api',
      script: '/home/fishbill/fishbill-api/src/server.js',
      cwd: '/home/fishbill/fishbill-api',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: '/home/fishbill/logs/api-error.log',
      out_file: '/home/fishbill/logs/api-out.log'
    },
    {
      name: 'fishbill-web',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/home/fishbill/fishbill-web',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      instances: 1,
      autorestart: true,
      error_file: '/home/fishbill/logs/web-error.log',
      out_file: '/home/fishbill/logs/web-out.log'
    }
  ]
};
EOF

mkdir -p /home/fishbill/logs
pm2 start /home/fishbill/ecosystem.config.js --env production
pm2 save
```

### Βήμα 4: Nginx Configuration

```bash
# Δημιουργία config
sudo nano /etc/nginx/sites-available/fishbill

# Paste:
server {
    listen 80;
    server_name fishbill.gr www.fishbill.gr app.fishbill.gr;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.fishbill.gr fishbill.gr www.fishbill.gr;

    ssl_certificate /etc/letsencrypt/live/fishbill.gr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fishbill.gr/privkey.pem;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;

    # Next.js web app
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # Static Next.js files
    location /_next/static {
        proxy_pass http://localhost:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}

server {
    listen 443 ssl http2;
    server_name api.fishbill.gr;

    ssl_certificate /etc/letsencrypt/live/fishbill.gr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fishbill.gr/privkey.pem;

    # API
    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        client_max_body_size 10M;
    }

    # PDF downloads
    location /pdfs/ {
        alias /var/www/fishbill/pdfs/;
        add_header Content-Disposition "attachment";
    }
}

# Ενεργοποίηση
sudo ln -s /etc/nginx/sites-available/fishbill /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 19. DOMAIN & SSL

### SSL με Let's Encrypt (Δωρεάν)

```bash
# Εγκατάσταση Certbot
sudo apt install -y certbot python3-certbot-nginx

# Απόκτηση certificate για όλα τα subdomains
sudo certbot --nginx \
  -d fishbill.gr \
  -d www.fishbill.gr \
  -d app.fishbill.gr \
  -d api.fishbill.gr \
  --email your@email.gr \
  --agree-tos \
  --non-interactive

# Auto-renewal (certbot κάνει αυτόματα με cron, αλλά να ελέγχεις)
sudo certbot renew --dry-run

# Το certbot προσθέτει αυτόματα cron για renewal:
# 0 0,12 * * * root certbot renew --quiet
```

### DNS Confirmation

```bash
# Επαλήθευση ότι τα DNS δείχνουν σωστά
dig fishbill.gr A
dig app.fishbill.gr A
dig api.fishbill.gr A

# Πρέπει να επιστρέφουν τη VPS IP σου
```

---

## 20. BUSINESS MODEL & SCALING

### Τιμολόγηση

```
BASIC  10€/μήνα → 1 χρήστης, 1 σειρά, έως 200 παρ./μήνα
PRO    20€/μήνα → 5 χρήστες, 3 σειρές, unlimited παρ.
```

### Κόστος Ανά Πελάτη

```
VPS Papaki:             15€/μήνα ÷ 100 πελάτες = 0.15€
Provider (SoftOne):     ~0.07€ × 50 παρ./μήνα  = 3.50€
Email (Resend free):    0€ (έως 3,000/μήνα)
SSL:                    0€ (Let's Encrypt)
Domain:                 ~1€/μήνα
─────────────────────────────────────────
Κόστος/πελάτη:          ~4€/μήνα
Τιμή:                   10€/μήνα
Κέρδος/πελάτη:          ~6€/μήνα
```

### Scaling Numbers

```
50  ψαράδες  →  500€/μήνα  →  300€ κέρδος
100 ψαράδες  →  1.000€/μήνα  →  600€ κέρδος
300 ψαράδες  →  3.000€/μήνα  →  2.200€ κέρδος
500 ψαράδες  →  5.000€/μήνα  →  3.800€ κέρδος

Σε 500 ψαράδες → αναβάθμισε VPS (35€/μήνα αντί 15€)
```

### Πού να Βρεις Πελάτες

```
1. Ιχθυόσκαλες (Κερατσίνι, Θεσσαλονίκη, Πάτρα, Ηράκλειο)
   → Μίλα με τη διοίκηση, πρόσφερε demo
2. Facebook groups: "Αλιεία Ελλάδα", "Ψαράδες Αιγαίου"
3. Λογιστές που έχουν αλιείς ως πελάτες
   → Δώσε τους 20% commission για κάθε παραπομπή
4. Λιμεναρχεία (bulletin boards)
5. Αλιευτικοί συνεταιρισμοί
```

---

## 21. LAUNCH CHECKLIST

### Infrastructure ✅

- [ ] Papaki VPS αγορασμένο και προσβάσιμο
- [ ] Ubuntu 22.04 εγκατεστημένο
- [ ] Node.js 20, MySQL 8, Redis, Nginx εγκατεστημένα
- [ ] MySQL βάση δημιουργημένη με όλους τους πίνακες
- [ ] .env file ρυθμισμένο με ασφαλείς κωδικούς
- [ ] PM2 τρέχει και ξεκινά αυτόματα στο reboot
- [ ] Nginx configured και τρέχει
- [ ] SSL certificate εγκατεστημένο (certbot)
- [ ] Firewall ενεργό (ufw)
- [ ] Backup directory δημιουργημένο

### Domain & DNS ✅

- [ ] Domain fishbill.gr αγορασμένο στο Papaki
- [ ] A records για @, app, api → VPS IP
- [ ] fishbill.gr ανοίγει στον browser ✅
- [ ] app.fishbill.gr ανοίγει στον browser ✅
- [ ] api.fishbill.gr/health επιστρέφει {"status":"ok"} ✅
- [ ] HTTPS λειτουργεί (κλειδαριά στον browser) ✅

### Backend ✅

- [ ] Login endpoint λειτουργεί (POST /api/auth/login)
- [ ] JWT tokens εκδίδονται σωστά
- [ ] Invoice creation λειτουργεί end-to-end
- [ ] Redis queue τρέχει και επεξεργάζεται jobs
- [ ] PDF παράγεται σωστά
- [ ] Email αποστέλλεται (test με Resend)
- [ ] Cron backup τρέχει (test χειροκίνητα)

### myDATA / Πάροχος ✅

- [ ] Σύμβαση με πάροχο υπογεγραμμένη
- [ ] Sandbox credentials λειτουργούν
- [ ] Test invoice σε sandbox → MARK επιστρέφεται ✅
- [ ] Production credentials ρυθμισμένα
- [ ] Live test invoice → MARK επιστρέφεται ✅

### Web Dashboard ✅

- [ ] Login στο app.fishbill.gr λειτουργεί
- [ ] Dashboard εμφανίζει σωστά stats
- [ ] Invoice table φορτώνει
- [ ] PDF preview λειτουργεί
- [ ] Export CSV λειτουργεί
- [ ] User management λειτουργεί

### Mobile App ✅

- [ ] APK build (release) επιτυχής
- [ ] Login λειτουργεί
- [ ] Επιλογή πελάτη/ψαριού λειτουργεί
- [ ] Έκδοση παραστατικού → MARK εμφανίζεται
- [ ] Offline mode → αποθηκεύει και στέλνει όταν βρει internet
- [ ] APK διαθέσιμο για download ή Play Store

### Νομικά ✅

- [ ] Πολιτική Απορρήτου (GDPR) στο site
- [ ] Όροι Χρήσης στο site
- [ ] Privacy notice στην εφαρμογή (GDPR consent)
- [ ] ΑΦΜ εταιρείας εμφανίζεται στα τιμολόγια
- [ ] Σύμβαση με πάροχο ✅

### Business ✅

- [ ] 3-5 pilot ψαράδες (δωρεάν 1 μήνας)
- [ ] Stripe/Viva Wallet ρυθμισμένο για πληρωμές
- [ ] WhatsApp/email support ενεργό
- [ ] Onboarding video έτοιμο (YouTube, 5 λεπτά)

---

## APPENDIX — Χρήσιμες Εντολές Server

```bash
# PM2
pm2 list                        # Status όλων των processes
pm2 logs fishbill-api           # Logs API
pm2 logs fishbill-web           # Logs Web
pm2 restart fishbill-api        # Restart API
pm2 reload fishbill-web         # Zero-downtime reload

# MySQL
mysql -u fishbill_user -p fishbill_db
SHOW TABLES;
SELECT COUNT(*) FROM invoices;
SELECT * FROM invoices WHERE status='failed';

# Redis
redis-cli -a [REDIS_PASSWORD]
KEYS *                          # Όλα τα keys
LLEN bull:invoice-transmission  # Queue size

# Nginx
sudo nginx -t                   # Test config
sudo systemctl reload nginx     # Reload
sudo tail -f /var/log/nginx/error.log

# Disk & Memory
df -h                           # Disk usage
free -h                         # RAM usage
htop                            # Live processes

# Backup manual
node -e "require('./src/jobs/backup.job').runBackup('manual')"

# SSL renewal (auto, but manual if needed)
sudo certbot renew
```

---

*FishBill Complete Guide v2.0 | MySQL + Papaki + Android + Web Dashboard*
*Τελευταία ενημέρωση: 2026*
