// Renders the shared sidebar/topbar for authenticated pages.
// Distinct from the FishBill admin — different structure, colors, icons.

function requireLogin() {
  if (!getToken()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

function renderShell(activePath) {
  const user = getCurrentUser() || {};
  const nav = [
    { path: 'dashboard.html',    label: 'Επισκόπηση',    icon: '📊' },
    { path: 'users.html',        label: 'Χρήστες',       icon: '👤' },
    { path: 'businesses.html',   label: 'Επιχειρήσεις',  icon: '🌾' },
    { path: 'invoices.html',     label: 'Τιμολόγια',     icon: '📄' },
    { path: 'subscriptions.html', label: 'Συνδρομές',    icon: '💳' },
  ];
  const items = nav.map(n => `
    <a href="${n.path}" class="nav-item ${n.path === activePath ? 'active' : ''}">
      <span class="nav-icon">${n.icon}</span>
      <span>${n.label}</span>
    </a>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <aside class="sidebar">
      <div class="brand">
        <svg viewBox="0 0 108 108" width="44" height="44">
          <path d="M 36,85.18 A 36,36 0 0,1 72,22.82" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
          <path d="M 85.18,36 A 36,36 0 0,1 22.82,72" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
          <path d="M 80.66,27.82 L 75,17.62 L 69,28 Z" fill="#fff"/>
          <path d="M 14.16,67 L 19.82,77.2 L 25.82,66.8 Z" fill="#fff"/>
          <path d="M 50,55 C 42,44 32,32 32,30 C 36,36 44,50 50,55 Z" fill="#fff"/>
          <path d="M 58,55 C 66,44 76,32 76,30 C 72,36 64,50 58,55 Z" fill="#fff"/>
          <path d="M 54,76 L 54,60" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round"/>
        </svg>
        <div>
          <div class="brand-name">Αγρότης</div>
          <div class="brand-tag">Superadmin · Staging</div>
        </div>
      </div>
      <nav>${items}</nav>
      <div class="sidebar-footer">
        <div class="who">${user.name || 'Άγνωστος'}<br><span>${user.email || ''}</span></div>
        <button onclick="clearToken(); location.href='index.html';">Αποσύνδεση</button>
      </div>
    </aside>
    <main class="content"></main>
  `);
}

window.requireLogin = requireLogin;
window.renderShell  = renderShell;
