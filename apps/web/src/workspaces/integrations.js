// Integrations and commerce connectors (`integrations-workspace`).

import { formatMinor, parseMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { descriptionItem, metric, option, row } from "../lib/dom.js";
import { formatQuantityMicros, quantityToMicros } from "../lib/format.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import {
  ownerWorkspaceEmpty,
  registerWorkspaceCalls,
  showWorkspaceNavigation
} from "../lib/workspace-calls.js";
import { buildWorkspaceSubnavigation, navigateTo } from "../shell.js";
import {
  accounts,
  activeWorkspaceId,
  elements,
  identity,
  inventoryLocations,
  products,
  setAccounts,
  setActiveWorkspaceId,
  setInventoryLocations,
  setProducts
} from "../state.js";

let emailConnections = [];
let emailDeliveryConfiguration = { mode: "DISABLED", enabled: false, reason: "disabled" };
let connectorProviders = [];
let connectorInstallations = [];
let commerceInboxEvents = [];
let activeCommerceConversion = null;
let externalCatalogProducts = [];
let inventorySyncState = { policies: [], operations: [], accountingEntriesCreated: 0 };
let selectedCatalogVariantId = null;
let activeInventoryConflict = null;
let catalogPollHasMore = false;
const commerceViewStorageKey = "clearledger_commerce_view";
const commerceViews = new Set(["review", "catalog", "inventory", "connections"]);
let activeCommerceView = commerceViews.has(sessionStorage.getItem(commerceViewStorageKey))
  ? sessionStorage.getItem(commerceViewStorageKey)
  : "review";
const connectorSyncContinuationStorageKey = "clearledger_connector_sync_continuation";
let connectorSyncContinuation = readConnectorSyncContinuation();

registerWorkspaceCalls({ formatConnectorStatus, formatConnectorTime, loadIntegrations });

export function initIntegrations() {
  elements["refresh-integrations"].addEventListener("click", loadIntegrations);
  elements["email-connections-list"].addEventListener("click", handleEmailConnectionAction);
  elements["smtp-connection-form"].addEventListener("submit", configureSmtpConnection);
  elements["load-commerce-demo"].addEventListener("click", loadCommerceDemo);
  elements["connector-draft-form"].addEventListener("submit", createConnectorDraft);
  elements["woocommerce-connect-form"].addEventListener("submit", connectWooCommerce);
  elements["etsy-oauth-form"].addEventListener("submit", startEtsyOAuth);
  elements["etsy-webhook-form"].addEventListener("submit", saveEtsyWebhookSecret);
  elements["connector-sync-form"].addEventListener("submit", syncConnector);
  elements["continue-connector-sync"].addEventListener("click", continueConnectorSync);
  elements["connector-mapping-form"].addEventListener("submit", saveConnectorMapping);
  elements["connector-installations"].addEventListener("click", handleConnectorAction);
  elements["commerce-inbox-events"].addEventListener("click", reviewCommerceEvent);
  elements["commerce-inbox-filter"].addEventListener("change", loadCommerceInbox);
  elements["commerce-conversion-confirm"].addEventListener("click", confirmCommerceConversion);
  elements["commerce-conversion-reject"].addEventListener("click", rejectCommerceConversion);
  elements["commerce-view-navigation"].addEventListener("click", handleCommerceViewNavigation);
  elements["catalog-poll-form"].addEventListener("submit", pollConnectorCatalog);
  elements["continue-catalog-poll"].addEventListener("click", continueCatalogPoll);
  elements["open-product-spreadsheet-import"].addEventListener(
    "click",
    openProductSpreadsheetImport
  );
  elements["open-catalog-bulk-create"].addEventListener("click", openCatalogBulkProductDialog);
  elements["catalog-product-filter"].addEventListener("input", renderCatalogReview);
  elements["catalog-product-list"].addEventListener("click", selectCatalogVariant);
  elements["catalog-selection"].addEventListener("click", handleCatalogReviewAction);
  elements["catalog-selection"].addEventListener("submit", handleCatalogPatternAction);
  elements["catalog-product-form"].addEventListener("submit", createProductFromCatalog);
  elements["catalog-bulk-product-form"].addEventListener("submit", createProductsFromCatalogBulk);
  elements["catalog-bulk-product-selection"].addEventListener(
    "change",
    renderCatalogBulkCreateSelectionSummary
  );
  elements["refresh-inventory-sync"].addEventListener("click", loadCatalogAutomation);
  elements["inventory-sync-policy-form"].addEventListener("submit", saveInventorySyncPolicy);
  elements["inventory-sync-policy-form"].elements.catalogVariantId.addEventListener(
    "change",
    renderInventoryPolicyMapping
  );
  elements["inventory-sync-policy-form"].elements.locationId.addEventListener(
    "change",
    fillExistingInventoryPolicy
  );
  elements["inventory-sync-policy-form"].elements.sourceOfTruth.addEventListener(
    "change",
    renderInventoryPolicyEffect
  );
  elements["inventory-sync-policy-form"].elements.enabled.addEventListener(
    "change",
    renderInventoryPolicyEffect
  );
  elements["reset-inventory-policy"].addEventListener("click", resetInventoryPolicyForm);
  elements["inventory-sync-policies"].addEventListener("click", editInventorySyncPolicy);
  elements["inventory-conflict-filter"].addEventListener("change", renderInventorySyncReview);
  elements["inventory-sync-conflicts"].addEventListener("click", openInventoryConflictReview);
  elements["inventory-conflict-form"].elements.action.addEventListener(
    "change",
    renderInventoryConflictEffect
  );
  elements["inventory-conflict-form"].addEventListener("submit", resolveInventoryConflict);
  elements["process-inventory-operations"].addEventListener("click", processInventoryOperations);
  elements["inventory-sync-operations"].addEventListener("click", retryInventoryOperation);
  elements["connector-mapping-form"].elements.connectorId.addEventListener(
    "change",
    fillConnectorMappingForm
  );
  elements["etsy-webhook-form"].elements.connectorId.addEventListener(
    "change",
    renderEtsyWebhookUrl
  );
  elements["open-accountant-commerce-review"].addEventListener("click", () => {
    setCommerceView("review");
  });
}

export async function loadIntegrations() {
  if (!identity?.activeOrganizationId) return;
  setCommerceView(activeCommerceView);
  const [providerResponse, connectorResponse] = await Promise.all([
    api("/v1/organizations/current/connectors/providers", {}, true),
    api("/v1/organizations/current/connectors", {}, true)
  ]);
  if (providerResponse.ok) connectorProviders = (await providerResponse.json()).providers;
  if (connectorResponse.ok) connectorInstallations = (await connectorResponse.json()).connectors;
  else if (connectorResponse.status !== 403) await showError(connectorResponse);
  renderConnectorProviders();
  renderConnectorSelects();
  renderConnectorInstallations();
  renderConnectorSyncContinuation();
  setDefaultConnectorDates();
  await Promise.all([loadCommerceInbox(), loadCatalogAutomation(), loadEmailConnections()]);
}

async function loadEmailConnections() {
  if (!identity?.activeOrganizationId) return;
  const response = await api("/v1/email-connections", {}, true);
  if (!response.ok) {
    emailConnections = [];
    const message =
      response.status === 403
        ? "Email connections are not available for your current role."
        : "Email connections could not be loaded. Refresh and try again.";
    renderEmailConnections(message);
    return;
  }
  const payload = await response.json();
  emailConnections = payload.providers ?? [];
  emailDeliveryConfiguration = payload.delivery ?? {
    mode: "DISABLED",
    enabled: false,
    reason: "disabled"
  };
  renderEmailConnections();
}

function renderEmailConnections(unavailableMessage = "") {
  const list = elements["email-connections-list"];
  renderEmailDeliveryConfiguration();
  if (unavailableMessage) {
    list.replaceChildren(ownerWorkspaceEmpty(unavailableMessage));
    return;
  }
  if (!emailConnections.length) {
    list.replaceChildren(
      ownerWorkspaceEmpty("No email providers are available in this environment.")
    );
    return;
  }
  list.replaceChildren(
    ...emailConnections.map((provider) => {
      const card = document.createElement("article");
      card.className = "email-connection-card";
      const copy = document.createElement("div");
      const heading = document.createElement("h3");
      const detail = document.createElement("p");
      const status = document.createElement("span");
      const actions = document.createElement("div");
      const providerLabel =
        provider.provider === "GMAIL"
          ? "Gmail"
          : provider.provider === "MICROSOFT"
            ? "Microsoft Outlook / Hotmail"
            : "SMTP relay";
      heading.textContent = providerLabel;
      status.className = "status-pill";
      if (!provider.configured) {
        status.textContent = "Not configured";
        detail.textContent =
          provider.provider === "SMTP"
            ? "This environment needs the secure email credential encryption key before an SMTP relay can be tested or saved."
            : "This environment needs the provider OAuth client and secure credential encryption before a mailbox can be connected.";
        const action = document.createElement("button");
        action.textContent = "Unavailable";
        action.disabled = true;
        action.type = "button";
        action.className = "secondary-command";
        actions.append(action);
      } else if (provider.connection?.status === "CONNECTED") {
        status.textContent = provider.connection.isDefaultSender ? "Sending mailbox" : "Connected";
        detail.textContent = provider.connection.senderEmail
          ? `${provider.provider === "SMTP" ? "Configured from" : "Authorized as"} ${provider.connection.senderEmail}.${provider.connection.isDefaultSender ? " This is the default sending mailbox." : " Choose it as the default mailbox before sending."}`
          : provider.connection.isDefaultSender
            ? "Configured as the default sending mailbox. Sending remains an explicit action."
            : "Configured. Choose it as the default mailbox before sending.";
        if (!provider.connection.isDefaultSender) {
          const makeDefault = document.createElement("button");
          makeDefault.type = "button";
          makeDefault.className = "secondary-command";
          makeDefault.textContent = "Use for sending";
          makeDefault.dataset.emailConnectionAction = "default";
          makeDefault.dataset.connectionId = provider.connection.id;
          actions.append(makeDefault);
        }
        const disconnect = document.createElement("button");
        disconnect.type = "button";
        disconnect.className = "secondary-command";
        disconnect.textContent = "Disconnect";
        disconnect.dataset.emailConnectionAction = "disconnect";
        disconnect.dataset.connectionId = provider.connection.id;
        actions.append(disconnect);
      } else if (
        provider.provider === "SMTP" &&
        (emailDeliveryConfiguration.mode !== "SMTP" || emailDeliveryConfiguration.enabled !== true)
      ) {
        status.textContent = "Delivery disabled";
        detail.textContent =
          "Enable SMTP delivery in the controlled runtime before PennyWise can test or store this relay.";
        const action = document.createElement("button");
        action.textContent = "SMTP unavailable";
        action.disabled = true;
        action.type = "button";
        action.className = "secondary-command";
        actions.append(action);
      } else {
        status.textContent = provider.connection?.status
          ? formatRole(provider.connection.status)
          : "Not connected";
        detail.textContent = provider.connection?.lastErrorCode
          ? provider.provider === "SMTP"
            ? "The last SMTP test was not completed. Check the relay settings and test again."
            : "The last authorization was not completed. Start a new authorization when ready."
          : provider.provider === "SMTP"
            ? "Enter your relay settings. PennyWise sends one test email before it saves or enables this connection."
            : "Authorize only the minimum sending permission from the provider's sign-in page.";
        const action = document.createElement("button");
        action.textContent =
          provider.provider === "SMTP"
            ? "Configure SMTP"
            : provider.connection?.status === "PENDING"
              ? "Authorize again"
              : "Connect";
        action.dataset.emailConnectionAction =
          provider.provider === "SMTP" ? "configure-smtp" : "connect";
        action.dataset.provider = provider.provider;
        action.type = "button";
        action.className = "secondary-command";
        actions.append(action);
      }
      copy.append(heading, status, detail);
      actions.className = "email-connection-actions";
      card.append(copy, actions);
      return card;
    })
  );
}

function renderEmailDeliveryConfiguration() {
  const status = elements["email-configuration-status"];
  const configuration = emailDeliveryConfiguration;
  status.classList.toggle("is-ready", configuration.enabled === true);
  const messages = {
    ready:
      "Email delivery is ready. An explicit invoice or estimate email uses the selected default mailbox or SMTP relay.",
    disabled:
      "Email delivery is disabled for this environment. Connect a mailbox now if desired; no customer mail can be sent until delivery is enabled.",
    "invalid-mode":
      "Email delivery is disabled because its configured mode is invalid. Set EMAIL_DELIVERY_MODE to connected-mailbox or smtp after reviewing the setup guide.",
    "beta-approval-required":
      "Email delivery is waiting for the beta delivery approval flag. Mailbox connections remain safe to test, but no customer email can be sent yet.",
    "oauth-provider-not-configured":
      "Email delivery needs at least one configured Gmail or Microsoft OAuth client before it can be enabled.",
    "credential-encryption-unavailable":
      "Email delivery needs the secure email credential encryption key before it can be enabled."
  };
  status.textContent = messages[configuration.reason] ?? messages.disabled;
}

async function handleEmailConnectionAction(event) {
  const button = event.target.closest("[data-email-connection-action]");
  if (!(button instanceof globalThis.HTMLButtonElement) || button.disabled) return;
  if (button.dataset.emailConnectionAction === "configure-smtp") {
    openSmtpConnectionDialog();
    return;
  }
  if (button.dataset.emailConnectionAction === "default") {
    button.disabled = true;
    const response = await api(
      `/v1/email-connections/${button.dataset.connectionId}/default`,
      jsonRequest({})
    );
    if (!response.ok) {
      button.disabled = false;
      return showError(response);
    }
    await loadEmailConnections();
    showNotice(
      "Default sending mailbox updated. Customer email still requires an explicit send action."
    );
    return;
  }
  if (button.dataset.emailConnectionAction === "disconnect") {
    button.disabled = true;
    const response = await api(
      `/v1/email-connections/${button.dataset.connectionId}/disconnect`,
      jsonRequest({})
    );
    if (!response.ok) {
      button.disabled = false;
      return showError(response);
    }
    await loadEmailConnections();
    showNotice("Email connection disconnected and its stored credential was removed.");
    return;
  }
  button.disabled = true;
  const response = await api(
    `/v1/email-connections/${button.dataset.provider}/authorize`,
    jsonRequest({})
  );
  if (!response.ok) {
    button.disabled = false;
    return showError(response);
  }
  const result = await response.json();
  window.location.assign(result.authorizationUrl);
}

function openSmtpConnectionDialog() {
  const dialog = elements["smtp-connection-dialog"];
  const form = elements["smtp-connection-form"];
  form.reset();
  form.elements.port.value = "587";
  form.elements.tlsMode.value = "STARTTLS";
  elements["smtp-connection-status"].textContent =
    "The relay is saved only after it accepts this test message over encrypted SMTP.";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  form.elements.host.focus();
}

async function configureSmtpConnection(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  const values = new FormData(form);
  const payload = {
    host: String(values.get("host") ?? ""),
    port: Number(values.get("port")),
    tlsMode: String(values.get("tlsMode") ?? ""),
    username: String(values.get("username") ?? ""),
    password: String(values.get("password") ?? ""),
    fromAddress: String(values.get("fromAddress") ?? ""),
    testRecipient: String(values.get("testRecipient") ?? "")
  };
  elements["smtp-connection-status"].textContent = "Testing encrypted SMTP delivery…";
  try {
    const response = await api("/v1/email-connections/smtp", jsonRequest(payload));
    if (!response.ok) {
      elements["smtp-connection-status"].textContent = "SMTP relay was not saved.";
      return showError(response);
    }
    const result = await response.json();
    form.reset();
    elements["smtp-connection-dialog"].close();
    await loadEmailConnections();
    showNotice(
      `SMTP test delivery was accepted. ${result.connection?.isDefaultSender ? "It is now the default sending mailbox." : "Choose it as the default mailbox before sending."}`
    );
  } finally {
    form.elements.password.value = "";
    if (submit) submit.disabled = false;
  }
}

function handleCommerceViewNavigation(event) {
  const button = event.target.closest("[data-commerce-view-target]");
  if (!button) return;
  setCommerceView(button.dataset.commerceViewTarget);
}

function setCommerceView(view) {
  const next = commerceViews.has(view) ? view : "review";
  activeCommerceView = next;
  sessionStorage.setItem(commerceViewStorageKey, next);
  elements["commerce-view-navigation"]
    .querySelectorAll("[data-commerce-view-target]")
    .forEach((button) => {
      const selected = button.dataset.commerceViewTarget === next;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("active", selected);
    });
  document.querySelectorAll("#integrations-workspace [data-commerce-view]").forEach((panel) => {
    panel.hidden = panel.dataset.commerceView !== next;
  });
  if (activeWorkspaceId === "integrations-workspace")
    buildWorkspaceSubnavigation(elements["integrations-workspace"]);
}

async function loadCatalogAutomation() {
  if (!identity?.activeOrganizationId) return;
  const [
    catalogResponse,
    inventoryResponse,
    locationsResponse,
    productsResponse,
    accountsResponse
  ] = await Promise.all([
    api("/v1/organizations/current/catalog?limit=200", {}, true),
    api("/v1/organizations/current/inventory-sync", {}, true),
    api("/v1/inventory/locations", {}, true),
    api("/v1/products", {}, true),
    api("/v1/accounts", {}, true)
  ]);
  if (catalogResponse.ok) externalCatalogProducts = (await catalogResponse.json()).products;
  else externalCatalogProducts = [];
  if (inventoryResponse.ok) inventorySyncState = await inventoryResponse.json();
  else inventorySyncState = { policies: [], operations: [], accountingEntriesCreated: 0 };
  if (locationsResponse.ok) setInventoryLocations((await locationsResponse.json()).locations);
  if (productsResponse.ok) setProducts((await productsResponse.json()).products);
  if (accountsResponse.ok) setAccounts((await accountsResponse.json()).accounts);
  const availableVariantIds = new Set(catalogVariants().map(({ variant }) => variant.id));
  if (!selectedCatalogVariantId || !availableVariantIds.has(selectedCatalogVariantId))
    selectedCatalogVariantId = catalogVariants()[0]?.variant.id ?? null;
  renderCatalogReview();
  renderInventorySyncReview();
}

async function pollConnectorCatalog(event) {
  event?.preventDefault();
  const form = elements["catalog-poll-form"];
  const data = new FormData(form);
  const connectorId = data.get("connectorId");
  if (!connectorId) return showNotice("Select a connected store before importing products.", true);
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  elements["continue-catalog-poll"].disabled = true;
  elements["catalog-operation-status"].textContent =
    "Reading channel products and preserving their source identifiers...";
  try {
    const response = await api(
      `/v1/organizations/current/connectors/${connectorId}/catalog/poll`,
      jsonRequest({
        pageSize: Number(data.get("pageSize")),
        maxPages: Number(data.get("maxPages")),
        restart: false
      })
    );
    if (!response.ok) return showError(response);
    const result = (await response.json()).catalogSync;
    catalogPollHasMore = result.hasMore;
    elements["catalog-operation-status"].textContent =
      `Imported ${result.importedProducts} products and ${result.importedVariants} variations ` +
      `from ${formatConnectorStatus(result.providerKey)} across ${result.pages} page${result.pages === 1 ? "" : "s"}. ` +
      `${result.observations} exact quantity observation${result.observations === 1 ? "" : "s"} recorded. ` +
      (result.hasMore
        ? "More products remain; Continue import resumes from the saved provider cursor."
        : "The available product pages are complete.") +
      " Accounting entries created: 0.";
    await loadCatalogAutomation();
    showNotice(
      result.hasMore
        ? "Product evidence imported. Continue when ready; no books were changed."
        : "Product list imported without changing the books."
    );
  } finally {
    submit.disabled = false;
    elements["continue-catalog-poll"].disabled = !catalogPollHasMore;
  }
}

function continueCatalogPoll() {
  return pollConnectorCatalog();
}

function openProductSpreadsheetImport() {
  navigateTo("portability-workspace");
  elements["data-import-source-system"].value = "OTHER";
  elements["data-import-source-system"].dispatchEvent(new globalThis.Event("change"));
  elements["data-import-form"].elements.importType.value = "PRODUCTS";
  elements["data-import-form"].elements.importType.dispatchEvent(new globalThis.Event("change"));
  elements["data-import-form"].scrollIntoView({
    behavior: preferredScrollBehavior(),
    block: "start"
  });
  elements["data-import-form"].elements.file.focus({ preventScroll: true });
}

function catalogVariants() {
  return externalCatalogProducts.flatMap((product) =>
    (product.variants ?? []).map((variant) => ({ product, variant }))
  );
}

function selectedCatalogEntry() {
  return catalogVariants().find(({ variant }) => variant.id === selectedCatalogVariantId) ?? null;
}

function renderCatalogReview() {
  const variants = catalogVariants();
  const confirmed = variants.filter(({ variant }) =>
    (variant.candidates ?? []).some((candidate) => candidate.status === "CONFIRMED")
  ).length;
  const pendingImages = externalCatalogProducts
    .flatMap((product) => [
      ...(product.images ?? []),
      ...(product.variants ?? []).flatMap((variant) => variant.images ?? [])
    ])
    .filter((image) => ["OBSERVED", "APPROVED"].includes(image.status)).length;
  elements["catalog-review-summary"].replaceChildren(
    metric("Channel products", externalCatalogProducts.length),
    metric("Variations", variants.length),
    metric("Approved matches", confirmed),
    metric("Awaiting review", variants.length - confirmed + pendingImages)
  );
  const filter = elements["catalog-product-filter"].value.trim().toLowerCase();
  const matchingProducts = externalCatalogProducts.filter((product) => {
    if (!filter) return true;
    return [
      product.name,
      product.externalProductId,
      ...(product.variants ?? []).flatMap((variant) => [
        variant.name,
        variant.sku,
        variant.gtin,
        variant.manufacturerPartNumber
      ])
    ].some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(filter)
    );
  });
  elements["catalog-product-list"].replaceChildren(
    ...(matchingProducts.length
      ? matchingProducts.map(renderCatalogProduct)
      : [
          commerceEmptyState(
            externalCatalogProducts.length
              ? "No products match this search"
              : "No products imported",
            externalCatalogProducts.length
              ? "Try a product name, SKU, barcode, or manufacturer part number."
              : "Choose a connected store above and import its product list, or use the spreadsheet mapper."
          )
        ])
  );
  renderCatalogSelection();
}

function renderCatalogProduct(product) {
  const article = document.createElement("article");
  article.className = "commerce-catalog-product";
  article.setAttribute("role", "listitem");
  const header = document.createElement("header");
  const heading = document.createElement("h4");
  heading.textContent = product.name;
  const source = document.createElement("p");
  const connector = connectorInstallations.find((item) => item.id === product.installationId);
  source.textContent = `${connector?.displayName ?? "Connected store"} / source ${product.externalProductId}`;
  header.append(heading, source);
  const list = document.createElement("div");
  list.className = "commerce-catalog-variants";
  for (const variant of product.variants ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "commerce-catalog-variant";
    button.dataset.catalogVariantId = variant.id;
    button.setAttribute("aria-pressed", String(variant.id === selectedCatalogVariantId));
    const copy = document.createElement("span");
    copy.className = "commerce-variant-copy";
    const name = document.createElement("strong");
    name.textContent = variant.name;
    const identifiers = document.createElement("small");
    identifiers.textContent = variant.sku ? `SKU ${variant.sku}` : "No channel SKU";
    copy.append(name, identifiers);
    const state = document.createElement("span");
    const approved = (variant.candidates ?? []).some(
      (candidate) => candidate.status === "CONFIRMED"
    );
    state.className = `mapping-authority ${approved ? "is-approved" : "is-proposed"}`;
    state.textContent = approved ? "Approved" : "Review";
    button.append(copy, state);
    list.append(button);
  }
  article.append(header, list);
  return article;
}

function selectCatalogVariant(event) {
  const button = event.target.closest("[data-catalog-variant-id]");
  if (!button) return;
  selectedCatalogVariantId = button.dataset.catalogVariantId;
  renderCatalogReview();
}

function renderCatalogSelection() {
  const container = elements["catalog-selection"];
  const entry = selectedCatalogEntry();
  if (!entry) {
    container.replaceChildren(
      commerceEmptyState(
        "Select a channel product",
        "PennyWise Accounting keeps imported product facts separate from approved item mappings."
      )
    );
    return;
  }
  const { product, variant } = entry;
  const confirmed = (variant.candidates ?? []).find(
    (candidate) => candidate.status === "CONFIRMED"
  );
  const heading = document.createElement("div");
  heading.className = "catalog-detail-heading";
  const titleBlock = document.createElement("div");
  const authority = document.createElement("span");
  authority.className = `mapping-authority ${confirmed ? "is-approved" : "is-proposed"}`;
  authority.textContent = confirmed ? "Approved item mapping" : "Proposed evidence only";
  const title = document.createElement("h3");
  title.id = "catalog-selection-heading";
  title.textContent = variant.name;
  const subtitle = document.createElement("p");
  subtitle.textContent = `${product.name} / source variation ${variant.externalVariantId}`;
  titleBlock.append(authority, title, subtitle);
  const actions = document.createElement("div");
  actions.className = "form-actions";
  const suggest = document.createElement("button");
  suggest.type = "button";
  suggest.className = "secondary-command";
  suggest.dataset.catalogAction = "suggest";
  suggest.textContent = "Find possible matches";
  const create = document.createElement("button");
  create.type = "button";
  create.dataset.catalogAction = "create";
  create.textContent = "Create a new item";
  actions.append(suggest, create);
  heading.append(titleBlock, actions);

  const facts = document.createElement("dl");
  facts.className = "catalog-facts";
  for (const [label, value] of [
    ["Channel SKU", variant.sku || "Not provided"],
    ["Barcode / GTIN", variant.gtin || "Not provided"],
    ["Manufacturer", variant.manufacturer || "Not provided"],
    ["Part number", variant.manufacturerPartNumber || "Not provided"]
  ])
    facts.append(descriptionItem(label, value));

  const matches = document.createElement("section");
  matches.className = "catalog-match-review";
  const matchHeading = document.createElement("div");
  matchHeading.className = "catalog-subheading";
  const matchTitle = document.createElement("h4");
  matchTitle.textContent = "Possible PennyWise Accounting items";
  const matchDescription = document.createElement("p");
  matchDescription.textContent = confirmed
    ? `Approved: ${confirmed.productItem?.sku ?? "No SKU"} / ${confirmed.productItem?.name ?? "PennyWise Accounting item"}`
    : "Scores explain similarity only. Every match requires your approval.";
  matchHeading.append(matchTitle, matchDescription);
  const candidateList = document.createElement("div");
  candidateList.className = "catalog-candidate-list";
  candidateList.replaceChildren(
    ...((variant.candidates ?? []).length
      ? variant.candidates.map((candidate) =>
          renderCatalogCandidate(candidate, Boolean(confirmed), product.installationId, variant.sku)
        )
      : [
          commerceEmptyState(
            "No suggestions yet",
            "Choose Find possible matches to compare SKUs, barcodes, manufacturer parts, names, and descriptions."
          )
        ])
  );
  matches.append(matchHeading, candidateList);

  const patternDetails = document.createElement("details");
  patternDetails.className = "catalog-pattern-editor";
  const patternSummary = document.createElement("summary");
  patternSummary.textContent = "Remember a safe prefix or suffix SKU pattern";
  const patternCopy = document.createElement("p");
  patternCopy.textContent =
    "Use anchored text only. PennyWise Accounting previews existing rows and blocks collisions before enabling the rule.";
  const patternForm = document.createElement("form");
  patternForm.className = "form-grid compact-form";
  const patternName = document.createElement("input");
  patternName.name = "name";
  patternName.placeholder = "Rule name";
  patternName.required = true;
  const prefix = document.createElement("input");
  prefix.name = "prefix";
  prefix.placeholder = "Prefix, e.g. AMZ-";
  const suffix = document.createElement("input");
  suffix.name = "suffix";
  suffix.placeholder = "Suffix, e.g. -FBA";
  const patternActions = document.createElement("div");
  patternActions.className = "form-actions";
  const savePattern = document.createElement("button");
  savePattern.type = "submit";
  savePattern.dataset.catalogPatternAction = "approve";
  savePattern.textContent = "Preview & approve pattern";
  patternActions.append(savePattern);
  patternForm.append(
    labeledControl("Name", patternName),
    labeledControl("Prefix", prefix),
    labeledControl("Suffix", suffix),
    patternActions
  );
  patternDetails.append(patternSummary, patternCopy, patternForm);

  const imageReview = renderCatalogImages(product, variant);
  container.replaceChildren(heading, facts, matches, patternDetails, imageReview);
}

function labeledControl(label, control) {
  const wrapper = document.createElement("label");
  wrapper.append(document.createTextNode(label), control);
  return wrapper;
}

function renderCatalogCandidate(candidate, hasConfirmedCandidate, installationId, sourceSku) {
  const article = document.createElement("article");
  article.className = `catalog-candidate ${candidate.status === "CONFIRMED" ? "is-approved" : ""}`;
  const main = document.createElement("div");
  const heading = document.createElement("div");
  heading.className = "catalog-candidate-heading";
  const name = document.createElement("strong");
  name.textContent = `${candidate.productItem?.sku ?? "No SKU"} / ${candidate.productItem?.name ?? "PennyWise Accounting item"}`;
  const status = document.createElement("span");
  status.className = `mapping-authority ${candidate.status === "CONFIRMED" ? "is-approved" : "is-proposed"}`;
  status.textContent = formatConnectorStatus(candidate.status);
  heading.append(name, status);
  const confidence = Math.max(0, Math.min(100, Number(candidate.score ?? 0) / 1000));
  const meterLabel = document.createElement("label");
  meterLabel.className = "candidate-confidence";
  meterLabel.textContent = `${confidence.toFixed(confidence % 1 ? 1 : 0)}% evidence match`;
  const meter = document.createElement("progress");
  meter.max = 100;
  meter.value = confidence;
  meterLabel.append(meter);
  const reasons = document.createElement("ul");
  reasons.className = "candidate-reasons";
  for (const reason of catalogReasonCodes(candidate.reason)) {
    const item = document.createElement("li");
    item.textContent = catalogMatchReason(reason, candidate.reason);
    reasons.append(item);
  }
  if (!reasons.childElementCount) {
    const item = document.createElement("li");
    item.textContent = "Ranked by nearest-field evidence; no exact identifier evidence.";
    reasons.append(item);
  }
  const similarity = renderCatalogSimilarityEvidence(candidate.reason);
  main.append(heading, meterLabel, reasons, similarity);
  const actions = document.createElement("div");
  actions.className = "catalog-candidate-actions";
  if (candidate.status === "CONFIRMED") {
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "secondary-command";
    reject.dataset.catalogCandidateAction = "reject";
    reject.dataset.candidateId = candidate.id;
    reject.textContent = "Remove approval";
    actions.append(reject);
  } else {
    const approve = document.createElement("button");
    approve.type = "button";
    approve.dataset.catalogCandidateAction = "confirm";
    approve.dataset.candidateId = candidate.id;
    approve.textContent = "Approve this match";
    approve.disabled = hasConfirmedCandidate;
    if (hasConfirmedCandidate)
      approve.title = "Remove the current approved match before approving another one.";
    actions.append(approve);
    if (sourceSku && installationId) {
      const remember = document.createElement("button");
      remember.type = "button";
      remember.className = "secondary-command";
      remember.dataset.catalogCandidateAction = "alias";
      remember.dataset.candidateId = candidate.id;
      remember.textContent = "Approve & remember SKU";
      remember.disabled = hasConfirmedCandidate;
      actions.append(remember);
    }
  }
  if (installationId) article.dataset.installationId = installationId;
  if (sourceSku) article.dataset.sourceSku = sourceSku;
  article.append(main, actions);
  return article;
}

function catalogReasonCodes(evidence = {}) {
  const values = Array.isArray(evidence.codes)
    ? evidence.codes
    : Array.isArray(evidence.matches)
      ? evidence.matches
      : [];
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function catalogMatchReason(reason, evidence = {}) {
  if (reason === "EXACT_GTIN") return "Exact barcode / GTIN";
  if (reason === "EXACT_MANUFACTURER_PART_NUMBER") return "Exact manufacturer and part number";
  if (reason === "NORMALIZED_SKU") return "Same SKU after case and spacing cleanup";
  if (reason === "EXPLICIT_LOCAL_PRODUCT_CREATION") return "Created from this channel variation";
  if (reason === "SKU_SIMILARITY")
    return `Nearest SKU evidence (${formatSimilarityBasisPoints(evidence.skuSimilarityBasisPoints)})`;
  if (reason === "NAME_SIMILARITY")
    return `Nearest name evidence (${formatSimilarityBasisPoints(evidence.nameSimilarityBasisPoints)})`;
  if (reason === "DESCRIPTION_SIMILARITY")
    return `Nearest description evidence (${formatSimilarityBasisPoints(evidence.descriptionSimilarityBasisPoints)})`;
  if (reason === "NAME_SIMILARITY_ONLY")
    return `Nearest name only (${formatSimilarityBasisPoints(evidence.nameSimilarityBasisPoints)}) - verify carefully`;
  return formatConnectorStatus(reason);
}

function renderCatalogSimilarityEvidence(evidence = {}) {
  const section = document.createElement("section");
  section.className = "candidate-similarity-evidence";
  const title = document.createElement("h5");
  title.textContent = `Nearest-field evidence · reason v${Number.isInteger(evidence.version) ? evidence.version : "unknown"}`;
  const description = document.createElement("p");
  description.textContent =
    "The composite ranks separate identifier, SKU, name, and description evidence. Fuzzy evidence never approves or links an item.";
  const state = document.createElement("p");
  state.className = `catalog-decision-state is-${String(evidence.decisionState ?? "unknown").toLowerCase()}`;
  const stateLabel = evidence.decisionState ?? "UNKNOWN";
  const margin = formatSimilarityBasisPoints(evidence.suggestionMarginBasisPoints);
  state.textContent =
    stateLabel === "AUTO_MATCH_CANDIDATE"
      ? "Deterministic candidate — review and explicitly approve before posting."
      : stateLabel === "AMBIGUOUS"
        ? `Ambiguous candidate — competing evidence is too close (margin ${margin}).`
        : stateLabel === "UNMATCHED"
          ? "No useful candidate was found."
          : "Suggested candidate — verify the source identity before approving.";
  if (evidence.matchMethod === "APPROVED_ALIAS" || evidence.matchMethod === "APPROVED_PATTERN") {
    const method = document.createElement("p");
    method.className = "catalog-match-method";
    method.textContent =
      evidence.matchMethod === "APPROVED_ALIAS"
        ? "Approved source SKU alias matched exactly."
        : "Approved anchored SKU pattern extracted a base SKU.";
    section.append(method);
  }
  section.append(title, description, state);
  if (Array.isArray(evidence.matchedTokens) && evidence.matchedTokens.length) {
    const matched = document.createElement("p");
    matched.className = "catalog-matched-tokens";
    matched.textContent = `Matched words: ${evidence.matchedTokens.join(", ")}`;
    section.append(matched);
  }
  if (Array.isArray(evidence.conflicts) && evidence.conflicts.length) {
    const conflicts = document.createElement("p");
    conflicts.className = "catalog-match-conflicts";
    conflicts.textContent = `Conflicts requiring review: ${evidence.conflicts.join(", ")}`;
    section.append(conflicts);
  }
  const list = document.createElement("dl");
  list.className = "candidate-similarity-grid";
  for (const [label, value, explanation] of [
    [
      "Composite",
      evidence.compositeSimilarityBasisPoints,
      "Weighted ranking evidence; it is not an approval threshold."
    ],
    [
      "Nearest SKU",
      evidence.skuSimilarityBasisPoints,
      "Compares product codes after safe case and spacing cleanup."
    ],
    [
      "Nearest name",
      evidence.nameSimilarityBasisPoints,
      "Compares the channel and local item names."
    ],
    [
      "Nearest description",
      evidence.descriptionSimilarityBasisPoints,
      "Compares descriptive text only when both systems provide it."
    ]
  ]) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    const score = document.createElement("strong");
    score.textContent = formatSimilarityBasisPoints(value);
    const note = document.createElement("span");
    note.textContent = explanation;
    detail.append(score, note);
    row.append(term, detail);
    list.append(row);
  }
  section.append(list);
  return section;
}

function formatSimilarityBasisPoints(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Not available";
  const percent = Math.max(0, Math.min(100, numeric / 100));
  return `${percent.toFixed(percent % 1 ? 1 : 0)}%`;
}

function renderCatalogImages(product, variant) {
  const section = document.createElement("section");
  section.className = "catalog-image-review";
  const heading = document.createElement("div");
  heading.className = "catalog-subheading";
  const title = document.createElement("h4");
  title.textContent = "Product image evidence";
  const description = document.createElement("p");
  description.textContent =
    "Approve a trusted provider source, then verify its file type, size, and dimensions. Images never decide an item match.";
  heading.append(title, description);
  const unique = new Map(
    [...(product.images ?? []), ...(variant.images ?? [])].map((image) => [image.id, image])
  );
  const list = document.createElement("div");
  list.className = "catalog-image-list";
  list.replaceChildren(
    ...(unique.size
      ? [...unique.values()].map(renderCatalogImage)
      : [commerceEmptyState("No image evidence", "This channel product did not provide an image.")])
  );
  section.append(heading, list);
  return section;
}

function renderCatalogImage(image) {
  const article = document.createElement("article");
  article.className = "catalog-image-item";
  const media = document.createElement("div");
  media.className = "catalog-image-frame";
  if (["APPROVED", "INGESTED"].includes(image.status)) {
    const preview = document.createElement("img");
    preview.src = image.remoteUrl;
    preview.alt = "Approved channel product preview";
    preview.loading = "lazy";
    preview.referrerPolicy = "no-referrer";
    media.append(preview);
  } else {
    const placeholder = document.createElement("span");
    placeholder.textContent = "Preview appears after source approval";
    media.append(placeholder);
  }
  const copy = document.createElement("div");
  const state = document.createElement("span");
  state.className = `mapping-authority ${image.status === "INGESTED" ? "is-approved" : "is-proposed"}`;
  state.textContent =
    image.status === "INGESTED" ? "Verified" : formatConnectorStatus(image.status);
  const dimensions = document.createElement("p");
  dimensions.textContent =
    image.width && image.height
      ? `${image.width} x ${image.height}${image.contentTypeHint ? ` / ${image.contentTypeHint}` : ""}`
      : "Dimensions not verified";
  const source = document.createElement("a");
  source.href = image.remoteUrl;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = "Open source image";
  copy.append(state, dimensions, source);
  const actions = document.createElement("div");
  actions.className = "catalog-image-actions";
  const addAction = (label, action, primary = false) => {
    const button = document.createElement("button");
    button.type = "button";
    if (!primary) button.className = "secondary-command";
    button.dataset.catalogImageAction = action;
    button.dataset.imageId = image.id;
    button.textContent = label;
    actions.append(button);
  };
  if (image.status === "OBSERVED") {
    addAction("Approve source", "approve", true);
    addAction("Reject", "reject");
  } else if (image.status === "APPROVED") {
    addAction("Verify image file", "ingest", true);
    addAction("Reject", "reject");
  }
  article.append(media, copy, actions);
  return article;
}

function commerceEmptyState(title, description) {
  const wrapper = document.createElement("div");
  wrapper.className = "commerce-empty-state";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  wrapper.append(heading, copy);
  return wrapper;
}

async function handleCatalogReviewAction(event) {
  const actionButton = event.target.closest(
    "[data-catalog-action], [data-catalog-candidate-action], [data-catalog-image-action]"
  );
  if (!actionButton) return;
  const entry = selectedCatalogEntry();
  if (!entry) return;
  if (actionButton.dataset.catalogAction === "suggest")
    return suggestCatalogCandidates(entry.variant.id);
  if (actionButton.dataset.catalogAction === "create") return openCatalogProductDialog(entry);
  if (actionButton.dataset.catalogCandidateAction) {
    const candidate = (entry.variant.candidates ?? []).find(
      (item) => item.id === actionButton.dataset.candidateId
    );
    if (!candidate) return;
    const action = actionButton.dataset.catalogCandidateAction;
    const approvalMessage =
      action === "confirm" || action === "alias"
        ? `Approve ${candidate.productItem?.sku ?? "this item"} / ${candidate.productItem?.name ?? "PennyWise Accounting item"} as the match for ${entry.variant.name}?`
        : `Remove the approved match between ${entry.variant.name} and ${candidate.productItem?.name ?? "this item"}?`;
    if (!window.confirm(approvalMessage)) return;
    if (action === "alias") {
      const confirmed = await api(
        `/v1/organizations/current/catalog/candidates/${candidate.id}/confirm`,
        jsonRequest({
          version: candidate.version,
          reason: "Approved in visual catalog review and saved as a source SKU alias."
        })
      );
      if (!confirmed.ok) return handleCatalogAutomationError(confirmed);
      const alias = await api(
        `/v1/organizations/current/connectors/${entry.product.installationId}/catalog/sku-aliases`,
        jsonRequest(
          {
            sourceSku: entry.variant.sku,
            productItemId: candidate.productItem.id,
            reason: "Approved from the catalog match review."
          },
          "POST"
        )
      );
      if (!alias.ok) return handleCatalogAutomationError(alias);
      await loadCatalogAutomation();
      showNotice("Item match approved and this source SKU was saved as a durable alias.");
      return;
    }
    const response = await api(
      `/v1/organizations/current/catalog/candidates/${candidate.id}/${action}`,
      jsonRequest({
        version: candidate.version,
        reason:
          action === "confirm"
            ? "Approved in the visual catalog review after comparing source identifiers."
            : "Approval removed in the visual catalog review."
      })
    );
    if (!response.ok) return handleCatalogAutomationError(response);
    await loadCatalogAutomation();
    showNotice(
      action === "confirm"
        ? "Item match approved. Inventory automation remains off until you configure a rule."
        : "Item match approval removed. Existing inventory rules may require review."
    );
    return;
  }
  const image = [...(entry.product.images ?? []), ...(entry.variant.images ?? [])].find(
    (item) => item.id === actionButton.dataset.imageId
  );
  if (!image) return;
  const action = actionButton.dataset.catalogImageAction;
  if (
    action === "approve" &&
    !window.confirm(
      "Approve this provider-hosted image source for a preview? This does not attach it to an item."
    )
  )
    return;
  const response = await api(
    `/v1/organizations/current/catalog/images/${image.id}/${action}`,
    jsonRequest({
      version: image.version,
      ...(action === "reject" ? { reason: "Rejected during product image review." } : {})
    })
  );
  if (!response.ok) return handleCatalogAutomationError(response);
  await loadCatalogAutomation();
  showNotice(
    action === "approve"
      ? "Image source approved. Verify its file before using the reference."
      : action === "ingest"
        ? "Image file verified for type, size, dimensions, and evidence hash."
        : "Image evidence rejected."
  );
}

async function handleCatalogPatternAction(event) {
  const form = event.target.closest("form");
  if (!form?.querySelector("[data-catalog-pattern-action]")) return;
  event.preventDefault();
  const entry = selectedCatalogEntry();
  if (!entry?.product.installationId || !entry.variant.sku) return;
  const data = new FormData(form);
  const prefix = String(data.get("prefix") ?? "").trim();
  const suffix = String(data.get("suffix") ?? "").trim();
  if (!prefix && !suffix)
    return showNotice("Enter a prefix or suffix before saving the rule.", true);
  const response = await api(
    `/v1/organizations/current/connectors/${entry.product.installationId}/catalog/sku-patterns`,
    jsonRequest({
      name: String(data.get("name") ?? "").trim(),
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
      examples: [entry.variant.sku],
      reason: "Approved from the catalog match review."
    })
  );
  if (!response.ok) return handleCatalogAutomationError(response);
  await loadCatalogAutomation();
  showNotice(
    "Pattern preview passed. The source-scoped SKU rule is now available for review matches."
  );
}

async function suggestCatalogCandidates(catalogVariantId) {
  const response = await api(
    `/v1/organizations/current/catalog/variants/${catalogVariantId}/candidates`,
    jsonRequest({ limit: 25 })
  );
  if (!response.ok) return handleCatalogAutomationError(response);
  const candidates = (await response.json()).candidates;
  await loadCatalogAutomation();
  showNotice(
    candidates.length
      ? `${candidates.length} possible item match${candidates.length === 1 ? "" : "es"} found. Review the evidence before approving one.`
      : "No useful item matches were found. Create a new PennyWise Accounting item or import a product spreadsheet."
  );
}

async function handleCatalogAutomationError(response) {
  const stale = response.status === 409;
  await showError(response);
  if (stale) {
    await loadCatalogAutomation();
    elements["catalog-operation-status"].textContent =
      "The review changed in another session. Current catalog and inventory evidence has been reloaded.";
  }
}

function openCatalogProductDialog(entry) {
  const form = elements["catalog-product-form"];
  const accountGroups = catalogProductAccountGroups();
  const missingAccount = Object.values(accountGroups).some(
    (types) =>
      !accounts.some((item) => types.includes(item.type) && !item.isControl && !item.isArchived)
  );
  if (missingAccount || !inventoryLocations.some((location) => location.isActive)) {
    showNotice(
      "Set up the required inventory accounts and at least one active location before creating this item.",
      true
    );
    navigateTo("inventory-workspace");
    elements["inventory-product-form"].scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "start"
    });
    return;
  }
  form.reset();
  form.dataset.catalogVariantId = entry.variant.id;
  form.elements.sku.value = entry.variant.sku ?? "";
  form.elements.name.value = entry.variant.name;
  for (const [field, types] of Object.entries(accountGroups))
    form.elements[field].replaceChildren(
      ...accounts
        .filter((item) => types.includes(item.type) && !item.isControl && !item.isArchived)
        .map((item) => option(item.id, `${item.code} ${item.name}`))
    );
  form.elements.defaultLocationId.replaceChildren(
    ...inventoryLocations
      .filter((location) => location.isActive)
      .map((location) => option(location.id, `${location.code} ${location.name}`))
  );
  const verifiedImages = new Map(
    [...(entry.product.images ?? []), ...(entry.variant.images ?? [])]
      .filter((image) => image.status === "INGESTED")
      .map((image) => [image.id, image])
  );
  form.elements.productImageReference.replaceChildren(
    option("", "Do not attach an image reference"),
    ...[...verifiedImages.values()].map((image, index) =>
      option(image.remoteUrl, `Verified channel image ${index + 1}`)
    )
  );
  elements["catalog-product-dialog"].showModal();
  form.elements.sku.focus();
}

function catalogBulkEligibleVariants() {
  return catalogVariants().filter(
    ({ variant }) =>
      !(variant.candidates ?? []).some((candidate) => candidate.status === "CONFIRMED")
  );
}

function openCatalogBulkProductDialog() {
  const form = elements["catalog-bulk-product-form"];
  const accountGroups = catalogProductAccountGroups();
  const missingAccount = Object.values(accountGroups).some(
    (types) =>
      !accounts.some((item) => types.includes(item.type) && !item.isControl && !item.isArchived)
  );
  if (missingAccount || !inventoryLocations.some((location) => location.isActive)) {
    showNotice(
      "Set up the required inventory accounts and at least one active location before creating channel items.",
      true
    );
    navigateTo("inventory-workspace");
    elements["inventory-product-form"].scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "start"
    });
    return;
  }
  const candidates = catalogBulkEligibleVariants();
  if (!candidates.length)
    return showNotice(
      "Every imported channel variation already has an approved item mapping.",
      true
    );
  const visibleCandidates = candidates.slice(0, 100);
  form.reset();
  for (const [field, types] of Object.entries(accountGroups))
    form.elements[field].replaceChildren(
      ...accounts
        .filter((item) => types.includes(item.type) && !item.isControl && !item.isArchived)
        .map((item) => option(item.id, `${item.code} ${item.name}`))
    );
  form.elements.defaultLocationId.replaceChildren(
    ...inventoryLocations
      .filter((location) => location.isActive)
      .map((location) => option(location.id, `${location.code} ${location.name}`))
  );
  const selection = elements["catalog-bulk-product-selection"];
  selection.replaceChildren(...visibleCandidates.map(renderCatalogBulkSelectionRow));
  elements["catalog-bulk-product-summary"].textContent =
    candidates.length > visibleCandidates.length
      ? `${candidates.length} unmatched variations are available. Select from the first ${visibleCandidates.length}; refresh or narrow the imported catalog before the next batch.`
      : `${candidates.length} unmatched channel variation${candidates.length === 1 ? " is" : "s are"} ready for deliberate creation.`;
  form.elements.attachFirstIngestedImage.checked = true;
  form.elements.confirmMappings.checked = false;
  renderCatalogBulkCreateSelectionSummary();
  elements["catalog-bulk-product-dialog"].showModal();
  form.elements.salesPriceMinor.focus();
}

function renderCatalogBulkSelectionRow(entry) {
  const label = document.createElement("label");
  label.className = "checkbox-row catalog-bulk-selection-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "catalogVariantIds";
  input.value = entry.variant.id;
  input.checked = true;
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = entry.variant.name;
  const source = document.createElement("small");
  source.textContent = `${entry.product.name} · ${entry.variant.sku ? `SKU ${entry.variant.sku}` : "No channel SKU"}`;
  copy.append(name, source);
  label.append(input, copy);
  return label;
}

function renderCatalogBulkCreateSelectionSummary() {
  const form = elements["catalog-bulk-product-form"];
  const selected = new FormData(form).getAll("catalogVariantIds").length;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = selected === 0;
  submit.textContent = selected
    ? `Create ${selected} selected item${selected === 1 ? "" : "s"}`
    : "Select at least one item";
}

async function createProductsFromCatalogBulk(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const catalogVariantIds = data.getAll("catalogVariantIds").map((value) => String(value));
  if (!catalogVariantIds.length) return showNotice("Select at least one channel variation.", true);
  let salesPriceMinor;
  let reorderPointMicros;
  try {
    salesPriceMinor = parseMoneyInput(data.get("salesPriceMinor"));
    reorderPointMicros = quantityToMicros(data.get("reorderPoint"));
  } catch (error) {
    return showNotice(
      error instanceof Error ? error.message : "Enter valid item amounts before creating products.",
      true
    );
  }
  const confirmMappings = data.get("confirmMappings") === "on";
  const confirmation = confirmMappings
    ? `Create ${catalogVariantIds.length} inventory item${catalogVariantIds.length === 1 ? "" : "s"} and explicitly approve each selected source mapping? No stock or accounting entries will be created.`
    : `Create ${catalogVariantIds.length} inventory item${catalogVariantIds.length === 1 ? "" : "s"}? Their source mappings will remain in review and no stock or accounting entries will be created.`;
  if (!window.confirm(confirmation)) return;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await api(
      "/v1/organizations/current/catalog/bulk-create-local-products",
      jsonRequest({
        catalogVariantIds,
        itemType: "INVENTORY_PRODUCT",
        salesPriceMinor,
        incomeAccountId: data.get("incomeAccountId"),
        inventoryAssetAccountId: data.get("inventoryAssetAccountId"),
        costOfGoodsSoldAccountId: data.get("costOfGoodsSoldAccountId"),
        purchaseClearingAccountId: data.get("purchaseClearingAccountId"),
        adjustmentGainAccountId: data.get("adjustmentGainAccountId"),
        inventoryLossAccountId: data.get("inventoryLossAccountId"),
        defaultLocationId: data.get("defaultLocationId"),
        reorderPointMicros,
        unitOfMeasure: "each",
        attachFirstIngestedImage: data.get("attachFirstIngestedImage") === "on",
        confirmMappings
      })
    );
    if (!response.ok) return handleCatalogAutomationError(response);
    const result = (await response.json()).bulkCreate;
    const summary = result.summary;
    await loadCatalogAutomation();
    elements["catalog-bulk-product-dialog"].close();
    elements["catalog-operation-status"].textContent =
      `Created ${summary.created}; already created ${summary.alreadyCreated}; already mapped ${summary.alreadyMapped}; ` +
      `needs review ${summary.reviewRequired}; not created ${summary.notCreated}. ` +
      "Inventory movements and accounting entries created: 0.";
    showNotice(
      summary.notCreated || summary.reviewRequired
        ? "Channel-item creation finished with rows requiring review. See the catalog status for the count."
        : "Selected channel items are ready. Establish quantity only through a reviewed inventory workflow."
    );
  } finally {
    renderCatalogBulkCreateSelectionSummary();
  }
}

function catalogProductAccountGroups() {
  return {
    incomeAccountId: ["REVENUE", "CONTRA_REVENUE"],
    inventoryAssetAccountId: ["ASSET"],
    costOfGoodsSoldAccountId: ["EXPENSE"],
    purchaseClearingAccountId: ["ASSET"],
    adjustmentGainAccountId: ["REVENUE", "CONTRA_REVENUE"],
    inventoryLossAccountId: ["EXPENSE"]
  };
}

async function createProductFromCatalog(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const catalogVariantId = form.dataset.catalogVariantId;
  if (!catalogVariantId) return showNotice("Select a channel product first.", true);
  const data = new FormData(form);
  let salesPriceMinor;
  let reorderPointMicros;
  try {
    salesPriceMinor = parseMoneyInput(data.get("salesPriceMinor"));
    reorderPointMicros = quantityToMicros(data.get("reorderPoint"));
  } catch (error) {
    return showNotice(
      error instanceof Error ? error.message : "Enter valid product amounts.",
      true
    );
  }
  const imageReference = String(data.get("productImageReference") ?? "").trim();
  const response = await api(
    `/v1/organizations/current/catalog/variants/${catalogVariantId}/create-local-product`,
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
      reorderPointMicros,
      unitOfMeasure: "each",
      ...(imageReference ? { productImageReference: imageReference } : {})
    })
  );
  if (!response.ok) return handleCatalogAutomationError(response);
  elements["catalog-product-dialog"].close();
  await loadCatalogAutomation();
  showNotice(
    "PennyWise Accounting item created. Its suggested channel match is visible now and still requires your approval."
  );
}

function approvedCatalogVariants() {
  return catalogVariants().flatMap(({ product, variant }) => {
    const candidate = (variant.candidates ?? []).find((item) => item.status === "CONFIRMED");
    const localProduct = candidate
      ? products.find((item) => item.id === candidate.productItemId)
      : null;
    return candidate && localProduct?.itemType === "INVENTORY_PRODUCT"
      ? [{ product, variant, candidate }]
      : [];
  });
}

function renderInventorySyncReview() {
  const policies = inventorySyncState.policies ?? [];
  const operations = inventorySyncState.operations ?? [];
  const conflicts = policies.flatMap((policy) =>
    (policy.conflicts ?? []).map((conflict) => ({ policy, conflict }))
  );
  elements["inventory-sync-summary"].replaceChildren(
    metric("Approved item matches", approvedCatalogVariants().length),
    metric("Saved rules", policies.length),
    metric("Automation enabled", policies.filter((policy) => policy.enabled).length),
    metric(
      "Open differences",
      conflicts.filter(({ conflict }) => conflict.status === "OPEN").length
    )
  );
  renderInventoryPolicyOptions();
  elements["inventory-sync-policies"].replaceChildren(
    ...(policies.length
      ? policies.map(renderInventoryPolicyRow)
      : [
          row([
            "No saved rules",
            "Approve a catalog match first",
            "Not available",
            "Manual review",
            "Off",
            "Not available",
            "Not available"
          ])
        ])
  );
  const statusFilter = elements["inventory-conflict-filter"].value;
  const visibleConflicts = conflicts.filter(
    ({ conflict }) => !statusFilter || conflict.status === statusFilter
  );
  elements["inventory-sync-conflicts"].replaceChildren(
    ...(visibleConflicts.length
      ? visibleConflicts.map(({ policy, conflict }) => renderInventoryConflictRow(policy, conflict))
      : [
          row([
            statusFilter === "OPEN" ? "No open quantity differences" : "No matching differences",
            "Not available",
            "Not available",
            "Not available",
            "Not available",
            "Not available",
            "Not available"
          ])
        ])
  );
  elements["inventory-sync-operations"].replaceChildren(
    ...(operations.length
      ? operations.map(renderInventoryOperationRow)
      : [row(["No queued provider updates", "Not available", "Not available", "Not available"])])
  );
}

function renderInventoryPolicyOptions() {
  const form = elements["inventory-sync-policy-form"];
  const variantSelect = form.elements.catalogVariantId;
  const locationSelect = form.elements.locationId;
  const previousVariant = variantSelect.value;
  const previousLocation = locationSelect.value;
  const approved = approvedCatalogVariants();
  variantSelect.replaceChildren(
    option("", approved.length ? "Select an approved item" : "Approve a catalog match first"),
    ...approved.map(({ product, variant, candidate }) => {
      const connector = connectorInstallations.find((item) => item.id === product.installationId);
      return option(
        variant.id,
        `${connector?.displayName ?? "Channel"} / ${variant.sku ?? variant.name} to ${candidate.productItem?.sku ?? candidate.productItem?.name ?? "PennyWise Accounting item"}`
      );
    })
  );
  locationSelect.replaceChildren(
    option("", "Select a location"),
    ...inventoryLocations
      .filter((location) => location.isActive)
      .map((location) => option(location.id, `${location.code} ${location.name}`))
  );
  if (approved.some(({ variant }) => variant.id === previousVariant))
    variantSelect.value = previousVariant;
  else if (approved.length === 1) variantSelect.value = approved[0].variant.id;
  if (inventoryLocations.some((location) => location.isActive && location.id === previousLocation))
    locationSelect.value = previousLocation;
  else {
    const defaultLocation = inventoryLocations.find(
      (location) => location.isActive && location.isDefault
    );
    if (defaultLocation) locationSelect.value = defaultLocation.id;
  }
  fillExistingInventoryPolicy();
}

function renderInventoryPolicyMapping() {
  const form = elements["inventory-sync-policy-form"];
  const approved = approvedCatalogVariants().find(
    ({ variant }) => variant.id === form.elements.catalogVariantId.value
  );
  elements["inventory-policy-mapping-summary"].textContent = approved
    ? `${approved.variant.sku ?? approved.variant.name} from the channel is approved as ${approved.candidate.productItem?.sku ?? "No SKU"} / ${approved.candidate.productItem?.name ?? "PennyWise Accounting item"}.`
    : "Approve a catalog match before configuring inventory.";
  fillExistingInventoryPolicy();
}

function fillExistingInventoryPolicy() {
  const form = elements["inventory-sync-policy-form"];
  const variantId = form.elements.catalogVariantId.value;
  const locationId = form.elements.locationId.value;
  const policy = (inventorySyncState.policies ?? []).find(
    (item) => item.catalogVariantId === variantId && item.locationId === locationId
  );
  form.elements.version.value = policy?.version ?? "";
  form.elements.sourceOfTruth.value = policy?.sourceOfTruth ?? "MANUAL_REVIEW";
  form.elements.desiredQuantity.value =
    policy?.desiredQuantityMicros === null || policy?.desiredQuantityMicros === undefined
      ? ""
      : formatQuantityMicros(policy.desiredQuantityMicros);
  form.elements.enabled.checked = Boolean(policy?.enabled);
  form.elements.approval.checked = false;
  renderInventoryPolicyEffect();
}

function inventoryChannelAuthorityLabel(installation) {
  if (installation?.providerKey === "WOOCOMMERCE") return "This WooCommerce store authoritative";
  if (installation?.providerKey === "ETSY") return "This Etsy shop authoritative";
  return "This sales channel authoritative";
}

function selectedInventoryInstallation() {
  const form = elements["inventory-sync-policy-form"];
  const approved = approvedCatalogVariants().find(
    ({ variant }) => variant.id === form.elements.catalogVariantId.value
  );
  return connectorInstallations.find((item) => item.id === approved?.product.installationId);
}

function renderInventoryAuthorityOptions() {
  const form = elements["inventory-sync-policy-form"];
  const installation = selectedInventoryInstallation();
  form.elements.sourceOfTruth.querySelector('[value="LOCAL"]').textContent =
    "PennyWise authoritative";
  form.elements.sourceOfTruth.querySelector('[value="CHANNEL"]').textContent =
    inventoryChannelAuthorityLabel(installation);
}

function renderInventoryPolicyEffect() {
  const form = elements["inventory-sync-policy-form"];
  const source = form.elements.sourceOfTruth.value;
  const enabled = form.elements.enabled;
  const scope = "Scope: this item + channel + inventory location.";
  const sharedPoolWarning = "Do not make two channels authoritative for one shared stock pool.";
  const channelAuthority = inventoryChannelAuthorityLabel(selectedInventoryInstallation());
  renderInventoryAuthorityOptions();
  if (source === "MANUAL_REVIEW") {
    enabled.checked = false;
    enabled.disabled = true;
  } else enabled.disabled = false;
  const approval = form.querySelector(".inventory-policy-approval");
  approval.hidden = !(enabled.checked && source !== "MANUAL_REVIEW");
  if (approval.hidden) form.elements.approval.checked = false;
  elements["inventory-policy-effect"].textContent =
    source === "LOCAL"
      ? enabled.checked
        ? `PennyWise authoritative. ${scope} A reviewed difference can queue its exact quantity to the channel; provider failures leave local inventory unchanged. ${sharedPoolWarning}`
        : `PennyWise authoritative, but automation remains off until you explicitly enable and approve it. ${scope} ${sharedPoolWarning}`
      : source === "CHANNEL"
        ? enabled.checked
          ? `${channelAuthority}. ${scope} Differences still stop for review; adopting one can create a dated local inventory adjustment and related accounting entry. ${sharedPoolWarning}`
          : `${channelAuthority}, but automation remains off until you explicitly enable and approve it. ${scope} ${sharedPoolWarning}`
        : `Manual review records exact observations and differences only. It cannot update the channel or create local inventory movements. ${scope} ${sharedPoolWarning}`;
}

function resetInventoryPolicyForm() {
  const form = elements["inventory-sync-policy-form"];
  form.reset();
  form.elements.version.value = "";
  renderInventoryPolicyOptions();
  elements["inventory-policy-status"].textContent = "";
}

async function saveInventorySyncPolicy(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const approved = approvedCatalogVariants().find(
    ({ variant }) => variant.id === data.get("catalogVariantId")
  );
  if (!approved) return showNotice("Choose an item with an approved catalog match.", true);
  const sourceOfTruth = data.get("sourceOfTruth");
  const enabled = sourceOfTruth === "MANUAL_REVIEW" ? false : data.get("enabled") === "on";
  if (enabled && data.get("approval") !== "on")
    return showNotice("Confirm the named quantity authority before enabling automation.", true);
  const quantityText = String(data.get("desiredQuantity") ?? "").trim();
  let desiredQuantityMicros = null;
  try {
    if (quantityText) desiredQuantityMicros = quantityToMicros(quantityText);
  } catch (error) {
    return showNotice(error instanceof Error ? error.message : "Enter a valid quantity.", true);
  }
  const version = String(data.get("version") ?? "").trim();
  const response = await api(
    "/v1/organizations/current/inventory-sync/policies",
    jsonRequest(
      {
        installationId: approved.product.installationId,
        catalogVariantId: approved.variant.id,
        productItemId: approved.candidate.productItemId,
        locationId: data.get("locationId"),
        sourceOfTruth,
        desiredQuantityMicros,
        enabled,
        ...(version ? { version: Number(version) } : {})
      },
      "PUT"
    )
  );
  if (!response.ok) return handleCatalogAutomationError(response);
  const policy = (await response.json()).policy;
  elements["inventory-policy-status"].textContent =
    `${inventoryAuthorityLabel(policy.sourceOfTruth, selectedInventoryInstallation())} saved for this item and location. ` +
    `Automation ${policy.enabled ? "enabled with explicit approval" : "off"}. Accounting entries created: 0.`;
  await loadCatalogAutomation();
  showNotice("Inventory rule saved. No quantity or accounting entry was changed.");
}

function renderInventoryPolicyRow(policy) {
  const automation = document.createElement("span");
  automation.className = `mapping-authority ${policy.enabled ? "is-approved" : "is-proposed"}`;
  automation.textContent = policy.enabled ? "Enabled" : "Off";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary-command";
  edit.dataset.inventoryPolicyId = policy.id;
  edit.textContent = "Review rule";
  const latest = policy.observations?.[0];
  return row([
    `${policy.installation?.displayName ?? "Channel"}\n${policy.variant?.sku ?? policy.variant?.name ?? policy.variant?.product?.name ?? "Variation"}`,
    `${policy.productItem?.sku ?? "No SKU"}\n${policy.productItem?.name ?? "PennyWise Accounting item"}`,
    `${policy.location?.code ?? ""} ${policy.location?.name ?? ""}`.trim(),
    inventoryAuthorityLabel(policy.sourceOfTruth, policy.installation),
    automation,
    latest
      ? `${formatQuantityMicros(latest.observedQuantityMicros)} / ${formatConnectorTime(latest.observedAt)}`
      : "No observation yet",
    edit
  ]);
}

function editInventorySyncPolicy(event) {
  const button = event.target.closest("[data-inventory-policy-id]");
  if (!button) return;
  const policy = (inventorySyncState.policies ?? []).find(
    (item) => item.id === button.dataset.inventoryPolicyId
  );
  if (!policy) return;
  const form = elements["inventory-sync-policy-form"];
  form.elements.catalogVariantId.value = policy.catalogVariantId;
  form.elements.locationId.value = policy.locationId;
  fillExistingInventoryPolicy();
  form.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  form.elements.sourceOfTruth.focus({ preventScroll: true });
}

function renderInventoryConflictRow(policy, conflict) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "secondary-command";
  action.dataset.inventoryConflictId = conflict.id;
  action.textContent = conflict.status === "OPEN" ? "Review difference" : "View evidence";
  const status = document.createElement("span");
  status.className = `mapping-authority ${conflict.status === "RESOLVED" ? "is-approved" : "is-proposed"}`;
  status.textContent = formatConnectorStatus(conflict.status);
  return row([
    `${policy.productItem?.sku ?? policy.variant?.sku ?? "Item"}\n${policy.location?.code ?? policy.location?.name ?? "Location"}`,
    formatQuantityMicros(conflict.observedQuantityMicros),
    formatQuantityMicros(conflict.desiredQuantityMicros),
    formatQuantityMicros(conflict.differenceMicros),
    inventoryAuthorityLabel(policy.sourceOfTruth, policy.installation),
    status,
    action
  ]);
}

function inventoryAuthorityLabel(sourceOfTruth, installation) {
  if (sourceOfTruth === "LOCAL") return "PennyWise authoritative";
  if (sourceOfTruth === "CHANNEL") return inventoryChannelAuthorityLabel(installation);
  return "Manual review";
}

function inventoryConflictEntry(conflictId) {
  for (const policy of inventorySyncState.policies ?? []) {
    const conflict = (policy.conflicts ?? []).find((item) => item.id === conflictId);
    if (conflict) return { policy, conflict };
  }
  return null;
}

function openInventoryConflictReview(event) {
  const button = event.target.closest("[data-inventory-conflict-id]");
  if (!button) return;
  const entry = inventoryConflictEntry(button.dataset.inventoryConflictId);
  if (!entry) return;
  activeInventoryConflict = entry;
  const { policy, conflict } = entry;
  const form = elements["inventory-conflict-form"];
  form.reset();
  elements["inventory-conflict-dialog-summary"].textContent =
    `${policy.productItem?.sku ?? policy.variant?.sku ?? "Item"} at ${policy.location?.code ?? policy.location?.name ?? "this location"}: ` +
    `channel ${formatQuantityMicros(conflict.observedQuantityMicros)}, expected ${formatQuantityMicros(conflict.desiredQuantityMicros)}, difference ${formatQuantityMicros(conflict.differenceMicros)}.`;
  const actions = [option("IGNORE", "Keep both systems unchanged and close this difference")];
  if (conflict.status === "OPEN" && policy.enabled && policy.sourceOfTruth === "LOCAL")
    actions.unshift(
      option("PUSH_LOCAL_TO_CHANNEL", "Send PennyWise Accounting quantity to the channel")
    );
  if (conflict.status === "OPEN" && policy.enabled && policy.sourceOfTruth === "CHANNEL")
    actions.unshift(
      option("ADOPT_CHANNEL_LOCALLY", "Adopt channel quantity in PennyWise Accounting")
    );
  form.elements.action.replaceChildren(...actions);
  form.elements.action.disabled = conflict.status !== "OPEN";
  form.querySelector('button[type="submit"]').hidden = conflict.status !== "OPEN";
  form.elements.effectiveDate.value = new Date().toISOString().slice(0, 10);
  renderInventoryConflictEffect();
  elements["inventory-conflict-dialog"].showModal();
  if (conflict.status === "OPEN") form.elements.action.focus();
}

function renderInventoryConflictEffect() {
  const form = elements["inventory-conflict-form"];
  const action = form.elements.action.value;
  const adopting = action === "ADOPT_CHANNEL_LOCALLY";
  for (const field of form.querySelectorAll(
    '[data-conflict-field="effectiveDate"], [data-conflict-field="unitCost"], [data-conflict-field="approval"]'
  ))
    field.hidden = !adopting;
  form.elements.effectiveDate.required = adopting;
  form.elements.approval.required = adopting;
  form.elements.reason.required = adopting || action === "IGNORE";
  if (!adopting) form.elements.approval.checked = false;
  elements["inventory-conflict-effect"].textContent =
    action === "PUSH_LOCAL_TO_CHANNEL"
      ? "Queues the exact PennyWise Accounting quantity for provider delivery. A provider failure leaves local inventory unchanged and remains visible for retry."
      : adopting
        ? "Creates a dated local inventory adjustment from reviewed channel evidence. This can change inventory value and create its related accounting entry."
        : "Closes this difference with your review note. Neither PennyWise Accounting nor the sales channel quantity is changed.";
}

async function resolveInventoryConflict(event) {
  event.preventDefault();
  if (!activeInventoryConflict || activeInventoryConflict.conflict.status !== "OPEN") return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const action = data.get("action");
  const reason = String(data.get("reason") ?? "").trim();
  if ((action === "IGNORE" || action === "ADOPT_CHANNEL_LOCALLY") && !reason)
    return showNotice("Add a review note for this resolution.", true);
  if (action === "ADOPT_CHANNEL_LOCALLY" && data.get("approval") !== "on")
    return showNotice("Approve the local inventory adjustment before continuing.", true);
  const body = {
    action,
    version: activeInventoryConflict.conflict.version,
    ...(action === "IGNORE" ? { reason } : {}),
    ...(action === "ADOPT_CHANNEL_LOCALLY"
      ? {
          effectiveDate: data.get("effectiveDate"),
          reason
        }
      : {})
  };
  const unitCost = String(data.get("unitCost") ?? "").trim();
  if (action === "ADOPT_CHANNEL_LOCALLY" && unitCost) {
    try {
      body.unitCostMinor = parseMoneyInput(unitCost);
    } catch (error) {
      return showNotice(error instanceof Error ? error.message : "Enter a valid unit cost.", true);
    }
  }
  const request = jsonRequest(body);
  if (action === "ADOPT_CHANNEL_LOCALLY")
    request.headers["idempotency-key"] = globalThis.crypto.randomUUID();
  const response = await api(
    `/v1/organizations/current/inventory-sync/conflicts/${activeInventoryConflict.conflict.id}/resolve`,
    request
  );
  if (!response.ok) return handleCatalogAutomationError(response);
  elements["inventory-conflict-dialog"].close();
  activeInventoryConflict = null;
  await loadCatalogAutomation();
  showNotice(
    action === "PUSH_LOCAL_TO_CHANNEL"
      ? "PennyWise Accounting quantity queued for provider delivery."
      : action === "ADOPT_CHANNEL_LOCALLY"
        ? "Reviewed channel quantity adopted through the inventory adjustment workflow."
        : "Quantity difference closed without changing either system."
  );
}

function renderInventoryOperationRow(operation) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "secondary-command";
  action.dataset.inventoryOperationId = operation.id;
  action.textContent = "Retry";
  action.disabled = operation.status !== "FAILED";
  return row([
    formatConnectorTime(operation.occurredAt),
    formatConnectorStatus(operation.status),
    operation.attempts,
    action
  ]);
}

async function processInventoryOperations() {
  const button = elements["process-inventory-operations"];
  button.disabled = true;
  try {
    const response = await api(
      "/v1/organizations/current/inventory-sync/operations/process",
      jsonRequest({ limit: 10 })
    );
    if (!response.ok) return handleCatalogAutomationError(response);
    const result = await response.json();
    await loadCatalogAutomation();
    showNotice(
      `Inventory delivery queue processed: ${result.completed} completed, ${result.failed} failed, ${result.claimed} claimed.`
    );
  } finally {
    button.disabled = false;
  }
}

async function retryInventoryOperation(event) {
  const button = event.target.closest("[data-inventory-operation-id]");
  if (!button || button.disabled) return;
  const response = await api(
    `/v1/organizations/current/inventory-sync/operations/${button.dataset.inventoryOperationId}/retry`,
    jsonRequest({})
  );
  if (!response.ok) return handleCatalogAutomationError(response);
  await loadCatalogAutomation();
  showNotice("Failed provider update returned to the pending queue.");
}

function renderConnectorProviders() {
  elements["load-commerce-demo"].hidden = !connectorProviders.some(
    (provider) => provider.demoAvailable
  );
  elements["connector-provider-cards"].replaceChildren(
    ...connectorProviders.map((provider) => {
      const card = document.createElement("article");
      card.className = "connector-provider-card";
      const mark = document.createElement("span");
      mark.className = "connector-provider-mark";
      mark.textContent = provider.providerKey === "WOOCOMMERCE" ? "W" : "E";
      mark.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = provider.displayName;
      const description = document.createElement("p");
      description.textContent = provider.description;
      const approval = document.createElement("p");
      approval.textContent = provider.externalApproval;
      copy.append(heading, description, approval);
      card.append(mark, copy);
      return card;
    })
  );
}

async function loadCommerceDemo() {
  const button = elements["load-commerce-demo"];
  button.disabled = true;
  try {
    const response = await api("/v1/organizations/current/commerce/demo", jsonRequest({}));
    if (!response.ok) return showError(response);
    const result = (await response.json()).demo;
    await loadIntegrations();
    elements["connector-operation-status"].textContent =
      `Sample order ${result.event.resourceId} is in the review inbox. ` +
      `Accounting entries created: ${result.accountingEntriesCreated}.`;
    showNotice("Safe sample commerce evidence loaded. No books were changed.");
  } finally {
    button.disabled = false;
  }
}

function renderConnectorSelects() {
  for (const select of document.querySelectorAll("[data-connector-select]")) {
    const previous = select.value;
    const provider = select.dataset.connectorSelect;
    const matches = connectorInstallations.filter(
      (connector) => provider === "ALL" || connector.providerKey === provider
    );
    select.replaceChildren(
      option("", matches.length ? "Select a store" : "Add a store above first"),
      ...matches.map((connector) =>
        option(
          connector.id,
          `${connector.displayName} · ${formatConnectorStatus(connector.status)}`
        )
      )
    );
    if (matches.some((connector) => connector.id === previous)) select.value = previous;
    else if (matches.length === 1) select.value = matches[0].id;
  }
  fillConnectorMappingForm();
  renderEtsyWebhookUrl();
}

function renderConnectorInstallations() {
  elements["connector-installations"].replaceChildren(
    ...connectorInstallations.map((connector) => {
      const status = document.createElement("span");
      status.className = `status-pill ${connector.healthStatus === "FAILED" ? "is-error" : connector.healthStatus === "DEGRADED" ? "is-warning" : ""}`;
      status.textContent = `${formatConnectorStatus(connector.status)} · ${formatConnectorStatus(connector.healthStatus)}`;
      const webhook = document.createElement("span");
      webhook.className = `status-pill ${connector.webhookStatus === "FAILED" ? "is-error" : connector.webhookStatus === "DEGRADED" ? "is-warning" : ""}`;
      webhook.textContent = formatConnectorStatus(connector.webhookStatus);
      const actions = document.createElement("div");
      actions.className = "connector-action-group";
      const addAction = (label, action, disabled = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-command";
        button.textContent = label;
        button.dataset.connectorAction = action;
        button.dataset.connectorId = connector.id;
        button.disabled = disabled;
        actions.append(button);
      };
      addAction("Health", "health", !connector.consentedAt);
      addAction("Sync", "sync", connector.status !== "READY");
      if (connector.providerKey === "WOOCOMMERCE")
        addAction("Webhooks", "register-webhooks", connector.status !== "READY");
      else addAction("Webhook setup", "etsy-webhook", connector.status !== "READY");
      addAction(
        connector.status === "PAUSED" ? "Resume" : "Pause",
        connector.status === "PAUSED" ? "resume" : "pause",
        !["READY", "PAUSED"].includes(connector.status)
      );
      addAction("Logs", "logs");
      addAction(
        "Disconnect",
        "disconnect",
        !connector.consentedAt || connector.status === "DISCONNECTED"
      );
      return row([
        connector.externalAccountId
          ? `${connector.displayName}\n${connector.externalAccountId}`
          : connector.displayName,
        connector.providerKey === "WOOCOMMERCE" ? "WooCommerce" : "Etsy",
        status,
        formatConnectorTime(connector.lastSyncAt),
        webhook,
        actions
      ]);
    })
  );
}

async function createConnectorDraft(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const response = await api(
    "/v1/organizations/current/connectors",
    jsonRequest({
      providerKey: data.get("providerKey"),
      displayName: data.get("displayName"),
      mapping: {
        customerStrategy: "UNCONFIGURED",
        skuMappings: {},
        taxMappings: {},
        taxRemittanceMappings: {},
        taxRemittanceResponsibility: "REVIEW_REQUIRED"
      }
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  await loadIntegrations();
  showNotice("Store added. Complete its secure connection next.");
}

async function connectWooCommerce(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const connectorId = data.get("connectorId");
  const response = await api(
    `/v1/organizations/current/connectors/${connectorId}/connect`,
    jsonRequest({
      credentials: {
        storeUrl: data.get("storeUrl"),
        consumerKey: data.get("consumerKey"),
        consumerSecret: data.get("consumerSecret")
      },
      backfillStartAt: connectorDateBoundary(data.get("backfillStart"), false),
      backfillEndAt: connectorDateBoundary(data.get("backfillEnd"), true)
    })
  );
  form.elements.consumerKey.value = "";
  form.elements.consumerSecret.value = "";
  if (!response.ok) return showError(response);
  await loadIntegrations();
  showNotice("WooCommerce credentials verified. Run the first synchronization when ready.");
}

async function startEtsyOAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const connectorId = data.get("connectorId");
  const response = await api(
    `/v1/organizations/current/connectors/${connectorId}/etsy/oauth/start`,
    jsonRequest({
      apiKey: data.get("apiKey"),
      sharedSecret: data.get("sharedSecret"),
      ...(String(data.get("shopId") || "").trim() ? { shopId: data.get("shopId") } : {}),
      redirectUri: new URL("/", window.location.origin).toString()
    })
  );
  form.elements.apiKey.value = "";
  form.elements.sharedSecret.value = "";
  if (!response.ok) return showError(response);
  const authorization = (await response.json()).authorization;
  sessionStorage.setItem("clearledger_etsy_oauth_connector", connectorId);
  window.location.assign(authorization.authorizationUrl);
}

export async function completeEtsyOAuthFromCallback() {
  const connectorId = sessionStorage.getItem("clearledger_etsy_oauth_connector");
  const query = new URLSearchParams(window.location.search);
  if (!connectorId || (!query.has("code") && !query.has("error"))) return;
  setActiveWorkspaceId("integrations-workspace");
  sessionStorage.setItem("clearledger_active_workspace", activeWorkspaceId);
  if (query.has("error")) {
    showNotice("Etsy authorization was cancelled or rejected.", true);
  } else {
    const response = await api(
      `/v1/organizations/current/connectors/${connectorId}/etsy/oauth/complete`,
      jsonRequest({ code: query.get("code"), state: query.get("state") })
    );
    if (!response.ok) await showError(response);
    else showNotice("Etsy shop connected. Run the first synchronization when ready.");
  }
  sessionStorage.removeItem("clearledger_etsy_oauth_connector");
  window.history.replaceState({}, "", "/");
  showWorkspaceNavigation();
  await loadIntegrations();
}

async function syncConnector(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await runConnectorSync(data.get("connectorId"), {
    from: connectorDateBoundary(data.get("from"), false),
    to: connectorDateBoundary(data.get("to"), true),
    maxPages: Number(data.get("maxPages")),
    pageSize: 50,
    scope: "ALL"
  });
}

async function runConnectorSync(connectorId, body = {}) {
  const isContinuation = Boolean(body.continuationToken);
  if (!isContinuation) setConnectorSyncContinuation(null);
  elements["continue-connector-sync"].disabled = true;
  elements["connector-operation-status"].textContent = "Synchronizing provider evidence…";
  const response = await api(
    `/v1/organizations/current/connectors/${connectorId}/sync`,
    jsonRequest(body)
  );
  if (!response.ok) {
    elements["connector-operation-status"].textContent = "";
    renderConnectorSyncContinuation();
    return showError(response);
  }
  const result = (await response.json()).sync;
  setConnectorSyncContinuation(
    result.continuation
      ? {
          organizationId: identity.activeOrganizationId,
          connectorId,
          token: result.continuation.token,
          remainingScopes: result.continuation.remainingScopes,
          window: result.continuation.window
        }
      : null
  );
  const remaining = result.continuation?.remainingScopes?.map(formatRole).join(", ") || "";
  elements["connector-operation-status"].textContent =
    `Imported ${result.imported}; already present ${result.replayed}; integrity conflicts ${result.conflicts}; pages ${result.pages}.\n` +
    (result.complete
      ? "All requested provider pages are complete. "
      : `More provider pages remain${remaining ? ` for ${remaining}` : ""}. Choose Continue sync to resume the same date range. `) +
    "Accounting entries created: 0. Imported events are waiting in the review inbox.";
  await loadIntegrations();
  showNotice(
    result.complete
      ? "Commerce synchronization completed without changing the books."
      : "More provider pages remain. Continue this synchronization when ready."
  );
}

async function continueConnectorSync() {
  if (
    !connectorSyncContinuation ||
    connectorSyncContinuation.organizationId !== identity?.activeOrganizationId
  )
    return;
  await runConnectorSync(connectorSyncContinuation.connectorId, {
    continuationToken: connectorSyncContinuation.token,
    maxPages: Number(elements["connector-sync-form"].elements.maxPages.value)
  });
}

function setConnectorSyncContinuation(value) {
  connectorSyncContinuation = value;
  if (value) sessionStorage.setItem(connectorSyncContinuationStorageKey, JSON.stringify(value));
  else sessionStorage.removeItem(connectorSyncContinuationStorageKey);
  renderConnectorSyncContinuation();
}

function readConnectorSyncContinuation() {
  try {
    const value = JSON.parse(sessionStorage.getItem(connectorSyncContinuationStorageKey) || "null");
    return value &&
      typeof value.organizationId === "string" &&
      typeof value.connectorId === "string" &&
      typeof value.token === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function renderConnectorSyncContinuation() {
  const available =
    connectorSyncContinuation?.organizationId === identity?.activeOrganizationId &&
    connectorInstallations.some(
      (connector) => connector.id === connectorSyncContinuation.connectorId
    );
  elements["continue-connector-sync"].disabled = !available;
  elements["continue-connector-sync"].title = available
    ? "Resume the same provider date range from its saved cursor."
    : "No incomplete synchronization is waiting.";
}

async function saveConnectorMapping(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const connector = connectorInstallations.find((item) => item.id === data.get("connectorId"));
  if (!connector) return showNotice("Select a store.", true);
  let skuMappings;
  let taxMappings;
  let taxRemittanceMappings;
  try {
    skuMappings = parseMappingLines(data.get("skuMappings"));
    taxMappings = parseMappingLines(data.get("taxMappings"));
    taxRemittanceMappings = parseMappingLines(data.get("taxRemittanceMappings"));
  } catch (error) {
    return showNotice(error.message, true);
  }
  const editableMapping = Object.fromEntries(
    Object.entries(connector.mapping ?? {}).filter(
      ([key]) =>
        ![
          "catalogVariantMappings",
          "catalogProductMappings",
          "catalogSkuMappings",
          "catalogSkuAliases",
          "catalogSkuPatternRules"
        ].includes(key)
    )
  );
  const response = await api(
    `/v1/organizations/current/connectors/${connector.id}/mapping`,
    jsonRequest(
      {
        version: connector.mappingVersion,
        mapping: {
          ...editableMapping,
          customerStrategy: data.get("customerStrategy"),
          skuMappings,
          taxMappings,
          taxRemittanceMappings,
          taxRemittanceResponsibility: data.get("taxRemittanceResponsibility")
        }
      },
      "PATCH"
    )
  );
  if (!response.ok) return showError(response);
  await loadIntegrations();
  showNotice("Import rules saved. Synchronize again to apply them to staged events.");
}

function fillConnectorMappingForm() {
  const form = elements["connector-mapping-form"];
  const connector = connectorInstallations.find(
    (item) => item.id === form.elements.connectorId.value
  );
  if (!connector) return;
  form.elements.customerStrategy.value = connector.mapping?.customerStrategy || "UNCONFIGURED";
  form.elements.skuMappings.value = formatMappingLines(connector.mapping?.skuMappings);
  form.elements.taxMappings.value = formatMappingLines(connector.mapping?.taxMappings);
  form.elements.taxRemittanceMappings.value = formatMappingLines(
    connector.mapping?.taxRemittanceMappings
  );
  form.elements.taxRemittanceResponsibility.value =
    connector.mapping?.taxRemittanceResponsibility || "REVIEW_REQUIRED";
}

async function handleConnectorAction(event) {
  const button = event.target.closest("[data-connector-action]");
  if (!button) return;
  const connectorId = button.dataset.connectorId;
  const action = button.dataset.connectorAction;
  if (action === "sync") return runConnectorSync(connectorId);
  if (action === "etsy-webhook") {
    const details = elements["etsy-webhook-form"].closest("details");
    details.open = true;
    elements["etsy-webhook-form"].elements.connectorId.value = connectorId;
    renderEtsyWebhookUrl();
    details.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
    return;
  }
  if (action === "register-webhooks") {
    const deliveryUrl = connectorWebhookUrl("woocommerce", connectorId);
    const response = await api(
      `/v1/organizations/current/connectors/${connectorId}/webhooks/register`,
      jsonRequest({ deliveryUrl })
    );
    if (!response.ok) return showError(response);
    const result = (await response.json()).webhook;
    elements["connector-operation-status"].textContent =
      `WooCommerce webhooks active. Created ${result.created}; already present ${result.existing}.`;
    await loadIntegrations();
    return;
  }
  if (action === "logs") {
    const response = await api(`/v1/organizations/current/connectors/${connectorId}/logs?limit=20`);
    if (!response.ok) return showError(response);
    const logs = (await response.json()).logs;
    elements["connector-operation-status"].textContent = logs.length
      ? logs.map((log) => `${formatConnectorTime(log.createdAt)} · ${log.message}`).join("\n")
      : "No connector activity has been recorded yet.";
    return;
  }
  if (
    action === "disconnect" &&
    !window.confirm(
      "Remove the stored provider credentials? Imported review evidence will be retained."
    )
  )
    return;
  const response = await api(
    `/v1/organizations/current/connectors/${connectorId}/${action}`,
    jsonRequest({})
  );
  if (!response.ok) return showError(response);
  await loadIntegrations();
  showNotice(
    action === "health"
      ? "Connector health check completed."
      : action === "disconnect"
        ? "Connector credentials removed; imported evidence was retained."
        : `Connector ${action === "pause" ? "paused" : "resumed"}.`
  );
}

async function saveEtsyWebhookSecret(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const connectorId = data.get("connectorId");
  const response = await api(
    `/v1/organizations/current/connectors/${connectorId}/webhook-secret`,
    jsonRequest({ signingSecret: data.get("signingSecret") }, "PUT")
  );
  form.elements.signingSecret.value = "";
  if (!response.ok) return showError(response);
  await loadIntegrations();
  showNotice("Etsy signing secret saved. A verified delivery will mark the webhook active.");
}

function renderEtsyWebhookUrl() {
  const form = elements["etsy-webhook-form"];
  const connectorId = form.elements.connectorId.value;
  form.elements.webhookUrl.value = connectorId ? connectorWebhookUrl("etsy", connectorId) : "";
}

function connectorWebhookUrl(provider, connectorId) {
  const configuredBase = connectorProviders.find(
    (entry) => entry.providerKey === provider.toUpperCase()
  )?.webhookBaseUrl;
  if (configuredBase)
    return new URL(
      `/v1/webhooks/commerce/${encodeURIComponent(provider)}/${encodeURIComponent(connectorId)}`,
      `${configuredBase}/`
    ).toString();
  return new URL(
    `/api/v1/webhooks/commerce/${encodeURIComponent(provider)}/${encodeURIComponent(connectorId)}`,
    window.location.origin
  ).toString();
}

async function loadCommerceInbox() {
  if (!identity?.activeOrganizationId) return;
  const status = elements["commerce-inbox-filter"].value;
  const response = await api(
    `/v1/organizations/current/commerce/inbox?limit=200${status ? `&status=${encodeURIComponent(status)}` : ""}`,
    {},
    true
  );
  if (!response.ok) {
    if (response.status !== 403) await showError(response);
    commerceInboxEvents = [];
  } else commerceInboxEvents = (await response.json()).events;
  renderCommerceInbox();
}

function renderCommerceInbox() {
  const counts = Object.fromEntries(
    ["REVIEW_REQUIRED", "NORMALIZED", "DEAD_LETTER"].map((status) => [
      status,
      commerceInboxEvents.filter((event) => event.status === status).length
    ])
  );
  elements["commerce-inbox-summary"].replaceChildren(
    metric("Needs review", counts.REVIEW_REQUIRED),
    metric("Reviewed", counts.NORMALIZED),
    metric("Cannot process", counts.DEAD_LETTER),
    metric("Visible events", commerceInboxEvents.length)
  );
  elements["commerce-inbox-events"].replaceChildren(
    ...commerceInboxEvents.map((event) => {
      const issues = Array.isArray(event.normalizationIssues) ? event.normalizationIssues : [];
      const issueList = document.createElement("ul");
      issueList.className = "commerce-issue-list";
      for (const issue of issues.slice(0, 4)) {
        const item = document.createElement("li");
        item.className = issue.severity === "BLOCKING" ? "is-blocking" : "";
        item.textContent = issue.message;
        issueList.append(item);
      }
      if (issues.length > 4) {
        const item = document.createElement("li");
        item.textContent = `+ ${issues.length - 4} more findings`;
        issueList.append(item);
      }
      if (!issues.length) {
        const item = document.createElement("li");
        item.textContent = "No normalization findings";
        issueList.append(item);
      }
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary-command";
      action.dataset.commerceEventId = event.id;
      const conversionComplete = Boolean(event.resultingInvoiceId);
      if (event.status === "NORMALIZED" && !conversionComplete) {
        action.textContent =
          event.conversionStatus === "REJECTED" ? "Review again" : "Preview draft";
      } else if (conversionComplete) {
        action.textContent = event.conversionStatus === "POSTED" ? "Posted" : "Draft linked";
      } else {
        action.textContent = "Mark reviewed";
      }
      action.disabled =
        conversionComplete ||
        (event.status !== "NORMALIZED" && issues.some((issue) => issue.severity === "BLOCKING"));
      return row([
        formatConnectorTime(event.occurredAt ?? event.createdAt),
        `${event.providerKey === "WOOCOMMERCE" ? "WooCommerce" : "Etsy"}\n${event.shopExternalId}`,
        `${formatConnectorStatus(event.eventType)}\n${event.resourceId}`,
        commerceEventTotal(event),
        issueList,
        event.conversionStatus && event.conversionStatus !== "NOT_STARTED"
          ? `${formatConnectorStatus(event.status)} · ${formatConnectorStatus(event.conversionStatus)}`
          : formatConnectorStatus(event.status),
        action
      ]);
    })
  );
}

async function reviewCommerceEvent(event) {
  const button = event.target.closest("[data-commerce-event-id]");
  if (!button) return;
  const item = commerceInboxEvents.find((entry) => entry.id === button.dataset.commerceEventId);
  if (!item) return;
  if (item.status === "NORMALIZED" && !item.resultingInvoiceId)
    return openCommerceConversionReview(item);
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${item.id}/review`,
    jsonRequest({
      version: item.version,
      status: "NORMALIZED",
      reviewNote:
        "Reviewed in the PennyWise Accounting commerce inbox. No accounting entry was created."
    })
  );
  if (!response.ok) return showError(response);
  await loadCommerceInbox();
  showNotice("Commerce evidence marked reviewed. The books were not changed.");
}

async function openCommerceConversionReview(event) {
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${event.id}/conversion-preflight`,
    {},
    true
  );
  if (!response.ok) return showError(response);
  const body = await response.json();
  activeCommerceConversion = { event, conversion: body.conversion };
  renderCommerceConversionReview();
  elements["commerce-conversion-dialog"].showModal();
}

function renderCommerceConversionReview() {
  const conversion = activeCommerceConversion?.conversion;
  if (!conversion) return;
  const provider = conversion.providerTotals ?? {};
  const providerMoney = provider.money?.total ?? provider.money?.amount;
  const providerReconciliation = provider.reconciliation;
  const providerOutput = elements["commerce-conversion-provider-evidence"];
  providerOutput.replaceChildren(
    conversionHeading("Provider evidence"),
    conversionDetail("Order currency", provider.currency ?? "Unknown"),
    conversionDetail("Provider subtotal", provider.money?.subtotal?.decimal ?? "Not supplied"),
    conversionDetail(
      "Provider tax",
      providerMoney?.currency ? (provider.money?.tax?.decimal ?? "Not supplied") : "Not supplied"
    ),
    conversionDetail("Provider total", providerMoney?.decimal ?? "Not supplied"),
    conversionDetail(
      "Reconciliation",
      providerReconciliation?.isExact === false
        ? "Provider totals need review"
        : "Retained provider totals"
    )
  );

  const draftOutput = elements["commerce-conversion-draft-preview"];
  draftOutput.replaceChildren(conversionHeading("Proposed PennyWise draft"));
  if (conversion.draft) {
    const draft = conversion.draft;
    draftOutput.append(
      conversionDetail("Customer", draft.customerName ?? "Selected customer"),
      conversionDetail("Issue date", String(draft.issueDate).slice(0, 10)),
      conversionDetail("Due date", String(draft.dueDate).slice(0, 10)),
      conversionDetail("Currency", draft.currency),
      conversionDetail("Subtotal", formatMinor(draft.subtotalMinor, draft.currency)),
      conversionDetail("Discount", formatMinor(draft.discountTotalMinor, draft.currency)),
      conversionDetail("Tax", formatMinor(draft.taxTotalMinor, draft.currency)),
      conversionDetail("Total", formatMinor(draft.grandTotalMinor, draft.currency))
    );
    const lines = document.createElement("ul");
    lines.className = "commerce-issue-list";
    for (const line of draft.lines ?? []) {
      const item = document.createElement("li");
      item.textContent = `${line.description} · ${formatQuantityMicros(line.quantityMicros)} × ${formatMinor(line.unitPriceMinor, draft.currency)} · net ${formatMinor(line.netAmountMinor, draft.currency)} · tax ${formatMinor(line.taxTotalMinor, draft.currency)} · income ${line.incomeAccountCode ?? "unmapped"} · tax code ${line.taxCodeId ?? "none"}`;
      lines.append(item);
    }
    draftOutput.append(conversionHeading("Lines, accounts, and tax"), lines);
  } else {
    const empty = document.createElement("p");
    empty.textContent = "No invoice draft can be assembled until the listed gaps are resolved.";
    draftOutput.append(empty);
  }

  const gapsOutput = elements["commerce-conversion-gaps"];
  gapsOutput.replaceChildren(
    conversionHeading(conversion.ready ? "Decision" : "Required before conversion")
  );
  if (conversion.ready) {
    const ready = document.createElement("p");
    ready.textContent = `Ready for explicit confirmation. Customer policy: ${conversion.customerStrategy}. This action creates a DRAFT only.`;
    gapsOutput.append(ready);
  } else {
    const gaps = document.createElement("ul");
    gaps.className = "commerce-issue-list";
    for (const gap of conversion.gaps ?? []) {
      const item = document.createElement("li");
      item.textContent = `${gap.code}: ${gap.message}${gap.path ? ` (${gap.path})` : ""}`;
      gaps.append(item);
    }
    gapsOutput.append(gaps);
  }
  elements["commerce-conversion-confirm"].disabled = !conversion.ready;
  elements["commerce-conversion-reject"].disabled = Boolean(conversion.resultingInvoiceId);
}

function conversionHeading(text) {
  const heading = document.createElement("h3");
  heading.textContent = text;
  return heading;
}

function conversionDetail(label, value) {
  const detail = document.createElement("p");
  detail.textContent = `${label}: ${value}`;
  return detail;
}

async function confirmCommerceConversion() {
  const active = activeCommerceConversion;
  if (!active?.conversion?.ready) return;
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${active.event.id}/convert`,
    jsonRequest({ decision: "CONFIRM", version: active.event.version })
  );
  if (!response.ok) return showError(response);
  elements["commerce-conversion-dialog"].close();
  activeCommerceConversion = null;
  await loadCommerceInbox();
  showNotice("Draft invoice created. Posting remains a separate invoice action.");
}

async function rejectCommerceConversion() {
  const active = activeCommerceConversion;
  if (!active) return;
  const reason = elements["commerce-conversion-rejection-reason"].value.trim();
  if (!reason) return showNotice("Enter a rejection reason before rejecting conversion.", true);
  const response = await api(
    `/v1/organizations/current/commerce/inbox/${active.event.id}/convert`,
    jsonRequest({ decision: "REJECT", version: active.event.version, reason })
  );
  if (!response.ok) return showError(response);
  elements["commerce-conversion-dialog"].close();
  activeCommerceConversion = null;
  await loadCommerceInbox();
  showNotice("Conversion rejected with a review note. The books were not changed.");
}

function commerceEventTotal(event) {
  const total = event.normalizedPayload?.money?.total ?? event.normalizedPayload?.money?.amount;
  return total?.currency && total?.decimal ? `${total.currency} ${total.decimal}` : "—";
}

function parseMappingLines(value) {
  const mappings = {};
  for (const [index, rawLine] of String(value || "")
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || !line.slice(separator + 1).trim())
      throw new Error(`Mapping line ${index + 1} must use “source = destination”.`);
    const source = line.slice(0, separator).trim();
    const destination = line.slice(separator + 1).trim();
    if (source in mappings) throw new Error(`Mapping source “${source}” is listed more than once.`);
    mappings[source] = destination;
  }
  return mappings;
}

function formatMappingLines(value) {
  return value && typeof value === "object"
    ? Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, destination]) => `${source} = ${destination}`)
        .join("\n")
    : "";
}

function setDefaultConnectorDates() {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  for (const form of [elements["woocommerce-connect-form"], elements["connector-sync-form"]]) {
    if (!form.elements.backfillStart?.value && form.elements.backfillStart)
      form.elements.backfillStart.value = from;
    if (!form.elements.backfillEnd?.value && form.elements.backfillEnd)
      form.elements.backfillEnd.value = today;
    if (!form.elements.from?.value && form.elements.from) form.elements.from.value = from;
    if (!form.elements.to?.value && form.elements.to) form.elements.to.value = today;
  }
}

function connectorDateBoundary(value, end) {
  const date = String(value || "");
  const today = new Date().toISOString().slice(0, 10);
  if (!date) return null;
  if (end && date === today) return new Date().toISOString();
  return `${date}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;
}

function formatConnectorTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatConnectorStatus(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
