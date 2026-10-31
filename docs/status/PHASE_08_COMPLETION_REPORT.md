# Phase 8 Completion Report

## 1. Phase Result

**PASS.** PostgreSQL-backed bank and credit-card accounts, CSV and OFX/QFX
imports, duplicate review, matching, categorization, transfers, reconciliation,
the minimal web workflow, and all required verification are complete. Phase 9
has not begun.

## 2. Materially Changed Files

- Domain/API: `apps/api/src/app.ts`,
  `apps/api/src/services/bank-import-parser.ts`,
  `apps/api/src/services/banking-service.ts`,
  `apps/api/src/auth/permissions.ts`, and `packages/db/src/index.ts`
- Tests: `apps/api/src/services/bank-import-parser.test.ts`,
  `apps/api/src/phase8-banking.integration.test.ts`, and
  `apps/api/src/auth/permissions.test.ts`
- Database: `packages/db/prisma/schema.prisma`,
  `packages/db/prisma/migrations/20260724200000_phase_8_banking/migration.sql`,
  its `down.sql`, and `packages/db/prisma/migrations/migration_lock.toml`
- Web: `apps/web/index.html`, `apps/web/app.js`, and
  `apps/web/scripts/verify-assets.mjs`
- Documentation: `docs/ACCOUNTING_POSTING_RULES.md`, `docs/ARCHITECTURE.md`,
  `docs/PERMISSION_MATRIX.md`, `docs/status/CURRENT_PHASE.md`, and this report

## 3. Migration

`20260724200000_phase_8_banking` is migration 30. It deploys from a clean
database. All 30 checked-in `down.sql` files passed deploy/down/redeploy/down
verification on `clearledger_rollback_verify_phase8`.

## 4. Final Test Counts

- Unit: 32 Vitest tests passed, plus the Phase 8 web asset verification.
- Integration: 87 PostgreSQL-backed tests passed, including 8 Phase 8
  end-to-end scenarios.
- Formatting, ESLint, TypeScript, Prisma validation, Prisma generation, clean
  migration reset/deploy, build, and rollback verification passed.

## 5. Import And Deduplication

Imports are previewed before an atomic commit. CSV uses explicit column
mappings and a quoted-field parser; OFX/QFX uses normalized statement
transactions. Strict file, row, date, currency, amount, and size limits apply.
Money is parsed directly to `bigint` minor units without floating point.
SHA-256 file hashes, provider IDs, normalized row fingerprints, and database
uniqueness prevent exact replay. Probable duplicates are held from financial
action until an authorized user records an audited reasoned override.

## 6. Matching And Categorization

Matching links an import to existing posted journal bank-side lines and never
reposts financial activity. Active split matches must exactly total the import,
and a journal can be actively matched only once per bank account.
Categorization is the posting path: selected lines and persisted tax snapshots
must exactly total the import, while the linked bank line has the exact
opposite side. Rules are deterministic, explainable suggestions only.
Transfers create one balanced destination-debit/source-credit journal and may
match both imported sides.

## 7. Reconciliation Controls

Statement impacts are derived and database-validated for bank versus
credit-card sign conventions. Completion requires zero difference and no
unmatched cleared rows. Completion produces an immutable revisioned snapshot;
source rows, matches, and completed items are locked. Reopen requires a
privileged role, recent authentication, reason, optimistic version, audit
record, and append-only retention of prior snapshots. Reports preserve
historical snapshots and identify later ledger adjustments.

## 8. Unresolved Risks

- Live bank feeds, credential storage, consent renewal, and balance polling are
  intentionally out of scope.
- The OFX/QFX adapter targets common statement formats; broader institution
  fixture coverage should grow before claiming universal compatibility.
- Bank rules never auto-post. A future autonomous workflow needs separate
  approval, explainability, rollback, and fraud controls.
- Production-scale import throughput and very large reconciliation periods
  still need load testing.
- The minimal web workflow is functional but does not expose every API
  correction or multi-line convenience.

## 9. Phase 9 Prerequisites

Preserve all 30 migrations, posted-journal immutability, bank matching
non-posting semantics, reconciliation snapshots, RLS, and integer money.
Before inventory work, approve explicit quantity precision, costing method,
negative-stock policy, location ownership, purchase/sale return behavior,
concurrency locks, and GL-to-inventory reconciliation rules. Inventory must not
reuse Phase 7 placeholder flags as valuation records or alter historical
banking evidence.
