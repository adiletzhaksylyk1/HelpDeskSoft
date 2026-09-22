// Tickets Module — Filtering, Rendering, Detail View, Replies & Attachments

let allTickets = [];
let displayedTickets = [];
let selectedTicketId = null;
let activeFilters = { status: '', priority: '', mailbox: '' };
let activeScope = 'all';

let currentTicketOriginal = null;
let pendingChanges = {};
let selectedReplyFiles = [];
let collisionPollerTimer = null;
let lastKnownReplyCount = 0;
let collisionDetected = false;

function updateAssigneeBanner(ticket) {
  const banner = document.getElementById('d-assignee-banner');
  if (!banner) return;
  const dict = I18N[currentLang] || I18N.RU;

  if (ticket && ticket.assigneeId && authState.user && ticket.assigneeId !== authState.user.id) {
    const assignedUser = users.find((u) => u.id === ticket.assigneeId);
    const assigneeName = ticket.assignee ? ticket.assignee.name : (assignedUser ? assignedUser.name : 'Коллега');
    banner.innerHTML = `<span>${dict.collision_assigned_warning || 'Внимание: Заявка закреплена за специалистом: '}<strong>${escapeHtml(assigneeName)}</strong></span>`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function startCollisionPoller(ticketId) {
  if (collisionPollerTimer) clearInterval(collisionPollerTimer);
  collisionPollerTimer = setInterval(async () => {
    if (selectedTicketId !== ticketId) {
      clearInterval(collisionPollerTimer);
      collisionPollerTimer = null;
      return;
    }

    try {
      const res = await fetch(`/api/tickets/${ticketId}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const updated = await res.json();
      const currentReplies = updated.replies || [];

      if (currentReplies.length > lastKnownReplyCount) {
        const newReplies = currentReplies.slice(lastKnownReplyCount);
        const hasColleagueReply = newReplies.some((r) => r.senderType === 'EMPLOYEE');

        if (hasColleagueReply) {
          collisionDetected = true;
          const banner = document.getElementById('d-collision-banner');
          const dict = I18N[currentLang] || I18N.RU;
          if (banner) {
            banner.innerHTML = `<span>${dict.collision_reply_alert || 'Внимание: Коллега только что отправил ответ на эту заявку! Проверьте новые сообщения ниже перед отправкой.'}</span>`;
            banner.style.display = 'flex';
          }
        }

        const thread = document.getElementById('d-thread');
        if (thread) {
          newReplies.forEach((rep) => {
            const repMsg = document.createElement('div');
            const isEmp = rep.senderType === 'EMPLOYEE';
            repMsg.className = `msg-card ${isEmp ? 'msg-employee' : ''}`;
            repMsg.style.animation = 'slideInDown 0.3s ease-out';
            const empName = rep.authorName || 'Support Agent';
            repMsg.innerHTML = `
              <div class="msg-header">
                <div class="msg-author">
                  <span class="msg-author-email">${isEmp ? escapeHtml(empName) : escapeHtml(updated.senderEmail)}</span>
                  <span class="msg-badge ${isEmp ? 'msg-badge-emp' : 'msg-badge-cust'}">${rep.senderType}</span>
                </div>
                <div class="msg-time">${new Date(rep.createdAt).toLocaleString()}</div>
              </div>
              <div class="msg-body">${formatMessageBody(rep.body)}</div>
            `;
            thread.appendChild(repMsg);
          });
          thread.scrollTop = thread.scrollHeight;
        }

        lastKnownReplyCount = currentReplies.length;

        if (updated.assigneeId && updated.assigneeId !== currentTicketOriginal.assigneeId) {
          currentTicketOriginal.assigneeId = updated.assigneeId;
          const dAssignee = document.getElementById('d-assignee-select');
          if (dAssignee) dAssignee.value = updated.assigneeId;
          updateAssigneeBanner(updated);
        }

        if (updated.status && updated.status !== currentTicketOriginal.status) {
          currentTicketOriginal.status = updated.status;
          const dStatus = document.getElementById('d-status-select');
          if (dStatus) dStatus.value = updated.status;
        }
      }
    } catch {
      // Background poll failure ignored
    }
  }, 7000);
}

async function loadAllTickets() {
  try {
    let url = '/api/tickets?limit=100';
    if (activeScope === 'my' && authState.token) {
      url += '&my_tickets=true';
    } else if (activeScope === 'unassigned') {
      url += '&assignee=unassigned';
    }

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      const newFetched = data.data || [];
      if (allTickets.length > 0 && newFetched.length > 0) {
        const existingIds = new Set(allTickets.map((t) => t.id));
        const brandNewTickets = newFetched.filter((t) => !existingIds.has(t.id));
        brandNewTickets.forEach((t) => {
          const isCritical = t.priority === 'CRITICAL' || t.priority === 'HIGH';
          addNotification({
            titleKey: isCritical ? 'notif_urgent_ticket' : 'notif_new_ticket',
            message: (t.subject || 'Без темы') + ' — ' + (t.senderEmail || 'клиент'),
            ticketId: t.id,
            ticketNumber: t.id.slice(0, 8),
            type: isCritical ? 'warning' : 'ticket',
          });
        });
      }
      allTickets = newFetched;
      updateCounters();
      applyFiltersAndRender();
      if (window.location.search.includes('selectFirst') && allTickets.length > 0 && !selectedTicketId) {
        selectTicket(allTickets[0].id);
      }

    }
  } catch (e) {
    console.error('Error fetching tickets:', e);
  }
}

function setScope(scope) {
  if (scope === 'my' && !authState.user) {
    openLoginModal('Please log in with your corporate account to view assigned tickets');
    return;
  }
  activeScope = scope;
  updateScopeUI();
  loadAllTickets();
}

function updateScopeUI() {
  document.querySelectorAll('.scope-nav-item').forEach((el) => el.classList.remove('active'));
  const target = document.getElementById(`scope-${activeScope}`);
  if (target) target.classList.add('active');
}

function updateCounters() {
  const count = (k, v) => allTickets.filter((t) => t[k] === v).length;
  ['waiting', 'progress', 'resolved'].forEach((s) => {
    const el = document.getElementById(`cnt-${s}`);
    if (el) el.textContent = count('status', s === 'progress' ? 'IN_PROGRESS' : s.toUpperCase());
  });
  ['critical', 'high', 'medium', 'low'].forEach((p) => {
    const el = document.getElementById(`cnt-${p}`);
    if (el) el.textContent = count('priority', p.toUpperCase());
  });
  const cntAll = document.getElementById('cnt-all');
  if (cntAll) cntAll.textContent = allTickets.length;
  const cntAllStatus = document.getElementById('cnt-all-status');
  if (cntAllStatus) cntAllStatus.textContent = allTickets.length;
  const cntPAll = document.getElementById('cnt-p-all');
  if (cntPAll) cntPAll.textContent = allTickets.length;
  if (typeof updateMailboxCounters === 'function') updateMailboxCounters();
}

function setFilter(type, value) {
  activeFilters[type] = value;

  if (type === 'status') {
    document.querySelectorAll('.status-filter-group .nav-item').forEach((el) => el.classList.remove('active'));
    const statusId = activeFilters.status === '' ? 'filter-all' : `filter-${activeFilters.status.toLowerCase().replace('_', '-')}`;
    const statusEl = document.getElementById(statusId);
    if (statusEl) statusEl.classList.add('active');
  }

  if (type === 'priority') {
    document.querySelectorAll('.priority-filter-group .nav-item').forEach((el) => el.classList.remove('active'));
    const priorityId = activeFilters.priority === '' ? 'filter-p-all' : `filter-${activeFilters.priority.toLowerCase()}`;
    const priorityEl = document.getElementById(priorityId);
    if (priorityEl) priorityEl.classList.add('active');
  }

  if (type === 'mailbox') {
    document.querySelectorAll('.channels-filter-group .nav-item').forEach((el) => el.classList.remove('active'));
    if (value === '') {
      const allEl = document.getElementById('filter-mb-all');
      if (allEl) allEl.classList.add('active');
    } else {
      const found = mailboxChannels.find((m) => m.email === value);
      if (found) {
        const mbEl = document.getElementById(`filter-mb-${found.id}`);
        if (mbEl) mbEl.classList.add('active');
      }
    }
  }

  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  displayedTickets = allTickets.filter((t) => {
    if (activeFilters.status && t.status !== activeFilters.status) return false;
    if (activeFilters.priority && t.priority !== activeFilters.priority) return false;
    if (activeFilters.mailbox && t.recipientEmail !== activeFilters.mailbox && t.mailboxId !== activeFilters.mailbox) return false;
    return true;
  });
  renderTicketList();

  const appBody = document.querySelector('.app-body');
  const isMobileViewOpen = appBody && appBody.classList.contains('ticket-view-open');
  const isMobile = window.innerWidth < 768;

  if (selectedTicketId) {
    const stillInList = displayedTickets.some((t) => t.id === selectedTicketId);
    if (!stillInList) {
      clearTicketDetail();
    } else if (isMobile && !isMobileViewOpen) {
      // User is on mobile browsing the ticket list; keep list view and do not force open
      selectedTicketId = null;
      renderTicketList();
    } else {
      // Refresh ticket details in-place without forcing mobile full-screen switch
      selectTicket(selectedTicketId, false, isMobileViewOpen);
    }
  }
}

function clearTicketDetail() {
  if (collisionPollerTimer) {
    clearInterval(collisionPollerTimer);
    collisionPollerTimer = null;
  }
  selectedTicketId = null;
  currentTicketOriginal = null;
  pendingChanges = {};
  const content = document.getElementById('ticket-content');
  if (content) content.style.display = 'none';
  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'flex';
  const appBody = document.querySelector('.app-body');
  if (appBody) appBody.classList.remove('ticket-view-open');
  renderTicketList();
}

function renderTicketList() {
  const container = document.getElementById('ticket-items-container');
  if (!container) return;
  const sb = document.getElementById('search-bar');
  const search = (sb ? sb.value : '').toLowerCase().trim();
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) clearBtn.style.display = search.length > 0 ? 'flex' : 'none';

  const filtered = displayedTickets.filter((t) => (
    (t.subject || '').toLowerCase().includes(search) ||
    (t.senderEmail || '').toLowerCase().includes(search) ||
    (t.body || '').toLowerCase().includes(search)
  ));

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding: 28px; text-align: center; color: var(--text-subtle); font-size: 13px;">No tickets match your filters</div>';
    return;
  }

  filtered.forEach((t) => {
    const card = document.createElement('div');
    card.className = `ticket-card ${selectedTicketId === t.id ? 'selected' : ''}`;
    card.onclick = () => selectTicket(t.id);

    const dict = I18N[currentLang] || I18N.RU;
    const statusClass = `badge-${(t.status || 'waiting').toLowerCase()}`;
    const priorityClass = `badge-priority-${(t.priority || 'medium').toLowerCase()}`;
    const statusMap = {
      WAITING: dict.status_waiting || 'В ожидании',
      IN_PROGRESS: dict.status_in_progress || 'В работе',
      RESOLVED: dict.status_resolved || 'Решена',
    };
    const priorityMap = {
      LOW: dict.priority_low || 'Низкий',
      MEDIUM: dict.priority_medium || 'Средний',
      HIGH: dict.priority_high || 'Высокий',
      CRITICAL: dict.priority_critical || 'Критический',
    };
    const statusText = statusMap[t.status] || t.status;
    const priorityText = priorityMap[t.priority] || t.priority;
    const assigneeName = t.assignee ? t.assignee.name : (dict.unassigned || '(Не назначен)');
    const dateStr = new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="card-meta-top">
        <span>${escapeHtml(t.senderEmail)}</span>
        <span>${dateStr}</span>
      </div>
      <div class="card-title">${escapeHtml(t.subject)}</div>
      <div class="card-preview">${escapeHtml(t.body)}</div>
      <div class="card-badges">
        <span class="badge ${statusClass}">${escapeHtml(statusText)}</span>
        <span class="badge ${priorityClass}">● ${escapeHtml(priorityText)}</span>
        ${t.recipientEmail ? `<span class="badge badge-channel" title="Received on ${escapeHtml(t.recipientEmail)}">${escapeHtml(t.recipientEmail)}</span>` : ''}
        <span style="margin-left: auto; font-size: 11px; color: var(--text-subtle);">${escapeHtml(assigneeName)}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function formatMessageBody(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/(?:(?!&lt;|&gt;)[^\s<>'"])+)/gi, (match) => {
    let clean = match;
    let trailing = '';
    const m = clean.match(/([.,;!?:)]+)$/);
    if (m) {
      trailing = m[1];
      clean = clean.slice(0, -trailing.length);
    }
    const href = clean.replace(/&amp;/g, '&');
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="msg-link">${clean}</a>${trailing}`;
  });
}

async function selectTicket(id, scrollToBottom = false, openMobileView = true) {
  selectedTicketId = id;
  selectedReplyFiles = [];
  const fileInput = document.getElementById('reply-file-input');
  if (fileInput) fileInput.value = '';
  renderReplyFilesPreview();
  renderTicketList();

  // Mobile: Switch view to full-screen ticket detail only if explicitly requested
  const appBody = document.querySelector('.app-body');
  if (openMobileView && appBody) {
    appBody.classList.add('ticket-view-open');
  }

  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'none';
  const content = document.getElementById('ticket-content');
  if (content) content.style.display = 'flex';

  try {
    const res = await fetch(`/api/tickets/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Ticket not found');
    const ticket = await res.json();

    const dSubject = document.getElementById('d-subject');
    if (dSubject) dSubject.textContent = ticket.subject;
    const breadcrumb = document.getElementById('d-breadcrumb-subject');
    if (breadcrumb) breadcrumb.textContent = ticket.subject || 'Обращение';

    const metaSender = document.getElementById('d-meta-sender');
    if (metaSender) metaSender.textContent = ticket.senderEmail || '—';

    const metaDate = document.getElementById('d-meta-date');
    if (metaDate) metaDate.textContent = new Date(ticket.createdAt).toLocaleDateString();

    const channelBadge = document.getElementById('d-channel-badge');
    if (channelBadge) {
      if (ticket.recipientEmail) {
        channelBadge.style.display = 'inline-flex';
        channelBadge.textContent = `${ticket.recipientEmail}`;
        channelBadge.title = `Inbound mailbox: ${ticket.recipientEmail}`;
      } else {
        channelBadge.style.display = 'none';
      }
    }
    const dStatus = document.getElementById('d-status-select');
    if (dStatus) dStatus.value = ticket.status;
    const dPriority = document.getElementById('d-priority-select');
    if (dPriority) dPriority.value = ticket.priority;
    const dAssignee = document.getElementById('d-assignee-select');
    if (dAssignee) dAssignee.value = ticket.assigneeId || '';

    currentTicketOriginal = {
      status: ticket.status,
      priority: ticket.priority,
      assigneeId: ticket.assigneeId || '',
    };
    pendingChanges = {};
    updateSaveButtonState();
    updateAuthUI();

    lastKnownReplyCount = (ticket.replies || []).length;
    collisionDetected = false;
    const colBanner = document.getElementById('d-collision-banner');
    if (colBanner) colBanner.style.display = 'none';

    updateAssigneeBanner(ticket);
    startCollisionPoller(id);

    const thread = document.getElementById('d-thread');
    if (thread) {
      thread.innerHTML = '';

      const origMsg = document.createElement('div');
      origMsg.className = 'msg-card msg-initial';
      origMsg.innerHTML = `
        <div class="msg-header">
          <div class="msg-author">
            <span class="msg-author-email">${escapeHtml(ticket.senderEmail)}</span>
            <span class="msg-badge msg-badge-cust">CUSTOMER</span>
            ${ticket.recipientEmail ? `<span class="badge badge-channel">В ящик: ${escapeHtml(ticket.recipientEmail)}</span>` : ''}
          </div>
          <div class="msg-time">${new Date(ticket.createdAt).toLocaleString()}</div>
        </div>
        <div class="msg-body">${formatMessageBody(ticket.body)}</div>
      `;
      thread.appendChild(origMsg);

      const replies = ticket.replies || [];
      replies.forEach((rep) => {
        const repMsg = document.createElement('div');
        const isEmp = rep.senderType === 'EMPLOYEE';
        repMsg.className = `msg-card ${isEmp ? 'msg-employee' : ''}`;
        const empName = rep.authorName || 'Support Agent';
        repMsg.innerHTML = `
          <div class="msg-header">
            <div class="msg-author">
              <span class="msg-author-email">${isEmp ? escapeHtml(empName) : escapeHtml(ticket.senderEmail)}</span>
              <span class="msg-badge ${isEmp ? 'msg-badge-emp' : 'msg-badge-cust'}">${rep.senderType}</span>
            </div>
            <div class="msg-time">${new Date(rep.createdAt).toLocaleString()}</div>
          </div>
          <div class="msg-body">${formatMessageBody(rep.body)}</div>
        `;
        thread.appendChild(repMsg);
      });

      if (scrollToBottom && replies.length > 0) {
        thread.scrollTop = thread.scrollHeight;
      } else {
        thread.scrollTop = 0;
      }
    }

    loadTicketAttachments(id);

    const replyMbSelect = document.getElementById('reply-mailbox-select');
    if (replyMbSelect) {
      replyMbSelect.innerHTML = '';
      if (!mailboxChannels || mailboxChannels.length === 0) {
        replyMbSelect.innerHTML = '<option value="">Основной ящик (.env)</option>';
      } else {
        mailboxChannels.forEach((mb) => {
          const opt = document.createElement('option');
          opt.value = mb.id;
          opt.textContent = `${mb.name} (${mb.email})`;
          const isMatchingMb = ticket.mailboxId === mb.id ||
            (ticket.recipientEmail && mb.email && ticket.recipientEmail.toLowerCase().trim() === mb.email.toLowerCase().trim());
          if (isMatchingMb) {
            opt.selected = true;
          }
          replyMbSelect.appendChild(opt);
        });
      }
    }
  } catch (e) {
    console.error('Failed to load ticket details:', e);
  }
}

function returnToHome(e) {
  if (e) {
    e.preventDefault();
  }
  selectedTicketId = null;
  currentTicketOriginal = null;
  pendingChanges = {};

  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'flex';

  const content = document.getElementById('ticket-content');
  if (content) content.style.display = 'none';

  const appBody = document.querySelector('.app-body');
  if (appBody) appBody.classList.remove('ticket-view-open');

  if (typeof closeMobileSidebar === 'function') {
    closeMobileSidebar();
  }
  if (typeof closeModals === 'function') {
    closeModals();
  }

  const replyText = document.getElementById('reply-text');
  if (replyText) replyText.value = '';
  selectedReplyFiles = [];
  renderReplyFilesPreview();

  renderTicketList();
}

function closeMobileTicketDetail() {
  returnToHome();
}

function handleMetaFieldChange(field) {
  if (!currentTicketOriginal) return;
  const statusVal = document.getElementById('d-status-select')?.value;
  const priorityVal = document.getElementById('d-priority-select')?.value;
  const assigneeVal = document.getElementById('d-assignee-select')?.value;

  pendingChanges = {};
  if (statusVal && statusVal !== currentTicketOriginal.status) {
    pendingChanges.status = statusVal;
  }
  if (priorityVal && priorityVal !== currentTicketOriginal.priority) {
    pendingChanges.priority = priorityVal;
  }
  if (assigneeVal !== undefined && assigneeVal !== currentTicketOriginal.assigneeId) {
    pendingChanges.assignee = assigneeVal;
  }

  updateSaveButtonState();
}

function updateSaveButtonState() {
  const btnSave = document.getElementById('btn-save-ticket');
  if (!btnSave) return;
  const count = Object.keys(pendingChanges).length;
  const dict = I18N[currentLang] || I18N.RU;
  const baseLabel = dict.btn_save || 'Сохранить';
  if (count > 0) {
    btnSave.classList.add('has-pending');
    btnSave.textContent = `${baseLabel} (${count})*`;
  } else {
    btnSave.classList.remove('has-pending');
    btnSave.textContent = baseLabel;
  }
}

async function saveTicketChanges() {
  if (!selectedTicketId) return;
  const dict = I18N[currentLang] || I18N.RU;
  const count = Object.keys(pendingChanges).length;
  if (count === 0) {
    showToast(dict.no_pending_changes || 'Нет несохраненных изменений');
    return;
  }

  const btnSave = document.getElementById('btn-save-ticket');
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = dict.saving || 'Сохранение...';
  }

  try {
    let savedOk = true;

    if (pendingChanges.status !== undefined || pendingChanges.priority !== undefined) {
      const payload = {};
      if (pendingChanges.status !== undefined) payload.status = pendingChanges.status;
      if (pendingChanges.priority !== undefined) payload.priority = pendingChanges.priority;
      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(true),
        body: JSON.stringify(payload),
      });
      if (!res.ok) savedOk = false;
    }

    if (pendingChanges.assignee !== undefined) {
      const res = await fetch(`/api/tickets/${selectedTicketId}/assign`, {
        method: 'PATCH',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ assignee_id: pendingChanges.assignee || null }),
      });
      if (!res.ok) savedOk = false;
    }

    if (savedOk) {
      showToast(dict.changes_saved || 'Изменения успешно сохранены');
      if (currentTicketOriginal) {
        if (pendingChanges.status !== undefined) currentTicketOriginal.status = pendingChanges.status;
        if (pendingChanges.priority !== undefined) currentTicketOriginal.priority = pendingChanges.priority;
        if (pendingChanges.assignee !== undefined) currentTicketOriginal.assigneeId = pendingChanges.assignee;
      }
      pendingChanges = {};

      const found = allTickets.find((t) => t.id === selectedTicketId);
      if (found) {
        if (currentTicketOriginal.status) found.status = currentTicketOriginal.status;
        if (currentTicketOriginal.priority) found.priority = currentTicketOriginal.priority;
        found.assigneeId = currentTicketOriginal.assigneeId || null;
        found.assignee = users.find((u) => u.id === found.assigneeId) || null;
      }

      updateCounters();
      applyFiltersAndRender();

      addNotification({
        titleKey: 'notif_ticket_updated',
        messageKey: 'notif_changes_saved_desc',
        ticketId: selectedTicketId,
        ticketNumber: selectedTicketId.slice(0, 8),
        type: 'success',
      });

    } else {
      alert('Failed to save some changes');
    }
  } catch (e) {
    console.error('Error saving ticket changes:', e);
    alert('Error saving changes: ' + e.message);
  } finally {
    if (btnSave) btnSave.disabled = false;
    updateSaveButtonState();
  }
}

async function quickResolveTicket() {
  const select = document.getElementById('d-status-select');
  if (!select || !selectedTicketId) return;
  select.value = 'RESOLVED';
  handleMetaFieldChange('status');
  await saveTicketChanges();
}

async function patchTicket(subpath, payload) {
  if (!selectedTicketId) return;
  try {
    const res = await fetch(`/api/tickets/${selectedTicketId}${subpath}`, {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(I18N[currentLang]?.changes_saved || 'Изменения сохранены');
    }
    await loadAllTickets();
  } catch (e) {
    console.error('Failed to patch ticket:', e);
  }
}



async function deleteCurrentTicket() {
  if (!selectedTicketId) return;
  if (!confirm('Are you sure you want to permanently delete this ticket and all attachments?')) return;
  try {
    const res = await fetch(`/api/tickets/${selectedTicketId}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (res.ok || res.status === 404) {
      clearTicketDetail();
      await loadAllTickets();
    } else {
      const err = await res.json();
      alert('Failed to delete ticket: ' + (err.message || 'Error'));
    }
  } catch {
    alert('Failed to delete ticket');
  }
}

function handleReplyFilesSelected(fileList) {
  if (!fileList || fileList.length === 0) return;
  for (let i = 0; i < fileList.length; i++) selectedReplyFiles.push(fileList[i]);
  renderReplyFilesPreview();
}

function removeReplyFile(index) {
  selectedReplyFiles.splice(index, 1);
  renderReplyFilesPreview();
}

function renderReplyFilesPreview() {
  const container = document.getElementById('reply-files-preview');
  const countSpan = document.getElementById('reply-files-count');
  if (!container) return;
  if (selectedReplyFiles.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    if (countSpan) countSpan.textContent = '';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = selectedReplyFiles.map((f, idx) => {
    const sizeKb = (f.size / 1024).toFixed(1);
    return `<span class="reply-file-chip">
      <span style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(f.name)}</span>
      <span style="color: var(--text-muted); font-size: 11px;">(${sizeKb} KB)</span>
      <button type="button" class="remove-file-btn" onclick="removeReplyFile(${idx})" title="Удалить файл" aria-label="Удалить файл">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    </span>`;
  }).join('');
  if (countSpan) countSpan.textContent = `(${selectedReplyFiles.length} attached)`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function submitReply() {
  const dict = I18N[currentLang] || I18N.RU;

  if (!authState.user || !authState.token) {
    openLoginModal(dict.auth_required_reply || 'Войдите в аккаунт сотрудника, чтобы ответить на тикет');
    return;
  }

  const text = document.getElementById('reply-text').value.trim();
  if (!text || !selectedTicketId) return;

  const btn = document.getElementById('btn-send-reply');
  if (btn) { btn.disabled = true; btn.textContent = dict.saving || 'Отправка...'; }

  if (collisionDetected) {
    const confirmSend = confirm(dict.collision_confirm || 'Коллега уже ответил на эту заявку. Вы уверены, что хотите отправить еще один ответ клиенту?');
    if (!confirmSend) {
      if (btn) { btn.disabled = false; btn.textContent = dict.btn_send || 'Отправить ответ'; }
      return;
    }
  }

  try {
    const attachments = [];
    for (const f of selectedReplyFiles) {
      const base64 = await fileToBase64(f);
      attachments.push({ original_name: f.name, mime_type: f.type || 'application/octet-stream', data: base64 });
    }

    const wasUnassigned = !currentTicketOriginal?.assigneeId;
    const selectedMailboxId = document.getElementById('reply-mailbox-select')?.value || undefined;
    const res = await fetch(`/api/tickets/${selectedTicketId}/replies`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        body: text,
        sender_type: 'EMPLOYEE',
        author_name: authState.user?.name || undefined,
        mailbox_id: selectedMailboxId,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    });

    if (res.ok) {
      document.getElementById('reply-text').value = '';
      selectedReplyFiles = [];
      const fileInput = document.getElementById('reply-file-input');
      if (fileInput) fileInput.value = '';
      renderReplyFilesPreview();

      collisionDetected = false;
      const colBanner = document.getElementById('d-collision-banner');
      if (colBanner) colBanner.style.display = 'none';

      await selectTicket(selectedTicketId, true);
      await loadAllTickets();

      if (wasUnassigned && authState.user) {
        showToast(dict.auto_assigned_toast || 'Заявка автоматически закреплена за вами');
      } else {
        showToast(dict.changes_saved || 'Ответ успешно отправлен');
      }

      addNotification({
        titleKey: 'notif_reply_sent',
        messageKey: 'notif_reply_dispatched_desc',
        ticketId: selectedTicketId,
        ticketNumber: selectedTicketId.slice(0, 8),
        type: 'reply',
      });

    } else {
      const err = await res.json();
      alert('Failed to send reply: ' + (err.message || 'Error'));
    }
  } catch (err) {
    alert('Failed to send reply: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = dict.btn_send || 'Отправить ответ'; }
  }
}

async function downloadAttachmentFile(e, ticketId, attId, filename) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  try {
    const tokenParam = (typeof authState !== 'undefined' && authState.token) ? `?token=${encodeURIComponent(authState.token)}` : '';
    const res = await fetch(`/api/tickets/${ticketId}/attachments/${attId}/download${tokenParam}`, {
      headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.message || 'Failed to download attachment');
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 1000);
  } catch (err) {
    console.error('Download error:', err);
    const tokenParam = (typeof authState !== 'undefined' && authState.token) ? `?token=${encodeURIComponent(authState.token)}` : '';
    window.open(`/api/tickets/${ticketId}/attachments/${attId}/download${tokenParam}`, '_blank');
  }
}

async function loadTicketAttachments(ticketId) {
  const panel = document.getElementById('d-attachments'), list = document.getElementById('d-attachments-list'), countSpan = document.getElementById('d-attachments-count');
  if (!panel || !list) return;
  try {
    const res = await fetch(`/api/tickets/${ticketId}/attachments`, { headers: getAuthHeaders() });
    if (!res.ok) { panel.style.display = 'none'; return; }
    const attachments = await res.json();
    if (!attachments || attachments.length === 0) { panel.style.display = 'none'; list.innerHTML = ''; return; }

    panel.style.display = 'flex';
    if (countSpan) countSpan.textContent = `(${attachments.length})`;
    list.innerHTML = '';

    const dict = (typeof I18N !== 'undefined' && I18N[currentLang]) ? I18N[currentLang] : (window.I18N?.RU || {});
    const downloadLabel = dict.btn_download || 'Скачать';
    const clickToViewLabel = dict.click_to_view || 'Click to view';
    const expiredLabel = dict.expired || 'Expired';

    attachments.forEach((att) => {
      const card = document.createElement('div');
      const sizeStr = formatBytes(att.size || att.fileSize);
      const isImg = (att.mimeType || '').startsWith('image/');
      const token = (typeof authState !== 'undefined' && authState.token) ? authState.token : '';
      const tokenParam = token ? `token=${encodeURIComponent(token)}` : '';
      const dlUrl = `/api/tickets/${ticketId}/attachments/${att.id}/download${tokenParam ? '?' + tokenParam : ''}`;
      const prevUrl = `/api/tickets/${ticketId}/attachments/${att.id}/download?inline=true${tokenParam ? '&' + tokenParam : ''}`;
      const name = escapeHtml(att.originalName);
      const safeRawName = (att.originalName || 'attachment').replace(/['"\\]/g, '');

      if (att.isPurged) {
        card.className = 'attachment-card';
        card.innerHTML = `<span></span><span class="attachment-name" title="${name}">${name}</span><span class="attachment-size">(${sizeStr})</span><span class="attachment-purged-badge" title="Purged 24h after resolution">${escapeHtml(expiredLabel)}</span>`;
      } else if (isImg) {
        card.className = 'attachment-image-card';
        card.onclick = () => openLightbox(prevUrl, att.originalName, dlUrl, ticketId, att.id);
        card.innerHTML = `<img src="${prevUrl}" class="attachment-thumb" alt="${name}" loading="lazy" /><div class="attachment-image-info"><span class="attachment-name" title="${name}">${name}</span><span class="attachment-size">${sizeStr} • ${escapeHtml(clickToViewLabel)}</span></div><a href="${dlUrl}" target="_blank" download="${name}" class="attachment-download-btn" onclick="downloadAttachmentFile(event, '${ticketId}', '${att.id}', '${safeRawName}')" style="margin-left: auto;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>${escapeHtml(downloadLabel)}</a>`;
      } else {
        card.className = 'attachment-card';
        card.innerHTML = `<span></span><span class="attachment-name" title="${name}">${name}</span><span class="attachment-size">(${sizeStr})</span><a href="${dlUrl}" target="_blank" download="${name}" class="attachment-download-btn" onclick="downloadAttachmentFile(event, '${ticketId}', '${att.id}', '${safeRawName}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>${escapeHtml(downloadLabel)}</a>`;
      }
      list.appendChild(card);
    });
  } catch (e) {
    console.error('Failed to load attachments:', e);
    panel.style.display = 'none';
  }
}

const openNewTicketModal = () => document.getElementById('modal-new-ticket').classList.add('active');

async function submitNewTicket() {
  const email = document.getElementById('nt-email').value.trim();
  const subject = document.getElementById('nt-subject').value.trim();
  const priority = document.getElementById('nt-priority').value;
  const body = document.getElementById('nt-body').value.trim();
  if (!email || !subject || !body) return alert('Please complete all required ticket fields');

  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ sender_email: email, subject, priority, body }),
  });
  if (res.ok) {
    const created = await res.json();
    closeModals();
    await loadAllTickets();
    selectTicket(created.id);
  } else {
    const err = await res.json();
    alert('Error: ' + (err.message || 'Failed to create ticket'));
  }
}
