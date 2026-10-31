# I8 overdue follow-up and statements report

**Prompt:** `I8-overdue-follow-up-and-statements.md`  
**Date:** 2026-09-11  
**Repository:** `C:\Users\EmceeHax\Desktop\clearledger-src`

## Outcome

I8 is implemented locally. The frozen `0.14.0.15` installer remains unchanged; a
separate `0.14.0.16` supervised participant candidate was built after source
verification.
The source now supports manual reminders, opt-in scheduled reminders, overdue review,
customer statement activity/open-item views, statement PDFs, and truthful provider/manual
statement delivery records. Late-fee settings are off by default and remain review-only;
no finance-charge journal or invoice is auto-posted.

## Delivered

- Added organization reminder settings: enablement, friendly/firm tone, relative-day rules,
  and quiet hours.
- Added customer reminder suppression/tone controls and invoice-level suppression.
- Added `ReminderService` with unpaid-finalized validation, archived/do-not-remind guards,
  one scheduled reminder per invoice per local day, idempotent `Communication` records, and
  I4 invoice-PDF delivery/manual fallback reuse.
- Enabled the I6 `customer-reminders` job when a real email delivery adapter is enabled;
  it remains unavailable when email is disabled instead of pretending to send.
- Added the overdue follow-up API and UI with age buckets, recipient/amount review, single
  invoice reminder actions, a batch review step, and reminder settings.
- Corrected customer statements to carry opening activity balance, use allocated payments,
  distinguish activity from open-item output, and expose the closing balance.
- Added a PDF statement renderer and download endpoint plus provider/manual communication
  recording endpoints. The renderer is deterministic and contains no tracking pixels.
- Added customer edit controls for do-not-remind and reminder tone.
- Fixed setup JSON serialization for the new BigInt late-fee settings and fixed the
  scheduled reminder candidate window so pre-due reminders are not silently skipped.
- Added ADR 010 and refreshed the competitive matrix from primary QuickBooks, Xero, and
  FreshBooks documentation.

## Verification

Passed:

- `corepack pnpm db:generate`
- Prisma schema validation with a non-secret placeholder `DATABASE_URL`
- API typecheck and lint
- web asset verification/build
- root `corepack pnpm test`: 18 native, 7 web, 9 shared, 35 accounting-core, 277 API unit
  tests
- `corepack pnpm test:research`: 21 modules
- root lint, typecheck, format check, and `corepack pnpm build`

Additional disposable-database evidence:

- The checked-in PostgreSQL test container accepted 127 migrations; I8 passed 1/1,
  Phase 3 setup passed 14/14 after the serializer fix, and Phase 12 portability passed
  21/21 with a 30-second reset-hook budget. No `.env` was read and no shared/beta
  database was reset.
- Real local SMTP delivery, clean-machine statement download, and human/browser acceptance.
  The provider/manual boundaries are implemented, but those external gates remain evidence
  work for the next run with an explicit isolated database and approved mailbox.

## Changed files

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260911210000_receivables_follow_up/migration.sql`
- `apps/api/src/http/schemas.ts`
- `apps/api/src/app.ts`
- `apps/api/src/jobs/automation-job-runner.ts`
- `apps/api/src/services/customer-service.ts`
- `apps/api/src/services/company-setup-service.ts`
- `apps/api/src/services/phase10-report-service.ts`
- `apps/api/src/services/reminder-service.ts`
- `apps/api/src/services/statement-document-service.ts`
- `apps/api/src/receivables-follow-up.integration.test.ts`
- `apps/web/app.js`, `apps/web/index.html`, and generated `apps/web/dist/`
- `docs/adr/010-receivables-follow-up-statements.md`
- `docs/COMPETITIVE_RESEARCH_MATRIX.md`
- product-gap status and handoff documents listed in the continuation index
- `docs/status/I8_PACKAGE_CANDIDATE_REPORT_2026-09-12.md`

## Remaining gates

The package candidate is `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.16`;
see `docs/status/I8_PACKAGE_CANDIDATE_REPORT_2026-09-12.md`. Clean-machine install,
packaged first launch, browser acceptance, and real mailbox/provider evidence remain
external gates and are not claimed here.
