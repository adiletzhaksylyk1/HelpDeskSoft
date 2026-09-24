// Trusted event functions. Untrusted values are passed as JSON data, never code.
const uiActions = {
  a0: (event, element, args) => {
    return toggleAuthLanguageDropdown(event);
  },
  a1: (event, element, args) => {
    setLanguage("RU");
    closeLanguageDropdown();
  },
  a2: (event, element, args) => {
    setLanguage("KZ");
    closeLanguageDropdown();
  },
  a3: (event, element, args) => {
    setLanguage("EN");
    closeLanguageDropdown();
  },
  a4: (event, element, args) => {
    return toggleTheme();
  },
  a5: (event, element, args) => {
    return handleAuthPageSubmit(event);
  },
  a6: (event, element, args) => {
    return toggleMobileSidebar();
  },
  a7: (event, element, args) => {
    return returnToHome(event);
  },
  a8: (event, element, args) => {
    return toggleLanguageDropdown(event);
  },
  a9: (event, element, args) => {
    setLanguage("RU");
    closeLanguageDropdown();
  },
  a10: (event, element, args) => {
    setLanguage("KZ");
    closeLanguageDropdown();
  },
  a11: (event, element, args) => {
    setLanguage("EN");
    closeLanguageDropdown();
  },
  a12: (event, element, args) => {
    return toggleTheme();
  },
  a13: (event, element, args) => {
    return toggleNotifications(event);
  },
  a14: (event, element, args) => {
    return markAllNotificationsRead();
  },
  a15: (event, element, args) => {
    return clearAllNotifications();
  },
  a16: (event, element, args) => {
    return openNewTicketModal();
  },
  a17: (event, element, args) => {
    return closeMobileSidebar();
  },
  a18: (event, element, args) => {
    return toggleSidebarGroup("group-views");
  },
  a19: (event, element, args) => {
    return setScope("all");
  },
  a20: (event, element, args) => {
    return setScope("my");
  },
  a21: (event, element, args) => {
    return setScope("unassigned");
  },
  a22: (event, element, args) => {
    return toggleSidebarGroup("group-status");
  },
  a23: (event, element, args) => {
    return setFilter("status", "");
  },
  a24: (event, element, args) => {
    return setFilter("status", "WAITING");
  },
  a25: (event, element, args) => {
    return setFilter("status", "IN_PROGRESS");
  },
  a26: (event, element, args) => {
    return setFilter("status", "RESOLVED");
  },
  a27: (event, element, args) => {
    return toggleSidebarGroup("group-priority");
  },
  a28: (event, element, args) => {
    return setFilter("priority", "");
  },
  a29: (event, element, args) => {
    return setFilter("priority", "CRITICAL");
  },
  a30: (event, element, args) => {
    return setFilter("priority", "HIGH");
  },
  a31: (event, element, args) => {
    return setFilter("priority", "MEDIUM");
  },
  a32: (event, element, args) => {
    return setFilter("priority", "LOW");
  },
  a33: (event, element, args) => {
    return toggleSidebarGroup("nav-channels-section");
  },
  a34: (event, element, args) => {
    return setFilter("mailbox", "");
  },
  a35: (event, element, args) => {
    return toggleSidebarGroup("nav-admin-section");
  },
  a36: (event, element, args) => {
    return openAdminModal("staff");
  },
  a37: (event, element, args) => {
    return openAdminModal("roles");
  },
  a38: (event, element, args) => {
    return openAdminModal("mailboxes");
  },
  a39: (event, element, args) => {
    return loadAllTickets();
  },
  a40: (event, element, args) => {
    return searchTickets(event);
  },
  a41: (event, element, args) => {
    return clearSearch();
  },
  a42: (event, element, args) => {
    return changeTicketPage(-1);
  },
  a43: (event, element, args) => {
    return changeTicketPage(1);
  },
  a44: (event, element, args) => {
    return closeMobileTicketDetail();
  },
  a45: (event, element, args) => {
    return handleReplyFilesSelected(element.files);
  },
  a46: (event, element, args) => {
    document.getElementById("reply-file-input").click();
  },
  a47: (event, element, args) => {
    return submitReply();
  },
  a48: (event, element, args) => {
    return saveTicketChanges();
  },
  a49: (event, element, args) => {
    return quickResolveTicket();
  },
  a50: (event, element, args) => {
    return deleteCurrentTicket();
  },
  a51: (event, element, args) => {
    return handleMetaFieldChange("status");
  },
  a52: (event, element, args) => {
    return handleMetaFieldChange("priority");
  },
  a53: (event, element, args) => {
    return handleMetaFieldChange("assignee");
  },
  a54: (event, element, args) => {
    return openNewStaffModal();
  },
  a55: (event, element, args) => {
    return openNewRoleModal();
  },
  a56: (event, element, args) => {
    return openNewMailboxModal();
  },
  a57: (event, element, args) => {
    return switchAdminTab("staff");
  },
  a58: (event, element, args) => {
    return switchAdminTab("roles");
  },
  a59: (event, element, args) => {
    return switchAdminTab("mailboxes");
  },
  a60: (event, element, args) => {
    return closeModals();
  },
  a61: (event, element, args) => {
    return closeModals();
  },
  a62: (event, element, args) => {
    return submitNewTicket();
  },
  a63: (event, element, args) => {
    return closeModals();
  },
  a64: (event, element, args) => {
    return submitNewStaff();
  },
  a65: (event, element, args) => {
    return closeModals();
  },
  a66: (event, element, args) => {
    return submitNewRole();
  },
  a67: (event, element, args) => {
    return selectMailboxProvider("graph");
  },
  a68: (event, element, args) => {
    return selectMailboxProvider("imap");
  },
  a69: (event, element, args) => {
    return onMailboxEmailInput(element.value);
  },
  a70: (event, element, args) => {
    return toggleRoleMultiselect(event);
  },
  a71: (event, element, args) => {
    return selectRoleMultiselectAll(event);
  },
  a72: (event, element, args) => {
    event.stopPropagation();
    selectRoleMultiselectAll(event);
  },
  a73: (event, element, args) => {
    return applyMailboxPreset(element.value);
  },
  a74: (event, element, args) => {
    return toggleSameSmtp(element.checked);
  },
  a75: (event, element, args) => {
    return testMailboxConnection(element);
  },
  a76: (event, element, args) => {
    return closeModals();
  },
  a77: (event, element, args) => {
    return submitNewMailbox();
  },
  a78: (event, element, args) => {
    return closeModals();
  },
  a79: (event, element, args) => {
    event.stopPropagation();
  },
  a80: (event, element, args) => {
    return closeModals();
  },
  a81: (event, element, args) => {
    return changeStaffRole(args[0], element.value);
  },
  a82: (event, element, args) => {
    return resetStaffPassword(args[0], args[1]);
  },
  a83: (event, element, args) => {
    return deleteStaffMember(args[0], args[1]);
  },
  a84: (event, element, args) => {
    return deleteRole(args[0], args[1], args[2]);
  },
  a85: (event, element, args) => {
    return toggleUserDropdown(event);
  },
  a86: (event, element, args) => {
    openAdminModal("staff");
    closeUserDropdown();
  },
  a87: (event, element, args) => {
    openAdminModal("roles");
    closeUserDropdown();
  },
  a88: (event, element, args) => {
    openAdminModal("mailboxes");
    closeUserDropdown();
  },
  a89: (event, element, args) => {
    logout();
    closeUserDropdown();
  },
  a90: (event, element, args) => {
    return openLoginModal();
  },
  a91: (event, element, args) => {
    return removeTableMailboxRole(args[0], args[1], event);
  },
  a92: (event, element, args) => {
    return toggleTableMailboxRole(args[0], args[1], event);
  },
  a93: (event, element, args) => {
    event.stopPropagation();
    toggleTableMailboxRole(args[0], args[1], event);
  },
  a94: (event, element, args) => {
    return toggleTableMailboxRole(args[0], args[1], event);
  },
  a95: (event, element, args) => {
    event.stopPropagation();
    toggleTableMailboxRole(args[0], args[1], event);
  },
  a96: (event, element, args) => {
    return toggleTableMailboxRoleDropdown(args[0], event);
  },
  a97: (event, element, args) => {
    event.stopPropagation();
  },
  a98: (event, element, args) => {
    return closeTableMailboxRoleDropdown(args[0], event);
  },
  a99: (event, element, args) => {
    return setTableMailboxRoleAll(args[0], event);
  },
  a100: (event, element, args) => {
    event.stopPropagation();
    setTableMailboxRoleAll(args[0], event);
  },
  a101: (event, element, args) => {
    return testSyncMailbox(args[0], args[1], element);
  },
  a102: (event, element, args) => {
    return deleteMailbox(args[0], args[1]);
  },
  a103: (event, element, args) => {
    return removeRoleChip(args[0], event);
  },
  a104: (event, element, args) => {
    event.stopPropagation();
    toggleRoleSelection(args[0], event);
  },
  a105: (event, element, args) => {
    return handleNotificationClick(args[0]);
  },
  a106: (event, element, args) => {
    return removeReplyFile(args[0]);
  },
};
const boundActions = new WeakMap();
function bindUiActions(root = document) {
  const elements = [
    ...(root.matches?.(
      "[data-ui-click],[data-ui-change],[data-ui-input],[data-ui-submit]",
    )
      ? [root]
      : []),
    ...root.querySelectorAll(
      "[data-ui-click],[data-ui-change],[data-ui-input],[data-ui-submit],[data-ui-focus],[data-ui-blur],[data-ui-keydown]",
    ),
  ];
  for (const element of elements) {
    let bound = boundActions.get(element);
    if (!bound) {
      bound = new Set();
      boundActions.set(element, bound);
    }
    for (const event of [
      "click",
      "change",
      "input",
      "submit",
      "focus",
      "blur",
      "keydown",
    ]) {
      const id = element.getAttribute("data-ui-" + event);
      if (!id || bound.has(event)) continue;
      bound.add(event);
      element.addEventListener(event, (e) => {
        const fn = uiActions[element.getAttribute("data-ui-" + event)];
        if (!fn) return;
        const args = JSON.parse(element.getAttribute("data-ui-args") || "[]");
        Promise.resolve(fn(e, element, args)).catch((error) =>
          showToast(error.message || "Action failed"),
        );
      });
    }
    if (
      element.hasAttribute("data-ui-click") &&
      ["DIV", "SPAN"].includes(element.tagName) &&
      !element.matches(
        ".modal-overlay,.sidebar-backdrop,.lightbox-container,.tbl-multiselect-popover",
      )
    ) {
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      if (!bound.has("keyboard")) {
        bound.add("keyboard");
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            element.click();
          }
        });
      }
    }
  }
}
const modalFocus = new WeakMap();
function syncDialogs() {
  for (const modal of document.querySelectorAll(".modal-overlay")) {
    const panel = modal.firstElementChild;
    if (!panel) continue;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const heading = panel.querySelector("h1,h2,h3,.modal-title");
    if (heading) {
      if (!heading.id) heading.id = "dialog-" + crypto.randomUUID();
      panel.setAttribute("aria-labelledby", heading.id);
    } else panel.setAttribute("aria-label", "Dialog");
    if (modal.classList.contains("active") && !modalFocus.has(modal)) {
      modalFocus.set(modal, document.activeElement);
      panel.tabIndex = -1;
      (
        panel.querySelector('input,button,textarea,select,[tabindex="0"]') ||
        panel
      ).focus();
    } else if (!modal.classList.contains("active") && modalFocus.has(modal)) {
      modalFocus.get(modal)?.focus();
      modalFocus.delete(modal);
    }
  }
}
document.addEventListener("keydown", (event) => {
  const modals = [...document.querySelectorAll(".modal-overlay.active")],
    modal = modals.at(-1);
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModals();
    return;
  }
  if (event.key === "Tab") {
    const focus = [
      ...modal.querySelectorAll(
        'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
      ),
    ].filter((el) => el.getClientRects().length);
    if (!focus.length) {
      event.preventDefault();
      return;
    }
    const first = focus[0],
      last = focus.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !modal.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !modal.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
});
bindUiActions();
syncDialogs();
new MutationObserver((records) => {
  for (const record of records)
    for (const node of record.addedNodes)
      if (node.nodeType === 1) bindUiActions(node);
  if (
    records.some(
      (r) =>
        r.type === "attributes" && r.target.classList.contains("modal-overlay"),
    ) ||
    records.some((r) => r.addedNodes.length)
  )
    syncDialogs();
}).observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["class"],
});
