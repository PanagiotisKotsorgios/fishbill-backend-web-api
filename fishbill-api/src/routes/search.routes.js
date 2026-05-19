const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/search?q=&types=&limit=
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const q = req.query.q || '';

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query parameter q must be at least 2 characters.' });
    }

    const likeQ = `%${q}%`;

    const isSuperAdmin = req.user.role === 'super_admin';
    const businessId = req.user.business_id;

    // Default types depend on role
    const defaultTypes = isSuperAdmin
      ? ['businesses', 'users', 'invoices', 'customers', 'products']
      : ['invoices', 'customers', 'products'];

    const requestedTypes = req.query.types
      ? req.query.types.split(',').map(t => t.trim()).filter(Boolean)
      : defaultTypes;

    const validTypes = ['invoices', 'customers', 'products', 'businesses', 'users'];
    const types = requestedTypes.filter(t => validTypes.includes(t));

    const rawLimit = parseInt(req.query.limit) || 5;
    const limit = Math.min(20, Math.max(1, rawLimit));

    const result = {};

    // -----------------------------------------------------------------------
    // Businesses (super_admin only)
    // -----------------------------------------------------------------------
    if (types.includes('businesses') && isSuperAdmin) {
      const [rows] = await pool.execute(
        `SELECT id, name, trade_name, afm, email, city, is_active
         FROM businesses
         WHERE name LIKE ? OR afm LIKE ? OR trade_name LIKE ? OR email LIKE ?
         ORDER BY name
         LIMIT ${limit}`,
        [likeQ, likeQ, likeQ, likeQ]
      );
      result.businesses = rows;
    }

    // -----------------------------------------------------------------------
    // Users (super_admin only)
    // -----------------------------------------------------------------------
    if (types.includes('users') && isSuperAdmin) {
      const [rows] = await pool.execute(
        `SELECT id, full_name, email, role, is_active
         FROM users
         WHERE full_name LIKE ? OR email LIKE ?
         ORDER BY full_name
         LIMIT ${limit}`,
        [likeQ, likeQ]
      );
      result.users = rows;
    }

    // -----------------------------------------------------------------------
    // Invoices
    // -----------------------------------------------------------------------
    if (types.includes('invoices')) {
      const params = [];
      let bizFilter = '';

      if (!isSuperAdmin) {
        bizFilter = 'AND i.business_id = ?';
        params.push(businessId);
      }

      params.push(likeQ, likeQ);

      const [invoiceRows] = await pool.execute(
        `SELECT i.id, i.full_number, i.issue_date, i.status, i.total_value, i.customer_id,
                c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         WHERE 1=1 ${bizFilter}
           AND (i.full_number LIKE ? OR c.name LIKE ?)
         ORDER BY i.issue_date DESC
         LIMIT ${limit}`,
        params
      );

      result.invoices = invoiceRows;
    }

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    if (types.includes('customers')) {
      const params = [];
      let bizFilter = '';

      if (!isSuperAdmin) {
        bizFilter = 'AND business_id = ?';
        params.push(businessId);
      }

      params.push(likeQ, likeQ, likeQ, likeQ);

      const [customerRows] = await pool.execute(
        `SELECT id, name, afm, city, phone, email, total_invoices, total_amount
         FROM customers
         WHERE is_active = 1 ${bizFilter}
           AND (name LIKE ? OR afm LIKE ? OR email LIKE ? OR phone LIKE ?)
         ORDER BY name
         LIMIT ${limit}`,
        params
      );

      result.customers = customerRows;
    }

    // -----------------------------------------------------------------------
    // Products
    // -----------------------------------------------------------------------
    if (types.includes('products')) {
      const params = [];
      let bizFilter = '';

      if (!isSuperAdmin) {
        bizFilter = 'AND business_id = ?';
        params.push(businessId);
      }

      params.push(likeQ, likeQ);

      const [productRows] = await pool.execute(
        `SELECT id, name, code, unit, default_price, vat_rate, is_active
         FROM products
         WHERE 1=1 ${bizFilter}
           AND (name LIKE ? OR code LIKE ?)
         ORDER BY name
         LIMIT ${limit}`,
        params
      );

      result.products = productRows;
    }

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;