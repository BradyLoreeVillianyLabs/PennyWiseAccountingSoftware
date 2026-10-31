# Phase 3 Completion Report

## Result

**PASS.** Phase 3 company setup and accounting configuration is implemented and verified. Phase 4 was not started.

## Material Changes

- Added versioned organization profile, business defaults, tax registrations/codes/components, account-preset provenance, setup-step state, logo metadata, and opening-balance draft models.
- Added six versioned chart presets with stable system purposes and conflict-safe, idempotent application.
- Added first-fiscal-year initialization, effective-dated tax configuration, and control-account validation without embedded current tax rates.
- Added one-journal opening balances through the Phase 1 posting transaction, idempotency, reversal-before-correction, control-detail warnings, and `BIGINT` minor units.
- Added binary logo verification, organization-isolated local storage, production storage/scanner interfaces, authorized retrieval, replacement history, and a setup-only web workflow.
- Added strict API schemas, Phase 3 permissions, OpenAPI paths, audit events, optimistic versions, forced RLS, restrictive foreign keys, exclusion/unique/check constraints, and history-protection triggers.

## Files

Created:

- `apps/api/src/phase3-company-setup.integration.test.ts`
- `apps/api/src/services/account-presets.ts`
- `apps/api/src/services/company-setup-service.ts`
- `apps/api/src/services/logo-service.ts`
- `apps/api/src/services/opening-balance-service.ts`
- `packages/db/prisma/migrations/20260723010000_phase_3_company_setup/migration.sql`
- `packages/db/prisma/migrations/20260723010000_phase_3_company_setup/down.sql`
- `docs/status/PHASE_03_COMPLETION_REPORT.md`

Materially changed:

- `.gitignore`, `README.md`
- `apps/api/src/app.ts`, `auth/permissions.ts`, `http/schemas.ts`, `openapi.ts`
- `apps/api/src/services/account-service.ts`, `journal-service.ts`, `organization-service.ts`
- `apps/web/index.html`, `app.js`, `styles.css`, `scripts/verify-assets.mjs`
- `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- `docs/00_DOCUMENT_INDEX.md`, `docs/PERMISSION_MATRIX.md`, `docs/status/CURRENT_PHASE.md`

## Migration

`20260723010000_phase_3_company_setup` passed clean deployment, complete rollback verification, and redeployment. It forces RLS on all 11 new tenant tables and grants only `clearledger_runtime`. Database controls enforce tenant-parent consistency, tax-version immutability/non-overlap, one active logo/draft, opening-line sides, posted opening-history immutability, journal linkage, and currency/fiscal locks.

## Verification

- Formatting, linting, TypeScript, Prisma validation/generation, and build: PASS.
- Unit tests: 14 PASS (7 API, 5 accounting core, 2 shared).
- Web contract/build verification: PASS.
- PostgreSQL integration tests: 62 PASS (28 ledger, 22 identity/RLS, 12 Phase 3).
- Clean migration reset/deploy: PASS, 4 migrations.
- Rollback verification: PASS, 4 rollback files on `clearledger_rollback_verify_phase3`, followed by clean redeploy.

Commands executed at the final gate:

```powershell
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd db:validate
pnpm.cmd db:generate
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd build
pnpm.cmd db:reset
pnpm.cmd db:migrate:deploy
pnpm.cmd db:rollback:verify
```

Development also used `pnpm.cmd format`, targeted repeats of the checks above, Prisma migration status/diff tooling, and PostgreSQL `createdb.exe`/`dropdb.exe` for the disposable rollback database. Early failures were corrected and affected checks rerun; none remain suppressed.

## Controls and Risks

Accounting amounts remain decimal-string/`bigint` minor units. Opening balances must balance, post atomically into an open period at the accounting start date, and become immutable; correction requires a Phase 1 reversal. Tax rates use exact Prisma `Decimal` strings and immutable sourced effective versions.

Organization context comes only from authenticated membership. Application filters remain mandatory and forced PostgreSQL RLS fails closed without matching organization/actor context. Sensitive identifiers are excluded from audit metadata; tax registration responses are masked.

Known limitations: no current tax rates are seeded; owners must supply verified source/effective metadata. Production must provide real object storage and malware scanner adapters. Local storage uses a development-only no-op scanner. Tax/business identifiers are not application-encrypted at rest beyond database/infrastructure controls. Browser automation is not yet present; UI coverage is contract verification plus end-to-end API/database integration. Opening control differences intentionally remain unresolved until future subledgers exist.

## Local Startup

```powershell
docker compose up -d postgres postgres-test
$env:DATABASE_URL = "postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public"
pnpm.cmd install
pnpm.cmd db:generate
pnpm.cmd db:migrate:deploy
pnpm.cmd --filter @clearledger/api dev
```

In a second PowerShell window:

```powershell
$env:API_BASE_URL = "http://localhost:3001"
pnpm.cmd --filter @clearledger/web dev
```

Open `http://localhost:3000`. Do not weaken PowerShell execution policy.

## Phase 4 Prerequisites

Owner approval, an explicit Phase 4 task, verified Canadian tax-rate configuration ownership, production logo storage/scanning selection, and invoice numbering/tax-snapshot/posting designs are required before customer, product, estimate, or invoice functionality begins.
