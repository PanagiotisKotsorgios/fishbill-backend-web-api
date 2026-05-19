const express = require('express');
const router = express.Router();
const Joi = require('joi');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../middleware/audit');

router.use(authenticate);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const productSchema = Joi.object({
  code: Joi.string().max(50).optional().allow('', null),
  name: Joi.string().min(1).max(255).required(),
  description: Joi.string().max(1000).optional().allow('', null),
  unit: Joi.string().max(20).optional().default('KG'),
  default_price: Joi.number().min(0).precision(4).optional().default(0),
  vat_rate: Joi.number().valid(0, 6, 13, 24).optional().default(13),
  income_category: Joi.string().max(50).optional().allow('', null),
  is_favorite: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).optional().default(0),
  is_active: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).optional(),
  sort_order: Joi.number().integer().min(0).optional().default(0),
});

const updateProductSchema = productSchema.fork(['name'], (f) => f.optional());

// ---------------------------------------------------------------------------
// GET /api/products/favorites  — must be before /:id
// ---------------------------------------------------------------------------
router.get('/favorites', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;

    const [rows] = await pool.execute(
      `SELECT * FROM products
       WHERE business_id = ? AND is_active = 1 AND is_favorite = 1
       ORDER BY sort_order ASC, name ASC`,
      [businessId]
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/products
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const businessId = req.user.business_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM products WHERE business_id = ? AND is_active = 1',
      [businessId]
    );

    const [rows] = await pool.execute(
      `SELECT * FROM products
       WHERE business_id = ? AND is_active = 1
       ORDER BY is_favorite DESC, sort_order ASC, name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      [businessId]
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/products
// ---------------------------------------------------------------------------
router.post(
  '/',
  validate(productSchema),
  logAudit('CREATE_PRODUCT', 'product'),
  async (req, res, next) => {
    try {
      const businessId = req.user.business_id;
      const {
        code, name, description, unit, default_price,
        vat_rate, is_favorite, sort_order, income_category,
      } = req.body;

      const [result] = await pool.execute(
        `INSERT INTO products
           (business_id, code, name, description, unit, default_price, vat_rate,
            is_favorite, sort_order, income_category, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [businessId, code || null, name, description || null,
         unit || 'KG', default_price || 0, vat_rate || 13,
         is_favorite ? 1 : 0, sort_order || 0, income_category || null]
      );

      const [newProduct] = await pool.execute('SELECT * FROM products WHERE id = ?', [result.insertId]);
      res.status(201).json({ data: newProduct[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/products/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const businessId = req.user.business_id;

    const [rows] = await pool.execute(
      'SELECT * FROM products WHERE id = ? AND business_id = ? LIMIT 1',
      [id, businessId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/products/:id
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  validate(updateProductSchema),
  logAudit('UPDATE_PRODUCT', 'product'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = req.user.business_id;

      const [existing] = await pool.execute(
        'SELECT id FROM products WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!existing.length) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      const allowedFields = [
        'code', 'name', 'description', 'unit', 'default_price',
        'vat_rate', 'is_favorite', 'is_active', 'sort_order', 'income_category',
      ];
      const setClauses = [];
      const params = [];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }

      if (!setClauses.length) {
        return res.status(400).json({ error: 'No updatable fields provided.' });
      }

      setClauses.push('updated_at = NOW()');
      params.push(id);

      await pool.execute(
        `UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );

      const [updated] = await pool.execute('SELECT * FROM products WHERE id = ?', [id]);
      res.json({ data: updated[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/products/:id  — soft delete
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  logAudit('DELETE_PRODUCT', 'product'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const businessId = req.user.business_id;

      const [existing] = await pool.execute(
        'SELECT id FROM products WHERE id = ? AND business_id = ? LIMIT 1',
        [id, businessId]
      );
      if (!existing.length) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      await pool.execute(
        'UPDATE products SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [id]
      );

      res.json({ data: { message: 'Product deactivated successfully.' } });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
