const express = require('express');
const pool    = require('../config/database');
const wrapp   = require('../services/wrapp-staging.service');
const logger  = require('../utils/logger');

const router = express.Router();

router.post('/', async (req, res) => {
  const sig = req.headers['x-webhook-secret'];
  if (!wrapp.verifyWebhookSignature(req.rawBody || '', sig)) {
    logger.warn('Wrapp webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = req.headers['event-type'];
  const body  = req.body || {};

  logger.info(`Wrapp webhook received: event=${event}`, body);

  try {
    switch (event) {
      case 'issued-invoice':
        if (body.id) {
          await pool.execute(
            `UPDATE ag_invoices SET
               my_data_mark = COALESCE(my_data_mark, ?),
               my_data_uid  = COALESCE(my_data_uid,  ?),
               my_data_qr_url = COALESCE(my_data_qr_url, ?),
               wrapp_invoice_url = COALESCE(wrapp_invoice_url, ?),
               series = COALESCE(series, ?),
               num    = COALESCE(num, ?)
             WHERE id = ?`,
            [body.my_data_mark || null, body.my_data_uid || null,
             body.my_data_qr_url || null, body.wrapp_invoice_url || null,
             body.series || null, body.num || null, body.id]
          );
        }
        break;

      case 'invoice-pdf':
      case 'thermal-print-pdf':
        if (body.invoice_id && body.download_url) {
          await pool.execute(
            `UPDATE ag_invoices SET pdf_url = ? WHERE id = ?`,
            [body.download_url, body.invoice_id]
          );
        }
        break;

      case 'pos-payment':
        logger.warn('POS payment error:', body);
        break;

      default:
        logger.info(`Unhandled event-type: ${event}`);
    }
    res.json({ ok: true });
  } catch (e) {
    logger.error('Webhook handler error:', e);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
