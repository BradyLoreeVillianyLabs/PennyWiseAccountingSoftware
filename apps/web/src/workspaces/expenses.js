// Purchases and payables (the classic `purchases-workspace`).

import { formatMinor, parseMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { completeContextualCreation } from "../lib/contextual-creation.js";
import { enhanceCreatableSelect } from "../lib/creatable-select.js";
import {
  renderBillCurrencyControls,
  renderBillPaymentCurrencyControls
} from "../lib/currency-controls.js";
import { billLineState, createInvoiceLine, setBillLineState } from "../lib/document-lines.js";
import { commandButton, moneyCell, moneyFromForm, option, row } from "../lib/dom.js";
import { applySavedTableFilters, clearBrowserFormDraft } from "../lib/forms.js";
import { showError, showNotice } from "../lib/notices.js";
import { activeRoleIs, formatRole } from "../lib/roles.js";
import {
  registerWorkspaceCalls,
  renderDocumentLineEditor,
  reviewCapture,
  syncDocumentLineStateFromDom
} from "../lib/workspace-calls.js";
import { navigateTo, refreshContextualSearches } from "../shell.js";
import {
  accounts,
  bills,
  elements,
  multiCurrencyState,
  products,
  purchaseRequests,
  setBills,
  setPurchaseRequests,
  setVendors,
  vendors
} from "../state.js";

let evidenceCaptures = [];
let activeCaptureConversion = null;
let captureEvidenceObjectUrl = null;
const captureConversionIdempotencyKeys = new Map();

registerWorkspaceCalls({
  loadEvidenceInbox,
  loadPurchases,
  renderBillDuplicateWarning,
  renderPurchaseSelects
});

export function initExpenses() {
  elements["refresh-purchases"].addEventListener("click", loadPurchases);
  elements["refresh-evidence-inbox"].addEventListener("click", loadEvidenceInbox);
  elements["evidence-filter-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    void loadEvidenceInbox();
  });
  elements["close-capture-conversion"].addEventListener("click", closeCaptureConversionDialog);
  elements["download-capture-evidence"].addEventListener("click", () => {
    if (activeCaptureConversion) void downloadCapture(activeCaptureConversion.capture);
  });
  elements["capture-conversion-dialog"].addEventListener("close", clearCaptureConversionDialog);
  elements["capture-conversion-form"].addEventListener("submit", convertCaptureToDraft);
  elements["capture-conversion-form"]
    .querySelectorAll('input[name="target"]')
    .forEach((input) => input.addEventListener("change", renderCaptureConversionTarget));
  for (const field of ["issueDate", "dueDate"])
    elements["capture-conversion-form"].elements[field].addEventListener(
      "change",
      validateCaptureConversionDates
    );
  elements["open-capture-linked-draft"].addEventListener("click", openCaptureLinkedDraft);
  elements["purchase-request-form"].addEventListener("submit", createPurchaseRequest);
  elements["vendor-form"].addEventListener("submit", createVendor);
  elements["bill-form"].addEventListener("submit", createBill);
  elements["bill-clear-browser-draft"].addEventListener("click", () =>
    clearBrowserFormDraft("bill-form")
  );
  elements["bill-form"].elements.vendorInvoiceNumber.addEventListener(
    "input",
    renderBillDuplicateWarning
  );
  for (const field of ["vendorId", "currency", "issueDate"])
    elements["bill-form"].elements[field].addEventListener("change", renderBillCurrencyControls);
  elements["bill-form"].elements.vendorId.addEventListener("change", renderBillDuplicateWarning);
  elements["expense-form"].addEventListener("submit", recordExpense);
  elements["bill-payment-form"].addEventListener("submit", recordBillPayment);
  for (const field of ["billId", "paymentDate"])
    elements["bill-payment-form"].elements[field].addEventListener(
      "change",
      renderBillPaymentCurrencyControls
    );
  elements["vendor-credit-form"].addEventListener("submit", createAndApplyVendorCredit);
}

function captureReviewListUrl() {
  const form = elements["evidence-filter-form"];
  const params = new URLSearchParams();
  for (const field of ["status", "kind", "conversion"]) {
    const value = String(form.elements[field].value || "");
    if (value) params.set(field, value);
  }
  const query = params.toString();
  return query ? `/v1/capture-reviews?${query}` : "/v1/capture-reviews";
}

export async function loadPurchases() {
  const [vendorResponse, billResponse, agingResponse, capturesResponse, requestsResponse] =
    await Promise.all([
      api("/v1/vendors"),
      api("/v1/bills"),
      api("/v1/payables/aging"),
      api(captureReviewListUrl()),
      api("/v1/purchase-requests")
    ]);
  // A new company can create vendors and draft bills before it has selected its
  // starting accounts. The aging projection is unavailable in that state, but
  // it must not prevent the supplier and account selectors from refreshing.
  if (![vendorResponse, billResponse].every((response) => response.ok)) return;
  setVendors((await vendorResponse.json()).vendors);
  setBills((await billResponse.json()).bills);
  elements.vendors.replaceChildren(
    ...vendors.map((vendor) =>
      row([vendor.vendorNumber, vendor.displayName, vendor.isActive ? "Active" : "Archived"])
    )
  );
  elements.bills.replaceChildren(...bills.map(renderBillRow));
  setPurchaseRequests(requestsResponse.ok ? (await requestsResponse.json()).purchaseRequests : []);
  elements["purchase-requests"].replaceChildren(...purchaseRequests.map(renderPurchaseRequestRow));
  renderPurchaseSelects();
  if (agingResponse.ok) {
    const payables = (await agingResponse.json()).payables;
    elements["payables-aging"].textContent =
      `Current ${payables.aging.current} | 1-30 ${payables.aging.days1To30} | ` +
      `31-60 ${payables.aging.days31To60} | 61-90 ${payables.aging.days61To90} | ` +
      `90+ ${formatMinor(payables.aging.over90)} | GL difference ${formatMinor(payables.discrepancyMinor)}`;
  } else {
    elements["payables-aging"].textContent =
      "Accounts-payable aging will be available after you choose your starting accounts.";
  }
  renderBillDuplicateWarning();
  if (capturesResponse.ok) {
    evidenceCaptures = (await capturesResponse.json()).captures;
    renderEvidenceInbox();
  }
  applySavedTableFilters();
  refreshContextualSearches();
}

function renderPurchaseRequestRow(request) {
  const actions = document.createElement("span");
  const canCreate = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES");
  const canApprove = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT");
  if (request.status === "DRAFT" && canCreate)
    actions.append(commandButton("Submit", () => transitionPurchaseRequest(request, "submit")));
  if (request.status === "SUBMITTED" && canApprove) {
    actions.append(commandButton("Approve", () => transitionPurchaseRequest(request, "approve")));
    actions.append(commandButton("Reject", () => transitionPurchaseRequest(request, "reject")));
  }
  if (["DRAFT", "SUBMITTED", "APPROVED"].includes(request.status) && canCreate)
    actions.append(commandButton("Cancel", () => transitionPurchaseRequest(request, "cancel")));
  return row([
    request.requestNumber,
    request.purpose,
    request.vendorName ?? "Vendor not selected",
    formatMinor(request.totalMinor),
    formatRole(request.status),
    actions
  ]);
}

async function createPurchaseRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const unitCostMinor = moneyFromForm(data, "unitCostMinor");
  const quantity = String(data.get("quantity") ?? "").trim();
  if (unitCostMinor === null || !/^\d+(?:\.\d{1,6})?$/.test(quantity)) {
    if (unitCostMinor !== null)
      showNotice("Quantity must be positive with at most six decimals.", true);
    return;
  }
  const response = await api(
    "/v1/purchase-requests",
    jsonRequest({
      requestNumber: data.get("requestNumber"),
      vendorId: data.get("vendorId") || null,
      requestedDate: data.get("requestedDate"),
      neededByDate: data.get("neededByDate") || null,
      purpose: data.get("purpose"),
      lines: [
        {
          description: data.get("description"),
          quantity,
          unitCostMinor,
          accountId: data.get("accountId") || null
        }
      ]
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  await loadPurchases();
  showNotice("Purchase request draft created.");
}

async function transitionPurchaseRequest(request, action) {
  let decisionNote = null;
  if (action === "approve" || action === "reject" || action === "cancel") {
    decisionNote = window.prompt(
      action === "approve"
        ? "Approval note (optional)"
        : action === "reject"
          ? "Reason for rejection (required)"
          : "Reason for cancellation (required)"
    );
    if (decisionNote === null) return;
    if ((action === "reject" || action === "cancel") && !decisionNote.trim())
      return showNotice("Enter a reason before continuing.", true);
  }
  const response = await api(
    `/v1/purchase-requests/${request.id}/${action}`,
    jsonRequest(
      {
        version: request.version,
        ...(decisionNote ? { decisionNote } : {})
      },
      "POST"
    )
  );
  if (!response.ok) return showError(response);
  await loadPurchases();
  const messages = {
    submit: "submitted",
    approve: "approved",
    reject: "rejected",
    cancel: "cancelled"
  };
  showNotice(`Purchase request ${messages[action]}.`);
}

async function loadEvidenceInbox() {
  const response = await api(captureReviewListUrl());
  if (!response.ok) return showError(response);
  evidenceCaptures = (await response.json()).captures;
  renderEvidenceInbox();
}

function renderEvidenceInbox() {
  const summary = elements["evidence-inbox-summary"];
  if (summary) {
    const linked = evidenceCaptures.filter((capture) => capture.conversion).length;
    const reviewRequired = evidenceCaptures.filter((capture) =>
      ["RECEIVED", "REVIEW_REQUIRED"].includes(capture.status)
    ).length;
    summary.textContent = `${evidenceCaptures.length} evidence item(s) shown · ${reviewRequired} awaiting review · ${linked} linked to drafts`;
  }
  elements["evidence-inbox"].replaceChildren(
    ...evidenceCaptures.map((capture) => {
      const actions = document.createElement("div");
      actions.className = "capture-inbox-actions";
      actions.append(commandButton("Preview source", () => openCaptureConversionDialog(capture)));
      if (["REVIEW_REQUIRED", "RECEIVED"].includes(capture.status)) {
        actions.append(commandButton("Approve", () => reviewCapture(capture, "APPROVED")));
        actions.append(commandButton("Reject", () => reviewCapture(capture, "REJECTED")));
      }
      if (!capture.conversion && capture.processingState !== "VALIDATED")
        actions.append(commandButton("Reprocess locally", () => processCaptureLocally(capture)));
      const eligibility = captureConversionEligibility(capture);
      if (capture.conversion) {
        const completed = commandButton("Draft already created", () => {});
        completed.disabled = true;
        completed.title = "Exactly one draft is linked to this evidence.";
        actions.append(completed);
        actions.append(
          commandButton("View linked draft", () => openCaptureConversionDialog(capture))
        );
      } else {
        const convert = commandButton(
          eligibility.target === "BILL" ? "Create bill draft" : "Create expense draft",
          () => openCaptureConversionDialog(capture)
        );
        convert.disabled = !eligibility.ready;
        convert.title = eligibility.message;
        actions.append(convert);
      }
      const source = document.createElement("div");
      source.className = "capture-source-summary";
      const sourceTitle = document.createElement("strong");
      sourceTitle.textContent = capture.mediaType || "Stored document";
      const sourceNote = document.createElement("small");
      sourceNote.textContent = capture.ocrConfidence
        ? `${capture.processingState ?? "PROCESSING"} - local evidence ${Math.round(Number(capture.ocrConfidence) * 100)}% confidence`
        : `${capture.processingState ?? "CAPTURED"} - Original file retained`;
      source.append(sourceTitle, sourceNote);
      const reviewState = document.createElement("div");
      reviewState.className = "capture-status-stack";
      reviewState.append(
        captureStatusTag(
          formatRole(capture.status),
          capture.status === "APPROVED" ? "ready" : "review"
        ),
        captureStatusTag(
          formatRole(capture.scanStatus),
          capture.scanStatus === "CLEAN" ? "ready" : "review"
        )
      );
      const linkedDraft = document.createElement("div");
      linkedDraft.className = "capture-linked-summary";
      if (capture.conversion) {
        const linkedTitle = document.createElement("strong");
        linkedTitle.textContent =
          capture.conversion.targetType === "BILL"
            ? "Bill draft created"
            : "Immediate expense draft created";
        const linkedNote = document.createElement("small");
        linkedNote.textContent = "DRAFT · Source linked · Not posted";
        linkedDraft.append(linkedTitle, linkedNote);
      } else {
        linkedDraft.textContent = eligibility.ready
          ? "Ready for explicit choice"
          : eligibility.message;
      }
      const item = row([
        new Date(capture.createdAt).toLocaleString(),
        capture.kind === "BILL" ? "Bill" : "Receipt",
        source,
        reviewState,
        linkedDraft,
        actions
      ]);
      item.dataset.captureReviewId = capture.id;
      return item;
    })
  );
}

async function processCaptureLocally(capture) {
  const response = await api(`/v1/capture-reviews/${capture.id}/process`, {
    ...jsonRequest({ version: capture.version }),
    headers: { "content-type": "application/json" }
  });
  if (!response.ok) return showError(response);
  await loadEvidenceInbox();
  showNotice("Evidence was reprocessed locally. Review the updated fields and warnings.");
}

function captureStatusTag(label, tone) {
  const tag = document.createElement("span");
  tag.className = `capture-status-tag is-${tone}`;
  tag.textContent = label;
  return tag;
}

function captureConversionEligibility(capture) {
  const target = capture.kind === "BILL" ? "BILL" : "IMMEDIATE_EXPENSE";
  if (capture.conversion)
    return { ready: false, target, message: "Exactly one draft is already linked." };
  if (capture.status !== "APPROVED")
    return { ready: false, target, message: "Approval is required before draft creation." };
  if (capture.scanStatus !== "CLEAN")
    return {
      ready: false,
      target,
      message: "A clean file scan is required before draft creation."
    };
  return {
    ready: true,
    target,
    message: "Approved and clean. Review the source and choose the draft explicitly."
  };
}

async function openCaptureConversionDialog(capture) {
  const dialog = elements["capture-conversion-dialog"];
  const form = elements["capture-conversion-form"];
  const eligibility = captureConversionEligibility(capture);
  clearCaptureEvidenceObjectUrl();
  form.reset();
  form.elements.captureReviewId.value = capture.id;
  form.elements.version.value = String(capture.version);
  form.elements.issueDate.value = new Date().toISOString().slice(0, 10);
  form.elements.expenseDate.value = new Date().toISOString().slice(0, 10);
  form.elements.quantity.value = "1";
  for (const input of form.querySelectorAll('input[name="target"]')) {
    input.checked = false;
    input.disabled = input.value !== eligibility.target;
  }
  setCaptureTargetSection(elements["capture-bill-fields"], false);
  setCaptureTargetSection(elements["capture-expense-fields"], false);
  setCaptureTargetSection(elements["capture-line-fields"], false);
  elements["capture-conversion-fields"].disabled = !eligibility.ready;
  elements["capture-conversion-form"].hidden = Boolean(capture.conversion);
  elements["capture-conversion-result"].hidden = !capture.conversion;
  elements["capture-conversion-status"].textContent = "";
  elements["capture-conversion-status"].classList.remove("is-error");
  elements["submit-capture-conversion"].disabled = true;
  elements["submit-capture-conversion"].textContent = "Select a draft target";
  elements["capture-evidence-kind"].textContent = capture.kind === "BILL" ? "Bill" : "Receipt";
  elements["capture-evidence-review-status"].textContent = formatRole(capture.status);
  elements["capture-evidence-scan-status"].textContent = formatRole(capture.scanStatus);
  elements["capture-evidence-ocr-status"].textContent = capture.ocrConfidence
    ? `${Math.round(Number(capture.ocrConfidence) * 100)}% confidence`
    : "No OCR suggestion";
  renderCaptureExtraction(capture);
  const guard = elements["capture-conversion-guard"];
  guard.textContent = capture.conversion
    ? "Completed once. The linked draft is read-only from this evidence action."
    : eligibility.message;
  guard.classList.toggle("is-ready", eligibility.ready);
  guard.classList.toggle("is-complete", Boolean(capture.conversion));
  activeCaptureConversion = {
    capture,
    pending: false,
    result: capture.conversion
      ? { conversion: capture.conversion, accountingEntriesCreated: 0 }
      : null,
    idempotencyKey:
      captureConversionIdempotencyKeys.get(`${capture.id}:${capture.version}`) ??
      globalThis.crypto.randomUUID()
  };
  captureConversionIdempotencyKeys.set(
    `${capture.id}:${capture.version}`,
    activeCaptureConversion.idempotencyKey
  );
  if (capture.conversion) renderCaptureConversionResult(activeCaptureConversion.result);
  if (!dialog.open) dialog.showModal();
  void loadCaptureEvidencePreview(capture);
}

function renderCaptureExtraction(capture) {
  const state = elements["capture-processing-state"];
  const guidance = elements["capture-extraction-guidance"];
  const fieldsElement = elements["capture-extraction-fields"];
  const reasonsElement = elements["capture-extraction-reasons"];
  if (!state || !guidance || !fieldsElement || !reasonsElement) return;
  const extraction =
    capture.extractedData && typeof capture.extractedData === "object"
      ? capture.extractedData.localExtraction
      : null;
  const fields = extraction && typeof extraction === "object" ? extraction.fields : null;
  const reasons = Array.isArray(capture.reviewReasons) ? capture.reviewReasons : [];
  state.textContent = capture.processingState ?? "CAPTURED";
  state.className = `capture-status-tag is-${capture.processingState === "VALIDATED" ? "ready" : "review"}`;
  guidance.textContent =
    extraction?.engine?.networkAccess === "NONE"
      ? "Extraction ran locally with no network access. Values are untrusted suggestions; confirm them against the original source before creating a draft."
      : "No local extraction evidence is available. Review the original source manually.";
  const labels = {
    supplierName: "Supplier",
    supplierTaxNumber: "Supplier tax number",
    invoiceNumber: "Invoice / receipt number",
    invoiceDate: "Invoice / transaction date",
    dueDate: "Due date",
    currency: "Currency",
    subtotalMinor: "Subtotal",
    discountMinor: "Discount",
    shippingMinor: "Shipping",
    tipMinor: "Tip",
    gstHstMinor: "GST / HST",
    pstMinor: "PST",
    qstMinor: "QST",
    taxTotalMinor: "Tax total",
    totalMinor: "Total",
    paymentStatus: "Payment status"
  };
  fieldsElement.replaceChildren();
  for (const [name, label] of Object.entries(labels)) {
    const field = fields?.[name];
    if (!field?.value) continue;
    const wrapper = document.createElement("div");
    const title = document.createElement("dt");
    title.textContent = label;
    const value = document.createElement("dd");
    const displayValue = name.endsWith("Minor") ? formatMinor(field.value) : field.value;
    value.textContent = `${displayValue} - ${Math.round(Number(field.confidence ?? 0) * 100)}%`;
    wrapper.append(title, value);
    fieldsElement.append(wrapper);
  }
  reasonsElement.replaceChildren();
  for (const reason of reasons) {
    const item = document.createElement("li");
    item.textContent = formatCaptureReviewReason(reason);
    reasonsElement.append(item);
  }
  if (reasons.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No extraction warnings. Human approval is still required.";
    reasonsElement.append(item);
  }
}

function formatCaptureReviewReason(reason) {
  return String(reason)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderCaptureConversionTarget() {
  if (!activeCaptureConversion || activeCaptureConversion.pending) return;
  const form = elements["capture-conversion-form"];
  const target = new FormData(form).get("target");
  const expected = captureConversionEligibility(activeCaptureConversion.capture).target;
  const validTarget = target === expected;
  setCaptureTargetSection(elements["capture-bill-fields"], target === "BILL");
  setCaptureTargetSection(elements["capture-expense-fields"], target === "IMMEDIATE_EXPENSE");
  setCaptureTargetSection(elements["capture-line-fields"], validTarget);
  const submit = elements["submit-capture-conversion"];
  elements["capture-conversion-status"].classList.remove("is-error");
  submit.disabled = !validTarget;
  submit.textContent =
    target === "BILL"
      ? "Create exactly one bill draft"
      : target === "IMMEDIATE_EXPENSE"
        ? "Create exactly one expense draft"
        : "Select a draft target";
  elements["capture-conversion-status"].textContent = validTarget
    ? "Review every field against the original source. This remains non-posting."
    : "Select the draft target that matches this evidence.";
}

function setCaptureTargetSection(section, active) {
  section.hidden = !active;
  for (const control of section.querySelectorAll("input, select, textarea, button"))
    control.disabled = !active;
}

function validateCaptureConversionDates() {
  const form = elements["capture-conversion-form"];
  const issueDate = form.elements.issueDate;
  const dueDate = form.elements.dueDate;
  dueDate.setCustomValidity(
    issueDate.value && dueDate.value && dueDate.value < issueDate.value
      ? "Due date cannot be before the issue date."
      : ""
  );
  return !dueDate.validationMessage;
}

async function loadCaptureEvidencePreview(capture) {
  const conversionState = activeCaptureConversion;
  if (!conversionState || conversionState.capture.id !== capture.id) return;
  const preview = elements["capture-evidence-preview"];
  preview.setAttribute("aria-busy", "true");
  preview.replaceChildren(document.createTextNode("Loading the original source evidence…"));
  const response = await api(`/v1/capture-reviews/${capture.id}/content`);
  if (activeCaptureConversion?.capture.id !== capture.id) return;
  preview.setAttribute("aria-busy", "false");
  if (!response.ok) {
    preview.replaceChildren(
      capturePreviewMessage(
        "Preview unavailable",
        "The original source could not be displayed. Refresh the inbox or download it again."
      )
    );
    return;
  }
  const blob = await response.blob();
  if (activeCaptureConversion !== conversionState) return;
  clearCaptureEvidenceObjectUrl();
  captureEvidenceObjectUrl = URL.createObjectURL(blob);
  conversionState.fileName = captureContentFileName(response, capture);
  if (blob.type.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = captureEvidenceObjectUrl;
    image.alt = `Original ${capture.kind === "BILL" ? "bill" : "receipt"} evidence`;
    preview.replaceChildren(image);
  } else if (blob.type === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.src = captureEvidenceObjectUrl;
    frame.title = `Original ${capture.kind === "BILL" ? "bill" : "receipt"} evidence`;
    preview.replaceChildren(frame);
  } else {
    preview.replaceChildren(
      capturePreviewMessage(
        "Preview not available for this file type",
        "Download the retained original and compare it with the draft fields."
      )
    );
  }
}

function capturePreviewMessage(title, detail) {
  const wrapper = document.createElement("div");
  wrapper.className = "capture-preview-message";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const description = document.createElement("p");
  description.textContent = detail;
  wrapper.append(heading, description);
  return wrapper;
}

function captureContentFileName(response, capture) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the plain filename and safe capture fallback.
    }
  }
  return (
    /filename="?([^";]+)"?/i.exec(disposition)?.[1] ??
    `${capture.kind === "BILL" ? "bill" : "receipt"}-evidence`
  );
}

function clearCaptureEvidenceObjectUrl() {
  if (captureEvidenceObjectUrl) URL.revokeObjectURL(captureEvidenceObjectUrl);
  captureEvidenceObjectUrl = null;
}

function closeCaptureConversionDialog() {
  if (elements["capture-conversion-dialog"].open) elements["capture-conversion-dialog"].close();
}

function clearCaptureConversionDialog() {
  clearCaptureEvidenceObjectUrl();
  activeCaptureConversion = null;
  const form = elements["capture-conversion-form"];
  form.reset();
  form.hidden = false;
  elements["capture-conversion-fields"].disabled = true;
  setCaptureTargetSection(elements["capture-bill-fields"], false);
  setCaptureTargetSection(elements["capture-expense-fields"], false);
  setCaptureTargetSection(elements["capture-line-fields"], false);
  elements["capture-conversion-result"].hidden = true;
  elements["capture-conversion-status"].textContent = "";
  elements["capture-conversion-status"].classList.remove("is-error");
  elements["capture-linked-draft-type"].textContent = "—";
  elements["capture-linked-draft-id"].textContent = "—";
  elements["capture-linked-accounting-count"].textContent = "0";
  elements["capture-evidence-preview"].setAttribute("aria-busy", "false");
  elements["capture-evidence-preview"].replaceChildren(
    document.createTextNode("Select evidence to preview it.")
  );
}

function captureConversionPayload(form, capture, target) {
  const data = new FormData(form);
  const quantity = String(data.get("quantity") ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(quantity) || Number(quantity) <= 0)
    throw new Error("Quantity must be positive with no more than six decimal places.");
  let unitCostMinor;
  let discountMinor;
  try {
    unitCostMinor = parseMoneyInput(data.get("unitCost"));
    discountMinor = data.get("discount") ? parseMoneyInput(data.get("discount")) : undefined;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Enter valid line amounts.", {
      cause: error
    });
  }
  if (BigInt(unitCostMinor) <= 0n) throw new Error("Unit cost must be greater than zero.");
  const line = {
    description: data.get("lineDescription"),
    quantity,
    unitCostMinor,
    ...(discountMinor ? { discountMinor } : {}),
    accountId: data.get("accountId")
  };
  if (target === "BILL") {
    if (!validateCaptureConversionDates()) throw new Error("Fix the issue and due dates.");
    const terms = String(data.get("paymentTermsDays") ?? "").trim();
    return {
      target,
      version: capture.version,
      bill: {
        vendorId: data.get("billVendorId"),
        vendorInvoiceNumber: data.get("vendorInvoiceNumber"),
        issueDate: data.get("issueDate"),
        ...(data.get("dueDate") ? { dueDate: data.get("dueDate") } : {}),
        ...(terms ? { paymentTermsDays: Number(terms) } : {}),
        currency: data.get("currency"),
        ...(data.get("internalNotes") ? { internalNotes: data.get("internalNotes") } : {}),
        lines: [line]
      }
    };
  }
  return {
    target,
    version: capture.version,
    expense: {
      ...(data.get("expenseVendorId") ? { vendorId: data.get("expenseVendorId") } : {}),
      ...(data.get("reference") ? { reference: data.get("reference") } : {}),
      expenseDate: data.get("expenseDate"),
      method: data.get("method"),
      payingAccountId: data.get("payingAccountId"),
      ...(data.get("internalNotes") ? { internalNotes: data.get("internalNotes") } : {}),
      lines: [line]
    }
  };
}

async function convertCaptureToDraft(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const state = activeCaptureConversion;
  if (!state || state.pending) return;
  const current = evidenceCaptures.find((capture) => capture.id === state.capture.id);
  if (!current) return setCaptureConversionError("Refresh the evidence inbox and try again.");
  if (current.conversion) return renderCaptureConversionResult({ conversion: current.conversion });
  const eligibility = captureConversionEligibility(current);
  if (!eligibility.ready) return setCaptureConversionError(eligibility.message);
  const target = new FormData(form).get("target");
  if (target !== eligibility.target)
    return setCaptureConversionError("Select the draft target that matches this evidence.");
  if (!form.reportValidity()) return;
  let payload;
  try {
    payload = captureConversionPayload(form, current, target);
  } catch (error) {
    return setCaptureConversionError(
      error instanceof Error ? error.message : "Review the draft fields and try again."
    );
  }
  state.pending = true;
  const submit = elements["submit-capture-conversion"];
  elements["capture-conversion-status"].classList.remove("is-error");
  submit.disabled = true;
  submit.textContent = "Creating one draft…";
  elements["capture-conversion-fields"].disabled = true;
  elements["capture-conversion-status"].textContent =
    "Creating one linked, non-posting draft. Repeated clicks are blocked.";
  const response = await api(`/v1/capture-reviews/${current.id}/convert`, {
    ...jsonRequest(payload),
    headers: {
      "content-type": "application/json",
      "idempotency-key": state.idempotencyKey
    }
  });
  if (!response.ok) {
    const detail = await captureConversionErrorDetail(response);
    state.pending = false;
    if (activeCaptureConversion !== state) {
      showNotice(detail.message, true);
      return;
    }
    if (
      [
        "CAPTURE_ALREADY_CONVERTED",
        "STALE_CAPTURE_REVIEW",
        "CAPTURE_NOT_APPROVED",
        "CAPTURE_EVIDENCE_NOT_CLEAN"
      ].includes(detail.code)
    ) {
      await loadEvidenceInbox();
      if (activeCaptureConversion !== state) return;
      const refreshed = evidenceCaptures.find((capture) => capture.id === current.id);
      if (refreshed?.conversion) {
        state.capture = refreshed;
        state.result = { conversion: refreshed.conversion, accountingEntriesCreated: 0 };
        renderCaptureConversionResult(state.result);
        showNotice("The linked draft already exists. No duplicate was created.");
        return;
      }
      if (refreshed) {
        await openCaptureConversionDialog(refreshed);
        setCaptureConversionError(detail.message);
        return;
      }
    }
    elements["capture-conversion-fields"].disabled = false;
    renderCaptureConversionTarget();
    setCaptureConversionError(detail.message);
    return;
  }
  const result = await response.json();
  captureConversionIdempotencyKeys.delete(`${current.id}:${current.version}`);
  await loadPurchases();
  const refreshed = evidenceCaptures.find((capture) => capture.id === current.id);
  state.capture = refreshed ?? { ...current, conversion: result.conversion };
  state.result = result;
  if (activeCaptureConversion === state) renderCaptureConversionResult(result);
  showNotice(
    result.conversion.targetType === "BILL"
      ? "One bill draft created from approved, clean evidence. Nothing was posted."
      : "One immediate expense draft created from approved, clean evidence. Nothing was posted."
  );
}

async function captureConversionErrorDetail(response) {
  try {
    const result = await response.json();
    return {
      code: result.error?.code ?? `HTTP_${response.status}`,
      message: result.error?.message ?? "The draft could not be created."
    };
  } catch {
    return { code: `HTTP_${response.status}`, message: "The draft could not be created." };
  }
}

function setCaptureConversionError(message) {
  elements["capture-conversion-status"].textContent = message;
  elements["capture-conversion-status"].classList.add("is-error");
}

function renderCaptureConversionResult(result) {
  const conversion = result.conversion;
  if (!conversion) return;
  elements["capture-conversion-form"].hidden = true;
  elements["capture-conversion-result"].hidden = false;
  elements["capture-conversion-status"].classList.remove("is-error");
  elements["capture-linked-draft-type"].textContent =
    conversion.targetType === "BILL" ? "Bill draft" : "Immediate expense draft";
  elements["capture-linked-draft-id"].textContent = conversion.targetId ?? "Linked";
  elements["capture-linked-accounting-count"].textContent = String(
    result.accountingEntriesCreated ?? 0
  );
  elements["capture-conversion-guard"].textContent =
    "Completed once. Replaying this action cannot create another draft.";
  elements["capture-conversion-guard"].classList.remove("is-ready");
  elements["capture-conversion-guard"].classList.add("is-complete");
  elements["open-capture-linked-draft"].textContent =
    conversion.targetType === "BILL" ? "Open bill list" : "Close and keep reviewing";
  if (activeCaptureConversion) {
    activeCaptureConversion.pending = false;
    activeCaptureConversion.result = result;
  }
}

function openCaptureLinkedDraft() {
  const conversion = activeCaptureConversion?.result?.conversion;
  closeCaptureConversionDialog();
  if (conversion?.targetType !== "BILL") {
    showNotice(
      "The immediate expense draft remains linked to its source evidence and is not posted."
    );
    return;
  }
  navigateTo("purchases-workspace", { scrollToTop: false });
  globalThis.requestAnimationFrame(() =>
    elements.bills.closest("section")?.scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "start"
    })
  );
}

async function downloadCapture(capture) {
  const response = await api(`/v1/capture-reviews/${capture.id}/content`);
  if (!response.ok) return showError(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = captureContentFileName(response, capture);
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderPurchaseSelects() {
  const vendorOptions = vendors
    .filter((vendor) => vendor.isActive)
    .map((vendor) => option(vendor.id, `${vendor.vendorNumber} | ${vendor.displayName}`));
  elements["bill-form"].elements.vendorId.replaceChildren(...vendorOptions);
  elements["purchase-request-form"].elements.vendorId.replaceChildren(
    option("", "Vendor not selected"),
    ...vendorOptions.map((item) => item.cloneNode(true))
  );
  elements["capture-conversion-form"].elements.billVendorId.replaceChildren(
    option("", "Choose vendor"),
    ...vendorOptions.map((item) => item.cloneNode(true))
  );
  elements["capture-conversion-form"].elements.expenseVendorId.replaceChildren(
    option("", "No vendor selected"),
    ...vendorOptions.map((item) => item.cloneNode(true))
  );
  enhanceCreatableSelect(elements["bill-form"].elements.vendorId, {
    label: "Bill supplier",
    placeholder: vendors.length ? "Search suppliers" : "No suppliers yet",
    emptyText: "No suppliers yet. Use + to add the first supplier.",
    createButton: elements["bill-form"].querySelector('[data-contextual-create="vendor"]'),
    createLabel: "Create a new supplier",
    canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES")
  });
  const purchaseAccounts = accounts
    .filter(
      (account) =>
        ["EXPENSE", "ASSET"].includes(account.type) && !account.isControl && !account.isArchived
    )
    .map((account) => option(account.id, `${account.code} ${account.name}`));
  elements["bill-form"].elements.accountId.replaceChildren(
    ...purchaseAccounts.map((item) => item.cloneNode(true))
  );
  elements["expense-form"].elements.accountId.replaceChildren(
    ...purchaseAccounts.map((item) => item.cloneNode(true))
  );
  elements["purchase-request-form"].elements.accountId.replaceChildren(
    option("", "Account not selected"),
    ...purchaseAccounts.map((item) => item.cloneNode(true))
  );
  elements["capture-conversion-form"].elements.accountId.replaceChildren(
    option("", "Choose expense or asset account"),
    ...purchaseAccounts.map((item) => item.cloneNode(true))
  );
  enhanceCreatableSelect(elements["bill-form"].elements.accountId, {
    label: "Bill account",
    placeholder: purchaseAccounts.length ? "Search expense accounts" : "No accounts yet",
    createButton: elements["bill-form"].querySelector('[data-contextual-create="account"]'),
    createLabel: "Create a new expense or asset account",
    canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT")
  });
  const payingAccounts = accounts
    .filter(
      (account) =>
        ["ASSET", "LIABILITY", "EQUITY"].includes(account.type) &&
        account.systemPurpose !== "accounts-receivable" &&
        !account.isArchived
    )
    .map((account) => option(account.id, `${account.code} ${account.name}`));
  for (const formId of ["expense-form", "bill-payment-form"])
    elements[formId].elements.payingAccountId.replaceChildren(
      ...payingAccounts.map((item) => item.cloneNode(true))
    );
  elements["capture-conversion-form"].elements.payingAccountId.replaceChildren(
    option("", "Choose paying account"),
    ...payingAccounts.map((item) => item.cloneNode(true))
  );
  const openBills = bills.filter((bill) =>
    ["POSTED", "PARTIALLY_PAID", "OVERDUE", "PARTIALLY_CREDITED"].includes(bill.status)
  );
  for (const formId of ["bill-payment-form", "vendor-credit-form"])
    elements[formId].elements.billId.replaceChildren(
      ...openBills.map((bill) =>
        option(
          bill.id,
          `${bill.vendorInvoiceNumber} | ${bill.vendor.displayName} | ${formatMinor(bill.outstandingMinor, bill.currency)}`
        )
      )
    );
  const today = new Date().toISOString().slice(0, 10);
  for (const [formId, field] of [
    ["bill-form", "issueDate"],
    ["expense-form", "expenseDate"],
    ["bill-payment-form", "paymentDate"],
    ["vendor-credit-form", "issueDate"]
  ])
    if (!elements[formId].elements[field].value) elements[formId].elements[field].value = today;
  if (!elements["purchase-request-form"].elements.requestedDate.value)
    elements["purchase-request-form"].elements.requestedDate.value = today;
  renderBillCurrencyControls();
  renderBillPaymentCurrencyControls();
  renderDocumentLineEditor("bill");
}

async function createVendor(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api("/v1/vendors", {
    ...jsonRequest({
      vendorNumber: data.get("vendorNumber"),
      legalName: data.get("legalName"),
      displayName: data.get("displayName"),
      defaultPaymentTermsDays: Number(data.get("defaultPaymentTermsDays")),
      defaultCurrency: data.get("defaultCurrency")
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const vendor = (await response.json()).vendor;
  event.target.reset();
  await loadPurchases();
  completeContextualCreation(vendor?.id);
  showNotice("Vendor created.");
}

async function createBill(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  syncDocumentLineStateFromDom("bill");
  const fallbackAccountId = String(data.get("accountId") ?? "");
  const lines = [];
  for (const line of billLineState) {
    const product = products.find((item) => item.id === line.productItemId);
    const description = String(line.description ?? "").trim() || product?.name || "";
    const accountId = line.accountId || fallbackAccountId;
    if (!description || !accountId) {
      showNotice("Each bill line needs a description and expense or asset account.", true);
      return;
    }
    let unitCostMinor = "0";
    let discountMinor = null;
    try {
      if (String(line.unitCostMinor ?? "").trim())
        unitCostMinor = parseMoneyInput(line.unitCostMinor);
      if (String(line.discountMinor ?? "").trim())
        discountMinor = parseMoneyInput(line.discountMinor);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Enter valid bill amounts.", true);
      return;
    }
    lines.push({
      description,
      quantity: line.quantity || "1",
      unitCostMinor,
      ...(discountMinor !== null ? { discountMinor } : {}),
      accountId,
      productItemId: line.productItemId || null,
      ...(line.taxCodeId ? { taxCodeId: line.taxCodeId } : {})
    });
  }
  const response = await api("/v1/bills", {
    ...jsonRequest({
      vendorId: data.get("vendorId"),
      vendorInvoiceNumber: data.get("vendorInvoiceNumber"),
      issueDate: data.get("issueDate"),
      currency: data.get("currency"),
      ...(data.get("fxRateSnapshotId") ? { fxRateSnapshotId: data.get("fxRateSnapshotId") } : {}),
      lines
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  setBillLineState([createInvoiceLine()]);
  renderDocumentLineEditor("bill");
  await loadPurchases();
  clearBrowserFormDraft("bill-form", { reset: false, announce: false });
  showNotice("Bill draft saved.");
}

function renderBillDuplicateWarning() {
  const output = elements["bill-duplicate-warning"];
  const form = elements["bill-form"];
  if (!output || !form) return;
  const reference = form.elements.vendorInvoiceNumber.value.trim().toLocaleLowerCase();
  const vendorId = form.elements.vendorId.value;
  const duplicate =
    reference && vendorId
      ? bills.find(
          (bill) =>
            bill.vendorId === vendorId &&
            String(bill.vendorInvoiceNumber ?? "")
              .trim()
              .toLocaleLowerCase() === reference &&
            !["CANCELLED", "VOID"].includes(bill.status)
        )
      : null;
  output.textContent = duplicate
    ? `Possible duplicate: ${duplicate.vendorInvoiceNumber} already exists for this vendor (${formatRole(duplicate.status)}). Review it before saving.`
    : "";
}

function renderBillRow(bill) {
  const currency = bill.currency ?? multiCurrencyState?.baseCurrency ?? "CAD";
  const baseCurrency = bill.baseCurrency ?? multiCurrencyState?.baseCurrency ?? "CAD";
  const tr = row([
    bill.vendorInvoiceNumber,
    bill.vendor.displayName,
    bill.dueDate.slice(0, 10),
    moneyCell(bill.outstandingMinor, currency),
    currency,
    moneyCell(bill.baseOutstandingMinor ?? bill.outstandingMinor, baseCurrency),
    formatRole(bill.status)
  ]);
  const actions = document.createElement("td");
  if (["DRAFT", "APPROVED"].includes(bill.status))
    actions.append(commandButton("Post", () => postBill(bill)));
  actions.append(commandButton("Attach", () => chooseBillAttachment(bill)));
  tr.append(actions);
  return tr;
}

async function postBill(bill) {
  const response = await api(`/v1/bills/${bill.id}/post`, {
    ...jsonRequest({ version: bill.version }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  await loadPurchases();
  showNotice("Bill posted.");
}

function chooseBillAttachment(bill) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,image/png,image/jpeg,image/webp,text/plain";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const response = await api(`/v1/bills/${bill.id}/attachments`, {
      method: "POST",
      headers: { "content-type": file.type, "x-file-name": file.name },
      body: file
    });
    if (!response.ok) return showError(response);
    showNotice("Attachment uploaded.");
  });
  input.click();
}

async function recordExpense(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const unitCostMinor = moneyFromForm(data, "unitCostMinor");
  if (unitCostMinor === null) return;
  const response = await api("/v1/immediate-expenses", {
    ...jsonRequest({
      reference: data.get("reference") || null,
      expenseDate: data.get("expenseDate"),
      method: data.get("method"),
      payingAccountId: data.get("payingAccountId"),
      lines: [
        {
          description: data.get("description"),
          quantity: "1",
          unitCostMinor,
          accountId: data.get("accountId")
        }
      ]
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const result = await response.json();
  event.target.reset();
  await loadPurchases();
  showNotice(
    result.duplicateReferenceWarning
      ? "Expense recorded. This reference was used previously."
      : "Expense recorded."
  );
}

async function recordBillPayment(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amountMinor = moneyFromForm(data, "amountMinor");
  if (amountMinor === null) return;
  const selected = bills.find((bill) => bill.id === data.get("billId"));
  if (!selected) return showNotice("Choose an open bill.");
  const response = await api("/v1/bill-payments", {
    ...jsonRequest({
      vendorId: selected.vendorId,
      paymentDate: data.get("paymentDate"),
      amountMinor,
      currency: event.currentTarget.elements.currency.value,
      ...(data.get("fxRateSnapshotId") ? { fxRateSnapshotId: data.get("fxRateSnapshotId") } : {}),
      method: data.get("method"),
      payingAccountId: data.get("payingAccountId"),
      reference: data.get("reference") || null,
      allocations: [{ billId: selected.id, amountMinor }]
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadPurchases();
  showNotice("Bill payment posted.");
}

async function createAndApplyVendorCredit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amountMinor = moneyFromForm(data, "amountMinor");
  if (amountMinor === null) return;
  const selected = bills.find((bill) => bill.id === data.get("billId"));
  if (!selected?.lines?.[0]) return showNotice("Choose a bill with an eligible line.");
  const created = await api(
    "/v1/vendor-credits",
    jsonRequest({
      vendorId: selected.vendorId,
      vendorCreditNumber: data.get("vendorCreditNumber"),
      issueDate: data.get("issueDate"),
      reason: data.get("reason"),
      lines: [{ billLineId: selected.lines[0].id, amountMinor }]
    })
  );
  if (!created.ok) return showError(created);
  const credit = (await created.json()).vendorCredit;
  const posted = await api(`/v1/vendor-credits/${credit.id}/post`, {
    ...jsonRequest({ version: credit.version }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!posted.ok) return showError(posted);
  const applied = await api(`/v1/vendor-credits/${credit.id}/apply`, {
    ...jsonRequest({
      allocations: [{ billId: selected.id, amountMinor }]
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!applied.ok) return showError(applied);
  event.target.reset();
  await loadPurchases();
  showNotice("Vendor credit posted and applied.");
}
