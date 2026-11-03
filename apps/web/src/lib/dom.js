// Small DOM builders shared by the workspaces.

import { formatMinor, parseMoneyInput } from "../../money.js";
import { showNotice } from "./notices.js";

export function moneyFromForm(data, field) {
  try {
    return parseMoneyInput(data.get(field));
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "Enter a valid amount.", true);
    return null;
  }
}

export function row(values) {
  const tr = document.createElement("tr");
  values.forEach((value) => tr.append(value instanceof HTMLElement ? value : cell(value)));
  return tr;
}

export function headerRow(values) {
  const tr = document.createElement("tr");
  values.forEach((value) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = value;
    tr.append(th);
  });
  return tr;
}

export function cell(value) {
  const td = document.createElement("td");
  if (value instanceof HTMLElement) td.append(value);
  else td.textContent = value;
  return td;
}

export function moneyCell(value, currency) {
  const td = cell(formatMinor(value, currency));
  td.className = "money-amount";
  td.dataset.moneyMinor = String(value ?? "0");
  td.dataset.moneyCurrency = currency;
  return td;
}

export function inputCell(field, value) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.dataset.field = field;
  input.inputMode = "numeric";
  input.pattern = field === "difference" ? "-?\\d+(?:[.,]\\d{1,2})?" : "\\d+(?:[.,]\\d{1,2})?";
  input.value = value;
  input.setAttribute("aria-label", field);
  td.append(input);
  return td;
}

export function rowText(value) {
  const p = document.createElement("p");
  p.textContent = value;
  return p;
}

export function listItem(value) {
  const item = document.createElement("li");
  item.textContent = value;
  return item;
}

export function escapeText(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

export function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

export function commandButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-command";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

export function microsFromDecimal(value, label) {
  const text = String(value ?? "")
    .trim()
    .replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) {
    showNotice(`${label} must be a positive number with at most six decimals.`, true);
    return null;
  }
  return `${match[1]}${(match[2] ?? "").padEnd(6, "0")}`.replace(/^0+(?=\d)/, "");
}

export function countLabel(value, singular, plural) {
  const count = Number(value ?? 0);
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatFileSize(value) {
  if (value < 1024) return `${value} bytes`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

export function definitionTerm(value) {
  const term = document.createElement("dt");
  term.textContent = value;
  return term;
}

export function definitionDescription(value) {
  const description = document.createElement("dd");
  description.textContent = value;
  return description;
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]
  );
}

export function descriptionItem(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  wrapper.append(term, detail);
  return wrapper;
}

export function metric(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = String(value);
  wrapper.append(term, detail);
  return wrapper;
}
