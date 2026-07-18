const express = require('express');
const pool    = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const [[inv]] = await pool.execute(
      `SELECT
         COUNT(*)                       AS total,
         COALESCE(SUM(total_amount),0)  AS revenue,
         SUM(CASE WHEN my_data_mark IS NOT NULL THEN 1 ELSE 0 END) AS issued,
         SUM(CASE WHEN draft = 1 THEN 1 ELSE 0 END)                AS drafts,
         SUM(CASE WHEN cancelled_by_mark IS NOT NULL THEN 1 ELSE 0 END) AS cancelled
       FROM ag_invoices WHERE business_id = ?`,
      [req.user.business_id]
    );
    const [[dn]] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN cancelled_by_mark IS NOT NULL THEN 1 ELSE 0 END) AS cancelled
         FROM ag_delivery_notes WHERE business_id = ?`,
      [req.user.business_id]
    );
    const [[cust]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM ag_customers WHERE business_id = ?',
      [req.user.business_id]
    );

    res.json({
      data: {
        invoices:         inv,
        delivery_notes:   dn,
        customers_total:  cust.total,
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
