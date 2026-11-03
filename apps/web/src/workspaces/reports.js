// Reports (`reports-workspace`).

import { formatMinor } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { headerRow, option, row } from "../lib/dom.js";
import { isoDate } from "../lib/format.js";
import { showError } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import { dashboardMoney, registerWorkspaceCalls } from "../lib/workspace-calls.js";
import { printWorkspace } from "../shell.js";
import {
  currentReportState,
  elements,
  multiCurrencyState,
  setCurrentReportState,
  setup
} from "../state.js";

let reportsLoading = false;
let savedReportViews = [];
let reportDrilldownState = null;
const reportEndpoints = {
  "profit-and-loss": { path: "/v1/reports/profit-and-loss", mode: "range" },
  "balance-sheet": { path: "/v1/reports/balance-sheet", mode: "asOf" },
  "trial-balance": { path: "/v1/reports/trial-balance", mode: "asOf" },
  "general-ledger": { path: "/v1/reports/general-ledger", mode: "range" },
  journals: { path: "/v1/reports/journals", mode: "range" },
  "cash-flow": { path: "/v1/reports/cash-flow", mode: "range" },
  receivables: { path: "/v1/reports/receivables", mode: "asOf" },
  payables: { path: "/v1/reports/payables", mode: "asOf" },
  tax: { path: "/v1/reports/tax", mode: "range" },
  banking: { path: "/v1/reports/banking", mode: "rangeAsOf" },
  sales: { path: "/v1/reports/sales", mode: "range" },
  expenses: { path: "/v1/reports/expenses", mode: "range" }
};
const exportableReports = new Set([
  "profit-and-loss",
  "balance-sheet",
  "journals",
  "receivables",
  "payables",
  "tax",
  "banking",
  "sales",
  "expenses"
]);
const reportComparisonMetrics = {
  "profit-and-loss": [
    ["Revenue", "totalRevenueMinor"],
    ["Expenses", "totalExpenseMinor"],
    ["Net income", "netIncomeMinor"]
  ],
  "balance-sheet": [
    ["Assets", "totalAssetsMinor"],
    ["Liabilities", "totalLiabilitiesMinor"],
    ["Equity", "totalEquityMinor"]
  ],
  "cash-flow": [
    ["Operating cash", "operatingMinor"],
    ["Investing cash", "investingMinor"],
    ["Net cash change", "netCashChangeMinor"]
  ],
  receivables: [["Receivables subledger", "subledgerBalanceMinor"]],
  payables: [["Payables subledger", "subledgerBalanceMinor"]],
  tax: [
    ["Collected", "collectedMinor"],
    ["Recoverable", "recoverableMinor"],
    ["Net tax position", "netTaxPositionMinor"]
  ],
  banking: [
    ["Cash balance", "paymentClearingBalanceMinor"],
    ["Unmatched items", "unmatchedCount"]
  ],
  sales: [
    ["Net sales", "netSalesMinor"],
    ["Gross margin", "grossMarginMinor"]
  ],
  expenses: [
    ["Expenses", "totalExpenseMinor"],
    ["Processing fees", "paymentProcessingFeesMinor"]
  ]
};

registerWorkspaceCalls({
  loadReports,
  minorIsNonZero,
  renderDashboard,
  reportMoneyText,
  runSelectedReport
});

export function initReports() {
  elements["export-tax-by-authority"]?.addEventListener("click", exportTaxByAuthority);
  elements["refresh-reports"].addEventListener("click", loadReports);
  elements["report-filter-form"].addEventListener("submit", runSelectedReport);
  elements["report-compare-enabled"].addEventListener("change", () => {
    if (elements["report-compare-enabled"].checked) void runSelectedReport();
    else clearReportComparison();
  });
  elements["report-period-preset"].addEventListener("change", applyReportPeriodPreset);
  elements["report-comparison-mode"].addEventListener("change", () => {
    if (elements["report-compare-enabled"].checked) void runSelectedReport();
  });
  elements["report-hide-zero"].addEventListener("change", () => {
    if (currentReportState) renderReport(currentReportState.reportName, currentReportState.report);
  });
  elements["report-currency-filter"].addEventListener("change", () => {
    updateReportHeaderLine();
    if (currentReportState) renderReport(currentReportState.reportName, currentReportState.report);
  });
  elements["report-view-select"].addEventListener("change", applySelectedReportView);
  elements["save-report-view"].addEventListener("click", saveCurrentReportView);
  elements["delete-report-view"].addEventListener("click", deleteSelectedReportView);
  elements["close-report-drilldown"].addEventListener("click", closeReportDrilldown);
  elements["export-report"].addEventListener("click", exportSelectedReport);
  elements["print-report"].addEventListener("click", () => printWorkspace("reports-workspace"));
}

function reportBaseCurrency() {
  return multiCurrencyState?.baseCurrency ?? setup?.settings?.baseCurrency ?? "CAD";
}

function updateReportHeaderLine() {
  const selected = elements["report-currency-filter"]?.value;
  const currency = !selected || selected === "base" ? reportBaseCurrency() : selected;
  elements["report-header-line"].textContent =
    currency === reportBaseCurrency()
      ? `Amounts in ${currency} (base currency)`
      : `Amounts shown in ${currency}`;
}

function refreshReportCurrencyOptions() {
  const select = elements["report-currency-filter"];
  const selected = select.value || "base";
  const currencies = [
    { value: "base", label: `${reportBaseCurrency()} (base currency)` },
    ...(multiCurrencyState?.enabled
      ? (multiCurrencyState.currencies ?? [])
          .filter((currency) => currency.enabled && currency.currencyCode !== reportBaseCurrency())
          .map((currency) => ({ value: currency.currencyCode, label: currency.currencyCode }))
      : [])
  ];
  select.replaceChildren(...currencies.map(({ value, label }) => option(value, label)));
  select.value = currencies.some((currency) => currency.value === selected) ? selected : "base";
  updateReportHeaderLine();
}

function applyReportPeriodPreset() {
  const preset = elements["report-period-preset"].value;
  if (preset === "custom") return;
  const anchor = new Date(
    `${elements["report-filter-form"].elements.asOf.value || isoDate(new Date())}T00:00:00Z`
  );
  if (!Number.isFinite(anchor.getTime())) return;
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  let from;
  let to;
  if (preset === "this-month") {
    from = new Date(Date.UTC(year, month, 1));
    to = new Date(Date.UTC(year, month + 1, 0));
  } else if (preset === "last-month") {
    from = new Date(Date.UTC(year, month - 1, 1));
    to = new Date(Date.UTC(year, month, 0));
  } else if (preset === "this-quarter") {
    const quarterStart = Math.floor(month / 3) * 3;
    from = new Date(Date.UTC(year, quarterStart, 1));
    to = new Date(Date.UTC(year, quarterStart + 3, 0));
  } else if (preset === "this-year") {
    from = new Date(Date.UTC(year, 0, 1));
    to = new Date(Date.UTC(year, 11, 31));
  } else {
    from = new Date(Date.UTC(year - 1, 0, 1));
    to = new Date(Date.UTC(year - 1, 11, 31));
  }
  const form = elements["report-filter-form"];
  form.elements.from.value = isoDate(from);
  form.elements.to.value = isoDate(to);
  form.elements.asOf.value = isoDate(to);
}

function reportViewConfiguration() {
  const form = elements["report-filter-form"];
  return {
    reportName: form.elements.reportName.value,
    preset: form.elements.preset.value,
    from: form.elements.from.value,
    to: form.elements.to.value,
    asOf: form.elements.asOf.value,
    basis: form.elements.basis.value,
    currency: form.elements.currency.value,
    comparisonEnabled: elements["report-compare-enabled"].checked,
    comparisonMode: elements["report-comparison-mode"].value,
    hideZero: elements["report-hide-zero"].checked,
    collapsedGroups: [...(currentReportState?.collapsedGroups ?? [])],
    columns: currentReportState?.columns ?? []
  };
}

async function loadReportViews(reportName) {
  const response = await api(
    `/v1/report-views?reportName=${encodeURIComponent(reportName)}`,
    {},
    true
  );
  if (!response.ok) return;
  savedReportViews = (await response.json()).views ?? [];
  const current = elements["report-view-select"].value;
  elements["report-view-select"].replaceChildren(
    option("", "Current filters"),
    ...savedReportViews.map((view) =>
      option(view.id, `${view.name}${view.shared ? " · shared" : ""}`)
    )
  );
  elements["report-view-select"].value = savedReportViews.some((view) => view.id === current)
    ? current
    : "";
  elements["delete-report-view"].disabled = !elements["report-view-select"].value;
}

async function applySelectedReportView() {
  const id = elements["report-view-select"].value;
  const view = savedReportViews.find((candidate) => candidate.id === id);
  elements["delete-report-view"].disabled = !view;
  if (!view) return;
  const config = view.configuration ?? {};
  const form = elements["report-filter-form"];
  for (const field of ["from", "to", "asOf", "basis", "currency", "preset"]) {
    if (config[field] !== undefined && form.elements[field])
      form.elements[field].value = config[field];
  }
  elements["report-compare-enabled"].checked = config.comparisonEnabled === true;
  if (config.comparisonMode) elements["report-comparison-mode"].value = config.comparisonMode;
  elements["report-hide-zero"].checked = config.hideZero !== false;
  elements["report-view-name"].value = view.name;
  elements["report-view-shared"].checked = view.shared === true;
  elements["report-view-default"].checked = view.isDefault === true;
  updateReportHeaderLine();
  await runSelectedReport();
}

async function saveCurrentReportView() {
  const name = elements["report-view-name"].value.trim();
  if (!name) {
    elements["report-view-status"].textContent = "Enter a name for this saved view.";
    elements["report-view-name"].focus();
    return;
  }
  const selectedId = elements["report-view-select"].value;
  const request = jsonRequest(
    {
      reportName: elements["report-filter-form"].elements.reportName.value,
      name,
      configuration: reportViewConfiguration(),
      shared: elements["report-view-shared"].checked,
      isDefault: elements["report-view-default"].checked
    },
    selectedId ? "PATCH" : "POST"
  );
  const response = await api(
    selectedId ? `/v1/report-views/${encodeURIComponent(selectedId)}` : "/v1/report-views",
    request
  );
  if (!response.ok) return showError(response);
  const view = (await response.json()).view;
  elements["report-view-status"].textContent = `Saved view “${view.name}”.`;
  await loadReportViews(view.reportName);
  elements["report-view-select"].value = view.id;
  elements["delete-report-view"].disabled = false;
}

async function deleteSelectedReportView() {
  const id = elements["report-view-select"].value;
  if (!id) return;
  const view = savedReportViews.find((candidate) => candidate.id === id);
  if (!view || !window.confirm(`Delete saved view “${view.name}”?`)) return;
  const response = await api(`/v1/report-views/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) return showError(response);
  elements["report-view-status"].textContent = `Deleted view “${view.name}”.`;
  elements["report-view-name"].value = "";
  await loadReportViews(elements["report-filter-form"].elements.reportName.value);
}

function reportMoneyText(value, currency) {
  const numericValue = (() => {
    try {
      return BigInt(String(value ?? "0"));
    } catch {
      return null;
    }
  })();
  if (numericValue === null) return String(value ?? "");
  const negative = numericValue < 0n;
  const absolute = negative ? (-numericValue).toString() : numericValue.toString();
  const formatted = formatMinor(absolute, currency);
  return negative ? `(${formatted})` : formatted;
}

function reportMoneyCell(value, currency) {
  const wrapper = document.createElement("span");
  wrapper.className = "report-money";
  const formatted = reportMoneyText(value, currency);
  const numericValue = (() => {
    try {
      return BigInt(String(value ?? "0"));
    } catch {
      return null;
    }
  })();
  const negative = numericValue !== null && numericValue < 0n;
  if (negative) {
    const visible = document.createElement("span");
    visible.setAttribute("aria-hidden", "true");
    visible.textContent = formatted;
    const accessible = document.createElement("span");
    accessible.className = "sr-only";
    accessible.textContent = `negative ${formatMinor((-numericValue).toString(), currency)}`;
    wrapper.append(visible, accessible);
  } else {
    wrapper.textContent = formatted;
  }
  return wrapper;
}

function reportValueIsZero(value) {
  try {
    return BigInt(String(value ?? "0")) === 0n;
  } catch {
    return false;
  }
}

async function openReportDrilldown(item, reportName, label) {
  const url =
    item.drillDownUrl ??
    item.drilldownUrl ??
    (reportName === "journals" && item.id
      ? `/v1/accountant/journals/${encodeURIComponent(item.id)}/trace`
      : null);
  if (!url) return;
  const tableWrap = elements["report-table"].closest(".table-wrap");
  reportDrilldownState = {
    scrollTop: tableWrap?.scrollTop ?? 0,
    scrollLeft: tableWrap?.scrollLeft ?? 0,
    focusId: document.activeElement?.getAttribute("data-report-row-id") ?? null
  };
  elements["report-drilldown-panel"].hidden = false;
  elements["report-drilldown-breadcrumb"].textContent =
    `${formatRole(reportName)} › ${label || "selected amount"}`;
  elements["report-drilldown-content"].replaceChildren(
    Object.assign(document.createElement("p"), { textContent: "Loading transaction details…" })
  );
  const response = await api(url.replace(/^\/api/, ""), {}, true);
  if (!response.ok) {
    elements["report-drilldown-content"].textContent =
      "The transaction detail could not be loaded. The report remains unchanged.";
    return;
  }
  const payload = await response.json();
  const pre = document.createElement("pre");
  pre.className = "report-drilldown-json";
  pre.textContent = JSON.stringify(payload, null, 2);
  elements["report-drilldown-content"].replaceChildren(pre);
  elements["close-report-drilldown"].focus();
}

function closeReportDrilldown() {
  elements["report-drilldown-panel"].hidden = true;
  const tableWrap = elements["report-table"].closest(".table-wrap");
  if (tableWrap && reportDrilldownState) {
    tableWrap.scrollTop = reportDrilldownState.scrollTop;
    tableWrap.scrollLeft = reportDrilldownState.scrollLeft;
  }
  reportDrilldownState = null;
}

function minorIsNonZero(value) {
  try {
    return BigInt(String(value ?? "0")) !== 0n;
  } catch {
    return false;
  }
}

export async function loadReports() {
  if (reportsLoading) return;
  reportsLoading = true;
  try {
    const form = elements["report-filter-form"];
    const today = new Date().toISOString().slice(0, 10);
    if (!form.elements.asOf.value) form.elements.asOf.value = today;
    if (!form.elements.to.value) form.elements.to.value = today;
    if (!form.elements.from.value) form.elements.from.value = `${today.slice(0, 8)}01`;
    refreshReportCurrencyOptions();
    updateReportHeaderLine();
    elements["report-status"].textContent = "Loading dashboard...";
    const response = await api(
      `/v1/dashboard?asOf=${encodeURIComponent(form.elements.asOf.value)}`
    );
    if (!response.ok) {
      elements["report-status"].textContent = "";
      return showError(response);
    }
    const dashboard = (await response.json()).dashboard;
    if (currentReportState) currentReportState.dashboard = dashboard;
    else setCurrentReportState({ dashboard });
    renderDashboard(dashboard);
    await runSelectedReport();
  } finally {
    reportsLoading = false;
  }
}

function renderDashboard(dashboard) {
  if (!dashboard) return;
  refreshReportCurrencyOptions();
  const metrics = [
    ["Cash", dashboard.cashMinor, dashboard.links.cash],
    ["Accounts receivable", dashboard.unpaidInvoicesMinor, dashboard.links.receivables],
    ["Overdue invoices", dashboard.overdueInvoicesMinor, dashboard.links.receivables],
    ["Upcoming bills", dashboard.upcomingBillsMinor, dashboard.links.payables],
    ["Sales this month", dashboard.salesThisMonthMinor, "/v1/reports/sales"],
    ["Expenses this month", dashboard.expensesThisMonthMinor, dashboard.links.profit],
    ["Estimated profit", dashboard.estimatedProfitMinor, dashboard.links.profit],
    ["Estimated tax position", dashboard.estimatedTaxPositionMinor, dashboard.links.tax]
  ];
  elements["dashboard-summary"].replaceChildren(
    ...metrics.map(([label, value, link]) => {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      const anchor = document.createElement("a");
      term.textContent = label;
      anchor.href = `/api${link}`;
      const money = dashboardMoney(value, dashboard.currency, label);
      anchor.textContent = money.text;
      anchor.setAttribute("aria-label", money.aria);
      detail.append(anchor);
      group.append(term, detail);
      return group;
    })
  );
}

async function runSelectedReport(event) {
  event?.preventDefault();
  const form = elements["report-filter-form"];
  const data = new FormData(form);
  const reportName = data.get("reportName");
  refreshReportCurrencyOptions();
  updateReportHeaderLine();
  const query = reportQuery(reportName, data);
  elements["report-status"].textContent = "Loading report...";
  elements["export-report"].disabled = !exportableReports.has(reportName);
  const response = await api(`${reportEndpoints[reportName].path}?${query}`);
  if (!response.ok) {
    elements["report-status"].textContent = "";
    return showError(response);
  }
  const payload = await response.json();
  const report = payload.report ?? payload.trialBalance ?? payload.generalLedger;
  setCurrentReportState({
    ...(currentReportState ?? {}),
    reportName,
    report,
    query,
    collapsedGroups: currentReportState?.collapsedGroups ?? new Set(),
    columns: currentReportState?.columns ?? []
  });
  renderReport(reportName, report);
  await loadReportViews(reportName);
  if (!elements["report-compare-enabled"].checked) {
    clearReportComparison();
    return;
  }
  const comparison = reportComparisonPeriod(reportName, data);
  if (!comparison) {
    renderReportComparisonUnavailable("Choose a valid report period before comparing.");
    return;
  }
  elements["report-comparison"].hidden = false;
  elements["report-comparison"].textContent = `Loading comparison for ${comparison.label}…`;
  const comparisonResponse = await api(`${reportEndpoints[reportName].path}?${comparison.query}`);
  if (!comparisonResponse.ok) {
    renderReportComparisonUnavailable(
      "The previous period could not be loaded. The current report remains available."
    );
    return;
  }
  const comparisonPayload = await comparisonResponse.json();
  const previousReport =
    comparisonPayload.report ?? comparisonPayload.trialBalance ?? comparisonPayload.generalLedger;
  renderReportComparison(reportName, report, previousReport, comparison.label);
}

function reportQuery(reportName, data) {
  const mode = reportEndpoints[reportName].mode;
  const query = new URLSearchParams();
  if (mode === "range" || mode === "rangeAsOf") {
    query.set("from", data.get("from"));
    query.set("to", data.get("to"));
  }
  if (mode === "asOf" || mode === "rangeAsOf") query.set("asOf", data.get("asOf"));
  if (reportName === "profit-and-loss") query.set("basis", data.get("basis"));
  return query;
}

function shiftReportDate(value, days) {
  const date = new Date(`${String(value)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function reportComparisonPeriod(reportName, data) {
  const mode = reportEndpoints[reportName].mode;
  const query = new URLSearchParams();
  if (mode === "asOf") {
    const previousAsOf = shiftReportDate(data.get("asOf"), -1);
    if (!previousAsOf) return null;
    query.set("asOf", previousAsOf);
    return { query, label: `as of ${previousAsOf}` };
  }
  const from = String(data.get("from") ?? "");
  const to = String(data.get("to") ?? "");
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return null;
  const duration = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (duration < 1) return null;
  const previousTo = shiftReportDate(from, -1);
  const previousFrom = previousTo && shiftReportDate(previousTo, -(duration - 1));
  if (!previousFrom || !previousTo) return null;
  query.set("from", previousFrom);
  query.set("to", previousTo);
  if (mode === "rangeAsOf") {
    const previousAsOf = shiftReportDate(data.get("asOf"), -duration);
    if (!previousAsOf) return null;
    query.set("asOf", previousAsOf);
  }
  if (reportName === "profit-and-loss") query.set("basis", data.get("basis"));
  return { query, label: `${previousFrom} to ${previousTo}` };
}

function clearReportComparison() {
  const output = elements["report-comparison"];
  output.hidden = true;
  output.replaceChildren();
}

function renderReportComparisonUnavailable(message) {
  const output = elements["report-comparison"];
  output.hidden = false;
  output.textContent = message;
}

function renderReportComparison(reportName, current, previous, label) {
  const output = elements["report-comparison"];
  output.hidden = false;
  const heading = document.createElement("strong");
  heading.textContent = `Compared with ${label}`;
  const detail = document.createElement("span");
  const metrics = reportComparisonMetrics[reportName] ?? [];
  const lines = metrics
    .filter(([, key]) => current?.[key] !== undefined || previous?.[key] !== undefined)
    .map(([metric, key]) => {
      const currentValue = current?.[key] ?? "0";
      const previousValue = previous?.[key] ?? "0";
      const isCount = !key.endsWith("Minor");
      let delta;
      try {
        delta = BigInt(String(currentValue)) - BigInt(String(previousValue));
      } catch {
        delta = null;
      }
      const currentLabel = isCount
        ? String(currentValue)
        : reportMoneyText(currentValue, reportBaseCurrency());
      const deltaLabel =
        delta === null
          ? ""
          : isCount
            ? String(delta)
            : reportMoneyText(delta, reportBaseCurrency());
      return `${metric}: ${currentLabel} (change ${deltaLabel})`;
    });
  detail.textContent = lines.length
    ? lines.join(" · ")
    : "The selected report has no comparable summary metrics; compare its detail rows below.";
  output.replaceChildren(heading, detail);
}

function renderTaxJurisdictions(reportName, report) {
  const section = elements["report-tax-jurisdictions"];
  if (!section) return;
  const groups =
    reportName === "tax" && Array.isArray(report?.jurisdictions) ? report.jurisdictions : [];
  section.hidden = groups.length === 0;
  if (groups.length === 0) return;
  elements["report-tax-jurisdictions-head"].replaceChildren(
    headerRow([
      "Authority",
      "Payable account",
      "Collected",
      "Recoverable",
      "Net",
      "Account balance",
      "Agrees"
    ])
  );
  // A return is prepared from these figures, so they are shown as money rather
  // than as the minor units the rest of the generic report table displays.
  const money = (value) => (value === null || value === undefined ? "—" : formatMinor(value));
  elements["report-tax-jurisdictions-body"].replaceChildren(
    ...groups.map((group) =>
      row([
        group.jurisdiction,
        group.payableAccountCode
          ? `${group.payableAccountCode} ${group.payableAccountName ?? ""}`.trim()
          : "No payable account",
        money(group.collectedMinor),
        money(group.recoverableMinor),
        money(group.netTaxPositionMinor),
        money(group.accountBalanceMinor),
        group.isReconciled === null ? "—" : group.isReconciled ? "Yes" : "No"
      ])
    )
  );
}

function renderReport(reportName, report) {
  renderTaxJurisdictions(reportName, report);
  const allRows = reportRows(reportName, report);
  const hideZero = elements["report-hide-zero"]?.checked !== false;
  const rows = hideZero
    ? allRows.filter((item) => {
        const moneyFields = Object.entries(item).filter(([key]) => key.endsWith("Minor"));
        return !moneyFields.length || moneyFields.some(([, value]) => !reportValueIsZero(value));
      })
    : allRows;
  const hiddenColumns = new Set([
    "id",
    "accountId",
    "organizationId",
    "journalId",
    "drilldownUrl",
    "drillDownUrl"
  ]);
  const columns = rows.length
    ? Object.keys(rows[0])
        .filter((column) => !hiddenColumns.has(column))
        .slice(0, 10)
    : [];
  const hasDetails = rows.some(
    (item) =>
      (typeof (item.drillDownUrl ?? item.drilldownUrl) === "string" &&
        (item.drillDownUrl ?? item.drilldownUrl)) ||
      (reportName === "journals" && typeof item.id === "string" && item.id)
  );
  const displayColumns = hasDetails ? [...columns, "drillDownUrl"] : columns;
  elements["report-head"].replaceChildren(
    headerRow(displayColumns.map((column) => reportColumnLabel(column)))
  );
  const collapsed = currentReportState?.collapsedGroups ?? new Set();
  const renderedRows = [];
  for (const item of rows) {
    const groupKey = String(item.section ?? item.type ?? "details");
    if (collapsed.has(groupKey)) continue;
    const detailRow = row(
      displayColumns.map((column, columnIndex) => {
        if (column === "drillDownUrl") {
          const drilldownUrl =
            item.drillDownUrl ??
            item.drilldownUrl ??
            (reportName === "journals" && item.id
              ? `/v1/accountant/journals/${encodeURIComponent(item.id)}/trace`
              : null);
          if (!drilldownUrl) return "";
          const link = document.createElement("a");
          link.className = "report-detail-link";
          link.href = drilldownUrl.startsWith("/api/") ? drilldownUrl : `/api${drilldownUrl}`;
          link.textContent = "View details";
          link.setAttribute("data-report-row-id", item.id ?? item.accountId ?? "");
          link.addEventListener("click", (event) => {
            event.preventDefault();
            void openReportDrilldown(
              item,
              reportName,
              item.accountName ?? item.description ?? item.id
            );
          });
          return link;
        }
        const rowCurrency =
          item.currency ?? report.currency ?? multiCurrencyState?.baseCurrency ?? "CAD";
        if (column.endsWith("Minor")) {
          const money = reportMoneyCell(item[column], rowCurrency);
          money.parentElement?.classList.add("report-numeric-cell");
          return money;
        }
        if (columnIndex === 0 && (item.section || item.type)) {
          const groupButton = document.createElement("button");
          groupButton.type = "button";
          groupButton.className = "report-group-toggle";
          groupButton.textContent = reportCell(item[column]);
          groupButton.setAttribute("aria-expanded", String(!collapsed.has(groupKey)));
          groupButton.title = `Collapse ${groupKey} group`;
          groupButton.addEventListener("click", () => {
            if (collapsed.has(groupKey)) collapsed.delete(groupKey);
            else collapsed.add(groupKey);
            currentReportState.collapsedGroups = collapsed;
            renderReport(reportName, report);
          });
          return groupButton;
        }
        return reportCell(item[column]);
      })
    );
    detailRow.dataset.reportGroup = groupKey;
    detailRow.querySelectorAll(".report-money").forEach((money) => {
      money.parentElement?.classList.add("report-numeric-cell");
    });
    renderedRows.push(detailRow);
  }
  elements["report-body"].replaceChildren(...renderedRows);
  elements["report-status"].textContent =
    `${formatRole(reportName)}: ${rows.length} detail row${rows.length === 1 ? "" : "s"}${hideZero && rows.length !== allRows.length ? ` (${allRows.length - rows.length} zero rows hidden)` : ""}.`;
}

function reportColumnLabel(column) {
  const labels = {
    accountCode: "Code",
    accountName: "Account",
    amountMinor: "Amount",
    balanceMinor: "Balance",
    debitMinor: "Debit",
    creditMinor: "Credit",
    drillDownUrl: "Details",
    effectiveDate: "Date",
    invoiceNumber: "Invoice",
    vendorInvoiceNumber: "Vendor invoice"
  };
  return labels[column] ?? formatRole(column.replace(/Minor$/, ""));
}

function reportRows(reportName, report) {
  if (Array.isArray(report.rows)) return report.rows;
  if (Array.isArray(report.lines)) return report.lines;
  if (Array.isArray(report.journals)) return report.journals;
  if (Array.isArray(report.invoices)) return report.invoices;
  if (Array.isArray(report.bills)) return report.bills;
  if (Array.isArray(report.detail)) return report.detail;
  if (reportName === "cash-flow" && report.categories)
    return Object.entries(report.categories).map(([category, amountMinor]) => ({
      category,
      amountMinor
    }));
  return Object.entries(report)
    .filter(([, value]) => typeof value !== "object")
    .map(([field, value]) => ({ field, value }));
}

function reportCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// A sales tax return is prepared per authority, so this exports the grouped
// figures rather than the line detail the generic export produces.
function exportTaxByAuthority() {
  const data = new FormData(elements["report-filter-form"]);
  const query = new URLSearchParams({
    from: data.get("from") ?? "",
    to: data.get("to") ?? "",
    asOf: data.get("asOf") ?? "",
    basis: data.get("basis") ?? "ACCRUAL"
  });
  window.location.assign(`/api/v1/reports/exports/tax-by-authority.csv?${query}`);
}

function exportSelectedReport() {
  const data = new FormData(elements["report-filter-form"]);
  const reportName = data.get("reportName");
  if (!exportableReports.has(reportName)) return;
  const query = new URLSearchParams({
    from: data.get("from"),
    to: data.get("to"),
    asOf: data.get("asOf"),
    basis: data.get("basis")
  });
  window.location.assign(`/api/v1/reports/exports/${reportName}.csv?${query}`);
}
