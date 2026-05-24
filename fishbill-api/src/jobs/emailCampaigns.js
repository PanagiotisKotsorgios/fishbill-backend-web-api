/**
 * Email Campaign Cron Jobs
 * Runs daily scheduled emails for trial/subscription lifecycle events.
 */

const cron = require('node-cron');
const emailSvc = require('../services/email.service');

// ── Helper: get owner of a business ─────────────────────────────────────────
async function getOwner(pool, bizId) {
  const [rows] = await pool.execute(
    `SELECT u.email, u.full_name
     FROM users u
     WHERE u.business_id = ? AND u.role IN ('owner','admin') AND u.is_active = 1
     ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1`,
    [bizId]
  );
  return rows[0] || null;
}

// ── Helper: send lifecycle campaign email using platform email service ────────
async function sendCampaignEmail(pool, bizId, bizName, subject, htmlBody) {
  try {
    if (!await emailSvc.isPlatformEmailEnabled('lifecycle')) {
      console.log(`[EmailCampaign] lifecycle emails blocked by platform toggle — skipping ${bizName}`);
      return;
    }
    const owner = await getOwner(pool, bizId);
    if (!owner) return;

    const cfg = await emailSvc.loadConfig();
    const webBaseUrl = (cfg.web_base_url || process.env.APP_BASE_URL || '').replace(/\/$/, '');
    const html = htmlBody.replace(/__SUBSCRIPTION_URL__/g, `${webBaseUrl}/app/subscription.html`);

    await emailSvc.sendEmail({
      to: owner.email,
      toName: owner.full_name,
      subject,
      html,
      _type: 'lifecycle',
    });
    emailSvc.trackEmailSent('lifecycle');
    console.log(`[EmailCampaign] ✓ Sent "${subject}" to ${owner.email} (${bizName})`);
  } catch (err) {
    console.error(`[EmailCampaign] ✗ Failed for business ${bizId}:`, err.message);
  }
}

// ── Email templates ──────────────────────────────────────────────────────────
function wrapEmail(title, preheader, body) {
  return `<!DOCTYPE html>
<html lang="el">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Inter,Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0D47A1 0%,#1976D2 100%);padding:32px 40px;text-align:center">
    <div style="font-size:32px;margin-bottom:8px">🐟</div>
    <h1 style="margin:0;color:#fff;font-size:26px;font-weight:800;letter-spacing:-0.5px">FishBill</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px">Έξυπνη Τιμολόγηση για Αλιείς</p>
  </div>
  <!-- Body -->
  <div style="padding:32px 40px">
    ${body}
  </div>
  <!-- Footer -->
  <div style="padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">
      © ${new Date().getFullYear()} FishBill · Παρέχεται με ❤️ για Έλληνες Αλιείς<br>
      <a href="#" style="color:#94a3b8;text-decoration:none">Κατάργηση εγγραφής</a>
    </p>
  </div>
</div>
</body></html>`;
}

function trialExpiringEmail(bizName, daysLeft) {
  const urgency = daysLeft === 1 ? 'αύριο' : `σε ${daysLeft} μέρες`;
  const color = daysLeft === 1 ? '#DC2626' : '#D97706';
  return wrapEmail(
    `Η δοκιμαστική περίοδος λήγει ${urgency}`,
    `Ανανεώστε σήμερα για να μην χάσετε πρόσβαση`,
    `<h2 style="margin:0 0 16px;color:#1e293b;font-size:22px">Γεια σας,</h2>
     <p style="color:#475569;line-height:1.7;margin:0 0 16px">
       Η δοκιμαστική περίοδος της επιχείρησης <strong>${bizName}</strong>
       στο FishBill λήγει <span style="color:${color};font-weight:700">${urgency}</span>.
     </p>
     <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:16px;margin:20px 0">
       <p style="margin:0;color:#92400e;font-weight:600">⚠️ Τι θα γίνει μετά τη λήξη;</p>
       <p style="margin:8px 0 0;color:#78350f;font-size:14px">
         Δεν θα μπορείτε να εκδίδετε νέα τιμολόγια ή να τα μεταδίδετε στο myDATA.
         Τα υπάρχοντα δεδομένα σας παραμένουν ασφαλή.
       </p>
     </div>
     <p style="color:#475569;line-height:1.7;margin:0 0 24px">
       Επιλέξτε πρόγραμμα συνδρομής σήμερα για να συνεχίσετε χωρίς διακοπή.
     </p>
     <div style="text-align:center;margin:24px 0">
       <a href="__SUBSCRIPTION_URL__"
          style="display:inline-block;background:linear-gradient(135deg,#0D47A1,#1976D2);color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:700;font-size:16px">
         Επιλογή Προγράμματος →
       </a>
     </div>
     <p style="color:#94a3b8;font-size:13px;margin:16px 0 0">
       Χρειάζεστε βοήθεια; Απαντήστε σε αυτό το email ή επικοινωνήστε μαζί μας.
     </p>`
  );
}

function trialExpiredEmail(bizName) {
  return wrapEmail(
    'Η δοκιμαστική σας περίοδος έληξε',
    'Ανανεώστε τώρα για να συνεχίσετε',
    `<h2 style="margin:0 0 16px;color:#1e293b;font-size:22px">Γεια σας,</h2>
     <p style="color:#475569;line-height:1.7;margin:0 0 16px">
       Η δοκιμαστική περίοδος της επιχείρησης <strong>${bizName}</strong> έληξε σήμερα.
     </p>
     <div style="background:#fee2e2;border-left:4px solid #ef4444;border-radius:8px;padding:16px;margin:20px 0">
       <p style="margin:0;color:#991b1b;font-weight:600">❌ Ο λογαριασμός σας έχει περιοριστεί</p>
       <p style="margin:8px 0 0;color:#7f1d1d;font-size:14px">
         Δεν μπορείτε πλέον να δημιουργείτε ή να μεταδίδετε τιμολόγια.
         Ενεργοποιήστε συνδρομή για να επαναφέρετε την πλήρη πρόσβαση.
       </p>
     </div>
     <div style="text-align:center;margin:24px 0">
       <a href="__SUBSCRIPTION_URL__"
          style="display:inline-block;background:linear-gradient(135deg,#0D47A1,#1976D2);color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:700;font-size:16px">
         Ενεργοποίηση Συνδρομής →
       </a>
     </div>
     <p style="color:#94a3b8;font-size:13px;margin:16px 0 0">
       Χρειάζεστε βοήθεια; Απαντήστε σε αυτό το email.
     </p>`
  );
}

function subscriptionExpiringEmail(bizName, daysLeft) {
  const urgency = daysLeft === 1 ? 'αύριο' : `σε ${daysLeft} μέρες`;
  const color = daysLeft <= 3 ? '#DC2626' : '#D97706';
  return wrapEmail(
    `Η συνδρομή σας λήγει ${urgency}`,
    'Ανανεώστε για αδιάλειπτη λειτουργία',
    `<h2 style="margin:0 0 16px;color:#1e293b;font-size:22px">Γεια σας,</h2>
     <p style="color:#475569;line-height:1.7;margin:0 0 16px">
       Η συνδρομή της επιχείρησης <strong>${bizName}</strong>
       λήγει <span style="color:${color};font-weight:700">${urgency}</span>.
     </p>
     <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:16px;margin:20px 0">
       <p style="margin:0;color:#92400e;font-weight:600">💡 Ανανεώστε για να συνεχίσετε κανονικά</p>
       <p style="margin:8px 0 0;color:#78350f;font-size:14px">
         Μετά τη λήξη δεν θα μπορείτε να εκδίδετε ή να μεταδίδετε τιμολόγια στο myDATA.
       </p>
     </div>
     <div style="text-align:center;margin:24px 0">
       <a href="__SUBSCRIPTION_URL__"
          style="display:inline-block;background:linear-gradient(135deg,#0D47A1,#1976D2);color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:700;font-size:16px">
         Ανανέωση Συνδρομής →
       </a>
     </div>
     <p style="color:#94a3b8;font-size:13px;margin:16px 0 0">
       Αν έχετε ενεργοποιημένη αυτόματη ανανέωση, δεν χρειάζεται καμία ενέργεια.
     </p>`
  );
}

function subscriptionExpiredEmail(bizName) {
  return wrapEmail(
    'Η συνδρομή σας έληξε',
    'Ανανεώστε τώρα για πλήρη πρόσβαση',
    `<h2 style="margin:0 0 16px;color:#1e293b;font-size:22px">Γεια σας,</h2>
     <p style="color:#475569;line-height:1.7;margin:0 0 16px">
       Η συνδρομή της επιχείρησης <strong>${bizName}</strong> έληξε σήμερα.
     </p>
     <div style="background:#fee2e2;border-left:4px solid #ef4444;border-radius:8px;padding:16px;margin:20px 0">
       <p style="margin:0;color:#991b1b;font-weight:600">❌ Ο λογαριασμός έχει περιοριστεί</p>
       <p style="margin:8px 0 0;color:#7f1d1d;font-size:14px">
         Ανανεώστε τη συνδρομή σας για να επαναφέρετε την πλήρη πρόσβαση στο FishBill.
       </p>
     </div>
     <div style="text-align:center;margin:24px 0">
       <a href="__SUBSCRIPTION_URL__"
          style="display:inline-block;background:linear-gradient(135deg,#DC2626,#EF4444);color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:700;font-size:16px">
         Ανανέωση Τώρα →
       </a>
     </div>`
  );
}

// ── Cron Job Runner ──────────────────────────────────────────────────────────
function startEmailCampaigns(pool) {
  // ── 08:00 — Trial reminders ─────────────────────────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    console.log('[EmailCampaign] Running trial expiration checks...');
    try {
      // Trials expiring in exactly 3 days
      const [in3] = await pool.execute(`
        SELECT id, name FROM businesses
        WHERE plan = 'trial'
          AND subscription_active = 0
          AND DATE(trial_ends_at) = DATE(DATE_ADD(NOW(), INTERVAL 3 DAY))`);
      for (const b of in3) {
        await sendCampaignEmail(pool, b.id, b.name,
          'Η δοκιμαστική σας περίοδος λήγει σε 3 μέρες',
          trialExpiringEmail(b.name, 3));
      }

      // Trials expiring in exactly 1 day
      const [in1] = await pool.execute(`
        SELECT id, name FROM businesses
        WHERE plan = 'trial'
          AND subscription_active = 0
          AND DATE(trial_ends_at) = DATE(DATE_ADD(NOW(), INTERVAL 1 DAY))`);
      for (const b of in1) {
        await sendCampaignEmail(pool, b.id, b.name,
          'Η δοκιμαστική σας περίοδος λήγει αύριο',
          trialExpiringEmail(b.name, 1));
      }

      // Trials that expired today
      const [expired] = await pool.execute(`
        SELECT id, name FROM businesses
        WHERE plan = 'trial'
          AND subscription_active = 0
          AND DATE(trial_ends_at) = CURDATE()`);
      for (const b of expired) {
        await sendCampaignEmail(pool, b.id, b.name,
          'Η δοκιμαστική σας περίοδος FishBill έληξε',
          trialExpiredEmail(b.name));
      }
    } catch (err) {
      console.error('[EmailCampaign] Trial check error:', err.message);
    }
  }, { timezone: 'Europe/Athens' });

  // ── 08:15 — Subscription expiration reminders ────────────────────────────────
  cron.schedule('15 8 * * *', async () => {
    console.log('[EmailCampaign] Running subscription expiration checks...');
    try {
      for (const days of [7, 3, 1]) {
        const [rows] = await pool.execute(`
          SELECT id, name FROM businesses
          WHERE subscription_active = 1
            AND DATE(subscription_ends_at) = DATE(DATE_ADD(NOW(), INTERVAL ${days} DAY))`);
        const label = days === 1 ? 'αύριο' : `σε ${days} μέρες`;
        for (const b of rows) {
          await sendCampaignEmail(pool, b.id, b.name,
            `Η συνδρομή σας FishBill λήγει ${label}`,
            subscriptionExpiringEmail(b.name, days));
        }
      }
    } catch (err) {
      console.error('[EmailCampaign] Subscription expiring check error:', err.message);
    }
  }, { timezone: 'Europe/Athens' });

  // ── 08:30 — Subscription expired today ──────────────────────────────────────
  cron.schedule('30 8 * * *', async () => {
    console.log('[EmailCampaign] Running expired subscription checks...');
    try {
      const [expired] = await pool.execute(`
        SELECT id, name FROM businesses
        WHERE subscription_active = 1
          AND DATE(subscription_ends_at) = CURDATE()
          AND (auto_renew = 0 OR auto_renew IS NULL)`);
      for (const b of expired) {
        // Mark as inactive
        await pool.execute(
          'UPDATE businesses SET subscription_active = 0, updated_at = NOW() WHERE id = ?',
          [b.id]
        );
        await sendCampaignEmail(pool, b.id, b.name,
          'Η συνδρομή σας FishBill έληξε',
          subscriptionExpiredEmail(b.name));
      }
    } catch (err) {
      console.error('[EmailCampaign] Expired subscription check error:', err.message);
    }
  }, { timezone: 'Europe/Athens' });

  // ── 07:00 — Daily activity summary for businesses that enabled it ────────────
  cron.schedule('0 7 * * *', async () => {
    console.log('[EmailCampaign] Running daily summary emails...');
    try {
      const [businesses] = await pool.execute(`
        SELECT b.id, b.name
        FROM businesses b
        JOIN business_settings bs ON bs.business_id = b.id
        WHERE bs.notif_daily_summary = 1`);

      for (const biz of businesses) {
        const owner = await getOwner(pool, biz.id);
        if (!owner) continue;

        const today = new Date().toISOString().slice(0, 10);
        const [[created]]     = await pool.execute(
          `SELECT COUNT(*) AS c FROM invoices WHERE business_id = ? AND DATE(created_at) = ?`,
          [biz.id, today]
        );
        const [[transmitted]] = await pool.execute(
          `SELECT COUNT(*) AS c FROM invoices WHERE business_id = ? AND status = 'transmitted' AND DATE(updated_at) = ?`,
          [biz.id, today]
        );
        const [[failed]]      = await pool.execute(
          `SELECT COUNT(*) AS c FROM invoices WHERE business_id = ? AND status = 'failed' AND DATE(updated_at) = ?`,
          [biz.id, today]
        );
        const [[revenue]]     = await pool.execute(
          `SELECT COALESCE(SUM(total_value),0) AS rev FROM invoices
           WHERE business_id = ? AND status = 'transmitted' AND DATE(updated_at) = ?`,
          [biz.id, today]
        );

        await emailSvc.sendDailySummaryEmail({
          to: owner.email,
          toName: owner.full_name,
          bizName: biz.name,
          stats: {
            created: created.c,
            transmitted: transmitted.c,
            failed: failed.c,
            revenue: parseFloat(revenue.rev || 0),
          },
        });
        console.log(`[EmailCampaign] ✓ Daily summary sent to ${owner.email} (${biz.name})`);
      }
    } catch (err) {
      console.error('[EmailCampaign] Daily summary error:', err.message);
    }
  }, { timezone: 'Europe/Athens' });

  console.log('[EmailCampaign] Cron jobs started (timezone: Europe/Athens)');
}

module.exports = { startEmailCampaigns };
