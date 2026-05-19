# Αίτημα Προσφοράς Hosting / VPS — Εμπιστευτικό

> Χρησιμοποιήστε αυτό το email ως βάση και αποστείλτε το σε κάθε πάροχο ξεχωριστά.
> Αντικαταστήστε τα `[BRACKETS]` με τα στοιχεία σας πριν αποστείλετε.

---

## Παροχοί στόχοι (ελέγξτε/προσαρμόστε)

| Πάροχος | Email / Φόρμα |
|---|---|
| **Epsilonet** | info@epsilonet.gr / sales@epsilonet.gr |
| **Papaki** | support@papaki.gr |
| **TopHost** | info@tophost.gr |
| **Arvanitus** | sales@arvanitus.gr |
| **HosterPro** | info@hosterpro.gr |
| **Contabo** | support@contabo.com |
| **DigitalOcean** | sales@digitalocean.com |

---

## Email Template (Ελληνικά)

**Θέμα:** Αίτημα Προσφοράς — VPS / Managed Hosting για Web Application

---

Καλημέρα,

Αναζητούμε πάροχο hosting για ένα web application που βρίσκεται σε φάση παραγωγικής λειτουργίας. Παρακαλούμε όπως μας αποστείλετε προσφορά βάσει των παρακάτω τεχνικών απαιτήσεων.

**Απαιτήσεις υποδομής:**

| Παράμετρος | Ελάχιστο | Προτιμώμενο |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Αποθηκευτικός χώρος (SSD) | 50 GB | 100 GB SSD NVMe |
| Bandwidth | Απεριόριστο / 2 TB | Απεριόριστο |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Uptime SLA | ≥ 99.5% | ≥ 99.9% |

**Stack εφαρμογής:**
- Node.js (LTS) — backend web server
- MySQL 8.x — relational database
- Nginx — reverse proxy / static file serving
- SSL/TLS — απαιτείται (Let's Encrypt ή αντίστοιχο)

**Πρόσθετες απαιτήσεις:**
- Root access ή sudo στο VPS
- IPv4 dedicated (static IP)
- Firewall (iptables / ufw) διαχείριση
- Daily automated backups (τουλάχιστον 7ήμερο retention)
- Monitoring / alerting (uptime, CPU, RAM, disk)
- Τεχνική υποστήριξη (email ή ticketing) — ανταπόκριση εντός 24ω

**Επιθυμητά (προαιρετικά):**
- Εγκατάσταση σε ελληνικό datacenter (για λόγους latency και GDPR)
- Managed MySQL (ή managed DB service)
- DDoS protection
- Δυνατότητα horizontal scaling (προσθήκη nodes)
- Παροχή εικόνας (snapshot) για disaster recovery

**Ερωτήσεις που χρειαζόμαστε απαντήσεις:**

1. Τιμή μηνιαία / ετήσια (με/χωρίς ΦΠΑ);
2. Υπάρχει SLA για uptime και ποιο είναι το compensation policy σε περίπτωση downtime;
3. Πού βρίσκεται το datacenter (χώρα / πόλη);
4. Υπάρχει δυνατότητα upgrade/downgrade πλάνου χωρίς data loss;
5. Τι περιλαμβάνει το backup service (πόσα snapshots, πόσα ημέρες retention, manual restore);
6. Ποια είναι η διαδικασία και ο χρόνος για initial provisioning;
7. Δέχεστε πληρωμή με χρεωστική/πιστωτική κάρτα ή/και τραπεζικό έμβασμα;
8. Παρέχετε dedicated IP ή shared;
9. Υπάρχει ελεύθερη δοκιμαστική περίοδος (trial);

Παρακαλούμε αποστείλετε την προσφορά σας στο **[EMAIL ΣΑΣ]** έως **[ΗΜΕΡΟΜΗΝΙΑ]**.

Με εκτίμηση,  
**[ΟΝΟΜΑ ΣΑΣ]**  
[ΤΙΤΛΟΣ]  
[ΤΗΛΕΦΩΝΟ]  
[EMAIL]

---

## Email Template (English — για διεθνείς παρόχους)

**Subject:** Hosting Quote Request — VPS for Production Node.js + MySQL Application

---

Hello,

We are looking for a hosting provider for a production web application. Please provide a quote based on the technical requirements below.

**Infrastructure Requirements:**

| Parameter | Minimum | Preferred |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Storage | 50 GB SSD | 100 GB NVMe SSD |
| Bandwidth | Unmetered / 2 TB | Unmetered |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Uptime SLA | ≥ 99.5% | ≥ 99.9% |

**Technology Stack:**
- Node.js (LTS) — application server
- MySQL 8.x — relational database
- Nginx — reverse proxy
- SSL/TLS required

**Additional Requirements:**
- Root / sudo access
- Dedicated static IPv4
- Firewall management (iptables / ufw)
- Daily automated backups with at least 7-day retention
- Basic monitoring/alerting (uptime, CPU, RAM, disk)
- Technical support via email or ticketing (max 24h response)

**Nice to Have:**
- Datacenter location in Greece or EU (for GDPR compliance and low latency)
- Managed MySQL / database service
- DDoS protection
- Horizontal scaling capability
- Snapshot/image for disaster recovery

**Questions:**

1. Monthly and annual pricing (with/without VAT)?
2. What is your SLA and compensation policy for downtime?
3. Where is your datacenter located (country/city)?
4. Can I upgrade/downgrade the plan without data loss?
5. What does the backup service include (how many snapshots, retention days, manual restore option)?
6. What is the provisioning time after purchase?
7. Accepted payment methods (credit card, bank transfer, PayPal)?
8. Dedicated or shared IP?
9. Is there a free trial period?

Please send your quote to **[YOUR EMAIL]** by **[DATE]**.

Kind regards,  
**[YOUR NAME]**  
[TITLE]  
[PHONE]  
[EMAIL]

---

## Σημειώσεις για Σύγκριση Προσφορών

Δημιουργήστε έναν πίνακα σύγκρισης όταν λάβετε τις προσφορές:

| Πάροχος | Τιμή/μήνα | CPU | RAM | SSD | DC Location | Backup | SLA | Support |
|---|---|---|---|---|---|---|---|---|
| Epsilonet | | | | | | | | |
| Papaki | | | | | | | | |
| Arvanitus | | | | | | | | |
| Contabo | | | | | | | | |
| DigitalOcean | | | | | | | | |

**Προτεραιότητες επιλογής (σε σειρά σπουδαιότητας):**
1. Uptime SLA ≥ 99.9%
2. Datacenter στην Ελλάδα ή Κεντρική Ευρώπη (GDPR + latency)
3. Τιμή / αξία
4. Ποιότητα τεχνικής υποστήριξης
5. Backup πολιτική
6. Δυνατότητα scaling
