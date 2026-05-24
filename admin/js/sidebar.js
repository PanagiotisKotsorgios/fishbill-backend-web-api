/**
 * FishBill Sidebar — Font Awesome 6 Edition
 * Injects Font Awesome, renders sidebar, mobile header, global search.
 */

// ── Inject Font Awesome once ─────────────────────────────────────────────────
(function injectFA() {
  if (document.getElementById('fa-link')) return;
  const link = document.createElement('link');
  link.id = 'fa-link';
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
  link.media = 'print';
  link.onload = function() { this.media = 'all'; };
  document.head.appendChild(link);
})();

// ── Nav definition ────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: 'dashboard.html',   icon: 'fa-gauge-high',        label: 'Dashboard',           roles: ['super_admin','owner','accountant','captain','employee'] },
    ],
  },
  {
    label: 'Λειτουργίες',
    items: [
      { href: 'invoices.html',       icon: 'fa-file-invoice',       label: 'Παραστατικά',         roles: ['super_admin','owner','accountant','captain','employee'] },
    ],
  },
  {
    label: 'Δελτία Ζύγισης',
    items: [
      { href: 'weighing-slips.html', icon: 'fa-scale-balanced',     label: 'Δελτία Ζύγισης',     roles: ['super_admin','owner','accountant','captain'] },
      { href: 'ospa.html',           icon: 'fa-file-circle-check',  label: 'Υποβολές ΟΣΠΑ',      roles: ['super_admin','owner','accountant'] },
    ],
  },
  {
    label: 'Λογιστής',
    items: [
      { href: 'accountant.html',  icon: 'fa-briefcase',         label: 'Πελάτες μου',         roles: ['accountant'] },
    ],
  },
  {
    label: 'Εργαζόμενος',
    items: [
      { href: 'employee-dashboard.html', icon: 'fa-id-badge',      label: 'Ο Λογαριασμός μου',   roles: ['employee'] },
      { href: 'monitor.html',            icon: 'fa-display-medical', label: 'Παρακολούθηση',        roles: ['employee'] },
    ],
  },
  {
    label: 'Διαχείριση',
    items: [
      { href: 'users.html',       icon: 'fa-user-gear',         label: 'Χρήστες',             roles: ['super_admin','owner'] },
      { href: 'businesses.html',  icon: 'fa-building',          label: 'Επιχειρήσεις',        roles: ['super_admin'] },
      { href: 'configure.html',       icon: 'fa-sliders',           label: 'Παραμετροποίηση',      roles: ['super_admin'] },
      { href: 'assoc-stats.html',     icon: 'fa-sitemap',           label: 'Στατιστικά Συλλόγων', roles: ['super_admin'] },
      { href: 'exports.html',     icon: 'fa-file-arrow-down',   label: 'Εξαγωγές',            roles: ['super_admin','owner','accountant'] },
      { href: 'logs.html',        icon: 'fa-clipboard-list',    label: 'Αρχείο Ελέγχου',      roles: ['super_admin','owner','accountant'] },
      { href: 'backups.html',     icon: 'fa-database',          label: 'Αντίγραφα Ασφ.',      roles: ['super_admin'] },
    ],
  },
  {
    label: 'Αναλυτικά',
    items: [
      { href: 'reports.html',     icon: 'fa-chart-bar',         label: 'Αναφορές',            roles: ['super_admin','owner','accountant'] },
      { href: 'mydata.html',      icon: 'fa-link',              label: 'myDATA / Ρύθμιση',    roles: ['super_admin'] },
      { href: 'integrations.html',icon: 'fa-bolt',              label: 'myDATA / Μεταδόσεις', roles: ['super_admin','owner'] },
    ],
  },
  {
    label: 'Οικονομικά',
    items: [
      { href: 'economics.html',   icon: 'fa-chart-pie',         label: 'Οικονομικά',          roles: ['super_admin'] },
    ],
  },
  {
    label: 'Προσωπικό',
    items: [
      { href: 'employee.html',    icon: 'fa-user-shield',       label: 'Σύστημα Εργαζομένων', roles: ['super_admin'] },
    ],
  },
  {
    label: 'Σύστημα',
    items: [
{ href: 'mydata-inbox.html',          icon: 'fa-inbox',              label: 'Εισερχόμενα myDATA',  roles: ['super_admin'] },
      { href: 'delivery-notes-inbox.html', icon: 'fa-truck',              label: 'Δελτία Αποστολής',    roles: ['super_admin'] },
      { href: 'billing.html',      icon: 'fa-credit-card',        label: 'Χρεώσεις',            roles: ['super_admin'] },
      { href: 'reminders.html',   icon: 'fa-bell-ring',         label: 'Υπενθυμίσεις SMS',    roles: ['super_admin'] },
      { href: 'platform.html',    icon: 'fa-server',            label: 'Πλατφόρμα',           roles: ['super_admin'] },
      { href: 'emails.html',      icon: 'fa-paper-plane',       label: 'Email & Campaigns',   roles: ['super_admin'] },
    ],
  },
];

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  owner: 'Ιδιοκτήτης',
  accountant: 'Λογιστής',
  captain: 'Κυβερνήτης',
  employee: 'Υπάλληλος',
};

const ROLE_COLOR = {
  super_admin: '#7C3AED',
  owner:       '#1565C0',
  accountant:  '#0D9488',
  captain:     '#EA580C',
  employee:    '#6B7280',
};

// ── Build sidebar ─────────────────────────────────────────────────────────────
function buildSidebar() {
  const role = getUserRole();
  const user = getCurrentUser();
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

  const displayName = (user && (user.name || user.full_name)) || 'Χρήστης';
  const userInitials = displayName.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
  const userEmail = (user && user.email) || '';
  const roleLabel = ROLE_LABEL[role] || role || '';
  const roleColor = ROLE_COLOR[role] || '#1565C0';
  const userAvatarUrl = user && user.avatar_url
    ? ((user.avatar_url.startsWith('http') ? '' : (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : 'http://localhost:4000/api').replace('/api', '')) + user.avatar_url)
    : null;

  // Build nav HTML
  const navHTML = NAV_GROUPS.map(group => {
    const visible = group.items.filter(item => item.roles.includes(role));
    if (!visible.length) return '';
    const labelHTML = group.label
      ? `<p class="sb-section-label">${group.label}</p>`
      : '<div class="sb-section-gap"></div>';
    const itemsHTML = visible.map(item => {
      const active = currentPage === item.href;
      return `<a href="${item.href}" class="sb-nav-item ${active ? 'active' : ''}">
        <i class="fa-solid ${item.icon} sb-nav-icon"></i>
        <span>${item.label}</span>
      </a>`;
    }).join('');
    return labelHTML + itemsHTML;
  }).join('');

  const html = `
    <style>
      :root {
        --sb-w: 248px;
        --sb-bg: #0F1729;
        --sb-border: rgba(255,255,255,.07);
        --sb-text: rgba(255,255,255,.65);
        --sb-text-active: #fff;
        --sb-hover: rgba(255,255,255,.06);
        --sb-active: rgba(255,255,255,.12);
        --sb-section: rgba(255,255,255,.3);
      }
      #sidebar {
        position: fixed; top:0; left:0; height:100%; width:var(--sb-w);
        background: var(--sb-bg);
        border-right: 1px solid var(--sb-border);
        z-index: 30;
        display: flex; flex-direction: column;
        transform: translateX(-100%);
        transition: transform .22s ease;
      }
      #sidebar.open { transform: translateX(0); }
      @media(min-width:1024px) { #sidebar { transform: translateX(0); } }

      .sb-logo {
        display:flex; align-items:center; gap:12px;
        padding:18px 18px 14px;
        border-bottom:1px solid var(--sb-border);
        flex-shrink:0;
      }
      .sb-logo-icon {
        width:36px;height:36px;border-radius:10px;
        background:linear-gradient(135deg,#1565C0,#0D47A1);
        display:flex;align-items:center;justify-content:center;
        font-size:16px;color:#fff;flex-shrink:0;
      }
      .sb-logo-name { font-size:15px;font-weight:800;color:#fff;letter-spacing:-.2px; }
      .sb-logo-role { font-size:11px;font-weight:600;color:${roleColor};margin-top:1px; }

      .sb-search-wrap { padding:10px 12px 6px; flex-shrink:0; }
      .sb-search {
        width:100%;padding:9px 12px 9px 34px;
        background:rgba(255,255,255,.07);
        border:1px solid rgba(255,255,255,.1);
        border-radius:10px;font-size:13px;color:#fff;
        outline:none;font-family:inherit;
        transition:all .15s; position:relative;
      }
      .sb-search::placeholder { color:rgba(255,255,255,.35); }
      .sb-search:focus { background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.25); }
      .sb-search-wrap { position:relative; }
      .sb-search-icon {
        position:absolute;left:22px;top:50%;transform:translateY(-50%);
        font-size:12px;color:rgba(255,255,255,.35);pointer-events:none;
      }
      .sb-search-dropdown {
        display:none;position:absolute;
        top:calc(100% + 4px);left:12px;right:12px;
        background:#1E2D4A;border:1px solid rgba(255,255,255,.12);
        border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.4);
        z-index:50;max-height:320px;overflow-y:auto;
      }
      .sb-search-dropdown.open { display:block; }

      nav.sb-nav { flex:1;overflow-y:auto;padding:8px 10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.1) transparent; }
      nav.sb-nav::-webkit-scrollbar { width:4px; }
      nav.sb-nav::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1);border-radius:2px; }

      .sb-section-label { font-size:10px;font-weight:700;color:var(--sb-section);letter-spacing:.1em;text-transform:uppercase;padding:16px 8px 6px; }
      .sb-section-gap { height:8px; }
      .sb-nav-item {
        display:flex;align-items:center;gap:10px;
        padding:9px 12px;border-radius:9px;
        color:var(--sb-text);font-size:13px;font-weight:500;
        text-decoration:none;transition:all .12s;margin-bottom:1px;
      }
      .sb-nav-item:hover { background:var(--sb-hover);color:var(--sb-text-active); }
      .sb-nav-item.active { background:var(--sb-active);color:var(--sb-text-active);font-weight:600; }
      .sb-nav-item.active .sb-nav-icon { color:#60A5FA; }
      .sb-nav-icon { width:16px;text-align:center;font-size:14px;flex-shrink:0;opacity:.8; }
      .sb-nav-item.active .sb-nav-icon { opacity:1; }

      .sb-footer {
        border-top:1px solid var(--sb-border);
        padding:10px;flex-shrink:0;
      }
      .sb-user {
        display:flex;align-items:center;gap:10px;
        padding:10px 10px;border-radius:10px;
        cursor:default;transition:background .15s;
      }
      .sb-user:hover { background:var(--sb-hover); }
      .sb-avatar {
        width:34px;height:34px;border-radius:9px;
        background:${roleColor};
        display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:700;color:#fff;flex-shrink:0;
      }
      .sb-user-name { font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      .sb-user-email { font-size:11px;color:rgba(255,255,255,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px; }
      .sb-logout {
        display:flex;align-items:center;gap:10px;
        padding:9px 10px;border-radius:9px;
        background:none;border:none;cursor:pointer;
        color:rgba(255,255,255,.45);font-size:13px;font-weight:500;
        width:100%;transition:all .15s;font-family:inherit;margin-top:2px;
      }
      .sb-logout:hover { background:rgba(239,68,68,.15);color:#F87171; }

      /* Mobile header */
      #mobile-header {
        display:flex;align-items:center;gap:12px;
        position:fixed;top:0;left:0;right:0;height:56px;
        background:#fff;border-bottom:1px solid #e5e7eb;
        padding:0 16px;z-index:10;
        box-shadow:0 1px 8px rgba(0,0,0,.06);
      }
      @media(min-width:1024px) { #mobile-header { display:none; } }
      .sb-hamburger {
        background:none;border:none;cursor:pointer;
        width:38px;height:38px;border-radius:9px;
        display:flex;align-items:center;justify-content:center;
        color:#374151;font-size:16px;
        transition:background .15s;
      }
      .sb-hamburger:hover { background:#f3f4f6; }
      #mob-title { font-size:15px;font-weight:800;color:#111;flex:1; }

      /* Overlay */
      #sb-overlay { position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:20;display:none; }

      /* Main offset */
      @media(min-width:1024px) { body { padding-left:248px !important; } }
    </style>

    <!-- Overlay -->
    <div id="sb-overlay" onclick="toggleSidebar()"></div>

    <!-- Sidebar -->
    <aside id="sidebar">
      <!-- Logo -->
      <div class="sb-logo">
        <div class="sb-logo-icon" style="background:none;padding:0;overflow:visible">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 120" width="36" height="24">
            <path fill="#0B2545" d="M38,60 L5,32 L18,60 L5,88 Z"/>
            <path fill="#0077B6" d="M38,60 C48,25 155,28 168,60 C155,92 48,95 38,60 Z"/>
            <path fill="#00B4D8" d="M55,60 C65,42 145,44 155,60 C145,76 65,78 55,60 Z"/>
            <path fill="#0B2545" d="M70,38 C80,8 110,8 120,35 L105,40 L90,38 Z"/>
            <path fill="#0B2545" d="M80,88 C88,108 102,108 110,86 Z"/>
            <circle cx="138" cy="60" r="10" fill="#FFFFFF"/>
            <circle cx="138" cy="60" r="5" fill="#03045E"/>
          </svg>
        </div>
        <div>
          <div class="sb-logo-name">${CONFIG.APP_NAME || 'FishBill'}</div>
          <div class="sb-logo-role"><i class="fa-solid fa-circle-dot" style="font-size:8px;margin-right:4px"></i>${roleLabel}</div>
        </div>
      </div>

      <!-- Search -->
      <div class="sb-search-wrap">
        <i class="fa-solid fa-magnifying-glass sb-search-icon"></i>
        <input class="sb-search" id="sb-search" type="text" placeholder="Αναζήτηση…"
          oninput="showSearchDropdown();handleSidebarSearch(this.value)"
          onfocus="showSearchDropdown()"
          onblur="setTimeout(hideSearchDropdown,500)" />
        <div class="sb-search-dropdown" id="search-dropdown">
          <div id="search-results" style="padding:12px;font-size:12px;color:rgba(255,255,255,.4);text-align:center">Πληκτρολογήστε για αναζήτηση…</div>
        </div>
      </div>

      <!-- Nav -->
      <nav class="sb-nav">${navHTML}</nav>

      <!-- Footer / user -->
      <div class="sb-footer">
        <div class="sb-user">
          ${userAvatarUrl
            ? `<img src="${userAvatarUrl}" alt="${userInitials}" class="sb-avatar" style="object-fit:cover;padding:0;" onerror="this.outerHTML='<div class=\\'sb-avatar\\'>${userInitials}</div>'" />`
            : `<div class="sb-avatar">${userInitials}</div>`
          }
          <div style="flex:1;min-width:0">
            <div class="sb-user-name">${displayName}</div>
            <div class="sb-user-email">${userEmail || roleLabel}</div>
          </div>
        </div>
        <button class="sb-logout" onclick="logout()">
          <i class="fa-solid fa-right-from-bracket"></i>
          <span>Αποσύνδεση</span>
        </button>
      </div>
    </aside>

    <!-- Mobile header -->
    <div id="mobile-header">
      <button class="sb-hamburger" onclick="toggleSidebar()">
        <i class="fa-solid fa-bars"></i>
      </button>
      <div id="mob-title" style="display:flex;align-items:center;gap:8px">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 120" width="32" height="21">
          <path fill="#0B2545" d="M38,60 L5,32 L18,60 L5,88 Z"/>
          <path fill="#0077B6" d="M38,60 C48,25 155,28 168,60 C155,92 48,95 38,60 Z"/>
          <path fill="#00B4D8" d="M55,60 C65,42 145,44 155,60 C145,76 65,78 55,60 Z"/>
          <path fill="#0B2545" d="M70,38 C80,8 110,8 120,35 L105,40 L90,38 Z"/>
          <circle cx="138" cy="60" r="9" fill="#FFFFFF"/>
          <circle cx="138" cy="60" r="4.5" fill="#03045E"/>
        </svg>
        ${CONFIG.APP_NAME || 'FishBill'}
      </div>
      <span style="font-size:11px;font-weight:700;color:${roleColor};background:rgba(255,255,255,.1);padding:3px 8px;border-radius:99px;border:1px solid currentColor">${roleLabel}</span>
    </div>
  `;

  const container = document.getElementById('sidebar-container');
  if (container) container.innerHTML = html;
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-overlay');
  if (!sb) return;
  const open = sb.classList.toggle('open');
  if (ov) ov.style.display = open ? 'block' : 'none';
}

// ── Search ────────────────────────────────────────────────────────────────────
let _searchTimer = null;

function showSearchDropdown() {
  const dd = document.getElementById('search-dropdown');
  if (dd) dd.classList.add('open');
}

function hideSearchDropdown() {
  const dd = document.getElementById('search-dropdown');
  if (dd) dd.classList.remove('open');
}

function handleSidebarSearch(q) {
  clearTimeout(_searchTimer);
  const res = document.getElementById('search-results');
  if (!res) return;

  if (!q || q.length < 2) {
    res.innerHTML = '<p style="font-size:12px;color:rgba(255,255,255,.35);text-align:center;padding:12px">Πληκτρολογήστε τουλάχιστον 2 χαρακτήρες…</p>';
    return;
  }

  res.innerHTML = '<p style="font-size:12px;color:rgba(255,255,255,.4);text-align:center;padding:12px"><i class="fa-solid fa-spinner fa-spin"></i> Αναζήτηση…</p>';

  _searchTimer = setTimeout(async () => {
    try {
      if (typeof api === 'undefined') throw new Error('Σφάλμα σύνδεσης με τον server.');
      const token = typeof getToken === 'function' ? getToken() : localStorage.getItem('fishbill_token');
      if (!token) { res.innerHTML = '<p style="font-size:12px;color:#F87171;text-align:center;padding:12px">Απαιτείται σύνδεση.</p>'; return; }
      const data = await api.get('/search', { q, limit: 5 });
      renderSearchResults(data.data || {}, q);
    } catch(e) {
      res.innerHTML = `<p style="font-size:12px;color:#F87171;text-align:center;padding:12px"><i class="fa-solid fa-triangle-exclamation"></i> ${e.message}</p>`;
    }
  }, 350);
}

function renderSearchResults(data, q) {
  const res = document.getElementById('search-results');
  if (!res) return;

  const hl = text => {
    if (!text) return '—';
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(text).replace(new RegExp(esc, 'gi'), m => `<mark style="background:#1D4ED8;color:#fff;border-radius:3px;padding:0 2px">${m}</mark>`);
  };

  const sections = [];

  const rowStyle = 'display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:8px;cursor:pointer;text-decoration:none;transition:background .1s;';
  const hoverScript = 'onmouseover="this.style.background=\'rgba(255,255,255,.08)\'" onmouseout="this.style.background=\'none\'"';

  if (data.businesses?.length) {
    sections.push(`
      <div style="padding:8px 10px 4px">
        <p style="font-size:10px;font-weight:700;color:rgba(255,255,255,.3);letter-spacing:.08em;text-transform:uppercase;padding:0 2px;margin-bottom:4px"><i class="fa-solid fa-building" style="margin-right:4px"></i>Επιχειρήσεις</p>
        ${data.businesses.map(b => `
          <a href="businesses.html" style="${rowStyle};color:rgba(255,255,255,.75)" ${hoverScript}>
            <i class="fa-solid fa-building" style="font-size:11px;color:#A78BFA;flex-shrink:0"></i>
            <span style="font-size:12px;font-weight:600">${hl(b.name)}</span>
            <span style="font-size:11px;color:rgba(255,255,255,.35);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.city||hl(b.afm)||''}</span>
            <span style="font-size:10px;color:rgba(255,255,255,.25)">${b.is_active ? '●' : '○'}</span>
          </a>`).join('')}
      </div>`);
  }

  if (data.users?.length) {
    sections.push(`
      <div style="padding:4px 10px">
        <p style="font-size:10px;font-weight:700;color:rgba(255,255,255,.3);letter-spacing:.08em;text-transform:uppercase;padding:0 2px;margin-bottom:4px"><i class="fa-solid fa-user-gear" style="margin-right:4px"></i>Χρήστες</p>
        ${data.users.map(u => `
          <a href="users.html" style="${rowStyle};color:rgba(255,255,255,.75)" ${hoverScript}>
            <i class="fa-solid fa-user-gear" style="font-size:11px;color:#F472B6;flex-shrink:0"></i>
            <span style="font-size:12px;font-weight:600">${hl(u.full_name)}</span>
            <span style="font-size:11px;color:rgba(255,255,255,.35);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(u.email)||''}</span>
          </a>`).join('')}
      </div>`);
  }

  if (data.invoices?.length) {
    sections.push(`
      <div style="padding:8px 10px 4px">
        <p style="font-size:10px;font-weight:700;color:rgba(255,255,255,.3);letter-spacing:.08em;text-transform:uppercase;padding:0 2px;margin-bottom:4px"><i class="fa-solid fa-file-invoice" style="margin-right:4px"></i>Παραστατικά</p>
        ${data.invoices.map(inv => `
          <a href="invoices.html#${inv.id}" style="${rowStyle};color:rgba(255,255,255,.75)" ${hoverScript}>
            <i class="fa-solid fa-file-invoice" style="font-size:11px;color:#60A5FA;flex-shrink:0"></i>
            <span style="font-size:12px;font-weight:600;color:#93C5FD">${hl(inv.full_number)}</span>
            <span style="font-size:12px;color:rgba(255,255,255,.5);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(inv.customer_name)||''}</span>
            <span style="font-size:11px;color:rgba(255,255,255,.4)">${inv.total_value ? '€'+parseFloat(inv.total_value).toLocaleString('el-GR',{minimumFractionDigits:2}) : ''}</span>
          </a>`).join('')}
      </div>`);
  }

  if (!sections.length) {
    res.innerHTML = `<p style="font-size:12px;color:rgba(255,255,255,.35);text-align:center;padding:16px">Δεν βρέθηκαν αποτελέσματα για "<strong style="color:rgba(255,255,255,.6)">${q}</strong>"</p>`;
    return;
  }

  res.innerHTML = sections.join(`<div style="height:1px;background:rgba(255,255,255,.06);margin:0 10px"></div>`) +
    `<div style="border-top:1px solid rgba(255,255,255,.06);padding:8px 12px">
       <a href="invoices.html?q=${encodeURIComponent(q)}" style="font-size:11px;color:#60A5FA;font-weight:600;text-decoration:none">
         <i class="fa-solid fa-arrow-right" style="margin-right:4px"></i>Περισσότερα αποτελέσματα
       </a>
     </div>`;
}

window.buildSidebar   = buildSidebar;
window.toggleSidebar  = toggleSidebar;
window.handleSidebarSearch = handleSidebarSearch;
window.showSearchDropdown  = showSearchDropdown;
window.hideSearchDropdown  = hideSearchDropdown;

// ── Admin Alert Sound System ──────────────────────────────────────────────────
// Plays a loud beeping alert when new invoices or delivery notes arrive.
// Only active for super_admin users.

let _alertLastInvoiceCount = -1;
let _alertLastDNCount      = -1;
let _alertEnabled          = true;
let _alertAudioCtx         = null;
let _alertToast            = null;

function _getAudioCtx() {
  if (!_alertAudioCtx) {
    try { _alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  return _alertAudioCtx;
}

function _playBeep(frequency, duration, volume) {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gainNode   = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type      = 'square';
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function _playAlertSequence() {
  // Three loud urgent beeps
  _playBeep(880, 0.25, 1.0);
  setTimeout(() => _playBeep(880, 0.25, 1.0), 320);
  setTimeout(() => _playBeep(1100, 0.40, 1.0), 640);
}

function _showAlertToast(message) {
  if (_alertToast) { _alertToast.remove(); _alertToast = null; }
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:99999;
    background:#dc2626;color:#fff;padding:16px 20px;border-radius:14px;
    box-shadow:0 8px 32px rgba(220,38,38,.5);font-family:Inter,sans-serif;
    font-size:14px;font-weight:700;max-width:360px;cursor:pointer;
    display:flex;align-items:center;gap:12px;
    animation:slideInRight .3s ease-out;
  `;
  t.innerHTML = `<span style="font-size:22px">🔔</span><div><div style="font-size:15px;font-weight:800">${message}</div><div style="font-size:12px;font-weight:500;opacity:.85;margin-top:3px">Κλικ για να κλείσει</div></div>`;
  t.onclick = () => { t.remove(); if (_alertToast === t) _alertToast = null; };
  document.body.appendChild(t);
  _alertToast = t;
  // Auto-dismiss after 15s
  setTimeout(() => { if (t.parentNode) t.remove(); if (_alertToast === t) _alertToast = null; }, 15000);
}

async function _checkForNewItems() {
  if (!_alertEnabled) return;
  const role = getUserRole ? getUserRole() : null;
  if (role !== 'super_admin') return;

  const token = typeof getToken === 'function' ? getToken() : localStorage.getItem('fishbill_token');
  if (!token) return;

  try {
    const apiBase = (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : 'http://localhost:4000/api');
    const headers = { 'Authorization': 'Bearer ' + token };

    const [invResp, dnResp] = await Promise.all([
      fetch(`${apiBase}/admin/invoices?page=1&limit=1&status=pending`, { headers }),
      fetch(`${apiBase}/delivery-notes?page=1&limit=1&status=pending`, { headers }),
    ]);

    const invData = invResp.ok ? await invResp.json() : null;
    const dnData  = dnResp.ok  ? await dnResp.json()  : null;

    const invTotal = invData?.meta?.total ?? invData?.data?.length ?? 0;
    const dnTotal  = dnData?.meta?.total  ?? dnData?.data?.length  ?? 0;

    const alerts = [];

    if (_alertLastInvoiceCount >= 0 && invTotal > _alertLastInvoiceCount) {
      const diff = invTotal - _alertLastInvoiceCount;
      alerts.push(`${diff} νέο${diff > 1 ? 'ι' : ''} τιμολόγιο${diff > 1 ? 'α' : ''} προς επεξεργασία!`);
    }
    if (_alertLastDNCount >= 0 && dnTotal > _alertLastDNCount) {
      const diff = dnTotal - _alertLastDNCount;
      alerts.push(`${diff} νέο${diff > 1 ? 'α' : ''} ΔΑ προς επεξεργασία!`);
    }

    if (alerts.length > 0) {
      _playAlertSequence();
      _showAlertToast(alerts.join(' | '));
      // Try browser notification too
      if (Notification.permission === 'granted') {
        new Notification('🔔 FishBill — Νέα εκκρεμή!', { body: alerts.join('\n'), icon: '/fishbill/admin/favicon.ico' });
      }
    }

    _alertLastInvoiceCount = invTotal;
    _alertLastDNCount      = dnTotal;
  } catch (_) {}
}

function _initAlertSystem() {
  const role = getUserRole ? getUserRole() : null;
  if (role !== 'super_admin') return;

  // Request browser notification permission
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  // Unlock AudioContext on first user interaction (browser requirement)
  const unlockAudio = () => {
    const ctx = _getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
  };
  document.addEventListener('click', unlockAudio);
  document.addEventListener('keydown', unlockAudio);

  // Initial check after 3 seconds, then every 30 seconds
  setTimeout(() => {
    _checkForNewItems();
    setInterval(_checkForNewItems, 30_000);
  }, 3000);
}

// Start alert system after sidebar is built
const _origBuildSidebar = window.buildSidebar;
window.buildSidebar = function() {
  _origBuildSidebar();
  _initAlertSystem();
};

window.adminAlertEnable  = () => { _alertEnabled = true; };
window.adminAlertDisable = () => { _alertEnabled = false; };