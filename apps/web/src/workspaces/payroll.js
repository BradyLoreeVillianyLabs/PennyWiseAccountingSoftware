// Payroll (`payroll-workspace`).

import { formatMinor, parseMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { metric, row } from "../lib/dom.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import { registerWorkspaceCalls } from "../lib/workspace-calls.js";
import { printWorkspace } from "../shell.js";
import { accounts, activeWorkspaceId, elements, identity } from "../state.js";

let payrollState = null;
let activePayrollRun = null;
let payrollLoadRequestId = 0;

registerWorkspaceCalls({ loadPayroll, renderPayrollAccountOptions });

export function initPayroll() {
  elements["refresh-payroll"].addEventListener("click", loadPayroll);
  elements["print-payroll"].addEventListener("click", () => printWorkspace("payroll-workspace"));
  elements["payroll-settings-form"].addEventListener("submit", savePayrollSettings);
  elements["ensure-ca-ab-payroll-codes"].addEventListener("click", ensureCaAbPayrollCodes);
  elements["payroll-worker-form"].addEventListener("submit", createPayrollWorker);
  elements["payroll-schedule-form"].addEventListener("submit", createPayrollSchedule);
  elements["payroll-period-form"].addEventListener("submit", createPayrollPeriod);
  elements["payroll-scheduled-draft-form"].addEventListener("submit", createScheduledPayrollDraft);
  elements["payroll-automation-form"].addEventListener("submit", runPayrollDraftAutomation);
}

function payrollToday() {
  return new Date().toISOString().slice(0, 10);
}

function payrollRequest(body, method = "POST") {
  return {
    ...jsonRequest(body, method),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  };
}

function setPayrollFormDisabled(formId, disabled) {
  const form = elements[formId];
  if (!form) return;
  for (const control of form.querySelectorAll("input, select, textarea, button")) {
    control.disabled = disabled;
  }
}

function replacePayrollOptions(select, options, selectedValue = select?.value ?? "") {
  if (!select) return;
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = options.length ? "Choose..." : "No choices available";
  select.replaceChildren(
    empty,
    ...options.map((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      return option;
    })
  );
  select.value = options.some((item) => item.value === selectedValue) ? selectedValue : "";
}

function payrollCodeReadinessSummary(readiness) {
  if (!readiness) return "The CA-AB base code check is unavailable.";
  if (readiness.ready)
    return `CA-AB base code set is ready (${payrollState?.activePayrollCodeCount ?? 0} active payroll codes total).`;
  const missing = readiness.missing?.length ? `Missing: ${readiness.missing.join(", ")}.` : "";
  const invalid = readiness.invalid?.length
    ? `Wrong category: ${readiness.invalid.map((item) => item.code).join(", ")}.`
    : "";
  return ["CA-AB base code set needs attention.", missing, invalid].filter(Boolean).join(" ");
}

function renderPayrollAccountOptions() {
  const settings = payrollState?.settings;
  const accountOptions = (accountType) =>
    accounts
      .filter((account) => account.type === accountType)
      .map((account) => ({
        value: account.id,
        label: `${account.code} ${account.name}`
      }));
  const expenseOptions = accountOptions("EXPENSE");
  const liabilityOptions = accountOptions("LIABILITY");
  const form = elements["payroll-settings-form"];
  replacePayrollOptions(
    form?.elements.defaultExpenseAccountId,
    expenseOptions,
    settings?.defaultExpenseAccountId ?? form?.elements.defaultExpenseAccountId?.value
  );
  replacePayrollOptions(
    form?.elements.defaultLiabilityAccountId,
    liabilityOptions,
    settings?.defaultLiabilityAccountId ?? form?.elements.defaultLiabilityAccountId?.value
  );
  replacePayrollOptions(
    form?.elements.netPayClearingAccountId,
    liabilityOptions,
    settings?.netPayClearingAccountId ?? form?.elements.netPayClearingAccountId?.value
  );
  if (settings) {
    form.elements.calculationRulePackId.value = settings.calculationRulePackId;
    form.elements.calculationRulePackVersion.value = settings.calculationRulePackVersion;
  }
  const canConfigure =
    expenseOptions.length > 0 &&
    liabilityOptions.length > 1 &&
    Boolean(identity?.activeOrganizationId);
  for (const control of form.querySelectorAll("select, button")) control.disabled = !canConfigure;
  elements["payroll-code-status"].textContent = settings
    ? payrollCodeReadinessSummary(payrollState.caAbBaseCodes)
    : expenseOptions.length && liabilityOptions.length > 1
      ? "Save the three ledger accounts before adding people or schedules."
      : "Add at least one expense account and two liability accounts before configuring payroll.";
  elements["ensure-ca-ab-payroll-codes"].disabled = !settings;
}

function renderPayrollScheduleOptions() {
  const options = (payrollState?.schedules ?? []).map((schedule) => ({
    value: schedule.id,
    label: `${schedule.name} (${formatRole(schedule.frequency)})`
  }));
  for (const formId of ["payroll-period-form", "payroll-scheduled-draft-form"]) {
    const select = elements[formId]?.elements.scheduleId;
    replacePayrollOptions(select, options, select?.value);
  }
}

function setPayrollDefaultDates() {
  const today = payrollToday();
  for (const formId of [
    "payroll-worker-form",
    "payroll-schedule-form",
    "payroll-period-form",
    "payroll-scheduled-draft-form",
    "payroll-automation-form"
  ]) {
    const form = elements[formId];
    if (!form) continue;
    for (const fieldName of [
      "effectiveFrom",
      "anchorPayDate",
      "periodStart",
      "periodEnd",
      "payDate",
      "asOfDate"
    ]) {
      if (form.elements[fieldName] && !form.elements[fieldName].value)
        form.elements[fieldName].value = today;
    }
  }
}

export async function loadPayroll() {
  if (!identity?.activeOrganizationId) return;
  const requestId = ++payrollLoadRequestId;
  const response = await api("/v1/payroll/overview", {}, true);
  if (requestId !== payrollLoadRequestId) return;
  if (!response.ok) {
    payrollState = null;
    activePayrollRun = null;
    renderPayroll();
    if (activeWorkspaceId === "payroll-workspace") await showError(response);
    return;
  }
  payrollState = (await response.json()).payroll;
  renderPayroll();
}

function renderPayroll() {
  setPayrollDefaultDates();
  renderPayrollAccountOptions();
  renderPayrollScheduleOptions();
  const unavailable = !payrollState;
  elements["payroll-status"].textContent = unavailable
    ? "Payroll information is unavailable for this company or your current role."
    : payrollState.settings
      ? "Payroll is configured for controlled CA-AB regular-pay workflow. Direct deposit and tax filing remain provider-gated."
      : "Start with the three payroll ledger accounts. No payroll run can be prepared until that setup is saved.";
  const state = payrollState;
  const workingRuns = (state?.runs ?? []).filter((run) => run.status !== "POSTED");
  elements["payroll-summary"].replaceChildren(
    metric("Setup", state?.settings ? "Ready" : "Needs setup"),
    metric("People", state?.workers?.length ?? 0),
    metric("Open runs", workingRuns.length),
    metric("Open remittances", state?.openRemittances?.length ?? 0)
  );
  renderPayrollWorkers();
  renderPayrollSchedules();
  renderPayrollRemittances();
  renderPayrollRuns();
  const configured = Boolean(state?.settings);
  const hasSchedules = Boolean(state?.schedules?.length);
  setPayrollFormDisabled("payroll-worker-form", !configured);
  setPayrollFormDisabled("payroll-schedule-form", !configured);
  setPayrollFormDisabled("payroll-period-form", !configured || !hasSchedules);
  setPayrollFormDisabled("payroll-scheduled-draft-form", !configured || !hasSchedules);
  setPayrollFormDisabled("payroll-automation-form", !configured || !hasSchedules);
  if (state?.periods?.length) {
    const upcoming = [...state.periods]
      .filter((period) => period.payDate >= payrollToday())
      .sort((left, right) => left.payDate.localeCompare(right.payDate))
      .slice(0, 3);
    elements["payroll-automation-status"].textContent = upcoming.length
      ? `${state.periods.length} explicit period${state.periods.length === 1 ? "" : "s"} saved. Next: ${upcoming.map((period) => `${period.schedule?.name ?? "Schedule"} ${period.payDate}`).join("; ")}.`
      : `${state.periods.length} explicit period${state.periods.length === 1 ? "" : "s"} saved. Add the next pay period before it becomes due.`;
  } else {
    elements["payroll-automation-status"].textContent = configured
      ? "No explicit pay periods are saved yet. Create one before using scheduled drafts."
      : "Finish payroll setup before planning a pay period.";
  }
  renderPayrollRunDetail();
}

function renderPayrollWorkers() {
  const workers = payrollState?.workers ?? [];
  elements["payroll-workers"].replaceChildren(
    ...workers.map((worker) =>
      row([
        `${worker.displayName}\n${worker.workerNumber}`,
        formatRole(worker.kind),
        worker.governmentIdMask || worker.bankAccountMask
          ? "Masked identifiers held outside this screen"
          : "No identifier or bank data in this browser"
      ])
    )
  );
  if (!workers.length) {
    const empty = row(["No payroll workers yet.", "", ""]);
    empty.querySelector("td").colSpan = 3;
    empty.deleteCell(2);
    empty.deleteCell(1);
    elements["payroll-workers"].append(empty);
  }
}

function renderPayrollSchedules() {
  const schedules = payrollState?.schedules ?? [];
  elements["payroll-schedules"].replaceChildren(
    ...schedules.map((schedule) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary-command";
      action.textContent = schedule.automaticDraftsEnabled
        ? "Disable draft prep"
        : "Enable draft prep";
      action.title =
        "This changes only scheduled DRAFT preparation; it cannot calculate, post, pay, or file payroll.";
      action.addEventListener("click", () =>
        updatePayrollScheduleAutomation(schedule, !schedule.automaticDraftsEnabled)
      );
      return row([
        `${schedule.name}\n${schedule.code}`,
        formatRole(schedule.frequency),
        schedule.automaticDraftsEnabled
          ? `Enabled ${schedule.draftLeadDays} day${schedule.draftLeadDays === 1 ? "" : "s"} before pay date`
          : "Off",
        action
      ]);
    })
  );
  if (!schedules.length) {
    const empty = row(["No pay schedules yet.", "", "", ""]);
    empty.querySelector("td").colSpan = 4;
    empty.deleteCell(3);
    empty.deleteCell(2);
    empty.deleteCell(1);
    elements["payroll-schedules"].append(empty);
  }
}

function payrollListEmpty(text) {
  const item = document.createElement("p");
  item.className = "field-help";
  item.textContent = text;
  return item;
}

function renderPayrollRemittances() {
  const remittances = payrollState?.openRemittances ?? [];
  elements["payroll-remittances"].replaceChildren(
    ...(remittances.length
      ? remittances.map((item) => {
          const line = document.createElement("div");
          line.className = "payroll-compact-list-item";
          const label = document.createElement("strong");
          label.textContent = `${item.authorityCode} due ${item.dueDate}`;
          const detail = document.createElement("span");
          detail.textContent = `${formatMinor(item.amountMinor, item.run.currency)} · ${formatRole(item.status)} · ${item.run.runNumber}`;
          line.append(label, detail);
          return line;
        })
      : [
          payrollListEmpty(
            "No open remittance records. Posting a reviewed run can create reviewable remittance liabilities."
          )
        ])
  );
  const batches = payrollState?.paymentBatches ?? [];
  elements["payroll-payment-batches"].replaceChildren(
    ...(batches.length
      ? batches.map((item) => {
          const line = document.createElement("div");
          line.className = "payroll-compact-list-item";
          const label = document.createElement("strong");
          label.textContent = `${item.batchNumber} · ${formatRole(item.status)}`;
          const detail = document.createElement("span");
          detail.textContent = `${formatMinor(item.totalMinor, item.run.currency)} · ${item.paymentDate} · ${item.run.runNumber}`;
          line.append(label, detail);
          return line;
        })
      : [
          payrollListEmpty(
            "No payment batches. PennyWise Accounting does not initiate direct deposit or transfer funds."
          )
        ])
  );
}

function renderPayrollRuns() {
  const runs = payrollState?.runs ?? [];
  elements["payroll-runs"].replaceChildren(
    ...runs.map((run) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary-command";
      action.textContent = activePayrollRun?.id === run.id ? "Open" : "Review";
      action.addEventListener("click", () => openPayrollRun(run.id));
      return row([
        run.payDate,
        `${run.runNumber}\n${run.schedule?.name ?? formatRole(run.kind)}`,
        formatRole(run.status),
        run.workerCount,
        run.remittanceCount,
        action
      ]);
    })
  );
  if (!runs.length) {
    const empty = row(["No payroll runs yet.", "", "", "", "", ""]);
    empty.querySelector("td").colSpan = 6;
    for (let index = 0; index < 5; index += 1) empty.deleteCell(1);
    elements["payroll-runs"].append(empty);
  }
}

function renderPayrollRunDetail() {
  const detail = elements["payroll-run-detail"];
  const run = activePayrollRun;
  if (!run) {
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  elements["payroll-run-detail-heading"].textContent =
    `${run.runNumber} - ${formatRole(run.status)}`;
  elements["payroll-run-detail-summary"].textContent =
    `${run.periodStart} to ${run.periodEnd}; pay date ${run.payDate}; ${run.currency}.`;
  elements["payroll-run-workers"].replaceChildren(
    ...run.workers.map((worker) =>
      row([
        `${worker.worker.displayName}\n${worker.worker.workerNumber}`,
        worker.worker.jurisdictionCode,
        worker.draftGrossPayMinor == null
          ? "-"
          : formatMinor(worker.draftGrossPayMinor, run.currency),
        formatMinor(worker.grossPayMinor, run.currency),
        formatMinor(worker.employeeDeductionsMinor, run.currency),
        formatMinor(worker.netPayMinor, run.currency)
      ])
    )
  );
  const actions = elements["payroll-run-detail-actions"];
  actions.replaceChildren();
  const status = elements["payroll-run-detail-status"];
  const baseCodeReadiness = payrollState?.caAbBaseCodes;
  if (run.status === "DRAFT") {
    const calculate = document.createElement("button");
    calculate.type = "button";
    calculate.textContent = "Calculate payroll";
    calculate.disabled = !baseCodeReadiness?.ready;
    calculate.title = calculate.disabled
      ? "Add the released CA-AB base codes before calculating this draft."
      : "Calculate with the released CA-AB rule pack. This does not post or pay payroll.";
    calculate.addEventListener("click", () => performPayrollRunAction("calculate"));
    actions.append(calculate);
    status.textContent = calculate.disabled
      ? `This is a draft. ${payrollCodeReadinessSummary(baseCodeReadiness)}`
      : "This is a draft. Calculation creates an immutable result for review; it does not post, pay, or file anything.";
  } else if (run.status === "CALCULATED") {
    const review = document.createElement("button");
    review.type = "button";
    review.textContent = "Mark reviewed";
    review.addEventListener("click", () => performPayrollRunAction("review"));
    actions.append(review);
    status.textContent =
      "Review the worker totals and deductions. A different permitted reviewer may be required before approval.";
  } else if (run.status === "REVIEWED") {
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "Approve payroll";
    approve.addEventListener("click", () => performPayrollRunAction("approve"));
    actions.append(approve);
    status.textContent =
      "Approval is a separate controlled action. It still does not create a journal or move funds.";
  } else if (run.status === "APPROVED") {
    const post = document.createElement("button");
    post.type = "button";
    post.textContent = "Post to ledger";
    post.addEventListener("click", () => performPayrollRunAction("post"));
    actions.append(post);
    status.textContent =
      "Posting creates the accounting journal, payslip snapshot, and remittance records. Direct deposit and filing remain disconnected.";
  } else {
    status.textContent = run.journalId
      ? "Posted to the ledger. Any payment export must be handled through an approved provider workflow; PennyWise Accounting did not send funds."
      : "This payroll run is complete.";
  }
}

async function savePayrollSettings(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/payroll/settings",
    jsonRequest(
      {
        defaultExpenseAccountId: data.get("defaultExpenseAccountId"),
        defaultLiabilityAccountId: data.get("defaultLiabilityAccountId"),
        netPayClearingAccountId: data.get("netPayClearingAccountId"),
        calculationRulePackId: data.get("calculationRulePackId"),
        calculationRulePackVersion: data.get("calculationRulePackVersion")
      },
      "PUT"
    )
  );
  if (!response.ok) return showError(response);
  await loadPayroll();
  showNotice(
    "Payroll setup saved. Add the released CA-AB base code set before calculating a draft."
  );
}

async function ensureCaAbPayrollCodes() {
  const response = await api("/v1/payroll/ca-ab-base-codes", payrollRequest({}));
  if (!response.ok) return showError(response);
  const result = (await response.json()).payrollCodeSet;
  await loadPayroll();
  showNotice(
    result.created
      ? `${result.created} missing CA-AB base payroll code${result.created === 1 ? " was" : "s were"} added. Existing mappings were not changed.`
      : "The released CA-AB base code set is already present. Existing mappings were not changed."
  );
}

function parsePayrollHoursMicros(value) {
  const text = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,6})?$/.test(text))
    throw new Error("Enter hours as a number with up to six decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micros <= 0n) throw new Error("Hours per pay period must be greater than zero.");
  return micros.toString();
}

async function createPayrollWorker(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  let rateMinor;
  let hoursPerPeriodMicros;
  let additionalTaxMinor;
  try {
    rateMinor = parseMoneyInput(data.get("rate"));
    hoursPerPeriodMicros =
      data.get("compensationKind") === "HOURLY"
        ? parsePayrollHoursMicros(data.get("hoursPerPeriod"))
        : null;
    if (data.get("compensationKind") === "HOURLY" && !hoursPerPeriodMicros)
      throw new Error(
        "Hourly workers need default hours per pay period before a draft can be prepared."
      );
    additionalTaxMinor = String(data.get("additionalTax") ?? "").trim()
      ? parseMoneyInput(data.get("additionalTax"))
      : null;
  } catch (error) {
    return showNotice(
      error instanceof Error ? error.message : "Check worker compensation values.",
      true
    );
  }
  const response = await api(
    "/v1/payroll/workers",
    payrollRequest({
      workerNumber: data.get("workerNumber"),
      kind: data.get("kind"),
      displayName: data.get("displayName"),
      profile: {
        effectiveFrom: data.get("effectiveFrom"),
        status: "ACTIVE",
        jurisdictionCode: data.get("jurisdictionCode"),
        taxAttributes: {
          canadianWithholding: {
            federalClaimCode: Number(data.get("federalClaimCode")),
            provincialClaimCode: Number(data.get("provincialClaimCode")),
            ...(additionalTaxMinor ? { additionalTaxMinor } : {})
          }
        }
      },
      compensation: {
        effectiveFrom: data.get("effectiveFrom"),
        kind: data.get("compensationKind"),
        rateMinor,
        hoursPerPeriodMicros
      }
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  setPayrollDefaultDates();
  await loadPayroll();
  showNotice(
    "Payroll worker added. No government identifier or bank detail was collected in this browser."
  );
}

async function createPayrollSchedule(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const response = await api(
    "/v1/payroll/schedules",
    payrollRequest({
      code: data.get("code"),
      name: data.get("name"),
      frequency: data.get("frequency"),
      anchorPayDate: data.get("anchorPayDate"),
      automaticDraftsEnabled: data.get("automaticDraftsEnabled") === "on",
      draftLeadDays: Number(data.get("draftLeadDays"))
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  setPayrollDefaultDates();
  await loadPayroll();
  showNotice(
    "Pay schedule added. Scheduled preparation can create only reviewable drafts from explicit periods."
  );
}

async function updatePayrollScheduleAutomation(schedule, automaticDraftsEnabled) {
  const response = await api(
    `/v1/payroll/schedules/${schedule.id}/automation`,
    jsonRequest(
      {
        version: schedule.version,
        automaticDraftsEnabled,
        draftLeadDays: schedule.draftLeadDays
      },
      "PATCH"
    )
  );
  if (!response.ok) return showError(response);
  await loadPayroll();
  showNotice(
    automaticDraftsEnabled
      ? "Scheduled draft preparation enabled. It cannot calculate, approve, post, pay, or file payroll."
      : "Scheduled draft preparation disabled. Existing drafts were not changed."
  );
}

async function createPayrollPeriod(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/payroll/periods",
    jsonRequest({
      scheduleId: data.get("scheduleId"),
      periodStart: data.get("periodStart"),
      periodEnd: data.get("periodEnd"),
      payDate: data.get("payDate"),
      sequence: Number(data.get("sequence"))
    })
  );
  if (!response.ok) return showError(response);
  await loadPayroll();
  showNotice("Explicit pay period saved. It can now be prepared as a reviewable draft when due.");
}

async function createScheduledPayrollDraft(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const rawSequence = String(data.get("sequence") ?? "").trim();
  const response = await api(
    `/v1/payroll/schedules/${encodeURIComponent(String(data.get("scheduleId")))}/generate-draft`,
    payrollRequest({
      periodStart: data.get("periodStart"),
      periodEnd: data.get("periodEnd"),
      payDate: data.get("payDate"),
      ...(rawSequence ? { sequence: Number(rawSequence) } : {})
    })
  );
  if (!response.ok) return showError(response);
  activePayrollRun = (await response.json()).payrollRun;
  await loadPayroll();
  renderPayrollRunDetail();
  showNotice("Payroll draft prepared. Review the planned gross pay, then calculate it when ready.");
}

async function runPayrollDraftAutomation(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/payroll/automation/run",
    jsonRequest({ asOfDate: data.get("asOfDate") })
  );
  if (!response.ok) return showError(response);
  const result = (await response.json()).payrollAutomation;
  await loadPayroll();
  elements["payroll-automation-status"].textContent =
    `${result.checked} period${result.checked === 1 ? "" : "s"} checked; ${result.created.length} draft${result.created.length === 1 ? "" : "s"} prepared; ${result.alreadyPrepared.length} already prepared; ${result.notDue.length} not due; ${result.blocked.length} blocked.`;
  showNotice(
    "Due-period check complete. It prepared drafts only; no calculation, posting, payment, or filing occurred."
  );
}

async function openPayrollRun(runId) {
  const response = await api(`/v1/payroll/runs/${encodeURIComponent(runId)}`, {}, true);
  if (!response.ok) return showError(response);
  activePayrollRun = (await response.json()).payrollRun;
  renderPayrollRunDetail();
}

async function performPayrollRunAction(action) {
  const run = activePayrollRun;
  if (!run) return;
  const path = `/v1/payroll/runs/${encodeURIComponent(run.id)}/${action === "review" ? "review" : action === "approve" ? "approve" : action === "post" ? "post" : "calculate"}`;
  const request =
    action === "calculate"
      ? jsonRequest({})
      : action === "post"
        ? payrollRequest({ version: run.version })
        : jsonRequest({ version: run.version });
  const response = await api(path, request);
  if (!response.ok) return showError(response);
  activePayrollRun = (await response.json()).payrollRun;
  await loadPayroll();
  renderPayrollRunDetail();
  const labels = {
    calculate: "Payroll calculated for review. No journal was posted and no funds moved.",
    review: "Payroll marked reviewed. Approval remains a separate controlled action.",
    approve: "Payroll approved. Posting to the ledger remains a separate controlled action.",
    post: "Payroll posted to the ledger. No direct deposit or filing was initiated."
  };
  showNotice(labels[action]);
}
