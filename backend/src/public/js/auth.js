// Authentication & Session
let authState = {
  token: localStorage.getItem('hd_token') || null,
  user: null,
};

try {
  const savedUser = localStorage.getItem('hd_user');
  if (savedUser) authState.user = JSON.parse(savedUser);
} catch {
  authState.user = null;
}

let currentSetupToken = null;

function getAuthHeaders(withJson = false) {
  const headers = {};
  if (withJson) headers['Content-Type'] = 'application/json';
  if (authState.token) headers['Authorization'] = `Bearer ${authState.token}`;
  return headers;
}

const saveSessionAndRefresh = (token, user) => {
  authState.token = token;
  authState.user = user;
  localStorage.setItem('hd_token', token);
  localStorage.setItem('hd_user', JSON.stringify(user));
  closeModals();
  updateAuthUI();
  if (typeof loadUsers === 'function') loadUsers();
  if (typeof loadMailboxChannels === 'function') loadMailboxChannels();
  if (typeof loadAllTickets === 'function') loadAllTickets();
  if (typeof seedNotificationsIfEmpty === 'function') seedNotificationsIfEmpty();
};

async function verifySession() {
  if (!authState.token) { updateAuthUI(); return; }
  try {
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${authState.token}` } });
    if (res.ok) {
      authState.user = await res.json();
      localStorage.setItem('hd_user', JSON.stringify(authState.user));
    } else {
      logout();
    }
  } catch (e) {
    console.error('Session verification error:', e);
  }
  updateAuthUI();
}

function toggleUserDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('user-dropdown-menu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function closeUserDropdown() {
  const menu = document.getElementById('user-dropdown-menu');
  if (menu) menu.style.display = 'none';
}

function updateAuthUI() {
  const authScreen = document.getElementById('auth-screen');
  const appRoot = document.getElementById('app-root');
  const userArea = document.getElementById('header-user-area');
  const adminNav = document.getElementById('nav-admin-section');
  const dict = I18N[currentLang] || I18N.RU;

  if (authState.user) {
    if (authScreen) authScreen.style.display = 'none';
    if (appRoot) appRoot.style.display = 'flex';

    const isAdmin = authState.user.role === 'admin';
    const initial = (authState.user.name || authState.user.email || 'U').charAt(0).toUpperCase();
    const roleLabel = isAdmin
      ? (currentLang === 'KZ' ? 'Әкімші' : (currentLang === 'EN' ? 'Administrator' : 'Администратор'))
      : authState.user.role;
    if (userArea) {
      userArea.innerHTML = `
        <div class="user-pill-container" id="user-pill-container">
          <div class="user-profile-pill" onclick="toggleUserDropdown(event)" title="${escapeHtml(authState.user.email)}">
            <span class="user-avatar-circle">${initial}</span>
            <div class="user-info-col">
              <span class="user-email-text">${escapeHtml(authState.user.email)}</span>
              <span class="user-role-text">${escapeHtml(roleLabel)}</span>
            </div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <div class="user-dropdown-menu" id="user-dropdown-menu" style="display: none;">
            <div class="user-dropdown-header">
              <div style="font-weight: 700; color: var(--text);">${escapeHtml(authState.user.name || (currentLang === 'KZ' ? 'Маман' : currentLang === 'EN' ? 'Specialist' : 'Сотрудник'))}</div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(authState.user.email)}</div>
              <div style="margin-top: 6px;"><span class="role-tag ${isAdmin ? 'admin' : 'dept'}">${escapeHtml(authState.user.role.toUpperCase())}</span></div>
            </div>
            <div class="user-dropdown-divider"></div>
            ${isAdmin ? `
              <div class="user-dropdown-item" onclick="openAdminModal('staff'); closeUserDropdown();">${dict.staff_and_roles || 'Сотрудники'}</div>
              <div class="user-dropdown-item" onclick="openAdminModal('roles'); closeUserDropdown();">${dict.roles_departments || 'Роли и отделы'}</div>
              <div class="user-dropdown-item" onclick="openAdminModal('mailboxes'); closeUserDropdown();">${dict.mailboxes_and_channels || 'Почтовые ящики'}</div>
              <div class="user-dropdown-divider"></div>
            ` : ''}
            <div class="user-dropdown-item text-danger" onclick="logout(); closeUserDropdown();">${dict.logout || 'Выйти из аккаунта'}</div>
          </div>
        </div>
      `;
    }
    if (adminNav) adminNav.style.display = isAdmin ? 'block' : 'none';
    const btnDelete = document.getElementById('btn-delete-ticket');
    if (btnDelete) btnDelete.style.display = isAdmin ? 'block' : 'none';
  } else {
    if (authScreen) authScreen.style.display = 'flex';
    if (appRoot) appRoot.style.display = 'none';

    if (userArea) userArea.innerHTML = `<button class="btn btn-secondary btn-sm" onclick="openLoginModal()" data-i18n="login">${dict.login || 'Войти'}</button>`;
    if (adminNav) adminNav.style.display = 'none';
    const btnDelete = document.getElementById('btn-delete-ticket');
    if (btnDelete) btnDelete.style.display = 'none';
    if (activeScope === 'my') activeScope = 'all';
  }
  if (typeof updateScopeUI === 'function') updateScopeUI();
}

function updateThemeIcon(isDark) {
  ['theme-toggle-btn', 'auth-theme-toggle-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (isDark) {
      btn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>`;
      btn.title = 'Switch to Light Theme';
    } else {
      btn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>`;
      btn.title = 'Switch to Dark Theme';
    }
  });
}

function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  localStorage.setItem('hd_theme', isDark ? 'dark' : 'light');
  updateThemeIcon(isDark);
}

function logout() {
  localStorage.removeItem('hd_token');
  localStorage.removeItem('hd_user');
  authState.token = null;
  authState.user = null;
  currentSetupToken = null;
  if (typeof allTickets !== 'undefined') allTickets = [];
  if (typeof currentTicketOriginal !== 'undefined') currentTicketOriginal = null;
  activeScope = 'all';

  const emailInput = document.getElementById('auth-page-email');
  const passInput = document.getElementById('auth-page-password');
  const alertBox = document.getElementById('auth-page-alert');
  const submitBtn = document.getElementById('auth-page-submit-btn');
  const btnText = document.getElementById('auth-page-btn-text');
  const dict = I18N[currentLang] || I18N.RU;

  if (emailInput) emailInput.value = '';
  if (passInput) {
    passInput.value = '';
    passInput.placeholder = dict.auth_pass_placeholder || 'Введите пароль';
  }
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.className = 'auth-card-alert';
    alertBox.innerHTML = '';
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.dataset.isSetup = 'false';
  }
  if (btnText) btnText.textContent = dict.login || 'Войти';

  updateAuthUI();
}

function openLoginModal(notice = '') {
  currentSetupToken = null;
  const authScreen = document.getElementById('auth-screen');
  const appRoot = document.getElementById('app-root');
  if (authScreen) authScreen.style.display = 'flex';
  if (appRoot) appRoot.style.display = 'none';

  if (notice) {
    showAuthAlert('info', notice);
  }
  const emailInput = document.getElementById('auth-page-email');
  if (emailInput) {
    emailInput.focus();
  }
}

function showAuthAlert(type, message) {
  const alertBox = document.getElementById('auth-page-alert');
  if (!alertBox) return;
  alertBox.className = `auth-card-alert ${type}`;
  alertBox.innerHTML = message;
  alertBox.style.display = 'flex';
}

async function handleAuthPageSubmit(e) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById('auth-page-email');
  const passInput = document.getElementById('auth-page-password');
  const alertBox = document.getElementById('auth-page-alert');
  const submitBtn = document.getElementById('auth-page-submit-btn');
  const btnText = document.getElementById('auth-page-btn-text');
  const dict = I18N[currentLang] || I18N.RU;

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value : '';

  if (!email) {
    showAuthAlert('error', dict.auth_email_required || 'Пожалуйста, введите логин или email');
    if (emailInput) emailInput.focus();
    return;
  }

  // 1. If currently in first-time password creation mode:
  if (currentSetupToken || (submitBtn && submitBtn.dataset.isSetup === 'true')) {
    if (!password || password.length < 8) {
      showAuthAlert('error', dict.auth_pass_min_chars || 'Пароль должен быть не менее 8 символов');
      if (passInput) passInput.focus();
      return;
    }

    submitBtn.disabled = true;
    if (btnText) btnText.textContent = dict.saving || 'Сохранение...';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentSetupToken) headers['Authorization'] = `Bearer ${currentSetupToken}`;
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          password,
          token: currentSetupToken || undefined
        })
      });
      const data = await res.json();
      submitBtn.disabled = false;

      if (!res.ok) {
        showAuthAlert('error', data.message || 'Ошибка установки пароля');
        if (btnText) btnText.textContent = dict.auth_first_login_btn || 'Создать пароль и войти';
        return;
      }

      currentSetupToken = null;
      submitBtn.dataset.isSetup = 'false';
      saveSessionAndRefresh(data.token, data.user);
      if (typeof showToast === 'function') showToast(dict.welcome_toast || 'Добро пожаловать в систему!');
      return;
    } catch {
      submitBtn.disabled = false;
      if (btnText) btnText.textContent = dict.auth_first_login_btn || 'Создать пароль и войти';
      showAuthAlert('error', 'Ошибка сети при сохранении пароля');
      return;
    }
  }

  // 2. Normal login attempt or initial first-login detection
  submitBtn.disabled = true;
  if (btnText) btnText.textContent = dict.login_checking || 'Проверка...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: password || undefined
      })
    });
    const data = await res.json();
    submitBtn.disabled = false;

    if (!res.ok) {
      if (btnText) btnText.textContent = dict.login || 'Войти';
      if (data && (data.message === 'Password is required' || data.requiresPassword)) {
        showAuthAlert('info', dict.auth_enter_password_hint || 'Введите пароль для входа в аккаунт');
        if (passInput) passInput.focus();
        return;
      }
      showAuthAlert('error', data.message || (dict.auth_error_not_found || 'Неверный логин или пароль'));
      return;
    }

    // First time login detected!
    if (data.requiresPasswordSetup) {
      currentSetupToken = data.token || null;
      submitBtn.dataset.isSetup = 'true';
      if (btnText) btnText.textContent = dict.auth_first_login_btn || 'Создать пароль и войти';
      showAuthAlert('first-login', `
        <strong>${dict.auth_first_login_title || 'Первый вход в систему!'}</strong>
        <span>${dict.auth_first_login_desc || 'Придумайте постоянный пароль (мин. 8 символов) для вашего аккаунта.'}</span>
      `);
      if (passInput) {
        passInput.placeholder = dict.auth_new_pass_placeholder || 'Придумайте новый пароль...';
        passInput.value = '';
        passInput.focus();
      }
      return;
    }

    // Successfully logged in
    if (data.token && data.user) {
      if (btnText) btnText.textContent = dict.login || 'Войти';
      if (alertBox) alertBox.style.display = 'none';
      saveSessionAndRefresh(data.token, data.user);
      if (typeof showToast === 'function') showToast(dict.welcome_toast || 'Добро пожаловать в систему!');
    }
  } catch {
    submitBtn.disabled = false;
    if (btnText) btnText.textContent = dict.login || 'Войти';
    showAuthAlert('error', 'Ошибка подключения к серверу');
  }
}
