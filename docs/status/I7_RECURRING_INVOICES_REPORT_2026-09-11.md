# I7 recurring invoices completion report

**Prompt:** `I7-recurring-invoices-that-run.md`  
**Date:** 2026-09-11  
**Repository:** `C:\Users\EmceeHax\Desktop\clearledger-src`

## Outcome

I7 is implemented for the local, while-open automation boundary. Active invoice
schedules now materialize due occurrences through the existing invoice service;
each occurrence is idempotent, audited through the I6 job run, and visible in
schedule history. The frozen 0.14.0.15 installer remains unchanged.

## Delivered

- Added durable `RecurringScheduleOccurrence` records with a unique
  organization/schedule/occurrence identity and status, invoice link, outcome,
  and blocking/failure reason.
- Added a unique recurrence idempotency key to invoices so a retry after a
  process interruption cannot create a second invoice for the same occurrence.
- Added schedule settings for `EVERY` versus `LATEST` missed-occurrence policy
  and `DRAFT`, `FINALIZE`, or `SEND` invoice mode.
- Added the `recurring-invoice-generation` I6 runner job. It creates every due
  occurrence by default, records skipped dates under `LATEST`, advances the
  schedule, and ends it after its end date.
- Reused the existing InvoiceService for authoritative tax recalculation and
  the existing finalize and invoice-document delivery services for posted and
  provider-enabled paths.
- When email is unavailable, SEND mode remains a draft with
  `DRAFT_EMAIL_UNAVAILABLE`; it does not silently post or claim delivery.
- When a foreign schedule lacks a transaction-date FX rate, the draft is saved
  with `FX_RATE_REQUIRED`. A closed or missing period is recorded as a visible
  blocker instead of being guessed around.
- Schedule responses include the next three dates and recent occurrence
  history. The web form supports create, edit, pause, resume, end, run-due-now,
  missed-occurrence policy, invoice mode, and a button that copies the current
  I2 invoice composer into the schedule template for review.
- Updated the web asset contract, recurring UI, runner registry, OpenAPI
  description, competitive research matrix, and ADR 009.

## Verification

Against disposable database `clearledger_i6_test_20260911_a`:

- 126 migrations deployed successfully.
- Focused recurring materialization integration: 1/1 test passed. It covered
  a due draft, concurrent Run now calls, exactly one invoice, occurrence
  history, and SEND-mode fallback to a draft when email is disabled.
- Full API integration suite: 46 test files and 253 tests passed.
- Root test suite: native 18, web 7, shared 9, accounting-core 35, and API
  unit 277 tests passed.
- API typecheck: passed.
- API lint: passed.
- Web asset verification and build: passed after updating the old planning-only
  assertion to require the live runner, policy, and mode controls.
- Root formatting, lint, typecheck, and workspace build: passed.
- Competitive research verification: passed for 21 modules.
- Existing shared recurrence tests continue to cover monthly day-31 clamping.

## Honest boundaries

- The runner executes only while the API process is alive; no OS wake task was
  added.
- Provider-enabled email was not enabled or externally accepted. Local tests
  prove the queue/fallback contract only.
- The current RLS automation access surrogate remains the active owner
  membership described in ADR 008; I7 does not introduce a separate system
  actor mode.
- The frozen installer and USB transfer folder were not rebuilt or modified.

## Changed files

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260911190000_recurring_invoice_materialization/migration.sql`
- `packages/db/prisma/migrations/20260911200000_recurring_invoice_blocking_reason/migration.sql`
- `apps/api/src/http/schemas.ts`
- `apps/api/src/services/currency-workflow-policy.ts`
- `apps/api/src/services/invoice-service.ts`
- `apps/api/src/services/estimate-service.ts`
- `apps/api/src/services/recurring-invoice-service.ts`
- `apps/api/src/jobs/automation-job-runner.ts`
- `apps/api/src/app.ts`
- `apps/api/src/recurring-invoice-materialization.integration.test.ts`
- `apps/web/app.js`
- `apps/web/index.html`
- `apps/web/scripts/verify-assets.mjs`
- regenerated `apps/web/dist/` assets
- `docs/COMPETITIVE_RESEARCH_MATRIX.md`
- `docs/adr/009-recurring-invoice-materialization.md`
- `docs/status/CURRENT_PHASE.md`
- this report
