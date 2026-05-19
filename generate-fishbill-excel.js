// ═══════════════════════════════════════════════════════════════════════════════
//  FishBill Excel Management System Generator
//  Run: node generate-fishbill-excel.js
//  Output: FishBill_Management.xlsx  (same folder)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const ExcelJS = require('exceljs');
const path    = require('path');

// ─────────────────────────── COLOUR PALETTE (ARGB) ───────────────────────────
const C = {
  navy:     'FF0D3B66', blue:     'FF1B6CA8', ltBlue:   'FFEBF3FB',
  teal:     'FF0A7E8C', green:    'FF2E8B57', ltGreen:  'FFD4EDDA',
  orange:   'FFE8740C', ltOrange: 'FFFFF3E0', red:      'FFB22222',
  ltRed:    'FFFDE8E8', gold:     'FF7D5A00', ltGold:   'FFFFF8DC',
  purple:   'FF6A0DAD', ltPurple: 'FFF3E8FF', gray:     'FF9E9E9E',
  ltGray:   'FFF5F5F5', white:    'FFFFFFFF', dark:     'FF1A1A2E',
  altRow:   'FFF0F7FF',
};

// ─────────────────────────── STYLE HELPERS ───────────────────────────────────
const fnt = (bold=false, sz=11, color=C.dark, nm='Calibri') =>
  ({ name: nm, size: sz, bold, color: { argb: color } });

const fl = (a) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: a } });

const bd = (s='thin', c='FFBDBDBD') =>
  ['top','bottom','left','right'].reduce((o,k) => ({ ...o, [k]: { style: s, color: { argb: c } } }), {});

const aln = (h='left', v='middle', w=false) => ({ horizontal: h, vertical: v, wrapText: w });

function mergeHeader(ws, row, c1, c2, txt, bgA, fgA=C.white, sz=15) {
  ws.mergeCells(row, c1, row, c2);
  const cell = ws.getCell(row, c1);
  cell.value = txt;
  cell.fill  = fl(bgA);
  cell.font  = fnt(true, sz, fgA);
  cell.alignment = aln('center', 'middle');
  ws.getRow(row).height = sz + 16;
}

function sectionHdr(ws, row, c1, c2, txt, bgA=C.blue) {
  ws.mergeCells(row, c1, row, c2);
  const cell = ws.getCell(row, c1);
  cell.value = txt;
  cell.fill  = fl(bgA);
  cell.font  = fnt(true, 10, C.white);
  cell.alignment = aln('left', 'middle');
  ws.getRow(row).height = 20;
}

function colHeaders(ws, row, headers, bgA=C.navy) {
  const r = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h;
    cell.fill  = fl(bgA);
    cell.font  = fnt(true, 10, C.white);
    cell.alignment = aln('center', 'middle', true);
    cell.border = bd('medium', 'FF000000');
  });
  r.height = 36;
  r.commit();
}

function sc(cell, bgA, bold=false, sz=11, fgA=C.dark, numFmt=null) {
  if (bgA)   cell.fill   = fl(bgA);
  cell.font  = fnt(bold, sz, fgA);
  cell.border = bd();
  if (numFmt) cell.numFmt = numFmt;
}

function lv(ws, row, col, label, value, numFmt=null, labelBg=C.ltGray, valueBg=C.white) {
  const lc = ws.getCell(row, col);
  lc.value = label;
  lc.fill  = fl(labelBg);
  lc.font  = fnt(true, 11, C.dark);
  lc.border = bd();
  lc.alignment = aln('right', 'middle');

  const vc = ws.getCell(row, col + 1);
  vc.value = value;
  vc.fill  = fl(valueBg);
  vc.font  = fnt(false, 11, C.dark);
  vc.border = bd();
  vc.alignment = aln('center', 'middle');
  if (numFmt) vc.numFmt = numFmt;

  ws.getRow(row).height = 22;
}

function colLetter(n) {
  let r = '';
  while (n > 0) { n--; r = String.fromCharCode(65 + (n % 26)) + r; n = Math.floor(n / 26); }
  return r;
}

function addDropDown(ws, rowS, rowE, col, list) {
  ws.dataValidations.add(`${colLetter(col)}${rowS}:${colLetter(col)}${rowE}`, {
    type: 'list', allowBlank: true,
    formulae: [`"${list.join(',')}"`],
    showErrorMessage: true,
    error: 'Επιλέξτε από τη λίστα', errorTitle: 'Μη έγκυρη τιμή',
  });
}

// ─────────────────────────── CONSTANTS ───────────────────────────────────────
const YEAR      = 2026;
const MONTHS_EL = ['Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος','Μάιος','Ιούνιος',
                   'Ιούλιος','Αύγουστος','Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'];
const MONTHS_SH = ['Ιαν','Φεβ','Μαρ','Απρ','Μαΐ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];

const REGIONS = [
  'Αττική','Κεντρική Μακεδονία','Δυτική Μακεδονία','Ανατολική Μακεδονία & Θράκη',
  'Ήπειρος','Θεσσαλία','Στερεά Ελλάδα','Δυτική Ελλάδα','Πελοπόννησος',
  'Ιόνια Νησιά','Βόρειο Αιγαίο','Νότιο Αιγαίο','Κρήτη',
];

const PLANS    = ['Basic','Standard','Premium'];
const STATUSES = ['Ενεργός','Ανενεργός','Δοκιμαστικός','Ληξιπρόθεσμος'];
const REL      = ['Άριστη','Καλή','Μέτρια','Κακή'];
const YN       = ['Ναι','Όχι'];
const OSPA_V   = ['Ολοκληρώθηκε','Εκκρεμεί','Δεν Απαιτείται'];

// Sheet names
const SN = {
  dash: 'Dashboard',  set:  'Ρυθμίσεις',    usr:  'Χρήστες',
  sub:  'Συνδρομές',  cred: 'Credentials',  ospa: 'OSPA',
  stat: 'Στατιστικά', cost: 'Ανάλυση Κόστους',
};

// Users sheet VLOOKUP range (update when adding columns)
const USR_RANGE = (sn) => `'${sn}'!$A$3:$AB$1002`;

// Settings cell references — Settings sheet column B
// Row layout: 3=sectionHdr, 4=Basic, 5=Standard, 6=Premium,
//             8=sectionHdr, 9=OSPA addon, 10=Extra addon,
//             12=sectionHdr, 13=Epsilon, 14=AADE,
//             16=sectionHdr, 17=FreeMonth, 18=VAT
const SET = {
  basic:     `'${SN.set}'!$B$4`,
  standard:  `'${SN.set}'!$B$5`,
  premium:   `'${SN.set}'!$B$6`,
  ospaAddon: `'${SN.set}'!$B$9`,
  extraAddon:`'${SN.set}'!$B$10`,
  epsilon:   `'${SN.set}'!$B$13`,
  aade:      `'${SN.set}'!$B$14`,
  freeMonth: `'${SN.set}'!$B$17`,
  vat:       `'${SN.set}'!$B$18`,
};

// Users sheet: column numbers for every field  (A=1 … AB=28)
const UL = {
  id:1,  ln:2,  fn:3,  afm:4,   doy:5,
  ph:6,  em:7,  reg:8, pref:9,  city:10,
  plan:11, ospa:12, start:13, freeEnd:14,
  fee:15, ospaCost:16, total:17,
  epsilon:18, net:19,
  status:20, rel:21, notes:22,
  // ── fishing / vessel ──
  license:23, boat:24, boatReg:25, port:26,
  // ── banking (reference copies — full details in Credentials) ──
  iban:27, bank:28,
};
// Letters derived automatically
const ULC = Object.fromEntries(Object.entries(UL).map(([k,v]) => [k, colLetter(v)]));

// ─────────────────────────── SAMPLE DATA ─────────────────────────────────────
const USERS = [
  { id:'USR001', ln:'Παπαδόπουλος', fn:'Γιάννης', afm:'123456789', doy:'ΔΟΥ Ηρακλείου',
    ph:'6901234567', em:'gpapadopoulos@example.com', reg:'Κρήτη', pref:'Ηράκλειο', city:'Ηράκλειο',
    plan:'Premium', ospa:'Ναι', start:new Date(2026,0,1), stat:'Ενεργός', rel:'Άριστη', notes:'VIP πελάτης',
    license:'ΑΛ-001234', boat:'ΑΓΙΟΣ ΝΙΚΟΛΑΟΣ', boatReg:'ΗΡ-123', port:'Ηράκλειο', iban:'GR1601101250000000012300695', bank:'Alpha Bank' },
  { id:'USR002', ln:'Αλεξίου', fn:'Νίκος', afm:'987654321', doy:'ΔΟΥ Πειραιά',
    ph:'6912345678', em:'nalexiou@example.com', reg:'Αττική', pref:'Αττική', city:'Πειραιάς',
    plan:'Standard', ospa:'Όχι', start:new Date(2026,1,1), stat:'Ενεργός', rel:'Καλή', notes:'',
    license:'ΑΛ-005678', boat:'ΠΟΣΕΙΔΩΝ', boatReg:'ΠΡ-456', port:'Πειραιάς', iban:'GR2601101250000000098765432', bank:'Eurobank' },
  { id:'USR003', ln:'Μανώλης', fn:'Κώστας', afm:'456789123', doy:'ΔΟΥ Κέρκυρας',
    ph:'6923456789', em:'kmanolis@example.com', reg:'Ιόνια Νησιά', pref:'Κέρκυρα', city:'Κέρκυρα',
    plan:'Basic', ospa:'Ναι', start:new Date(2025,10,1), stat:'Ληξιπρόθεσμος', rel:'Κακή', notes:'Καθυστέρηση 2 μηνών',
    license:'ΑΛ-009012', boat:'ΙΟΝΙΟ ΠΕΛΑΓΟΣ', boatReg:'ΚΡ-789', port:'Κέρκυρα', iban:'GR3601101250000000045678912', bank:'Πειραιώς' },
  { id:'USR004', ln:'Θεοδώρου', fn:'Σταύρος', afm:'321654987', doy:'ΔΟΥ Μυτιλήνης',
    ph:'6934567890', em:'stheodorou@example.com', reg:'Βόρειο Αιγαίο', pref:'Λέσβος', city:'Μυτιλήνη',
    plan:'Premium', ospa:'Ναι', start:new Date(2025,8,1), stat:'Ενεργός', rel:'Άριστη', notes:'',
    license:'ΑΛ-003456', boat:'ΑΙΟΛΟΣ', boatReg:'ΛΣ-321', port:'Μυτιλήνη', iban:'GR4601101250000000032165498', bank:'Εθνική' },
  { id:'USR005', ln:'Καρράς', fn:'Μιχάλης', afm:'654321789', doy:'ΔΟΥ Θεσσαλονίκης',
    ph:'6945678901', em:'mkarras@example.com', reg:'Κεντρική Μακεδονία', pref:'Θεσσαλονίκη', city:'Θεσσαλονίκη',
    plan:'Standard', ospa:'Όχι', start:new Date(2026,2,1), stat:'Δοκιμαστικός', rel:'Καλή', notes:'Νέος πελάτης',
    license:'ΑΛ-007890', boat:'ΘΕΡΜΑΙΚΟΣ', boatReg:'ΘΣ-654', port:'Θεσσαλονίκη', iban:'GR5601101250000000065432178', bank:'Optima' },
];

// Full credentials per user (all sensitive systems)
const CREDS = [
  { id:'USR001',
    fbEmail:'gpapadopoulos@example.com', fbPass:'••••••••',
    emailAddr:'gpapadopoulos@gmail.com', emailPass:'••••••••',
    txUser:'gpap_tax',   txPass:'••••••••',
    ggpsUser:'gpap_ggps', ggpsPass:'••••••••',
    aadeClientId:'CLIENT_001', aadeApiKey:'API_KEY_001_XXXXXXXXXXXXXXXXXXXXXXXX',
    ebUser:'gpap_ebank', ebPass:'••••••••', bank:'Alpha Bank',
    iban:'GR1601101250000000012300695', irisMobile:'6901234567', notes:'' },
  { id:'USR002',
    fbEmail:'nalexiou@example.com', fbPass:'••••••••',
    emailAddr:'nalexiou@yahoo.gr', emailPass:'••••••••',
    txUser:'nalex_tax',   txPass:'••••••••',
    ggpsUser:'nalex_ggps', ggpsPass:'••••••••',
    aadeClientId:'CLIENT_002', aadeApiKey:'API_KEY_002_XXXXXXXXXXXXXXXXXXXXXXXX',
    ebUser:'nalex_ebank', ebPass:'••••••••', bank:'Eurobank',
    iban:'GR2601101250000000098765432', irisMobile:'6912345678', notes:'' },
  { id:'USR003',
    fbEmail:'kmanolis@example.com', fbPass:'••••••••',
    emailAddr:'kmanolis@gmail.com', emailPass:'••••••••',
    txUser:'kman_tax',   txPass:'••••••••',
    ggpsUser:'kman_ggps', ggpsPass:'••••••••',
    aadeClientId:'CLIENT_003', aadeApiKey:'API_KEY_003_XXXXXXXXXXXXXXXXXXXXXXXX',
    ebUser:'kman_ebank', ebPass:'••••••••', bank:'Πειραιώς',
    iban:'GR3601101250000000045678912', irisMobile:'6923456789', notes:'Ληξιπρόθεσμος — επαλήθευση πληρωμής εκκρεμεί' },
  { id:'USR004',
    fbEmail:'stheodorou@example.com', fbPass:'••••••••',
    emailAddr:'stheodorou@hotmail.com', emailPass:'••••••••',
    txUser:'sthed_tax',   txPass:'••••••••',
    ggpsUser:'sthed_ggps', ggpsPass:'••••••••',
    aadeClientId:'CLIENT_004', aadeApiKey:'API_KEY_004_XXXXXXXXXXXXXXXXXXXXXXXX',
    ebUser:'sthed_ebank', ebPass:'••••••••', bank:'Εθνική',
    iban:'GR4601101250000000032165498', irisMobile:'6934567890', notes:'' },
  { id:'USR005',
    fbEmail:'mkarras@example.com', fbPass:'••••••••',
    emailAddr:'mkarras@gmail.com', emailPass:'••••••••',
    txUser:'mkar_tax',   txPass:'••••••••',
    ggpsUser:'mkar_ggps', ggpsPass:'••••••••',
    aadeClientId:'CLIENT_005', aadeApiKey:'API_KEY_005_XXXXXXXXXXXXXXXXXXXXXXXX',
    ebUser:'mkar_ebank', ebPass:'••••••••', bank:'Optima',
    iban:'GR5601101250000000065432178', irisMobile:'6945678901', notes:'Νέος — setup AADE εκκρεμεί' },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: Ρυθμίσεις  (Settings — single source of truth for all prices)
// ═══════════════════════════════════════════════════════════════════════════════
function buildSettings(wb) {
  const ws = wb.addWorksheet(SN.set, { tabColor: { argb: 'FF1B6CA8' } });
  ws.views = [{ showGridLines: false }];
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 50;

  mergeHeader(ws, 1, 1, 3, 'FishBill — Ρυθμίσεις & Μεταβλητές Τιμές', C.navy, C.white, 16);
  mergeHeader(ws, 2, 1, 3, 'Αλλάξτε ΜΟΝΟ τη στήλη Β — όλα τα φύλλα ενημερώνονται αυτόματα', C.orange, C.white, 10);

  // ── Plan prices (rows 3-6)
  sectionHdr(ws, 3, 1, 3, '   ΤΙΜΕΣ ΠΛΑΝΩΝ  (€ / χρήστη / μήνα)', C.blue);
  [
    [4, 'Basic Plan',    29.99, 'Βασικό πλάνο — μικρή δραστηριότητα'],
    [5, 'Standard Plan', 49.99, 'Τυπικό πλάνο — η πλειονότητα των χρηστών'],
    [6, 'Premium Plan',  79.99, 'Premium — εντατική χρήση, πλήρη χαρακτηριστικά'],
  ].forEach(([r, label, val, note]) => {
    lv(ws, r, 1, label, val, '"€"#,##0.00', C.ltBlue, C.white);
    const nc = ws.getCell(r, 3); nc.value = note; sc(nc, C.ltGray, false, 10, C.gray); nc.alignment = aln('left','middle');
  });

  ws.getRow(7).height = 6;

  // ── Add-ons (rows 8-10)
  sectionHdr(ws, 8, 1, 3, '   ΠΡΟΣΘΕΤΑ (ADD-ONS)  (€ / χρήστη / μήνα)', C.blue);
  [
    [9,  'OSPA Addon',           5.00, 'Μηνιαία υποβολή OSPA ανά αλιέα'],
    [10, 'Extra Addon (future)', 0.00, 'Διαθέσιμο για μελλοντική υπηρεσία — θέστε 0 αν ανενεργό'],
  ].forEach(([r, label, val, note]) => {
    lv(ws, r, 1, label, val, '"€"#,##0.00', C.ltBlue, C.white);
    const nc = ws.getCell(r, 3); nc.value = note; sc(nc, C.ltGray, false, 10, C.gray); nc.alignment = aln('left','middle');
  });

  ws.getRow(11).height = 6;

  // ── System costs (rows 12-14)
  sectionHdr(ws, 12, 1, 3, '   ΚΟΣΤΗ ΣΥΣΤΗΜΑΤΟΣ  (€ / χρήστη / μήνα)', C.orange);
  [
    [13, 'Epsilon Smart — κόστος/χρήστη/μήνα', 3.00, 'Κόστος Epsilon που αφαιρείται από κάθε συνδρομή'],
    [14, 'AADE Timologio — κόστος/χρήστη/μήνα', 0.00, 'Εναλλακτικό σύστημα (δωρεάν = 0)'],
  ].forEach(([r, label, val, note]) => {
    lv(ws, r, 1, label, val, '"€"#,##0.00', C.ltOrange, C.white);
    const nc = ws.getCell(r, 3); nc.value = note; sc(nc, C.ltGray, false, 10, C.gray); nc.alignment = aln('left','middle');
  });

  ws.getRow(15).height = 6;

  // ── Options (rows 16-18)
  sectionHdr(ws, 16, 1, 3, '   ΕΠΙΛΟΓΕΣ', C.teal);
  lv(ws, 17, 1, 'Πρώτος Μήνας Δωρεάν', true, null, C.ltBlue, C.white);
  const fn = ws.getCell(17, 3); fn.value = 'TRUE = 1ος μήνας χωρίς χρέωση (Λήξη Δωρεάν υπολογίζεται αυτόματα)';
  sc(fn, C.ltGray, false, 10, C.gray); fn.alignment = aln('left','middle');

  lv(ws, 18, 1, 'ΦΠΑ (%)', 0.24, '0%', C.ltBlue, C.white);
  const vn = ws.getCell(18, 3); vn.value = 'Ποσοστό ΦΠΑ για έκδοση τιμολογίων (24% τυπικά)';
  sc(vn, C.ltGray, false, 10, C.gray); vn.alignment = aln('left','middle');

  ws.getRow(19).height = 6;

  // ── Cost comparison legend
  sectionHdr(ws, 20, 1, 3, '   ΕΠΕΞΗΓΗΣΗ: Πώς υπολογίζεται το κόστος/εξοικονόμηση', C.navy);
  const legend = [
    [21, 'Μηνιαία Χρέωση Χρήστη', '= Τιμή Πλάνου + OSPA Addon (αν ισχύει)'],
    [22, 'Κόστος Epsilon/χρήστη', '= B13  →  αφαιρείται από το μηνιαίο έσοδο'],
    [23, 'Καθαρό Έσοδο/χρήστη',  '= Μηνιαία Χρέωση − Κόστος Epsilon'],
    [24, 'Εξοικονόμηση/χρήστη (αν αλλάξετε σε AADE)', '= B13 − B14  (ανά μήνα)'],
    [25, 'Ετήσια εξοικονόμηση',   '= Εξοικονόμηση × 12 × Αριθμός ενεργών χρηστών'],
  ];
  legend.forEach(([r, label, val]) => {
    lv(ws, r, 1, label, val, null, C.ltGold, C.ltGold);
    ws.getCell(r, 2).alignment = aln('left','middle');
    ws.mergeCells(r, 2, r, 3);
    ws.getRow(r).height = 20;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: Χρήστες  (Master user table with formula columns)
// ═══════════════════════════════════════════════════════════════════════════════
function buildUsers(wb) {
  const ws = wb.addWorksheet(SN.usr, { tabColor: { argb: 'FF2E8B57' } });
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 2, showGridLines: true }];

  // Column widths  (A–V existing, W–AB new)
  [10,18,14,14,18,14,28,22,18,16, 12,8,14,14, 14,12,14, 14,14, 14,12,30, 20,20,14,20, 30,18]
    .forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Title + headers
  mergeHeader(ws, 1, 1, 28, `Χρήστες FishBill — ${YEAR}  |  Πίνακας Αλιέων & Συνδρομών`, C.navy, C.white, 13);

  colHeaders(ws, 2, [
    'ID', 'Επώνυμο', 'Όνομα', 'ΑΦΜ', 'ΔΟΥ',
    'Τηλέφωνο', 'Email', 'Περιφέρεια', 'Νομός', 'Πόλη',
    'Πλάνο', 'OSPA', 'Έναρξη\nΣυνδρομής', 'Λήξη\nΔωρεάν',
    'Μηνιαία\nΧρέωση', 'Addon\nOSPA', 'Σύνολο\n/μήνα',
    'Κόστος\nEpsilon', 'Καθαρό\nΈσοδο',
    'Κατάσταση', 'Αξιοπιστία\nΠληρωμής', 'Σημειώσεις',
    // ── new ──────────────────────────────────────────────────
    'Αρ. Αλιευτικής\nΆδειας', 'Όνομα\nΣκάφους', 'Αρ.\nΝηολογίου', 'Λιμάνι /\nΛιμενάρχειο',
    'IBAN', 'Τράπεζα',
  ], C.navy);

  // Formula builder for each data row
  const DATA_ROWS = 1000;
  const START_ROW = 3;

  for (let i = 0; i < DATA_ROWS; i++) {
    const r   = START_ROW + i;
    const usr = USERS[i] || null;
    const bgA = i % 2 === 0 ? C.white : C.altRow;

    // Static data cells (28 columns)
    const vals = usr ? [
      usr.id, usr.ln, usr.fn, usr.afm, usr.doy,
      usr.ph, usr.em, usr.reg, usr.pref, usr.city,
      usr.plan, usr.ospa, usr.start, null,       // freeEnd = formula
      null, null, null, null, null,               // fee/ospaCost/total/epsilon/net = formulas
      usr.stat, usr.rel, usr.notes,
      // ── new columns ──
      usr.license, usr.boat, usr.boatReg, usr.port, usr.iban, usr.bank,
    ] : Array(28).fill(null);

    vals.forEach((v, ci) => {
      const col = ci + 1;
      const cell = ws.getCell(r, col);

      // Formula columns override static
      if (col === UL.freeEnd) {
        cell.value = { formula: `IF(${SET.freeMonth}=TRUE,EDATE(${ULC.start}${r},1),${ULC.start}${r})` };
        cell.numFmt = 'dd/mm/yyyy';
      } else if (col === UL.fee) {
        cell.value = { formula: `IF(${ULC.plan}${r}="Basic",${SET.basic},IF(${ULC.plan}${r}="Standard",${SET.standard},IF(${ULC.plan}${r}="Premium",${SET.premium},0)))` };
        cell.numFmt = '"€"#,##0.00';
      } else if (col === UL.ospaCost) {
        cell.value = { formula: `IF(${ULC.ospa}${r}="Ναι",${SET.ospaAddon},0)` };
        cell.numFmt = '"€"#,##0.00';
      } else if (col === UL.total) {
        cell.value = { formula: `${ULC.fee}${r}+${ULC.ospaCost}${r}` };
        cell.numFmt = '"€"#,##0.00';
      } else if (col === UL.epsilon) {
        cell.value = { formula: `IF(${ULC.status}${r}="Ενεργός",${SET.epsilon},0)` };
        cell.numFmt = '"€"#,##0.00';
      } else if (col === UL.net) {
        cell.value = { formula: `${ULC.total}${r}-${ULC.epsilon}${r}` };
        cell.numFmt = '"€"#,##0.00';
      } else {
        if (v !== null) cell.value = v;
        if (col === UL.start) cell.numFmt = 'dd/mm/yyyy';
      }

      cell.fill   = fl(bgA);
      cell.font   = fnt(false, 10, C.dark);
      cell.border = bd();
      if (col <= 4) cell.alignment = aln('center','middle');
      else          cell.alignment = aln('left','middle');
    });

    ws.getRow(r).height = 20;
  }

  // Drop-down validation
  const eRow = START_ROW + DATA_ROWS - 1;
  addDropDown(ws, START_ROW, eRow, UL.plan,   PLANS);
  addDropDown(ws, START_ROW, eRow, UL.ospa,   YN);
  addDropDown(ws, START_ROW, eRow, UL.status, STATUSES);
  addDropDown(ws, START_ROW, eRow, UL.rel,    REL);
  addDropDown(ws, START_ROW, eRow, UL.reg,    REGIONS);

  // Conditional formatting — status colours
  ws.addConditionalFormatting({
    ref: `${ULC.status}${START_ROW}:${ULC.status}${eRow}`,
    rules: [
      { type:'containsText', operator:'containsText', text:'Ληξιπρόθεσμος', priority:1,
        style:{ fill: fl(C.ltRed), font: fnt(true, 10, C.red) } },
      { type:'containsText', operator:'containsText', text:'Δοκιμαστικός', priority:2,
        style:{ fill: fl(C.ltOrange), font: fnt(false, 10, C.orange) } },
      { type:'containsText', operator:'containsText', text:'Ενεργός', priority:3,
        style:{ fill: fl(C.ltGreen), font: fnt(false, 10, C.green) } },
    ],
  });

  // Conditional formatting — payment reliability
  ws.addConditionalFormatting({
    ref: `${ULC.rel}${START_ROW}:${ULC.rel}${eRow}`,
    rules: [
      { type:'containsText', operator:'containsText', text:'Κακή', priority:1,
        style:{ fill: fl(C.ltRed), font: fnt(true, 10, C.red) } },
      { type:'containsText', operator:'containsText', text:'Άριστη', priority:2,
        style:{ fill: fl(C.ltGreen), font: fnt(false, 10, C.green) } },
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: Συνδρομές  (Monthly payment tracking per user)
// ═══════════════════════════════════════════════════════════════════════════════
function buildSubscriptions(wb) {
  const ws = wb.addWorksheet(SN.sub, { tabColor: { argb: 'FF0D3B66' } });
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 2, showGridLines: true }];

  // Cols: A=ID B=Επώνυμο+Όνομα C=ΑΦΜ D=Πλάνο | E..P=Jan..Dec | Q=TotalPaid R=AnnualExp S=Rate T=Diff
  const COL_JAN   = 5;
  const COL_DEC   = 16;
  const COL_TPAID = 17;
  const COL_AEXP  = 18;
  const COL_RATE  = 19;
  const COL_DIFF  = 20;

  const usrRef = (r, col) => `IFERROR(VLOOKUP($A${r},${USR_RANGE(SN.usr)},${col},FALSE),"")`;

  widths([10, 26, 14, 12, ...Array(12).fill(9), 14, 14, 10, 14], ws);

  mergeHeader(ws, 1, 1, 20, `Παρακολούθηση Συνδρομών — ${YEAR}  |  Εισάγετε ποσό που εισπράχθηκε (€) ή 0`, C.navy, C.white, 13);

  // Header row
  const hdrs = ['ID', 'Ονοματεπώνυμο', 'ΑΦΜ', 'Πλάνο',
    ...MONTHS_SH.map(m => `${m}\n${YEAR}`),
    'Σύνολο\nΕισπραχθέντων', 'Ετήσια\nΑναμενόμενα', 'Ποσοστό\nΕίσπραξης', 'Διαφορά'];
  colHeaders(ws, 2, hdrs, C.navy);

  const DATA_ROWS = 200;
  const START_ROW = 3;

  for (let i = 0; i < DATA_ROWS; i++) {
    const r   = START_ROW + i;
    const usr = USERS[i] || null;
    const bgA = i % 2 === 0 ? C.white : C.altRow;

    // ID cell — pre-fill for samples
    const idCell = ws.getCell(r, 1);
    if (usr) idCell.value = usr.id;
    sc(idCell, bgA, false, 10);

    // Name (formula)
    const nameCell = ws.getCell(r, 2);
    nameCell.value = { formula: `${usrRef(r,2)}&IF(${usrRef(r,3)}<>""," "&${usrRef(r,3)},"")` };
    sc(nameCell, bgA, false, 10);

    // AFM
    const afmCell = ws.getCell(r, 3);
    afmCell.value = { formula: usrRef(r, 4) };
    sc(afmCell, bgA, false, 10);

    // Plan
    const planCell = ws.getCell(r, 4);
    planCell.value = { formula: usrRef(r, 11) };
    sc(planCell, bgA, false, 10);

    // Month cells (E..P) — manual input, yellow background = fill in
    for (let m = 0; m < 12; m++) {
      const cell = ws.getCell(r, COL_JAN + m);
      if (usr) cell.value = 0;  // default 0
      sc(cell, i % 2 === 0 ? 'FFFFFEF0' : 'FFFFFCE8', false, 10);
      cell.numFmt = '"€"#,##0.00';
      cell.alignment = aln('center','middle');
    }

    // Total paid
    const janL = colLetter(COL_JAN); const decL = colLetter(COL_DEC);
    const tpCell = ws.getCell(r, COL_TPAID);
    tpCell.value = { formula: `SUM(${janL}${r}:${decL}${r})` };
    sc(tpCell, bgA, true, 10, C.navy); tpCell.numFmt = '"€"#,##0.00';

    // Annual expected (monthly * 12)
    const aeCell = ws.getCell(r, COL_AEXP);
    aeCell.value = { formula: `IFERROR(${usrRef(r,17)}*12,0)` };
    sc(aeCell, bgA, false, 10); aeCell.numFmt = '"€"#,##0.00';

    // Collection rate
    const rateCell = ws.getCell(r, COL_RATE);
    rateCell.value = { formula: `IF(${colLetter(COL_AEXP)}${r}>0,${colLetter(COL_TPAID)}${r}/${colLetter(COL_AEXP)}${r},"")` };
    sc(rateCell, bgA, false, 10); rateCell.numFmt = '0.0%';

    // Difference
    const diffCell = ws.getCell(r, COL_DIFF);
    diffCell.value = { formula: `${colLetter(COL_TPAID)}${r}-${colLetter(COL_AEXP)}${r}` };
    sc(diffCell, bgA, false, 10); diffCell.numFmt = '"€"#,##0.00';

    ws.getRow(r).height = 20;
  }

  // Conditional format: negative difference = red
  const eRow = START_ROW + DATA_ROWS - 1;
  ws.addConditionalFormatting({
    ref: `${colLetter(COL_DIFF)}${START_ROW}:${colLetter(COL_DIFF)}${eRow}`,
    rules: [{
      type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 1,
      style: { fill: fl(C.ltRed), font: fnt(true, 10, C.red) },
    }],
  });

  // Totals row at the bottom
  const totRow = START_ROW + DATA_ROWS;
  mergeHeader(ws, totRow, 1, 4, 'ΣΥΝΟΛΑ', C.navy, C.white, 11);
  for (let m = 0; m < 12; m++) {
    const col = COL_JAN + m;
    const cell = ws.getCell(totRow, col);
    cell.value = { formula: `SUM(${colLetter(col)}${START_ROW}:${colLetter(col)}${eRow})` };
    sc(cell, C.navy, true, 10, C.white); cell.numFmt = '"€"#,##0.00';
  }
  const totPaid = ws.getCell(totRow, COL_TPAID);
  totPaid.value = { formula: `SUM(${colLetter(COL_TPAID)}${START_ROW}:${colLetter(COL_TPAID)}${eRow})` };
  sc(totPaid, C.navy, true, 10, C.white); totPaid.numFmt = '"€"#,##0.00';
  const totExp = ws.getCell(totRow, COL_AEXP);
  totExp.value = { formula: `SUM(${colLetter(COL_AEXP)}${START_ROW}:${colLetter(COL_AEXP)}${eRow})` };
  sc(totExp, C.navy, true, 10, C.white); totExp.numFmt = '"€"#,##0.00';
}

// helper to set multiple column widths at once
function widths(arr, ws) {
  arr.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: Credentials  (Sensitive — recommend protecting this sheet)
// ═══════════════════════════════════════════════════════════════════════════════
function buildCredentials(wb) {
  const ws = wb.addWorksheet(SN.cred, { tabColor: { argb: 'FF8B6914' } });
  const usrRef = (r, col) => `IFERROR(VLOOKUP($A${r},${USR_RANGE(SN.usr)},${col},FALSE),"")`;
  const DATA_ROWS = 200;
  const START_ROW = 4;

  // ── Column layout (A–U = 21 cols) ────────────────────────────────────────
  // A  B           C    D          E         F             G
  // ID Name(f)    AFM  FB Email   FB Pass   Pers. Email   Pers. Email Pass
  // H          I        J         K          L             M
  // Taxisnet U  Tax.P   GGPS U    GGPS P    AADE ClientID AADE API Key
  // N        O          P         Q     R          S       T       U
  // eBank U  eBank P   Τράπεζα   IBAN  IRIS Mob  Πλάνο(f) Stat(f) Notes
  widths([10,26,14, 28,22, 28,22, 22,22, 22,22, 28,38, 22,22, 18,30, 18, 12,14, 34], ws);

  mergeHeader(ws, 1, 1, 21, 'CREDENTIALS — ΠΛΗΡΗ ΕΥΑΙΣΘΗΤΑ ΣΤΟΙΧΕΙΑ ΧΡΗΣΤΩΝ  |  ⚠ ΑΠΟΚΛΕΙΣΤΙΚΑ ΓΙΑ ΛΟΓΙΣΤΗ', C.red, C.white, 13);
  mergeHeader(ws, 2, 1, 21,
    'ΠΡΟΣΟΧΗ: Αυτό το φύλλο περιέχει κωδικούς & API keys. Κρατήστε το ΚΛΕΙΔΩΜΕΝΟ (Review → Protect Sheet) και κρυπτογραφήστε το αρχείο.',
    'FFFFF3CD', C.red, 9);

  // Header groups (row 3 = category row)
  const grpHdrs = [
    [1,3,  'ΤΑΥΤΟΤΗΤΑ',          C.navy],
    [4,5,  'FISHBILL APP',       'FF8B0000'],
    [6,7,  'ΠΡΟΣΩΠΙΚΟ EMAIL',    C.gold],
    [8,9,  'TAXISNET',           C.teal],
    [10,11,'GGPS / ΑΦΜ',        C.teal],
    [12,13,'myAADE',             C.purple],
    [14,15,'e-BANKING',          'FF8B0000'],
    [16,16,'ΤΡΑΠΕΖΑ',            C.blue],
    [17,17,'IBAN',               C.blue],
    [18,18,'IRIS ΚΙΝΗΤΟ',        C.blue],
    [19,20,'ΣΥΝΔΡΟΜΗ (auto)',    C.green],
    [21,21,'ΣΗΜΕΙΩΣΕΙΣ',         C.gray],
  ];
  grpHdrs.forEach(([c1, c2, lbl, bg]) => {
    if (c1 === c2) {
      const cell = ws.getCell(3, c1);
      cell.value = lbl; cell.fill = fl('FF' + bg.replace(/^FF/,'')); // already ARGB or hex
      cell.fill = fl(bg.startsWith('FF') ? bg : 'FF' + bg);
      cell.font = fnt(true, 9, C.white); cell.alignment = aln('center','middle'); cell.border = bd();
    } else {
      ws.mergeCells(3, c1, 3, c2);
      const cell = ws.getCell(3, c1);
      cell.value = lbl;
      cell.fill = fl(bg.startsWith('FF') ? bg : 'FF' + bg);
      cell.font = fnt(true, 9, C.white); cell.alignment = aln('center','middle'); cell.border = bd();
    }
  });
  ws.getRow(3).height = 18;

  colHeaders(ws, 4, [
    'ID', 'Ονοματεπώνυμο', 'ΑΦΜ',
    'FishBill\nEmail Login', 'FishBill\nPassword',
    'Προσωπικό\nEmail', 'Email\nPassword',
    'Taxisnet\nUsername', 'Taxisnet\nPassword',
    'GGPS\nUsername', 'GGPS\nPassword',
    'myAADE\nClient ID', 'myAADE\nAPI Key',
    'e-Banking\nUsername', 'e-Banking\nPassword',
    'Τράπεζα', 'IBAN',
    'IRIS\nΚινητό',
    'Πλάνο', 'Κατάσταση',
    'Σημειώσεις',
  ], C.gold);

  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 4, showGridLines: true }];

  const DATA_START = 5;

  for (let i = 0; i < DATA_ROWS; i++) {
    const r    = DATA_START + i;
    const cred = CREDS[i]  || null;
    const usr  = USERS[i]  || null;
    const bgA  = i % 2 === 0 ? C.ltGold : C.white;

    // A: ID
    const idCell = ws.getCell(r, 1);
    if (usr) idCell.value = usr.id;
    sc(idCell, bgA, false, 10); idCell.alignment = aln('center','middle');

    // B: Name (formula from Users)
    ws.getCell(r, 2).value = { formula: `${usrRef(r,2)}&IF(${usrRef(r,3)}<>""," "&${usrRef(r,3)},"")` };
    sc(ws.getCell(r, 2), bgA, false, 10);

    // C: AFM (formula)
    ws.getCell(r, 3).value = { formula: usrRef(r, 4) };
    sc(ws.getCell(r, 3), bgA, false, 10); ws.getCell(r, 3).alignment = aln('center','middle');

    // Password columns (will be styled red)
    const passColumns = [5, 7, 9, 11, 15];

    const fields = cred ? [
      cred.fbEmail,   cred.fbPass,     // D, E  — FishBill
      cred.emailAddr, cred.emailPass,  // F, G  — personal email
      cred.txUser,    cred.txPass,     // H, I  — Taxisnet
      cred.ggpsUser,  cred.ggpsPass,   // J, K  — GGPS
      cred.aadeClientId, cred.aadeApiKey, // L, M — myAADE
      cred.ebUser,    cred.ebPass,     // N, O  — e-banking
      cred.bank,                       // P     — bank name
      cred.iban,                       // Q     — IBAN
      cred.irisMobile,                 // R     — IRIS mobile
      null, null,                      // S, T  — plan/status (formulas)
      cred.notes,                      // U     — notes
    ] : Array(18).fill('').concat([null, null, '']);

    fields.forEach((v, fi) => {
      const col  = 4 + fi;  // starts at D (col 4)
      const cell = ws.getCell(r, col);

      // Formula cols: S=plan(19), T=status(20)
      if (col === 19) {
        cell.value = { formula: usrRef(r, 11) };  // plan
        sc(cell, bgA, true, 10, C.blue);
      } else if (col === 20) {
        cell.value = { formula: usrRef(r, 20) };  // status
        sc(cell, bgA, true, 10, C.dark);
      } else {
        if (v !== null) cell.value = v;
        const isPass = passColumns.includes(col);
        sc(cell, bgA, false, 10, isPass ? C.red : C.dark);
        if (isPass) cell.font = fnt(false, 10, C.red);
      }
      cell.border = bd();
      cell.alignment = aln('left','middle');
    });

    // Status conditional colour (col T=20)
    ws.getRow(r).height = 20;
  }

  // Conditional formatting on Status column (T)
  const eRow = DATA_START + DATA_ROWS - 1;
  ws.addConditionalFormatting({
    ref: `T${DATA_START}:T${eRow}`,
    rules: [
      { type:'containsText', operator:'containsText', text:'Ληξιπρόθεσμος', priority:1,
        style:{ fill: fl(C.ltRed), font: fnt(true, 10, C.red) } },
      { type:'containsText', operator:'containsText', text:'Ενεργός', priority:2,
        style:{ fill: fl(C.ltGreen), font: fnt(false, 10, C.green) } },
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: OSPA  (Monthly OSPA completion tracking)
// ═══════════════════════════════════════════════════════════════════════════════
function buildOSPA(wb) {
  const ws = wb.addWorksheet(SN.ospa, { tabColor: { argb: 'FF0A7E8C' } });
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 2, showGridLines: true }];

  widths([10, 26, 14, 10, ...Array(12).fill(15), 12], ws);

  mergeHeader(ws, 1, 1, 17,
    `Παρακολούθηση OSPA — ${YEAR}  |  Επιλέξτε κατάσταση από dropdown σε κάθε μήνα`,
    C.teal, C.white, 13);

  colHeaders(ws, 2, [
    'ID', 'Ονοματεπώνυμο', 'ΑΦΜ', 'OSPA\nAddon',
    ...MONTHS_EL, 'Σύνολο\nΟλοκληρωμένων',
  ], C.teal);

  const usrRef = (r, col) => `IFERROR(VLOOKUP($A${r},${USR_RANGE(SN.usr)},${col},FALSE),"")`;
  const DATA_ROWS = 200;
  const START_ROW = 3;
  const COL_JAN = 5;
  const COL_DEC = 16;
  const COL_TOT = 17;

  for (let i = 0; i < DATA_ROWS; i++) {
    const r   = START_ROW + i;
    const usr = USERS[i] || null;
    const bgA = i % 2 === 0 ? C.white : 'FFEFF9FA';

    const idCell = ws.getCell(r, 1);
    if (usr) idCell.value = usr.id;
    sc(idCell, bgA, false, 10);

    ws.getCell(r, 2).value = { formula: `${usrRef(r,2)}&IF(${usrRef(r,3)}<>""," "&${usrRef(r,3)},"")` };
    sc(ws.getCell(r, 2), bgA, false, 10);

    ws.getCell(r, 3).value = { formula: usrRef(r, 4) };
    sc(ws.getCell(r, 3), bgA, false, 10);

    ws.getCell(r, 4).value = { formula: usrRef(r, 12) };
    sc(ws.getCell(r, 4), bgA, false, 10);

    // Month cells
    for (let m = 0; m < 12; m++) {
      const col  = COL_JAN + m;
      const cell = ws.getCell(r, col);
      if (usr && usr.ospa === 'Ναι') cell.value = 'Εκκρεμεί';
      sc(cell, i % 2 === 0 ? 'FFEFFFFE' : 'FFE0F7FA', false, 10);
      cell.alignment = aln('center','middle');
    }

    // Total completed
    const totCell = ws.getCell(r, COL_TOT);
    const janL = colLetter(COL_JAN); const decL = colLetter(COL_DEC);
    totCell.value = { formula: `COUNTIF(${janL}${r}:${decL}${r},"Ολοκληρώθηκε")` };
    sc(totCell, bgA, true, 10, C.teal);
    totCell.alignment = aln('center','middle');

    ws.getRow(r).height = 20;
  }

  // Dropdown validation for month columns
  const eRow = START_ROW + DATA_ROWS - 1;
  for (let m = 0; m < 12; m++) {
    addDropDown(ws, START_ROW, eRow, COL_JAN + m, OSPA_V);
  }

  // Conditional formatting for OSPA cells
  for (let m = 0; m < 12; m++) {
    const col = colLetter(COL_JAN + m);
    ws.addConditionalFormatting({
      ref: `${col}${START_ROW}:${col}${eRow}`,
      rules: [
        { type:'containsText', operator:'containsText', text:'Ολοκληρώθηκε', priority:1,
          style:{ fill: fl(C.ltGreen), font: fnt(true, 10, C.green) } },
        { type:'containsText', operator:'containsText', text:'Εκκρεμεί', priority:2,
          style:{ fill: fl(C.ltOrange), font: fnt(false, 10, C.orange) } },
        { type:'containsText', operator:'containsText', text:'Δεν Απαιτείται', priority:3,
          style:{ fill: fl(C.ltGray), font: fnt(false, 10, C.gray) } },
      ],
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: Στατιστικά  (Automated percentages, distributions, payer ranking)
// ═══════════════════════════════════════════════════════════════════════════════
function buildStatistics(wb) {
  const ws = wb.addWorksheet(SN.stat, { tabColor: { argb: 'FF6A0DAD' } });
  ws.views = [{ showGridLines: false }];
  widths([28, 16, 12, 28, 16, 12], ws);

  mergeHeader(ws, 1, 1, 6, `Στατιστικά FishBill — ${YEAR}  |  Ενημερώνονται αυτόματα`, C.navy, C.white, 14);
  ws.getRow(2).height = 6;

  const usrT  = `'${SN.usr}'`;
  const tot   = `COUNTA(${usrT}!$A$3:$A$1002)`;
  const totAct= `COUNTIF(${usrT}!$T$3:$T$1002,"Ενεργός")`;

  // ── Section 1: User overview (left, rows 3-12)
  sectionHdr(ws, 3, 1, 3, '  ΧΡΗΣΤΕΣ — ΕΠΙΣΚΟΠΗΣΗ', C.blue);
  const overviewRows = [
    [4,  'Σύνολο Χρηστών',            `=${tot}`],
    [5,  'Ενεργοί',                    `=COUNTIF(${usrT}!$T$3:$T$1002,"Ενεργός")`],
    [6,  'Δοκιμαστικοί',               `=COUNTIF(${usrT}!$T$3:$T$1002,"Δοκιμαστικός")`],
    [7,  'Ληξιπρόθεσμοι',              `=COUNTIF(${usrT}!$T$3:$T$1002,"Ληξιπρόθεσμος")`],
    [8,  'Ανενεργοί',                  `=COUNTIF(${usrT}!$T$3:$T$1002,"Ανενεργός")`],
    [9,  'Με OSPA Addon',              `=COUNTIF(${usrT}!$L$3:$L$1002,"Ναι")`],
    [10, '% Με OSPA',                  `=IFERROR(COUNTIF(${usrT}!$L$3:$L$1002,"Ναι")/${tot},"")`],
  ];
  overviewRows.forEach(([r, label, formula]) => {
    const lc = ws.getCell(r, 1); lc.value = label; sc(lc, C.ltPurple, true, 11, C.purple); lc.alignment = aln('right','middle');
    const vc = ws.getCell(r, 2); vc.value = { formula: formula.replace('=','') };
    sc(vc, C.white, false, 11, C.dark);
    if (r === 10) vc.numFmt = '0.0%';
    vc.alignment = aln('center','middle');
    const empty = ws.getCell(r, 3); empty.fill = fl(C.ltGray);
    ws.getRow(r).height = 22;
  });

  ws.getRow(11).height = 6;

  // ── Section 2: Revenue KPIs (left, rows 12-20)
  sectionHdr(ws, 12, 1, 3, '  ΕΣΟΔΑ', C.green);
  const revenueRows = [
    [13, 'MRR — Μηνιαία Έσοδα (ενεργοί)', `=SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$Q$3:$Q$1002)`, '"€"#,##0.00'],
    [14, 'ARR — Ετήσια Έσοδα',             `=SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$Q$3:$Q$1002)*12`, '"€"#,##0.00'],
    [15, 'Σύνολο Κόστους Epsilon/μήνα',    `=SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$R$3:$R$1002)`, '"€"#,##0.00'],
    [16, 'Καθαρό Μηνιαίο Κέρδος',         `=SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$S$3:$S$1002)`, '"€"#,##0.00'],
    [17, 'Καθαρό Ετήσιο Κέρδος',          `=SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$S$3:$S$1002)*12`, '"€"#,##0.00'],
    [18, 'Μέσο Έσοδο/Ενεργό Χρήστη',     `=IFERROR(SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$Q$3:$Q$1002)/COUNTIF(${usrT}!$T$3:$T$1002,"Ενεργός"),"")`, '"€"#,##0.00'],
  ];
  revenueRows.forEach(([r, label, formula, fmt]) => {
    const lc = ws.getCell(r, 1); lc.value = label; sc(lc, C.ltGreen, true, 11, C.green); lc.alignment = aln('right','middle');
    const vc = ws.getCell(r, 2); vc.value = { formula: formula.replace('=','') };
    sc(vc, C.white, false, 11, C.dark); if (fmt) vc.numFmt = fmt;
    vc.alignment = aln('center','middle');
    ws.getCell(r, 3).fill = fl(C.ltGray);
    ws.getRow(r).height = 22;
  });

  ws.getRow(19).height = 6;

  // ── Section 3: Plan distribution (left, rows 20-27)
  sectionHdr(ws, 20, 1, 3, '  ΚΑΤΑΝΟΜΗ ΠΛΑΝΩΝ', C.blue);
  [
    [21, 'Basic',    'Basic'],
    [22, 'Standard', 'Standard'],
    [23, 'Premium',  'Premium'],
  ].forEach(([r, label, plan]) => {
    const cnt  = `COUNTIF(${usrT}!$K$3:$K$1002,"${plan}")`;
    const pct  = `IFERROR(COUNTIF(${usrT}!$K$3:$K$1002,"${plan}")/${tot},"")`;
    ws.getCell(r, 1).value = label;
    sc(ws.getCell(r, 1), C.ltBlue, true, 11, C.navy); ws.getCell(r, 1).alignment = aln('right','middle');
    ws.getCell(r, 2).value = { formula: cnt };
    sc(ws.getCell(r, 2), C.white, false, 11, C.dark); ws.getCell(r, 2).alignment = aln('center','middle');
    ws.getCell(r, 3).value = { formula: pct };
    sc(ws.getCell(r, 3), C.ltBlue, false, 11, C.dark, '0.0%'); ws.getCell(r, 3).alignment = aln('center','middle');
    ws.getRow(r).height = 22;
  });
  ws.getRow(24).height = 6;

  // ── Section 4: Reliability distribution (left, rows 25-31)
  sectionHdr(ws, 25, 1, 3, '  ΑΞΙΟΠΙΣΤΙΑ ΠΛΗΡΩΜΩΝ', C.orange);
  [
    [26, 'Άριστη', C.ltGreen],
    [27, 'Καλή',   C.ltGreen],
    [28, 'Μέτρια', C.ltOrange],
    [29, 'Κακή',   C.ltRed],
  ].forEach(([r, label, bg]) => {
    const cnt = `COUNTIF(${usrT}!$U$3:$U$1002,"${label}")`;
    const pct = `IFERROR(COUNTIF(${usrT}!$U$3:$U$1002,"${label}")/${tot},"")`;
    ws.getCell(r, 1).value = label;
    sc(ws.getCell(r, 1), bg, true, 11, C.dark); ws.getCell(r, 1).alignment = aln('right','middle');
    ws.getCell(r, 2).value = { formula: cnt };
    sc(ws.getCell(r, 2), C.white, false, 11, C.dark); ws.getCell(r, 2).alignment = aln('center','middle');
    ws.getCell(r, 3).value = { formula: pct };
    sc(ws.getCell(r, 3), bg, false, 11, C.dark, '0.0%'); ws.getCell(r, 3).alignment = aln('center','middle');
    ws.getRow(r).height = 22;
  });
  ws.getRow(30).height = 6;

  // ── Section 5: Regional distribution (right side, rows 3-20)
  sectionHdr(ws, 3, 4, 6, '  ΚΑΤΑΝΟΜΗ ΑΝΑ ΠΕΡΙΦΕΡΕΙΑ', C.purple);
  REGIONS.forEach((reg, i) => {
    const r   = 4 + i;
    const cnt = `COUNTIF(${usrT}!$H$3:$H$1002,"${reg}")`;
    const pct = `IFERROR(COUNTIF(${usrT}!$H$3:$H$1002,"${reg}")/${tot},"")`;
    const bgA = i % 2 === 0 ? C.ltPurple : C.white;
    ws.getCell(r, 4).value = reg;
    sc(ws.getCell(r, 4), bgA, false, 10, C.dark); ws.getCell(r, 4).alignment = aln('right','middle');
    ws.getCell(r, 5).value = { formula: cnt };
    sc(ws.getCell(r, 5), C.white, false, 10, C.dark); ws.getCell(r, 5).alignment = aln('center','middle');
    ws.getCell(r, 6).value = { formula: pct };
    sc(ws.getCell(r, 6), bgA, false, 10, C.dark, '0.0%'); ws.getCell(r, 6).alignment = aln('center','middle');
    if (!ws.getRow(r).height || ws.getRow(r).height < 20) ws.getRow(r).height = 20;
  });

  ws.getRow(17).height = 6;
  sectionHdr(ws, 21, 4, 6, '  TOP ΠΛΗΡΩΤΕΣ (κατά Καθαρό Έσοδο/μήνα)', C.green);
  // Top 5 earners using LARGE
  for (let k = 1; k <= 5; k++) {
    const r = 21 + k;
    ws.getCell(r, 4).value = `#${k}`;
    sc(ws.getCell(r, 4), C.ltGreen, true, 10, C.green); ws.getCell(r, 4).alignment = aln('center','middle');
    // Match name to LARGE value
    ws.getCell(r, 5).value = { formula:
      `IFERROR(INDEX(${usrT}!$B$3:$B$1002,MATCH(LARGE(${usrT}!$Q$3:$Q$1002,${k}),${usrT}!$Q$3:$Q$1002,0))&" "&INDEX(${usrT}!$C$3:$C$1002,MATCH(LARGE(${usrT}!$Q$3:$Q$1002,${k}),${usrT}!$Q$3:$Q$1002,0)),"")` };
    sc(ws.getCell(r, 5), C.ltGreen, false, 10, C.dark);
    ws.getCell(r, 6).value = { formula: `IFERROR(LARGE(${usrT}!$Q$3:$Q$1002,${k}),"")` };
    sc(ws.getCell(r, 6), C.ltGreen, true, 10, C.green, '"€"#,##0.00');
    ws.getRow(r).height = 20;
  }

  ws.getRow(28).height = 6;
  sectionHdr(ws, 29, 4, 6, '  ΧΕΙΡΟΤΕΡΟΙ ΠΛΗΡΩΤΕΣ (Κακή αξιοπιστία)', C.red);
  for (let k = 1; k <= 5; k++) {
    const r = 29 + k;
    ws.getCell(r, 4).value = `#${k}`;
    sc(ws.getCell(r, 4), C.ltRed, true, 10, C.red); ws.getCell(r, 4).alignment = aln('center','middle');
    ws.getCell(r, 5).value = { formula:
      `IFERROR(INDEX(${usrT}!$B$3:$B$1002,MATCH(SMALL(${usrT}!$Q$3:$Q$1002,${k}),${usrT}!$Q$3:$Q$1002,0))&" "&INDEX(${usrT}!$C$3:$C$1002,MATCH(SMALL(${usrT}!$Q$3:$Q$1002,${k}),${usrT}!$Q$3:$Q$1002,0)),"")` };
    sc(ws.getCell(r, 5), C.ltRed, false, 10, C.dark);
    ws.getCell(r, 6).value = { formula: `IFERROR(SMALL(${usrT}!$Q$3:$Q$1002,${k}),"")` };
    sc(ws.getCell(r, 6), C.ltRed, true, 10, C.red, '"€"#,##0.00');
    ws.getRow(r).height = 20;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: Ανάλυση Κόστους  (Epsilon vs AADE Timologio savings calculator)
// ═══════════════════════════════════════════════════════════════════════════════
function buildCostAnalysis(wb) {
  const ws = wb.addWorksheet(SN.cost, { tabColor: { argb: 'FFE8740C' } });
  ws.views = [{ showGridLines: false }];
  widths([26, 16, 16, 16, 28], ws);

  mergeHeader(ws, 1, 1, 5, 'Ανάλυση Κόστους — Epsilon Smart vs AADE Timologio', C.navy, C.white, 14);
  mergeHeader(ws, 2, 1, 5,
    'Αλλάξτε τις τιμές στο φύλλο Ρυθμίσεις (B13 & B14) — αυτός ο πίνακας ενημερώνεται αυτόματα',
    C.orange, C.white, 9);

  ws.getRow(3).height = 8;

  // ── Summary KPIs (rows 4-14)
  sectionHdr(ws, 4, 1, 5, '  ΣΥΓΚΡΙΣΗ ΣΥΣΤΗΜΑΤΩΝ — ΣΥΝΟΛΑ', C.orange);

  const usrT    = `'${SN.usr}'`;
  const actCnt  = `COUNTIF(${usrT}!$T$3:$T$1002,"Ενεργός")`;

  const kpis = [
    [5,  'Ενεργοί Χρήστες',                       `=${actCnt}`,                                                           null],
    [6,  'Κόστος Epsilon / χρήστη / μήνα',        `=${SET.epsilon}`,                                                      '"€"#,##0.00'],
    [7,  'Κόστος AADE Timologio / χρήστη / μήνα', `=${SET.aade}`,                                                         '"€"#,##0.00'],
    [8,  'Εξοικονόμηση / χρήστη / μήνα',          `=${SET.epsilon}-${SET.aade}`,                                          '"€"#,##0.00'],
    [9,  'Εξοικονόμηση / χρήστη / χρόνο',         `=(${SET.epsilon}-${SET.aade})*12`,                                     '"€"#,##0.00'],
    [10, 'ΣΥΝΟΛΙΚΗ Εξοικονόμηση / μήνα',          `=(${SET.epsilon}-${SET.aade})*${actCnt}`,                              '"€"#,##0.00'],
    [11, 'ΣΥΝΟΛΙΚΗ Εξοικονόμηση / χρόνο',         `=(${SET.epsilon}-${SET.aade})*${actCnt}*12`,                           '"€"#,##0.00'],
    [12, 'Τρέχον ετήσιο κόστος Epsilon (σύνολο)', `=${SET.epsilon}*${actCnt}*12`,                                          '"€"#,##0.00'],
    [13, 'Εναλλακτικό ετήσιο κόστος AADE',        `=${SET.aade}*${actCnt}*12`,                                            '"€"#,##0.00'],
    [14, '% Μείωση κόστους',                      `=IFERROR((${SET.epsilon}-${SET.aade})/${SET.epsilon},"")`,             '0.0%'],
  ];

  kpis.forEach(([r, label, formula, fmt]) => {
    const lc = ws.getCell(r, 1); lc.value = label; sc(lc, C.ltOrange, true, 11, C.orange); lc.alignment = aln('right','middle');
    const vc = ws.getCell(r, 2); vc.value = { formula: formula.replace(/^=/,'') };
    const isGood = [8,9,10,11,14].includes(r);
    sc(vc, isGood ? C.ltGreen : C.white, isGood, 11, isGood ? C.green : C.dark);
    if (fmt) vc.numFmt = fmt;
    vc.alignment = aln('center','middle');
    ws.mergeCells(r, 3, r, 5);
    ws.getRow(r).height = 22;
  });

  ws.getRow(15).height = 8;

  // ── Per-user breakdown table (rows 16+)
  sectionHdr(ws, 16, 1, 5, '  ΑΝΑΛΥΣΗ ΑΝΑ ΧΡΗΣΤΗ', C.navy);
  colHeaders(ws, 17, ['ID', 'Χρήστης', 'Κόστος\nEpsilon/μήνα', 'Κόστος\nAADE/μήνα', 'Εξοικονόμηση\n/μήνα'], C.navy);

  const usrRef = (r, col) => `IFERROR(VLOOKUP($A${r},${USR_RANGE(SN.usr)},${col},FALSE),"")`;
  const DATA_ROWS = 200;
  const START_ROW = 18;

  for (let i = 0; i < DATA_ROWS; i++) {
    const r   = START_ROW + i;
    const usr = USERS[i] || null;
    const bgA = i % 2 === 0 ? C.white : C.altRow;

    const idCell = ws.getCell(r, 1); if (usr) idCell.value = usr.id; sc(idCell, bgA, false, 10);
    ws.getCell(r, 2).value = { formula: `${usrRef(r,2)}&IF(${usrRef(r,3)}<>""," "&${usrRef(r,3)},"")` };
    sc(ws.getCell(r, 2), bgA, false, 10);

    // Epsilon cost: same formula as Users sheet
    const epCell = ws.getCell(r, 3);
    epCell.value = { formula: `IF(${usrRef(r,20)}="Ενεργός",${SET.epsilon},0)` };
    sc(epCell, bgA, false, 10); epCell.numFmt = '"€"#,##0.00'; epCell.alignment = aln('center','middle');

    // AADE cost
    const aaCell = ws.getCell(r, 4);
    aaCell.value = { formula: `IF(${usrRef(r,20)}="Ενεργός",${SET.aade},0)` };
    sc(aaCell, bgA, false, 10); aaCell.numFmt = '"€"#,##0.00'; aaCell.alignment = aln('center','middle');

    // Savings
    const svCell = ws.getCell(r, 5);
    svCell.value = { formula: `C${r}-D${r}` };
    sc(svCell, bgA, true, 10, C.green); svCell.numFmt = '"€"#,##0.00'; svCell.alignment = aln('center','middle');

    ws.getRow(r).height = 20;
  }

  // Totals
  const eRow   = START_ROW + DATA_ROWS - 1;
  const totRow = START_ROW + DATA_ROWS;
  ws.mergeCells(totRow, 1, totRow, 2);
  const ttl = ws.getCell(totRow, 1); ttl.value = 'ΣΥΝΟΛΑ';
  sc(ttl, C.navy, true, 11, C.white); ttl.alignment = aln('center','middle');
  [3,4,5].forEach(col => {
    const cell = ws.getCell(totRow, col);
    cell.value = { formula: `SUM(${colLetter(col)}${START_ROW}:${colLetter(col)}${eRow})` };
    sc(cell, C.navy, true, 11, C.white); cell.numFmt = '"€"#,##0.00'; cell.alignment = aln('center','middle');
  });
  ws.getRow(totRow).height = 24;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHEET: Dashboard  (Executive overview — all formulas from other sheets)
// ═══════════════════════════════════════════════════════════════════════════════
function buildDashboard(wb) {
  const ws = wb.addWorksheet(SN.dash, { tabColor: { argb: 'FF0D3B66' } });
  ws.views = [{ showGridLines: false }];
  widths([24, 18, 8, 24, 18, 8, 24, 18], ws);

  mergeHeader(ws, 1, 1, 8, 'FishBill — Dashboard Διαχείρισης Αλιέων', C.navy, C.white, 18);
  mergeHeader(ws, 2, 1, 8, `Ετήσια Εποπτεία ${YEAR}  |  Ανανεώθηκε: ${new Date().toLocaleDateString('el-GR')}`, C.blue, C.white, 11);
  ws.getRow(3).height = 10;

  // Helper: KPI card (2-col: label | value)
  function kpiCard(row, col, label, formula, numFmt=null, bgA=C.ltBlue, fgA=C.navy) {
    ws.mergeCells(row, col, row, col);
    const lc = ws.getCell(row, col);
    lc.value = label; sc(lc, bgA, true, 11, fgA); lc.alignment = aln('right','middle');
    const vc = ws.getCell(row, col+1);
    vc.value = { formula }; sc(vc, C.white, true, 13, C.navy);
    vc.alignment = aln('center','middle');
    if (numFmt) vc.numFmt = numFmt;
    ws.getRow(row).height = 26;
  }

  const S  = `'${SN.stat}'`;
  const ST = `'${SN.set}'`;
  const usrT = `'${SN.usr}'`;

  // ── KPI block A (rows 4-13, cols 1-2)
  sectionHdr(ws, 4, 1, 2, '  ΧΡΗΣΤΕΣ', C.blue);
  kpiCard( 5, 1, 'Σύνολο Χρηστών',    `COUNTA(${usrT}!$A$3:$A$1002)`);
  kpiCard( 6, 1, 'Ενεργοί',           `COUNTIF(${usrT}!$T$3:$T$1002,"Ενεργός")`, null, C.ltGreen, C.green);
  kpiCard( 7, 1, 'Δοκιμαστικοί',      `COUNTIF(${usrT}!$T$3:$T$1002,"Δοκιμαστικός")`, null, C.ltOrange, C.orange);
  kpiCard( 8, 1, 'Ληξιπρόθεσμοι',     `COUNTIF(${usrT}!$T$3:$T$1002,"Ληξιπρόθεσμος")`, null, C.ltRed, C.red);
  kpiCard( 9, 1, 'Με OSPA',           `COUNTIF(${usrT}!$L$3:$L$1002,"Ναι")`);
  kpiCard(10, 1, '% OSPA Χρηστών',    `IFERROR(COUNTIF(${usrT}!$L$3:$L$1002,"Ναι")/COUNTA(${usrT}!$A$3:$A$1002),"")`, '0.0%');

  ws.getRow(11).height = 6;

  // ── KPI block B (rows 4-13, cols 4-5)
  sectionHdr(ws, 4, 4, 5, '  ΕΣΟΔΑ', C.green);
  kpiCard( 5, 4, 'MRR (Μηνιαία Έσοδα)',   `SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$Q$3:$Q$1002)`, '"€"#,##0.00', C.ltGreen, C.green);
  kpiCard( 6, 4, 'ARR (Ετήσια Έσοδα)',    `SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$Q$3:$Q$1002)*12`, '"€"#,##0.00', C.ltGreen, C.green);
  kpiCard( 7, 4, 'Κόστος Epsilon/μήνα',   `SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$R$3:$R$1002)`, '"€"#,##0.00', C.ltOrange, C.orange);
  kpiCard( 8, 4, 'Καθαρό Κέρδος/μήνα',   `SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$S$3:$S$1002)`, '"€"#,##0.00', C.ltGreen, C.green);
  kpiCard( 9, 4, 'Καθαρό Κέρδος/χρόνο',  `SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$S$3:$S$1002)*12`, '"€"#,##0.00', C.ltGreen, C.green);
  kpiCard(10, 4, 'Μέσο Έσοδο/Χρήστη',   `IFERROR(SUMIF(${usrT}!$T$3:$T$1002,"Ενεργός",${usrT}!$Q$3:$Q$1002)/COUNTIF(${usrT}!$T$3:$T$1002,"Ενεργός"),"")`, '"€"#,##0.00');

  ws.getRow(11).height = 6;

  // ── KPI block C (rows 4-10, cols 7-8)
  sectionHdr(ws, 4, 7, 8, '  ΠΛΑΝΑ & ΤΙΜΕΣ', C.purple);
  kpiCard( 5, 7, 'Basic Plan',    `${ST}!$B$4`, '"€"#,##0.00', C.ltPurple, C.purple);
  kpiCard( 6, 7, 'Standard Plan', `${ST}!$B$5`, '"€"#,##0.00', C.ltPurple, C.purple);
  kpiCard( 7, 7, 'Premium Plan',  `${ST}!$B$6`, '"€"#,##0.00', C.ltPurple, C.purple);
  kpiCard( 8, 7, 'OSPA Addon',    `${ST}!$B$9`, '"€"#,##0.00');
  kpiCard( 9, 7, 'Epsilon/χρήστη',`${ST}!$B$13`, '"€"#,##0.00', C.ltOrange, C.orange);
  kpiCard(10, 7, 'Εξοικονόμηση → AADE', `(${ST}!$B$13-${ST}!$B$14)*COUNTIF(${usrT}!$T$3:$T$1002,"Ενεργός")*12`, '"€"#,##0.00', C.ltGreen, C.green);

  ws.getRow(11).height = 8;

  // ── Plan distribution mini-table (rows 12-17)
  sectionHdr(ws, 12, 1, 8, '  ΚΑΤΑΝΟΜΗ ΠΛΑΝΩΝ & ΑΞΙΟΠΙΣΤΙΑΣ', C.navy);
  colHeaders(ws, 13, ['Πλάνο', 'Χρήστες', '%', '', 'Αξιοπιστία', 'Χρήστες', '%', ''], C.blue);

  const totAll = `COUNTA(${usrT}!$A$3:$A$1002)`;
  [['Basic','Basic'], ['Standard','Standard'], ['Premium','Premium']].forEach(([label, plan], i) => {
    const r = 14 + i;
    ws.getCell(r, 1).value = label; sc(ws.getCell(r, 1), C.ltBlue, true, 11, C.navy); ws.getCell(r, 1).alignment = aln('center','middle');
    ws.getCell(r, 2).value = { formula: `COUNTIF(${usrT}!$K$3:$K$1002,"${plan}")` };
    sc(ws.getCell(r, 2), C.white, false, 11, C.dark); ws.getCell(r, 2).alignment = aln('center','middle');
    ws.getCell(r, 3).value = { formula: `IFERROR(COUNTIF(${usrT}!$K$3:$K$1002,"${plan}")/${totAll},"")` };
    sc(ws.getCell(r, 3), C.ltBlue, false, 11, C.dark, '0.0%'); ws.getCell(r, 3).alignment = aln('center','middle');
    ws.getRow(r).height = 22;
  });

  const relLabels = [['Άριστη', C.ltGreen, C.green],['Καλή', C.ltGreen, C.green],['Μέτρια', C.ltOrange, C.orange],['Κακή', C.ltRed, C.red]];
  relLabels.forEach(([label, bg, fg], i) => {
    if (i >= 3) return;
    const r = 14 + i;
    ws.getCell(r, 5).value = label; sc(ws.getCell(r, 5), bg, true, 11, fg); ws.getCell(r, 5).alignment = aln('center','middle');
    ws.getCell(r, 6).value = { formula: `COUNTIF(${usrT}!$U$3:$U$1002,"${label}")` };
    sc(ws.getCell(r, 6), C.white, false, 11, C.dark); ws.getCell(r, 6).alignment = aln('center','middle');
    ws.getCell(r, 7).value = { formula: `IFERROR(COUNTIF(${usrT}!$U$3:$U$1002,"${label}")/${totAll},"")` };
    sc(ws.getCell(r, 7), bg, false, 11, C.dark, '0.0%'); ws.getCell(r, 7).alignment = aln('center','middle');
  });

  ws.getRow(18).height = 8;

  // ── Notes / Instructions
  sectionHdr(ws, 19, 1, 8, '  ΟΔΗΓΙΕΣ ΧΡΗΣΗΣ', C.teal);
  const notes = [
    '1.  Καρτέλα "Ρυθμίσεις": αλλάξτε τιμές πλάνων, addon, Epsilon — όλα ενημερώνονται αυτόματα.',
    '2.  Καρτέλα "Χρήστες": προσθέστε/επεξεργαστείτε χρήστες. Γεμίστε μόνο τα λευκά κελιά — τα κίτρινα υπολογίζονται.',
    '3.  Καρτέλα "Συνδρομές": εισάγετε ποσό/μήνα ανά χρήστη (κίτρινα κελιά). Τα άλλα υπολογίζονται.',
    '4.  Καρτέλα "OSPA": επιλέξτε κατάσταση (dropdown) για κάθε μήνα ανά αλιέα.',
    '5.  Καρτέλα "Credentials": FishBill login, email, Taxisnet, GGPS, myAADE, e-Banking, IBAN, IRIS — ΕΥΑΙΣΘΗΤΑ ΔΕΔΟΜΕΝΑ. Review → Protect Sheet + κωδικός.',
    '6.  Καρτέλα "Ανάλυση Κόστους": αλλάξτε B14 στο φύλλο Ρυθμίσεις για εναλλακτικό κόστος AADE.',
    '7.  Για νέους χρήστες στις Συνδρομές/OSPA/Credentials: εισάγετε το ID τους (στήλη Α) — τα υπόλοιπα συμπληρώνονται αυτόματα.',
  ];
  notes.forEach((note, i) => {
    const r = 20 + i;
    ws.mergeCells(r, 1, r, 8);
    const cell = ws.getCell(r, 1);
    cell.value = note;
    sc(cell, i % 2 === 0 ? 'FFF0FFFD' : C.white, false, 10, C.dark);
    cell.alignment = aln('left','middle');
    ws.getRow(r).height = 20;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'FishBill System';
  wb.created  = new Date();
  wb.modified = new Date();

  console.log('Δημιουργία φύλλων...');
  buildDashboard(wb);
  buildSettings(wb);
  buildUsers(wb);
  buildSubscriptions(wb);
  buildCredentials(wb);
  buildOSPA(wb);
  buildStatistics(wb);
  buildCostAnalysis(wb);

  const outPath = path.resolve(__dirname, 'FishBill_Management.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`\n✅  Έτοιμο: ${outPath}`);
  console.log('   Ανοίξτε με Excel και ενεργοποιήστε τους τύπους αν σας ζητηθεί.\n');
  console.log('   ΕΠΟΜΕΝΑ ΒΗΜΑΤΑ:');
  console.log('   • Προσθέστε τους πραγματικούς χρήστες στο φύλλο "Χρήστες"');
  console.log('   • Συμπληρώστε τα credentials στο φύλλο "Credentials" και προστατεύστε το');
  console.log('   • Ενημερώστε τις τιμές στο "Ρυθμίσεις" ώστε να ταιριάζουν με τις τρέχουσες τιμές σας');
}

main().catch(err => { console.error('Σφάλμα:', err.message); process.exit(1); });
