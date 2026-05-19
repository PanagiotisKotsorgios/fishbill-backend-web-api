/**
 * Dashboard routes — purpose-built endpoints for the admin dashboard.
 * Aggregates stats, chart data, and top customers in the exact shape the frontend expects.
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/dashboard/stats
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString().slice(0, 10);

    // Active businesses (super_admin sees all, others just their own = 1)
    let activeBusinesses = 1;
    if (isSuperAdmin) {
      const [biz] = await pool.execute(
        'SELECT COUNT(*) AS cnt FROM businesses WHERE is_active = 1'
      );
      activeBusinesses = biz[0].cnt;
    }

    const [totalInv] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond}`,
      bizParams
    );

    const [todayInv] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond} AND DATE(issue_date) = ?`,
      [...bizParams, today]
    );

    const [failedInv] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond} AND status = 'failed'`,
      bizParams
    );

    const [revenue] = await pool.execute(
      `SELECT COALESCE(SUM(total_value), 0) AS total
       FROM invoices
       WHERE ${bizCond} AND issue_date >= ? AND status != 'cancelled'`,
      [...bizParams, monthStart]
    );

    const [monthlyInv] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices
       WHERE ${bizCond} AND issue_date >= ? AND status != 'cancelled'`,
      [...bizParams, monthStart]
    );

    const [transmitted] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond} AND status = 'transmitted'`,
      bizParams
    );

    const [monthlyDN] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM delivery_notes
       WHERE ${bizCond} AND issue_date >= ? AND status != 'cancelled'`,
      [...bizParams, monthStart]
    );

    res.json({
      stats: {
        activeBusinesses,
        totalInvoices: totalInv[0].cnt,
        todayInvoices: todayInv[0].cnt,
        monthlyInvoices: monthlyInv[0].cnt,
        failedTransmissions: failedInv[0].cnt,
        transmittedCount: transmitted[0].cnt,
        monthlyRevenue: parseFloat(revenue[0].total),
        monthlyDeliveryNotes: monthlyDN[0].cnt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/chart?days=30
// ---------------------------------------------------------------------------
router.get('/chart', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const [rows] = await pool.execute(
      `SELECT
         DATE(issue_date) AS date,
         COUNT(*) AS count,
         COALESCE(SUM(total_value), 0) AS amount
       FROM invoices
       WHERE ${bizCond} AND issue_date >= ? AND status != 'cancelled'
       GROUP BY DATE(issue_date)
       ORDER BY date ASC`,
      [...bizParams, dateFrom]
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/top-customers
// ---------------------------------------------------------------------------
router.get('/top-customers', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'c.business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const [rows] = await pool.execute(
      `SELECT
         c.id, c.name, c.afm, c.city,
         COUNT(i.id) AS invoiceCount,
         COALESCE(SUM(i.total_value), 0) AS totalAmount
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'cancelled'
       WHERE ${bizCond} AND c.is_active = 1
       GROUP BY c.id
       HAVING invoiceCount > 0
       ORDER BY totalAmount DESC
       LIMIT 8`,
      bizParams
    );

    res.json({ customers: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
