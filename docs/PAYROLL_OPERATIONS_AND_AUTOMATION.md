# Payroll operations and scheduled drafts

Status: controlled CA-AB regular-pay workflow; no direct deposit, government filing, or
money movement.

This guide documents what PennyWise Accounting can safely automate today and the controls
that remain intentionally human or provider-gated. It is an operations guide, not payroll,
tax, employment, or legal advice.

## Current supported workflow

For a Canada--Alberta regular pay run, an authorized accountant can:

1. Configure one expense account, a separate payroll-remittance liability account, and a
   separate net-pay-clearing liability account.
2. Add or verify the exact CA-AB statutory base code set. The product checks each required
   code and category; a generic count of payroll codes never unlocks calculation.
3. Add effective-dated workers and compensation without placing government identifiers or
   bank details in the browser form.
4. Add a pay schedule and an explicit pay period.
5. Create a **DRAFT** manually or, for an enabled schedule with a saved explicit period,
   have a narrow automation credential prepare the draft when its lead window begins.
6. Have a person calculate, review, approve, and post the run. Posting records the journal,
   payslip snapshot, and remittance records only. It does not pay people or submit a return.

The scheduled action never invents a period, hours, earnings, pay date, or jurisdiction. It
fails closed when a worker lacks effective compensation, an hourly default, or a released
CA-AB profile. It never calculates, approves, posts, exports payment instructions, sends
funds, or files taxes.

## Scheduler credential and command

Create a dedicated organization API credential named, for example, `Payroll scheduled-draft
runner`. Its only delegated scope must be:

```text
payroll:automation
```

The scope is intentionally unable to call the arbitrary-draft, calculate, review, approve,
post, payment-export, or filing paths. The credential is organization-bound, expiring,
revocable, and audited. Its one-time secret must be copied directly into an approved secret
manager or Windows Credential Manager; never use a browser session cookie, commit it to a
repository, add it to a shortcut, or paste it into a shared ticket.

Set these environment values in the scheduler's protected execution context:

```text
PENNYWISE_PAYROLL_AUTOMATION_URL=https://your-host.example/api/v1/payroll/automation/run
PENNYWISE_PAYROLL_AUTOMATION_TOKEN=cl_live_<one-time-credential-secret>
PENNYWISE_PAYROLL_AUTOMATION_AS_OF_DATE=2026-08-12   # optional; defaults to UTC today
```

Then run:

```powershell
corepack pnpm payroll:automation
```

The command accepts HTTPS endpoints (or loopback HTTP only for local development), validates
the fixed payroll automation route, sends only the as-of date, times out after 30 seconds,
and prints only safe counts such as `created`, `alreadyPrepared`, `notDue`, and `blocked`.
It never logs a credential, worker, account, pay amount, bank value, or provider payload.

Run it no more than once per day per organization unless an operator is investigating a
documented outage. Repeating it is idempotent: an already-created run is reported as already
prepared rather than duplicated. Revoke or rotate the credential immediately when the task
is disabled, the device changes ownership, an operator leaves, or a secret might have been
exposed.

For the beta, use a stable internal/hosted endpoint rather than a temporary loclx tunnel.
A tunnel is useful for supervised testing but is not a production scheduler boundary.

## Required human review

Before a draft advances, the reviewer must verify the workers, period dates, gross wages,
deductions, employer cost, net pay, rule-pack version, and warnings. Approval and posting
are separate permissions and carry their own audit trail. A payroll exception must be
corrected through the payroll workflow, not an unrelated manual journal.

## Jurisdiction and provider limits

- **Released posting:** CA-AB regular payroll only.
- **Validation only:** CA-QC and a limited 2026 US-FEDERAL calculation boundary. PennyWise
  does not post a U.S. run because a complete state/local withholding, unemployment,
  paid-leave, workers' compensation, work-location, and filing pack is not released.
- **Direct deposit:** disconnected. A payment batch/export is not proof of payment and does
  not move funds. The product-level legal/privacy review is recorded as passed in
  `distribution/public-beta/RELEASE_EVIDENCE.md`; that sign-off does not replace
  provider-adapter legal/security acceptance. The API overview now exposes a stable
  `capabilities.providerGates.directDeposit` contract with non-secret blocker codes and
  required evidence. It remains `PROVIDER_REQUIRED` until an approved adapter, bank
  acceptance, tenant consent, idempotent acknowledgement, and reconciliation evidence exist.
- **Tax filing/remittance payment:** disconnected. Remittance records are reviewable
  liabilities; CRA, Revenu Québec, IRS, state, provincial, and bank submission require an
  approved provider, credentials, provider-adapter legal/security review, reconciliation evidence, and an
  explicit production gate. The API overview exposes the corresponding
  `capabilities.providerGates.taxFiling` contract; configuration alone cannot enable it.

The provider-gate contract is deliberately descriptive rather than an enablement switch. It
contains no provider credentials, bank details, or filing payloads, and its fail-closed blocker
codes are suitable for release evidence and UI guidance. Future provider work must add an
organization-scoped adapter, idempotent submission/receipt records, and focused authorization,
tenant-isolation, retry, and legally reviewed fixture coverage before changing either gate to
`READY`.

The regulatory sources that define these boundaries include the [CRA employer payroll
guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html),
[IRS Publication 15](https://www.irs.gov/publications/p15), and [IRS Publication
15-T](https://www.irs.gov/publications/p15t).

## U.S. payroll release gate

The 2026 U.S. federal publications are useful source evidence, but they are not a complete
U.S. payroll product specification. Publication 15 covers federal employer duties including
FICA/FUTA context; Publication 15-T specifies federal income-tax withholding methods. A
released U.S. payroll run also needs effective-dated state and local withholding tables,
state unemployment and disability programs, paid-leave/workers'-compensation rules,
reciprocity/residency treatment, new-hire and year-end reporting, payment/funding controls,
and jurisdiction-specific filing receipts. Every supported work location must have a tested
rule pack, a legal review, and an approved filing/payment provider path before PennyWise can
calculate-and-post or claim automation for it.

The scheduled-draft mechanism is intentionally reusable for this future work: it may prepare
an explicit, reviewed period, but it cannot turn a missing legal rule pack into a payment,
filing, or posted payroll run.

## Verification evidence

Run these from the repository root against the isolated test database:

```powershell
corepack pnpm --filter @clearledger/api run typecheck
$env:TEST_DATABASE_URL="postgresql://clearledger:clearledger_dev_only@127.0.0.1:5433/clearledger_test?schema=public"
$env:DATABASE_URL=$env:TEST_DATABASE_URL
corepack pnpm --filter @clearledger/api exec vitest run --config vitest.integration.config.ts src/payroll-api.integration.test.ts src/payroll-core.integration.test.ts
node --test scripts/payroll-draft-automation-client.test.mjs
corepack pnpm run test:e2e -- apps/web/e2e/payroll-scheduled-draft.spec.ts
```

The API coverage proves that a `payroll:automation` credential can prepare a due draft but
is denied an arbitrary draft; it also proves no journal is created. The browser matrix
starts with a genuinely blank company, applies a chart preset, configures payroll, creates a
worker/schedule/draft, and calculates it across Chrome, Edge, Firefox, mobile Chrome, and
mobile WebKit.
