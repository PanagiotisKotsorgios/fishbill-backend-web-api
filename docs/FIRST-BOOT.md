# FishBill — First Boot Setup

After deploying the server and confirming `GET /health` returns `{"status":"ok"}`, complete these steps in the Admin Panel before going live.

**Admin Panel URL:** `https://your-domain.com/admin/`  
**Default credentials:** `admin@fishbill.gr` / `Admin@123`

---

## Checklist

### 1 — Change the Admin Password

Admin Panel → top-right user menu → **Profile** → change password.  
The default password is publicly known — change it immediately.

---

### 2 — Configure Platform Settings

Admin Panel → **Platform** → **Settings**

| Setting | What to enter |
|---------|--------------|
| App base URL | `https://your-domain.com` |
| Web base URL | `https://your-domain.com` |
| Admin email | Your real email |
| Support phone | Your support number |

---

### 3 — Configure Email (Brevo)

FishBill sends transactional emails (registration, invoices, subscription reminders) via [Brevo](https://www.brevo.com/) (free up to 300 emails/day).

1. Create a free Brevo account
2. Go to **Account → SMTP & API** → create an API key
3. In Admin Panel → **Platform** → **Settings** → Email section:
   - Brevo API key
   - Sender name (e.g. `FishBill`)
   - Sender email (must be verified in Brevo)
4. Click **Send Test Email** to verify

---

### 4 — Configure Payment Settings

Admin Panel → **Platform** → **Settings** → Payment section:

Set up the bank account details or IRIS payment link that appear on subscription invoices sent to customers:
- Bank name, IBAN, account holder
- IRIS payment link (if using IRIS)
- Payment instructions text

---

### 5 — Configure MyData / AADE Integration

Admin Panel → **Platform** → **Provider**

FishBill supports direct AADE myDATA transmission. Choose your provider:
- **Direct AADE** — uses each business's own myDATA credentials
- **e-Τιμολόγηση** — third-party provider (requires API key)

Enter the API endpoints and credentials for whichever provider you use.

---

### 6 — Set App Version (for Android auto-updates)

Admin Panel → **Platform** → **Settings** → App Version section:

| Setting | Value |
|---------|-------|
| Latest version code | `10` (or current) |
| APK download URL | `https://github.com/PanagiotisKotsorgios/fishbill-android-app/releases/download/v10/fishbill-v10.apk` |

This controls the in-app update popup on Android devices.

---

### 7 — Configure GSIS / AFM Lookup

Admin Panel → **Platform** → **Settings** → GSIS section:

Enter your TAXISnet credentials. These are used to auto-fill business information when a new business registers using their AFM.

---

### 8 — Create the First Business Account

Admin Panel → **Businesses** → **New Business**

Or let businesses register themselves at `https://your-domain.com/app/` → Register.

After registration, go to **Businesses** → find the business → **Activate Subscription** to give them access.

---

### 9 — Configure Firebase Push Notifications (Optional)

Push notifications (subscription reminders, admin alerts) require Firebase Cloud Messaging.

1. Create a [Firebase project](https://console.firebase.google.com/)
2. Download the **service account JSON** from Firebase → Project Settings → Service Accounts
3. Admin Panel → **Platform** → **Settings** → Firebase section → paste the JSON

---

### 10 — Test Everything

Run through this checklist:

```
[ ] /health returns {"status":"ok"}
[ ] /admin/ loads and you can log in
[ ] /app/ loads (user registration page)
[ ] Create a test business and log in as owner
[ ] Create and issue a test invoice
[ ] Download the invoice PDF
[ ] Admin panel → Businesses shows the test business
[ ] Email arrives after registration (if Brevo is configured)
[ ] Android app connects and logs in
[ ] Android app update check works (no false update popup)
```

---

## Quick Database Checks

```bash
# Confirm admin user exists
mysql -u fishbill_user -p -e "SELECT email, role FROM users WHERE role='super_admin';" fishbill_db

# Confirm platform_settings are populated
mysql -u fishbill_user -p -e "SELECT setting_key, setting_value FROM platform_settings;" fishbill_db
```
