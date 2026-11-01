// Help, guided tour, and support (`help-workspace`).

import { downloadTextFile, preferredScrollBehavior, writeClipboardText } from "../lib/browser.js";
import { dashboardPreferences } from "../lib/dashboard-preferences.js";
import { showNotice } from "../lib/notices.js";
import { setProductAnalyticsConsent, trackProductEvent } from "../lib/product-analytics.js";
import {
  readScopedDashboardPreference,
  registerWorkspaceCalls,
  showSetupStep,
  writeScopedDashboardPreference
} from "../lib/workspace-calls.js";
import {
  buildWorkspaceSubnavigation,
  headerDisclosureMenus,
  navigateTo,
  revealWorkspaceTarget,
  workspaceIds
} from "../shell.js";
import { activeWorkspaceId, controlledShareMode, elements, setup } from "../state.js";

const guidedTourStorageKey = "clearledger_guided_tour_step";
const guidedTourCompleteStorageKey = "clearledger_guided_tour_complete";
const dashboardHelpStorageKey = "clearledger_dashboard_help";
const guidedTourSteps = [
  {
    title: "Set up your company",
    summary:
      "Add the business details and accounting choices that every later transaction depends on.",
    checklist: [
      "Confirm your fiscal year, base currency, tax registration, and starting accounts.",
      "Add opening balances and invoice branding when they apply. You can pause and return."
    ],
    workspaceId: "setup-workspace",
    targetId: "setup-tabs",
    actionLabel: "Open company settings"
  },
  {
    title: "Add a customer and what you sell",
    summary:
      "Create at least one customer and one product or service so they are ready to use on an invoice.",
    checklist: [
      "Add the customer's display name, contact details, and payment terms.",
      "Add a product or service with its price, income account, and tax treatment."
    ],
    workspaceId: "sales-workspace",
    targetId: "customer-form",
    actionLabel: "Add a customer"
  },
  {
    title: "Create and check an invoice",
    summary:
      "Build a draft and review the exact customer document before you choose to post or send it.",
    checklist: [
      "Choose the customer, dates, currency, terms, and invoice lines.",
      "Check the preview, totals, logo, and payment instructions before posting."
    ],
    workspaceId: "sales-workspace",
    targetId: "invoice-designer-section",
    actionLabel: "Create an invoice"
  },
  {
    title: "Record a payment",
    summary:
      "After an invoice is posted, record the money received and allocate it to the right invoice.",
    checklist: [
      "Use a manual payment for cash, cheque, e-transfer, or another offline receipt.",
      "Stripe is optional and must be configured separately before it can collect payments."
    ],
    workspaceId: "payments-workspace",
    targetId: "manual-payment-form",
    actionLabel: "Open payments"
  },
  {
    title: "Review bank activity",
    summary:
      "Add a financial account, preview a statement import, then categorize, match, or reconcile it.",
    checklist: [
      "Upload a supported statement CSV and verify the preview before importing.",
      "Match or categorize activity, then reconcile the statement balance."
    ],
    workspaceId: "banking-workspace",
    targetId: "bank-import-form",
    actionLabel: "Upload a statement"
  },
  {
    title: "Invite a reviewer",
    summary:
      "Invite a bookkeeper, accountant, or teammate and give them only the role their work requires.",
    checklist: [
      "Use the current organization so the invitation cannot cross company boundaries.",
      "Choose the narrowest suitable role and review membership when responsibilities change."
    ],
    workspaceId: "membership-admin",
    targetId: "invitation-form",
    actionLabel: "Manage team"
  }
];
let guidedTourIndex = Math.min(
  Math.max(Number(window.localStorage.getItem(guidedTourStorageKey)) || 0, 0),
  guidedTourSteps.length - 1
);
let guidedTourComplete = window.localStorage.getItem(guidedTourCompleteStorageKey) === "true";
const bugReportRequiredFields = {
  summary: "Add a short summary of the problem.",
  severity: "Choose how much the problem affects your work.",
  steps: "Add the steps someone can follow to reproduce the problem.",
  expected: "Describe what you expected to happen.",
  actual: "Describe what actually happened."
};

registerWorkspaceCalls({
  filterHelpTopics,
  openHelpDestination,
  renderGuidedTour,
  resolveGuidedTourFromState,
  syncDashboardHelpPanel
});

export function initHelp() {
  elements["toggle-dashboard-help"].addEventListener("click", toggleDashboardHelp);
  elements["close-dashboard-help"].addEventListener("click", closeDashboardHelp);
  elements["open-help-index"].addEventListener("click", openHelpIndex);
  elements["dashboard-help-previous"].addEventListener("click", () => moveGuidedTour(-1));
  elements["dashboard-help-next"].addEventListener("click", () => moveGuidedTour(1));
  elements["dashboard-help-open-step"].addEventListener("click", openGuidedTourStep);
  elements["guided-tour-previous"].addEventListener("click", () => moveGuidedTour(-1));
  elements["guided-tour-next"].addEventListener("click", () => moveGuidedTour(1));
  elements["guided-tour-open-step"].addEventListener("click", openGuidedTourStep);
  elements["restart-guided-tour"].addEventListener("click", restartGuidedTour);
  elements["help-search"].addEventListener("input", filterHelpTopics);
  document
    .querySelectorAll("[data-help-destination]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openHelpDestination(button.dataset.helpDestination, button.dataset.helpTarget)
      )
    );
  window.addEventListener("resize", syncDashboardHelpPanel);
  elements["download-support-diagnostics"].addEventListener("click", downloadSupportDiagnostics);
  elements["bug-report-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    void copyBugReport();
  });
  elements["copy-bug-report"].addEventListener("click", () => void copyBugReport());
  elements["download-bug-report"].addEventListener("click", downloadBugReport);
  elements["email-bug-report"].addEventListener("click", emailBugReport);
  elements["bug-report-form"].addEventListener("reset", () => {
    globalThis.setTimeout(() => {
      clearBugReportValidity();
      setBugReportStatus("Your report has not been shared.");
    });
  });
  for (const field of elements["bug-report-form"].querySelectorAll(
    "input[required], select[required], textarea[required]"
  )) {
    field.addEventListener("input", () => field.setCustomValidity(""));
    field.addEventListener("change", () => field.setCustomValidity(""));
  }
  elements["product-analytics-consent"].checked = false;
  elements["product-analytics-consent"].addEventListener("change", (event) => {
    void setProductAnalyticsConsent(event.currentTarget.checked);
  });
  document.querySelectorAll("[data-help-article]").forEach((article) =>
    article.addEventListener("toggle", () => {
      if (article.open) trackProductEvent("HELP_ARTICLE_OPENED");
    })
  );
}

function dashboardHelpIsDesktop() {
  return window.matchMedia("(min-width: 1181px)").matches;
}

export function syncDashboardHelpPanel() {
  const desktop = dashboardHelpIsDesktop();
  // Default closed. Open-by-default cost the dashboard a 290px column on every
  // load, squeezing the data grid from three equal columns to `238px 612px` and
  // pushing the figures down. The panel is one click away from the toolbar.
  const open = desktop && readScopedDashboardPreference(dashboardHelpStorageKey) === "open";
  elements["dashboard-help-panel"].hidden = !open;
  elements["overview-workspace"].dataset.helpPanel = open ? "open" : "closed";
  elements["toggle-dashboard-help"].textContent = desktop
    ? open
      ? "Hide help"
      : "Show help"
    : "Help & learning";
  elements["toggle-dashboard-help"].setAttribute("aria-expanded", String(open));
  elements["toggle-dashboard-help"].setAttribute(
    "aria-controls",
    desktop ? "dashboard-help-panel" : "help-workspace"
  );
}

function toggleDashboardHelp() {
  if (!dashboardHelpIsDesktop()) {
    openHelpIndex();
    return;
  }
  const panelIsOpen = !elements["dashboard-help-panel"].hidden;
  writeScopedDashboardPreference(dashboardHelpStorageKey, panelIsOpen ? "closed" : "open");
  syncDashboardHelpPanel();
  buildWorkspaceSubnavigation(elements["overview-workspace"]);
  if (panelIsOpen) elements["toggle-dashboard-help"].focus();
}

function closeDashboardHelp() {
  writeScopedDashboardPreference(dashboardHelpStorageKey, "closed");
  syncDashboardHelpPanel();
  buildWorkspaceSubnavigation(elements["overview-workspace"]);
  elements["toggle-dashboard-help"].focus();
}

function openHelpIndex() {
  navigateTo("help-workspace");
  globalThis.setTimeout(() => elements["help-search"].focus(), 300);
}

function openHelpDestination(workspaceId, targetId, setupStep = null) {
  if (!workspaceIds.includes(workspaceId)) return;
  navigateTo(workspaceId);
  if (setupStep && setup?.steps?.some((step) => step.step === setupStep)) {
    showSetupStep(setupStep);
  }
  revealWorkspaceTarget(workspaceId, targetId);
  globalThis.setTimeout(() => {
    if (headerDisclosureMenus.some((menu) => menu.open)) return;
    const target = targetId ? document.getElementById(targetId) : elements[workspaceId];
    target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
    const focusTarget = target?.matches?.("button, input, select, textarea, [tabindex]")
      ? target
      : target?.querySelector?.("button, input, select, textarea, [tabindex]");
    focusTarget?.focus({ preventScroll: true });
  }, 300);
}

function openGuidedTourStep() {
  const step = guidedTourSteps[guidedTourIndex];
  trackProductEvent("GUIDED_TOUR_TASK_OPENED");
  openHelpDestination(step.workspaceId, step.targetId);
}

function moveGuidedTour(direction) {
  const lastIndex = guidedTourSteps.length - 1;
  if (direction > 0 && guidedTourIndex === lastIndex) {
    if (!guidedTourComplete) {
      guidedTourComplete = true;
      window.localStorage.setItem(guidedTourCompleteStorageKey, "true");
      trackProductEvent("GUIDED_TOUR_COMPLETED");
      showNotice(
        "Getting-started tutorial complete. You can review any step whenever you need it."
      );
    }
  } else {
    guidedTourIndex = Math.min(Math.max(guidedTourIndex + direction, 0), lastIndex);
    writeScopedDashboardPreference(guidedTourStorageKey, String(guidedTourIndex));
  }
  renderGuidedTour();
}

function restartGuidedTour() {
  guidedTourIndex = 0;
  guidedTourComplete = false;
  writeScopedDashboardPreference(guidedTourStorageKey, "0");
  window.localStorage.removeItem(guidedTourCompleteStorageKey);
  renderGuidedTour();
  showNotice("Getting-started tutorial restarted at company setup.");
}

// The tour used to open at "Step 1 of 6 - Set up your company" for every
// company forever, because guidedTourIndex was read from localStorage alone and
// never consulted real state. A business with completed setup, posted invoices
// and balanced journals was still told to set itself up.
//
// Only step 1 has an unambiguous completion signal available on the client
// (the activation checklist in `setup.steps`). Steps 2-6 - customer/product,
// invoice, payment, bank review, invite - have no equivalent client-side signal
// today, so they are deliberately left to the stored position rather than
// guessed at. Wiring those up needs an activation summary from the API.
function resolveGuidedTourFromState() {
  if (!setup?.steps?.length) return;
  const stored = readScopedDashboardPreference(guidedTourStorageKey);
  // An explicit choice by the user always wins.
  if (stored !== null && stored !== "") {
    const parsed = Number(stored);
    if (Number.isFinite(parsed)) {
      guidedTourIndex = Math.min(Math.max(parsed, 0), guidedTourSteps.length - 1);
      renderGuidedTour();
      return;
    }
  }
  const setupComplete = setup.steps.every((step) => ["COMPLETED", "SKIPPED"].includes(step.status));
  if (setupComplete && guidedTourIndex === 0) {
    guidedTourIndex = 1;
    renderGuidedTour();
  }
}

export function renderGuidedTour() {
  const step = guidedTourSteps[guidedTourIndex];
  const stepNumber = guidedTourIndex + 1;
  const stepCount = guidedTourSteps.length;
  const status = guidedTourComplete
    ? `Tutorial complete · Step ${stepNumber} of ${stepCount}`
    : `Step ${stepNumber} of ${stepCount}`;
  const surfaces = [
    {
      progress: elements["guided-tour-progress"],
      count: elements["guided-tour-step-count"],
      title: elements["guided-tour-title"],
      summary: elements["guided-tour-summary"],
      checklist: elements["guided-tour-checklist"],
      previous: elements["guided-tour-previous"],
      next: elements["guided-tour-next"],
      action: elements["guided-tour-open-step"]
    },
    {
      progress: elements["dashboard-help-progress"],
      count: elements["dashboard-help-step-count"],
      title: elements["dashboard-help-step-title"],
      summary: elements["dashboard-help-step-summary"],
      checklist: elements["dashboard-help-step-checklist"],
      previous: elements["dashboard-help-previous"],
      next: elements["dashboard-help-next"],
      action: elements["dashboard-help-open-step"]
    }
  ];
  for (const surface of surfaces) {
    surface.progress.value = stepNumber;
    surface.progress.max = stepCount;
    surface.progress.textContent = `${stepNumber} of ${stepCount}`;
    surface.count.textContent = status;
    surface.title.textContent = step.title;
    surface.summary.textContent = step.summary;
    surface.checklist.replaceChildren(
      ...step.checklist.map((item) => {
        const line = document.createElement("li");
        line.textContent = item;
        return line;
      })
    );
    surface.previous.disabled = guidedTourIndex === 0;
    surface.next.disabled = guidedTourComplete && guidedTourIndex === stepCount - 1;
    surface.next.textContent =
      guidedTourIndex === stepCount - 1
        ? guidedTourComplete
          ? "Tutorial complete"
          : "Finish tutorial"
        : "Next step";
    surface.action.textContent = step.actionLabel;
  }
}

export function filterHelpTopics() {
  const query = elements["help-search"].value.trim().toLocaleLowerCase();
  const topics = [...document.querySelectorAll("[data-help-topic]")];
  let visible = 0;
  for (const topic of topics) {
    const haystack = `${topic.textContent} ${topic.dataset.helpKeywords || ""}`.toLocaleLowerCase();
    const matches = !query || haystack.includes(query);
    topic.hidden = !matches;
    if (matches) visible += 1;
  }
  elements["help-search-status"].textContent = query
    ? `${visible} of ${topics.length} help topics match “${elements["help-search"].value.trim()}”.`
    : `Showing all ${topics.length} help topics.`;
}

function supportDiagnosticsLines(generatedAt = new Date()) {
  return [
    `Generated: ${generatedAt.toISOString()}`,
    `Browser: ${window.navigator.userAgent}`,
    `Language: ${window.navigator.language}`,
    `Online: ${window.navigator.onLine ? "yes" : "no"}`,
    `Viewport: ${window.innerWidth} x ${window.innerHeight}`,
    `Theme: ${document.documentElement.dataset.theme || "light"}`,
    `Density: ${document.documentElement.dataset.density || "comfortable"}`,
    `Text size: ${document.documentElement.dataset.textScale || "standard"}`,
    `Screen width: ${document.documentElement.dataset.contentWidth || "standard"}`,
    `Motion: ${document.documentElement.dataset.motion || "system"}`,
    `Dashboard layout: ${document.documentElement.dataset.dashboardLayout || "balanced"}`,
    `Dashboard tiles shown: ${dashboardPreferences.tiles
      .filter(({ visible }) => visible)
      .map(({ key }) => key)
      .join(", ")}`,
    `Workspace: ${activeWorkspaceId}`,
    `Runtime: ${controlledShareMode ? "controlled share" : "standard"}`,
    "Excluded: names, email addresses, organization identifiers, authentication details, documents, account numbers, transactions, and amounts."
  ];
}

function buildSupportDiagnostics(generatedAt = new Date()) {
  return ["PennyWise Accounting support details", ...supportDiagnosticsLines(generatedAt)].join(
    "\n"
  );
}

function downloadSupportDiagnostics() {
  downloadTextFile("clearledger-support-details.txt", buildSupportDiagnostics());
  trackProductEvent("SUPPORT_DIAGNOSTICS_DOWNLOADED");
  showNotice("Support details downloaded without financial or customer data.");
}

function clearBugReportValidity() {
  for (const fieldName of Object.keys(bugReportRequiredFields)) {
    elements["bug-report-form"].elements[fieldName].setCustomValidity("");
  }
}

function setBugReportStatus(message, isError = false) {
  elements["bug-report-status"].textContent = message;
  elements["bug-report-status"].dataset.state = isError ? "error" : "ready";
}

function prepareBugReport() {
  const form = elements["bug-report-form"];
  for (const [fieldName, message] of Object.entries(bugReportRequiredFields)) {
    const field = form.elements[fieldName];
    field.setCustomValidity(field.value.trim() ? "" : message);
  }
  if (!form.reportValidity()) {
    setBugReportStatus("Complete every required field before preparing the report.", true);
    return null;
  }

  const data = new FormData(form);
  const generatedAt = new Date();
  const includeDiagnostics = data.get("includeDiagnostics") === "on";
  const report = [
    "PennyWise Accounting bug report",
    `Prepared locally: ${generatedAt.toISOString()}`,
    "Submission status: Not sent automatically",
    "",
    "SUMMARY",
    data.get("summary").trim(),
    "",
    "SEVERITY",
    data.get("severity").trim(),
    "",
    "STEPS TO REPRODUCE",
    data.get("steps").trim(),
    "",
    "EXPECTED RESULT",
    data.get("expected").trim(),
    "",
    "ACTUAL RESULT",
    data.get("actual").trim(),
    "",
    "PRIVACY-SAFE DIAGNOSTICS",
    ...(includeDiagnostics
      ? supportDiagnosticsLines(generatedAt)
      : ["Not included at the reporter's request."])
  ].join("\n");

  return { report, summary: data.get("summary").trim() };
}

async function copyBugReport() {
  const prepared = prepareBugReport();
  if (!prepared) return;
  try {
    await writeClipboardText(prepared.report);
    setBugReportStatus(
      "Report copied. It has not been sent; paste it into a message to a trusted support person."
    );
  } catch {
    setBugReportStatus("The browser could not copy the report. Use Download report instead.", true);
  }
}

function downloadBugReport() {
  const prepared = prepareBugReport();
  if (!prepared) return;
  const date = new Date().toISOString().slice(0, 10);
  downloadTextFile(`clearledger-bug-report-${date}.txt`, prepared.report);
  setBugReportStatus("Report downloaded. It has not been sent; review the file before sharing it.");
}

function emailBugReport() {
  const prepared = prepareBugReport();
  if (!prepared) return;
  const link = document.createElement("a");
  link.href = `mailto:?subject=${encodeURIComponent(`PennyWise Accounting bug: ${prepared.summary}`)}&body=${encodeURIComponent(prepared.report)}`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setBugReportStatus(
    "Email draft opened with no recipient. Review it, choose a trusted recipient, and press Send yourself."
  );
}
