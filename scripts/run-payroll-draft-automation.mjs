import { runPayrollDraftAutomation } from "./payroll-draft-automation-client.mjs";

try {
  const result = await runPayrollDraftAutomation();
  // Deliberately report counts only. The runner never logs a credential, worker,
  // pay amount, account, or provider payload.
  console.log(`PAYROLL_DRAFT_AUTOMATION ${JSON.stringify(result)}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown payroll automation failure.";
  console.error(`PAYROLL_DRAFT_AUTOMATION_FAILED ${message}`);
  process.exitCode = 1;
}
