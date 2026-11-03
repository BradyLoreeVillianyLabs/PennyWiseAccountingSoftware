// Orders and fulfilment (`fulfilment-workspace`).

import { formatMinor } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { option } from "../lib/dom.js";
import { formatQuantityMicros } from "../lib/format.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import { registerWorkspaceCalls } from "../lib/workspace-calls.js";
import { navigateTo } from "../shell.js";
import { accounts, elements, identity, setAccounts } from "../state.js";

// ---------------------------------------------------------------------------
// Orders & fulfilment workspace
//
// D3/D4/D5 built the order-conversion, picking-slip and shipping services and no
// way to drive them: before this, apps/web contained zero references to picking,
// shipment, carrier or commerce/orders. This is the operator surface for that
// loop — review, convert, pick, ship.
//
// The connector review boundary is the point of the screen. Provider data stays
// non-posting until a person acts, so nothing here converts implicitly: loading
// the workspace, selecting an order and reading its preflight all post nothing.
// ---------------------------------------------------------------------------

let fulfilmentOrders = [];
let fulfilmentSelectedEventId = null;
let fulfilmentPreflight = null;
let fulfilmentCarrierAccounts = [];
let fulfilmentInvoice = null;
let fulfilmentPickingSlip = null;
let fulfilmentShipment = null;
let fulfilmentPickingMessage = null;
let fulfilmentShipmentMessage = null;
const fulfilmentProgressByInvoice = new Map();
const fulfilmentShipmentIds = readFulfilmentShipmentIds();
const fulfilmentStatusLabels = {
  AWAITING_REVIEW: "Awaiting review",
  REVIEW_REQUIRED: "Review required",
  REVIEWED: "Reviewed",
  CONVERTED: "Converted",
  PICKED: "Picked",
  SHORT_PICK: "Short pick",
  SHIPPED: "Shipped",
  FAILED: "Failed"
};

registerWorkspaceCalls({ loadFulfilment });

export function initFulfilment() {
  elements["refresh-fulfilment"]?.addEventListener("click", () => void loadFulfilment());
  elements["fulfilment-status-filter"]?.addEventListener("change", () => {
    fulfilmentSelectedEventId = null;
    fulfilmentPreflight = null;
    void loadFulfilmentOrders();
  });
}

function readFulfilmentShipmentIds() {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem("clearledger_fulfilment_shipments_v1") ?? "{}"
    );
    return new Map(
      Object.entries(stored).filter(
        ([invoiceId, shipmentId]) =>
          typeof invoiceId === "string" && typeof shipmentId === "string" && shipmentId
      )
    );
  } catch {
    return new Map();
  }
}

function rememberFulfilmentShipment(invoiceId, shipmentId) {
  if (!invoiceId || !shipmentId) return;
  fulfilmentShipmentIds.set(invoiceId, shipmentId);
  sessionStorage.setItem(
    "clearledger_fulfilment_shipments_v1",
    JSON.stringify(Object.fromEntries(fulfilmentShipmentIds))
  );
}

function fulfilmentShipmentIdFor(invoiceId) {
  return invoiceId ? (fulfilmentShipmentIds.get(invoiceId) ?? null) : null;
}

function setFulfilmentStatus(message, isError = false) {
  const status = elements["fulfilment-status"];
  if (!status) return;
  status.hidden = !message;
  status.textContent = message ?? "";
  status.dataset.state = message ? (isError ? "error" : "info") : "idle";
}

async function loadFulfilment() {
  if (!identity?.activeOrganizationId) return;
  await Promise.all([
    loadFulfilmentOrders(),
    loadFulfilmentCarrierAccounts(),
    accounts.length ? Promise.resolve() : loadFulfilmentAccounts()
  ]);
}

async function loadFulfilmentAccounts() {
  const response = await api("/v1/accounts", {}, true);
  if (response.ok) setAccounts((await response.json()).accounts ?? []);
}

async function loadFulfilmentOrders() {
  const list = elements["fulfilment-order-list"];
  if (!list) return;
  const status = elements["fulfilment-status-filter"]?.value ?? "";
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const response = await api(`/v1/organizations/current/commerce/inbox${query}`, {}, true);
  if (!response.ok) {
    fulfilmentOrders = [];
    list.replaceChildren(
      fulfilmentEmptyState(
        response.status === 403
          ? "Your role cannot review store orders."
          : "Orders could not be loaded. No order was changed."
      )
    );
    setFulfilmentStatus("Orders are unavailable right now.", true);
    return;
  }
  setFulfilmentStatus(null);
  fulfilmentOrders = (await response.json()).events ?? [];
  renderFulfilmentOrders();
  await loadFulfilmentProgress();
}

async function loadFulfilmentProgress() {
  const converted = fulfilmentOrders.filter((event) => event.resultingInvoiceId);
  await Promise.all(
    converted.map(async (event) => {
      const invoiceId = event.resultingInvoiceId;
      const pickingResponse = await api(`/v1/invoices/${invoiceId}/picking-slip`, {}, true);
      let pickingSlip = null;
      if (pickingResponse.ok) pickingSlip = (await pickingResponse.json()).slip ?? null;
      const shipmentId = fulfilmentShipmentIdFor(invoiceId);
      let shipment = null;
      if (shipmentId) {
        const shipmentResponse = await api(`/v1/shipments/${shipmentId}`, {}, true);
        if (shipmentResponse.ok) shipment = (await shipmentResponse.json()).shipment ?? null;
      }
      fulfilmentProgressByInvoice.set(invoiceId, { pickingSlip, shipment });
    })
  );
  renderFulfilmentOrders();
}

function fulfilmentEmptyState(message) {
  const item = document.createElement("li");
  item.className = "empty-state";
  item.textContent = message;
  return item;
}

// The inbox returns the provider's raw payload. Read it defensively: a store can
// omit anything, and a missing field must read as unknown rather than as zero.
function fulfilmentOrderSummary(event) {
  const payload = event.rawPayload ?? {};
  const lines = Array.isArray(payload.line_items) ? payload.line_items : [];
  const buyer = payload.billing ?? {};
  const name = [buyer.first_name, buyer.last_name].filter(Boolean).join(" ").trim();
  return {
    reference: payload.number ?? payload.id ?? event.resourceId ?? event.externalEventId,
    customerName: name || buyer.company || null,
    lineCount: lines.length,
    total: typeof payload.total === "string" ? payload.total : null,
    currency: event.sourceCurrency ?? payload.currency ?? null
  };
}

function fulfilmentDerivedStatus(event) {
  const invoiceId = event?.resultingInvoiceId ?? null;
  const progress = invoiceId ? fulfilmentProgressByInvoice.get(invoiceId) : null;
  const shipment =
    event?.id === fulfilmentSelectedEventId ? fulfilmentShipment : (progress?.shipment ?? null);
  if (shipment?.status === "PURCHASED" || shipment?.status === "PURCHASED_EXPENSE_PENDING")
    return "SHIPPED";
  if (progress?.pickingSlip?.status === "SHORT_PICK") return "SHORT_PICK";
  if (progress?.pickingSlip?.status === "PICKED") return "PICKED";
  if (invoiceId) return "CONVERTED";
  if (event.status === "NORMALIZED") return "REVIEWED";
  if (event.status === "DEAD_LETTER") return "FAILED";
  if (event.status === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  return "AWAITING_REVIEW";
}

function renderFulfilmentOrders() {
  const list = elements["fulfilment-order-list"];
  if (!list) return;
  if (fulfilmentOrders.length === 0) {
    list.replaceChildren(
      fulfilmentEmptyState("No orders are waiting. Nothing needs your attention here.")
    );
    renderFulfilmentDetail();
    return;
  }
  list.replaceChildren(
    ...fulfilmentOrders.map((event) => {
      const summary = fulfilmentOrderSummary(event);
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fulfilment-order";
      button.dataset.eventId = event.id;
      if (event.id === fulfilmentSelectedEventId) button.setAttribute("aria-current", "true");

      const heading = document.createElement("span");
      heading.className = "fulfilment-order-reference";
      heading.textContent = `Order ${String(summary.reference)}`;

      const meta = document.createElement("span");
      meta.className = "fulfilment-order-meta";
      const parts = [];
      if (summary.customerName) parts.push(summary.customerName);
      parts.push(`${String(summary.lineCount)} line${summary.lineCount === 1 ? "" : "s"}`);
      // The provider's own total, labelled as theirs. PennyWise's calculated
      // total appears only in the preflight, where the two can be compared.
      if (summary.total && summary.currency)
        parts.push(`${summary.currency} ${summary.total} at the store`);
      meta.textContent = parts.join(" · ");

      const state = document.createElement("span");
      state.className = "fulfilment-order-state";
      const derivedStatus = fulfilmentDerivedStatus(event);
      state.dataset.status = derivedStatus;
      state.textContent = fulfilmentStatusLabels[derivedStatus] ?? derivedStatus;

      button.append(heading, meta, state);
      button.addEventListener("click", () => void selectFulfilmentOrder(event.id));
      item.append(button);
      return item;
    })
  );
}

async function selectFulfilmentOrder(eventId) {
  fulfilmentSelectedEventId = eventId;
  fulfilmentPreflight = null;
  fulfilmentInvoice = null;
  fulfilmentPickingSlip = null;
  fulfilmentShipment = null;
  fulfilmentPickingMessage = null;
  fulfilmentShipmentMessage = null;
  renderFulfilmentOrders();
  const detail = elements["fulfilment-detail"];
  if (detail) detail.replaceChildren(fulfilmentParagraph("Checking this order…", "empty-state"));
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${eventId}/conversion-preflight`,
    {},
    true
  );
  if (!response.ok) {
    fulfilmentPreflight = null;
    if (detail)
      detail.replaceChildren(
        fulfilmentParagraph(
          "This order could not be checked. Nothing was converted or changed.",
          "empty-state"
        )
      );
    return;
  }
  const body = await response.json();
  fulfilmentPreflight = body.conversion ?? body;
  await loadFulfilmentLinkedRecords();
  renderFulfilmentDetail();
}

async function loadFulfilmentLinkedRecords() {
  const event = fulfilmentSelectedEvent();
  const invoiceId = event?.resultingInvoiceId ?? null;
  if (!invoiceId) {
    renderFulfilmentPicking();
    renderFulfilmentShipping();
    return;
  }
  const invoiceResponse = await api(`/v1/invoices/${invoiceId}`, {}, true);
  fulfilmentInvoice = invoiceResponse.ok ? ((await invoiceResponse.json()).invoice ?? null) : null;
  await Promise.all([loadFulfilmentPicking(invoiceId), loadFulfilmentShipment(invoiceId)]);
  fulfilmentProgressByInvoice.set(invoiceId, {
    pickingSlip: fulfilmentPickingSlip,
    shipment: fulfilmentShipment
  });
  renderFulfilmentOrders();
}

async function loadFulfilmentShipment(invoiceId) {
  fulfilmentShipment = null;
  fulfilmentShipmentMessage = null;
  const shipmentId = fulfilmentShipmentIdFor(invoiceId);
  if (!shipmentId) {
    renderFulfilmentShipping();
    return;
  }
  const response = await api(`/v1/shipments/${shipmentId}`, {}, true);
  if (!response.ok) {
    fulfilmentShipmentMessage =
      response.status === 404
        ? "The saved shipment is no longer available. Create a new shipment draft."
        : "The shipment could not be loaded. No shipping action was made.";
    renderFulfilmentShipping();
    return;
  }
  fulfilmentShipment = (await response.json()).shipment ?? null;
  renderFulfilmentShipping();
}

function fulfilmentParagraph(text, className) {
  const p = document.createElement("p");
  if (className) p.className = className;
  p.textContent = text;
  return p;
}

// providerTotals carries the store's own money representation. Render the
// provider's decimal string as given rather than reformatting it — this is the
// number to compare against, and re-deriving it would defeat the comparison.
function fulfilmentProviderTotal(providerTotals) {
  const total = providerTotals?.money?.total;
  if (!total) return null;
  const currency = total.currency ?? providerTotals.currency ?? "";
  const value = total.providerRepresentation ?? total.decimal;
  return value ? `${currency} ${value}`.trim() : null;
}

function fulfilmentOrderLines(event) {
  const payload = event?.rawPayload ?? {};
  return Array.isArray(payload.line_items) ? payload.line_items : [];
}

function renderFulfilmentOrderLines(event) {
  const lines = fulfilmentOrderLines(event);
  if (!lines.length) return fulfilmentParagraph("The store supplied no line items.", "empty-state");
  const wrapper = document.createElement("div");
  wrapper.className = "fulfilment-line-list";
  const heading = document.createElement("h4");
  heading.textContent = "Store line items";
  const table = document.createElement("table");
  table.className = "fulfilment-lines-table";
  table.innerHTML =
    '<thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Price</th><th scope="col">Total</th></tr></thead>';
  const body = document.createElement("tbody");
  for (const line of lines) {
    const row = document.createElement("tr");
    const values = [
      line.name ?? line.product_name ?? line.sku ?? "Unnamed item",
      line.quantity ?? "Unknown",
      line.price ?? line.unit_price ?? "Unknown",
      line.total ?? line.subtotal ?? "Unknown"
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  wrapper.append(heading, table);
  return wrapper;
}

function renderFulfilmentDetail() {
  const detail = elements["fulfilment-detail"];
  if (!detail) return;
  if (!fulfilmentSelectedEventId || !fulfilmentPreflight) {
    detail.replaceChildren(
      fulfilmentParagraph("Choose an order to see what converting it would create.", "empty-state")
    );
    return;
  }
  const preflight = fulfilmentPreflight;
  const event = fulfilmentOrders.find((candidate) => candidate.id === fulfilmentSelectedEventId);
  if (!event) {
    detail.replaceChildren(
      fulfilmentParagraph("Refresh the order list and choose an order again.", "empty-state")
    );
    return;
  }
  const summary = event ? fulfilmentOrderSummary(event) : null;
  const nodes = [];

  const heading = document.createElement("h3");
  heading.className = "fulfilment-detail-reference";
  heading.textContent = summary ? `Order ${String(summary.reference)}` : "Order";
  nodes.push(heading);

  const state = document.createElement("p");
  state.className = "fulfilment-detail-state";
  const derivedStatus = fulfilmentDerivedStatus(event);
  state.textContent = `Workflow status: ${fulfilmentStatusLabels[derivedStatus] ?? derivedStatus}`;
  state.dataset.status = derivedStatus;
  nodes.push(state, renderFulfilmentOrderLines(event));

  // Readiness first: the operator's question is "can I convert this, and if not,
  // what do I have to do".
  const readiness = document.createElement("p");
  readiness.className = "fulfilment-readiness";
  readiness.dataset.ready = String(preflight.ready === true);
  readiness.textContent = preflight.ready
    ? "Ready to convert. This creates a draft customer invoice. Posting is a separate explicit accounting action."
    : "Not ready to convert yet.";
  nodes.push(readiness);

  const facts = document.createElement("dl");
  facts.className = "fulfilment-facts";
  const providerTotal = fulfilmentProviderTotal(preflight.providerTotals);
  const rows = [
    ["Store total", providerTotal ?? "Not supplied by the store"],
    ["Customer handling", preflight.customerStrategy ?? "Unknown"],
    ["Conversion status", preflight.conversionStatus ?? preflight.status ?? "Unknown"]
  ];
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    facts.append(term, description);
  }
  nodes.push(facts);

  if (fulfilmentInvoice) nodes.push(renderFulfilmentInvoiceState(fulfilmentInvoice));

  if (Array.isArray(preflight.gaps) && preflight.gaps.length > 0) {
    const gapsHeading = document.createElement("h4");
    gapsHeading.textContent = "Before this order can be converted";
    const gaps = document.createElement("ul");
    gaps.className = "fulfilment-gaps";
    for (const gap of preflight.gaps) {
      const item = document.createElement("li");
      // Show the service's own message. A friendlier rewrite here would lose the
      // reason the operator needs in order to fix it.
      item.textContent = gap.message ?? gap.code ?? "Unspecified requirement";
      gaps.append(item);
    }
    nodes.push(gapsHeading, gaps);
  }

  const actions = document.createElement("div");
  actions.className = "fulfilment-actions";

  if (!event.resultingInvoiceId) {
    const markReviewed = document.createElement("button");
    markReviewed.type = "button";
    markReviewed.className = "secondary-command";
    markReviewed.textContent = "Mark reviewed";
    markReviewed.addEventListener("click", () => void reviewFulfilmentOrder("NORMALIZED"));

    const convert = document.createElement("button");
    convert.type = "button";
    convert.className = "fulfilment-convert";
    convert.textContent = "Convert to invoice";
    convert.disabled = preflight.ready !== true;
    if (preflight.ready !== true)
      convert.title = "Resolve the listed requirements before this order can be converted.";
    convert.addEventListener("click", () => void convertFulfilmentOrder());

    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "text-command";
    reject.textContent = "Reject order";
    reject.addEventListener("click", () => void rejectFulfilmentOrder());

    actions.append(markReviewed, convert, reject);
  }
  nodes.push(actions);

  detail.replaceChildren(...nodes);
}

function renderFulfilmentInvoiceState(invoice) {
  const wrapper = document.createElement("section");
  wrapper.className = "fulfilment-linked-record";
  const heading = document.createElement("h4");
  heading.textContent = "Linked invoice";
  const facts = document.createElement("dl");
  facts.className = "fulfilment-facts";
  for (const [label, value] of [
    ["Invoice", invoice.invoiceNumber ?? invoice.provisionalIdentifier ?? invoice.id],
    ["Status", invoice.status ?? "Unknown"],
    ["Total", formatMinor(invoice.grandTotalMinor, invoice.currency)]
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    facts.append(term, description);
  }
  wrapper.append(heading, facts);
  if (invoice.status === "DRAFT" || invoice.status === "APPROVED") {
    const note = fulfilmentParagraph(
      "Posting creates the customer invoice journal and depletes linked inventory. Nothing has been posted yet.",
      "non-posting-callout"
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fulfilment-convert";
    button.textContent = "Post invoice";
    button.addEventListener("click", () => void postFulfilmentInvoice(invoice));
    wrapper.append(note, button);
  } else if (invoice.status === "POSTED") {
    wrapper.append(
      fulfilmentParagraph(
        "Invoice is posted. Warehouse and shipping actions below do not post accounting entries."
      )
    );
  }
  return wrapper;
}

function fulfilmentSelectedEvent() {
  return fulfilmentOrders.find((candidate) => candidate.id === fulfilmentSelectedEventId) ?? null;
}

async function reviewFulfilmentOrder(status) {
  const event = fulfilmentSelectedEvent();
  if (!event) return;
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${event.id}/review`,
    jsonRequest({ status, version: event.version ?? 1 })
  );
  if (!response.ok) return showError(response);
  showNotice("Order marked reviewed.");
  await loadFulfilmentOrders();
  await selectFulfilmentOrder(event.id);
}

async function convertFulfilmentOrder() {
  const event = fulfilmentSelectedEvent();
  if (!event || fulfilmentPreflight?.ready !== true) return;
  const summary = fulfilmentOrderSummary(event);
  const confirmed = window.confirm(
    `Convert order ${String(summary.reference)} into a customer invoice?\n\n` +
      "This creates a draft invoice only. Posting it is a separate explicit accounting action in Order detail."
  );
  if (!confirmed) return;
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${event.id}/convert`,
    jsonRequest({ decision: "CONFIRM", version: event.version ?? 1 })
  );
  if (!response.ok) return showError(response);
  const body = await response.json().catch(() => ({}));
  const invoiceId =
    body.conversion?.resultingInvoiceId ?? body.invoice?.id ?? body.invoiceId ?? null;
  showNotice(
    invoiceId
      ? "Order converted to a draft invoice. Review it, then post it explicitly to continue."
      : "Order converted to an invoice draft."
  );
  await loadFulfilmentOrders();
  await selectFulfilmentOrder(event.id);
}

async function postFulfilmentInvoice(invoice) {
  const label = invoice.invoiceNumber ?? invoice.provisionalIdentifier ?? invoice.id;
  if (
    !window.confirm(
      `Post invoice ${label} for ${formatMinor(invoice.grandTotalMinor, invoice.currency)}?\n\n` +
        "This creates the customer invoice journal and depletes linked inventory. The action is recorded in the audit trail."
    )
  )
    return;
  const response = await api(`/v1/invoices/${invoice.id}/post`, {
    ...jsonRequest({ version: invoice.version }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  showNotice("Invoice posted. You can now create the picking slip.");
  await loadFulfilmentOrders();
  await selectFulfilmentOrder(fulfilmentSelectedEventId);
}

async function rejectFulfilmentOrder() {
  const event = fulfilmentSelectedEvent();
  if (!event) return;
  const reason = window.prompt(
    "Why is this order being rejected? The reason is kept with the order."
  );
  if (!reason || !reason.trim()) return;
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${event.id}/convert`,
    jsonRequest({ decision: "REJECT", version: event.version ?? 1, reason: reason.trim() })
  );
  if (!response.ok) return showError(response);
  showNotice("Order rejected.");
  fulfilmentSelectedEventId = null;
  fulfilmentPreflight = null;
  await loadFulfilmentOrders();
  renderFulfilmentDetail();
}

// --- Picking ---------------------------------------------------------------

async function loadFulfilmentPicking(invoiceId) {
  fulfilmentPickingSlip = null;
  fulfilmentPickingMessage = null;
  const response = await api(`/v1/invoices/${invoiceId}/picking-slip`, {}, true);
  if (!response.ok) {
    fulfilmentPickingMessage =
      response.status === 404
        ? "No picking slip exists for this order yet."
        : "The picking slip could not be loaded. No warehouse record was changed.";
    renderFulfilmentPicking();
    return;
  }
  fulfilmentPickingSlip = (await response.json()).slip ?? null;
  renderFulfilmentPicking();
}

function fulfilmentCreateSlipButton(invoiceId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-command";
  button.textContent = "Create picking slip";
  button.addEventListener("click", () => void createFulfilmentPickingSlip(invoiceId));
  return button;
}

async function createFulfilmentPickingSlip(invoiceId) {
  const response = await api(`/v1/invoices/${invoiceId}/picking-slip`, jsonRequest({}));
  if (!response.ok) return showError(response);
  showNotice("Picking slip created.");
  await loadFulfilmentPicking(invoiceId);
  fulfilmentProgressByInvoice.set(invoiceId, {
    pickingSlip: fulfilmentPickingSlip,
    shipment: fulfilmentShipment
  });
  renderFulfilmentOrders();
}

function renderFulfilmentPicking(slip = fulfilmentPickingSlip) {
  const panel = elements["fulfilment-picking"];
  if (!panel) return;
  if (!fulfilmentInvoice) {
    panel.replaceChildren(
      fulfilmentParagraph(
        "Convert and post an order before producing a picking slip.",
        "empty-state"
      )
    );
    return;
  }
  if (fulfilmentInvoice.status === "DRAFT" || fulfilmentInvoice.status === "APPROVED") {
    panel.replaceChildren(
      fulfilmentParagraph(
        "Post the linked invoice before producing a picking slip. Posting is an explicit accounting action in Order detail.",
        "empty-state"
      )
    );
    return;
  }
  if (!slip) {
    panel.replaceChildren(
      fulfilmentParagraph(
        fulfilmentPickingMessage ?? "No picking slip exists for this order yet.",
        "empty-state"
      ),
      fulfilmentCreateSlipButton(fulfilmentInvoice.id)
    );
    return;
  }
  const nodes = [];
  const facts = document.createElement("dl");
  facts.className = "fulfilment-facts";
  for (const [label, value] of [
    ["Slip", slip.slipNumber ?? slip.id ?? "Unknown"],
    ["Generation", slip.generation != null ? String(slip.generation) : "1"],
    ["Status", slip.status ?? "Open"]
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    facts.append(term, description);
  }
  nodes.push(facts);

  const lineHeading = document.createElement("h4");
  lineHeading.textContent = "Record picked quantities";
  nodes.push(lineHeading);
  const explanation = fulfilmentParagraph(
    "Enter what was physically picked for every line. A short pick creates an inventory-count review only; it does not change stock or post a journal.",
    "field-help"
  );
  nodes.push(explanation);

  if (slip.status !== "PICKED") {
    const form = document.createElement("form");
    form.className = "fulfilment-picking-form";
    form.addEventListener("submit", (event) => void recordFulfilmentPick(event, slip));
    const table = document.createElement("table");
    table.className = "fulfilment-lines-table";
    table.innerHTML =
      '<thead><tr><th scope="col">Item</th><th scope="col">To pick</th><th scope="col">Picked</th></tr></thead>';
    const body = document.createElement("tbody");
    for (const line of slip.lines ?? []) {
      const row = document.createElement("tr");
      const item = document.createElement("td");
      item.textContent = [line.descriptionSnapshot, line.skuSnapshot].filter(Boolean).join(" | ");
      const toPick = document.createElement("td");
      toPick.textContent = formatQuantityMicros(line.quantityToPick);
      const pickedCell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.required = true;
      input.value =
        line.pickedQuantityMicros == null
          ? formatQuantityMicros(line.quantityToPick)
          : formatQuantityMicros(line.pickedQuantityMicros);
      input.dataset.pickingLineId = line.id;
      input.setAttribute("aria-label", `Picked quantity for ${line.descriptionSnapshot}`);
      pickedCell.append(input);
      row.append(item, toPick, pickedCell);
      body.append(row);
    }
    table.append(body);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Record picked quantities";
    form.append(table, submit);
    nodes.push(form);
  } else {
    nodes.push(
      fulfilmentParagraph(
        "All lines were picked. No accounting entry was created by this warehouse action."
      )
    );
  }

  const actions = document.createElement("div");
  actions.className = "fulfilment-actions";
  const openPdf = document.createElement("button");
  openPdf.type = "button";
  openPdf.className = "secondary-command";
  openPdf.textContent = "Open picking slip PDF";
  openPdf.addEventListener("click", () => void openFulfilmentPickingPdf(slip));
  const reprint = document.createElement("button");
  reprint.type = "button";
  reprint.className = "secondary-command";
  reprint.textContent = "Reprint";
  reprint.addEventListener("click", () => void reprintFulfilmentPickingSlip(slip));
  actions.append(openPdf, reprint);
  nodes.push(actions);
  panel.replaceChildren(...nodes);
}

async function openFulfilmentPickingPdf(slip) {
  const response = await api(`/v1/picking-slips/${slip.id}/pdf`, {}, true);
  if (!response.ok) return showError(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.download = `${slip.slipNumber ?? slip.id}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
  showNotice("Picking slip PDF opened. No accounting entry was created.");
}

async function recordFulfilmentPick(event, slip) {
  event.preventDefault();
  const form = event.currentTarget;
  const lines = [...form.querySelectorAll("[data-picking-line-id]")].map((input) => ({
    lineId: input.dataset.pickingLineId,
    pickedQuantity: input.value.trim()
  }));
  if (lines.some((line) => !line.pickedQuantity))
    return showNotice("Record a picked quantity for every line.", true);
  const response = await api(`/v1/picking-slips/${slip.id}/short-pick`, jsonRequest({ lines }));
  if (!response.ok) return showError(response);
  const body = await response.json();
  fulfilmentPickingSlip = body.slip ?? slip;
  fulfilmentPickingMessage = null;
  fulfilmentProgressByInvoice.set(fulfilmentInvoice.id, {
    pickingSlip: fulfilmentPickingSlip,
    shipment: fulfilmentShipment
  });
  showNotice(
    fulfilmentPickingSlip.status === "PICKED"
      ? "All picked quantities recorded. No accounting entry was created."
      : "Short pick recorded for inventory review. No accounting entry was created."
  );
  renderFulfilmentPicking();
  renderFulfilmentOrders();
}

async function reprintFulfilmentPickingSlip(slip) {
  const response = await api(
    `/v1/picking-slips/${slip.id}/reprint`,
    jsonRequest({ version: slip.version ?? 1 })
  );
  if (!response.ok) return showError(response);
  showNotice("Picking slip reprinted.");
  const body = await response.json().catch(() => ({}));
  renderFulfilmentPicking(body.slip ?? slip);
}

// --- Shipping --------------------------------------------------------------

async function loadFulfilmentCarrierAccounts() {
  const response = await api("/v1/shipping/carrier-accounts", {}, true);
  if (!response.ok) {
    fulfilmentCarrierAccounts = [];
    fulfilmentShipmentMessage =
      "Carrier accounts could not be loaded. No label was bought or changed.";
    renderFulfilmentShipping();
    return;
  }
  fulfilmentCarrierAccounts = (await response.json()).carrierAccounts ?? [];
  renderFulfilmentShipping();
}

function renderFulfilmentShipping() {
  const panel = elements["fulfilment-shipping"];
  if (!panel) return;
  const activeCarrierAccounts = fulfilmentCarrierAccounts.filter(
    (account) => account.status === "ACTIVE"
  );
  if (fulfilmentCarrierAccounts.length === 0 || activeCarrierAccounts.length === 0) {
    const nodes = [
      fulfilmentParagraph(
        "No carrier account is connected, so labels cannot be bought yet.",
        "empty-state"
      ),
      fulfilmentParagraph(
        "Connect the carrier account you already hold in External integrations. Postage is billed to that account by the carrier.",
        "field-help"
      )
    ];
    const open = document.createElement("button");
    open.type = "button";
    open.className = "secondary-command";
    open.textContent = "Open External integrations";
    open.addEventListener("click", () => navigateTo("integrations-workspace"));
    nodes.push(open);
    panel.replaceChildren(...nodes);
    return;
  }
  if (!fulfilmentInvoice) {
    panel.replaceChildren(
      fulfilmentParagraph("Convert and post an order before creating a shipment.", "empty-state")
    );
    return;
  }
  if (!["POSTED", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(fulfilmentInvoice.status)) {
    panel.replaceChildren(
      fulfilmentParagraph(
        "The linked invoice must be posted before a shipment can be created.",
        "empty-state"
      )
    );
    return;
  }
  if (!fulfilmentShipment) {
    panel.replaceChildren(
      fulfilmentShipmentMessage
        ? fulfilmentParagraph(fulfilmentShipmentMessage, "empty-state")
        : fulfilmentParagraph(
            "Create a shipment draft. This does not call the carrier or post an expense.",
            "field-help"
          ),
      fulfilmentCreateShipmentForm(activeCarrierAccounts)
    );
    return;
  }
  panel.replaceChildren(renderFulfilmentShipmentState(fulfilmentShipment));
  /*
      .join(" · ");
    item.append(name, meta);
    list.append(item);
  }
  panel.replaceChildren(list);
  */
}

function fulfilmentField(labelText, control, helpText) {
  const label = document.createElement("label");
  label.className = "fulfilment-field";
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(text, control);
  if (helpText) {
    const help = document.createElement("small");
    help.className = "field-help";
    help.textContent = helpText;
    label.append(help);
  }
  return label;
}

function fulfilmentInput(name, type, value, options = {}) {
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value;
  if (options.required) input.required = true;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.step !== undefined) input.step = String(options.step);
  if (options.inputMode) input.inputMode = options.inputMode;
  if (options.placeholder) input.placeholder = options.placeholder;
  return input;
}

function fulfilmentSelect(name, choices, required = false) {
  const select = document.createElement("select");
  select.name = name;
  select.replaceChildren(...choices.map(([value, label]) => option(value, label)));
  select.required = required;
  return select;
}

function fulfilmentFormActions(submitLabel) {
  const actions = document.createElement("div");
  actions.className = "fulfilment-actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "fulfilment-convert";
  submit.textContent = submitLabel;
  actions.append(submit);
  return actions;
}

function fulfilmentCreateShipmentForm(carrierAccounts) {
  const form = document.createElement("form");
  form.className = "fulfilment-shipment-form";
  form.addEventListener("submit", (event) => void createFulfilmentShipment(event));
  const carrier = fulfilmentSelect(
    "carrierAccountId",
    [
      ["", "Choose carrier account"],
      ...carrierAccounts.map((account) => [
        account.id,
        `${account.displayName ?? account.carrierKey} | ${account.environment}`
      ])
    ],
    true
  );
  const parcelFields = document.createElement("div");
  parcelFields.className = "fulfilment-form-grid";
  parcelFields.append(
    fulfilmentField("Carrier account", carrier),
    fulfilmentField(
      "Weight (grams)",
      fulfilmentInput("weightGrams", "number", "1500", { required: true, min: 1 })
    ),
    fulfilmentField(
      "Length (mm)",
      fulfilmentInput("lengthMm", "number", "300", { required: true, min: 1 })
    ),
    fulfilmentField(
      "Width (mm)",
      fulfilmentInput("widthMm", "number", "200", { required: true, min: 1 })
    ),
    fulfilmentField(
      "Height (mm)",
      fulfilmentInput("heightMm", "number", "100", { required: true, min: 1 })
    ),
    fulfilmentField(
      "Package type",
      fulfilmentInput("packageType", "text", "BOX", { placeholder: "BOX" }),
      "Dimensions and weight are sent to the carrier exactly as entered."
    )
  );
  form.append(
    fulfilmentParagraph(
      "The posted invoice supplies the sender and customer shipping address. Review the parcel measurements before asking the carrier for a quote.",
      "field-help"
    ),
    parcelFields,
    fulfilmentFormActions("Create shipment draft")
  );
  return form;
}

function fulfilmentShipmentFacts(shipment) {
  const facts = document.createElement("dl");
  facts.className = "fulfilment-facts";
  const carrier = shipment.carrierAccount ?? {};
  const quote = shipment.quotedCostMinor
    ? formatMinor(shipment.quotedCostMinor, shipment.quotedCurrency)
    : "No quote yet";
  for (const [label, value] of [
    ["Shipment", shipment.id],
    ["Carrier", carrier.displayName ?? carrier.carrierKey ?? "Unknown"],
    ["Status", shipment.status ?? "Unknown"],
    ["Service", shipment.serviceName ?? shipment.serviceCode ?? "Not selected"],
    ["Quote", quote],
    ["Tracking", shipment.trackingNumber ?? "Not available"]
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    facts.append(term, description);
  }
  return facts;
}

function fulfilmentShipmentError(shipment) {
  if (!shipment.lastErrorMessage && !shipment.lastProviderCode) return null;
  const error = fulfilmentParagraph(
    [shipment.lastErrorMessage, shipment.lastProviderCode].filter(Boolean).join(" | "),
    "fulfilment-provider-error"
  );
  error.setAttribute("role", "alert");
  return error;
}

function fulfilmentQuoteForm(shipment) {
  const form = document.createElement("form");
  form.className = "fulfilment-quote-form";
  form.addEventListener("submit", (event) => void quoteFulfilmentShipment(event, shipment));
  const service = fulfilmentInput("serviceCode", "text", shipment.serviceCode ?? "", {
    placeholder: "Optional carrier service code"
  });
  form.append(
    fulfilmentField(
      "Service code",
      service,
      "Leave blank to let the configured carrier choose its default service."
    ),
    fulfilmentFormActions("Get carrier quote")
  );
  return form;
}

function fulfilmentAccountLabel(accountId) {
  const account = accounts.find((candidate) => candidate.id === accountId);
  return account ? `${account.code} ${account.name}` : "Choose an account";
}

function fulfilmentPurchaseForm(shipment) {
  const expenseAccounts = accounts.filter(
    (account) => account.type === "EXPENSE" && !account.isControl && !account.isArchived
  );
  const payingAccounts = accounts.filter(
    (account) =>
      ["ASSET", "LIABILITY", "EQUITY"].includes(account.type) &&
      account.systemPurpose !== "accounts-receivable" &&
      !account.isArchived
  );
  const form = document.createElement("form");
  form.className = "fulfilment-purchase-form";
  form.addEventListener("submit", (event) => void purchaseFulfilmentShipment(event, shipment));
  if (!expenseAccounts.length || !payingAccounts.length) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "secondary-command";
    open.textContent = "Open chart of accounts";
    open.addEventListener("click", () => navigateTo("setup-workspace"));
    form.append(
      fulfilmentParagraph(
        "An active expense account and paying account are required before postage can be purchased.",
        "empty-state"
      ),
      open
    );
    return form;
  }
  const expense = fulfilmentSelect(
    "expenseAccountId",
    [
      ["", "Choose postage expense account"],
      ...expenseAccounts.map((account) => [account.id, `${account.code} ${account.name}`])
    ],
    true
  );
  const paying = fulfilmentSelect(
    "payingAccountId",
    [
      ["", "Choose paying account"],
      ...payingAccounts.map((account) => [account.id, `${account.code} ${account.name}`])
    ],
    true
  );
  const method = fulfilmentSelect(
    "expenseMethod",
    [
      ["", "Choose payment method"],
      ["CASH", "Cash"],
      ["CHEQUE", "Cheque"],
      ["ELECTRONIC_TRANSFER", "Electronic transfer"],
      ["CREDIT_CARD", "Credit card"],
      ["OWNER_PAID", "Owner paid"],
      ["OTHER", "Other"]
    ],
    true
  );
  const date = fulfilmentInput("expenseDate", "date", new Date().toISOString().slice(0, 10), {
    required: true
  });
  const fields = document.createElement("div");
  fields.className = "fulfilment-form-grid";
  fields.append(
    fulfilmentField("Postage expense account", expense),
    fulfilmentField("Paying account", paying),
    fulfilmentField("Payment method", method),
    fulfilmentField("Expense date", date)
  );
  form.append(
    fulfilmentParagraph(
      `Buying this label will call the carrier and create one immediate expense for ${formatMinor(shipment.quotedCostMinor, shipment.quotedCurrency)}. This is the only shipping action that posts an expense.`,
      "fulfilment-posting-callout"
    ),
    fields,
    fulfilmentFormActions("Review and purchase label")
  );
  return form;
}

function renderFulfilmentShipmentState(shipment) {
  const wrapper = document.createElement("div");
  wrapper.className = "fulfilment-shipment-state";
  const heading = document.createElement("h3");
  heading.textContent = "Shipment";
  wrapper.append(heading, fulfilmentShipmentFacts(shipment));
  const error = fulfilmentShipmentError(shipment);
  if (error) wrapper.append(error);
  if (["DRAFT", "FAILED"].includes(shipment.status)) wrapper.append(fulfilmentQuoteForm(shipment));
  if (["QUOTED", "PURCHASED_EXPENSE_PENDING"].includes(shipment.status)) {
    wrapper.append(
      fulfilmentParagraph(
        shipment.status === "PURCHASED_EXPENSE_PENDING"
          ? "The carrier purchase was recorded. Complete the linked expense below; the service will reconcile the existing purchase instead of buying a second label."
          : "Review the carrier quote, then choose the accounts and date for the one expense that label purchase will post.",
        "field-help"
      ),
      fulfilmentPurchaseForm(shipment)
    );
  }
  if (shipment.status === "VOID_REJECTED")
    wrapper.append(
      fulfilmentParagraph(
        "The carrier rejected the void. Review its response before trying again.",
        "field-help"
      )
    );
  if (["PURCHASED", "VOID_PENDING", "VOID_REJECTED"].includes(shipment.status)) {
    const actions = document.createElement("div");
    actions.className = "fulfilment-actions";
    for (const label of shipment.labels ?? []) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "secondary-command";
      open.textContent = label.format === "ZPL" ? "Download ZPL label" : "Open PDF label";
      open.addEventListener("click", () => void openFulfilmentLabel(label));
      actions.append(open);
    }
    if (shipment.status === "PURCHASED") {
      const track = document.createElement("button");
      track.type = "button";
      track.className = "secondary-command";
      track.textContent = "Refresh tracking";
      track.addEventListener("click", () => void trackFulfilmentShipment(shipment));
      actions.append(track);
    }
    if (["PURCHASED", "VOID_REJECTED"].includes(shipment.status)) {
      const voidButton = document.createElement("button");
      voidButton.type = "button";
      voidButton.className = "text-command";
      voidButton.textContent = "Void shipment";
      voidButton.addEventListener("click", () => void voidFulfilmentShipment(shipment));
      actions.append(voidButton);
    }
    wrapper.append(actions);
  }
  if (shipment.status === "VOIDED")
    wrapper.append(
      fulfilmentParagraph(
        "The carrier accepted the void. No active label remains for this shipment."
      )
    );
  return wrapper;
}

function updateFulfilmentShipment(shipment) {
  fulfilmentShipment = shipment;
  if (fulfilmentInvoice?.id && shipment?.id)
    rememberFulfilmentShipment(fulfilmentInvoice.id, shipment.id);
  if (fulfilmentInvoice?.id)
    fulfilmentProgressByInvoice.set(fulfilmentInvoice.id, {
      pickingSlip: fulfilmentPickingSlip,
      shipment
    });
  renderFulfilmentShipping();
  renderFulfilmentOrders();
}

async function createFulfilmentShipment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = {};
  for (const name of ["weightGrams", "lengthMm", "widthMm", "heightMm"]) {
    const value = Number(form.elements[name].value);
    if (!Number.isSafeInteger(value) || value <= 0)
      return showNotice(`${name} must be a positive whole number.`, true);
    values[name] = value;
  }
  const packageType = form.elements.packageType.value.trim();
  const response = await api(
    `/v1/invoices/${fulfilmentInvoice.id}/shipment`,
    jsonRequest({
      carrierAccountId: form.elements.carrierAccountId.value,
      parcels: [{ parcelNumber: 1, ...values, ...(packageType ? { packageType } : {}) }]
    })
  );
  if (!response.ok) return showError(response);
  const body = await response.json();
  updateFulfilmentShipment(body.shipment);
  showNotice("Shipment draft created. No carrier call or expense was made.");
}

async function quoteFulfilmentShipment(event, shipment) {
  event.preventDefault();
  const serviceCode = event.currentTarget.elements.serviceCode.value.trim();
  const response = await api(
    `/v1/shipments/${shipment.id}/quote`,
    jsonRequest({ version: shipment.version, ...(serviceCode ? { serviceCode } : {}) })
  );
  if (!response.ok) return showError(response);
  const body = await response.json();
  updateFulfilmentShipment(body.shipment);
  showNotice("Carrier quote received. Review it before purchasing the label.");
}

async function purchaseFulfilmentShipment(event, shipment) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const expenseAccountId = form.elements.expenseAccountId.value;
  const payingAccountId = form.elements.payingAccountId.value;
  const expenseMethod = form.elements.expenseMethod.value;
  const expenseDate = form.elements.expenseDate.value;
  const amount = formatMinor(shipment.quotedCostMinor, shipment.quotedCurrency);
  const expenseAccount = fulfilmentAccountLabel(expenseAccountId);
  const payingAccount = fulfilmentAccountLabel(payingAccountId);
  if (
    !window.confirm(
      `Purchase the ${shipment.serviceName ?? shipment.serviceCode} label for ${amount}?\n\n` +
        `This calls the carrier and posts one immediate expense: ${amount} to ${expenseAccount}, paid from ${payingAccount}, method ${formatRole(expenseMethod)}, dated ${expenseDate}. Confirm only if those exact accounting details are correct.`
    )
  )
    return;
  const response = await api(
    `/v1/shipments/${shipment.id}/purchase`,
    jsonRequest({
      version: shipment.version,
      confirmed: true,
      serviceCode: shipment.serviceCode,
      quotedCostMinor: shipment.quotedCostMinor,
      quotedCurrency: shipment.quotedCurrency,
      expenseAccountId,
      payingAccountId,
      expenseMethod,
      expenseDate
    })
  );
  if (!response.ok) return showError(response);
  const body = await response.json();
  updateFulfilmentShipment(body.shipment);
  showNotice("Label purchased. One shipping expense was posted to the selected accounts.");
}

async function openFulfilmentLabel(label) {
  const response = await api(`/v1/shipment-labels/${label.id}`, {}, true);
  if (!response.ok) return showError(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.download = `${label.id}.${label.format === "ZPL" ? "zpl" : "pdf"}`;
  link.click();
  URL.revokeObjectURL(url);
  showNotice(
    `${label.format === "ZPL" ? "ZPL" : "PDF"} label opened. No accounting entry was created.`
  );
}

async function trackFulfilmentShipment(shipment) {
  const response = await api(`/v1/shipments/${shipment.id}/track`, jsonRequest({}));
  if (!response.ok) return showError(response);
  const body = await response.json();
  updateFulfilmentShipment(body.shipment);
  showNotice("Tracking refreshed. No accounting entry was created.");
}

async function voidFulfilmentShipment(shipment) {
  const reason = window.prompt(
    "Why is this shipment being voided? The reason is kept with the shipment."
  );
  if (!reason || !reason.trim()) return;
  if (
    !window.confirm(
      "Ask the carrier to void this shipment? The carrier's response will decide the final state."
    )
  )
    return;
  const response = await api(
    `/v1/shipments/${shipment.id}/void`,
    jsonRequest({ version: shipment.version, reason: reason.trim() })
  );
  if (!response.ok) return showError(response);
  const body = await response.json();
  updateFulfilmentShipment(body.shipment);
  showNotice(
    "Carrier void response recorded. No accounting entry was created by the void request."
  );
}
