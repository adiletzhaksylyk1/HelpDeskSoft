// Mailboxes Module — Channels, IMAP/SMTP Ingestion & Admin Management

let mailboxChannels = [];
let adminMailboxesCache = [];

async function loadMailboxChannels() {
  try {
    const res = await apiFetch("/api/mailboxes", { headers: getAuthHeaders() });
    if (res.ok) {
      mailboxChannels = await res.json();
      renderSidebarChannels();
    }
  } catch (e) {
    console.error("Error fetching mailboxes:", e);
  }
}

function renderSidebarChannels() {
  const container = document.getElementById("sidebar-mailboxes-list");
  if (!container) return;
  container.innerHTML = "";
  mailboxChannels.forEach((mb) => {
    const item = document.createElement("div");
    const isActive = activeFilters.mailbox === mb.email;
    item.className = `nav-item ${isActive ? "active" : ""}`;
    item.id = `filter-mb-${mb.id}`;
    item.onclick = () => setFilter("mailbox", mb.email);
    item.innerHTML = `
      <span title="${escapeHtml(mb.email)}">${escapeHtml(mb.name)}</span>
      <span class="counter-pill" id="cnt-mb-${mb.id}">0</span>
    `;
    container.appendChild(item);
  });
  updateMailboxCounters();
}

function updateMailboxCounters() {
  if (!mailboxChannels) return;
  mailboxChannels.forEach((mb) => {
    const cnt = ticketStats.groups
      .filter((g) => g.mailboxId === mb.id)
      .reduce((n, g) => n + Number(g.total), 0);
    const el = document.getElementById(`cnt-mb-${mb.id}`);
    if (el) el.textContent = cnt;
  });
  const allMbCnt = document.getElementById("cnt-mb-all");
  if (allMbCnt) allMbCnt.textContent = ticketStats.total;
}

async function loadAdminMailboxesList(silent = false) {
  const tbody = document.getElementById("admin-mailboxes-tbody");
  if (!tbody) return;
  if (!silent) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align: center; color: var(--text-subtle);">Loading configured mailboxes...</td></tr>';
  }

  try {
    if (!allRoles || allRoles.length === 0) {
      await loadRoles();
    }
    const res = await apiFetch("/api/admin/mailboxes", {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      if (!silent)
        tbody.innerHTML =
          '<tr><td colspan="7" style="color: var(--danger);">Failed to load mailboxes</td></tr>';
      return;
    }

    const mbs = await res.json();
    adminMailboxesCache = mbs;
    tbody.innerHTML = "";
    if (mbs.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="text-align: center; color: var(--text-subtle); padding: 20px;">No mailboxes configured yet. Click "+ Connect Mailbox" to connect your first inbox.</td></tr>';
      return;
    }

    const dict = I18N[currentLang] || I18N.RU;

    mbs.forEach((mb) => {
      const tr = document.createElement("tr");
      const hasError = Boolean(mb.lastSyncError);
      const statusClass = hasError ? "error" : mb.isActive ? "online" : "idle";
      const statusText = hasError
        ? "Sync Error"
        : mb.isActive
          ? "Active"
          : "Disabled";
      const lastSyncStr = mb.lastSyncAt
        ? new Date(mb.lastSyncAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Never";

      const isGraph = mb.provider === "graph";
      const inboundDisplay = isGraph
        ? `<span class="provider-badge-m365">M365 Graph</span>`
        : `<span class="provider-badge-imap">IMAP</span> <small style="color: var(--text-muted);">${escapeHtml(mb.imapHost || "")}:${mb.imapPort || ""}</small>`;
      const outboundDisplay = isGraph
        ? `<span class="provider-badge-m365">Graph API</span>`
        : `<span class="provider-badge-imap">SMTP</span> <small style="color: var(--text-muted);">${escapeHtml(mb.smtpHost || "")}:${mb.smtpPort || ""}</small>`;

      // Multi-role selection for inline assignment
      const currentRoles = (mb.targetRole || "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      const isAll = currentRoles.length === 0;

      // Badges inside the trigger button
      let triggerBadgesHtml = "";
      if (isAll) {
        triggerBadgesHtml = `<span class="tbl-role-badge-all">${dict.all_departments_fallback || "(Все отделы / Общая очередь)"}</span>`;
      } else {
        triggerBadgesHtml = currentRoles
          .map(
            (role) => `
          <span class="tbl-role-badge">
            <span>${escapeHtml(role)}</span>
            <span class="role-chip-btn" data-ui-click="a91" data-ui-args="${escapeHtml(JSON.stringify([mb.id, role]))}" title="Удалить отдел">×</span>
          </span>
        `,
          )
          .join("");
      }

      // Popover role list
      let rolesListHtml = "";
      if (Array.isArray(allRoles)) {
        allRoles.forEach((r) => {
          if (r.name === "admin") return;
          const isSelected = currentRoles.includes(r.name);
          rolesListHtml += `
            <div class="role-multiselect-item ${isSelected ? "selected" : ""}" data-ui-click="a92" data-ui-args="${escapeHtml(JSON.stringify([mb.id, r.name]))}">
              <input type="checkbox" class="role-checkbox" ${isSelected ? "checked" : ""} data-ui-click="a93" data-ui-args="${escapeHtml(JSON.stringify([mb.id, r.name]))}">
              <div class="role-item-text">
                <div class="role-item-name" style="font-size: 12px;">${escapeHtml(r.name)}</div>
                ${r.description ? `<div class="role-item-desc" style="font-size: 10.5px;">${escapeHtml(r.description)}</div>` : ""}
              </div>
            </div>
          `;
        });
      }
      currentRoles.forEach((cr) => {
        if (!allRoles.some((r) => r.name === cr)) {
          rolesListHtml += `
            <div class="role-multiselect-item selected" data-ui-click="a94" data-ui-args="${escapeHtml(JSON.stringify([mb.id, cr]))}">
              <input type="checkbox" class="role-checkbox" checked data-ui-click="a95" data-ui-args="${escapeHtml(JSON.stringify([mb.id, cr]))}">
              <div class="role-item-text">
                <div class="role-item-name" style="font-size: 12px;">${escapeHtml(cr)}</div>
              </div>
            </div>
          `;
        }
      });

      const deptDisplay = `
        <div class="tbl-multiselect-wrap" id="tbl-ms-wrap-${mb.id}">
          <div class="tbl-multiselect-trigger" data-ui-click="a96" data-ui-args="${escapeHtml(JSON.stringify([mb.id]))}" title="Нажмите, чтобы выбрать отделы назначения">
            <div class="tbl-multiselect-chips">
              ${triggerBadgesHtml}
            </div>
            <svg class="tbl-multiselect-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="tbl-multiselect-popover" data-ui-click="a97">
            <div class="tbl-multiselect-header">
              <span class="tbl-ms-title">${dict.dept_modal_title || "Отделы назначения"}</span>
              <button type="button" class="tbl-ms-close-btn" data-ui-click="a98" data-ui-args="${escapeHtml(JSON.stringify([mb.id]))}">×</button>
            </div>
            <div class="role-multiselect-item ${isAll ? "selected" : ""}" data-ui-click="a99" data-ui-args="${escapeHtml(JSON.stringify([mb.id]))}">
              <input type="checkbox" class="role-checkbox" ${isAll ? "checked" : ""} data-ui-click="a100" data-ui-args="${escapeHtml(JSON.stringify([mb.id]))}">
              <div class="role-item-text">
                <div class="role-item-name" style="font-size: 12px;">${dict.all_departments_fallback || "(Все отделы / Общая очередь)"}</div>
              </div>
            </div>
            <div class="role-multiselect-separator"></div>
            ${rolesListHtml}
          </div>
        </div>
      `;

      tr.innerHTML = `
        <td><strong>${escapeHtml(mb.name)}</strong></td>
        <td><code>${escapeHtml(mb.email)}</code></td>
        <td>${deptDisplay}</td>
        <td>${inboundDisplay}</td>
        <td>${outboundDisplay}</td>
        <td>
          <span class="status-pill ${statusClass}" title="${hasError ? escapeHtml(mb.lastSyncError) : "Last sync: " + lastSyncStr}">
            ● ${statusText}
          </span>
          <div style="font-size: 10px; color: var(--text-subtle); margin-top: 2px;">Sync: ${lastSyncStr}</div>
          ${hasError ? `<div style="font-size: 10px; color: var(--danger); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(mb.lastSyncError)}">${escapeHtml(mb.lastSyncError)}</div>` : ""}
        </td>
        <td style="white-space: nowrap;">
          <button class="btn btn-secondary btn-sm" data-ui-click="a101" data-ui-args="${escapeHtml(JSON.stringify([mb.id, mb.name]))}" title="Test connection and ingest unread emails now">
            Sync
          </button>
          <button class="btn btn-danger btn-sm" data-ui-click="a102" data-ui-args="${escapeHtml(JSON.stringify([mb.id, mb.name]))}" style="margin-left: 4px;">
            ${dict.btn_delete || "Удалить"}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch {
    if (!silent)
      tbody.innerHTML =
        '<tr><td colspan="7" style="color: var(--danger);">Network error fetching mailboxes</td></tr>';
  }
}

async function changeMailboxDepartment(
  mailboxId,
  newRole,
  keepPopoverOpen = false,
) {
  if (!authState.user || !authState.user.isAdmin)
    return alert("Access restricted to administrators");
  try {
    const res = await apiFetch(`/api/admin/mailboxes/${mailboxId}`, {
      method: "PATCH",
      headers: getAuthHeaders(true),
      body: JSON.stringify({ target_role: newRole || null }),
    });
    if (res.ok) {
      showToast("Отделы назначения ящика успешно обновлены");
      await loadMailboxChannels();
      await loadAdminMailboxesList(true);
      if (keepPopoverOpen) {
        const wrap = document.getElementById(`tbl-ms-wrap-${mailboxId}`);
        if (wrap) wrap.classList.add("open");
      }
    } else {
      const err = await res.json();
      alert("Error: " + (err.message || "Failed to update mailbox department"));
      await loadAdminMailboxesList(true);
    }
  } catch (err) {
    alert("Failed to update mailbox department");
    await loadAdminMailboxesList(true);
  }
}

function toggleTableMailboxRoleDropdown(mailboxId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const targetWrap = document.getElementById(`tbl-ms-wrap-${mailboxId}`);
  if (!targetWrap) return;
  const isCurrentlyOpen = targetWrap.classList.contains("open");
  document.querySelectorAll(".tbl-multiselect-wrap.open").forEach((wrap) => {
    wrap.classList.remove("open");
    wrap.classList.remove("dropup");
  });
  if (!isCurrentlyOpen) {
    const rect = targetWrap.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 260 && rect.top > 260) {
      targetWrap.classList.add("dropup");
    }
    targetWrap.classList.add("open");
  }
}

function closeTableMailboxRoleDropdown(mailboxId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const targetWrap = document.getElementById(`tbl-ms-wrap-${mailboxId}`);
  if (targetWrap) targetWrap.classList.remove("open");
}

async function setTableMailboxRoleAll(mailboxId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  await changeMailboxDepartment(mailboxId, null, true);
}

async function toggleTableMailboxRole(mailboxId, roleName, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const mb = adminMailboxesCache.find((m) => m.id === mailboxId);
  const currentRoles = (mb && mb.targetRole ? mb.targetRole : "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const idx = currentRoles.indexOf(roleName);
  if (idx >= 0) {
    currentRoles.splice(idx, 1);
  } else {
    currentRoles.push(roleName);
  }

  const newRoleStr = currentRoles.length > 0 ? currentRoles.join(",") : null;
  await changeMailboxDepartment(mailboxId, newRoleStr, true);
}

async function removeTableMailboxRole(mailboxId, roleName, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const mb = adminMailboxesCache.find((m) => m.id === mailboxId);
  const currentRoles = (mb && mb.targetRole ? mb.targetRole : "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const idx = currentRoles.indexOf(roleName);
  if (idx >= 0) {
    currentRoles.splice(idx, 1);
  }

  const newRoleStr = currentRoles.length > 0 ? currentRoles.join(",") : null;
  await changeMailboxDepartment(mailboxId, newRoleStr, false);
}

async function testSyncMailbox(id, name, btnEl) {
  const btn = btnEl || (typeof event !== "undefined" ? event?.target : null);
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "...";
    }
    const res = await apiFetch(`/api/admin/mailboxes/${id}/sync`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Синхронизация "${name}" завершена: ${data.message}`);
      await loadAdminMailboxesList(true);
      await loadAllTickets();
      await loadMailboxChannels();
    } else {
      showToast(`Ошибка: ${data.message || data.error}`);
      await loadAdminMailboxesList(true);
    }
  } catch {
    showToast("Сетевая ошибка при проверке синхронизации");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Sync";
    }
  }
}

async function deleteMailbox(id, name) {
  if (
    !confirm(
      `Are you sure you want to remove mailbox "${name}"? Helpdesk will stop polling this inbox.`,
    )
  )
    return;
  try {
    const res = await apiFetch(`/api/admin/mailboxes/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      await loadAdminMailboxesList();
      await loadMailboxChannels();
      await loadAllTickets();
    } else {
      const err = await res.json();
      alert("Error: " + (err.message || "Failed to delete mailbox"));
    }
  } catch {
    alert("Failed to delete mailbox");
  }
}

let currentMailboxProvider = "graph";

function selectMailboxProvider(provider) {
  currentMailboxProvider = provider;
  const btnGraph = document.getElementById("btn-provider-graph");
  const btnImap = document.getElementById("btn-provider-imap");
  const secGraph = document.getElementById("section-graph-fields");
  const secImap = document.getElementById("section-imap-fields");
  const statusEl = document.getElementById("mb-test-status");

  if (btnGraph && btnImap) {
    btnGraph.classList.toggle("active", provider === "graph");
    btnImap.classList.toggle("active", provider === "imap");
  }

  if (secGraph && secImap) {
    secGraph.style.display = provider === "graph" ? "block" : "none";
    secImap.style.display = provider === "imap" ? "block" : "none";
  }

  if (statusEl) {
    const message = document.createElement("span");
    message.dataset.i18n = "mailbox_test_before_save";
    message.textContent = t("mailbox_test_before_save");
    statusEl.replaceChildren(message);
  }
}

function openNewMailboxModal() {
  if (!authState.user || !authState.user.isAdmin)
    return alert("Access restricted to administrators");
  document.getElementById("mb-name").value = "";
  document.getElementById("mb-email").value = "";
  const tenantInput = document.getElementById("mb-ms-tenant-id");
  if (tenantInput) tenantInput.value = "";
  const clientInput = document.getElementById("mb-ms-client-id");
  if (clientInput) clientInput.value = "";
  const secretInput = document.getElementById("mb-ms-client-secret");
  if (secretInput) secretInput.value = "";

  document.getElementById("mb-imap-user").value = "";
  document.getElementById("mb-imap-pass").value = "";
  document.getElementById("mb-smtp-user").value = "";
  document.getElementById("mb-smtp-pass").value = "";
  document.getElementById("mb-same-smtp").checked = true;
  document.getElementById("smtp-custom-fields").style.display = "none";

  initRoleMultiselect([]);

  selectMailboxProvider("graph");
  applyMailboxPreset("astanait");
  document.getElementById("modal-new-mailbox").classList.add("active");
}

async function testMailboxConnection(btnEl) {
  const btn = btnEl || document.getElementById("btn-test-conn");
  const statusEl = document.getElementById("mb-test-status");
  const email = document.getElementById("mb-email").value.trim();

  if (!email) {
    if (statusEl)
      statusEl.innerHTML =
        '<span style="color: var(--danger);">Укажите Corporate Email Address</span>';
    return;
  }

  const payload = { provider: currentMailboxProvider, email };

  if (currentMailboxProvider === "graph") {
    const msTenantId = (
      document.getElementById("mb-ms-tenant-id")?.value || ""
    ).trim();
    const msClientId = (
      document.getElementById("mb-ms-client-id")?.value || ""
    ).trim();
    const msClientSecret = (
      document.getElementById("mb-ms-client-secret")?.value || ""
    ).trim();

    if (!msTenantId || !msClientId || !msClientSecret) {
      if (statusEl)
        statusEl.innerHTML =
          '<span style="color: var(--danger);">Заполните Tenant ID, Client ID и Client Secret</span>';
      return;
    }

    payload.msTenantId = msTenantId;
    payload.msClientId = msClientId;
    payload.msClientSecret = msClientSecret;
  } else {
    const imapHost = (
      document.getElementById("mb-imap-host")?.value || ""
    ).trim();
    const imapPort =
      parseInt(document.getElementById("mb-imap-port")?.value, 10) || 993;
    const imapSecure = document.getElementById("mb-imap-secure")?.checked;
    const imapUser = (
      document.getElementById("mb-imap-user")?.value || ""
    ).trim();
    const imapPassword = document.getElementById("mb-imap-pass")?.value || "";

    if (!imapHost || !imapUser || !imapPassword) {
      if (statusEl)
        statusEl.innerHTML =
          '<span style="color: var(--danger);">Заполните IMAP хост, пользователя и пароль</span>';
      return;
    }

    payload.imapHost = imapHost;
    payload.imapPort = imapPort;
    payload.imapSecure = imapSecure;
    payload.imapUser = imapUser;
    payload.imapPassword = imapPassword;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("mailbox_testing");
    }
    if (statusEl) {
      statusEl.innerHTML =
        '<span style="color: var(--primary);">Тестирование подключения к почтовому серверу...</span>';
    }

    const res = await apiFetch("/api/admin/mailboxes/test-connection", {
      method: "POST",
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--success); font-weight: 600;">${escapeHtml(data.message)}</span>`;
      }
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--danger); font-weight: 600;">${escapeHtml(data.message || data.error || "Не удалось подключиться")}</span>`;
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color: var(--danger);">Сетевая ошибка при проверке</span>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("mailbox_test_connection");
    }
  }
}

function applyMailboxPreset(preset) {
  const imapHost = document.getElementById("mb-imap-host");
  const imapPort = document.getElementById("mb-imap-port");
  const imapSec = document.getElementById("mb-imap-secure");
  const smtpHost = document.getElementById("mb-smtp-host");
  const smtpPort = document.getElementById("mb-smtp-port");
  const smtpSec = document.getElementById("mb-smtp-secure");

  if (preset === "astanait") {
    if (imapHost) imapHost.value = "outlook.office365.com";
    if (imapPort) imapPort.value = "993";
    if (imapSec) imapSec.checked = true;
    if (smtpHost) smtpHost.value = "smtp.office365.com";
    if (smtpPort) smtpPort.value = "587";
    if (smtpSec) smtpSec.checked = false;
  } else if (preset === "gmail") {
    if (imapHost) imapHost.value = "imap.gmail.com";
    if (imapPort) imapPort.value = "993";
    if (imapSec) imapSec.checked = true;
    if (smtpHost) smtpHost.value = "smtp.gmail.com";
    if (smtpPort) smtpPort.value = "465";
    if (smtpSec) smtpSec.checked = true;
  }
}

function onMailboxEmailInput(val) {
  const userField = document.getElementById("mb-imap-user");
  if (userField && (!userField.value || userField.value.includes("@"))) {
    userField.value = val;
  }
}

function toggleSameSmtp(isSame) {
  const customFields = document.getElementById("smtp-custom-fields");
  if (customFields) customFields.style.display = isSame ? "none" : "block";
}

async function submitNewMailbox() {
  if (!authState.user || !authState.user.isAdmin)
    return alert("Access restricted to administrators");
  const name = document.getElementById("mb-name").value.trim();
  const email = document.getElementById("mb-email").value.trim();

  if (!name || !email) {
    return alert("Please specify Channel Name and Corporate Email Address");
  }

  const targetRole = (
    document.getElementById("mb-target-role")?.value || ""
  ).trim();

  const payload = {
    name,
    email,
    provider: currentMailboxProvider,
    target_role: targetRole || null,
    isActive: true,
  };

  if (currentMailboxProvider === "graph") {
    const msTenantId = (
      document.getElementById("mb-ms-tenant-id")?.value || ""
    ).trim();
    const msClientId = (
      document.getElementById("mb-ms-client-id")?.value || ""
    ).trim();
    const msClientSecret = (
      document.getElementById("mb-ms-client-secret")?.value || ""
    ).trim();

    if (!msTenantId || !msClientId || !msClientSecret) {
      return alert(
        "Please enter Tenant ID, Client ID and Client Secret for Microsoft 365",
      );
    }

    payload.msTenantId = msTenantId;
    payload.msClientId = msClientId;
    payload.msClientSecret = msClientSecret;
  } else {
    const imapHost = (
      document.getElementById("mb-imap-host")?.value || ""
    ).trim();
    const imapPort =
      parseInt(document.getElementById("mb-imap-port")?.value, 10) || 993;
    const imapSecure = document.getElementById("mb-imap-secure")?.checked;
    const imapUser = (
      document.getElementById("mb-imap-user")?.value || ""
    ).trim();
    const imapPassword = document.getElementById("mb-imap-pass")?.value || "";

    const sameSmtp = document.getElementById("mb-same-smtp")?.checked;
    const preset = document.getElementById("mb-preset")?.value;
    const smtpHost = sameSmtp
      ? preset === "gmail"
        ? "smtp.gmail.com"
        : "smtp.office365.com"
      : document.getElementById("mb-smtp-host")?.value.trim() || "";
    const smtpPort = sameSmtp
      ? preset === "gmail"
        ? 465
        : 587
      : parseInt(document.getElementById("mb-smtp-port")?.value, 10) || 587;
    const smtpSecure = sameSmtp
      ? preset === "gmail"
      : Boolean(document.getElementById("mb-smtp-secure")?.checked);
    const smtpUser = sameSmtp
      ? imapUser
      : document.getElementById("mb-smtp-user")?.value.trim() || imapUser;
    const smtpPassword = sameSmtp
      ? imapPassword
      : document.getElementById("mb-smtp-pass")?.value || imapPassword;

    if (!imapHost || !imapUser || !imapPassword) {
      return alert("Please complete all required IMAP mailbox fields");
    }

    payload.imapHost = imapHost;
    payload.imapPort = imapPort;
    payload.imapUser = imapUser;
    payload.imapPassword = imapPassword;
    payload.imapSecure = imapSecure;
    payload.smtpHost = smtpHost;
    payload.smtpPort = smtpPort;
    payload.smtpUser = smtpUser;
    payload.smtpPassword = smtpPassword;
    payload.smtpSecure = smtpSecure;
  }

  try {
    const res = await apiFetch("/api/admin/mailboxes", {
      method: "POST",
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      closeModals();
      await loadAdminMailboxesList();
      await loadMailboxChannels();
      showToast(`Mailbox "${name}" (${email}) connected successfully!`);
    } else {
      const err = await res.json();
      alert("Error: " + (err.message || "Failed to connect mailbox"));
    }
  } catch {
    alert("Network error connecting mailbox");
  }
}

// --- Role / Department Multi-Select Component Logic ---
let selectedMailboxRoles = [];

function toggleRoleMultiselect(e) {
  if (e) e.stopPropagation();
  const container = document.getElementById("mb-role-multiselect-container");
  if (container) {
    container.classList.toggle("open");
  }
}

function closeRoleMultiselect() {
  const container = document.getElementById("mb-role-multiselect-container");
  if (container) {
    container.classList.remove("open");
  }
}

function selectRoleMultiselectAll(e) {
  if (e) e.stopPropagation();
  selectedMailboxRoles = [];
  renderRoleMultiselectUI();
}

function onRoleAllCheckboxChange(cb, e) {
  if (e) e.stopPropagation();
  selectedMailboxRoles = [];
  renderRoleMultiselectUI();
}

function toggleRoleSelection(roleName, e) {
  if (e) e.stopPropagation();
  const idx = selectedMailboxRoles.indexOf(roleName);
  if (idx >= 0) {
    selectedMailboxRoles.splice(idx, 1);
  } else {
    selectedMailboxRoles.push(roleName);
  }
  renderRoleMultiselectUI();
}

function removeRoleChip(roleName, e) {
  if (e) e.stopPropagation();
  const idx = selectedMailboxRoles.indexOf(roleName);
  if (idx >= 0) {
    selectedMailboxRoles.splice(idx, 1);
  }
  renderRoleMultiselectUI();
}

function renderRoleMultiselectUI() {
  const tagsContainer = document.getElementById("mb-role-multiselect-tags");
  const countBadge = document.getElementById("mb-role-count-badge");
  const checkAll = document.getElementById("mb-role-check-all");
  const itemAll = document.getElementById("mb-role-item-all");
  const hiddenInput = document.getElementById("mb-target-role");
  const dict = I18N[currentLang] || I18N.RU;

  const isAll = selectedMailboxRoles.length === 0;

  if (checkAll) checkAll.checked = isAll;
  if (itemAll) itemAll.classList.toggle("selected", isAll);

  if (tagsContainer) {
    if (isAll) {
      tagsContainer.innerHTML = `<span class="role-placeholder" id="mb-role-placeholder">${dict.all_departments_fallback || "(Все отделы / Общая очередь)"}</span>`;
    } else {
      tagsContainer.innerHTML = selectedMailboxRoles
        .map(
          (role) => `
        <span class="role-chip">
          <span>${escapeHtml(role)}</span>
          <span class="role-chip-btn" data-ui-click="a103" data-ui-args="${escapeHtml(JSON.stringify([role]))}" title="Удалить">×</span>
        </span>
      `,
        )
        .join("");
    }
  }

  if (countBadge) {
    if (isAll) {
      countBadge.style.display = "none";
    } else {
      countBadge.textContent = selectedMailboxRoles.length;
      countBadge.style.display = "inline-block";
    }
  }

  if (hiddenInput) {
    hiddenInput.value = selectedMailboxRoles.join(",");
  }

  // Update checkbox states in options list
  const optionsContainer = document.getElementById(
    "mb-role-multiselect-options",
  );
  if (optionsContainer) {
    optionsContainer
      .querySelectorAll(".role-multiselect-item")
      .forEach((item) => {
        const roleName = item.dataset.roleName;
        const isSelected = selectedMailboxRoles.includes(roleName);
        item.classList.toggle("selected", isSelected);
        const cb = item.querySelector(".role-checkbox");
        if (cb) cb.checked = isSelected;
      });
  }
}

function initRoleMultiselect(initialRoles = []) {
  selectedMailboxRoles = Array.isArray(initialRoles) ? [...initialRoles] : [];
  const optionsContainer = document.getElementById(
    "mb-role-multiselect-options",
  );
  if (optionsContainer) {
    optionsContainer.innerHTML = "";
    if (Array.isArray(allRoles)) {
      allRoles.forEach((r) => {
        if (r.name === "admin") return;
        const item = document.createElement("div");
        item.className = "role-multiselect-item";
        item.dataset.roleName = r.name;
        item.onclick = (e) => toggleRoleSelection(r.name, e);
        item.innerHTML = `
          <input type="checkbox" class="role-checkbox" data-ui-click="a104" data-ui-args="${escapeHtml(JSON.stringify([r.name]))}">
          <div class="role-item-text">
            <div class="role-item-name">${escapeHtml(r.name)}</div>
            ${r.description ? `<div class="role-item-desc">${escapeHtml(r.description)}</div>` : ""}
          </div>
        `;
        optionsContainer.appendChild(item);
      });
    }
  }
  renderRoleMultiselectUI();
}

// Global click-outside listener to close dropdowns
document.addEventListener("click", (e) => {
  const container = document.getElementById("mb-role-multiselect-container");
  if (container && !container.contains(e.target)) {
    container.classList.remove("open");
  }
  document.querySelectorAll(".tbl-multiselect-wrap.open").forEach((wrap) => {
    if (!wrap.contains(e.target)) {
      wrap.classList.remove("open");
    }
  });
});
