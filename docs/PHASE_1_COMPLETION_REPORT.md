# Phase 1 Completion Report

Date: 2026-07-22

## 1. Work Completed

Phase 1 implemented the ledger foundation only:

- users, organizations, memberships, and roles;
- chart of accounts;
- fiscal periods;
- journals and journal lines;
- atomic journal posting;
- exact reversal journals;
- idempotency for financial writes;
- audit events and transactional outbox records;
- trial balance and general ledger reports;
- Prisma schema, PostgreSQL constraints, PostgreSQL triggers, forward migrations, rollback SQL, and rollback verification;
- adversarial Phase 1 hardening for accounting correctness, tenant isolation, auditability, and database integrity.

Invoices, payments, banking, inventory, imports, and full customer export remain locked until later phases are explicitly approved.

## 2. Files Created Or Changed

This workspace is not a Git repository, so there is no Git diff available. The Phase 1 implementation and verification surface is:

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `.prettierignore`
- `.prettierrc.json`
- `AGENTS.md`
- `CODEX_MASTER_PROMPT.md`
- `COPY_THIS_TO_CODEX.md`
- `FILE_PLACEMENT_MAP.md`
- `PROJECT_CHECKLIST.md`
- `PROJECT_FILE_LIST.txt`
- `README.md`
- `START_HERE.md`
- `docker-compose.yml`
- `eslint.config.js`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.eslint.json`
- `tsconfig.json`
- `apps/api/README.md`
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/vitest.config.ts`
- `apps/api/vitest.integration.config.ts`
- `apps/api/src/app.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/auth/dev-identity.ts`
- `apps/api/src/auth/permissions.test.ts`
- `apps/api/src/auth/permissions.ts`
- `apps/api/src/http/request-context.ts`
- `apps/api/src/http/schemas.ts`
- `apps/api/src/index.ts`
- `apps/api/src/ledger.integration.test.ts`
- `apps/api/src/openapi.ts`
- `apps/api/src/services/account-service.ts`
- `apps/api/src/services/fiscal-period-service.ts`
- `apps/api/src/services/idempotency-service.ts`
- `apps/api/src/services/journal-service.ts`
- `apps/api/src/services/organization-service.ts`
- `apps/api/src/services/report-service.ts`
- `apps/api/src/utils/audit.ts`
- `apps/api/src/utils/dates.ts`
- `apps/api/src/utils/json.ts`
- `apps/web/README.md`
- `docs/00_DOCUMENT_INDEX.md`
- `docs/ACCEPTANCE_TESTS.md`
- `docs/ACCOUNTING_POSTING_RULES.md`
- `docs/API_GUIDELINES.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS_AND_OPEN_QUESTIONS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PERMISSION_MATRIX.md`
- `docs/PHASE_1_COMPLETION_REPORT.md`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/SECURITY_AND_COMPLIANCE.md`
- `docs/THREAT_MODEL.md`
- `docs/adr/0001-phase-1-ledger-foundation.md`
- `docs/adr/001-production-authentication.md`
- `docs/adr/002-tenant-isolation-and-postgresql-rls.md`
- `docs/adr/003-production-migration-policy.md`
- `docs/tasks/PHASE_1_CODEX_TASK.md`
- `infrastructure/README.md`
- `packages/accounting-core/README.md`
- `packages/accounting-core/package.json`
- `packages/accounting-core/tsconfig.json`
- `packages/accounting-core/vitest.config.ts`
- `packages/accounting-core/src/index.ts`
- `packages/accounting-core/src/journal.test.ts`
- `packages/accounting-core/src/journal.ts`
- `packages/accounting-core/src/money.ts`
- `packages/db/README.md`
- `packages/db/package.json`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260722190000_phase_1_ledger/down.sql`
- `packages/db/prisma/migrations/20260722190000_phase_1_ledger/migration.sql`
- `packages/db/prisma/migrations/20260722210000_phase_1_adversarial_hardening/down.sql`
- `packages/db/prisma/migrations/20260722210000_phase_1_adversarial_hardening/migration.sql`
- `packages/db/src/index.ts`
- `packages/db/src/test-utils.ts`
- `packages/db/tsconfig.json`
- `packages/shared/README.md`
- `packages/shared/package.json`
- `packages/shared/src/context.ts`
- `packages/shared/src/errors.test.ts`
- `packages/shared/src/errors.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tsconfig.json`
- `scripts/README.md`
- `scripts/run-integration-tests.mjs`
- `scripts/verify-migration-rollbacks.mjs`

Generated build outputs under `apps/api/dist`, `packages/accounting-core/dist`, `packages/db/dist`, and `packages/shared/dist` were also produced by TypeScript builds.

## 3. Commands Executed

Top-level Node tooling commands were invoked with Windows-safe executable names.

```powershell
node.exe --version
npm.cmd --version
pnpm.cmd --version
where.exe node
where.exe npm
where.exe pnpm
Get-ChildItem -Force
rg --files
git status --short
pnpm.cmd install
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
$env:DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public'; pnpm.cmd db:validate
$env:DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public'; pnpm.cmd db:generate
$env:DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public'; $env:TEST_DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5433/clearledger_test?schema=public'; pnpm.cmd test:integration
$env:PGPASSWORD = 'clearledger_dev_only'; $pgbin = Join-Path (Get-Location) '.tmp\tools\postgresql-17.10-2-windows-x64-binaries\pgsql\bin'; & (Join-Path $pgbin 'dropdb.exe') --if-exists --force -h localhost -p 5432 -U clearledger clearledger_clean_migrate_20260722; & (Join-Path $pgbin 'createdb.exe') -h localhost -p 5432 -U clearledger clearledger_clean_migrate_20260722; $env:DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger_clean_migrate_20260722?schema=public'; pnpm.cmd db:migrate; & (Join-Path $pgbin 'dropdb.exe') --if-exists --force -h localhost -p 5432 -U clearledger clearledger_clean_migrate_20260722
$env:PGPASSWORD = 'clearledger_dev_only'; $pgbin = Join-Path (Get-Location) '.tmp\tools\postgresql-17.10-2-windows-x64-binaries\pgsql\bin'; & (Join-Path $pgbin 'dropdb.exe') --if-exists --force -h localhost -p 5432 -U clearledger clearledger_rollback_verify_20260722; & (Join-Path $pgbin 'createdb.exe') -h localhost -p 5432 -U clearledger clearledger_rollback_verify_20260722; $env:DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger_rollback_verify_20260722?schema=public'; $env:POSTGRES_BIN = $pgbin; pnpm.cmd db:rollback:verify; & (Join-Path $pgbin 'dropdb.exe') --if-exists --force -h localhost -p 5432 -U clearledger clearledger_rollback_verify_20260722
$env:DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public'; $env:TEST_DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5433/clearledger_test?schema=public'; pnpm.cmd check
rg -n "\b(v1/(invoice|payment|bank|inventory)|createInvoice|recordPayment|bankAccount|inventoryMovement)\b" apps packages -g '!node_modules' -g '!dist'
rg -n "Float|Double|Decimal\(|parseFloat|Number\(|Math\.round|toFixed" apps packages -g '!node_modules' -g '!dist'
Get-Content docs\PHASE_1_COMPLETION_REPORT.md
```

`git status --short` failed because the project directory is not a Git repository.

## 4. Complete Test Results

- Environment: Node.js `v24.18.0`, npm `11.16.0`, pnpm `10.13.1`.
- `pnpm.cmd install`: passed; lockfile already up to date.
- `pnpm.cmd format:check`: passed.
- `pnpm.cmd lint`: passed.
- `pnpm.cmd typecheck`: passed.
- `pnpm.cmd test`: passed, 11 unit tests.
- `pnpm.cmd db:validate`: passed.
- `pnpm.cmd db:generate`: passed; Prisma Client v6.19.3 generated.
- `pnpm.cmd test:integration`: passed, 28 PostgreSQL integration tests.
- Clean database `pnpm.cmd db:migrate`: passed.
- `pnpm.cmd db:rollback:verify`: passed; 2 rollback files verified through two up/down cycles.
- `pnpm.cmd check`: passed, including format check, lint, type check, Prisma validation, unit tests, integration tests, and build.
- Phase 2 route scan: only hit is `apps/api/src/app.test.ts`, which asserts `/v1/inventory/movements` is absent.
- Floating-point money scan: no matches.

## 5. Prisma Migration Names And Status

- `20260722190000_phase_1_ledger`: applied successfully to a clean database; rollback SQL verified.
- `20260722210000_phase_1_adversarial_hardening`: applied successfully to a clean database; rollback SQL verified.

The integration test database reported 2 migrations found and no pending migrations.

## 6. Accounting Invariants Implemented

- Posted journals must contain at least two journal lines.
- Posted journal debits and credits must balance.
- Journal lines must contain exactly one positive debit or credit.
- Money is accepted as integer minor-unit strings and parsed to TypeScript `bigint`.
- PostgreSQL stores money amounts as `BIGINT`.
- Minor-unit parsing rejects values outside the PostgreSQL `BIGINT` range.
- Posted journals are immutable.
- Posted journal lines are immutable.
- Corrections use linked reversal journals.
- Reversal lines exactly invert original debit and credit amounts.
- Only posted journals can be reversed.
- A journal cannot reverse itself.
- Only one reversal is allowed per original journal per organization.
- Posting into closed fiscal periods is rejected.
- Fiscal periods cannot overlap within an organization.
- Direct control-account posting requires explicit override, permission, and reason.
- Journal posting, lines, audit event, outbox event, and idempotency response state are written atomically.

## 7. Tenant-Isolation Controls Implemented

- Organization context is required for organization-scoped endpoints.
- Organization context is accepted only after authenticated membership lookup.
- Service queries include `organizationId` filters.
- Account, fiscal period, journal, journal line, audit, idempotency, and outbox records are organization scoped.
- Journal-line trigger requires line, journal, and account organizations to match.
- Journal trigger requires fiscal period and journal organizations to match.
- Journal trigger requires reversed journal and reversal journal organizations to match.
- Unique posting, source, idempotency, account-code, and membership constraints are organization scoped.
- Integration tests reject cross-tenant journal reads.
- Integration tests reject direct cross-tenant period and reversal references.

## 8. Security Controls Implemented

- Development identity adapter is disabled when `NODE_ENV=production`.
- Role-based authorization protects accounts, fiscal periods, journal posting, journal reversal, reports, and member management.
- Non-admin member role escalation is rejected.
- Denied role-assignment attempts are audited.
- Membership role assignment audits include before and after metadata.
- Audit metadata includes request IP address and user agent when available.
- Audit events are append-only via PostgreSQL update/delete prevention triggers.
- Idempotency hashes request payloads and rejects key reuse with different payloads.
- Duplicate posting and duplicate reversal conflicts return deterministic application errors.
- Rollback verification refuses non-throwaway database names unless explicitly overridden.

## 9. Known Limitations

- Production authentication, MFA, session management, account recovery, and reauthentication are not implemented in Phase 1.
- PostgreSQL row-level security is not enabled yet.
- Redis, durable background queues, and outbox dispatch workers are deferred.
- Full customer data export is not implemented in Phase 1.
- Invoices, payments, banking, inventory, imports, and exports are not implemented in Phase 1.
- CI status cannot be observed locally because this directory is not a Git repository.
- PowerShell blocks bare npm and pnpm `.ps1` shims in this environment; use `node.exe`, `npm.cmd`, `pnpm.cmd`, `corepack.cmd`, and `npx.cmd`.

## 10. Unresolved Risks

- Project owner and CPA/accounting reviewer approval is still required.
- Production identity-provider selection remains open.
- RLS should be evaluated before production multi-tenant deployment.
- Backup restoration, dependency scanning, secrets scanning, and penetration testing require production-like infrastructure.
- Broader concurrency, load, and disaster-recovery testing remains future work.
- Phase 2 posting rules must be reviewed before sales, invoices, payments, banking, or inventory begin.

## 11. Exact Local Startup Instructions

From PowerShell:

```powershell
cd C:\Users\EmceeHax\CodexAccountingProject\ClearLedger-Codex-Ready\ClearLedger-Codex-Ready
$env:DATABASE_URL = 'postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public'
pnpm.cmd install
pnpm.cmd db:generate
pnpm.cmd db:migrate
pnpm.cmd --filter @clearledger/api run dev
```

The API defaults to `http://localhost:3001` unless `PORT` is set.

## 12. Recommended Phase 2 Prerequisites

- Obtain explicit Phase 1 approval from the project owner.
- Obtain CPA/accounting review approval for the ledger foundation.
- Select and document production authentication.
- Decide whether Phase 2 must add PostgreSQL RLS before new tenant-owned domains.
- Add CI visibility with PostgreSQL-backed migration, rollback, unit, integration, lint, typecheck, and build gates.
- Write Phase 2 acceptance criteria before implementing invoices, payments, banking, inventory, imports, exports, or customer data export.
