import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import {
  assembleIndexHtml,
  readWebScripts,
  readWebStyles,
  verifyModuleBoundaries
} from "./web-sources.mjs";

const root = resolve(import.meta.dirname, "..");
for (const file of [
  "index.html",
  "app.js",
  "pwa.js",
  "money.js",
  "styles.css",
  "manifest.webmanifest",
  "service-worker.js",
  "offline.html",
  "icons/clearledger.svg",
  "icons/clearledger-maskable.svg",
  "serve.mjs"
]) {
  await access(resolve(root, file), constants.R_OK);
}
await verifyModuleBoundaries(root);
const html = await assembleIndexHtml(root);
const normalizedHtml = html.replace(/\s+/g, " ");
for (const required of [
  '<meta name="theme-color" content="#142a3b"',
  '<link rel="manifest" href="/manifest.webmanifest"',
  '<link rel="icon" href="/icons/clearledger.svg"',
  '<script src="/pwa.js" defer>',
  'data-runtime-mode="standard"',
  'id="controlled-share-loading"',
  'id="session-loading" class="session-loading" role="status"',
  'id="signed-out" class="auth-state" hidden',
  "Opening your test company…"
]) {
  if (!html.includes(required)) {
    throw new Error(`Installable web shell is missing ${required}.`);
  }
}
for (const required of [
  "app.js",
  "styles.css",
  "local-identity-form",
  "organization-form",
  "invitation-form",
  "setup-workspace",
  "profile-form",
  "company-management-list",
  "company-create-form",
  "company-management-status",
  "workflow-preferences-form",
  "workflow-safety-controls",
  "multi-currency-form",
  "fx-rate-form",
  "suggest-boc-rate",
  "fx-rate-suggestion-status",
  "opening-form",
  "sales-workspace",
  "global-search-menu",
  "global-search-input",
  "global-search-results",
  "customer-form",
  "product-form",
  "invoice-form",
  "invoice-preview",
  "bulk-entry-section",
  "bulk-entry-grid",
  "bulk-entry-save",
  "bulk-entry-save-close",
  "bulk-entry-clear",
  "bulk-entry-status",
  "bulk-entry-preview",
  "customer-deposit-form",
  "customer-deposit-requests",
  "progress-billing-form",
  "progress-billing-detail",
  "progress-billing-plans",
  "recurring-schedule-form",
  "recurring-schedules",
  "payments-workspace",
  "payment-settings-form",
  "manual-payment-form",
  "refund-form",
  "payment-disputes",
  "purchases-workspace",
  "purchase-request-form",
  "purchase-requests",
  "projects-workspace",
  "calendar-panel",
  "calendar-date",
  "calendar-timed-grid",
  "calendar-grid",
  "calendar-agenda-section",
  "project-work-item-form",
  "project-work-items",
  "project-work-item-details",
  "project-form",
  "time-entry-form",
  "mileage-form",
  "capture-form",
  "projects",
  "project-activity",
  "vendor-form",
  "bill-form",
  "expense-form",
  "bill-payment-form",
  "vendor-credit-form",
  "payables-aging",
  "evidence-inbox",
  "capture-conversion-dialog",
  "capture-conversion-form",
  "capture-evidence-preview",
  "capture-conversion-result",
  "open-capture-linked-draft",
  "capture-conversion-dialog",
  "capture-evidence-preview",
  "capture-conversion-form",
  "capture-conversion-fields",
  "capture-conversion-status",
  "capture-conversion-result",
  "submit-capture-conversion",
  "banking-workspace",
  "planning-workspace",
  "cash-assumption-form",
  "cash-assumptions",
  "cash-forecast",
  "budget-form",
  "budget-draft-lines",
  "budgets",
  "budget-detail",
  "fixed-assets-workspace",
  "fixed-asset-class-form",
  "fixed-asset-form",
  "fixed-asset-classes",
  "fixed-assets",
  "fixed-asset-preview",
  "fixed-asset-depreciation-schedule",
  "bank-account-form",
  "bank-feed-connect",
  "bank-feed-local-account",
  "bank-feed-status",
  "bank-feed-boundary",
  "bank-feed-connections",
  "bank-feed-mapping-dialog",
  "bank-feed-mapping-form",
  "bank-feed-mapping-status",
  "bank-import-form",
  "bank-import-preview",
  "bank-transactions",
  "bank-category-form",
  "bank-match-form",
  "bank-transfer-form",
  "bank-rule-form",
  "bank-reconciliation-form",
  "bank-reconciliation-summary",
  "inventory-workspace",
  "inventory-location-form",
  "inventory-product-form",
  "inventory-receipt-form",
  "inventory-customer-return-form",
  "inventory-vendor-return-form",
  "inventory-adjustment-form",
  "inventory-transfer-form",
  "inventory-quantities",
  "inventory-movements",
  "inventory-low-stock",
  "inventory-cogs",
  "inventory-reconciliation",
  "reports-workspace",
  "report-filter-form",
  "dashboard-summary",
  "report-table",
  "export-report",
  "print-report",
  "accountant-workspace",
  "payroll-workspace",
  "payroll-settings-form",
  "ensure-ca-ab-payroll-codes",
  "payroll-worker-form",
  "payroll-schedule-form",
  "payroll-period-form",
  "payroll-scheduled-draft-form",
  "payroll-automation-form",
  "payroll-runs",
  "payroll-run-detail",
  "about-workspace",
  "manual-journal-form",
  "manual-journal-lines",
  "add-manual-journal-line",
  "manual-journal-difference",
  "manual-journal-drafts",
  "accountant-periods",
  "accountant-review-items",
  "journal-trace-form",
  "audit-filter-form",
  "audit-events",
  "portability-workspace",
  "data-import-form",
  "data-import-source-guide",
  "data-import-source-system",
  "data-import-source-guide-heading",
  "data-import-source-summary",
  "data-import-source-checklist",
  "data-import-source-help",
  "download-import-template",
  "data-import-currency-warning",
  "data-import-status",
  "import-item-match-review",
  "import-item-match-rows",
  "previous-import-item-matches",
  "next-import-item-matches",
  "import-item-match-page-status",
  "organization-export-form",
  "organization-export-status",
  "organization-closure-form",
  "organization-closure-status",
  "activation-card",
  "activation-checklist",
  "help-workspace",
  "guided-tour-progress",
  "guided-tour-open-step",
  "help-search",
  "help-topic-grid",
  "dashboard-help-panel",
  "toggle-dashboard-help",
  "data-demo-company-option",
  "data-create-demo-company",
  "books-health-card",
  "books-health-summary",
  "books-health-findings",
  "books-health-disclaimer",
  "refresh-books-health",
  "refresh-home-dashboard",
  "home-as-of-label",
  "toggle-books-health",
  "download-support-diagnostics",
  "bug-report-form",
  "bug-report-status",
  "copy-bug-report",
  "download-bug-report",
  "email-bug-report",
  "product-analytics-consent",
  "theme-select",
  "content-width-select",
  "motion-select",
  "window-mode-select",
  "platform-window-dock",
  "dashboard-layout-select",
  "configure-dashboard",
  "dashboard-editor",
  "dashboard-editor-list",
  "reset-dashboard-layout",
  "reset-display-preferences",
  "close-appearance-menu",
  "appearance-status",
  "home-dashboard-grid",
  "home-attention-section",
  "home-cash-section",
  "home-quick-actions",
  "home-getting-started",
  "load-commerce-demo",
  "commerce-view-navigation",
  "commerce-catalog-view",
  "catalog-poll-form",
  "catalog-product-list",
  "catalog-selection",
  "catalog-product-dialog",
  "commerce-inventory-sync-view",
  "inventory-sync-policy-form",
  "inventory-sync-policies",
  "inventory-sync-conflicts",
  "inventory-conflict-dialog",
  "inventory-sync-operations",
  "open-catalog-bulk-create",
  "catalog-bulk-product-dialog",
  "catalog-bulk-product-form",
  "catalog-bulk-product-selection"
]) {
  if (!html.includes(required)) {
    throw new Error(`Identity web asset is missing ${required}.`);
  }
}
const script = await readWebScripts(root);
const stylesheet = await readWebStyles(root);
for (const required of [
  'id="sales-delivery-boundary"',
  'id="payment-provider-boundary"',
  'id="hosted-payment-settings-section" hidden',
  'id="connect-payment-account" type="button" hidden',
  'id="refund-submit"',
  "PennyWise Accounting does not collect, transfer,",
  "Record refund already paid"
]) {
  // Prettier may wrap explanatory copy between words. Validate the rendered
  // text contract rather than treating harmless source formatting as a missing
  // safety disclosure.
  if (!normalizedHtml.includes(required)) {
    throw new Error(`The beta provider boundary interface is missing ${required}.`);
  }
}
for (const required of [
  "function renderBankFeedPanel",
  "function startBankFeedConnection",
  "function loadPlaidLinkLibrary",
  "Use Sync now to place activity in the review queue."
]) {
  if (!script.includes(required)) {
    throw new Error(`The connected bank-feed workflow is missing ${required}.`);
  }
}
for (const required of [
  "session.runtimeCapabilities?.emailDelivery === true",
  "session.runtimeCapabilities?.hostedPayments === true",
  "if (!runtimeCapabilities.emailDelivery)",
  "if (!runtimeCapabilities.hostedPayments)",
  "downloadInvoiceForManualSend",
  "PennyWise Accounting did not send an email",
  "Beta customer links are for local or controlled-share testing only",
  "No funds can move through PennyWise Accounting",
  "Refund recorded in the ledger; PennyWise Accounting did not move funds."
]) {
  if (!script.includes(required)) {
    throw new Error(`The beta provider fail-safe flow is missing ${required}.`);
  }
}
if (!/id="load-commerce-demo"[^>]*\bhidden\b/.test(html)) {
  throw new Error("The development commerce demo control must be hidden until enabled by the API.");
}
if (!script.includes('"about-workspace"')) {
  throw new Error("About PennyWise Accounting must be registered as a workspace.");
}
for (const required of [
  '"payroll-workspace"',
  '"/v1/payroll/overview"',
  '"/v1/payroll/ca-ab-base-codes"',
  "function performPayrollRunAction",
  "Direct deposit and tax filing remain provider-gated",
  "It cannot calculate, approve, post, pay, or file payroll"
]) {
  if (!script.includes(required)) {
    throw new Error(`The payroll control workflow is missing ${required}.`);
  }
}
for (const required of [
  "PennyWise Accounting does not move payroll funds or file taxes.",
  "This screen intentionally does not collect government identifiers or bank details.",
  "Direct deposit and filing are not connected"
]) {
  if (!normalizedHtml.includes(required)) {
    throw new Error(`The payroll safety boundary is missing ${required}.`);
  }
}
for (const required of [
  ".home-toolbar h1",
  "font-size: clamp(22px, 2vw, 26px)",
  "grid-template-columns: repeat(6, minmax(0, 1fr))",
  ".home-dashboard",
  ".home-disclosures",
  ".switching-source-guide"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The compact responsive Home and switching layout is missing ${required}.`);
  }
}
for (const required of [
  'data-commerce-view-target="catalog"',
  'data-commerce-view-target="inventory"',
  "Suggestions never become accounting or inventory authority on their own.",
  "I approve this named system as the",
  "Creating the item does not post a journal or move inventory."
]) {
  if (!html.includes(required)) {
    throw new Error(`The staged commerce review interface is missing ${required}.`);
  }
}
for (const required of [
  "/v1/organizations/current/catalog?limit=200",
  "/catalog/poll",
  "/candidates/${candidate.id}/${action}",
  "/create-local-product",
  "/catalog/images/${image.id}/${action}",
  "/v1/organizations/current/inventory-sync/policies",
  "/inventory-sync/conflicts/${activeInventoryConflict.conflict.id}/resolve",
  'request.headers["idempotency-key"] = globalThis.crypto.randomUUID()',
  "skuSimilarityBasisPoints",
  "nameSimilarityBasisPoints",
  "descriptionSimilarityBasisPoints",
  "compositeSimilarityBasisPoints",
  "catalogReasonCodes",
  "reason v${",
  "Nearest-field evidence",
  "Fuzzy evidence never approves or links an item.",
  "Accounting entries created: 0."
]) {
  if (!script.includes(required)) {
    throw new Error(`The catalog and inventory automation web flow is missing ${required}.`);
  }
}
for (const required of [
  "/item-match-suggestions?offset=${encodeURIComponent(offset)}&limit=25",
  "currentImportItemMatches",
  "renderImportItemMatchReview",
  "importItemMatchCandidate",
  'evidence.setAttribute("aria-label", "Nearest-field evidence")',
  "EXACT_SKU_REQUIRED_FOR_INVENTORY_POSTING",
  "currentImportItemMatches.nextOffset"
]) {
  if (!script.includes(required)) {
    throw new Error(`The spreadsheet nearest-item review flow is missing ${required}.`);
  }
}
for (const required of [
  ".import-item-match-review",
  ".import-item-match-candidates",
  ".import-item-field-evidence",
  ".import-item-match-pagination"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The spreadsheet nearest-item review styling is missing ${required}.`);
  }
}
for (const required of [
  "--header-bg",
  ".workspace-navigation > button:focus-visible",
  "grid-template-columns: minmax(230px, 0.72fr) minmax(0, 1.85fr) minmax(290px, 0.8fr)",
  ".candidate-similarity-grid"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The high-contrast three-pane workspace layer is missing ${required}.`);
  }
}
for (const required of [
  "Array.isArray(result.calendar?.events)",
  "/v1/project-work-items",
  "/status",
  "/archive",
  "/dependencies",
  "renderProjectWorkItems",
  "WORK_ITEM_MILESTONE"
]) {
  if (!script.includes(required)) {
    throw new Error(`The calendar and project-work-item interface is missing ${required}.`);
  }
}
for (const required of [
  "manualJournalLinesFromEditor",
  "renderManualJournalLines",
  "refreshManualJournalAccountOptions",
  'jsonRequest(payload, draftId ? "PATCH" : "POST")',
  "/cancel",
  "Post to ledger",
  "Non-posting workpaper",
  "MANUAL_JOURNAL_MAX_LINES",
  "manual-journal-balance-status"
]) {
  if (!script.includes(required)) {
    throw new Error(`The editable multi-line manual journal workpaper is missing ${required}.`);
  }
}
for (const required of [
  ".manual-journal-line-list",
  ".manual-journal-line",
  ".manual-journal-totals"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The responsive manual journal editor is missing ${required}.`);
  }
}
for (const required of [
  'id="task-finder-menu"',
  'id="task-finder-input"',
  'id="task-finder-results"',
  "Find a task",
  "Receipt or invoice image"
]) {
  if (!html.includes(required)) {
    throw new Error(`The task finder interface is missing ${required}.`);
  }
}
for (const required of [
  'id="home-command-center"',
  'id="home-tool-pane"',
  'id="settings-menu"',
  'id="runtime-diagnostics"',
  "Business center",
  "Sales and customers",
  "Purchases and operations",
  "Banking and accounting",
  "Company tools",
  "Environment and diagnostics"
]) {
  if (!html.includes(required)) {
    throw new Error(`The grouped home center and settings surfaces are missing ${required}.`);
  }
}
for (const required of [
  'option value="system">Match device',
  'option value="ocean">Ocean blue',
  'option value="warm">Warm paper',
  'option value="extra-large">Extra large',
  "Configure dashboard"
]) {
  if (!html.includes(required)) {
    throw new Error(`The expanded Appearance controls are missing ${required}.`);
  }
}
for (const required of [
  "displayPreferenceDefinitions",
  "dashboardTilePreferences",
  "dashboardBrowserStorageKey",
  "clearledger_dashboard_preferences",
  "restoreDashboardPreferences",
  "resetDashboardPreferences",
  "resetDisplayPreferences",
  "preferredScrollBehavior",
  "Hidden; available to restore"
]) {
  if (!script.includes(required)) {
    throw new Error(`Browser-safe display customization is missing ${required}.`);
  }
}
for (const required of [
  ':root[data-theme="ocean"]',
  ':root[data-theme="warm"]',
  ':root[data-text-scale="extra-large"]',
  ':root[data-content-width="wide"] main',
  ':root[data-dashboard-layout="single"] .home-dashboard',
  ':root[data-motion="reduce"]'
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`Responsive appearance customization is missing ${required}.`);
  }
}
for (const required of [
  "Clear interface hierarchy",
  ".workspace-navigation > button[aria-current]",
  ".workspace-subnavigation button[aria-current]",
  ".navigation-menu-panel .compact-navigation-item",
  "--more-menu-max-height",
  "--create-menu-max-height",
  "position: fixed",
  ".workspace-navigation > .desktop-navigation-item",
  '.tab[aria-current="step"]',
  ".home-toolbar.workspace-heading",
  ".help-learning-layout",
  ".dashboard-help-panel",
  ".bug-report-panel",
  ".bug-report-privacy",
  ".task-finder-panel",
  ".home-command-center",
  ".home-command-card",
  ".home-tool-pane",
  ".settings-panel",
  ".runtime-diagnostics",
  "#workspace > section[id]:not(#overview-workspace) section > h2",
  "#workspace > section[id]:not(#overview-workspace) section > h3",
  "--app-header-height",
  '.workspace-subnavigation[data-quick-tabs="true"]',
  "[data-workspace-tab-panel]",
  "@media (forced-colors: active)"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(
      `The distinct navigation, heading, action, and help hierarchy is missing ${required}.`
    );
  }
}
const desktopNavigationItems = html.match(/class="desktop-navigation-item"/g) ?? [];
const compactNavigationItems = html.match(/class="compact-navigation-item"/g) ?? [];
if (desktopNavigationItems.length !== 10 || compactNavigationItems.length !== 11) {
  throw new Error(
    "Desktop navigation must preserve its ten compact destinations while Payroll remains available in More without crowding the top toolbar."
  );
}
for (const workspaceId of [
  "accountant-workspace",
  "inventory-workspace",
  "projects-workspace",
  "planning-workspace",
  "fixed-assets-workspace",
  "payments-workspace",
  "integrations-workspace"
]) {
  if (
    !new RegExp(
      `class="desktop-navigation-item"[\\s\\S]{0,100}data-workspace-target="${workspaceId}"`
    ).test(html) ||
    !new RegExp(
      `class="compact-navigation-item"[\\s\\S]{0,100}data-workspace-target="${workspaceId}"`
    ).test(html)
  ) {
    throw new Error(`Responsive navigation is missing ${workspaceId}.`);
  }
}
if (
  !new RegExp(
    'class="compact-navigation-item"[\\s\\S]{0,100}data-workspace-target="payroll-workspace"'
  ).test(html)
) {
  throw new Error("Payroll must remain available from the compact More navigation.");
}
for (const required of [
  'data-planning-tab="crm"',
  'data-planning-tab="calendar"',
  'data-planning-tab="projects"',
  'data-planning-tab="budgets"',
  'data-planning-tab="capture"',
  'data-create-planning-tab="capture"',
  "CRM &amp; clients",
  "Project planning",
  "Budgets &amp; forecasts",
  "Receipt &amp; bill capture",
  "Receipt or invoice image"
]) {
  if (!html.includes(required)) {
    throw new Error(
      `The explicit CRM, calendar, project-planning, and budget destinations are missing ${required}.`
    );
  }
}
for (const required of [
  "desktopNavigationWorkspaceIds",
  "syncWorkspaceNavigationState",
  "positionMoreNavigationPanel",
  "positionGlobalCreatePanel",
  "taskFinderDefinitions",
  "renderTaskFinderResults",
  "openTaskFinderResult",
  "selectWorkspaceTab",
  "revealWorkspaceTarget",
  "syncAppHeaderHeight",
  "openHomeDestination",
  "positionSettingsPanel",
  "openRuntimeDiagnostics",
  'window.matchMedia("(min-width: 561px)")',
  'button.setAttribute("aria-pressed", String(active))',
  'window.matchMedia("(min-width: 1181px)")',
  'elements["workspace-navigation"].querySelectorAll(\n    "[data-workspace-target]"'
]) {
  if (!script.includes(required)) {
    throw new Error(`Responsive navigation behavior is missing ${required}.`);
  }
}
for (const required of [
  "guidedTourSteps",
  "renderGuidedTour",
  "filterHelpTopics",
  "openHelpDestination",
  "syncDashboardHelpPanel",
  "buildSupportDiagnostics",
  "prepareBugReport",
  "copyBugReport",
  "downloadBugReport",
  "emailBugReport",
  "clearledger-bug-report-",
  "mailto:?subject=",
  "Submission status: Not sent automatically",
  "clearledger_dashboard_help",
  "const active = button.dataset.planningTab",
  "loadDemoCompanyCapability",
  "createDemoCompany",
  "/v1/demo-company/capabilities",
  "/v1/demo-company",
  'request.headers["idempotency-key"]',
  "!result?.fictional",
  '!result.enabledCurrencies?.includes("CAD")',
  '!result.enabledCurrencies?.includes("USD")',
  "result.counts?.postedJournals > 0",
  '"help-workspace"'
]) {
  if (!script.includes(required)) {
    throw new Error(`The guided and dockable Help experience is missing ${required}.`);
  }
}
for (const required of [
  '<h1 id="members-heading">',
  '<h1 id="payments-heading">',
  '<h1 id="purchases-heading">',
  '<h1 id="inventory-heading">',
  '<h1 id="accountant-heading">',
  '<h1 id="reports-heading">'
]) {
  if (!html.includes(required)) {
    throw new Error(`Every workspace must expose a discernible level-one page title: ${required}.`);
  }
}
for (const required of [
  "renderHomeDashboardUnavailable",
  "No zero values were assumed.",
  "No immediate dashboard exceptions",
  "dashboard.unreconciledBankItems",
  "dashboard.overdueInvoicesMinor",
  "dashboard.lowStock",
  "dashboardMoney(value, dashboard.currency, label)",
  'workspaceId === "overview-workspace" && refreshData'
]) {
  if (!script.includes(required)) {
    throw new Error(`The fail-closed, exception-driven Home dashboard is missing ${required}.`);
  }
}
if (/renderHomeDashboard\(\{\s*currency:\s*["']CAD["']/.test(script)) {
  throw new Error(
    "Home must not replace an unavailable dashboard response with invented CAD zeroes."
  );
}
const loadReportsBody = script.slice(
  script.indexOf("async function loadReports()"),
  script.indexOf("function renderDashboard(")
);
if (loadReportsBody.includes("renderHomeDashboard(dashboard)")) {
  throw new Error("Historical report filters must not overwrite the as-of-today Home dashboard.");
}
if (
  /\.home-summary-band \.summary-value\s*\{[^}]*text-overflow:\s*ellipsis/s.test(stylesheet) ||
  /\.home-summary-band \.summary-value\s*\{[^}]*overflow:\s*hidden/s.test(stylesheet)
) {
  throw new Error("Home must not silently truncate exact financial values.");
}
for (const required of [
  "/v1/books-health?asOf=",
  'booksHealth?.mode !== "READ_ONLY"',
  "booksHealth?.accountingEntriesCreated !== 0",
  "openBooksHealthTarget(finding.target)",
  "PennyWise Accounting will not treat an unavailable check as all clear."
]) {
  if (!script.includes(required)) {
    throw new Error(`The read-only Books Health Home flow is missing ${required}.`);
  }
}
for (const required of [
  "renderImportSourceGuide",
  "Before you export from ${guide.name}",
  "${guide.name} export help",
  "Xero",
  "Wave",
  "FreshBooks",
  "Sage",
  "Zoho Books",
  "Keep the Sage backup and a read-only source available until every control total agrees.",
  "dataImportTemplates",
  "downloadImportTemplate",
  "pennywise-${source}-${template.slug}-template.csv",
  "setMigrationStep",
  "foreignMigrationWarningTypes"
]) {
  if (!script.includes(required)) {
    throw new Error(`The source-specific Switching Centre guide is missing ${required}.`);
  }
}
if (script.includes("clearledger-${source}-${template.slug}-template.csv")) {
  throw new Error(
    "Template downloads must use the PennyWise filename contract, not the legacy ClearLedger filename."
  );
}
for (const required of [
  'id="data-import-file"',
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  'id="import-mapping-workspace"',
  'id="import-preview-table"',
  'id="import-column-mapper"',
  "Not uploaded or imported"
]) {
  if (!html.includes(required)) {
    throw new Error(`The safe spreadsheet mapping workspace is missing ${required}.`);
  }
}
for (const required of [
  "inspectDataImportFile",
  "parseLocalImportCsv",
  "workbookSelectionPreview",
  "importMediaType",
  "renderImportColumnMapper",
  "syncImportMappingJson",
  "minorUnitGuidance",
  "leading zeroes are displayed as text",
  '"content-type": mediaType'
]) {
  if (!script.includes(required)) {
    throw new Error(`The safe spreadsheet mapping behavior is missing ${required}.`);
  }
}
for (const required of [
  ".import-mapping-workspace",
  ".import-column-mapper",
  ".import-preview-table-wrap",
  ".import-mapping-row",
  "@media (forced-colors: active)"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The responsive spreadsheet mapping styles are missing ${required}.`);
  }
}
if (!/id="data-import-source-system"[^>]*form="data-import-form"/s.test(html)) {
  throw new Error(
    "The source selector must appear before its guide while remaining part of the import form."
  );
}
if (!/<details class="advanced-import-mapping wide-field">/s.test(html)) {
  throw new Error("Raw import mapping JSON must remain inside an Advanced disclosure.");
}
if (/api\([^\n]*\/v1\/books-health[^\n]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/.test(script)) {
  throw new Error("Books Health must not expose a mutating web request.");
}
if (!script.includes("capture-reviews/upload")) {
  throw new Error("The web surface must expose the reviewed capture upload workflow.");
}
for (const required of [
  "function openCaptureConversionDialog(capture)",
  "function closeCaptureConversionDialog()",
  "function clearCaptureConversionDialog()",
  "function renderCaptureConversionTarget()",
  "function validateCaptureConversionDates()",
  "async function convertCaptureToDraft(event)",
  "function openCaptureLinkedDraft()",
  "/v1/capture-reviews/${current.id}/convert",
  '"idempotency-key": state.idempotencyKey',
  "activeCaptureConversion = null",
  "clearCaptureEvidenceObjectUrl()",
  'classList.remove("is-error")',
  "accountingEntriesCreated ?? 0"
]) {
  if (!script.includes(required)) {
    throw new Error(`The reviewed capture-to-draft interface is missing ${required}.`);
  }
}
for (const required of [
  ".capture-conversion-dialog",
  ".capture-conversion-layout",
  ".capture-evidence-preview",
  ".capture-target-options",
  ".capture-conversion-status.is-error"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The reviewed capture-to-draft styling is missing ${required}.`);
  }
}
for (const required of [
  "/v1/capture-reviews/${current.id}/convert",
  '"idempotency-key": state.idempotencyKey',
  'capture.status !== "APPROVED"',
  'capture.scanStatus !== "CLEAN"',
  "Draft already created",
  "Create exactly one bill draft",
  "Create exactly one expense draft",
  "Repeated clicks are blocked",
  "accountingEntriesCreated ?? 0",
  "loadCaptureEvidencePreview",
  "captureEvidenceObjectUrl"
]) {
  if (!script.includes(required)) {
    throw new Error(`The exactly-once capture-to-draft web flow is missing ${required}.`);
  }
}
for (const required of [
  ".capture-conversion-dialog",
  ".capture-conversion-layout",
  ".capture-evidence-preview",
  ".capture-target-options",
  ".capture-conversion-result",
  "@media (max-width: 900px)"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The responsive capture-to-draft review styles are missing ${required}.`);
  }
}
for (const required of [
  "/v1/settings/multi-currency/rate-suggestion?date=",
  "form.elements.rate.value = suggestion.rate",
  "Nothing has been saved or posted"
]) {
  if (!script.includes(required)) {
    throw new Error(`The non-posting Bank of Canada suggestion flow is missing ${required}.`);
  }
}
for (const required of [
  'elements["load-commerce-demo"].addEventListener("click", loadCommerceDemo)',
  'elements["load-commerce-demo"].hidden = !connectorProviders.some(',
  "(provider) => provider.demoAvailable",
  "/v1/organizations/current/commerce/demo",
  "Accounting entries created: ${result.accountingEntriesCreated}.",
  "Safe sample commerce evidence loaded. No books were changed."
]) {
  if (!script.includes(required)) {
    throw new Error(`The safe commerce demo web flow is missing ${required}.`);
  }
}
if (script.includes("event.currentTarget.reset()")) {
  throw new Error("Async form handlers must not use transient event.currentTarget after awaiting.");
}
for (const required of [
  "form.querySelector('input[name=\"statement\"]')?.files?.[0]",
  "readFileAsArrayBuffer(file)",
  "reader.readAsArrayBuffer(file)",
  "reader.result instanceof globalThis.ArrayBuffer"
]) {
  if (!script.includes(required)) {
    throw new Error(`The WebKit-safe bank statement reader is missing ${required}.`);
  }
}
if (
  !script.includes('headers.set("x-clearledger-organization-id", activeOrganizationId)') ||
  !script.includes('sessionStorage.getItem("clearledger_active_organization")')
) {
  throw new Error("The local identity web flow must forward the selected organization context.");
}
if (
  !script.includes(
    "await loadAccounts();\n  await Promise.all([loadSales(), loadPurchases(), loadBanking(), loadInventory()]);\n  await loadPayments();"
  )
) {
  throw new Error("Applying a chart preset must refresh every account-dependent workspace.");
}
if (
  !script.includes(
    ".filter((item) => item.active)\n      .map((item) => option(item.id, `${item.customerNumber} | ${item.displayName}`))"
  ) ||
  !script.includes(
    ".filter((item) => item.active)\n      .map((item) => option(item.id, `${item.name} | ${formatMinor(item.salesPriceMinor)}`))"
  ) ||
  !script.includes(
    ".filter((customer) => customer.active)\n      .map((customer) => option(customer.id, customer.displayName))"
  )
) {
  throw new Error("Customer and product selectors must use the API's active field.");
}
if (script.includes("reconciliation.openBalanceMinor")) {
  throw new Error("The receivables summary must render the reconciliation subledger balance.");
}
if (!script.includes('await loadSales();\n  await loadPayments();\n  showNotice("Invoice posted')) {
  throw new Error("Posting an invoice must refresh the available payment allocations.");
}
for (const required of [
  '"fixed-assets-workspace"',
  "loadFixedAssets(),",
  'workspaceId === "fixed-assets-workspace"',
  "workflowPreferences.fixedAssetRegisterEnabled",
  'if (asset.status === "REJECTED" && canApprove)',
  'commandButton("Register (non-posting)"',
  "api(`/v1/fixed-assets/${asset.id}/depreciation-preview`)"
]) {
  if (!script.includes(required)) {
    throw new Error(`Fixed-asset register web flow is missing ${required}.`);
  }
}
if (
  script.includes('["REJECTED", "REGISTERED"].includes(asset.status)') ||
  !html.includes("Registered records are frozen") ||
  !html.includes("NON-POSTING") ||
  !html.includes("authorized review") ||
  script.includes("submitted for accountant review")
) {
  throw new Error(
    "Registered fixed assets must remain frozen and the register must clearly remain non-posting."
  );
}
if (
  html.includes('name="payrollSummaryImportEnabled"') ||
  !script.includes("payrollSummaryImportEnabled: false") ||
  !script.includes("Payroll summary import: Not available in this beta")
) {
  throw new Error("The unavailable payroll-summary preference must remain hidden and disabled.");
}
if (
  !html.includes("Automations run while") ||
  !script.includes("runRecurringInvoices") ||
  !script.includes("missedOccurrencePolicy") ||
  !script.includes("invoiceMode")
) {
  throw new Error(
    "Recurring invoice schedules must expose the runner, missed-occurrence policy, and invoice mode."
  );
}
if (
  !html.includes("does not include a malware scanner") ||
  !html.includes("file signature, and structure")
) {
  throw new Error("The local upload boundary must not imply real malware scanning.");
}
for (const forbidden of [
  "/v1/fixed-assets/${asset.id}/post",
  "/v1/fixed-assets/${asset.id}/dispose",
  "/v1/fixed-assets/${asset.id}/cca"
]) {
  if (script.includes(forbidden)) {
    throw new Error(`The fixed-asset register must not expose gated route ${forbidden}.`);
  }
}
for (const endpoint of [
  "/v1/auth/sign-out",
  "/v1/organizations",
  "/v1/organizations/switch",
  "/v1/organizations/current/invitations",
  "/v1/invitations/accept",
  "/v1/organizations/current/members/",
  "/v1/setup",
  "/v1/settings/workflow-preferences",
  "/v1/setup/opening-balances",
  "/v1/setup/complete",
  "/v1/customers",
  "/v1/products",
  "/v1/invoices",
  "/v1/customer-deposit-requests",
  "/v1/progress-billing-plans",
  "/v1/receivables/reconciliation",
  "/v1/payment-account",
  "/v1/payment-settings",
  "/v1/payments",
  "/v1/payment-disputes",
  "/v1/vendors",
  "/v1/bills",
  "/v1/immediate-expenses",
  "/v1/bill-payments",
  "/v1/vendor-credits",
  "/v1/payables/aging",
  "/v1/fixed-asset-classes",
  "/v1/fixed-assets",
  "/v1/bank-accounts",
  "/v1/bank-imports",
  "/v1/bank-transactions",
  "/v1/bank-rules",
  "/v1/bank-transfers",
  "/v1/bank-reconciliations",
  "/v1/inventory/locations",
  "/v1/inventory/quantities",
  "/v1/inventory/movements",
  "/v1/inventory/purchase-receipts",
  "/v1/inventory/customer-returns",
  "/v1/inventory/vendor-returns",
  "/v1/inventory/adjustments",
  "/v1/inventory/transfers",
  "/v1/inventory/reports/low-stock",
  "/v1/inventory/reports/cost-of-goods",
  "/v1/inventory/reports/control-reconciliation",
  "/v1/dashboard",
  "/v1/reports/profit-and-loss",
  "/v1/reports/balance-sheet",
  "/v1/reports/trial-balance",
  "/v1/reports/general-ledger",
  "/v1/reports/cash-flow",
  "/v1/reports/receivables",
  "/v1/reports/payables",
  "/v1/reports/tax",
  "/v1/reports/banking",
  "/v1/reports/sales",
  "/v1/reports/expenses",
  "/v1/reports/exports/",
  "/v1/accountant/manual-journals",
  "/v1/accountant/review-queue",
  "/v1/accountant/audit-events",
  "/v1/accountant/journals/",
  "/close-preview",
  "/v1/imports/upload",
  "/v1/imports/",
  "/v1/exports",
  "/v1/organization-closure",
  "/v1/product-events"
]) {
  if (!script.includes(endpoint)) {
    throw new Error(`Identity web flow is missing ${endpoint}.`);
  }
}
if (!script.includes('redirectToAuth("sign-in")')) {
  throw new Error("Identity web flow is missing OIDC sign-in.");
}
for (const required of [
  'id="calendar-panel"',
  'id="calendar-date" type="date"',
  'id="calendar-timed-grid"',
  'id="calendar-agenda"',
  'data-planning-tab="calendar"',
  'data-planning-tab="budgets"',
  'data-calendar-view="week"',
  "Drag a timed CRM",
  "invoice and bill due dates stay read-only"
]) {
  if (!html.includes(required)) {
    throw new Error(`The accessible calendar and planning-tab markup is missing ${required}.`);
  }
}
for (const required of [
  "/v1/calendar/events?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}",
  "openPlanningTab",
  "planningTabFromHash",
  "#planning=${tab}",
  "CALENDAR_RESULT_LIMIT_EXCEEDED",
  "calendarCanMoveEvent",
  "rescheduleCalendarEvent",
  "This due date comes from a financial document",
  'formatMinor(event.amountMinor, event.currency ?? "CAD")'
]) {
  if (!script.includes(required)) {
    throw new Error(`The professional calendar behavior is missing ${required}.`);
  }
}
for (const required of [
  ".calendar-timed-grid",
  ".calendar-timed-event",
  ".calendar-view-switch",
  ".calendar-grid",
  ".calendar-agenda",
  ".calendar-event-details",
  "@media (forced-colors: active)"
]) {
  if (!stylesheet.includes(required)) {
    throw new Error(`The calendar accessibility styles are missing ${required}.`);
  }
}
const server = await readFile(resolve(root, "serve.mjs"), "utf8");
if (!server.includes('["/money.js", ["money.js", "text/javascript; charset=utf-8"]]')) {
  throw new Error("The local web server must serve the shared money module.");
}
for (const route of [
  "/pwa.js",
  "/manifest.webmanifest",
  "/service-worker.js",
  "/offline.html",
  "/icons/clearledger.svg",
  "/icons/clearledger-maskable.svg"
]) {
  if (!server.includes(`["${route}",`)) {
    throw new Error(`The local web server must serve ${route}.`);
  }
}
if (
  !server.includes('"cache-control": "no-cache"') ||
  !server.includes('"service-worker-allowed": "/"')
) {
  throw new Error("The service worker must be updateable and restricted to the application scope.");
}
if (!html.includes('id="local-identity-form" class="local-test-access" hidden')) {
  throw new Error(
    "The development identity form must remain hidden until a localhost-only client enables it."
  );
}
if (!html.includes('id="local-test-account-picker" class="local-test-account-picker" hidden')) {
  throw new Error("The localhost test-account picker must be present and hidden by default.");
}
if (!script.includes("localIdentityEnabled") || !script.includes("data-local-test-email")) {
  throw new Error("The localhost test-account picker must remain client-gated and selectable.");
}
for (const required of [
  'id="more-navigation-panel"',
  "positionMoreNavigationPanel",
  "--more-menu-top",
  "resize: vertical",
  "overscroll-behavior: contain"
]) {
  if (!html.includes(required) && !script.includes(required) && !stylesheet.includes(required)) {
    throw new Error(`The viewport-safe More menu is missing ${required}.`);
  }
}
for (const required of [
  "SHARE_IDENTITY_EMAIL",
  "SHARE_IDENTITY_NAME",
  "SHARE_ORGANIZATION_ID",
  "SHARE_ACCESS_USERNAME",
  "SHARE_ACCESS_PASSWORD",
  "isAuthorizedControlledShare",
  "timingSafeEqual",
  'headers.set("x-clearledger-user-email", shareIdentityEmail)',
  'headers.set("x-clearledger-user-name", shareIdentityName)',
  'headers.set("x-clearledger-organization-id", shareOrganizationId)',
  "headers.delete(name)",
  '"authorization"',
  'data-runtime-mode="controlled-share"',
  "The web shell runtime marker is missing"
]) {
  if (!server.includes(required)) {
    throw new Error(`Controlled sharing mode is missing ${required}.`);
  }
}
for (const required of [
  "controlledShareMode",
  'elements["session-loading"].hidden = false',
  'elements["signed-out"].hidden = true',
  'elements["controlled-share-loading"].dataset.state = "error"',
  'html[data-runtime-mode="controlled-share"] #sign-in',
  'html[data-runtime-mode="controlled-share"] .controlled-share-loading'
]) {
  if (!script.includes(required) && !stylesheet.includes(required)) {
    throw new Error(`Controlled share sign-in handoff is missing ${required}.`);
  }
}

const manifest = JSON.parse(await readFile(resolve(root, "manifest.webmanifest"), "utf8"));
if (
  manifest.id !== "/" ||
  manifest.start_url !== "/" ||
  manifest.scope !== "/" ||
  manifest.display !== "standalone" ||
  manifest.theme_color !== "#142a3b" ||
  manifest.background_color !== "#f7f3ed"
) {
  throw new Error("The web app manifest is missing its installable shell contract.");
}
for (const purpose of ["any", "maskable"]) {
  if (
    !manifest.icons?.some(
      (icon) => icon.type === "image/svg+xml" && icon.sizes === "any" && icon.purpose === purpose
    )
  ) {
    throw new Error(`The web app manifest is missing its ${purpose} SVG icon.`);
  }
}

const registration = await readFile(resolve(root, "pwa.js"), "utf8");
for (const required of [
  '"serviceWorker" in navigator',
  "window.isSecureContext",
  'navigator.serviceWorker.register("/service-worker.js", { scope: "/" })'
]) {
  if (!registration.includes(required)) {
    throw new Error(`PWA registration is missing ${required}.`);
  }
}

const serviceWorker = await readFile(resolve(root, "service-worker.js"), "utf8");
for (const required of [
  'const SHELL_SCHEMA = "commerce-dashboard-v8"',
  "const CACHE_NAME = `${CACHE_PREFIX}__CLEARLEDGER_CACHE_VERSION__-${SHELL_SCHEMA}`",
  "const STATIC_PATHS = new Set(STATIC_ASSETS.keys())",
  "if (isSensitivePath(url.pathname)) return",
  "if (!STATIC_PATHS.has(url.pathname)) return",
  "response.redirected",
  "responseUrl.pathname !== pathname",
  'fetch(request, { cache: "no-store" })',
  'caches.match("/offline.html")'
]) {
  if (!serviceWorker.includes(required)) {
    throw new Error(`The service worker safety contract is missing ${required}.`);
  }
}
const staticAssetsStart = serviceWorker.indexOf("const STATIC_ASSETS");
const staticAssetsEnd = serviceWorker.indexOf("const STATIC_PATHS");
const staticAssets = serviceWorker.slice(staticAssetsStart, staticAssetsEnd);
for (const forbidden of ["/api", "/public", "/v1", "/auth", "/oauth"]) {
  if (staticAssets.includes(forbidden)) {
    throw new Error(`Sensitive path ${forbidden} must never enter the static cache allowlist.`);
  }
}

const offline = await readFile(resolve(root, "offline.html"), "utf8");
const normalizedOffline = offline.replace(/\s+/g, " ");
if (
  !offline.includes("PennyWise Accounting is offline") ||
  !normalizedOffline.includes("does not store organization or financial data for offline use") ||
  !offline.includes("box-sizing: border-box") ||
  offline.includes("/app.js") ||
  offline.includes("/api/")
) {
  throw new Error(
    "The offline fallback must remain data-free and independent of the application API."
  );
}

for (const icon of ["icons/clearledger.svg", "icons/clearledger-maskable.svg"]) {
  const svg = await readFile(resolve(root, icon), "utf8");
  if (!svg.includes("<svg") || svg.includes("data:image/")) {
    throw new Error(`${icon} must remain a code-native SVG asset.`);
  }
}
console.log("Verified the PennyWise Accounting web assets and data-safe PWA shell.");
