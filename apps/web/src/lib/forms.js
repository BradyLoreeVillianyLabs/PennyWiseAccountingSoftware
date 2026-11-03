// Browser form drafts, table filters, and visible-table export.

import { formatMoney } from "../../money.js";
import { csvEscape, readBrowserPreference, writeBrowserPreference } from "./browser.js";
import { renderBillDuplicateWarning } from "./workspace-calls.js";
import { elements, identity } from "../state.js";

const browserDraftFormDefinitions = {
  "invoice-form": {
    statusId: "invoice-browser-draft-status",
    clearId: "invoice-clear-browser-draft",
    label: "Invoice"
  },
  "bill-form": {
    statusId: "bill-browser-draft-status",
    clearId: "bill-clear-browser-draft",
    label: "Bill"
  }
};
const browserDraftTimers = new Map();

function browserDraftStorageKey(formId) {
  const email = identity?.email?.trim().toLowerCase();
  const organizationId = identity?.activeOrganizationId;
  if (!email || !organizationId) return null;
  return `clearledger_browser_draft:v1:${encodeURIComponent(email)}:${encodeURIComponent(organizationId)}:${formId}`;
}

function browserDraftFields(form) {
  return [...form.elements].filter(
    (field) =>
      field instanceof globalThis.HTMLInputElement ||
      field instanceof globalThis.HTMLSelectElement ||
      field instanceof globalThis.HTMLTextAreaElement
  );
}

function serializeBrowserFormDraft(form) {
  return Object.fromEntries(
    browserDraftFields(form)
      .filter(
        (field) =>
          field.name && !["file", "password", "submit", "button", "reset"].includes(field.type)
      )
      .map((field) => [field.name, field.type === "checkbox" ? field.checked : field.value])
  );
}

function saveBrowserFormDraft(formId) {
  const key = browserDraftStorageKey(formId);
  const form = elements[formId];
  const definition = browserDraftFormDefinitions[formId];
  if (!key || !form || !definition) return;
  const values = serializeBrowserFormDraft(form);
  const hasContent = Object.values(values).some((value) => value === true || String(value).trim());
  if (!hasContent) {
    clearBrowserFormDraft(formId, { reset: false, announce: false });
    return;
  }
  const saved = writeBrowserPreference(
    key,
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), values })
  );
  elements[definition.statusId].textContent = saved
    ? "Unsaved changes saved in this browser."
    : "Unsaved changes are only in this tab.";
}

function scheduleBrowserFormDraftSave(formId) {
  const existing = browserDraftTimers.get(formId);
  if (existing) globalThis.clearTimeout(existing);
  browserDraftTimers.set(
    formId,
    globalThis.setTimeout(() => {
      browserDraftTimers.delete(formId);
      saveBrowserFormDraft(formId);
    }, 350)
  );
}

export function clearBrowserFormDraft(formId, { reset = true, announce = true } = {}) {
  const key = browserDraftStorageKey(formId);
  const form = elements[formId];
  const definition = browserDraftFormDefinitions[formId];
  if (key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Browser drafts are optional and never affect accounting data.
    }
  }
  if (reset && form) form.reset();
  if (definition) {
    elements[definition.statusId].textContent = announce ? "Local draft discarded." : "";
    elements[definition.clearId].hidden = true;
  }
  if (formId === "bill-form") renderBillDuplicateWarning();
}

function restoreBrowserFormDraft(formId) {
  const key = browserDraftStorageKey(formId);
  const form = elements[formId];
  const definition = browserDraftFormDefinitions[formId];
  if (!key || !form || !definition) return;
  let parsed;
  try {
    parsed = JSON.parse(readBrowserPreference(key) || "null");
  } catch {
    parsed = null;
  }
  if (!parsed?.values || typeof parsed.values !== "object") return;
  for (const field of browserDraftFields(form)) {
    if (!field.name || !(field.name in parsed.values) || field.type === "file") continue;
    if (field.type === "checkbox") field.checked = parsed.values[field.name] === true;
    else field.value = String(parsed.values[field.name] ?? "");
  }
  elements[definition.statusId].textContent =
    `Recovered unsaved ${definition.label.toLowerCase()} changes from this browser.`;
  elements[definition.clearId].hidden = false;
  if (formId === "bill-form") renderBillDuplicateWarning();
}

export function initializeBrowserFormDrafts() {
  for (const [formId, definition] of Object.entries(browserDraftFormDefinitions)) {
    const form = elements[formId];
    if (!form || form.dataset.browserDraftReady === "true") continue;
    form.dataset.browserDraftReady = "true";
    form.addEventListener("input", () => scheduleBrowserFormDraftSave(formId));
    form.addEventListener("change", () => scheduleBrowserFormDraftSave(formId));
    restoreBrowserFormDraft(formId);
    elements[definition.clearId].hidden = !readBrowserPreference(
      browserDraftStorageKey(formId) ?? ""
    );
  }
}

function tableFilterStorageKey(targetId) {
  const email = identity?.email?.trim().toLowerCase();
  const organizationId = identity?.activeOrganizationId;
  if (!email || !organizationId) return null;
  return `clearledger_table_filter:v1:${encodeURIComponent(email)}:${encodeURIComponent(organizationId)}:${targetId}`;
}

export function applyTableFilter(targetId, { persist = true } = {}) {
  const input = document.querySelector(`[data-table-filter-target="${targetId}"]`);
  const body = document.getElementById(targetId);
  const count = document.querySelector(`[data-table-filter-count="${targetId}"]`);
  if (!input || !body || !count) return;
  const term = input.value.trim().toLocaleLowerCase();
  const rows = [...body.children];
  let visible = 0;
  for (const row of rows) {
    const matches = !term || row.textContent.toLocaleLowerCase().includes(term);
    row.hidden = !matches;
    if (matches) visible += 1;
  }
  count.textContent = term
    ? `Showing ${visible} of ${rows.length} rows`
    : `${rows.length} row${rows.length === 1 ? "" : "s"}`;
  if (persist) {
    const key = tableFilterStorageKey(targetId);
    if (key) writeBrowserPreference(key, input.value);
  }
}

export function applySavedTableFilters() {
  document.querySelectorAll("[data-table-filter-target]").forEach((input) => {
    const targetId = input.dataset.tableFilterTarget;
    if (!targetId) return;
    const stored = readBrowserPreference(tableFilterStorageKey(targetId) ?? "");
    if (stored !== null) input.value = stored;
    applyTableFilter(targetId, { persist: false });
  });
}

export function downloadVisibleTable(targetId) {
  const body = document.getElementById(targetId);
  const table = body?.closest("table");
  if (!body || !table) return;
  const headers = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
  const rows = [...body.children]
    .filter((row) => !row.hidden)
    .map((row) =>
      [...row.children].map((tableCell) =>
        tableCell.dataset.moneyMinor
          ? formatMoney(tableCell.dataset.moneyMinor, tableCell.dataset.moneyCurrency, {
              context: "export"
            })
          : tableCell.textContent.trim()
      )
    );
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new globalThis.Blob([`${csv}\r\n`], { type: "text/csv;charset=utf-8" })
  );
  link.download = `clearledger-${targetId}-visible.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
