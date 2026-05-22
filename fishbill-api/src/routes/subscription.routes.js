const express  = require('express');
const router   = express.Router();
const pool     = require('../config/database');
const emailSvc = require('../services/email.service');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

const VALID_PLANS  = ['basic', 'pro', 'enterprise'];
const VALID_CYCLES = ['monthly', 'semi_annual', 'annual'];
const PLAN_LIMITS  = { basic: 30, pro: 50, enterprise: -1, trial: -1 };
const WEIGHING_SLIPS_ADDON_MONTHLY = 2;

// Pricing table: plan → cycle → total amount in EUR
const PLAN_PRICING = {
  basic:      { monthly: 8,   semi_annual: 35,  annual: 60  },
  pro:        { monthly: 12,  semi_annual: 65,  annual: 120 },
  enterprise: { monthly: 30,  semi_annual: 130, annual: 240 },
};

// Cycle → months map (for human-readable descriptions)
const CYCLE_MONTHS = { monthly: 1, semi_annual: 6, annual: 12 };

// ---------------------------------------------------------------------------
// Helper: compute days until a date
// ---------------------------------------------------------------------------
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now    = new Date();
  const diffMs = target - now;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// GET /api/subscription/status
// ---------------------------------------------------------------------------
router.get('/status', async (req, res, next) => {
  try {
    let biz;
    try {
      const [rows] = await pool.execute(
        `SELECT b.plan, b.trial_ends_at, b.subscription_active, b.subscription_ends_at,
                b.auto_renew, b.billing_cycle, COALESCE(b.is_parametrised, 0) AS is_parametrised,
                COALESCE(bs.feature_ospa, 0) AS addon_ospa,
                COALESCE(bs.feature_weighing_slips, 0) AS addon_weighing_slips
         FROM businesses b
         LEFT JOIN business_settings bs ON bs.business_id = b.id
         WHERE b.id = ? LIMIT 1`,
        [req.user.business_id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Business not found.' });
      biz = rows[0];
    } catch (_) {
      // Older schema — fall back gracefully
      const [rows] = await pool.execute(
        `SELECT plan, trial_ends_at, subscription_active, subscription_ends_at
         FROM businesses WHERE id = ? LIMIT 1`,
        [req.user.business_id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Business not found.' });
      biz = { ...rows[0], auto_renew: 1, billing_cycle: 'monthly', is_parametrised: 0, addon_ospa: 0, addon_weighing_slips: 0 };
    }

    const GRACE_DAYS         = 78;
    const now                = new Date();
    const trialActive        = biz.trial_ends_at && new Date(biz.trial_ends_at) > now;
    const subscriptionActive = biz.subscription_active === 1;
    const graceUntil         = biz.subscription_ends_at
      ? new Date(new Date(biz.subscription_ends_at).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000)
      : null;
    const inGracePeriod      = !subscriptionActive && graceUntil && graceUntil > now;
    const hasAccess          = trialActive || subscriptionActive || inGracePeriod;
    const monthlyLimit       = PLAN_LIMITS[biz.plan] ?? -1;

    const trialDaysRemaining = trialActive        ? daysUntil(biz.trial_ends_at)        : null;
    const daysUntilRenewal   = subscriptionActive ? daysUntil(biz.subscription_ends_at) : null;
    const graceDaysRemaining = inGracePeriod && graceUntil
      ? Math.max(0, Math.ceil((graceUntil - now) / (1000 * 60 * 60 * 24)))
      : null;

    const cycle = biz.billing_cycle || 'monthly';

    // Count invoices and delivery notes used this calendar month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const [[{ inv_used }]]  = await pool.execute(
      `SELECT COUNT(*) AS inv_used FROM invoices
       WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
      [req.user.business_id, monthStart]
    ).catch(() => [[{ inv_used: 0 }]]);
    const [[{ dn_used }]]   = await pool.execute(
      `SELECT COUNT(*) AS dn_used FROM delivery_notes
       WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
      [req.user.business_id, monthStart]
    ).catch(() => [[{ dn_used: 0 }]]);

    const invoicesUsed   = Number(inv_used  || 0);
    const dnUsed         = Number(dn_used   || 0);
    const invoicesLeft   = monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - invoicesUsed);
    const dnLeft         = monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - dnUsed);

    const planPrice = PLAN_PRICING[biz.plan]?.[cycle] ?? null;

    res.json({
      data: {
        plan:                    biz.plan || 'trial',
        billing_cycle:           cycle,
        trial_ends_at:           biz.trial_ends_at          || null,
        trial_active:            !!trialActive,
        subscription_active:     subscriptionActive,
        subscription_ends_at:    biz.subscription_ends_at   || null,
        has_access:              !!hasAccess,
        monthly_limit:           monthlyLimit,
        monthly_dn_limit:        monthlyLimit,
        invoices_used:           invoicesUsed,
        invoices_remaining:      invoicesLeft,
        dn_used:                 dnUsed,
        dn_remaining:            dnLeft,
        plan_price_eur:          planPrice,
        in_grace_period:         !!inGracePeriod,
        grace_days_remaining:    graceDaysRemaining ?? null,
        auto_renew:              biz.auto_renew === 1 || biz.auto_renew === true,
        days_until_renewal:      daysUntilRenewal   ?? null,
        trial_days_remaining:    trialDaysRemaining ?? null,
        is_parametrised:         biz.is_parametrised === 1 || biz.is_parametrised === true,
        addon_ospa:              biz.addon_ospa === 1 || biz.addon_ospa === true,
        addon_weighing_slips:    biz.addon_weighing_slips === 1 || biz.addon_weighing_slips === true,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/subscription/request  — user selects a plan + billing cycle
// ---------------------------------------------------------------------------
router.post('/request', async (req, res, next) => {
  try {
    const {
      plan,
      billing_cycle = 'monthly',
      addon_ospa = false,
      addon_weighing_slips = false,
    } = req.body;

    if (!VALID_PLANS.includes(plan)) {
      return res.status(400).json({ error: `Μη έγκυρο πλάνο. Επιλέξτε: ${VALID_PLANS.join(', ')}` });
    }
    if (!VALID_CYCLES.includes(billing_cycle)) {
      return res.status(400).json({ error: `Μη έγκυρος κύκλος χρέωσης. Επιλέξτε: ${VALID_CYCLES.join(', ')}` });
    }

    const price  = PLAN_PRICING[plan]?.[billing_cycle] ?? PLAN_PRICING[plan]?.monthly;
    const months = CYCLE_MONTHS[billing_cycle] ?? 1;

    try {
      await pool.execute(
        'UPDATE businesses SET plan = ?, billing_cycle = ?, updated_at = NOW() WHERE id = ?',
        [plan, billing_cycle, req.user.business_id]
      );
    } catch (_) {
      // billing_cycle column may not exist yet — fallback
      await pool.execute(
        'UPDATE businesses SET plan = ?, updated_at = NOW() WHERE id = ?',
        [plan, req.user.business_id]
      );
    }

    const toBool = v => v === true || v === 1 || v === '1' || v === 'true';
    const addonOspaSent     = req.body.addon_ospa !== undefined;
    const addonWeighingSent = req.body.addon_weighing_slips !== undefined;

    // Fetch existing addon settings so we never silently reset them
    let wantsOspa = false;
    let wantsWeighing = false;
    try {
      const [[existing]] = await pool.execute(
        'SELECT feature_ospa, feature_weighing_slips FROM business_settings WHERE business_id = ? LIMIT 1',
        [req.user.business_id]
      );
      if (existing) {
        wantsOspa     = existing.feature_ospa === 1;
        wantsWeighing = existing.feature_weighing_slips === 1;
      }
    } catch (_) {}

    // Only override if the client explicitly sent the field
    if (addonOspaSent)     wantsOspa     = toBool(req.body.addon_ospa);
    if (addonWeighingSent) wantsWeighing = toBool(req.body.addon_weighing_slips);

    try {
      await pool.execute(
        `INSERT INTO business_settings (business_id, feature_ospa, feature_weighing_slips)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           feature_ospa = VALUES(feature_ospa),
           feature_weighing_slips = VALUES(feature_weighing_slips)`,
        [req.user.business_id, wantsOspa ? 1 : 0, wantsWeighing ? 1 : 0]
      );
    } catch (e) {
      console.warn('[subscription/request] feature flag save skipped:', e.message);
    }

    const addonTotal =
      (wantsOspa ? 10 * months : 0) +
      (wantsWeighing ? WEIGHING_SLIPS_ADDON_MONTHLY * months : 0);
    const totalPrice = price + addonTotal;

    const cycleLabels = { monthly: 'μηνιαία', semi_annual: '6μηνη', annual: 'ετήσια' };

    res.json({
      data: {
        message:       `Αίτημα για ${plan} (${cycleLabels[billing_cycle]}) καταγράφηκε. Η ενεργοποίηση γίνεται εντός 24ωρών μετά την πληρωμή.`,
        plan,
        billing_cycle,
        addon_ospa: wantsOspa,
        addon_weighing_slips: wantsWeighing,
        base_price_eur: price,
        price_eur: totalPrice,
        months,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/subscription/cancel  — cancel active subscription
// ---------------------------------------------------------------------------
router.post('/cancel', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT subscription_active FROM businesses WHERE id = ? LIMIT 1',
      [req.user.business_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Business not found.' });
    if (!rows[0].subscription_active) {
      return res.status(400).json({ error: 'Δεν υπάρχει ενεργή συνδρομή για ακύρωση.' });
    }

    try {
      await pool.execute(
        'UPDATE businesses SET auto_renew = 0, updated_at = NOW() WHERE id = ?',
        [req.user.business_id]
      );
    } catch (_) { /* auto_renew may not exist */ }

    res.json({
      data: {
        message: 'Η συνδρομή σας έχει ακυρωθεί. Θα παραμείνει ενεργή μέχρι τη λήξη της τρέχουσας περιόδου.',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/subscription/autorenew  — toggle auto-renew
// ---------------------------------------------------------------------------
router.patch('/autorenew', async (req, res, next) => {
  try {
    const { auto_renew } = req.body;
    if (typeof auto_renew !== 'boolean' && auto_renew !== 0 && auto_renew !== 1) {
      return res.status(400).json({ error: 'auto_renew must be a boolean.' });
    }

    const val = (auto_renew === true || auto_renew === 1) ? 1 : 0;
    try {
      await pool.execute(
        'UPDATE businesses SET auto_renew = ?, updated_at = NOW() WHERE id = ?',
        [val, req.user.business_id]
      );
    } catch (_) { /* column may not exist yet */ }

    res.json({
      data: {
        auto_renew: val === 1,
        message:    val === 1
          ? 'Η αυτόματη ανανέωση ενεργοποιήθηκε.'
          : 'Η αυτόματη ανανέωση απενεργοποιήθηκε.',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/subscription/pricing  — public pricing table (no auth, no internal add-ons)
// ---------------------------------------------------------------------------
router.get('/pricing', (req, res) => {
  res.json({
    data: {
      plans: [
        {
          id: 'basic', name: 'Basic', color: '#1976D2',
          monthly_limit: 30,
          pricing: { monthly: 8, semi_annual: 35, annual: 60 },
          savings: { semi_annual: 13, annual: 36 },
          features: ['Έκδοση τιμολογίων', 'Δελτία αποστολής', 'PDF εξαγωγή', 'Email υποστήριξη'],
        },
        {
          id: 'pro', name: 'Pro', color: '#7C3AED', popular: true,
          monthly_limit: 50,
          pricing: { monthly: 15, semi_annual: 65, annual: 120 },
          savings: { semi_annual: 25, annual: 60 },
          features: ['Έκδοση τιμολογίων', 'Δελτία αποστολής', 'PDF εξαγωγή', 'Προηγμένα στατιστικά', 'Προτεραιότητα υποστήριξης'],
        },
        {
          id: 'enterprise', name: 'Enterprise', color: '#D97706',
          monthly_limit: -1,
          pricing: { monthly: 30, semi_annual: 130, annual: 240 },
          savings: { semi_annual: 50, annual: 120 },
          features: ['Απεριόριστα τιμολόγια', 'Δελτία αποστολής', 'PDF εξαγωγή', 'Πλήρη στατιστικά', 'Αφιερωμένη υποστήριξη', 'API πρόσβαση'],
        },
      ],
      cycles: [
        { id: 'monthly',     label: 'Μηνιαίο',  months: 1  },
        { id: 'semi_annual', label: '6 Μήνες',  months: 6  },
        { id: 'annual',      label: 'Ετήσιο',   months: 12, recommended: true },
      ],
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/subscription/package-details  — full package breakdown (auth required)
// Shows add-on pricing — visible only to logged-in users
// ---------------------------------------------------------------------------
router.get('/package-details', (req, res) => {
  res.json({
    data: {
      plans: [
        {
          id: 'basic', name: 'Basic',
          pricing: PLAN_PRICING.basic,
          savings: { semi_annual: 13, annual: 36 },
          monthly_limit: 30,
          features: [
            { label: 'Έκδοση τιμολογίων (30/μήνα)', included: true },
            { label: 'Δελτία αποστολής',              included: true },
            { label: 'PDF εξαγωγή & email',           included: true },
          ],
          include_weighing_slips: false,
        },
        {
          id: 'pro', name: 'Pro', popular: true,
          pricing: PLAN_PRICING.pro,
          savings: { semi_annual: 25, annual: 60 },
          monthly_limit: 50,
          features: [
            { label: 'Έκδοση τιμολογίων (50/μήνα)', included: true },
            { label: 'Δελτία αποστολής',              included: true },
            { label: 'PDF εξαγωγή & email',           included: true },
            { label: 'Προηγμένα στατιστικά',          included: true },
          ],
          include_weighing_slips: false,
        },
        {
          id: 'enterprise', name: 'Enterprise',
          pricing: PLAN_PRICING.enterprise,
          savings: { semi_annual: 50, annual: 120 },
          monthly_limit: -1,
          features: [
            { label: 'Απεριόριστα τιμολόγια',         included: true },
            { label: 'Δελτία αποστολής (απεριόριστα)', included: true },
            { label: 'PDF εξαγωγή & email',            included: true },
            { label: 'Πλήρη στατιστικά & API',         included: true },
            { label: 'Αφιερωμένη υποστήριξη',          included: true },
          ],
          include_weighing_slips: false,
        },
      ],
      addons: [
        {
          id: 'ospa',
          name: 'OSPA — Συμπλήρωση από εμάς',
          price_monthly: 13,
          description: 'Η ομάδα της FishBill αναλαμβάνει την ηλεκτρονική υποβολή των Ονομαστικών Στοιχείων Προσωπικής Απόδοσης (ΟΣΠΑ) για λογαριασμό σας κάθε μήνα.',
          details: [
            'Ηλεκτρονική υποβολή ΟΣΠΑ',
            'Έλεγχος δεδομένων πριν υποβολή',
            'Επιβεβαίωση υποβολής με email',
            'Διαθέσιμο σε όλα τα πλάνα',
          ],
        },
      ],
      cycles: [
        { id: 'monthly',     label: 'Μηνιαίο',  months: 1  },
        { id: 'semi_annual', label: '6 Μήνες',  months: 6  },
        { id: 'annual',      label: 'Ετήσιο',   months: 12, recommended: true },
      ],
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/subscription/notify-renewal — user taps "Ενημέρωση Πληρωμής"
// Sends an email to the admin so they know to look for and confirm the payment.
// ---------------------------------------------------------------------------
router.post('/notify-renewal', async (req, res, next) => {
  try {
    const [[biz]] = await pool.execute(
      `SELECT b.name, b.afm, b.plan, b.subscription_ends_at,
              u.full_name, u.email
       FROM businesses b
       JOIN users u ON u.business_id = b.id AND u.role IN ('owner','admin')
       WHERE b.id = ? ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1`,
      [req.user.business_id]
    );
    if (!biz) return res.status(404).json({ error: 'Δεν βρέθηκε επιχείρηση.' });

    const planLabel = { basic: 'Βασικό', pro: 'Pro', enterprise: 'Enterprise', trial: 'Δοκιμαστικό' }[biz.plan] ?? biz.plan;
    const endsAt    = biz.subscription_ends_at
      ? new Date(biz.subscription_ends_at).toLocaleDateString('el-GR')
      : '—';

    await emailSvc.sendAdminActionEmail({
      subject: `Ενημέρωση πληρωμής συνδρομής — ${biz.name}`,
      bodyHtml: `
        <h1 style="font-size:20px;font-weight:800;color:#0D47A1;margin:0 0 12px">💳 Ενημέρωση Ανανέωσης Συνδρομής</h1>
        <p style="font-size:14px;color:#3a5560;margin:0 0 16px">
          Ο χρήστης <strong>${biz.full_name}</strong> (${biz.email}) ενημέρωσε ότι έχει πραγματοποιήσει πληρωμή ανανέωσης συνδρομής.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
          ${[['Επιχείρηση', biz.name], ['ΑΦΜ', biz.afm || '—'], ['Πλάνο', planLabel], ['Τρέχουσα λήξη', endsAt]]
            .map(([k,v]) => `<tr>
              <td style="padding:8px 12px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572;width:40%">${k}</td>
              <td style="padding:8px 12px;border:1px solid #d5edf2;color:#1a2e35;font-weight:700">${v}</td>
            </tr>`).join('')}
        </table>
        <p style="font-size:13px;color:#6b7280;">Ελέγξτε τις εισερχόμενες καταθέσεις και εγκρίνετε τη συνδρομή από το admin panel.</p>`,
    });

    res.json({ data: { message: 'Ο διαχειριστής ενημερώθηκε. Θα επικυρώσει την πληρωμή σύντομα.' } });
  } catch (err) { next(err); }
});

module.exports = router;
