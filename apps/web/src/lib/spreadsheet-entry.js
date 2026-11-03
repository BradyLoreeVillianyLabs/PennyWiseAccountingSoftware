// Paste-grid entry for forms that support spreadsheets.

import { showNotice } from "./notices.js";
import { elements, setSpreadsheetEntryState, spreadsheetEntryState } from "../state.js";

function normalizeSpreadsheetHeader(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function spreadsheetFieldLabel(field) {
  const label = field.closest("label")?.cloneNode(true);
  label?.querySelectorAll("input, select, textarea")?.forEach((control) => control.remove());
  return label?.textContent?.trim() || field.name || "Value";
}

function spreadsheetFieldsForForm(form) {
  const seen = new Set();
  return [...form.elements].filter((field) => {
    if (
      !(
        field instanceof globalThis.HTMLInputElement ||
        field instanceof globalThis.HTMLSelectElement ||
        field instanceof globalThis.HTMLTextAreaElement
      )
    )
      return false;
    if (
      !field.name ||
      seen.has(field.name) ||
      ["hidden", "submit", "button", "reset", "file"].includes(field.type)
    )
      return false;
    seen.add(field.name);
    return true;
  });
}

function spreadsheetEntryRows() {
  return spreadsheetEntryState.rows.length ? spreadsheetEntryState.rows : [[]];
}

function renderSpreadsheetEntryGrid() {
  const grid = elements["spreadsheet-entry-grid"];
  if (!grid) return;
  const columns = spreadsheetEntryState.columns;
  grid.style.setProperty("--spreadsheet-entry-column-count", String(Math.max(1, columns.length)));
  const header = document.createElement("div");
  header.className = "spreadsheet-entry-grid-row spreadsheet-entry-grid-header";
  header.setAttribute("role", "row");
  header.append(Object.assign(document.createElement("span"), { textContent: "Row" }));
  for (const column of columns) {
    const cell = document.createElement("span");
    cell.textContent = column.label;
    cell.setAttribute("role", "columnheader");
    header.append(cell);
  }
  const rows = spreadsheetEntryRows().map((values, rowIndex) => {
    const row = document.createElement("div");
    row.className = "spreadsheet-entry-grid-row";
    row.dataset.spreadsheetEntryRow = String(rowIndex);
    row.setAttribute("role", "row");
    const marker = document.createElement("span");
    marker.className = "spreadsheet-entry-row-marker";
    marker.textContent = String(rowIndex + 1);
    marker.setAttribute("role", "rowheader");
    row.append(marker);
    columns.forEach((column, columnIndex) => {
      const cell = document.createElement("span");
      cell.className = "spreadsheet-entry-grid-cell";
      cell.setAttribute("role", "gridcell");
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(values[columnIndex] ?? "");
      input.dataset.spreadsheetEntryRow = String(rowIndex);
      input.dataset.spreadsheetEntryColumn = String(columnIndex);
      input.setAttribute("aria-label", `${column.label}, row ${rowIndex + 1}`);
      cell.append(input);
      row.append(cell);
    });
    return row;
  });
  grid.replaceChildren(header, ...rows);
}

function spreadsheetEntryMessage(message) {
  if (elements["spreadsheet-entry-status"])
    elements["spreadsheet-entry-status"].textContent = message;
}

function openSpreadsheetEntry(form) {
  const fields = spreadsheetFieldsForForm(form);
  if (!fields.length) return showNotice("This screen has no spreadsheet-compatible fields.", true);
  setSpreadsheetEntryState({
    form,
    columns: fields.map((field) => ({
      name: field.name,
      label: spreadsheetFieldLabel(field),
      field
    })),
    rows: [fields.map((field) => field.value ?? "")]
  });
  elements["spreadsheet-entry-heading"].textContent =
    `Paste rows into ${form.closest("section")?.querySelector("h2, h3")?.textContent?.trim() || "this screen"}`;
  elements["spreadsheet-entry-description"].textContent =
    `Columns mirror the editable fields in ${form.id || "this form"}. Paste tab-separated cells from Excel, review the grid, then apply one row to the form.`;
  renderSpreadsheetEntryGrid();
  spreadsheetEntryMessage("Paste a row to begin.");
  const dialog = elements["spreadsheet-entry-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function addSpreadsheetEntryRow() {
  spreadsheetEntryState.rows.push(spreadsheetEntryState.columns.map(() => ""));
  renderSpreadsheetEntryGrid();
  elements["spreadsheet-entry-grid"]
    ?.querySelector(`[data-spreadsheet-entry-row="${spreadsheetEntryState.rows.length - 1}"]`)
    ?.focus();
}

export function handleSpreadsheetEntryPaste(event) {
  const target = event.target.closest?.("[data-spreadsheet-entry-row]");
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!target || (!text.includes("\t") && !text.includes("\n"))) return;
  event.preventDefault();
  const lines = text
    .replaceAll("\r", "")
    .split("\n")
    .filter((line) => line.length > 0);
  const startRow = Number(target.dataset.spreadsheetEntryRow ?? 0);
  const startColumn = Number(target.dataset.spreadsheetEntryColumn ?? 0);
  const first = lines[0].split("\t");
  const aliases = new Map(
    spreadsheetEntryState.columns.map((column, index) => [
      normalizeSpreadsheetHeader(column.name),
      index
    ])
  );
  spreadsheetEntryState.columns.forEach((column, index) =>
    aliases.set(normalizeSpreadsheetHeader(column.label), index)
  );
  const headerMap = new Map();
  first.forEach((value, index) => {
    const mapped = aliases.get(normalizeSpreadsheetHeader(value));
    if (mapped != null) headerMap.set(index, mapped);
  });
  const hasHeaders = headerMap.size > 0;
  const dataLines = hasHeaders ? lines.slice(1) : lines;
  dataLines.forEach((line, rowOffset) => {
    const rowIndex = startRow + rowOffset;
    while (!spreadsheetEntryState.rows[rowIndex])
      spreadsheetEntryState.rows.push(spreadsheetEntryState.columns.map(() => ""));
    line.split("\t").forEach((value, columnOffset) => {
      const columnIndex = hasHeaders ? headerMap.get(columnOffset) : startColumn + columnOffset;
      if (columnIndex != null && spreadsheetEntryState.rows[rowIndex])
        spreadsheetEntryState.rows[rowIndex][columnIndex] = value;
    });
  });
  renderSpreadsheetEntryGrid();
  spreadsheetEntryMessage(
    `Pasted ${dataLines.length} row${dataLines.length === 1 ? "" : "s"}${hasHeaders ? " with detected headers" : ""}. Review before applying.`
  );
}

export function clearSpreadsheetEntryGrid() {
  spreadsheetEntryState.rows = [spreadsheetEntryState.columns.map(() => "")];
  renderSpreadsheetEntryGrid();
  spreadsheetEntryMessage("Grid cleared. Paste or type a reviewed row.");
}

export function applySpreadsheetEntryRow() {
  const form = spreadsheetEntryState.form;
  const values = spreadsheetEntryState.rows[0] ?? [];
  if (!form || values.every((value) => !String(value ?? "").trim()))
    return showNotice("Enter or paste at least one value first.", true);
  spreadsheetEntryState.columns.forEach((column, index) => {
    const field = form.elements.namedItem(column.name);
    if (!(field instanceof globalThis.Element)) return;
    const value = String(values[index] ?? "");
    if (field instanceof globalThis.HTMLInputElement && ["checkbox", "radio"].includes(field.type))
      field.checked = /^(true|yes|1|on)$/i.test(value);
    else if (field instanceof globalThis.HTMLSelectElement) {
      const normalized = normalizeSpreadsheetHeader(value);
      const match = [...field.options].find(
        (option) =>
          normalizeSpreadsheetHeader(option.value) === normalized ||
          normalizeSpreadsheetHeader(option.textContent) === normalized
      );
      if (match) field.value = match.value;
    } else field.value = value;
    field.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
    field.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
  });
  elements["spreadsheet-entry-dialog"].close?.();
  showNotice(
    `Applied the first reviewed spreadsheet row to ${form.id || "the form"}. Review and submit when ready.`
  );
}

export function installSpreadsheetEntryTools() {
  const ignoredFormIds = new Set([
    "local-identity-form",
    "organization-form",
    "accept-form",
    "invitation-form",
    "report-filter-form",
    "evidence-filter-form",
    "journal-trace-form",
    "audit-filter-form",
    "bank-reconciliation-form",
    "organization-export-form",
    "organization-closure-form"
  ]);
  for (const form of document.querySelectorAll("form.form-grid, form.inline-form")) {
    if (ignoredFormIds.has(form.id)) continue;
    if (form.querySelector(".spreadsheet-entry-launch") || !spreadsheetFieldsForForm(form).length)
      continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-command spreadsheet-entry-launch";
    button.textContent = "Paste from Excel";
    button.title = "Open a column grid for Excel or spreadsheet values";
    button.addEventListener("click", () => openSpreadsheetEntry(form));
    const actions = form.querySelector(".form-actions");
    if (actions) actions.append(button);
    else {
      const wrapper = document.createElement("div");
      wrapper.className = "spreadsheet-entry-form-tools";
      wrapper.append(button);
      form.prepend(wrapper);
    }
  }
}
