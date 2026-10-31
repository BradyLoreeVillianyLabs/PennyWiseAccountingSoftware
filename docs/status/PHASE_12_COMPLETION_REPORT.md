# Phase 12 Completion Report

## 1. Phase Result

**PASS.** Phase 12 delivers staged tenant-scoped CSV migration, financial
reconciliation through established posting services, complete integrity-checked
organization export, and controlled closure/retention scheduling. The complete
quality gate and adversarial review pass.

## 2. Materially Changed Files

- API: `apps/api/src/app.ts`, `apps/api/src/http/schemas.ts`,
  `apps/api/src/auth/permissions.ts`,
  `apps/api/src/services/data-import-parser.ts`,
  `data-migration-service.ts`, and `organization-portability-service.ts`
- Tests: `apps/api/src/services/data-import-parser.test.ts` and
  `apps/api/src/phase12-portability.integration.test.ts`
- Database: `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`,
  `packages/db/src/runtime-context.ts`, and the five Phase 12 migrations below
- Web: `apps/web/index.html`, `apps/web/app.js`, `apps/web/styles.css`, and
  `apps/web/scripts/verify-assets.mjs`
- Documentation: `docs/MIGRATION_AND_PORTABILITY.md`,
  `docs/API_GUIDELINES.md`, `docs/ARCHITECTURE.md`,
  `docs/ACCOUNTING_POSTING_RULES.md`, `docs/PERMISSION_MATRIX.md`,
  `docs/00_DOCUMENT_INDEX.md`, `docs/status/CURRENT_PHASE.md`, and this report

## 3. Migrations Added

- `20260726010000_phase_12_data_portability`
- `20260726020000_phase_12_portability_hardening`
- `20260726030000_phase_12_export_completeness`
- `20260726040000_phase_12_evidence_immutability`
- `20260726050000_phase_12_initial_state_guards`

These add tenant-composite foreign keys, forced RLS, runtime grants, import and
export state/evidence guards, a constrained session-revocation function, and
reversible `down.sql` files. All 37 repository migrations deployed to a clean
database. All 37 rollback files passed two deploy/down cycles.

## 4. Tests and Commands

- 46 unit tests passed across 13 Vitest files; the web asset verifier passed.
- 128 PostgreSQL integration tests passed across 11 files; 11 cover Phase 12.
- Phase 12 coverage includes malformed CSV, malware rejection, atomic master
  rollback, financial/control reconciliation, exact inventory opening values,
  non-posting credit history, initial-state guards, evidence immutability,
  tenant/RLS isolation, concurrent upload/commit claims, export integrity,
  attachment sanitization, authorization, closure, legal hold, and session
  revocation.
- Passed commands: `pnpm.cmd format`, `pnpm.cmd format:check`,
  `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`,
  `pnpm.cmd --filter @clearledger/db exec prisma validate`,
  `pnpm.cmd --filter @clearledger/db run generate`, clean
  `pnpm.cmd --filter @clearledger/db run migrate:deploy`,
  `pnpm.cmd test:integration`, `pnpm.cmd build`, and
  `pnpm.cmd db:rollback:verify`.

## 5. Accounting and Import Controls

Imports are staged as upload, preview, dry run, commit, reconciliation, and
acknowledgement. Money is parsed as exact integer minor units and persisted as
`bigint`; quantities use the established fixed-scale parser. Financial imports
use the invoice, bill, opening-balance, and inventory workflows, so posted
journals remain balanced, immutable, idempotent, period-aware, and auditable.
Master and historical batches commit atomically. Credits lacking document and
allocation evidence remain explicit non-posting historical records.

## 6. Tenant and Security Controls

Every import/export/closure operation uses the authenticated organization
context, centralized permission checks, and tenant transactions. New tables use
forced PostgreSQL RLS with tenant-composite foreign keys. Export downloads
require authorization, recent authentication, a hash-only high-entropy token,
24-hour expiry, and whole-archive hash verification. Archives redact sessions,
provider secrets, token hashes, payment credentials, and internal storage keys.
The secret scan found only documented local/CI development placeholders; no
actual `.env`, key, or certificate file is staged.

## 7. Export and Closure Controls

The versioned JSON archive includes core organization, ledger, operational,
configuration, audit, import, and safe attachment metadata/data with per-file
and whole-archive SHA-256 evidence. Attachment paths are sanitized and unsafe,
missing, quarantined, or rejected content is reported but excluded. Closure
requires an owner, recent authentication, a ready export, and no legal hold;
it revokes organization sessions, disconnects payment accounts, schedules
30-day retention, and does not hard-delete financial history.

## 8. Remaining Risks

- CSV support is intentionally bounded; QuickBooks headings are assisted, not
  universal compatibility. Inventory products need prior configuration.
- A financial row failure after earlier rows can require operator-led linked
  reversal; it is explicitly marked `COMPENSATION_REQUIRED`, never erased.
- Export assembly is memory-resident and the local worker/storage/scanner are
  development adapters. Production needs durable workers, object storage, and
  an integrated malware scanner.
- Jurisdiction-specific deletion, anonymization, backup, and legal-retention
  procedures remain operational policy rather than immediate API deletion.

## 9. Local Verification

Start PostgreSQL services, then in Windows PowerShell set
`$env:DATABASE_URL` and `$env:TEST_DATABASE_URL` from `.env.example`. Run
`pnpm.cmd install`, `pnpm.cmd db:generate`, `pnpm.cmd db:migrate:deploy`, and
`pnpm.cmd dev`. Use `pnpm.cmd test:integration` for PostgreSQL tests. Do not
relax PowerShell execution policy; use the documented `.cmd` shims.

## 10. Phase 13 Prerequisites

Keep the immutable-ledger, RLS, fixed-precision, audit, and outbox controls
intact. Before production hardening, provision managed PostgreSQL roles and
backups, durable outbox/export workers, production object storage, malware
scanning, deployment secret management, retention/anonymization runbooks, and
load testing for large export archives.
