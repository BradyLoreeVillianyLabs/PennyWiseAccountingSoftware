// Company setup and settings (`setup-workspace`).

import { formatMinor, minorToInput, parseMoneyInput, parseSignedMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { formatRateSnapshot, renderAllCurrencyControls } from "../lib/currency-controls.js";
import {
  cell,
  escapeHtml,
  escapeText,
  inputCell,
  listItem,
  option,
  row,
  rowText
} from "../lib/dom.js";
import { showError, showNotice } from "../lib/notices.js";
import { trackProductEvent } from "../lib/product-analytics.js";
import { activeRoleIs, formatRole } from "../lib/roles.js";
import {
  formatOwnerDate,
  loadBanking,
  loadFixedAssets,
  loadHomeDashboard,
  loadInventory,
  loadPayments,
  loadPurchases,
  loadSales,
  previewInvoice,
  refreshTaxCodeComponentAccounts,
  registerWorkspaceCalls,
  renderFixedAssetSelects,
  renderPayrollAccountOptions,
  renderTaxCodeList,
  resolveGuidedTourFromState
} from "../lib/workspace-calls.js";
import { renderLeftNavigation, setOwnerWorkspaceMode } from "../nav.js";
import { buildWorkspaceSubnavigation, navigateTo } from "../shell.js";
import {
  accounts,
  activePreviewInvoice,
  activeWorkspaceId,
  elements,
  identity,
  multiCurrencyEnabledLocally,
  multiCurrencySettingsRequestSequence,
  multiCurrencyState,
  organizationMemberships,
  ownerWorkspaceMode,
  setAccounts,
  setActiveWorkspaceId,
  setMultiCurrencyEnabledLocally,
  setMultiCurrencySettingsRequestSequence,
  setMultiCurrencyState,
  setSetup,
  setWorkflowPreferencesState,
  setup,
  workflowPreferencesState
} from "../state.js";

let automationState = null;
let openingBalance = null;
const setupLabels = {
  BUSINESS_PROFILE: "Business",
  FISCAL_CURRENCY: "Fiscal",
  TAX_REGISTRATION: "Tax",
  INDUSTRY_PRESET: "Preset",
  CHART_REVIEW: "Chart",
  OPENING_BALANCES: "Balances",
  BRANDING_DEFAULTS: "Branding",
  FINAL_REVIEW: "Review"
};
const activationLabels = {
  BUSINESS_PROFILE: ["Add your business details", "Name, contact, locale, and timezone"],
  FISCAL_CURRENCY: ["Choose your accounting calendar", "Currency, start date, and fiscal year"],
  TAX_REGISTRATION: ["Set up tax", "Registration details and tax treatment"],
  INDUSTRY_PRESET: ["Choose your starting accounts", "Use a preset that fits your business"],
  CHART_REVIEW: ["Review your accounts", "Confirm the accounts you will use"],
  OPENING_BALANCES: [
    "Add opening balances",
    "Optional starting balances reviewed by your accountant"
  ],
  BRANDING_DEFAULTS: ["Make invoices yours", "Logo, terms, colours, and payment instructions"],
  FINAL_REVIEW: ["Finish setup", "Confirm the choices before everyday work"]
};

registerWorkspaceCalls({
  applyWorkflowVisibility,
  loadAccounts,
  loadMultiCurrencySettings,
  refreshSetupState,
  renderMultiCurrencySettings,
  showSetupStep
});

export function initSetup() {
  elements["show-more-pennywise"]?.addEventListener("click", showMorePennyWise);
  elements["profile-form"].addEventListener("submit", saveProfile);
  elements["fiscal-form"].addEventListener("submit", saveFiscal);
  elements["initialize-fiscal"].addEventListener("click", initializeFiscal);
  elements["tax-registration-form"].addEventListener("submit", saveTaxRegistration);
  elements["preset-form"].addEventListener("submit", applyPreset);
  elements["preset-form"].elements.presetKey.addEventListener("change", previewPreset);
  elements["refresh-accounts"].addEventListener("click", loadAccounts);
  elements["opening-form"].addEventListener("submit", saveOpeningBalances);
  elements["post-opening"].addEventListener("click", postOpeningBalances);
  elements["defaults-form"].addEventListener("submit", saveDefaults);
  elements["workflow-preferences-form"].addEventListener("submit", saveWorkflowPreferences);
  elements["refresh-automations"]?.addEventListener("click", loadAutomations);
  elements["automation-job-list"]?.addEventListener("click", handleAutomationAction);
  elements["multi-currency-form"].addEventListener("submit", saveMultiCurrencySettings);
  elements["fx-rate-form"].addEventListener("submit", createFxRateSnapshot);
  elements["suggest-boc-rate"].addEventListener("click", suggestBankOfCanadaRate);
  elements["fx-rate-form"].elements.transactionCurrency.addEventListener(
    "change",
    renderBankOfCanadaSuggestionAvailability
  );
  elements["workflow-preferences-form"].elements.profileKey.addEventListener(
    "change",
    applySelectedWorkflowProfile
  );
  elements["logo-form"].addEventListener("submit", uploadLogo);
  elements["invoice-logo-form"].addEventListener("submit", uploadLogo);
  elements["invoice-background-form"].addEventListener("submit", uploadInvoiceBackground);
  elements["open-accountant-workspace"].addEventListener("click", () => {
    setOwnerWorkspaceMode(false);
    navigateTo("accountant-workspace");
  });
  elements["complete-setup"].addEventListener("click", completeSetup);
  elements["activation-refresh"].addEventListener("click", loadSetup);
  document
    .querySelectorAll("[data-skip]")
    .forEach((button) =>
      button.addEventListener("click", () => setStep(button.dataset.skip, "SKIPPED"))
    );
  document
    .querySelectorAll("[data-complete]")
    .forEach((button) =>
      button.addEventListener("click", () => setStep(button.dataset.complete, "COMPLETED"))
    );
}

export async function loadSetup() {
  const response = await api("/v1/setup");
  if (!response.ok) return showError(response);
  setSetup((await response.json()).setup);
  await renderSetupState();
}

export async function refreshSetupState() {
  const response = await api("/v1/setup");
  if (!response.ok) return false;
  setSetup((await response.json()).setup);
  await renderSetupState();
  return true;
}

async function renderSetupState() {
  renderSetupTabs();
  renderActivationChecklist();
  fillSetupForms();
  renderTaxCodeList();
  await Promise.all([
    loadAccounts(),
    loadOpeningBalances(),
    loadWorkflowPreferences(),
    loadAutomations(),
    loadMultiCurrencySettings()
  ]);
  await previewPreset();
}

function renderActivationChecklist() {
  if (!setup?.steps) return;
  resolveGuidedTourFromState();
  const completed = setup.steps.filter((step) => ["COMPLETED", "SKIPPED"].includes(step.status));
  const setupComplete = completed.length === setup.steps.length;
  const card = elements["activation-card"];
  card.hidden = false;
  // The heading is static in the markup, so a company with posted invoices was
  // still told to "Get ready to send your first invoice" — and buildWorkspaceSubnavigation,
  // which reads visible H2 text, repeated that into the workspace subnav.
  elements["activation-heading"].textContent = setupComplete
    ? "Setup checklist"
    : "Get ready to send your first invoice";
  elements["activation-summary"].textContent = setupComplete
    ? "Your workspace is ready. You can revisit any choice from Business settings."
    : `${completed.length} of ${setup.steps.length} steps complete. You can pause and return whenever you are ready.`;
  elements["activation-checklist"].replaceChildren(
    ...setup.steps.map((step) => {
      const [label, description] = activationLabels[step.step] ?? [step.step, "Setup step"];
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activation-item";
      button.dataset.status = step.status;
      button.innerHTML = `<span class="activation-item-title"></span><span class="activation-item-description"></span>`;
      button.querySelector(".activation-item-title").textContent =
        `${["COMPLETED", "SKIPPED"].includes(step.status) ? "✓ " : ""}${label}`;
      button.querySelector(".activation-item-description").textContent = description;
      button.addEventListener("click", () => {
        trackProductEvent("ACTIVATION_STEP_OPENED");
        navigateTo("setup-workspace");
        showSetupStep(step.step);
      });
      item.append(button);
      return item;
    })
  );
  if (!sessionStorage.getItem("clearledger_activation_viewed")) {
    sessionStorage.setItem("clearledger_activation_viewed", "1");
    trackProductEvent("ACTIVATION_CHECKLIST_VIEWED");
  }
}

function renderSetupTabs() {
  const finished = setup.steps.filter((step) =>
    ["COMPLETED", "SKIPPED"].includes(step.status)
  ).length;
  elements["setup-progress"].textContent = `${finished} of ${setup.steps.length}`;
  elements["setup-tabs"].replaceChildren(
    ...setup.steps.map((state, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab";
      button.textContent = `${index + 1}. ${setupLabels[state.step]}`;
      button.dataset.status = state.status;
      button.addEventListener("click", () => showSetupStep(state.step));
      return button;
    })
  );
  const next =
    setup.steps.find((step) => !["COMPLETED", "SKIPPED"].includes(step.status))?.step ??
    "FINAL_REVIEW";
  showSetupStep(next);
}

export function showSetupStep(step) {
  trackProductEvent("ACTIVATION_STEP_OPENED");
  document.querySelectorAll(".setup-panel").forEach((panel) => {
    panel.hidden = panel.dataset.step !== step;
  });
  document
    .querySelectorAll(".tab")
    .forEach((tab) =>
      tab.setAttribute(
        "aria-current",
        tab.textContent.includes(setupLabels[step]) ? "step" : "false"
      )
    );
  if (step === "FINAL_REVIEW") renderFinalStatus();
}

function fillSetupForms() {
  const profile = elements["profile-form"].elements;
  const fiscal = elements["fiscal-form"].elements;
  for (const [name, value] of Object.entries({ ...setup.organization, ...setup.settings }))
    if (profile[name]) profile[name].value = value ?? "";
  profile.version.value = setup.settings.version;
  fiscal.baseCurrency.value = setup.settings.baseCurrency ?? "";
  fiscal.accountingStartDate.value = setup.settings.accountingStartDate ?? "";
  fiscal.fiscalYearEndDate.value = fiscalYearEndDateValue(
    setup.settings.fiscalYearEndMonth,
    setup.settings.fiscalYearEndDay,
    setup.settings.accountingStartDate
  );
  const defaults = elements["defaults-form"].elements;
  for (const [name, value] of Object.entries(setup.defaults)) {
    if (!defaults[name]) continue;
    if (name === "paymentMethods") {
      const selected = new Set(Array.isArray(value) ? value : []);
      for (const input of elements["defaults-form"].querySelectorAll(
        'input[name="paymentMethods"]'
      ))
        input.checked = selected.has(input.value);
    } else if (defaults[name].type === "checkbox") defaults[name].checked = value;
    else defaults[name].value = value ?? "";
  }
}

async function loadWorkflowPreferences() {
  const response = await api("/v1/settings/workflow-preferences");
  if (!response.ok) return showError(response);
  setWorkflowPreferencesState(await response.json());
  renderWorkflowPreferences();
  applyWorkflowVisibility();
}

async function loadAutomations() {
  const response = await api("/v1/organizations/current/automations", {}, true);
  if (!response.ok) {
    if (response.status === 403 || response.status === 404) {
      elements["automation-job-list"]?.replaceChildren();
      return;
    }
    return showError(response);
  }
  automationState = await response.json();
  renderAutomations();
}

function renderAutomations() {
  const list = elements["automation-job-list"];
  if (!list || !automationState) return;
  const status = automationState.status;
  elements["automation-runtime-status"].textContent = status.enabled
    ? status.recoveryComplete
      ? "Automations are active while PennyWise is open on this computer."
      : "Automations are catching up; the API will report ready when recovery completes."
    : "Automations are disabled for this installation (JOBS_ENABLED=false).";
  list.replaceChildren(
    ...automationState.jobs.map((job) => {
      const card = document.createElement("article");
      card.className = "automation-job-card";
      const last = job.lastRun
        ? `${job.lastRun.status.toLowerCase()} · ${formatOwnerDate(job.lastRun.startedAt)}`
        : "Not run yet";
      const next = job.nextRunAt ? formatOwnerDate(job.nextRunAt) : "Not scheduled";
      const state = job.unavailableReason
        ? `Unavailable: ${job.unavailableReason}`
        : job.deadLettered
          ? "Dead-lettered after repeated failures; resume to retry."
          : job.paused
            ? "Paused for this organization."
            : `Every ${Math.round(job.intervalMs / 1000)} seconds · batch ${job.batchSize}`;
      card.innerHTML = `
        <div class="automation-job-card-heading">
          <div><h4>${escapeHtml(job.label)}</h4><p>${escapeHtml(state)}</p></div>
          <span class="status-pill">${escapeHtml(job.available ? (job.paused ? "Paused" : "Available") : "Unavailable")}</span>
        </div>
        <dl class="automation-job-meta">
          <div><dt>Last run</dt><dd>${escapeHtml(last)}</dd></div>
          <div><dt>Next run</dt><dd>${escapeHtml(next)}</dd></div>
          <div><dt>Failures</dt><dd>${escapeHtml(String(job.lastRun?.failed ?? 0))}</dd></div>
        </dl>
        <div class="form-actions">
          <button type="button" class="secondary-command" data-automation-action="run" data-job-name="${escapeHtml(job.name)}" ${job.available && !job.paused ? "" : "disabled"}>Run now</button>
          <button type="button" class="secondary-command" data-automation-action="pause" data-job-name="${escapeHtml(job.name)}" ${job.available ? "" : "disabled"}>${job.paused ? "Resume" : "Pause"}</button>
        </div>`;
      return card;
    })
  );
}

async function handleAutomationAction(event) {
  const target = event.target;
  if (!(target instanceof globalThis.Element)) return;
  const button = target.closest("button[data-automation-action]");
  if (!(button instanceof globalThis.HTMLButtonElement)) return;
  const jobName = button.dataset.jobName;
  const action = button.dataset.automationAction;
  if (!jobName || !action) return;
  button.disabled = true;
  try {
    if (action === "run") {
      const response = await api(
        `/v1/organizations/current/automations/${encodeURIComponent(jobName)}/run`,
        jsonRequest({})
      );
      if (!response.ok) return showError(response);
      showNotice("Automation run started.");
    } else if (action === "pause") {
      const job = automationState?.jobs.find((candidate) => candidate.name === jobName);
      const response = await api(
        `/v1/organizations/current/automations/${encodeURIComponent(jobName)}`,
        jsonRequest({ paused: !job?.paused }, "PATCH")
      );
      if (!response.ok) return showError(response);
      showNotice(job?.paused ? "Automation resumed." : "Automation paused.");
    }
    await loadAutomations();
  } finally {
    button.disabled = false;
  }
}

async function loadMultiCurrencySettings() {
  const requestSequence = setMultiCurrencySettingsRequestSequence(
    multiCurrencySettingsRequestSequence + 1
  );
  const response = await api("/v1/settings/multi-currency");
  if (!response.ok) return showError(response);
  if (requestSequence !== multiCurrencySettingsRequestSequence) return;
  const loadedState = (await response.json()).multiCurrency;
  // Setup refreshes can overlap the contextual enable write. Do not let an
  // older disabled snapshot undo a confirmed enable in the active page.
  if (!loadedState.enabled && multiCurrencyEnabledLocally) return;
  setMultiCurrencyState(loadedState);
  setMultiCurrencyEnabledLocally(multiCurrencyEnabledLocally || loadedState.enabled);
  renderMultiCurrencySettings();
}

function renderMultiCurrencySettings() {
  if (!multiCurrencyState) return;
  const form = elements["multi-currency-form"];
  form.elements.version.value = multiCurrencyState.version;
  form.elements.enabled.checked = multiCurrencyState.enabled;
  form.elements.enabled.disabled = false;
  form.elements.rateMode.value = "MANUAL";
  form.elements.rateMode.disabled = true;
  for (const checkbox of form.querySelectorAll('input[name="currency"]')) {
    checkbox.checked = multiCurrencyState.currencies.some(
      (currency) => currency.currencyCode === checkbox.value && currency.enabled
    );
    checkbox.disabled =
      checkbox.value === multiCurrencyState.baseCurrency || multiCurrencyState.enabled;
  }
  const rateCurrency = elements["fx-rate-form"].elements.transactionCurrency;
  rateCurrency.replaceChildren(
    ...multiCurrencyState.currencies
      .filter(
        (currency) => currency.enabled && currency.currencyCode !== multiCurrencyState.baseCurrency
      )
      .map((currency) => option(currency.currencyCode, currency.currencyCode))
  );
  for (const control of elements["fx-rate-form"].elements) {
    control.disabled = !multiCurrencyState.enabled;
  }
  renderBankOfCanadaSuggestionAvailability();
  const help = elements["multi-currency-help"];
  help.textContent = multiCurrencyState.enabled
    ? `Base reporting currency: ${multiCurrencyState.baseCurrency}. CAD and USD documents post using explicit, immutable rate snapshots.`
    : `Base reporting currency: ${multiCurrencyState.baseCurrency}. Enable CAD and USD before creating foreign-currency documents or rates.`;
  elements["fx-rate-rows"].replaceChildren(
    ...multiCurrencyState.rates.map((rate) => {
      const row = document.createElement("tr");
      row.append(
        cell(`${rate.transactionCurrency}/${rate.baseCurrency}`),
        cell(formatRateSnapshot(rate)),
        cell(rate.effectiveAt.slice(0, 10)),
        cell(formatRole(rate.purpose)),
        cell(rate.method),
        cell(rate.sourceReference || "—")
      );
      return row;
    })
  );
  renderAllCurrencyControls();
}

async function saveMultiCurrencySettings(event) {
  event.preventDefault();
  if (!multiCurrencyState) return;
  const form = event.currentTarget;
  const currencies = [...form.querySelectorAll('input[name="currency"]:checked')].map(
    (input) => input.value
  );
  const response = await api(
    "/v1/settings/multi-currency",
    jsonRequest(
      {
        version: multiCurrencyState.version,
        enabled: form.elements.enabled.checked,
        rateMode: "MANUAL",
        currencies
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  setMultiCurrencyState((await response.json()).multiCurrency);
  setMultiCurrencyEnabledLocally(multiCurrencyState.enabled);
  // This write also advances OrganizationSettings.version. Keep the guided
  // profile/fiscal forms on the same version so saving currency and fiscal
  // settings in either order cannot produce a false stale-settings conflict.
  if (setup?.settings) setup.settings.version = multiCurrencyState.version;
  renderMultiCurrencySettings();
  showNotice("Multi-currency settings saved.");
}

async function createFxRateSnapshot(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const effectiveDate = form.elements.effectiveAt.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))
    return showNotice("Choose a valid effective date.", true);
  const response = await api(
    "/v1/settings/multi-currency/rates",
    jsonRequest(
      {
        transactionCurrency: form.elements.transactionCurrency.value,
        rate: form.elements.rate.value.trim(),
        effectiveAt: `${effectiveDate}T12:00:00.000Z`,
        method: "MANUAL",
        purpose: form.elements.purpose.value,
        sourceReference: form.elements.sourceReference.value.trim() || null
      },
      "POST"
    )
  );
  if (!response.ok) return showError(response);
  form.reset();
  await loadMultiCurrencySettings();
  elements["fx-rate-suggestion-status"].textContent =
    "The reviewed snapshot was saved. Any future suggestion remains a preview until you explicitly add it.";
  showNotice("Exchange-rate snapshot added.");
}

function renderBankOfCanadaSuggestionAvailability() {
  const rateForm = elements["fx-rate-form"];
  const supported = Boolean(
    multiCurrencyState?.enabled &&
      multiCurrencyState.baseCurrency === "CAD" &&
      rateForm.elements.transactionCurrency.value === "USD"
  );
  elements["suggest-boc-rate"].disabled = !supported;
  elements["suggest-boc-rate"].title = supported
    ? "Preview the latest published FXUSDCAD observation on or before the effective date."
    : "The no-key suggestion currently supports USD transactions in a CAD-base company.";
}

async function suggestBankOfCanadaRate() {
  const form = elements["fx-rate-form"];
  const status = elements["fx-rate-suggestion-status"];
  if (!form.elements.effectiveAt.value) {
    form.elements.effectiveAt.value = new Date().toISOString().slice(0, 10);
  }
  const requestedDate = form.elements.effectiveAt.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    status.textContent = "Choose a valid effective date before requesting a suggestion.";
    return showNotice(status.textContent, true);
  }

  elements["suggest-boc-rate"].disabled = true;
  elements["suggest-boc-rate"].setAttribute("aria-busy", "true");
  status.textContent = "Checking the official Bank of Canada Valet observations...";
  const response = await api(
    `/v1/settings/multi-currency/rate-suggestion?date=${encodeURIComponent(requestedDate)}&transactionCurrency=USD`
  );
  elements["suggest-boc-rate"].removeAttribute("aria-busy");
  renderBankOfCanadaSuggestionAvailability();
  if (!response.ok) {
    status.textContent =
      "No suggestion was applied. You can still enter a documented rate manually.";
    return showError(response);
  }

  const { suggestion } = await response.json();
  form.elements.rate.value = suggestion.rate;
  form.elements.effectiveAt.value = suggestion.requestedDate;
  form.elements.sourceReference.value = suggestion.sourceReference;
  status.textContent = `Indicative ${suggestion.series} observation ${suggestion.observationDate}: 1 USD = ${suggestion.rate} CAD (requested ${suggestion.requestedDate}). Nothing has been saved or posted; review every field, then choose Add rate snapshot if appropriate.`;
  showNotice("Indicative rate prefilled for review. Nothing has been saved.");
}

function renderWorkflowPreferences() {
  if (!workflowPreferencesState) return;
  const form = elements["workflow-preferences-form"];
  const preferences = workflowPreferencesState.workflowPreferences;
  form.elements.profileKey.replaceChildren(
    ...workflowPreferencesState.profileDefaults.map((profile) => option(profile.key, profile.label))
  );
  form.elements.profileKey.value = preferences.profileKey;
  for (const name of [
    "cashPlanningEnabled",
    "bankFeedReviewRequired",
    "purchaseRequestsEnabled",
    "requireSeparatePurchaseApprover",
    "customerDepositsEnabled",
    "progressBillingEnabled",
    "fixedAssetRegisterEnabled",
    "ownerWorkspaceEnabled"
  ]) {
    form.elements[name].checked = preferences[name];
  }
  form.elements.purchaseApprovalThresholdMinor.value = minorToInput(
    preferences.purchaseApprovalThresholdMinor
  );
  const profile = workflowPreferencesState.profileDefaults.find(
    (item) => item.key === preferences.profileKey
  );
  elements["workflow-profile-description"].textContent = profile?.description ?? "";
  if (elements["show-more-pennywise-panel"])
    elements["show-more-pennywise-panel"].hidden = preferences.profileKey !== "INVOICING_ONLY";

  const role = organizationMemberships.find(
    (membership) => membership.organizationId === identity?.activeOrganizationId
  )?.role;
  const canEdit = ["OWNER", "ADMIN"].includes(role);
  for (const control of form.elements) control.disabled = !canEdit;
  form.title = canEdit ? "" : "Only an organization owner or administrator can change these.";

  const safety = workflowPreferencesState.safetyControls;
  elements["workflow-safety-controls"].replaceChildren(
    listItem("Manual statement imports require review: Yes"),
    listItem(
      `Connected bank rule processing: ${preferences.bankFeedReviewRequired ? "Review everything" : "Approved exact rules may process; exceptions remain in review"}`
    ),
    listItem(
      `OCR captures always require review: ${safety.ocrCaptureReviewRequired ? "Yes" : "No"}`
    ),
    listItem(
      `Unrestricted automatic posting: ${safety.automaticPostingEnabled ? "Enabled" : "Disabled"}`
    ),
    listItem(`Holdbacks: ${safety.holdbacksEnabled ? "Enabled" : "Disabled"}`),
    listItem("Payroll summary import: Not available in this beta")
  );
}

function showMorePennyWise() {
  const form = elements["workflow-preferences-form"];
  if (!workflowPreferencesState || !form || form.elements.profileKey.disabled) return;
  form.elements.profileKey.value = "SOLO_SERVICE";
  applySelectedWorkflowProfile();
  form.requestSubmit();
}

function applySelectedWorkflowProfile() {
  if (!workflowPreferencesState) return;
  const form = elements["workflow-preferences-form"];
  const profile = workflowPreferencesState.profileDefaults.find(
    (item) => item.key === form.elements.profileKey.value
  );
  if (!profile) return;
  for (const name of [
    "cashPlanningEnabled",
    "bankFeedReviewRequired",
    "purchaseRequestsEnabled",
    "requireSeparatePurchaseApprover",
    "customerDepositsEnabled",
    "progressBillingEnabled",
    "fixedAssetRegisterEnabled",
    "ownerWorkspaceEnabled"
  ]) {
    form.elements[name].checked = profile[name];
  }
  form.elements.purchaseApprovalThresholdMinor.value = minorToInput(
    profile.purchaseApprovalThresholdMinor
  );
  elements["workflow-profile-description"].textContent = profile.description;
}

async function saveWorkflowPreferences(event) {
  event.preventDefault();
  if (!workflowPreferencesState) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  let purchaseApprovalThresholdMinor;
  try {
    purchaseApprovalThresholdMinor = parseMoneyInput(data.get("purchaseApprovalThresholdMinor"));
  } catch (error) {
    return showNotice(
      error instanceof Error ? error.message : "Enter a valid approval threshold.",
      true
    );
  }
  const response = await api(
    "/v1/settings/workflow-preferences",
    jsonRequest(
      {
        version: workflowPreferencesState.workflowPreferences.version,
        profileKey: data.get("profileKey"),
        cashPlanningEnabled: data.get("cashPlanningEnabled") === "on",
        bankFeedReviewRequired: data.get("bankFeedReviewRequired") === "on",
        purchaseRequestsEnabled: data.get("purchaseRequestsEnabled") === "on",
        purchaseApprovalThresholdMinor,
        requireSeparatePurchaseApprover: data.get("requireSeparatePurchaseApprover") === "on",
        customerDepositsEnabled: data.get("customerDepositsEnabled") === "on",
        progressBillingEnabled: data.get("progressBillingEnabled") === "on",
        fixedAssetRegisterEnabled: data.get("fixedAssetRegisterEnabled") === "on",
        ownerWorkspaceEnabled: data.get("ownerWorkspaceEnabled") === "on",
        payrollSummaryImportEnabled: false
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  setWorkflowPreferencesState(await response.json());
  renderWorkflowPreferences();
  applyWorkflowVisibility();
  if (workflowPreferencesState.workflowPreferences.fixedAssetRegisterEnabled) {
    await loadFixedAssets();
  }
  showNotice("Workflow preferences saved.");
}

function applyWorkflowVisibility() {
  const preferences = workflowPreferencesState?.workflowPreferences;
  if (!preferences) return;
  const invoicingOnly = preferences.profileKey === "INVOICING_ONLY";
  const invoicingOnlyVisibleTargets = new Set([
    "overview-workspace",
    "sales-workspace",
    "payments-workspace",
    "reports-workspace"
  ]);
  for (const navigation of document.querySelectorAll(
    "#workspace-navigation > button[data-workspace-target]"
  )) {
    navigation.hidden =
      invoicingOnly && !invoicingOnlyVisibleTargets.has(navigation.dataset.workspaceTarget);
  }
  if (!preferences.ownerWorkspaceEnabled && ownerWorkspaceMode) {
    setOwnerWorkspaceMode(false, { rerender: false });
    if (activeWorkspaceId === "owner-workspace") setActiveWorkspaceId("overview-workspace");
  }
  renderLeftNavigation();
  const planningNavigation = document.querySelectorAll(
    '[data-workspace-target="planning-workspace"]'
  );
  const purchaseRequestCreate = document.querySelector(
    '[data-create-target="purchase-request-form"]'
  );
  const fixedAssetNavigation = document.querySelectorAll(
    '[data-workspace-target="fixed-assets-workspace"]'
  );
  const canCreatePurchaseRequest = activeRoleIs(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES"
  );
  const canManageSalesWorkflow = activeRoleIs(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES"
  );
  const canReadFixedAssets = activeRoleIs(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES",
    "READ_ONLY"
  );
  const canManageFixedAssets = activeRoleIs(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES"
  );
  const canConfigureFixedAssets = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT");
  for (const navigation of planningNavigation) {
    navigation.hidden = !preferences.cashPlanningEnabled;
  }
  for (const navigation of fixedAssetNavigation) {
    navigation.hidden = !preferences.fixedAssetRegisterEnabled || !canReadFixedAssets;
  }
  purchaseRequestCreate.hidden = !preferences.purchaseRequestsEnabled || !canCreatePurchaseRequest;
  elements["purchase-request-section"].hidden = !preferences.purchaseRequestsEnabled;
  elements["purchase-request-form"].hidden = !canCreatePurchaseRequest;
  elements["customer-deposit-section"].hidden = !preferences.customerDepositsEnabled;
  elements["customer-deposit-form"].hidden = !canManageSalesWorkflow;
  elements["progress-billing-section"].hidden = !preferences.progressBillingEnabled;
  elements["progress-billing-form"].hidden = !canManageSalesWorkflow;
  elements["fixed-asset-class-section"].hidden = !canConfigureFixedAssets;
  elements["fixed-asset-draft-section"].hidden = !canManageFixedAssets;
  if (!preferences.cashPlanningEnabled && activeWorkspaceId === "planning-workspace") {
    setActiveWorkspaceId("setup-workspace");
    sessionStorage.setItem("clearledger_active_workspace", activeWorkspaceId);
  }
  if (
    (!preferences.fixedAssetRegisterEnabled || !canReadFixedAssets) &&
    activeWorkspaceId === "fixed-assets-workspace"
  ) {
    setActiveWorkspaceId(
      preferences.fixedAssetRegisterEnabled ? "overview-workspace" : "setup-workspace"
    );
    sessionStorage.setItem("clearledger_active_workspace", activeWorkspaceId);
  }
  const activeWorkspace = elements[activeWorkspaceId];
  if (activeWorkspace && !activeWorkspace.hidden) buildWorkspaceSubnavigation(activeWorkspace);
}

function profilePayload() {
  const profile = new FormData(elements["profile-form"]);
  const fiscal = new FormData(elements["fiscal-form"]);
  const nullable = (value) => value?.trim() || null;
  const fiscalYearEnd = fiscalYearEndParts(fiscal.get("fiscalYearEndDate"));
  return {
    version: setup.settings.version,
    legalName: profile.get("legalName"),
    displayName: profile.get("displayName"),
    businessType: nullable(profile.get("businessType")),
    businessNumber: nullable(profile.get("businessNumber")),
    phone: nullable(profile.get("phone")),
    email: nullable(profile.get("email")),
    website: nullable(profile.get("website")),
    locale: profile.get("locale"),
    timeZone: profile.get("timeZone"),
    baseCurrency: fiscal.get("baseCurrency") || setup.settings.baseCurrency,
    fiscalYearEndMonth: fiscalYearEnd.month,
    fiscalYearEndDay: fiscalYearEnd.day,
    accountingStartDate: nullable(fiscal.get("accountingStartDate")),
    primaryColor: setup.settings.primaryColor,
    accentColor: setup.settings.accentColor
  };
}

function fiscalYearEndParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return { month: null, day: null };
  return { month: Number(match[2]), day: Number(match[3]) };
}

function fiscalYearEndDateValue(month, day, accountingStartDate) {
  if (!month || !day) return "";
  const startYear = Number((accountingStartDate ?? "").slice(0, 4));
  const currentYear = new Date().getFullYear();
  const preferredYear = Number.isInteger(startYear) && startYear > 0 ? startYear : currentYear;
  for (let offset = 0; offset < 8; offset += 1) {
    const year = preferredYear + offset;
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) === candidate)
      return candidate;
  }
  return "";
}

async function saveProfile(event) {
  event.preventDefault();
  await updateProfileAndStep("BUSINESS_PROFILE");
}

async function saveFiscal(event) {
  event.preventDefault();
  const response = await api("/v1/setup/profile", jsonRequest(profilePayload(), "PATCH"));
  if (!response.ok) return showError(response);
  setup.settings = (await response.json()).settings;
  const fiscalResponse = await api("/v1/setup/fiscal-year/initialize", jsonRequest({}));
  if (!fiscalResponse.ok) return showError(fiscalResponse);
  await refreshSetupState();
  if (!(await setStep("FISCAL_CURRENCY", "COMPLETED", false))) return;
  showNotice("Fiscal settings saved and first fiscal year initialized.");
}

async function updateProfileAndStep(step) {
  const response = await api("/v1/setup/profile", jsonRequest(profilePayload(), "PATCH"));
  if (!response.ok) return showError(response);
  setup.settings = (await response.json()).settings;
  // Multi-currency settings share the OrganizationSettings version. Refresh the
  // currency view after a profile save so its next optimistic-lock write does
  // not submit the version that was loaded before this request.
  await loadMultiCurrencySettings();
  if (!(await setStep(step, "COMPLETED", false))) return;
  showNotice("Settings saved.");
}

async function initializeFiscal() {
  const response = await api("/v1/setup/fiscal-year/initialize", jsonRequest({}));
  if (!response.ok) return showError(response);
  await refreshSetupState();
  showNotice("Fiscal year initialized.");
}

async function saveTaxRegistration(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/setup/tax-registrations",
    jsonRequest(
      {
        registrationType: data.get("registrationType"),
        jurisdiction: data.get("jurisdiction"),
        registrationNumber: data.get("registrationNumber") || null,
        registered: data.get("registered") === "on",
        effectiveFrom: data.get("effectiveFrom") || null
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  if (!(await setStep("TAX_REGISTRATION", "COMPLETED", false))) return;
  showNotice("Tax registration saved.");
}

async function previewPreset() {
  if (!setup) return;
  const key = elements["preset-form"].elements.presetKey.value;
  const response = await api(`/v1/setup/presets/${key}`);
  if (!response.ok) return;
  const preset = (await response.json()).preset;
  elements["preset-preview"].innerHTML =
    `<table aria-label="Account preset preview"><thead><tr><th scope="col">Code</th><th scope="col">Account</th><th scope="col">Type</th></tr></thead><tbody>${preset.accounts.map((item) => `<tr><td>${escapeText(item.code)}</td><td>${escapeText(item.name)}</td><td>${escapeText(item.type)}</td></tr>`).join("")}</tbody></table>`;
}

async function applyPreset(event) {
  event.preventDefault();
  const key = event.currentTarget.elements.presetKey.value;
  const response = await api(`/v1/setup/presets/${key}/apply`, {
    ...jsonRequest({}),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  await refreshSetupState();
  if (!(await setStep("INDUSTRY_PRESET", "COMPLETED", false))) return;
  await loadAccounts();
  await Promise.all([loadSales(), loadPurchases(), loadBanking(), loadInventory()]);
  await loadPayments();
  showNotice("Account preset applied.");
}

async function loadAccounts() {
  const response = await api("/v1/accounts");
  if (!response.ok) return;
  setAccounts((await response.json()).accounts);
  elements["setup-accounts"].replaceChildren(
    ...accounts.map((account) =>
      row([account.code, account.name, formatRole(account.type), account.isControl ? "Yes" : "No"])
    )
  );
  renderOpeningLines();
  renderFixedAssetSelects();
  renderPayrollAccountOptions();
  renderTaxCodeList();
  refreshTaxCodeComponentAccounts();
}

async function loadOpeningBalances() {
  const response = await api("/v1/setup/opening-balances");
  if (!response.ok) return;
  openingBalance = (await response.json()).openingBalance;
  renderOpeningLines();
}

function renderOpeningLines() {
  const existing = new Map((openingBalance?.lines ?? []).map((line) => [line.accountId, line]));
  elements["opening-lines"].replaceChildren(
    ...accounts.map((account) => {
      const prior = existing.get(account.id);
      const tr = document.createElement("tr");
      tr.dataset.accountId = account.id;
      tr.append(
        cell(`${account.code} ${account.name}`),
        inputCell("debit", minorToInput(prior?.debitMinor ?? "0")),
        inputCell("credit", minorToInput(prior?.creditMinor ?? "0")),
        inputCell(
          "difference",
          prior?.controlDifferenceMinor ? minorToInput(prior.controlDifferenceMinor) : ""
        )
      );
      return tr;
    })
  );
  elements["opening-form"].elements.effectiveDate.value =
    openingBalance?.effectiveDate?.slice(0, 10) ?? setup?.settings.accountingStartDate ?? "";
  updateOpeningBalanceSummary();
  for (const input of elements["opening-lines"].querySelectorAll("input")) {
    input.addEventListener("input", updateOpeningBalanceSummary);
  }
}

function openingBalanceTotals() {
  let debit = 0n;
  let credit = 0n;
  for (const tr of elements["opening-lines"].rows) {
    try {
      debit += BigInt(parseMoneyInput(tr.querySelector('[data-field="debit"]').value || "0"));
      credit += BigInt(parseMoneyInput(tr.querySelector('[data-field="credit"]').value || "0"));
    } catch {
      return { debit: null, credit: null, difference: null };
    }
  }
  return { debit, credit, difference: debit - credit };
}

function updateOpeningBalanceSummary() {
  const summary = elements["opening-balance-summary"];
  if (!summary) return;
  const totals = openingBalanceTotals();
  if (totals.debit === null || totals.credit === null) {
    summary.textContent = "Enter valid amounts to calculate the balance.";
    summary.dataset.balanced = "false";
    return;
  }
  const difference = totals.difference;
  const balanced = difference === 0n;
  summary.textContent = `Debits ${formatMinor(totals.debit.toString())} · Credits ${formatMinor(totals.credit.toString())} · ${balanced ? "Balanced" : `Difference ${formatMinor(difference < 0n ? (-difference).toString() : difference.toString())} — debits and credits must match`}`;
  summary.dataset.balanced = balanced ? "true" : "false";
}

async function saveOpeningBalances(event) {
  event.preventDefault();
  let lines;
  try {
    lines = [...elements["opening-lines"].rows]
      .map((tr) => ({
        accountId: tr.dataset.accountId,
        debitMinor: parseMoneyInput(tr.querySelector('[data-field="debit"]').value || "0"),
        creditMinor: parseMoneyInput(tr.querySelector('[data-field="credit"]').value || "0"),
        controlDifferenceMinor: tr.querySelector('[data-field="difference"]').value
          ? parseSignedMoneyInput(tr.querySelector('[data-field="difference"]').value)
          : null
      }))
      .filter((line) => line.debitMinor !== "0" || line.creditMinor !== "0");
  } catch (error) {
    return showNotice(
      error instanceof Error ? error.message : "Enter valid opening amounts.",
      true
    );
  }
  const totals = openingBalanceTotals();
  if (totals.debit === null || totals.credit === null)
    return showNotice("Enter valid opening amounts.", true);
  if (totals.debit !== totals.credit) {
    return showNotice(
      `Opening balances must balance before saving. Debits ${formatMinor(totals.debit.toString())}; credits ${formatMinor(totals.credit.toString())}.`,
      true
    );
  }
  const response = await api(
    "/v1/setup/opening-balances",
    jsonRequest(
      {
        version: openingBalance?.version,
        effectiveDate: event.currentTarget.elements.effectiveDate.value,
        lines
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  openingBalance = (await response.json()).openingBalance;
  renderOpeningLines();
  showNotice("Opening-balance draft saved.");
}

async function postOpeningBalances() {
  if (!openingBalance) return showNotice("Save a balanced draft first.");
  const response = await api(`/v1/setup/opening-balances/${openingBalance.id}/post`, {
    ...jsonRequest({}),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  openingBalance = (await response.json()).openingBalance;
  if (!(await setStep("OPENING_BALANCES", "COMPLETED", false))) return;
  showNotice("Opening balances posted.");
}

async function saveDefaults(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/setup/defaults",
    jsonRequest(
      {
        version: Number(data.get("version")),
        paymentTermsDays: Number(data.get("paymentTermsDays")),
        invoicePrefix: data.get("invoicePrefix"),
        invoiceNextPlaceholder: data.get("invoiceNextPlaceholder"),
        estimatePrefix: data.get("estimatePrefix"),
        estimateNextPlaceholder: data.get("estimateNextPlaceholder"),
        taxCalculationMode: data.get("taxCalculationMode"),
        customerNotes: data.get("customerNotes") || null,
        paymentInstructions: data.get("paymentInstructions") || null,
        paymentMethods: data.getAll("paymentMethods"),
        documentLanguage: data.get("documentLanguage"),
        dateFormat: data.get("dateFormat"),
        numberFormat: data.get("numberFormat"),
        showLogo: data.get("showLogo") === "on",
        showBusinessNumber: data.get("showBusinessNumber") === "on"
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  setup.defaults = (await response.json()).defaults;
  if (!(await setStep("BRANDING_DEFAULTS", "COMPLETED", false))) return;
  showNotice("Defaults saved.");
}

async function uploadLogo(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.logo.files[0];
  if (!file) return;
  const response = await api("/v1/setup/logo", {
    method: "POST",
    headers: { "content-type": file.type },
    body: file
  });
  if (!response.ok) return showError(response);
  form.reset();
  if (activePreviewInvoice) await previewInvoice(activePreviewInvoice);
  showNotice("Logo uploaded.");
}

async function uploadInvoiceBackground(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.background.files[0];
  if (!file) return;
  const status = elements["invoice-background-status"];
  status.textContent = "Uploading and checking image…";
  const response = await api("/v1/setup/invoice-background", {
    method: "POST",
    headers: { "content-type": file.type },
    body: file
  });
  if (!response.ok) {
    status.textContent = "The background was not saved.";
    return showError(response);
  }
  const asset = (await response.json()).asset;
  elements["invoice-template-form"].elements.headerImageAssetId.value = asset.id;
  form.reset();
  status.textContent = `Background ready (${asset.width} × ${asset.height}). Select Image watermark, then save the invoice appearance.`;
  showNotice("Invoice background uploaded. Save the appearance to apply it.");
}

export async function setStep(step, status, reload = true) {
  const current = setup.steps.find((item) => item.step === step);
  if (!current) return false;
  const response = await api(
    `/v1/setup/steps/${step}`,
    jsonRequest({ version: current.version, status }, "PATCH")
  );
  if (!response.ok) {
    await showError(response);
    return false;
  }
  Object.assign(current, (await response.json()).step);
  renderSetupTabs();
  renderActivationChecklist();
  if (status === "COMPLETED") trackProductEvent("ACTIVATION_STEP_COMPLETED");
  if (reload) showNotice("Setup progress saved.");
  return true;
}

function renderFinalStatus() {
  elements["final-status"].replaceChildren(
    ...setup.steps.map((item) => rowText(`${setupLabels[item.step]}: ${formatRole(item.status)}`))
  );
}

async function completeSetup() {
  const response = await api(
    "/v1/setup/complete",
    jsonRequest({ version: setup.settings.version })
  );
  if (!response.ok) return showError(response);
  setup.settings = (await response.json()).settings;
  await refreshSetupState();
  navigateTo("overview-workspace");
  await loadHomeDashboard();
  trackProductEvent("SETUP_COMPLETED");
  showNotice("Business setup completed. Welcome to your workspace.");
}
