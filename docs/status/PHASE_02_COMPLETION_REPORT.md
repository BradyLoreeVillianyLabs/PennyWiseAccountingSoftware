# Phase 2 Completion Report

## Result

**PASS.** Phase 2 implements production identity, membership lifecycle, centralized authorization, forced PostgreSQL RLS, and the minimal identity web flow. Phase 1 ledger behavior remains green. No Phase 3 product functionality is included in this result.

## Material files

- Configuration and contracts: `.env.example`, `README.md`, `apps/api/README.md`, `apps/api/package.json`, `eslint.config.js`, `pnpm-lock.yaml`.
- API/authentication: `apps/api/src/app.ts`, `index.ts`, `openapi.ts`, `auth/{identity-adapter,dev-identity,oidc-authentication-service,oidc-provider,permissions,security,session-service}.ts`, `http/{request-context,schemas}.ts`.
- Services: `account-service.ts`, `fiscal-period-service.ts`, `idempotency-service.ts`, `journal-service.ts`, `membership-service.ts`, `organization-service.ts`, `report-service.ts`.
- Tests: `app.test.ts`, `auth/permissions.test.ts`, `identity-tenancy.integration.test.ts`, `ledger.integration.test.ts`, `vitest.integration.config.ts`.
- Web flow: `apps/web/{index.html,app.js,styles.css,serve.mjs,package.json,README.md}` and `apps/web/scripts/verify-assets.mjs`.
- Database/shared: `packages/db/prisma/schema.prisma`, `packages/db/src/{index,runtime-context,test-utils}.ts`, `packages/shared/src/context.ts`.
- Documentation: `docs/00_DOCUMENT_INDEX.md`, `docs/ARCHITECTURE.md`, ADRs 001-003, `docs/status/CURRENT_PHASE.md`, and this report.

## Migration

- Added `20260722230000_phase_2_identity_tenancy` with forward and disposable-database `down.sql` migrations.
- Clean deployment and reset applied all three repository migrations successfully.
- Rollback verification applied all three down migrations and redeployed the complete history twice.
- The down migration intentionally retains the cluster-global `clearledger_runtime` role; removing a shared cluster role is a separate administrative operation.

## Tests

- Unit: **14 passed** across 4 Vitest files; web asset/route contract: **1 passed**.
- Integration: **50 passed** across 2 PostgreSQL-backed files: 28 ledger and 22 identity/tenancy.
- New scenarios cover OIDC state/nonce/PKCE boundaries, verified email, recovery, renewal/revocation, MFA, recent authentication, invitation misuse and simultaneous acceptance, role changes, session invalidation, final-owner concurrency, immediate revocation, organization switching, horizontal escalation, RLS context, bootstrap abuse, pool leakage, constrained production login, append-only security audit, CSRF, and the complete minimal OIDC membership journey.

## Controls

- OIDC discovery/JWKS verification, HTTPS-only production endpoints, opaque hashed sessions, idle/absolute expiry, rotation, provider recovery, secure cookies, CSRF origin enforcement, and append-only authentication audit.
- Default-deny permission registry; membership-derived organization context; independent resource organization filters; recent-auth and MFA enforcement; denied-action audit; no self-escalation.
- Hashed, email-bound, expiring, single-use invitations. Row locking makes concurrent acceptance deterministic. Role changes revoke active sessions. Database triggers atomically preserve at least one active owner.
- Tenant work uses short transactions, `SET LOCAL ROLE clearledger_runtime`, and transaction-local actor/organization settings. Forced RLS checks database-maintained active membership. Invitation and organization-bootstrap exceptions are token/transaction bound.
- Production startup rejects superuser, bypass, inheriting, table-owning, or non-member database credentials. Money and Phase 1 posted-ledger invariants were not weakened.

## Verification commands

All final commands passed after the lint-only browser-global correction:

```powershell
node.exe --version
npm.cmd --version
pnpm.cmd --version
where.exe node
where.exe npm
where.exe pnpm
pnpm.cmd install --frozen-lockfile
pnpm.cmd format
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd db:validate
pnpm.cmd db:generate
pnpm.cmd db:migrate:deploy
pnpm.cmd db:reset --force
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd build
pnpm.cmd db:rollback:verify
git diff --check
```

## Local startup

```powershell
docker compose up -d postgres postgres-test
pnpm.cmd install --frozen-lockfile
$env:DATABASE_URL = "postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public"
pnpm.cmd db:migrate:deploy
pnpm.cmd --filter @clearledger/api dev
```

In a second PowerShell window:

```powershell
$env:API_BASE_URL = "http://localhost:3001"
pnpm.cmd --filter @clearledger/web dev
```

Open `http://localhost:3000` and use the localhost-only development identity. Do not weaken PowerShell execution policy. Production additionally requires the OIDC variables in `.env.example` and a dedicated `NOINHERIT` application database login granted membership in `clearledger_runtime`.

## Remaining risks and Phase 3 prerequisites

- A real managed OIDC provider, production proxy/pooler, email delivery, edge rate limiting, HSTS, monitoring, backup restore, and penetration testing require deployment-environment validation.
- The invitation token is returned once for the minimal flow; production must deliver it through an approved notification channel and avoid displaying it to administrators.
- Build output is ignored under `dist/**`; no `.env`, generated build output, or detected private-key/provider-token pattern is tracked.
- Phase 3 must preserve the runtime transaction/RLS boundary, add RLS and organization indexes for every new tenant table, use deterministic decimal representations, and avoid invoices, payments, banking, and inventory outside its authorized company-setup scope.
