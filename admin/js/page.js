/**
 * FishBill – Shared Page Utilities
 * Provides consistent pagination, confirm dialogs, modal helpers and loading states.
 */

// ─── Spinner / Loading ───────────────────────────────────────────────────────

function showSpinner(containerId) {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return;
  el.innerHTML = `
    <div class="flex items-center justify-center py-16">
      <div class="flex flex-col items-center gap-3">
        <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
        <p class="text-sm text-gray-400">Φόρτωση...</p>
      </div>
    </div>`;
}

function showError(containerId, message) {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return;
  el.innerHTML = `
    <div class="flex items-center justify-center py-12">
      <div class="text-center">
        <div class="text-4xl mb-3">⚠️</div>
        <p class="text-sm font-medium text-red-600">${message}</p>
      </div>
    </div>`;
}

function showEmpty(containerId, message = 'Δεν βρέθηκαν αποτελέσματα', icon = '📭') {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return;
  el.innerHTML = `
    <div class="flex items-center justify-center py-16">
      <div class="text-center">
        <div class="text-5xl mb-3 opacity-40">${icon}</div>
        <p class="text-sm text-gray-500">${message}</p>
      </div>
    </div>`;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

// Global registry so onclick strings can reference named handlers, not function bodies
window._pgReg = window._pgReg || {};
window._pgGo  = function(key, p) {
  const cb = window._pgReg[key]?.onPage;
  if (typeof cb === 'function') cb(p);
  else if (typeof cb === 'string' && typeof window[cb] === 'function') window[cb](p);
};
window._pgLim = function(key, l) {
  const cb = window._pgReg[key]?.onLimit;
  if (typeof cb === 'function') cb(l);
  else if (typeof cb === 'string' && typeof window[cb] === 'function') window[cb](l);
};

/**
 * Render pagination controls.
 * @param {string|Element} containerId
 * @param {number}  total         - total number of records
 * @param {number}  page          - current page (1-based)
 * @param {number}  limit         - records per page
 * @param {Function} onPage       - called with new page number
 * @param {Function} [onLimit]    - optional; called with new limit when page-size changes
 */
function renderPagination(containerId, total, page, limit, onPage, onLimit) {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return;

  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1 && !onLimit) { el.innerHTML = ''; return; }

  const from = Math.min((page - 1) * limit + 1, total || 1);
  const to   = Math.min(page * limit, total);

  // Register callbacks under a stable key so onclick attributes stay tiny
  const key = 'pg_' + (typeof containerId === 'string' ? containerId : containerId.id || 'el') + '_' + Date.now();
  window._pgReg[key] = { onPage, onLimit };

  // Build page numbers
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  const btn = (label, p, active = false, disabled = false) => {
    if (p === '…') return `<span class="px-2 text-gray-400 text-sm">…</span>`;
    const base = 'inline-flex items-center justify-center min-w-[36px] h-9 px-2 rounded-lg text-sm font-medium transition-colors';
    const cls  = active
      ? `${base} bg-blue-600 text-white`
      : disabled
        ? `${base} text-gray-300 cursor-not-allowed`
        : `${base} text-gray-600 hover:bg-gray-100`;
    const attr = disabled ? 'disabled' : `onclick="_pgGo('${key}',${p})"`;
    return `<button ${attr} class="${cls}">${label}</button>`;
  };

  const sizeSelector = onLimit ? `
    <div class="flex items-center gap-1.5 ml-4">
      <span class="text-xs text-gray-400">Ανά σελ.:</span>
      <select onchange="_pgLim('${key}',parseInt(this.value))"
        class="border border-gray-200 rounded-lg text-xs text-gray-700 py-1 px-2 bg-white focus:ring-2 focus:ring-blue-400 focus:border-transparent cursor-pointer">
        ${[10, 25, 50, 100].map(n => `<option value="${n}"${n === limit ? ' selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>` : '';

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
      <div class="flex items-center flex-wrap gap-1">
        <p class="text-xs text-gray-500">Εμφάνιση <span class="font-semibold text-gray-700">${total > 0 ? from : 0}–${to}</span> από <span class="font-semibold text-gray-700">${total}</span></p>
        ${sizeSelector}
      </div>
      <div class="flex items-center gap-1">
        ${totalPages > 1 ? btn('‹', page - 1, false, page <= 1) : ''}
        ${totalPages > 1 ? pages.map(p => btn(p, p, p === page)).join('') : ''}
        ${totalPages > 1 ? btn('›', page + 1, false, page >= totalPages) : ''}
      </div>
    </div>`;
}

// ─── Confirm Dialog ──────────────────────────────────────────────────────────

function confirmDialog(title, message, danger = false) {
  return new Promise(resolve => {
    // Remove any existing confirm dialog
    const existing = document.getElementById('_confirm_dialog');
    if (existing) existing.remove();

    const btnCls = danger
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-blue-600 hover:bg-blue-700 text-white';

    const overlay = document.createElement('div');
    overlay.id = '_confirm_dialog';
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-[fadeUp_.2s_ease-out]">
        <div class="flex items-start gap-4 mb-4">
          <div class="w-10 h-10 rounded-xl ${danger ? 'bg-red-100' : 'bg-blue-100'} flex items-center justify-center flex-shrink-0">
            <span class="text-xl">${danger ? '🗑️' : '❓'}</span>
          </div>
          <div>
            <h3 class="text-base font-bold text-gray-900">${title}</h3>
            <p class="text-sm text-gray-500 mt-1">${message}</p>
          </div>
        </div>
        <div class="flex gap-3 justify-end">
          <button id="_confirm_no"
            class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
            Άκυρο
          </button>
          <button id="_confirm_yes"
            class="px-4 py-2 text-sm font-semibold ${btnCls} rounded-xl transition-colors">
            ${danger ? 'Διαγραφή' : 'Επιβεβαίωση'}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    function cleanup(val) {
      overlay.remove();
      resolve(val);
    }

    document.getElementById('_confirm_yes').onclick = () => cleanup(true);
    document.getElementById('_confirm_no').onclick  = () => cleanup(false);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });

    // Keyboard support
    function keyHandler(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', keyHandler); cleanup(false); }
      if (e.key === 'Enter')  { document.removeEventListener('keydown', keyHandler); cleanup(true); }
    }
    document.addEventListener('keydown', keyHandler);
  });
}

// ─── Modal helpers ───────────────────────────────────────────────────────────

function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('hidden');
  m.classList.add('flex');
  document.body.classList.add('overflow-hidden');
  setTimeout(() => m.querySelector('[data-autofocus]')?.focus(), 50);
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('hidden');
  m.classList.remove('flex');
  if (!document.querySelector('.modal-open:not(.hidden)')) {
    document.body.classList.remove('overflow-hidden');
  }
}

function closeAllModals() {
  document.querySelectorAll('[id^="modal-"]').forEach(m => {
    m.classList.add('hidden');
    m.classList.remove('flex');
  });
  document.body.classList.remove('overflow-hidden');
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) {
    closeAllModals();
  }
});

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllModals();
});

// ─── Input helpers ───────────────────────────────────────────────────────────

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function setChecked(id, bool) {
  const el = document.getElementById(id);
  if (el) el.checked = !!bool;
}

// ─── Page initialization ─────────────────────────────────────────────────────

function initPage(options = {}) {
  if (typeof requireAuth === 'function') requireAuth();
  if (typeof buildSidebar === 'function') buildSidebar();
  if (options.requireRole && typeof requireRole === 'function') {
    requireRole(...(Array.isArray(options.requireRole) ? options.requireRole : [options.requireRole]));
  }
}

// ─── Search debounce ─────────────────────────────────────────────────────────

function debounce(fn, ms = 350) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ─── Number formatting ───────────────────────────────────────────────────────

function fmtMoney(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '€0,00';
  return '€' + num.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}

// ─── Badge helpers ───────────────────────────────────────────────────────────

function statusBadge(status) {
  const map = {
    draft:         { label: 'Πρόχειρο',    cls: 'bg-gray-100 text-gray-600' },
    issued:        { label: 'Εκδόθηκε',    cls: 'bg-blue-100 text-blue-700' },
    transmitted:   { label: 'Μεταδόθηκε',  cls: 'bg-emerald-100 text-emerald-700' },
    failed:        { label: 'Αποτυχία',    cls: 'bg-red-100 text-red-700' },
    pending_retry: { label: 'Εκ νέου',     cls: 'bg-amber-100 text-amber-700' },
    cancelled:     { label: 'Ακυρώθηκε',  cls: 'bg-gray-100 text-gray-400 line-through' },
    active:        { label: 'Ενεργό',      cls: 'bg-emerald-100 text-emerald-700' },
    inactive:      { label: 'Ανενεργό',   cls: 'bg-gray-100 text-gray-500' },
    suspended:     { label: 'Ανεσταλμένο', cls: 'bg-red-100 text-red-700' },
    success:       { label: 'Επιτυχία',    cls: 'bg-emerald-100 text-emerald-700' },
    error:         { label: 'Σφάλμα',      cls: 'bg-red-100 text-red-700' },
    running:       { label: 'Εκτελείται',  cls: 'bg-blue-100 text-blue-700' },
    completed:     { label: 'Ολοκληρώθηκε', cls: 'bg-emerald-100 text-emerald-700' },
    pending:       { label: 'Εκκρεμεί',   cls: 'bg-amber-100 text-amber-700' },
  };
  const s = (status || '').toLowerCase();
  const info = map[s] || { label: status || '—', cls: 'bg-gray-100 text-gray-600' };
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${info.cls}">${info.label}</span>`;
}

function planBadge(plan) {
  const map = {
    trial:      { label: 'Trial',      cls: 'bg-gray-100 text-gray-600' },
    basic:      { label: 'Basic',      cls: 'bg-blue-100 text-blue-700' },
    pro:        { label: 'Pro',        cls: 'bg-purple-100 text-purple-700' },
    enterprise: { label: 'Enterprise', cls: 'bg-amber-100 text-amber-700' },
  };
  const info = map[plan] || { label: plan || '—', cls: 'bg-gray-100 text-gray-600' };
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${info.cls}">${info.label}</span>`;
}

function activeBadge(is_active) {
  return is_active
    ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Ενεργός</span>`
    : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500"><span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>Ανενεργός</span>`;
}

// ─── Action button builder ───────────────────────────────────────────────────

function actionBtn(icon, label, onclick, danger = false) {
  const cls = danger
    ? 'text-red-600 hover:bg-red-50'
    : 'text-gray-600 hover:bg-gray-100';
  return `<button onclick="${onclick}"
    class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${cls}"
    title="${label}">
    ${icon} <span class="hidden sm:inline">${label}</span>
  </button>`;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

window.showSpinner = showSpinner;
window.showError   = showError;
window.showEmpty   = showEmpty;
window.renderPagination = renderPagination;
window.confirmDialog    = confirmDialog;
window.openModal   = openModal;
window.closeModal  = closeModal;
window.closeAllModals = closeAllModals;
window.val     = val;
window.setVal  = setVal;
window.getChecked = getChecked;
window.setChecked = setChecked;
window.initPage = initPage;
window.debounce = debounce;
window.fmtMoney    = fmtMoney;
window.fmtDate     = fmtDate;
window.fmtDateTime = fmtDateTime;
window.statusBadge = statusBadge;
window.planBadge   = planBadge;
window.activeBadge = activeBadge;
window.actionBtn   = actionBtn;
