import { randomUUID } from "node:crypto";

const endpointPath = "/v1/payroll/automation/run";

export function payrollAutomationConfig(environment = process.env) {
  const endpointValue = requiredEnvironment(environment, "PENNYWISE_PAYROLL_AUTOMATION_URL");
  const token = requiredEnvironment(environment, "PENNYWISE_PAYROLL_AUTOMATION_TOKEN");
  if (!token.startsWith("cl_live_"))
    throw new Error(
      "PENNYWISE_PAYROLL_AUTOMATION_TOKEN must be a scoped PennyWise API credential."
    );
  const endpoint = new URL(endpointValue);
  if (!["https:", "http:"].includes(endpoint.protocol))
    throw new Error(
      "PENNYWISE_PAYROLL_AUTOMATION_URL must use HTTPS (or local HTTP for development)."
    );
  if (!isLocalHost(endpoint.hostname) && endpoint.protocol !== "https:")
    throw new Error("PENNYWISE_PAYROLL_AUTOMATION_URL must use HTTPS outside local development.");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error(
      "PENNYWISE_PAYROLL_AUTOMATION_URL must not include credentials, query values, or fragments."
    );
  if (!endpoint.pathname.endsWith(endpointPath))
    throw new Error(`PENNYWISE_PAYROLL_AUTOMATION_URL must end with ${endpointPath}.`);
  return {
    endpoint: endpoint.toString(),
    token,
    asOfDate: payrollAutomationAsOfDate(environment.PENNYWISE_PAYROLL_AUTOMATION_AS_OF_DATE)
  };
}

export function payrollAutomationAsOfDate(value, now = new Date()) {
  const date = String(value ?? now.toISOString().slice(0, 10)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("PENNYWISE_PAYROLL_AUTOMATION_AS_OF_DATE must use YYYY-MM-DD.");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error("PENNYWISE_PAYROLL_AUTOMATION_AS_OF_DATE is not a calendar date.");
  return date;
}

export async function runPayrollDraftAutomation(
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (typeof fetchImplementation !== "function")
    throw new Error("A Fetch implementation is required.");
  const config = payrollAutomationConfig(environment);
  const response = await fetchImplementation(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "PennyWise-Payroll-Draft-Automation/1.0",
      "x-request-id": `payroll-draft-${randomUUID()}`
    },
    body: JSON.stringify({ asOfDate: config.asOfDate }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = safeErrorMessage(payload) ?? `Request failed with HTTP ${response.status}.`;
    throw new Error(`Payroll scheduled-draft request was rejected: ${message}`);
  }
  const automation = payload?.payrollAutomation;
  if (!automation || typeof automation !== "object")
    throw new Error("Payroll scheduled-draft response did not contain an automation result.");
  return {
    asOfDate: config.asOfDate,
    checked: counted(automation.checked),
    created: countArray(automation.created),
    alreadyPrepared: countArray(automation.alreadyPrepared),
    notDue: countArray(automation.notDue),
    blocked: countArray(automation.blocked)
  };
}

function requiredEnvironment(environment, key) {
  const value = String(environment[key] ?? "").trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.toLowerCase());
}

function safeErrorMessage(payload) {
  const value = payload?.error?.message;
  return typeof value === "string" && value.length <= 500
    ? value.replaceAll(/[\r\n]+/g, " ").trim()
    : null;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function counted(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
