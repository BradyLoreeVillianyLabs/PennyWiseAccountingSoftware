// Budgets and cash planning (`planning-workspace`).

import { formatMinor } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { commandButton, moneyFromForm, option, row } from "../lib/dom.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import { accounts, budgets, elements, setBudgets } from "../state.js";

let cashAssumptions = [];
let budgetDraftLines = [];

export function initPlanning() {
  elements["refresh-planning"].addEventListener("click", loadPlanning);
  elements["cash-assumption-form"].addEventListener("submit", createCashAssumption);
  elements["budget-form"].addEventListener("submit", createBudget);
  elements["add-budget-line"].addEventListener("click", addBudgetLine);
}

export async function loadPlanning() {
  const [budgetsResponse, forecastResponse, assumptionsResponse] = await Promise.all([
    api("/v1/budgets"),
    api("/v1/cash-forecast"),
    api("/v1/cash-forecast/assumptions")
  ]);
  if (!budgetsResponse.ok) {
    if (budgetsResponse.status !== 403) showError(budgetsResponse);
    elements["planning-workspace"].hidden = true;
    return;
  }
  setBudgets((await budgetsResponse.json()).budgets);
  cashAssumptions = assumptionsResponse.ok ? (await assumptionsResponse.json()).assumptions : [];
  renderPlanningSelects();
  renderBudgets();
  renderCashAssumptions();
  if (forecastResponse.ok) {
    renderCashForecast((await forecastResponse.json()).forecast);
  } else {
    elements["cash-forecast"].replaceChildren(
      row(["Forecast unavailable", "", "", "", "", "Refresh after resolving the error"])
    );
    if (forecastResponse.status !== 403) showError(forecastResponse);
  }
}

function renderPlanningSelects() {
  const select = elements["budget-form"].elements.accountId;
  select.replaceChildren(
    ...accounts
      .filter(
        (account) =>
          ["REVENUE", "EXPENSE"].includes(account.type) && !account.isArchived && !account.isControl
      )
      .map((account) => option(account.id, `${account.code} ${account.name}`))
  );
  const today = new Date().toISOString().slice(0, 10);
  const monday = startOfBrowserWeek(today);
  if (!elements["cash-assumption-form"].elements.weekStart.value)
    elements["cash-assumption-form"].elements.weekStart.value = monday;
  if (!elements["budget-form"].elements.startDate.value)
    elements["budget-form"].elements.startDate.value = `${today.slice(0, 4)}-01-01`;
  if (!elements["budget-form"].elements.endDate.value)
    elements["budget-form"].elements.endDate.value = `${today.slice(0, 4)}-12-31`;
  if (!elements["budget-form"].elements.periodStart.value)
    elements["budget-form"].elements.periodStart.value =
      elements["budget-form"].elements.startDate.value;
}

function startOfBrowserWeek(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function renderCashForecast(forecast) {
  elements["cash-forecast"].replaceChildren(
    ...forecast.weeks.map((week) =>
      row([
        week.weekStart.slice(0, 10),
        formatMinor(week.openingMinor),
        formatMinor(week.inflowsMinor),
        formatMinor(week.outflowsMinor),
        formatMinor(week.closingMinor),
        week.drivers.length
          ? week.drivers
              .map(
                (driver) =>
                  `${driver.label}: ${formatMinor(driver.amountMinor)} (${formatRole(driver.confidence)})`
              )
              .join(" | ")
          : "No projected activity"
      ])
    )
  );
}

function renderCashAssumptions() {
  elements["cash-assumptions"].replaceChildren(
    ...cashAssumptions.map((assumption) => {
      const actions = document.createElement("span");
      actions.append(commandButton("Remove", () => deleteCashAssumption(assumption)));
      return row([
        assumption.weekStart.slice(0, 10),
        assumption.label,
        assumption.direction === "INFLOW" ? "Money in" : "Money out",
        formatMinor(assumption.amountMinor),
        actions
      ]);
    })
  );
}

async function createCashAssumption(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const amountMinor = moneyFromForm(data, "amountMinor");
  if (amountMinor === null) return;
  const response = await api(
    "/v1/cash-forecast/assumptions",
    jsonRequest({
      weekStart: startOfBrowserWeek(String(data.get("weekStart"))),
      label: data.get("label"),
      direction: data.get("direction"),
      amountMinor,
      note: data.get("note") || null
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  await loadPlanning();
  showNotice("Cash assumption added.");
}

async function deleteCashAssumption(assumption) {
  const response = await api(
    `/v1/cash-forecast/assumptions/${assumption.id}`,
    jsonRequest({ version: assumption.version }, "DELETE")
  );
  if (!response.ok) return showError(response);
  await loadPlanning();
  showNotice("Cash assumption removed.");
}

function addBudgetLine() {
  const form = elements["budget-form"];
  const data = new FormData(form);
  const plannedMinor = moneyFromForm(data, "plannedMinor");
  const accountId = String(data.get("accountId") || "");
  const periodStart = String(data.get("periodStart") || "");
  if (!accountId || !periodStart || plannedMinor === null)
    return showNotice("Choose an account, period, and planned amount.", true);
  const duplicate = budgetDraftLines.some(
    (line) => line.accountId === accountId && line.periodStart === periodStart
  );
  if (duplicate) return showNotice("That account already has a line for this period.", true);
  budgetDraftLines.push({
    accountId,
    periodStart,
    plannedMinor,
    note: data.get("lineNote") || null
  });
  form.elements.plannedMinor.value = "";
  form.elements.lineNote.value = "";
  renderBudgetDraftLines();
}

function renderBudgetDraftLines() {
  elements["budget-draft-lines"].replaceChildren(
    ...budgetDraftLines.map((line, index) => {
      const account = accounts.find((candidate) => candidate.id === line.accountId);
      const actions = document.createElement("span");
      actions.append(
        commandButton("Remove", () => {
          budgetDraftLines.splice(index, 1);
          renderBudgetDraftLines();
        })
      );
      return row([
        account ? `${account.code} ${account.name}` : line.accountId,
        line.periodStart,
        formatMinor(line.plannedMinor),
        line.note ?? "",
        actions
      ]);
    })
  );
}

async function createBudget(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!budgetDraftLines.length)
    return showNotice("Add at least one budget line before creating the budget.", true);
  const data = new FormData(form);
  const response = await api(
    "/v1/budgets",
    jsonRequest({
      name: data.get("name"),
      periodType: data.get("periodType"),
      startDate: data.get("startDate"),
      endDate: data.get("endDate"),
      lines: budgetDraftLines
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  budgetDraftLines = [];
  renderBudgetDraftLines();
  await loadPlanning();
  showNotice("Budget draft created.");
}

function renderBudgets() {
  elements.budgets.replaceChildren(
    ...budgets.map((budget) => {
      const actions = document.createElement("span");
      actions.append(commandButton("View", () => showBudget(budget)));
      if (budget.status === "DRAFT")
        actions.append(commandButton("Activate", () => setBudgetStatus(budget, "activate")));
      if (budget.status !== "ARCHIVED")
        actions.append(commandButton("Archive", () => setBudgetStatus(budget, "archive")));
      return row([
        budget.name,
        `${budget.startDate.slice(0, 10)} to ${budget.endDate.slice(0, 10)}`,
        formatRole(budget.periodType),
        formatRole(budget.status),
        String(budget.lineCount),
        actions
      ]);
    })
  );
}

async function showBudget(budget) {
  const response = await api(`/v1/budgets/${budget.id}`);
  if (!response.ok) return showError(response);
  const detail = (await response.json()).budget;
  elements["budget-detail"].replaceChildren(
    ...detail.lines.map((line) =>
      row([
        `${line.accountCode} ${line.accountName}`,
        line.periodStart.slice(0, 10),
        formatMinor(line.plannedMinor),
        formatMinor(line.actualMinor),
        formatMinor(line.varianceMinor)
      ])
    )
  );
}

async function setBudgetStatus(budget, action) {
  const response = await api(
    `/v1/budgets/${budget.id}/${action}`,
    jsonRequest({ version: budget.version }, "POST")
  );
  if (!response.ok) return showError(response);
  await loadPlanning();
  showNotice(`Budget ${action === "activate" ? "activated" : "archived"}.`);
}
