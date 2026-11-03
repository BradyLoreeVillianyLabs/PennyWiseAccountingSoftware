// Workspace switching, layout customisation, platform windows, and display preferences.

import { formatMinor } from "../money.js";
import { api } from "./api.js";
import {
  preferredScrollBehavior,
  readBrowserPreference,
  writeBrowserPreference
} from "./lib/browser.js";
import { applyTableFilter, downloadVisibleTable } from "./lib/forms.js";
import { trackProductEvent } from "./lib/product-analytics.js";
import { activeRoleIs, formatRole } from "./lib/roles.js";
import {
  addSpreadsheetEntryRow,
  applySpreadsheetEntryRow,
  clearSpreadsheetEntryGrid,
  handleSpreadsheetEntryPaste,
  installSpreadsheetEntryTools
} from "./lib/spreadsheet-entry.js";
import {
  clampBulkEntryWindowToViewport,
  filterHelpTopics,
  loadCalendar,
  loadContracts,
  loadFixedAssets,
  loadFulfilment,
  loadHomeDashboard,
  loadIntegrations,
  loadInventory,
  loadOwnerWorkspace,
  loadPayroll,
  loadPos,
  loadReports,
  openBulkEntryWindow,
  openDashboardEditor,
  openHelpDestination,
  openPlanningTab,
  planningTabFromHash,
  registerWorkspaceCalls,
  renderGuidedTour,
  resetDashboardPreferences,
  syncDashboardHelpPanel,
  syncPlanningTabs
} from "./lib/workspace-calls.js";
import {
  ownerWorkspaceIsEnabled,
  setLeftNavigationOpen,
  setOwnerWorkspaceMode,
  syncLeftNavigationState
} from "./nav.js";
import {
  accounts,
  activeWorkspaceId,
  bankTransactions,
  bills,
  budgets,
  customers,
  elements,
  estimates,
  fixedAssets,
  identity,
  invoices,
  ownerWorkspaceMode,
  payments,
  products,
  projects,
  purchaseRequests,
  setActiveWorkspaceId,
  spreadsheetEntryState,
  vendors,
  workflowPreferencesState
} from "./state.js";

export const appHeader = document.querySelector(".app-header");
const displayPreferenceDefinitions = {
  theme: {
    controlId: "theme-select",
    storageKey: "clearledger_theme",
    fallback: "light",
    values: new Set(["light", "system", "evergreen", "ocean", "warm", "midnight", "contrast"])
  },
  density: {
    controlId: "density-select",
    storageKey: "clearledger_density",
    fallback: "comfortable",
    values: new Set(["comfortable", "compact", "spacious"])
  },
  textScale: {
    controlId: "text-scale-select",
    storageKey: "clearledger_text_scale",
    fallback: "standard",
    values: new Set(["standard", "large", "extra-large"])
  },
  contentWidth: {
    controlId: "content-width-select",
    storageKey: "clearledger_content_width",
    fallback: "standard",
    values: new Set(["standard", "focused", "wide"])
  },
  motion: {
    controlId: "motion-select",
    storageKey: "clearledger_motion",
    fallback: "system",
    values: new Set(["system", "reduce"])
  },
  windowMode: {
    controlId: "window-mode-select",
    storageKey: "clearledger_window_mode",
    fallback: "standard",
    values: new Set(["standard", "floating"])
  }
};
const platformWindowDefinitions = [
  { id: "customers-section", label: "Customers" },
  { id: "products-services-section", label: "Products and services" },
  { id: "invoice-designer-section", label: "Invoice workbench" },
  { id: "estimate-designer-section", label: "Estimate workbench" },
  { id: "pos-workspace", label: "Point of sale" },
  { id: "payments-workspace", label: "Payments" },
  { id: "purchases-workspace", label: "Purchases and payables" },
  { id: "banking-workspace", label: "Banking" },
  { id: "inventory-workspace", label: "Inventory" },
  { id: "accountant-workspace", label: "Accountant review" },
  { id: "payroll-workspace", label: "Payroll control centre" },
  { id: "portability-workspace", label: "Switching centre" },
  { id: "planning-workspace", label: "Budgets and cash planning" },
  { id: "fixed-assets-workspace", label: "Fixed asset register" },
  { id: "customer-relationships-panel", label: "CRM and client history" },
  { id: "calendar-panel", label: "Calendar" },
  { id: "project-work-items-panel", label: "Project work plan" },
  { id: "integrations-workspace", label: "Commerce integrations" },
  { id: "reports-workspace", label: "Dashboard and reports" }
];
let platformWindowManagerReady = false;
let platformWindowZIndex = 1050;
export const workspaceIds = [
  "overview-workspace",
  "owner-workspace",
  "setup-workspace",
  "sales-workspace",
  "pos-workspace",
  "payments-workspace",
  "purchases-workspace",
  "banking-workspace",
  "planning-workspace",
  "fixed-assets-workspace",
  "projects-workspace",
  "inventory-workspace",
  "reports-workspace",
  "accountant-workspace",
  "payroll-workspace",
  "portability-workspace",
  "integrations-workspace",
  "fulfilment-workspace",
  "help-workspace",
  "about-workspace",
  "membership-admin",
  "contracts-workspace"
];
const primaryWorkspaceGroups = {
  "overview-workspace": "overview-workspace",
  "sales-workspace": "sales-workspace",
  "purchases-workspace": "purchases-workspace",
  "banking-workspace": "banking-workspace",
  "reports-workspace": "reports-workspace"
};
const desktopNavigationWorkspaceIds = new Set([
  "pos-workspace",
  "accountant-workspace",
  "inventory-workspace",
  "projects-workspace",
  "planning-workspace",
  "fixed-assets-workspace",
  "payments-workspace",
  "integrations-workspace"
]);
const layoutCustomizationStorageKey = "pennywise_layout_customizations_v1";
const platformWindowZoomSteps = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];
const adjustableLayoutSelector = [
  ".home-dashboard",
  ".home-command-center",
  ".owner-workspace-grid",
  ".contracts-workspace-grid",
  ".sales-columns",
  ".invoice-designer-grid",
  ".payments-columns",
  ".payroll-workspace-grid",
  ".accountant-workbench-grid",
  ".customer-relationships-grid",
  ".integration-setup-grid",
  ".connector-provider-grid",
  ".about-feature-grid",
  ".columns"
].join(", ");
const layoutColumnLabels = {
  "home-dashboard": ["Main work", "At a glance"],
  "home-command-center": ["Task centers", "Quick tools"],
  "owner-workspace-grid": ["Today and follow-up", "Jobs and agreements"],
  "contracts-workspace-grid": ["Templates", "Agreement", "Preview"],
  "sales-columns": ["Customers", "Products and services"],
  "invoice-designer-grid": ["Editor", "Exact preview"],
  "payments-columns": ["Configuration", "Activity"],
  "payroll-workspace-grid": ["Setup", "Review"],
  "accountant-workbench-grid": ["Work area", "Review queue"],
  "customer-relationships-grid": ["Contacts", "Activity"],
  "integration-setup-grid": ["Connection", "Guidance"],
  "connector-provider-grid": ["Provider", "Details"],
  columns: ["Primary", "Secondary"]
};
const taskFinderDefinitions = [
  {
    id: "create-invoice",
    title: "Create an invoice",
    description: "Create, preview, and post a customer invoice.",
    keywords: "invoice sales customer bill customer invoice send",
    workspaceId: "sales-workspace",
    targetId: "invoice-designer-section"
  },
  {
    id: "open-point-of-sale",
    title: "Open point of sale",
    description: "Set up a register, open a shift, and check out a sale.",
    keywords: "pos point of sale register checkout retail cash drawer shift receipt",
    workspaceId: "pos-workspace",
    targetId: "pos-register-config-form",
    actionLabel: "Open point of sale"
  },
  {
    id: "bulk-entry",
    title: "Enter invoices or bills in bulk",
    description: "Paste spreadsheet rows into a reviewable draft-entry workbench.",
    keywords: "bulk batch spreadsheet grid paste invoice bill payable draft save",
    workspaceId: "sales-workspace",
    targetId: "bulk-entry-section",
    actionLabel: "Open bulk entry"
  },
  {
    id: "manage-customers",
    title: "Manage customers and contacts",
    description: "Create customers, contacts, notes, and follow-up history.",
    keywords: "customer client contact crm relationship note follow up",
    workspaceId: "projects-workspace",
    planningTab: "crm",
    targetId: "customer-relationships-heading"
  },
  {
    id: "upload-receipt",
    title: "Upload a receipt or supplier invoice image",
    description: "Store the original file, review extraction, and create a purchase draft.",
    keywords: "receipt picture photo image invoice bill upload scan ocr expense capture",
    workspaceId: "projects-workspace",
    planningTab: "capture",
    targetId: "capture-form"
  },
  {
    id: "import-data",
    title: "Import QuickBooks or spreadsheet data",
    description: "Map source fields, preview rows, dry-run, commit, and reconcile.",
    keywords: "quickbooks qbo qbd desktop csv xlsx spreadsheet migrate switching import",
    workspaceId: "portability-workspace",
    targetId: "data-import-form"
  },
  {
    id: "reconcile-bank",
    title: "Import and reconcile a bank statement",
    description: "Upload a statement, review matches, and reconcile the account.",
    keywords: "bank statement csv ofx reconcile match transaction banking",
    workspaceId: "banking-workspace",
    targetId: "bank-import-form"
  },
  {
    id: "plan-project",
    title: "Plan a project or milestone",
    description: "Create projects, tasks, milestones, and time records.",
    keywords: "project planning task milestone work time job schedule",
    workspaceId: "projects-workspace",
    planningTab: "projects",
    targetId: "project-form"
  },
  {
    id: "open-calendar",
    title: "Open the calendar",
    description: "View project dates, due dates, appointments, and planning events.",
    keywords: "calendar appointment meeting date due reminder schedule",
    workspaceId: "projects-workspace",
    planningTab: "calendar",
    targetId: "calendar-heading"
  },
  {
    id: "create-budget",
    title: "Create a budget or forecast",
    description: "Build a budget and compare projected cash with posted activity.",
    keywords: "budget forecast cash plan planning variance estimate",
    workspaceId: "planning-workspace",
    planningTab: "budgets",
    targetId: "budget-form"
  },
  {
    id: "manage-inventory",
    title: "Manage inventory and SKU matching",
    description: "Review products, stock, catalog matches, and inventory movements.",
    keywords: "inventory sku product stock catalog mapping woo etsy quantity",
    workspaceId: "inventory-workspace",
    targetId: "inventory-heading"
  },
  {
    id: "configure-tax",
    title: "Configure tax settings",
    description: "Set tax registrations, tax codes, and accounting-safe tax behavior.",
    keywords: "tax gst hst pst registration tax code rates sales tax",
    workspaceId: "setup-workspace",
    setupStep: "TAX_REGISTRATION",
    targetId: "tax-registration-form"
  },
  {
    id: "review-reports",
    title: "Review reports and books health",
    description: "Open authoritative reports, aging, tax, and ledger health views.",
    keywords: "report profit loss balance sheet trial balance aging accountant books health",
    workspaceId: "reports-workspace",
    targetId: "report-filter-form"
  },
  {
    id: "run-payroll",
    title: "Prepare a payroll draft",
    description: "Set up payroll, plan an explicit period, and prepare a reviewable pay run.",
    keywords: "payroll employee contractor pay run pay period salary wages cpp ei td1 remittance",
    workspaceId: "payroll-workspace",
    targetId: "payroll-runs-section"
  },
  {
    id: "open-integrations",
    title: "Review WooCommerce and Etsy integrations",
    description: "Review imported commerce activity, tax, fees, and SKU suggestions.",
    keywords: "woocommerce etsy shop store connector integration commerce marketplace",
    workspaceId: "integrations-workspace",
    targetId: "integrations-heading"
  }
];
const contextualSearchDefinitions = [
  { targetId: "setup-accounts", label: "Chart of accounts", placeholder: "Code, name, or type" },
  { targetId: "customers", label: "Customers", placeholder: "Name, number, or email" },
  { targetId: "products", label: "Products and services", placeholder: "Name, SKU, or price" },
  { targetId: "invoices", label: "Invoices", placeholder: "Invoice number, customer, or status" },
  {
    targetId: "estimates",
    label: "Estimates",
    placeholder: "Estimate number, customer, or status"
  },
  { targetId: "payments", label: "Payment history", placeholder: "Status, amount, or reference" },
  { targetId: "vendors", label: "Vendors", placeholder: "Name, number, or status" },
  { targetId: "bills", label: "Bills", placeholder: "Bill number, vendor, or status" },
  {
    targetId: "purchase-requests",
    label: "Purchase requests",
    placeholder: "Request, vendor, or status"
  },
  {
    targetId: "evidence-inbox",
    label: "Evidence inbox",
    placeholder: "File name, type, or review state"
  },
  {
    targetId: "bank-transactions",
    label: "Bank activity",
    placeholder: "Description, amount, or status"
  },
  { targetId: "budgets", label: "Budgets", placeholder: "Budget name, period, or status" },
  { targetId: "fixed-assets", label: "Fixed assets", placeholder: "Asset number, name, or status" },
  { targetId: "projects", label: "Projects", placeholder: "Project number, name, or customer" },
  {
    targetId: "project-work-items",
    label: "Planning items",
    placeholder: "Task, milestone, owner, or status"
  },
  {
    targetId: "inventory-quantities",
    label: "Inventory quantities",
    placeholder: "SKU, product, or location"
  },
  {
    targetId: "inventory-movements",
    label: "Inventory movements",
    placeholder: "SKU, location, or movement"
  },
  {
    targetId: "pos-sales",
    label: "Point-of-sale sales",
    placeholder: "Receipt, register, or status"
  },
  {
    targetId: "connector-installations",
    label: "Integrations",
    placeholder: "Provider, store, or status"
  },
  {
    targetId: "commerce-inbox-events",
    label: "Commerce inbox",
    placeholder: "Order, channel, or review state"
  },
  { targetId: "audit-events", label: "Audit events", placeholder: "Action, actor, or record" }
];
let layoutCustomizations = readLayoutCustomizations();
export const headerDisclosureMenus = [
  elements["more-navigation"],
  elements["global-search-menu"],
  elements["task-finder-menu"],
  elements["global-create-menu"],
  elements["settings-menu"],
  elements["appearance-menu"]
];
const tabbedWorkspaceIds = new Set([
  "sales-workspace",
  "pos-workspace",
  "payments-workspace",
  "purchases-workspace",
  "banking-workspace",
  "inventory-workspace",
  "accountant-workspace",
  "portability-workspace",
  "planning-workspace",
  "fixed-assets-workspace",
  "projects-workspace",
  "reports-workspace"
]);

registerWorkspaceCalls({ keepPlatformWindowsInView, navigateTo });

export function initShellLayout() {
  // Give dynamic results and data tables stable names before any asynchronous content arrives.
  for (const output of document.querySelectorAll("output:not([aria-live])")) {
    output.setAttribute("role", "status");
    output.setAttribute("aria-live", "polite");
  }
  for (const table of document.querySelectorAll(".table-wrap table:not([aria-label])")) {
    const heading = table.closest("section")?.querySelector("h2, h3")?.textContent?.trim();
    table.setAttribute("aria-label", heading || "PennyWise Accounting data");
    for (const header of table.querySelectorAll("thead th:not([scope])")) {
      header.setAttribute("scope", "col");
    }
  }
  syncAppLayoutMetrics();
  if (appHeader && "ResizeObserver" in globalThis) {
    new globalThis.ResizeObserver(syncAppLayoutMetrics).observe(appHeader);
  }
  if (elements["workspace-subnavigation"] && "ResizeObserver" in globalThis) {
    new globalThis.ResizeObserver(syncWorkspaceSubnavigationHeight).observe(
      elements["workspace-subnavigation"]
    );
  }
}

export function initShell() {
  elements["spreadsheet-entry-add-row"].addEventListener("click", addSpreadsheetEntryRow);
  elements["spreadsheet-entry-clear"].addEventListener("click", clearSpreadsheetEntryGrid);
  elements["spreadsheet-entry-apply"].addEventListener("click", applySpreadsheetEntryRow);
  elements["layout-reset-current"].addEventListener("click", resetCurrentWorkspaceLayout);
  elements["spreadsheet-entry-grid"].addEventListener("input", (event) => {
    const input = event.target.closest?.("[data-spreadsheet-entry-row]");
    if (!input) return;
    const row = spreadsheetEntryState.rows[Number(input.dataset.spreadsheetEntryRow)];
    const column = Number(input.dataset.spreadsheetEntryColumn);
    if (row && Number.isInteger(column)) row[column] = input.value;
  });
  elements["spreadsheet-entry-grid"].addEventListener("paste", handleSpreadsheetEntryPaste);
  document
    .querySelectorAll("[data-open-settings-menu]")
    .forEach((button) => button.addEventListener("click", openSettingsMenu));
  document
    .querySelectorAll("[data-open-layout-customizer]")
    .forEach((button) => button.addEventListener("click", openLayoutCustomizer));
  elements["print-workspace"].addEventListener("click", printCurrentWorkspace);
  document.querySelectorAll("[data-table-filter-target]").forEach((input) => {
    input.addEventListener("input", () => applyTableFilter(input.dataset.tableFilterTarget));
  });
  document.querySelectorAll("[data-table-export]").forEach((button) => {
    button.addEventListener("click", () => downloadVisibleTable(button.dataset.tableExport));
  });
  document
    .querySelectorAll("[data-close-dialog]")
    .forEach((button) =>
      button.addEventListener("click", () => elements[button.dataset.closeDialog]?.close())
    );
  for (const menu of headerDisclosureMenus) {
    menu.addEventListener("toggle", () => {
      disclosureTrigger(menu)?.setAttribute("aria-expanded", String(menu.open));
      if (menu.open) closeAllHeaderDisclosures(menu);
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof globalThis.Node)) return;
    for (const menu of headerDisclosureMenus) {
      if (menu.open && !menu.contains(event.target)) closeHeaderDisclosure(menu);
    }
  });
  document.addEventListener("focusin", (event) => {
    if (!(event.target instanceof globalThis.Node)) return;
    for (const menu of headerDisclosureMenus) {
      if (menu.open && !menu.contains(event.target)) closeHeaderDisclosure(menu);
    }
  });
  document.addEventListener("keydown", (event) => {
    const eventStartedInDialog =
      event.target instanceof globalThis.Element && Boolean(event.target.closest("dialog[open]"));
    if (event.key !== "Escape" || event.defaultPrevented || eventStartedInDialog) return;
    const openMenu = headerDisclosureMenus.find((menu) => menu.open);
    if (!openMenu) return;
    event.preventDefault();
    closeHeaderDisclosure(openMenu, { restoreFocus: true });
  });
  elements["workspace-navigation"].querySelectorAll("[data-workspace-target]").forEach((button) =>
    button.addEventListener("click", () => {
      elements["more-navigation"].open = false;
      if (button.dataset.planningTab) {
        openPlanningTab(button.dataset.planningTab);
      } else {
        activateWorkspace(button.dataset.workspaceTarget);
      }
    })
  );
  elements["more-navigation"].addEventListener("toggle", positionMoreNavigationPanel);
  elements["task-finder-menu"].addEventListener("toggle", () => {
    if (elements["task-finder-menu"].open) {
      renderTaskFinderResults(elements["task-finder-input"].value);
      globalThis.setTimeout(() => elements["task-finder-input"].focus(), 0);
    }
  });
  elements["global-search-menu"].addEventListener("toggle", () => {
    if (elements["global-search-menu"].open) {
      renderGlobalSearchResults(elements["global-search-input"].value);
      globalThis.setTimeout(() => elements["global-search-input"].focus(), 0);
    }
  });
  elements["task-finder-input"].addEventListener("input", () =>
    renderTaskFinderResults(elements["task-finder-input"].value)
  );
  elements["global-search-input"].addEventListener("input", () =>
    renderGlobalSearchResults(elements["global-search-input"].value)
  );
  elements["task-finder-input"].addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements["task-finder-results"].querySelector("button")?.click();
    }
  });
  elements["global-search-input"].addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements["global-search-results"].querySelector("button")?.click();
    }
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof globalThis.Element ? event.target : null;
    if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
    const shortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    if (shortcut || event.key === "/") {
      event.preventDefault();
      elements["global-search-menu"].open = true;
      renderGlobalSearchResults(elements["global-search-input"].value);
      elements["global-search-input"].focus();
    }
  });
  installContextualSearchBars();
  installSpreadsheetEntryTools();
  elements["global-create-menu"].addEventListener("toggle", positionGlobalCreatePanel);
  elements["settings-menu"].addEventListener("toggle", positionSettingsPanel);
  elements["appearance-menu"].addEventListener("toggle", positionAppearancePanel);
  window.addEventListener("resize", () => {
    syncAppHeaderHeight();
    positionMoreNavigationPanel();
    positionGlobalCreatePanel();
    positionSettingsPanel();
    positionAppearancePanel();
    applyLayoutCustomizations();
    keepPlatformWindowsInView();
    if (!elements["bulk-entry-section"]?.hidden) clampBulkEntryWindowToViewport();
    if (identity?.activeOrganizationId) syncWorkspaceNavigationState(activeWorkspaceId);
  });
  window.addEventListener(
    "scroll",
    () => {
      positionMoreNavigationPanel();
      positionGlobalCreatePanel();
      positionSettingsPanel();
      positionAppearancePanel();
    },
    { passive: true }
  );
  document.querySelectorAll("button[data-workspace-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      const ownerMode = button.dataset.workspaceMode === "owner";
      setOwnerWorkspaceMode(ownerMode);
      activateWorkspace(ownerMode ? "owner-workspace" : "accountant-workspace");
    })
  );
  document.querySelectorAll("[data-create-workspace]").forEach((button) =>
    button.addEventListener("click", () => {
      if (button.dataset.createTarget === "bulk-entry-section") {
        openBulkEntryWindow();
        elements["global-create-menu"].open = false;
        return;
      }
      if (button.dataset.createPlanningTab) {
        openPlanningTab(button.dataset.createPlanningTab, { scroll: false });
      } else {
        activateWorkspace(button.dataset.createWorkspace, false);
      }
      elements["global-create-menu"].open = false;
      revealWorkspaceTarget(button.dataset.createWorkspace, button.dataset.createTarget);
      const target = document.getElementById(button.dataset.createTarget);
      target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
      focusCreateTarget(target);
      globalThis.setTimeout(() => focusCreateTarget(target), 300);
      globalThis.setTimeout(() => focusCreateTarget(target), 900);
    })
  );
  document.querySelectorAll("[data-quick-workspace]").forEach((button) =>
    button.addEventListener("click", () => {
      const workspaceId = button.dataset.quickWorkspace;
      activateWorkspace(workspaceId);
      if (workspaceId === "sales-workspace") {
        document
          .querySelector("#invoice-designer-section")
          ?.scrollIntoView({ behavior: preferredScrollBehavior() });
      }
    })
  );
  document.querySelectorAll("[data-settings-workspace]").forEach((button) =>
    button.addEventListener("click", () => {
      closeHeaderDisclosure(elements["settings-menu"]);
      const workspaceId = button.dataset.settingsWorkspace;
      activateWorkspace(workspaceId);
      revealWorkspaceTarget(workspaceId, button.dataset.settingsTarget);
    })
  );
  document.querySelectorAll("[data-open-appearance]").forEach((button) =>
    button.addEventListener("click", () => {
      closeMobileNavigationForOverlay();
      closeAllHeaderDisclosures(elements["appearance-menu"]);
      closeHeaderDisclosure(elements["settings-menu"]);
      elements["appearance-menu"].open = true;
      disclosureTrigger(elements["appearance-menu"])?.setAttribute("aria-expanded", "true");
      positionAppearancePanel();
    })
  );
  document.querySelectorAll("[data-open-dashboard-preferences]").forEach((button) =>
    button.addEventListener("click", () => {
      closeHeaderDisclosure(elements["settings-menu"]);
      openDashboardEditor();
    })
  );
  document.querySelectorAll("[data-open-organization-actions]").forEach((button) =>
    button.addEventListener("click", () => {
      closeHeaderDisclosure(elements["settings-menu"]);
      const actions = elements["organization-actions"];
      actions.hidden = false;
      actions.open = true;
      actions.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
      actions.querySelector("input, select, button")?.focus();
    })
  );
  document.querySelectorAll("[data-open-runtime-diagnostics]").forEach((button) =>
    button.addEventListener("click", () => {
      closeHeaderDisclosure(elements["settings-menu"]);
      openRuntimeDiagnostics();
    })
  );
  document.querySelectorAll("[data-open-task-finder]").forEach((button) =>
    button.addEventListener("click", () => {
      closeMobileNavigationForOverlay();
      elements["task-finder-menu"].hidden = false;
      elements["task-finder-menu"].open = true;
      renderTaskFinderResults(elements["task-finder-input"].value);
      elements["task-finder-input"].focus();
    })
  );
  for (const definition of Object.values(displayPreferenceDefinitions)) {
    elements[definition.controlId].addEventListener("change", () => applyDisplayPreferences());
  }
  initializePlatformWindowManager();
  elements["reset-display-preferences"].addEventListener("click", resetDisplayPreferences);
  elements["close-appearance-menu"].addEventListener("click", () =>
    closeHeaderDisclosure(elements["appearance-menu"], { restoreFocus: true })
  );
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (elements["theme-select"].value === "system") updateBrowserThemeColor("system");
  });
  window.addEventListener("hashchange", () => {
    const planningTab = planningTabFromHash();
    if (planningTab && identity?.activeOrganizationId)
      openPlanningTab(planningTab, { updateHash: false, scroll: false });
  });
}

function syncAppHeaderHeight() {
  if (!appHeader) return;
  const height = Math.ceil(appHeader.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--app-header-height", `${height}px`);
}

function syncWorkspaceSubnavigationHeight() {
  const navigation = elements["workspace-subnavigation"];
  if (!navigation) return;
  const height = navigation.hidden ? 0 : Math.ceil(navigation.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--workspace-subnavigation-height", `${height}px`);
}

function syncAppLayoutMetrics() {
  syncAppHeaderHeight();
  syncWorkspaceSubnavigationHeight();
}

function disclosureTrigger(menu) {
  const triggerByMenuId = {
    "settings-menu": elements["left-navigation-settings"],
    "appearance-menu": elements["left-navigation-appearance"]
  };
  return triggerByMenuId[menu.id] ?? menu.querySelector("summary");
}

function closeHeaderDisclosure(menu, { restoreFocus = false } = {}) {
  if (!menu.open) return;
  menu.open = false;
  disclosureTrigger(menu)?.setAttribute("aria-expanded", "false");
  if (restoreFocus) disclosureTrigger(menu)?.focus();
}

export function closeAllHeaderDisclosures(except) {
  for (const menu of headerDisclosureMenus) {
    if (menu !== except) closeHeaderDisclosure(menu);
  }
}

function openSettingsMenu() {
  closeMobileNavigationForOverlay();
  const menu = elements["settings-menu"];
  closeAllHeaderDisclosures(menu);
  menu.open = true;
  disclosureTrigger(menu)?.setAttribute("aria-expanded", "true");
  positionSettingsPanel();
  globalThis.setTimeout(() => menu.querySelector("button, select")?.focus(), 0);
}

function printCurrentWorkspace() {
  printWorkspace(activeWorkspaceId || "overview-workspace");
}

export function printWorkspace(workspaceId) {
  if (!workspaceIds.includes(workspaceId)) workspaceId = "overview-workspace";
  document.querySelectorAll("#workspace > section[id]").forEach((section) => {
    section.dataset.printTarget = String(section.id === workspaceId);
  });
  document.documentElement.dataset.printingWorkspace = workspaceId;
  const cleanup = () => {
    document.querySelectorAll("#workspace > section[data-print-target]").forEach((section) => {
      delete section.dataset.printTarget;
    });
    delete document.documentElement.dataset.printingWorkspace;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1200);
}

function positionMoreNavigationPanel() {
  const menu = elements["more-navigation"];
  const panel = elements["more-navigation-panel"];
  if (!menu.open || !window.matchMedia("(min-width: 561px)").matches) {
    panel.style.removeProperty("--more-menu-top");
    panel.style.removeProperty("--more-menu-right");
    panel.style.removeProperty("--more-menu-max-height");
    return;
  }
  const summary = menu.querySelector("summary");
  const summaryRect = summary.getBoundingClientRect();
  const viewportPadding = 8;
  const menuGap = 8;
  const minimumUsableHeight = 72;
  const maximumPreferredHeight = 520;
  const availableBelow = Math.max(
    0,
    window.innerHeight - summaryRect.bottom - menuGap - viewportPadding
  );
  const availableAbove = Math.max(0, summaryRect.top - menuGap - viewportPadding);
  const preferredHeight = Math.min(panel.scrollHeight, maximumPreferredHeight);
  const openAbove =
    availableBelow < Math.min(preferredHeight, 180) && availableAbove > availableBelow;

  let top;
  let maximumHeight;
  if (openAbove) {
    maximumHeight = Math.max(minimumUsableHeight, availableAbove);
    top = Math.max(
      viewportPadding,
      summaryRect.top - menuGap - Math.min(preferredHeight, maximumHeight)
    );
  } else {
    top = Math.max(
      viewportPadding,
      Math.min(
        summaryRect.bottom + menuGap,
        window.innerHeight - minimumUsableHeight - viewportPadding
      )
    );
    maximumHeight = Math.max(minimumUsableHeight, window.innerHeight - top - viewportPadding);
  }

  panel.style.setProperty("--more-menu-top", `${Math.round(top)}px`);
  panel.style.setProperty("--more-menu-max-height", `${Math.round(maximumHeight)}px`);
  panel.style.setProperty(
    "--more-menu-right",
    `${Math.max(viewportPadding, Math.round(window.innerWidth - summaryRect.right))}px`
  );
}

function positionGlobalCreatePanel() {
  const menu = elements["global-create-menu"];
  const panel = menu.querySelector(".global-create-panel");
  if (!menu.open || !window.matchMedia("(min-width: 561px)").matches) {
    panel.style.removeProperty("--create-menu-top");
    panel.style.removeProperty("--create-menu-left");
    panel.style.removeProperty("--create-menu-max-height");
    return;
  }

  const summaryRect = menu.querySelector("summary").getBoundingClientRect();
  const viewportPadding = 8;
  const menuGap = 8;
  const minimumUsableHeight = 72;
  const maximumPreferredHeight = 520;
  const panelWidth = Math.min(320, window.innerWidth - viewportPadding * 2);
  const availableBelow = Math.max(
    0,
    window.innerHeight - summaryRect.bottom - menuGap - viewportPadding
  );
  const availableAbove = Math.max(0, summaryRect.top - menuGap - viewportPadding);
  const preferredHeight = Math.min(panel.scrollHeight, maximumPreferredHeight);
  const openAbove =
    availableBelow < Math.min(preferredHeight, 180) && availableAbove > availableBelow;

  let top;
  let maximumHeight;
  if (openAbove) {
    maximumHeight = Math.max(minimumUsableHeight, availableAbove);
    top = Math.max(
      viewportPadding,
      summaryRect.top - menuGap - Math.min(preferredHeight, maximumHeight)
    );
  } else {
    top = Math.max(
      viewportPadding,
      Math.min(
        summaryRect.bottom + menuGap,
        window.innerHeight - minimumUsableHeight - viewportPadding
      )
    );
    maximumHeight = Math.max(minimumUsableHeight, window.innerHeight - top - viewportPadding);
  }

  const left = Math.min(
    Math.max(viewportPadding, summaryRect.left),
    Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
  );
  panel.style.setProperty("--create-menu-top", `${Math.round(top)}px`);
  panel.style.setProperty("--create-menu-left", `${Math.round(left)}px`);
  panel.style.setProperty("--create-menu-max-height", `${Math.round(maximumHeight)}px`);
}

function positionAppearancePanel() {
  const menu = elements["appearance-menu"];
  const panel = menu.querySelector(".appearance-panel");
  if (!menu.open || !window.matchMedia("(min-width: 561px)").matches) {
    panel.style.removeProperty("--appearance-menu-top");
    panel.style.removeProperty("--appearance-menu-left");
    panel.style.removeProperty("--appearance-menu-max-height");
    return;
  }

  const trigger = disclosureTrigger(menu);
  const summaryRect = trigger.getBoundingClientRect();
  const viewportPadding = 8;
  const menuGap = 8;
  const minimumUsableHeight = 72;
  const maximumPreferredHeight = 720;
  const panelWidth = Math.min(440, window.innerWidth - viewportPadding * 2);
  const availableBelow = Math.max(
    0,
    window.innerHeight - summaryRect.bottom - menuGap - viewportPadding
  );
  const availableAbove = Math.max(0, summaryRect.top - menuGap - viewportPadding);
  const preferredHeight = Math.min(panel.scrollHeight, maximumPreferredHeight);
  const openAbove =
    availableBelow < Math.min(preferredHeight, 180) && availableAbove > availableBelow;

  let top;
  let maximumHeight;
  if (openAbove) {
    maximumHeight = Math.max(minimumUsableHeight, availableAbove);
    top = Math.max(
      viewportPadding,
      summaryRect.top - menuGap - Math.min(preferredHeight, maximumHeight)
    );
  } else {
    top = Math.max(
      viewportPadding,
      Math.min(
        summaryRect.bottom + menuGap,
        window.innerHeight - minimumUsableHeight - viewportPadding
      )
    );
    maximumHeight = Math.max(minimumUsableHeight, window.innerHeight - top - viewportPadding);
  }

  const left = Math.min(
    Math.max(viewportPadding, summaryRect.right + menuGap),
    Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
  );
  panel.style.setProperty("--appearance-menu-top", `${Math.round(top)}px`);
  panel.style.setProperty("--appearance-menu-left", `${Math.round(left)}px`);
  panel.style.setProperty("--appearance-menu-max-height", `${Math.round(maximumHeight)}px`);
}

function positionSettingsPanel() {
  const menu = elements["settings-menu"];
  const panel = menu.querySelector(".settings-panel");
  if (!menu.open || !window.matchMedia("(min-width: 561px)").matches) {
    panel.style.removeProperty("--settings-menu-top");
    panel.style.removeProperty("--settings-menu-left");
    panel.style.removeProperty("--settings-menu-max-height");
    return;
  }

  const trigger = disclosureTrigger(menu);
  const summaryRect = trigger.getBoundingClientRect();
  const viewportPadding = 8;
  const menuGap = 8;
  const top = Math.max(viewportPadding, summaryRect.top);
  const maximumHeight = Math.max(180, window.innerHeight - top - viewportPadding);
  const panelWidth = Math.min(340, window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    Math.max(viewportPadding, summaryRect.right + menuGap),
    Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
  );
  panel.style.setProperty("--settings-menu-top", `${Math.round(top)}px`);
  panel.style.setProperty("--settings-menu-left", `${Math.round(left)}px`);
  panel.style.setProperty("--settings-menu-max-height", `${Math.round(maximumHeight)}px`);
}

function readLayoutCustomizations() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(layoutCustomizationStorageKey) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function persistLayoutCustomizations() {
  try {
    window.localStorage.setItem(
      layoutCustomizationStorageKey,
      JSON.stringify(layoutCustomizations)
    );
  } catch {
    // Layout is a browser-only preference. A blocked storage write must not affect work.
  }
}

function layoutWorkspaceForGrid(grid) {
  return grid.closest("#workspace > section[id]");
}

function layoutGridClassName(grid) {
  return (
    Object.keys(layoutColumnLabels).find((className) => grid.classList.contains(className)) ??
    "columns"
  );
}

function layoutGridKey(grid) {
  const workspace = layoutWorkspaceForGrid(grid);
  if (!workspace) return grid.id || "unknown-layout-grid";
  const className = layoutGridClassName(grid);
  const matchingGrids = [...workspace.querySelectorAll(adjustableLayoutSelector)].filter(
    (candidate) => layoutGridClassName(candidate) === className
  );
  const occurrence = Math.max(0, matchingGrids.indexOf(grid));
  return `${workspace.id}:${grid.id || className}:${occurrence}`;
}

function layoutGridColumns(grid) {
  const template = window.getComputedStyle(grid).gridTemplateColumns.trim();
  if (!template || template === "none") return [];
  return template
    .split(/\s+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function normalizedLayoutWeights(values, columnCount) {
  const sanitized = Array.from({ length: columnCount }, (_, index) => {
    const value = Number(values[index]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  const total = sanitized.reduce((sum, value) => sum + value, 0);
  return sanitized.map((value) => (value / total) * 100);
}

function layoutWeightsForGrid(grid) {
  const columns = layoutGridColumns(grid);
  const key = layoutGridKey(grid);
  const stored = layoutCustomizations[key];
  if (Array.isArray(stored) && stored.length === columns.length)
    return normalizedLayoutWeights(stored, columns.length);
  return normalizedLayoutWeights(columns, columns.length);
}

function activeLayoutGrids() {
  const workspace = elements[activeWorkspaceId];
  if (!workspace || workspace.hidden) return [];
  return [...workspace.querySelectorAll(adjustableLayoutSelector)].filter((grid) => {
    const style = window.getComputedStyle(grid);
    return (
      style.display === "grid" &&
      grid.getClientRects().length > 0 &&
      layoutGridColumns(grid).length > 1
    );
  });
}

function applyLayoutCustomizations() {
  const desktop = window.matchMedia("(min-width: 761px)").matches;
  for (const grid of document.querySelectorAll(adjustableLayoutSelector)) {
    const key = layoutGridKey(grid);
    const stored = layoutCustomizations[key];
    if (!desktop || !Array.isArray(stored) || stored.length !== layoutGridColumns(grid).length) {
      if (grid.dataset.layoutCustomized === "true") {
        grid.style.removeProperty("grid-template-columns");
        delete grid.dataset.layoutCustomized;
      }
      continue;
    }
    const weights = normalizedLayoutWeights(stored, stored.length);
    grid.style.setProperty(
      "grid-template-columns",
      weights.map((weight) => `minmax(0, ${Math.round(weight * 100) / 100}fr)`).join(" ")
    );
    grid.dataset.layoutCustomized = "true";
  }
}

function layoutGridTitle(grid) {
  const labels = {
    "home-dashboard": "Overview panels",
    "home-command-center": "Business center",
    "owner-workspace-grid": "Owner workspace",
    "contracts-workspace-grid": "Contracts workspace",
    "sales-columns": "Sales setup",
    "invoice-designer-grid": "Document designer",
    "payments-columns": "Payments workspace",
    "accountant-workbench-grid": "Accountant workbench",
    "customer-relationships-grid": "Customer relationships",
    "integration-setup-grid": "Integration setup",
    "connector-provider-grid": "Connector providers",
    "about-feature-grid": "Information panels",
    columns: "Page columns"
  };
  return labels[layoutGridClassName(grid)] ?? "Page columns";
}

function layoutGridColumnLabel(grid, index) {
  const labels = layoutColumnLabels[layoutGridClassName(grid)] ?? [];
  return labels[index] ?? `Column ${index + 1}`;
}

function layoutCustomizerMessage(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "layout-customizer-empty";
  paragraph.textContent = message;
  return paragraph;
}

function renderLayoutCustomizer() {
  const grids = activeLayoutGrids();
  const controls = elements["layout-customizer-grids"];
  const status = elements["layout-customizer-status"];
  controls.replaceChildren();
  status.textContent = "";
  if (!window.matchMedia("(min-width: 761px)").matches) {
    controls.append(
      layoutCustomizerMessage(
        "Layout automatically adapts on smaller screens. Open this on a desktop-sized window to adjust page columns."
      )
    );
    return;
  }
  if (!grids.length) {
    controls.append(
      layoutCustomizerMessage(
        "This page has no multi-column work area to adjust. Choose a page with multiple panels."
      )
    );
    return;
  }
  for (const grid of grids) {
    const key = layoutGridKey(grid);
    const weights = layoutWeightsForGrid(grid);
    const group = document.createElement("section");
    group.className = "layout-customizer-group";
    const heading = document.createElement("h3");
    heading.textContent = layoutGridTitle(grid);
    const hint = document.createElement("p");
    hint.textContent = "Drag a control to give this column more or less room.";
    group.append(heading, hint);
    const minimum = weights.length === 2 ? 20 : 12;
    const maximum = weights.length === 2 ? 80 : 70;
    weights.forEach((weight, index) => {
      const label = document.createElement("label");
      label.className = "layout-customizer-control";
      const labelText = document.createElement("span");
      labelText.textContent = layoutGridColumnLabel(grid, index);
      const value = document.createElement("output");
      value.className = "layout-column-value";
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(minimum);
      input.max = String(maximum);
      input.step = "1";
      input.value = String(Math.round(weight));
      input.dataset.layoutGridKey = key;
      input.dataset.layoutColumn = String(index);
      label.append(labelText, value, input);
      group.append(label);
    });
    const syncControls = (nextWeights) => {
      const inputs = [...group.querySelectorAll("input[data-layout-column]")];
      inputs.forEach((input, index) => {
        input.value = String(Math.round(nextWeights[index]));
        const output = input.closest("label")?.querySelector(".layout-column-value");
        if (output) output.textContent = `${Math.round(nextWeights[index])}%`;
      });
    };
    const save = () => {
      const inputs = [...group.querySelectorAll("input[data-layout-column]")];
      const nextWeights = normalizedLayoutWeights(
        inputs.map((input) => Number(input.value)),
        weights.length
      );
      layoutCustomizations[key] = nextWeights;
      persistLayoutCustomizations();
      applyLayoutCustomizations();
      syncControls(nextWeights);
      status.textContent = `${layoutGridTitle(grid)} layout saved in this browser.`;
    };
    group.querySelectorAll("input[data-layout-column]").forEach((input) => {
      input.addEventListener("input", save);
    });
    syncControls(weights);
    controls.append(group);
  }
}

function closeMobileNavigationForOverlay() {
  if (window.matchMedia("(max-width: 760px)").matches) setLeftNavigationOpen(false);
}

function openLayoutCustomizer() {
  closeMobileNavigationForOverlay();
  const dialog = elements["layout-customizer"];
  renderLayoutCustomizer();
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function resetCurrentWorkspaceLayout() {
  for (const grid of activeLayoutGrids())
    Reflect.deleteProperty(layoutCustomizations, layoutGridKey(grid));
  persistLayoutCustomizations();
  applyLayoutCustomizations();
  renderLayoutCustomizer();
  elements["layout-customizer-status"].textContent = "This page’s column proportions were reset.";
}

function openRuntimeDiagnostics() {
  const dialog = elements["runtime-diagnostics"];
  elements["runtime-mode-value"].textContent =
    document.documentElement.dataset.runtimeMode === "controlled-share"
      ? "Controlled beta share"
      : "Standard local runtime";
  elements["runtime-platform-value"].textContent =
    globalThis.navigator.userAgentData?.platform ??
    globalThis.navigator.platform ??
    "Unknown browser platform";
  elements["runtime-api-value"].textContent = "Checking API health…";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  void api("/health", {}, true).then((response) => {
    elements["runtime-api-value"].textContent = response.ok
      ? `Healthy (HTTP ${response.status})`
      : `Unavailable (HTTP ${response.status})`;
  });
}

export function focusCreateTarget(target) {
  if (!(target instanceof globalThis.Element) || target.closest("[hidden]")) return;
  const focusTarget =
    target.querySelector('#invoice-form select[name="customerId"]') ??
    target.querySelector("input, select, textarea, button");
  if (!(focusTarget instanceof globalThis.HTMLElement) || focusTarget.disabled) return;
  if (target.contains(document.activeElement) && document.activeElement !== target) return;
  focusTarget.focus({ preventScroll: true });
}

function renderTaskFinderResults(rawQuery = "") {
  const query = rawQuery.trim().toLocaleLowerCase();
  const results = taskFinderDefinitions
    .map((task) => {
      const haystack = `${task.title} ${task.description} ${task.keywords}`.toLocaleLowerCase();
      const terms = query.split(/\s+/).filter(Boolean);
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { task, score };
    })
    .filter(({ score }) => !query || score > 0)
    .sort(
      (left, right) => right.score - left.score || left.task.title.localeCompare(right.task.title)
    )
    .slice(0, 10);
  const resultsElement = elements["task-finder-results"];
  resultsElement.replaceChildren(
    ...results.map(({ task }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-finder-result";
      button.setAttribute("role", "option");
      button.dataset.searchAction = "open";
      button.setAttribute("aria-label", `Open ${task.title}`);
      const title = document.createElement("strong");
      title.textContent = task.title;
      const description = document.createElement("span");
      description.textContent = task.description;
      const action = document.createElement("span");
      action.className = "search-result-action";
      action.textContent = "Open";
      button.append(title, description, action);
      button.addEventListener("click", () => openTaskFinderResult(task));
      return button;
    })
  );
  elements["task-finder-hint"].textContent = query
    ? results.length
      ? `${results.length} matching task${results.length === 1 ? "" : "s"}. Press Enter to open the first result.`
      : "No matching task. Try a simpler phrase such as invoice, receipt, bank, budget, or project."
    : "Search by what you want to do. PennyWise Accounting will open the matching screen.";
}

function normalizedSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function searchTermsMatch(value, rawQuery) {
  const text = normalizedSearchText(value);
  const terms = normalizedSearchText(rawQuery).split(/\s+/).filter(Boolean);
  return terms.every((term) => text.includes(term));
}

function installContextualSearchBars() {
  for (const definition of contextualSearchDefinitions) {
    const target = elements[definition.targetId];
    if (!target || document.querySelector(`[data-context-search-target="${definition.targetId}"]`))
      continue;
    const search = document.createElement("label");
    search.className = "context-search-wrap";
    search.dataset.contextSearchTarget = definition.targetId;
    const caption = document.createElement("span");
    caption.textContent = `Find in ${definition.label}`;
    const input = document.createElement("input");
    input.id = `${definition.targetId}-search`;
    input.className = "context-search";
    input.type = "search";
    input.placeholder = definition.placeholder;
    input.setAttribute("aria-label", `Find in ${definition.label}`);
    input.setAttribute("aria-controls", definition.targetId);
    input.dataset.searchTarget = definition.targetId;
    const status = document.createElement("span");
    status.className = "context-search-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    search.append(caption, input, status);
    const tableWrap = target.matches("tbody") ? target.closest(".table-wrap") : null;
    const anchor = tableWrap ?? target;
    anchor.parentElement?.insertBefore(search, anchor);
    input.addEventListener("input", () => filterContextualSearch(input));
  }
}

function filterContextualSearch(input) {
  const target = elements[input.dataset.searchTarget];
  if (!target) return;
  const query = input.value.trim();
  const candidates = [...target.children];
  let visible = 0;
  for (const candidate of candidates) {
    const matches = !query || searchTermsMatch(candidate.textContent, query);
    candidate.hidden = !matches;
    if (matches) visible += 1;
  }
  const status = input.closest(".context-search-wrap")?.querySelector(".context-search-status");
  if (status)
    status.textContent = query
      ? `${visible} of ${candidates.length} ${visible === 1 ? "result" : "results"}`
      : "";
}

export function refreshContextualSearches() {
  document.querySelectorAll(".context-search").forEach((input) => filterContextualSearch(input));
}

function globalSearchRecordItems() {
  const records = [];
  const add = (type, collection, config) => {
    for (const item of collection ?? []) {
      const title = String(config.title(item) || "").trim();
      if (!title) continue;
      records.push({
        kind: "record",
        type,
        title,
        subtitle: config.subtitle(item),
        searchText: config.searchText(item),
        searchValue: config.searchValue(item),
        workspaceId: config.workspaceId,
        planningTab: config.planningTab,
        targetId: config.targetId,
        searchControlId: `${config.targetId}-search`
      });
    }
  };
  add("Customer", customers, {
    title: (item) => item.displayName,
    subtitle: (item) => `${item.customerNumber} · ${item.email || "Customer"}`,
    searchText: (item) => `${item.customerNumber} ${item.displayName} ${item.email || ""}`,
    searchValue: (item) => item.customerNumber || item.displayName,
    workspaceId: "sales-workspace",
    targetId: "customers"
  });
  add("Product", products, {
    title: (item) => item.name,
    subtitle: (item) => `${item.sku || "No SKU"} · Product or service`,
    searchText: (item) => `${item.sku || ""} ${item.name} ${item.description || ""}`,
    searchValue: (item) => item.sku || item.name,
    workspaceId: "sales-workspace",
    targetId: "products"
  });
  add("Invoice", invoices, {
    title: (item) => item.invoiceNumber ?? item.provisionalIdentifier,
    subtitle: (item) => `${item.customerNameSnapshot || "Customer"} · ${formatRole(item.status)}`,
    searchText: (item) =>
      `${item.invoiceNumber || ""} ${item.provisionalIdentifier || ""} ${item.customerNameSnapshot || ""} ${item.status || ""}`,
    searchValue: (item) => item.invoiceNumber ?? item.provisionalIdentifier,
    workspaceId: "sales-workspace",
    targetId: "invoices"
  });
  add("Estimate", estimates, {
    title: (item) => item.estimateNumber ?? item.provisionalIdentifier,
    subtitle: (item) => `${item.customerName || "Customer"} · ${formatRole(item.status)}`,
    searchText: (item) =>
      `${item.estimateNumber || ""} ${item.provisionalIdentifier || ""} ${item.customerName || ""} ${item.status || ""}`,
    searchValue: (item) => item.estimateNumber ?? item.provisionalIdentifier,
    workspaceId: "sales-workspace",
    targetId: "estimates"
  });
  add("Vendor", vendors, {
    title: (item) => item.displayName,
    subtitle: (item) => `${item.vendorNumber} · Vendor`,
    searchText: (item) => `${item.vendorNumber} ${item.displayName} ${item.legalName || ""}`,
    searchValue: (item) => item.vendorNumber || item.displayName,
    workspaceId: "purchases-workspace",
    targetId: "vendors"
  });
  add("Bill", bills, {
    title: (item) => item.vendorInvoiceNumber,
    subtitle: (item) => `${item.vendor?.displayName || "Vendor"} · ${formatRole(item.status)}`,
    searchText: (item) =>
      `${item.vendorInvoiceNumber} ${item.vendor?.displayName || ""} ${item.status || ""}`,
    searchValue: (item) => item.vendorInvoiceNumber,
    workspaceId: "purchases-workspace",
    targetId: "bills"
  });
  add("Project", projects, {
    title: (item) => item.name,
    subtitle: (item) => `${item.projectNumber} · ${item.customerName || "Project"}`,
    searchText: (item) =>
      `${item.projectNumber} ${item.name} ${item.customerName || ""} ${item.status || ""}`,
    searchValue: (item) => item.projectNumber || item.name,
    workspaceId: "projects-workspace",
    planningTab: "projects",
    targetId: "projects"
  });
  add("Budget", budgets, {
    title: (item) => item.name,
    subtitle: (item) => `${item.periodStart || ""} · ${formatRole(item.status)}`,
    searchText: (item) =>
      `${item.name} ${item.status || ""} ${item.periodStart || ""} ${item.periodEnd || ""}`,
    searchValue: (item) => item.name,
    workspaceId: "planning-workspace",
    planningTab: "budgets",
    targetId: "budgets"
  });
  add("Account", accounts, {
    title: (item) => `${item.code} ${item.name}`,
    subtitle: (item) => `${formatRole(item.type)} · Chart of accounts`,
    searchText: (item) => `${item.code} ${item.name} ${item.type || ""}`,
    searchValue: (item) => item.code,
    workspaceId: "setup-workspace",
    targetId: "setup-accounts"
  });
  add("Bank transaction", bankTransactions, {
    title: (item) => item.description,
    subtitle: (item) => `${item.postingDate?.slice(0, 10) || ""} · ${formatRole(item.status)}`,
    searchText: (item) => `${item.description} ${item.amountMinor} ${item.status || ""} ${item.id}`,
    searchValue: (item) => item.description,
    workspaceId: "banking-workspace",
    targetId: "bank-transactions"
  });
  add("Fixed asset", fixedAssets, {
    title: (item) => item.name,
    subtitle: (item) => `${item.assetNumber} · ${formatRole(item.status)}`,
    searchText: (item) =>
      `${item.assetNumber} ${item.name} ${item.className || ""} ${item.status || ""}`,
    searchValue: (item) => item.assetNumber || item.name,
    workspaceId: "fixed-assets-workspace",
    targetId: "fixed-assets"
  });
  add("Purchase request", purchaseRequests, {
    title: (item) => item.requestNumber,
    subtitle: (item) => `${item.vendorName || "Vendor not selected"} · ${formatRole(item.status)}`,
    searchText: (item) =>
      `${item.requestNumber} ${item.purpose || ""} ${item.vendorName || ""} ${item.status || ""}`,
    searchValue: (item) => item.requestNumber,
    workspaceId: "purchases-workspace",
    targetId: "purchase-requests"
  });
  add("Payment", payments, {
    title: (item) => item.id,
    subtitle: (item) =>
      `${formatMinor(item.amountMinor, item.currency)} · ${formatRole(item.status)}`,
    searchText: (item) =>
      `${item.id} ${item.reference || ""} ${item.status || ""} ${item.amountMinor}`,
    searchValue: (item) => item.id,
    workspaceId: "payments-workspace",
    targetId: "payments"
  });
  return records;
}

function renderGlobalSearchResults(rawQuery = "") {
  const query = rawQuery.trim();
  const normalizedQuery = normalizedSearchText(query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const screens = taskFinderDefinitions.map((task) => {
    const haystack = normalizedSearchText(`${task.title} ${task.description} ${task.keywords}`);
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return {
      kind: "screen",
      title: task.title,
      subtitle: `Screen · ${task.description}`,
      searchText: haystack,
      score,
      task
    };
  });
  const records = globalSearchRecordItems().map((record) => {
    const haystack = normalizedSearchText(
      `${record.title} ${record.subtitle} ${record.searchText}`
    );
    const score = terms.reduce(
      (total, term) =>
        total +
        (haystack.includes(term) ? 1 : 0) +
        (normalizedSearchText(record.title).startsWith(term) ? 2 : 0),
      0
    );
    return { ...record, score };
  });
  const results = [...(query ? [...screens, ...records].filter((item) => item.score > 0) : screens)]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 18);
  const output = elements["global-search-results"];
  output.replaceChildren(
    ...results.map((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "global-search-result";
      button.setAttribute("role", "option");
      button.dataset.searchAction = "open";
      button.setAttribute("aria-label", `Open ${result.title}`);
      const title = document.createElement("strong");
      title.textContent = result.title;
      const subtitle = document.createElement("small");
      subtitle.textContent = result.subtitle;
      const action = document.createElement("span");
      action.className = "search-result-action";
      action.textContent = "Open";
      button.append(title, subtitle, action);
      button.addEventListener("click", () => openGlobalSearchResult(result));
      return button;
    })
  );
  elements["global-search-hint"].textContent = query
    ? results.length
      ? `${results.length} matching screen${results.length === 1 ? "" : "s"} or record${results.length === 1 ? "" : "s"}. Press Enter to open the first result.`
      : "No match. Try a customer, invoice number, SKU, vendor, project, or task such as reconcile bank."
    : "Search screens and records currently loaded for your company. Press Ctrl+K or / anytime.";
}

function openGlobalSearchResult(result) {
  closeHeaderDisclosure(elements["global-search-menu"]);
  if (result.kind === "screen") {
    openTaskFinderResult(result.task);
    return;
  }
  if (result.planningTab) openPlanningTab(result.planningTab);
  else activateWorkspace(result.workspaceId);
  const input = elements[result.searchControlId];
  if (input) {
    input.value = result.searchValue;
    filterContextualSearch(input);
  }
  globalThis.setTimeout(
    () =>
      elements[result.targetId]?.scrollIntoView({
        behavior: preferredScrollBehavior(),
        block: "center"
      }),
    0
  );
}

function openTaskFinderResult(task) {
  elements["task-finder-menu"].open = false;
  if (task.targetId === "bulk-entry-section") {
    openBulkEntryWindow();
    return;
  }
  if (task.planningTab) {
    openPlanningTab(task.planningTab);
    return;
  }
  openHelpDestination(task.workspaceId, task.targetId, task.setupStep);
}

function activateWorkspace(workspaceId, scrollToTop = true, refreshData = true) {
  if (!workspaceIds.includes(workspaceId) || !identity?.activeOrganizationId) return;
  if (workspaceId === "owner-workspace" && !ownerWorkspaceIsEnabled()) {
    workspaceId = "overview-workspace";
  }
  if (
    workspaceId === "planning-workspace" &&
    workflowPreferencesState &&
    !workflowPreferencesState.workflowPreferences.cashPlanningEnabled
  ) {
    workspaceId = "setup-workspace";
  }
  if (
    workspaceId === "fixed-assets-workspace" &&
    (!workflowPreferencesState?.workflowPreferences.fixedAssetRegisterEnabled ||
      !activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES", "READ_ONLY"))
  ) {
    workspaceId = workflowPreferencesState?.workflowPreferences.fixedAssetRegisterEnabled
      ? "overview-workspace"
      : "setup-workspace";
  }
  setActiveWorkspaceId(workspaceId);
  sessionStorage.setItem("clearledger_active_workspace", workspaceId);
  for (const id of workspaceIds) {
    elements[id].hidden = id !== workspaceId;
  }
  applyLayoutCustomizations();
  fitVisiblePlatformWindowContent();
  syncWorkspaceNavigationState(workspaceId);
  if (["projects-workspace", "planning-workspace"].includes(workspaceId))
    syncPlanningTabs(
      planningTabFromHash() ?? (workspaceId === "planning-workspace" ? "budgets" : "calendar")
    );
  for (const button of document.querySelectorAll("button[data-workspace-mode]")) {
    const active =
      button.dataset.workspaceMode === "owner" ? ownerWorkspaceMode : !ownerWorkspaceMode;
    button.setAttribute("aria-pressed", String(active));
  }
  buildWorkspaceSubnavigation(elements[workspaceId]);
  if (workspaceId === "overview-workspace") syncDashboardHelpPanel();
  if (workspaceId === "help-workspace") {
    renderGuidedTour();
    filterHelpTopics();
  }
  if (workspaceId === "overview-workspace" && refreshData) void loadHomeDashboard();
  if (workspaceId === "owner-workspace" && refreshData) void loadOwnerWorkspace();
  if (workspaceId === "contracts-workspace") void loadContracts();
  if (workspaceId === "reports-workspace") void loadReports();
  if (workspaceId === "fixed-assets-workspace") void loadFixedAssets();
  if (workspaceId === "payroll-workspace") void loadPayroll();
  if (workspaceId === "projects-workspace") void loadCalendar();
  if (workspaceId === "integrations-workspace") void loadIntegrations();
  if (workspaceId === "fulfilment-workspace") void loadFulfilment();
  if (workspaceId === "inventory-workspace") void loadInventory();
  if (workspaceId === "pos-workspace") void loadPos();
  if (scrollToTop) window.scrollTo({ top: 0, behavior: "smooth" });
}

// The only way a workspace should open another workspace.
export function navigateTo(workspaceId, options = {}) {
  activateWorkspace(workspaceId, options.scrollToTop, options.refreshData);
}

export function syncWorkspaceNavigationState(workspaceId) {
  const primaryWorkspaceId = primaryWorkspaceGroups[workspaceId];
  const selectedPlanningTab =
    planningTabFromHash() ??
    (workspaceId === "planning-workspace"
      ? "budgets"
      : workspaceId === "projects-workspace"
        ? "calendar"
        : null);
  const navigationPlanningTab = ["projects", "tasks", "time", "capture"].includes(
    selectedPlanningTab
  )
    ? "projects"
    : selectedPlanningTab;
  for (const button of elements["workspace-navigation"].querySelectorAll(
    "[data-workspace-target]"
  )) {
    const active = button.dataset.planningTab
      ? Boolean(
          button.dataset.workspaceTarget === workspaceId &&
            button.dataset.planningTab === navigationPlanningTab
        )
      : Boolean(
          button.dataset.workspaceTarget === workspaceId ||
            (primaryWorkspaceId && button.dataset.workspaceTarget === primaryWorkspaceId)
        );
    button.toggleAttribute("aria-current", active);
  }
  const isExpandedDesktopDestination =
    window.matchMedia("(min-width: 1181px)").matches &&
    desktopNavigationWorkspaceIds.has(workspaceId);
  const moreIsActive = !primaryWorkspaceId && !isExpandedDesktopDestination;
  elements["more-navigation"].toggleAttribute("data-active", moreIsActive);
  syncLeftNavigationState(workspaceId);
  keepPlatformWindowsInView();
}

function outermostSectionForHeading(workspace, heading) {
  let outermost = null;
  for (let node = heading.parentElement; node && node !== workspace; node = node.parentElement) {
    if (node.tagName === "SECTION") outermost = node;
  }
  return outermost;
}

function selectWorkspaceTab(workspace, panel, button, { scroll = true, persist = true } = {}) {
  if (!panel) return;
  const panels = [...workspace.querySelectorAll("[data-workspace-tab-panel]")];
  for (const candidate of panels) candidate.hidden = false;
  for (const candidate of document.querySelectorAll(
    "#workspace-subnavigation [data-workspace-tab]"
  )) {
    const active = candidate.getAttribute("aria-controls") === panel.id;
    candidate.toggleAttribute("aria-current", active);
  }
  if (persist) sessionStorage.setItem(`clearledger_tab_${workspace.id}`, panel.id);
  if (scroll) panel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
}

export function revealWorkspaceTarget(workspaceId, targetId) {
  const workspace = elements[workspaceId];
  const target = targetId ? document.getElementById(targetId) : workspace;
  if (!workspace || !target || !tabbedWorkspaceIds.has(workspaceId)) return;
  const panel = outermostSectionForHeading(workspace, target);
  if (!panel?.id) return;
  const button = [
    ...document.querySelectorAll("#workspace-subnavigation [data-workspace-tab]")
  ].find((candidate) => candidate.getAttribute("aria-controls") === panel.id);
  if (button) selectWorkspaceTab(workspace, panel, button, { scroll: false });
}

export function buildWorkspaceSubnavigation(workspace) {
  const navigation = elements["workspace-subnavigation"];
  if (workspace.id === "setup-workspace") {
    navigation.replaceChildren();
    navigation.hidden = true;
    return;
  }
  const visibleHeadings = [...workspace.querySelectorAll("h2, h3")].filter((heading) => {
    if (heading.closest("dialog:not([open])")) return false;
    const hiddenAncestor = heading.closest("[hidden]");
    return !hiddenAncestor || hiddenAncestor.hasAttribute("data-workspace-tab-panel");
  });
  const sectionHeadings = visibleHeadings.filter((heading) => heading.tagName === "H2");
  const headings =
    sectionHeadings.length > 1
      ? sectionHeadings
      : visibleHeadings.filter((heading) => heading.tagName === "H3");
  const seen = new Set();
  const buttons = [];
  const tabbed = tabbedWorkspaceIds.has(workspace.id);
  const tabPanels = [];
  for (const heading of headings) {
    const label = heading.textContent.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    if (!heading.id) {
      const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      heading.id = `${workspace.id}-${slug || String(buttons.length + 1)}`;
    }
    const panel = tabbed ? outermostSectionForHeading(workspace, heading) : null;
    if (panel && !panel.id) panel.id = `${heading.id}-panel`;
    if (panel) {
      panel.dataset.workspaceTabPanel = "true";
      if (!tabPanels.includes(panel)) tabPanels.push(panel);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (panel) {
      button.dataset.workspaceTab = "true";
      button.setAttribute("aria-controls", panel.id);
      button.addEventListener("click", () =>
        selectWorkspaceTab(workspace, panel, button, { scroll: true })
      );
    } else {
      button.addEventListener("click", () => {
        heading.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
        for (const item of navigation.querySelectorAll("button"))
          item.toggleAttribute("aria-current", item === button);
      });
    }
    buttons.push(button);
  }
  if (workspace.id === "sales-workspace") {
    const posButton = document.createElement("button");
    posButton.type = "button";
    posButton.dataset.workspaceShortcut = "point-of-sale";
    posButton.textContent = "Point of sale";
    posButton.addEventListener("click", () => activateWorkspace("pos-workspace"));
    buttons.push(posButton);
    const paymentsButton = document.createElement("button");
    paymentsButton.type = "button";
    paymentsButton.dataset.workspaceShortcut = "payments";
    paymentsButton.textContent = "Payments";
    paymentsButton.addEventListener("click", () => activateWorkspace("payments-workspace"));
    buttons.push(paymentsButton);
  } else if (workspace.id === "payments-workspace") {
    const salesButton = document.createElement("button");
    salesButton.type = "button";
    salesButton.textContent = "Back to sales";
    salesButton.addEventListener("click", () => activateWorkspace("sales-workspace"));
    buttons.unshift(salesButton);
  }
  navigation.replaceChildren(...buttons);
  navigation.setAttribute("role", "navigation");
  navigation.toggleAttribute("data-quick-tabs", tabbed);
  navigation.setAttribute(
    "aria-label",
    tabbed
      ? `${workspace.querySelector("h1")?.textContent ?? "Workspace"} sections quick navigation`
      : "Current workspace sections"
  );
  navigation.hidden = buttons.length === 0;
  syncWorkspaceSubnavigationHeight();
  if (tabbed && tabPanels.length > 0) {
    const savedPanelId = sessionStorage.getItem(`clearledger_tab_${workspace.id}`);
    const selectedPanel = tabPanels.find((panel) => panel.id === savedPanelId) ?? tabPanels[0];
    const selectedButton = buttons.find(
      (button) => button.getAttribute("aria-controls") === selectedPanel.id
    );
    selectWorkspaceTab(workspace, selectedPanel, selectedButton, { scroll: false, persist: false });
  }
}

export function restoreDisplayPreferences() {
  for (const definition of Object.values(displayPreferenceDefinitions)) {
    const storedValue = readBrowserPreference(definition.storageKey);
    elements[definition.controlId].value = definition.values.has(storedValue)
      ? storedValue
      : definition.fallback;
  }
  applyDisplayPreferences({ announce: false });
}

function platformWindowStorageKey(id) {
  return `clearledger_platform_window:${id}`;
}

function normalizePlatformWindowZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return platformWindowZoomSteps.reduce((closest, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(closest - numeric) ? candidate : closest
  );
}

function platformWindowViewportBounds() {
  const viewportPadding = 16;
  const headerBottom = appHeader?.getBoundingClientRect().bottom ?? 0;
  const leftNavigation = elements["left-navigation-pane"];
  const navigationRight =
    leftNavigation && !leftNavigation.hidden && window.matchMedia("(min-width: 761px)").matches
      ? Math.ceil(leftNavigation.getBoundingClientRect().right + 12)
      : viewportPadding;
  const subnavigation = elements["workspace-subnavigation"];
  const subnavigationBottom =
    subnavigation && !subnavigation.hidden
      ? subnavigation.getBoundingClientRect().bottom
      : headerBottom;
  const top = Math.min(
    Math.max(viewportPadding, Math.ceil(subnavigationBottom + 12)),
    Math.max(viewportPadding, window.innerHeight - 300 - viewportPadding)
  );
  return {
    left: Math.max(viewportPadding, navigationRight),
    top,
    right: Math.max(viewportPadding, window.innerWidth - viewportPadding),
    bottom: Math.max(top + 280, window.innerHeight - viewportPadding)
  };
}

function clampPlatformWindowToViewport(surface, { fit = false } = {}) {
  if (!surface) return;
  const bounds = platformWindowViewportBounds();
  const minimumWidth = 460;
  const minimumHeight = 280;
  const availableWidth = Math.max(minimumWidth, bounds.right - bounds.left);
  const availableHeight = Math.max(minimumHeight, bounds.bottom - bounds.top);
  const current = surface.getBoundingClientRect();
  const width = fit
    ? availableWidth
    : Math.min(availableWidth, Math.max(minimumWidth, current.width || availableWidth));
  const height = fit
    ? availableHeight
    : Math.min(availableHeight, Math.max(minimumHeight, current.height || availableHeight));
  const left = fit
    ? bounds.left
    : Math.min(bounds.right - width, Math.max(bounds.left, current.left || bounds.left));
  const top = fit
    ? bounds.top
    : Math.min(bounds.bottom - height, Math.max(bounds.top, current.top || bounds.top));
  surface.style.left = `${Math.round(left)}px`;
  surface.style.top = `${Math.round(top)}px`;
  surface.style.width = `${Math.round(width)}px`;
  surface.style.height = `${Math.round(height)}px`;
}

function fitPlatformWindowForDefinition(surface, definition) {
  if (!surface || !definition) return;
  const bounds = platformWindowViewportBounds();
  const gap = 12;
  const salesSurfaceIds = [
    "customers-section",
    "products-services-section",
    "invoice-designer-section",
    "estimate-designer-section"
  ];
  const projectSurfaceIds = [
    "customer-relationships-panel",
    "calendar-panel",
    "project-work-items-panel"
  ];
  const groupedSurfaceIds = salesSurfaceIds.includes(definition.id)
    ? salesSurfaceIds
    : projectSurfaceIds.includes(definition.id)
      ? projectSurfaceIds
      : null;
  if (!groupedSurfaceIds) {
    clampPlatformWindowToViewport(surface, { fit: true });
    return;
  }
  const columns = 2;
  const index = groupedSurfaceIds.indexOf(definition.id);
  const rows = Math.ceil(groupedSurfaceIds.length / columns);
  const cellWidth = Math.max(460, Math.floor((bounds.right - bounds.left - gap) / columns));
  const cellHeight = Math.max(
    280,
    Math.floor((bounds.bottom - bounds.top - gap * (rows - 1)) / rows)
  );
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = bounds.left + column * (cellWidth + gap);
  const top = bounds.top + row * (cellHeight + gap);
  const width = Math.min(cellWidth, bounds.right - left);
  const height = Math.min(cellHeight, bounds.bottom - top);
  surface.style.left = `${Math.round(left)}px`;
  surface.style.top = `${Math.round(top)}px`;
  surface.style.width = `${Math.round(width)}px`;
  surface.style.height = `${Math.round(height)}px`;
}

function keepPlatformWindowsInView() {
  if (!platformWindowManagerReady) return;
  for (const definition of platformWindowDefinitions) {
    const surface = elements[definition.id];
    if (surface?.dataset.platformWindowReady === "true" && !surface.hidden)
      clampPlatformWindowToViewport(surface);
  }
}

function platformWindowLayout(surface) {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(platformWindowStorageKey(surface.id)) || "null"
    );
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function savePlatformWindowLayout(surface) {
  const rect = surface.getBoundingClientRect();
  try {
    window.localStorage.setItem(
      platformWindowStorageKey(surface.id),
      JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        zoom: normalizePlatformWindowZoom(surface.dataset.platformWindowZoom)
      })
    );
  } catch {
    // Layout is optional browser preference data, never financial data.
  }
}

function setPlatformWindowZoom(surface, value, { persist = false } = {}) {
  if (!surface) return;
  const zoom = normalizePlatformWindowZoom(value);
  surface.dataset.platformWindowZoom = String(zoom);
  surface.style.setProperty("--platform-window-content-zoom", String(zoom));
  const label = surface.querySelector("[data-platform-window-zoom-label]");
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  if (persist) savePlatformWindowLayout(surface);
}

function fitPlatformWindowContent(surface, { persist = false } = {}) {
  const content = surface?.querySelector(".platform-window-content");
  if (!content) return;
  // Measure at 100% first so a saved zoom does not compound every time a
  // window is fitted. The result is intentionally conservative: readability
  // wins over forcing a long form into a single viewport.
  setPlatformWindowZoom(surface, 1);
  const availableWidth = Math.max(1, content.clientWidth - 24);
  const naturalWidth = Math.max(availableWidth, content.scrollWidth);
  const target = Math.max(0.8, Math.min(1, (availableWidth / naturalWidth) * 0.98));
  setPlatformWindowZoom(surface, target, { persist });
}

function platformWindowTitlebar(definition, surface) {
  const header = document.createElement("header");
  header.className = "platform-window-titlebar";
  header.dataset.platformWindowDragHandle = "true";
  const title = document.createElement("h2");
  title.textContent = definition.label;
  const controls = document.createElement("div");
  controls.className = "platform-window-controls";
  controls.setAttribute("aria-label", `${definition.label} window controls`);
  for (const control of [
    ["fit", "Fit", `Fit ${definition.label} to available space`],
    ["zoom-out", "−", `Zoom out ${definition.label}`],
    ["zoom-reset", "100%", `Reset ${definition.label} zoom`],
    ["zoom-in", "+", `Zoom in ${definition.label}`],
    ["minimize", "−", `Minimize ${definition.label}`],
    ["maximize", "□", `Maximize ${definition.label}`],
    ["close", "×", `Close ${definition.label}`]
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "window-control";
    button.dataset.platformWindowAction = control[0];
    button.textContent = control[1];
    button.setAttribute("aria-label", control[2]);
    if (control[0] === "zoom-reset") button.dataset.platformWindowZoomLabel = "true";
    controls.append(button);
  }
  header.append(title, controls);
  header
    .querySelectorAll("[data-platform-window-action]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        platformWindowAction(surface, button.dataset.platformWindowAction)
      )
    );
  return header;
}

function platformWindowAction(surface, action) {
  if (!surface || !action) return;
  if (action === "fit") {
    const definition = platformWindowDefinitions.find((candidate) => candidate.id === surface.id);
    if (definition) fitPlatformWindowForDefinition(surface, definition);
    fitPlatformWindowContent(surface);
    savePlatformWindowLayout(surface);
    return;
  }
  if (action === "zoom-in" || action === "zoom-out" || action === "zoom-reset") {
    surface.dataset.platformWindowZoomCustomized = "true";
    const current = normalizePlatformWindowZoom(surface.dataset.platformWindowZoom);
    const index = platformWindowZoomSteps.indexOf(current);
    const nextIndex =
      action === "zoom-reset"
        ? platformWindowZoomSteps.indexOf(1)
        : Math.min(
            platformWindowZoomSteps.length - 1,
            Math.max(0, index + (action === "zoom-in" ? 1 : -1))
          );
    setPlatformWindowZoom(surface, platformWindowZoomSteps[nextIndex], { persist: true });
    return;
  }
  if (action === "close") {
    surface.hidden = true;
    surface.dataset.platformWindowClosed = "true";
    renderPlatformWindowDock();
    return;
  }
  if (action === "minimize") {
    const minimized = surface.dataset.platformWindowState === "minimized";
    surface.dataset.platformWindowState = minimized ? "open" : "minimized";
    surface.classList.toggle("platform-window-minimized", !minimized);
    for (const child of surface.children) {
      if (!child.classList.contains("platform-window-titlebar")) child.hidden = !minimized;
    }
    return;
  }
  if (action === "maximize") {
    surface.classList.toggle("platform-window-maximized");
    savePlatformWindowLayout(surface);
  }
}

function renderPlatformWindowDock() {
  const dock = elements["platform-window-dock"];
  if (!dock) return;
  const closed = platformWindowDefinitions
    .map((definition) => ({ definition, surface: elements[definition.id] }))
    .filter(({ surface }) => surface?.dataset.platformWindowClosed === "true");
  dock.replaceChildren(
    ...closed.map(({ definition, surface }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "platform-window-dock-item";
      button.textContent = `Restore ${definition.label}`;
      button.addEventListener("click", () => {
        surface.hidden = false;
        delete surface.dataset.platformWindowClosed;
        clampPlatformWindowToViewport(surface);
        renderPlatformWindowDock();
        surface.querySelector("[data-platform-window-action]")?.focus();
      });
      return button;
    })
  );
  dock.hidden = closed.length === 0;
}

function setupPlatformWindow(definition) {
  const surface = elements[definition.id];
  if (!surface || surface.dataset.platformWindowReady === "true") return;
  surface.dataset.platformWindowReady = "true";
  surface.classList.add("platform-window-surface");
  surface.prepend(platformWindowTitlebar(definition, surface));
  const content = document.createElement("div");
  content.className = "platform-window-content";
  content.append(...[...surface.children].slice(1));
  surface.append(content);
  const saved = platformWindowLayout(surface);
  if (saved) {
    for (const key of ["left", "top", "width", "height"])
      if (typeof saved[key] === "number") surface.style.setProperty(key, `${saved[key]}px`);
    setPlatformWindowZoom(surface, saved.zoom);
  } else {
    // New surfaces open as a usable workbench in the current viewport instead
    // of relying on a guessed offset that can land below a wrapped header.
    fitPlatformWindowForDefinition(surface, definition);
    setPlatformWindowZoom(surface, 1);
    globalThis.requestAnimationFrame(() => fitPlatformWindowContent(surface));
  }
  clampPlatformWindowToViewport(surface);
  surface.style.zIndex = String(++platformWindowZIndex);
  surface.addEventListener("pointerdown", () => {
    surface.style.zIndex = String(++platformWindowZIndex);
  });
  const handle = surface.querySelector("[data-platform-window-drag-handle]");
  const resize = document.createElement("div");
  resize.className = "platform-window-resize-handle";
  resize.dataset.platformWindowResizeHandle = "true";
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", `Resize ${definition.label}`);
  resize.tabIndex = 0;
  surface.append(resize);
  const startPointer = (event, mode) => {
    if (event.button !== 0 || event.target.closest("button, input, select, textarea")) return;
    event.preventDefault();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    const rect = surface.getBoundingClientRect();
    const start = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (mode === "drag") {
        surface.style.left = `${Math.max(8, start.left + dx)}px`;
        surface.style.top = `${Math.max(8, start.top + dy)}px`;
      } else {
        surface.style.width = `${Math.max(460, start.width + dx)}px`;
        surface.style.height = `${Math.max(280, start.height + dy)}px`;
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      clampPlatformWindowToViewport(surface);
      savePlatformWindowLayout(surface);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };
  handle?.addEventListener("pointerdown", (event) => startPointer(event, "drag"));
  resize.addEventListener("pointerdown", (event) => startPointer(event, "resize"));
  resize.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 80 : 20;
    const rect = surface.getBoundingClientRect();
    if (event.key === "ArrowRight") surface.style.width = `${rect.width + step}px`;
    else if (event.key === "ArrowLeft") surface.style.width = `${rect.width - step}px`;
    else if (event.key === "ArrowDown") surface.style.height = `${rect.height + step}px`;
    else if (event.key === "ArrowUp") surface.style.height = `${rect.height - step}px`;
    else return;
    event.preventDefault();
    clampPlatformWindowToViewport(surface);
    savePlatformWindowLayout(surface);
  });
}

function teardownPlatformWindow(definition) {
  const surface = elements[definition.id];
  if (!surface || surface.dataset.platformWindowReady !== "true") return;
  const wasHidden = surface.hidden;
  const content = surface.querySelector(".platform-window-content");
  if (content) {
    while (content.firstChild) surface.insertBefore(content.firstChild, content);
    content.remove();
  }
  surface.querySelector(".platform-window-titlebar")?.remove();
  surface.querySelector(".platform-window-resize-handle")?.remove();
  surface.classList.remove(
    "platform-window-surface",
    "platform-window-minimized",
    "platform-window-maximized"
  );
  surface.removeAttribute("style");
  delete surface.dataset.platformWindowReady;
  delete surface.dataset.platformWindowClosed;
  delete surface.dataset.platformWindowState;
  delete surface.dataset.platformWindowZoom;
  delete surface.dataset.platformWindowZoomCustomized;
  surface.hidden = wasHidden;
  for (const child of surface.children) child.hidden = false;
}

function applyPlatformWindowMode(mode) {
  if (!platformWindowManagerReady) return;
  const desktop = window.matchMedia("(min-width: 1181px)").matches;
  if (mode === "floating" && desktop) {
    for (const definition of platformWindowDefinitions) setupPlatformWindow(definition);
    renderPlatformWindowDock();
  } else {
    for (const definition of platformWindowDefinitions) teardownPlatformWindow(definition);
    elements["platform-window-dock"].hidden = true;
  }
}

function fitVisiblePlatformWindowContent() {
  if (!platformWindowManagerReady) return;
  globalThis.requestAnimationFrame(() => {
    for (const definition of platformWindowDefinitions) {
      const surface = elements[definition.id];
      if (
        surface?.dataset.platformWindowReady === "true" &&
        !surface.hidden &&
        surface.dataset.platformWindowZoomCustomized !== "true"
      ) {
        fitPlatformWindowContent(surface);
      }
    }
  });
}

function initializePlatformWindowManager() {
  platformWindowManagerReady = true;
  applyPlatformWindowMode(document.documentElement.dataset.windowMode ?? "standard");
}

function applyDisplayPreferences({ announce = true } = {}) {
  const values = {};
  let persisted = true;
  for (const [name, definition] of Object.entries(displayPreferenceDefinitions)) {
    const selectedValue = elements[definition.controlId].value;
    const value = definition.values.has(selectedValue) ? selectedValue : definition.fallback;
    values[name] = value;
    elements[definition.controlId].value = value;
    persisted = writeBrowserPreference(definition.storageKey, value) && persisted;
  }

  document.documentElement.dataset.theme = values.theme;
  document.documentElement.dataset.density = values.density;
  document.documentElement.dataset.textScale = values.textScale;
  document.documentElement.dataset.contentWidth = values.contentWidth;
  document.documentElement.dataset.motion = values.motion;
  document.documentElement.dataset.windowMode = values.windowMode;
  applyPlatformWindowMode(values.windowMode);
  updateBrowserThemeColor(values.theme);
  if (!elements["overview-workspace"].hidden) {
    buildWorkspaceSubnavigation(elements["overview-workspace"]);
  }

  if (announce) {
    elements["appearance-status"].textContent = persisted
      ? "Appearance saved in this browser."
      : "Appearance applied for this session. This browser blocked local saving.";
  }
  if (identity?.activeOrganizationId) trackProductEvent("DISPLAY_PREFERENCE_CHANGED");
}

function resetDisplayPreferences() {
  for (const definition of Object.values(displayPreferenceDefinitions)) {
    elements[definition.controlId].value = definition.fallback;
  }
  applyDisplayPreferences({ announce: false });
  resetDashboardPreferences({ announce: false });
  elements["appearance-status"].textContent = "Default appearance and dashboard restored.";
}

function updateBrowserThemeColor(theme) {
  const systemIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeColors = {
    light: "#142a3b",
    system: systemIsDark ? "#172432" : "#142a3b",
    evergreen: "#064b38",
    ocean: "#155e99",
    warm: "#9a4d15",
    midnight: "#101820",
    contrast: "#000000"
  };
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[theme]);
}
