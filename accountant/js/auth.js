function requireAuth() {
  const t = getToken();
  if (!t) { window.location.href = '/fishbill/accountant/index.html'; return false; }
  try {
    const u = getUser();
    if (!u || (u.exp && u.exp * 1000 < Date.now())) {
      clearToken();
      window.location.href = '/fishbill/accountant/index.html';
      return false;
    }
    if (!['accountant', 'super_admin'].includes(u.role)) {
      clearToken();
      window.location.href = '/fishbill/accountant/index.html';
      return false;
    }
  } catch (e) {
    clearToken();
    window.location.href = '/fishbill/accountant/index.html';
    return false;
  }
  return true;
}

function logout() {
  clearToken();
  window.location.href = '/fishbill/accountant/index.html';
}

window.requireAuth = requireAuth;
window.logout      = logout;
