const express = require('express');
const Joi     = require('joi');
const { v4: uuid } = require('uuid');

const pool   = require('../config/database');
const wrapp  = require('../services/wrapp-staging.service');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM ag_delivery_notes WHERE business_id = ?',
      [req.user.business_id]
    );
    const [rows] = await pool.execute(
      `SELECT id, series, num, customer_name, my_data_mark, cancelled_by_mark,
              dispatch_date, vehicle_number, draft, created_at
         FROM ag_delivery_notes
        WHERE business_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [req.user.business_id, limit, offset]
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [[dn]] = await pool.execute(
      'SELECT * FROM ag_delivery_notes WHERE id = ? AND business_id = ? LIMIT 1',
      [req.params.id, req.user.business_id]
    );
    if (!dn) return res.status(404).json({ error: 'Delivery note not found' });
    const [lines] = await pool.execute(
      'SELECT * FROM ag_delivery_note_lines WHERE dn_id = ? ORDER BY line_number',
      [dn.id]
    );
    res.json({ data: { ...dn, lines } });
  } catch (e) { next(e); }
});

const createSchema = Joi.object({
  billing_book_id: Joi.string().required(),
  customer: Joi.object({
    name:         Joi.string().required(),
    afm:          Joi.string().allow('', null),
    country_code: Joi.string().length(2).default('GR'),
    city:         Joi.string().allow('', null),
    street:       Joi.string().allow('', null),
    number:       Joi.string().allow('', null),
    postal_code:  Joi.string().allow('', null),
  }).required(),
  dispatch_date:   Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/).required(),
  dispatch_time:   Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  vehicle_number:  Joi.string().required(),
  purpose_of_movement:              Joi.number().valid(1,2,3,4,5,7,8,9,10,11,12,13,14,19,20).required(),
  purpose_of_movement_custom_title: Joi.string().allow('', null),
  issuer_of_movement: Joi.string().required(),
  from_address:  Joi.string().required(),
  from_number:   Joi.string().required(),
  from_city:     Joi.string().required(),
  from_zipcode:  Joi.string().required(),
  to_address:    Joi.string().required(),
  to_number:     Joi.string().required(),
  to_city:       Joi.string().required(),
  to_zipcode:    Joi.string().required(),
  lines: Joi.array().items(Joi.object({
    name:          Joi.string().required(),
    code:          Joi.string().allow('', null),
    quantity:      Joi.number().positive().required(),
    quantity_type: Joi.number().valid(1,2,3,4,5,6).default(2),
    unit_price:    Joi.number().default(0),
    vat_rate:      Joi.number().valid(0,6,13,24).default(0),
    classification_category: Joi.string().default('category1_2'),
    classification_type:     Joi.string().default('E3_561_001'),
  })).min(1).required(),
  draft: Joi.boolean().default(false),
}).unknown(true);

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    // Wrapp requires purpose_of_movement_custom_title when purpose==19
    if (Number(value.purpose_of_movement) === 19 && !value.purpose_of_movement_custom_title) {
      return res.status(400).json({ error: 'purpose_of_movement_custom_title is required when purpose_of_movement=19' });
    }

    const linesWithTotals = value.lines.map((l, i) => {
      const net = Number((l.quantity * l.unit_price).toFixed(2));
      const vat = Number((net * l.vat_rate / 100).toFixed(2));
      return {
        line_number: i + 1,
        name: l.name, code: l.code || null,
        quantity: l.quantity, quantity_type: l.quantity_type,
        unit_price: l.unit_price,
        net_total_price: net,
        vat_rate: l.vat_rate, vat_total: vat,
        subtotal: Number((net + vat).toFixed(2)),
        classification_category: l.classification_category,
        classification_type:     l.classification_type,
      };
    });

    const [[u]] = await pool.execute(
      'SELECT email FROM ag_users WHERE id = ? LIMIT 1',
      [req.user.sub]
    );

    let wrappResp = null;
    if (!value.draft) {
      try {
        wrappResp = await wrapp.issueInvoice(u.email, {
          invoice_type_code:   '9.3',
          billing_book_id:     value.billing_book_id,
          payment_method_type: 1,
          net_total_amount:    0,
          vat_total_amount:    0,
          total_amount:        0,
          payable_total_amount: 0,
          counterpart: {
            name:         value.customer.name,
            country_code: value.customer.country_code || 'GR',
            vat:          value.customer.afm || undefined,
            city:         value.customer.city || undefined,
            street:       value.customer.street || undefined,
            number:       value.customer.number || undefined,
            postal_code:  value.customer.postal_code || undefined,
          },
          is_delivery_note: true,
          delivery_detail: {
            dispatch_date:  value.dispatch_date,
            dispatch_time:  value.dispatch_time,
            vehicle_number: value.vehicle_number,
            purpose_of_movement: String(value.purpose_of_movement),
            purpose_of_movement_custom_title: value.purpose_of_movement_custom_title || undefined,
            issuer_of_movement: value.issuer_of_movement,
            from_address:  value.from_address,
            from_number:   value.from_number,
            from_city:     value.from_city,
            from_zipcode:  value.from_zipcode,
            to_address:    value.to_address,
            to_number:     value.to_number,
            to_city:       value.to_city,
            to_zipcode:    value.to_zipcode,
          },
          invoice_lines: linesWithTotals.map(l => ({ ...l, vat_rate: l.vat_rate || 24 })),
          draft: false,
        });
      } catch (e) {
        logger.error('Wrapp DN issue failed:', e.response?.data || e.message);
        return res.status(502).json({
          error: 'Wrapp delivery note transmission failed',
          details: e.response?.data || e.message,
        });
      }
    }

    const dnId = uuid();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO ag_delivery_notes
           (id, business_id, billing_book_id, customer_name, customer_afm,
            dispatch_date, dispatch_time, vehicle_number,
            purpose_of_movement, purpose_of_movement_custom_title, issuer_of_movement,
            from_address, from_number, from_city, from_zipcode,
            to_address, to_number, to_city, to_zipcode,
            my_data_mark, my_data_uid, wrapp_qr_url,
            series, num, draft, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [dnId, req.user.business_id, value.billing_book_id,
         value.customer.name, value.customer.afm || null,
         value.dispatch_date, value.dispatch_time, value.vehicle_number,
         value.purpose_of_movement, value.purpose_of_movement_custom_title || null,
         value.issuer_of_movement,
         value.from_address, value.from_number, value.from_city, value.from_zipcode,
         value.to_address, value.to_number, value.to_city, value.to_zipcode,
         wrappResp?.my_data_mark || null, wrappResp?.my_data_uid || null,
         wrappResp?.my_data_qr_url || null,
         wrappResp?.series || null, wrappResp?.num || null,
         value.draft ? 1 : 0]
      );
      for (const l of linesWithTotals) {
        await conn.execute(
          `INSERT INTO ag_delivery_note_lines
             (dn_id, line_number, name, code, quantity, quantity_type,
              unit_price, net_total_price, vat_rate, vat_total, subtotal,
              classification_category, classification_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [dnId, l.line_number, l.name, l.code, l.quantity, l.quantity_type,
           l.unit_price, l.net_total_price, l.vat_rate, l.vat_total, l.subtotal,
           l.classification_category, l.classification_type]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback(); throw e;
    } finally {
      conn.release();
    }

    res.status(201).json({ data: { id: dnId, ...(wrappResp || {}) } });
  } catch (e) { next(e); }
});

// ── POST /delivery-notes/:id/cancel ────────────────────────────────────────
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const [[dn]] = await pool.execute(
      'SELECT * FROM ag_delivery_notes WHERE id = ? AND business_id = ? LIMIT 1',
      [req.params.id, req.user.business_id]
    );
    if (!dn) return res.status(404).json({ error: 'Delivery note not found' });
    if (dn.cancelled_by_mark) return res.status(409).json({ error: 'Already cancelled' });
    if (!dn.my_data_mark)     return res.status(400).json({ error: 'Cannot cancel a draft delivery note' });

    const [[u]] = await pool.execute(
      'SELECT email FROM ag_users WHERE id = ? LIMIT 1',
      [req.user.sub]
    );

    const cancelResp = await wrapp.cancelDeliveryNote(u.email, dn.my_data_mark);

    await pool.execute(
      'UPDATE ag_delivery_notes SET cancelled_by_mark = ?, cancelled_at = NOW() WHERE id = ?',
      [cancelResp?.cancelled_by_mark || 'unknown', dn.id]
    );

    res.json({ data: cancelResp });
  } catch (e) {
    logger.error('DN cancel failed:', e.response?.data || e.message);
    next(e);
  }
});

module.exports = router;
