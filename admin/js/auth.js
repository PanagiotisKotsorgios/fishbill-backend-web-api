/**
 * FishBill Auth Helpers
 */

function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = 'index.html';
    return false;
  }
  // Check token validity / expiry
  try {
    const user = getUser();
    if (!user) {
      clearToken();
      window.location.href = '401.html';
      return false;
    }
    if (user.exp && user.exp * 1000 < Date.now()) {
      clearToken();
      window.location.href = '401.html';
      return false;
    }
  } catch (e) {
    clearToken();
    window.location.href = '401.html';
    return false;
  }
  return true;
}

function requireRole(...roles) {
  const userRole = getUserRole();
  if (!roles.includes(userRole)) {
    window.location.href = '403.html';
    return false;
  }
  return true;
}

function getUserRole() {
  const user = getCurrentUser();
  return user ? user.role : null;
}

function getBusinessId() {
  const user = getCurrentUser();
  return user ? (user.business_id || user.businessId || null) : null;
}

function getUserName() {
  const user = getCurrentUser();
  return user ? (user.name || user.full_name || 'Χρήστης') : 'Χρήστης';
}

function getUserEmail() {
  const user = getCurrentUser();
  return user ? (user.email || '') : '';
}

function logout() {
  clearToken();
  window.location.href = 'index.html';
}

window.requireAuth  = requireAuth;
window.requireRole  = requireRole;
window.getUserRole  = getUserRole;
window.getBusinessId = getBusinessId;
window.getUserName  = getUserName;
window.getUserEmail = getUserEmail;
window.logout       = logout;
