// ═══════════════════════════════════════════════════════════════════════════════
//  FishBill — Φόρμα Εγγραφής Αλιέα  (printable Word document)
//  Run: node generate-fishbill-form.js
//  Output: FishBill_Φόρμα_Εγγραφής.docx
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, VerticalAlign,
  HeadingLevel, ShadingType, convertInchesToTwip, PageSize,
  TableLayoutType, UnderlineType,
} = require('docx');
const fs   = require('fs');
const path = require('path');

// ─────────────────────────── BRAND CONSTANTS ─────────────────────────────────
const BRAND = {
  navy:   '0D3B66',
  blue:   '1B6CA8',
  teal:   '0A7E8C',
  green:  '2E8B57',
  orange: 'E8740C',
  ltBlue: 'D6E8F7',
  ltGray: 'F2F2F2',
  midGray:'BDBDBD',
  white:  'FFFFFF',
  dark:   '1A1A2E',
};

const FONT  = 'Calibri';
const FONT2 = 'Calibri';

// ─────────────────────────── HELPER: no border ────────────────────────────────
const noBorder = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const thinBorder = (color = BRAND.midGray) => ({
  top:    { style: BorderStyle.SINGLE, size: 4, color },
  bottom: { style: BorderStyle.SINGLE, size: 4, color },
  left:   { style: BorderStyle.SINGLE, size: 4, color },
  right:  { style: BorderStyle.SINGLE, size: 4, color },
});

const bottomOnlyBorder = (color = BRAND.navy) => ({
  top:    { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.SINGLE, size: 8, color },
  left:   { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' },
});

// ─────────────────────────── HELPER: shading ─────────────────────────────────
const shade = (color) => ({ type: ShadingType.SOLID, color, fill: color });

// ─────────────────────────── HELPER: spacer paragraph ────────────────────────
const spacer = (pts = 80) =>
  new Paragraph({ spacing: { before: pts, after: 0 }, children: [] });

// ─────────────────────────── HELPER: horizontal rule ─────────────────────────
function hRule(color = BRAND.navy) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, color },
    },
    children: [],
  });
}

// ─────────────────────────── HELPER: checkbox line ───────────────────────────
function checkBox(label, description = '') {
  return new Paragraph({
    spacing: { before: 60, after: 20 },
    indent:  { left: convertInchesToTwip(0.15) },
    children: [
      new TextRun({ text: '☐  ', font: FONT, size: 24, bold: true, color: BRAND.navy }),
      new TextRun({ text: label, font: FONT, size: 22, bold: true, color: BRAND.dark }),
      ...(description ? [new TextRun({ text: `  —  ${description}`, font: FONT, size: 20, color: '555555' })] : []),
    ],
  });
}

// ─────────────────────────── HELPER: field row in form table ─────────────────
// Returns a TableRow with [label | fill-in line | label | fill-in line]
function fieldRow(label1, label2 = null) {
  const labelCell = (txt) => new TableCell({
    width:  { size: 18, type: WidthType.PERCENTAGE },
    borders: noBorder,
    shading: shade(BRAND.ltGray),
    verticalAlign: VerticalAlign.BOTTOM,
    margins: { left: 80, right: 80, top: 40, bottom: 40 },
    children: [new Paragraph({
      children: [new TextRun({ text: txt, font: FONT, size: 18, bold: true, color: BRAND.navy })],
    })],
  });

  const inputCell = (wide = false) => new TableCell({
    width:  { size: wide ? 64 : 29, type: WidthType.PERCENTAGE },
    borders: bottomOnlyBorder(BRAND.navy),
    verticalAlign: VerticalAlign.BOTTOM,
    margins: { left: 60, right: 60, top: 40, bottom: 10 },
    children: [new Paragraph({ children: [new TextRun({ text: '', size: 20 })] })],
  });

  if (!label2) {
    return new TableRow({
      height: { value: 480, rule: 'exact' },
      children: [labelCell(label1), inputCell(true)],
    });
  }

  return new TableRow({
    height: { value: 480, rule: 'exact' },
    children: [labelCell(label1), inputCell(), labelCell(label2), inputCell()],
  });
}

// ─────────────────────────── HELPER: plan table cell ─────────────────────────
function planCell(name, price, features, bgColor, textColor = BRAND.white, accent = BRAND.white) {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 40 },
      children: [
        new TextRun({ text: name, font: FONT, size: 28, bold: true, color: textColor }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [
        new TextRun({ text: price, font: FONT, size: 36, bold: true, color: accent }),
        new TextRun({ text: ' /μήνα', font: FONT, size: 18, color: textColor }),
      ],
    }),
    ...features.map(f => new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing:   { before: 30, after: 30 },
      indent:    { left: convertInchesToTwip(0.15) },
      children: [
        new TextRun({ text: '✓  ', font: FONT, size: 19, bold: true, color: accent }),
        new TextRun({ text: f,    font: FONT, size: 19, color: textColor }),
      ],
    })),
    spacer(60),
  ];

  return new TableCell({
    width:   { size: 33, type: WidthType.PERCENTAGE },
    borders: noBorder,
    shading: shade(bgColor),
    margins: { left: 120, right: 120, top: 60, bottom: 60 },
    children,
  });
}

// ─────────────────────────── HELPER: feature bullet ─────────────────────────
function bullet(icon, title, desc) {
  return new Paragraph({
    spacing: { before: 60, after: 40 },
    indent:  { left: convertInchesToTwip(0.2) },
    children: [
      new TextRun({ text: `${icon}  `, font: FONT, size: 22 }),
      new TextRun({ text: `${title}`, font: FONT, size: 22, bold: true, color: BRAND.navy }),
      new TextRun({ text: `  ${desc}`, font: FONT, size: 21, color: BRAND.dark }),
    ],
  });
}

// ─────────────────────────── SECTION HEADER paragraph ────────────────────────
function sectionTitle(text, color = BRAND.navy) {
  return new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [
      new TextRun({
        text,
        font:  FONT,
        size:  26,
        bold:  true,
        color,
        underline: { type: UnderlineType.SINGLE, color },
      }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BUILD DOCUMENT
// ═══════════════════════════════════════════════════════════════════════════════
function buildDocument() {

  // ── 1. HEADER ──────────────────────────────────────────────────────────────
  const headerTable = new Table({
    layout:  TableLayoutType.FIXED,
    width:   { size: 100, type: WidthType.PERCENTAGE },
    borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }])) },
    rows: [new TableRow({
      children: [
        // Left: branding
        new TableCell({
          width:   { size: 70, type: WidthType.PERCENTAGE },
          shading: shade(BRAND.navy),
          borders: noBorder,
          margins: { left: 200, right: 120, top: 140, bottom: 140 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: '🐟  FishBill', font: FONT, size: 52, bold: true, color: BRAND.white }),
              ],
            }),
            new Paragraph({
              spacing: { before: 40, after: 0 },
              children: [
                new TextRun({ text: 'Ψηφιακή Πλατφόρμα Τιμολόγησης για Αλιείς', font: FONT, size: 22, color: 'B0CCE8', italics: true }),
              ],
            }),
          ],
        }),
        // Right: "NEW" badge area
        new TableCell({
          width:   { size: 30, type: WidthType.PERCENTAGE },
          shading: shade(BRAND.blue),
          borders: noBorder,
          verticalAlign: VerticalAlign.CENTER,
          margins: { left: 120, right: 200, top: 80, bottom: 80 },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: '1ος Μήνας', font: FONT, size: 20, bold: true, color: BRAND.white }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: 'ΔΩΡΕΑΝ', font: FONT, size: 32, bold: true, color: 'FFD700' }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 40 },
              children: [
                new TextRun({ text: 'για κάθε νέο χρήστη', font: FONT, size: 18, color: 'B0CCE8' }),
              ],
            }),
          ],
        }),
      ],
    })],
  });

  // ── 2. APP DESCRIPTION ────────────────────────────────────────────────────
  const descSection = [
    spacer(100),
    sectionTitle('Τι είναι το FishBill;'),
    new Paragraph({
      spacing: { before: 40, after: 80 },
      children: [
        new TextRun({
          text: 'Το FishBill είναι η πρώτη ελληνική ψηφιακή πλατφόρμα σχεδιασμένη αποκλειστικά για αλιείς. '
              + 'Αναλαμβάνουμε όλη την τιμολόγηση και τη διαχείριση εγγράφων σας — εσείς ασχολείστε με τη δουλειά σας.',
          font: FONT, size: 21, color: BRAND.dark,
        }),
      ],
    }),
    bullet('📄', 'Αυτόματη έκδοση τιμολογίων', '— πλήρης συμβατότητα με myDATA / AADE'),
    bullet('🐠', 'Δελτία ζύγισης & αλιεύματος', '— ψηφιακή καταγραφή ποσοτήτων και ειδών'),
    bullet('📋', 'Υποβολή OSPA', '— μηνιαία αρχειοθέτηση χωρίς χάρτινα έγγραφα'),
    bullet('🔍', 'Αναζήτηση ΑΦΜ (GGPS)',         '— άμεσος έλεγχος αγοραστή'),
    bullet('🧾', 'Παραστατικά παράδοσης',         '— ηλεκτρονικά δελτία αποστολής'),
    bullet('📱', 'Πρόσβαση από παντού',            '— web εφαρμογή + σύντομα Android'),
    bullet('👨‍💼', 'Διαχείριση από λογιστή',         '— ο λογιστής σας έχει πρόσβαση στο σύστημα'),
  ];

  // ── 3. PLAN TABLE ─────────────────────────────────────────────────────────
  const plansSection = [
    spacer(80),
    hRule(),
    sectionTitle('Επιλέξτε το Πλάνο σας'),
    new Table({
      layout:  TableLayoutType.FIXED,
      width:   { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }])) },
      rows: [new TableRow({
        children: [
          planCell(
            'BASIC',
            '€29,99',
            [
              'Έκδοση τιμολογίων (myDATA)',
              'Δελτία ζύγισης',
              'Παραστατικά παράδοσης',
              'Αναζήτηση ΑΦΜ (GGPS)',
              'Υποστήριξη μέσω email',
            ],
            BRAND.blue, BRAND.white, 'FFD700',
          ),
          planCell(
            'STANDARD',
            '€49,99',
            [
              'Όλα του Basic',
              'Αναφορές & στατιστικά',
              'Εξαγωγή σε Excel / PDF',
              'Ειδοποιήσεις email',
              'Προτεραιότητα υποστήριξης',
            ],
            BRAND.teal, BRAND.white, 'FFD700',
          ),
          planCell(
            'PREMIUM',
            '€79,99',
            [
              'Όλα του Standard',
              'Απεριόριστα τιμολόγια',
              'Πρόσβαση πολλών χρηστών',
              'API σύνδεση AADE',
              'Αφοσιωμένος λογαριασμός',
            ],
            BRAND.navy, BRAND.white, 'FFD700',
          ),
        ],
      })],
    }),
  ];

  // ── 4. ADDON BOX ──────────────────────────────────────────────────────────
  const addonSection = [
    spacer(80),
    new Table({
      layout:  TableLayoutType.FIXED,
      width:   { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.SINGLE, size: 6, color: BRAND.orange }])) },
      rows: [new TableRow({
        children: [new TableCell({
          shading: shade('FFF8F0'),
          margins: { left: 200, right: 200, top: 100, bottom: 100 },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 40 },
              children: [
                new TextRun({ text: '➕  Προαιρετικό Πρόσθετο (Add-on)', font: FONT, size: 22, bold: true, color: BRAND.orange }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: 'OSPA — Μηνιαία Υποβολή Αλιευτικής Δήλωσης', font: FONT, size: 21, bold: true, color: BRAND.dark }),
                new TextRun({ text: '   +€5,00/μήνα', font: FONT, size: 21, bold: true, color: BRAND.orange }),
              ],
            }),
            new Paragraph({
              spacing: { before: 30 },
              children: [
                new TextRun({
                  text: 'Αναλαμβάνουμε την ψηφιακή σύνταξη και αρχειοθέτηση της μηνιαίας δήλωσης OSPA '
                      + 'απαλλάσσοντάς σας από τη γραφειοκρατία. Ιδανικό για αλιείς που υποχρεούνται σε '
                      + 'μηνιαία υποβολή στοιχείων αλιευμάτων.',
                  font: FONT, size: 19, color: '555555',
                }),
              ],
            }),
          ],
        })],
      })],
    }),
  ];

  // ── 5. REGISTRATION FORM ──────────────────────────────────────────────────
  const formSection = [
    spacer(80),
    hRule(),
    sectionTitle('✍️  Φόρμα Εγγραφής', BRAND.navy),
    new Paragraph({
      spacing: { before: 0, after: 80 },
      children: [
        new TextRun({
          text: 'Συμπληρώστε τα παρακάτω πεδία με κεφαλαία γράμματα και επιστρέψτε τη φόρμα στον λογιστή σας.',
          font: FONT, size: 19, italics: true, color: '555555',
        }),
      ],
    }),

    // Personal details table
    new Table({
      layout:  TableLayoutType.FIXED,
      width:   { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }])) },
      rows: [
        fieldRow('Επώνυμο', 'Όνομα'),
        new TableRow({ height: { value: 120, rule: 'exact' }, children: [
          new TableCell({ columnSpan: 4, borders: noBorder, children: [spacer(0)] }),
        ]}),
        fieldRow('ΑΦΜ', 'ΔΟΥ'),
        new TableRow({ height: { value: 120, rule: 'exact' }, children: [
          new TableCell({ columnSpan: 4, borders: noBorder, children: [spacer(0)] }),
        ]}),
        fieldRow('Κινητό Τηλέφωνο', 'Email'),
        new TableRow({ height: { value: 120, rule: 'exact' }, children: [
          new TableCell({ columnSpan: 4, borders: noBorder, children: [spacer(0)] }),
        ]}),
        fieldRow('Περιφέρεια / Νομός', 'Πόλη / Χωριό'),
        new TableRow({ height: { value: 120, rule: 'exact' }, children: [
          new TableCell({ columnSpan: 4, borders: noBorder, children: [spacer(0)] }),
        ]}),
        fieldRow('Λιμάνι / Τόπος Αλιείας'),
      ],
    }),

    spacer(80),

    // Plan selection
    new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [
        new TextRun({ text: 'Επιλογή Πλάνου  ', font: FONT, size: 22, bold: true, color: BRAND.navy }),
        new TextRun({ text: '(σημειώστε με ✓)', font: FONT, size: 19, italics: true, color: '777777' }),
      ],
    }),

    new Table({
      layout:  TableLayoutType.FIXED,
      width:   { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }])) },
      rows: [new TableRow({
        children: [
          // Basic
          new TableCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            borders: thinBorder(BRAND.blue),
            shading: shade(BRAND.ltBlue),
            margins: { left: 120, right: 120, top: 80, bottom: 80 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [
                new TextRun({ text: '☐', font: FONT, size: 32, bold: true, color: BRAND.navy }),
              ]}),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [
                new TextRun({ text: 'BASIC', font: FONT, size: 22, bold: true, color: BRAND.navy }),
              ]}),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [
                new TextRun({ text: '€29,99 / μήνα', font: FONT, size: 20, bold: true, color: BRAND.blue }),
              ]}),
            ],
          }),
          new TableCell({ width: { size: 1, type: WidthType.PERCENTAGE }, borders: noBorder, children: [new Paragraph({ children: [] })] }),
          // Standard
          new TableCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            borders: thinBorder(BRAND.teal),
            shading: shade('D6F0EF'),
            margins: { left: 120, right: 120, top: 80, bottom: 80 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [
                new TextRun({ text: '☐', font: FONT, size: 32, bold: true, color: BRAND.teal }),
              ]}),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [
                new TextRun({ text: 'STANDARD', font: FONT, size: 22, bold: true, color: BRAND.teal }),
              ]}),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [
                new TextRun({ text: '€49,99 / μήνα', font: FONT, size: 20, bold: true, color: BRAND.teal }),
              ]}),
            ],
          }),
          new TableCell({ width: { size: 1, type: WidthType.PERCENTAGE }, borders: noBorder, children: [new Paragraph({ children: [] })] }),
          // Premium
          new TableCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            borders: thinBorder(BRAND.navy),
            shading: shade('CDD8E6'),
            margins: { left: 120, right: 120, top: 80, bottom: 80 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [
                new TextRun({ text: '☐', font: FONT, size: 32, bold: true, color: BRAND.navy }),
              ]}),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [
                new TextRun({ text: 'PREMIUM', font: FONT, size: 22, bold: true, color: BRAND.navy }),
              ]}),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [
                new TextRun({ text: '€79,99 / μήνα', font: FONT, size: 20, bold: true, color: BRAND.navy }),
              ]}),
            ],
          }),
        ],
      })],
    }),

    spacer(60),

    // OSPA checkbox
    new Paragraph({
      spacing: { before: 60, after: 30 },
      children: [
        new TextRun({ text: 'Πρόσθετη Υπηρεσία  ', font: FONT, size: 22, bold: true, color: BRAND.orange }),
        new TextRun({ text: '(προαιρετικό)', font: FONT, size: 19, italics: true, color: '777777' }),
      ],
    }),

    new Table({
      layout:  TableLayoutType.FIXED,
      width:   { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }])) },
      rows: [new TableRow({
        children: [new TableCell({
          borders: thinBorder(BRAND.orange),
          shading: shade('FFF3E0'),
          margins: { left: 160, right: 160, top: 80, bottom: 80 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: '☐  ', font: FONT, size: 28, bold: true, color: BRAND.orange }),
                new TextRun({ text: 'OSPA Add-on', font: FONT, size: 22, bold: true, color: BRAND.dark }),
                new TextRun({ text: '  (+€5,00 / μήνα)', font: FONT, size: 22, bold: true, color: BRAND.orange }),
                new TextRun({ text: '  —  Μηνιαία υποβολή δήλωσης αλιευμάτων OSPA', font: FONT, size: 20, color: '555555' }),
              ],
            }),
          ],
        })],
      })],
    }),

    spacer(80),

    // Signature row
    new Table({
      layout:  TableLayoutType.FIXED,
      width:   { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }])) },
      rows: [new TableRow({
        height: { value: 600, rule: 'exact' },
        children: [
          new TableCell({
            width: { size: 48, type: WidthType.PERCENTAGE },
            borders: bottomOnlyBorder(BRAND.navy),
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { left: 0, right: 200, top: 0, bottom: 40 },
            children: [new Paragraph({
              children: [new TextRun({ text: 'Υπογραφή Αλιέα', font: FONT, size: 18, bold: true, color: BRAND.navy })],
            })],
          }),
          new TableCell({
            width: { size: 4, type: WidthType.PERCENTAGE },
            borders: noBorder,
            children: [new Paragraph({ children: [] })],
          }),
          new TableCell({
            width: { size: 24, type: WidthType.PERCENTAGE },
            borders: bottomOnlyBorder(BRAND.navy),
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { left: 0, right: 0, top: 0, bottom: 40 },
            children: [new Paragraph({
              children: [new TextRun({ text: 'Ημερομηνία', font: FONT, size: 18, bold: true, color: BRAND.navy })],
            })],
          }),
          new TableCell({
            width: { size: 4, type: WidthType.PERCENTAGE },
            borders: noBorder,
            children: [new Paragraph({ children: [] })],
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            borders: bottomOnlyBorder(BRAND.navy),
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { left: 0, right: 0, top: 0, bottom: 40 },
            children: [new Paragraph({
              children: [new TextRun({ text: 'Αρ. Ταυτότητας / ΑΦΜ', font: FONT, size: 18, bold: true, color: BRAND.navy })],
            })],
          }),
        ],
      })],
    }),
  ];

  // ── 6. FOOTER ─────────────────────────────────────────────────────────────
  const footerSection = [
    spacer(80),
    hRule(BRAND.blue),
    new Table({
      layout:  TableLayoutType.FIXED,
      width:   { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...Object.fromEntries(['top','bottom','left','right','insideH','insideV'].map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }])) },
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: noBorder,
            margins: { left: 0, right: 80, top: 60, bottom: 40 },
            children: [
              new Paragraph({ children: [
                new TextRun({ text: '📞  Επικοινωνία', font: FONT, size: 20, bold: true, color: BRAND.navy }),
              ]}),
              new Paragraph({ spacing: { before: 30 }, children: [
                new TextRun({ text: 'Τηλ: ', font: FONT, size: 19, bold: true, color: BRAND.dark }),
                new TextRun({ text: 'Επικοινωνήστε με τον λογιστή σας', font: FONT, size: 19, color: '444444' }),
              ]}),
              new Paragraph({ spacing: { before: 20 }, children: [
                new TextRun({ text: 'Email: ', font: FONT, size: 19, bold: true, color: BRAND.dark }),
                new TextRun({ text: 'pkotsorgios654@gmail.com', font: FONT, size: 19, color: BRAND.blue }),
              ]}),
            ],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: noBorder,
            margins: { left: 80, right: 0, top: 60, bottom: 40 },
            children: [
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                new TextRun({ text: '⚖️  Σημαντική Σημείωση', font: FONT, size: 20, bold: true, color: BRAND.orange }),
              ]}),
              new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 30 }, children: [
                new TextRun({
                  text: 'Ο πρώτος μήνας παρέχεται δωρεάν για κάθε νέο χρήστη. '
                      + 'Η χρέωση ξεκινά από τον 2ο μήνα. '
                      + 'Δεν απαιτείται δέσμευση — ακύρωση οποτεδήποτε.',
                  font: FONT, size: 17, color: '555555',
                }),
              ]}),
            ],
          }),
        ],
      })],
    }),
    spacer(40),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 40 },
      children: [
        new TextRun({
          text: 'FishBill © 2026  —  Ψηφιακή Τιμολόγηση για Αλιείς  —  Συμβατό με myDATA / AADE',
          font: FONT, size: 16, color: BRAND.midGray, italics: true,
        }),
      ],
    }),
  ];

  // ── ASSEMBLE ──────────────────────────────────────────────────────────────
  return new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 22, color: BRAND.dark } },
      },
    },
    sections: [{
      properties: {
        page: {
          size:    { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) }, // A4
          margin:  { top: convertInchesToTwip(0.7), bottom: convertInchesToTwip(0.7),
                     left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) },
        },
      },
      children: [
        headerTable,
        ...descSection,
        ...plansSection,
        ...addonSection,
        ...formSection,
        ...footerSection,
      ],
    }],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('Δημιουργία φόρμας εγγραφής...');
  const doc     = buildDocument();
  const buffer  = await Packer.toBuffer(doc);
  const outPath = path.resolve(__dirname, 'FishBill_Φόρμα_Εγγραφής.docx');
  fs.writeFileSync(outPath, buffer);
  console.log(`\n✅  Έτοιμο: ${outPath}`);
  console.log('   Ανοίξτε με Word, ελέγξτε, εκτυπώστε ή στείλτε ψηφιακά.\n');
}

main().catch(err => { console.error('Σφάλμα:', err.message); process.exit(1); });
