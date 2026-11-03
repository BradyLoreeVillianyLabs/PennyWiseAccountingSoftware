// Home dashboard (`overview-workspace`).

import { formatMinor } from "../../money.js";
import { api } from "../api.js";
import {
  preferredScrollBehavior,
  readBrowserPreference,
  writeBrowserPreference
} from "../lib/browser.js";
import {
  dashboardPreferenceVersion,
  dashboardPreferences,
  dashboardTilePreferences,
  defaultDashboardPreferences,
  setDashboardPreferences
} from "../lib/dashboard-preferences.js";
import { countLabel } from "../lib/dom.js";
import { localCalendarDate } from "../lib/format.js";
import { trackProductEvent } from "../lib/product-analytics.js";
import {
  minorIsNonZero,
  openPlanningTab,
  registerWorkspaceCalls,
  renderDashboard,
  reportMoneyText,
  runSelectedReport,
  showSetupStep
} from "../lib/workspace-calls.js";
import {
  buildWorkspaceSubnavigation,
  navigateTo,
  revealWorkspaceTarget,
  workspaceIds
} from "../shell.js";
import {
  currentReportState,
  elements,
  identity,
  multiCurrencyState,
  setCurrentReportState,
  setup
} from "../state.js";

let booksHealthSnapshot = null;
const dashboardLayouts = new Set(["balanced", "priorities", "single"]);
const dashboardTileSizes = new Set(["compact", "standard", "wide"]);
const homeAsOfPreferenceVersion = 1;
let homeDashboardRequestVersion = 0;
let dashboardDraggingTileKey = null;

registerWorkspaceCalls({
  dashboardMoney,
  loadHomeDashboard,
  openDashboardEditor,
  readScopedDashboardPreference,
  resetDashboardPreferences,
  writeScopedDashboardPreference
});

export function initHome() {
  elements["hide-dashboard-amounts"].addEventListener("change", handleDashboardAmountPrivacyChange);
  document
    .querySelectorAll("[data-home-workspace]")
    .forEach((button) => button.addEventListener("click", () => openHomeDestination(button)));
  elements["configure-dashboard"].addEventListener("click", openDashboardEditor);
  elements["dashboard-layout-select"].addEventListener("change", () => {
    dashboardPreferences.layout = elements["dashboard-layout-select"].value;
    saveDashboardPreferences("Dashboard layout saved.");
  });
  elements["dashboard-editor-list"].addEventListener("change", handleDashboardEditorChange);
  elements["dashboard-editor-list"].addEventListener("click", handleDashboardEditorAction);
  elements["dashboard-editor-list"].addEventListener("dragstart", startDashboardTileDrag);
  elements["dashboard-editor-list"].addEventListener("dragover", dragOverDashboardTile);
  elements["dashboard-editor-list"].addEventListener("drop", dropDashboardTile);
  elements["dashboard-editor-list"].addEventListener("dragend", clearDashboardTileDrag);
  elements["reset-dashboard-layout"].addEventListener("click", resetDashboardPreferences);
  elements["refresh-home-dashboard"].addEventListener("click", refreshHomeDashboard);
  elements["home-as-of-input"].addEventListener("change", () => {
    const asOf = normalizeHomeAsOf(elements["home-as-of-input"].value);
    if (!asOf) {
      elements["home-as-of-input"].value = homeAsOfDate();
      return;
    }
    saveHomeAsOf(asOf);
    void loadHomeDashboard({ announce: true });
  });
  elements["home-data-status-action"].addEventListener("click", refreshHomeDashboard);
  elements["refresh-books-health"].addEventListener("click", loadBooksHealth);
  elements["toggle-books-health"].addEventListener("click", toggleBooksHealth);
  elements["books-health-severity-filter"].addEventListener("change", () => {
    if (booksHealthSnapshot) renderBooksHealth(booksHealthSnapshot);
  });
}

function openHomeDestination(button) {
  const workspaceId = button.dataset.homeWorkspace;
  const targetId = button.dataset.homeTarget;
  if (button.dataset.homePlanningTab) {
    openPlanningTab(button.dataset.homePlanningTab);
  } else {
    navigateTo(workspaceId);
    revealWorkspaceTarget(workspaceId, targetId);
  }
  const target = targetId ? document.getElementById(targetId) : null;
  target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  globalThis.setTimeout(() => {
    target?.querySelector("input, select, textarea, button")?.focus();
  }, 300);
}

function dashboardBrowserStorageKey() {
  const email = identity?.email?.trim().toLowerCase();
  const organizationId = identity?.activeOrganizationId;
  if (!email || !organizationId) return null;
  return `clearledger_dashboard_preferences:${encodeURIComponent(email)}:${encodeURIComponent(organizationId)}`;
}

// Tile preferences have always been scoped per user and organization. The help
// panel state and the guided tour step were not, so on a shared browser one
// business's choices followed the user into every other business, and into other
// users' sessions. These scope them the same way, falling back to the unscoped
// key so nobody's existing state is lost on upgrade.
function scopedDashboardKey(base) {
  const email = identity?.email?.trim().toLowerCase();
  const organizationId = identity?.activeOrganizationId;
  if (!email || !organizationId) return null;
  return `${base}:${encodeURIComponent(email)}:${encodeURIComponent(organizationId)}`;
}

function readScopedDashboardPreference(base) {
  const key = scopedDashboardKey(base);
  try {
    if (key) {
      const scoped = window.localStorage.getItem(key);
      if (scoped !== null) return scoped;
      // One-time migration of the pre-scoping global value.
      const legacy = window.localStorage.getItem(base);
      if (legacy !== null) {
        window.localStorage.setItem(key, legacy);
        window.localStorage.removeItem(base);
        return legacy;
      }
      return null;
    }
    return window.localStorage.getItem(base);
  } catch {
    return null;
  }
}

function writeScopedDashboardPreference(base, value) {
  try {
    window.localStorage.setItem(scopedDashboardKey(base) ?? base, value);
  } catch {
    // A browser with local storage blocked keeps the choice for this session only.
  }
}

function normalizeDashboardPreferences(value) {
  const defaults = defaultDashboardPreferences();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const savedTiles = new Map(
    Array.isArray(value.tiles)
      ? value.tiles
          .filter((tile) => tile && typeof tile === "object" && typeof tile.key === "string")
          .map((tile) => [tile.key, tile])
      : []
  );
  const orderedKeys = Array.isArray(value.tiles)
    ? value.tiles
        .map((tile) => tile?.key)
        .filter((key) => dashboardTilePreferences.some((tile) => tile.key === key))
    : [];
  const uniqueKeys = [
    ...new Set([...orderedKeys, ...dashboardTilePreferences.map((tile) => tile.key)])
  ];
  return {
    version: dashboardPreferenceVersion,
    layout: dashboardLayouts.has(value.layout) ? value.layout : defaults.layout,
    tiles: uniqueKeys.map((key) => {
      const saved = savedTiles.get(key);
      return {
        key,
        visible: saved?.visible !== false,
        size: dashboardTileSizes.has(saved?.size) ? saved.size : "standard"
      };
    })
  };
}

export function restoreDashboardPreferences() {
  const storageKey = dashboardBrowserStorageKey();
  let stored = null;
  if (storageKey) {
    try {
      stored = JSON.parse(readBrowserPreference(storageKey) || "null");
    } catch {
      stored = null;
    }
  }
  setDashboardPreferences(normalizeDashboardPreferences(stored));
  applyDashboardPreferences({ announce: false, persist: false });
}

function applyDashboardPreferences({ announce = false, persist = false, message } = {}) {
  setDashboardPreferences(normalizeDashboardPreferences(dashboardPreferences));
  document.documentElement.dataset.dashboardLayout = dashboardPreferences.layout;
  elements["dashboard-layout-select"].value = dashboardPreferences.layout;
  const dashboard = elements["home-dashboard-grid"];
  let visibleCount = 0;
  for (const tile of dashboardPreferences.tiles) {
    const definition = dashboardTilePreferences.find((candidate) => candidate.key === tile.key);
    const target = definition && elements[definition.targetId];
    if (!target) continue;
    target.hidden = !tile.visible;
    target.dataset.dashboardTileSize = tile.size;
    dashboard.append(target);
    if (tile.visible) visibleCount += 1;
  }
  dashboard.hidden = visibleCount === 0;
  renderDashboardEditor();
  if (!elements["overview-workspace"].hidden)
    buildWorkspaceSubnavigation(elements["overview-workspace"]);

  if (persist) {
    const storageKey = dashboardBrowserStorageKey();
    const saved =
      storageKey && writeBrowserPreference(storageKey, JSON.stringify(dashboardPreferences));
    const status = saved
      ? message || "Dashboard saved for this business in this browser."
      : "Dashboard applied for this session. This browser blocked local saving.";
    elements["dashboard-editor-status"].textContent = status;
    elements["appearance-status"].textContent = status;
    if (identity?.activeOrganizationId) trackProductEvent("DISPLAY_PREFERENCE_CHANGED");
  } else if (announce) {
    elements["dashboard-editor-status"].textContent = message || "Dashboard updated.";
  }
}

function saveDashboardPreferences(message) {
  applyDashboardPreferences({ persist: true, message });
}

function renderDashboardEditor() {
  const list = elements["dashboard-editor-list"];
  if (!list) return;
  list.replaceChildren(
    ...dashboardPreferences.tiles.map((tile, index) => {
      const definition = dashboardTilePreferences.find((candidate) => candidate.key === tile.key);
      const item = document.createElement("li");
      item.className = "dashboard-editor-tile";
      item.dataset.dashboardTileKey = tile.key;
      item.draggable = true;
      const labelId = `dashboard-tile-${tile.key}-label`;
      item.innerHTML = `
        <span class="dashboard-drag-handle" aria-hidden="true">⋮⋮</span>
        <div class="dashboard-editor-tile-main">
          <label class="dashboard-editor-visibility" for="dashboard-tile-${tile.key}-visible">
            <input id="dashboard-tile-${tile.key}-visible" data-dashboard-visible="${tile.key}" type="checkbox" ${tile.visible ? "checked" : ""} />
            <span id="${labelId}">${definition?.label ?? tile.key}</span>
          </label>
          <span class="dashboard-editor-tile-note">${tile.visible ? "Shown on your dashboard" : "Hidden; available to restore"}</span>
        </div>
        <label class="dashboard-editor-size">Tile size
          <select data-dashboard-size="${tile.key}" aria-labelledby="${labelId}">
            ${["compact", "standard", "wide"].map((size) => `<option value="${size}" ${tile.size === size ? "selected" : ""}>${size[0].toUpperCase()}${size.slice(1)}</option>`).join("")}
          </select>
        </label>
        <div class="dashboard-editor-move" aria-label="Move ${definition?.label ?? tile.key}">
          <button type="button" class="text-command" data-dashboard-action="up" data-dashboard-key="${tile.key}" ${index === 0 ? "disabled" : ""}>Move up</button>
          <button type="button" class="text-command" data-dashboard-action="down" data-dashboard-key="${tile.key}" ${index === dashboardPreferences.tiles.length - 1 ? "disabled" : ""}>Move down</button>
        </div>`;
      return item;
    })
  );
}

function openDashboardEditor() {
  renderDashboardEditor();
  elements["dashboard-editor-status"].textContent =
    "Dashboard editor opened. Changes save in this browser for the active business.";
  const editor = elements["dashboard-editor"];
  if (typeof editor.showModal === "function") editor.showModal();
  else editor.setAttribute("open", "");
}

function handleDashboardEditorChange(event) {
  const key = event.target.dataset.dashboardVisible || event.target.dataset.dashboardSize;
  if (!key) return;
  const tile = dashboardPreferences.tiles.find((candidate) => candidate.key === key);
  if (!tile) return;
  if (event.target.dataset.dashboardVisible) tile.visible = event.target.checked;
  if (event.target.dataset.dashboardSize && dashboardTileSizes.has(event.target.value))
    tile.size = event.target.value;
  saveDashboardPreferences(
    `${dashboardTilePreferences.find((candidate) => candidate.key === key)?.label ?? "Dashboard tile"} updated.`
  );
}

function handleDashboardEditorAction(event) {
  const action = event.target.dataset.dashboardAction;
  const key = event.target.dataset.dashboardKey;
  if (!action || !key) return;
  const index = dashboardPreferences.tiles.findIndex((tile) => tile.key === key);
  const nextIndex = action === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= dashboardPreferences.tiles.length) return;
  [dashboardPreferences.tiles[index], dashboardPreferences.tiles[nextIndex]] = [
    dashboardPreferences.tiles[nextIndex],
    dashboardPreferences.tiles[index]
  ];
  saveDashboardPreferences(
    `${dashboardTilePreferences.find((tile) => tile.key === key)?.label ?? "Dashboard tile"} moved ${action}.`
  );
}

function startDashboardTileDrag(event) {
  const item = event.target.closest("[data-dashboard-tile-key]");
  if (!item) return;
  dashboardDraggingTileKey = item.dataset.dashboardTileKey;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dashboardDraggingTileKey);
  item.classList.add("is-dragging");
}

function dragOverDashboardTile(event) {
  const item = event.target.closest("[data-dashboard-tile-key]");
  if (
    !item ||
    !dashboardDraggingTileKey ||
    item.dataset.dashboardTileKey === dashboardDraggingTileKey
  )
    return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  for (const tile of elements["dashboard-editor-list"].querySelectorAll(".is-drop-target"))
    tile.classList.remove("is-drop-target");
  item.classList.add("is-drop-target");
}

function dropDashboardTile(event) {
  const item = event.target.closest("[data-dashboard-tile-key]");
  if (!item || !dashboardDraggingTileKey) return;
  event.preventDefault();
  const from = dashboardPreferences.tiles.findIndex(
    (tile) => tile.key === dashboardDraggingTileKey
  );
  const to = dashboardPreferences.tiles.findIndex(
    (tile) => tile.key === item.dataset.dashboardTileKey
  );
  if (from >= 0 && to >= 0 && from !== to) {
    const [moved] = dashboardPreferences.tiles.splice(from, 1);
    dashboardPreferences.tiles.splice(to, 0, moved);
    saveDashboardPreferences(
      `${dashboardTilePreferences.find((tile) => tile.key === moved.key)?.label ?? "Dashboard tile"} reordered.`
    );
  }
  clearDashboardTileDrag();
}

function clearDashboardTileDrag() {
  dashboardDraggingTileKey = null;
  for (const item of elements["dashboard-editor-list"].querySelectorAll(
    ".is-dragging, .is-drop-target"
  )) {
    item.classList.remove("is-dragging", "is-drop-target");
  }
}

function resetDashboardPreferences({ announce = true } = {}) {
  setDashboardPreferences(defaultDashboardPreferences());
  applyDashboardPreferences({
    persist: Boolean(dashboardBrowserStorageKey()),
    announce,
    message: "Dashboard defaults restored."
  });
}

function normalizeHomeAsOf(value) {
  const candidate = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? candidate
    : null;
}

function homeAsOfStorageKey() {
  const email = identity?.email?.trim().toLowerCase();
  const organizationId = identity?.activeOrganizationId;
  if (!email || !organizationId) return null;
  return `clearledger_home_as_of:v${homeAsOfPreferenceVersion}:${encodeURIComponent(email)}:${encodeURIComponent(organizationId)}`;
}

function homeAsOfDate() {
  const stored = normalizeHomeAsOf(readBrowserPreference(homeAsOfStorageKey() ?? ""));
  return stored ?? localCalendarDate();
}

function saveHomeAsOf(asOf) {
  const key = homeAsOfStorageKey();
  if (key) writeBrowserPreference(key, asOf);
}

function setHomeDataState(state, message, { action = false } = {}) {
  const status = elements["home-data-status"];
  status.dataset.state = state;
  status.hidden = !message;
  elements["home-data-status-message"].textContent = message ?? "";
  elements["home-data-status-action"].hidden = !action;
  elements["home-data-status-action"].disabled = false;
  elements["overview-workspace"].setAttribute("aria-busy", String(state === "loading"));
}

function initializeHomeAsOfControl() {
  const asOf = homeAsOfDate();
  elements["home-as-of-input"].value = asOf;
  return asOf;
}

export async function loadHomeDashboard({ announce = false } = {}) {
  if (!identity?.activeOrganizationId) return;
  const requestVersion = ++homeDashboardRequestVersion;
  const asOf = initializeHomeAsOfControl();
  const hadData = elements["overview-workspace"].dataset.dashboardLoaded === "true";
  // A new blank company has no control accounts yet. Do not ask the accounting
  // dashboard to calculate balances and then surface its expected 422 in the
  // browser console; render the existing setup-safe state instead. The setup
  // workflow is the source of truth here because the membership summary can
  // briefly remain stale after an account preset is applied.
  const industryPresetStatus = setup?.steps?.find(
    (step) => step.step === "INDUSTRY_PRESET"
  )?.status;
  const dashboardRequiresSetup =
    Boolean(industryPresetStatus) && !["COMPLETED", "SKIPPED"].includes(industryPresetStatus);
  setHomeDataState(
    "loading",
    hadData || announce ? `Refreshing dashboard as of ${asOf}…` : "Loading your dashboard…"
  );
  const [response, booksHealthResponse] = await Promise.all([
    dashboardRequiresSetup
      ? Promise.resolve(null)
      : api(`/v1/dashboard?asOf=${encodeURIComponent(asOf)}`, {}, true),
    dashboardRequiresSetup
      ? Promise.resolve(null)
      : api(`/v1/books-health?asOf=${encodeURIComponent(asOf)}`, {}, true)
  ]);
  if (requestVersion !== homeDashboardRequestVersion) return;
  if (booksHealthResponse?.ok) {
    try {
      renderBooksHealth((await booksHealthResponse.json()).booksHealth);
    } catch {
      renderBooksHealthUnavailable("Books Health returned an unreadable response.");
    }
  } else if (booksHealthResponse) {
    renderBooksHealthUnavailable(
      booksHealthResponse.status === 401 || booksHealthResponse.status === 403
        ? "Books Health is not available for your current role."
        : undefined
    );
  } else {
    renderBooksHealthUnavailable(
      "Complete company setup to begin the read-only Books Health check."
    );
  }
  if (dashboardRequiresSetup) {
    renderHomeDashboardUnavailable(422, asOf);
    return;
  }
  if (!response?.ok) {
    renderHomeDashboardUnavailable(response?.status ?? 503, asOf);
    return;
  }
  try {
    renderHomeDashboard((await response.json()).dashboard);
  } catch {
    renderHomeDashboardUnavailable(500, asOf);
  }
}

async function refreshHomeDashboard() {
  const button = elements["refresh-home-dashboard"];
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    await loadHomeDashboard();
  } finally {
    button.disabled = false;
    button.textContent = "Refresh";
  }
}

async function loadBooksHealth() {
  if (!identity?.activeOrganizationId) return;
  const button = elements["refresh-books-health"];
  button.disabled = true;
  elements["books-health-summary"].textContent = "Refreshing five read-only checks…";
  try {
    const asOf = initializeHomeAsOfControl();
    const response = await api(`/v1/books-health?asOf=${encodeURIComponent(asOf)}`, {}, true);
    if (!response.ok) {
      renderBooksHealthUnavailable(
        response.status === 401 || response.status === 403
          ? "Books Health is not available for your current role."
          : undefined
      );
      return;
    }
    renderBooksHealth((await response.json()).booksHealth);
    trackProductEvent("CLOSE_READINESS_VIEWED");
  } finally {
    button.disabled = false;
  }
}

function renderBooksHealth(booksHealth) {
  if (booksHealth?.mode !== "READ_ONLY" || booksHealth?.accountingEntriesCreated !== 0) {
    renderBooksHealthUnavailable(
      "Books Health returned an unexpected safety response, so its findings are hidden."
    );
    return;
  }
  booksHealthSnapshot = booksHealth;
  const summary = booksHealth.summary ?? {};
  elements["books-health-card"].dataset.status = booksHealth.status;
  elements["books-health-summary"].textContent =
    booksHealth.status === "NO_FINDINGS"
      ? `Good · ${summary.checkedAreas ?? 5} areas checked`
      : `${countLabel(summary.blockerCount, "blocker", "blockers")} · ${countLabel(summary.warningCount, "warning", "warnings")} · ${countLabel(summary.noticeCount, "notice", "notices")}`;
  elements["books-health-disclaimer"].textContent = booksHealth.disclaimer;

  const areaLabels = new Map((booksHealth.areas ?? []).map((area) => [area.category, area.label]));
  const severityFilter = elements["books-health-severity-filter"].value;
  const findings = (booksHealth.findings ?? []).filter(
    (finding) => severityFilter === "ALL" || finding.severity === severityFilter
  );
  if (!booksHealth.findings?.length || !findings.length) {
    elements["toggle-books-health"].hidden = true;
    elements["books-health-card"].dataset.collapsible = "false";
    setBooksHealthExpanded(false);
    const empty = document.createElement("p");
    empty.className = "empty-state books-health-clear";
    empty.textContent = booksHealth.findings?.length
      ? "No checks match this severity filter. Choose All checks to see the complete review list."
      : "No automated exceptions were found in commerce, banking, imports, tax settings, or period close.";
    elements["books-health-findings"].replaceChildren(empty);
    return;
  }

  // The one-line clamp on a finding exists to keep a long list compact. When
  // there are too few findings to warrant the "View all checks" expander, the
  // clamp had nothing to expand it with and simply cut the text off mid-sentence,
  // so the collapsible state drives both the button and the clamp.
  const collapsible = findings.length > 2;
  elements["toggle-books-health"].hidden = !collapsible;
  elements["books-health-card"].dataset.collapsible = String(collapsible);
  setBooksHealthExpanded(false);

  elements["books-health-findings"].replaceChildren(
    ...findings.map((finding) => {
      const row = document.createElement("article");
      row.className = "books-health-finding";
      row.dataset.severity = finding.severity;
      const copy = document.createElement("div");
      copy.className = "books-health-finding-copy";
      const meta = document.createElement("p");
      meta.className = "books-health-finding-meta";
      const severity = document.createElement("span");
      severity.className = "books-health-severity";
      severity.textContent =
        finding.severity === "BLOCKER"
          ? "Action needed"
          : finding.severity === "WARNING"
            ? "Review"
            : "Notice";
      const category = document.createElement("span");
      category.textContent = `${areaLabels.get(finding.category) ?? finding.category} · ${countLabel(finding.count, "item", "items")}`;
      meta.append(severity, category);
      const title = document.createElement("h3");
      title.textContent = finding.title;
      const reason = document.createElement("p");
      reason.textContent = finding.reason;
      copy.append(meta, title, reason);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary-command books-health-action";
      action.textContent = finding.target.label;
      action.addEventListener("click", () => openBooksHealthTarget(finding.target));
      row.append(copy, action);
      return row;
    })
  );
}

function renderBooksHealthUnavailable(
  message = "Books Health could not be refreshed. Other Home information remains available."
) {
  booksHealthSnapshot = null;
  elements["books-health-card"].dataset.status = "UNAVAILABLE";
  elements["toggle-books-health"].hidden = true;
  setBooksHealthExpanded(false);
  elements["books-health-summary"].textContent = message;
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent =
    "Try Refresh checks. PennyWise Accounting will not treat an unavailable check as all clear.";
  elements["books-health-findings"].replaceChildren(empty);
  elements["books-health-disclaimer"].textContent =
    "Books Health is read-only and never posts accounting entries. An unavailable check is not professional approval.";
}

function toggleBooksHealth() {
  setBooksHealthExpanded(elements["books-health-card"].dataset.expanded !== "true");
}

function setBooksHealthExpanded(expanded) {
  elements["books-health-card"].dataset.expanded = String(expanded);
  elements["toggle-books-health"].setAttribute("aria-expanded", String(expanded));
  elements["toggle-books-health"].textContent = expanded ? "Show fewer checks" : "View all checks";
}

function openBooksHealthTarget(target) {
  if (!target || !workspaceIds.includes(target.workspaceId)) return;
  navigateTo(target.workspaceId);
  if (target.setupStep && setup?.steps?.some((step) => step.step === target.setupStep)) {
    showSetupStep(target.setupStep);
  }
  globalThis.setTimeout(() => {
    const destination = document.getElementById(target.anchorId);
    destination?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
    if (destination) {
      destination.setAttribute("tabindex", "-1");
      destination.focus({ preventScroll: true });
    }
  }, 120);
}

function renderHomeDashboard(dashboard) {
  setCurrentReportState({ ...(currentReportState ?? {}), dashboard });
  elements["overview-workspace"].dataset.dashboardLoaded = "true";
  elements["home-as-of-label"].textContent = `As of ${dashboard.asOf}`;
  setHomeDataState("ready", `Dashboard updated for ${dashboard.asOf}.`);
  const bankItems = Number(dashboard.unreconciledBankItems ?? 0);
  const lowStock = Array.isArray(dashboard.lowStock) ? dashboard.lowStock : [];
  const attentionItems = [];
  if (bankItems > 0) {
    attentionItems.push({
      title: `${bankItems} bank item${bankItems === 1 ? "" : "s"} to review`,
      detail: "Match, categorize, transfer, or exclude each item before reconciling.",
      action: "Review banking",
      workspaceId: "banking-workspace",
      tone: "attention"
    });
  }
  if (minorIsNonZero(dashboard.overdueInvoicesMinor)) {
    const overdue = dashboardMoney(dashboard.overdueInvoicesMinor, dashboard.currency, "Overdue");
    attentionItems.push({
      title: `${overdue.text} overdue`,
      detail: "Receivables are past due and may need customer follow-up.",
      action: "View invoices",
      workspaceId: "sales-workspace",
      tone: "overdue"
    });
  }
  if (minorIsNonZero(dashboard.upcomingBillsMinor)) {
    const dueSoon = dashboardMoney(
      dashboard.upcomingBillsMinor,
      dashboard.currency,
      "Bills due soon"
    );
    attentionItems.push({
      title: `${dueSoon.text} in bills due soon`,
      detail: "Review payment timing against available cash.",
      action: "Review bills",
      workspaceId: "purchases-workspace",
      tone: "attention"
    });
  }
  if (lowStock.length > 0) {
    attentionItems.push({
      title: `${lowStock.length} product${lowStock.length === 1 ? "" : "s"} at or below reorder point`,
      detail: "Review quantities before the next sale or purchase.",
      action: "Review inventory",
      workspaceId: "inventory-workspace",
      tone: "attention"
    });
  }
  if (!attentionItems.length) {
    attentionItems.push({
      title: "No immediate dashboard exceptions",
      detail:
        "No overdue receivables, bank items, bills due soon, or low-stock alerts were found. Books Health may list other checks.",
      action: null,
      workspaceId: null,
      tone: "complete"
    });
  }
  elements["home-attention-list"].replaceChildren(
    ...attentionItems.map((item) => {
      const row = document.createElement("article");
      row.className = "attention-row";
      row.dataset.tone = item.tone;
      const marker = document.createElement("span");
      marker.className = "attention-marker";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = item.tone === "complete" ? "✓" : "!";
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      const detail = document.createElement("p");
      title.textContent = item.title;
      detail.textContent = item.detail;
      copy.append(title, detail);
      row.append(marker, copy);
      if (item.action && item.workspaceId) {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "text-command";
        action.textContent = item.action;
        action.addEventListener("click", () => navigateTo(item.workspaceId));
        row.append(action);
      }
      return row;
    })
  );
  // "Cash balance" is the first tile of the business summary band directly above
  // this panel; repeating it here said the same number twice and cost a row that
  // Cash & tax could use for something the operator cannot already see.
  const positionMetrics = [
    ["Estimated tax position", dashboard.estimatedTaxPositionMinor],
    ["Bank items to review", String(bankItems), "count"]
  ];
  elements["home-cash-overview"].replaceChildren(
    ...positionMetrics.map(([label, value, kind]) => {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent =
        kind === "count" ? value : dashboardMoney(value, dashboard.currency, label).text;
      group.append(term, detail);
      return group;
    })
  );
  const summary = [
    ["Cash balance", dashboard.cashMinor, "banking", "cash"],
    ["Receivables", dashboard.unpaidInvoicesMinor, "receivables", "receivables"],
    ["Upcoming bills", dashboard.upcomingBillsMinor, "payables", "payables"],
    ["Sales this month", dashboard.salesThisMonthMinor, "sales", "profit"],
    ["Expenses this month", dashboard.expensesThisMonthMinor, "expenses", "profit"],
    ["Estimated profit", dashboard.estimatedProfitMinor, "profit-and-loss", "profit"]
  ];
  delete elements["home-business-summary"].dataset.state;
  delete elements["overview-workspace"].dataset.dashboardData;
  const summaryNodes = summary.map(([label, value, reportName, linkKey]) => {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    const action = document.createElement("button");
    term.textContent = label;
    action.type = "button";
    action.className = "summary-value";
    const money = dashboardMoney(value, dashboard.currency, label);
    action.textContent = money.text;
    action.setAttribute("aria-label", money.aria);
    action.title = money.aria;
    action.addEventListener("click", () =>
      openHomeReport(reportName, dashboard.links?.[linkKey], dashboard.asOf)
    );
    detail.append(action);
    group.append(term, detail);
    return group;
  });
  if (
    multiCurrencyState?.enabled &&
    Array.isArray(dashboard.foreignExposure) &&
    dashboard.foreignExposure.length
  ) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    const action = document.createElement("button");
    term.textContent = "Foreign exposure";
    action.type = "button";
    action.className = "summary-value";
    const exposure = dashboard.foreignExposure
      .map((item) => `${item.currency} ${reportMoneyText(item.amountMinor, dashboard.currency)}`)
      .join(", ");
    action.textContent = dashboardAmountsHidden() ? "••••" : exposure;
    action.setAttribute(
      "aria-label",
      dashboardAmountsHidden() ? "Foreign exposure: amount hidden" : `Foreign exposure: ${exposure}`
    );
    action.addEventListener("click", () =>
      openHomeReport("receivables", dashboard.links?.receivables, dashboard.asOf)
    );
    detail.append(action);
    group.append(term, detail);
    summaryNodes.push(group);
  }
  elements["home-business-summary"].replaceChildren(...summaryNodes);
}

function openHomeReport(reportName, link, asOf) {
  const form = elements["report-filter-form"];
  const reportUrl = link ? new URL(`/api${link}`, window.location.origin) : null;
  const query = reportUrl ? reportUrl.searchParams : new URLSearchParams();
  const selectedAsOf = normalizeHomeAsOf(query.get("asOf") ?? asOf) ?? homeAsOfDate();
  const selectedFrom = normalizeHomeAsOf(query.get("from"));
  const selectedTo = normalizeHomeAsOf(query.get("to"));
  form.elements.reportName.value = reportName;
  form.elements.asOf.value = selectedAsOf;
  form.elements.from.value = selectedFrom ?? `${selectedAsOf.slice(0, 8)}01`;
  form.elements.to.value = selectedTo ?? selectedAsOf;
  navigateTo("reports-workspace", { scrollToTop: true, refreshData: false });
  void runSelectedReport();
}

function buildDashboardUnavailableNotice(setupRequired, permissionDenied) {
  const notice = document.createElement("div");
  notice.className = "home-summary-unavailable";
  const heading = document.createElement("p");
  heading.className = "home-summary-unavailable-title";
  heading.textContent = permissionDenied
    ? "Financial indicators are not available for your role"
    : setupRequired
      ? "Financial indicators appear once company setup is complete"
      : "Financial indicators are unavailable right now";
  const detail = document.createElement("p");
  detail.className = "home-summary-unavailable-detail";
  detail.textContent = permissionDenied
    ? "Ask an owner or administrator if you need access to balances and review counts."
    : setupRequired
      ? "Add your business profile, fiscal year, and starting accounts. PennyWise Accounting will not replace missing accounting configuration with zeroes."
      : "No zero values were assumed. Refresh before relying on balances or review counts.";
  // No action button here on purpose: "Needs attention" directly below is the
  // established place for a task and its action, and rendering "Open company
  // setup" in both panels put the same button on screen twice. This panel
  // explains why the figures are absent; that one carries the task.
  notice.append(heading, detail);
  return notice;
}

function renderHomeDashboardUnavailable(statusCode, asOf) {
  const hasPreviousData = elements["overview-workspace"].dataset.dashboardLoaded === "true";
  const permissionDenied = statusCode === 401 || statusCode === 403;
  const setupRequired = statusCode === 422;
  const message = permissionDenied
    ? "Dashboard access is not available for your current role."
    : setupRequired
      ? "Complete company setup to activate your dashboard."
      : statusCode === 503
        ? "The dashboard service is unavailable."
        : "The dashboard could not be refreshed.";
  elements["home-as-of-label"].textContent = hasPreviousData
    ? `Showing the last successful dashboard · as of ${elements["home-as-of-label"].textContent.replace(/^As of /, "")}`
    : "Current data unavailable";
  // Incomplete setup is an expected state for a new company, not a failure: it
  // gets its own neutral treatment rather than the danger colour, and no
  // "Try again" — retrying cannot succeed until the operator finishes setup.
  setHomeDataState(
    permissionDenied ? "permission" : setupRequired ? "setup" : "error",
    hasPreviousData ? `${message} Previous values remain visible.` : message,
    { action: !permissionDenied && !setupRequired }
  );
  if (hasPreviousData) return;
  if (!permissionDenied) elements["home-as-of-label"].textContent = `As of ${asOf} · unavailable`;
  // Nine consecutive "Unavailable" cells (six here, three in Cash & tax) said one
  // thing nine times and buried the only sentence that helped. Say it once, in
  // the band's own space, and keep the guarantee that no zeroes were assumed.
  elements["home-business-summary"].dataset.state = "unavailable";
  elements["home-business-summary"].replaceChildren(
    buildDashboardUnavailableNotice(setupRequired, permissionDenied)
  );
  // Not `.hidden` — that property is owned by the tile-preference system, and
  // writing it here would silently override the user's own show/hide choice.
  elements["overview-workspace"].dataset.dashboardData = "unavailable";
  const row = document.createElement("article");
  row.className = "attention-row";
  row.dataset.tone = "unavailable";
  const marker = document.createElement("span");
  marker.className = "attention-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "—";
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = setupRequired
    ? "Finish setup before relying on financial values"
    : "Dashboard values are unavailable";
  const detail = document.createElement("p");
  detail.textContent = setupRequired
    ? "Add your business profile, fiscal year, and starting accounts. PennyWise Accounting will not replace missing accounting configuration with zeroes."
    : "Refresh before relying on balances or review counts. No zero values were assumed.";
  copy.append(title, detail);
  row.append(marker, copy);
  // "Try again" is only honest when retrying can succeed. Incomplete setup is not
  // a failed request; retrying it will never work until the operator finishes setup.
  if (!permissionDenied && !setupRequired) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "text-command";
    retry.textContent = "Try again";
    retry.addEventListener("click", refreshHomeDashboard);
    row.append(retry);
  } else if (setupRequired) {
    const openSetup = document.createElement("button");
    openSetup.type = "button";
    openSetup.className = "text-command";
    openSetup.textContent = "Open company setup";
    openSetup.addEventListener("click", () => navigateTo("setup-workspace"));
    row.append(openSetup);
  }
  elements["home-attention-list"].replaceChildren(row);
  elements["home-cash-overview"].replaceChildren(
    ...["Cash balance", "Estimated tax position", "Bank items to review"].map((label) =>
      unavailableMetric(label)
    )
  );
}

function unavailableMetric(label) {
  const group = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = "Unavailable";
  group.append(term, detail);
  return group;
}

function dashboardAmountsHidden() {
  return readScopedDashboardPreference("clearledger_dashboard_hide_amounts") === "true";
}

export function initializeDashboardAmountPrivacy() {
  elements["hide-dashboard-amounts"].checked = dashboardAmountsHidden();
}

function handleDashboardAmountPrivacyChange(event) {
  const hidden = event.currentTarget.checked;
  writeScopedDashboardPreference("clearledger_dashboard_hide_amounts", String(hidden));
  renderDashboard(currentReportState?.dashboard ?? null);
  if (elements["overview-workspace"].dataset.dashboardLoaded === "true") void loadHomeDashboard();
  elements["dashboard-editor-status"].textContent = hidden
    ? "Dashboard amounts are hidden in this browser for this business."
    : "Dashboard amounts are visible in this browser for this business.";
}

function dashboardMoney(value, currency, label) {
  if (dashboardAmountsHidden()) return { text: "••••", aria: `${label}: amount hidden` };
  const text = formatMinor(value, currency);
  return { text, aria: `${label}: ${text}` };
}
