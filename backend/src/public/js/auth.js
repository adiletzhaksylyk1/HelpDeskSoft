// Authentication & Session
let authState = {
  token: sessionStorage.getItem("hd_token") || null,
  user: null,
};

try {
  const savedUser = sessionStorage.getItem("hd_user");
  if (savedUser) authState.user = JSON.parse(savedUser);
} catch {
  authState.user = null;
}

let currentSetupToken = null;

function getAuthHeaders(withJson = false) {
  const headers = {};
  if (withJson) headers["Content-Type"] = "application/json";
  if (authState.token) headers["Authorization"] = `Bearer ${authState.token}`;
  return headers;
}

const saveSessionAndRefresh = async (token, user) => {
  authState.token = token;
  authState.user = user;
  sessionStorage.setItem("hd_token", token);
  sessionStorage.setItem("hd_user", JSON.stringify(user));
  resetSearchInput();
  closeModals();
  await verifySession();
  initNotifications();
  updateAuthUI();
  if (typeof loadUsers === "function") loadUsers();
  if (typeof loadMailboxChannels === "function") loadMailboxChannels();
  if (typeof loadAllTickets === "function") loadAllTickets();
  const limits = await apiRequest("/api/tickets/limits");
  uploadLimits = limits;
  if (typeof seedNotificationsIfEmpty === "function")
    seedNotificationsIfEmpty();
};

async function verifySession() {
  if (!authState.token) {
    updateAuthUI();
    return;
  }
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${authState.token}` },
    });
    if (res.ok) {
      authState.user = await res.json();
      sessionStorage.setItem("hd_user", JSON.stringify(authState.user));
    } else {
      logout();
    }
  } catch (e) {
    console.error("Session verification error:", e);
  }
  updateAuthUI();
}

function toggleUserDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("user-dropdown-menu");
  if (menu)
    menu.style.display = menu.style.display === "none" ? "flex" : "none";
}

function closeUserDropdown() {
  const menu = document.getElementById("user-dropdown-menu");
  if (menu) menu.style.display = "none";
}

function updateAuthUI() {
  const authScreen = document.getElementById("auth-screen");
  const appRoot = document.getElementById("app-root");
  const userArea = document.getElementById("header-user-area");
  const adminNav = document.getElementById("nav-admin-section");
  const dict = I18N[currentLang] || I18N.RU;

  if (authState.user) {
    if (authScreen) authScreen.style.display = "none";
    if (appRoot) appRoot.style.display = "flex";

    const isAdmin = !!authState.user.isAdmin;
    const initial = (authState.user.name || authState.user.email || "U")
      .charAt(0)
      .toUpperCase();
    const roleLabel = isAdmin
      ? currentLang === "KZ"
        ? "Әкімші"
        : currentLang === "EN"
          ? "Administrator"
          : "Администратор"
      : authState.user.role;
    if (userArea) {
      userArea.innerHTML = `
        <div class="user-pill-container" id="user-pill-container">
          <div class="user-profile-pill" data-ui-click="a85" title="${escapeHtml(authState.user.email)}">
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
              <div style="font-weight: 700; color: var(--text);">${escapeHtml(authState.user.name || (currentLang === "KZ" ? "Маман" : currentLang === "EN" ? "Specialist" : "Сотрудник"))}</div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(authState.user.email)}</div>
              <div style="margin-top: 6px;"><span class="role-tag ${isAdmin ? "admin" : "dept"}">${escapeHtml(authState.user.role.toUpperCase())}</span></div>
            </div>
            <div class="user-dropdown-divider"></div>
            ${
              isAdmin
                ? `
              <div class="user-dropdown-item" data-ui-click="a86">${dict.staff_and_roles || "Сотрудники"}</div>
              <div class="user-dropdown-item" data-ui-click="a87">${dict.roles_departments || "Роли и отделы"}</div>
              <div class="user-dropdown-item" data-ui-click="a88">${dict.mailboxes_and_channels || "Почтовые ящики"}</div>
              <div class="user-dropdown-divider"></div>
            `
                : ""
            }
            <div class="user-dropdown-item text-danger" data-ui-click="a89">${dict.logout || "Выйти из аккаунта"}</div>
          </div>
        </div>
      `;
    }
    if (adminNav) adminNav.style.display = isAdmin ? "block" : "none";
    const btnDelete = document.getElementById("btn-delete-ticket");
    if (btnDelete) btnDelete.style.display = isAdmin ? "block" : "none";
  } else {
    if (authScreen) authScreen.style.display = "flex";
    if (appRoot) appRoot.style.display = "none";

    if (userArea)
      userArea.innerHTML = `<button class="btn btn-secondary btn-sm" data-ui-click="a90" data-i18n="login">${dict.login || "Войти"}</button>`;
    if (adminNav) adminNav.style.display = "none";
    const btnDelete = document.getElementById("btn-delete-ticket");
    if (btnDelete) btnDelete.style.display = "none";
    if (activeScope === "my") activeScope = "all";
  }
  if (typeof updateScopeUI === "function") updateScopeUI();
}

function updateThemeIcon(isDark) {
  ["theme-toggle-btn", "auth-theme-toggle-btn"].forEach((id) => {
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
      btn.title = "Switch to Light Theme";
    } else {
      btn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>`;
      btn.title = "Switch to Dark Theme";
    }
  });
}

function toggleTheme() {
  document.body.classList.toggle("dark-theme");
  const isDark = document.body.classList.contains("dark-theme");
  sessionStorage.setItem("hd_theme", isDark ? "dark" : "light");
  updateThemeIcon(isDark);
}

function logout() {
  if (authState.token)
    fetch("/api/auth/logout", {
      method: "POST",
      headers: getAuthHeaders(),
    }).catch(() => {});
  notifications = [];
  sessionStorage.removeItem("hd_notifications_" + authState.user?.id);
  localStorage.removeItem("hd_token");
  localStorage.removeItem("hd_user");
  sessionStorage.removeItem("hd_notifications");
  localStorage.removeItem("hd_notifications");
  if (typeof ticketDrafts !== "undefined") ticketDrafts.clear();
  if (typeof clearTicketDetail === "function") clearTicketDetail();
  sessionStorage.removeItem("hd_token");
  sessionStorage.removeItem("hd_user");
  authState.token = null;
  authState.user = null;
  currentSetupToken = null;
  if (typeof allTickets !== "undefined") allTickets = [];
  if (typeof currentTicketOriginal !== "undefined")
    currentTicketOriginal = null;
  activeScope = "all";
  resetSearchInput();

  const emailInput = document.getElementById("auth-page-email");
  const passInput = document.getElementById("auth-page-password");
  const alertBox = document.getElementById("auth-page-alert");
  const submitBtn = document.getElementById("auth-page-submit-btn");
  const btnText = document.getElementById("auth-page-btn-text");
  const dict = I18N[currentLang] || I18N.RU;

  if (emailInput) emailInput.value = "";
  if (passInput) {
    passInput.value = "";
    passInput.placeholder = dict.auth_pass_placeholder || "Введите пароль";
  }
  if (alertBox) {
    alertBox.style.display = "none";
    alertBox.className = "auth-card-alert";
    alertBox.innerHTML = "";
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.dataset.isSetup = "false";
  }
  if (btnText) btnText.textContent = dict.login || "Войти";

  updateAuthUI();
}

function openLoginModal(notice = "") {
  currentSetupToken = null;
  const authScreen = document.getElementById("auth-screen");
  const appRoot = document.getElementById("app-root");
  if (authScreen) authScreen.style.display = "flex";
  if (appRoot) appRoot.style.display = "none";

  if (notice) {
    showAuthAlert("info", notice);
  }
  const emailInput = document.getElementById("auth-page-email");
  if (emailInput) {
    emailInput.focus();
  }
}

function updateAuthMode() {
  const isSetup = Boolean(
    document.getElementById("auth-invite-token")?.value.trim(),
  );
  const buttonText = document.getElementById("auth-page-btn-text");
  const password = document.getElementById("auth-page-password");
  const key = isSetup ? "setup_password" : "login";
  if (buttonText) {
    buttonText.dataset.i18n = key;
    buttonText.textContent = t(key);
  }
  if (password) {
    password.autocomplete = isSetup ? "new-password" : "current-password";
    password.dataset.i18nPlaceholder = isSetup
      ? "auth_new_password_placeholder"
      : "auth_pass_placeholder";
    password.placeholder = t(password.dataset.i18nPlaceholder);
  }
}

document
  .getElementById("auth-invite-token")
  ?.addEventListener("input", updateAuthMode);

function showAuthAlert(type, message) {
  const alertBox = document.getElementById("auth-page-alert");
  if (!alertBox) return;
  alertBox.className = `auth-card-alert ${type}`;
  alertBox.textContent = message;
  alertBox.style.display = "flex";
}

async function handleAuthPageSubmit(event) {
  event?.preventDefault();
  const email = document.getElementById("auth-page-email").value.trim();
  const password = document.getElementById("auth-page-password").value;
  const token = document.getElementById("auth-invite-token").value.trim();
  const button = document.getElementById("auth-page-submit-btn");
  button.disabled = true;
  try {
    const response = await fetch(
      token ? "/api/auth/setup-password" : "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(token ? { token } : {}) }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Sign-in failed");
    document.getElementById("auth-invite-token").value = "";
    document.getElementById("auth-page-password").value = "";
    history.replaceState(null, "", location.pathname);
    await saveSessionAndRefresh(data.token, data.user);
  } catch (error) {
    showAuthAlert("error", error.message);
  } finally {
    button.disabled = false;
  }
}
function showInvitation(email, token) {
  const previousFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  const panel = document.createElement("div");
  panel.className = "modal-card";
  panel.style.padding = "24px";
  const title = document.createElement("h2");
  title.textContent = t("invitation_title");
  const info = document.createElement("p");
  info.textContent = t("invitation_info") + " " + email;
  const area = document.createElement("textarea");
  area.readOnly = true;
  area.style.width = "100%";
  area.setAttribute("aria-label", "Invitation link");
  area.value =
    location.origin +
    "/#invite=" +
    encodeURIComponent(token) +
    "&email=" +
    encodeURIComponent(email);
  const close = document.createElement("button");
  close.className = "btn btn-secondary";
  close.textContent = t("close");
  close.addEventListener("click", () => {
    overlay.remove();
    previousFocus?.focus();
  });
  panel.append(title, info, area, close);
  overlay.append(panel);
  document.body.append(overlay);
  area.focus();
  area.select();
}
