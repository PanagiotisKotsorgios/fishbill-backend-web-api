// ── Config ────────────────────────────────────────────────────────────────────
// PRODUCTION: change these two lines to your live API domain.
const API_URL  = 'https://master-app.gr/api';
const API_HOST = 'https://master-app.gr';

// Prefix server-relative paths (e.g. /avatars/...) with the API host
function assetUrl(path) {
  if (!path) return '';
  return path.startsWith('/') ? API_HOST + path : path;
}

// ── Token management ──────────────────────────────────────────────────────────
const T = {
  get: ()      => localStorage.getItem('fb_token'),
  set: (a, r)  => { localStorage.setItem('fb_token', a); if (r) localStorage.setItem('fb_refresh', r); },
  clear: ()    => ['fb_token','fb_refresh','fb_user'].forEach(k => localStorage.removeItem(k)),
  setUser: (u) => localStorage.setItem('fb_user', JSON.stringify(u)),
  getUser: ()  => { try { return JSON.parse(localStorage.getItem('fb_user')); } catch { return null; } },
};

// ── AUTH ENDPOINTS — never trigger the 401-redirect on these ─────────────────
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];

// ── API fetch ─────────────────────────────────────────────────────────────────
async function apiFetch(method, endpoint, data = null, params = null) {
  const headers = { 'Content-Type': 'application/json' };
  const tok = T.get();
  if (tok) headers['Authorization'] = `Bearer ${tok}`;

  let url = API_URL + endpoint;
  if (params) {
    const qs = Object.entries(params).filter(([,v]) => v != null && v !== '')
      .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    if (qs) url += '?' + qs;
  }

  const opts = { method: method.toUpperCase(), headers };
  if (data && method !== 'GET') opts.body = JSON.stringify(data);

  const res = await fetch(url, opts);

  // 401 on auth endpoints = wrong credentials → throw so the login page can catch it
  // 401 on protected endpoints = expired/missing token → redirect to login
  if (res.status === 401) {
    const isAuthEndpoint = AUTH_ENDPOINTS.some(ep => endpoint.startsWith(ep));
    if (isAuthEndpoint) {
      const json = await res.json().catch(() => null);
      const err = new Error((json && json.error) || 'Λάθος email ή κωδικός πρόσβασης.');
      err.status = 401;
      err.error_code = json && json.error_code;
      throw err;
    }
    T.clear();
    window.location = '/fishbill/app/';
    return null;
  }

  if (res.status === 402) {
    if (!window.location.pathname.includes('plan-setup.html')) {
      window.location.replace('/fishbill/app/plan-setup.html');
    }
    return null;
  }

  if (res.status === 204) return { success: true };
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((json && json.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.error_code = json && json.error_code;
    throw err;
  }
  return json;
}

const api = {
  get:    (ep, p)    => apiFetch('GET',    ep, null, p),
  post:   (ep, d, p) => apiFetch('POST',   ep, d,    p),
  put:    (ep, d)    => apiFetch('PUT',    ep, d),
  patch:  (ep, d)    => apiFetch('PATCH',  ep, d),
  delete: (ep)       => apiFetch('DELETE', ep),
};

// ── Maintenance mode check ────────────────────────────────────────────────────
// Runs automatically on every app page. Redirects to maintenance page if enabled.
(async () => {
  const onMaintPage = window.location.pathname.includes('maintenance.html');
  const onAdmin     = window.location.pathname.includes('/admin/');
  if (onMaintPage || onAdmin) return; // never redirect these pages
  try {
    const r = await fetch(API_HOST + '/api/status');
    const d = await r.json();
    if (d.maintenance) {
      window.location.replace('/fishbill/maintenance.html');
    }
  } catch { /* server unreachable — don't block the app */ }
})();

// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth() {
  if (!T.get()) { window.location = '/fishbill/app/'; return false; }
  return true;
}

// ── Customers feature flag ────────────────────────────────────────────────────
function initCustomersNav() {
  const enabled = localStorage.getItem('fb_feat_customers') === '1';
  ['nav-customers-desktop', 'nav-customers-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = enabled ? '' : 'none';
  });
}

function setFeatureCustomers(val) {
  localStorage.setItem('fb_feat_customers', val ? '1' : '0');
  initCustomersNav();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const colors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;
    background:${colors[type]||colors.info};color:#fff;padding:12px 20px;border-radius:999px;
    font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.2);
    white-space:nowrap;transition:opacity .3s;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3200);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmtMoney(n) {
  const v = parseFloat(n);
  return isNaN(v) ? '€0,00' : '€' + v.toLocaleString('el-GR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? d : `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}
function statusBadge(s) {
  const m = {
    transmitted: ['Μεταδόθηκε','#d1fae5','#065f46'],
    issued:      ['Εκδόθηκε',  '#dbeafe','#1e3a5f'],
    failed:      ['Αποτυχία',  '#fee2e2','#7f1d1d'],
    draft:       ['Πρόχειρο',  '#f3f4f6','#374151'],
    pending_retry:['Εκ νέου',  '#fef3c7','#78350f'],
    cancelled:   ['Ακυρώθηκε','#f3f4f6','#9ca3af'],
  };
  const [label, bg, color] = m[s] || [s,'#f3f4f6','#374151'];
  return `<span style="background:${bg};color:${color};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700">${label}</span>`;
}

window.T = T; window.api = api; window.requireAuth = requireAuth;
window.toast = toast; window.fmtMoney = fmtMoney; window.fmtDate = fmtDate; window.statusBadge = statusBadge;
window.assetUrl = assetUrl;

// ── Render user avatar in any element with id="nav-avatar" ───────────────────
function initNavAvatar() {
  const el = document.getElementById('nav-avatar');
  if (!el) return;
  const user = T.getUser();
  if (!user) return;
  if (user.avatar_url) {
    const initials = (user.full_name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    el.innerHTML = `<img src="${assetUrl(user.avatar_url)}" 
      onerror="this.style.display='none';this.parentElement.textContent='${initials}'" 
      style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    const initials = (user.full_name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    el.textContent = initials;
  }
}

initNavAvatar();
// ── Subscription gate (auto-loaded on every protected app page) ───────────────
(async () => {
  const path = window.location.pathname;
  const isExempt = !path.includes('/app/') ||
    path.endsWith('/app/') ||
    path.endsWith('index.html') ||
    path.includes('plan-setup.html') ||
    path.includes('/admin/') ||
    path.includes('maintenance.html');
  if (isExempt || !T.get()) return;
  try {
    const r = await apiFetch('GET', '/subscription/status');
    if (r?.data && !r.data.subscription_active) {
      window.location.replace('/fishbill/app/plan-setup.html');
    }
  } catch (e) {
    if (e && e.status === 402) window.location.replace('/fishbill/app/plan-setup.html');
  }
})();

// ── GDPR Cookie Consent (auto-loaded with core.js) ────────────────────────────
(function(){var s=document.createElement('script');s.src='/fishbill/app/js/cookie-consent.js';document.head.appendChild(s);})();
