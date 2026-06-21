'use strict';
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

const OUT       = path.join(__dirname, '..', 'pdfs', 'entipo_b.pdf');
const FONT      = 'C:\\Windows\\Fonts\\arial.ttf';
const FONT_BOLD = 'C:\\Windows\\Fonts\\arialbd.ttf';

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const doc = new PDFDocument({
  size: 'A4',
  margin: 0,          // we handle all margins manually
  autoFirstPage: true,
  info: { Title: 'Έντυπο Β – Δήλωση Καταγραφής Ζύγισης' }
});
doc.pipe(fs.createWriteStream(OUT));

const W  = doc.page.width;   // 595.28
const ML = 38;
const CW = W - ML * 2;       // 519.28

// ── Helper: draw a bordered cell with optional fill and text ──────────────────
function cell(x, y, w, h, text, opts = {}) {
  const { bold=false, fs=7.5, align='left', pad=3, fill=null } = opts;
  if (fill) { doc.rect(x, y, w, h).fill(fill); doc.fillColor('#000'); }
  doc.rect(x, y, w, h).lineWidth(0.5).stroke('#000');
  if (!text) return;
  const lines   = text.split('\n');
  const lineH   = fs * 1.28;
  const textH   = lines.length * lineH;
  const topY    = y + Math.max(pad, (h - textH) / 2);
  doc.font(bold ? FONT_BOLD : FONT).fontSize(fs).fillColor('#000')
     .text(text, x + pad, topY, { width: w - pad*2, align, lineGap: lineH - fs });
}

// ── Legal-basis reference (top right) ─────────────────────────────────────────
// Reference the law that defines the form, NOT the circular's ADA (which used
// to appear here by accident — it was the identifier of the circular document,
// not of the form itself).
doc.font(FONT).fontSize(7).fillColor('#444')
   .text('ΥΑ 65/23344/2024 — ΦΕΚ Β′789  ·  Παράρτημα ΙΙΙ', ML, 26, { width: CW, align: 'right' });

// ── Title ─────────────────────────────────────────────────────────────────────
let y = 44;
doc.font(FONT_BOLD).fontSize(11).fillColor('#000')
   .text('ΕΝΤΥΠΟ Β — Δήλωση Καταγραφής Ζύγισης', ML, y, { width: CW, align: 'center' });
y += 18;

// ── Table 1: Στοιχεία σκάφους ─────────────────────────────────────────────────
const RH  = 15;   // standard row height
const LW  = 195;  // label column width

const T1 = [
  'Ονοματεπώνυμο',
  'ΑΦΜ',
  'Αριθμός Δελτίου Ταυτότητας',
  'Τηλέφωνο Επικοινωνίας',
  'Αριθμός ΑΜΑΣ του σκάφους',
  'Εξωτερικός Αριθμός Ταυτοποίησης',
  'Ονομασία Αλιευτικού Σκάφους',
];

cell(ML, y, CW, RH, 'Στοιχεία σκάφους & υπεύθυνου για τη ζύγιση',
  { bold: true, fs: 8, align: 'center', fill: '#E8E8E8' });
y += RH;

T1.forEach(label => {
  cell(ML,      y, LW,      RH, label);
  cell(ML + LW, y, CW - LW, RH, '');
  y += RH;
});
y += 7;

// ── Table 2: Ημερομηνία / Λιμένας ────────────────────────────────────────────
const T2 = [
  ['Ημερομηνία Ζύγισης (ΕΕΕΕ-ΜΜ-ΗΗ)',                                         RH],
  ['Πενταψήφιος Κωδικός Λιμένα',                                               RH],
  ['Λιμένας ή Σημείο Εκφόρτωσης',                                              RH],
  ['Επίπεδο Κινδύνου (εφόσον υφίσταται)\n– Σταθμισμένη επικινδυνότητα',       26],
];

T2.forEach(([label, rh]) => {
  cell(ML,      y, LW,      rh, label, { fs: 7.5 });
  cell(ML + LW, y, CW - LW, rh, '');
  y += rh;
});
y += 9;

// ── Table 3: Δήλωση Καταγραφής Ζύγισης ──────────────────────────────────────
cell(ML, y, CW, 17, 'Δήλωση Καταγραφής Ζύγισης',
  { bold: true, fs: 8.5, align: 'center', fill: '#E8E8E8' });
y += 17;
cell(ML, y, CW, 13, 'Έντυπο Β : για αλιεύματα που εκφορτώνονται σε μη τυποποιημένα κιβώτια',
  { fs: 7.5, align: 'center', fill: '#E8E8E8' });
y += 13;

// Column definitions — widths must sum to CW (519.28)
const COLS = [
  { label: 'Α/Α',                                                              w: 26  },
  { label: 'Εμπορική\nονομασία\nείδους',                                       w: 88  },
  { label: 'Τριψήφιος\nΑλφαβητικός\nΚωδικός FAO\nκάθε είδους',               w: 76  },
  { label: 'Αριθμός\nατόμων που\nζυγίστηκαν (για\nτα είδη που\nαπαιτείται η\nκαταγραφή\nαριθμού\nατόμων)', w: 97 },
  { label: 'Συνολικό\nβάρος σε kg',                                            w: 70  },
  { label: 'Κωδικός\nπαρουσίασης των\nαλιευτικών\nπροϊόντων που\nέχουν ζυγιστεί', w: 0 },
];
// Last column fills remainder
COLS[COLS.length-1].w = CW - COLS.slice(0,-1).reduce((s,c)=>s+c.w,0);

const CH = 64;   // column header height
let cx = ML;
COLS.forEach(c => {
  cell(cx, y, c.w, CH, c.label, { bold: true, fs: 6.8, align: 'center', pad: 3 });
  cx += c.w;
});
y += CH;

// 6 empty data rows
for (let r = 0; r < 6; r++) {
  cx = ML;
  COLS.forEach(c => { cell(cx, y, c.w, RH, ''); cx += c.w; });
  y += RH;
}

// ── Signature ─────────────────────────────────────────────────────────────────
y += 16;
doc.font(FONT_BOLD).fontSize(8.5).fillColor('#000')
   .text('ΥΠΟΓΡΑΦΗ ΥΠΕΥΘΥΝΟΥ ΖΥΓΙΣΗΣ:', ML, y, { width: CW, align: 'center' });

// ── Finalize (no page-number text at absolute-y — that was causing blank page 2) ──
doc.end();
doc.on('end', () => console.log('OK — single page PDF:', OUT));
