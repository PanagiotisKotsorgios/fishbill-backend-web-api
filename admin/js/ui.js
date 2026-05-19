/**
 * FishBill UI Helpers
 */

// Toast notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container') || createToastContainer();

  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500',
  };

  const icons = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>',
    error: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>',
    info: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 ${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow-lg mb-2 transform transition-all duration-300 translate-x-full max-w-sm`;
  toast.innerHTML = `
    <span class="flex-shrink-0">${icons[type] || icons.info}</span>
    <span class="flex-1 text-sm font-medium">${message}</span>
    <button onclick="this.parentElement.remove()" class="flex-shrink-0 ml-2 opacity-75 hover:opacity-100">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
    </button>
  `;

  container.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.remove('translate-x-full'), 50);

  // Auto remove
  setTimeout(() => {
    toast.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'fixed top-4 right-4 z-50 flex flex-col items-end';
  document.body.appendChild(container);
  return container;
}

// Loading spinner
function showLoading(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.innerHTML = `
    <div class="flex items-center justify-center py-12">
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
    </div>
  `;
}

// Date formatter
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Date + time formatter
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// Money formatter
function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '-';
  const num = parseFloat(amount);
  if (isNaN(num)) return '-';
  return `€${num.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Status badge
function statusBadge(status) {
  const map = {
    draft: { label: 'Πρόχειρο', cls: 'bg-gray-100 text-gray-700' },
    issued: { label: 'Εκδόθηκε', cls: 'bg-blue-100 text-blue-700' },
    transmitted: { label: 'Μεταδόθηκε', cls: 'bg-green-100 text-green-700' },
    failed: { label: 'Αποτυχία', cls: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Ακυρώθηκε', cls: 'bg-gray-100 text-gray-500 line-through' },
    active: { label: 'Ενεργό', cls: 'bg-green-100 text-green-700' },
    inactive: { label: 'Ανενεργό', cls: 'bg-gray-100 text-gray-500' },
    suspended: { label: 'Ανεσταλμένο', cls: 'bg-red-100 text-red-700' },
    pending: { label: 'Εκκρεμεί', cls: 'bg-yellow-100 text-yellow-700' },
    success: { label: 'Επιτυχία', cls: 'bg-green-100 text-green-700' },
    completed: { label: 'Ολοκληρώθηκε', cls: 'bg-green-100 text-green-700' },
    running: { label: 'Σε εξέλιξη', cls: 'bg-blue-100 text-blue-700' },
    error: { label: 'Σφάλμα', cls: 'bg-red-100 text-red-700' },
  };
  const s = (status || '').toLowerCase();
  const info = map[s] || { label: status || '-', cls: 'bg-gray-100 text-gray-600' };
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${info.cls}">${info.label}</span>`;
}

// Confirm dialog
function uiConfirm(message) {
  return Promise.resolve(window.confirm(message));
}

// Build HTML table
function buildTable(headers, rows, emptyMessage = 'Δεν βρέθηκαν δεδομένα') {
  if (!rows || rows.length === 0) {
    return `<div class="text-center py-12 text-gray-500">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <p class="text-sm">${emptyMessage}</p>
    </div>`;
  }

  const thead = `<thead class="bg-gray-50"><tr>${headers.map(h =>
    `<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">${h}</th>`
  ).join('')}</tr></thead>`;

  const tbody = `<tbody class="bg-white divide-y divide-gray-200">${rows.map(row =>
    `<tr class="hover:bg-gray-50 transition-colors">${row.map(cell =>
      `<td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${cell !== null && cell !== undefined ? cell : '-'}</td>`
    ).join('')}</tr>`
  ).join('')}</tbody>`;

  return `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">${thead}${tbody}</table></div>`;
}

// Build pagination
function buildPagination(total, page, limit, onPageChange) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return '';

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  let pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  const pageButtons = pages.map(p => {
    if (p === '...') return `<span class="px-3 py-2 text-gray-400">...</span>`;
    const active = p === page;
    return `<button onclick="(${onPageChange})(${p})"
      class="px-3 py-2 text-sm rounded-md ${active ? 'bg-blue-600 text-white font-medium' : 'text-gray-600 hover:bg-gray-100'} transition-colors">
      ${p}
    </button>`;
  }).join('');

  return `
    <div class="flex items-center justify-between px-4 py-3 border-t border-gray-200">
      <p class="text-sm text-gray-600">Εμφάνιση <span class="font-medium">${from}-${to}</span> από <span class="font-medium">${total}</span></p>
      <div class="flex items-center gap-1">
        <button onclick="(${onPageChange})(${page - 1})" ${page <= 1 ? 'disabled' : ''}
          class="px-3 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          &laquo;
        </button>
        ${pageButtons}
        <button onclick="(${onPageChange})(${page + 1})" ${page >= totalPages ? 'disabled' : ''}
          class="px-3 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          &raquo;
        </button>
      </div>
    </div>
  `;
}

// Modal helpers
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
  }
}

// Role label
function roleLabel(role) {
  const map = {
    super_admin: 'Super Admin',
    owner: 'Ιδιοκτήτης',
    accountant: 'Λογιστής',
    captain: 'Καπετάνιος',
    employee: 'Υπάλληλος',
  };
  return map[role] || role;
}

// Role badge
function roleBadge(role) {
  const map = {
    super_admin: 'bg-purple-100 text-purple-700',
    owner: 'bg-blue-100 text-blue-700',
    accountant: 'bg-green-100 text-green-700',
    captain: 'bg-orange-100 text-orange-700',
    employee: 'bg-gray-100 text-gray-600',
  };
  const cls = map[role] || 'bg-gray-100 text-gray-600';
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}">${roleLabel(role)}</span>`;
}

// XSS escape helper — wraps user-provided strings before inserting into innerHTML
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

window.ui = {
  showToast,
  showLoading,
  formatDate,
  formatDateTime,
  formatMoney,
  statusBadge,
  confirm: uiConfirm,
  buildTable,
  buildPagination,
  openModal,
  closeModal,
  roleLabel,
  roleBadge,
  esc,
};

// Also expose directly
window.showToast = showToast;
window.openModal = openModal;
window.closeModal = closeModal;
