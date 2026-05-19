const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Resolve a Unicode-capable font for Greek text rendering.
// PDFKit's built-in Helvetica only covers Latin — Greek characters need a TTF font.
// Priority: env var → bundled assets → Windows system → Linux system → fallback (no Greek)
function resolveFont(bold = false) {
  const candidates = [
    process.env.PDF_FONT_PATH ? (bold ? process.env.PDF_FONT_BOLD_PATH : process.env.PDF_FONT_PATH) : null,
    path.join(__dirname, '../../assets/fonts', bold ? 'NotoSans-Bold.ttf' : 'NotoSans-Regular.ttf'),
    path.join(__dirname, '../../assets/fonts', bold ? 'DejaVuSans-Bold.ttf' : 'DejaVuSans.ttf'),
    `C:\\Windows\\Fonts\\${bold ? 'arialbd.ttf' : 'arial.ttf'}`,
    `/usr/share/fonts/truetype/dejavu/${bold ? 'DejaVuSans-Bold.ttf' : 'DejaVuSans.ttf'}`,
    `/usr/share/fonts/truetype/noto/${bold ? 'NotoSans-Bold.ttf' : 'NotoSans-Regular.ttf'}`,
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return bold ? 'Helvetica-Bold' : 'Helvetica'; // fallback — Greek will appear as boxes
}

const FONT_REGULAR = resolveFont(false);
const FONT_BOLD    = resolveFont(true);

/**
 * Ensure the PDF storage directory exists.
 */
function ensurePdfDir() {
  const pdfDir = process.env.PDF_STORAGE_PATH || './pdfs';
  const absDir = path.resolve(pdfDir);
  if (!fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
  }
  return absDir;
}

/**
 * Format a number as Greek currency string.
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  return `${parseFloat(value || 0).toFixed(2)} EUR`;
}

/**
 * Format a date string as DD/MM/YYYY.
 * @param {string|Date} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Generate an invoice PDF using PDFKit.
 * @param {object} invoice - invoice with lines and customer attached
 * @returns {Promise<string>} absolute file path of the generated PDF
 */
async function generateInvoicePDF(invoice) {
  const pdfDir = ensurePdfDir();
  const fileName = `invoice_${invoice.id}_${Date.now()}.pdf`;
  const filePath = path.join(pdfDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      font: FONT_REGULAR,
      info: {
        Title: `Invoice ${invoice.invoice_number || invoice.id}`,
        Author: invoice.business_name || 'FishBill',
        Subject: 'Invoice',
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // -----------------------------------------------------------------------
    // HEADER BAND
    // -----------------------------------------------------------------------
    doc
      .rect(50, 40, 495, 60)
      .fillAndStroke('#1a4a6b', '#1a4a6b');

    doc
      .fillColor('#ffffff')
      .fontSize(18)
      .font(FONT_BOLD)
      .text('TIMOLOGIO PWLHSHS / INVOICE', 60, 52, { align: 'left' });

    doc
      .fontSize(10)
      .font(FONT_REGULAR)
      .text('FishBill - Greek Fishing Industry Invoicing', 60, 75, { align: 'left' });

    doc.fillColor('#000000');

    // -----------------------------------------------------------------------
    // BUSINESS INFO (left) + INVOICE META (right)
    // -----------------------------------------------------------------------
    const topInfoY = 120;

    // Business box
    doc
      .rect(50, topInfoY, 230, 130)
      .stroke('#cccccc');

    doc
      .fontSize(9)
      .font(FONT_BOLD)
      .fillColor('#1a4a6b')
      .text('EPICHEIRHSH / BUSINESS', 58, topInfoY + 8);

    doc
      .font(FONT_REGULAR)
      .fillColor('#000000')
      .fontSize(10)
      .text(invoice.business_name || 'N/A', 58, topInfoY + 22, { width: 214 });

    doc
      .fontSize(8)
      .text(`AFM: ${invoice.business_afm || 'N/A'}`, 58, topInfoY + 38)
      .text(`DOY: ${invoice.business_doy || 'N/A'}`, 58, topInfoY + 50)
      .text(invoice.business_address || '', 58, topInfoY + 62, { width: 214 })
      .text(`${invoice.business_city || ''}  ${invoice.business_postal || ''}`, 58, topInfoY + 74)
      .text(`Tel: ${invoice.business_phone || 'N/A'}`, 58, topInfoY + 86)
      .text(`Email: ${invoice.business_email || 'N/A'}`, 58, topInfoY + 98, { width: 214 });

    // Customer box
    doc
      .rect(295, topInfoY, 250, 130)
      .stroke('#cccccc');

    doc
      .fontSize(9)
      .font(FONT_BOLD)
      .fillColor('#1a4a6b')
      .text('PELATHS / CUSTOMER', 303, topInfoY + 8);

    doc
      .font(FONT_REGULAR)
      .fillColor('#000000')
      .fontSize(10)
      .text(invoice.customer_name || 'N/A', 303, topInfoY + 22, { width: 234 });

    doc
      .fontSize(8)
      .text(`AFM: ${invoice.customer_afm || 'N/A'}`, 303, topInfoY + 38)
      .text(`DOY: ${invoice.customer_doy || 'N/A'}`, 303, topInfoY + 50)
      .text(invoice.customer_address || '', 303, topInfoY + 62, { width: 234 })
      .text(`${invoice.customer_city || ''}  ${invoice.customer_postal || ''}`, 303, topInfoY + 74)
      .text(`Tel: ${invoice.customer_phone || 'N/A'}`, 303, topInfoY + 86)
      .text(`Email: ${invoice.customer_email || 'N/A'}`, 303, topInfoY + 98, { width: 234 });

    // -----------------------------------------------------------------------
    // INVOICE DETAILS BAR
    // -----------------------------------------------------------------------
    const detailY = 265;
    doc
      .rect(50, detailY, 495, 32)
      .fillAndStroke('#e8f0f7', '#cccccc');

    doc.fillColor('#000000').font(FONT_BOLD).fontSize(8);
    doc.text('AR. TIMOLOGIOU', 58, detailY + 6);
    doc.text('HMERОМHNIA', 168, detailY + 6);
    doc.text('TROPOS PLHRWMHS', 268, detailY + 6);
    doc.text('SERIES', 398, detailY + 6);
    doc.text('STATUS', 448, detailY + 6);

    doc.font(FONT_REGULAR).fontSize(9).fillColor('#1a4a6b');
    doc.text(invoice.invoice_number || String(invoice.id), 58, detailY + 18);
    doc.text(formatDate(invoice.invoice_date), 168, detailY + 18);
    doc.text(invoice.payment_method || 'N/A', 268, detailY + 18);
    doc.text(invoice.series || 'A', 398, detailY + 18);
    doc.text((invoice.status || '').toUpperCase(), 448, detailY + 18);

    // -----------------------------------------------------------------------
    // LINE ITEMS TABLE
    // -----------------------------------------------------------------------
    const tableTop = 310;
    const colX = { desc: 50, qty: 260, unit: 305, price: 345, vat: 395, net: 430, total: 470 };

    // Table header
    doc
      .rect(50, tableTop, 495, 20)
      .fillAndStroke('#1a4a6b', '#1a4a6b');

    doc.fillColor('#ffffff').font(FONT_BOLD).fontSize(7.5);
    doc.text('PERIGRAFI / DESCRIPTION', colX.desc + 4, tableTop + 6, { width: 200 });
    doc.text('QTY', colX.qty, tableTop + 6, { width: 40, align: 'right' });
    doc.text('UNIT', colX.unit, tableTop + 6, { width: 35, align: 'right' });
    doc.text('TIMH/UNIT', colX.price, tableTop + 6, { width: 45, align: 'right' });
    doc.text('VAT%', colX.vat, tableTop + 6, { width: 30, align: 'right' });
    doc.text('NET', colX.net, tableTop + 6, { width: 35, align: 'right' });
    doc.text('TOTAL', colX.total, tableTop + 6, { width: 35, align: 'right' });

    doc.fillColor('#000000').font(FONT_REGULAR).fontSize(8);

    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    let rowY = tableTop + 22;

    lines.forEach((line, idx) => {
      if (rowY > 680) {
        doc.addPage();
        rowY = 60;
      }

      const bgColor = idx % 2 === 0 ? '#f9f9f9' : '#ffffff';
      doc.rect(50, rowY, 495, 18).fillAndStroke(bgColor, '#e0e0e0');

      doc.fillColor('#000000');
      doc.text(line.description || line.product_name || '', colX.desc + 4, rowY + 5, { width: 200, ellipsis: true });
      doc.text(parseFloat(line.quantity || 0).toFixed(2), colX.qty, rowY + 5, { width: 40, align: 'right' });
      doc.text(line.unit || 'kg', colX.unit, rowY + 5, { width: 35, align: 'right' });
      doc.text(parseFloat(line.unit_price || 0).toFixed(2), colX.price, rowY + 5, { width: 45, align: 'right' });
      doc.text(`${parseFloat(line.vat_rate || 13).toFixed(0)}%`, colX.vat, rowY + 5, { width: 30, align: 'right' });
      doc.text(parseFloat(line.net_value || 0).toFixed(2), colX.net, rowY + 5, { width: 35, align: 'right' });
      doc.text(parseFloat(line.total_value || 0).toFixed(2), colX.total, rowY + 5, { width: 35, align: 'right' });

      rowY += 18;
    });

    // -----------------------------------------------------------------------
    // TOTALS BOX
    // -----------------------------------------------------------------------
    const totalsY = rowY + 15;

    doc
      .rect(350, totalsY, 195, 80)
      .fillAndStroke('#f5f9fd', '#cccccc');

    doc.font(FONT_REGULAR).fontSize(9).fillColor('#000000');

    doc.text('Net Value / KATHARA AXIA:', 358, totalsY + 8, { width: 130 });
    doc.font(FONT_BOLD).text(formatCurrency(invoice.net_value), 358, totalsY + 8, { width: 180, align: 'right' });

    doc.font(FONT_REGULAR).text(`VAT / ФПА (${invoice.vat_rate || ''}%):`, 358, totalsY + 24, { width: 130 });
    doc.font(FONT_BOLD).text(formatCurrency(invoice.vat_amount), 358, totalsY + 24, { width: 180, align: 'right' });

    if (parseFloat(invoice.discount_amount) > 0) {
      doc.font(FONT_REGULAR).fillColor('#c00').text('Discount / EКПTΩSH:', 358, totalsY + 40, { width: 130 });
      doc.font(FONT_BOLD).text(`-${formatCurrency(invoice.discount_amount)}`, 358, totalsY + 40, { width: 180, align: 'right' });
    }

    doc
      .rect(350, totalsY + 56, 195, 24)
      .fillAndStroke('#1a4a6b', '#1a4a6b');

    doc.fillColor('#ffffff').font(FONT_BOLD).fontSize(10);
    doc.text('TOTAL / ΣΥΝΟΛΟ:', 358, totalsY + 62, { width: 130 });
    doc.text(formatCurrency(invoice.total_value), 358, totalsY + 62, { width: 180, align: 'right' });

    // -----------------------------------------------------------------------
    // MARK / TRANSMISSION STATUS
    // -----------------------------------------------------------------------
    const markY = totalsY + 95;
    doc
      .rect(50, markY, 280, 40)
      .stroke('#cccccc');

    doc.fillColor('#000000').font(FONT_BOLD).fontSize(8);
    doc.text('MARK (AADE MyDATA):', 58, markY + 8);

    if (invoice.mark) {
      doc.font(FONT_REGULAR).fillColor('#1a7a1a').fontSize(9)
        .text(invoice.mark, 58, markY + 22, { width: 264 });
    } else {
      doc.font(FONT_REGULAR).fillColor('#aa6600').fontSize(8)
        .text('Pending transmission to AADE MyDATA', 58, markY + 22);
    }

    // -----------------------------------------------------------------------
    // NOTES
    // -----------------------------------------------------------------------
    if (invoice.notes) {
      doc.fillColor('#555555').font(FONT_REGULAR).fontSize(7.5)
        .text(`Notes: ${invoice.notes}`, 50, markY + 50, { width: 495 });
    }

    // -----------------------------------------------------------------------
    // FOOTER
    // -----------------------------------------------------------------------
    const footerY = 790;
    doc
      .rect(50, footerY - 5, 495, 1)
      .fillAndStroke('#1a4a6b');

    doc
      .fillColor('#888888')
      .font(FONT_REGULAR)
      .fontSize(7)
      .text(
        `Generated by FishBill | ${new Date().toLocaleString('el-GR')} | ${invoice.invoice_number || ''}`,
        50,
        footerY + 2,
        { align: 'center', width: 495 }
      );

    doc.end();

    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

/**
 * Generate a delivery note PDF using PDFKit.
 * @param {object} note  - delivery note object with lines attached
 * @returns {Promise<string>} absolute file path of the generated PDF
 */
async function generateDeliveryNotePDF(note) {
  const pdfDir = ensurePdfDir();
  const fileName = `dn_${note.id}_${Date.now()}.pdf`;
  const filePath = path.join(pdfDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, font: FONT_REGULAR, info: {
      Title: `Delivery Note ${note.series || ''}-${note.number || ''}`,
      Author: note.business_name || 'FishBill',
      Subject: 'Delivery Note',
    }});

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ── HEADER BAND ──
    doc.rect(50, 40, 495, 60).fillAndStroke('#0D47A1', '#0D47A1');
    doc.fillColor('#ffffff').fontSize(16).font(FONT_BOLD)
       .text('DELTIO APOSTOLHS / DELIVERY NOTE', 60, 50, { align: 'left' });
    doc.fontSize(9).font(FONT_REGULAR)
       .text('FishBill - Electronic Delivery Note | HDA Parastatiko', 60, 72, { align: 'left' });
    doc.fillColor('#000000');

    // ── DATE & NUMBER ──
    const metaY = 115;
    doc.rect(295, metaY, 250, 70).stroke('#cccccc');
    doc.fontSize(9).font(FONT_BOLD).fillColor('#0D47A1')
       .text('STOICHEIA DELTIO / NOTE INFO', 303, metaY + 6);
    doc.font(FONT_REGULAR).fillColor('#000000').fontSize(10)
       .text(`Arithmos: ${note.series || 'A'}-${note.number || ''}`, 303, metaY + 20)
       .text(`Hm/nia: ${formatDate(note.issue_date)}`, 303, metaY + 34);
    if (note.dispatch_date)
       doc.text(`Hm/nia Apostolhs: ${formatDate(note.dispatch_date)}`, 303, metaY + 48);

    // ── SENDER BOX ──
    doc.rect(50, metaY, 230, 70).stroke('#cccccc');
    doc.fontSize(9).font(FONT_BOLD).fillColor('#0D47A1')
       .text('APOSTOLEAS / SENDER', 58, metaY + 6);
    doc.font(FONT_REGULAR).fillColor('#000000').fontSize(9)
       .text(note.sender_name || note.business_name || 'N/A', 58, metaY + 20, { width: 214 })
       .text(`AFM: ${note.sender_afm || note.business_afm || 'N/A'}`, 58, metaY + 34)
       .text(note.dispatch_location || '', 58, metaY + 48, { width: 214 });

    // ── RECIPIENT BOX ──
    const recY = metaY + 85;
    doc.rect(50, recY, 495, 70).stroke('#cccccc');
    doc.fontSize(9).font(FONT_BOLD).fillColor('#0D47A1')
       .text('PARALIPTHS / RECIPIENT', 58, recY + 6);
    doc.font(FONT_REGULAR).fillColor('#000000').fontSize(10)
       .text(note.recipient_name || 'N/A', 58, recY + 20, { width: 480 });
    doc.fontSize(8)
       .text(`AFM: ${note.recipient_afm || ''}`, 58, recY + 36)
       .text(`Poli: ${note.recipient_city || ''}`, 200, recY + 36)
       .text(`Topos Paradoshs: ${note.delivery_location || ''}`, 320, recY + 36, { width: 215 });
    if (note.vehicle_plate)
       doc.text(`Pinakida: ${note.vehicle_plate}`, 58, recY + 50, { width: 200 });

    // ── LINES TABLE ──
    const tableY = recY + 90;
    const colDesc  = 50,  colQty  = 300, colUnit = 380, colPrice = 430, colTotal = 490;
    const colWidths = { desc: 240, qty: 70, unit: 45, price: 55, total: 55 };

    // Header
    doc.rect(50, tableY, 495, 18).fillAndStroke('#EFF6FF', '#90CAF9');
    doc.fillColor('#0D47A1').font(FONT_BOLD).fontSize(8)
       .text('PERIGRAFI / DESCRIPTION', colDesc, tableY + 5)
       .text('POSOTHTA', colQty, tableY + 5, { width: colWidths.qty, align: 'right' })
       .text('MON.', colUnit, tableY + 5, { width: colWidths.unit, align: 'center' })
       .text('TIMH', colPrice, tableY + 5, { width: colWidths.price, align: 'right' })
       .text('AXIA', colTotal, tableY + 5, { width: colWidths.total, align: 'right' });

    const lines = note.lines || [];
    let rowY = tableY + 20;
    let totalAmount = 0;

    lines.forEach((line, idx) => {
      if (rowY > 720) return; // guard — skip overflow lines in simple impl
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      doc.rect(50, rowY, 495, 18).fillAndStroke(bg, '#E5E7EB');
      doc.fillColor('#111111').font(FONT_REGULAR).fontSize(8)
         .text(line.description || '', colDesc, rowY + 5, { width: colWidths.desc })
         .text(parseFloat(line.quantity || 0).toFixed(3), colQty, rowY + 5, { width: colWidths.qty, align: 'right' })
         .text(line.unit || 'kg', colUnit, rowY + 5, { width: colWidths.unit, align: 'center' });
      if (parseFloat(line.unit_price) > 0) {
        doc.text(formatCurrency(line.unit_price), colPrice, rowY + 5, { width: colWidths.price, align: 'right' })
           .text(formatCurrency(line.net_amount), colTotal, rowY + 5, { width: colWidths.total, align: 'right' });
        totalAmount += parseFloat(line.net_amount || 0);
      }
      rowY += 18;
    });

    // Total row
    if (totalAmount > 0) {
      doc.rect(50, rowY, 495, 18).fillAndStroke('#DBEAFE', '#90CAF9');
      doc.fillColor('#0D47A1').font(FONT_BOLD).fontSize(9)
         .text('SYNOLO / TOTAL', colDesc, rowY + 5)
         .text(formatCurrency(totalAmount), colTotal, rowY + 5, { width: colWidths.total, align: 'right' });
      rowY += 20;
    }

    // ── MYDATA MARK ──
    if (note.mydata_mark) {
      const markY = rowY + 14;
      doc.rect(50, markY, 495, 30).fillAndStroke('#F0FDF4', '#BBF7D0');
      doc.fillColor('#166534').font(FONT_BOLD).fontSize(8)
         .text('myDATA MARK:', 58, markY + 6)
         .font(FONT_REGULAR).fontSize(10)
         .text(note.mydata_mark, 140, markY + 5);
      rowY = markY + 34;
    }

    // ── NOTES ──
    if (note.notes) {
      doc.fillColor('#555555').font(FONT_REGULAR).fontSize(7.5)
         .text(`Simeiosis: ${note.notes}`, 50, rowY + 8, { width: 495 });
    }

    // ── FOOTER ──
    doc.rect(50, 790, 495, 1).fillAndStroke('#0D47A1');
    doc.fillColor('#888888').font(FONT_REGULAR).fontSize(7)
       .text(
         `Generated by FishBill | ${new Date().toLocaleString('el-GR')} | ${note.series || 'A'}-${note.number || ''}`,
         50, 793, { align: 'center', width: 495 }
       );

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateInvoicePDF, generateDeliveryNotePDF, ensurePdfDir };
