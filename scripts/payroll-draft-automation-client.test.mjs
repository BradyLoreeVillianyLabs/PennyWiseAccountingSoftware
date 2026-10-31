import assert from "node:assert/strict";
import test from "node:test";
import {
  payrollAutomationAsOfDate,
  payrollAutomationConfig,
  runPayrollDraftAutomation
} from "./payroll-draft-automation-client.mjs";

const validEnvironment = {
  PENNYWISE_PAYROLL_AUTOMATION_URL: "https://pennywise.example.test/api/v1/payroll/automation/run",
  PENNYWISE_PAYROLL_AUTOMATION_TOKEN: "cl_live_scheduler-token",
  PENNYWISE_PAYROLL_AUTOMATION_AS_OF_DATE: "2026-08-12"
};

test("payroll automation accepts only a scoped secure endpoint and calendar date", () => {
  assert.deepEqual(payrollAutomationConfig(validEnvironment), {
    endpoint: "https://pennywise.example.test/api/v1/payroll/automation/run",
    token: "cl_live_scheduler-token",
    asOfDate: "2026-08-12"
  });
  assert.equal(
    payrollAutomationAsOfDate(undefined, new Date("2026-08-12T18:00:00.000Z")),
    "2026-08-12"
  );
  assert.throws(
    () =>
      payrollAutomationConfig({
        ...validEnvironment,
        PENNYWISE_PAYROLL_AUTOMATION_URL:
          "http://pennywise.example.test/api/v1/payroll/automation/run"
      }),
    /HTTPS/
  );
  assert.throws(() => payrollAutomationAsOfDate("2026-02-30"), /calendar date/);
});

test("payroll automation sends only the as-of date and reports safe result counts", async () => {
  const requests = [];
  const result = await runPayrollDraftAutomation(validEnvironment, async (url, request) => {
    requests.push({ url, request });
    return new Response(
      JSON.stringify({
        payrollAutomation: {
          checked: 4,
          created: ["one"],
          alreadyPrepared: ["two"],
          notDue: ["three"],
          blocked: ["four"]
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
  assert.deepEqual(result, {
    asOfDate: "2026-08-12",
    checked: 4,
    created: 1,
    alreadyPrepared: 1,
    notDue: 1,
    blocked: 1
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, validEnvironment.PENNYWISE_PAYROLL_AUTOMATION_URL);
  assert.deepEqual(JSON.parse(requests[0].request.body), { asOfDate: "2026-08-12" });
  assert.match(requests[0].request.headers.authorization, /^Bearer cl_live_/);
});

test("payroll automation surfaces a safe API error without returning a response body", async () => {
  await assert.rejects(
    () =>
      runPayrollDraftAutomation(
        validEnvironment,
        async () =>
          new Response(
            JSON.stringify({ error: { message: "Scope denied" }, secret: "do-not-log" }),
            {
              status: 403,
              headers: { "content-type": "application/json" }
            }
          )
      ),
    /Scope denied/
  );
});
