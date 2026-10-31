# I6 background job runner completion report

**Prompt:** `I6-background-job-runner.md`  
**Date:** 2026-09-11  
**Repository:** `C:\Users\EmceeHax\Desktop\clearledger-src`

## Outcome

I6 is complete for the local-process automation scope. PennyWise now has a
small, database-backed background runner that starts with the API, catches up
after launch, claims work with per-organization leases, records runs, retries
transient failures with bounded exponential backoff, and dead-letters repeated
failures. The runner stops cleanly and releases its leases.

This is not an OS wake service: installed builds run automation while PennyWise
is open on that computer. At the I6 completion boundary, I7 recurring invoices
and I8 customer reminders were registered as visibly unavailable reservations.
I7 subsequently enabled recurring invoice generation, and I8 now enables the
customer-reminder body only when provider email is configured. This historical
I6 report does not claim I8 verification; see the I8 report for its current
implementation and unrun database gate.

## Implemented scope

- Added `AutomationJobLease` and `AutomationJobRun` tables, indexes, foreign
  keys, RLS policies, and the restricted runtime discovery function in
  migration `20260911180000_automation_job_runner`.
- Added `apps/api/src/jobs/automation-job-runner.ts` with atomic lease claims,
  bounded batches, run logging, retry/dead-letter state, pause controls,
  startup catch-up, and graceful lease release.
- Scheduled the existing payment webhook and receipt outbox work, outbound
  webhook delivery, invoice and estimate delivery retries, payroll due drafts,
  and hosted-checkout expiry where a cancellation-capable provider is present.
- Changed failed payment-webhook outbox rows to remain replayable while their
  bounded attempt count has not been exhausted.
- Added owner/admin Automations API routes for status, Run now, and pause or
  resume, plus the Settings/Final Review Automations panel.
- Added `/ready` recovery gating. Liveness remains available while startup
  recovery runs, but readiness is not successful until recovery is complete.
- Added the `JOBS_ENABLED=false` kill switch and shutdown handling in
  `apps/api/src/index.ts`.
- Added the job-runner ADR and updated the competitive research matrix. The
  selected design uses the existing PostgreSQL/Prisma migration and RLS model;
  pg-boss, Redis, and OS-level scheduled wake were not introduced.

## Job registry boundary

Available jobs are:

1. payment-webhook-retry
2. payment-receipt-email
3. outbound-webhook-dispatch
4. invoice-email-delivery
5. estimate-email-delivery
6. payroll-due-drafts
7. payment-checkout-expiry, when a hosted provider supports cancellation

Reserved at the I6 completion boundary:

- `recurring-invoice-generation` — I7
- `customer-reminders` — I8

The invoice, estimate, and receipt email jobs remain subject to the existing
email-provider configuration and kill switches. No SMTP/OAuth/provider gate was
opened by I6. The checkout-expiry worker remains subject to its existing
provider and late-payment reconciliation boundaries.

## Tenant and audit boundary

The runner discovers active organizations through the restricted runtime
function and performs each job inside the existing tenant transaction/RLS
path. The current RLS contract requires a membership actor, so this increment
uses the active owner membership as the database access surrogate for an
automation run and records the job-run id in automation audit records. It does
not claim to have introduced a separate null/system actor mode. That is an
explicit follow-up if the RLS model is later extended for one.

Jobs continue to call the same domain services used by user actions and retain
their idempotency and closed-period protections. A retry guarantees one
accounting effect, not one network attempt.

## Verification

All checks below were run against disposable database
`clearledger_i6_test_20260911_a`; no shared or beta database was reset and no
secret values were recorded.

- Prisma generation: passed.
- Migration deployment: passed, 124 migrations applied.
- Focused runner integration: 2/2 passed, including Run now, pause, shutdown
  lease release, and two concurrent runners claiming one interval once.
- Full integration suite: 252 tests across 45 files passed.
- Root/native tests: 18 passed.
- Web tests: 7 passed.
- Shared package tests: 9 passed.
- Accounting-core tests: 35 passed.
- API suite: 277 tests across 49 files passed.
- Workspace build: passed.
- API typecheck and root typecheck: passed.
- Root lint: passed.
- Root format check: passed.
- Research verification: passed, 21 modules.
- Web asset build and data-safe PWA verification: passed.

## Changed files

Source and generated application changes:

- `.env.example`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260911180000_automation_job_runner/migration.sql`
- `apps/api/src/jobs/automation-job-runner.ts`
- `apps/api/src/automation-job-runner.integration.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/auth/permissions.ts`
- `apps/api/src/openapi.ts`
- `apps/api/src/services/payment-outbox-worker.ts`
- `apps/web/app.js`
- `apps/web/index.html`
- regenerated `apps/web/dist/` assets via the repository build script

Decision, research, and handoff records:

- `docs/adr/008-background-automation-runner.md`
- `docs/COMPETITIVE_RESEARCH_MATRIX.md`
- `docs/status/CURRENT_PHASE.md`
- `docs/tasks/product-gap-program/MODEL-TAKEOVER.md`
- `docs/tasks/product-gap-program/HANDOFF-BUILD-PLAN.md`
- `docs/tasks/product-gap-program/README.md`
- `docs/tasks/product-gap-program/RECONCILIATION-2026-09-11.md`
- this report

## Release boundary and next work

The existing PennyWise 0.14.0.15 installer and USB transfer folder remain
frozen and unchanged. No installer was generated for I6. Clean-machine,
provider, mail-delivery, Store/signing, tax/legal, and human usability gates
remain evidence-gated.

The next dependency-ordered increments after this report were I7 and I8.
They are recorded in `I7_RECURRING_INVOICES_REPORT_2026-09-11.md` and
`I8_OVERDUE_FOLLOW_UP_AND_STATEMENTS_REPORT_2026-09-11.md`; the I6 evidence
counts remain historical and are not relabelled as I8 verification.
