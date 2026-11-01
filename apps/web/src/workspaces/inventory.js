// Inventory (`inventory-workspace`).

import { formatMinor } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { moneyFromForm, option, row } from "../lib/dom.js";
import { formatQuantityMicros, quantityToMicros } from "../lib/format.js";
import { showError, showNotice } from "../lib/notices.js";
import { trackProductEvent } from "../lib/product-analytics.js";
import { formatRole } from "../lib/roles.js";
import { loadBanking, loadSales, registerWorkspaceCalls } from "../lib/workspace-calls.js";
import { refreshContextualSearches } from "../shell.js";
import {
  accounts,
  currentReconciliation,
  elements,
  inventoryLocations,
  products,
  setAccounts,
  setCurrentReconciliation,
  setInventoryLocations,
  setProducts
} from "../state.js";

registerWorkspaceCalls({ loadInventory });

export function initInventory() {
  elements["complete-bank-reconciliation"].addEventListener("click", completeBankReconciliation);
  elements["refresh-inventory"].addEventListener("click", loadInventory);
  elements["inventory-location-form"].addEventListener("submit", createInventoryLocation);
  elements["inventory-product-form"].addEventListener("submit", createInventoryProduct);
  elements["inventory-receipt-form"].addEventListener("submit", receiveInventory);
  elements["inventory-customer-return-form"].addEventListener("submit", recordCustomerReturn);
  elements["inventory-vendor-return-form"].addEventListener("submit", recordVendorReturn);
  elements["inventory-adjustment-form"].addEventListener("submit", postInventoryAdjustment);
  elements["inventory-transfer-form"].addEventListener("submit", postInventoryTransfer);
  elements["inventory-bin-form"].addEventListener("submit", createInventoryBin);
  elements["inventory-status-form"].addEventListener("submit", createInventoryStatus);
  elements["inventory-reservation-form"].addEventListener("submit", createInventoryReservation);
  elements["inventory-transfer-order-form"].addEventListener(
    "submit",
    createInventoryTransferOrder
  );
  elements["inventory-count-form"].addEventListener("submit", createInventoryCount);
}

async function completeBankReconciliation() {
  if (!currentReconciliation) return;
  const response = await api(`/v1/bank-reconciliations/${currentReconciliation.id}/complete`, {
    ...jsonRequest({ version: currentReconciliation.version }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const result = await response.json();
  setCurrentReconciliation(result.reconciliation);
  elements["complete-bank-reconciliation"].disabled = true;
  elements["bank-reconciliation-summary"].textContent =
    `Completed with zero difference. Snapshot ${result.snapshot.revision}.`;
  trackProductEvent("RECONCILIATION_COMPLETED");
  await loadBanking();
}

export async function loadInventory() {
  const [
    locationsResponse,
    quantitiesResponse,
    movementsResponse,
    lowStockResponse,
    costOfGoodsResponse,
    reconciliationResponse,
    binsResponse,
    statusesResponse,
    reorderResponse,
    countsResponse,
    productsResponse,
    accountsResponse
  ] = await Promise.all([
    api("/v1/inventory/locations"),
    api("/v1/inventory/quantities"),
    api("/v1/inventory/movements"),
    api("/v1/inventory/reports/low-stock"),
    api("/v1/inventory/reports/cost-of-goods"),
    api("/v1/inventory/reports/control-reconciliation"),
    api("/v1/inventory/bins"),
    api("/v1/inventory/statuses"),
    api("/v1/inventory/reports/reorder-suggestions"),
    api("/v1/inventory/counts"),
    api("/v1/products"),
    api("/v1/accounts")
  ]);
  if (
    ![
      locationsResponse,
      quantitiesResponse,
      movementsResponse,
      lowStockResponse,
      costOfGoodsResponse,
      reconciliationResponse,
      binsResponse,
      statusesResponse,
      reorderResponse,
      countsResponse,
      productsResponse,
      accountsResponse
    ].every((response) => response.ok)
  )
    return;
  setInventoryLocations((await locationsResponse.json()).locations);
  const quantities = (await quantitiesResponse.json()).quantities;
  const movements = (await movementsResponse.json()).movements;
  const lowStock = (await lowStockResponse.json()).products;
  const costOfGoods = (await costOfGoodsResponse.json()).costOfGoods;
  const reconciliation = (await reconciliationResponse.json()).reconciliation;
  const bins = (await binsResponse.json()).bins;
  const statuses = (await statusesResponse.json()).statuses;
  const reorder = (await reorderResponse.json()).products;
  const counts = (await countsResponse.json()).counts;
  setProducts((await productsResponse.json()).products);
  setAccounts((await accountsResponse.json()).accounts);
  elements["inventory-locations"].replaceChildren(
    ...inventoryLocations.map((item) => row([item.code, item.name, item.isDefault ? "Yes" : "No"]))
  );
  elements["inventory-quantities"].replaceChildren(
    ...quantities.map((item) =>
      row([
        inventoryThumbnail(item.productItem),
        item.productItem.sku ?? "",
        item.productItem.name,
        item.location.code,
        formatQuantityMicros(item.quantityOnHandMicros),
        formatMinor(item.valueOnHandMinor),
        item.averageUnitCostMicros
      ])
    )
  );
  const productNames = new Map(products.map((item) => [item.id, item.name]));
  const locationCodes = new Map(inventoryLocations.map((item) => [item.id, item.code]));
  elements["inventory-movements"].replaceChildren(
    ...movements.map((item) =>
      row([
        item.eventDate.slice(0, 10),
        formatRole(item.movementType),
        productNames.get(item.productItemId) ?? item.productItemId,
        locationCodes.get(item.locationId) ?? item.locationId,
        formatQuantityMicros(item.quantityMicros),
        formatMinor(item.totalValueMinor),
        item.sourceType
      ])
    )
  );
  elements["inventory-low-stock"].textContent = lowStock.length
    ? `Low stock: ${lowStock.map((item) => `${item.sku ?? item.name} (${formatQuantityMicros(item.quantityMicros)})`).join(", ")}`
    : "No products are at or below their reorder point.";
  elements["inventory-cogs"].textContent =
    `Cost of goods: ${formatMinor(costOfGoods.totalCostOfGoodsMinor)}.`;
  elements["inventory-reconciliation"].textContent = reconciliation.isReconciled
    ? `Inventory control reconciled at ${formatMinor(reconciliation.totalInventoryValueMinor)}.`
    : `Inventory control difference: ${formatMinor(reconciliation.differenceMinor)}.`;
  elements["inventory-storage-summary"].textContent =
    `${bins.length} active bins and ${statuses.length} inventory statuses configured.`;
  elements["inventory-reorder"].textContent = reorder.length
    ? `Reorder suggestions: ${reorder.map((item) => `${item.sku ?? item.name} (${formatQuantityMicros(item.suggestedOrderMicros)})`).join(", ")}.`
    : "No reorder suggestions.";
  elements["inventory-count-summary"].textContent = counts.length
    ? `Latest count ${counts[0].countNumber}: ${formatRole(counts[0].status)}.`
    : "No cycle counts yet.";
  renderInventorySelects();
  refreshContextualSearches();
}

function inventoryThumbnail(product) {
  const frame = document.createElement("span");
  frame.className = "inventory-thumbnail";
  const imageUrl = trustedProductImageUrl(product?.productImageReference);
  if (!imageUrl) {
    frame.setAttribute("aria-label", `No product image for ${product?.name ?? "this item"}`);
    frame.title = "No verified product image";
    const fallback = document.createElement("span");
    fallback.textContent = "No image";
    frame.append(fallback);
    return frame;
  }
  const image = document.createElement("img");
  image.src = imageUrl;
  image.alt = `${product.name} thumbnail`;
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    image.remove();
    const fallback = document.createElement("span");
    fallback.textContent = "Image unavailable";
    frame.replaceChildren(fallback);
    frame.setAttribute("aria-label", `Product image unavailable for ${product.name}`);
  });
  frame.append(image);
  return frame;
}

function trustedProductImageUrl(reference) {
  if (typeof reference !== "string" || !reference.trim()) return null;
  if (/^\/v1\/products\/[0-9a-f-]{36}\/image$/i.test(reference.trim())) return reference.trim();
  try {
    const url = new URL(reference);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderInventorySelects() {
  const inventoryProducts = products.filter(
    (item) => item.itemType === "INVENTORY_PRODUCT" && item.active
  );
  const locations = inventoryLocations.filter((item) => item.isActive);
  for (const formId of ["inventory-adjustment-form", "inventory-transfer-form"])
    elements[formId].elements.productItemId.replaceChildren(
      ...inventoryProducts.map((item) => option(item.id, `${item.sku ?? ""} ${item.name}`.trim()))
    );
  for (const formId of ["inventory-reservation-form", "inventory-transfer-order-form"])
    elements[formId].elements.productItemId.replaceChildren(
      ...inventoryProducts.map((item) => option(item.id, `${item.sku ?? ""} ${item.name}`.trim()))
    );
  for (const field of ["defaultLocationId", "locationId", "fromLocationId", "toLocationId"]) {
    const form =
      field === "defaultLocationId"
        ? elements["inventory-product-form"]
        : field === "locationId"
          ? elements["inventory-adjustment-form"]
          : elements["inventory-transfer-form"];
    form.elements[field].replaceChildren(
      ...locations.map((item) => option(item.id, `${item.code} ${item.name}`))
    );
  }
  for (const formId of [
    "inventory-receipt-form",
    "inventory-customer-return-form",
    "inventory-vendor-return-form"
  ])
    elements[formId].elements.locationId.replaceChildren(
      ...locations.map((item) => option(item.id, `${item.code} ${item.name}`))
    );
  elements["inventory-bin-form"].elements.locationId.replaceChildren(
    ...locations.map((item) => option(item.id, `${item.code} ${item.name}`))
  );
  elements["inventory-reservation-form"].elements.locationId.replaceChildren(
    ...locations.map((item) => option(item.id, `${item.code} ${item.name}`))
  );
  elements["inventory-count-form"].elements.locationId.replaceChildren(
    ...locations.map((item) => option(item.id, `${item.code} ${item.name}`))
  );
  for (const field of ["fromLocationId", "toLocationId"])
    elements["inventory-transfer-order-form"].elements[field].replaceChildren(
      ...locations.map((item) => option(item.id, `${item.code} ${item.name}`))
    );
  const accountGroups = {
    incomeAccountId: ["REVENUE", "CONTRA_REVENUE"],
    inventoryAssetAccountId: ["ASSET"],
    costOfGoodsSoldAccountId: ["EXPENSE"],
    purchaseClearingAccountId: ["ASSET"],
    adjustmentGainAccountId: ["REVENUE", "CONTRA_REVENUE"],
    inventoryLossAccountId: ["EXPENSE"]
  };
  for (const [field, types] of Object.entries(accountGroups))
    elements["inventory-product-form"].elements[field].replaceChildren(
      ...accounts
        .filter((item) => types.includes(item.type) && !item.isControl && !item.isArchived)
        .map((item) => option(item.id, `${item.code} ${item.name}`))
    );
  const today = new Date().toISOString().slice(0, 10);
  for (const [formId, field] of [
    ["inventory-receipt-form", "receivedDate"],
    ["inventory-customer-return-form", "returnDate"],
    ["inventory-vendor-return-form", "returnDate"],
    ["inventory-adjustment-form", "effectiveDate"],
    ["inventory-transfer-form", "effectiveDate"]
  ])
    if (!elements[formId].elements[field].value) elements[formId].elements[field].value = today;
}

async function createInventoryLocation(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/inventory/locations",
    jsonRequest({
      code: data.get("code"),
      name: data.get("name"),
      isDefault: data.get("isDefault") === "on"
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Inventory location created.");
}

async function createInventoryProduct(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const salesPriceMinor = moneyFromForm(data, "salesPriceMinor");
  if (salesPriceMinor === null) return;
  const response = await api(
    "/v1/products",
    jsonRequest({
      sku: data.get("sku"),
      name: data.get("name"),
      itemType: "INVENTORY_PRODUCT",
      salesPriceMinor,
      incomeAccountId: data.get("incomeAccountId"),
      inventoryAssetAccountId: data.get("inventoryAssetAccountId"),
      costOfGoodsSoldAccountId: data.get("costOfGoodsSoldAccountId"),
      purchaseClearingAccountId: data.get("purchaseClearingAccountId"),
      adjustmentGainAccountId: data.get("adjustmentGainAccountId"),
      inventoryLossAccountId: data.get("inventoryLossAccountId"),
      defaultLocationId: data.get("defaultLocationId"),
      reorderPointMicros: quantityToMicros(data.get("reorderPoint")),
      safetyStockMicros: quantityToMicros(data.get("safetyStock")),
      preferredStockMicros: quantityToMicros(data.get("preferredStock")),
      leadTimeDays: Number(data.get("leadTimeDays") || 0),
      orderMultipleMicros: quantityToMicros(data.get("orderMultiple")),
      minimumOrderMicros: quantityToMicros(data.get("minimumOrder")),
      unitOfMeasure: "each",
      ...(String(data.get("hsTariffCode") ?? "").trim()
        ? { hsTariffCode: String(data.get("hsTariffCode")).trim() }
        : {}),
      ...(String(data.get("countryOfOrigin") ?? "").trim()
        ? { countryOfOrigin: String(data.get("countryOfOrigin")).trim().toUpperCase() }
        : {})
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await Promise.all([loadSales(), loadInventory()]);
  showNotice("Inventory product created.");
}

async function receiveInventory(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await inventoryCommand("/v1/inventory/purchase-receipts", {
    billLineId: data.get("billLineId"),
    quantity: data.get("quantity"),
    locationId: data.get("locationId"),
    receivedDate: data.get("receivedDate"),
    ...(data.get("reason") ? { reason: data.get("reason") } : {})
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Purchase receipt posted.");
}

async function recordCustomerReturn(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await inventoryCommand("/v1/inventory/customer-returns", {
    creditNoteLineId: data.get("creditNoteLineId"),
    quantity: data.get("quantity"),
    locationId: data.get("locationId"),
    disposition: data.get("disposition"),
    returnDate: data.get("returnDate"),
    reason: data.get("reason")
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Customer inventory return posted.");
}

async function recordVendorReturn(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await inventoryCommand("/v1/inventory/vendor-returns", {
    vendorCreditLineId: data.get("vendorCreditLineId"),
    quantity: data.get("quantity"),
    locationId: data.get("locationId"),
    returnDate: data.get("returnDate"),
    reason: data.get("reason")
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Vendor inventory return posted.");
}

function inventoryCommand(path, body) {
  return api(path, {
    ...jsonRequest(body),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
}

async function postInventoryAdjustment(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const direction = data.get("direction");
  const unitCostMinor = direction === "IN" ? moneyFromForm(data, "unitCostMinor") : null;
  if (direction === "IN" && unitCostMinor === null) return;
  const response = await api("/v1/inventory/adjustments", {
    ...jsonRequest({
      productItemId: data.get("productItemId"),
      locationId: data.get("locationId"),
      direction,
      quantity: data.get("quantity"),
      ...(direction === "IN" ? { unitCostMinor } : {}),
      adjustmentKind: data.get("adjustmentKind"),
      effectiveDate: data.get("effectiveDate"),
      reason: data.get("reason")
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Inventory adjustment posted.");
}

async function postInventoryTransfer(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api("/v1/inventory/transfers", {
    ...jsonRequest({
      productItemId: data.get("productItemId"),
      fromLocationId: data.get("fromLocationId"),
      toLocationId: data.get("toLocationId"),
      quantity: data.get("quantity"),
      effectiveDate: data.get("effectiveDate"),
      ...(data.get("reason") ? { reason: data.get("reason") } : {})
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Inventory transferred.");
}

async function createInventoryBin(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/inventory/bins",
    jsonRequest({
      locationId: data.get("locationId"),
      code: data.get("code"),
      name: data.get("name"),
      pickPriority: Number(data.get("pickPriority") || 0)
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Inventory bin created.");
}

async function createInventoryStatus(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/inventory/statuses",
    jsonRequest({
      code: data.get("code"),
      name: data.get("name"),
      sellable: data.get("sellable") === "on",
      allocatable: data.get("allocatable") === "on"
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadInventory();
  showNotice("Inventory status created.");
}

async function createInventoryReservation(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const expires = data.get("expiresAt");
  const response = await inventoryCommand("/v1/inventory/reservations", {
    productItemId: data.get("productItemId"),
    locationId: data.get("locationId"),
    quantity: data.get("quantity"),
    sourceType: data.get("sourceType"),
    sourceId: data.get("sourceId"),
    ...(expires ? { expiresAt: new Date(String(expires)).toISOString() } : {})
  });
  if (!response.ok) return showError(response);
  const body = await response.json();
  event.target.reset();
  elements["inventory-reservation-summary"].textContent =
    `Reserved ${formatQuantityMicros(body.reservation.quantityMicros)}; available ${formatQuantityMicros(body.availableQuantityMicros)}.`;
  await loadInventory();
  showNotice("Inventory reserved.");
}

async function createInventoryTransferOrder(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await inventoryCommand("/v1/inventory/transfer-orders", {
    fromLocationId: data.get("fromLocationId"),
    toLocationId: data.get("toLocationId"),
    lines: [{ productItemId: data.get("productItemId"), quantity: data.get("quantity") }],
    ...(data.get("reason") ? { reason: data.get("reason") } : {})
  });
  if (!response.ok) return showError(response);
  const body = await response.json();
  event.target.reset();
  elements["inventory-transfer-order-summary"].textContent =
    `Transfer ${body.transfer.transferNumber} created in ${formatRole(body.transfer.status)} state. Approve, ship, then receive it to move value between locations.`;
  await loadInventory();
  showNotice("Transfer order created.");
}

async function createInventoryCount(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await inventoryCommand("/v1/inventory/counts", {
    locationId: data.get("locationId"),
    blind: data.get("blind") === "on"
  });
  if (!response.ok) return showError(response);
  const body = await response.json();
  event.target.reset();
  elements["inventory-count-summary"].textContent =
    `Count ${body.count.countNumber} released with ${body.count.lines.length} lines. Record counted quantities before approving.`;
  await loadInventory();
  showNotice("Cycle count started.");
}
