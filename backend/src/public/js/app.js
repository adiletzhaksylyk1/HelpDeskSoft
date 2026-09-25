// HelpDesk Core App — Bootstrap, Shared Utilities, Layout & Mobile Navigation

function isMobile() {
  return window.innerWidth < 768;
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024,
    sizes = ["B", "KB", "MB", "GB"],
    i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="10" fill="#12B886"/>
      <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function openLightbox(url, name, dlUrl, ticketId, attId) {
  const modal = document.getElementById("modal-lightbox");
  const img = document.getElementById("lightbox-img");
  const title = document.getElementById("lightbox-title");
  const dl = document.getElementById("lightbox-dl-btn");
  if (!modal || !img) return;
  img.src = url;
  title.textContent = name;
  dl.href = dlUrl || url;
  dl.download = name;
  if (ticketId && attId && typeof downloadAttachmentFile === "function") {
    const safeRawName = (name || "attachment").replace(/['"\\]/g, "");
    dl.onclick = (e) => downloadAttachmentFile(e, ticketId, attId, safeRawName);
  } else {
    dl.onclick = null;
  }
  modal.classList.add("active");
}

function toggleSidebarGroup(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.classList.toggle("collapsed");
  const isCollapsed = group.classList.contains("collapsed");
  try {
    localStorage.setItem(
      `hd_sidebar_${groupId}_collapsed`,
      isCollapsed ? "1" : "0",
    );
  } catch (e) {}
}

function restoreSidebarState() {
  [
    "group-views",
    "group-status",
    "group-priority",
    "nav-channels-section",
    "nav-admin-section",
  ].forEach((id) => {
    try {
      const isCollapsed =
        localStorage.getItem(`hd_sidebar_${id}_collapsed`) === "1";
      const group = document.getElementById(id);
      if (group && isCollapsed) {
        group.classList.add("collapsed");
      }
    } catch (e) {}
  });
}

// Mobile sidebar drawer
function toggleMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains("mobile-open");
  if (isOpen) {
    closeMobileSidebar();
  } else {
    sidebar.classList.add("mobile-open");
    if (backdrop) backdrop.classList.add("mobile-open");
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("mobile-open");
  if (backdrop) backdrop.classList.remove("mobile-open");
}

const closeModals = () => {
  document
    .querySelectorAll(".modal-overlay")
    .forEach((m) => m.classList.remove("active"));
  if (typeof adminModalPollInterval !== "undefined" && adminModalPollInterval) {
    clearInterval(adminModalPollInterval);
    adminModalPollInterval = null;
  }
};

const closeTopModal = () => {
  const modal = [...document.querySelectorAll(".modal-overlay.active")].at(-1);
  if (!modal) return;
  modal.classList.remove("active");
  if (modal.id === "modal-admin" && adminModalPollInterval) {
    clearInterval(adminModalPollInterval);
    adminModalPollInterval = null;
  }
};

// Global click listener for closing popovers and mobile overlays
document.addEventListener("click", (e) => {
  const container = document.getElementById("user-pill-container");
  if (container && !container.contains(e.target)) {
    closeUserDropdown();
  }
  const langContainer = document.getElementById("lang-container");
  const authLangContainer = document.getElementById("auth-lang-container");
  if (
    (!langContainer || !langContainer.contains(e.target)) &&
    (!authLangContainer || !authLangContainer.contains(e.target))
  ) {
    closeLanguageDropdown();
  }
  const notifContainer = document.getElementById("notif-container");
  if (notifContainer && !notifContainer.contains(e.target)) {
    closeNotifications();
  }
  // Mobile sidebar close when tapping outside
  const sidebar = document.getElementById("sidebar");
  const hamburger = document.getElementById("hamburger-btn");
  if (sidebar && sidebar.classList.contains("mobile-open")) {
    if (
      !sidebar.contains(e.target) &&
      (!hamburger || !hamburger.contains(e.target))
    ) {
      closeMobileSidebar();
    }
  }
});

function resetSearchInput() {
  clearTimeout(searchTimer);
  ticketSearchQuery = "";
  ticketPage = 1;
  const sb = document.getElementById("search-bar");
  if (sb) {
    sb.value = "";
    sb.readOnly = document.activeElement !== sb;
  }
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) clearBtn.style.display = "none";
}

function clearSearch() {
  const sb = document.getElementById("search-bar");
  if (sb) {
    sb.value = "";
    const clearBtn = document.getElementById("search-clear-btn");
    if (clearBtn) clearBtn.style.display = "none";
    searchTickets();
    sb.focus();
  }
}

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const themeParam = urlParams.get("theme");
  const isDark =
    themeParam === "dark" ||
    (!themeParam && localStorage.getItem("hd_theme") === "dark");
  if (isDark) {
    document.body.classList.add("dark-theme");
  } else if (themeParam === "light") {
    document.body.classList.remove("dark-theme");
  }
  if (typeof updateThemeIcon === "function") {
    updateThemeIcon(document.body.classList.contains("dark-theme"));
  }

  initLanguage();
  if (urlParams.get("lang")) {
    setLanguage(urlParams.get("lang"));
  }

  handleInvitationLink();
  initNotifications();
  restoreSidebarState();
  if (urlParams.get("collapse")) {
    urlParams
      .get("collapse")
      .split(",")
      .forEach((id) => {
        const g = document.getElementById(
          id.startsWith("group-") || id.startsWith("nav-") ? id : `group-${id}`,
        );
        if (g) g.classList.add("collapsed");
      });
  }

  resetSearchInput();
  const searchInput = document.getElementById("search-bar");
  searchInput.addEventListener("focus", () => {
    searchInput.value = ticketSearchQuery;
    searchInput.readOnly = false;
  });
  searchInput.addEventListener("blur", () => {
    searchInput.readOnly = true;
    searchInput.value = ticketSearchQuery;
  });
  await verifySession();
  if (authState.user) {
    await loadUsers();
    await loadMailboxChannels();
    await loadAllTickets();
    const limits = await apiFetch("/api/tickets/limits", {
      headers: getAuthHeaders(),
    });
    if (limits.ok) uploadLimits = await limits.json();
    seedNotificationsIfEmpty();
  }

  if (urlParams.get("openNotif")) {
    setTimeout(() => toggleNotifications(), 600);
  }
  if (urlParams.get("openSidebar")) {
    setTimeout(() => toggleMobileSidebar(), 600);
  }
}

window.onload = init;
function handleInvitationLink() {
  const invitation = new URLSearchParams(location.hash.slice(1));
  if (!invitation.has("invite")) return;
  sessionStorage.removeItem("hd_token");
  sessionStorage.removeItem("hd_user");
  authState = { token: null, user: null };
  ticketListRequest++;
  ticketDetailRequest++;
  ticketDrafts.clear();
  clearTicketDetail();
  notifications = [];
  allTickets = [];
  document.getElementById("auth-invite-token").value = invitation.get("invite");
  document.getElementById("auth-page-email").value =
    invitation.get("email") || "";
  updateAuthMode();
  history.replaceState(null, "", location.pathname);
  updateAuthUI();
}
window.addEventListener("hashchange", handleInvitationLink);
setInterval(() => {
  if (authState.token && !document.hidden) loadAllTickets();
}, 30000);
