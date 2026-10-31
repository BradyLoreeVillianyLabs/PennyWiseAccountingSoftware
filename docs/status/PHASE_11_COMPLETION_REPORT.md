# Phase 11 Completion Report

## 1. Phase Result

**PASS.** The accountant workspace, controlled manual journals, correction
guidance, period close/reopen evidence, deterministic review queues, audit
explorer/export, journal traceability, and next-year creation meet the Phase 11
gate. The adversarial review defects were corrected and the complete
verification suite passes.

## 2. Materially Changed Files

- API: `apps/api/src/app.ts`, `apps/api/src/http/schemas.ts`,
  `apps/api/src/auth/permissions.ts`,
  `apps/api/src/services/accountant-service.ts`, and
  `apps/api/src/services/fiscal-period-service.ts`
- Database: `packages/db/prisma/schema.prisma` and the Phase 11 migration files
- Tests: `apps/api/src/phase11-accountant.integration.test.ts`
- Web: `apps/web/index.html`, `apps/web/app.js`,
  `apps/web/scripts/verify-assets.mjs`, and `eslint.config.js`
- Documentation: `docs/API_GUIDELINES.md`, `docs/ARCHITECTURE.md`,
  `docs/ACCOUNTING_POSTING_RULES.md`, `docs/PERMISSION_MATRIX.md`,
  `docs/status/CURRENT_PHASE.md`, and this report

## 3. Migrations Added

`20260725120000_phase_11_accountant_review` adds tenant-owned manual-journal
drafts and lines, append-only period-close records, and append-only review-item
dismissals. It includes tenant-composite foreign keys, exact one-sided line
checks, posted-draft immutability triggers, tenant guards, forced RLS, runtime
grants, and a tested `down.sql`. All 32 repository migrations deployed cleanly;
all 32 rollback files passed two deploy/down cycles.

## 4. Final Test Counts

- Unit: 43 Vitest tests passed across 12 files, plus the Phase 11 web verifier.
- Integration: 117 PostgreSQL-backed tests passed across 10 files; 8 are
  focused Phase 11 scenarios.
- Formatting, ESLint, TypeScript, Prisma validation, Prisma Client generation,
  clean migration deployment, build, `git diff --check`, and rollback
  verification passed.

## 5. Close and Reopen Controls

Close requires authorized, recently authenticated roles and a reason, locks the
period against concurrent posting, and stores an immutable checklist revision.
Evidence covers drafts, bank reconciliation, imports, payment/webhook failures,
suspense balances, and configured AR, AP, tax, and inventory controls. Warnings
require explicit acknowledgement. Reopen uses a stronger permission, reason,
recent authentication, a new immutable revision, and an audit event; prior
close evidence remains unchanged.

## 6. Manual-Journal Controls

Drafts require valid tenant accounts, exact integer minor units, at least two
one-sided lines, balance, memo, reason, and effective date. Posting is
version-checked, row-locked, permission-controlled, idempotent, period-aware,
and routed through the shared journal poster. Control-account overrides require
the posting actor's explicit permission. Posted drafts, lines, journals, and
audit history are immutable; correction uses linked reversal.

## 7. Review Queues

Deterministic fingerprints identify unmatched and unreconciled banking,
suspense and unusual balances, stale manual/invoice/bill drafts, AR/AP/tax and
inventory discrepancies, tax-configuration gaps, and failed outbox/webhook
events. Findings are explanatory and link to supporting records. No correction
is automatic. Dismissal requires a reason and must match an active finding;
fabricated or stale fingerprints are rejected.

## 8. Traceability Evidence

Journal trace returns the immutable journal, source type and ID, source URL,
original reversal link, and later reversal link. Tests prove manual draft to
posted journal to exact reversal, source preservation, report control
differences, cross-tenant denial, and immutable close/audit evidence. The web
workspace exposes shared chart, ledger, reports, periods, review, trace, and
audit data rather than a second accounting model.

## 9. Unresolved Risks

- Audit export is intentionally synchronous and capped at 100 rows; Phase 12
  needs complete asynchronous organization export.
- Review source queries are capped at 500 items per category and need
  production-volume performance testing.
- Manual-journal-specific attachments are not added; existing immutable source
  attachment workflows remain available only for invoices and purchases.
- Base currency remains CAD-only. Corporate tax return preparation and
  automatic retained-earnings posting are intentionally out of scope.

## 10. Phase 12 Prerequisites

Preserve RLS transactions, integer minor units, immutable posted history,
source snapshots, deterministic identifiers, close revisions, and audit
redaction. Imports must validate fully before commit, be replay-safe and
tenant-scoped, and post through existing services. Complete exports must be
bounded or asynchronous, authorized, audited, integrity-manifested, and
portable without exposing secrets.
