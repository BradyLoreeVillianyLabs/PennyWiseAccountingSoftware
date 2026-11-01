// Payments and refunds (`payments-workspace`).

import { formatMinor, minorToInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { renderManualPaymentCurrencyControls } from "../lib/currency-controls.js";
import { commandButton, moneyFromForm, option, row } from "../lib/dom.js";
import { applySavedTableFilters } from "../lib/forms.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import {
  loadSales,
  previewInvoice,
  registerWorkspaceCalls,
  renderInvoicePaymentMethodOptions
} from "../lib/workspace-calls.js";
import { refreshContextualSearches } from "../shell.js";
import {
  accounts,
  activePreviewInvoice,
  customers,
  elements,
  identity,
  invoices,
  multiCurrencyState,
  paymentInstructionSettings,
  payments,
  runtimeCapabilities,
  setActiveInvoiceDraft,
  setPaymentInstructionSettings,
  setPayments
} from "../state.js";

let paymentDataRequestVersion = 0;
let paymentInstructionFormDirty = false;
let paymentSettings = null;
let ownPaymentAccounts = [];
let durablePaymentLinks = [];

registerWorkspaceCalls({ finalizeInvoice, loadPayments, openInvoicePaymentDialog });

export function initPayments() {
  elements["record-preview-invoice-payment"].addEventListener("click", () => {
    if (activePreviewInvoice) openInvoicePaymentDialog(activePreviewInvoice);
  });
  elements["refresh-payments"].addEventListener("click", loadPayments);
  elements["connect-payment-account"].addEventListener("click", connectPaymentAccount);
  elements["disconnect-payment-account"].addEventListener("click", disconnectPaymentAccount);
  elements["payment-settings-form"].addEventListener("submit", savePaymentSettings);
  elements["own-payment-account-form"].addEventListener("submit", saveOwnPaymentAccount);
  elements["own-payment-account-form"].elements.provider.addEventListener(
    "change",
    syncOwnPaymentProviderFields
  );
  elements["durable-payment-link-form"].addEventListener("submit", createDurablePaymentLink);
  elements["payment-instructions-form"].addEventListener("submit", savePaymentInstructions);
  elements["payment-instructions-form"].addEventListener("input", () => {
    paymentInstructionFormDirty = true;
  });
  elements["payment-instructions-form"]
    .querySelectorAll('input[name="methodKey"]')
    .forEach((input) =>
      input.addEventListener("change", () => {
        paymentInstructionFormDirty = true;
        renderPaymentInstructionDetails();
      })
    );
  elements["manual-payment-form"].addEventListener("submit", recordManualPayment);
  elements["record-invoice-payment-form"].addEventListener("submit", recordInvoicePayment);
  elements["close-record-invoice-payment"].addEventListener("click", () =>
    elements["record-invoice-payment-dialog"].close()
  );
  for (const field of ["invoiceId", "paymentDate"])
    elements["manual-payment-form"].elements[field].addEventListener(
      "change",
      renderManualPaymentCurrencyControls
    );
  elements["refund-form"].addEventListener("submit", createRefund);
}

async function finalizeInvoice(invoice) {
  if (
    !window.confirm(
      `Finalize ${invoice.invoiceNumber ?? invoice.provisionalIdentifier}? This posts it to the receivables ledger and cannot be edited afterward.`
    )
  )
    return;
  const response = await api(`/v1/invoices/${invoice.id}/finalize`, {
    ...jsonRequest({ version: invoice.version }, "POST"),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const posted = (await response.json()).invoice;
  setActiveInvoiceDraft(null);
  elements["invoice-copy-new-draft"].hidden = true;
  await Promise.all([loadSales(), loadPayments()]);
  await previewInvoice(posted);
  showNotice(
    "Invoice finalized and posted. Use Send or Download & send to deliver it manually in this beta."
  );
}

export async function loadPayments() {
  if (!identity?.activeOrganizationId) return;
  const requestVersion = ++paymentDataRequestVersion;
  const [
    accountResponse,
    ownAccountsResponse,
    settingsResponse,
    paymentsResponse,
    disputesResponse,
    instructionsResponse
  ] = await Promise.all([
    api("/v1/payment-account"),
    api("/v1/payment-accounts"),
    api("/v1/payment-settings"),
    api("/v1/payments"),
    api("/v1/payment-disputes"),
    api("/v1/payment-instructions")
  ]);
  if (requestVersion !== paymentDataRequestVersion) return;
  if (![accountResponse, settingsResponse, paymentsResponse].every((response) => response.ok))
    return;
  const account = (await accountResponse.json()).paymentAccount;
  ownPaymentAccounts = ownAccountsResponse.ok
    ? (await ownAccountsResponse.json()).paymentAccounts
    : [];
  paymentSettings = (await settingsResponse.json()).paymentSettings;
  setPayments((await paymentsResponse.json()).payments);
  renderPaymentAccount(account);
  renderOwnPaymentAccounts();
  renderPaymentSettings();
  if (instructionsResponse.ok)
    renderPaymentInstructions((await instructionsResponse.json()).paymentInstructions);
  renderPaymentSelects();
  renderDurablePaymentLinkForm();
  elements.payments.replaceChildren(...payments.map(renderPaymentRow));
  if (disputesResponse.ok) {
    const disputes = (await disputesResponse.json()).disputes;
    elements["payment-disputes"].replaceChildren(...disputes.map(renderDisputeRow));
  }
  applySavedTableFilters();
  refreshContextualSearches();
}

function syncOwnPaymentProviderFields() {
  const form = elements["own-payment-account-form"];
  const square = form.elements.provider.value === "SQUARE";
  elements["own-payment-location-field"].hidden = !square;
  form.elements.locationId.required = square;
}

function renderOwnPaymentAccounts() {
  const container = elements["own-payment-accounts"];
  container.replaceChildren(
    ...ownPaymentAccounts.map((account) => {
      const item = document.createElement("p");
      item.textContent = `${account.provider}: ${account.providerDisplayName ?? "connected"} (${account.providerEnvironment}); credential saved: ${account.credentialConfigured ? "yes" : "no"}.`;
      return item;
    })
  );
  syncOwnPaymentProviderFields();
}

function renderDurablePaymentLinkForm() {
  const form = elements["durable-payment-link-form"];
  const eligible = invoices.filter((invoice) =>
    ["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status)
  );
  form.elements.invoiceId.replaceChildren(
    ...eligible.map((invoice) =>
      option(
        invoice.id,
        `${invoice.invoiceNumber ?? invoice.provisionalIdentifier} | ${invoice.customerNameSnapshot}`
      )
    )
  );
}

function renderDurablePaymentLinks() {
  const container = elements["durable-payment-links"];
  container.replaceChildren(
    ...durablePaymentLinks.map((link) => {
      const item = document.createElement("p");
      const anchor = document.createElement("a");
      anchor.href = link.providerLinkUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = `${link.currency} ${minorToInput(link.requestedAmountMinor)} · ${link.status} · open provider link`;
      item.append(anchor);
      return item;
    })
  );
}

function renderPaymentAccount(account) {
  if (!runtimeCapabilities.hostedPayments) {
    elements["payment-account-status"].textContent =
      "Online collection is disabled in this beta. No funds can move through PennyWise Accounting.";
    elements["connect-payment-account"].hidden = true;
    elements["disconnect-payment-account"].hidden = true;
    return;
  }
  elements["connect-payment-account"].hidden = false;
  elements["disconnect-payment-account"].hidden = false;
  elements["payment-account-status"].textContent = account
    ? `${formatRole(account.status)}; charges ${account.chargesEnabled ? "enabled" : "disabled"}; payouts ${account.payoutsEnabled ? "enabled" : "disabled"}.`
    : "Not connected";
  elements["connect-payment-account"].disabled = account?.status === "CONNECTED";
  elements["disconnect-payment-account"].disabled = !account || account.status === "DISCONNECTED";
}

function renderPaymentSettings() {
  const form = elements["payment-settings-form"];
  form.elements.clearingAccountId.replaceChildren(
    ...accounts
      .filter((account) => account.type === "ASSET" && !account.isArchived)
      .map((account) => option(account.id, `${account.code} ${account.name}`))
  );
  form.elements.feeExpenseAccountId.replaceChildren(
    ...accounts
      .filter((account) => account.type === "EXPENSE" && !account.isArchived)
      .map((account) => option(account.id, `${account.code} ${account.name}`))
  );
  if (!paymentSettings) return;
  form.elements.clearingAccountId.value = paymentSettings.clearingAccountId;
  form.elements.feeExpenseAccountId.value = paymentSettings.feeExpenseAccountId;
  form.elements.allowPartialPayments.checked = paymentSettings.allowPartialPayments;
  form.elements.minimumPartialMinor.value = minorToInput(paymentSettings.minimumPartialMinor);
}

function renderPaymentSelects() {
  const manual = elements["manual-payment-form"];
  manual.elements.customerId.replaceChildren(
    ...customers
      .filter((customer) => customer.active)
      .map((customer) => option(customer.id, customer.displayName))
  );
  manual.elements.invoiceId.replaceChildren(
    ...invoices
      .filter((invoice) =>
        ["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status)
      )
      .map((invoice) =>
        option(
          invoice.id,
          `${invoice.invoiceNumber ?? invoice.provisionalIdentifier} | ${invoice.customerNameSnapshot}`
        )
      )
  );
  manual.elements.receivingAccountId.replaceChildren(
    ...accounts
      .filter((account) => account.type === "ASSET" && !account.isArchived)
      .map((account) => option(account.id, `${account.code} ${account.name}`))
  );
  elements["refund-form"].elements.paymentId.replaceChildren(
    ...payments
      .filter((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status))
      .map((payment) =>
        option(
          payment.id,
          `${formatMinor(payment.amountMinor, payment.currency ?? multiCurrencyState?.baseCurrency ?? "CAD")} | ${formatRole(payment.status)}`
        )
      )
  );
  if (!manual.elements.paymentDate.value)
    manual.elements.paymentDate.value = new Date().toISOString().slice(0, 10);
  renderManualPaymentCurrencyControls();
}

async function connectPaymentAccount() {
  if (!runtimeCapabilities.hostedPayments) {
    return showNotice(
      "Hosted payments are disabled in this beta. Record a manual payment only after funds reach your bank.",
      true
    );
  }
  const returnUrl = new URL("/", window.location.href).toString();
  const response = await api("/v1/payment-account/connect", jsonRequest({ returnUrl }));
  if (!response.ok) return showError(response);
  const result = await response.json();
  if (result.onboardingUrl) window.location.assign(result.onboardingUrl);
  else await loadPayments();
}

async function disconnectPaymentAccount() {
  const response = await api("/v1/payment-account/disconnect", jsonRequest({}));
  if (!response.ok) return showError(response);
  await loadPayments();
  showNotice("Payment account disconnected.");
}

async function savePaymentSettings(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const minimumPartialMinor = moneyFromForm(data, "minimumPartialMinor");
  if (minimumPartialMinor === null) return;
  const response = await api(
    "/v1/payment-settings",
    jsonRequest(
      {
        clearingAccountId: data.get("clearingAccountId"),
        feeExpenseAccountId: data.get("feeExpenseAccountId"),
        allowPartialPayments: data.get("allowPartialPayments") === "on",
        minimumPartialMinor,
        ...(paymentSettings ? { version: paymentSettings.version } : {})
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  paymentSettings = (await response.json()).paymentSettings;
  renderPaymentSettings();
  showNotice("Payment settings saved.");
}

async function saveOwnPaymentAccount(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const provider = String(data.get("provider") || "");
  const response = await api(
    "/v1/payment-accounts/own",
    jsonRequest(
      {
        provider,
        credential: data.get("credential"),
        mode: data.get("mode"),
        ...(data.get("locationId") ? { locationId: data.get("locationId") } : {})
      },
      "POST"
    )
  );
  if (!response.ok) return showError(response);
  event.currentTarget.elements.credential.value = "";
  const accountsResponse = await api("/v1/payment-accounts");
  if (accountsResponse.ok) ownPaymentAccounts = (await accountsResponse.json()).paymentAccounts;
  renderOwnPaymentAccounts();
  elements["own-payment-account-status"].textContent =
    `${provider} account tested and saved. The credential was not returned.`;
}

async function createDurablePaymentLink(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const invoiceId = String(data.get("invoiceId") || "");
  if (!invoiceId) return showNotice("Choose a posted invoice first.", true);
  const response = await api(`/v1/invoices/${invoiceId}/payment-links`, {
    ...jsonRequest({ provider: data.get("provider") }, "POST"),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const result = await response.json();
  durablePaymentLinks = [
    result.paymentLink,
    ...durablePaymentLinks.filter((link) => link.id !== result.paymentLink.id)
  ];
  renderDurablePaymentLinks();
  elements["durable-payment-link-status"].textContent =
    "Provider link created. It remains active until paid or deactivated by the provider.";
}

function renderPaymentInstructionDetails() {
  const form = elements["payment-instructions-form"];
  for (const panel of form.querySelectorAll("[data-payment-method-details]")) {
    const key = panel.dataset.paymentMethodDetails;
    const selected = [...form.querySelectorAll('input[name="methodKey"]')].some(
      (input) => input.checked && input.value === key
    );
    panel.classList.toggle("is-visible", selected);
  }
}

function renderPaymentInstructions(settings) {
  if (paymentInstructionFormDirty) return;
  setPaymentInstructionSettings(settings);
  const form = elements["payment-instructions-form"];
  form.reset();
  form.elements.legacyInstructions.value = settings.legacyInstructions ?? "";
  for (const method of settings.methods ?? []) {
    const checkbox = [...form.querySelectorAll('input[name="methodKey"]')].find(
      (input) => input.value === method.key
    );
    if (checkbox) checkbox.checked = true;
    if (method.key === "E_TRANSFER") {
      form.elements.eTransferEmail.value = method.recipientEmail ?? "";
      form.elements.eTransferAutodeposit.checked = method.autodeposit === true;
    }
    if (method.key === "EFT") {
      form.elements.eftInstitution.value = method.institution ?? "";
      form.elements.eftTransit.value = "";
      form.elements.eftAccount.value = "";
      elements["payment-instructions-status"].textContent =
        method.transitNumber || method.accountNumber
          ? "Existing EFT numbers are protected and masked. Re-enter them only when replacing them."
          : "";
    }
    if (method.key === "CHEQUE") {
      form.elements.chequePayableTo.value = method.payableTo ?? "";
      form.elements.chequeAddress.value = method.mailingAddress ?? "";
    }
    if (method.key === "PAY_ONLINE") form.elements.paymentUrl.value = method.url ?? "";
    if (method.key === "OTHER")
      form.elements.otherPaymentDescription.value = method.description ?? "";
  }
  renderPaymentInstructionDetails();
  renderInvoicePaymentMethodOptions();
}

async function savePaymentInstructions(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const selected = data.getAll("methodKey");
  const methods = [];
  for (const key of selected) {
    if (key === "E_TRANSFER")
      methods.push({
        key,
        recipientEmail: data.get("eTransferEmail"),
        autodeposit: data.get("eTransferAutodeposit") === "on"
      });
    if (key === "EFT")
      methods.push({
        key,
        institution: data.get("eftInstitution"),
        transitNumber: data.get("eftTransit"),
        accountNumber: data.get("eftAccount")
      });
    if (key === "CHEQUE")
      methods.push({
        key,
        payableTo: data.get("chequePayableTo"),
        mailingAddress: data.get("chequeAddress")
      });
    if (key === "PAY_ONLINE") methods.push({ key, url: data.get("paymentUrl") });
    if (key === "CASH") methods.push({ key });
    if (key === "OTHER") methods.push({ key, description: data.get("otherPaymentDescription") });
  }
  elements["payment-instructions-status"].textContent = "Saving…";
  const response = await api(
    "/v1/payment-instructions",
    jsonRequest(
      {
        ...(paymentInstructionSettings?.version
          ? { version: paymentInstructionSettings.version }
          : {}),
        legacyInstructions: data.get("legacyInstructions") || null,
        methods
      },
      "PUT"
    )
  );
  if (!response.ok) {
    elements["payment-instructions-status"].textContent = "Payment instructions were not saved.";
    return showError(response);
  }
  paymentInstructionFormDirty = false;
  renderPaymentInstructions((await response.json()).paymentInstructions);
  elements["payment-instructions-status"].textContent = "Payment instructions saved.";
}

async function recordManualPayment(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amountMinor = moneyFromForm(data, "amountMinor");
  const allocationMinor = moneyFromForm(data, "allocationMinor");
  if (amountMinor === null || allocationMinor === null) return;
  const invoice = invoices.find((item) => item.id === data.get("invoiceId"));
  const customer = customers.find((item) => item.id === data.get("customerId"));
  if (!invoice || !customer || invoice.customerId !== customer.id)
    return showNotice("Choose an invoice belonging to the selected customer.");
  const response = await api("/v1/payments/manual", {
    ...jsonRequest({
      customerId: data.get("customerId"),
      receivingAccountId: data.get("receivingAccountId"),
      paymentDate: data.get("paymentDate"),
      amountMinor,
      currency: event.currentTarget.elements.currency.value,
      ...(data.get("fxRateSnapshotId") ? { fxRateSnapshotId: data.get("fxRateSnapshotId") } : {}),
      methodCategory: data.get("methodCategory"),
      reference: data.get("reference") || undefined,
      allocations: [{ invoiceId: data.get("invoiceId"), amountMinor: allocationMinor }]
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await Promise.all([loadSales(), loadPayments()]);
  showNotice("Manual payment recorded and posted.");
}

function renderPaymentRow(payment) {
  const currency = payment.currency ?? multiCurrencyState?.baseCurrency ?? "CAD";
  const tr = row([
    formatRole(payment.status),
    formatMinor(payment.amountMinor, currency),
    formatMinor(payment.unappliedMinor, currency),
    formatMinor(payment.refundedMinor, currency)
  ]);
  const actions = document.createElement("td");
  actions.append(commandButton("Detail", () => showPayment(payment.id)));
  actions.append(commandButton("Receipt", () => showReceipt(payment.id)));
  tr.append(actions);
  return tr;
}

function openInvoicePaymentDialog(invoice) {
  const form = elements["record-invoice-payment-form"];
  form.reset();
  form.elements.customerId.value = invoice.customerId;
  form.elements.invoiceId.value = invoice.id;
  form.elements.amountMinor.value = minorToInput(invoice.outstandingBalanceMinor ?? "0");
  form.elements.allocationMinor.value = minorToInput(invoice.outstandingBalanceMinor ?? "0");
  form.elements.paymentDate.value = new Date().toISOString().slice(0, 10);
  form.elements.reference.value = invoice.invoiceNumber ?? invoice.provisionalIdentifier;
  form.elements.receivingAccountId.replaceChildren(
    ...accounts
      .filter((account) => account.type === "ASSET" && !account.isArchived)
      .map((account) => option(account.id, `${account.code} ${account.name}`))
  );
  elements["record-invoice-payment-summary"].textContent =
    `${invoice.invoiceNumber ?? invoice.provisionalIdentifier} · balance ${formatMinor(invoice.outstandingBalanceMinor ?? "0", invoice.currency)}`;
  const dialog = elements["record-invoice-payment-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  form.elements.amountMinor.focus();
}

async function recordInvoicePayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const amountMinor = moneyFromForm(data, "amountMinor");
  const allocationMinor = moneyFromForm(data, "allocationMinor");
  if (amountMinor === null || allocationMinor === null) return;
  const response = await api("/v1/payments/manual", {
    ...jsonRequest({
      customerId: data.get("customerId"),
      receivingAccountId: data.get("receivingAccountId"),
      paymentDate: data.get("paymentDate"),
      amountMinor,
      methodCategory: data.get("methodCategory"),
      reference: data.get("reference") || undefined,
      allocations: [{ invoiceId: data.get("invoiceId"), amountMinor: allocationMinor }]
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  elements["record-invoice-payment-dialog"].close();
  await Promise.all([loadSales(), loadPayments()]);
  showNotice("Payment recorded and allocated to the invoice.");
}

async function showPayment(paymentId) {
  const response = await api(`/v1/payments/${paymentId}`);
  if (!response.ok) return showError(response);
  const payment = (await response.json()).payment;
  const currency = payment.currency ?? multiCurrencyState?.baseCurrency ?? "CAD";
  elements["payment-detail"].textContent =
    `Payment ${payment.id}\nStatus: ${payment.status}\nAmount: ${formatMinor(payment.amountMinor, currency)}\nUnapplied: ${formatMinor(payment.unappliedMinor, currency)}\nRefunded: ${formatMinor(payment.refundedMinor, currency)}\nReceipt: ${payment.receiptNumber ?? "pending"}`;
  elements["refund-form"].elements.paymentId.value = payment.id;
}

async function showReceipt(paymentId) {
  const response = await api(`/v1/payments/${paymentId}/receipt`);
  if (!response.ok) return showError(response);
  const receipt = (await response.json()).receipt;
  elements["payment-detail"].textContent =
    `Receipt ${receipt.receiptNumber}\nCreated: ${receipt.createdAt}\n${JSON.stringify(receipt.renderData, null, 2)}`;
}

async function createRefund(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amountMinor = moneyFromForm(data, "amountMinor");
  if (amountMinor === null) return;
  const response = await api(`/v1/payments/${data.get("paymentId")}/refunds`, {
    ...jsonRequest({
      amountMinor,
      reason: data.get("reason"),
      treatment: data.get("treatment")
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await Promise.all([loadSales(), loadPayments()]);
  showNotice(
    runtimeCapabilities.hostedPayments
      ? "Provider refund request recorded."
      : "Refund recorded in the ledger; PennyWise Accounting did not move funds."
  );
}

function renderDisputeRow(dispute) {
  const tr = row([
    formatRole(dispute.status),
    formatMinor(dispute.amountMinor),
    dispute.reasonCategory ?? "Not provided"
  ]);
  const actions = document.createElement("td");
  if (dispute.status === "REVIEW_REQUIRED")
    actions.append(commandButton("Review", () => updateDispute(dispute.id, "UNDER_REVIEW")));
  if (["REVIEW_REQUIRED", "UNDER_REVIEW"].includes(dispute.status)) {
    actions.append(commandButton("Won", () => updateDispute(dispute.id, "WON")));
    actions.append(commandButton("Lost", () => updateDispute(dispute.id, "LOST")));
  }
  tr.append(actions);
  return tr;
}

async function updateDispute(disputeId, status) {
  const response = await api(`/v1/payment-disputes/${disputeId}`, jsonRequest({ status }, "PATCH"));
  if (!response.ok) return showError(response);
  await loadPayments();
  showNotice("Dispute status updated.");
}
