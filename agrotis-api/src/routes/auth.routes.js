const express = require('express');
const bcrypt  = require('bcrypt');
const Joi     = require('joi');
const { v4: uuid } = require('uuid');

const pool = require('../config/database');
const { signAccess, signRefresh, verify, requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ── POST /auth/register ────────────────────────────────────────────────────
const registerSchema = Joi.object({
  business_name:    Joi.string().min(2).max(200).required(),
  business_afm:     Joi.string().length(9).pattern(/^\d+$/).required(),
  owner_name:       Joi.string().min(2).max(200).required(),
  owner_email:      Joi.string().email().required(),
  owner_password:   Joi.string().min(8).max(200).required(),
  business_doy:     Joi.string().allow('', null).max(200),
  business_address: Joi.string().allow('', null).max(200),
  business_city:    Joi.string().allow('', null).max(100),
  business_phone:   Joi.string().allow('', null).max(50),
  business_email:   Joi.string().email().allow('', null),
  // Backwards-compat: some clients still send this — accepted and ignored.
  fishing_license:  Joi.string().allow('', null).max(200),
}).unknown(true);

router.post('/register', async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const [existing] = await pool.execute(
      'SELECT id FROM ag_users WHERE email = ? LIMIT 1',
      [value.owner_email.toLowerCase()]
    );
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(value.owner_password, 12);
    const businessId   = uuid();
    const userId       = uuid();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        `INSERT INTO ag_businesses
           (id, name, afm, doy, address, city, phone, email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [businessId, value.business_name, value.business_afm,
         value.business_doy || null, value.business_address || null,
         value.business_city || null, value.business_phone || null,
         value.business_email || null]
      );

      await conn.execute(
        `INSERT INTO ag_users
           (id, business_id, name, email, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?, 'owner', NOW())`,
        [userId, businessId, value.owner_name,
         value.owner_email.toLowerCase(), passwordHash]
      );

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    logger.info(`Registered new agrotis user ${value.owner_email} (business ${businessId})`);

    const payload = { sub: userId, business_id: businessId, role: 'owner' };
    res.json({
      data: {
        access_token:  signAccess(payload),
        refresh_token: signRefresh(payload),
        user: {
          id: userId, name: value.owner_name, role: 'owner',
          business_id: businessId, business_name: value.business_name,
          email: value.owner_email, business_afm: value.business_afm,
        },
      },
    });
  } catch (e) { next(e); }
});

// ── POST /auth/login ───────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.business_id,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_users u
         LEFT JOIN ag_businesses b ON b.id = u.business_id
        WHERE u.email = ? LIMIT 1`,
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    await pool.execute('UPDATE ag_users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    const payload = { sub: user.id, business_id: user.business_id, role: user.role };
    res.json({
      data: {
        access_token:  signAccess(payload),
        refresh_token: signRefresh(payload),
        user: {
          id: user.id, name: user.name, role: user.role,
          business_id: user.business_id, business_name: user.business_name,
          email: user.email, business_afm: user.business_afm,
        },
      },
    });
  } catch (e) { next(e); }
});

// ── POST /auth/refresh ─────────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });
  try {
    const p = verify(refresh_token);
    if (p.kind !== 'refresh') return res.status(401).json({ error: 'Not a refresh token' });
    const payload = { sub: p.sub, business_id: p.business_id, role: p.role };
    res.json({ data: {
      access_token:  signAccess(payload),
      refresh_token: signRefresh(payload),
    }});
  } catch { res.status(401).json({ error: 'Invalid refresh token' }); }
});

// ── GET /auth/me ───────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role, u.business_id,
              b.name AS business_name, b.afm AS business_afm
         FROM ag_users u
         LEFT JOIN ag_businesses b ON b.id = u.business_id
        WHERE u.id = ? LIMIT 1`,
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ data: rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
