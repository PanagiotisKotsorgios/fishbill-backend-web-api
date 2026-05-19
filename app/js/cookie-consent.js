/**
 * FishBill — GDPR Cookie Consent Banner
 * Auto-initialises on DOMContentLoaded.
 * Stores consent in localStorage under key "fishbill_cookie_consent".
 */
(function () {
  'use strict';

  const CONSENT_KEY = 'fishbill_cookie_consent';
  const CONSENT_VER = '1'; // bump this to re-show the banner after policy updates

  function hasConsent() {
    try {
      const val = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      return val && val.version === CONSENT_VER;
    } catch { return false; }
  }

  function saveConsent(accepted) {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({
      version:  CONSENT_VER,
      accepted,
      date: new Date().toISOString(),
    }));
  }

  function dismiss(accepted) {
    saveConsent(accepted);
    const banner = document.getElementById('fishbill-cookie-banner');
    if (banner) {
      banner.style.transition = 'opacity .3s ease, transform .3s ease';
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(16px)';
      setTimeout(() => banner.remove(), 350);
    }
  }

  function injectBanner() {
    if (hasConsent()) return;
    if (document.getElementById('fishbill-cookie-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'fishbill-cookie-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Συγκατάθεση cookies');
    banner.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#1e293b', 'color:#f1f5f9',
      'padding:16px 20px', 'display:flex', 'flex-wrap:wrap',
      'align-items:center', 'gap:12px',
      'font-family:Inter,system-ui,sans-serif', 'font-size:13px',
      'box-shadow:0 -4px 24px rgba(0,0,0,.25)',
    ].join(';');

    banner.innerHTML = `
      <div style="flex:1;min-width:260px;line-height:1.55">
        🍪 Χρησιμοποιούμε cookies αναγκαίας λειτουργίας για τη σύνδεση και ασφάλεια της εφαρμογής.
        <a href="/fishbill/app/privacy.html" target="_blank"
           style="color:#38bdf8;text-decoration:underline;white-space:nowrap">
          Πολιτική Απορρήτου
        </a>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button id="fb-cookie-decline"
          style="background:transparent;border:1px solid #475569;color:#94a3b8;
                 border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;
                 font-family:inherit">
          Απόρριψη
        </button>
        <button id="fb-cookie-accept"
          style="background:#0A5568;border:none;color:#fff;
                 border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;
                 font-weight:600;font-family:inherit">
          Αποδοχή
        </button>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('fb-cookie-accept').addEventListener('click', () => dismiss(true));
    document.getElementById('fb-cookie-decline').addEventListener('click', () => dismiss(false));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBanner);
  } else {
    injectBanner();
  }
})();
