// ── Maintenance mode check ────────────────────────────────────────────────────
(async () => {
  const onMaintPage = window.location.pathname.includes('maintenance.html');
  const onAdmin     = window.location.pathname.includes('/admin/');
  if (onMaintPage || onAdmin) return;
  try {
    const apiHost = (CONFIG && CONFIG.API_URL) ? CONFIG.API_URL.replace('/api', '') : 'http://localhost:4000';
    const r = await fetch(apiHost + '/api/status');
    const d = await r.json();
    if (d.maintenance) window.location.replace('/fishbill/maintenance.html');
  } catch { /* server unreachable */ }
})();

// ─── Token management ────────────────────────────────────────────────────────
function getToken()  { return localStorage.getItem('acc_token'); }
function setToken(t, r) {
  localStorage.setItem('acc_token', t);
  if (r) localStorage.setItem('acc_refresh_token', r);
}
function clearToken() {
  localStorage.removeItem('acc_token');
  localStorage.removeItem('acc_refresh_token');
  localStorage.removeItem('acc_user');
}
function setCurrentUser(u) { if (u) localStorage.setItem('acc_user', JSON.stringify(u)); }
function getCurrentUser() {
  try {
    const s = localStorage.getItem('acc_user');
    if (s) return JSON.parse(s);
  } catch (e) {}
  return getUser();
}
function getUser() {
  const t = getToken();
  if (!t) return null;
  try {
    const b = t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4)));
  } catch (e) { return null; }
}
function getUserName()  { const u = getCurrentUser(); return u ? (u.name || u.full_name || 'Λογιστής') : 'Λογιστής'; }
function getUserEmail() { const u = getCurrentUser(); return u ? (u.email || '') : ''; }

// ─── Auth endpoints: NEVER trigger the 401-redirect on these ─────────────────
const AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/accountant/login',
  '/accountant/register',
];

// ─── Core request ─────────────────────────────────────────────────────────────
async function request(method, endpoint, data = null, params = null) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const base = (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : 'http://localhost:4000/api');
  let url = `${base}${endpoint}`;
  if (params && typeof params === 'object') {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    if (qs) url += `?${qs}`;
  }

  const opts = { method: method.toUpperCase(), headers };
  if (data !== null && method !== 'GET') opts.body = JSON.stringify(data);

  try {
    const res = await fetch(url, opts);

    if (res.status === 401) {
      const isAuthEndpoint = AUTH_ENDPOINTS.some(ep => endpoint.startsWith(ep));
      if (isAuthEndpoint) {
        // Wrong credentials on login/register — throw so the page can show the Greek error
        const json = await res.json().catch(() => null);
        const err = new Error((json && json.error) || 'Λάθος email ή κωδικός πρόσβασης.');
        err.status = 401;
        err.error_code = json && json.error_code;
        throw err;
      }
      // Expired token on a protected page — redirect to login
      clearToken();
      window.location.href = '/fishbill/accountant/index.html';
      return null;
    }

    if (res.status === 204) return { success: true };

    const ct = res.headers.get('content-type');
    const result = (ct && ct.includes('application/json')) ? await res.json() : await res.text();

    if (!res.ok) {
      const raw = (result && result.error) || '';
      // Translate any English server errors to Greek
      let msg = raw;
      if (!msg || msg.toLowerCase().includes('internal') || msg.match(/^HTTP \d+$/)) {
        msg = 'Προσωρινό πρόβλημα στον server. Παρακαλώ δοκιμάστε ξανά σε λίγο.';
      } else if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid credentials')) {
        msg = 'Λάθος email ή κωδικός πρόσβασης.';
      } else if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no user')) {
        msg = 'Δεν βρέθηκε λογαριασμός με αυτά τα στοιχεία.';
      } else if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('taken')) {
        msg = 'Υπάρχει ήδη λογαριασμός με αυτό το email.';
      } else if (msg.toLowerCase().includes('forbidden') || msg.toLowerCase().includes('access denied')) {
        msg = 'Δεν έχετε δικαίωμα πρόσβασης σε αυτή την ενέργεια.';
      } else if (msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('rate limit')) {
        msg = 'Πολλές αποτυχημένες προσπάθειες. Παρακαλώ περιμένετε λίγο.';
      } else if (msg.toLowerCase().includes('validation') || msg.toLowerCase().includes('invalid input')) {
        msg = 'Τα στοιχεία που εισάγατε δεν είναι έγκυρα. Παρακαλώ ελέγξτε και δοκιμάστε ξανά.';
      }
      const err = new Error(msg);
      err.status = res.status;
      err.error_code = result && result.error_code;
      throw err;
    }

    return result;
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Δεν είναι δυνατή η σύνδεση με τον server. Ελέγξτε τη σύνδεσή σας στο δίκτυο.');
    }
    throw err;
  }
}

const api = {
  get:    (ep, params)       => request('GET',    ep, null, params),
  post:   (ep, data, params) => request('POST',   ep, data, params),
  put:    (ep, data, params) => request('PUT',    ep, data, params),
  patch:  (ep, data, params) => request('PATCH',  ep, data, params),
  delete: (ep, params)       => request('DELETE', ep, null, params),
};

window.api            = api;
window.getToken       = getToken;
window.setToken       = setToken;
window.clearToken     = clearToken;
window.getUser        = getUser;
window.getCurrentUser = getCurrentUser;
window.setCurrentUser = setCurrentUser;
window.getUserName    = getUserName;
window.getUserEmail   = getUserEmail;