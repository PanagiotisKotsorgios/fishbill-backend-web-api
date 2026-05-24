'use strict';

const axios = require('axios');
const pool  = require('../config/database');

const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Load config from DB ─────────────────────────────────────────────────────

const SETTING_KEYS = [
  'platform_email_from',
  'platform_email_from_name',
  'platform_brevo_key',
  'platform_name',
  'admin_notification_email',
  'web_base_url',
];

async function loadConfig() {
  try {
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${SETTING_KEYS.map(() => '?').join(',')})`,
      SETTING_KEYS
    );
    const cfg = {};
    rows.forEach(r => { cfg[r.setting_key] = r.setting_value; });
    return cfg;
  } catch {
    return {};
  }
}

function normalizeBaseUrl(url) {
  return (url || '').trim().replace(/\/$/, '');
}

function getWebBaseUrl(cfg = {}) {
  return normalizeBaseUrl(cfg.web_base_url || APP_BASE_URL);
}

function buildWebUrl(path, cfg = {}) {
  return `${getWebBaseUrl(cfg)}${path.startsWith('/') ? path : '/' + path}`;
}

function buildMobileResetUrl(resetToken, isAccountant) {
  const params = new URLSearchParams({ token: resetToken });
  if (isAccountant) params.set('type', 'accountant');
  return `fishbill://reset-password?${params.toString()}`;
}

// ─── Core send ───────────────────────────────────────────────────────────────

async function sendEmail({ to, toName, subject, html, text, attachments, _type }) {
  const cfg       = await loadConfig();
  const apiKey    = cfg.platform_brevo_key;
  const fromEmail = cfg.platform_email_from || 'noreply@fishbill.gr';
  const fromName  = cfg.platform_email_from_name || cfg.platform_name || 'FishBill';

  if (!apiKey) throw new Error('Brevo API key δεν έχει ρυθμιστεί. Μεταβείτε στις Ρυθμίσεις → Email Platform.');

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to:     [{ email: to, name: toName || to }],
    subject,
    htmlContent: html,
  };
  if (text) payload.textContent = text;
  if (attachments && attachments.length) {
    payload.attachment = attachments.slice(0, 5).map(a => ({ content: a.content, name: a.name }));
  }

  await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
    headers: {
      'api-key':      apiKey,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    timeout: 15000,
  });

  if (!_type) trackEmailSent('system');
}

// ─── Platform email toggles & stats ──────────────────────────────────────────

async function isPlatformEmailEnabled(type) {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1',
      [`platform_email_type_${type}`]
    );
    if (!rows.length) return true;
    return rows[0].setting_value !== '0';
  } catch {
    return true;
  }
}

async function trackEmailSent(type) {
  const month = new Date().toISOString().slice(0, 7);
  const keys = [
    'email_stat_total',
    `email_stat_month_${month}`,
    ...(type ? [`email_stat_type_${type}`] : []),
  ];
  for (const key of keys) {
    pool.execute(
      `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, '1')
       ON DUPLICATE KEY UPDATE setting_value = CAST(CAST(IFNULL(setting_value,'0') AS UNSIGNED) + 1 AS CHAR)`,
      [key]
    ).catch(() => {});
  }
}

// ─── Template helpers ────────────────────────────────────────────────────────

function baseTemplate(title, contentHtml) {
  return `<!DOCTYPE html>
<html lang="el">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f0f7f9;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f9;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(11,114,133,.12)">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#0A5568,#0B7285);padding:28px 32px;text-align:center">
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:1.5px;margin-bottom:2px">🐟 FishBill</div>
          <div style="font-size:13px;color:rgba(255,255,255,.75)">Ηλεκτρονική Τιμολόγηση Αλιείας</div>
        </td></tr></table>
      </td></tr>

      <!-- Content -->
      <tr><td style="padding:32px">
        ${contentHtml}
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f5fbfc;padding:20px 32px;text-align:center;border-top:1px solid #d5edf2">
        <p style="margin:0;font-size:12px;color:#8aacb4">
          &copy; 2026 FishBill · Ηλεκτρονική Τιμολόγηση myDATA για Αλιείς<br/>
          Αν δεν ζητήσατε αυτό το email, αγνοήστε το.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Specific email senders ───────────────────────────────────────────────────

async function sendPasswordResetEmail({ to, toName, resetToken, baseUrl, isAccountant }) {
  const cfg = await loadConfig();
  const webBaseUrl = normalizeBaseUrl(baseUrl) || getWebBaseUrl(cfg);
  const webResetUrl = `${webBaseUrl}/reset-password.html?token=${encodeURIComponent(resetToken)}${isAccountant ? '&type=accountant' : ''}`;
  const resetUrl = buildMobileResetUrl(resetToken, isAccountant);
  const html = baseTemplate('Επαναφορά Κωδικού FishBill', `
    <h1 style="font-size:22px;font-weight:800;color:#0A5568;margin:0 0 12px">Επαναφορά Κωδικού</h1>
    <p style="font-size:15px;color:#3a5560;margin:0 0 20px;line-height:1.65">
      Γεια σας${toName ? ' <strong>' + toName + '</strong>' : ''},<br/><br/>
      Λάβαμε αίτημα για επαναφορά του κωδικού πρόσβασής σας στο <strong>FishBill</strong>.
      Πατήστε το παρακάτω κουμπί για να ορίσετε νέο κωδικό:
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${resetUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#0A5568,#0B7285);color:#fff;
                text-decoration:none;border-radius:12px;padding:16px 36px;
                font-size:17px;font-weight:700;letter-spacing:.5px">
        Επαναφορά Κωδικού →
      </a>
    </div>
    <div style="background:#f5fbfc;border:1px solid #ceeaee;border-radius:10px;padding:14px 16px;margin-bottom:20px">
      <p style="margin:0;font-size:13px;color:#4a6572">
        <strong>⏱ Ο σύνδεσμος λήγει σε 1 ώρα.</strong><br/>
        Αν δεν μπορείτε να κάνετε κλικ, αντιγράψτε και επικολλήστε αυτή τη διεύθυνση στον browser:<br/>
        <span style="font-size:11px;color:#0B7285;word-break:break-all">${webResetUrl}</span>
      </p>
    </div>
    <p style="font-size:13px;color:#8aacb4;margin:0">
      Αν <strong>δεν</strong> ζητήσατε επαναφορά κωδικού, αγνοήστε αυτό το email. Ο λογαριασμός σας παραμένει ασφαλής.
    </p>
  `);

  await sendEmail({
    to, toName,
    subject: 'Επαναφορά Κωδικού FishBill',
    html,
    text: `Επαναφορά κωδικού FishBill\n\nΣύνδεσμος: ${resetUrl}\n\nΟ σύνδεσμος λήγει σε 1 ώρα.`,
  });
}

async function sendWelcomeEmail({ to, toName, businessName, baseUrl }) {
  const cfg = await loadConfig();
  const loginUrl   = `${normalizeBaseUrl(baseUrl) || getWebBaseUrl(cfg)}/app/`;
  const supportEmail = cfg.platform_email_from || process.env.ADMIN_EMAIL || 'support@fishbill.gr';
  const html = baseTemplate('Καλώς ήρθατε στο FishBill!', `
    <h1 style="font-size:22px;font-weight:800;color:#0A5568;margin:0 0 12px">Καλώς ήρθατε στο FishBill! 🐟</h1>
    <p style="font-size:15px;color:#3a5560;margin:0 0 16px;line-height:1.65">
      Γεια σας <strong>${escHtml(toName || to)}</strong>,<br/><br/>
      Ο λογαριασμός σας για την επιχείρηση <strong>${escHtml(businessName || '')}</strong> δημιουργήθηκε επιτυχώς.
      Επιλέξτε το πλάνο που σας ταιριάζει και ξεκινήστε να εκδίδετε παραστατικά άμεσα.
      Με την πρώτη σας πληρωμή <strong>κερδίζετε 1 επιπλέον μήνα δωρεάν</strong>!
    </p>
    <div style="text-align:center;margin:24px 0">
      <a href="${loginUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#0A5568,#0B7285);color:#fff;
                text-decoration:none;border-radius:12px;padding:14px 32px;font-size:16px;font-weight:700">
        Σύνδεση στο FishBill →
      </a>
    </div>
    <p style="font-size:13px;color:#8aacb4;margin:0">
      Για βοήθεια επικοινωνήστε μαζί μας στο ${escHtml(supportEmail)}
    </p>
  `);

  await sendEmail({ to, toName, subject: 'Καλώς ήρθατε στο FishBill!', html });
}

async function sendVerificationRequestToAdmin({ adminEmail, accountant, details, attachments }) {
  const cfg = await loadConfig();
  const html = baseTemplate('Νέο Αίτημα Επαλήθευσης Λογιστή', `
    <h1 style="font-size:20px;font-weight:800;color:#0A5568;margin:0 0 12px">Αίτημα Επαλήθευσης Λογιστή</h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">Υποβλήθηκε νέο αίτημα επαλήθευσης:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
      ${Object.entries({
        'Ονοματεπώνυμο': accountant.full_name,
        'Email': accountant.email,
        'Τηλέφωνο': details.phone || '—',
        'ΑΦΜ Λογιστή': details.tax_id || '—',
        'Άδεια Λογιστή': details.license_number || '—',
        'Επωνυμία Γραφείου': details.office_name || '—',
      }).map(([label, val]) => `
        <tr>
          <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572;width:40%">${label}</td>
          <td style="padding:8px 12px;border:1px solid #d5edf2;color:#1a2e35">${val || '—'}</td>
        </tr>`).join('')}
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${buildWebUrl('/admin/users.html', cfg)}"
         style="display:inline-block;background:#0A5568;color:#fff;text-decoration:none;
                border-radius:10px;padding:12px 28px;font-size:14px;font-weight:700">
        Διαχείριση στο Admin Panel →
      </a>
    </div>
  `);

  await sendEmail({
    to: adminEmail,
    subject: `[FishBill] Αίτημα Επαλήθευσης: ${accountant.full_name}`,
    html,
    attachments,
  });
}

async function sendTestEmail({ to }) {
  const html = baseTemplate('Δοκιμαστικό Email FishBill', `
    <h1 style="font-size:20px;font-weight:800;color:#0A5568;margin:0 0 12px">✓ Η αποστολή email λειτουργεί!</h1>
    <p style="font-size:14px;color:#3a5560;line-height:1.65">
      Αυτό είναι ένα δοκιμαστικό email από το FishBill μέσω Brevo API. Εάν το λάβατε, οι ρυθμίσεις email είναι σωστές.
    </p>
    <p style="font-size:12px;color:#8aacb4;margin-top:16px">Αποστάλθηκε: ${new Date().toLocaleString('el-GR')}</p>
  `);

  await sendEmail({ to, subject: '[FishBill] Δοκιμαστικό Email ✓', html });
}

async function sendAdminActionEmail({ action, subject, bodyHtml, adminEmail }) {
  const cfg = await loadConfig();
  const to = adminEmail || cfg.admin_notification_email || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';
  const html = baseTemplate(subject, bodyHtml);
  await sendEmail({ to, subject: `[FishBill] ${subject}`, html });
}

async function sendNewBusinessRegistrationToAdmin({ adminEmail, ownerName, ownerEmail, businessName, businessAfm, city }) {
  const cfg = await loadConfig();
  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:800;color:#0A5568;margin:0 0 12px">🐟 Νέα Εγγραφή Επιχείρησης</h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">Υποβλήθηκε νέα εγγραφή επιχείρησης/αλιέα:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
      ${Object.entries({
        'Επωνυμία': businessName,
        'ΑΦΜ': businessAfm || '—',
        'Πόλη': city || '—',
        'Ιδιοκτήτης': ownerName,
        'Email Ιδιοκτήτη': ownerEmail,
      }).map(([label, val]) => `
        <tr>
          <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572;width:40%">${label}</td>
          <td style="padding:8px 12px;border:1px solid #d5edf2;color:#1a2e35">${val}</td>
        </tr>`).join('')}
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${buildWebUrl('/admin/businesses.html', cfg)}"
         style="display:inline-block;background:#0A5568;color:#fff;text-decoration:none;
                border-radius:10px;padding:12px 28px;font-size:14px;font-weight:700">
        Διαχείριση Επιχειρήσεων →
      </a>
    </div>`;
  await sendAdminActionEmail({ adminEmail, subject: `Νέα Εγγραφή Επιχείρησης: ${businessName}`, bodyHtml });
}

async function sendNewAccountantRegistrationToAdmin({ adminEmail, accountantName, accountantEmail, accountantAfm, phone }) {
  const cfg = await loadConfig();
  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:800;color:#0A5568;margin:0 0 12px">👤 Νέα Εγγραφή Λογιστή</h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">Νέος λογιστής εγγράφηκε στην πλατφόρμα:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
      ${Object.entries({
        'Ονοματεπώνυμο': accountantName,
        'Email': accountantEmail,
        'ΑΦΜ': accountantAfm || '—',
        'Τηλέφωνο': phone || '—',
      }).map(([label, val]) => `
        <tr>
          <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572;width:40%">${label}</td>
          <td style="padding:8px 12px;border:1px solid #d5edf2;color:#1a2e35">${val}</td>
        </tr>`).join('')}
    </table>
    <p style="font-size:13px;color:#6b7280;margin:16px 0 0">Αναμένει επαλήθευση από τον διαχειριστή.</p>
    <div style="text-align:center;margin:24px 0">
      <a href="${buildWebUrl('/admin/users.html', cfg)}"
         style="display:inline-block;background:#0A5568;color:#fff;text-decoration:none;
                border-radius:10px;padding:12px 28px;font-size:14px;font-weight:700">
        Διαχείριση Χρηστών →
      </a>
    </div>`;
  await sendAdminActionEmail({ adminEmail, subject: `Νέα Εγγραφή Λογιστή: ${accountantName}`, bodyHtml });
}

async function sendAccountantVerificationResult({ to, toName, approved, adminMessage }) {
  const cfg = await loadConfig();
  const subject = approved ? 'Ο λογαριασμός σας επαληθεύτηκε!' : 'Αίτημα επαλήθευσης απορρίφθηκε';
  const html = baseTemplate(subject, `
    <h1 style="font-size:22px;font-weight:800;color:${approved ? '#0A5568' : '#991b1b'};margin:0 0 12px">
      ${approved ? '✅ Επαλήθευση Λογαριασμού Εγκρίθηκε' : '❌ Αίτημα Επαλήθευσης Απορρίφθηκε'}
    </h1>
    <p style="font-size:15px;color:#3a5560;margin:0 0 16px;line-height:1.65">
      Αγαπητέ/ή <strong>${toName || to}</strong>,<br/><br/>
      ${approved
        ? 'Ο λογαριασμός σας ως λογιστής έχει <strong>επαληθευτεί επιτυχώς</strong>. Τώρα έχετε πλήρη πρόσβαση στην πλατφόρμα FishBill.'
        : 'Το αίτημα επαλήθευσης του λογαριασμού σας δεν εγκρίθηκε αυτή τη στιγμή.'}
    </p>
    ${adminMessage ? `<div style="background:#f5fbfc;border:1px solid #ceeaee;border-radius:10px;padding:14px 16px;margin-bottom:16px"><p style="margin:0;font-size:14px;color:#1a2e35"><strong>Μήνυμα διαχειριστή:</strong><br/>${adminMessage}</p></div>` : ''}
    ${approved ? `<div style="text-align:center;margin:24px 0">
      <a href="${buildWebUrl('/accountant/', cfg)}"
         style="display:inline-block;background:linear-gradient(135deg,#0A5568,#0B7285);color:#fff;
                text-decoration:none;border-radius:12px;padding:14px 32px;font-size:16px;font-weight:700">
        Σύνδεση στο FishBill →
      </a>
    </div>` : ''}
  `);
  await sendEmail({ to, toName, subject: `[FishBill] ${subject}`, html });
}

async function sendAdminVerificationActionLog({ adminEmail, accountantName, accountantEmail, approved }) {
  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:800;color:#0A5568;margin:0 0 12px">
      ${approved ? '✅ Λογιστής Επαληθεύτηκε' : '❌ Επαλήθευση Λογιστή Απορρίφθηκε'}
    </h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">
      Εκτελέσατε την παρακάτω ενέργεια επαλήθευσης:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
      <tr>
        <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572;width:40%">Λογιστής</td>
        <td style="padding:8px 12px;border:1px solid #d5edf2;color:#1a2e35">${accountantName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572">Email</td>
        <td style="padding:8px 12px;border:1px solid #d5edf2;color:#1a2e35">${accountantEmail}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572">Απόφαση</td>
        <td style="padding:8px 12px;border:1px solid #d5edf2;color:${approved ? '#059669' : '#dc2626'};font-weight:700">${approved ? 'ΕΓΚΡΙΘΗΚΕ' : 'ΑΠΟΡΡΙΦΘΗΚΕ'}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572">Χρόνος</td>
        <td style="padding:8px 12px;border:1px solid #d5edf2;color:#1a2e35">${new Date().toLocaleString('el-GR')}</td>
      </tr>
    </table>`;
  await sendAdminActionEmail({
    adminEmail, subject: `Επαλήθευση Λογιστή: ${accountantName} — ${approved ? 'ΕΓΚΡΙΘΗΚΕ' : 'ΑΠΟΡΡΙΦΘΗΚΕ'}`, bodyHtml,
  });
}

// ─── Fisherman notification emails ───────────────────────────────────────────

async function sendInvoiceCreatedNotif({ to, toName, bizName, invoice }) {
  const cfg = await loadConfig();
  const num = invoice.full_number || `${invoice.series || 'A'}-${invoice.number}`;
  const date = invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('el-GR') : '—';
  const total = parseFloat(invoice.total_value || 0).toFixed(2);
  const customer = invoice.customer_name || '—';

  if (!await isPlatformEmailEnabled('invoice_created')) return;
  const html = baseTemplate('Δημιουργία Νέου Τιμολογίου', `
    <h1 style="font-size:22px;font-weight:800;color:#0A5568;margin:0 0 12px">📄 Νέο Τιμολόγιο Δημιουργήθηκε</h1>
    <p style="font-size:15px;color:#3a5560;margin:0 0 20px;line-height:1.65">
      Γεια σας${toName ? ' <strong>' + toName + '</strong>' : ''},<br/>
      Ένα νέο τιμολόγιο δημιουργήθηκε για την επιχείρηση <strong>${bizName}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-bottom:20px">
      ${[['Αριθμός', num], ['Ημερομηνία', date], ['Πελάτης', customer], ['Σύνολο', `€${total}`]]
        .map(([l,v]) => `<tr>
          <td style="padding:9px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:700;color:#4a6572;width:38%">${l}</td>
          <td style="padding:9px 12px;border:1px solid #d5edf2;color:#1a2e35;font-weight:600">${v}</td>
        </tr>`).join('')}
    </table>
    <div style="text-align:center;margin:20px 0">
      <a href="${buildWebUrl('/app/invoices.html', cfg)}"
         style="display:inline-block;background:linear-gradient(135deg,#0A5568,#0B7285);color:#fff;
                text-decoration:none;border-radius:12px;padding:14px 30px;font-size:15px;font-weight:700">
        Προβολή Τιμολογίου →
      </a>
    </div>
  `);
  await sendEmail({ to, toName, subject: `[FishBill] Νέο Τιμολόγιο ${num}`, html, _type: 'invoice_created' });
  trackEmailSent('invoice_created');
}

async function sendInvoiceTransmittedNotif({ to, toName, bizName, invoice }) {
  if (!await isPlatformEmailEnabled('invoice_transmitted')) return;
  const num = invoice.full_number || `${invoice.series || 'A'}-${invoice.number}`;
  const mark = invoice.mydata_mark || invoice.mark || '—';
  const total = parseFloat(invoice.total_value || 0).toFixed(2);
  const customer = invoice.customer_name || '—';

  const html = baseTemplate('Επιτυχής Διαβίβαση στο myDATA', `
    <h1 style="font-size:22px;font-weight:800;color:#064e3b;margin:0 0 12px">✅ Τιμολόγιο Διαβιβάστηκε Επιτυχώς</h1>
    <p style="font-size:15px;color:#3a5560;margin:0 0 20px;line-height:1.65">
      Γεια σας${toName ? ' <strong>' + toName + '</strong>' : ''},<br/>
      Το τιμολόγιο <strong>${num}</strong> της επιχείρησης <strong>${bizName}</strong> εστάλη επιτυχώς στο myDATA/ΑΑΔΕ.
    </p>
    <div style="background:#d1fae5;border:1px solid #a7f3d0;border-radius:12px;padding:16px 18px;margin-bottom:20px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
        ${[['Αριθμός', num], ['Πελάτης', customer], ['Ποσό', `€${total}`], ['MARK myDATA', mark]]
          .map(([l,v]) => `<tr>
            <td style="padding:6px 8px;font-weight:700;color:#065f46;width:38%">${l}</td>
            <td style="padding:6px 8px;color:#064e3b;font-weight:600">${v}</td>
          </tr>`).join('')}
      </table>
    </div>
    <p style="font-size:13px;color:#8aacb4;margin:0">
      Το MARK αποτελεί απόδειξη επιτυχούς διαβίβασης στην ΑΑΔΕ και αποθηκεύεται αυτόματα στο σύστημά σας.
    </p>
  `);
  await sendEmail({ to, toName, subject: `[FishBill] ✅ Επιτυχής διαβίβαση ${num}`, html, _type: 'invoice_transmitted' });
  trackEmailSent('invoice_transmitted');
}

async function sendInvoiceFailedNotif({ to, toName, bizName, invoice, errorMsg }) {
  const cfg = await loadConfig();
  if (!await isPlatformEmailEnabled('invoice_failed')) return;
  const num = invoice.full_number || `${invoice.series || 'A'}-${invoice.number}`;
  const customer = invoice.customer_name || '—';

  const html = baseTemplate('Αποτυχία Διαβίβασης στο myDATA', `
    <h1 style="font-size:22px;font-weight:800;color:#991b1b;margin:0 0 12px">❌ Αποτυχία Διαβίβασης Τιμολογίου</h1>
    <p style="font-size:15px;color:#3a5560;margin:0 0 16px;line-height:1.65">
      Γεια σας${toName ? ' <strong>' + toName + '</strong>' : ''},<br/>
      Η αποστολή του τιμολογίου <strong>${num}</strong> στο myDATA/ΑΑΔΕ απέτυχε.
    </p>
    <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:12px;padding:16px 18px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-weight:700;color:#991b1b">Λεπτομέρειες</p>
      <p style="margin:0 0 6px;font-size:14px;color:#7f1d1d"><strong>Τιμολόγιο:</strong> ${num} · ${customer}</p>
      ${errorMsg ? `<p style="margin:0;font-size:13px;color:#7f1d1d"><strong>Σφάλμα:</strong> ${errorMsg}</p>` : ''}
    </div>
    <p style="font-size:14px;color:#3a5560;margin:0 0 20px;line-height:1.65">
      Παρακαλώ δοκιμάστε ξανά ή επικοινωνήστε με τον διαχειριστή αν το πρόβλημα παραμένει.
    </p>
    <div style="text-align:center;margin:20px 0">
      <a href="${buildWebUrl('/app/invoices.html', cfg)}"
         style="display:inline-block;background:#991b1b;color:#fff;
                text-decoration:none;border-radius:12px;padding:14px 30px;font-size:15px;font-weight:700">
        Επανάληψη Διαβίβασης →
      </a>
    </div>
  `);
  await sendEmail({ to, toName, subject: `[FishBill] ❌ Αποτυχία διαβίβασης ${num}`, html, _type: 'invoice_failed' });
  trackEmailSent('invoice_failed');
}

async function sendDailySummaryEmail({ to, toName, bizName, stats }) {
  const cfg = await loadConfig();
  if (!await isPlatformEmailEnabled('daily_summary')) return;
  const { created = 0, transmitted = 0, failed = 0, revenue = 0, date } = stats;
  const dateLabel = date || new Date(Date.now() - 86400000).toLocaleDateString('el-GR');
  const hasActivity = created + transmitted + failed > 0;

  const html = baseTemplate(`Ημερήσια Σύνοψη FishBill — ${dateLabel}`, `
    <h1 style="font-size:22px;font-weight:800;color:#0A5568;margin:0 0 6px">📊 Ημερήσια Σύνοψη</h1>
    <p style="font-size:14px;color:#6b7280;margin:0 0 20px">${bizName} · ${dateLabel}</p>
    ${hasActivity ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="padding:14px;background:#EFF6FF;border-radius:10px 0 0 10px;text-align:center;border:1px solid #BFDBFE;width:25%">
          <div style="font-size:28px;font-weight:900;color:#1D4ED8">${created}</div>
          <div style="font-size:12px;font-weight:600;color:#3b82f6;margin-top:3px">Δημιουργήθηκαν</div>
        </td>
        <td style="padding:14px;background:#F0FDF4;text-align:center;border:1px solid #BBF7D0;width:25%">
          <div style="font-size:28px;font-weight:900;color:#15803D">${transmitted}</div>
          <div style="font-size:12px;font-weight:600;color:#16a34a;margin-top:3px">Διαβιβάστηκαν</div>
        </td>
        <td style="padding:14px;background:#FFF1F2;text-align:center;border:1px solid #FECDD3;width:25%">
          <div style="font-size:28px;font-weight:900;color:#BE123C">${failed}</div>
          <div style="font-size:12px;font-weight:600;color:#e11d48;margin-top:3px">Αποτυχίες</div>
        </td>
        <td style="padding:14px;background:#F9FAFB;border-radius:0 10px 10px 0;text-align:center;border:1px solid #E5E7EB;width:25%">
          <div style="font-size:22px;font-weight:900;color:#111827">€${parseFloat(revenue).toFixed(2)}</div>
          <div style="font-size:12px;font-weight:600;color:#6b7280;margin-top:3px">Τζίρος</div>
        </td>
      </tr>
    </table>` : `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
      <p style="color:#6b7280;font-size:14px;margin:0">Δεν υπήρξε δραστηριότητα χθες.</p>
    </div>`}
    <div style="text-align:center;margin:16px 0">
      <a href="${buildWebUrl('/app/dashboard.html', cfg)}"
         style="display:inline-block;background:linear-gradient(135deg,#0A5568,#0B7285);color:#fff;
                text-decoration:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:700">
        Πίνακας Ελέγχου →
      </a>
    </div>
  `);
  await sendEmail({ to, toName, subject: `[FishBill] Σύνοψη ${dateLabel} — ${bizName}`, html, _type: 'daily_summary' });
  trackEmailSent('daily_summary');
}

async function sendDirectEmail({ to, toName, subject, messageHtml, senderName }) {
  if (!await isPlatformEmailEnabled('direct')) return;
  const cfg = await loadConfig();
  const replyEmail = cfg.platform_email_from || process.env.ADMIN_EMAIL || '';
  const html = baseTemplate(subject, `
    <p style="font-size:13px;color:#9ca3af;margin:0 0 16px;font-style:italic">
      Μήνυμα από τον διαχειριστή${senderName ? ' ' + escHtml(senderName) : ''} της πλατφόρμας FishBill
    </p>
    <div style="font-size:15px;color:#1a2e35;line-height:1.75;margin-bottom:20px">
      ${messageHtml}
    </div>
    <div style="border-top:1px solid #d5edf2;padding-top:14px;margin-top:20px">
      <p style="font-size:12px;color:#8aacb4;margin:0">
        ${replyEmail ? `Για απορίες απαντήστε σε αυτό το email ή επικοινωνήστε με ${escHtml(replyEmail)}` : 'Για απορίες απαντήστε σε αυτό το email.'}
      </p>
    </div>
  `);
  await sendEmail({ to, toName, subject, html, _type: 'direct' });
  trackEmailSent('direct');
}

// ── Admin: new invoice needs manual Epsilon Smart processing ─────────────────
async function sendAdminInvoiceReadyEmail({ invoice, businessName, businessAfm, customerName, adminEmail }) {
  const cfg = await loadConfig();
  const to  = adminEmail || cfg.admin_notification_email || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';

  const rows = Object.entries({
    'Επιχείρηση':    `${businessName} (ΑΦΜ: ${businessAfm || '—'})`,
    'Παραστατικό':   invoice.full_number || invoice.id,
    'Πελάτης':       customerName || '—',
    'Ποσό':          `€${parseFloat(invoice.total_value || 0).toFixed(2)}`,
    'Ημερομηνία':    invoice.issue_date || new Date().toISOString().slice(0,10),
    'Τύπος':         invoice.invoice_type || '1.1',
  }).map(([k,v]) => `
    <tr>
      <td style="padding:8px 12px;background:#f1f5f9;font-size:13px;font-weight:600;color:#374151;border-radius:4px;white-space:nowrap">${k}</td>
      <td style="padding:8px 12px;font-size:13px;color:#111827;font-weight:700">${v}</td>
    </tr>`).join('');

  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:800;color:#0A5568;margin:0 0 8px">📄 Νέο Παραστατικό — Απαιτείται Επεξεργασία</h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">
      Ένας χρήστης δημιούργησε παραστατικό στην εφαρμογή. Εισάγετέ το στο <strong>TIMOLOGIO της ΑΑΔΕ</strong> (δωρεάν) για να λάβετε ΜΑΡΚ.
    </p>
    <table width="100%" cellpadding="4" cellspacing="0" style="border-collapse:separate;border-spacing:0 4px;margin-bottom:20px">
      ${rows}
    </table>
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <p style="margin:0;font-size:13px;color:#92400e;font-weight:600">
        ⚡ Βήματα: Ανοίξτε <a href="https://www.timologio.gr" style="color:#1d4ed8">TIMOLOGIO της ΑΑΔΕ</a> → Δημιουργήστε το παραστατικό → Λάβετε ΜΑΡΚ → Καταχωρήστε στα Εισερχόμενα myDATA.
      </p>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:0 0 16px">Εναλλακτικά μπορείτε να χρησιμοποιήσετε <a href="https://app.epsilonsmart.gr" style="color:#6b7280">Epsilon Smart</a>.</p>
    <a href="${buildWebUrl('/admin/mydata-inbox.html', cfg)}"
       style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
      Εισερχόμενα myDATA →
    </a>`;

  const html = baseTemplate('Νέο Παραστατικό — Επεξεργασία TIMOLOGIO', bodyHtml);
  await sendEmail({ to, toName: 'FishBill Admin', subject: `[FishBill] Νέο παραστατικό ${invoice.full_number || ''} — ${businessName}`, html, _type: 'admin_invoice_ready' });
  trackEmailSent('admin_invoice_ready');
}

// ── Admin: invoice cancelled — needs ακυρωτικό in Epsilon Smart ──────────────
async function sendInvoiceCancelledAdminEmail({ invoice, businessName, businessAfm, adminEmail }) {
  const cfg = await loadConfig();
  const to  = adminEmail || cfg.admin_notification_email || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';

  const rows = Object.entries({
    'Επιχείρηση':  `${businessName} (ΑΦΜ: ${businessAfm || '—'})`,
    'Παραστατικό': invoice.full_number || invoice.id,
    'Πελάτης':     invoice.customer_name || '—',
    'Ποσό':        `€${parseFloat(invoice.total_value || 0).toFixed(2)}`,
    'Ημερομηνία':  invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('el-GR') : '—',
    'MARK':        invoice.mydata_mark || '—',
  }).map(([k,v]) => `
    <tr>
      <td style="padding:8px 12px;background:#fef2f2;font-size:13px;font-weight:600;color:#7f1d1d;white-space:nowrap">${k}</td>
      <td style="padding:8px 12px;font-size:13px;color:#111827;font-weight:700">${v}</td>
    </tr>`).join('');

  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:800;color:#991b1b;margin:0 0 8px">🚫 Ακύρωση Παραστατικού — Απαιτείται Ενέργεια</h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">
      Ένας χρήστης ακύρωσε παραστατικό. Δημιουργήστε <strong>ακυρωτικό</strong> στο <strong>TIMOLOGIO της ΑΑΔΕ</strong> και διαβιβάστε στο myDATA.
    </p>
    <table width="100%" cellpadding="4" cellspacing="0" style="border-collapse:separate;border-spacing:0 4px;margin-bottom:20px">
      ${rows}
    </table>
    <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <p style="margin:0;font-size:13px;color:#7f1d1d;font-weight:600">
        ⚡ Βήματα: Ανοίξτε <a href="https://www.timologio.gr" style="color:#991b1b">TIMOLOGIO της ΑΑΔΕ</a> → Δημιουργήστε ακυρωτικό για το ${invoice.full_number || invoice.id} → Διαβιβάστε στο myDATA.
      </p>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:0 0 16px">Εναλλακτικά μπορείτε να χρησιμοποιήσετε <a href="https://app.epsilonsmart.gr" style="color:#6b7280">Epsilon Smart</a>.</p>
    <a href="${buildWebUrl('/admin/mydata-inbox.html', cfg)}"
       style="display:inline-block;padding:12px 24px;background:#991b1b;color:#fff;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
      Εισερχόμενα myDATA →
    </a>`;

  const html = baseTemplate('Ακύρωση Παραστατικού — Δημιουργία Ακυρωτικού', bodyHtml);
  await sendEmail({ to, toName: 'FishBill Admin', subject: `[FishBill] 🚫 Ακύρωση ${invoice.full_number || ''} — ${businessName}`, html, _type: 'admin_invoice_cancelled' });
  trackEmailSent('admin_invoice_cancelled');
}

// ── Admin: delivery note cancelled ───────────────────────────────────────────
async function sendDeliveryNoteCancelledAdminEmail({ note, businessName, adminEmail }) {
  const cfg = await loadConfig();
  const to  = adminEmail || cfg.admin_notification_email || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';

  const rows = Object.entries({
    'Επιχείρηση':       businessName,
    'Δελτίο':           note.full_number || note.id,
    'Παραλήπτης':       note.recipient_name || '—',
    'Ημερομηνία':       note.issue_date ? new Date(note.issue_date).toLocaleDateString('el-GR') : '—',
    'MARK':             note.mydata_mark || '—',
  }).map(([k,v]) => `
    <tr>
      <td style="padding:8px 12px;background:#fef2f2;font-size:13px;font-weight:600;color:#7f1d1d;white-space:nowrap">${k}</td>
      <td style="padding:8px 12px;font-size:13px;color:#111827;font-weight:700">${v}</td>
    </tr>`).join('');

  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:800;color:#991b1b;margin:0 0 8px">🚫 Ακύρωση Δελτίου Αποστολής — Απαιτείται Ενέργεια</h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">
      Ένας χρήστης ακύρωσε Δελτίο Αποστολής. Ακυρώστε το αντίστοιχο στο <strong>TIMOLOGIO της ΑΑΔΕ</strong> και διαβιβάστε στο myDATA.
    </p>
    <table width="100%" cellpadding="4" cellspacing="0" style="border-collapse:separate;border-spacing:0 4px;margin-bottom:20px">
      ${rows}
    </table>
    <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <p style="margin:0;font-size:13px;color:#7f1d1d;font-weight:600">
        ⚡ Ανοίξτε <a href="https://www.timologio.gr" style="color:#991b1b">TIMOLOGIO της ΑΑΔΕ</a> → Βρείτε το ΔΑ ${note.full_number || note.id} → Ακυρώστε το → Διαβιβάστε στο myDATA.
      </p>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:0 0 16px">Εναλλακτικά μπορείτε να χρησιμοποιήσετε <a href="https://app.epsilonsmart.gr" style="color:#6b7280">Epsilon Smart</a>.</p>
    <a href="${buildWebUrl('/admin/delivery-notes-inbox.html', cfg)}"
       style="display:inline-block;padding:12px 24px;background:#991b1b;color:#fff;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
      Δελτία Αποστολής →
    </a>`;

  const html = baseTemplate('Ακύρωση Δελτίου Αποστολής', bodyHtml);
  await sendEmail({ to, toName: 'FishBill Admin', subject: `[FishBill] 🚫 Ακύρωση ΔΑ ${note.full_number || ''} — ${businessName}`, html, _type: 'admin_dn_cancelled' });
  trackEmailSent('admin_dn_cancelled');
}

// ── User notification: new delivery note created ──────────────────────────────
async function sendDeliveryNoteCreatedNotif({ to, toName, bizName, note }) {
  const cfg = await loadConfig();
  if (!await isPlatformEmailEnabled('delivery_note_created')) return;
  const num  = note.full_number || note.id;
  const date = note.issue_date ? new Date(note.issue_date).toLocaleDateString('el-GR') : '—';
  const recipient = note.recipient_name || '—';

  const html = baseTemplate('Δημιουργία Νέου Δελτίου Αποστολής', `
    <h1 style="font-size:22px;font-weight:800;color:#0A5568;margin:0 0 12px">🚛 Νέο Δελτίο Αποστολής Δημιουργήθηκε</h1>
    <p style="font-size:15px;color:#3a5560;margin:0 0 20px;line-height:1.65">
      Γεια σας${toName ? ' <strong>' + toName + '</strong>' : ''},<br/>
      Ένα νέο Δελτίο Αποστολής δημιουργήθηκε για την επιχείρηση <strong>${bizName}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-bottom:20px">
      ${[['Αριθμός ΔΑ', num], ['Ημερομηνία', date], ['Παραλήπτης', recipient]]
        .map(([l,v]) => `<tr>
          <td style="padding:9px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:700;color:#4a6572;width:38%">${l}</td>
          <td style="padding:9px 12px;border:1px solid #d5edf2;color:#1a2e35;font-weight:600">${v}</td>
        </tr>`).join('')}
    </table>
  `);
  await sendEmail({ to, toName, subject: `[FishBill] Νέο Δελτίο Αποστολής ${num}`, html, _type: 'delivery_note_created' });
  trackEmailSent('delivery_note_created');
}

// ── Admin: new delivery note needs Epsilon Smart processing ───────────────────
async function sendAdminDeliveryNoteReadyEmail({ note, businessName, businessAfm, adminEmail }) {
  const cfg = await loadConfig();
  const to  = adminEmail || cfg.admin_notification_email || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';

  const rows = Object.entries({
    'Επιχείρηση':       `${businessName} (ΑΦΜ: ${businessAfm || '—'})`,
    'Δελτίο Αποστολής': note.full_number || note.id,
    'Παραλήπτης':       note.recipient_name || '—',
    'Ημερομηνία':       note.issue_date ? new Date(note.issue_date).toLocaleDateString('el-GR') : '—',
  }).map(([k,v]) => `
    <tr>
      <td style="padding:8px 12px;background:#f1f5f9;font-size:13px;font-weight:600;color:#374151;white-space:nowrap">${k}</td>
      <td style="padding:8px 12px;font-size:13px;color:#111827;font-weight:700">${v}</td>
    </tr>`).join('');

  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:800;color:#0A5568;margin:0 0 8px">🚛 Νέο Δελτίο Αποστολής — Απαιτείται Επεξεργασία</h1>
    <p style="font-size:14px;color:#3a5560;margin:0 0 16px">
      Δημιουργήθηκε νέο Δελτίο Αποστολής στην εφαρμογή. Εισάγετέ το στο <strong>TIMOLOGIO της ΑΑΔΕ</strong> (δωρεάν) για να λάβετε ΜΑΡΚ.
    </p>
    <table width="100%" cellpadding="4" cellspacing="0" style="border-collapse:separate;border-spacing:0 4px;margin-bottom:20px">
      ${rows}
    </table>
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <p style="margin:0;font-size:13px;color:#92400e;font-weight:600">
        ⚡ Βήματα: Ανοίξτε <a href="https://www.timologio.gr" style="color:#1d4ed8">TIMOLOGIO της ΑΑΔΕ</a> → Δημιουργήστε ΔΑ → Λάβετε ΜΑΡΚ → Καταχωρήστε στα Δελτία Αποστολής του admin panel.
      </p>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:0 0 16px">Εναλλακτικά μπορείτε να χρησιμοποιήσετε <a href="https://app.epsilonsmart.gr" style="color:#6b7280">Epsilon Smart</a>.</p>
    <a href="${buildWebUrl('/admin/delivery-notes-inbox.html', cfg)}"
       style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
      Δελτία Αποστολής →
    </a>`;

  const html = baseTemplate('Νέο Δελτίο Αποστολής — Επεξεργασία TIMOLOGIO', bodyHtml);
  await sendEmail({ to, toName: 'FishBill Admin', subject: `[FishBill] Νέο ΔΑ ${note.full_number || ''} — ${businessName}`, html, _type: 'admin_dn_ready' });
  trackEmailSent('admin_dn_ready');
}

// ── Admin OTP verification email ─────────────────────────────────────────────
async function sendAdminOtpEmail(toEmail, code) {
  const bodyHtml = `
    <div style="text-align:center;padding:32px 0 24px">
      <div style="font-size:13px;color:#6b7280;margin-bottom:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase">Κωδικός Επαλήθευσης Διαχειριστή</div>
      <div style="display:inline-block;background:#0A5568;color:#fff;font-size:44px;font-weight:900;letter-spacing:12px;padding:20px 36px;border-radius:16px;font-family:monospace">${code}</div>
      <div style="margin-top:20px;font-size:13px;color:#6b7280">Ο κωδικός ισχύει για <strong>5 λεπτά</strong>.</div>
      <div style="margin-top:8px;font-size:12px;color:#9ca3af">Αν δεν ζητήσατε αυτό τον κωδικό, αγνοήστε αυτό το email και ελέγξτε αμέσως τον λογαριασμό σας.</div>
    </div>`;
  const html = baseTemplate('Κωδικός Επαλήθευσης — FishBill Admin', bodyHtml);
  await sendEmail({ to: toEmail, toName: 'FishBill Admin', subject: `[FishBill] Κωδικός επαλήθευσης: ${code}`, html, _type: 'admin_otp' });
}

module.exports = {
  escHtml,
  sendEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendVerificationRequestToAdmin,
  sendTestEmail,
  loadConfig,
  sendAdminActionEmail,
  sendNewBusinessRegistrationToAdmin,
  sendNewAccountantRegistrationToAdmin,
  sendAccountantVerificationResult,
  sendAdminVerificationActionLog,
  sendInvoiceCreatedNotif,
  sendInvoiceTransmittedNotif,
  sendInvoiceFailedNotif,
  sendDailySummaryEmail,
  sendDirectEmail,
  sendAdminInvoiceReadyEmail,
  sendInvoiceCancelledAdminEmail,
  sendDeliveryNoteCancelledAdminEmail,
  sendDeliveryNoteCreatedNotif,
  sendAdminDeliveryNoteReadyEmail,
  sendAdminOtpEmail,
  isPlatformEmailEnabled,
  trackEmailSent,
};
