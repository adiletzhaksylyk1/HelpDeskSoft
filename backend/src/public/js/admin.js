// Admin Module — Staff Directory, Roles & Admin Modal Tabs

let users = [];
let allRoles = [];
let activeAdminTab = 'staff';
let adminModalPollInterval = null;

async function loadUsers() {
  try {
    const res = await fetch('/api/users', { headers: getAuthHeaders() });
    if (res.ok) {
      users = await res.json();
      renderAssigneeDropdowns();
    }
  } catch (e) {
    console.error('Error fetching users:', e);
  }
}

async function loadRoles() {
  try {
    const res = await fetch('/api/admin/roles', { headers: getAuthHeaders() });
    if (res.ok) {
      allRoles = await res.json();
      populateNewStaffRoleDropdown();
      renderAssigneeDropdowns();
    }
  } catch (e) {
    console.error('Error fetching roles:', e);
  }
}

function populateNewStaffRoleDropdown() {
  const sel = document.getElementById('ns-role');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '';
  if (!allRoles || allRoles.length === 0) {
    sel.innerHTML = `
      <option value="admin">Administrator (Full Access & Management)</option>
    `;
    return;
  }
  allRoles.forEach((r) => {
    if (r.name.toLowerCase() === 'employee') return;
    const opt = document.createElement('option');
    opt.value = r.name;
    opt.textContent = `${r.name}${r.isAdmin ? ' (Administrator)' : ''}`;
    if (r.name === currentVal) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  });
  if (!sel.value && sel.options.length > 0) {
    const nonAdminOpt = Array.from(sel.options).find((opt) => opt.value !== 'admin');
    if (nonAdminOpt) {
      nonAdminOpt.selected = true;
    } else {
      sel.options[0].selected = true;
    }
  }
}

function formatUserRoleLabel(role) {
  if (!role) return '';
  const dict = I18N[currentLang] || I18N.RU;
  const lower = role.toLowerCase();
  if (lower === 'admin') {
    return dict.role_admin || 'Администратор';
  }
  const found = (allRoles || []).find((r) => r.name.toLowerCase() === lower);
  if (found && found.name) {
    return found.name;
  }
  return role;
}

function renderAssigneeDropdowns() {
  const select = document.getElementById('d-assignee-select');
  if (!select) return;
  const currentVal = select.value;
  const dict = I18N[currentLang] || I18N.RU;
  select.innerHTML = `<option value="">${dict.unassigned || '(Не назначен)'}</option>`;
  users.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u.id;
    const roleLabel = formatUserRoleLabel(u.role);
    opt.textContent = roleLabel ? `${u.name} (${roleLabel})` : u.name;
    select.appendChild(opt);
  });
  if (currentVal) select.value = currentVal;
}


async function openAdminModal(tab = 'staff') {
  if (!authState.user || authState.user.role !== 'admin') return alert('Access restricted to administrators');
  document.getElementById('modal-admin').classList.add('active');
  await loadRoles();
  switchAdminTab(tab);
}

function switchAdminTab(tab) {
  activeAdminTab = tab;
  const isStaff = tab === 'staff';
  const isRoles = tab === 'roles';
  const isMb = tab === 'mailboxes';

  const tabBtnStaff = document.getElementById('tab-btn-staff');
  const tabBtnRoles = document.getElementById('tab-btn-roles');
  const tabBtnMb = document.getElementById('tab-btn-mailboxes');
  if (tabBtnStaff) tabBtnStaff.classList.toggle('active', isStaff);
  if (tabBtnRoles) tabBtnRoles.classList.toggle('active', isRoles);
  if (tabBtnMb) tabBtnMb.classList.toggle('active', isMb);

  const contentStaff = document.getElementById('tab-content-staff');
  const contentRoles = document.getElementById('tab-content-roles');
  const contentMb = document.getElementById('tab-content-mailboxes');
  if (contentStaff) contentStaff.style.display = isStaff ? 'block' : 'none';
  if (contentRoles) contentRoles.style.display = isRoles ? 'block' : 'none';
  if (contentMb) contentMb.style.display = isMb ? 'block' : 'none';

  const btnAddStaff = document.getElementById('btn-add-staff');
  const btnAddRole = document.getElementById('btn-add-role');
  const btnAddMb = document.getElementById('btn-add-mailbox');
  if (btnAddStaff) btnAddStaff.style.display = isStaff ? 'inline-flex' : 'none';
  if (btnAddRole) btnAddRole.style.display = isRoles ? 'inline-flex' : 'none';
  if (btnAddMb) btnAddMb.style.display = isMb ? 'inline-flex' : 'none';

  if (isStaff) {
    loadAdminStaffList();
  } else if (isRoles) {
    loadAdminRolesList();
  } else {
    loadAdminMailboxesList();
  }

  if (adminModalPollInterval) clearInterval(adminModalPollInterval);
  adminModalPollInterval = setInterval(() => {
    const modal = document.getElementById('modal-admin');
    if (!modal || !modal.classList.contains('active')) {
      clearInterval(adminModalPollInterval);
      adminModalPollInterval = null;
      return;
    }
    if (activeAdminTab === 'mailboxes') {
      loadAdminMailboxesList(true);
    }
  }, 4000);
}

async function loadAdminStaffList() {
  const tbody = document.getElementById('admin-staff-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-subtle);">Loading staff directory...</td></tr>';

  try {
    if (!allRoles || allRoles.length === 0) await loadRoles();
    const res = await fetch('/api/admin/users', { headers: getAuthHeaders() });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" style="color: var(--danger);">Failed to load staff list</td></tr>';
      return;
    }

    const staff = await res.json();
    tbody.innerHTML = '';
    if (staff.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-subtle);">No staff members found</td></tr>';
      return;
    }

    const dict = I18N[currentLang] || I18N.RU;
    const youLabel = currentLang === 'KZ' ? 'Сіз' : currentLang === 'EN' ? 'You' : 'Вы';
    staff.forEach((u) => {
      const tr = document.createElement('tr');
      const isSelf = authState.user && authState.user.id === u.id;

      // Build options from allRoles
      let optionsHtml = allRoles.map((r) => `
        <option value="${escapeHtml(r.name)}" ${u.role === r.name ? 'selected' : ''}>
          ${escapeHtml(r.name)}${r.isAdmin ? ' (Admin)' : ''}
        </option>
      `).join('');

      // If user has a custom role not yet in allRoles, append it
      if (!allRoles.some((r) => r.name === u.role)) {
        optionsHtml += `<option value="${escapeHtml(u.role)}" selected>${escapeHtml(u.role)}</option>`;
      }

      tr.innerHTML = `
        <td><strong>${escapeHtml(u.name)}</strong>${isSelf ? ` <span style="font-size: 10px; color: var(--primary);">(${youLabel})</span>` : ''}</td>
        <td><code>${escapeHtml(u.email)}</code></td>
        <td>
          <select class="input-select" onchange="changeStaffRole('${u.id}', this.value)" ${isSelf ? 'disabled' : ''}>
            ${optionsHtml}
          </select>
        </td>
        <td><span class="counter-pill">${u.activeTicketsCount || 0}</span></td>
        <td>
          <div style="display: inline-flex; gap: 6px; align-items: center;">
            <button class="btn btn-secondary btn-sm" onclick="resetStaffPassword('${u.id}', '${escapeHtml(u.name)}')" ${isSelf ? 'disabled title="Нельзя сбросить пароль себе"' : ''} title="${dict.btn_reset_pass_title || 'Сбросить пароль'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 3px;"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
              ${dict.btn_reset_pass || 'Сбросить'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteStaffMember('${u.id}', '${escapeHtml(u.name)}')" ${isSelf ? 'disabled title="Cannot delete yourself"' : ''}>
              ${dict.btn_delete || 'Удалить'}
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" style="color: var(--danger);">Network error fetching staff</td></tr>';
  }
}

async function loadAdminRolesList() {
  const tbody = document.getElementById('admin-roles-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-subtle);">Loading roles & departments...</td></tr>';
  const dict = I18N[currentLang] || I18N.RU;

  try {
    const res = await fetch('/api/admin/roles', { headers: getAuthHeaders() });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" style="color: var(--danger);">Failed to load roles</td></tr>';
      return;
    }
    allRoles = await res.json();
    populateNewStaffRoleDropdown();
    tbody.innerHTML = '';
    if (allRoles.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-subtle);">No roles found</td></tr>';
      return;
    }

    allRoles.forEach((r) => {
      const tr = document.createElement('tr');
      const isProtected = r.name === 'admin';
      const accessLabel = r.isAdmin ? (dict.access_admin || 'Администратор') : (dict.access_staff || 'Сотрудник поддержки');
      const badgeClass = r.isAdmin ? 'role-tag admin' : 'role-tag dept';

      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="color: var(--text);">${escapeHtml(r.name)}</strong>
            <span class="${badgeClass}" style="font-size: 10px; padding: 2px 6px;">${r.isAdmin ? 'ADMIN' : 'DEPT'}</span>
            ${isProtected ? '<span class="badge" style="font-size: 10px; color: var(--text-muted); background: var(--surface-hover); padding: 1px 5px; border-radius: 4px;">System</span>' : ''}
          </div>
        </td>
        <td style="color: var(--text-secondary); max-width: 250px;">${escapeHtml(r.description || '—')}</td>
        <td>
          <span style="font-size: 12.5px; font-weight: 500; color: ${r.isAdmin ? 'var(--primary)' : 'var(--text-secondary)'};">
            ${escapeHtml(accessLabel)}
          </span>
        </td>
        <td><span class="counter-pill">${r.userCount || 0}</span></td>
        <td>
          ${isProtected
          ? `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Protected</span>`
          : `<button class="btn btn-danger btn-sm" onclick="deleteRole('${r.id}', '${escapeHtml(r.name)}', ${r.userCount || 0})" title="Delete this role / department">
                ${dict.btn_delete || 'Удалить'}
              </button>`
        }
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load roles:', err);
    tbody.innerHTML = '<tr><td colspan="5" style="color: var(--danger);">Network error fetching roles</td></tr>';
  }
}

function openNewRoleModal() {
  if (!authState.user || authState.user.role !== 'admin') return alert('Access restricted to administrators');
  document.getElementById('nr-name').value = '';
  document.getElementById('nr-desc').value = '';
  document.getElementById('nr-is-admin').checked = false;
  document.getElementById('modal-new-role').classList.add('active');
}

async function submitNewRole() {
  if (!authState.user || authState.user.role !== 'admin') return alert('Access restricted to administrators');
  const dict = I18N[currentLang] || I18N.RU;
  const name = document.getElementById('nr-name').value.trim();
  const description = document.getElementById('nr-desc').value.trim();
  const isAdmin = document.getElementById('nr-is-admin').checked;

  if (!name) return alert('Please enter role / department name');

  try {
    const res = await fetch('/api/admin/roles', {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ name, description, is_admin: isAdmin }),
    });

    if (res.ok) {
      document.getElementById('modal-new-role').classList.remove('active');
      await loadRoles();
      await loadAdminRolesList();
      showToast(dict.role_created || 'Роль успешно создана');
    } else {
      const err = await res.json();
      alert('Error: ' + (err.message || 'Failed to create role'));
    }
  } catch (err) {
    alert('Failed to create role: ' + err.message);
  }
}

async function deleteRole(id, name, userCount = 0) {
  if (!authState.user || authState.user.role !== 'admin') return alert('Access restricted to administrators');
  const dict = I18N[currentLang] || I18N.RU;

  let confirmMsg = `Удалить роль / отдел "${name}"?`;
  if (userCount > 0) {
    confirmMsg = `В этой роли/отделе числится сотрудников: ${userCount}.\nПри удалении роли они будут автоматически переведены в основной отдел поддержки.\n\nВы уверены, что хотите удалить роль "${name}"?`;
  }
  if (!confirm(confirmMsg)) return;

  try {
    const url = userCount > 0 ? `/api/admin/roles/${id}?reassign=true` : `/api/admin/roles/${id}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (res.ok) {
      await loadRoles();
      await loadAdminRolesList();
      if (activeAdminTab === 'staff') {
        await loadAdminStaffList();
      }
      showToast(dict.role_deleted || 'Роль успешно удалена');
    } else {
      const err = await res.json();
      alert('Error: ' + (err.message || 'Failed to delete role'));
    }
  } catch (err) {
    alert('Failed to delete role: ' + err.message);
  }
}

async function changeStaffRole(userId, newRole) {
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      await loadAdminStaffList();
      await loadUsers();
    } else {
      const err = await res.json();
      alert('Error: ' + (err.message || 'Failed to update role'));
    }
  } catch {
    alert('Failed to update role');
  }
}

async function deleteStaffMember(userId, name) {
  if (!confirm(`Are you sure you want to remove ${name}?`)) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (res.ok) {
      await loadAdminStaffList();
      await loadUsers();
      await loadAllTickets();
    } else {
      const err = await res.json();
      alert('Error: ' + (err.message || 'Failed to remove user'));
    }
  } catch {
    alert('Failed to delete staff member');
  }
}

async function resetStaffPassword(userId, name) {
  const dict = I18N[currentLang] || I18N.RU;
  const rawPrompt = dict.confirm_reset_pass || 'Сбросить пароль для сотрудника «{name}»?\nПри следующем входе в систему ему потребуется создать новый постоянный пароль.';
  const msg = rawPrompt.replace('{name}', name);
  if (!confirm(msg)) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof showToast === 'function') {
        showToast(data.message || (dict.reset_pass_success || 'Пароль успешно сброшен'));
      } else {
        alert(data.message || 'Password reset successfully');
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert('Error: ' + (err.message || 'Failed to reset password'));
    }
  } catch {
    alert('Failed to reset password');
  }
}

async function openNewStaffModal() {
  if (!authState.user || authState.user.role !== 'admin') return alert('Access restricted to administrators');
  await loadRoles();
  document.getElementById('modal-new-staff').classList.add('active');
}

async function submitNewStaff() {
  if (!authState.user || authState.user.role !== 'admin') return alert('Access restricted to administrators');
  const name = document.getElementById('ns-name') ? document.getElementById('ns-name').value.trim() : '';
  const email = document.getElementById('ns-email') ? document.getElementById('ns-email').value.trim() : '';
  const roleSelect = document.getElementById('ns-role');
  const role = roleSelect ? roleSelect.value : '';
  if (!name || !email) return alert('Please enter name and corporate email');
  if (!role) return alert('Please select a role or department');

  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ name, email, role, is_active: true }),
  });
  if (res.ok) {
    closeModals();
    await loadUsers();
    if (document.getElementById('modal-admin').classList.contains('active')) await loadAdminStaffList();
    alert(`Staff member ${name} created! They can now log in using their corporate email.`);
  } else {
    const err = await res.json();
    alert('Error: ' + (err.message || 'Failed to add staff'));
  }
}

