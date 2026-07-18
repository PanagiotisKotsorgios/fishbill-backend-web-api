// Αγρότης admin API helper — completely independent from FishBill's api.js.

const TOKEN_KEY = 'agrotis_admin_token';
const USER_KEY  = 'agrotis_admin_user';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function setCurrentUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}

async function request(method, path, body = null, params = null) {
  // Resolve CONFIG.API_URL against location.origin so both absolute
  // (https://…) and path-relative (/agrotis/api) forms work.
  const base = new URL(
    CONFIG.API_URL.endsWith('/') ? CONFIG.API_URL : CONFIG.API_URL + '/',
    location.origin
  );
  const url = new URL(path.replace(/^\//, ''), base);
  if (params) for (const k of Object.keys(params)) {
    if (params[k] != null && params[k] !== '') url.searchParams.set(k, params[k]);
  }

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const opts = { method: method.toUpperCase(), headers };
  if (body != null && opts.method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url.toString(), opts);
  if (res.status === 401 && path !== '/admin/login') {
    clearToken();
    window.location.href = 'index.html?expired=1';
    return null;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body   = json;
    throw err;
  }
  return json;
}

const api = {
  login:          (email, password) => request('POST', '/admin/login', { email, password }),
  changePassword: (currentPw, newPw) =>
    request('POST', '/admin/change-password', { current_password: currentPw, new_password: newPw }),

  stats:          ()      => request('GET', '/admin/stats'),
  users:          (p={})  => request('GET', '/admin/users', null, p),
  deleteUser:     (id)    => request('DELETE', `/admin/users/${id}`),
  businesses:     (p={})  => request('GET', '/admin/businesses', null, p),
  business:       (id)    => request('GET', `/admin/businesses/${id}`),
  invoices:       (p={})  => request('GET', '/admin/invoices', null, p),
  invoice:        (id)    => request('GET', `/admin/invoices/${id}`),
  deliveryNotes:  (p={})  => request('GET', '/admin/delivery-notes', null, p),
  deliveryNote:   (id)    => request('GET', `/admin/delivery-notes/${id}`),
  weighingSlips:  (p={})  => request('GET', '/admin/weighing-slips', null, p),
  wrappLogs:      (p={})  => request('GET', '/admin/wrapp-logs', null, p),
  wrappLog:       (id)    => request('GET', `/admin/wrapp-logs/${id}`),
  purgeWrappLogs: (days)  => request('DELETE', '/admin/wrapp-logs/purge', null, { days }),

  updateSubscription: (businessId, body) =>
    request('PATCH', `/admin/subscriptions/${businessId}`, body),
};

window.api = api;
window.getCurrentUser = getCurrentUser;
window.setCurrentUser = setCurrentUser;
window.setToken       = setToken;
window.getToken       = getToken;
window.clearToken     = clearToken;
