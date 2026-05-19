# FishBill — Πλήρης Τεκμηρίωση Συστήματος

> Ημερομηνία: Απρίλιος 2026  
> Έκδοση: 1.0 Production

---

## ΜΕΡΟΣ 1 — ΕΠΙΣΚΟΠΗΣΗ ΣΥΣΤΗΜΑΤΟΣ

### Τι είναι το FishBill
SaaS εφαρμογή τιμολόγησης ειδικά σχεδιασμένη για αλιείς (ψαράδες) στην Ελλάδα. Επιτρέπει την έκδοση τιμολογίων και δελτίων αποστολής, διαχείριση πελατών, και παρακολούθηση στατιστικών.

### Αρχιτεκτονική

| Στρώμα | Τεχνολογία | Τοποθεσία |
|--------|-----------|----------|
| Βάση Δεδομένων | MySQL 8 (XAMPP) | localhost:3306 / db: `fishbill` |
| API Backend | Node.js + Express | port 4000, `E:\xaamp\htdocs\fishbill\fishbill-api` |
| Web Admin Panel | HTML + Tailwind CSS | `E:\xaamp\htdocs\fishbill\admin` |
| Web Fisherman App | HTML + Vanilla JS | `E:\xaamp\htdocs\fishbill\app` |
| Android App | Kotlin + Jetpack Compose | `C:\Users\PC\AndroidStudioProjects\FishBillApp` |

---

## ΜΕΡΟΣ 2 — ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ

### Κύριοι Πίνακες

| Πίνακας | Περιγραφή |
|---------|----------|
| `businesses` | Κάθε ψαράς = 1 επιχείρηση. Περιέχει plan, συνδρομή, AFM, ρυθμίσεις |
| `users` | Χρήστες (owner, employee, accountant, super_admin). Ένα business έχει πολλούς users |
| `invoices` | Τιμολόγια. FK → businesses |
| `invoice_items` | Γραμμές τιμολογίου (ψάρι, ποσότητα, τιμή) |
| `delivery_notes` | Δελτία αποστολής. FK → businesses |
| `delivery_note_items` | Γραμμές δελτίου αποστολής |
| `customers` | Πελάτες ανά επιχείρηση |
| `products` | Προϊόντα (ψάρια/θαλασσινά) ανά επιχείρηση |
| `business_settings` | Ρυθμίσεις ανά επιχείρηση (email, SMS, myDATA, features) |
| `business_associations` | Αλιευτικοί σύλλογοι/ενώσεις |
| `invoice_series` | Σειρές τιμολογίων (π.χ. Α, Β) |
| `audit_logs` | Ιστορικό ενεργειών (logins, αλλαγές) |
| `platform_settings` | Ρυθμίσεις πλατφόρμας (super_admin only) |

### Σχέση businesses → users
```
businesses (1) ──── (N) users
businesses (1) ──── (N) invoices
businesses (1) ──── (N) delivery_notes
businesses (1) ──── (N) customers
businesses (1) ──── (1) business_settings
```

### Πεδία Συνδρομής στο businesses
```sql
plan                    ENUM('trial','basic','pro','enterprise')
trial_ends_at           DATETIME NULL         -- NULL = no trial
subscription_active     TINYINT(1) DEFAULT 0
subscription_ends_at    DATETIME NULL
billing_cycle           ENUM('monthly','semi_annual','annual')
auto_renew              TINYINT(1) DEFAULT 1
is_first_subscription   TINYINT(1) DEFAULT 1  -- 1=bonus month not yet applied
```

### Migrations (σε σειρά)
| Αρχείο | Τι κάνει |
|--------|----------|
| 001 | business_settings πίνακας |
| 002 | Bug fixes αρχικού schema |
| 003 | Accountant portal (accountant role, πρόσβαση) |
| 004 | User avatars |
| 004 | IRIS payment tables |
| 005 | Integrations (email/SMS/myDATA settings) |
| 006 | auto_renew column σε businesses |
| 007 | invoice_type (retail/wholesale) |
| 008 | payment_method enum |
| 009 | fisherman_code + bug reports |
| 010 | Invoice cancel OTP |
| 011 | FCM tokens (push notifications) |
| 012 | Credit invoice support |
| 013 | Pending columns cleanup |
| 014 | delivery_notes + delivery_note_items |
| 015 | business_associations |
| 016 | Email verification tokens |
| 017 | billing_cycle column |
| 018 | feature_customers (toggle πελατών) |
| 019 | is_first_subscription (bonus μήνας) |

**Για να τρέξεις migrations:** `node run_migration.js` στο φάκελο fishbill-api, ή μέσω phpMyAdmin.

---

## ΜΕΡΟΣ 3 — API ENDPOINTS

### Βάση URL
- **Localhost:** `http://localhost:4000/api`
- **Production:** `https://your-domain.com/api`

### Authentication
Όλα τα endpoints (εκτός /auth/login, /auth/register) απαιτούν:
```
Authorization: Bearer <access_token>
```

### 3.1 Auth Routes (`/api/auth`)

| Method | Endpoint | Περιγραφή | Auth |
|--------|----------|-----------|------|
| POST | `/auth/register` | Εγγραφή νέας επιχείρησης + owner | ❌ |
| POST | `/auth/login` | Σύνδεση, επιστρέφει access+refresh token | ❌ |
| POST | `/auth/refresh` | Ανανέωση access token | ❌ |
| POST | `/auth/logout` | Αποσύνδεση (client-side token drop) | ✅ |
| GET  | `/auth/verify-email/:token` | Επιβεβαίωση email από link | ❌ |
| POST | `/auth/resend-verify` | Επαναποστολή verification email | ✅ |
| POST | `/auth/forgot-password` | Αποστολή reset link | ❌ |
| POST | `/auth/reset-password` | Αλλαγή κωδικού με token | ❌ |
| POST | `/auth/change-password` | Αλλαγή κωδικού (authenticated) | ✅ |
| POST | `/auth/owner-recovery` | Βήμα 1: recovery με email+AFM | ❌ |
| POST | `/auth/owner-recovery-login` | Βήμα 2: login με recovery token | ❌ |
| DELETE | `/auth/me` | Απενεργοποίηση λογαριασμού | ✅ |

**Register body:**
```json
{
  "business_name": "Αλιεία Παπαδόπουλος",
  "business_afm": "123456789",
  "business_doy": "ΔΟΥ Πειραιά",
  "business_address": "Λιμάνι 1",
  "business_city": "Πειραιάς",
  "business_phone": "2101234567",
  "business_email": "info@papas.gr",
  "owner_name": "Γιώργης Παπαδόπουλος",
  "owner_email": "giorgis@papas.gr",
  "owner_password": "securepass123"
}
```

### 3.2 Dashboard (`/api/dashboard`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/dashboard/stats` | Στατιστικά: συνολικά/μηνιαία τιμολόγια, δελτία, πελάτες, έσοδα |

**Απάντηση:**
```json
{
  "stats": {
    "totalInvoices": 145,
    "monthlyInvoices": 12,
    "totalRevenue": 8420.50,
    "monthlyRevenue": 1200.00,
    "totalCustomers": 28,
    "monthlyDeliveryNotes": 5
  }
}
```

### 3.3 Invoices (`/api/invoices`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/invoices` | Λίστα τιμολογίων (pagination, search, filter) |
| GET | `/invoices/:id` | Ένα τιμολόγιο με items |
| POST | `/invoices` | Δημιουργία (έλεγχος ορίου μηνιαίου πλάνου) |
| PATCH | `/invoices/:id` | Επεξεργασία |
| DELETE | `/invoices/:id` | Ακύρωση (απαιτεί OTP) |
| GET | `/invoices/:id/pdf` | Λήψη PDF |

**Όρια ανά πλάνο:**
- Basic: 15 τιμολόγια/μήνα
- Pro: 30 τιμολόγια/μήνα
- Enterprise: Απεριόριστα

**Αν ξεπεραστεί το όριο:** HTTP 403 με `error_code: "INVOICE_LIMIT_REACHED"`

### 3.4 Delivery Notes (`/api/delivery-notes`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/delivery-notes` | Λίστα δελτίων |
| GET | `/delivery-notes/:id` | Ένα δελτίο |
| POST | `/delivery-notes` | Δημιουργία (έλεγχος ορίου) |
| PATCH | `/delivery-notes/:id` | Επεξεργασία |
| DELETE | `/delivery-notes/:id` | Διαγραφή/ακύρωση |

**Όρια ανά πλάνο:**
- Basic: 15 δελτία/μήνα
- Pro: 30 δελτία/μήνα
- Enterprise: Απεριόριστα

**Αν ξεπεραστεί το όριο:** HTTP 403 με `error_code: "DN_LIMIT_REACHED"`

### 3.5 Customers (`/api/customers`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/customers` | Λίστα πελατών |
| GET | `/customers/:id` | Ένας πελάτης |
| POST | `/customers` | Δημιουργία |
| PATCH | `/customers/:id` | Επεξεργασία |
| DELETE | `/customers/:id` | Διαγραφή |
| GET | `/customers/search` | Αναζήτηση |

**Σημείωση:** Η καρτέλα Πελατών εμφανίζεται μόνο αν ο ψαράς την ενεργοποιήσει από Ρυθμίσεις → Λειτουργίες Εφαρμογής.

### 3.6 Products (`/api/products`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/products` | Λίστα προϊόντων (ψάρια) |
| POST | `/products` | Δημιουργία |
| PATCH | `/products/:id` | Επεξεργασία |
| DELETE | `/products/:id` | Διαγραφή |

### 3.7 Subscription (`/api/subscription`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/subscription/status` | Τρέχουσα κατάσταση συνδρομής |
| GET | `/subscription/pricing` | Τιμοκατάλογος (δημόσιο) |
| POST | `/subscription/request` | Αίτημα αλλαγής πλάνου |
| POST | `/subscription/cancel` | Ακύρωση συνδρομής |
| PATCH | `/subscription/autorenew` | Toggle auto-renew |

**Status απάντηση:**
```json
{
  "data": {
    "plan": "basic",
    "billing_cycle": "monthly",
    "trial_active": false,
    "subscription_active": true,
    "subscription_ends_at": "2026-05-18T00:00:00.000Z",
    "has_access": true,
    "monthly_limit": 15,
    "monthly_dn_limit": 15,
    "auto_renew": true,
    "days_until_renewal": 30,
    "trial_days_remaining": null
  }
}
```

### 3.8 Settings (`/api/settings`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/settings/notifications` | Φόρτωση ρυθμίσεων |
| PATCH | `/settings/notifications` | Αποθήκευση ρυθμίσεων |

**Ρυθμίσεις (βασικά πεδία):**
```json
{
  "email_new_invoice": true,
  "email_invoice_due": true,
  "sms_new_invoice": false,
  "feature_customers": 0
}
```

### 3.9 Integrations (`/api/integrations`)

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| POST | `/integrations/email/test` | Δοκιμή email provider |
| POST | `/integrations/sms/test` | Δοκιμή SMS provider |
| POST | `/integrations/provider/test` | Δοκιμή myDATA provider |
| POST | `/integrations/provider/transmit` | Αποστολή τιμολογίου σε myDATA |
| GET | `/integrations/logs` | Ιστορικό integrations |
| GET/POST/DELETE | `/integrations/webhooks` | Webhooks |

### 3.10 Accountant Routes (`/api/accountant`)

Μόνο για χρήστες με role=`accountant`.

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/accountant/businesses` | Λίστα επιχειρήσεων που εξυπηρετεί |
| GET | `/accountant/businesses/:id/invoices` | Τιμολόγια επιχείρησης |
| GET | `/accountant/businesses/:id/stats` | Στατιστικά επιχείρησης |
| GET | `/accountant/businesses/:id/exports` | Εξαγωγή δεδομένων |

**ΣΗΜΑΝΤΙΚΟ:** Ο λογιστής ΠΡΕΠΕΙ να χρησιμοποιεί `/api/accountant/*`. Το `/api/businesses/*` είναι blocked για accountant role.

### 3.11 Platform/Admin Routes (`/api/platform`) — Super Admin Only

| Method | Endpoint | Περιγραφή |
|--------|----------|-----------|
| GET | `/platform/subscriptions` | Λίστα όλων επιχειρήσεων με συνδρομή |
| POST | `/platform/subscriptions/:id/activate` | Ενεργοποίηση συνδρομής |
| POST | `/platform/subscriptions/:id/deactivate` | Απενεργοποίηση |
| POST | `/platform/subscriptions/:id/extend-trial` | Επέκταση trial |
| GET/POST | `/platform/settings` | Ρυθμίσεις πλατφόρμας |
| GET/POST | `/platform/provider` | myDATA provider config |
| GET | `/platform/public-settings` | Δημόσιες ρυθμίσεις (bank info κλπ) |

**Activate body:**
```json
{
  "plan": "basic",
  "billing_cycle": "monthly",
  "months": 1
}
```
→ Αν είναι η πρώτη ενεργοποίηση (`is_first_subscription=1`), το σύστημα αυτόματα προσθέτει +1 μήνα ΔΩΡΕΑΝ.

---

## ΜΕΡΟΣ 4 — ΜΟΝΤΕΛΟ ΣΥΝΔΡΟΜΗΣ

### Τιμοκατάλογος

| Πλάνο | Μηνιαίο | 6μηνο | Ετήσιο |
|-------|---------|-------|--------|
| Basic | €8/μήνα | €35 (-13%) | €60 (-37%) |
| Pro | €15/μήνα | €65 (-13%) | €120 (-33%) |
| Enterprise | €30/μήνα | €130 (-13%) | €240 (-33%) |

### Όρια Χρήσης

| Πλάνο | Τιμολόγια/μήνα | Δελτία/μήνα |
|-------|----------------|-------------|
| Trial | Απεριόριστα | Απεριόριστα |
| Basic | 15 | 15 |
| Pro | 30 | 30 |
| Enterprise | Απεριόριστα | Απεριόριστα |

### Προσφορά Εγγραφής (Νέο)
- **Δεν υπάρχει δωρεάν δοκιμαστική περίοδος.**
- Κατά την πρώτη πληρωμή: +1 μήνας ΔΩΡΕΑΝ αυτόματα.
- Παράδειγμα: Πληρώνεις 1 μήνα Basic (€8) → λαμβάνεις 2 μήνες πρόσβαση.

### Ροή Πληρωμής
1. Ψαράς επιλέγει πλάνο στην εφαρμογή → POST `/subscription/request`
2. Εφαρμογή εμφανίζει οδηγίες τραπεζικής μεταφοράς (IRIS)
3. Ψαράς πληρώνει
4. Super Admin ενεργοποιεί: POST `/platform/subscriptions/:id/activate`
5. Σύστημα υπολογίζει αυτόματα bonus μήνα αν is_first_subscription=1

---

## ΜΕΡΟΣ 5 — ΡΟΛΟΙ ΧΡΗΣΤΩΝ

| Role | Πρόσβαση |
|------|---------|
| `super_admin` | Πλήρης πρόσβαση σε όλα. Admin panel. |
| `owner` | Πλήρης πρόσβαση στη δική του επιχείρηση |
| `employee` | Μόνο τιμολόγια + δελτία (δεν βλέπει financials) |
| `accountant` | Read-only σε τιμολόγια + στατιστικά μέσω `/api/accountant/*` |

---

## ΜΕΡΟΣ 6 — WEB ΕΦΑΡΜΟΓΗ (FISHERMAN)

### Σελίδες
| Αρχείο | Λειτουργία |
|--------|-----------|
| `index.html` | Login / Register |
| `dashboard.html` | Κεντρικός πίνακας, στατιστικά, progress bars πλάνου |
| `invoices.html` | Λίστα + δημιουργία τιμολογίων |
| `invoice-create.html` | Αναλυτική φόρμα δημιουργίας τιμολογίου |
| `delivery-notes.html` | Λίστα + δημιουργία δελτίων αποστολής |
| `delivery-note-print.html` | Preview/εκτύπωση δελτίου |
| `customers.html` | Διαχείριση πελατών (κρυμμένη αν δεν ενεργοποιηθεί) |
| `settings.html` | Ρυθμίσεις, integrations, features |
| `profile.html` | Προφίλ χρήστη |
| `subscription.html` | Επιλογή/αλλαγή πλάνου |
| `privacy.html` | Πολιτική απορρήτου (GDPR) |
| `recovery-login.html` | Emergency recovery login |
| `setup-guide.html` | Οδηγός αρχικής ρύθμισης |

### Βασικά JS αρχεία
| Αρχείο | Σκοπός |
|--------|--------|
| `js/core.js` | Auth guards, API wrapper, nav helpers, feature toggles |
| `js/api.js` | HTTP client (axios-like) με auto token refresh |
| `js/toast.js` | Ειδοποιήσεις UI |

### Feature Toggle Πελατών
- Αποθηκεύεται στο `localStorage` ως `fb_feat_customers`
- Sync με backend: `business_settings.feature_customers`
- Ελέγχεται σε κάθε σελίδα με `initCustomersNav()`
- Ενεργοποιείται από Ρυθμίσεις → Λειτουργίες Εφαρμογής

---

## ΜΕΡΟΣ 7 — WEB ΕΦΑΡΜΟΓΗ (ADMIN PANEL)

### Σελίδες Admin
| Αρχείο | Λειτουργία |
|--------|-----------|
| `index.html` | Login super_admin |
| `dashboard.html` | Στατιστικά πλατφόρμας |
| `businesses.html` | Λίστα όλων επιχειρήσεων |
| `subscriptions.html` | Διαχείριση συνδρομών, ενεργοποίηση |
| `users.html` | Διαχείριση χρηστών |
| `invoices.html` | Προβολή τιμολογίων όλων |
| `economics.html` | Οικονομικά αναφορές |
| `integrations.html` | Email/SMS/myDATA ρυθμίσεις |
| `platform.html` | Ρυθμίσεις πλατφόρμας, bank details |
| `configure.html` | Mass config, σύλλογοι |
| `logs.html` | Audit logs |
| `reports.html` | Αναφορές |
| `accountant.html` | Λογιστές |
| `backups.html` | Backups βάσης |
| `emails.html` | Email templates/logs |
| `exports.html` | Εξαγωγή δεδομένων |

---

## ΜΕΡΟΣ 8 — ANDROID ΕΦΑΡΜΟΓΗ

### Δομή Package: `com.master.fishbillapp`

```
data/
  model/           -- Data classes (Invoice, Customer, DashboardStats κλπ)
  network/         -- ApiService (Retrofit interface)
  repository/      -- Repository classes
ui/
  main/
    dashboard/     -- DashboardScreen + ViewModel
    invoices/      -- InvoicesScreen + ViewModel
    delivery/      -- DeliveryNotesScreen + ViewModel
    customers/     -- CustomersScreen + ViewModel
    settings/      -- SettingsScreen + ViewModel
    subscription/  -- SubscriptionScreen + ViewModel
    profile/       -- ProfileScreen
  auth/            -- LoginScreen, RegisterScreen
utils/
  TokenManager     -- DataStore για JWT tokens
  Resource         -- Sealed class: Loading/Success/Error
```

### Navigation
- Bottom Navigation Bar με tabs: Dashboard, Invoices, Delivery Notes, (Customers), Profile
- Customers tab κρυμμένο αν `feature_customers = 0` στις ρυθμίσεις
- Tabs δυναμικά: `activeTabs = if(customersEnabled) ALL_TABS else ALL_TABS.filter { it !is Customers }`

### State Management
- `ViewModel` + `StateFlow` + `collectAsState()` σε κάθε Screen
- `TokenManager` (DataStore) για persistent auth state
- `Resource<T>` sealed class: `Loading | Success(data) | Error(message)`

### Βασικά Models
```kotlin
data class Invoice(val id: String, val number: String, val customer_name: String,
                   val total_amount: Double, val issue_date: String, val status: String)

data class DashboardStats(val totalInvoices: Int, val monthlyInvoices: Int,
                          val totalRevenue: Double, val monthlyDeliveryNotes: Int)

data class SubscriptionStatus(val plan: String, val billing_cycle: String,
                               val trial_active: Boolean, val subscription_active: Boolean,
                               val monthly_limit: Int, val monthly_dn_limit: Int,
                               val trial_days_remaining: Int?)
```

### Push Notifications
- Firebase FCM
- Tokens αποθηκεύονται στον `fcm_tokens` πίνακα
- Στέλνει ειδοποίηση σε νέο τιμολόγιο/δελτίο

---

## ΜΕΡΟΣ 9 — INTEGRATIONS

### Email Providers (επιλέγεται ένας)
| Provider | API Key Setting |
|----------|----------------|
| Brevo (SendinBlue) | `brevo_api_key` |
| SendGrid | `sendgrid_api_key` |
| Mailgun | `mailgun_api_key` + `mailgun_domain` |
| SMTP | `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass` |

### SMS Providers (επιλέγεται ένας)
| Provider | Χώρα/Χρήση |
|----------|-----------|
| Apifon | Ελλάδα |
| Routee | Ελλάδα |
| BSMS | Ελλάδα |
| Yuboto | Ελλάδα |
| Infobip | Διεθνές |
| Vonage | Διεθνές |
| Twilio | Διεθνές |

### myDATA Providers (ΑΑΔΕ)
| Provider | Σημειώσεις |
|----------|-----------|
| SoftOne | Εμπορικό ERP |
| EpsilonNet | Ελληνικό λογισμικό |
| UniDoc | Cloud λύση |
| Entersoft | ERP |
| Direct ΑΑΔΕ | Απευθείας στο API της ΑΑΔΕ |

**ΣΗΜΑΝΤΙΚΟ:** Η σύνδεση με myDATA είναι η πιο κρίσιμη pending δουλειά (βλ. Μέρος 11).

---

## ΜΕΡΟΣ 10 — ΑΣΦΑΛΕΙΑ

### Authentication
- JWT Access Token: λήγει σε 7 ημέρες
- JWT Refresh Token: λήγει σε 30 ημέρες
- Bcrypt για passwords (12 rounds)
- Email verification κατά την εγγραφή

### Έλεγχοι Πρόσβασης
- Middleware `authenticate`: κάθε request
- Middleware `requireSuperAdmin`: admin-only routes
- Role-based: owner/employee/accountant/super_admin
- Business isolation: κάθε user βλέπει μόνο δικά του δεδομένα

### OTP για Ακύρωση Τιμολογίου
- Αποστολή OTP στο email του owner
- Ισχύει 10 λεπτά
- Αποτρέπει τυχαία/злοχαρακτηριστική ακύρωση

### Audit Logs
- Κάθε login (επιτυχής/αποτυχημένος)
- Αλλαγές κρίσιμων δεδομένων
- IP address καταγραφή

### GDPR
- `privacy.html` με πλήρη πολιτική
- Δυνατότητα διαγραφής λογαριασμού (`DELETE /auth/me`)
- Δεν αποθηκεύονται passwords σε plaintext

---

## ΜΕΡΟΣ 11 — ΤΙ ΑΠΟΜΕΝΕΙ (PENDING ΕΡΓΑΣΙΕΣ)

### 🔴 Κρίσιμα (απαιτούνται πριν από production scale-up)

#### 1. myDATA Integration — Σύνδεση με ΑΑΔΕ
**Τι είναι:** Η νόμιμη υποχρέωση ηλεκτρονικής διαβίβασης τιμολογίων στη γενική γραμματεία δημοσίων εσόδων.
**Τι υπάρχει τώρα:** Το `/api/integrations/provider/transmit` endpoint υπάρχει αλλά δεν κάνει πραγματική αποστολή — στέλνει mock response.
**Τι χρειάζεται:**
- Εγγραφή στο myDATA API της ΑΑΔΕ (production credentials)
- Ενεργοποίηση `direct_aade` mode στο integrations ή σύνδεση με εμπορικό provider (π.χ. EpsilonNet)
- Test environment: `mydata.aade.gr` sandbox
- Κάθε τιμολόγιο πρέπει να λαμβάνει ΜΑΡΚ (Μοναδικός Αριθμός Καταχώρισης)
- Αποθήκευση ΜΑΡΚ στη βάση (migration χρειάζεται)

#### 2. Πάροχοι SMS — Επιλογή και activation
**Τι χρειάζεται:**
- Επιλογή provider (προτείνεται Apifon ή Routee για Ελλάδα)
- Απόκτηση API key
- Ρύθμιση στο Admin Panel → Integrations → SMS
- Test αποστολής με το `/integrations/sms/test`

#### 3. Email Provider — Ρύθμιση production
**Τι χρειάζεται:**
- Επιλογή provider (προτείνεται Brevo — δωρεάν 300 emails/ημέρα)
- Απόκτηση API key
- Ρύθμιση domain authentication (SPF, DKIM)
- Ρύθμιση στο Admin Panel → Integrations → Email

#### 4. IRIS/Τραπεζικά στοιχεία — Ρύθμιση
**Τι χρειάζεται:**
- Εισαγωγή IBAN/λογαριασμού στο Admin Panel → Platform → Bank Settings
- Τα στοιχεία εμφανίζονται αυτόματα στις οδηγίες πληρωμής

### 🟡 Σημαντικά (πριν από marketing push)

#### 5. Android App — Πλήρης Testing
**Pending test scenarios:**
- [ ] Register → επιβεβαίωση email → login flow
- [ ] Dashboard με active subscription (limits progress bars)
- [ ] Δημιουργία τιμολογίου → PDF preview
- [ ] Δελτίο αποστολής → limit check
- [ ] Billing cycle toggle (Monthly/6m/Annual) → όλα τα plans ανανεώνουν τιμή
- [ ] Settings → feature_customers toggle → tabs ανανεώνονται
- [ ] Subscription screen → promo banner για νέους χρήστες
- [ ] Push notifications (FCM) δοκιμή σε πραγματική συσκευή
- [ ] Dark mode compatibility
- [ ] Offline graceful handling

#### 6. Συμβόλαια/Contracts (ΔΕΝ υπάρχουν ακόμα)
**Τι λείπει:**
- Δεν υπάρχει module για contracts/συμβόλαια στο σύστημα
- Αν χρειάζεσαι: νέος πίνακας `contracts`, νέα route `/api/contracts`, νέα σελίδα `contracts.html`
- Τι θα αποθηκεύει: αντισυμβαλλόμενος, αντικείμενο, ημερομηνία, ποσό, PDF attachment

#### 7. Production Server
**Τι χρειάζεται:**
- Domain name + SSL certificate (Let's Encrypt)
- Nginx reverse proxy → port 4000
- PM2 για Node.js process management
- MySQL backup cron job
- Firewall κανόνες (μόνο 80/443 ανοιχτά)
- Environment variables σε production `.env`

#### 8. Google Play Store — Δημοσίευση Android App
**Βήματα:**
- Google Play Developer Account ($25 εφάπαξ)
- Release APK/AAB (signed keystore)
- Screenshots + περιγραφή + icon 512x512
- Privacy policy URL → χρησιμοποίησε `privacy.html`
- Δήλωση χρήσης permissions (camera, storage, internet)

### 🟢 Nice-to-have (μελλοντικά)

#### 9. Αποθήκευση PDF στο Cloud
Αυτή τη στιγμή τα PDF δημιουργούνται on-the-fly. Μπορούν να αποθηκεύονται στο S3/R2 για ιστορικό.

#### 10. Αυτόματες πληρωμές (Stripe/Viva Wallet)
Αντί για χειροκίνητη ενεργοποίηση, integration με payment gateway.

#### 11. Πολλαπλές Γλώσσες (i18n)
Τώρα μόνο Ελληνικά. Αγγλικά για μέλλον.

#### 12. Reporting/Εξαγωγή Excel
Εξαγωγή τιμολογίων/στατιστικών σε Excel για λογιστή.

---

## ΜΕΡΟΣ 12 — ΕΚΚΙΝΗΣΗ ΕΦΑΡΜΟΓΗΣ

### Localhost Development
```bash
# 1. Εκκίνηση XAMPP (Apache + MySQL)
# 2. Εκκίνηση API
cd E:\xaamp\htdocs\fishbill\fishbill-api
npm run dev          # nodemon — auto restart σε αλλαγές

# 3. Web app
# http://localhost/fishbill/app
# http://localhost/fishbill/admin

# 4. Android: Run σε emulator ή συσκευή από Android Studio
# API base URL: http://10.0.2.2:4000/api (emulator) ή http://192.168.x.x:4000/api (συσκευή)
```

### Environment Variables (`.env`)
```env
PORT=4000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=fishbill
DB_USER=root
DB_PASSWORD=
JWT_SECRET=your-very-long-random-secret
JWT_REFRESH_SECRET=another-very-long-random-secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
APP_BASE_URL=http://localhost/fishbill
```

### Χρήσιμες Εντολές
```bash
# Εκκίνηση API
npm run dev

# Manual restart nodemon
rs

# Test endpoint
curl http://localhost:4000/api/health

# Τρέξε migration
node -e "require('./run_migration')('018_feature_customers.sql')"
```

---

## ΜΕΡΟΣ 13 — ΣΥΧΝΑ ΠΡΟΒΛΗΜΑΤΑ & ΛΥΣΕΙΣ

| Πρόβλημα | Αιτία | Λύση |
|----------|-------|------|
| `EADDRINUSE port 4000` | Παλιά διεργασία | `npm run dev` ξανά ή `rs` |
| MySQL CLI auth error | `caching_sha2_password` plugin | Τρέξε migrations μέσω Node.js, όχι CLI |
| `ALTER TABLE IF NOT EXISTS` error | MySQL version δεν το υποστηρίζει | Χρησιμοποίησε INFORMATION_SCHEMA check |
| "Failed to fetch" στο browser | API δεν τρέχει | Εκκίνησε `npm run dev` |
| Android token refresh loop | Expired refresh token | Logout + re-login |
| Billing toggle δεν αλλάζει Pro/Enterprise | TypeError σε null `btn-label` span | Διορθώθηκε με null-check |

---

*Τεκμηρίωση FishBill v1.0 — Απρίλιος 2026*
