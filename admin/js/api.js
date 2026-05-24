/**
 * FishBill API Client
 * Handles auth tokens, debug logging, and all HTTP communication.
 */

// ─── Token management ───────────────────────────────────────────────────────

function getToken() {
  // Per-tab impersonation token takes priority (set by employee-dashboard.html)
  return sessionStorage.getItem('fishbill_imp_token') || localStorage.getItem('fishbill_token');
}

function setToken(token, refreshToken) {
  localStorage.setItem('fishbill_token', token);
  if (refreshToken) {
    localStorage.setItem('fishbill_refresh_token', refreshToken);
  }
}

function clearToken() {
  localStorage.removeItem('fishbill_token');
  localStorage.removeItem('fishbill_refresh_token');
  localStorage.removeItem('fishbill_user');
}

// ─── User data ───────────────────────────────────────────────────────────────

/** Store full user object returned by the login response. */
function setCurrentUser(userData) {
  if (userData) {
    localStorage.setItem('fishbill_user', JSON.stringify(userData));
  }
}

/** Return the stored user object (set after login). Falls back to JWT decode. */
function getCurrentUser() {
  // In impersonation mode, always decode from the session token (skip localStorage user)
  if (sessionStorage.getItem('fishbill_imp_token')) return getUser();
  try {
    const stored = localStorage.getItem('fishbill_user');
    if (stored) return JSON.parse(stored);
  } catch (e) { /* ignore */ }
  return getUser();
}

/** Decode the JWT payload (low-level). Prefer getCurrentUser() for display data. */
function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch (e) {
    if (typeof CONFIG !== 'undefined' && CONFIG.DEBUG) {
      console.error('[FishBill] JWT decode failed:', e);
    }
    return null;
  }
}

// ─── Debug logging ──────────────────────────────────────────────────────────

const _lastRequests = [];

function _isDebug() {
  return (typeof CONFIG !== 'undefined' && CONFIG.DEBUG);
}

function _dbg(...args) {
  if (!_isDebug()) return;
  console.log('%c[FishBill API]', 'color:#3b82f6;font-weight:bold', ...args);
}

function _dbgError(...args) {
  if (!_isDebug()) return;
  console.error('%c[FishBill API]', 'color:#ef4444;font-weight:bold', ...args);
}

/** Returns the last 20 API request log entries (useful in debug mode). */
function getDebugLog() {
  return _lastRequests;
}

// ─── Auth endpoints — never redirect on 401 for these ───────────────────────
const AUTH_ENDPOINTS = ['/auth/login', '/auth/admin-login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];

// ─── Core request ────────────────────────────────────────────────────────────

async function request(method, endpoint, data = null, params = null) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const baseUrl = (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : 'http://localhost:4000/api');
  let url = `${baseUrl}${endpoint}`;

  if (params && typeof params === 'object') {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const options = { method: method.toUpperCase(), headers };
  if (data !== null && method !== 'GET') {
    options.body = JSON.stringify(data);
  }

  const startTime = Date.now();
  const logEntry = { method: method.toUpperCase(), url, status: null, duration: null, error: null, ts: new Date().toISOString() };

  _dbg(`→ ${method.toUpperCase()} ${endpoint}`, data ? JSON.stringify(data).slice(0, 200) : '');

  try {
    const response = await fetch(url, options);
    logEntry.status = response.status;
    logEntry.duration = Date.now() - startTime;
    _lastRequests.unshift(logEntry);
    if (_lastRequests.length > 20) _lastRequests.pop();

    if (response.status === 401) {
      const isAuthEndpoint = AUTH_ENDPOINTS.some(ep => endpoint.startsWith(ep));
      if (isAuthEndpoint) {
        // Login attempt failed — parse error and throw so caller can show it
        const errBody = await response.json().catch(() => null);
        const errMsg = (errBody && errBody.error) || 'Λάθος email ή κωδικός πρόσβασης.';
        const err = new Error(errMsg);
        err.status = 401;
        throw err;
      }
      _dbgError('401 Unauthorized — clearing session');
      clearToken();
      window.location.href = '401.html';
      return null;
    }

    if (response.status === 204) return { success: true };

    const contentType = response.headers.get('content-type');
    let result;
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    _dbg(`← ${response.status} ${endpoint} (${logEntry.duration}ms)`, result);

    if (!response.ok) {
      const errorMsg = (result && result.error) || (result && result.message) || `HTTP ${response.status}`;
      logEntry.error = errorMsg;
      throw new Error(errorMsg);
    }

    return result;
  } catch (err) {
    logEntry.error = err.message;
    logEntry.duration = logEntry.duration || (Date.now() - startTime);
    if (!logEntry.status) {
      _lastRequests.unshift(logEntry);
      if (_lastRequests.length > 20) _lastRequests.pop();
    }

    _dbgError(`✖ ${method.toUpperCase()} ${endpoint}:`, err.message);

    if (err.name === 'TypeError' && (err.message.includes('fetch') || err.message.includes('Failed to fetch'))) {
      window.location.href = '503.html';
      return null;
    }
    throw err;
  }
}

// ─── API object ──────────────────────────────────────────────────────────────

const api = {
  get:    (endpoint, params)       => request('GET',    endpoint, null, params),
  post:   (endpoint, data, params) => request('POST',   endpoint, data, params),
  put:    (endpoint, data, params) => request('PUT',    endpoint, data, params),
  patch:  (endpoint, data, params) => request('PATCH',  endpoint, data, params),
  delete: (endpoint, params)       => request('DELETE', endpoint, null, params),
};

// ─── Admin OTP System ────────────────────────────────────────────────────────
// OTP is no longer required on every mutation or every page.
// It is session-wide: once verified per browser session it is remembered.
// Call AdminOTP.requireAction(msg) explicitly before any truly dangerous operation.

const _SESSION_KEY = 'fb_otp_session';

const AdminOTP = {
  _resolve: null,
  _reject: null,
  _timerInterval: null,

  _isSessionVerified() {
    return sessionStorage.getItem(_SESSION_KEY) === '1';
  },

  _markSessionVerified() {
    sessionStorage.setItem(_SESSION_KEY, '1');
  },

  // Call before truly dangerous actions (delete user, delete business, etc.)
  // Shows OTP dialog only if not already verified this session.
  async requireAction(description) {
    if (this._isSessionVerified()) return;
    return this._showDialog(false, description);
  },

  // Called on page load for high-security pages (billing, platform config, etc.)
  // Verifies once per session — no re-prompt on subsequent page visits.
  async requireSection() {
    if (this._isSessionVerified()) return;
    try {
      await this._showDialog(true);
      this._markSessionVerified();
    } catch {
      history.back();
    }
  },

  _inject() {
    if (document.getElementById('fb-otp-overlay')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div id="fb-otp-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;align-items:center;justify-content:center">
  <div id="fb-otp-box" style="background:#fff;border-radius:20px;padding:32px 36px;width:100%;max-width:420px;box-shadow:0 24px 60px rgba(0,0,0,.3);font-family:Inter,system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div style="width:44px;height:44px;background:#0A5568;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <div>
        <div style="font-size:17px;font-weight:800;color:#0A5568">Επαλήθευση Ταυτότητας</div>
        <div id="fb-otp-subtitle" style="font-size:12px;color:#6b7280;margin-top:2px">Απαιτείται 6-ψήφιος κωδικός</div>
      </div>
    </div>
    <p id="fb-otp-desc" style="font-size:13px;color:#374151;margin:0 0 20px;line-height:1.6"></p>
    <button id="fb-otp-send-btn" style="width:100%;background:#0A5568;color:#fff;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .2s">
      Αποστολή Κωδικού στο Email
    </button>
    <div id="fb-otp-input-area" style="display:none;margin-top:16px">
      <div style="font-size:12px;color:#6b7280;margin-bottom:8px;text-align:center">Εισάγετε τον 6-ψήφιο κωδικό που στάλθηκε στο email σας</div>
      <input id="fb-otp-input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"
        style="width:100%;border:2px solid #e5e7eb;border-radius:12px;padding:14px;font-size:28px;font-weight:800;letter-spacing:10px;text-align:center;outline:none;box-sizing:border-box;font-family:monospace;transition:border-color .2s"
        placeholder="——————" />
      <div id="fb-otp-timer" style="font-size:11px;color:#9ca3af;text-align:center;margin-top:6px"></div>
    </div>
    <div id="fb-otp-error" style="display:none;margin-top:12px;background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:10px 14px;font-size:13px;color:#991b1b;text-align:center"></div>
    <div style="display:flex;gap:10px;margin-top:20px">
      <button id="fb-otp-verify-btn" style="display:none;flex:1;background:#16a34a;color:#fff;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">
        Επαλήθευση
      </button>
      <button id="fb-otp-cancel-btn" style="flex:1;background:#f3f4f6;color:#374151;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:600;cursor:pointer">
        Ακύρωση
      </button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap.firstElementChild);

    document.getElementById('fb-otp-send-btn').addEventListener('click', () => AdminOTP._sendCode());
    document.getElementById('fb-otp-verify-btn').addEventListener('click', () => AdminOTP._verifyCode());
    document.getElementById('fb-otp-cancel-btn').addEventListener('click', () => AdminOTP._cancel());
    document.getElementById('fb-otp-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') AdminOTP._verifyCode();
    });
    document.getElementById('fb-otp-input').addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '');
      document.getElementById('fb-otp-error').style.display = 'none';
    });
  },

  async _sendCode() {
    const btn = document.getElementById('fb-otp-send-btn');
    const errEl = document.getElementById('fb-otp-error');
    btn.disabled = true;
    btn.textContent = 'Αποστολή...';
    errEl.style.display = 'none';
    try {
      const result = await request('POST', '/admin/otp/request', {});
      document.getElementById('fb-otp-input-area').style.display = 'block';
      document.getElementById('fb-otp-verify-btn').style.display = 'block';
      document.getElementById('fb-otp-input').focus();
      btn.textContent = 'Επανάληψη αποστολής';
      btn.style.background = '#6b7280';
      btn.disabled = false;
      this._startTimer(300);
    } catch (e) {
      errEl.textContent = e.message || 'Αποτυχία αποστολής. Δοκιμάστε ξανά.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Αποστολή Κωδικού στο Email';
    }
  },

  _startTimer(secs) {
    clearInterval(this._timerInterval);
    let s = secs;
    const el = document.getElementById('fb-otp-timer');
    const tick = () => {
      if (s <= 0) {
        clearInterval(this._timerInterval);
        if (el) el.textContent = 'Ο κωδικός έληξε — ζητήστε νέο.';
        return;
      }
      const m = Math.floor(s / 60), ss = s % 60;
      if (el) el.textContent = `Λήξη σε ${m}:${String(ss).padStart(2, '0')}`;
      s--;
    };
    tick();
    this._timerInterval = setInterval(tick, 1000);
  },

  async _verifyCode() {
    const code = (document.getElementById('fb-otp-input').value || '').trim();
    const errEl = document.getElementById('fb-otp-error');
    errEl.style.display = 'none';
    if (code.length !== 6) {
      errEl.textContent = 'Εισάγετε ακριβώς 6 ψηφία.';
      errEl.style.display = 'block';
      return;
    }
    const btn = document.getElementById('fb-otp-verify-btn');
    btn.disabled = true;
    btn.textContent = 'Επαλήθευση...';
    try {
      await request('POST', '/admin/otp/verify', { code });
      clearInterval(this._timerInterval);
      this._markSessionVerified();
      this._close();
      if (this._resolve) { const r = this._resolve; this._resolve = null; this._reject = null; r(); }
    } catch (e) {
      errEl.textContent = e.message || 'Λάθος ή ληγμένος κωδικός.';
      errEl.style.display = 'block';
      document.getElementById('fb-otp-input').value = '';
      document.getElementById('fb-otp-input').focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Επαλήθευση';
    }
  },

  _cancel() {
    clearInterval(this._timerInterval);
    this._close();
    if (this._reject) { const r = this._reject; this._resolve = null; this._reject = null; r(new Error('Ακυρώθηκε')); }
  },

  _close() {
    const overlay = document.getElementById('fb-otp-overlay');
    if (overlay) overlay.style.display = 'none';
    const inp = document.getElementById('fb-otp-input');
    if (inp) inp.value = '';
    const err = document.getElementById('fb-otp-error');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    const area = document.getElementById('fb-otp-input-area');
    if (area) area.style.display = 'none';
    const vBtn = document.getElementById('fb-otp-verify-btn');
    if (vBtn) vBtn.style.display = 'none';
    const sBtn = document.getElementById('fb-otp-send-btn');
    if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'Αποστολή Κωδικού στο Email'; sBtn.style.background = '#0A5568'; }
    const timer = document.getElementById('fb-otp-timer');
    if (timer) timer.textContent = '';
  },

  _showDialog(isSection, customDescription) {
    this._inject();
    const overlay = document.getElementById('fb-otp-overlay');
    overlay.style.display = 'flex';
    const desc = document.getElementById('fb-otp-desc');
    if (customDescription) {
      desc.textContent = customDescription + ' Θα σταλεί κωδικός 6 ψηφίων στο email σας για επαλήθευση. Η επαλήθευση ισχύει για ολόκληρη τη συνεδρία.';
    } else if (isSection) {
      desc.textContent = 'Η ενότητα αυτή περιέχει ευαίσθητες ρυθμίσεις. Επαληθεύστε την ταυτότητά σας μία φορά ανά συνεδρία.';
    } else {
      desc.textContent = 'Απαιτείται επαλήθευση για αυτή την ενέργεια. Θα σταλεί κωδικός 6 ψηφίων στο email σας.';
    }
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  },
};

window.AdminOTP = AdminOTP;

// Pages that require OTP on load (managed here so individual pages don't need boilerplate)
const _OTP_GATED_PAGES = new Set([]);

// Auto-gate for the protected "Σύστημα" section pages on page load
document.addEventListener('DOMContentLoaded', () => {
  const page = location.pathname.split('/').pop() || '';
  if (_OTP_GATED_PAGES.has(page)) {
    AdminOTP.requireSection();
  }
});

// ─── Expose globals ──────────────────────────────────────────────────────────

window.api            = api;
window.getToken       = getToken;
window.setToken       = setToken;
window.clearToken     = clearToken;
window.getUser        = getUser;
window.getCurrentUser = getCurrentUser;
window.setCurrentUser = setCurrentUser;
window.getDebugLog    = getDebugLog;
