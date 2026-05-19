const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/stats/overview
// ---------------------------------------------------------------------------
router.get('/overview', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';

    const bizCond = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const invCond = isSuperAdmin ? '1=1' : 'i.business_id = ?';

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    // Total businesses (super_admin) or just 1
    let totalBusinesses = 1;
    if (isSuperAdmin) {
      const [biz] = await pool.execute('SELECT COUNT(*) AS cnt FROM businesses WHERE is_active = 1', []);
      totalBusinesses = biz[0].cnt;
    }

    // Total users
    const [users] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE ${bizCond} AND is_active = 1`,
      bizParams
    );

    // Total invoices
    const [invoices] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond}`,
      bizParams
    );

    // Today invoices
    const [todayInv] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond} AND DATE(issue_date) = ?`,
      [...bizParams, today]
    );

    // Failed count
    const [failed] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond} AND status = 'failed'`,
      bizParams
    );

    // Transmitted count
    const [transmitted] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE ${bizCond} AND status = 'transmitted'`,
      bizParams
    );

    // Revenue this month
    const [revenue] = await pool.execute(
      `SELECT COALESCE(SUM(total_value), 0) AS total
       FROM invoices
       WHERE ${bizCond} AND issue_date >= ? AND status != 'cancelled'`,
      [...bizParams, monthStart]
    );

    // MRR (super_admin only — would be subscription-based revenue)
    let mrr = 0;
    if (isSuperAdmin) {
      // Placeholder: would query a subscriptions table
      // For now, estimate based on active businesses × avg plan value
      const [plans] = await pool.execute(
        `SELECT subscription_plan, COUNT(*) AS cnt
         FROM businesses WHERE is_active = 1 GROUP BY subscription_plan`,
        []
      );
      const planValues = { free: 0, basic: 29, pro: 79, enterprise: 199 };
      mrr = plans.reduce((sum, p) => sum + (planValues[p.subscription_plan] || 0) * p.cnt, 0);
    }

    res.json({
      data: {
        totalBusinesses,
        totalUsers: users[0].cnt,
        totalInvoices: invoices[0].cnt,
        todayInvoices: todayInv[0].cnt,
        failedCount: failed[0].cnt,
        transmittedCount: transmitted[0].cnt,
        revenueThisMonth: parseFloat(revenue[0].total),
        mrr,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats/invoices-by-day  — last 30 days
// ---------------------------------------------------------------------------
router.get('/invoices-by-day', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const [rows] = await pool.execute(
      `SELECT
         DATE(issue_date) AS date,
         COUNT(*) AS invoice_count,
         COALESCE(SUM(total_value), 0) AS revenue
       FROM invoices
       WHERE ${bizCond} AND issue_date >= ? AND status != 'cancelled'
       GROUP BY DATE(issue_date)
       ORDER BY date ASC`,
      [...bizParams, thirtyDaysAgo]
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats/top-customers
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
         COUNT(i.id) AS invoice_count,
         COALESCE(SUM(i.total_value), 0) AS total_revenue
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'cancelled'
       WHERE ${bizCond} AND c.is_active = 1
       GROUP BY c.id
       ORDER BY total_revenue DESC
       LIMIT 5`,
      bizParams
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats/revenue  — revenue by period
// ---------------------------------------------------------------------------
router.get('/revenue', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];

    const period = req.query.period || 'month'; // week | month | year

    let groupBy, dateFrom;
    const now = new Date();

    if (period === 'week') {
      dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      groupBy = "DATE(issue_date)";
    } else if (period === 'year') {
      dateFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      groupBy = "DATE_FORMAT(issue_date, '%Y-%m')";
    } else {
      // month (default)
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      groupBy = "DATE(issue_date)";
    }

    const [rows] = await pool.execute(
      `SELECT
         ${groupBy} AS period,
         COUNT(*) AS invoice_count,
         COALESCE(SUM(total_value), 0) AS revenue,
         COALESCE(SUM(net_value), 0) AS net_revenue,
         COALESCE(SUM(vat_amount), 0) AS vat_total
       FROM invoices
       WHERE ${bizCond} AND issue_date >= ? AND status != 'cancelled'
       GROUP BY ${groupBy}
       ORDER BY period ASC`,
      [...bizParams, dateFrom]
    );

    const totalRevenue = rows.reduce((sum, r) => sum + parseFloat(r.revenue), 0);

    res.json({ data: rows, period, totalRevenue });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats/top-products  — top product descriptions by revenue
// ---------------------------------------------------------------------------
router.get('/top-products', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'i.business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];
    const limit = Math.min(20, parseInt(req.query.limit) || 5);

    const [rows] = await pool.execute(
      `SELECT
         il.description,
         il.unit,
         SUM(il.quantity) AS total_quantity,
         COALESCE(SUM(il.total_value), 0) AS total_value,
         COUNT(DISTINCT il.invoice_id) AS invoice_count
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       WHERE ${bizCond} AND i.status != 'cancelled'
       GROUP BY il.description, il.unit
       ORDER BY total_value DESC
       LIMIT ${limit}`,
      bizParams
    );

    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/stats/monthly  — monthly invoice count + revenue
// ---------------------------------------------------------------------------
router.get('/monthly', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];
    const months = Math.min(24, parseInt(req.query.months) || 6);

    const [rows] = await pool.execute(
      `SELECT
         DATE_FORMAT(issue_date, '%Y-%m') AS month,
         COUNT(*) AS invoice_count,
         COALESCE(SUM(total_value), 0) AS total_value,
         COALESCE(SUM(net_value), 0) AS net_value
       FROM invoices
       WHERE ${bizCond}
         AND status != 'cancelled'
         AND issue_date >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)
       GROUP BY DATE_FORMAT(issue_date, '%Y-%m')
       ORDER BY month ASC`,
      bizParams
    );

    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/stats/summary  — summary for a given number of days
// ---------------------------------------------------------------------------
router.get('/summary', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const bizCond = isSuperAdmin ? '1=1' : 'business_id = ?';
    const bizParams = isSuperAdmin ? [] : [businessId];
    const days = Math.min(366, parseInt(req.query.days) || 30);

    const [[inv]] = await pool.execute(
      `SELECT COUNT(*) AS invoice_count,
              COALESCE(SUM(total_value),0) AS total_gross,
              COALESCE(SUM(net_value),0)   AS total_net,
              COALESCE(SUM(vat_amount),0)  AS total_vat,
              COUNT(DISTINCT customer_id)  AS unique_customers
       FROM invoices
       WHERE ${bizCond} AND status != 'cancelled'
         AND issue_date >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`,
      bizParams
    );

    res.json({ data: { ...inv, days } });
  } catch (err) { next(err); }
});

module.exports = router;
