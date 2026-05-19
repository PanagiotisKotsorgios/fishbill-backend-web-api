'use strict';

const express = require('express');
const router  = express.Router();
const emailSvc = require('../services/email.service');

// In-memory OTP store: userId -> { code, expires }
const _otpStore = new Map();

// Cleanup expired entries every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _otpStore.entries()) {
    if (val.expires < now) _otpStore.delete(key);
  }
}, 10 * 60 * 1000);

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Μόνο super admin.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /api/admin/otp/request  — generate & email 6-digit code
// ---------------------------------------------------------------------------
router.post('/request', requireSuperAdmin, async (req, res, next) => {
  try {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = Date.now() + 5 * 60 * 1000; // 5 min

    _otpStore.set(String(req.user.id), { code, expires });

    const cfg = await emailSvc.loadConfig();
    const toEmail = cfg.admin_notification_email || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';

    await emailSvc.sendAdminOtpEmail(toEmail, code);

    res.json({ data: { message: 'Κωδικός εστάλη.', email: toEmail.replace(/(.{2}).+(@.+)/, '$1***$2') } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/otp/verify  — verify code
// ---------------------------------------------------------------------------
router.post('/verify', requireSuperAdmin, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Απαιτείται κωδικός.' });
    }

    const entry = _otpStore.get(String(req.user.id));
    if (!entry) {
      return res.status(400).json({ error: 'Δεν υπάρχει ενεργός κωδικός. Ζητήστε νέο.' });
    }
    if (Date.now() > entry.expires) {
      _otpStore.delete(String(req.user.id));
      return res.status(400).json({ error: 'Ο κωδικός έληξε. Ζητήστε νέο.' });
    }
    if (entry.code !== code.trim()) {
      return res.status(400).json({ error: 'Λάθος κωδικός.' });
    }

    // Consume OTP after successful verify
    _otpStore.delete(String(req.user.id));

    res.json({ data: { valid: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
