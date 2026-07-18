const express = require('express');
const Joi     = require('joi');
const { v4: uuid } = require('uuid');

const pool   = require('../config/database');
const wrapp  = require('../services/wrapp-staging.service');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

// ── GET /invoices ──────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM ag_invoices WHERE business_id = ?',
      [req.user.business_id]
    );
    const [rows] = await pool.execute(
      `SELECT id, series, num, invoice_type, customer_name, customer_afm,
              total_amount, my_data_mark, wrapp_qr_url, cancelled_by_mark,
              draft, created_at
         FROM ag_invoices
        WHERE business_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [req.user.business_id, limit, offset]
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// ── GET /invoices/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [[inv]] = await pool.execute(
      'SELECT * FROM ag_invoices WHERE id = ? AND business_id = ? LIMIT 1',
      [req.params.id, req.user.business_id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const [lines] = await pool.execute(
      'SELECT * FROM ag_invoice_lines WHERE invoice_id = ? ORDER BY line_number',
      [inv.id]
    );
    res.json({ data: { ...inv, lines } });
  } catch (e) { next(e); }
});

// ── POST /invoices ─────────────────────────────────────────────────────────
const createSchema = Joi.object({
  invoice_type:    Joi.string().valid('1.1','2.1','11.1','11.2','5.1','5.2','9.3').required(),
  billing_book_id: Joi.string().required(),
  customer:        Joi.object({
    name:         Joi.string().required(),
    afm:          Joi.string().allow('', null),
    country_code: Joi.string().length(2).default('GR'),
    city:         Joi.string().allow('', null),
    street:       Joi.string().allow('', null),
    number:       Joi.string().allow('', null),
    postal_code:  Joi.string().allow('', null),
    email:        Joi.string().email().allow('', null),
  }).required(),
  lines: Joi.array().items(Joi.object({
    name:                    Joi.string().required(),
    code:                    Joi.string().allow('', null),
    description:             Joi.string().allow('', null),
    quantity:                Joi.number().positive().required(),
    quantity_type:           Joi.number().valid(1,2,3,4,5,6).default(2),
    unit_price:              Joi.number().required(),
    vat_rate:                Joi.number().valid(0,6,13,24).required(),
    classification_category: Joi.string().required(),
    classification_type:     Joi.string().required(),
    vat_exemption_code:      Joi.number().allow(null),
  })).min(1).required(),
  payment_method_type: Joi.number().valid(0,1,2,3,4,5,6,7).required(),
  payment_details:     Joi.string().allow('', null),
  notes:               Joi.string().allow('', null),
  draft:               Joi.boolean().default(false),
  customer_emails:     Joi.array().items(Joi.string().email()).default([]),
}).unknown(true);

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    // Calculate totals
    let netTotal = 0, vatTotal = 0;
    const linesWithTotals = value.lines.map((l, i) => {
      const net = Number((l.quantity * l.unit_price).toFixed(2));
      const vat = Number((net * l.vat_rate / 100).toFixed(2));
      netTotal += net;
      vatTotal += vat;
      return {
        line_number:    i + 1,
        name:           l.name,
        code:           l.code || null,
        description:    l.description || null,
        quantity:       l.quantity,
        quantity_type:  l.quantity_type,
        unit_price:     l.unit_price,
        net_total_price: net,
        vat_rate:       l.vat_rate,
        vat_total:      vat,
        subtotal:       Number((net + vat).toFixed(2)),
        vat_exemption_code:      l.vat_exemption_code || null,
        classification_category: l.classification_category,
        classification_type:     l.classification_type,
      };
    });
    netTotal = Number(netTotal.toFixed(2));
    vatTotal = Number(vatTotal.toFixed(2));
    const totalAmount = Number((netTotal + vatTotal).toFixed(2));

    // Fetch owner email for Wrapp login
    const [[u]] = await pool.execute(
      'SELECT email FROM ag_users WHERE id = ? LIMIT 1',
      [req.user.sub]
    );

    let wrappResp = null;
    if (!value.draft) {
      try {
        wrappResp = await wrapp.issueInvoice(u.email, {
          invoice_type_code:   value.invoice_type,
          billing_book_id:     value.billing_book_id,
          payment_method_type: value.payment_method_type,
          payment_details:     value.payment_details || undefined,
          notes:               value.notes || undefined,
          net_total_amount:    netTotal,
          vat_total_amount:    vatTotal,
          total_amount:        totalAmount,
          payable_total_amount: totalAmount,
          counterpart: {
            name:         value.customer.name,
            country_code: value.customer.country_code || 'GR',
            vat:          value.customer.afm || undefined,
            city:         value.customer.city || undefined,
            street:       value.customer.street || undefined,
            number:       value.customer.number || undefined,
            postal_code:  value.customer.postal_code || undefined,
            email:        value.customer.email || undefined,
          },
          invoice_lines:   linesWithTotals,
          customer_emails: value.customer_emails,
          email_locale:    'el',
          draft:           false,
        });
      } catch (wrappErr) {
        logger.error('Wrapp issue failed:', wrappErr.response?.data || wrappErr.message);
        return res.status(502).json({
          error: 'Wrapp transmission failed',
          details: wrappErr.response?.data || wrappErr.message,
        });
      }
    }

    const invoiceId = uuid();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO ag_invoices
           (id, business_id, invoice_type, billing_book_id,
            customer_name, customer_afm, customer_city, customer_street,
            customer_number, customer_postal_code, customer_email,
            net_total_amount, vat_total_amount, total_amount,
            payment_method_type, payment_details, notes,
            my_data_mark, my_data_uid, wrapp_qr_url, wrapp_invoice_url,
            series, num, draft, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [invoiceId, req.user.business_id, value.invoice_type, value.billing_book_id,
         value.customer.name, value.customer.afm || null, value.customer.city || null,
         value.customer.street || null, value.customer.number || null,
         value.customer.postal_code || null, value.customer.email || null,
         netTotal, vatTotal, totalAmount,
         value.payment_method_type, value.payment_details || null, value.notes || null,
         wrappResp?.my_data_mark || null, wrappResp?.my_data_uid || null,
         wrappResp?.my_data_qr_url || null, wrappResp?.wrapp_invoice_url || null,
         wrappResp?.series || null, wrappResp?.num || null,
         value.draft ? 1 : 0]
      );
      for (const line of linesWithTotals) {
        await conn.execute(
          `INSERT INTO ag_invoice_lines
             (invoice_id, line_number, name, code, description,
              quantity, quantity_type, unit_price, net_total_price,
              vat_rate, vat_total, subtotal, vat_exemption_code,
              classification_category, classification_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [invoiceId, line.line_number, line.name, line.code, line.description,
           line.quantity, line.quantity_type, line.unit_price, line.net_total_price,
           line.vat_rate, line.vat_total, line.subtotal, line.vat_exemption_code,
           line.classification_category, line.classification_type]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.status(201).json({ data: { id: invoiceId, ...(wrappResp || {}) } });
  } catch (e) { next(e); }
});

module.exports = router;
