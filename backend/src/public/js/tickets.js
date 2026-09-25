// Tickets Module — Filtering, Rendering, Detail View, Replies & Attachments

let ticketPage = 1,
  ticketTotalPages = 1,
  ticketListRequest = 0,
  ticketDetailRequest = 0;
let ticketStats = { total: 0, groups: [] };
const ticketDrafts = new Map();
let attachmentBlobUrls = [];
let uploadLimits = {
  maxAttachmentBytes: 10485760,
  maxMessageBytes: 26214400,
  maxAttachments: 20,
};
let searchTimer;
let ticketSearchQuery = "";
function searchTickets(event) {
  const input = document.getElementById("search-bar");
  // Credential autofill must not become a ticket filter, even if it fires input.
  if (
    event &&
    (document.activeElement !== input || input.matches(":autofill"))
  ) {
    input.value = ticketSearchQuery;
    return;
  }
  ticketSearchQuery = input?.value || "";
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    ticketPage = 1;
    loadAllTickets();
  }, 250);
}
function saveDraft() {
  if (selectedTicketId)
    ticketDrafts.set(selectedTicketId, {
      ...ticketDrafts.get(selectedTicketId),
      text: document.getElementById("reply-text")?.value || "",
      files: [...selectedReplyFiles],
      pending: { ...pendingChanges },
      original: currentTicketOriginal ? { ...currentTicketOriginal } : null,
      mailbox: document.getElementById("reply-mailbox-select")?.value,
    });
}
function showTicketError(message) {
  const el = document.getElementById("ticket-error");
  if (el) {
    el.textContent = message;
    el.hidden = !message;
  }
}
let allTickets = [];
let displayedTickets = [];
let selectedTicketId = null;
let activeFilters = { status: "", priority: "", mailbox: "" };
let activeScope = "all";

let currentTicketOriginal = null;
let pendingChanges = {};
let selectedReplyFiles = [];
let collisionPollerTimer = null;
let lastKnownReplyCount = 0;
let collisionDetected = false;

function updateAssigneeBanner(ticket) {
  const banner = document.getElementById("d-assignee-banner");
  if (!banner) return;
  const dict = I18N[currentLang] || I18N.RU;

  if (
    ticket &&
    ticket.assigneeId &&
    authState.user &&
    ticket.assigneeId !== authState.user.id
  ) {
    const assignedUser = users.find((u) => u.id === ticket.assigneeId);
    const assigneeName = ticket.assignee
      ? ticket.assignee.name
      : assignedUser
        ? assignedUser.name
        : "Коллега";
    banner.innerHTML = `<span>${dict.collision_assigned_warning || "Внимание: Заявка закреплена за специалистом: "}<strong>${escapeHtml(assigneeName)}</strong></span>`;
    banner.style.display = "flex";
  } else {
    banner.style.display = "none";
  }
}

function renderReplyCard(reply, ticketId, senderEmail) {
  const card = document.createElement("div");
  card.className =
    "msg-card" + (reply.senderType === "EMPLOYEE" ? " msg-employee" : "");
  card.dataset.replyId = reply.id;
  const header = document.createElement("div");
  header.className = "msg-header";
  const author = document.createElement("span");
  author.textContent = reply.authorName || senderEmail || reply.senderType;
  const state = document.createElement("span");
  state.className = "msg-badge";
  state.textContent = t("delivery_" + reply.deliveryStatus);
  const time = document.createElement("time");
  time.textContent = new Date(reply.createdAt).toLocaleString();
  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = formatMessageBody(reply.body);
  header.append(author, state, time);
  card.append(header, body);
  if (reply.deliveryError) {
    const error = document.createElement("p");
    error.textContent = reply.deliveryError;
    card.append(error);
  }
  if (["failed", "uncertain"].includes(reply.deliveryStatus)) {
    const retry = document.createElement("button");
    retry.className = "btn btn-secondary";
    retry.textContent = t("retry_delivery");
    retry.addEventListener("click", async () => {
      const uncertain = reply.deliveryStatus === "uncertain";
      if (!confirm(t(uncertain ? "retry_uncertain" : "retry_confirm"))) return;
      retry.disabled = true;
      try {
        await apiRequest(
          "/api/tickets/" + ticketId + "/replies/" + reply.id + "/retry",
          {
            method: "POST",
            body: JSON.stringify({ confirmPossibleDuplicate: uncertain }),
          },
        );
        card.replaceWith(
          renderReplyCard(
            { ...reply, deliveryStatus: "pending", deliveryError: null },
            ticketId,
            senderEmail,
          ),
        );
      } catch (error) {
        showTicketError(error.message);
        retry.disabled = false;
      }
    });
    card.append(retry);
  }
  return card;
}
function startCollisionPoller(ticketId) {
  if (collisionPollerTimer) clearInterval(collisionPollerTimer);
  collisionPollerTimer = setInterval(async () => {
    if (selectedTicketId !== ticketId || document.hidden) return;
    try {
      const updated = await apiRequest("/api/tickets/" + ticketId);
      if (selectedTicketId !== ticketId) return;
      const thread = document.getElementById("d-thread");
      for (const reply of updated.replies || []) {
        const old = thread.querySelector('[data-reply-id="' + reply.id + '"]');
        if (old)
          old.replaceWith(
            renderReplyCard(reply, ticketId, updated.senderEmail),
          );
      }
      if (updated.replyCount > lastKnownReplyCount) {
        const newer = await apiRequest(
          "/api/tickets/" +
            ticketId +
            "/replies?offset=" +
            lastKnownReplyCount +
            "&limit=100",
        );
        if (selectedTicketId !== ticketId) return;
        for (const reply of newer)
          if (!thread.querySelector('[data-reply-id="' + reply.id + '"]'))
            thread.append(
              renderReplyCard(reply, ticketId, updated.senderEmail),
            );
        lastKnownReplyCount += newer.length;
        const banner = document.getElementById("d-collision-banner");
        banner.textContent = t("conversation_updated");
        banner.style.display = "flex";
        await loadTicketAttachments(ticketId);
      }
      updateAssigneeBanner(updated);
      if (!Object.keys(pendingChanges).length && currentTicketOriginal) {
        currentTicketOriginal = {
          id: updated.id,
          version: updated.version,
          status: updated.status,
          priority: updated.priority,
          assigneeId: updated.assigneeId || "",
        };
        document.getElementById("d-status-select").value = updated.status;
        document.getElementById("d-priority-select").value = updated.priority;
        document.getElementById("d-assignee-select").value =
          updated.assigneeId || "";
      }
    } catch (error) {
      showTicketError(t("refresh_failed"));
    }
  }, 7000);
}

async function loadAllTickets() {
  if (!authState.token) return;
  const request = ++ticketListRequest;
  const query = new URLSearchParams({ page: String(ticketPage), limit: "30" });
  const scope = new URLSearchParams();
  if (activeScope === "my") scope.set("my_tickets", "true");
  if (activeScope === "unassigned") scope.set("assignee", "unassigned");
  for (const [key, value] of scope) query.set(key, value);
  if (activeFilters.status) query.set("status", activeFilters.status);
  if (activeFilters.priority) query.set("priority", activeFilters.priority);
  if (activeFilters.mailbox) {
    const mb = mailboxChannels.find(
      (m) =>
        m.email === activeFilters.mailbox || m.id === activeFilters.mailbox,
    );
    if (mb) query.set("mailbox_id", mb.id);
  }
  const searchInput = document.getElementById("search-bar");
  if (searchInput) searchInput.value = ticketSearchQuery;
  const search = ticketSearchQuery.trim();
  if (search) query.set("search", search);
  try {
    const [res, stats] = await Promise.all([
      apiFetch("/api/tickets?" + query, { headers: getAuthHeaders() }),
      apiFetch("/api/tickets/stats?" + scope, { headers: getAuthHeaders() }),
    ]);
    if (!res.ok)
      throw new Error((await res.json()).message || "Unable to load tickets");
    const data = validateTicketPage(await res.json());
    if (request !== ticketListRequest) return;
    allTickets = data.data;
    displayedTickets = allTickets;
    ticketTotalPages = data.totalPages;
    if (stats.ok) ticketStats = await stats.json();
    if (ticketPage > ticketTotalPages) {
      ticketPage = ticketTotalPages;
      return loadAllTickets();
    }
    showTicketError("");
    updateCounters();
    renderTicketList();
    const page = document.getElementById("ticket-page");
    if (page)
      page.textContent =
        ticketPage + " / " + ticketTotalPages + " (" + data.total + ")";
    document.getElementById("ticket-prev").disabled = ticketPage <= 1;
    document.getElementById("ticket-next").disabled =
      ticketPage >= ticketTotalPages;
  } catch (error) {
    if (request === ticketListRequest) showTicketError(error.message);
  }
}
function changeTicketPage(delta) {
  ticketPage = Math.max(1, Math.min(ticketTotalPages, ticketPage + delta));
  loadAllTickets();
}

function setScope(scope) {
  if (scope === "my" && !authState.user) {
    openLoginModal(
      "Please log in with your corporate account to view assigned tickets",
    );
    return;
  }
  activeScope = scope;
  ticketPage = 1;
  updateScopeUI();
  loadAllTickets();
}

function updateScopeUI() {
  document
    .querySelectorAll(".scope-nav-item")
    .forEach((el) => el.classList.remove("active"));
  const target = document.getElementById(`scope-${activeScope}`);
  if (target) target.classList.add("active");
}

function updateCounters() {
  const count = (key, value) =>
    ticketStats.groups
      .filter((g) => g[key] === value)
      .reduce((n, g) => n + Number(g.total), 0);
  ["waiting", "progress", "resolved"].forEach((s) => {
    const el = document.getElementById(`cnt-${s}`);
    if (el)
      el.textContent = count(
        "status",
        s === "progress" ? "IN_PROGRESS" : s.toUpperCase(),
      );
  });
  ["critical", "high", "medium", "low"].forEach((p) => {
    const el = document.getElementById(`cnt-${p}`);
    if (el) el.textContent = count("priority", p.toUpperCase());
  });
  const cntAll = document.getElementById("cnt-all");
  if (cntAll) cntAll.textContent = ticketStats.total;
  const cntAllStatus = document.getElementById("cnt-all-status");
  if (cntAllStatus) cntAllStatus.textContent = ticketStats.total;
  const cntPAll = document.getElementById("cnt-p-all");
  if (cntPAll) cntPAll.textContent = ticketStats.total;
  if (typeof updateMailboxCounters === "function") updateMailboxCounters();
}

function setFilter(type, value) {
  activeFilters[type] = value;

  if (type === "status") {
    document
      .querySelectorAll(".status-filter-group .nav-item")
      .forEach((el) => el.classList.remove("active"));
    const statusId =
      activeFilters.status === ""
        ? "filter-all"
        : `filter-${activeFilters.status.toLowerCase().replace("_", "-")}`;
    const statusEl = document.getElementById(statusId);
    if (statusEl) statusEl.classList.add("active");
  }

  if (type === "priority") {
    document
      .querySelectorAll(".priority-filter-group .nav-item")
      .forEach((el) => el.classList.remove("active"));
    const priorityId =
      activeFilters.priority === ""
        ? "filter-p-all"
        : `filter-${activeFilters.priority.toLowerCase()}`;
    const priorityEl = document.getElementById(priorityId);
    if (priorityEl) priorityEl.classList.add("active");
  }

  if (type === "mailbox") {
    document
      .querySelectorAll(".channels-filter-group .nav-item")
      .forEach((el) => el.classList.remove("active"));
    if (value === "") {
      const allEl = document.getElementById("filter-mb-all");
      if (allEl) allEl.classList.add("active");
    } else {
      const found = mailboxChannels.find((m) => m.email === value);
      if (found) {
        const mbEl = document.getElementById(`filter-mb-${found.id}`);
        if (mbEl) mbEl.classList.add("active");
      }
    }
  }

  ticketPage = 1;
  loadAllTickets();
}

function applyFiltersAndRender() {
  displayedTickets = allTickets;
  renderTicketList();
}

function clearTicketDetail() {
  if (collisionPollerTimer) {
    clearInterval(collisionPollerTimer);
    collisionPollerTimer = null;
  }
  saveDraft();
  selectedTicketId = null;
  currentTicketOriginal = null;
  pendingChanges = {};
  const content = document.getElementById("ticket-content");
  if (content) content.style.display = "none";
  const emptyState = document.getElementById("empty-state");
  if (emptyState) emptyState.style.display = "flex";
  const appBody = document.querySelector(".app-body");
  if (appBody) appBody.classList.remove("ticket-view-open");
  renderTicketList();
}

function renderTicketList() {
  const container = document.getElementById("ticket-items-container");
  if (!container) return;
  const search = ticketSearchQuery.trim();
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) clearBtn.style.display = search.length > 0 ? "flex" : "none";

  const filtered = displayedTickets;

  container.innerHTML = "";
  if (filtered.length === 0) {
    container.innerHTML =
      '<div style="padding: 28px; text-align: center; color: var(--text-subtle); font-size: 13px;">No tickets match your filters</div>';
    return;
  }

  filtered.forEach((t) => {
    const card = document.createElement("div");
    card.className = `ticket-card ${selectedTicketId === t.id ? "selected" : ""}`;
    card.onclick = () => selectTicket(t.id);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectTicket(t.id);
      }
    };

    const dict = I18N[currentLang] || I18N.RU;
    const statusClass = `badge-${(t.status || "waiting").toLowerCase()}`;
    const priorityClass = `badge-priority-${(t.priority || "medium").toLowerCase()}`;
    const statusMap = {
      WAITING: dict.status_waiting || "В ожидании",
      IN_PROGRESS: dict.status_in_progress || "В работе",
      RESOLVED: dict.status_resolved || "Решена",
    };
    const priorityMap = {
      LOW: dict.priority_low || "Низкий",
      MEDIUM: dict.priority_medium || "Средний",
      HIGH: dict.priority_high || "Высокий",
      CRITICAL: dict.priority_critical || "Критический",
    };
    const statusText = statusMap[t.status] || t.status;
    const priorityText = priorityMap[t.priority] || t.priority;
    const assigneeName = t.assignee
      ? t.assignee.name
      : dict.unassigned || "(Не назначен)";
    const dateStr = new Date(t.updatedAt || t.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const latestPreview = t.latestReplyBody || t.body;
    const latestBy = t.latestReplyBody
      ? t.latestReplySenderType === "EMPLOYEE"
        ? (dict.reply_from_support || "Поддержка") + ": "
        : (dict.reply_from_customer || "Клиент") + ": "
      : "";

    card.innerHTML = `
      <div class="card-meta-top">
        <span class="card-sender-email" title="${escapeHtml(t.senderEmail)}">${escapeHtml(t.senderEmail)}</span>
        <span>${dateStr}</span>
      </div>
      <div class="card-title">${escapeHtml(t.subject)}${t.replyCount ? ` <span class="badge">${t.replyCount + 1}</span>` : ""}</div>
      <div class="card-preview">${escapeHtml(latestBy + latestPreview)}</div>
      <div class="card-badges">
        <span class="badge ${statusClass}">${escapeHtml(statusText)}</span>
        <span class="badge ${priorityClass}">● ${escapeHtml(priorityText)}</span>
        ${t.recipientEmail ? `<span class="badge badge-channel" title="Received on ${escapeHtml(t.recipientEmail)}">${escapeHtml(t.recipientEmail)}</span>` : ""}
        <span style="margin-left: auto; font-size: 11px; color: var(--text-subtle);">${escapeHtml(assigneeName)}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function formatMessageBody(text) {
  if (!text) return "";
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/(?:(?!&lt;|&gt;)[^\s<>'"])+)/gi,
    (match) => {
      let clean = match;
      let trailing = "";
      const m = clean.match(/([.,;!?:)]+)$/);
      if (m) {
        trailing = m[1];
        clean = clean.slice(0, -trailing.length);
      }
      const href = clean.replace(/&amp;/g, "&");
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="msg-link">${clean}</a>${trailing}`;
    },
  );
}

async function selectTicket(id, scrollToBottom = false, openMobileView = true) {
  const request = ++ticketDetailRequest;
  if (selectedTicketId !== id) saveDraft();
  selectedTicketId = id;
  const draft = ticketDrafts.get(id);
  selectedReplyFiles =
    draft?.files ||
    (currentTicketOriginal?.id === id ? selectedReplyFiles : []);
  document.getElementById("reply-text").value =
    draft?.text ||
    (currentTicketOriginal?.id === id
      ? document.getElementById("reply-text").value
      : "");
  const fileInput = document.getElementById("reply-file-input");
  if (fileInput) fileInput.value = "";
  renderReplyFilesPreview();
  renderTicketList();

  // Mobile: Switch view to full-screen ticket detail only if explicitly requested
  const appBody = document.querySelector(".app-body");
  if (openMobileView && appBody) {
    appBody.classList.add("ticket-view-open");
  }

  const emptyState = document.getElementById("empty-state");
  if (emptyState) emptyState.style.display = "none";
  const content = document.getElementById("ticket-content");
  if (content) content.style.display = "flex";

  try {
    const res = await apiFetch(`/api/tickets/${id}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const message =
        res.status === 404 ? t("ticket_not_found") : t("ticket_load_failed");
      throw new Error(`${message} (HTTP ${res.status})`);
    }
    const ticket = await res.json();
    if (request !== ticketDetailRequest || selectedTicketId !== id) return;
    showTicketError("");

    const dSubject = document.getElementById("d-subject");
    if (dSubject) dSubject.textContent = ticket.subject;
    const breadcrumb = document.getElementById("d-breadcrumb-subject");
    if (breadcrumb) breadcrumb.textContent = ticket.subject || "Обращение";

    const metaSender = document.getElementById("d-meta-sender");
    if (metaSender) metaSender.textContent = ticket.senderEmail || "—";

    const metaDate = document.getElementById("d-meta-date");
    if (metaDate)
      metaDate.textContent = new Date(ticket.createdAt).toLocaleDateString();

    const channelBadge = document.getElementById("d-channel-badge");
    if (channelBadge) {
      if (ticket.recipientEmail) {
        channelBadge.style.display = "inline-flex";
        channelBadge.textContent = `${ticket.recipientEmail}`;
        channelBadge.title = `Inbound mailbox: ${ticket.recipientEmail}`;
      } else {
        channelBadge.style.display = "none";
      }
    }
    const dStatus = document.getElementById("d-status-select");
    if (dStatus) dStatus.value = ticket.status;
    const dPriority = document.getElementById("d-priority-select");
    if (dPriority) dPriority.value = ticket.priority;
    const dAssignee = document.getElementById("d-assignee-select");
    if (dAssignee) dAssignee.value = ticket.assigneeId || "";

    currentTicketOriginal = {
      id: ticket.id,
      version: ticket.version,
      status: ticket.status,
      priority: ticket.priority,
      assigneeId: ticket.assigneeId || "",
    };
    if (draft?.original && Object.keys(draft.pending || {}).length)
      currentTicketOriginal = draft.original;
    pendingChanges = draft?.pending || {};
    for (const [key, value] of Object.entries(pendingChanges)) {
      const control = document.getElementById(
        key === "assignee_id" ? "d-assignee-select" : "d-" + key + "-select",
      );
      if (control) control.value = value || "";
    }
    updateSaveButtonState();
    updateAuthUI();

    lastKnownReplyCount = ticket.replyCount ?? (ticket.replies || []).length;
    collisionDetected = false;
    const colBanner = document.getElementById("d-collision-banner");
    if (colBanner) colBanner.style.display = "none";

    updateAssigneeBanner(ticket);
    startCollisionPoller(id);

    const thread = document.getElementById("d-thread");
    if (thread) {
      thread.innerHTML = "";

      const origMsg = document.createElement("div");
      origMsg.className = "msg-card msg-initial";
      origMsg.innerHTML = `
        <div class="msg-header">
          <div class="msg-author">
            <span class="msg-author-email">${escapeHtml(ticket.senderEmail)}</span>
            <span class="msg-badge msg-badge-cust">CUSTOMER</span>
            ${ticket.recipientEmail ? `<span class="badge badge-channel">В ящик: ${escapeHtml(ticket.recipientEmail)}</span>` : ""}
          </div>
          <div class="msg-time">${new Date(ticket.createdAt).toLocaleString()}</div>
        </div>
        <div class="msg-body">${formatMessageBody(ticket.body)}</div>
      `;
      thread.appendChild(origMsg);

      const replies = ticket.replies || [];
      replies.forEach((rep) =>
        thread.append(renderReplyCard(rep, id, ticket.senderEmail)),
      );

      if (scrollToBottom && replies.length > 0) {
        thread.scrollTop = thread.scrollHeight;
      } else {
        thread.scrollTop = 0;
      }
    }

    loadTicketAttachments(id);
    if ((ticket.replies || []).length < ticket.replyCount) {
      const more = document.createElement("button");
      more.className = "btn btn-secondary";
      more.textContent = t("load_more_replies");
      more.onclick = () => loadMoreReplies(id, ticket.replies.length, more);
      thread.append(more);
    }

    const replyMbSelect = document.getElementById("reply-mailbox-select");
    if (replyMbSelect) {
      replyMbSelect.replaceChildren();
      const outgoingMailboxes = mailboxChannels.filter((mailbox) => mailbox.canSend);
      for (const mailbox of outgoingMailboxes) {
        const option = document.createElement("option");
        option.value = mailbox.id;
        option.textContent = mailbox.email;
        replyMbSelect.append(option);
      }
      replyMbSelect.disabled = outgoingMailboxes.length === 0;
      if (outgoingMailboxes.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = t("no_outgoing_mailbox");
        replyMbSelect.append(option);
      } else {
        const preferredMailboxId = draft?.mailbox || ticket.mailboxId;
        replyMbSelect.value = outgoingMailboxes.some(
          (mailbox) => mailbox.id === preferredMailboxId,
        )
          ? preferredMailboxId
          : outgoingMailboxes[0].id;
      }
      replyMbSelect.onchange = () => saveDraft();
    }
  } catch (e) {
    if (request === ticketDetailRequest) {
      if (currentTicketOriginal?.id !== id) {
        currentTicketOriginal = draft?.original || null;
        pendingChanges = draft?.pending || {};
      }
      clearTicketDetail();
      showTicketError(e.message);
    }
  }
}

function returnToHome(e) {
  if (e) {
    e.preventDefault();
  }
  selectedTicketId = null;
  currentTicketOriginal = null;
  pendingChanges = {};

  const emptyState = document.getElementById("empty-state");
  if (emptyState) emptyState.style.display = "flex";

  const content = document.getElementById("ticket-content");
  if (content) content.style.display = "none";

  const appBody = document.querySelector(".app-body");
  if (appBody) appBody.classList.remove("ticket-view-open");

  if (typeof closeMobileSidebar === "function") {
    closeMobileSidebar();
  }
  if (typeof closeModals === "function") {
    closeModals();
  }

  const replyText = document.getElementById("reply-text");
  if (replyText) replyText.value = "";
  selectedReplyFiles = [];
  renderReplyFilesPreview();

  renderTicketList();
}

function closeMobileTicketDetail() {
  returnToHome();
}

function handleMetaFieldChange(field) {
  if (!currentTicketOriginal) return;
  const statusVal = document.getElementById("d-status-select")?.value;
  const priorityVal = document.getElementById("d-priority-select")?.value;
  const assigneeVal = document.getElementById("d-assignee-select")?.value;

  pendingChanges = {};
  if (statusVal && statusVal !== currentTicketOriginal.status) {
    pendingChanges.status = statusVal;
  }
  if (priorityVal && priorityVal !== currentTicketOriginal.priority) {
    pendingChanges.priority = priorityVal;
  }
  if (
    assigneeVal !== undefined &&
    assigneeVal !== currentTicketOriginal.assigneeId
  ) {
    pendingChanges.assignee = assigneeVal;
  }

  updateSaveButtonState();
}

function updateSaveButtonState() {
  const btnSave = document.getElementById("btn-save-ticket");
  if (!btnSave) return;
  const count = Object.keys(pendingChanges).length;
  const dict = I18N[currentLang] || I18N.RU;
  const baseLabel = dict.btn_save || "Сохранить";
  if (count > 0) {
    btnSave.classList.add("has-pending");
    btnSave.textContent = `${baseLabel} (${count})*`;
  } else {
    btnSave.classList.remove("has-pending");
    btnSave.textContent = baseLabel;
  }
}

async function saveTicketChanges() {
  if (!selectedTicketId || !currentTicketOriginal) return;
  const id = selectedTicketId,
    changes = { ...pendingChanges };
  let version = currentTicketOriginal.version;
  const button = document.getElementById("btn-save-ticket");
  if (button) button.disabled = true;
  try {
    const fields = {};
    if (changes.status !== undefined) fields.status = changes.status;
    if (changes.priority !== undefined) fields.priority = changes.priority;
    if (changes.assignee !== undefined)
      fields.assignee_id = changes.assignee || null;
    if (Object.keys(fields).length) {
      const res = await apiFetch("/api/tickets/" + id, {
        method: "PATCH",
        headers: getAuthHeaders(true),
        body: JSON.stringify({ ...fields, version }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && confirm(t("discard_conflicting_changes"))) {
          const draft = ticketDrafts.get(id);
          if (draft) draft.pending = {};
          if (selectedTicketId === id) {
            pendingChanges = {};
            await selectTicket(id);
          }
        }
        throw new Error(data.message);
      }
      version = data.version;
    }
    if (selectedTicketId === id) {
      pendingChanges = {};
      saveDraft();
      await selectTicket(id);
    }
    await loadAllTickets();
    showToast(I18N[currentLang]?.changes_saved || "Saved");
  } catch (error) {
    showTicketError(error.message + " Refresh the ticket before retrying.");
  } finally {
    if (button) button.disabled = false;
    updateSaveButtonState();
  }
}

async function quickResolveTicket() {
  const select = document.getElementById("d-status-select");
  if (!select || !selectedTicketId) return;
  select.value = "RESOLVED";
  handleMetaFieldChange("status");
  await saveTicketChanges();
}

async function patchTicket(subpath, payload) {
  if (!selectedTicketId) return;
  try {
    const res = await apiFetch(`/api/tickets/${selectedTicketId}${subpath}`, {
      method: "PATCH",
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        ...payload,
        version: currentTicketOriginal?.version,
      }),
    });
    if (res.ok) {
      showToast(I18N[currentLang]?.changes_saved || "Изменения сохранены");
    }
    await loadAllTickets();
  } catch (e) {
    console.error("Failed to patch ticket:", e);
  }
}

async function deleteCurrentTicket() {
  if (!selectedTicketId) return;
  if (
    !confirm(
      "Are you sure you want to permanently delete this ticket and all attachments?",
    )
  )
    return;
  try {
    const res = await apiFetch(`/api/tickets/${selectedTicketId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (res.ok || res.status === 404) {
      clearTicketDetail();
      await loadAllTickets();
    } else {
      const err = await res.json();
      alert("Failed to delete ticket: " + (err.message || "Error"));
    }
  } catch {
    alert("Failed to delete ticket");
  }
}

function handleReplyFilesSelected(fileList) {
  if (!fileList || fileList.length === 0) return;
  for (let i = 0; i < fileList.length; i++)
    selectedReplyFiles.push(fileList[i]);
  renderReplyFilesPreview();
}

function removeReplyFile(index) {
  selectedReplyFiles.splice(index, 1);
  renderReplyFilesPreview();
}

function renderReplyFilesPreview() {
  const container = document.getElementById("reply-files-preview");
  const countSpan = document.getElementById("reply-files-count");
  if (!container) return;
  if (selectedReplyFiles.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    if (countSpan) countSpan.textContent = "";
    return;
  }
  container.style.display = "flex";
  container.innerHTML = selectedReplyFiles
    .map((f, idx) => {
      const sizeKb = (f.size / 1024).toFixed(1);
      return `<span class="reply-file-chip">
      <span style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(f.name)}</span>
      <span style="color: var(--text-muted); font-size: 11px;">(${sizeKb} KB)</span>
      <button type="button" class="remove-file-btn" data-ui-click="a106" data-ui-args="${escapeHtml(JSON.stringify([idx]))}" title="Удалить файл" aria-label="Удалить файл">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    </span>`;
    })
    .join("");
  if (countSpan)
    countSpan.textContent = `(${selectedReplyFiles.length} attached)`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function submitReply() {
  if (!authState.token || !selectedTicketId) return;
  saveDraft();
  const id = selectedTicketId,
    draft = ticketDrafts.get(id),
    text = draft.text.trim(),
    files = [...draft.files];
  if (!text) return;
  if (
    files.length > uploadLimits.maxAttachments ||
    files.some((f) => f.size > uploadLimits.maxAttachmentBytes) ||
    files.reduce((n, f) => n + f.size, 0) > uploadLimits.maxMessageBytes
  )
    return showTicketError("Attachment size or count limit exceeded");
  const signature =
    text +
    "|" +
    (document.getElementById("reply-mailbox-select")?.value || "") +
    "|" +
    files.map((f) => f.name + ":" + f.size + ":" + f.lastModified).join("|");
  if (draft.signature !== signature) {
    draft.key = crypto.randomUUID();
    draft.signature = signature;
    draft.uploadKeys = files.map(() => crypto.randomUUID());
  }
  const btn = document.getElementById("btn-send-reply");
  btn.disabled = true;
  try {
    const attachmentIds = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const res = await apiFetch("/api/tickets/" + id + "/uploads", {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
          "X-File-Type": file.type || "application/octet-stream",
          "Idempotency-Key": draft.uploadKeys[i],
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      attachmentIds.push(data.id);
    }
    const res = await apiFetch("/api/tickets/" + id + "/replies", {
      method: "POST",
      headers: { ...getAuthHeaders(true), "Idempotency-Key": draft.key },
      body: JSON.stringify({
        body: text,
        sender_type: "EMPLOYEE",
        mailbox_id:
          document.getElementById("reply-mailbox-select")?.value || null,
        attachment_ids: attachmentIds,
      }),
    });
    const reply = await res.json();
    if (!res.ok) throw new Error(reply.message);
    ticketDrafts.delete(id);
    if (selectedTicketId === id) {
      document.getElementById("reply-text").value = "";
      selectedReplyFiles = [];
      await selectTicket(id, true);
    }
    await loadAllTickets();
    showToast(
      I18N[currentLang]?.reply_queued || "Reply saved and queued for delivery",
    );
    addNotification({
      titleKey: "reply_queued",
      message: text.slice(0, 100),
      ticketId: id,
      type: "reply",
    });
  } catch (error) {
    showTicketError(error.message);
  } finally {
    btn.disabled = false;
  }
}
async function downloadAttachmentFile(event, ticketId, attId, filename) {
  event?.preventDefault();
  event?.stopPropagation();
  try {
    const res = await apiFetch(
      "/api/tickets/" + ticketId + "/attachments/" + attId + "/download",
      { headers: getAuthHeaders() },
    );
    if (!res.ok) throw new Error((await res.json()).message);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showTicketError(error.message);
  }
}
async function loadTicketAttachments(ticketId) {
  const panel = document.getElementById("d-attachments"),
    list = document.getElementById("d-attachments-list");
  try {
    const response = await apiFetch(
      "/api/tickets/" + ticketId + "/attachments",
      { headers: getAuthHeaders() },
    );
    if (!response.ok) throw new Error("Unable to load attachments");
    const attachments = await response.json();
    if (selectedTicketId !== ticketId) return;
    attachmentBlobUrls.forEach((url) => URL.revokeObjectURL(url));
    attachmentBlobUrls = [];
    list.replaceChildren();
    panel.style.display = attachments.length ? "flex" : "none";
    document.getElementById("d-attachments-count").textContent =
      "(" + attachments.length + ")";
    for (const attachment of attachments) {
      const card = document.createElement("div");
      card.className = "attachment-card";
      const label = document.createElement("span");
      label.className = "attachment-name";
      label.textContent =
        attachment.originalName + " (" + formatBytes(attachment.size) + ")";
      card.append(label);
      if (attachment.isPurged) {
        const badge = document.createElement("span");
        badge.textContent = I18N[currentLang]?.expired || "Expired";
        card.append(badge);
      } else {
        const button = document.createElement("button");
        button.className = "btn btn-secondary";
        button.textContent = I18N[currentLang]?.btn_download || "Download";
        button.addEventListener("click", (event) =>
          downloadAttachmentFile(
            event,
            ticketId,
            attachment.id,
            attachment.originalName,
          ),
        );
        card.append(button);
        if (
          ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            attachment.mimeType,
          )
        ) {
          const preview = document.createElement("button");
          preview.className = "btn btn-secondary";
          preview.textContent = I18N[currentLang]?.preview || "Preview";
          preview.addEventListener("click", async () => {
            try {
              const res = await apiFetch(
                "/api/tickets/" +
                  ticketId +
                  "/attachments/" +
                  attachment.id +
                  "/download?inline=true",
                { headers: getAuthHeaders() },
              );
              if (!res.ok) throw new Error("Preview unavailable");
              const url = URL.createObjectURL(await res.blob());
              if (selectedTicketId !== ticketId) {
                URL.revokeObjectURL(url);
                return;
              }
              attachmentBlobUrls.push(url);
              openLightbox(
                url,
                attachment.originalName,
                url,
                ticketId,
                attachment.id,
              );
            } catch (error) {
              showTicketError(error.message);
            }
          });
          card.append(preview);
        }
      }
      list.append(card);
    }
  } catch (error) {
    if (selectedTicketId === ticketId) showTicketError(error.message);
  }
}
async function loadMoreReplies(id, offset, button) {
  button.disabled = true;
  try {
    const response = await apiFetch(
      "/api/tickets/" + id + "/replies?offset=" + offset + "&limit=50",
      { headers: getAuthHeaders() },
    );
    if (!response.ok) throw new Error("Unable to load replies");
    const replies = await response.json();
    if (selectedTicketId !== id) return;
    for (const reply of replies)
      if (!document.querySelector('[data-reply-id="' + reply.id + '"]'))
        button.before(renderReplyCard(reply, id, ""));
    if (replies.length < 50) button.remove();
    else {
      button.onclick = () =>
        loadMoreReplies(id, offset + replies.length, button);
      button.disabled = false;
    }
  } catch (error) {
    button.disabled = false;
    showTicketError(error.message);
  }
}

const openNewTicketModal = () => {
  const modal = document.getElementById("modal-new-ticket");
  let select = document.getElementById("nt-mailbox");
  if (!select) {
    const group = document.createElement("div");
    group.className = "form-group";
    const label = document.createElement("label");
    label.htmlFor = "nt-mailbox";
    label.textContent = t("outgoing_mailbox");
    select = document.createElement("select");
    select.id = "nt-mailbox";
    select.className = "form-control";
    group.append(label, select);
    document.getElementById("nt-email").closest(".form-group").after(group);
  }
  select.replaceChildren();
  for (const mailbox of mailboxChannels) {
    const option = document.createElement("option");
    option.value = mailbox.id;
    option.textContent = mailbox.email;
    select.append(option);
  }
  modal.classList.add("active");
};

async function submitNewTicket() {
  const email = document.getElementById("nt-email").value.trim();
  const subject = document.getElementById("nt-subject").value.trim();
  const priority = document.getElementById("nt-priority").value;
  const body = document.getElementById("nt-body").value.trim();
  if (!email || !subject || !body)
    return alert("Please complete all required ticket fields");

  const res = await apiFetch("/api/tickets", {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify({
      sender_email: email,
      subject,
      priority,
      body,
      mailbox_id: document.getElementById("nt-mailbox")?.value || undefined,
    }),
  });
  if (res.ok) {
    const created = await res.json();
    closeModals();
    await loadAllTickets();
    selectTicket(created.id);
  } else {
    const err = await res.json();
    alert("Error: " + (err.message || "Failed to create ticket"));
  }
}
