# UI v2 API summary stream report

Date: 2026-11-02

Stream: `api-summary` / issue [#4](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/4)

Branch: `ui/api-summary`

## Result

Implemented four tenant-scoped, read-only GET route groups:

- `GET /v1/ui/home-summary?asOf=YYYY-MM-DD` composes the existing posted-ledger profit/loss,
  cash-flow, banking, receivables, and payables reports. Cash in/out are the positive and negative
  posted cash movements for the trailing 30 days; profit is compared month-to-date with the prior
  month-to-date period. The trend contains 12 monthly income/expense points.
- `GET /v1/ui/attention-queue?asOf=YYYY-MM-DD` returns up to five dated overdue invoice, near-due
  bill, bank review/reconciliation, payroll remittance, or failed connector items with workspace
  and target IDs.
- `GET /v1/ui/landing/{sales|expenses|banking|contacts|taxes}?asOf=YYYY-MM-DD` returns the
  requested module KPIs and available pipeline counts. Report-derived monetary KPIs use the
  organization's base currency and minor-unit strings.
- `GET /v1/ui/tax-calendar?asOf=YYYY-MM-DD` returns recorded open payroll remittances due in the
  following 90 days for roles with `payroll:read`.

All routes use the existing organization-context resolver and dashboard read permission. Their
responses set `Cache-Control: private, no-store`. The v1 OpenAPI document lists the routes and
date/module parameters. No schema, migration, posting, or UI files changed.

## Known source-data blocker

The current schema stores tax registration type, jurisdiction, registered state, and effective
dates, but it has no GST/HST filing frequency, return periods, next filing date, or filed-return
history. The tax calendar therefore returns an empty `gstHstFilingDates` list and
`gstHstAvailability: "filing-frequency-not-configured"`; the taxes landing does not invent a due
date or last-filed value. Filling that part of the UI v2 requirement needs an approved data-source
or schema task. Payroll remittance dates are returned only when recorded in the existing
`PayrollRemittance` data and visible to the caller's role.

## Example

The following is a focused response example from the fixed test fixture (CAD, minor units):

```json
{
  "summary": {
    "asOf": "2026-03-31",
    "currency": "CAD",
    "cashOnHandMinor": "25000",
    "moneyIn30d": {
      "amountMinor": "25000",
      "previousPeriodMinor": "0",
      "changeMinor": "25000"
    },
    "moneyOut30d": {
      "amountMinor": "0",
      "previousPeriodMinor": "0",
      "changeMinor": "0"
    },
    "profitMtd": {
      "amountMinor": "25000",
      "previousPeriodMinor": "0",
      "changeMinor": "25000"
    },
    "receivablesAging": {
      "current": "0",
      "days1To30": "0",
      "days31To60": "0",
      "days61To90": "0",
      "over90": "0"
    },
    "payablesAging": {
      "current": "0",
      "days1To30": "0",
      "days31To60": "0",
      "days61To90": "0",
      "over90": "0"
    },
    "incomeExpense12Months": [
      { "from": "2025-04-01", "to": "2025-04-30", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-05-01", "to": "2025-05-31", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-06-01", "to": "2025-06-30", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-07-01", "to": "2025-07-31", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-08-01", "to": "2025-08-31", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-09-01", "to": "2025-09-30", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-10-01", "to": "2025-10-31", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-11-01", "to": "2025-11-30", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2025-12-01", "to": "2025-12-31", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2026-01-01", "to": "2026-01-31", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2026-02-01", "to": "2026-02-28", "incomeMinor": "0", "expenseMinor": "0" },
      { "from": "2026-03-01", "to": "2026-03-31", "incomeMinor": "25000", "expenseMinor": "0" }
    ],
    "source": "posted-ledger-and-existing-reports"
  }
}
```

## Focused research note

ERPNext's accounting reports document matching company/date filters and drill-through to source
documents; Frappe Books states reports present submitted data without changing it. PennyWise keeps
that read-only report boundary and uses its existing report services as the source. See [ERPNext
Accounting Reports](https://docs.frappe.io/erpnext/accounting-reports) and [Frappe Books Reports](https://docs.frappe.io/books/reports).

The shared `reporting-budgeting-and-insights` catalog entry was not edited because this stream owns
API route modules and tests. The module research stream or a follow-up issue should record the new
API-summary interaction contract and focused test location in that shared catalog.

## Validation

- `corepack pnpm --filter @clearledger/api test` — passed, 52 files / 292 tests.
- Stream UI-summary integration test — passed, 2 tests. It compares home cash, profit, cash movement,
  income trend, aging buckets, and module financial KPIs with their existing report endpoints; it
  also covers tenant separation, non-member rejection, all five landing modules, the calendar,
  invalid module rejection, and no-store headers.
- `corepack pnpm test:integration` — 47 files passed and 2 failed (257 passed / 2 failed tests out
  of 259). The failures are in unrelated existing tests:
  `recurring-invoice-materialization.integration.test.ts` (expected one invoice, got two) and
  `automation-job-runner.integration.test.ts` (expected one interval claim, got two). Both failures
  repeated when those files were rerun by themselves.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm build` — passed.
- `corepack pnpm db:validate` — passed.
- `corepack pnpm test:research` — passed; the repository verifier checked 21 module baselines.
- Prettier on all stream-changed files — passed. Repository-wide `corepack pnpm format:check` is
  blocked by the unchanged `docs/status/PB0_FIRST_COMMIT_INVENTORY.md`.
- `git diff --check` — passed.
