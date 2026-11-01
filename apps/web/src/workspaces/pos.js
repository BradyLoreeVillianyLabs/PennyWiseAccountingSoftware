// Point of sale (`pos-workspace`).

import { formatMinor } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { option, row } from "../lib/dom.js";
import { showError, showNotice } from "../lib/notices.js";
import { loadSales, registerWorkspaceCalls } from "../lib/workspace-calls.js";
import {
  accounts,
  elements,
  identity,
  inventoryLocations,
  products,
  setInventoryLocations,
  setProducts
} from "../state.js";

let posRegisters = [];
let posCurrentShift = null;
let posSales = [];
let posLookupSequence = 0;
let posCapabilities = null;
let posCartLines = [];
let posTenderRows = [{ type: "CASH", amountReceivedMinor: "" }];
let posLastCompletedSale = null;
const posIntentStoragePrefix = "clearledger_pos_intent";

registerWorkspaceCalls({ loadPos });

export function initPos() {
  elements["refresh-pos"].addEventListener("click", loadPos);
  elements["pos-register-config-form"].addEventListener("submit", createPosRegister);
  elements["pos-register-form"].addEventListener("submit", openPosShift);
  elements["pos-close-shift-form"].addEventListener("submit", closePosShift);
  elements["pos-preview"].addEventListener("click", previewPosSale);
  elements["pos-sale-form"].addEventListener("submit", completePosSale);
  elements["pos-add-line"].addEventListener("click", addPosLine);
  elements["pos-add-tender"].addEventListener("click", addPosTender);
  elements["pos-print-receipt"].addEventListener("click", printPosReceipt);
  elements["pos-return-form"].addEventListener("submit", processPosReturn);
}

async function loadPos() {
  if (!products.length) await loadSales();
  const [registerResponse, productsResponse, locationsResponse, capabilitiesResponse] =
    await Promise.all([
      api("/v1/pos/registers"),
      api("/v1/products"),
      api("/v1/inventory/locations", {}, true),
      api("/v1/pos/capabilities", {}, true)
    ]);
  if (!registerResponse.ok) {
    if (registerResponse.status !== 403) await showError(registerResponse);
    return;
  }
  posRegisters = (await registerResponse.json()).registers;
  if (productsResponse.ok) setProducts((await productsResponse.json()).products);
  if (locationsResponse.ok) setInventoryLocations((await locationsResponse.json()).locations);
  if (capabilitiesResponse.ok) {
    posCapabilities = (await capabilitiesResponse.json()).capabilities;
    renderPosCapabilities();
  }
  renderPosRegisterConfiguration();
  const registerSelect = elements["pos-register-form"].elements.registerId;
  const selected = registerSelect.value;
  registerSelect.replaceChildren(
    option("", posRegisters.length ? "Select a register" : "No registers configured"),
    ...posRegisters.map((register) => option(register.id, `${register.code} | ${register.name}`))
  );
  if (posRegisters.some((register) => register.id === selected)) registerSelect.value = selected;
  const productSelect = elements["pos-sale-form"].elements.productItemId;
  const selectedProduct = productSelect.value;
  productSelect.replaceChildren(
    option("", products.length ? "Select a product or service" : "No products available"),
    ...products
      .filter((product) => product.active !== false)
      .map((product) => option(product.id, `${product.sku ?? ""} ${product.name}`.trim()))
  );
  if (products.some((product) => product.id === selectedProduct))
    productSelect.value = selectedProduct;
  productSelect.onchange = () => {
    const product = products.find((item) => item.id === productSelect.value);
    if (product) elements["pos-sale-form"].elements.unitPriceMinor.value = product.salesPriceMinor;
  };
  const productLookup = elements["pos-sale-form"].elements.productLookup;
  const productLookupOutput = elements["pos-product-lookup-output"];
  const resolveExactProductLookup = async () => {
    const identifier = productLookup.value.trim();
    const sequence = ++posLookupSequence;
    productLookupOutput.textContent = "";
    if (!identifier) return;
    const response = await api(
      `/v1/pos/products/resolve?identifier=${encodeURIComponent(identifier)}`,
      {},
      true
    );
    if (sequence !== posLookupSequence) return;
    if (!response.ok) {
      if (response.status === 404)
        productLookupOutput.textContent = "No active product has that exact identifier.";
      else if (response.status === 409)
        productLookupOutput.textContent =
          "That identifier is ambiguous. Select a product manually after resolving the duplicate.";
      else productLookupOutput.textContent = "Unable to resolve that identifier.";
      return;
    }
    const resolved = await response.json();
    const product = resolved.product;
    productSelect.value = product.id;
    productSelect.dispatchEvent(new globalThis.Event("change"));
    productLookupOutput.textContent = `Selected ${product.sku ?? product.name} by exact identifier.`;
  };
  productLookup.onkeydown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void resolveExactProductLookup();
  };
  productLookup.onchange = () => void resolveExactProductLookup();
  renderPosCartLines();
  renderPosTenders();
  if (!elements["pos-register-form"].elements.businessDate.value)
    elements["pos-register-form"].elements.businessDate.value = new Date()
      .toISOString()
      .slice(0, 10);
  const savedShiftId = sessionStorage.getItem("clearledger_pos_shift");
  if (savedShiftId) {
    const shiftResponse = await api(
      `/v1/pos/shifts/${encodeURIComponent(savedShiftId)}/reconciliation`,
      {},
      true
    );
    if (shiftResponse.ok) {
      posCurrentShift = (await shiftResponse.json()).shift;
      renderPosShiftStatus();
    } else {
      sessionStorage.removeItem("clearledger_pos_shift");
      posCurrentShift = null;
    }
  }
  await renderPosSales();
}

function renderPosCapabilities() {
  const output = elements["pos-capabilities-status"];
  if (!output) return;
  if (!posCapabilities) {
    output.textContent =
      "POS capability information is unavailable; checkout controls remain closed.";
    return;
  }
  const cart = posCapabilities.cart;
  const tenders = posCapabilities.tenders;
  const receipts = posCapabilities.receipts;
  output.textContent = [
    cart?.multiLine
      ? `Multi-line cart enabled (up to ${cart.maxLines} lines).`
      : "Single-line cart only.",
    tenders?.split
      ? `Split tender enabled (up to ${tenders.maxTenders}); cash change supported.`
      : "Single tender only.",
    receipts?.browserPrint
      ? "Posted receipts can be printed from this browser."
      : "Receipt printing is unavailable."
  ].join(" ");
}

function addPosLine() {
  const form = elements["pos-sale-form"];
  const productId = form.elements.productItemId.value;
  const quantity = form.elements.quantity.value.trim();
  const unitPriceMinor = form.elements.unitPriceMinor.value.trim();
  if (!productId || !quantity || !unitPriceMinor)
    return showNotice(
      "Choose a product, quantity, and unit price before adding a cart line.",
      true
    );
  const maxLines = posCapabilities?.cart?.maxLines ?? 100;
  if (posCartLines.length >= maxLines)
    return showNotice(`This cart cannot contain more than ${maxLines} lines.`, true);
  if (!/^\d+(?:\.\d{1,6})?$/.test(quantity) || !/^\d+$/.test(unitPriceMinor))
    return showNotice("Enter a valid quantity and non-negative minor-unit price.", true);
  posCartLines.push({
    productItemId: productId,
    quantity,
    unitPriceMinor,
    discountMinor: "0"
  });
  renderPosCartLines();
  form.elements.productItemId.value = "";
  form.elements.productLookup.value = "";
  form.elements.quantity.value = "1";
  form.elements.unitPriceMinor.value = "";
  elements["pos-product-lookup-output"].textContent =
    "Line added. Add another item or preview the cart.";
}

function renderPosCartLines() {
  const body = elements["pos-cart-lines"];
  if (!body) return;
  body.replaceChildren(
    ...posCartLines.map((line, index) => {
      const product = products.find((item) => item.id === line.productItemId);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-command";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${product?.name ?? "cart line"}`);
      remove.addEventListener("click", () => {
        posCartLines.splice(index, 1);
        renderPosCartLines();
      });
      return row([
        product?.sku ? `${product.sku} | ${product.name}` : (product?.name ?? "Product"),
        line.quantity,
        formatMinor(line.unitPriceMinor),
        remove
      ]);
    })
  );
}

function addPosTender() {
  const maxTenders = posCapabilities?.tenders?.maxTenders ?? 10;
  if (posTenderRows.length >= maxTenders)
    return showNotice(`This sale cannot contain more than ${maxTenders} tenders.`, true);
  posTenderRows.push({ type: "MANUAL", amountReceivedMinor: "" });
  renderPosTenders();
}

function renderPosTenders() {
  const container = elements["pos-tender-rows"];
  if (!container) return;
  container.replaceChildren(
    ...posTenderRows.map((tender, index) => {
      const rowElement = document.createElement("div");
      rowElement.className = "inline-form";
      rowElement.dataset.posTenderRow = String(index);
      const typeLabel = document.createElement("label");
      typeLabel.textContent = `Tender ${index + 1}`;
      const type = document.createElement("select");
      type.name = "tenderType";
      type.setAttribute("aria-label", `Tender ${index + 1} type`);
      type.append(option("CASH", "Cash"), option("MANUAL", "Manual").cloneNode(true));
      type.value = tender.type;
      type.addEventListener("change", () => {
        posTenderRows[index].type = type.value;
      });
      typeLabel.append(type);
      const amountLabel = document.createElement("label");
      amountLabel.textContent = "Received (minor units)";
      const amount = document.createElement("input");
      amount.name = "amountReceivedMinor";
      amount.inputMode = "numeric";
      amount.required = true;
      amount.value = tender.amountReceivedMinor;
      amount.addEventListener("input", () => {
        posTenderRows[index].amountReceivedMinor = amount.value;
        renderPosTenderSummary();
      });
      amountLabel.append(amount);
      rowElement.append(typeLabel, amountLabel);
      if (tender.type === "MANUAL") {
        const referenceLabel = document.createElement("label");
        referenceLabel.textContent = "Reference";
        const reference = document.createElement("input");
        reference.name = "tenderReference";
        reference.maxLength = 200;
        reference.value = tender.reference ?? "";
        reference.addEventListener("input", () => {
          posTenderRows[index].reference = reference.value;
        });
        referenceLabel.append(reference);
        rowElement.append(referenceLabel);
      }
      if (posTenderRows.length > 1) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-command";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          posTenderRows.splice(index, 1);
          renderPosTenders();
        });
        rowElement.append(remove);
      }
      return rowElement;
    })
  );
  elements["pos-add-tender"].disabled =
    posTenderRows.length >= (posCapabilities?.tenders?.maxTenders ?? 10);
  renderPosTenderSummary();
}

function readPosTenders() {
  const rows = [...elements["pos-tender-rows"].querySelectorAll("[data-pos-tender-row]")];
  return rows.map((rowElement) => {
    const type = rowElement.querySelector('[name="tenderType"]')?.value ?? "CASH";
    const amountReceivedMinor =
      rowElement.querySelector('[name="amountReceivedMinor"]')?.value.trim() ?? "";
    const reference = rowElement.querySelector('[name="tenderReference"]')?.value.trim() ?? "";
    return { type, amountReceivedMinor, ...(reference ? { reference } : {}) };
  });
}

function renderPosTenderSummary(totalMinor = null) {
  const output = elements["pos-preview-output"];
  if (!output) return;
  const tenders = readPosTenders();
  if (!totalMinor || tenders.some((tender) => !/^\d+$/.test(tender.amountReceivedMinor))) return;
  const received = tenders.reduce((sum, tender) => sum + BigInt(tender.amountReceivedMinor), 0n);
  const total = BigInt(totalMinor);
  const change = received > total ? received - total : 0n;
  const short = received < total ? total - received : 0n;
  output.textContent +=
    short > 0n
      ? ` Tender short by ${formatMinor(short.toString())}.`
      : ` Change due ${formatMinor(change.toString())}.`;
}

function renderPosReceipt(sale) {
  posLastCompletedSale = sale;
  const section = elements["pos-receipt-section"];
  if (section) section.hidden = false;
  elements["pos-receipt-status"].textContent =
    `Receipt ${sale.receiptNumber ?? sale.id.slice(0, 8)} is linked to posted invoice ${sale.invoiceId ?? "pending"}. Browser printing is available; device printing and external delivery remain disabled.`;
  elements["pos-printable-receipt-number"].textContent =
    `${sale.receiptNumber ?? sale.id.slice(0, 8)} · ${sale.businessDate}`;
  elements["pos-printable-receipt-lines"].replaceChildren(
    ...(sale.lines ?? []).map((line) => {
      const lineElement = document.createElement("div");
      lineElement.className = "pos-printable-receipt-line";
      const description = document.createElement("span");
      description.textContent = `${line.description} × ${line.quantity}`;
      const amount = document.createElement("span");
      amount.textContent = formatMinor(line.totalMinor);
      lineElement.append(description, amount);
      return lineElement;
    })
  );
  elements["pos-printable-receipt-total"].textContent =
    `Total: ${formatMinor(sale.grandTotalMinor)}`;
  elements["pos-printable-receipt-tenders"].textContent = (sale.tenders ?? [])
    .map(
      (tender) =>
        `${tender.type}: ${formatMinor(tender.appliedAmountMinor)}${BigInt(tender.changeMinor ?? "0") > 0n ? ` · Change ${formatMinor(tender.changeMinor)}` : ""}`
    )
    .join(" | ");
}

function printPosReceipt() {
  if (!posLastCompletedSale)
    return showNotice("Complete a sale before printing its receipt.", true);
  const receipt = elements["pos-printable-receipt"];
  receipt.hidden = false;
  window.print();
  receipt.hidden = true;
}

function renderPosRegisterConfiguration() {
  const form = elements["pos-register-config-form"];
  const locationSelect = form.elements.inventoryLocationId;
  const cashSelect = form.elements.cashAccountId;
  locationSelect.replaceChildren(
    option(
      "",
      inventoryLocations.length ? "Select a location" : "Create an inventory location first"
    ),
    ...inventoryLocations
      .filter((location) => location.isActive !== false)
      .map((location) => option(location.id, `${location.code} | ${location.name}`))
  );
  cashSelect.replaceChildren(
    option("", "Select a cash asset account"),
    ...accounts
      .filter((account) => account.type === "ASSET" && !account.isArchived)
      .map((account) => option(account.id, `${account.code} | ${account.name}`))
  );
}

async function createPosRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!identity?.activeCompanyId)
    return showNotice("Select a company before configuring a register.", true);
  const response = await api(
    "/v1/pos/registers",
    jsonRequest({
      companyId: identity.activeCompanyId,
      inventoryLocationId: form.elements.inventoryLocationId.value,
      cashAccountId: form.elements.cashAccountId.value,
      code: form.elements.code.value,
      name: form.elements.name.value
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  await loadPos();
  showNotice("Register configured and ready to open a shift.");
}

async function openPosShift(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await api("/v1/pos/shifts/open", {
    ...jsonRequest({
      registerId: form.elements.registerId.value,
      businessDate: form.elements.businessDate.value,
      openingFloatMinor: form.elements.openingFloatMinor.value
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  posCurrentShift = (await response.json()).shift;
  sessionStorage.setItem("clearledger_pos_shift", posCurrentShift.id);
  renderPosShiftStatus();
  showNotice("POS shift opened.");
}

function renderPosShiftStatus() {
  const output = elements["pos-shift-status"];
  const closeForm = elements["pos-close-shift-form"];
  if (!posCurrentShift) {
    output.textContent = "No shift loaded.";
    closeForm.hidden = true;
    return;
  }
  output.textContent = `Shift ${posCurrentShift.id.slice(0, 8)} is ${posCurrentShift.status}. Opening float: ${formatMinor(posCurrentShift.openingFloatMinor)}.`;
  closeForm.hidden = posCurrentShift.status !== "OPEN";
}

function posSalePayload() {
  if (!posCurrentShift) throw new Error("Open a POS shift first.");
  const form = elements["pos-sale-form"];
  const editorLine = {
    productItemId: form.elements.productItemId.value,
    quantity: form.elements.quantity.value,
    unitPriceMinor: form.elements.unitPriceMinor.value,
    discountMinor: "0"
  };
  const lines = posCartLines.length ? posCartLines : [editorLine];
  if (lines.some((line) => !line.productItemId || !line.quantity || !line.unitPriceMinor))
    throw new Error("Add at least one complete product line to the cart.");
  return {
    registerId: elements["pos-register-form"].elements.registerId.value,
    shiftId: posCurrentShift.id,
    businessDate: elements["pos-register-form"].elements.businessDate.value,
    lines
  };
}

async function previewPosSale() {
  try {
    const response = await api("/v1/pos/preview", jsonRequest(posSalePayload()));
    if (!response.ok) return showError(response);
    const preview = await response.json();
    elements["pos-preview-output"].textContent =
      `Authoritative preview: ${preview.lines.length} line(s), total ${formatMinor(preview.totals.grandTotalMinor)}; tax ${formatMinor(preview.totals.taxTotalMinor)}.`;
    renderPosTenderSummary(preview.totals.grandTotalMinor);
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "Unable to preview this sale.", true);
  }
}

async function completePosSale(event) {
  event.preventDefault();
  try {
    const payload = {
      ...posSalePayload(),
      tenders: readPosTenders()
    };
    const idempotencyKey = posIntentKey("sale", payload);
    const response = await api("/v1/pos/sales", {
      ...jsonRequest(payload),
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      }
    });
    if (!response.ok) return showError(response);
    const sale = (await response.json()).sale;
    clearPosIntent("sale", payload);
    elements["pos-sale-output"].textContent =
      `Sale complete. Receipt ${sale.receiptNumber ?? sale.id}; total ${formatMinor(sale.grandTotalMinor)}.`;
    renderPosReceipt(sale);
    posCartLines = [];
    renderPosCartLines();
    posTenderRows = [{ type: "CASH", amountReceivedMinor: "" }];
    renderPosTenders();
    await renderPosSales();
    showNotice("POS sale completed and posted through the accounting workflow.");
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "Unable to complete this sale.", true);
  }
}

async function closePosShift(event) {
  event.preventDefault();
  if (!posCurrentShift) return;
  const response = await api(
    `/v1/pos/shifts/${encodeURIComponent(posCurrentShift.id)}/close`,
    jsonRequest({ countedCashMinor: event.currentTarget.elements.countedCashMinor.value })
  );
  if (!response.ok) return showError(response);
  posCurrentShift = (await response.json()).shift;
  if (posCurrentShift.status === "CLOSED") sessionStorage.removeItem("clearledger_pos_shift");
  renderPosShiftStatus();
  const reconciliation = await api(
    `/v1/pos/shifts/${encodeURIComponent(posCurrentShift.id)}/reconciliation`,
    {},
    true
  );
  if (reconciliation.ok) {
    const result = await reconciliation.json();
    elements["pos-reconciliation"].textContent =
      `Reconciliation: ${result.completedSales} completed sale(s), ${formatMinor(result.salesTotalMinor)} total.`;
  }
}

async function renderPosSales() {
  const response = await api(
    posCurrentShift
      ? `/v1/pos/sales?shiftId=${encodeURIComponent(posCurrentShift.id)}`
      : "/v1/pos/sales",
    {},
    true
  );
  if (!response.ok) return;
  const sales = (await response.json()).sales;
  posSales = sales;
  elements["pos-sales"].replaceChildren(
    ...sales.map((sale) =>
      row([
        sale.receiptNumber ?? sale.id.slice(0, 8),
        sale.businessDate,
        formatMinor(sale.grandTotalMinor),
        sale.status
      ])
    )
  );
  renderPosReturnControls();
}

function renderPosReturnControls() {
  const form = elements["pos-return-form"];
  if (!form) return;
  const saleSelect = form.elements.saleId;
  const lineSelect = form.elements.saleLineId;
  const selectedSaleId = saleSelect.value;
  saleSelect.replaceChildren(
    option("", posSales.length ? "Select a completed sale" : "No completed sales"),
    ...posSales
      .filter((sale) => sale.status === "COMPLETED")
      .map((sale) =>
        option(
          sale.id,
          `${sale.receiptNumber ?? sale.id.slice(0, 8)} | ${sale.businessDate} | ${formatMinor(sale.grandTotalMinor)}`
        )
      )
  );
  if (posSales.some((sale) => sale.id === selectedSaleId)) saleSelect.value = selectedSaleId;
  const renderLines = () => {
    const sale = posSales.find((item) => item.id === saleSelect.value);
    const selectedLineId = lineSelect.value;
    lineSelect.replaceChildren(
      option("", sale?.lines?.length ? "Select a sale line" : "Select a sale first"),
      ...(sale?.lines ?? []).map((line) =>
        option(
          line.id,
          `${line.description} | ${line.quantity} × ${formatMinor(line.unitPriceMinor)}`
        )
      )
    );
    if (sale?.lines?.some((line) => line.id === selectedLineId)) lineSelect.value = selectedLineId;
  };
  saleSelect.onchange = renderLines;
  renderLines();
}

async function processPosReturn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const saleId = form.elements.saleId.value;
  if (!saleId) return showNotice("Select a completed sale first.", true);
  const quantity = form.elements.quantity.value.trim();
  const payload = {
    returnDate: new Date().toISOString().slice(0, 10),
    reason: form.elements.reason.value.trim(),
    refund: form.elements.refund.checked,
    ...(posCurrentShift?.status === "OPEN" ? { refundShiftId: posCurrentShift.id } : {}),
    lines: [
      {
        saleLineId: form.elements.saleLineId.value,
        disposition: form.elements.disposition.value,
        ...(quantity ? { quantity } : {})
      }
    ]
  };
  const idempotencyKey = posIntentKey("return", payload);
  const response = await api(`/v1/pos/sales/${encodeURIComponent(saleId)}/returns`, {
    ...jsonRequest(payload),
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    }
  });
  if (!response.ok) return showError(response);
  const returned = (await response.json()).return;
  clearPosIntent("return", payload);
  elements["pos-return-output"].textContent =
    `Return ${returned.status.toLowerCase()}. Credit note ${returned.creditNoteId ?? "pending"}; total ${formatMinor(returned.totalMinor)}.`;
  await renderPosSales();
  showNotice("Return processed through the accounting-safe credit-note workflow.");
}

function posIntentStorageKey(kind) {
  const organizationId = identity?.activeOrganizationId ?? "no-organization";
  const companyId = identity?.activeCompanyId ?? "no-company";
  return `${posIntentStoragePrefix}:${kind}:${organizationId}:${companyId}`;
}

function posIntentKey(kind, payload) {
  const fingerprint = JSON.stringify(payload);
  const storageKey = posIntentStorageKey(kind);
  try {
    const existing = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (
      existing?.fingerprint === fingerprint &&
      typeof existing.idempotencyKey === "string" &&
      existing.idempotencyKey.length >= 16
    )
      return existing.idempotencyKey;
    const idempotencyKey = globalThis.crypto.randomUUID();
    sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, idempotencyKey }));
    return idempotencyKey;
  } catch {
    // Storage is optional. A modern-browser retry remains server-idempotent when it retains this key.
    return globalThis.crypto.randomUUID();
  }
}

function clearPosIntent(kind, payload) {
  const storageKey = posIntentStorageKey(kind);
  try {
    const existing = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (existing?.fingerprint === JSON.stringify(payload)) sessionStorage.removeItem(storageKey);
  } catch {
    // A completed sale or return is still server-authoritative when browser storage is unavailable.
  }
}
