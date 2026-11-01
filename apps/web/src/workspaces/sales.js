// Sales and receivables (`sales-workspace`).

import { formatMinor, formatMoney, minorToInput, parseMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { completeContextualCreation } from "../lib/contextual-creation.js";
import { enhanceCreatableSelect } from "../lib/creatable-select.js";
import {
  handleContextualCurrencyChoice,
  renderInvoiceCurrencyControls,
  renderInvoiceInlineRate,
  suggestInvoiceRate,
  useSuggestedInvoiceRate
} from "../lib/currency-controls.js";
import {
  billLineState,
  createInvoiceLine,
  estimateLineState,
  invoiceLineCounter,
  invoiceLineState,
  setEstimateLineState,
  setInvoiceLineState
} from "../lib/document-lines.js";
import {
  cell,
  commandButton,
  headerRow,
  listItem,
  moneyCell,
  moneyFromForm,
  option,
  row,
  rowText
} from "../lib/dom.js";
import { percentToRatioMicros, toIsoDateTime, toLocalDateTimeInput } from "../lib/format.js";
import {
  applySavedTableFilters,
  clearBrowserFormDraft,
  initializeBrowserFormDrafts
} from "../lib/forms.js";
import { showError, showNotice } from "../lib/notices.js";
import { trackProductEvent } from "../lib/product-analytics.js";
import { activeRoleIs, formatRole } from "../lib/roles.js";
import {
  finalizeInvoice,
  formatOwnerDate,
  loadCustomerRelationship,
  loadPayments,
  loadPurchases,
  openInvoicePaymentDialog,
  registerWorkspaceCalls,
  renderProjectWorkItemSelects
} from "../lib/workspace-calls.js";
import { appHeader, navigateTo, refreshContextualSearches } from "../shell.js";
import {
  accounts,
  activeInvoiceDraft,
  activePreviewInvoice,
  customers,
  elements,
  estimates,
  invoices,
  localIdentityEmail,
  multiCurrencyState,
  paymentInstructionSettings,
  payments,
  products,
  projects,
  runtimeCapabilities,
  setActiveInvoiceDraft,
  setActivePreviewInvoice,
  setCustomers,
  setEstimates,
  setInvoices,
  setProducts,
  setProjects,
  setup,
  vendors,
  workflowPreferencesState
} from "../state.js";
import { t } from "../../strings.js";

let creditNoteSource = null;
let voidInvoiceSource = null;
let invoiceDetailSource = null;
let invoiceSendSource = null;
let invoiceSendMode = "manual";
let invoiceSendResend = false;
let latestFollowUpInvoices = [];
let reminderSettingsVersion = null;
const invoicePublicLinks = new Map();
let invoiceTemplateState = null;
let customerDepositRequests = [];
let progressBillingPlans = [];
let recurringSchedules = [];
let invoiceLineUndo = null;
let documentLineUndo = { estimate: null, bill: null };
let documentLineDragId = null;
let invoiceDraftSaveTimer = null;
let invoiceDraftSaveSequence = 0;
let invoiceDueDateTouched = false;
const bulkEntryState = {
  type: "invoice",
  rows: [],
  selectedRowId: null,
  dirty: false,
  saving: false
};
let bulkEntryRowCounter = 0;
const bulkEntryZoomSteps = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];
let bulkEntryLayoutLoaded = false;
const paymentInstructionMethodLabels = {
  E_TRANSFER: "Interac e-Transfer",
  EFT: "Direct deposit / EFT",
  CHEQUE: "Cheque",
  PAY_ONLINE: "Pay online",
  CASH: "Cash",
  OTHER: "Other"
};
const bulkEntryHeaderAliases = {
  invoice: {
    customerId: ["customer", "client", "customerid", "customer_number", "client_name"],
    issueDate: ["date", "issue_date", "invoice_date", "invoicedate"],
    productItemId: ["product", "item", "sku", "product_id", "item_id"],
    description: ["description", "memo", "details", "service"],
    quantity: ["quantity", "qty", "units", "hours"],
    unitPriceMinor: ["unit_price", "unit_price_minor", "rate", "price", "amount"],
    discountMinor: ["discount", "discount_amount", "discount_minor"],
    currency: ["currency", "currency_code"]
  },
  bill: {
    vendorId: ["vendor", "supplier", "vendor_id", "supplier_name"],
    vendorInvoiceNumber: [
      "vendor_invoice",
      "vendor_invoice_number",
      "bill_number",
      "invoice_number"
    ],
    issueDate: ["date", "issue_date", "bill_date", "invoice_date"],
    description: ["description", "memo", "details", "expense"],
    quantity: ["quantity", "qty", "units"],
    unitCostMinor: ["unit_cost", "unit_cost_minor", "rate", "cost", "amount"],
    accountId: ["account", "account_id", "expense_account", "expense_account_id"],
    currency: ["currency", "currency_code"]
  }
};

registerWorkspaceCalls({
  clampBulkEntryWindowToViewport,
  documentLineEditor,
  documentLinePriceForProduct,
  documentLineState,
  invoicePriceForProduct,
  loadSales,
  openBulkEntryWindow,
  previewInvoice,
  renderDocumentLineEditor,
  renderInvoiceLineEditor,
  renderInvoicePaymentMethodOptions,
  renderSalesSelects,
  syncDocumentLineStateFromDom,
  syncInvoiceLineStateFromDom
});

export function initSales() {
  elements["refresh-sales"].addEventListener("click", loadSales);
  elements["credit-note-form"].addEventListener("submit", createAndPostCreditNote);
  elements["credit-note-form"].elements.fullCredit.addEventListener("change", (event) => {
    elements["credit-note-line-selection"].hidden = event.currentTarget.checked;
  });
  elements["void-invoice-form"].addEventListener("submit", voidInvoice);
  elements["invoice-detail-attachment-form"]?.addEventListener(
    "submit",
    uploadInvoiceDetailAttachment
  );
  elements["invoice-detail-preview"]?.addEventListener("click", () => {
    if (!invoiceDetailSource) return;
    elements["invoice-detail-dialog"].close();
    void previewInvoice(invoiceDetailSource);
  });
  elements["invoice-send-form"]?.addEventListener("submit", submitInvoiceSend);
  elements["invoice-send-prepare"]?.addEventListener("click", prepareManualInvoiceEmail);
  elements["invoice-send-mark-manual"]?.addEventListener("click", markInvoiceManualDelivery);
  elements["refresh-receivables-follow-up"]?.addEventListener("click", loadReceivablesFollowUp);
  elements["review-bulk-reminders"]?.addEventListener("click", reviewBulkReminders);
  elements["reminder-settings-form"]?.addEventListener("submit", saveReminderSettings);
  elements["customer-form"].addEventListener("submit", createCustomer);
  elements["cancel-customer-edit"].addEventListener("click", resetCustomerForm);
  elements["product-form"].addEventListener("submit", createProduct);
  elements["invoice-form"].addEventListener("submit", createInvoice);
  elements["invoice-line-editor"]?.addEventListener("click", handleInvoiceLineEditorClick);
  elements["invoice-line-editor"]?.addEventListener("input", handleInvoiceLineEditorInput);
  elements["invoice-line-editor"]?.addEventListener("change", handleInvoiceLineEditorInput);
  elements["invoice-line-editor"]?.addEventListener("keydown", handleInvoiceLineEditorKeydown);
  elements["invoice-line-editor"]?.addEventListener("dragstart", handleDocumentLineDragStart);
  elements["invoice-line-editor"]?.addEventListener("dragover", handleDocumentLineDragOver);
  elements["invoice-line-editor"]?.addEventListener("drop", handleDocumentLineDrop);
  elements["invoice-add-line"]?.addEventListener("click", addInvoiceLine);
  elements["estimate-line-editor"]?.addEventListener("click", handleDocumentLineEditorClick);
  elements["estimate-line-editor"]?.addEventListener("input", handleDocumentLineEditorInput);
  elements["estimate-line-editor"]?.addEventListener("change", handleDocumentLineEditorInput);
  elements["estimate-line-editor"]?.addEventListener("keydown", handleDocumentLineEditorKeydown);
  elements["estimate-line-editor"]?.addEventListener("dragstart", handleDocumentLineDragStart);
  elements["estimate-line-editor"]?.addEventListener("dragover", handleDocumentLineDragOver);
  elements["estimate-line-editor"]?.addEventListener("drop", handleDocumentLineDrop);
  elements["estimate-add-line"]?.addEventListener("click", () => addDocumentLine("estimate"));
  elements["bill-line-editor"]?.addEventListener("click", handleDocumentLineEditorClick);
  elements["bill-line-editor"]?.addEventListener("input", handleDocumentLineEditorInput);
  elements["bill-line-editor"]?.addEventListener("change", handleDocumentLineEditorInput);
  elements["bill-line-editor"]?.addEventListener("keydown", handleDocumentLineEditorKeydown);
  elements["bill-line-editor"]?.addEventListener("dragstart", handleDocumentLineDragStart);
  elements["bill-line-editor"]?.addEventListener("dragover", handleDocumentLineDragOver);
  elements["bill-line-editor"]?.addEventListener("drop", handleDocumentLineDrop);
  elements["bill-add-line"]?.addEventListener("click", () => addDocumentLine("bill"));
  elements["invoice-copy-new-draft"]?.addEventListener("click", copyInvoiceToNewDraft);
  for (const legacyField of ["productItemId", "quantity", "unitPriceMinor", "discountMinor"]) {
    elements["invoice-form"].elements[legacyField]?.addEventListener(
      "input",
      syncLegacyInvoiceField
    );
    elements["invoice-form"].elements[legacyField]?.addEventListener(
      "change",
      syncLegacyInvoiceField
    );
  }
  elements["invoice-clear-browser-draft"].addEventListener("click", () =>
    clearBrowserFormDraft("invoice-form")
  );
  elements["bulk-entry-add-row"]?.addEventListener("click", () => addBulkEntryRow());
  elements["bulk-entry-duplicate-row"]?.addEventListener("click", duplicateBulkEntryRow);
  elements["bulk-entry-delete-row"]?.addEventListener("click", deleteBulkEntryRow);
  elements["bulk-entry-clear"]?.addEventListener("click", clearBulkEntryDrafts);
  elements["bulk-entry-save"]?.addEventListener("click", () => void saveBulkEntry(false));
  elements["bulk-entry-save-close"]?.addEventListener("click", () => void saveBulkEntry(true));
  elements["bulk-entry-grid"]?.addEventListener("paste", handleBulkEntryPaste);
  elements["bulk-entry-grid"]?.addEventListener("input", handleBulkEntryInput);
  elements["bulk-entry-grid"]?.addEventListener("change", handleBulkEntryInput);
  elements["bulk-entry-grid"]?.addEventListener("focusin", handleBulkEntryFocus);
  document
    .querySelectorAll("[data-bulk-entry-type]")
    .forEach((button) =>
      button.addEventListener("click", () => setBulkEntryType(button.dataset.bulkEntryType))
    );
  document
    .querySelectorAll("[data-window-action]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        handleBulkEntryWindowAction(button.dataset.windowAction)
      )
    );
  initializeBulkEntryWindowManager();
  for (const field of ["currency", "issueDate", "customerId"])
    elements["invoice-form"].elements[field].addEventListener(
      "change",
      renderInvoiceCurrencyControls
    );
  elements["invoice-form"].elements.currency.addEventListener("change", () => {
    void handleContextualCurrencyChoice(elements["invoice-form"].elements.currency, "invoice");
  });
  elements["invoice-form"].elements.currency.addEventListener("change", renderInvoiceInlineRate);
  elements["invoice-form"].elements.issueDate.addEventListener("change", renderInvoiceInlineRate);
  elements["invoice-form"].elements.currency.addEventListener("change", () => {
    syncInvoiceLineStateFromDom();
    if (invoiceCurrency() !== invoiceBaseCurrency()) {
      for (const line of invoiceLineState) {
        if (line.productItemId) line.unitPriceMinor = "";
      }
    }
    renderInvoiceLineEditor();
  });
  elements["invoice-suggest-rate"]?.addEventListener("click", () => void suggestInvoiceRate());
  elements["invoice-use-suggested-rate"]?.addEventListener(
    "click",
    () => void useSuggestedInvoiceRate()
  );
  elements["customer-form"].elements.defaultCurrency.addEventListener("change", () => {
    void handleContextualCurrencyChoice(
      elements["customer-form"].elements.defaultCurrency,
      "customer"
    );
  });
  elements["invoice-form"].elements.issueDate.addEventListener("change", syncInvoiceDueDate);
  elements["invoice-form"].elements.paymentTermsDays.addEventListener("input", syncInvoiceDueDate);
  elements["invoice-form"].elements.dueDate.addEventListener("input", () => {
    invoiceDueDateTouched = true;
    scheduleInvoiceDraftAutosave();
  });
  elements.invoices.addEventListener("click", handleInvoiceTableAction);
  elements["estimate-form"].addEventListener("submit", createEstimate);
  elements["refresh-estimates"].addEventListener("click", loadSales);
  elements["customer-deposit-form"].addEventListener("submit", createCustomerDepositRequest);
  elements["customer-deposit-form"].elements.customerId.addEventListener(
    "change",
    renderDepositRelatedSelects
  );
  elements["progress-billing-form"].addEventListener("submit", createProgressBillingPlan);
  elements["progress-billing-form"].elements.estimateId.addEventListener(
    "change",
    renderProgressProjectSelect
  );
  elements["refresh-recurring-schedules"].addEventListener("click", loadRecurringSchedules);
  elements["recurring-schedule-form"].addEventListener("submit", createRecurringSchedule);
  elements["recurring-use-invoice-composer"]?.addEventListener(
    "click",
    useInvoiceComposerForRecurringTemplate
  );
  elements["invoice-template-form"].addEventListener("submit", saveInvoiceTemplate);
  elements["invoice-template-form"].elements.templateKey.addEventListener(
    "change",
    selectInvoiceTemplate
  );
  elements["print-invoice-preview"].addEventListener("click", printInvoicePreview);
  elements["invoice-form"].addEventListener("input", () => {
    elements["invoice-save-status"].textContent = "Unsaved changes";
    elements["invoice-preview"].textContent =
      "Create the draft to calculate taxes and render the exact customer document.";
    scheduleInvoiceDraftAutosave();
  });
}

export function industryPresetIsReady() {
  return ["COMPLETED", "SKIPPED"].includes(
    setup?.steps?.find((step) => step.step === "INDUSTRY_PRESET")?.status
  );
}

export async function loadSales() {
  // A fresh company can work with contacts and items before it adopts a chart,
  // but the receivables control-account reconciliation is not meaningful yet.
  // Do not emit a predictable 422 just because a user opens Sales early.
  const accountsReady = industryPresetIsReady();
  const [
    customersResponse,
    productsResponse,
    invoicesResponse,
    estimatesResponse,
    reconciliationResponse,
    recurringSchedulesResponse,
    projectsResponse,
    depositRequestsResponse,
    progressBillingResponse
  ] = await Promise.all([
    api("/v1/customers"),
    api("/v1/products"),
    api("/v1/invoices"),
    api("/v1/estimates"),
    accountsReady ? api("/v1/receivables/reconciliation") : Promise.resolve(null),
    api("/v1/recurring-schedules"),
    api("/v1/projects"),
    workflowPreferencesState?.workflowPreferences.customerDepositsEnabled
      ? api("/v1/customer-deposit-requests")
      : Promise.resolve(null),
    workflowPreferencesState?.workflowPreferences.progressBillingEnabled
      ? api("/v1/progress-billing-plans")
      : Promise.resolve(null)
  ]);
  if (![customersResponse, productsResponse, invoicesResponse].every((response) => response.ok)) {
    return;
  }
  setCustomers((await customersResponse.json()).customers);
  setProducts((await productsResponse.json()).products);
  setInvoices((await invoicesResponse.json()).invoices);
  setEstimates(estimatesResponse.ok ? (await estimatesResponse.json()).estimates : []);
  if (projectsResponse.ok) setProjects((await projectsResponse.json()).projects);
  customerDepositRequests = depositRequestsResponse?.ok
    ? (await depositRequestsResponse.json()).depositRequests
    : [];
  progressBillingPlans = progressBillingResponse?.ok
    ? (await progressBillingResponse.json()).progressBillingPlans
    : [];
  renderSalesSelects(customers, products);
  renderEstimateSelects(customers, products);
  renderDepositAndProgressSelects();
  await loadInvoiceTemplates();
  elements.customers.replaceChildren(...customers.map(renderCustomerRow));
  elements.products.replaceChildren(
    ...products.map((item) =>
      row([item.sku ?? "", item.name, moneyCell(item.salesPriceMinor, invoiceBaseCurrency())])
    )
  );
  elements.invoices.replaceChildren(...invoices.map(renderInvoiceRow));
  elements.estimates.replaceChildren(...estimates.map(renderEstimateRow));
  renderCustomerDepositRequests();
  renderProgressBillingPlans();
  if (recurringSchedulesResponse.ok) {
    recurringSchedules = (await recurringSchedulesResponse.json()).schedules;
    renderRecurringScheduleSelect();
    renderRecurringSchedules();
  }
  if (reconciliationResponse?.ok) {
    const reconciliation = (await reconciliationResponse.json()).reconciliation;
    elements["receivables-summary"].textContent =
      `Open receivables: ${formatMinor(reconciliation.subledgerBalanceMinor)}; reconciled: ${reconciliation.isReconciled ? "yes" : "no"}.`;
  } else if (!accountsReady) {
    elements["receivables-summary"].textContent =
      "Receivables reconciliation will be available after you choose your starting accounts.";
  }
  void loadReceivablesFollowUp();
  void loadReminderSettings();
  renderProjectWorkItemSelects();
  applySavedTableFilters();
  initializeBrowserFormDrafts();
  void loadCustomerRelationship();
  refreshContextualSearches();
}

async function loadReceivablesFollowUp() {
  const target = elements["receivables-follow-up-rows"];
  if (!target) return;
  const response = await api("/v1/receivables/follow-up", {}, true);
  if (!response.ok) {
    target.replaceChildren(
      row(["Overdue follow-up is unavailable for this role.", "", "", "", "", ""])
    );
    return;
  }
  const invoices = (await response.json()).invoices ?? [];
  latestFollowUpInvoices = invoices;
  target.replaceChildren();
  for (const item of invoices) {
    const action = item.canRemind
      ? commandButton("Send reminder", () =>
          openInvoiceSendDialog(
            {
              id: item.invoiceId,
              invoiceNumber: item.invoiceNumber,
              provisionalIdentifier: item.invoiceNumber,
              customerId: item.customerId,
              customerNameSnapshot: item.customerName,
              customerEmailSnapshot: item.recipientEmail,
              currency: item.currency,
              dueDate: item.dueDate,
              outstandingBalanceMinor: item.outstandingMinor,
              grandTotalMinor: item.outstandingMinor
            },
            runtimeCapabilities.emailDelivery ? "reminder" : "reminder-manual"
          )
        )
      : rowText(item.reminderDisabled ? "Suppressed" : "No recipient");
    target.append(
      row([
        item.invoiceNumber,
        item.customerName,
        `${item.ageDays} days (${item.bucket})`,
        formatMinor(item.outstandingMinor, item.currency),
        item.recipientEmail ?? "Missing",
        action
      ])
    );
  }
  if (!invoices.length) target.append(row(["No overdue invoices", "", "", "", "", ""]));
}

async function loadReminderSettings() {
  const form = elements["reminder-settings-form"];
  if (!form) return;
  const response = await api("/v1/reminder-settings", {}, true);
  if (!response.ok) return;
  const settings = (await response.json()).reminderSettings;
  reminderSettingsVersion = settings.version;
  form.elements.enabled.checked = Boolean(settings.enabled);
  form.elements.tone.value = settings.tone === "FIRM" ? "FIRM" : "FRIENDLY";
  form.elements.offsets.value = settings.offsets.join(",");
  form.elements.quietStartHour.value = String(settings.quietStartHour);
  form.elements.quietEndHour.value = String(settings.quietEndHour);
}

async function saveReminderSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const offsets = String(form.elements.offsets.value ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));
  if (!reminderSettingsVersion)
    return showNotice("Reminder settings are not available for this role.", true);
  const response = await api(
    "/v1/reminder-settings",
    jsonRequest(
      {
        version: reminderSettingsVersion,
        enabled: form.elements.enabled.checked,
        tone: form.elements.tone.value,
        offsets,
        quietStartHour: Number(form.elements.quietStartHour.value),
        quietEndHour: Number(form.elements.quietEndHour.value)
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  const settings = (await response.json()).reminderSettings;
  reminderSettingsVersion = settings.version;
  elements["reminder-settings-status"].textContent = "Reminder settings saved.";
  showNotice(
    "Reminder settings saved. Automated email reminders remain disabled until you enable them here."
  );
}

async function reviewBulkReminders() {
  const eligible = latestFollowUpInvoices.filter((invoice) => invoice.canRemind);
  if (!eligible.length) return showNotice("There are no eligible overdue reminders to review.");
  const summary = eligible
    .map(
      (invoice) =>
        `${invoice.invoiceNumber} · ${invoice.customerName} · ${invoice.recipientEmail ?? "no email"} · ${formatMinor(invoice.outstandingMinor, invoice.currency)}`
    )
    .join("\n");
  if (
    !window.confirm(`Review these reminder recipients and balances before sending:\n\n${summary}`)
  )
    return;
  if (!runtimeCapabilities.emailDelivery)
    return showNotice(
      "The batch was reviewed. Email delivery is disabled, so send each reminder from your own email app to keep delivery truthful."
    );
  let queued = 0;
  for (const invoice of eligible) {
    const response = await api(
      `/v1/invoices/${invoice.invoiceId}/reminder`,
      jsonRequest({ recipientEmail: invoice.recipientEmail })
    );
    if (response.ok) queued++;
  }
  await loadReceivablesFollowUp();
  showNotice(`${queued} reminder${queued === 1 ? "" : "s"} queued after review.`);
}

function renderRecurringScheduleSelect() {
  const select = elements["recurring-schedule-form"].elements.customerId;
  select.replaceChildren(
    ...customers
      .filter((item) => item.active)
      .map((item) => option(item.id, `${item.customerNumber} | ${item.displayName}`))
  );
}

function renderRecurringSchedules() {
  elements["recurring-schedules"].replaceChildren(
    ...recurringSchedules.map((schedule) => {
      const customer = customers.find((item) => item.id === schedule.customerId);
      const cadence = `${schedule.interval} ${schedule.frequency.toLowerCase()}${schedule.interval === 1 ? "" : "s"}`;
      const action =
        schedule.status === "ACTIVE" ? "pause" : schedule.status === "PAUSED" ? "resume" : null;
      const history = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `${schedule.history?.length ?? 0} occurrence${schedule.history?.length === 1 ? "" : "s"}`;
      history.append(summary);
      const historyList = document.createElement("ul");
      for (const occurrence of schedule.history ?? []) {
        const item = document.createElement("li");
        item.textContent = `${new Date(occurrence.occurrenceAt).toLocaleDateString()} · ${occurrence.status}${occurrence.outcome ? ` · ${occurrence.outcome}` : ""}${occurrence.blockingReason ? ` · ${occurrence.blockingReason}` : ""}`;
        historyList.append(item);
      }
      history.append(historyList);
      const actions = document.createElement("div");
      actions.append(commandButton("Edit", () => editRecurringSchedule(schedule)));
      if (action)
        actions.append(
          commandButton(action === "pause" ? "Pause" : "Resume", () =>
            setRecurringScheduleStatus(schedule, action)
          )
        );
      actions.append(commandButton("Run due now", runRecurringInvoices));
      return row([
        customer?.displayName ?? "Any customer",
        cadence,
        `${new Date(schedule.nextRunAt).toLocaleString()}${schedule.invoiceMode ? ` · ${schedule.invoiceMode}` : ""}`,
        schedule.status,
        history,
        actions
      ]);
    })
  );
}

async function loadRecurringSchedules() {
  const response = await api("/v1/recurring-schedules");
  if (!response.ok) return showError(response);
  recurringSchedules = (await response.json()).schedules;
  renderRecurringScheduleSelect();
  renderRecurringSchedules();
}

async function createRecurringSchedule(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  let template;
  try {
    template = JSON.parse(String(data.get("template") || "{}"));
  } catch {
    return showNotice("Invoice template must be valid JSON.", true);
  }
  const editId = form.dataset.editId || "";
  const payload = {
    scheduleType: "INVOICE",
    customerId: data.get("customerId") || null,
    frequency: data.get("frequency"),
    interval: Number(data.get("interval")),
    dayOfMonth: data.get("dayOfMonth") ? Number(data.get("dayOfMonth")) : null,
    missedOccurrencePolicy: data.get("missedOccurrencePolicy"),
    invoiceMode: data.get("invoiceMode"),
    timeZone: setup?.settings?.timeZone || "America/Edmonton",
    startAt: toIsoDateTime(data.get("startAt")),
    endAt: toIsoDateTime(data.get("endAt")),
    template
  };
  if (editId) payload.version = Number(form.dataset.editVersion);
  const response = await api(
    editId ? `/v1/recurring-schedules/${editId}` : "/v1/recurring-schedules",
    jsonRequest(payload, editId ? "PATCH" : "POST")
  );
  if (!response.ok) return showError(response);
  form.reset();
  delete form.dataset.editId;
  delete form.dataset.editVersion;
  form.querySelector('button[type="submit"]').textContent = "Create recurring schedule";
  await loadRecurringSchedules();
  showNotice(
    editId
      ? "Recurring invoice plan updated."
      : "Recurring invoice plan saved. Due occurrences will be created while PennyWise is open."
  );
}

function editRecurringSchedule(schedule) {
  const form = elements["recurring-schedule-form"];
  form.dataset.editId = schedule.id;
  form.dataset.editVersion = String(schedule.version);
  form.elements.customerId.value = schedule.customerId ?? "";
  form.elements.frequency.value = schedule.frequency;
  form.elements.interval.value = String(schedule.interval);
  form.elements.dayOfMonth.value = schedule.dayOfMonth ? String(schedule.dayOfMonth) : "";
  form.elements.startAt.value = toLocalDateTimeInput(schedule.startAt);
  form.elements.endAt.value = toLocalDateTimeInput(schedule.endAt);
  form.elements.missedOccurrencePolicy.value = schedule.missedOccurrencePolicy ?? "EVERY";
  form.elements.invoiceMode.value = schedule.invoiceMode ?? "DRAFT";
  form.elements.template.value = JSON.stringify(schedule.template ?? {}, null, 2);
  form.querySelector('button[type="submit"]').textContent = "Save recurring schedule";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function useInvoiceComposerForRecurringTemplate() {
  const invoiceForm = elements["invoice-form"];
  const recurringForm = elements["recurring-schedule-form"];
  if (!invoiceForm || !recurringForm) return;
  syncInvoiceLineStateFromDom();
  const customerId = invoiceForm.elements.customerId?.value;
  if (customerId) recurringForm.elements.customerId.value = customerId;
  const lines = invoiceLineState.map((line) => ({
    ...(line.productItemId ? { productItemId: line.productItemId } : {}),
    ...(line.description ? { description: line.description } : {}),
    quantity: line.quantity || "1",
    ...(line.unitPriceMinor ? { unitPriceMinor: line.unitPriceMinor } : {}),
    discountMinor: line.discountMinor || "0",
    ...(line.taxCodeId ? { taxCodeId: line.taxCodeId } : {})
  }));
  recurringForm.elements.template.value = JSON.stringify(
    {
      currency: invoiceForm.elements.currency?.value || "CAD",
      ...(invoiceForm.elements.paymentTermsDays?.value
        ? { paymentTermsDays: Number(invoiceForm.elements.paymentTermsDays.value) }
        : {}),
      ...(invoiceForm.elements.customerFacingNotes?.value
        ? { customerFacingNotes: invoiceForm.elements.customerFacingNotes.value }
        : {}),
      ...(invoiceForm.elements.internalNotes?.value
        ? { internalNotes: invoiceForm.elements.internalNotes.value }
        : {}),
      ...(invoiceForm.elements.terms?.value ? { terms: invoiceForm.elements.terms.value } : {}),
      lines
    },
    null,
    2
  );
  showNotice(
    "The current invoice composer lines and terms are now the recurring template. Review before saving."
  );
}

async function runRecurringInvoices() {
  const response = await api(
    "/v1/organizations/current/automations/recurring-invoice-generation/run",
    jsonRequest({}, "POST")
  );
  if (!response.ok) return showError(response);
  const result = await response.json();
  await loadRecurringSchedules();
  showNotice(
    result.status === "unavailable"
      ? `Recurring invoice generation is unavailable: ${result.reason}`
      : "Recurring invoice automation ran. Review the schedule history for drafts or blockers."
  );
}

async function setRecurringScheduleStatus(schedule, action) {
  const response = await api(
    `/v1/recurring-schedules/${schedule.id}/${action}`,
    jsonRequest({ version: schedule.version }, "POST")
  );
  if (!response.ok) return showError(response);
  await loadRecurringSchedules();
  showNotice(`Recurring schedule ${action === "pause" ? "paused" : "resumed"}.`);
}

async function loadInvoiceTemplates() {
  const response = await api("/v1/invoice-templates");
  if (!response.ok) return;
  const result = await response.json();
  invoiceTemplateState = result;
  const select = elements["invoice-template-form"].elements.templateKey;
  select.replaceChildren(
    ...result.templates.map((template) => option(template.key, template.name))
  );
  const selected = result.selected ?? result.templates[0];
  if (!selected) return;
  select.value = selected.key;
  const selectedDefinition =
    result.templates.find((template) => template.key === selected.key) ?? result.templates[0];
  fillInvoiceTemplateForm({
    ...selectedDefinition.defaultConfiguration,
    ...(selected.configuration ?? {})
  });
  renderInvoiceTemplateSummary(selected.key);
  renderInvoiceTemplateQuickPicks(selected.key);
  invoiceTemplateState.selected = result.selected;
}

function fillInvoiceTemplateForm(configuration) {
  const form = elements["invoice-template-form"];
  for (const name of [
    "primaryColor",
    "accentColor",
    "pageSize",
    "headerAlignment",
    "fontPairing",
    "headingFontSize",
    "bodyFontSize",
    "tableFontSize",
    "notesFontSize",
    "backgroundTreatment",
    "headerImageAssetId",
    "spacing",
    "detailStyle",
    "customerNotes",
    "terms",
    "paymentInstructions",
    "footer",
    "signatureBlock"
  ])
    if (configuration[name] !== undefined && form.elements[name])
      form.elements[name].value = configuration[name] ?? "";
}

function selectInvoiceTemplate(event) {
  const template = invoiceTemplateState?.templates?.find(
    (candidate) => candidate.key === event.currentTarget.value
  );
  if (template) {
    fillInvoiceTemplateForm(template.defaultConfiguration);
    renderInvoiceTemplateSummary(template.key);
    renderInvoiceTemplateQuickPicks(template.key);
  }
}

function renderInvoiceTemplateSummary(templateKey) {
  const template = invoiceTemplateState?.templates?.find(
    (candidate) => candidate.key === templateKey
  );
  elements["invoice-template-summary"].textContent = template
    ? `${template.name} - ${template.description}. ${template.defaultConfiguration.pageSize === "A4" ? "A4" : "Letter"} paper, ${template.defaultConfiguration.spacing} spacing, ${template.defaultConfiguration.fontPairing} type.`
    : "Choose a layout to see its design intent.";
}

function renderInvoiceTemplateQuickPicks(selectedKey) {
  const target = elements["invoice-template-quick-picks"];
  const select = elements["invoice-template-form"]?.elements.templateKey;
  if (!target || !select || !invoiceTemplateState?.templates) return;
  const preferredKeys = ["clean-professional", "creative", "contractor"];
  const templates = preferredKeys
    .map((key) => invoiceTemplateState.templates.find((template) => template.key === key))
    .filter(Boolean);
  target.replaceChildren(
    ...templates.map((template) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "invoice-template-quick-pick";
      button.dataset.selected = String(template.key === selectedKey);
      button.innerHTML =
        '<span class="invoice-template-swatch" aria-hidden="true"></span><span class="invoice-template-pick-copy"><strong></strong><small></small></span>';
      button
        .querySelector(".invoice-template-swatch")
        .style.setProperty("--template-primary", template.defaultConfiguration.primaryColor);
      button
        .querySelector(".invoice-template-swatch")
        .style.setProperty("--template-accent", template.defaultConfiguration.accentColor);
      button.querySelector("strong").textContent = template.name;
      button.querySelector("small").textContent = template.description;
      button.addEventListener("click", () => {
        select.value = template.key;
        fillInvoiceTemplateForm(template.defaultConfiguration);
        renderInvoiceTemplateSummary(template.key);
        renderInvoiceTemplateQuickPicks(template.key);
      });
      return button;
    })
  );
}

async function saveInvoiceTemplate(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const templateKey = data.get("templateKey");
  const selectedTemplate = invoiceTemplateState?.templates?.find(
    (template) => template.key === templateKey
  );
  const base =
    invoiceTemplateState?.selected?.key === templateKey
      ? invoiceTemplateState.selected.configuration
      : (selectedTemplate?.defaultConfiguration ?? {});
  const response = await api(
    "/v1/organizations/current/invoice-template",
    jsonRequest(
      {
        templateKey,
        version: invoiceTemplateState?.selected?.recordVersion,
        configuration: {
          ...base,
          primaryColor: data.get("primaryColor"),
          accentColor: data.get("accentColor"),
          pageSize: data.get("pageSize"),
          headerAlignment: data.get("headerAlignment"),
          fontPairing: data.get("fontPairing"),
          headingFontSize: Number(data.get("headingFontSize")),
          bodyFontSize: Number(data.get("bodyFontSize")),
          tableFontSize: Number(data.get("tableFontSize")),
          notesFontSize: Number(data.get("notesFontSize")),
          backgroundTreatment: data.get("backgroundTreatment"),
          headerImageAssetId: data.get("headerImageAssetId") || null,
          spacing: data.get("spacing"),
          detailStyle: data.get("detailStyle"),
          customerNotes: data.get("customerNotes") || null,
          terms: data.get("terms") || null,
          paymentInstructions: data.get("paymentInstructions") || null,
          footer: data.get("footer") || null,
          signatureBlock: data.get("signatureBlock") || null
        }
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  const result = (await response.json()).template;
  invoiceTemplateState.selected = result;
  if (activePreviewInvoice) await previewInvoice(activePreviewInvoice);
  showNotice("Invoice template saved.");
}

function invoiceLineProductLabel(productId) {
  const product = products.find((item) => item.id === productId);
  return product ? `${product.name} | ${invoiceProductPriceLabel(product)}` : "";
}

function invoiceBaseCurrency() {
  return multiCurrencyState?.baseCurrency ?? setup?.settings?.baseCurrency ?? "CAD";
}

function invoiceCurrency() {
  return elements["invoice-form"]?.elements.currency?.value || invoiceBaseCurrency();
}

function invoiceProductPriceLabel(product) {
  const basePrice = formatMinor(product.salesPriceMinor, invoiceBaseCurrency());
  return invoiceCurrency() === invoiceBaseCurrency()
    ? basePrice
    : `base ${invoiceBaseCurrency()} ${basePrice}`;
}

function invoicePriceForProduct(product) {
  return invoiceCurrency() === invoiceBaseCurrency() ? minorToInput(product.salesPriceMinor) : "";
}

function invoiceLineTaxOptions(selectedId) {
  return [
    option("", "No tax"),
    ...(setup?.taxCodes ?? []).map((taxCode) =>
      option(taxCode.id, `${taxCode.code} | ${taxCode.name}`)
    )
  ].map((taxOption) => {
    taxOption.selected = taxOption.value === selectedId;
    return taxOption;
  });
}

function renderInvoiceLineEditor() {
  const editor = elements["invoice-line-editor"];
  if (!editor) return;
  editor.replaceChildren();
  for (const [index, line] of invoiceLineState.entries()) {
    const selectedProduct = products.find((item) => item.id === line.productItemId);
    if (selectedProduct && !line.unitPriceMinor)
      line.unitPriceMinor = invoicePriceForProduct(selectedProduct);
    const row = document.createElement("div");
    row.className = "invoice-line-row";
    row.dataset.lineId = line.id;
    row.draggable = true;
    row.setAttribute("role", "row");
    const itemWrap = document.createElement("div");
    itemWrap.className = "invoice-line-cell invoice-line-item";
    const itemPicker = renderLineProductPicker(line, "invoice-form");
    itemWrap.append(itemPicker);

    const description = invoiceLineField("Description", "description", line.description, "text");
    const quantity = invoiceLineField("Qty", "quantity", line.quantity, "text");
    quantity.input.inputMode = "decimal";
    quantity.input.pattern = "\\d+(\\.\\d{1,6})?";
    const rate = invoiceLineField("Rate", "unitPriceMinor", line.unitPriceMinor, "text");
    rate.input.inputMode = "decimal";
    if (selectedProduct && invoiceCurrency() !== invoiceBaseCurrency()) {
      rate.input.placeholder = `Enter ${invoiceCurrency()} price`;
      rate.input.title = `Base price: ${formatMinor(selectedProduct.salesPriceMinor, invoiceBaseCurrency())}. Enter the ${invoiceCurrency()} price; no conversion was assumed.`;
    }
    const discount = invoiceLineField("Discount", "discountMinor", line.discountMinor, "text");
    discount.input.inputMode = "decimal";
    const taxWrap = document.createElement("label");
    taxWrap.className = "invoice-line-cell";
    taxWrap.textContent = "Tax code";
    const tax = document.createElement("select");
    tax.name = `line-${line.id}-taxCodeId`;
    tax.dataset.lineField = "taxCodeId";
    tax.replaceChildren(...invoiceLineTaxOptions(line.taxCodeId));
    taxWrap.append(tax);

    const amount = document.createElement("output");
    amount.className = "invoice-line-cell invoice-line-amount";
    amount.dataset.lineAmount = "true";
    amount.textContent = `Amount (${invoiceCurrency()}): ${formatInvoiceLineEstimate(line, invoiceCurrency())}`;
    amount.setAttribute("aria-label", "Estimated line amount");

    const actions = document.createElement("div");
    actions.className = "invoice-line-actions";
    const drag = document.createElement("span");
    drag.className = "document-line-drag-handle";
    drag.textContent = "↕ Drag";
    drag.title = "Drag to reorder this line";
    drag.setAttribute("aria-label", "Drag to reorder line");
    actions.append(drag);
    for (const [action, label] of [
      ["insert", "Insert below"],
      ["duplicate", "Duplicate"],
      ["up", "Move up"],
      ["down", "Move down"],
      ["delete", "Delete"],
      ["save-item", "Save as item"]
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-command";
      button.dataset.lineAction = action;
      button.textContent = label;
      button.disabled =
        action === "up"
          ? index === 0
          : action === "down"
            ? index === invoiceLineState.length - 1
            : false;
      if (action === "save-item") {
        button.dataset.contextualCreate = "product";
        button.dataset.contextualOriginForm = "invoice-form";
        button.dataset.contextualOriginWorkspace = "sales-workspace";
        button.dataset.contextualSelectionName = `productItemId-${line.id}`;
        button.dataset.contextualLineId = line.id;
        button.dataset.contextualDocumentKind = "invoice";
      }
      actions.append(button);
    }
    row.append(
      itemWrap,
      description.wrapper,
      quantity.wrapper,
      rate.wrapper,
      discount.wrapper,
      taxWrap,
      amount,
      actions
    );
    editor.append(row);
  }
  renderInvoiceEstimatedTotals();
}

function documentLineState(kind) {
  return kind === "estimate" ? estimateLineState : billLineState;
}

function documentLineEditor(kind) {
  return elements[`${kind}-line-editor`];
}

function documentLineCurrency(kind) {
  return elements[`${kind}-form`]?.elements.currency?.value ?? invoiceBaseCurrency();
}

function documentLineRateField(kind) {
  return kind === "estimate" ? "unitPriceMinor" : "unitCostMinor";
}

function documentLineProductLabel(product) {
  return product
    ? `${product.name} | ${formatMinor(product.salesPriceMinor, invoiceBaseCurrency())}`
    : "";
}

function documentLinePriceForProduct(product, kind) {
  return kind === "estimate" ? minorToInput(product.salesPriceMinor) : "";
}

function renderDocumentLineEditor(kind) {
  const editor = documentLineEditor(kind);
  if (!editor) return;
  const state = documentLineState(kind);
  if (!state.length) state.push(createInvoiceLine());
  editor.replaceChildren();
  const rateField = documentLineRateField(kind);
  for (const [index, line] of state.entries()) {
    const selectedProduct = products.find((item) => item.id === line.productItemId);
    if (selectedProduct && !line[rateField])
      line[rateField] = documentLinePriceForProduct(selectedProduct, kind);
    const row = document.createElement("div");
    row.className = "invoice-line-row document-line-row";
    row.dataset.lineId = line.id;
    row.dataset.documentKind = kind;
    row.draggable = true;
    row.setAttribute("role", "row");

    const itemWrap = document.createElement("div");
    itemWrap.className = "invoice-line-cell invoice-line-item";
    itemWrap.append(renderLineProductPicker(line, `${kind}-form`, kind));
    const description = invoiceLineField("Description", "description", line.description, "text");
    const quantity = invoiceLineField("Qty", "quantity", line.quantity, "text");
    quantity.input.inputMode = "decimal";
    const rate = invoiceLineField(
      kind === "estimate" ? "Rate" : "Unit cost",
      rateField,
      line[rateField],
      "text"
    );
    rate.input.inputMode = "decimal";
    const discount = invoiceLineField("Discount", "discountMinor", line.discountMinor, "text");
    discount.input.inputMode = "decimal";
    const taxWrap = document.createElement("label");
    taxWrap.className = "invoice-line-cell";
    taxWrap.textContent = "Tax code";
    const tax = document.createElement("select");
    tax.dataset.lineField = "taxCodeId";
    tax.name = `${kind}-line-${line.id}-taxCodeId`;
    tax.replaceChildren(...invoiceLineTaxOptions(line.taxCodeId));
    taxWrap.append(tax);

    let accountWrap = null;
    if (kind === "bill") {
      accountWrap = document.createElement("label");
      accountWrap.className = "invoice-line-cell document-line-account";
      accountWrap.textContent = "Expense or asset account";
      const account = document.createElement("select");
      account.dataset.lineField = "accountId";
      account.name = `bill-line-${line.id}-accountId`;
      const fallback = elements["bill-form"]?.elements.accountId?.value ?? "";
      account.replaceChildren(
        option("", "Choose account"),
        ...accounts
          .filter((item) => ["EXPENSE", "ASSET"].includes(item.type) && !item.isArchived)
          .map((item) => option(item.id, `${item.code} ${item.name}`))
      );
      account.value = line.accountId || fallback;
      accountWrap.append(account);
      line.accountId = account.value;
    }
    const amount = document.createElement("output");
    amount.className = "invoice-line-cell invoice-line-amount";
    amount.dataset.lineAmount = "true";
    amount.textContent = `Amount (${documentLineCurrency(kind)}): ${formatDocumentLineEstimate(line, kind)}`;
    amount.setAttribute("aria-label", "Estimated line amount");
    const actions = document.createElement("div");
    actions.className = "invoice-line-actions";
    const drag = document.createElement("span");
    drag.className = "document-line-drag-handle";
    drag.textContent = "↕ Drag";
    drag.title = "Drag to reorder this line";
    drag.setAttribute("aria-label", "Drag to reorder line");
    actions.append(drag);
    for (const [action, label] of [
      ["insert", "Insert below"],
      ["duplicate", "Duplicate"],
      ["up", "Move up"],
      ["down", "Move down"],
      ["delete", "Delete"],
      ["save-item", "Save as item"]
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-command";
      button.dataset.lineAction = action;
      button.textContent = label;
      button.disabled =
        action === "up" ? index === 0 : action === "down" ? index === state.length - 1 : false;
      if (action === "save-item") {
        button.dataset.contextualCreate = "product";
        button.dataset.contextualOriginForm = `${kind}-form`;
        button.dataset.contextualOriginWorkspace =
          kind === "bill" ? "purchases-workspace" : "sales-workspace";
        button.dataset.contextualSelectionName = `productItemId-${line.id}`;
        button.dataset.contextualLineId = line.id;
        button.dataset.contextualDocumentKind = kind;
      }
      actions.append(button);
    }
    row.append(
      itemWrap,
      description.wrapper,
      quantity.wrapper,
      rate.wrapper,
      discount.wrapper,
      taxWrap
    );
    if (accountWrap) row.append(accountWrap);
    row.append(amount, actions);
    editor.append(row);
  }
  renderDocumentEstimatedTotals(kind);
}

function syncDocumentLineStateFromDom(kind) {
  const state = documentLineState(kind);
  for (const row of documentLineEditor(kind)?.querySelectorAll(".document-line-row") ?? []) {
    const line = state.find((item) => item.id === row.dataset.lineId);
    if (!line) continue;
    for (const field of [
      "description",
      "quantity",
      documentLineRateField(kind),
      "discountMinor",
      "taxCodeId",
      "accountId"
    ]) {
      const input = row.querySelector(`[data-line-field="${field}"]`);
      if (input) line[field] = input.value;
    }
    const productId = row.querySelector('[data-line-field="productItemId"]');
    if (productId) line.productItemId = productId.value;
    const itemInput = row.querySelector('[data-line-field="item"]');
    const exact = products.find(
      (product) => documentLineProductLabel(product) === itemInput?.value
    );
    if (exact) {
      line.productItemId = exact.id;
      if (productId) productId.value = exact.id;
      if (!line[documentLineRateField(kind)] && kind === "estimate")
        line[documentLineRateField(kind)] = documentLinePriceForProduct(exact, kind);
    }
  }
}

function formatDocumentLineEstimate(line, kind) {
  try {
    const quantity = Number(line.quantity || 0);
    const rate = Number(parseMoneyInput(line[documentLineRateField(kind)] || "0"));
    const discount = Number(parseMoneyInput(line.discountMinor || "0"));
    return formatMinor(
      String(Math.max(0, Math.round(quantity * rate - discount))),
      documentLineCurrency(kind)
    );
  } catch {
    return "0.00";
  }
}

function renderDocumentEstimatedTotals(kind) {
  const state = documentLineState(kind);
  let subtotal = 0;
  let discount = 0;
  for (const line of state) {
    const quantity = Number(line.quantity || 0);
    try {
      subtotal += Number.isFinite(quantity)
        ? Math.max(0, quantity * Number(parseMoneyInput(line[documentLineRateField(kind)] || "0")))
        : 0;
      discount += Number(parseMoneyInput(line.discountMinor || "0"));
    } catch {
      // Keep a useful zero estimate while the user is editing an amount.
    }
  }
  const currency = documentLineCurrency(kind);
  const subtotalText = `Subtotal: ${formatMinor(String(Math.round(subtotal)), currency)}`;
  const discountText = `Discount: ${formatMinor(String(Math.round(discount)), currency)}`;
  const totalText = `Total: ${formatMinor(String(Math.max(0, Math.round(subtotal - discount))), currency)}`;
  elements[`${kind}-estimated-subtotal`].textContent = subtotalText;
  elements[`${kind}-estimated-discount`].textContent = discountText;
  elements[`${kind}-estimated-total`].textContent = totalText;
  for (const row of documentLineEditor(kind)?.querySelectorAll(".document-line-row") ?? []) {
    const line = state.find((item) => item.id === row.dataset.lineId);
    const output = row.querySelector("[data-line-amount]");
    if (line && output)
      output.textContent = `Amount (${currency}): ${formatDocumentLineEstimate(line, kind)}`;
  }
}

function documentKindFromEditor(editor) {
  if (editor?.id === "estimate-line-editor") return "estimate";
  if (editor?.id === "bill-line-editor") return "bill";
  if (editor?.id === "invoice-line-editor") return "invoice";
  return null;
}

function handleDocumentLineEditorClick(event) {
  const button = event.target.closest?.("[data-line-action]");
  const editor = event.currentTarget;
  const kind = documentKindFromEditor(editor);
  if (!button || !kind || kind === "invoice") return;
  const state = documentLineState(kind);
  syncDocumentLineStateFromDom(kind);
  const row = button.closest(".document-line-row");
  const index = state.findIndex((line) => line.id === row?.dataset.lineId);
  if (index < 0) return;
  const action = button.dataset.lineAction;
  if (action === "insert") state.splice(index + 1, 0, createInvoiceLine());
  if (action === "duplicate")
    state.splice(index + 1, 0, createInvoiceLine({ ...state[index], id: undefined }));
  if (action === "up" && index > 0)
    [state[index - 1], state[index]] = [state[index], state[index - 1]];
  if (action === "down" && index < state.length - 1)
    [state[index], state[index + 1]] = [state[index + 1], state[index]];
  if (action === "delete" && state.length > 1) {
    documentLineUndo[kind] = { line: state[index], index };
    state.splice(index, 1);
    const status = elements[`${kind}-line-status`];
    status.replaceChildren(document.createTextNode("Line deleted. "));
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "text-command";
    undo.textContent = "Undo";
    undo.addEventListener(
      "click",
      () => {
        const previous = documentLineUndo[kind];
        if (!previous) return;
        state.splice(previous.index, 0, previous.line);
        documentLineUndo[kind] = null;
        status.textContent = "Line restored.";
        renderDocumentLineEditor(kind);
      },
      { once: true }
    );
    status.append(undo);
  }
  if (action === "save-item") return;
  renderDocumentLineEditor(kind);
}

function handleDocumentLineEditorInput(event) {
  const kind = documentKindFromEditor(event.currentTarget);
  if (!kind) return;
  if (kind === "invoice") return handleInvoiceLineEditorInput(event);
  const row = event.target.closest?.(".document-line-row");
  const line = documentLineState(kind).find((item) => item.id === row?.dataset.lineId);
  const field = event.target.dataset.lineField;
  if (line && field && field !== "item" && field !== "productItemId")
    line[field] = event.target.value;
  syncDocumentLineStateFromDom(kind);
  renderDocumentEstimatedTotals(kind);
}

function handleDocumentLineEditorKeydown(event) {
  const kind = documentKindFromEditor(event.currentTarget);
  if (!kind) return;
  if (kind === "invoice") return handleInvoiceLineEditorKeydown(event);
  const row = event.target.closest?.(".document-line-row");
  const state = documentLineState(kind);
  const index = state.findIndex((line) => line.id === row?.dataset.lineId);
  if (index < 0) return;
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    const next = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (next >= 0 && next < state.length) {
      syncDocumentLineStateFromDom(kind);
      [state[index], state[next]] = [state[next], state[index]];
      renderDocumentLineEditor(kind);
      documentLineEditor(kind)
        .querySelector(
          `[data-line-id="${globalThis.CSS.escape(state[next].id)}"] [data-line-field="description"]`
        )
        ?.focus();
    }
    return;
  }
  if (
    event.key !== "Enter" ||
    event.target.tagName === "SELECT" ||
    event.target.dataset.pickerQuery
  )
    return;
  const rows = [...documentLineEditor(kind).querySelectorAll(".document-line-row")];
  if (rows.at(-1) !== row) return;
  event.preventDefault();
  syncDocumentLineStateFromDom(kind);
  state.push(createInvoiceLine());
  renderDocumentLineEditor(kind);
  documentLineEditor(kind)
    .querySelector('.document-line-row:last-child [data-line-field="item"]')
    ?.focus();
}

function addDocumentLine(kind) {
  syncDocumentLineStateFromDom(kind);
  documentLineState(kind).push(createInvoiceLine());
  renderDocumentLineEditor(kind);
  documentLineEditor(kind)
    .querySelector('.document-line-row:last-child [data-line-field="item"]')
    ?.focus();
}

function handleDocumentLineDragStart(event) {
  const row = event.target.closest?.(".invoice-line-row");
  const kind = documentKindFromEditor(event.currentTarget);
  if (!row || !kind) return;
  documentLineDragId = { kind, id: row.dataset.lineId };
  event.dataTransfer?.setData("text/plain", row.dataset.lineId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function handleDocumentLineDragOver(event) {
  if (documentLineDragId) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }
}

function handleDocumentLineDrop(event) {
  const row = event.target.closest?.(".invoice-line-row");
  const kind = documentKindFromEditor(event.currentTarget);
  if (!row || !kind || !documentLineDragId || documentLineDragId.kind !== kind) return;
  event.preventDefault();
  const state = documentLineState(kind);
  const from = state.findIndex((line) => line.id === documentLineDragId.id);
  const to = state.findIndex((line) => line.id === row.dataset.lineId);
  documentLineDragId = null;
  if (from < 0 || to < 0 || from === to) return;
  syncDocumentLineStateFromDom(kind);
  const [moved] = state.splice(from, 1);
  state.splice(to, 0, moved);
  renderDocumentLineEditor(kind);
}

function renderLineProductPicker(line, originForm, kind = "invoice") {
  const picker = document.createElement("span");
  picker.className = "creatable-picker line-item-picker";
  const input = document.createElement("input");
  input.type = "text";
  input.name = `line-${line.id}-item`;
  const labelForProduct = (product) =>
    product
      ? kind === "invoice"
        ? invoiceLineProductLabel(product.id)
        : documentLineProductLabel(product)
      : "";
  const priceForProduct = (product) =>
    kind === "invoice"
      ? invoicePriceForProduct(product)
      : documentLinePriceForProduct(product, kind);
  input.value = products.find((item) => item.id === line.productItemId)
    ? labelForProduct(products.find((item) => item.id === line.productItemId))
    : "";
  input.placeholder = "Description-only line or choose item";
  input.autocomplete = "off";
  input.role = "combobox";
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", "Item or service, optional");
  input.dataset.lineField = "item";
  input.dataset.pickerQuery = "true";
  const listbox = document.createElement("div");
  listbox.id = `${kind}-item-list-${line.id}`;
  listbox.className = "creatable-picker-listbox";
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;
  input.setAttribute("aria-controls", listbox.id);
  const create = document.createElement("button");
  create.type = "button";
  create.className = "creatable-picker-create contextual-add-action";
  create.textContent = "+ Create item";
  create.title = "Create a new product or service";
  create.setAttribute("aria-label", "+ Create item — create a new product or service");
  create.dataset.contextualCreate = "product";
  create.dataset.contextualOriginForm = originForm;
  create.dataset.contextualOriginWorkspace =
    kind === "bill" ? "purchases-workspace" : "sales-workspace";
  create.dataset.contextualSelectionName = `productItemId-${line.id}`;
  create.dataset.contextualLineId = line.id;
  create.dataset.contextualDocumentKind = kind;
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = `productItemId-${line.id}`;
  hidden.value = line.productItemId;
  hidden.dataset.lineField = "productItemId";
  picker.append(input, create, listbox, hidden);
  let activeIndex = -1;
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase();
    const options = products.filter((item) => item.active);
    const matches = options.filter((item) =>
      labelForProduct(item).toLocaleLowerCase().includes(query)
    );
    listbox.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "creatable-picker-empty";
      empty.textContent = options.length
        ? "No saved product or service matches this text."
        : "No saved products or services yet. Type a description, or use + to create one you can reuse.";
      empty.setAttribute("role", "status");
      listbox.append(empty);
    }
    matches.forEach((product, index) => {
      const optionElement = document.createElement("div");
      optionElement.className = "creatable-picker-option";
      optionElement.textContent = labelForProduct(product);
      optionElement.id = `${listbox.id}-option-${index}`;
      optionElement.setAttribute("role", "option");
      optionElement.addEventListener("mousedown", (event) => event.preventDefault());
      optionElement.addEventListener("click", () => {
        line.productItemId = product.id;
        line[kind === "bill" ? "unitCostMinor" : "unitPriceMinor"] = priceForProduct(product);
        hidden.value = product.id;
        input.value = optionElement.textContent;
        listbox.hidden = true;
        input.setAttribute("aria-expanded", "false");
        if (kind === "invoice") renderInvoiceLineEditor();
        else renderDocumentLineEditor(kind);
        documentLineEditor(kind === "invoice" ? "invoice" : kind)
          ?.querySelector(
            `[data-line-id="${globalThis.CSS.escape(line.id)}"] [data-line-field="quantity"]`
          )
          ?.focus();
      });
      listbox.append(optionElement);
    });
    if (query && !options.some((item) => item.name.trim().toLocaleLowerCase() === query)) {
      const optionElement = document.createElement("div");
      optionElement.className = "creatable-picker-option creatable-picker-create-option";
      optionElement.textContent = `+ Create '${input.value.trim()}'`;
      optionElement.setAttribute("role", "option");
      optionElement.addEventListener("mousedown", (event) => event.preventDefault());
      optionElement.addEventListener("click", () => {
        create.dataset.contextualTypedValue = input.value.trim();
        create.click();
      });
      listbox.append(optionElement);
    }
    activeIndex = -1;
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("focus", render);
  input.addEventListener("input", () => {
    line.productItemId = "";
    hidden.value = "";
    if (
      line.description === labelForProduct(products.find((item) => item.id === line.productItemId))
    )
      line.description = "";
    globalThis.setTimeout(render, 120);
  });
  input.addEventListener("blur", () =>
    globalThis.setTimeout(() => {
      if (!picker.contains(document.activeElement)) {
        listbox.hidden = true;
        input.setAttribute("aria-expanded", "false");
      }
    }, 120)
  );
  input.addEventListener("keydown", (event) => {
    const options = [...listbox.querySelectorAll('[role="option"]')];
    if (event.key === "Escape") {
      listbox.hidden = true;
      input.setAttribute("aria-expanded", "false");
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      activeIndex =
        (activeIndex + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
      options.forEach((item, index) => item.classList.toggle("is-active", index === activeIndex));
      input.setAttribute("aria-activedescendant", options[activeIndex].id);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      options[activeIndex].click();
    }
  });
  return picker;
}

function invoiceLineField(label, field, value, type = "text") {
  const wrapper = document.createElement("label");
  wrapper.className = "invoice-line-cell";
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";
  input.dataset.lineField = field;
  input.name = `line-${invoiceLineCounter}-${field}`;
  wrapper.append(input);
  return { wrapper, input };
}

function syncInvoiceLineStateFromDom() {
  for (const row of elements["invoice-line-editor"]?.querySelectorAll(".invoice-line-row") ?? []) {
    const line = invoiceLineState.find((item) => item.id === row.dataset.lineId);
    if (!line) continue;
    for (const field of [
      "description",
      "quantity",
      "unitPriceMinor",
      "discountMinor",
      "taxCodeId"
    ]) {
      const input = row.querySelector(`[data-line-field="${field}"]`);
      if (input) line[field] = input.value;
    }
    const itemInput = row.querySelector('[data-line-field="item"]');
    const productId = row.querySelector('[data-line-field="productItemId"]');
    if (productId?.value) line.productItemId = productId.value;
    const exact = products.find(
      (product) => `${product.name} | ${invoiceProductPriceLabel(product)}` === itemInput?.value
    );
    if (exact) {
      line.productItemId = exact.id;
      productId.value = exact.id;
      if (!line.unitPriceMinor) line.unitPriceMinor = invoicePriceForProduct(exact);
    } else if (!itemInput?.value.trim() && !productId?.value) {
      line.productItemId = "";
      if (productId) productId.value = "";
    }
  }
}

function formatInvoiceLineEstimate(line, currency = invoiceCurrency()) {
  try {
    const quantity = Number(line.quantity || 0);
    const unitPriceMinor = Number(parseMoneyInput(line.unitPriceMinor || "0"));
    const discount = Number(parseMoneyInput(line.discountMinor || "0"));
    return formatMinor(
      String(Math.max(0, Math.round(quantity * unitPriceMinor - discount))),
      currency
    );
  } catch {
    return "0.00";
  }
}

function renderInvoiceEstimatedTotals() {
  const currency = elements["invoice-form"]?.elements.currency?.value ?? "CAD";
  let subtotal = 0;
  let discount = 0;
  for (const line of invoiceLineState) {
    const quantity = Number(line.quantity || 0);
    let rate = 0;
    let lineDiscount = 0;
    try {
      rate = Number(parseMoneyInput(line.unitPriceMinor || "0"));
      lineDiscount = Number(parseMoneyInput(line.discountMinor || "0"));
    } catch {
      // The line input is still being edited; keep the estimate at zero until it is valid.
    }
    subtotal += Number.isFinite(quantity) ? Math.max(0, quantity * rate) : 0;
    discount += Number.isFinite(lineDiscount) ? lineDiscount : 0;
  }
  const roundedSubtotal = String(Math.round(subtotal));
  const roundedDiscount = String(Math.round(discount));
  const total = String(Math.max(0, Math.round(subtotal - discount)));
  elements["invoice-estimated-subtotal"].textContent =
    `Subtotal: ${formatMinor(roundedSubtotal, currency)}`;
  elements["invoice-estimated-discount"].textContent =
    `Discount: ${formatMinor(roundedDiscount, currency)}`;
  elements["invoice-estimated-tax"].textContent = "Tax: calculated when saved";
  elements["invoice-estimated-total"].textContent =
    `Estimated total: ${formatMinor(total, currency)}`;
  for (const row of elements["invoice-line-editor"]?.querySelectorAll(".invoice-line-row") ?? []) {
    const line = invoiceLineState.find((item) => item.id === row.dataset.lineId);
    const output = row.querySelector("[data-line-amount]");
    if (line)
      output.textContent = `Amount (${currency}): ${formatInvoiceLineEstimate(line, currency)}`;
  }
}

function handleInvoiceLineEditorClick(event) {
  const button = event.target.closest?.("[data-line-action]");
  if (!button) return;
  syncInvoiceLineStateFromDom();
  const row = button.closest(".invoice-line-row");
  const index = invoiceLineState.findIndex((line) => line.id === row?.dataset.lineId);
  if (index < 0) return;
  const action = button.dataset.lineAction;
  if (action === "duplicate")
    invoiceLineState.splice(
      index + 1,
      0,
      createInvoiceLine({ ...invoiceLineState[index], id: undefined })
    );
  if (action === "insert") invoiceLineState.splice(index + 1, 0, createInvoiceLine());
  if (action === "up" && index > 0)
    [invoiceLineState[index - 1], invoiceLineState[index]] = [
      invoiceLineState[index],
      invoiceLineState[index - 1]
    ];
  if (action === "down" && index < invoiceLineState.length - 1)
    [invoiceLineState[index], invoiceLineState[index + 1]] = [
      invoiceLineState[index + 1],
      invoiceLineState[index]
    ];
  if (action === "delete" && invoiceLineState.length > 1) {
    invoiceLineUndo = { line: invoiceLineState[index], index };
    invoiceLineState.splice(index, 1);
    const status = elements["invoice-line-status"];
    status.replaceChildren(document.createTextNode("Line deleted. "));
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "text-command";
    undo.textContent = "Undo";
    undo.addEventListener(
      "click",
      () => {
        if (!invoiceLineUndo) return;
        invoiceLineState.splice(invoiceLineUndo.index, 0, invoiceLineUndo.line);
        invoiceLineUndo = null;
        status.textContent = "Line restored.";
        renderInvoiceLineEditor();
      },
      { once: true }
    );
    status.append(undo);
  }
  if (action === "save-item") return;
  renderInvoiceLineEditor();
}

function handleInvoiceLineEditorInput(event) {
  const field = event?.target?.dataset?.lineField;
  const row = event?.target?.closest?.(".invoice-line-row");
  const line = invoiceLineState.find((item) => item.id === row?.dataset.lineId);
  if (line && field && field !== "item" && field !== "productItemId")
    line[field] = event.target.value;
  syncInvoiceLineStateFromDom();
  renderInvoiceEstimatedTotals();
}

function handleInvoiceLineEditorKeydown(event) {
  const row = event.target.closest(".invoice-line-row");
  if (!row) return;
  const index = invoiceLineState.findIndex((line) => line.id === row.dataset.lineId);
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && index >= 0) {
    event.preventDefault();
    const next = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (next >= 0 && next < invoiceLineState.length) {
      syncInvoiceLineStateFromDom();
      [invoiceLineState[index], invoiceLineState[next]] = [
        invoiceLineState[next],
        invoiceLineState[index]
      ];
      renderInvoiceLineEditor();
      elements["invoice-line-editor"]
        .querySelector(
          `[data-line-id="${globalThis.CSS.escape(invoiceLineState[next].id)}"] [data-line-field="description"]`
        )
        ?.focus();
    }
    return;
  }
  if (
    event.key !== "Enter" ||
    event.target.tagName === "SELECT" ||
    event.target.dataset.pickerQuery
  )
    return;
  const rows = [...elements["invoice-line-editor"].querySelectorAll(".invoice-line-row")];
  if (rows.at(-1) !== row) return;
  event.preventDefault();
  syncInvoiceLineStateFromDom();
  invoiceLineState.push(createInvoiceLine());
  renderInvoiceLineEditor();
  elements["invoice-line-editor"]
    .querySelector('.invoice-line-row:last-child [data-line-field="item"]')
    ?.focus();
}

function syncLegacyInvoiceField(event) {
  const field = event.target;
  const line = invoiceLineState[0];
  if (!line || !field?.name) return;
  if (field.name === "productItemId") line.productItemId = field.value;
  if (field.name === "quantity") line.quantity = field.value;
  if (field.name === "unitPriceMinor") line.unitPriceMinor = field.value;
  if (field.name === "discountMinor") line.discountMinor = field.value;
  renderInvoiceLineEditor();
}

function addInvoiceLine() {
  syncInvoiceLineStateFromDom();
  invoiceLineState.push(createInvoiceLine());
  renderInvoiceLineEditor();
  elements["invoice-line-editor"]
    .querySelector('.invoice-line-row:last-child [data-line-field="item"]')
    ?.focus();
}

function renderSalesSelects(customers, products) {
  const customerSelect = elements["invoice-form"].elements.customerId;
  const legacyProductSelect = elements["invoice-form"].elements.productItemId;
  customerSelect.replaceChildren(
    ...customers
      .filter((item) => item.active)
      .map((item) => option(item.id, `${item.customerNumber} | ${item.displayName}`))
  );
  legacyProductSelect.replaceChildren(
    ...products
      .filter((item) => item.active)
      .map((item) => option(item.id, `${item.name} | ${formatMinor(item.salesPriceMinor)}`))
  );
  legacyProductSelect.value = invoiceLineState[0]?.productItemId ?? "";
  elements["invoice-form"].elements.quantity.value = invoiceLineState[0]?.quantity ?? "1";
  elements["invoice-form"].elements.unitPriceMinor.value =
    invoiceLineState[0]?.unitPriceMinor ?? "";
  elements["invoice-form"].elements.discountMinor.value = invoiceLineState[0]?.discountMinor ?? "0";
  renderInvoiceLineEditor();
  const accountSelect = elements["product-form"].elements.incomeAccountId;
  accountSelect.replaceChildren(
    ...accounts
      .filter((account) => account.type === "REVENUE")
      .map((account) => option(account.id, `${account.code} ${account.name}`))
  );
  // ProductItem.defaultTaxCodeId drives the fallback in invoice-calculation when
  // a line does not name a code, and had no UI at all.
  const taxCodeSelect = elements["product-form"].elements.defaultTaxCodeId;
  if (taxCodeSelect) {
    const previous = taxCodeSelect.value;
    taxCodeSelect.replaceChildren(
      option("", "No default"),
      ...(setup?.taxCodes ?? []).map((code) => option(code.id, `${code.code} | ${code.name}`))
    );
    taxCodeSelect.value = previous;
  }
  enhanceCreatableSelect(customerSelect, {
    label: "Customer",
    placeholder: customers.length ? "Search customers" : "No customers yet",
    emptyText: customers.length
      ? "No matching customers. Use + to add one."
      : "No customers yet. Use + to add the first customer.",
    createButton: elements["invoice-form"].querySelector('[data-contextual-create="customer"]'),
    createLabel: "Create a new customer",
    canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES")
  });
  enhanceCreatableSelect(accountSelect, {
    label: "Income account",
    placeholder: "Search revenue accounts",
    createButton: elements["product-form"].querySelector('[data-contextual-create="account"]'),
    createLabel: "Create a new revenue account",
    canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT")
  });
  enhanceCreatableSelect(taxCodeSelect, {
    label: "Default tax code",
    placeholder: "Search tax codes",
    createButton: elements["product-form"].querySelector('[data-contextual-create="tax-code"]'),
    createLabel: "Create a new tax code",
    canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT")
  });
  if (!elements["invoice-form"].elements.issueDate.value)
    elements["invoice-form"].elements.issueDate.value = new Date().toISOString().slice(0, 10);
  if (!elements["invoice-form"].elements.dueDate.value) syncInvoiceDueDate();
  renderInvoiceCurrencyControls({ target: { name: "customerId" } });
  renderInvoicePaymentMethodOptions();
  renderInvoiceNumberStatus();
}

function displayInvoiceNumber(invoice) {
  return invoice?.invoiceNumber ?? "Draft";
}

function displayEstimateNumber(estimate) {
  return estimate?.estimateNumber ?? "Draft";
}

function renderInvoiceNumberStatus(invoice = activeInvoiceDraft) {
  const status = elements["invoice-number-status"];
  if (!status) return;
  status.textContent = invoice?.invoiceNumber
    ? `Invoice ${invoice.invoiceNumber}`
    : "Draft — invoice number assigned when finalized";
}

function renderInvoicePaymentMethodOptions(selectedKeys = null) {
  const options = elements["invoice-payment-method-options"];
  if (!options) return;
  const current = new Set(
    selectedKeys ??
      [...options.querySelectorAll('input[name="paymentMethodSelection"]:checked')].map(
        (input) => input.value
      )
  );
  const methods = [...(paymentInstructionSettings?.methods ?? [])].sort(
    (left, right) => Number(left.position ?? 0) - Number(right.position ?? 0)
  );
  if (!methods.length) {
    options.replaceChildren(
      Object.assign(document.createElement("span"), {
        className: "field-help",
        textContent:
          "No structured payment methods are configured yet; company defaults will be used."
      })
    );
    return;
  }
  options.replaceChildren(
    ...methods.map((method) => {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "paymentMethodSelection";
      input.value = method.key;
      input.checked = current.has(method.key);
      label.append(
        input,
        document.createTextNode(paymentInstructionMethodLabels[method.key] ?? method.key)
      );
      return label;
    })
  );
}

function renderEstimateSelects(customers) {
  const form = elements["estimate-form"];
  form.elements.customerId.replaceChildren(
    ...customers
      .filter((item) => item.active)
      .map((item) => option(item.id, `${item.customerNumber} | ${item.displayName}`))
  );
  enhanceCreatableSelect(form.elements.customerId, {
    label: "Estimate customer",
    placeholder: customers.length ? "Search customers" : "No customers yet",
    emptyText: "No customers yet. Use + to add the first customer.",
    createButton: form.querySelector('[data-contextual-create="customer"]'),
    createLabel: "Create a new customer",
    canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES")
  });
  renderDocumentLineEditor("estimate");
  renderEstimateNumberGuidance();
}

function renderEstimateNumberGuidance() {
  const input = elements["estimate-form"]?.elements.estimateNumber;
  const guidance = elements["estimate-number-guidance"];
  if (!input || !guidance) return;
  const prefix = String(setup?.defaults?.estimatePrefix ?? "EST").trim() || "EST";
  input.placeholder = `${prefix}-0001`;
  guidance.textContent = `Leave blank to use your next ${prefix} number. A custom number is locked after saving.`;
}

function renderDepositAndProgressSelects() {
  const depositForm = elements["customer-deposit-form"];
  const currentCustomerId = depositForm.elements.customerId.value;
  depositForm.elements.customerId.replaceChildren(
    ...customers
      .filter((item) => item.active)
      .map((item) => option(item.id, `${item.customerNumber} | ${item.displayName}`))
  );
  if ([...depositForm.elements.customerId.options].some((item) => item.value === currentCustomerId))
    depositForm.elements.customerId.value = currentCustomerId;
  renderDepositRelatedSelects();

  const progressForm = elements["progress-billing-form"];
  const currentEstimateId = progressForm.elements.estimateId.value;
  progressForm.elements.estimateId.replaceChildren(
    ...estimates
      .filter((estimate) => estimate.status === "ACCEPTED")
      .map((estimate) =>
        option(
          estimate.id,
          `${displayEstimateNumber(estimate)} | ${estimate.customerName} | ${formatMinor(estimate.grandTotalMinor)}`
        )
      )
  );
  if (
    [...progressForm.elements.estimateId.options].some((item) => item.value === currentEstimateId)
  )
    progressForm.elements.estimateId.value = currentEstimateId;
  renderProgressProjectSelect();

  const today = new Date().toISOString().slice(0, 10);
  if (!depositForm.elements.requestDate.value) depositForm.elements.requestDate.value = today;
}

function renderDepositRelatedSelects() {
  const form = elements["customer-deposit-form"];
  const customerId = form.elements.customerId.value;
  const previousEstimateId = form.elements.estimateId.value;
  const previousProjectId = form.elements.projectId.value;
  form.elements.estimateId.replaceChildren(
    option("", "No related estimate"),
    ...estimates
      .filter(
        (estimate) =>
          estimate.customerId === customerId &&
          ["SENT", "VIEWED", "ACCEPTED"].includes(estimate.status)
      )
      .map((estimate) =>
        option(
          estimate.id,
          `${displayEstimateNumber(estimate)} | ${formatMinor(estimate.grandTotalMinor)}`
        )
      )
  );
  form.elements.projectId.replaceChildren(
    option("", "No related project"),
    ...projects
      .filter((project) => project.customerId === customerId && project.status !== "ARCHIVED")
      .map((project) => option(project.id, `${project.projectNumber} | ${project.name}`))
  );
  if ([...form.elements.estimateId.options].some((item) => item.value === previousEstimateId))
    form.elements.estimateId.value = previousEstimateId;
  if ([...form.elements.projectId.options].some((item) => item.value === previousProjectId))
    form.elements.projectId.value = previousProjectId;
}

function renderProgressProjectSelect() {
  const form = elements["progress-billing-form"];
  const estimate = estimates.find((item) => item.id === form.elements.estimateId.value);
  const previousProjectId = form.elements.projectId.value;
  form.elements.projectId.replaceChildren(
    option("", "No related project"),
    ...projects
      .filter(
        (project) =>
          project.customerId === estimate?.customerId &&
          project.status !== "ARCHIVED" &&
          project.billingMethod !== "NON_BILLABLE"
      )
      .map((project) => option(project.id, `${project.projectNumber} | ${project.name}`))
  );
  if ([...form.elements.projectId.options].some((item) => item.value === previousProjectId))
    form.elements.projectId.value = previousProjectId;
}

async function createCustomerDepositRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const amountMinor = moneyFromForm(data, "amountMinor");
  if (amountMinor === null) return;
  const response = await api("/v1/customer-deposit-requests", {
    ...jsonRequest({
      requestNumber: data.get("requestNumber"),
      customerId: data.get("customerId"),
      estimateId: data.get("estimateId") || null,
      projectId: data.get("projectId") || null,
      classification: data.get("classification"),
      requestDate: data.get("requestDate"),
      dueDate: data.get("dueDate") || null,
      amountMinor,
      currency: "CAD",
      purpose: data.get("purpose"),
      customerMessage: data.get("customerMessage") || null
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  form.reset();
  await loadSales();
  showNotice("Deposit request saved as a non-posting draft.");
}

function renderCustomerDepositRequests() {
  elements["customer-deposit-requests"].replaceChildren(
    ...customerDepositRequests.map((request) => {
      const actions = document.createElement("span");
      const canManage = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES");
      const canApprove = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER");
      if (request.status === "DRAFT" && canManage)
        actions.append(commandButton("Submit", () => transitionCustomerDeposit(request, "submit")));
      if (request.status === "SUBMITTED" && canApprove) {
        actions.append(
          commandButton("Approve", () => transitionCustomerDeposit(request, "approve"))
        );
        actions.append(commandButton("Reject", () => transitionCustomerDeposit(request, "reject")));
      }
      if (["APPROVED", "REJECTED"].includes(request.status) && canApprove)
        actions.append(commandButton("Revise", () => transitionCustomerDeposit(request, "revise")));
      if (!["CANCELLED"].includes(request.status) && canManage)
        actions.append(commandButton("Cancel", () => transitionCustomerDeposit(request, "cancel")));
      return row([
        request.requestNumber,
        request.customerName,
        formatRole(request.classification),
        formatMinor(request.amountMinor),
        formatRole(request.status),
        actions
      ]);
    })
  );
}

async function transitionCustomerDeposit(request, action) {
  let reason = null;
  if (["reject", "revise", "cancel"].includes(action)) {
    reason = window.prompt(`Reason to ${action} this deposit request:`)?.trim();
    if (!reason) return;
  }
  const response = await api(`/v1/customer-deposit-requests/${request.id}/${action}`, {
    ...jsonRequest({ version: request.version, reason }, "POST"),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  await loadSales();
  const outcome = {
    submit: "submitted",
    approve: "approved",
    reject: "rejected",
    revise: "returned to draft",
    cancel: "cancelled"
  }[action];
  showNotice(`Deposit request ${outcome}.`);
}

async function createProgressBillingPlan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const basis = data.get("milestoneBasis");
  const ratioMicros =
    basis === "PERCENT_OF_ESTIMATE" ? percentToRatioMicros(data.get("milestoneValue")) : null;
  const fixedSubtotalMinor =
    basis === "FIXED_SUBTOTAL" ? moneyFromForm(data, "milestoneValue") : null;
  if (
    (basis === "PERCENT_OF_ESTIMATE" && ratioMicros === null) ||
    (basis === "FIXED_SUBTOTAL" && fixedSubtotalMinor === null)
  )
    return;
  const response = await api(`/v1/estimates/${data.get("estimateId")}/progress-billing-plans`, {
    ...jsonRequest({
      planNumber: data.get("planNumber"),
      projectId: data.get("projectId") || null,
      notes: data.get("notes") || null,
      milestones: [
        {
          name: data.get("milestoneName"),
          customerDescription: null,
          dueDate: data.get("milestoneDueDate") || null,
          basis,
          ratioMicros,
          fixedSubtotalMinor
        },
        {
          name: "Final balance",
          customerDescription: null,
          dueDate: null,
          basis: "REMAINING_BALANCE",
          ratioMicros: null,
          fixedSubtotalMinor: null
        }
      ]
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const created = (await response.json()).progressBillingPlan;
  form.reset();
  await loadSales();
  if (created) await showProgressBillingPlan(created.id);
  showNotice("Progress plan built and reconciled as a non-posting draft.");
}

function renderProgressBillingPlans() {
  elements["progress-billing-plans"].replaceChildren(
    ...progressBillingPlans.map((plan) => {
      const actions = document.createElement("span");
      actions.append(commandButton("Review", () => showProgressBillingPlan(plan.id)));
      const canManage = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES");
      const canApprove = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER");
      if (plan.status === "DRAFT" && canManage)
        actions.append(commandButton("Submit", () => transitionProgressBilling(plan, "submit")));
      if (plan.status === "SUBMITTED" && canApprove) {
        actions.append(commandButton("Approve", () => transitionProgressBilling(plan, "approve")));
        actions.append(commandButton("Reject", () => transitionProgressBilling(plan, "reject")));
      }
      if (["APPROVED", "REJECTED"].includes(plan.status) && canApprove)
        actions.append(commandButton("Revise", () => transitionProgressBilling(plan, "revise")));
      if (plan.status !== "CANCELLED" && canManage)
        actions.append(commandButton("Cancel", () => transitionProgressBilling(plan, "cancel")));
      return row([
        plan.planNumber,
        plan.estimateReference,
        plan.customerName,
        formatMinor(plan.estimateTotalSnapshotMinor),
        formatRole(plan.status),
        actions
      ]);
    })
  );
}

async function showProgressBillingPlan(planId) {
  const response = await api(`/v1/progress-billing-plans/${planId}`);
  if (!response.ok) return showError(response);
  const plan = (await response.json()).progressBillingPlan;
  const milestoneText = plan.milestones
    .map(
      (milestone) =>
        `${milestone.sequence}. ${milestone.name}: ${formatMinor(milestone.plannedNetMinor)} net + ${formatMinor(milestone.estimatedTaxMinor)} estimated tax = ${formatMinor(milestone.estimatedTotalMinor)}`
    )
    .join("\n");
  elements["progress-billing-detail"].textContent =
    `${plan.planNumber} | ${plan.estimateReference} | ${formatRole(plan.status)}\n` +
    `${milestoneText}\nTotal: ${formatMinor(plan.estimateTotalSnapshotMinor)}\n` +
    "Financial state: non-posting; no invoice or journal has been created.";
}

async function transitionProgressBilling(plan, action) {
  let reason = null;
  if (["reject", "revise", "cancel"].includes(action)) {
    reason = window.prompt(`Reason to ${action} this progress plan:`)?.trim();
    if (!reason) return;
  }
  const response = await api(`/v1/progress-billing-plans/${plan.id}/${action}`, {
    ...jsonRequest({ version: plan.version, reason }, "POST"),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  await loadSales();
  const outcome = {
    submit: "submitted",
    approve: "approved",
    reject: "rejected",
    revise: "returned to draft",
    cancel: "cancelled"
  }[action];
  showNotice(`Progress plan ${outcome}.`);
}

async function createCustomer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const customerId = String(data.get("customerId") || "");
  const payload = {
    customerNumber: data.get("customerNumber") || null,
    displayName: data.get("displayName"),
    email: data.get("email") || null,
    documentLanguage: data.get("documentLanguage") || null,
    defaultPaymentTermsDays: Number(data.get("defaultPaymentTermsDays")),
    defaultCurrency: data.get("defaultCurrency"),
    reminderDisabled: data.get("reminderDisabled") === "on",
    reminderTone: data.get("reminderTone") || null
  };
  const response = customerId
    ? await api(
        `/v1/customers/${customerId}`,
        jsonRequest({ ...payload, version: Number(data.get("version")) }, "PATCH")
      )
    : await api("/v1/customers", jsonRequest(payload));
  if (!response.ok) return showError(response);
  const customer = (await response.json()).customer;
  resetCustomerForm();
  await loadSales();
  completeContextualCreation(customer?.id);
  showNotice(customerId ? "Customer updated." : "Customer created.");
}

function resetCustomerForm() {
  const form = elements["customer-form"];
  form.reset();
  form.elements.customerId.value = "";
  form.elements.version.value = "";
  elements["customer-form-heading"].textContent = "Customers";
  form.querySelector('button[type="submit"]').textContent = "Create customer";
  elements["cancel-customer-edit"].hidden = true;
}

function editCustomer(customer) {
  const form = elements["customer-form"];
  form.elements.customerId.value = customer.id;
  form.elements.version.value = String(customer.version);
  form.elements.customerNumber.value = customer.customerNumber ?? "";
  form.elements.displayName.value = customer.displayName ?? "";
  form.elements.email.value = customer.email ?? "";
  form.elements.documentLanguage.value = customer.documentLanguage ?? "";
  form.elements.defaultCurrency.value = customer.defaultCurrency ?? "CAD";
  form.elements.defaultPaymentTermsDays.value = String(customer.defaultPaymentTermsDays ?? 30);
  form.elements.reminderDisabled.checked = Boolean(customer.reminderDisabled);
  form.elements.reminderTone.value = customer.reminderTone ?? "";
  elements["customer-form-heading"].textContent = `Edit customer: ${customer.displayName}`;
  form.querySelector('button[type="submit"]').textContent = "Save customer";
  elements["cancel-customer-edit"].hidden = false;
  form.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
  form.elements.displayName.focus();
}

async function archiveCustomer(customer) {
  if (!customer.active) return;
  const balanceResponse = await api(`/v1/customers/${customer.id}/balance`);
  if (!balanceResponse.ok) return showError(balanceResponse);
  const balance = (await balanceResponse.json()).balance;
  if (BigInt(balance.balanceMinor ?? "0") > 0n)
    return showNotice(
      "This customer cannot be archived while an open receivables balance remains. Settle or credit the outstanding invoices first.",
      true
    );
  if (
    !window.confirm(
      `Archive ${customer.displayName}? New invoices will no longer use this customer.`
    )
  )
    return;
  const response = await api(
    `/v1/customers/${customer.id}/archive`,
    jsonRequest({ version: customer.version })
  );
  if (!response.ok) return showError(response);
  await loadSales();
  showNotice("Customer archived.");
}

function renderCustomerRow(customer) {
  const actions = document.createElement("div");
  actions.className = "table-command-group";
  actions.append(commandButton("Details", () => openCustomerDetail(customer)));
  if (customer.active) {
    if (activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES")) {
      actions.append(commandButton("Edit", () => editCustomer(customer)));
      actions.append(commandButton("Archive", () => archiveCustomer(customer)));
    }
  } else {
    const archived = document.createElement("span");
    archived.textContent = "Archived";
    actions.append(archived);
  }
  return row([customer.customerNumber, customer.displayName, customer.email ?? "", actions]);
}

async function openCustomerDetail(customer) {
  const content = elements["customer-detail-content"];
  content.replaceChildren(rowText("Loading customer balance and statement…"));
  const statementTo = new Date().toISOString().slice(0, 10);
  const statementFrom = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const statementQuery = new URLSearchParams({
    from: statementFrom,
    to: statementTo,
    type: "ACTIVITY"
  });
  const [balanceResponse, statementResponse] = await Promise.all([
    api(`/v1/customers/${customer.id}/balance`),
    api(`/v1/reports/receivables/customers/${customer.id}/statement?${statementQuery}`)
  ]);
  if (!balanceResponse.ok) return showError(balanceResponse);
  const balance = (await balanceResponse.json()).balance;
  const statement = statementResponse.ok ? (await statementResponse.json()).report : null;
  const heading = elements["customer-detail-heading"];
  heading.textContent = `${customer.displayName} details`;
  const summary = elements["customer-detail-summary"];
  summary.textContent = `Open balance: ${formatMinor(balance.balanceMinor, customer.defaultCurrency ?? "CAD")}. ${balance.invoices.length} receivables invoice(s) are included.`;
  const invoiceTable = document.createElement("table");
  invoiceTable.append(headerRow(["Invoice", "Status", "Total", "Paid", "Credited", "Open"]));
  for (const invoice of balance.invoices)
    invoiceTable.append(
      row([
        invoice.invoiceNumber ?? invoice.invoiceId.slice(0, 8),
        invoice.status,
        formatMinor(invoice.grandTotalMinor, customer.defaultCurrency ?? "CAD"),
        formatMinor(invoice.amountPaidMinor, customer.defaultCurrency ?? "CAD"),
        formatMinor(invoice.creditedMinor, customer.defaultCurrency ?? "CAD"),
        formatMinor(invoice.outstandingBalanceMinor, customer.defaultCurrency ?? "CAD")
      ])
    );
  if (!balance.invoices.length)
    invoiceTable.append(row(["No posted invoices", "", "", "", "", ""]));
  const invoiceSection = document.createElement("section");
  const invoiceHeading = document.createElement("h3");
  invoiceHeading.textContent = "Receivables";
  invoiceSection.append(invoiceHeading, invoiceTable);
  const statementSection = document.createElement("section");
  const statementHeading = document.createElement("h3");
  statementHeading.textContent = "Statement activity";
  const statementActions = document.createElement("div");
  statementActions.className = "table-command-group";
  statementActions.append(
    commandButton("Download activity PDF", () =>
      downloadCustomerStatement(customer, "ACTIVITY", statementFrom, statementTo)
    ),
    commandButton("Download open items PDF", () =>
      downloadCustomerStatement(customer, "OPEN_ITEM", statementFrom, statementTo)
    ),
    commandButton(
      runtimeCapabilities.emailDelivery ? "Email statement" : "Send statement manually",
      () => sendCustomerStatement(customer, "ACTIVITY", statementFrom, statementTo)
    )
  );
  statementSection.append(statementHeading, statementActions);
  if (statement) {
    const statementTable = document.createElement("table");
    statementTable.append(headerRow(["Date", "Type", "Reference", "Charge", "Credit", "Balance"]));
    for (const entry of statement.entries)
      statementTable.append(
        row([
          entry.date,
          entry.type,
          entry.reference ?? entry.sourceId.slice(0, 8),
          formatMinor(entry.chargeMinor, customer.defaultCurrency ?? "CAD"),
          formatMinor(entry.creditMinor, customer.defaultCurrency ?? "CAD"),
          formatMinor(entry.runningBalanceMinor, customer.defaultCurrency ?? "CAD")
        ])
      );
    if (!statement.entries.length)
      statementTable.append(row(["No activity in the statement range", "", "", "", "", ""]));
    statementSection.append(statementTable);
  } else {
    statementSection.append(rowText("The customer statement could not be loaded for this role."));
  }
  content.replaceChildren(invoiceSection, statementSection);
  const dialog = elements["customer-detail-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

async function downloadCustomerStatement(customer, type, from, to) {
  const query = new URLSearchParams({ from, to, type });
  const response = await api(
    `/v1/reports/receivables/customers/${customer.id}/statement.pdf?${query}`
  );
  if (!response.ok) return showError(response);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = `customer-statement-${customer.customerNumber}-${type.toLowerCase()}.pdf`;
  link.click();
  URL.revokeObjectURL(link.href);
  showNotice("Customer statement PDF downloaded.");
  return true;
}

async function sendCustomerStatement(customer, type, from, to) {
  const recipientEmail = window.prompt("Recipient email", customer.email ?? "");
  if (!recipientEmail) return;
  const payload = { from, to, type, recipientEmail };
  if (runtimeCapabilities.emailDelivery) {
    const response = await api(
      `/v1/reports/receivables/customers/${customer.id}/statement/send`,
      jsonRequest(payload)
    );
    if (!response.ok) return showError(response);
    showNotice("Customer statement sent through the configured delivery mailbox.");
    return;
  }
  const downloaded = await downloadCustomerStatement(customer, type, from, to);
  if (downloaded !== true) return;
  const message = `Please find the customer statement for ${from} to ${to} attached.`;
  try {
    await globalThis.navigator?.clipboard?.writeText(message);
  } catch {
    // Clipboard permissions vary on installed builds.
  }
  window.location.href = `mailto:${encodeURIComponent(recipientEmail)}?${new URLSearchParams({ subject: "Customer statement", body: message })}`;
  const response = await api(
    `/v1/reports/receivables/customers/${customer.id}/statement/manual-delivery`,
    jsonRequest(payload)
  );
  if (!response.ok) return showError(response);
  showNotice("Statement prepared and manual delivery recorded. PennyWise did not send the email.");
}

async function createProduct(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const salesPriceMinor = moneyFromForm(data, "salesPriceMinor");
  if (salesPriceMinor === null) return;
  const response = await api(
    "/v1/products",
    jsonRequest({
      sku: data.get("sku") || null,
      name: data.get("name"),
      itemType: data.get("itemType"),
      salesPriceMinor,
      incomeAccountId: data.get("incomeAccountId"),
      ...(data.get("defaultTaxCodeId") ? { defaultTaxCodeId: data.get("defaultTaxCodeId") } : {}),
      ...(String(data.get("hsTariffCode") ?? "").trim()
        ? { hsTariffCode: String(data.get("hsTariffCode")).trim() }
        : {}),
      ...(String(data.get("countryOfOrigin") ?? "").trim()
        ? { countryOfOrigin: String(data.get("countryOfOrigin")).trim().toUpperCase() }
        : {})
    })
  );
  if (!response.ok) return showError(response);
  const product = (await response.json()).product;
  event.target.reset();
  await loadSales();
  completeContextualCreation(product?.id);
  showNotice("Product or service created.");
}

function newBulkEntryRow(values = {}) {
  bulkEntryRowCounter += 1;
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: `bulk-${Date.now()}-${bulkEntryRowCounter}`,
    status: "dirty",
    resourceId: null,
    customerId: "",
    vendorId: "",
    productItemId: "",
    accountId: "",
    description: "",
    vendorInvoiceNumber: "",
    issueDate: today,
    quantity: "1",
    unitPriceMinor: "",
    unitCostMinor: "",
    discountMinor: "0",
    currency: "CAD",
    error: "",
    ...values
  };
}

function bulkEntryColumns() {
  if (bulkEntryState.type === "invoice")
    return [
      { key: "customerId", label: "Customer", kind: "customer", required: true },
      { key: "issueDate", label: "Issue date", kind: "date", required: true },
      { key: "productItemId", label: "Product/service", kind: "product", required: false },
      { key: "description", label: "Description", kind: "text", required: false },
      { key: "quantity", label: "Qty", kind: "quantity", required: true },
      { key: "unitPriceMinor", label: "Unit price", kind: "money", required: true },
      { key: "discountMinor", label: "Discount", kind: "money", required: false },
      { key: "currency", label: "Currency", kind: "currency", required: true }
    ];
  return [
    { key: "vendorId", label: "Vendor", kind: "vendor", required: true },
    { key: "vendorInvoiceNumber", label: "Vendor invoice", kind: "text", required: true },
    { key: "issueDate", label: "Issue date", kind: "date", required: true },
    { key: "description", label: "Description", kind: "text", required: true },
    { key: "quantity", label: "Qty", kind: "quantity", required: true },
    { key: "unitCostMinor", label: "Unit cost", kind: "money", required: true },
    { key: "accountId", label: "Expense account", kind: "account", required: true },
    { key: "currency", label: "Currency", kind: "currency", required: true }
  ];
}

function normalizeBulkHeader(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function resolveBulkReference(column, value) {
  const raw = String(value ?? "").trim();
  if (!raw || !["customer", "vendor", "product", "account"].includes(column.kind)) return raw;
  const collection =
    column.kind === "customer"
      ? customers
      : column.kind === "vendor"
        ? vendors
        : column.kind === "product"
          ? products
          : accounts;
  const normalized = raw.toLocaleLowerCase();
  const match = collection.find((item) =>
    [item.id, item.displayName, item.name, item.code, item.sku]
      .filter(Boolean)
      .some((candidate) => String(candidate).trim().toLocaleLowerCase() === normalized)
  );
  return match?.id ?? raw;
}

function bulkEntryOptions(kind) {
  const options = [{ value: "", label: "Choose…" }];
  if (kind === "customer")
    options.push(...customers.map((item) => ({ value: item.id, label: item.displayName })));
  if (kind === "vendor")
    options.push(...vendors.map((item) => ({ value: item.id, label: item.displayName })));
  if (kind === "product")
    options.push(...products.map((item) => ({ value: item.id, label: item.name })));
  if (kind === "account")
    options.push(
      ...accounts.map((item) => ({ value: item.id, label: `${item.code} ${item.name}` }))
    );
  if (kind === "currency")
    return [
      { value: "CAD", label: "CAD" },
      { value: "USD", label: "USD" }
    ];
  return options;
}

function bulkEntryEditorFor(rowValue, column) {
  let editor;
  if (["customer", "vendor", "product", "account", "currency"].includes(column.kind)) {
    editor = document.createElement("select");
    for (const option of bulkEntryOptions(column.kind)) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      editor.append(element);
    }
  } else {
    editor = document.createElement("input");
    editor.type = column.kind === "date" ? "date" : "text";
    if (column.kind === "quantity") editor.inputMode = "decimal";
    if (column.kind === "money") editor.inputMode = "decimal";
  }
  editor.value = String(rowValue ?? "");
  editor.dataset.bulkEntryField = column.key;
  editor.setAttribute("aria-label", column.label);
  if (column.required) editor.required = true;
  return editor;
}

function renderBulkEntryGrid() {
  const grid = elements["bulk-entry-grid"];
  if (!grid) return;
  const columns = bulkEntryColumns();
  const header = document.createElement("div");
  header.className = "bulk-entry-grid-row bulk-entry-grid-header";
  header.setAttribute("role", "row");
  header.append(document.createElement("span"));
  for (const column of columns) {
    const cell = document.createElement("span");
    cell.textContent = column.required ? `${column.label} *` : column.label;
    cell.setAttribute("role", "columnheader");
    header.append(cell);
  }
  const rows = bulkEntryState.rows.map((data, index) => {
    const rowElement = document.createElement("div");
    rowElement.className = "bulk-entry-grid-row";
    rowElement.dataset.bulkEntryRowId = data.id;
    rowElement.setAttribute("role", "row");
    rowElement.classList.toggle("is-selected", data.id === bulkEntryState.selectedRowId);
    rowElement.classList.toggle("is-saved", data.status === "saved");
    rowElement.classList.toggle("has-error", Boolean(data.error));
    const marker = document.createElement("span");
    marker.className = "bulk-entry-row-marker";
    marker.textContent = String(index + 1);
    marker.title = data.error || `Row ${index + 1} ${data.status}`;
    marker.setAttribute("role", "rowheader");
    rowElement.append(marker);
    for (const column of columns) {
      const cell = document.createElement("span");
      cell.className = "bulk-entry-grid-cell";
      cell.setAttribute("role", "gridcell");
      const editor = bulkEntryEditorFor(data[column.key], column);
      editor.dataset.bulkEntryRowId = data.id;
      cell.append(editor);
      rowElement.append(cell);
    }
    return rowElement;
  });
  grid.replaceChildren(header, ...rows);
  renderBulkEntryStatus();
}

function renderBulkEntryStatus() {
  const status = elements["bulk-entry-status"];
  const preview = elements["bulk-entry-preview"];
  if (!status || !preview) return;
  const saved = bulkEntryState.rows.filter((row) => row.status === "saved").length;
  const invalid = bulkEntryState.rows.filter((row) => row.error).length;
  const pending = bulkEntryState.rows.length - saved;
  const amountField = bulkEntryState.type === "invoice" ? "unitPriceMinor" : "unitCostMinor";
  const amountCandidates = bulkEntryState.rows.filter((row) => row[amountField]).length;
  status.textContent = `${bulkEntryState.rows.length} row${bulkEntryState.rows.length === 1 ? "" : "s"} | ${saved} saved draft${saved === 1 ? "" : "s"} | ${invalid} needs attention`;
  if (bulkEntryState.saving) status.textContent += " | Saving…";
  preview.textContent = pending
    ? `Preview: ${amountCandidates} row${amountCandidates === 1 ? "" : "s"} include an amount. Review ${pending} unsaved row${pending === 1 ? "" : "s"}; the server calculates exact totals and tax.`
    : "All rows have been saved as drafts. Use the existing review/post actions to affect accounting.";
  preview.classList.toggle("has-warning", invalid > 0);
  bulkEntryState.dirty = bulkEntryState.rows.some((row) => row.status !== "saved");
}

function addBulkEntryRow(values = {}) {
  const next = newBulkEntryRow(values);
  bulkEntryState.rows.push(next);
  bulkEntryState.selectedRowId = next.id;
  renderBulkEntryGrid();
  const rowElement = [
    ...(elements["bulk-entry-grid"]?.querySelectorAll("[data-bulk-entry-row-id]") ?? [])
  ].find((candidate) => candidate.dataset.bulkEntryRowId === next.id);
  const editor = rowElement?.querySelector("[data-bulk-entry-field]");
  editor?.focus();
}

function selectedBulkEntryRow() {
  return bulkEntryState.rows.find((row) => row.id === bulkEntryState.selectedRowId);
}

function duplicateBulkEntryRow() {
  const source = selectedBulkEntryRow();
  if (!source) return showNotice("Select a row to duplicate.", true);
  const copy = { ...source, status: "dirty", resourceId: null, error: "" };
  const next = newBulkEntryRow(copy);
  const index = bulkEntryState.rows.findIndex((row) => row.id === source.id);
  bulkEntryState.rows.splice(index + 1, 0, next);
  bulkEntryState.selectedRowId = next.id;
  renderBulkEntryGrid();
}

function deleteBulkEntryRow() {
  const row = selectedBulkEntryRow();
  if (!row) return showNotice("Select a row to delete.", true);
  if (row.status === "saved")
    return showNotice(
      "Saved drafts are not deleted by the grid. Open the draft to cancel it safely.",
      true
    );
  bulkEntryState.rows = bulkEntryState.rows.filter((candidate) => candidate.id !== row.id);
  if (!bulkEntryState.rows.length) addBulkEntryRow();
  else {
    bulkEntryState.selectedRowId = bulkEntryState.rows[0].id;
    renderBulkEntryGrid();
  }
}

function clearBulkEntryDrafts() {
  const unsaved = bulkEntryState.rows.filter((row) => row.status !== "saved");
  if (unsaved.length && !window.confirm("Clear unsaved grid changes? Saved drafts will remain."))
    return;
  bulkEntryState.rows = bulkEntryState.rows.filter((row) => row.status === "saved");
  if (!bulkEntryState.rows.length) addBulkEntryRow();
  else {
    bulkEntryState.selectedRowId = bulkEntryState.rows[0].id;
    renderBulkEntryGrid();
  }
}

function setBulkEntryType(type) {
  if (!(type === "invoice" || type === "bill") || type === bulkEntryState.type) return;
  if (
    bulkEntryState.dirty &&
    !window.confirm("Switching entry type clears unsaved rows. Continue?")
  )
    return;
  bulkEntryState.type = type;
  bulkEntryState.rows = [];
  bulkEntryState.selectedRowId = null;
  for (const button of document.querySelectorAll("[data-bulk-entry-type]"))
    button.setAttribute("aria-selected", String(button.dataset.bulkEntryType === type));
  addBulkEntryRow();
}

function handleBulkEntryFocus(event) {
  const editor = event.target.closest?.("[data-bulk-entry-row-id]");
  if (!editor) return;
  bulkEntryState.selectedRowId = editor.dataset.bulkEntryRowId;
  const rowElement = editor.closest(".bulk-entry-grid-row");
  rowElement?.classList.add("is-selected");
}

function handleBulkEntryInput(event) {
  const editor = event.target.closest?.("[data-bulk-entry-field]");
  if (!editor) return;
  const row = bulkEntryState.rows.find(
    (candidate) => candidate.id === editor.dataset.bulkEntryRowId
  );
  if (!row || row.status === "saved") return;
  row[editor.dataset.bulkEntryField] = editor.value;
  row.status = "dirty";
  row.error = "";
  bulkEntryState.selectedRowId = row.id;
  renderBulkEntryStatus();
}

function handleBulkEntryPaste(event) {
  const editor = event.target.closest?.("[data-bulk-entry-field]");
  if (!editor) return;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text.includes("\t") && !text.includes("\n")) return;
  event.preventDefault();
  const lines = text
    .replaceAll("\r", "")
    .split("\n")
    .filter((line) => line.length > 0);
  const columns = bulkEntryColumns();
  const startRow = bulkEntryState.rows.findIndex((row) => row.id === editor.dataset.bulkEntryRowId);
  const startColumn = Math.max(
    0,
    columns.findIndex((column) => column.key === editor.dataset.bulkEntryField)
  );
  const headerMap = new Map();
  const aliases = bulkEntryHeaderAliases[bulkEntryState.type];
  const firstLine = lines[0].split("\t").map(normalizeBulkHeader);
  for (let sourceColumn = 0; sourceColumn < firstLine.length; sourceColumn += 1) {
    const sourceHeader = firstLine[sourceColumn];
    const targetColumn = columns.find((column) => aliases[column.key]?.includes(sourceHeader));
    if (targetColumn) headerMap.set(sourceColumn, targetColumn);
  }
  const hasHeaderMap = headerMap.size >= 2;
  const dataLines = hasHeaderMap ? lines.slice(1) : lines;
  for (let rowOffset = 0; rowOffset < dataLines.length; rowOffset += 1) {
    const values = dataLines[rowOffset].split("\t");
    while (!bulkEntryState.rows[startRow + rowOffset]) bulkEntryState.rows.push(newBulkEntryRow());
    const row = bulkEntryState.rows[startRow + rowOffset];
    if (row.status === "saved") continue;
    values.forEach((value, columnOffset) => {
      const column = hasHeaderMap
        ? headerMap.get(columnOffset)
        : columns[startColumn + columnOffset];
      if (column) row[column.key] = resolveBulkReference(column, value);
    });
    row.status = "dirty";
    row.error = "";
  }
  bulkEntryState.selectedRowId = bulkEntryState.rows[startRow]?.id ?? bulkEntryState.rows[0]?.id;
  renderBulkEntryGrid();
  showNotice(
    `Pasted ${dataLines.length} row${dataLines.length === 1 ? "" : "s"}${hasHeaderMap ? " with detected column aliases" : ""}. Review the grid before saving.`
  );
}

function validateBulkEntryRow(row) {
  const columns = bulkEntryColumns();
  for (const column of columns) {
    if (column.required && !String(row[column.key] ?? "").trim())
      return `${column.label} is required.`;
    if (row[column.key] && ["customer", "vendor", "product", "account"].includes(column.kind)) {
      const values = bulkEntryOptions(column.kind).map((option) => option.value);
      if (!values.includes(String(row[column.key])))
        return `Choose a recognized ${column.label.toLocaleLowerCase()}.`;
    }
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(String(row.quantity).trim()) || Number(row.quantity) <= 0)
    return "Quantity must be a positive decimal.";
  const amount = bulkEntryState.type === "invoice" ? row.unitPriceMinor : row.unitCostMinor;
  try {
    parseMoneyInput(amount);
    parseMoneyInput(row.discountMinor || "0");
  } catch (error) {
    return error instanceof Error ? error.message : "Enter a valid amount.";
  }
  if (bulkEntryState.type === "invoice" && !row.productItemId && !row.description.trim())
    return "Choose a product/service or enter a description.";
  return "";
}

function bulkEntryPayload(row) {
  if (bulkEntryState.type === "invoice")
    return {
      customerId: row.customerId,
      issueDate: row.issueDate,
      currency: row.currency,
      lines: [
        {
          productItemId: row.productItemId || null,
          description: row.description || undefined,
          quantity: row.quantity,
          unitPriceMinor: parseMoneyInput(row.unitPriceMinor),
          discountMinor: parseMoneyInput(row.discountMinor || "0")
        }
      ]
    };
  return {
    vendorId: row.vendorId,
    vendorInvoiceNumber: row.vendorInvoiceNumber,
    issueDate: row.issueDate,
    currency: row.currency,
    lines: [
      {
        description: row.description,
        quantity: row.quantity,
        unitCostMinor: parseMoneyInput(row.unitCostMinor),
        accountId: row.accountId
      }
    ]
  };
}

async function saveBulkEntry(closeAfterSave) {
  if (bulkEntryState.saving) return;
  const pending = bulkEntryState.rows.filter((row) => row.status !== "saved");
  if (!pending.length) {
    if (closeAfterSave) closeBulkEntryWindow();
    else showNotice("All rows are already saved as drafts.");
    return;
  }
  bulkEntryState.saving = true;
  renderBulkEntryStatus();
  let savedCount = 0;
  for (const row of pending) {
    const error = validateBulkEntryRow(row);
    if (error) {
      row.status = "invalid";
      row.error = error;
      continue;
    }
    row.status = "saving";
    row.error = "";
    renderBulkEntryGrid();
    const endpoint = bulkEntryState.type === "invoice" ? "/v1/invoices" : "/v1/bills";
    let response;
    try {
      response = await api(endpoint, {
        ...jsonRequest(bulkEntryPayload(row)),
        headers: {
          "content-type": "application/json",
          "idempotency-key": `bulk-entry-${row.id}`
        }
      });
    } catch {
      row.status = "needs-review";
      row.error = "The result is unknown. Refresh and review before retrying this row.";
      continue;
    }
    if (!response.ok) {
      row.status = response.status >= 500 ? "needs-review" : "invalid";
      row.error =
        response.status >= 500
          ? "The result is unknown. Refresh and review before retrying this row."
          : "Server validation failed.";
      const body = await response.json().catch(() => null);
      if (response.status < 500 && body?.error?.message) row.error = body.error.message;
      continue;
    }
    const body = await response.json().catch(() => null);
    const resource = body?.invoice ?? body?.bill;
    row.status = "saved";
    row.resourceId = resource?.id ?? null;
    savedCount += 1;
  }
  bulkEntryState.saving = false;
  renderBulkEntryGrid();
  if (savedCount) {
    await Promise.all([loadSales(), loadPurchases()]);
    showNotice(
      `${savedCount} draft${savedCount === 1 ? "" : "s"} saved. No accounting entries were posted.`
    );
  }
  if (closeAfterSave && !bulkEntryState.rows.some((row) => row.status !== "saved"))
    closeBulkEntryWindow();
}

function normalizeBulkEntryZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return bulkEntryZoomSteps.reduce((closest, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(closest - numeric) ? candidate : closest
  );
}

function setBulkEntryZoom(value, { persist = false } = {}) {
  const windowElement = elements["bulk-entry-section"];
  if (!windowElement) return;
  const zoom = normalizeBulkEntryZoom(value);
  windowElement.dataset.bulkEntryZoom = String(zoom);
  windowElement.style.setProperty("--bulk-entry-content-zoom", String(zoom));
  const label = elements["bulk-entry-zoom-label"];
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  if (persist) persistBulkEntryWindowLayout();
}

function bulkEntryViewportBounds() {
  const viewportPadding = 16;
  const headerBottom = appHeader?.getBoundingClientRect().bottom ?? 0;
  const leftNavigation = elements["left-navigation-pane"];
  const navigationRight =
    leftNavigation && !leftNavigation.hidden && window.matchMedia("(min-width: 761px)").matches
      ? Math.ceil(leftNavigation.getBoundingClientRect().right + 12)
      : viewportPadding;
  const top = Math.min(
    Math.max(viewportPadding, Math.ceil(headerBottom + 12)),
    Math.max(viewportPadding, window.innerHeight - 360 - viewportPadding)
  );
  return {
    left: Math.max(viewportPadding, navigationRight),
    top,
    right: Math.max(viewportPadding, window.innerWidth - viewportPadding),
    bottom: Math.max(top + 360, window.innerHeight - viewportPadding)
  };
}

function fitBulkEntryWindow() {
  const windowElement = elements["bulk-entry-section"];
  if (!windowElement) return;
  const bounds = bulkEntryViewportBounds();
  windowElement.style.transform = "none";
  windowElement.style.left = `${Math.round(bounds.left)}px`;
  windowElement.style.top = `${Math.round(bounds.top)}px`;
  windowElement.style.width = `${Math.round(bounds.right - bounds.left)}px`;
  windowElement.style.height = `${Math.round(bounds.bottom - bounds.top)}px`;
  const grid = elements["bulk-entry-grid"];
  if (grid) {
    const availableWidth = Math.max(1, windowElement.clientWidth - 28);
    const target = Math.max(
      0.8,
      Math.min(1, (availableWidth / Math.max(availableWidth, grid.scrollWidth)) * 0.98)
    );
    setBulkEntryZoom(target);
  }
}

function clampBulkEntryWindowToViewport() {
  const windowElement = elements["bulk-entry-section"];
  if (!windowElement) return;
  const bounds = bulkEntryViewportBounds();
  const minimumWidth = Math.min(620, bounds.right - bounds.left);
  const minimumHeight = Math.min(360, bounds.bottom - bounds.top);
  const rect = windowElement.getBoundingClientRect();
  const width = Math.min(bounds.right - bounds.left, Math.max(minimumWidth, rect.width));
  const height = Math.min(bounds.bottom - bounds.top, Math.max(minimumHeight, rect.height));
  const left = Math.min(bounds.right - width, Math.max(bounds.left, rect.left));
  const top = Math.min(bounds.bottom - height, Math.max(bounds.top, rect.top));
  windowElement.style.transform = "none";
  windowElement.style.left = `${Math.round(left)}px`;
  windowElement.style.top = `${Math.round(top)}px`;
  windowElement.style.width = `${Math.round(width)}px`;
  windowElement.style.height = `${Math.round(height)}px`;
}

function persistBulkEntryWindowLayout() {
  const windowElement = elements["bulk-entry-section"];
  if (!windowElement) return;
  const rect = windowElement.getBoundingClientRect();
  try {
    window.localStorage.setItem(
      "clearledger_bulk_entry_window",
      JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        zoom: normalizeBulkEntryZoom(windowElement.dataset.bulkEntryZoom)
      })
    );
  } catch {
    // Browser layout preferences are optional and never affect accounting data.
  }
}

function openBulkEntryWindow() {
  navigateTo("sales-workspace", { scrollToTop: false });
  const windowElement = elements["bulk-entry-section"];
  if (!windowElement) return;
  windowElement.hidden = false;
  if (!windowElement.dataset.bulkEntryLayoutCustomized) fitBulkEntryWindow();
  clampBulkEntryWindowToViewport();
  windowElement.classList.add("is-window-open");
  if (!bulkEntryState.rows.length) addBulkEntryRow();
  else renderBulkEntryGrid();
  windowElement.querySelector("[data-bulk-entry-field]")?.focus();
}

function closeBulkEntryWindow() {
  if (bulkEntryState.dirty && !window.confirm("Close bulk entry and discard unsaved changes?"))
    return;
  elements["bulk-entry-section"].hidden = true;
  elements["bulk-entry-section"].classList.remove("is-window-open", "is-minimized", "is-maximized");
}

function handleBulkEntryWindowAction(action) {
  const windowElement = elements["bulk-entry-section"];
  if (!windowElement) return;
  if (action === "fit") {
    delete windowElement.dataset.bulkEntryLayoutCustomized;
    fitBulkEntryWindow();
    persistBulkEntryWindowLayout();
    return;
  }
  if (action === "zoom-in" || action === "zoom-out" || action === "zoom-reset") {
    const current = normalizeBulkEntryZoom(windowElement.dataset.bulkEntryZoom);
    const index = bulkEntryZoomSteps.indexOf(current);
    const nextIndex =
      action === "zoom-reset"
        ? bulkEntryZoomSteps.indexOf(1)
        : Math.min(
            bulkEntryZoomSteps.length - 1,
            Math.max(0, index + (action === "zoom-in" ? 1 : -1))
          );
    setBulkEntryZoom(bulkEntryZoomSteps[nextIndex], { persist: true });
    return;
  }
  if (action === "close") return closeBulkEntryWindow();
  if (action === "minimize") windowElement.classList.toggle("is-minimized");
  if (action === "maximize") windowElement.classList.toggle("is-maximized");
}

function initializeBulkEntryWindowManager() {
  const windowElement = elements["bulk-entry-section"];
  const handle = windowElement?.querySelector("[data-window-drag-handle]");
  const resize = windowElement?.querySelector("[data-window-resize-handle]");
  if (!windowElement || !handle || !resize) return;
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", "Resize bulk entry");
  resize.tabIndex = 0;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem("clearledger_bulk_entry_window") || "null"
    );
    if (saved && typeof saved === "object") {
      if (Number.isFinite(saved.left)) windowElement.style.left = `${saved.left}px`;
      if (Number.isFinite(saved.top)) windowElement.style.top = `${saved.top}px`;
      if (Number.isFinite(saved.width)) windowElement.style.width = `${saved.width}px`;
      if (Number.isFinite(saved.height)) windowElement.style.height = `${saved.height}px`;
      windowElement.style.transform = "none";
      windowElement.dataset.bulkEntryLayoutCustomized = "true";
      bulkEntryLayoutLoaded = true;
      setBulkEntryZoom(saved.zoom);
    }
  } catch {
    // Browser layout preferences are optional and never affect accounting data.
  }
  if (!bulkEntryLayoutLoaded) setBulkEntryZoom(1);
  const moveWindow = (event, mode, start) => {
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const bounds = bulkEntryViewportBounds();
    if (mode === "drag") {
      const left = Math.max(
        bounds.left,
        Math.min(bounds.right - Math.max(220, start.width), start.left + dx)
      );
      const top = Math.max(
        bounds.top,
        Math.min(bounds.bottom - Math.max(80, start.height), start.top + dy)
      );
      windowElement.style.left = `${left}px`;
      windowElement.style.top = `${top}px`;
    } else {
      const width = Math.max(
        Math.min(620, bounds.right - bounds.left),
        Math.min(bounds.right - start.left, start.width + dx)
      );
      const height = Math.max(
        Math.min(360, bounds.bottom - bounds.top),
        Math.min(bounds.bottom - start.top, start.height + dy)
      );
      windowElement.style.width = `${width}px`;
      windowElement.style.height = `${height}px`;
    }
  };
  const startPointer = (event, mode) => {
    if (event.button !== 0 || event.target.closest("button, input, select, textarea")) return;
    event.preventDefault();
    const rect = windowElement.getBoundingClientRect();
    const start = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    const move = (moveEvent) => moveWindow(moveEvent, mode, start);
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      windowElement.dataset.bulkEntryLayoutCustomized = "true";
      clampBulkEntryWindowToViewport();
      persistBulkEntryWindowLayout();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };
  handle.addEventListener("pointerdown", (event) => startPointer(event, "drag"));
  resize.addEventListener("pointerdown", (event) => startPointer(event, "resize"));
  resize.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 80 : 20;
    const rect = windowElement.getBoundingClientRect();
    if (event.key === "ArrowRight") windowElement.style.width = `${rect.width + step}px`;
    else if (event.key === "ArrowLeft") windowElement.style.width = `${rect.width - step}px`;
    else if (event.key === "ArrowDown") windowElement.style.height = `${rect.height + step}px`;
    else if (event.key === "ArrowUp") windowElement.style.height = `${rect.height - step}px`;
    else return;
    event.preventDefault();
    windowElement.dataset.bulkEntryLayoutCustomized = "true";
    clampBulkEntryWindowToViewport();
    persistBulkEntryWindowLayout();
  });
}

async function createInvoice(event) {
  event.preventDefault();
  const wasEditingDraft = Boolean(activeInvoiceDraft);
  if (invoiceDraftSaveTimer) {
    globalThis.clearTimeout(invoiceDraftSaveTimer);
    invoiceDraftSaveTimer = null;
  }
  invoiceDraftSaveSequence += 1;
  let payload;
  try {
    payload = invoiceDraftPayloadFromForm();
  } catch (error) {
    return showNotice(
      error instanceof Error ? error.message : "Enter valid invoice details.",
      true
    );
  }
  const response = activeInvoiceDraft
    ? await api(`/v1/invoices/${activeInvoiceDraft.id}`, {
        ...jsonRequest({ ...payload, version: activeInvoiceDraft.version }, "PATCH")
      })
    : await api("/v1/invoices", {
        ...jsonRequest(payload),
        headers: {
          "content-type": "application/json",
          "idempotency-key": globalThis.crypto.randomUUID()
        }
      });
  if (!response.ok) return showError(response);
  const invoice = (await response.json()).invoice;
  setActiveInvoiceDraft(invoice);
  invoiceDueDateTouched = Boolean(payload.dueDate);
  elements["invoice-form"].querySelector('button[type="submit"] span').textContent =
    "Save draft changes";
  elements["invoice-copy-new-draft"].hidden = false;
  elements["invoice-preview"].textContent =
    `Draft saved: subtotal ${invoice.currency} ${formatMoney(invoice.subtotalMinor, invoice.currency, { context: "export" })}, tax ${invoice.currency} ${formatMoney(invoice.taxTotalMinor, invoice.currency, { context: "export" })}, total ${invoice.currency} ${formatMoney(invoice.grandTotalMinor, invoice.currency, { context: "export" })}. The invoice number is assigned only when you finalize it.`;
  renderServerInvoiceTotals(invoice);
  renderInvoiceNumberStatus(invoice);
  elements["invoice-save-status"].textContent = "Draft saved just now";
  clearBrowserFormDraft("invoice-form", { reset: false, announce: false });
  await loadSales();
  showNotice(wasEditingDraft ? "Draft changes saved." : t("invoice.draftCreated"));
  await previewInvoice(invoice);
  trackProductEvent(wasEditingDraft ? "INVOICE_DRAFT_UPDATED" : "INVOICE_DRAFT_CREATED");
}

function editInvoiceDraft(invoice) {
  if (!invoice || !["DRAFT", "APPROVED"].includes(invoice.status)) return;
  setActiveInvoiceDraft(invoice);
  invoiceDueDateTouched = Boolean(invoice.dueDate);
  const form = elements["invoice-form"];
  form.reset();
  form.elements.customerId.value = invoice.customerId ?? "";
  form.elements.issueDate.value = String(invoice.issueDate ?? "").slice(0, 10);
  form.elements.dueDate.value = String(invoice.dueDate ?? "").slice(0, 10);
  form.elements.paymentTermsDays.value = String(invoice.paymentTermsDays ?? 30);
  form.elements.currency.value = invoice.currency ?? "CAD";
  form.elements.fxRateSnapshotId.value = invoice.fxRateSnapshotId ?? "";
  form.elements.customerFacingNotes.value = invoice.customerFacingNotes ?? "";
  form.elements.terms.value = invoice.terms ?? "";
  setInvoiceLineState(
    (invoice.lines ?? []).map((line) =>
      createInvoiceLine({
        id: line.id,
        productItemId: line.productItemId ?? "",
        description: line.description ?? "",
        quantity: line.quantity ?? "1",
        unitPriceMinor: minorToInput(line.unitPriceMinor ?? "0"),
        discountMinor: minorToInput(line.discountMinor ?? "0"),
        taxCodeId: line.taxCodeId ?? ""
      })
    )
  );
  if (!invoiceLineState.length) setInvoiceLineState([createInvoiceLine()]);
  const selectedMethods = Array.isArray(invoice.paymentMethodSelection)
    ? invoice.paymentMethodSelection
    : [];
  renderInvoicePaymentMethodOptions(selectedMethods);
  renderInvoiceLineEditor();
  renderInvoiceCurrencyControls({ target: { name: "currency" } });
  renderServerInvoiceTotals(invoice);
  elements["invoice-form"].querySelector('button[type="submit"] span').textContent =
    "Save draft changes";
  elements["invoice-copy-new-draft"].hidden = false;
  elements["invoice-preview"].textContent =
    `Editing ${displayInvoiceNumber(invoice).toLowerCase()}. Save to refresh the customer preview.`;
  renderInvoiceNumberStatus(invoice);
  navigateTo("sales-workspace");
  form.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  form.elements.customerId.focus();
}

function invoiceDraftPayloadFromForm() {
  syncInvoiceLineStateFromDom();
  const form = elements["invoice-form"];
  const data = new FormData(form);
  const lines = invoiceLineState.map((line, index) => {
    if (!line.productItemId && !line.description.trim())
      throw new Error(`Add an item or description to invoice line ${index + 1}.`);
    let unitPriceMinor;
    let discountMinor;
    try {
      unitPriceMinor = parseMoneyInput(line.unitPriceMinor || "0");
      discountMinor = parseMoneyInput(line.discountMinor || "0");
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Enter a valid line amount.", {
        cause: error
      });
    }
    return {
      productItemId: line.productItemId || null,
      ...(line.description.trim() ? { description: line.description.trim() } : {}),
      quantity: line.quantity || "1",
      unitPriceMinor,
      discountMinor,
      ...(line.taxCodeId ? { taxCodeId: line.taxCodeId } : {})
    };
  });
  const paymentTermsDays = String(data.get("paymentTermsDays") ?? "").trim();
  const paymentMethodSelection = data
    .getAll("paymentMethodSelection")
    .filter((value) => typeof value === "string" && value.trim());
  return {
    customerId: data.get("customerId"),
    issueDate: data.get("issueDate"),
    ...(data.get("dueDate") ? { dueDate: data.get("dueDate") } : {}),
    ...(paymentTermsDays ? { paymentTermsDays: Number(paymentTermsDays) } : {}),
    currency: data.get("currency"),
    ...(data.get("fxRateSnapshotId") ? { fxRateSnapshotId: data.get("fxRateSnapshotId") } : {}),
    ...(paymentMethodSelection.length ? { paymentMethodSelection } : {}),
    lines,
    customerFacingNotes: data.get("customerFacingNotes") || null,
    terms: data.get("terms") || null
  };
}

function syncInvoiceDueDate() {
  if (invoiceDueDateTouched) return;
  const form = elements["invoice-form"];
  const issueDate = form.elements.issueDate.value;
  const terms = Number(form.elements.paymentTermsDays.value || 0);
  if (!issueDate || !Number.isInteger(terms) || terms < 0) return;
  const due = new Date(`${issueDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + terms);
  form.elements.dueDate.value = due.toISOString().slice(0, 10);
}

function scheduleInvoiceDraftAutosave() {
  if (!activeInvoiceDraft || !["DRAFT", "APPROVED"].includes(activeInvoiceDraft.status)) return;
  if (invoiceDraftSaveTimer) globalThis.clearTimeout(invoiceDraftSaveTimer);
  elements["invoice-save-status"].textContent = "Changes will save shortly…";
  invoiceDraftSaveTimer = globalThis.setTimeout(() => void autosaveInvoiceDraft(), 650);
}

async function autosaveInvoiceDraft() {
  if (!activeInvoiceDraft) return;
  const sequence = ++invoiceDraftSaveSequence;
  let payload;
  try {
    payload = invoiceDraftPayloadFromForm();
  } catch (error) {
    elements["invoice-save-status"].textContent =
      error instanceof Error ? error.message : "Draft needs attention.";
    return;
  }
  const response = await api(`/v1/invoices/${activeInvoiceDraft.id}`, {
    ...jsonRequest({ ...payload, version: activeInvoiceDraft.version }, "PATCH")
  });
  if (sequence !== invoiceDraftSaveSequence) return;
  if (response.status === 409) {
    elements["invoice-save-status"].textContent =
      "This draft changed in another tab. Your edits were not saved; reload it before continuing.";
    return showNotice("This draft changed in another tab. Reload it before continuing.", true);
  }
  if (!response.ok) return showError(response);
  setActiveInvoiceDraft((await response.json()).invoice);
  renderServerInvoiceTotals(activeInvoiceDraft);
  renderInvoiceNumberStatus(activeInvoiceDraft);
  elements["invoice-save-status"].textContent = "Draft saved just now";
}

function renderServerInvoiceTotals(invoice) {
  elements["invoice-estimated-subtotal"].textContent =
    `Subtotal: ${formatMinor(invoice.subtotalMinor, invoice.currency)}`;
  elements["invoice-estimated-discount"].textContent =
    `Discount: ${formatMinor(invoice.discountTotalMinor, invoice.currency)}`;
  elements["invoice-estimated-tax"].textContent =
    `Tax: ${formatMinor(invoice.taxTotalMinor, invoice.currency)}`;
  elements["invoice-estimated-total"].textContent =
    `Total: ${formatMinor(invoice.grandTotalMinor, invoice.currency)}`;
}

function copyInvoiceToNewDraft() {
  if (invoiceDraftSaveTimer) globalThis.clearTimeout(invoiceDraftSaveTimer);
  setActiveInvoiceDraft(null);
  invoiceDueDateTouched = false;
  elements["invoice-form"].reset();
  elements["invoice-form"].querySelector('button[type="submit"] span').textContent =
    "Create draft & review";
  elements["invoice-copy-new-draft"].hidden = true;
  setInvoiceLineState([createInvoiceLine()]);
  renderInvoiceLineEditor();
  const today = new Date().toISOString().slice(0, 10);
  elements["invoice-form"].elements.issueDate.value = today;
  syncInvoiceDueDate();
  elements["invoice-books-impact"].hidden = true;
  elements["invoice-document-preview"].replaceChildren();
  elements["invoice-preview"].textContent = "";
  elements["invoice-preview-panel"].open = false;
  elements["invoice-preview-status"].textContent = "Create a draft to review it";
  renderInvoiceNumberStatus();
}

async function createEstimate(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  syncDocumentLineStateFromDom("estimate");
  const lines = [];
  for (const line of estimateLineState) {
    const description = String(line.description ?? "").trim();
    if (!line.productItemId && !description) {
      showNotice("Each estimate line needs an item or description.", true);
      return;
    }
    let unitPriceMinor = null;
    let discountMinor = null;
    try {
      if (String(line.unitPriceMinor ?? "").trim())
        unitPriceMinor = parseMoneyInput(line.unitPriceMinor);
      if (String(line.discountMinor ?? "").trim())
        discountMinor = parseMoneyInput(line.discountMinor);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Enter valid estimate amounts.", true);
      return;
    }
    lines.push({
      productItemId: line.productItemId || null,
      ...(description ? { description } : {}),
      quantity: line.quantity || "1",
      ...(unitPriceMinor !== null ? { unitPriceMinor } : {}),
      ...(discountMinor !== null ? { discountMinor } : {}),
      ...(line.taxCodeId ? { taxCodeId: line.taxCodeId } : {})
    });
  }
  const response = await api("/v1/estimates", {
    ...jsonRequest({
      customerId: data.get("customerId"),
      issueDate: data.get("issueDate"),
      expiryDate: data.get("expiryDate") || null,
      estimateNumber: data.get("estimateNumber") || null,
      lines,
      customerFacingNotes: data.get("customerFacingNotes") || null,
      terms: data.get("terms") || null
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const estimate = (await response.json()).estimate;
  event.target.reset();
  setEstimateLineState([createInvoiceLine()]);
  renderDocumentLineEditor("estimate");
  await loadSales();
  renderEstimateNumberGuidance();
  showNotice("Estimate draft created. Review the customer preview before sending.");
  await previewEstimate(estimate);
  trackProductEvent("ESTIMATE_DRAFT_CREATED");
}

function renderEstimateRow(estimate) {
  const tr = document.createElement("tr");
  tr.append(
    cell(displayEstimateNumber(estimate)),
    cell(estimate.customerName),
    cell(estimate.status),
    cell(formatMinor(estimate.grandTotalMinor))
  );
  const actions = document.createElement("td");
  actions.append(commandButton("Preview", () => previewEstimate(estimate)));
  if (estimate.status === "DRAFT")
    actions.append(commandButton("Mark sent", () => sendEstimate(estimate)));
  if (["SENT", "VIEWED", "ACCEPTED"].includes(estimate.status))
    actions.append(
      runtimeCapabilities.emailDelivery
        ? commandButton("Email", () => emailEstimate(estimate))
        : commandButton("Send manually", explainManualEstimateSend)
    );
  if (["SENT", "VIEWED", "ACCEPTED"].includes(estimate.status))
    actions.append(
      commandButton(runtimeCapabilities.betaRuntime ? "Test link" : "Public link", () =>
        issuePublicEstimateLink(estimate)
      )
    );
  if (estimate.status === "ACCEPTED")
    actions.append(commandButton("Convert to invoice", () => convertEstimate(estimate)));
  tr.append(actions);
  return tr;
}

async function previewEstimate(estimate) {
  const response = await api(`/v1/estimates/${estimate.id}/preview`);
  if (!response.ok) return showError(response);
  const result = await response.json();
  const frame = document.createElement("iframe");
  frame.title = "Estimate preview";
  frame.sandbox = "";
  frame.srcdoc = result.html;
  elements["estimate-document-preview"].replaceChildren(frame);
  elements["estimate-preview-panel"].open = true;
  elements["estimate-preview-status"].textContent = "Preview ready";
  trackProductEvent("ESTIMATE_PREVIEW_VIEWED");
}

async function sendEstimate(estimate) {
  const response = await api(`/v1/estimates/${estimate.id}/send`, {
    ...jsonRequest({ version: estimate.version })
  });
  if (!response.ok) return showError(response);
  showNotice(
    "Estimate marked sent for your records. PennyWise Accounting did not deliver it; print the preview to PDF and send it through your own email service."
  );
  // A successful send is the authoritative user action. Refresh the surrounding
  // Sales workspace after acknowledging it so a slower browser or secondary
  // list request cannot leave the previous draft notice visible.
  void loadSales().catch(() => undefined);
}

async function emailEstimate(estimate) {
  if (!runtimeCapabilities.emailDelivery) return explainManualEstimateSend();
  const recipientEmail = window.prompt("Recipient email", estimate.customerEmail ?? "");
  if (!recipientEmail) return;
  const response = await api(`/v1/estimates/${estimate.id}/email`, {
    ...jsonRequest({ recipientEmail }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const result = await response.json();
  const link = document.createElement("a");
  link.href = result.publicUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Open the link included in the queued email";
  elements["estimate-document-preview"].replaceChildren(link);
  showNotice("Estimate email queued.");
}

function explainManualEstimateSend() {
  showNotice(
    "Use Preview and your browser's Print or Save as PDF command, then send that PDF through your own email service. Beta customer links are for local or controlled-share testing only. PennyWise Accounting did not send an email."
  );
}

async function issuePublicEstimateLink(estimate) {
  const response = await api(`/v1/estimates/${estimate.id}/public-link`, jsonRequest({}));
  if (!response.ok) return showError(response);
  const result = await response.json();
  const link = document.createElement("a");
  link.href = result.link.publicUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = runtimeCapabilities.betaRuntime
    ? "Open local or controlled-share test estimate"
    : "Open public estimate";
  elements["estimate-document-preview"].replaceChildren(link);
  showNotice(
    runtimeCapabilities.betaRuntime
      ? "Test link issued. A localhost link works only on this computer; a controlled-share link works only while that protected share is running. Print the preview to PDF for customer delivery."
      : "Public estimate link issued."
  );
}

async function convertEstimate(estimate) {
  const response = await api(
    `/v1/estimates/${estimate.id}/convert`,
    jsonRequest({ version: estimate.version }, "POST")
  );
  if (!response.ok) return showError(response);
  await loadSales();
  showNotice("Accepted estimate converted to a draft invoice.");
}

function renderInvoiceRow(invoice) {
  const tr = document.createElement("tr");
  const baseCurrency = invoice.baseCurrency ?? multiCurrencyState?.baseCurrency ?? "CAD";
  tr.append(
    cell(displayInvoiceNumber(invoice)),
    cell(invoice.customerNameSnapshot),
    cell(invoicePaymentStatus(invoice)),
    moneyCell(invoice.grandTotalMinor, invoice.currency),
    cell(invoice.currency),
    moneyCell(invoice.baseGrandTotalMinor ?? invoice.grandTotalMinor, baseCurrency)
  );
  const actions = document.createElement("td");
  actions.append(commandButton("Details", () => openInvoiceDetail(invoice)));
  if (invoice.status === "DRAFT") {
    if (activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES")) {
      const button = commandButton("Edit", () => editInvoiceDraft(invoice));
      button.dataset.invoiceAction = "edit";
      actions.append(button);
      const finalize = document.createElement("button");
      finalize.type = "button";
      finalize.className = "secondary-command";
      finalize.textContent = "Finalize";
      finalize.dataset.invoiceAction = "finalize";
      finalize.dataset.invoiceId = invoice.id;
      actions.append(finalize);
    }
  }
  const expertCommands = document.createElement("details");
  expertCommands.className = "invoice-expert-commands";
  const expertSummary = document.createElement("summary");
  expertSummary.textContent = "More";
  expertCommands.append(expertSummary);
  const expertMenu = document.createElement("div");
  expertMenu.className = "invoice-expert-command-list";
  expertMenu.append(commandButton("Preview", () => previewInvoice(invoice)));
  if (["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED"].includes(invoice.status)) {
    if (
      invoicePaymentStatus(invoice) !== "Paid" &&
      Number(invoice.outstandingBalanceMinor ?? 0) > 0
    ) {
      actions.append(commandButton("Record payment", () => openInvoicePaymentDialog(invoice)));
      actions.append(commandButton("Send reminder", () => sendInvoiceReminder(invoice)));
    }
    if (
      activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER") &&
      invoice.status === "POSTED" &&
      BigInt(invoice.amountPaidMinor ?? "0") === 0n
    )
      actions.append(commandButton("Void", () => openVoidInvoice(invoice)));
    if (
      activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER") &&
      ["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED"].includes(invoice.status)
    )
      actions.append(commandButton(t("invoice.creditNote"), () => openCreditNote(invoice)));
    expertMenu.append(commandButton("PDF", () => generateInvoicePdf(invoice)));
    actions.append(
      runtimeCapabilities.emailDelivery
        ? commandButton("Email", () => sendInvoice(invoice))
        : commandButton("Send from email app", () => downloadInvoiceForManualSend(invoice))
    );
    expertMenu.append(
      commandButton(runtimeCapabilities.betaRuntime ? "Test link" : "Public link", () =>
        issuePublicInvoiceLink(invoice)
      )
    );
    if (runtimeCapabilities.emailDelivery)
      expertMenu.append(commandButton("History", () => loadDeliveryHistory(invoice)));
  }
  expertCommands.append(expertMenu);
  actions.append(expertCommands);
  tr.append(actions);
  return tr;
}

function invoiceDetailSection(title, content) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading, content);
  return section;
}

async function openInvoiceDetail(invoice) {
  invoiceDetailSource = invoice;
  const content = elements["invoice-detail-content"];
  content.replaceChildren(rowText("Loading invoice details…"));
  const [invoiceResponse, deliveriesResponse, attachmentsResponse] = await Promise.all([
    api(`/v1/invoices/${invoice.id}`),
    api(`/v1/invoices/${invoice.id}/delivery-history`, {}, true),
    api(`/v1/invoices/${invoice.id}/attachments`, {}, true)
  ]);
  if (!invoiceResponse.ok) return showError(invoiceResponse);
  const detail = (await invoiceResponse.json()).invoice;
  const deliveries = deliveriesResponse.ok ? (await deliveriesResponse.json()).deliveries : [];
  const attachments = attachmentsResponse.ok ? (await attachmentsResponse.json()).attachments : [];
  const currency = detail.currency ?? invoice.currency ?? "CAD";
  elements["invoice-detail-heading"].textContent =
    `${detail.invoiceNumber ?? detail.provisionalIdentifier ?? "Invoice"} details`;
  elements["invoice-detail-summary"].textContent =
    `${detail.customerNameSnapshot} · ${invoicePaymentStatus(detail)} · total ${formatMinor(detail.grandTotalMinor, currency)} · open ${formatMinor(detail.outstandingBalanceMinor ?? "0", currency)}`;

  const totals = document.createElement("dl");
  for (const [label, value] of [
    ["Subtotal", formatMinor(detail.subtotalMinor, currency)],
    ["Tax", formatMinor(detail.taxTotalMinor, currency)],
    ["Paid", formatMinor(detail.amountPaidMinor ?? "0", currency)],
    [
      "Credited",
      formatMinor(
        detail.creditNotes?.reduce((sum, note) => sum + BigInt(note.grandTotalMinor), 0n) ?? 0n,
        currency
      )
    ],
    ["Balance", formatMinor(detail.outstandingBalanceMinor ?? "0", currency)]
  ]) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    totals.append(dt, dd);
  }

  const paymentsTable = document.createElement("table");
  paymentsTable.append(headerRow(["Date", "Status", "Amount", "Applied"]));
  const allocations = payments.flatMap((payment) =>
    (payment.allocations ?? [])
      .filter((allocation) => allocation.invoiceId === detail.id)
      .map((allocation) => ({ payment, allocation }))
  );
  for (const { payment, allocation } of allocations)
    paymentsTable.append(
      row([
        payment.paymentDate,
        payment.status,
        formatMinor(payment.amountMinor, payment.currency ?? currency),
        formatMinor(allocation.amountMinor, payment.currency ?? currency)
      ])
    );
  if (!allocations.length) paymentsTable.append(row(["No payments allocated", "", "", ""]));

  const deliveriesList = document.createElement("ul");
  if (!deliveries.length) deliveriesList.append(listItem("No delivery attempts recorded."));
  for (const delivery of deliveries)
    deliveriesList.append(
      listItem(
        `${delivery.recipientEmail ?? "recipient not recorded"}: ${delivery.status}; ${
          delivery.status === "MANUAL" ? "recorded" : "queued"
        } ${new Date(delivery.sentAt ?? delivery.queuedAt).toLocaleString()}; attempts ${delivery.attempts}`
      )
    );

  const attachmentsList = document.createElement("ul");
  if (!attachments.length) attachmentsList.append(listItem("No attachments."));
  for (const attachment of attachments) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/api${attachment.downloadUrl}`;
    link.textContent = `${attachment.fileName} (${attachment.mediaType})`;
    link.download = attachment.fileName;
    item.append(link);
    attachmentsList.append(item);
  }

  const creditsTable = document.createElement("table");
  creditsTable.append(headerRow(["Credit note", "Status", "Total", "Reason"]));
  for (const credit of detail.creditNotes ?? [])
    creditsTable.append(
      row([
        credit.creditNoteNumber ?? credit.id.slice(0, 8),
        credit.status,
        formatMinor(credit.grandTotalMinor, currency),
        credit.reason ?? ""
      ])
    );
  if (!(detail.creditNotes ?? []).length)
    creditsTable.append(row(["No posted credit notes", "", "", ""]));

  const journal = document.createElement("p");
  journal.textContent = detail.journalId
    ? `Posted journal: ${detail.journalId}`
    : "No posted journal yet.";
  if (detail.journalId) {
    const link = document.createElement("a");
    link.href = "#accountant-workspace";
    link.textContent = " Open Accountant workspace";
    link.addEventListener("click", () => navigateTo("accountant-workspace"), { once: true });
    journal.append(link);
  }
  content.replaceChildren(
    invoiceDetailSection("Totals and balance", totals),
    invoiceDetailSection("Payments and allocations", paymentsTable),
    invoiceDetailSection("Delivery history", deliveriesList),
    invoiceDetailSection("Attachments", attachmentsList),
    invoiceDetailSection("Linked credit notes", creditsTable),
    invoiceDetailSection("Books link", journal)
  );
  const resend = elements["invoice-detail-resend"];
  resend.hidden = ![
    "POSTED",
    "PARTIALLY_PAID",
    "PAID",
    "OVERDUE",
    "PARTIALLY_CREDITED",
    "CREDITED"
  ].includes(detail.status);
  resend.textContent = runtimeCapabilities.emailDelivery
    ? "Resend email"
    : "Send again from email app";
  resend.onclick = () => resendInvoice(detail);
  const revoke = elements["invoice-detail-revoke-link"];
  const knownLink = invoicePublicLinks.get(detail.id);
  revoke.hidden =
    !knownLink || !activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES");
  revoke.onclick = () => revokeInvoicePublicLink(detail, knownLink);
  const attachmentForm = elements["invoice-detail-attachment-form"];
  const canUploadAttachment =
    ["DRAFT", "APPROVED"].includes(detail.status) &&
    activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES");
  attachmentForm.hidden = false;
  const attachmentInput = attachmentForm.querySelector('input[name="file"]');
  const attachmentLabel = attachmentInput?.closest("label");
  if (attachmentLabel) attachmentLabel.hidden = !canUploadAttachment;
  const attachmentSubmit = attachmentForm.querySelector('button[type="submit"]');
  if (attachmentSubmit) attachmentSubmit.hidden = !canUploadAttachment;
  const dialog = elements["invoice-detail-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

async function uploadInvoiceDetailAttachment(event) {
  event.preventDefault();
  if (!invoiceDetailSource) return;
  const form = event.currentTarget;
  const file = form.elements.file.files?.[0];
  if (!file) return showNotice("Choose an attachment first.", true);
  const response = await api(`/v1/invoices/${invoiceDetailSource.id}/attachments`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", "x-file-name": file.name },
    body: await file.arrayBuffer()
  });
  if (!response.ok) return showError(response);
  form.reset();
  await openInvoiceDetail(invoiceDetailSource);
  showNotice("Invoice attachment uploaded.");
}

async function resendInvoice(invoice) {
  openInvoiceSendDialog(invoice, runtimeCapabilities.emailDelivery ? "email" : "manual", true);
}

async function revokeInvoicePublicLink(invoice, link) {
  if (!link?.id || !window.confirm("Revoke this customer link? Anyone using it will lose access."))
    return;
  const response = await api(
    `/v1/invoices/${invoice.id}/public-links/${link.id}/revoke`,
    jsonRequest({})
  );
  if (!response.ok) return showError(response);
  invoicePublicLinks.delete(invoice.id);
  await openInvoiceDetail(invoice);
  showNotice("Public invoice link revoked.");
}

function invoicePaymentStatus(invoice) {
  if (invoice.status === "VOIDED" || invoice.status === "VOID") return "Void";
  if (invoice.status === "DRAFT" || invoice.status === "APPROVED") return "Draft";
  const outstanding = BigInt(invoice.outstandingBalanceMinor ?? "0");
  if (invoice.status === "PAID" || outstanding === 0n) return "Paid";
  if (BigInt(invoice.amountPaidMinor ?? "0") > 0n) return "Partially paid";
  if (invoice.dueDate && invoice.dueDate < new Date().toISOString().slice(0, 10)) return "Overdue";
  return "Awaiting payment";
}

function openVoidInvoice(invoice) {
  voidInvoiceSource = invoice;
  const form = elements["void-invoice-form"];
  form.reset();
  elements["void-invoice-source"].textContent =
    `${invoice.invoiceNumber ?? invoice.provisionalIdentifier} | ${invoice.customerNameSnapshot} | ${formatMinor(invoice.grandTotalMinor, invoice.currency)}`;
  elements["void-invoice-status"].textContent = "";
  const dialog = elements["void-invoice-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  form.elements.reason.focus();
}

async function voidInvoice(event) {
  event.preventDefault();
  if (!voidInvoiceSource) return showNotice("Choose an invoice to void.", true);
  const form = event.currentTarget;
  const reason = String(new FormData(form).get("reason") ?? "").trim();
  if (!reason) return showNotice("A reason is required to void an invoice.", true);
  const submit = elements["void-invoice-submit"];
  submit.disabled = true;
  elements["void-invoice-status"].textContent = "Reversing the posted receivables journal…";
  try {
    const response = await api(`/v1/invoices/${voidInvoiceSource.id}/void`, {
      ...jsonRequest({ version: voidInvoiceSource.version, reason }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID()
      }
    });
    if (!response.ok) {
      elements["void-invoice-status"].textContent =
        "This invoice could not be voided. If a payment was applied, use Credit note instead.";
      return showError(response);
    }
    elements["void-invoice-dialog"].close();
    voidInvoiceSource = null;
    await loadSales();
    showNotice("Invoice voided and the posted journal was reversed.");
  } finally {
    submit.disabled = false;
    elements["void-invoice-status"].textContent = "";
  }
}

function openCreditNote(invoice) {
  void loadCreditNoteSource(invoice);
}

async function loadCreditNoteSource(invoice) {
  const response = await api(`/v1/invoices/${invoice.id}`);
  if (!response.ok) return showError(response);
  creditNoteSource = (await response.json()).invoice;
  const form = elements["credit-note-form"];
  form.reset();
  form.elements.issueDate.value = new Date().toISOString().slice(0, 10);
  form.elements.fullCredit.checked = true;
  renderCreditNoteLines(creditNoteSource);
  elements["credit-note-line-selection"].hidden = true;
  elements["credit-note-source"].textContent =
    `${t("creditNote.source")}: ${creditNoteSource.invoiceNumber ?? creditNoteSource.provisionalIdentifier} | ${creditNoteSource.customerNameSnapshot} | ${formatMinor(creditNoteSource.grandTotalMinor, creditNoteSource.currency)}`;
  elements["credit-note-status"].textContent = "";
  const dialog = elements["credit-note-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  form.elements.reason.focus();
}

function creditNoteRemainingByLine(invoice) {
  const credited = new Map();
  for (const note of invoice.creditNotes ?? [])
    for (const line of note.lines ?? [])
      credited.set(
        line.invoiceLineId,
        (credited.get(line.invoiceLineId) ?? 0n) + BigInt(line.totalMinor ?? "0")
      );
  return credited;
}

function renderCreditNoteLines(invoice) {
  const container = elements["credit-note-lines"];
  const credited = creditNoteRemainingByLine(invoice);
  const lines = (invoice.lines ?? []).filter((line) => {
    try {
      return BigInt(line.totalMinor ?? "0") - (credited.get(line.id) ?? 0n) > 0n;
    } catch {
      return false;
    }
  });
  if (!lines.length) {
    container.replaceChildren(rowText("No invoice lines remain eligible for credit."));
    return;
  }
  container.replaceChildren(
    ...lines.map((line) => {
      const remaining = BigInt(line.totalMinor) - (credited.get(line.id) ?? 0n);
      const wrapper = document.createElement("div");
      wrapper.className = "credit-note-line-choice";
      const label = document.createElement("label");
      label.className = "check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.creditLineId = line.id;
      checkbox.checked = true;
      const description = document.createElement("span");
      description.textContent =
        `${line.lineNumber ?? ""} ${line.description ?? "Invoice line"} — eligible ${formatMinor(remaining, invoice.currency)}`.trim();
      label.append(checkbox, description);
      const amountLabel = document.createElement("label");
      amountLabel.textContent = "Amount";
      const amount = document.createElement("input");
      amount.type = "text";
      amount.inputMode = "decimal";
      amount.value = minorToInput(remaining);
      amount.dataset.creditLineAmount = line.id;
      amount.setAttribute("aria-label", `Credit amount for ${line.description ?? "invoice line"}`);
      amountLabel.append(amount);
      wrapper.append(label, amountLabel);
      return wrapper;
    })
  );
}

async function createAndPostCreditNote(event) {
  event.preventDefault();
  if (!creditNoteSource) return showNotice(t("creditNote.chooseInvoice"), true);
  const form = event.currentTarget;
  const submit = elements["credit-note-submit"];
  const data = new FormData(form);
  const fullCredit = data.get("fullCredit") === "on";
  let creditLines = [];
  if (!fullCredit) {
    try {
      creditLines = [...form.querySelectorAll("[data-credit-line-id]:checked")].map((checkbox) => {
        const amountField = checkbox
          .closest(".credit-note-line-choice")
          ?.querySelector("[data-credit-line-amount]");
        if (!(amountField instanceof globalThis.HTMLInputElement))
          throw new Error("Choose a credit amount for every selected line.");
        return {
          invoiceLineId: checkbox.dataset.creditLineId,
          amountMinor: parseMoneyInput(amountField.value)
        };
      });
      if (!creditLines.length) throw new Error("Select at least one invoice line to credit.");
    } catch (error) {
      submit.disabled = false;
      elements["credit-note-status"].textContent = "";
      return showNotice(
        error instanceof Error ? error.message : "Enter valid credit amounts.",
        true
      );
    }
  }
  submit.disabled = true;
  elements["credit-note-status"].textContent = t("creditNote.creating");
  try {
    const createResponse = await api(`/v1/invoices/${creditNoteSource.id}/credit-notes`, {
      ...jsonRequest({
        issueDate: data.get("issueDate"),
        reason: data.get("reason"),
        fullCredit,
        ...(fullCredit ? {} : { lines: creditLines })
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID()
      }
    });
    if (!createResponse.ok) return showError(createResponse);
    const { creditNote } = await createResponse.json();
    const postResponse = await api(`/v1/credit-notes/${creditNote.id}/post`, {
      ...jsonRequest({ version: creditNote.version }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID()
      }
    });
    if (!postResponse.ok) return showError(postResponse);
    elements["credit-note-dialog"].close();
    creditNoteSource = null;
    await Promise.all([loadSales(), loadPayments()]);
    showNotice(t("creditNote.posted"));
  } finally {
    submit.disabled = false;
    elements["credit-note-status"].textContent = "";
  }
}

async function handleInvoiceTableAction(event) {
  const button = event.target.closest("[data-invoice-action]");
  if (!(button instanceof globalThis.HTMLButtonElement)) return;
  if (button.disabled) return;
  const invoice = invoices.find((candidate) => candidate.id === button.dataset.invoiceId);
  if (!invoice) return showNotice("Refresh Sales and try that invoice again.", true);
  button.disabled = true;
  showNotice("Posting invoice…");
  try {
    if (button.dataset.invoiceAction === "finalize") await finalizeInvoice(invoice);
    if (button.dataset.invoiceAction === "post") await postInvoice(invoice);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function previewInvoice(invoice) {
  const response = await api(`/v1/invoices/${invoice.id}/preview`);
  if (!response.ok) return showError(response);
  const result = await response.json();
  setActivePreviewInvoice(invoice);
  trackProductEvent("INVOICE_PREVIEW_VIEWED");
  const frame = document.createElement("iframe");
  frame.title = "Invoice preview";
  frame.sandbox = "allow-same-origin allow-modals";
  frame.srcdoc = result.html;
  elements["invoice-document-preview"].replaceChildren(frame);
  elements["invoice-preview-panel"].open = true;
  elements["invoice-preview-status"].textContent = "Preview ready";
  renderInvoiceNumberStatus(invoice);
  elements["print-invoice-preview"].disabled = false;
  elements["record-preview-invoice-payment"].hidden =
    !["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status) ||
    BigInt(invoice.outstandingBalanceMinor ?? "0") <= 0n;
  elements["invoice-preview-integrity"].textContent =
    `Immutable snapshot ${result.renderDataHash.slice(0, 12)} - preview, public link, and PDF share this design.`;
  if (["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED"].includes(invoice.status))
    await loadInvoiceBooksImpact(invoice);
}

async function loadInvoiceBooksImpact(invoice) {
  const response = await api(`/v1/invoices/${invoice.id}/books-impact`);
  if (!response.ok) return showError(response);
  const impact = (await response.json()).impact;
  const currency = impact.currency;
  elements["invoice-books-impact-summary"].textContent =
    `Receivables increased by ${formatMinor(impact.totals.receivablesDebitMinor, currency)}; revenue is ${formatMinor(impact.totals.revenueCreditMinor, currency)} and tax payable is ${formatMinor(impact.totals.taxPayableCreditMinor, currency)}.`;
  const table = document.createElement("table");
  table.innerHTML =
    '<caption class="sr-only">Posted journal entries</caption><thead><tr><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>';
  const body = document.createElement("tbody");
  for (const entry of impact.entries) {
    const row = document.createElement("tr");
    row.append(
      cell(`${entry.accountCode} ${entry.accountName}`),
      cell(entry.description ?? ""),
      cell(formatMinor(entry.debitMinor, currency)),
      cell(formatMinor(entry.creditMinor, currency))
    );
    body.append(row);
  }
  table.append(body);
  elements["invoice-books-impact-entries"].replaceChildren(table);
  const link = elements["invoice-books-impact-link"];
  link.hidden = false;
  link.href = "#accountant-workspace";
  link.textContent = `Open posted journal ${impact.journalId.slice(0, 8)} in Accountant`;
  link.addEventListener(
    "click",
    () => document.querySelector('[data-workspace-target="accountant-workspace"]')?.click(),
    { once: true }
  );
  elements["invoice-books-impact"].hidden = false;
}

function printInvoicePreview() {
  const frame = elements["invoice-document-preview"].querySelector("iframe");
  if (!frame?.contentWindow) {
    showNotice("Create or reopen an invoice preview before printing.", true);
    return;
  }
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

async function generateInvoicePdf(invoice, successMessage) {
  const response = await api(`/v1/invoices/${invoice.id}/pdf`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    },
    body: "{}"
  });
  if (!response.ok) return showError(response);
  const artifact = (await response.json()).artifact;
  const download = await api(`/v1/invoices/${invoice.id}/pdf`);
  if (!download.ok) return showError(download);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await download.blob());
  link.download = `${invoice.invoiceNumber ?? invoice.provisionalIdentifier}.pdf`;
  link.click();
  URL.revokeObjectURL(link.href);
  showNotice(successMessage ?? `PDF generated (${artifact.checksum.slice(0, 12)}).`);
  return true;
}

async function downloadInvoiceForManualSend(invoice) {
  openInvoiceSendDialog(invoice, "manual");
}

async function sendInvoice(invoice) {
  openInvoiceSendDialog(invoice, runtimeCapabilities.emailDelivery ? "email" : "manual");
}

function sendInvoiceReminder(invoice) {
  openInvoiceSendDialog(
    invoice,
    runtimeCapabilities.emailDelivery ? "reminder" : "reminder-manual"
  );
}

function invoiceMergeValue(invoice, key) {
  const organization = invoice.organizationSnapshot;
  const organizationName =
    organization && typeof organization === "object" && !Array.isArray(organization)
      ? (organization.displayName ?? organization.legalName)
      : null;
  return (
    {
      customer_name: invoice.customerNameSnapshot ?? "customer",
      invoice_number: invoice.invoiceNumber ?? invoice.provisionalIdentifier ?? "invoice",
      amount_due: formatMinor(
        invoice.outstandingBalanceMinor ?? invoice.grandTotalMinor,
        invoice.currency
      ),
      due_date: invoice.dueDate
        ? formatOwnerDate(invoice.dueDate)
        : "the due date shown on the invoice",
      business_name: organizationName ?? "PennyWise Accounting",
      payment_instructions: "Please see the attached invoice for payment instructions."
    }[key] ?? "{" + key + "}"
  );
}

function renderInvoiceMessageTemplate(invoice) {
  return "Hello {customer_name},\n\nPlease find invoice {invoice_number} attached for {amount_due}, due {due_date}.\n\n{payment_instructions}\n\nThank you,\n{business_name}".replace(
    /{([a-z_]+)}/g,
    (_match, key) => invoiceMergeValue(invoice, key)
  );
}

function renderReminderMessageTemplate(invoice) {
  const customer = customers.find((candidate) => candidate.id === invoice.customerId);
  return `Hello ${customer?.displayName ?? invoice.customerNameSnapshot ?? "customer"},\n\nJust a friendly reminder that invoice ${invoice.invoiceNumber ?? invoice.provisionalIdentifier} is still outstanding. Please let us know if you need anything to complete payment.\n\nThank you.`;
}

function openInvoiceSendDialog(invoice, mode, resend = false) {
  invoiceSendSource = invoice;
  invoiceSendMode = mode;
  invoiceSendResend = resend;
  const form = elements["invoice-send-form"];
  const customer = customers.find((candidate) => candidate.id === invoice.customerId);
  form.reset();
  form.elements.recipientEmails.value = invoice.customerEmailSnapshot ?? customer?.email ?? "";
  form.elements.ccMe.checked = Boolean(localIdentityEmail);
  const reminder = mode.startsWith("reminder");
  const manual = mode === "manual" || mode === "reminder-manual";
  form.elements.subject.value =
    (resend ? "Resend: " : reminder ? "Payment reminder: " : "Invoice ") +
    (invoice.invoiceNumber ?? invoice.provisionalIdentifier);
  form.elements.message.value = reminder
    ? renderReminderMessageTemplate(invoice)
    : renderInvoiceMessageTemplate(invoice);
  elements["invoice-send-heading"].textContent = !manual
    ? resend
      ? "Resend invoice"
      : reminder
        ? "Send payment reminder"
        : "Send invoice"
    : reminder
      ? "Send payment reminder from your own email app"
      : "Send from your own email app";
  elements["invoice-send-description"].textContent = !manual
    ? reminder
      ? "Review the reminder and recipient. PennyWise will queue the invoice PDF through the configured delivery mailbox."
      : "Review the recipients and message. PennyWise will queue the PDF attachment for the selected sending mailbox."
    : "PennyWise will download the PDF, copy the prepared message, and open your email app. Attach the PDF there, then mark this delivery as sent.";
  elements["invoice-send-source"].textContent =
    (invoice.invoiceNumber ?? invoice.provisionalIdentifier) +
    " · " +
    (invoice.customerNameSnapshot ?? "Customer");
  elements["invoice-send-status"].textContent = "";
  elements["invoice-send-prepare"].hidden = !manual;
  elements["invoice-send-submit"].hidden = manual;
  elements["invoice-send-submit"].textContent = reminder
    ? "Queue reminder"
    : resend
      ? "Queue resend"
      : "Send invoice email";
  elements["invoice-send-mark-manual"].hidden = !manual;
  const dialog = elements["invoice-send-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  form.elements.recipientEmails.focus();
}

function invoiceSendRecipients(form) {
  const values = String(form.elements.recipientEmails.value ?? "")
    .split(/[;,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (form.elements.ccMe.checked && localIdentityEmail) values.push(localIdentityEmail);
  const unique = [...new Set(values.map((value) => value.toLowerCase()))];
  if (!unique.length || unique.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))
    throw new Error("Enter one or more valid recipient email addresses.");
  return unique;
}

async function prepareManualInvoiceEmail() {
  if (!invoiceSendSource) return;
  const form = elements["invoice-send-form"];
  let recipients;
  try {
    recipients = invoiceSendRecipients(form);
  } catch (error) {
    return showNotice(error instanceof Error ? error.message : "Enter valid recipients.", true);
  }
  const subject = String(form.elements.subject.value ?? "").trim();
  const message = String(form.elements.message.value ?? "").trim();
  if (!subject || !message) return showNotice("Enter a subject and message first.", true);
  const generated = await generateInvoicePdf(
    invoiceSendSource,
    "PDF downloaded. Attach it in your email app."
  );
  if (generated !== true) return;
  try {
    await globalThis.navigator?.clipboard?.writeText(message);
  } catch {
    // Clipboard permissions vary on installed builds; the message remains visible for copying.
  }
  const query = new URLSearchParams({ subject, body: message });
  window.location.href =
    "mailto:" + encodeURIComponent(recipients.join(",")) + "?" + query.toString();
  elements["invoice-send-status"].textContent =
    "The PDF was downloaded and the prepared message was copied when permitted. Attach the PDF, send it, then choose Mark as sent.";
}

async function markInvoiceManualDelivery() {
  if (!invoiceSendSource) return;
  const form = elements["invoice-send-form"];
  let recipients;
  try {
    recipients = invoiceSendRecipients(form);
  } catch (error) {
    return showNotice(error instanceof Error ? error.message : "Enter valid recipients.", true);
  }
  const subject = String(form.elements.subject.value ?? "").trim();
  const message = String(form.elements.message.value ?? "").trim();
  if (!subject || !message) return showNotice("Enter a subject and message first.", true);
  const reminder = invoiceSendMode.startsWith("reminder");
  const response = await api(
    "/v1/invoices/" + invoiceSendSource.id + (reminder ? "/manual-reminder" : "/manual-delivery"),
    {
      ...jsonRequest(
        reminder
          ? { recipientEmail: recipients[0], subject, message }
          : { recipientEmails: recipients, subject, message }
      ),
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID()
      }
    }
  );
  if (!response.ok) return showError(response);
  elements["invoice-send-dialog"].close();
  await loadSales();
  showNotice(
    reminder
      ? "Manual reminder recorded. PennyWise did not send the email."
      : "Manual delivery recorded. PennyWise did not send the email."
  );
}

async function submitInvoiceSend(event) {
  event.preventDefault();
  if (!invoiceSendSource || !["email", "reminder"].includes(invoiceSendMode)) return;
  const form = event.currentTarget;
  let recipients;
  try {
    recipients = invoiceSendRecipients(form);
  } catch (error) {
    return showNotice(error instanceof Error ? error.message : "Enter valid recipients.", true);
  }
  const subject = String(form.elements.subject.value ?? "").trim();
  const message = String(form.elements.message.value ?? "").trim();
  if (!subject || !message) return showNotice("Enter a subject and message first.", true);
  const submit = elements["invoice-send-submit"];
  submit.disabled = true;
  try {
    const responses = await Promise.all(
      recipients.map((recipientEmail) =>
        api(
          "/v1/invoices/" +
            invoiceSendSource.id +
            "/" +
            (invoiceSendMode === "reminder" ? "reminder" : invoiceSendResend ? "resend" : "send"),
          {
            ...jsonRequest({ recipientEmail, subject, message }),
            headers: {
              "content-type": "application/json",
              "idempotency-key": globalThis.crypto.randomUUID()
            }
          }
        )
      )
    );
    const failed = responses.find((response) => !response.ok);
    if (failed) return showError(failed);
    elements["invoice-send-dialog"].close();
    showNotice(
      invoiceSendMode === "reminder" ? "Payment reminder queued." : "Invoice email queued."
    );
    trackProductEvent(
      invoiceSendMode === "reminder" ? "INVOICE_REMINDER_REQUESTED" : "INVOICE_DELIVERY_REQUESTED"
    );
  } finally {
    submit.disabled = false;
  }
}

async function issuePublicInvoiceLink(invoice) {
  const response = await api(`/v1/invoices/${invoice.id}/public-link`, jsonRequest({}));
  if (!response.ok) return showError(response);
  const result = await response.json();
  invoicePublicLinks.set(invoice.id, result.link);
  const link = document.createElement("a");
  link.href = result.publicUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = runtimeCapabilities.betaRuntime
    ? "Open local or controlled-share test invoice"
    : "Open public invoice";
  elements["invoice-document-preview"].replaceChildren(link);
  showNotice(
    runtimeCapabilities.betaRuntime
      ? "Test link issued. A localhost link works only on this computer; a controlled-share link works only while that protected share is running. Use the PDF for customer delivery."
      : "Public invoice link issued."
  );
}

async function loadDeliveryHistory(invoice) {
  const response = await api(`/v1/invoices/${invoice.id}/delivery-history`);
  if (!response.ok) return showError(response);
  const result = await response.json();
  elements["delivery-history"].textContent = result.deliveries
    .map((delivery) => `${delivery.recipientEmail}: ${delivery.status} (${delivery.attempts})`)
    .join(" | ");
}

async function postInvoice(invoice) {
  const response = await api(`/v1/invoices/${invoice.id}/post`, {
    ...jsonRequest({ version: invoice.version }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  await loadSales();
  await loadPayments();
  showNotice("Invoice posted to the receivables ledger.");
}
