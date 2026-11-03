// Navigation definitions and the left navigation rail.

import {
  keepPlatformWindowsInView,
  navigateTo,
  openPlanningTab,
  planningTabFromHash
} from "./lib/workspace-calls.js";
import {
  activeWorkspaceId,
  elements,
  identity,
  ownerWorkspaceMode,
  ownerWorkspaceModeStorageKey,
  storeOwnerWorkspaceMode,
  workflowPreferencesState
} from "./state.js";

const leftNavigationStorageKey = "clearledger_left_navigation_v3";
const leftNavigationDefinitions = [
  {
    key: "owner",
    tier: "more",
    featureKey: "owner",
    label: "Owner workspace",
    icon: "O",
    workspaceId: "owner-workspace"
  },
  {
    key: "home",
    tier: "primary",
    featureKey: "home",
    label: "Home",
    icon: "⌂",
    workspaceId: "overview-workspace"
  },
  {
    key: "sales",
    tier: "primary",
    featureKey: "sales",
    label: "Receivables & sales",
    icon: "↗",
    workspaceId: "sales-workspace"
  },
  {
    key: "payables",
    tier: "primary",
    featureKey: "expenses",
    label: "Payables & purchases",
    icon: "↙",
    workspaceId: "purchases-workspace"
  },
  {
    key: "pos",
    tier: "more",
    featureKey: "pos",
    label: "Point of sale",
    icon: "▦",
    workspaceId: "pos-workspace"
  },
  {
    key: "payments",
    tier: "more",
    featureKey: "payments",
    label: "Payments & refunds",
    icon: "$",
    workspaceId: "payments-workspace"
  },
  {
    key: "crm",
    tier: "primary",
    featureKey: "contacts",
    label: "CRM & clients",
    icon: "♧",
    workspaceId: "projects-workspace",
    planningTab: "crm"
  },
  {
    key: "calendar",
    tier: "more",
    featureKey: "calendar",
    label: "Calendar",
    icon: "□",
    workspaceId: "projects-workspace",
    planningTab: "calendar"
  },
  {
    key: "projects",
    tier: "more",
    featureKey: "projects",
    label: "Project planning",
    icon: "◆",
    workspaceId: "projects-workspace",
    planningTab: "projects"
  },
  {
    key: "fulfilment",
    tier: "more",
    featureKey: "fulfilment",
    label: "Orders & fulfilment",
    icon: "▷",
    workspaceId: "fulfilment-workspace"
  },
  {
    key: "contracts",
    tier: "more",
    featureKey: "contracts",
    label: "Contracts",
    icon: "C",
    workspaceId: "contracts-workspace"
  },
  {
    key: "banking",
    tier: "primary",
    featureKey: "banking",
    label: "Banking",
    icon: "▤",
    workspaceId: "banking-workspace"
  },
  {
    key: "inventory",
    tier: "more",
    featureKey: "inventory",
    label: "Inventory",
    icon: "▥",
    workspaceId: "inventory-workspace"
  },
  {
    key: "tax",
    tier: "primary",
    featureKey: "taxes",
    label: "Tax centre",
    icon: "%",
    workspaceId: "accountant-workspace"
  },
  {
    key: "payroll",
    tier: "more",
    featureKey: "payroll",
    label: "Payroll",
    icon: "P",
    workspaceId: "payroll-workspace"
  },
  {
    key: "switching",
    tier: "more",
    featureKey: "switching",
    label: "Switching centre",
    icon: "⇄",
    workspaceId: "portability-workspace"
  },
  {
    key: "integrations",
    tier: "more",
    featureKey: "integrations",
    label: "External integrations",
    icon: "⌘",
    workspaceId: "integrations-workspace"
  },
  {
    key: "reports",
    tier: "primary",
    featureKey: "reports",
    label: "Reports & insights",
    icon: "▥",
    workspaceId: "reports-workspace"
  },
  {
    key: "settings",
    tier: "admin",
    featureKey: "settings",
    label: "Company settings",
    icon: "⚙",
    workspaceId: "setup-workspace"
  },
  {
    key: "help",
    tier: "admin",
    featureKey: "help",
    label: "Help & learning",
    icon: "?",
    workspaceId: "help-workspace"
  }
];
const leftNavigationKeys = new Set(leftNavigationDefinitions.map((item) => item.key));
export let leftNavigationState = readLeftNavigationState();
const ownerNavigationKeys = new Set([
  "owner",
  "home",
  "sales",
  // Turning store orders into posted sales, picking them and shipping them is
  // the owner's daily loop for a product business, so the rail carries it in
  // Business mode rather than only in the fuller accountant rail.
  "fulfilment",
  "banking",
  "crm",
  "calendar",
  "projects",
  "contracts",
  "inventory",
  "reports",
  "integrations",
  "settings",
  "help"
]);

export function initNavigation() {
  setOwnerWorkspaceMode(ownerWorkspaceMode, { persist: false, rerender: false });
  renderLeftNavigation();
  elements["left-navigation-close"]?.addEventListener("click", () => setLeftNavigationOpen(false));
  elements["left-navigation-reopen"]?.addEventListener("click", () => setLeftNavigationOpen(true));
  elements["left-navigation-collapse"]?.addEventListener("click", () => {
    leftNavigationState.collapsed = !leftNavigationState.collapsed;
    persistLeftNavigationState();
    syncLeftNavigationState();
  });
  elements["left-navigation-customize"]?.addEventListener("click", () => {
    const customizer = elements["left-navigation-customizer"];
    const open = customizer.hidden;
    customizer.hidden = !open;
    elements["left-navigation-customize"].setAttribute("aria-expanded", String(open));
  });
}

function defaultLeftNavigationState() {
  return {
    // PennyWise uses a compact desktop rail as the primary task navigation.
    // Phones retain the closed drawer so the active task stays unobstructed.
    open: !window.matchMedia("(max-width: 760px)").matches,
    collapsed: false,
    visibleKeys: leftNavigationDefinitions.map((item) => item.key),
    order: leftNavigationDefinitions.map((item) => item.key)
  };
}

function readLeftNavigationState() {
  const fallback = defaultLeftNavigationState();
  try {
    const stored = JSON.parse(window.localStorage.getItem(leftNavigationStorageKey) || "null");
    if (!stored || typeof stored !== "object") return fallback;
    const order = Array.isArray(stored.order)
      ? [...new Set(stored.order.filter((key) => leftNavigationKeys.has(key)))]
      : [];
    const visibleKeys = Array.isArray(stored.visibleKeys)
      ? [...new Set(stored.visibleKeys.filter((key) => leftNavigationKeys.has(key)))]
      : [];
    const storedOrder = Array.isArray(stored.order) ? stored.order : [];
    const storedVisible = Array.isArray(stored.visibleKeys) ? stored.visibleKeys : [];
    for (const key of fallback.order) {
      if (!order.includes(key)) order.push(key);
      // A destination the stored state has never seen is new to this build, not
      // one the operator chose to hide. Previously new keys were only made
      // visible when `stored.visibleKeys` was absent entirely, so every
      // navigation destination added after a user first customised their rail
      // stayed permanently invisible to them. An explicit hide is still
      // respected: those keys are present in the stored state.
      const knownToStoredState = storedOrder.includes(key) || storedVisible.includes(key);
      if (!visibleKeys.includes(key) && !knownToStoredState) visibleKeys.push(key);
    }
    return {
      open: stored.open !== false,
      collapsed: stored.collapsed === true,
      visibleKeys: visibleKeys.length ? visibleKeys : fallback.visibleKeys,
      order
    };
  } catch {
    return fallback;
  }
}

function persistLeftNavigationState() {
  try {
    window.localStorage.setItem(leftNavigationStorageKey, JSON.stringify(leftNavigationState));
  } catch {
    // Navigation preferences are optional browser-local state, never accounting data.
  }
}

function leftNavigationItemIsActive(item, workspaceId) {
  if (item.planningTab) {
    const selectedPlanningTab = planningTabFromHash();
    return workspaceId === item.workspaceId && selectedPlanningTab === item.planningTab;
  }
  return workspaceId === item.workspaceId;
}

export function ownerWorkspaceIsEnabled() {
  return workflowPreferencesState?.workflowPreferences?.ownerWorkspaceEnabled !== false;
}

function visibleLeftNavigationDefinitions() {
  const profileKey = workflowPreferencesState?.workflowPreferences?.profileKey;
  const base =
    profileKey === "INVOICING_ONLY"
      ? leftNavigationDefinitions.filter((item) =>
          new Set(["home", "sales", "payments", "reports", "settings", "help"]).has(item.key)
        )
      : leftNavigationDefinitions;
  if (!ownerWorkspaceMode || !ownerWorkspaceIsEnabled()) return base;
  return base.filter((item) => ownerNavigationKeys.has(item.key));
}

export function setOwnerWorkspaceMode(nextMode, { persist = true, rerender = true } = {}) {
  storeOwnerWorkspaceMode(Boolean(nextMode) && ownerWorkspaceIsEnabled());
  document.documentElement.dataset.workspaceMode = ownerWorkspaceMode ? "owner" : "accountant";
  if (persist) {
    try {
      window.localStorage.setItem(ownerWorkspaceModeStorageKey, String(ownerWorkspaceMode));
    } catch {
      // This is a visual preference only; accounting data never depends on browser storage.
    }
  }
  if (rerender) {
    renderLeftNavigation();
    syncLeftNavigationState(activeWorkspaceId);
  }
}

export function renderLeftNavigation() {
  const list = elements["left-navigation-list"];
  const options = elements["left-navigation-options"];
  if (!list || !options) return;
  const navigationDefinitions = visibleLeftNavigationDefinitions();
  const itemsByKey = new Map(navigationDefinitions.map((item) => [item.key, item]));
  const visibleItems = leftNavigationState.order
    .map((key) => itemsByKey.get(key))
    .filter((item) => item && leftNavigationState.visibleKeys.includes(item.key));
  list.replaceChildren(
    ...visibleItems.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "left-navigation-item";
      button.dataset.leftNavigationKey = item.key;
      button.dataset.workspaceTarget = item.workspaceId;
      if (item.planningTab) button.dataset.planningTab = item.planningTab;
      button.title = `Open ${item.label}`;
      // Keep the visible section name compact while making the rail action
      // unambiguous to screen readers and command-oriented automation.
      button.setAttribute("aria-label", `Open ${item.label}`);
      const icon = document.createElement("span");
      icon.className = "left-navigation-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.icon;
      const label = document.createElement("span");
      label.className = "left-navigation-label";
      label.textContent = item.label;
      button.append(icon, label);
      button.addEventListener("click", () => {
        if (item.planningTab) openPlanningTab(item.planningTab);
        else navigateTo(item.workspaceId);
        if (window.matchMedia("(max-width: 760px)").matches) setLeftNavigationOpen(false);
      });
      return button;
    })
  );
  options.replaceChildren(
    ...leftNavigationState.order
      .map((key) => itemsByKey.get(key))
      .filter(Boolean)
      .map((item) => {
        const label = document.createElement("label");
        label.className = "left-navigation-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = leftNavigationState.visibleKeys.includes(item.key);
        input.dataset.leftNavigationOption = item.key;
        input.addEventListener("change", () => {
          const visible = new Set(leftNavigationState.visibleKeys);
          if (input.checked) visible.add(item.key);
          else if (visible.size > 1) visible.delete(item.key);
          else input.checked = true;
          leftNavigationState.visibleKeys = leftNavigationState.order.filter((key) =>
            visible.has(key)
          );
          persistLeftNavigationState();
          renderLeftNavigation();
          syncLeftNavigationState(activeWorkspaceId);
        });
        label.append(input, document.createTextNode(item.label));
        return label;
      })
  );
}

export function syncLeftNavigationState(workspaceId = activeWorkspaceId) {
  const pane = elements["left-navigation-pane"];
  const reopen = elements["left-navigation-reopen"];
  if (!pane || !reopen) return;
  const open = leftNavigationState.open && Boolean(identity?.activeOrganizationId);
  pane.hidden = !open;
  reopen.hidden = !identity?.activeOrganizationId || open;
  document.documentElement.dataset.leftNavigation = open
    ? leftNavigationState.collapsed
      ? "collapsed"
      : "open"
    : "closed";
  elements["left-navigation-collapse"]?.setAttribute(
    "aria-expanded",
    String(!leftNavigationState.collapsed)
  );
  if (elements["left-navigation-collapse"])
    elements["left-navigation-collapse"].textContent = leftNavigationState.collapsed
      ? "Expand"
      : "Collapse";
  for (const button of pane.querySelectorAll("[data-left-navigation-key]")) {
    const item = leftNavigationDefinitions.find(
      (candidate) => candidate.key === button.dataset.leftNavigationKey
    );
    button.toggleAttribute(
      "aria-current",
      Boolean(item && leftNavigationItemIsActive(item, workspaceId))
    );
  }
  const current = elements["left-navigation-current"];
  if (current) {
    const active = leftNavigationDefinitions.find((item) =>
      leftNavigationItemIsActive(item, workspaceId)
    );
    current.textContent = `Current area: ${active?.label ?? "Home"}`;
  }
  keepPlatformWindowsInView();
}

export function setLeftNavigationOpen(open) {
  leftNavigationState.open = Boolean(open);
  persistLeftNavigationState();
  syncLeftNavigationState();
}
