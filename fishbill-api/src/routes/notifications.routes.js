const express = require('express');
const router = express.Router();
const Joi = require('joi');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const onlyUnread = req.query.unread === '1';
    const readCondition = onlyUnread ? 'AND is_read = 0' : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? ${readCondition}`,
      [userId]
    );

    const [rows] = await pool.execute(
      `SELECT * FROM notifications
       WHERE user_id = ? ${readCondition}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [userId]
    );

    const [unreadCount] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );

    res.json({
      data: rows,
      total: countRows[0].total,
      unread_count: unreadCount[0].cnt,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/:id/read
// ---------------------------------------------------------------------------
router.post('/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [existing] = await pool.execute(
      'SELECT id FROM notifications WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );

    if (!existing.length) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    res.json({ data: { message: 'Notification marked as read.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all
// ---------------------------------------------------------------------------
router.post('/read-all', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [result] = await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [userId]
    );

    res.json({
      data: {
        message: 'All notifications marked as read.',
        updated: result.affectedRows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/broadcast  (super_admin only)
// Body: { title, body, target, type }
// target: 'all' | 'owners' | 'trial' | 'basic' | 'pro' | 'business'
// ---------------------------------------------------------------------------
router.post('/broadcast', async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Απαιτείται ρόλος super_admin.' });
    }
    const { title, body, target = 'all', type = 'info' } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title και body απαιτούνται.' });

    // Build user query based on target
    let userWhere = 'u.is_active = 1';
    const userParams = [];

    if (target === 'owners') {
      userWhere += " AND u.role = 'owner'";
    } else if (target === 'trial') {
      userWhere += " AND u.role = 'owner' AND b.plan = 'trial'";
    } else if (['basic','pro','business','enterprise'].includes(target)) {
      userWhere += ' AND u.role = ? AND b.plan = ?';
      userParams.push('owner', target);
    }

    const [users] = await pool.execute(
      `SELECT u.id FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE ${userWhere}`,
      userParams
    );

    if (!users.length) return res.json({ data: { message: 'Δεν βρέθηκαν χρήστες.', count: 0 } });

    // Batch insert notifications
    for (const u of users) {
      await pool.execute(
        'INSERT INTO notifications (id, user_id, type, title, message, is_read) VALUES (UUID(),?,?,?,?,0)',
        [u.id, type, title, body]
      );
    }

    res.json({ data: { message: `Ανακοίνωση στάλθηκε σε ${users.length} χρήστες.`, count: users.length } });
  } catch (err) { next(err); }
});

module.exports = router;
