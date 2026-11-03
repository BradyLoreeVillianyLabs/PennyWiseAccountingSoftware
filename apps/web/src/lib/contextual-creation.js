// Quick-create dialogs that return to the form that opened them.

import { parseMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "./browser.js";
import { invoiceLineState } from "./document-lines.js";
import { option } from "./dom.js";
import { showError, showNotice } from "./notices.js";
import { formatRole } from "./roles.js";
import {
  documentLineEditor,
  documentLinePriceForProduct,
  documentLineState,
  invoicePriceForProduct,
  loadAccounts,
  loadPurchases,
  loadSales,
  registerWorkspaceCalls,
  renderDocumentLineEditor,
  renderInvoiceLineEditor,
  renderProjectSelects,
  renderPurchaseSelects,
  renderSalesSelects,
  showSetupStep,
  syncInvoiceLineStateFromDom
} from "./workspace-calls.js";
import { navigateTo } from "../shell.js";
import {
  accounts,
  contextualCreationParentState,
  contextualCreationState,
  customers,
  elements,
  products,
  projects,
  setContextualCreationParentState,
  setContextualCreationState,
  setCustomers,
  setProducts,
  setProjects,
  setVendors,
  setup,
  vendors
} from "../state.js";

registerWorkspaceCalls({ beginContextualCreation });

export function beginContextualCreation(button) {
  const kind = button.dataset.contextualCreate;
  const originForm = button.dataset.contextualOriginForm;
  const originWorkspace = button.dataset.contextualOriginWorkspace;
  const selectionName = button.dataset.contextualSelectionName;
  if (!kind || !originForm || !originWorkspace || !selectionName) return;

  if (kind === "account") {
    if (contextualCreationState?.kind === "product" && originForm === "quick-create-form") {
      const quickForm = elements["quick-create-form"];
      setContextualCreationParentState(contextualCreationState);
      contextualCreationParentState.quickProductDraft = {
        productName: quickForm.elements.productName.value,
        productPrice: quickForm.elements.productPrice.value,
        productType: quickForm.elements.productType.value,
        productTaxCode: quickForm.elements.productTaxCode.value
      };
      setContextualCreationState({
        kind: "account",
        originForm,
        originWorkspace,
        selectionName,
        parentKind: "product",
        accountTypes: (button.dataset.contextualAccountTypes ?? "REVENUE").split(",")
      });
      openQuickCreateAccountDialog(contextualCreationState.accountTypes);
      return;
    }
    setContextualCreationParentState(contextualCreationState);
    setContextualCreationState({ kind, originForm, originWorkspace, selectionName });
    const dialog = elements["contextual-account-dialog"];
    const form = elements["contextual-account-form"];
    const types = (button.dataset.contextualAccountTypes ?? "ASSET,EXPENSE")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    form.reset();
    const typeSelect = form.elements.type;
    typeSelect.replaceChildren(...types.map((type) => option(type, formatRole(type))));
    elements["contextual-account-status"].textContent =
      `This account will be created for ${formatRole(types[0] ?? "the selected account type")}.`;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    form.elements.code.focus();
    return;
  }

  if (kind === "customer" || kind === "product" || kind === "vendor" || kind === "project") {
    setContextualCreationState({
      kind,
      originForm,
      originWorkspace,
      selectionName,
      lineId: button.dataset.contextualLineId ?? null,
      typedValue: button.dataset.contextualTypedValue ?? "",
      documentKind: button.dataset.contextualDocumentKind ?? "invoice"
    });
    openQuickCreateDialog(kind, button.dataset.contextualTypedValue ?? "");
    return;
  }

  const formIdByKind = {
    customer: "customer-form",
    product: "product-form",
    vendor: "vendor-form",
    "tax-code": "tax-code-form"
  };
  const workspaceByKind = {
    customer: "sales-workspace",
    product: "sales-workspace",
    vendor: "purchases-workspace",
    "tax-code": "setup-workspace"
  };
  const target = elements[formIdByKind[kind]];
  if (!target) return;
  setContextualCreationState({
    kind,
    originForm,
    originWorkspace,
    selectionName,
    creationForm: formIdByKind[kind],
    creationWorkspace: workspaceByKind[kind]
  });
  const cancel =
    target.querySelector(`[data-cancel-contextual-create="${kind}"]`) ??
    (kind === "tax-code" ? elements["cancel-contextual-tax-code"] : null);
  if (cancel) cancel.hidden = false;
  navigateTo(workspaceByKind[kind]);
  if (kind === "tax-code") showSetupStep("TAX_REGISTRATION");
  target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  target.querySelector("input, select, textarea")?.focus();
  showNotice(
    `Add the ${kind === "tax-code" ? "tax code" : kind} here, then PennyWise will return you to the draft.`
  );
}

export function openQuickCreateDialog(kind, typedValue = "") {
  const form = elements["quick-create-form"];
  form.reset();
  form.elements.kind.value = kind;
  elements["quick-create-heading"].textContent =
    kind === "product" ? "Create a product or service" : "Create a customer";
  elements["quick-create-help"].textContent =
    "Create it here and return to the invoice without losing your draft.";
  elements["quick-create-customer-fields"].hidden = kind !== "customer";
  elements["quick-create-product-fields"].hidden = kind !== "product";
  elements["quick-create-account-fields"].hidden = true;
  elements["quick-create-vendor-fields"].hidden = kind !== "vendor";
  elements["quick-create-project-fields"].hidden = kind !== "project";
  elements["quick-create-account-back"].hidden = true;
  form.elements.customerName.required = kind === "customer";
  form.elements.productName.required = kind === "product";
  form.elements.productPrice.required = kind === "product";
  form.elements.productIncomeAccount.required = kind === "product";
  form.elements.accountCode.required = false;
  form.elements.accountName.required = false;
  form.elements.accountType.required = false;
  form.elements.projectCustomerId.required = kind === "project";
  form.elements.projectNumber.required = kind === "project";
  form.elements.projectName.required = kind === "project";
  elements["quick-create-submit"].textContent =
    kind === "project" ? "Create project and return" : "Create and return to invoice";
  form.elements.vendorNumber.required = kind === "vendor";
  form.elements.vendorLegalName.required = kind === "vendor";
  form.elements.vendorDisplayName.required = kind === "vendor";
  elements["quick-create-status"].textContent = "";
  if (kind === "customer") {
    form.elements.customerName.value = typedValue;
    form.elements.customerCurrency.value =
      elements["invoice-form"].elements.currency.value || "CAD";
  } else if (kind === "product") {
    form.elements.productName.value = typedValue;
    form.elements.productIncomeAccount.replaceChildren(
      ...accounts
        .filter((account) => account.type === "REVENUE" && !account.isArchived)
        .map((account) => option(account.id, `${account.code} ${account.name}`))
    );
    form.elements.productTaxCode.replaceChildren(
      option("", "No default"),
      ...(setup?.taxCodes ?? []).map((taxCode) =>
        option(taxCode.id, `${taxCode.code} | ${taxCode.name}`)
      )
    );
    const preferredAccount = accounts.find(
      (account) => account.type === "REVENUE" && account.name.toLocaleLowerCase().includes("sales")
    );
    if (preferredAccount) form.elements.productIncomeAccount.value = preferredAccount.id;
    const preferredTaxCode = (setup?.taxCodes ?? []).find(
      (taxCode) => taxCode.isDefault || taxCode.defaultForSales
    );
    if (preferredTaxCode) form.elements.productTaxCode.value = preferredTaxCode.id;
  } else if (kind === "vendor") {
    form.elements.vendorNumber.value = typedValue || nextQuickVendorNumber();
    form.elements.vendorLegalName.value = typedValue;
    form.elements.vendorDisplayName.value = typedValue;
    form.elements.vendorPaymentTermsDays.value = "30";
    form.elements.vendorCurrency.value = elements["bill-form"]?.elements.currency?.value || "CAD";
  } else if (kind === "project") {
    form.elements.projectCustomerId.replaceChildren(
      option("", "Choose customer"),
      ...customers
        .filter((customer) => customer.active)
        .map((customer) =>
          option(customer.id, `${customer.customerNumber} | ${customer.displayName}`)
        )
    );
    const originCustomerId =
      elements[contextualCreationState?.originForm]?.elements?.customerId?.value ?? "";
    if (originCustomerId) form.elements.projectCustomerId.value = originCustomerId;
    else if (customers.length === 1) form.elements.projectCustomerId.value = customers[0].id;
    form.elements.projectNumber.value = nextQuickProjectNumber();
    form.elements.projectName.value = typedValue;
    form.elements.projectBillingMethod.value = "TIME_AND_MATERIALS";
  }
  const dialog = elements["quick-create-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  (kind === "product"
    ? form.elements.productName
    : kind === "vendor"
      ? form.elements.vendorDisplayName
      : kind === "project"
        ? form.elements.projectName
        : form.elements.customerName
  ).focus();
}

function openQuickCreateAccountDialog(types = ["REVENUE"]) {
  const form = elements["quick-create-form"];
  form.reset();
  form.elements.kind.value = "account";
  elements["quick-create-heading"].textContent = "Add revenue account";
  elements["quick-create-help"].textContent =
    "Add the account as one step, then return to the product without losing your draft.";
  elements["quick-create-customer-fields"].hidden = true;
  elements["quick-create-product-fields"].hidden = true;
  elements["quick-create-project-fields"].hidden = true;
  elements["quick-create-account-fields"].hidden = false;
  form.elements.customerName.required = false;
  form.elements.productName.required = false;
  form.elements.productPrice.required = false;
  form.elements.productIncomeAccount.required = false;
  form.elements.projectCustomerId.required = false;
  form.elements.projectNumber.required = false;
  form.elements.projectName.required = false;
  elements["quick-create-account-back"].hidden = false;
  form.elements.accountCode.required = true;
  form.elements.accountName.required = true;
  form.elements.accountType.required = true;
  form.elements.accountType.replaceChildren(...types.map((type) => option(type, formatRole(type))));
  elements["quick-create-submit"].textContent = "Create account and return";
  elements["quick-create-status"].textContent = "";
  form.elements.accountCode.focus();
}

export function restoreQuickProductDraft(draft) {
  if (!draft) return;
  const form = elements["quick-create-form"];
  form.elements.productName.value = draft.productName ?? "";
  form.elements.productPrice.value = draft.productPrice ?? "";
  form.elements.productType.value = draft.productType ?? "SERVICE";
  form.elements.productTaxCode.value = draft.productTaxCode ?? "";
}

function nextQuickCustomerNumber() {
  const used = new Set(customers.map((customer) => customer.customerNumber));
  let number = customers.length + 1;
  while (used.has(`CUST-${String(number).padStart(4, "0")}`)) number += 1;
  return `CUST-${String(number).padStart(4, "0")}`;
}

function nextQuickVendorNumber() {
  const used = new Set(vendors.map((vendor) => vendor.vendorNumber));
  let number = vendors.length + 1;
  while (used.has(`VEND-${String(number).padStart(4, "0")}`)) number += 1;
  return `VEND-${String(number).padStart(4, "0")}`;
}

function nextQuickProjectNumber() {
  const used = new Set(projects.map((project) => project.projectNumber));
  let number = projects.length + 1;
  while (used.has(`JOB-${String(number).padStart(4, "0")}`)) number += 1;
  return `JOB-${String(number).padStart(4, "0")}`;
}

export async function submitQuickCreate(event) {
  event.preventDefault();
  const state = contextualCreationState;
  if (!state || !["customer", "product", "vendor", "project", "account"].includes(state.kind))
    return;
  const form = event.currentTarget;
  const submit = elements["quick-create-submit"];
  submit.disabled = true;
  elements["quick-create-status"].textContent = "Creating...";
  try {
    const data = new FormData(form);
    if (state.kind === "account") {
      const response = await api("/v1/accounts", {
        ...jsonRequest({
          code: String(data.get("accountCode") ?? "").trim(),
          name: String(data.get("accountName") ?? "").trim(),
          type: data.get("accountType"),
          subtype: String(data.get("accountSubtype") ?? "").trim() || undefined,
          isControl: false
        }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": globalThis.crypto.randomUUID()
        }
      });
      if (!response.ok) return showError(response);
      const account = (await response.json()).account;
      const parent = contextualCreationParentState;
      const productDraft = parent?.quickProductDraft ?? {};
      await loadAccounts();
      setContextualCreationState(parent);
      setContextualCreationParentState(null);
      openQuickCreateDialog("product", parent?.typedValue ?? "");
      restoreQuickProductDraft(productDraft);
      if (account?.id)
        elements["quick-create-form"].elements.productIncomeAccount.value = account.id;
      elements["quick-create-status"].textContent =
        "Revenue account created. Finish the product, then return to the draft.";
      showNotice(`Account ${account?.code ?? ""} created and ready to use.`.trim());
      return;
    }
    const body =
      state.kind === "customer"
        ? {
            customerNumber: nextQuickCustomerNumber(),
            displayName: String(data.get("customerName") ?? "").trim(),
            email: String(data.get("customerEmail") ?? "").trim() || null,
            defaultPaymentTermsDays: 30,
            defaultCurrency: data.get("customerCurrency")
          }
        : state.kind === "vendor"
          ? {
              vendorNumber: String(data.get("vendorNumber") ?? "").trim(),
              legalName: String(data.get("vendorLegalName") ?? "").trim(),
              displayName: String(data.get("vendorDisplayName") ?? "").trim(),
              defaultPaymentTermsDays: Number(data.get("vendorPaymentTermsDays") ?? 30),
              defaultCurrency: data.get("vendorCurrency")
            }
          : state.kind === "project"
            ? {
                customerId: data.get("projectCustomerId"),
                projectNumber: String(data.get("projectNumber") ?? "").trim(),
                name: String(data.get("projectName") ?? "").trim(),
                description: String(data.get("projectDescription") ?? "").trim() || null,
                billingMethod: data.get("projectBillingMethod"),
                startDate: data.get("projectStartDate") || null,
                endDate: data.get("projectEndDate") || null,
                budgetMinor: data.get("projectBudgetMinor")
                  ? parseMoneyInput(data.get("projectBudgetMinor"))
                  : null,
                tags: []
              }
            : {
                name: String(data.get("productName") ?? "").trim(),
                itemType: data.get("productType"),
                salesPriceMinor: parseMoneyInput(data.get("productPrice") || "0"),
                incomeAccountId: data.get("productIncomeAccount"),
                ...(data.get("productTaxCode")
                  ? { defaultTaxCodeId: data.get("productTaxCode") }
                  : {})
              };
    const pathByKind = {
      customer: "/v1/customers",
      product: "/v1/products",
      vendor: "/v1/vendors",
      project: "/v1/projects"
    };
    const response = await api(pathByKind[state.kind], {
      ...jsonRequest(body),
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID()
      }
    });
    if (!response.ok) return showError(response);
    const created = await response.json();
    const resourceId =
      created.customer?.id ?? created.product?.id ?? created.vendor?.id ?? created.project?.id;
    syncInvoiceLineStateFromDom();
    if (created.customer) setCustomers([created.customer, ...customers]);
    if (created.product) setProducts([created.product, ...products]);
    if (created.vendor) setVendors([created.vendor, ...vendors]);
    if (created.project) setProjects([created.project, ...projects]);
    renderSalesSelects(customers, products);
    renderPurchaseSelects();
    renderProjectSelects();
    completeContextualCreation(resourceId);
    elements["quick-create-dialog"].close();
    if (state.kind === "product" && state.lineId) {
      documentLineEditor(state.documentKind ?? "invoice")
        .querySelector(
          `[data-line-id="${globalThis.CSS.escape(state.lineId)}"] [data-line-field="quantity"]`
        )
        ?.focus();
    }
    showNotice(
      `${state.kind === "product" ? "Product or service" : state.kind === "vendor" ? "Supplier" : state.kind === "project" ? "Project" : "Customer"} created and selected.`
    );
  } catch (error) {
    elements["quick-create-status"].textContent =
      error instanceof Error ? error.message : "Unable to create this record.";
  } finally {
    submit.disabled = false;
  }
}

export async function createContextualAccount(event) {
  event.preventDefault();
  const state = contextualCreationState;
  if (!state || state.kind !== "account") return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  elements["contextual-account-status"].textContent = "Creating account…";
  try {
    const response = await api("/v1/accounts", {
      ...jsonRequest({
        code: data.get("code"),
        name: data.get("name"),
        type: data.get("type"),
        subtype: String(data.get("subtype") ?? "").trim() || undefined,
        isControl: false
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID()
      }
    });
    if (!response.ok) return showError(response);
    const account = (await response.json()).account;
    await loadAccounts();
    if (state.originWorkspace === "sales-workspace") await loadSales();
    if (state.originWorkspace === "purchases-workspace") await loadPurchases();
    completeContextualCreation(account?.id);
    elements["contextual-account-dialog"].close();
    showNotice(`Account ${account?.code ?? ""} created and selected.`.trim());
  } finally {
    submit.disabled = false;
  }
}

export function completeContextualCreation(resourceId) {
  const state = contextualCreationState;
  if (!state) return;
  if (state.lineId && state.kind === "product") {
    const documentKind = state.documentKind ?? "invoice";
    const line =
      documentKind === "invoice"
        ? invoiceLineState.find((item) => item.id === state.lineId)
        : documentLineState(documentKind).find((item) => item.id === state.lineId);
    const product = products.find((item) => item.id === resourceId);
    if (line && product) {
      line.productItemId = product.id;
      line[documentKind === "bill" ? "unitCostMinor" : "unitPriceMinor"] =
        documentKind === "invoice"
          ? invoicePriceForProduct(product)
          : documentLinePriceForProduct(product, documentKind);
      if (documentKind === "invoice") renderInvoiceLineEditor();
      else renderDocumentLineEditor(documentKind);
      documentLineEditor(documentKind)
        .querySelector(
          `[data-line-id="${globalThis.CSS.escape(line.id)}"] [data-line-field="quantity"]`
        )
        ?.focus();
    }
  }
  const origin = elements[state.originForm];
  const select = origin?.elements?.[state.selectionName];
  if (select && resourceId) {
    if (
      !select.querySelector(`option[value="${globalThis.CSS.escape(resourceId)}"]`) &&
      state.kind === "account"
    ) {
      const account = accounts.find((item) => item.id === resourceId);
      if (account) select.append(option(account.id, `${account.code} ${account.name}`));
    }
    select.value = resourceId;
    select.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
  }
  const creation = elements[state.creationForm ?? state.originForm];
  const cancel =
    creation?.querySelector(`[data-cancel-contextual-create="${state.kind}"]`) ??
    (state.kind === "tax-code" ? elements["cancel-contextual-tax-code"] : null);
  if (cancel) cancel.hidden = true;
  const workspace = state.originWorkspace;
  const parentState = contextualCreationParentState;
  setContextualCreationParentState(null);
  setContextualCreationState(parentState);
  if (workspace) navigateTo(workspace, { scrollToTop: false, refreshData: false });
}

export function cancelContextualCreation(kind) {
  const state = contextualCreationState;
  const targetKind = kind ?? state?.kind;
  const creationForm = state?.creationForm ?? state?.originForm;
  const cancel = creationForm
    ? elements[creationForm]?.querySelector(`[data-cancel-contextual-create="${targetKind}"]`)
    : null;
  if (cancel) cancel.hidden = true;
  if (targetKind === "tax-code") elements["cancel-contextual-tax-code"].hidden = true;
  const workspace = state?.originWorkspace;
  setContextualCreationState(null);
  if (workspace) navigateTo(workspace, { scrollToTop: false, refreshData: false });
  showNotice("Returned to the draft without creating anything.");
}

export function closeContextualAccountDialog() {
  if (contextualCreationState?.kind === "account") {
    setContextualCreationState(contextualCreationParentState);
    setContextualCreationParentState(null);
  }
  elements["contextual-account-status"].textContent = "";
}
