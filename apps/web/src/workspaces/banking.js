// Banking (`banking-workspace`).

import { formatMinor, minorToInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { readFileAsBase64 } from "../lib/browser.js";
import { replaceCurrencyOptions } from "../lib/currency-controls.js";
import { cell, commandButton, moneyFromForm, option, row } from "../lib/dom.js";
import { applySavedTableFilters } from "../lib/forms.js";
import { showError, showNotice } from "../lib/notices.js";
import { trackProductEvent } from "../lib/product-analytics.js";
import { activeRoleIs, formatRole } from "../lib/roles.js";
import {
  formatConnectorStatus,
  formatConnectorTime,
  registerWorkspaceCalls
} from "../lib/workspace-calls.js";
import { refreshContextualSearches } from "../shell.js";
import {
  accounts,
  bankTransactions,
  currentReconciliation,
  elements,
  identity,
  setBankTransactions,
  setCurrentReconciliation
} from "../state.js";

let bankAccounts = [];
let pendingBankImport = null;
let bankFeedStatus = null;
let bankFeeds = [];
let pendingBankFeedLink = null;
let plaidLinkScriptPromise = null;
let pendingFlinksConnect = null;

registerWorkspaceCalls({ loadBanking });

export function initBanking() {
  elements["refresh-banking"].addEventListener("click", loadBanking);
  elements["bank-feed-connect"].addEventListener("click", () => startBankFeedConnection());
  elements["bank-feed-mapping-form"].addEventListener("submit", completeBankFeedConnection);
  elements["bank-feed-mapping-dialog"].addEventListener("close", () => {
    pendingBankFeedLink = null;
    elements["bank-feed-mapping-status"].textContent = "";
  });
  elements["flinks-connect-dialog"].addEventListener("close", () => {
    pendingFlinksConnect = null;
    elements["flinks-connect-frame"].removeAttribute("src");
    elements["flinks-connect-status"].textContent = "";
  });
  window.addEventListener("message", handleFlinksConnectMessage);
  elements["bank-account-form"].addEventListener("submit", createBankAccount);
  elements["bank-import-form"].addEventListener("submit", previewBankImport);
  elements["commit-bank-import"].addEventListener("click", commitBankImport);
  elements["bank-category-form"].addEventListener("submit", categorizeBankTransaction);
  elements["bank-match-form"].addEventListener("submit", matchBankTransaction);
  elements["bank-transfer-form"].addEventListener("submit", createBankTransfer);
  elements["bank-rule-form"].addEventListener("submit", createBankRule);
  elements["bank-reconciliation-form"].addEventListener("submit", saveBankReconciliation);
}

export async function loadBanking() {
  if (!identity?.activeOrganizationId) return;
  const [accountResponse, transactionResponse] = await Promise.all([
    api("/v1/bank-accounts"),
    api("/v1/bank-transactions?limit=100")
  ]);
  await loadBankFeedPanel();
  // The connection boundary must remain understandable even when a newly-created
  // company has not completed the banking prerequisites yet. Do not let an
  // unrelated account/transaction response leave the secure-feed card blank.
  if (!accountResponse.ok || !transactionResponse.ok) {
    bankAccounts = [];
    setBankTransactions([]);
    renderBankFeedPanel();
    return;
  }
  bankAccounts = (await accountResponse.json()).bankAccounts;
  setBankTransactions((await transactionResponse.json()).transactions.items);
  elements["bank-accounts"].replaceChildren(
    ...bankAccounts.map((account) =>
      row([
        account.displayName,
        formatRole(account.accountKind),
        account.currency,
        account.maskedAccountReference,
        account.lastImportAt?.slice(0, 10) ?? "Never",
        account.lastReconciledAt?.slice(0, 10) ?? "Never"
      ])
    )
  );
  elements["bank-transactions"].replaceChildren(...bankTransactions.map(renderBankTransaction));
  const activeBankOptions = bankAccounts
    .filter((account) => account.isActive)
    .map((account) =>
      option(account.id, `${account.displayName} | ${account.maskedAccountReference}`)
    );
  for (const formId of ["bank-import-form", "bank-reconciliation-form"]) {
    elements[formId].elements.bankAccountId.replaceChildren(
      ...activeBankOptions.map((entry) => entry.cloneNode(true))
    );
  }
  elements["bank-feed-local-account"].replaceChildren(
    option(
      "",
      bankAccounts.some((account) => account.isActive)
        ? "Choose an account"
        : "Add a financial account first"
    ),
    ...activeBankOptions.map((entry) => entry.cloneNode(true))
  );
  for (const name of ["sourceBankAccountId", "destinationBankAccountId"])
    elements["bank-transfer-form"].elements[name].replaceChildren(
      ...activeBankOptions.map((entry) => entry.cloneNode(true))
    );
  const ledgerOptions = accounts
    .filter((account) => !account.isArchived)
    .map((account) => option(account.id, `${account.code} | ${account.name}`));
  elements["bank-account-form"].elements.linkedLedgerAccountId.replaceChildren(
    ...ledgerOptions.map((entry) => entry.cloneNode(true))
  );
  replaceCurrencyOptions(elements["bank-account-form"].elements.currency);
  for (const formId of ["bank-category-form", "bank-rule-form"])
    elements[formId].elements.accountId.replaceChildren(
      ...ledgerOptions.map((entry) => entry.cloneNode(true))
    );
  elements["bank-category-form"].elements.secondAccountId.replaceChildren(
    option("", "None"),
    ...ledgerOptions.map((entry) => entry.cloneNode(true))
  );
  renderBankFeedPanel();
  setDefaultBankDates();
  applySavedTableFilters();
  refreshContextualSearches();
}

export async function loadBankFeedPanel() {
  if (!identity?.activeOrganizationId) return;
  const [feedStatusResponse, feedResponse] = await Promise.all([
    api("/v1/bank-feeds/status"),
    api("/v1/bank-feeds")
  ]);
  bankFeedStatus = feedStatusResponse.ok ? (await feedStatusResponse.json()).bankFeeds : null;
  bankFeeds = feedResponse.ok ? (await feedResponse.json()).bankFeeds : [];
  renderBankFeedPanel();
}

function bankFeedManageable() {
  return activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT");
}

function renderBankFeedPanel() {
  const status = bankFeedStatus;
  const hasActiveAccount = bankAccounts.some((account) => account.isActive);
  const canManage = bankFeedManageable();
  const connectEnabled = status?.connectEnabled === true && hasActiveAccount && canManage;
  const connectButton = elements["bank-feed-connect"];

  connectButton.disabled = !connectEnabled;
  if (!status) {
    connectButton.textContent = "Connection unavailable";
    elements["bank-feed-status"].textContent =
      "PennyWise could not verify the connected-feed service. Manual statement imports remain available.";
    elements["bank-feed-boundary"].textContent =
      "CSV, OFX, and QFX uploads remain available while the connection service is checked.";
  } else if (!canManage) {
    connectButton.textContent = "Connect securely";
    elements["bank-feed-status"].textContent =
      "Only an owner, admin, or accountant can manage secure bank connections.";
    elements["bank-feed-boundary"].textContent = status.boundary;
  } else if (status.connectEnabled) {
    if (!hasActiveAccount) {
      connectButton.textContent = "Connect securely";
      elements["bank-feed-status"].textContent =
        "Add an active PennyWise bank or credit-card account before connecting a bank.";
      elements["bank-feed-boundary"].textContent = status.boundary;
    } else {
      const localTest = status.connectionFlow === "LOCAL_TEST";
      connectButton.textContent = localTest ? "Connect test bank" : "Connect securely";
      elements["bank-feed-status"].textContent = localTest
        ? "PennyWise test bank is ready. It creates simulated activity only; no financial institution or real account is connected."
        : `${formatConnectorStatus(status.providerKey)} ${formatConnectorStatus(status.environment)} connection is ready. Select an account, then use the bank's secure window.`;
      elements["bank-feed-boundary"].textContent = status.boundary;
    }
  } else {
    connectButton.textContent = "Connection unavailable";
    elements["bank-feed-status"].textContent =
      "Connected bank feeds are not enabled for this controlled beta.";
    elements["bank-feed-boundary"].textContent = status.boundary;
  }

  const container = elements["bank-feed-connections"];
  if (!bankFeeds.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = status?.connectEnabled
      ? "No secure bank connections yet. Connected activity will always be placed in Review and match activity."
      : "No secure bank connections are enabled. Import a CSV, OFX, or QFX statement to begin review.";
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(...bankFeeds.map(renderBankFeedConnection));
}

function renderBankFeedConnection(feed) {
  const article = document.createElement("article");
  article.className = "bank-feed-connection";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = feed.institutionName || formatConnectorStatus(feed.providerKey);
  const details = document.createElement("small");
  const mappedAccounts = feed.mappings
    .map((mapping) => {
      const source = `${mapping.displayName}${mapping.maskedAccountReference ? ` ${mapping.maskedAccountReference}` : ""}`;
      return `${mapping.bankAccount.displayName} <- ${source}`;
    })
    .join("; ");
  const lastSync = feed.lastSyncAt
    ? `Last refreshed ${formatConnectorTime(feed.lastSyncAt)}.`
    : "Not refreshed yet.";
  const syncDetail = feed.latestSync
    ? ` Latest import: ${formatConnectorStatus(feed.latestSync.status)}; ${feed.latestSync.addedCount} added, ${feed.latestSync.modifiedCount} observed, ${feed.latestSync.removedCount} removed.`
    : "";
  details.textContent = `${formatConnectorStatus(feed.status)}. ${mappedAccounts || "No account mappings."} ${lastSync}${syncDetail}${feed.lastError ? ` ${feed.lastError}` : ""}`;
  copy.append(title, details);

  const actions = document.createElement("div");
  actions.className = "bank-feed-actions";
  const canManage = bankFeedManageable() && bankFeedStatus?.connectEnabled === true;
  if (feed.status !== "DISCONNECTED") {
    const sync = commandButton("Sync now", () => syncBankFeed(feed.id));
    sync.disabled = !canManage || feed.status === "CONSENT_EXPIRED";
    actions.append(sync);
  }
  if (feed.status === "CONSENT_EXPIRED" || feed.status === "DEGRADED") {
    const reconnect = commandButton("Reconnect", () => startBankFeedConnection(feed.id));
    reconnect.disabled = !canManage;
    actions.append(reconnect);
  }
  if (feed.status !== "DISCONNECTED") {
    const disconnect = commandButton("Disconnect", () => disconnectBankFeed(feed));
    disconnect.disabled = !canManage;
    actions.append(disconnect);
  }
  article.append(copy, actions);
  return article;
}

async function startBankFeedConnection(bankFeedItemId = null) {
  if (bankFeedStatus?.connectEnabled !== true) {
    showNotice(bankFeedStatus?.boundary || "Connected bank feeds are not enabled.", true);
    return;
  }
  if (!bankFeedManageable()) {
    showNotice("Only an owner, admin, or accountant can manage secure bank connections.", true);
    return;
  }
  const selectedAccountId = elements["bank-feed-local-account"].value;
  if (!bankFeedItemId && !selectedAccountId) {
    showNotice("Choose the PennyWise financial account you want to connect first.", true);
    return;
  }
  const button = elements["bank-feed-connect"];
  button.disabled = true;
  try {
    const response = await api(
      "/v1/bank-feeds/link-token",
      jsonRequest(bankFeedItemId ? { bankFeedItemId } : {})
    );
    if (!response.ok) return showError(response);
    const { bankFeedLink } = await response.json();
    if (bankFeedLink.connectionFlow === "LOCAL_TEST") {
      openBankFeedMappingDialog({
        publicToken: bankFeedLink.linkToken,
        bankFeedItemId,
        defaultBankAccountId: selectedAccountId,
        localTest: true,
        providerAccounts: normalizeBankFeedTestAccounts(bankFeedLink.providerAccounts)
      });
      return;
    }
    if (bankFeedStatus?.providerKey === "FLINKS" && bankFeedLink.hostedUrl) {
      openFlinksConnect({
        hostedUrl: bankFeedLink.hostedUrl,
        bankFeedItemId,
        defaultBankAccountId: selectedAccountId
      });
      return;
    }
    const Plaid = await loadPlaidLinkLibrary();
    if (!Plaid?.create) {
      showNotice(
        "The secure bank window could not be loaded. Check the connection and try again.",
        true
      );
      return;
    }
    const link = Plaid.create({
      token: bankFeedLink.linkToken,
      onSuccess: (publicToken, metadata) => {
        openBankFeedMappingDialog({
          publicToken,
          bankFeedItemId,
          defaultBankAccountId: selectedAccountId,
          providerAccounts: normalizeBankFeedLinkAccounts(metadata?.accounts)
        });
      },
      onExit: (_error, metadata) => {
        if (!metadata?.status)
          showNotice("Secure bank connection closed before an account was selected.");
      }
    });
    link.open();
  } catch (error) {
    showNotice(
      error instanceof Error ? error.message : "The secure bank connection could not be started.",
      true
    );
  } finally {
    renderBankFeedPanel();
  }
}

function openFlinksConnect(connection) {
  let hostedUrl;
  try {
    hostedUrl = new URL(connection.hostedUrl);
  } catch {
    showNotice(
      "The secure bank window returned an invalid address. Try the connection again.",
      true
    );
    return;
  }
  if (hostedUrl.protocol !== "https:") {
    showNotice("The secure bank window must use HTTPS. Try the connection again.", true);
    return;
  }
  pendingFlinksConnect = {
    expectedOrigin: hostedUrl.origin,
    bankFeedItemId: connection.bankFeedItemId ?? null,
    defaultBankAccountId: connection.defaultBankAccountId ?? null,
    hostedUrl: hostedUrl.toString()
  };
  elements["flinks-connect-status"].textContent =
    "Complete the secure bank window. PennyWise will then ask you which account to map.";
  elements["flinks-connect-frame"].src = pendingFlinksConnect.hostedUrl;
  const dialog = elements["flinks-connect-dialog"];
  if (!dialog.open) dialog.showModal();
}

function handleFlinksConnectMessage(event) {
  const pending = pendingFlinksConnect;
  const frame = elements["flinks-connect-frame"];
  if (!pending || event.origin !== pending.expectedOrigin || event.source !== frame.contentWindow)
    return;
  const data = event.data;
  if (!data || typeof data !== "object" || typeof data.step !== "string") return;
  if (data.step === "TOKEN_INVALID") {
    void refreshFlinksConnect(pending);
    return;
  }
  if (data.step === "REDIRECT") {
    const loginId = flinksLoginIdFromEvent(data);
    if (!loginId) {
      elements["flinks-connect-status"].textContent =
        "The secure bank window completed without a usable connection. Start it again.";
      return;
    }
    void completeFlinksConnect(pending, loginId);
    return;
  }
  if (data.step === "COMPONENT_CLOSE_SESSION") {
    elements["flinks-connect-dialog"].close();
    showNotice("Secure bank connection closed before an account was selected.");
  }
}

function flinksLoginIdFromEvent(data) {
  if (typeof data.loginId === "string" && /^[a-z0-9._-]{1,200}$/i.test(data.loginId))
    return data.loginId;
  if (typeof data.url !== "string") return null;
  try {
    const url = new URL(data.url);
    const loginId = url.searchParams.get("loginId");
    return loginId && /^[a-z0-9._-]{1,200}$/i.test(loginId) ? loginId : null;
  } catch {
    return null;
  }
}

async function refreshFlinksConnect(pending) {
  elements["flinks-connect-status"].textContent =
    "The secure bank window expired. Refreshing it with a new short-lived authorizationâ€¦";
  const response = await api(
    "/v1/bank-feeds/link-token",
    jsonRequest(pending.bankFeedItemId ? { bankFeedItemId: pending.bankFeedItemId } : {})
  );
  if (!response.ok) {
    elements["flinks-connect-dialog"].close();
    return showError(response);
  }
  const { bankFeedLink } = await response.json();
  if (!bankFeedLink.hostedUrl || bankFeedStatus?.providerKey !== "FLINKS") {
    elements["flinks-connect-dialog"].close();
    showNotice("The secure bank window could not be refreshed. Start the connection again.", true);
    return;
  }
  openFlinksConnect({
    hostedUrl: bankFeedLink.hostedUrl,
    bankFeedItemId: pending.bankFeedItemId,
    defaultBankAccountId: pending.defaultBankAccountId
  });
}

async function completeFlinksConnect(pending, loginId) {
  elements["flinks-connect-status"].textContent =
    "Reading the selected account names securely so you can confirm the mappingâ€¦";
  const response = await api("/v1/bank-feeds/preview", jsonRequest({ publicToken: loginId }));
  if (!response.ok) return showError(response);
  const { bankFeedPreview } = await response.json();
  const providerAccounts = normalizeBankFeedTestAccounts(bankFeedPreview.providerAccounts);
  if (!providerAccounts.length) {
    elements["flinks-connect-status"].textContent =
      "The bank did not return a selectable CAD or USD account. Close the secure window and try again.";
    return;
  }
  pendingFlinksConnect = null;
  elements["flinks-connect-dialog"].close();
  openBankFeedMappingDialog({
    publicToken: loginId,
    bankFeedItemId: pending.bankFeedItemId,
    defaultBankAccountId: pending.defaultBankAccountId,
    localTest: false,
    providerAccounts
  });
}

function loadPlaidLinkLibrary() {
  if (globalThis.Plaid?.create) return Promise.resolve(globalThis.Plaid);
  if (plaidLinkScriptPromise) return plaidLinkScriptPromise;
  plaidLinkScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve(globalThis.Plaid);
    script.onerror = () => reject(new Error("The secure bank provider library did not load."));
    document.head.append(script);
  }).catch((error) => {
    plaidLinkScriptPromise = null;
    throw error;
  });
  return plaidLinkScriptPromise;
}

function normalizeBankFeedLinkAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  const seen = new Set();
  return accounts
    .map((account) => {
      const reference = String(account?.id || account?.account_id || "").trim();
      if (!reference || seen.has(reference)) return null;
      seen.add(reference);
      const name = String(
        account?.name || account?.official_name || "Selected bank account"
      ).trim();
      const mask = String(account?.mask || "").trim();
      return { reference, label: `${name}${mask ? ` | ****${mask}` : ""}` };
    })
    .filter(Boolean);
}

function normalizeBankFeedTestAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  const seen = new Set();
  return accounts
    .map((account) => {
      const reference = String(account?.providerAccountReference || "").trim();
      if (!reference || seen.has(reference)) return null;
      seen.add(reference);
      const name = String(account?.displayName || "PennyWise test account").trim();
      const mask = String(account?.maskedAccountReference || "").trim();
      const currency = String(account?.currency || "").trim();
      return {
        reference,
        label: `${name}${mask ? ` | ****${mask}` : ""}${currency ? ` | ${currency}` : ""}`
      };
    })
    .filter(Boolean);
}

function openBankFeedMappingDialog(connection) {
  if (!connection.publicToken || !connection.providerAccounts.length) {
    showNotice(
      "The bank did not return a selectable account. Close the secure window and try again.",
      true
    );
    return;
  }
  pendingBankFeedLink = connection;
  const form = elements["bank-feed-mapping-form"];
  const localAccount = form.elements.bankAccountId;
  localAccount.replaceChildren(
    option("", "Choose a PennyWise account"),
    ...bankAccounts
      .filter((account) => account.isActive)
      .map((account) =>
        option(account.id, `${account.displayName} | ${account.maskedAccountReference}`)
      )
  );
  if (connection.defaultBankAccountId) localAccount.value = connection.defaultBankAccountId;
  form.elements.providerAccountReference.replaceChildren(
    option(
      "",
      connection.localTest ? "Choose a simulated test account" : "Choose the bank account"
    ),
    ...connection.providerAccounts.map((account) => option(account.reference, account.label))
  );
  elements["bank-feed-mapping-status"].textContent = connection.localTest
    ? "Confirm the account pair. This uses simulated PennyWise test activity only; no financial institution is contacted."
    : "Confirm the account pair. PennyWise will exchange the short-lived authorization securely and retain only an encrypted provider token.";
  const dialog = elements["bank-feed-mapping-dialog"];
  if (!dialog.open) dialog.showModal();
}

async function completeBankFeedConnection(event) {
  event.preventDefault();
  const pending = pendingBankFeedLink;
  if (!pending?.publicToken) {
    showNotice("The bank authorization expired. Start the secure connection again.", true);
    return;
  }
  const form = event.currentTarget;
  const data = new FormData(form);
  const bankAccountId = String(data.get("bankAccountId") || "");
  const providerAccountReference = String(data.get("providerAccountReference") || "");
  if (!bankAccountId || !providerAccountReference) {
    elements["bank-feed-mapping-status"].textContent = "Choose both accounts before connecting.";
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  const publicToken = pending.publicToken;
  pendingBankFeedLink = null;
  try {
    const response = await api(
      "/v1/bank-feeds/connect",
      jsonRequest({
        publicToken,
        ...(pending.bankFeedItemId ? { bankFeedItemId: pending.bankFeedItemId } : {}),
        mappings: [{ bankAccountId, providerAccountReference }]
      })
    );
    if (!response.ok) {
      pendingBankFeedLink = null;
      return showError(response);
    }
    elements["bank-feed-mapping-dialog"].close();
    form.reset();
    await loadBanking();
    showNotice("Bank connection saved. Use Sync now to place activity in the review queue.");
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
}

async function syncBankFeed(bankFeedItemId) {
  const response = await api(`/v1/bank-feeds/${bankFeedItemId}/sync`, jsonRequest({}));
  if (!response.ok) return showError(response);
  const { bankFeedSync } = await response.json();
  await loadBanking();
  const sync = bankFeedSync.sync;
  const rules = bankFeedSync.ruleProcessing;
  const ruleSummary = rules?.enabled
    ? ` ${rules.automaticCategorizedCount} categorized by approved rules; ${rules.reviewRequiredCount} require review.`
    : " Review it before matching or reconciling.";
  showNotice(
    `Bank activity refreshed: ${sync.addedCount} added, ${sync.modifiedCount} observed, ${sync.removedCount} removed.${ruleSummary}`
  );
}

async function disconnectBankFeed(feed) {
  if (
    !globalThis.confirm(
      `Disconnect ${feed.institutionName || formatConnectorStatus(feed.providerKey)}? Activity already imported will remain as review evidence.`
    )
  )
    return;
  const response = await api(`/v1/bank-feeds/${feed.id}/disconnect`, jsonRequest({}));
  if (!response.ok) return showError(response);
  await loadBanking();
  showNotice("Bank connection removed. Existing review items were left unchanged.");
}

function renderBankTransaction(transaction) {
  const tr = document.createElement("tr");
  const clearCell = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.reconcileTransaction = transaction.id;
  checkbox.disabled = transaction.status === "UNMATCHED";
  checkbox.setAttribute("aria-label", `Clear ${transaction.description}`);
  clearCell.append(checkbox);
  tr.append(
    clearCell,
    cell(transaction.postingDate.slice(0, 10)),
    cell(transaction.description),
    cell(formatRole(transaction.direction)),
    cell(formatMinor(transaction.amountMinor)),
    cell(formatRole(transaction.status))
  );
  const actions = document.createElement("td");
  actions.append(commandButton("Review", () => reviewBankTransaction(transaction)));
  tr.append(actions);
  return tr;
}

async function reviewBankTransaction(transaction) {
  for (const formId of ["bank-category-form", "bank-match-form"]) {
    elements[formId].elements.transactionId.value = transaction.id;
    elements[formId].elements.version.value = transaction.version;
    elements[formId].elements.amountMinor.value = minorToInput(transaction.amountMinor);
  }
  const response = await api(`/v1/bank-transactions/${transaction.id}/match-suggestions`);
  if (response.ok) {
    const suggestions = (await response.json()).suggestions;
    const output = elements["bank-match-suggestions"];
    output.replaceChildren();
    output.append(
      document.createTextNode(
        suggestions.length
          ? suggestions
              .map(
                (item) =>
                  `${item.targetType} ${item.targetJournalId} for ${formatMinor(item.amountMinor)}: ${item.reasons.join(", ")}`
              )
              .join(" | ")
          : "No exact posted-transaction suggestions."
      )
    );
    if (transaction.direction === "CREDIT" && transaction.currency === "CAD") {
      const depositResponse = await api(
        `/v1/bank-transactions/${transaction.id}/invoice-deposit-suggestions`
      );
      if (depositResponse.ok) {
        const depositSuggestions = (await depositResponse.json()).suggestions ?? [];
        renderInvoiceDepositSuggestions(output, transaction, depositSuggestions);
      }
    }
  }
}

function renderInvoiceDepositSuggestions(output, transaction, suggestions) {
  const section = document.createElement("div");
  section.className = "bank-deposit-suggestions";
  const heading = document.createElement("strong");
  heading.textContent = "Possible e-Transfer invoice payments (review before posting)";
  section.append(document.createElement("br"), heading);
  if (!suggestions.length) {
    section.append(document.createTextNode(" No invoice reference or exact balance was found."));
    output.append(section);
    return;
  }
  for (const suggestion of suggestions.slice(0, 5)) {
    const row = document.createElement("div");
    const description = document.createElement("span");
    description.textContent = ` ${suggestion.confidence}: ${suggestion.invoiceIds.join(", ")} (${suggestion.reasons.join(", ")}) `;
    const remember = document.createElement("input");
    remember.type = "checkbox";
    remember.id = `remember-payer-${transaction.id}-${suggestion.invoiceIds.join("-")}`;
    const rememberLabel = document.createElement("label");
    rememberLabel.htmlFor = remember.id;
    rememberLabel.textContent = "remember sender";
    const confirm = commandButton("Confirm and post payment", async () => {
      if (!globalThis.confirm("Create the customer payment and match this bank deposit?")) return;
      confirm.disabled = true;
      const response = await api(
        `/v1/bank-transactions/${transaction.id}/confirm-invoice-deposit`,
        {
          ...jsonRequest({
            version: transaction.version,
            allocations: suggestion.invoiceIds.map((invoiceId, index) => ({
              invoiceId,
              amountMinor: suggestion.allocationAmountsMinor[index]
            })),
            rememberPayerAlias: remember.checked
          }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": globalThis.crypto.randomUUID()
          }
        }
      );
      if (!response.ok) {
        confirm.disabled = false;
        return showError(response);
      }
      showNotice("Payment posted and bank deposit matched to the selected invoice(s).");
      await loadBanking();
    });
    row.append(description, remember, rememberLabel, confirm);
    section.append(row);
  }
  output.append(section);
}

async function createBankAccount(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/bank-accounts",
    jsonRequest({
      displayName: data.get("displayName"),
      accountKind: data.get("accountKind"),
      maskedAccountReference: data.get("maskedAccountReference"),
      financialInstitutionName: data.get("financialInstitutionName") || null,
      currency: data.get("currency"),
      linkedLedgerAccountId: data.get("linkedLedgerAccountId"),
      openingDate: data.get("openingDate")
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadBanking();
  showNotice("Financial account added.");
}

async function previewBankImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const reviewButton = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const file = form.querySelector('input[name="statement"]')?.files?.[0];
  if (!(file instanceof globalThis.File) || !file.size) {
    showNotice("Choose a bank statement file to review.", true);
    return;
  }
  elements["bank-import-preview"].textContent = "Reading statement and checking for duplicates…";
  if (reviewButton) reviewButton.disabled = true;
  try {
    const response = await api(
      "/v1/bank-imports/preview",
      jsonRequest({
        bankAccountId: data.get("bankAccountId"),
        fileName: file.name,
        format: data.get("format"),
        contentBase64: await readFileAsBase64(file)
      })
    );
    if (!response.ok) return await showError(response);
    const result = await response.json();
    pendingBankImport = result.batch;
    elements["bank-import-preview"].textContent =
      `${result.rows.length} transactions ready to review; ${result.batch.probableDuplicates} possible duplicates need attention.`;
    elements["commit-bank-import"].disabled = result.batch.status !== "PREVIEWED";
  } catch {
    elements["bank-import-preview"].textContent =
      "The statement could not be read. Choose the file again and retry.";
  } finally {
    if (reviewButton) reviewButton.disabled = false;
  }
}

async function commitBankImport() {
  if (!pendingBankImport) return;
  const response = await api(`/v1/bank-imports/${pendingBankImport.id}/commit`, {
    ...jsonRequest({ version: pendingBankImport.version }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  pendingBankImport = null;
  elements["commit-bank-import"].disabled = true;
  elements["bank-import-preview"].textContent = "Reviewed transactions added to banking.";
  trackProductEvent("BANK_IMPORT_COMPLETED");
  await loadBanking();
}

async function categorizeBankTransaction(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amountMinor = moneyFromForm(data, "amountMinor");
  const secondAmountMinor = data.get("secondAmountMinor")
    ? moneyFromForm(data, "secondAmountMinor")
    : null;
  if (amountMinor === null || (data.get("secondAmountMinor") && secondAmountMinor === null)) return;
  const lines = [
    {
      accountId: data.get("accountId"),
      amountMinor,
      memo: data.get("memo") || null
    }
  ];
  if (data.get("secondAccountId") && secondAmountMinor !== null)
    lines.push({
      accountId: data.get("secondAccountId"),
      amountMinor: secondAmountMinor,
      memo: data.get("memo") || null
    });
  const response = await api(`/v1/bank-transactions/${data.get("transactionId")}/categorize`, {
    ...jsonRequest({ version: Number(data.get("version")), lines }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadBanking();
  showNotice("Bank transaction categorized and posted.");
}

async function matchBankTransaction(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amountMinor = moneyFromForm(data, "amountMinor");
  if (amountMinor === null) return;
  const response = await api(`/v1/bank-transactions/${data.get("transactionId")}/matches`, {
    ...jsonRequest({
      version: Number(data.get("version")),
      matches: [
        {
          targetJournalId: data.get("targetJournalId"),
          targetType: data.get("targetType"),
          targetId: data.get("targetId"),
          amountMinor,
          reasons: ["user-confirmed"]
        }
      ]
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadBanking();
  showNotice("Posted transaction matched without creating another journal.");
}

async function createBankTransfer(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amountMinor = moneyFromForm(data, "amountMinor");
  if (amountMinor === null) return;
  const response = await api("/v1/bank-transfers", {
    ...jsonRequest({
      sourceBankAccountId: data.get("sourceBankAccountId"),
      destinationBankAccountId: data.get("destinationBankAccountId"),
      transferDate: data.get("transferDate"),
      amountMinor,
      reference: data.get("reference") || null
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadBanking();
  showNotice("Transfer posted.");
}

async function createBankRule(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/bank-rules",
    jsonRequest({
      name: data.get("name"),
      priority: Number(data.get("priority")),
      descriptionContains: data.get("descriptionContains"),
      suggestion: { accountId: data.get("accountId") }
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  showNotice("Advisory bank rule saved.");
}

async function saveBankReconciliation(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const openingStatementBalanceMinor = moneyFromForm(data, "openingStatementBalanceMinor");
  const closingStatementBalanceMinor = moneyFromForm(data, "closingStatementBalanceMinor");
  if (openingStatementBalanceMinor === null || closingStatementBalanceMinor === null) return;
  const importedTransactionIds = [
    ...document.querySelectorAll("[data-reconcile-transaction]:checked")
  ].map((checkbox) => checkbox.dataset.reconcileTransaction);
  const response = await api(
    "/v1/bank-reconciliations",
    jsonRequest({
      bankAccountId: data.get("bankAccountId"),
      statementStartDate: data.get("statementStartDate"),
      statementEndDate: data.get("statementEndDate"),
      openingStatementBalanceMinor,
      closingStatementBalanceMinor,
      importedTransactionIds
    })
  );
  if (!response.ok) return showError(response);
  setCurrentReconciliation((await response.json()).reconciliation);
  elements["bank-reconciliation-summary"].textContent =
    `Calculated ${formatMinor(currentReconciliation.calculatedClosingBalanceMinor)}; difference ${formatMinor(currentReconciliation.differenceMinor)}.`;
  elements["complete-bank-reconciliation"].disabled = currentReconciliation.differenceMinor !== "0";
  showNotice("Reconciliation saved.");
}

function setDefaultBankDates() {
  const today = new Date().toISOString().slice(0, 10);
  for (const [formId, field] of [
    ["bank-account-form", "openingDate"],
    ["bank-transfer-form", "transferDate"]
  ])
    if (!elements[formId].elements[field].value) elements[formId].elements[field].value = today;
}
