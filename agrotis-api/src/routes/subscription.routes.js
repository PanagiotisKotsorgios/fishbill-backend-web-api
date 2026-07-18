const express = require('express');
const pool    = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Single-plan model — Αγρότης Pro (mirrors FishBill Pro): 1500 docs/year @ €65.
const PLAN = {
  id:          'agrotis-pro',
  name:        'Αγρότης Pro',
  description: 'Αγρότης Pro — Ηλεκτρονική τιμολόγηση + Wrapp myDATA ΥΠΑΗΕΣ (staging)',
  monthly_limit: 125,
  yearly_limit:  1500,
  pricing: { monthly: 6, annual: 65 },
  features: [
    '1.500 παραστατικά ετησίως (τιμολόγια + δελτία αποστολής)',
    'myDATA ΥΠΑΗΕΣ μέσω Wrapp (staging sandbox)',
    'Αυτόματη διαβίβαση στην ΑΑΔΕ',
    'Δελτία ζύγισης προϊόντων & OSPA',
    'PDF εξαγωγή — Email & τηλεφωνική υποστήριξη',
  ],
};

router.get('/plan', (req, res) => res.json({ data: PLAN }));

router.get('/status', async (req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      `SELECT plan, status, current_period_end, docs_used_this_period, docs_limit_this_period
         FROM ag_subscriptions WHERE business_id = ? LIMIT 1`,
      [req.user.business_id]
    );
    res.json({ data: row || {
      plan: 'trial', status: 'trial',
      current_period_end: null,
      docs_used_this_period: 0,
      docs_limit_this_period: 50,
    }});
  } catch (e) { next(e); }
});

module.exports = router;
