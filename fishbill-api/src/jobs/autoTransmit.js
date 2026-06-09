/**
 * Auto-Transmit Job
 * Every 60 s: picks up all issued invoices and delivery notes for wrapp-enabled
 * businesses and transmits them automatically. All steps logged to wrapp.log.
 */

const cron        = require('node-cron');
const fs          = require('fs');
const path        = require('path');
const pool        = require('../config/database');
const invoiceSvc  = require('../services/invoice.service');

const LOG_FILE = path.join(__dirname, '../../logs/wrapp.log');
try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch (_) {}

function tlog(level, msg, data) {
  const ts   = new Date().toISOString();
  const line = data !== undefined
    ? `[${ts}] [${level}] [AUTO_TX] ${msg} ${JSON.stringify(data)}`
    : `[${ts}] [${level}] [AUTO_TX] ${msg}`;
  if (level === 'ERROR') console.error(line); else console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ── Transmit one invoice ───────────────────────────────────────────────────────
async function processInvoice(invoice) {
  tlog('INFO', 'processing invoice', { id: invoice.id, number: invoice.invoice_number, biz_id: invoice.business_id });
  try {
    const result = await invoiceSvc.transmit(invoice);
    if (result.success) {
      tlog('INFO', 'invoice transmitted OK', { id: invoice.id, mark: result.mark, qrUrl: result.qrUrl });
    } else {
      tlog('ERROR', 'invoice transmission failed', { id: invoice.id, message: result.message });
    }
    return result;
  } catch (err) {
    tlog('ERROR', 'invoice transmission threw', { id: invoice.id, error: err.message });
    return { success: false, message: err.message };
  }
}

// ── Transmit one delivery note ─────────────────────────────────────────────────
async function processDeliveryNote(note, biz) {
  tlog('INFO', 'processing delivery note', { id: note.id, number: note.note_number, biz_id: note.business_id });
  try {
    const wrapp = require('../services/wrapp.service');

    const [lines] = await pool.execute(
      'SELECT * FROM delivery_note_lines WHERE delivery_note_id = ? ORDER BY sort_order',
      [note.id]
    );
    tlog('DEBUG', 'DN lines fetched', { id: note.id, count: lines.length });

    const bizObj = {
      afm:         biz.afm,
      name:        biz.name,
      address:     biz.address,
      city:        biz.city,
      postal_code: biz.postal_code,
    };

    let result;
    try {
      result = await wrapp.transmitDeliveryNote(note, lines, bizObj);
      tlog('INFO', 'wrapp.transmitDeliveryNote returned', { id: note.id, mark: result.mark, wrapp_id: result.wrapp_invoice_id });
    } catch (wrappErr) {
      tlog('ERROR', 'wrapp.transmitDeliveryNote threw', { id: note.id, error: wrappErr.message });
      await pool.execute(
        "UPDATE delivery_notes SET status='failed', mydata_response=?, updated_at=NOW() WHERE id=?",
        [JSON.stringify({ error: wrappErr.message }), note.id]
      ).catch(() => {});
      return { success: false, message: wrappErr.message };
    }

    await pool.execute(
      `UPDATE delivery_notes
       SET status='transmitted', mydata_mark=?, mydata_uid=?,
           wrapp_invoice_id=?, wrapp_mark=?, wrapp_qr_url=?,
           mydata_response=?, transmitted_at=NOW(), updated_at=NOW()
       WHERE id=?`,
      [
        result.mark, result.uid || null,
        result.wrapp_invoice_id, result.mark, result.qrUrl || null,
        JSON.stringify({ mark: result.mark, uid: result.uid, wrapp_id: result.wrapp_invoice_id, provider: 'wrapp' }),
        note.id,
      ]
    );
    tlog('INFO', 'DN transmitted OK', { id: note.id, mark: result.mark });
    return { success: true, mark: result.mark };

  } catch (err) {
    tlog('ERROR', 'DN transmission threw', { id: note.id, error: err.message });
    await pool.execute(
      "UPDATE delivery_notes SET status='failed', mydata_response=?, updated_at=NOW() WHERE id=?",
      [JSON.stringify({ error: err.message }), note.id]
    ).catch(() => {});
    return { success: false, message: err.message };
  }
}

// ── Main job tick ──────────────────────────────────────────────────────────────
async function runAutoTransmit() {
  try {
    // Find all wrapp-enabled businesses that have an api_key
    const [bizRows] = await pool.execute(
      `SELECT id, name, afm, address, city, postal_code, wrapp_api_key
       FROM businesses
       WHERE wrapp_enabled = 1 AND wrapp_api_key IS NOT NULL AND wrapp_api_key != ''`
    );

    if (!bizRows.length) return; // nothing to do

    tlog('DEBUG', 'auto-transmit tick', { wrapp_biz_count: bizRows.length, biz_ids: bizRows.map(b => b.id) });

    for (const biz of bizRows) {
      // ── Pending invoices (issued or previously failed) ──────────────────────
      const [invoices] = await pool.execute(
        `SELECT * FROM invoices WHERE business_id = ? AND status IN ('issued','failed') ORDER BY created_at ASC LIMIT 20`,
        [biz.id]
      );
      if (invoices.length) {
        tlog('INFO', 'found pending invoices', { biz_id: biz.id, count: invoices.length, statuses: invoices.map(i => i.status) });
        for (const inv of invoices) {
          await processInvoice(inv);
        }
      } else {
        tlog('DEBUG', 'no pending invoices for biz', { biz_id: biz.id });
      }

      // ── Pending delivery notes ──────────────────────────────────────────────
      const [notes] = await pool.execute(
        `SELECT dn.*
         FROM delivery_notes dn
         WHERE dn.business_id = ? AND dn.status IN ('issued','draft') ORDER BY dn.created_at ASC LIMIT 20`,
        [biz.id]
      );
      if (notes.length) {
        tlog('INFO', 'found pending delivery notes', { biz_id: biz.id, count: notes.length, statuses: notes.map(n => n.status) });
        for (const note of notes) {
          await processDeliveryNote(note, biz);
        }
      } else {
        tlog('DEBUG', 'no pending delivery notes for biz', { biz_id: biz.id });
      }
    }
  } catch (err) {
    tlog('ERROR', 'auto-transmit tick threw', { error: err.message });
  }
}

// ── Start cron ─────────────────────────────────────────────────────────────────
function startAutoTransmit() {
  tlog('INFO', 'auto-transmit job started — running every 60s');
  // Run immediately on startup, then every minute
  runAutoTransmit();
  cron.schedule('* * * * *', runAutoTransmit);
}

module.exports = { startAutoTransmit, runAutoTransmit };
