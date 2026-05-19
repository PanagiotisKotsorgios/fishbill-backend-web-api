// ─── Toast notifications ──────────────────────────────────────────────────────
function toast(message, type = 'success') {
  const colors = {
    success: '#065F46',
    error:   '#7F1D1D',
    warning: '#78350F',
    info:    '#1E3A5F',
  };
  const icons = { success: '✔', error: '✖', warning: '⚠', info: 'ℹ' };
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    z-index:9999; display:flex; align-items:center; gap:10px;
    padding:12px 22px; border-radius:12px; color:#fff; font-size:14px;
    font-weight:600; font-family:inherit; box-shadow:0 8px 24px rgba(0,0,0,.25);
    background:${colors[type] || colors.info}; opacity:0;
    transition:opacity .25s ease; max-width:420px; white-space:pre-wrap;
  `;
  t.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ─── Loading states ───────────────────────────────────────────────────────────
function showSpinner(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:48px 16px">
    <div style="width:32px;height:32px;border:3px solid #E5E7EB;border-top-color:#1E3A5F;border-radius:50%;animation:spin .65s linear infinite"></div>
  </div>`;
}

function showEmpty(el, msg = 'Δεν βρέθηκαν αποτελέσματα') {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:48px 16px;color:#9CA3AF;font-size:14px">${msg}</div>`;
}

function showError(el, msg) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:32px 16px;color:#B91C1C;font-size:14px">⚠ ${msg}</div>`;
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────
function confirmDialog(title, message, danger = false) {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px`;
    const accentColor = danger ? '#DC2626' : '#1E3A5F';
    const accentBg    = danger ? '#FEF2F2' : '#EFF6FF';
    d.innerHTML = `
      <div style="background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.2);max-width:400px;width:100%;padding:28px">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px">
          <div style="width:42px;height:42px;border-radius:10px;background:${accentBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">
            ${danger ? '🗑' : '❓'}
          </div>
          <div>
            <div style="font-size:16px;font-weight:700;color:#111827">${title}</div>
            <div style="font-size:13px;color:#6B7280;margin-top:5px;line-height:1.55">${message}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="_no" style="padding:9px 20px;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:8px;font-size:14px;font-weight:600;color:#374151;cursor:pointer;font-family:inherit">Άκυρο</button>
          <button id="_yes" style="padding:9px 20px;background:${accentColor};border:none;border-radius:8px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">${danger ? 'Διαγραφή' : 'OK'}</button>
        </div>
      </div>`;
    document.body.appendChild(d);
    const cleanup = v => { d.remove(); resolve(v); };
    d.querySelector('#_yes').onclick = () => cleanup(true);
    d.querySelector('#_no').onclick  = () => cleanup(false);
    d.addEventListener('click', e => { if (e.target === d) cleanup(false); });
    const k = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', k); cleanup(false); } };
    document.addEventListener('keydown', k);
  });
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmtMoney(n) {
  const v = parseFloat(n);
  return isNaN(v) ? '€0,00' : '€' + v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}
function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }
function setVal(id, v) { const e = document.getElementById(id); if (e) e.value = (v ?? ''); }
function setChecked(id, b) { const e = document.getElementById(id); if (e) e.checked = !!b; }

function statusBadge(s) {
  const map = {
    transmitted:   ['#F0FDF4','#15803D','Μεταδόθηκε'],
    issued:        ['#EFF6FF','#1D4ED8','Εκδόθηκε'],
    failed:        ['#FEF2F2','#B91C1C','Αποτυχία'],
    draft:         ['#F3F4F6','#6B7280','Πρόχειρο'],
    pending_retry: ['#FFFBEB','#92400E','Εκ νέου'],
    cancelled:     ['#F3F4F6','#9CA3AF','Ακυρώθηκε'],
  };
  const [bg, color, label] = map[s] || ['#F3F4F6','#6B7280', s || '—'];
  return `<span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;background:${bg};color:${color}">${label}</span>`;
}

window.toast          = toast;
window.showSpinner    = showSpinner;
window.showEmpty      = showEmpty;
window.showError      = showError;
window.confirmDialog  = confirmDialog;
window.fmtMoney       = fmtMoney;
window.fmtDate        = fmtDate;
window.val            = val;
window.setVal         = setVal;
window.setChecked     = setChecked;
window.statusBadge    = statusBadge;
