const express  = require('express');
const router   = express.Router();
const pool     = require('../config/database');
const emailSvc = require('../services/email.service');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

const VALID_PLANS  = ['basic', 'pro', 'enterprise'];
const VALID_CYCLES = ['monthly', 'semi_annual', 'annual'];
const PLAN_LIMITS  = { basic: 30, pro: 125, enterprise: -1, trial: -1 };
const WEIGHING_SLIPS_ADDON_MONTHLY = 2;

// Pricing table: plan → cycle → total amount in EUR
const PLAN_PRICING = {
  basic:      { monthly: 8,   semi_annual: 35,  annual: 60  },
  pro:        { monthly: 12,  semi_annual: 65,  annual: 65  },
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
                COALESCE(bs.feature_weighing_slips, 0) AS addon_weighing_slips,
                DATE_FORMAT(b.billing_cycle_started_at, '%Y-%m-%d') AS billing_cycle_started_at
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

    const GRACE_DAYS = 78;
    const now        = new Date();

    // Self-heal: if our DB says not active, check Wrapp directly.
    // Handles the case where Wrapp's webhook was delayed or never arrived.
    if (!biz.subscription_active) {
      try {
        const wrappSvc   = require('../services/wrapp.service');
        const wrappCheck = await wrappSvc.checkUserStatus(req.user.business_id);
        if (wrappCheck?.active_subscription) {
          const isFirst    = biz.is_first_subscription !== 0;
          const monthCount = 12 + (isFirst ? 1 : 0);
          const endDate    = new Date();
          endDate.setMonth(endDate.getMonth() + monthCount);
          await pool.execute(
            `UPDATE businesses SET subscription_active = 1, plan = 'pro', billing_cycle = 'annual',
             subscription_ends_at = ?, is_first_subscription = 0, updated_at = NOW()
             WHERE id = ? AND subscription_active = 0`,
            [endDate, req.user.business_id]
          );
          await pool.execute(
            `INSERT INTO business_settings (business_id, feature_ospa, feature_weighing_slips)
             VALUES (?, 1, 1) ON DUPLICATE KEY UPDATE feature_ospa = 1, feature_weighing_slips = 1`,
            [req.user.business_id]
          );
          biz.subscription_active = 1;
          biz.plan                = 'pro';
          biz.billing_cycle       = 'annual';
          biz.subscription_ends_at = endDate.toISOString();
          console.log(`[subscription] self-healed activation for business ${req.user.business_id} via Wrapp check`);
        }
      } catch (_) {}
    }

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

    // Count invoices and delivery notes since the later of: month start or plan renewal date
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const cycleStart = biz.billing_cycle_started_at && biz.billing_cycle_started_at > monthStart
      ? biz.billing_cycle_started_at
      : monthStart;
    const [[{ inv_used }]]  = await pool.execute(
      `SELECT COUNT(*) AS inv_used FROM invoices
       WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
      [req.user.business_id, cycleStart]
    ).catch(() => [[{ inv_used: 0 }]]);
    const [[{ dn_used }]]   = await pool.execute(
      `SELECT COUNT(*) AS dn_used FROM delivery_notes
       WHERE business_id = ? AND issue_date >= ? AND status != 'cancelled'`,
      [req.user.business_id, cycleStart]
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
          id: 'pro', name: 'FishBill Pro', color: '#7C3AED', popular: true,
          monthly_limit: 125, // = 1.500/year per Wrapp production package
          pricing: { monthly: 12, semi_annual: 65, annual: 65 },
          savings: { semi_annual: 0, annual: 79 },
          features: [
            '1.500 παραστατικά/έτος (όλων των ειδών, εκτός B2G)',
            'Διαβίβαση myDATA μέσω παρόχου ΥΠΑΗΕΣ (Wrapp)',
            'Δελτία Αποστολής με αυτόματη ακύρωση',
            'Πιστωτικά / Ακυρωτικά',
            'Επίσημο PDF από τον πάροχο',
            'Προτεραιότητα υποστήριξης',
          ],
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
      `SELECT b.name, b.afm, b.city, b.plan,
              b.billing_cycle, b.plan_price_override,
              b.subscription_ends_at, b.subscription_active,
              b.extra_dn_credits, b.extra_invoice_credits,
              b.is_first_subscription,
              u.full_name, u.email, u.phone
       FROM businesses b
       JOIN users u ON u.business_id = b.id AND u.role IN ('owner','admin')
       WHERE b.id = ? ORDER BY FIELD(u.role,'owner','admin') DESC LIMIT 1`,
      [req.user.business_id]
    );
    if (!biz) return res.status(404).json({ error: 'Δεν βρέθηκε επιχείρηση.' });

    // ── Labels ────────────────────────────────────────────────────────────────
    const planLabel = {
      basic:      'Βασικό',
      pro:        'Pro / Προηγμένο',
      enterprise: 'Enterprise / Επιχειρηματικό',
      trial:      'Δωρεάν Δοκιμή',
    }[biz.plan] ?? biz.plan;

    const cycleLabel = {
      monthly:    'Μηνιαία (1 μήνας)',
      quarterly:  'Τριμηνιαία (3 μήνες)',
      semi_annual:'Εξαμηνιαία (6 μήνες)',
      yearly:     'Ετήσια (12 μήνες)',
      annual:     'Ετήσια (12 μήνες)',
    }[biz.billing_cycle] ?? (biz.billing_cycle || '—');

    // Price: fetch from platform_settings if no override
    let priceLabel = '—';
    try {
      const priceKey = `price_${biz.plan}`;
      const [[ps]] = await pool.execute(
        'SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1', [priceKey]
      );
      const basePrice = parseFloat(biz.plan_price_override ?? ps?.setting_value ?? 0);
      if (basePrice > 0) {
        const multiplier = { monthly:1, quarterly:3, semi_annual:6, yearly:12, annual:12 }[biz.billing_cycle] ?? 1;
        priceLabel = `€${(basePrice * multiplier).toFixed(2)} / ${cycleLabel.split(' ')[0].toLowerCase()}`;
      }
    } catch (_) {}

    const endsAt   = biz.subscription_ends_at
      ? new Date(biz.subscription_ends_at).toLocaleDateString('el-GR')
      : '—';
    const sentAt   = new Date().toLocaleString('el-GR');
    const isFirst  = biz.is_first_subscription;

    // ── New subscription_ends_at after renewal ────────────────────────────────
    const cycleMonths = { monthly:1, quarterly:3, semi_annual:6, yearly:12, annual:12 }[biz.billing_cycle] ?? 1;
    const base = biz.subscription_ends_at && new Date(biz.subscription_ends_at) > new Date()
      ? new Date(biz.subscription_ends_at)
      : new Date();
    base.setMonth(base.getMonth() + cycleMonths);
    const newEndsAt = base.toLocaleDateString('el-GR');

    const row = (label, value, highlight = false) => `
      <tr>
        <td style="padding:9px 14px;background:#f5fbfc;border:1px solid #d5edf2;font-weight:600;color:#4a6572;white-space:nowrap;width:38%">${label}</td>
        <td style="padding:9px 14px;border:1px solid #d5edf2;color:${highlight ? '#0D47A1' : '#1a2e35'};font-weight:${highlight ? '800' : '700'}">${value}</td>
      </tr>`;

    await emailSvc.sendAdminActionEmail({
      subject: `💳 Ανανέωση συνδρομής — ${biz.name} (${planLabel}, ${cycleLabel.split(' ')[0]})`,
      bodyHtml: `
        <h1 style="font-size:20px;font-weight:800;color:#0D47A1;margin:0 0 6px">💳 Αίτημα Ανανέωσης Συνδρομής</h1>
        <p style="font-size:13px;color:#6b7280;margin:0 0 18px">Αποστάλθηκε: ${sentAt}</p>

        <p style="font-size:14px;color:#3a5560;margin:0 0 16px;line-height:1.65">
          Ο χρήστης <strong>${biz.full_name}</strong>
          ${biz.phone ? `(τηλ: <strong>${biz.phone}</strong>)` : ''}
          ειδοποίησε ότι πραγματοποίησε πληρωμή για ανανέωση της συνδρομής του.
        </p>

        <!-- Στοιχεία Επιχείρησης -->
        <p style="font-size:12px;font-weight:700;color:#0D47A1;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Στοιχεία Επιχείρησης</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-bottom:18px">
          ${row('Επωνυμία', biz.name)}
          ${row('ΑΦΜ', biz.afm || '—')}
          ${biz.city ? row('Πόλη', biz.city) : ''}
          ${row('Email', biz.email)}
          ${biz.phone ? row('Τηλέφωνο', biz.phone) : ''}
        </table>

        <!-- Στοιχεία Συνδρομής -->
        <p style="font-size:12px;font-weight:700;color:#0D47A1;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Στοιχεία Συνδρομής</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-bottom:18px">
          ${row('Πλάνο', planLabel, true)}
          ${row('Περίοδος χρέωσης', cycleLabel, true)}
          ${row('Τιμή', priceLabel)}
          ${row('Τρέχουσα λήξη', endsAt)}
          ${row('Νέα λήξη (εκτιμώμενη)', newEndsAt, true)}
          ${row('Πρώτη ανανέωση;', isFirst ? 'Ναι — πρώτη φορά' : 'Όχι — υπάρχουσα συνδρομή')}
        </table>

        ${(biz.extra_dn_credits > 0 || biz.extra_invoice_credits > 0) ? `
        <!-- Επιπλέον πιστώσεις -->
        <p style="font-size:12px;font-weight:700;color:#0D47A1;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Επιπλέον Πιστώσεις</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-bottom:18px">
          ${biz.extra_dn_credits > 0 ? row('Extra Δελτία Αποστολής', `+${biz.extra_dn_credits}`) : ''}
          ${biz.extra_invoice_credits > 0 ? row('Extra Τιμολόγια', `+${biz.extra_invoice_credits}`) : ''}
        </table>` : ''}

        <!-- Οδηγίες -->
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:14px 16px;margin-bottom:16px">
          <p style="margin:0;font-size:13px;color:#1e40af;font-weight:600">📋 Ενέργειες διαχειριστή</p>
          <ol style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#1e3a8a;line-height:1.8">
            <li>Ελέγξτε τις εισερχόμενες καταθέσεις / IRIS για ποσό <strong>${priceLabel}</strong></li>
            <li>Εντοπίστε την κατάθεση από <strong>${biz.name}</strong> (ΑΦΜ: ${biz.afm || '—'})</li>
            <li>Εγκρίνετε τη συνδρομή από το Admin Panel → Επιχειρήσεις → Συνδρομές</li>
            <li>Η νέα λήξη πρέπει να οριστεί περίπου στις <strong>${newEndsAt}</strong></li>
          </ol>
        </div>`,
    });

    res.json({ data: { message: 'Ο διαχειριστής ενημερώθηκε. Θα επικυρώσει την πληρωμή σύντομα.' } });
  } catch (err) { next(err); }
});

module.exports = router;
