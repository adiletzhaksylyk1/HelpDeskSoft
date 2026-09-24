// Notifications System
let notifications = [];

function initNotifications() {
  notifications = [];
  try {
    const saved = sessionStorage.getItem(
      "hd_notifications_" + (authState.user?.id || "signed-out"),
    );
    if (saved) notifications = JSON.parse(saved);
  } catch {
    notifications = [];
  }
  updateNotificationsUI();
}

function saveNotifications() {
  sessionStorage.setItem(
    "hd_notifications_" + (authState.user?.id || "signed-out"),
    JSON.stringify(notifications),
  );
  updateNotificationsUI();
}

function seedNotificationsIfEmpty() {
  /* Only actual activity is recorded. */
}

function addNotification(notif) {
  const item = {
    id: "notif_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
    ticketId: notif.ticketId || null,
    ticketNumber:
      notif.ticketNumber ||
      (notif.ticketId ? notif.ticketId.slice(0, 8) : null),
    titleKey: notif.titleKey || null,
    title: notif.title || null,
    messageKey: notif.messageKey || null,
    message: notif.message || "",
    time: new Date().toISOString(),
    read: false,
    type: notif.type || "info",
  };
  notifications.unshift(item);
  if (notifications.length > 30) notifications = notifications.slice(0, 30);
  saveNotifications();
}

function updateNotificationsUI() {
  const unreadCount = notifications.filter((n) => !n.read).length;
  const countBadge = document.getElementById("notif-unread-count");
  const bellDot = document.getElementById("notif-bell-dot");
  if (countBadge) countBadge.textContent = unreadCount;
  if (bellDot) bellDot.style.display = unreadCount > 0 ? "block" : "none";
  renderNotificationsList();
}

function getLocalizedNotifTitle(n, dict) {
  if (n.titleKey && dict[n.titleKey]) return dict[n.titleKey];
  // Auto-translate legacy stored Russian strings
  const legacyMap = {
    "Заявка обновлена": dict.notif_ticket_updated || "Ticket updated",
    "Тикет обновлен": dict.notif_ticket_updated || "Ticket updated",
    "Ответ отправлен": dict.notif_reply_sent || "Reply sent",
    "Новое обращение": dict.notif_new_ticket || "New ticket",
    "Жаңа өтінім": dict.notif_new_ticket || "New ticket",
    "Поступило срочное обращение":
      dict.notif_urgent_ticket || "Urgent ticket received",
    "Шұғыл өтінім келіп түсті":
      dict.notif_urgent_ticket || "Urgent ticket received",
    "Өтінім жаңартылды": dict.notif_ticket_updated || "Ticket updated",
    "Жауап жіберілді": dict.notif_reply_sent || "Reply sent",
  };
  if (n.title && legacyMap[n.title]) return legacyMap[n.title];
  return n.title || dict.notif_title || "Notification";
}

function getLocalizedNotifMessage(n, dict) {
  if (n.messageKey && dict[n.messageKey]) {
    let msg = dict[n.messageKey];
    if (n.ticketNumber) msg += `: #${n.ticketNumber}`;
    return msg;
  }
  // Auto-translate legacy stored descriptions
  if (typeof n.message === "string") {
    let msg = n.message;
    if (
      msg.includes("Изменения сохранены") ||
      msg.includes("Өтінім өзгерістері сақталды") ||
      msg.includes("Ticket changes saved")
    ) {
      const idMatch = msg.match(/#([a-zA-Z0-9_-]+)/);
      return `${dict.notif_changes_saved_desc || "Changes saved"}${idMatch ? ": #" + idMatch[1] : ""}`;
    }
    if (
      msg.includes("Ответ отправлен заявителю") ||
      msg.includes("Өтініш берушіге жауап жіберілді") ||
      msg.includes("Reply dispatched")
    ) {
      const idMatch = msg.match(/#([a-zA-Z0-9_-]+)/);
      return `${dict.notif_reply_dispatched_desc || "Reply dispatched to customer"}${idMatch ? ": #" + idMatch[1] : ""}`;
    }
    if (msg.includes("Без темы")) {
      msg = msg.replace("Без темы", dict.notif_no_subject || "No subject");
    }
    if (msg.includes("клиент")) {
      msg = msg.replace("клиент", dict.notif_customer || "customer");
    }
    return msg;
  }
  return "";
}

function getNotificationSvgIcon(type) {
  switch (type) {
    case "ticket":
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>`;
    case "reply":
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
    case "warning":
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    case "success":
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    default:
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
}

function renderNotificationsList() {
  const container = document.getElementById("notif-items-list");
  if (!container) return;
  const dict = I18N[currentLang] || I18N.RU;

  if (!notifications || notifications.length === 0) {
    container.innerHTML = `
      <div class="notif-empty-state">
        <div style="font-size: 28px; margin-bottom: 6px;">🔔</div>
        <div style="font-weight: 600; font-size: 13px; color: var(--text);">${dict.notif_empty || "Нет новых уведомлений"}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = notifications
    .map((n) => {
      const iconSvg = getNotificationSvgIcon(n.type || "info");
      const dateObj = new Date(n.time);
      const timeStr = isNaN(dateObj.getTime())
        ? ""
        : dateObj.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
      const localizedTitle = getLocalizedNotifTitle(n, dict);
      const localizedMessage = getLocalizedNotifMessage(n, dict);

      return `
      <div class="notif-item ${n.read ? "read" : "unread"}" data-ui-click="a105" data-ui-args="${escapeHtml(JSON.stringify([n.id]))}">
        <div class="notif-item-icon notif-icon-${n.type || "info"}">${iconSvg}</div>
        <div class="notif-item-content">
          <div class="notif-item-title">${escapeHtml(localizedTitle)}</div>
          <div class="notif-item-desc">${escapeHtml(localizedMessage)}</div>
          <div class="notif-item-time">${timeStr}</div>
        </div>
        ${!n.read ? '<div class="notif-unread-dot"></div>' : ""}
      </div>
    `;
    })
    .join("");
}

function handleNotificationClick(notifId) {
  const notif = notifications.find((n) => n.id === notifId);
  if (notif) {
    notif.read = true;
    saveNotifications();
    if (notif.ticketId && typeof selectTicket === "function") {
      selectTicket(notif.ticketId);
    }
  }
  closeNotifications();
}

function markAllNotificationsRead() {
  notifications.forEach((n) => {
    n.read = true;
  });
  saveNotifications();
}

function clearAllNotifications() {
  notifications = [];
  saveNotifications();
}

function toggleNotifications(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById("notif-popover");
  if (!popover) return;
  const isHidden = popover.style.display === "none" || !popover.style.display;
  if (isHidden) {
    if (typeof closeLanguageDropdown === "function") closeLanguageDropdown();
    if (typeof closeUserDropdown === "function") closeUserDropdown();
    popover.style.display = "flex";
  } else {
    popover.style.display = "none";
  }
}

function closeNotifications() {
  const popover = document.getElementById("notif-popover");
  if (popover) popover.style.display = "none";
}
