// Tax centre and accountant tools (the classic `accountant-workspace`).

import { formatMinor, minorToInput, parseMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { completeContextualCreation } from "../lib/contextual-creation.js";
import { renderRevaluationRateControls } from "../lib/currency-controls.js";
import { commandButton, option, row } from "../lib/dom.js";
import { applySavedTableFilters } from "../lib/forms.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import {
  loadAccounts,
  loadReports,
  loadSales,
  refreshSetupState,
  registerWorkspaceCalls
} from "../lib/workspace-calls.js";
import { navigateTo } from "../shell.js";
import {
  accounts,
  contextualCreationState,
  elements,
  multiCurrencyState,
  setup
} from "../state.js";

let manualJournalDrafts = [];
let activeManualJournalDraftId = null;
const MANUAL_JOURNAL_MAX_LINES = 500;
let fxRevaluationPreview = null;
// ---------------------------------------------------------------------------
// Sales tax code configuration
//
// PennyWise's tax engine already supports what a Canadian seller needs: a code
// holds one component per authority, each component carries a jurisdiction and
// its own payable account, and the invoice journal credits each component to
// that account (invoice-service.ts) and refuses to post if one is missing. None
// of it was reachable — POST /v1/setup/tax-codes/versions had no screen, so
// "GST to the federal account, PST to the provincial one" could not be
// expressed, and every provincial remittance was blocked behind that.
//
// This screen collects rates from the operator. It ships no rate table on
// purpose: rates change, and a stale hardcoded rate posted to a customer invoice
// is a liability. The API requires a source and a retrieval date, and so does
// this form.
// ---------------------------------------------------------------------------

let taxCodeComponentSeq = 0;

registerWorkspaceCalls({ refreshTaxCodeComponentAccounts, renderTaxCodeList });

export function initTaxes() {
  elements["tax-code-form"]?.addEventListener("submit", saveTaxCodeVersion);
  elements["open-accountant-for-remittance"]?.addEventListener("click", () =>
    navigateTo("accountant-workspace")
  );
  elements["tax-code-add-component"]?.addEventListener("click", () => addTaxCodeComponentRow());
  elements["tax-code-treatment"]?.addEventListener("change", renderTaxCodePreview);
  elements["refresh-accountant"].addEventListener("click", loadAccountant);
  elements["fx-revaluation-form"].addEventListener("submit", previewFxRevaluation);
  elements["fx-revaluation-form"].elements.valuationDate.addEventListener(
    "change",
    renderRevaluationRateControls
  );
  elements["post-fx-revaluation"].addEventListener("click", postFxRevaluation);
  elements["manual-journal-form"].addEventListener("submit", createManualJournalDraft);
  elements["cancel-manual-journal-edit"].addEventListener("click", resetManualJournalForm);
  elements["add-manual-journal-line"].addEventListener("click", () => appendManualJournalLine());
  elements["manual-journal-lines"].addEventListener("input", updateManualJournalTotals);
  elements["manual-journal-lines"].addEventListener("click", removeManualJournalLine);
  renderManualJournalLines();
  elements["journal-trace-form"].addEventListener("submit", traceJournal);
  elements["audit-filter-form"].addEventListener("submit", loadAuditEvents);
  elements["export-audit"].addEventListener("click", exportAudit);
}

async function previewFxRevaluation(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const valuationDate = data.get("valuationDate");
  const rateSnapshotId = data.get("rateSnapshotId");
  if (!valuationDate) return showNotice("Choose a valuation date.", true);
  if (!rateSnapshotId)
    return showNotice("Choose a closing rate recorded for the valuation date.", true);
  const response = await api(
    "/v1/accounting/fx-revaluation/preview",
    jsonRequest({ valuationDate, rateSnapshotIds: [rateSnapshotId], post: false }, "POST")
  );
  if (!response.ok) return showError(response);
  fxRevaluationPreview = (await response.json()).preview;
  elements["fx-revaluation-result"].textContent = fxRevaluationPreview.positions.length
    ? `${fxRevaluationPreview.positions.length} position(s): gains ${formatMinor(fxRevaluationPreview.totalUnrealizedGainMinor, fxRevaluationPreview.baseCurrency)}, losses ${formatMinor(fxRevaluationPreview.totalUnrealizedLossMinor, fxRevaluationPreview.baseCurrency)}. ${fxRevaluationPreview.readyToPost ? "Ready to post." : `Missing: ${[...fxRevaluationPreview.missingAccounts, ...fxRevaluationPreview.missingRates].join(", ")}.`}`
    : "No active foreign monetary positions require revaluation.";
  elements["fx-revaluation-rows"].replaceChildren(
    ...fxRevaluationPreview.positions.map((position) =>
      row([
        position.currency,
        formatMinor(position.carryingBaseMinor, fxRevaluationPreview.baseCurrency),
        formatMinor(position.deltaBaseMinor, fxRevaluationPreview.baseCurrency),
        position.gainLoss
      ])
    )
  );
  elements["post-fx-revaluation"].disabled = !fxRevaluationPreview.readyToPost;
}

async function postFxRevaluation() {
  if (!fxRevaluationPreview) return;
  const response = await api(
    "/v1/accounting/fx-revaluation/post",
    jsonRequest(
      {
        valuationDate: fxRevaluationPreview.valuationDate,
        rateSnapshotIds: [
          ...new Set(fxRevaluationPreview.positions.map((position) => position.rateSnapshotId))
        ],
        post: true
      },
      "POST"
    )
  );
  if (!response.ok) return showError(response);
  elements["post-fx-revaluation"].disabled = true;
  await Promise.all([loadAccountant(), loadReports()]);
  showNotice("FX revaluation posted with an automatic next-period reversal.");
}

function renderFxOverview(fx) {
  const baseCurrency = multiCurrencyState?.baseCurrency ?? "CAD";
  elements["fx-position-rows"].replaceChildren(
    ...fx.positions
      .filter((position) => position.active)
      .map((position) =>
        row([
          formatRole(position.kind),
          position.currency,
          formatMinor(position.outstandingTransactionMinor, position.currency),
          formatMinor(position.carryingBaseMinor, baseCurrency),
          position.asOfDate
        ])
      )
  );
}

export async function loadAccountant() {
  const asOf =
    elements["report-filter-form"].elements.asOf.value || new Date().toISOString().slice(0, 10);
  const [draftsResponse, periodsResponse, queueResponse, fxResponse] = await Promise.all([
    api("/v1/accountant/manual-journals"),
    api("/v1/fiscal-periods"),
    api(`/v1/accountant/review-queue?asOf=${encodeURIComponent(asOf)}`),
    api("/v1/accounting/fx-overview")
  ]);
  if (draftsResponse.status === 403) {
    elements["accountant-workspace"].hidden = true;
    return;
  }
  if (!draftsResponse.ok) return showError(draftsResponse);
  if (!periodsResponse.ok) return showError(periodsResponse);
  if (!queueResponse.ok) return showError(queueResponse);
  const drafts = (await draftsResponse.json()).drafts;
  manualJournalDrafts = drafts;
  const periods = (await periodsResponse.json()).periods;
  const queue = (await queueResponse.json()).queue;
  if (fxResponse.ok) renderFxOverview((await fxResponse.json()).fx);
  if (!accounts.length) await loadAccounts();
  refreshManualJournalAccountOptions();
  if (!elements["manual-journal-form"].elements.effectiveDate.value)
    elements["manual-journal-form"].elements.effectiveDate.value = asOf;
  elements["manual-journal-drafts"].replaceChildren(
    ...drafts.map((draft) => {
      const actions = document.createElement("div");
      actions.className = "table-command-group";
      if (draft.accountingBoundary?.editable) {
        actions.append(commandButton("Edit", () => editManualJournalDraft(draft)));
        actions.append(commandButton("Cancel", () => cancelManualJournalDraft(draft)));
      }
      const post = document.createElement("button");
      post.type = "button";
      post.textContent = "Post to ledger";
      post.title = "Create one authoritative journal from this reviewed workpaper";
      post.disabled = draft.status !== "DRAFT";
      post.addEventListener("click", () => postManualJournalDraft(draft, post));
      actions.append(post);
      return row([
        draft.effectiveDate.slice(0, 10),
        draft.description,
        draft.accountingBoundary?.authoritative
          ? `${formatRole(draft.status)} · Authoritative`
          : `${formatRole(draft.status)} · Non-posting workpaper`,
        actions
      ]);
    })
  );
  elements["accountant-periods"].replaceChildren(
    ...(await Promise.all(
      periods.map(async (period) => {
        const previewResponse = await api(`/v1/fiscal-periods/${period.id}/close-preview`);
        const checklist = previewResponse.ok ? (await previewResponse.json()).checklist : null;
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = period.status === "CLOSED" ? "Reopen" : "Close";
        action.addEventListener("click", () => changePeriodStatus(period, checklist));
        return row([
          `${period.name} (${period.startDate.slice(0, 10)} to ${period.endDate.slice(0, 10)})`,
          formatRole(period.status),
          checklist
            ? checklist.clean
              ? "Clean"
              : `${checklist.warnings.length} warning(s)`
            : "Unavailable",
          action
        ]);
      })
    ))
  );
  elements["accountant-review-items"].replaceChildren(
    ...queue.items.map((item) => {
      const action = document.createElement("button");
      action.type = "button";
      action.textContent = "Dismiss";
      action.addEventListener("click", () => dismissReviewItem(item));
      return row([
        formatRole(item.category),
        item.explanation,
        `${item.targetType} ${item.targetId ?? ""}`,
        action
      ]);
    })
  );
  await loadAuditEvents();
  applySavedTableFilters();
}

async function createManualJournalDraft(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const lines = manualJournalLinesFromEditor();
  if (!lines) return;
  const draftId = String(data.get("draftId") ?? "");
  const versionValue = String(data.get("version") ?? "");
  const payload = {
    description: data.get("description"),
    effectiveDate: data.get("effectiveDate"),
    reason: data.get("reason"),
    allowControlAccountPosting: data.get("allowControlAccountPosting") === "on",
    lines,
    ...(draftId ? { version: Number(versionValue) } : {})
  };
  const response = await api(
    draftId ? `/v1/accountant/manual-journals/${draftId}` : "/v1/accountant/manual-journals",
    jsonRequest(payload, draftId ? "PATCH" : "POST")
  );
  if (!response.ok) {
    if (response.status === 409) {
      await loadAccountant();
      const latest = manualJournalDrafts.find((draft) => draft.id === draftId);
      if (latest?.accountingBoundary?.editable) editManualJournalDraft(latest, false);
      return showNotice(
        "This workpaper changed in another session. The latest version has been reloaded; review it before saving.",
        true
      );
    }
    return showError(response);
  }
  resetManualJournalForm();
  await loadAccountant();
  showNotice(
    draftId
      ? "Workpaper updated in place. No ledger entry was created."
      : "Non-posting workpaper created for review."
  );
}

function manualJournalEditorValues() {
  return [...elements["manual-journal-lines"].querySelectorAll(".manual-journal-line")].map(
    (line) => ({
      accountId: line.querySelector('[data-manual-journal-field="accountId"]').value,
      description: line.querySelector('[data-manual-journal-field="description"]').value,
      debitValue: line.querySelector('[data-manual-journal-field="debitMinor"]').value,
      creditValue: line.querySelector('[data-manual-journal-field="creditMinor"]').value
    })
  );
}

function manualJournalAccountOptions(selectedAccountId = "") {
  const available = accounts.filter((account) => !account.isArchived);
  const selected = accounts.find((account) => account.id === selectedAccountId);
  const selectedIsAvailable = available.some((account) => account.id === selectedAccountId);
  return [
    option("", "Choose account"),
    ...available.map((account) => option(account.id, `${account.code} ${account.name}`)),
    ...(selectedAccountId && !selectedIsAvailable
      ? [
          option(
            selectedAccountId,
            selected
              ? `${selected.code} ${selected.name} (archived - choose another)`
              : "Unavailable account (choose another)"
          )
        ]
      : [])
  ];
}

function renderManualJournalLine(line, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "manual-journal-line";
  wrapper.setAttribute("role", "listitem");
  wrapper.setAttribute("aria-label", `Journal line ${index + 1}`);

  const lineNumber = document.createElement("strong");
  lineNumber.className = "manual-journal-line-number";
  lineNumber.textContent = String(index + 1);
  lineNumber.setAttribute("aria-hidden", "true");

  const accountLabel = document.createElement("label");
  accountLabel.className = "manual-journal-line-account";
  const accountLabelText = document.createElement("span");
  accountLabelText.textContent = "Account";
  const account = document.createElement("select");
  account.required = true;
  account.dataset.manualJournalField = "accountId";
  account.setAttribute("aria-label", `Account for journal line ${index + 1}`);
  account.replaceChildren(...manualJournalAccountOptions(line.accountId));
  account.value = line.accountId || "";
  accountLabel.append(accountLabelText, account);

  const descriptionLabel = document.createElement("label");
  descriptionLabel.className = "manual-journal-line-description";
  const descriptionLabelText = document.createElement("span");
  descriptionLabelText.textContent = "Line description";
  const description = document.createElement("input");
  description.maxLength = 500;
  description.value = line.description || "";
  description.dataset.manualJournalField = "description";
  description.setAttribute("aria-label", `Description for journal line ${index + 1}`);
  descriptionLabel.append(descriptionLabelText, description);

  const debitLabel = document.createElement("label");
  debitLabel.className = "manual-journal-line-debit";
  const debitLabelText = document.createElement("span");
  debitLabelText.textContent = "Debit";
  const debit = document.createElement("input");
  debit.inputMode = "decimal";
  debit.placeholder = "0.00";
  debit.value = line.debitValue || "";
  debit.dataset.manualJournalField = "debitMinor";
  debit.setAttribute("aria-label", `Debit for journal line ${index + 1}`);
  debitLabel.append(debitLabelText, debit);

  const creditLabel = document.createElement("label");
  creditLabel.className = "manual-journal-line-credit";
  const creditLabelText = document.createElement("span");
  creditLabelText.textContent = "Credit";
  const credit = document.createElement("input");
  credit.inputMode = "decimal";
  credit.placeholder = "0.00";
  credit.value = line.creditValue || "";
  credit.dataset.manualJournalField = "creditMinor";
  credit.setAttribute("aria-label", `Credit for journal line ${index + 1}`);
  creditLabel.append(creditLabelText, credit);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-command manual-journal-line-remove";
  remove.dataset.manualJournalAction = "remove";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove journal line ${index + 1}`);

  wrapper.append(lineNumber, accountLabel, descriptionLabel, debitLabel, creditLabel, remove);
  return wrapper;
}

function renderManualJournalLines(
  lines = [
    { accountId: "", description: "", debitValue: "", creditValue: "" },
    { accountId: "", description: "", debitValue: "", creditValue: "" }
  ]
) {
  const normalized =
    lines.length >= 2 ? lines : [...lines, ...Array.from({ length: 2 - lines.length }, () => ({}))];
  elements["manual-journal-lines"].replaceChildren(
    ...normalized.map((line, index) => renderManualJournalLine(line, index))
  );
  const canRemove = normalized.length > 2;
  for (const button of elements["manual-journal-lines"].querySelectorAll(
    '[data-manual-journal-action="remove"]'
  ))
    button.disabled = !canRemove;
  elements["add-manual-journal-line"].disabled = normalized.length >= MANUAL_JOURNAL_MAX_LINES;
  updateManualJournalTotals();
}

function appendManualJournalLine(line = {}) {
  const lines = manualJournalEditorValues();
  if (lines.length >= MANUAL_JOURNAL_MAX_LINES)
    return showNotice(
      `A manual journal workpaper can contain at most ${MANUAL_JOURNAL_MAX_LINES} lines.`,
      true
    );
  renderManualJournalLines([...lines, line]);
  const added = elements["manual-journal-lines"].lastElementChild;
  added?.querySelector("select")?.focus();
}

function removeManualJournalLine(event) {
  const button = event.target.closest('[data-manual-journal-action="remove"]');
  if (!button) return;
  const lines = manualJournalEditorValues();
  if (lines.length <= 2)
    return showNotice("A manual journal workpaper requires at least two lines.", true);
  const index = [...elements["manual-journal-lines"].children].indexOf(
    button.closest(".manual-journal-line")
  );
  if (index < 0) return;
  lines.splice(index, 1);
  renderManualJournalLines(lines);
}

function refreshManualJournalAccountOptions() {
  for (const select of elements["manual-journal-lines"].querySelectorAll(
    '[data-manual-journal-field="accountId"]'
  )) {
    const selected = select.value;
    select.replaceChildren(...manualJournalAccountOptions(selected));
    select.value = selected;
  }
}

function updateManualJournalTotals() {
  let debits = 0n;
  let credits = 0n;
  let valid = true;
  let lineSidesValid = true;
  for (const line of manualJournalEditorValues()) {
    try {
      const debit = BigInt(parseMoneyInput(line.debitValue || "0"));
      const credit = BigInt(parseMoneyInput(line.creditValue || "0"));
      debits += debit;
      credits += credit;
      if ((debit === 0n && credit === 0n) || (debit > 0n && credit > 0n)) lineSidesValid = false;
    } catch {
      valid = false;
    }
  }
  const currency = multiCurrencyState?.baseCurrency ?? "CAD";
  elements["manual-journal-debit-total"].textContent = valid
    ? formatMinor(debits.toString(), currency)
    : "Check amounts";
  elements["manual-journal-credit-total"].textContent = valid
    ? formatMinor(credits.toString(), currency)
    : "Check amounts";
  elements["manual-journal-difference"].textContent = valid
    ? formatMinor((debits >= credits ? debits - credits : credits - debits).toString(), currency)
    : "Check amounts";
  const fieldset = elements["manual-journal-lines"].closest("fieldset");
  const balanced = valid && lineSidesValid && debits > 0n && debits === credits;
  fieldset?.classList.toggle("is-balanced", balanced);
  fieldset?.classList.toggle("is-unbalanced", !balanced);
  const status = elements["manual-journal-balance-status"];
  if (!valid) status.textContent = "Enter amounts with no more than two decimal places.";
  else if (!lineSidesValid)
    status.textContent = "Each line needs either one debit or one credit amount.";
  else if (debits > credits)
    status.textContent = `${formatMinor(debits - credits, currency)} more credits are needed.`;
  else if (credits > debits)
    status.textContent = `${formatMinor(credits - debits, currency)} more debits are needed.`;
  else if (balanced)
    status.textContent = `Balanced at ${formatMinor(debits, currency)}. Still non-posting.`;
  else status.textContent = "Add at least two balanced lines.";
}

function manualJournalLinesFromEditor() {
  const values = manualJournalEditorValues();
  if (values.length < 2) {
    showNotice("A manual journal workpaper requires at least two lines.", true);
    return null;
  }
  if (values.length > MANUAL_JOURNAL_MAX_LINES) {
    showNotice(
      `A manual journal workpaper can contain at most ${MANUAL_JOURNAL_MAX_LINES} lines.`,
      true
    );
    return null;
  }
  const lines = [];
  let totalDebits = 0n;
  let totalCredits = 0n;
  for (const [index, line] of values.entries()) {
    if (!line.accountId) {
      showNotice(`Choose an account for journal line ${index + 1}.`, true);
      elements["manual-journal-lines"].children[index]
        ?.querySelector('[data-manual-journal-field="accountId"]')
        ?.focus();
      return null;
    }
    let debitMinor;
    let creditMinor;
    try {
      debitMinor = parseMoneyInput(line.debitValue || "0");
      creditMinor = parseMoneyInput(line.creditValue || "0");
    } catch (error) {
      showNotice(
        `Journal line ${index + 1}: ${error instanceof Error ? error.message : "Enter a valid amount."}`,
        true
      );
      elements["manual-journal-lines"].children[index]
        ?.querySelector('[data-manual-journal-field="debitMinor"]')
        ?.focus();
      return null;
    }
    const debit = BigInt(debitMinor);
    const credit = BigInt(creditMinor);
    if ((debit === 0n && credit === 0n) || (debit > 0n && credit > 0n)) {
      showNotice(`Journal line ${index + 1} must contain either one debit or one credit.`, true);
      return null;
    }
    totalDebits += debit;
    totalCredits += credit;
    lines.push({
      accountId: line.accountId,
      ...(line.description.trim() ? { description: line.description.trim() } : {}),
      debitMinor,
      creditMinor
    });
  }
  if (totalDebits !== totalCredits) {
    const currency = multiCurrencyState?.baseCurrency ?? "CAD";
    showNotice(
      `Debits (${formatMinor(totalDebits, currency)}) must equal credits (${formatMinor(totalCredits, currency)}) before saving.`,
      true
    );
    return null;
  }
  return lines;
}

function editManualJournalDraft(draft, scroll = true) {
  const form = elements["manual-journal-form"];
  activeManualJournalDraftId = draft.id;
  form.elements.draftId.value = draft.id;
  form.elements.version.value = String(draft.version);
  form.elements.description.value = draft.description;
  form.elements.effectiveDate.value = draft.effectiveDate.slice(0, 10);
  form.elements.reason.value = draft.reason;
  form.elements.allowControlAccountPosting.checked = draft.allowControlAccountPosting;
  renderManualJournalLines(
    draft.lines.map((line) => ({
      accountId: line.accountId,
      description: line.description ?? "",
      debitValue: BigInt(line.debitMinor) === 0n ? "" : minorToInput(line.debitMinor),
      creditValue: BigInt(line.creditMinor) === 0n ? "" : minorToInput(line.creditMinor)
    }))
  );
  elements["manual-journal-form-heading"].textContent = "Edit manual journal workpaper";
  elements["save-manual-journal-draft"].textContent = "Save workpaper";
  elements["cancel-manual-journal-edit"].hidden = false;
  if (scroll)
    elements["manual-journal-form-heading"].scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "start"
    });
}

function resetManualJournalForm() {
  const form = elements["manual-journal-form"];
  form.reset();
  activeManualJournalDraftId = null;
  form.elements.draftId.value = "";
  form.elements.version.value = "";
  form.elements.effectiveDate.value =
    elements["report-filter-form"].elements.asOf.value || new Date().toISOString().slice(0, 10);
  renderManualJournalLines();
  elements["manual-journal-form-heading"].textContent = "Manual journal workpaper";
  elements["save-manual-journal-draft"].textContent = "Create workpaper";
  elements["cancel-manual-journal-edit"].hidden = true;
}

async function cancelManualJournalDraft(draft) {
  if (
    !window.confirm(
      `Cancel the non-posting workpaper “${draft.description}”? Its audit history will be retained.`
    )
  )
    return;
  const response = await api(
    `/v1/accountant/manual-journals/${draft.id}/cancel`,
    jsonRequest({ version: draft.version })
  );
  if (!response.ok) {
    if (response.status === 409) {
      await loadAccountant();
      return showNotice(
        "This workpaper changed in another session. The latest version is shown.",
        true
      );
    }
    return showError(response);
  }
  if (activeManualJournalDraftId === draft.id) resetManualJournalForm();
  await loadAccountant();
  showNotice("Workpaper cancelled without creating a ledger entry.");
}

async function postManualJournalDraft(draft, button) {
  if (
    !window.confirm(
      `Post “${draft.description}” once? This creates an authoritative journal that cannot be edited or cancelled.`
    )
  )
    return;
  button.disabled = true;
  button.textContent = "Posting…";
  const response = await api(`/v1/accountant/manual-journals/${draft.id}/post`, {
    ...jsonRequest({ version: draft.version }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) {
    button.disabled = false;
    button.textContent = "Post to ledger";
    if (response.status === 409) {
      await loadAccountant();
      return showNotice(
        "This workpaper changed in another session. The latest version is shown; review it before posting.",
        true
      );
    }
    return showError(response);
  }
  if (activeManualJournalDraftId === draft.id) resetManualJournalForm();
  await Promise.all([loadAccountant(), loadReports()]);
  showNotice("Manual journal posted once. The workpaper is now authoritative and read-only.");
}

async function changePeriodStatus(period, checklist) {
  const reason = window.prompt(
    `Reason to ${period.status === "CLOSED" ? "reopen" : "close"} this period:`
  );
  if (!reason?.trim()) return;
  const closing = period.status !== "CLOSED";
  const acknowledgeWarnings =
    closing && checklist && !checklist.clean
      ? window.confirm("This period has review warnings. Close after acknowledging them?")
      : false;
  if (closing && checklist && !checklist.clean && !acknowledgeWarnings) return;
  const response = await api(
    `/v1/fiscal-periods/${period.id}/${closing ? "close" : "reopen"}`,
    jsonRequest({ reason, ...(closing ? { acknowledgeWarnings } : {}) })
  );
  if (!response.ok) return showError(response);
  await loadAccountant();
  showNotice(`Fiscal period ${closing ? "closed" : "reopened"}.`);
}

async function dismissReviewItem(item) {
  const reason = window.prompt("Reason for dismissing this review item:");
  if (!reason?.trim()) return;
  const response = await api(
    "/v1/accountant/review-queue/dismiss",
    jsonRequest({
      fingerprint: item.fingerprint,
      category: item.category,
      reason,
      asOf:
        elements["report-filter-form"].elements.asOf.value || new Date().toISOString().slice(0, 10)
    })
  );
  if (!response.ok) return showError(response);
  await loadAccountant();
  showNotice("Review item dismissed with audit evidence.");
}

async function traceJournal(event) {
  event.preventDefault();
  const journalId = new FormData(event.currentTarget).get("journalId");
  const [traceResponse, guideResponse] = await Promise.all([
    api(`/v1/accountant/journals/${encodeURIComponent(journalId)}/trace`),
    api(`/v1/accountant/journals/${encodeURIComponent(journalId)}/correction-guide`)
  ]);
  if (!traceResponse.ok) return showError(traceResponse);
  if (!guideResponse.ok) return showError(guideResponse);
  const trace = (await traceResponse.json()).trace;
  const guidance = (await guideResponse.json()).guidance;
  elements["journal-trace-result"].textContent =
    `Source: ${trace.source.type} ${trace.source.id}. ${guidance.strategy}`;
}

async function loadAuditEvents(event) {
  event?.preventDefault();
  const action = elements["audit-filter-form"].elements.action.value;
  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  if (action) query.set("action", action);
  const response = await api(`/v1/accountant/audit-events?${query}`);
  if (!response.ok) return;
  const audit = (await response.json()).audit;
  elements["audit-events"].replaceChildren(
    ...audit.events.map((entry) =>
      row([
        entry.createdAt,
        entry.actor?.displayName ?? entry.actor?.email ?? "System",
        entry.action,
        `${entry.targetType} ${entry.targetId ?? ""}`
      ])
    )
  );
}

function exportAudit() {
  const action = elements["audit-filter-form"].elements.action.value;
  const query = new URLSearchParams({ page: "1", pageSize: "100" });
  if (action) query.set("action", action);
  window.location.assign(`/api/v1/accountant/audit-events.csv?${query}`);
}

function taxParagraph(text, className) {
  const paragraph = document.createElement("p");
  if (className) paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

// The API takes a rate as a decimal string in 0..1 with up to six places, while
// operators think in percent. Convert by shifting the decimal point two places
// on the string itself — never with a float, because 9.975 / 100 is not exactly
// 0.09975 in binary floating point and a tax rate must be exact.
function taxPercentToRate(input) {
  const text = String(input ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const pointFromRight = fraction.length + 2;
  const padded = digits.padStart(pointFromRight + 1, "0");
  const cut = padded.length - pointFromRight;
  const result = `${padded.slice(0, cut)}.${padded.slice(cut)}`
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const normalized = result.startsWith(".") ? `0${result}` : result;
  if (!/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/.test(normalized)) return null;
  return normalized;
}

function taxRateToPercent(rate) {
  const text = String(rate ?? "0");
  const [whole, fraction = ""] = text.split(".");
  const digits = `${whole}${fraction}`;
  const pointFromRight = Math.max(fraction.length - 2, 0);
  const padded = digits.padStart(pointFromRight + 1, "0");
  const cut = padded.length - pointFromRight;
  const shifted = pointFromRight
    ? `${padded.slice(0, cut)}.${padded.slice(cut)}`
    : `${padded}${"0".repeat(2 - fraction.length)}`;
  return shifted.replace(/^0+(?=\d)/, "").replace(/\.?0+$/, "") || "0";
}

function taxCodeAccountOptions(select, selectedId, types) {
  const choices = accounts.filter((account) => !account.isArchived && types.includes(account.type));
  select.replaceChildren(
    ...[
      Object.assign(document.createElement("option"), {
        value: "",
        textContent: "Choose an account"
      })
    ],
    ...choices.map((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.code} ${account.name}`;
      option.selected = account.id === selectedId;
      return option;
    })
  );
}

function addTaxCodeComponentRow(values = {}) {
  const container = elements["tax-code-components"];
  if (!container) return;
  const index = (taxCodeComponentSeq += 1);
  const row = document.createElement("fieldset");
  row.className = "tax-code-component";
  row.dataset.componentRow = String(index);

  const legend = document.createElement("legend");
  legend.textContent = `Component ${String(container.children.length + 1)}`;
  row.append(legend);

  const grid = document.createElement("div");
  grid.className = "form-grid";

  const field = (labelText, node, help) => {
    const label = document.createElement("label");
    label.append(document.createTextNode(labelText), node);
    if (help) {
      const hint = document.createElement("span");
      hint.className = "field-help";
      hint.textContent = help;
      label.append(hint);
    }
    grid.append(label);
    return node;
  };

  const name = Object.assign(document.createElement("input"), {
    name: "componentName",
    required: true,
    maxLength: 80,
    placeholder: "GST",
    value: values.name ?? ""
  });
  field("Name", name);

  const jurisdiction = Object.assign(document.createElement("input"), {
    name: "componentJurisdiction",
    required: true,
    maxLength: 40,
    placeholder: "CA",
    value: values.jurisdiction ?? ""
  });
  field("Authority", jurisdiction, "Who this component is remitted to, for example CA or CA-BC.");

  const rate = Object.assign(document.createElement("input"), {
    name: "componentRate",
    required: true,
    inputMode: "decimal",
    placeholder: "5",
    value: values.rate ? taxRateToPercent(values.rate) : ""
  });
  field("Rate %", rate, "A percentage, for example 5 or 9.975.");

  const recoverable = Object.assign(document.createElement("input"), {
    name: "componentRecoverable",
    required: true,
    inputMode: "decimal",
    placeholder: "100",
    value: values.recoverablePercent ? taxRateToPercent(values.recoverablePercent) : "100"
  });
  field("Recoverable %", recoverable, "How much of this component is recoverable on purchases.");

  const payable = document.createElement("select");
  payable.name = "componentPayableAccount";
  payable.required = true;
  taxCodeAccountOptions(payable, values.payableAccountId, ["LIABILITY"]);
  field(
    "Payable account",
    payable,
    "Where a sale credits this component. A posted tax component without an account is refused."
  );

  const recoverableAccount = document.createElement("select");
  recoverableAccount.name = "componentRecoverableAccount";
  taxCodeAccountOptions(recoverableAccount, values.recoverableAccountId, ["ASSET"]);
  field("Recoverable account", recoverableAccount, "Where a purchase debits the recoverable part.");

  row.append(grid);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-command";
  remove.textContent = "Remove component";
  remove.addEventListener("click", () => {
    row.remove();
    renumberTaxCodeComponents();
    renderTaxCodePreview();
  });
  row.append(remove);

  for (const control of row.querySelectorAll("input, select"))
    control.addEventListener("input", renderTaxCodePreview);

  container.append(row);
  renumberTaxCodeComponents();
  renderTaxCodePreview();
}

function renumberTaxCodeComponents() {
  const container = elements["tax-code-components"];
  if (!container) return;
  [...container.children].forEach((row, index) => {
    const legend = row.querySelector("legend");
    if (legend) legend.textContent = `Component ${String(index + 1)}`;
  });
  const add = elements["tax-code-add-component"];
  // The API caps a version at five components.
  if (add) add.disabled = container.children.length >= 5;
}

function readTaxCodeComponents() {
  const container = elements["tax-code-components"];
  if (!container) return [];
  return [...container.children].map((row) => {
    const value = (name) => row.querySelector(`[name="${name}"]`)?.value?.trim() ?? "";
    return {
      name: value("componentName"),
      jurisdiction: value("componentJurisdiction"),
      ratePercent: value("componentRate"),
      recoverablePercent: value("componentRecoverable"),
      payableAccountId: value("componentPayableAccount"),
      recoverableAccountId: value("componentRecoverableAccount")
    };
  });
}

// An operator is configuring double-entry consequences through a form about
// percentages. Show the consequence before they save it.
function renderTaxCodePreview() {
  const body = elements["tax-code-preview-body"];
  if (!body) return;
  const treatment = elements["tax-code-form"]?.elements.treatment?.value ?? "STANDARD";
  const components = readTaxCodeComponents();
  if (treatment !== "STANDARD") {
    body.replaceChildren(
      taxParagraph(
        treatment === "ZERO_RATED"
          ? "A sale using this code charges no tax and credits no tax account. The sale is still reported as a zero-rated supply, and input tax credits on related purchases are kept."
          : "A sale using this code charges no tax and credits no tax account. The sale is reported as exempt, and input tax credits on related purchases are lost.",
        null
      )
    );
    return;
  }
  if (components.length === 0) {
    body.replaceChildren(
      taxParagraph("Add a component to see the accounts a sale would use.", "empty-state")
    );
    return;
  }
  const list = document.createElement("ul");
  list.className = "tax-code-preview-list";
  for (const component of components) {
    const account = accounts.find((candidate) => candidate.id === component.payableAccountId);
    const item = document.createElement("li");
    const rate = component.ratePercent ? `${component.ratePercent}%` : "no rate";
    item.textContent = account
      ? `On a 100.00 sale, ${component.name || "this component"} at ${rate} credits ${account.code} ${account.name}.`
      : `${component.name || "This component"} at ${rate} has no payable account yet, so a sale using this code cannot post.`;
    if (!account) item.dataset.state = "blocked";
    list.append(item);
  }
  body.replaceChildren(list);
}

function renderTaxCodeList() {
  const container = elements["tax-code-list"];
  if (!container) return;
  const codes = setup?.taxCodes ?? [];
  if (codes.length === 0) {
    container.replaceChildren(
      taxParagraph("No tax codes yet. A sale cannot charge tax until one exists.", "empty-state")
    );
    return;
  }
  container.replaceChildren(
    ...codes.map((code) => {
      const version = code.versions?.[0];
      const card = document.createElement("article");
      card.className = "tax-code-card";

      const heading = document.createElement("h4");
      heading.textContent = `${code.code} — ${code.name}`;
      card.append(heading);

      const meta = document.createElement("p");
      meta.className = "tax-code-card-meta";
      meta.textContent = version
        ? `Version ${String(version.version)} · ${version.treatment} · ${version.calculationMode} · from ${String(version.effectiveFrom).slice(0, 10)}${version.effectiveTo ? ` to ${String(version.effectiveTo).slice(0, 10)}` : ""}`
        : "No effective version";
      card.append(meta);

      if (version?.components?.length) {
        const list = document.createElement("ul");
        list.className = "tax-code-card-components";
        for (const component of version.components) {
          const account = accounts.find((candidate) => candidate.id === component.payableAccountId);
          const item = document.createElement("li");
          item.textContent = `${component.name} · ${component.jurisdiction} · ${taxRateToPercent(component.rate)}% → ${account ? `${account.code} ${account.name}` : "no payable account"}`;
          if (!account) item.dataset.state = "blocked";
          list.append(item);
        }
        card.append(list);
      }

      if (version?.sourceName) {
        const source = document.createElement("p");
        source.className = "tax-code-card-source";
        source.textContent = `Source: ${version.sourceName}${version.sourceRetrievedAt ? `, checked ${String(version.sourceRetrievedAt).slice(0, 10)}` : ""}`;
        card.append(source);
      }

      const reversion = document.createElement("button");
      reversion.type = "button";
      reversion.className = "secondary-command";
      reversion.textContent = "New version of this code";
      reversion.addEventListener("click", () => prefillTaxCodeForm(code));
      card.append(reversion);
      return card;
    })
  );
}

function prefillTaxCodeForm(code) {
  const form = elements["tax-code-form"];
  if (!form) return;
  const version = code.versions?.[0];
  form.elements.code.value = code.code;
  form.elements.name.value = code.name;
  if (version) {
    form.elements.treatment.value = version.treatment;
    form.elements.calculationMode.value = version.calculationMode;
    form.elements.sourceName.value = version.sourceName ?? "";
    form.elements.sourceUrl.value = version.sourceUrl ?? "";
  }
  elements["tax-code-components"].replaceChildren();
  for (const component of version?.components ?? []) addTaxCodeComponentRow(component);
  if ((version?.components?.length ?? 0) === 0) addTaxCodeComponentRow();
  renderTaxCodePreview();
  form.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  showNotice(`Editing a new version of ${code.code}. Set the effective dates before saving.`);
}

async function saveTaxCodeVersion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const treatment = String(data.get("treatment"));
  const rawComponents = readTaxCodeComponents();

  if (treatment === "STANDARD" && rawComponents.length === 0) {
    showNotice("A standard tax code needs at least one component.", true);
    return;
  }

  const components = [];
  for (const component of rawComponents) {
    const rate = taxPercentToRate(component.ratePercent);
    const recoverable = taxPercentToRate(component.recoverablePercent);
    if (rate === null) {
      showNotice(`Enter a valid rate for ${component.name || "the component"}.`, true);
      return;
    }
    if (recoverable === null) {
      showNotice(
        `Enter a valid recoverable percentage for ${component.name || "the component"}.`,
        true
      );
      return;
    }
    // invoice-service refuses to post a tax component without a payable account.
    // Refuse it here so the operator learns now rather than at posting time.
    if (!component.payableAccountId) {
      showNotice(
        `Choose a payable account for ${component.name || "the component"}. A sale cannot post without it.`,
        true
      );
      return;
    }
    components.push({
      name: component.name,
      jurisdiction: component.jurisdiction,
      rate,
      recoverablePercent: recoverable,
      payableAccountId: component.payableAccountId,
      ...(component.recoverableAccountId
        ? { recoverableAccountId: component.recoverableAccountId }
        : {})
    });
  }

  const retrieved = String(data.get("sourceRetrievedAt"));
  const body = {
    code: String(data.get("code")).trim().toUpperCase(),
    name: String(data.get("name")).trim(),
    treatment,
    calculationMode: String(data.get("calculationMode")),
    effectiveFrom: String(data.get("effectiveFrom")),
    ...(data.get("effectiveTo") ? { effectiveTo: String(data.get("effectiveTo")) } : {}),
    sourceName: String(data.get("sourceName")).trim(),
    ...(data.get("sourceUrl") ? { sourceUrl: String(data.get("sourceUrl")).trim() } : {}),
    sourceRetrievedAt: new Date(`${retrieved}T00:00:00Z`).toISOString(),
    components
  };

  const existing = (setup?.taxCodes ?? []).find((candidate) => candidate.code === body.code);
  if (existing?.version) body.expectedTaxCodeVersion = existing.version;

  const response = await api("/v1/setup/tax-codes/versions", jsonRequest(body));
  if (!response.ok) return showError(response);
  const savedTaxCode = (await response.json()).taxCodeVersion;
  showNotice(`Tax code ${body.code} saved.`);
  form.reset();
  elements["tax-code-components"].replaceChildren();
  renumberTaxCodeComponents();
  renderTaxCodePreview();
  const returnToProduct = contextualCreationState?.kind === "tax-code";
  await refreshSetupState();
  if (returnToProduct) await loadSales();
  completeContextualCreation(savedTaxCode?.taxCodeId ?? savedTaxCode?.id);
}

function refreshTaxCodeComponentAccounts() {
  const container = elements["tax-code-components"];
  if (!container) return;
  for (const row of container.children) {
    const payable = row.querySelector('[name="componentPayableAccount"]');
    const recoverable = row.querySelector('[name="componentRecoverableAccount"]');
    if (payable) taxCodeAccountOptions(payable, payable.value, ["LIABILITY"]);
    if (recoverable) taxCodeAccountOptions(recoverable, recoverable.value, ["ASSET"]);
  }
  renderTaxCodePreview();
}
