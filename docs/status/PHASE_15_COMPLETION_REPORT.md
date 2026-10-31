# Phase 15 Controlled Beta Launch - Engineering Completion

## Result

**ENGINEERING IMPLEMENTATION PASSED; PRODUCTION ACCEPTANCE REMAINS OPEN.**

The repository now contains a fail-closed production configuration contract,
database readiness endpoint, provider-readiness documentation, and the
deployment evidence checklist required to run a bounded Canadian beta. This
report records repository evidence only. It is not an attestation that the
external production providers have been configured.

## Implemented

- Added `scripts/verify-production-config.mjs` and the root
  `verify:production-config` command. Production checks require non-empty
  database, cache, HTTPS, OIDC/MFA, payment, encryption, adapter, Canadian
  region, backup-drill, security-review, and legal/privacy-review settings.
- Added `infrastructure/production.env.example` and
  `infrastructure/PRODUCTION_CONFIG.md` with secret-safe deployment and
  readiness guidance.
- Added `GET /ready`, which returns `200` only after the database responds and
  returns `503` without tenant data when it cannot connect.
- Preserved the existing production adapter fail-closed behavior for storage,
  malware scanning, email, payments, webhook/request rate limiting, and RLS.
- Added the organization-scoped `ProductEvent` migration with forced RLS,
  duplicate-safe client event ids, and a thresholded summary service.

## Evidence

- Formatting: pass.
- ESLint: pass.
- TypeScript workspace and browser E2E typecheck: pass.
- API unit suite: 40 passing tests across 12 files.
- PostgreSQL integration suite: 129 passing tests across 11 files on the
  disposable database, including forced-RLS and accounting invariants.
- Web asset and money-input suite: 3 passing money tests plus static asset
  verification.
- API, web, and database package builds: pass.
- Prisma schema validation: pass with the disposable test database URL.
- Phase 16 product-event migration: deployed successfully to the disposable
  PostgreSQL database on port 5433.
- Production configuration check: development skip path and populated
  contract pass; production missing-configuration path fails closed.

## Required owner/provider evidence before beta acceptance

1. Complete the Phase 14 owner-controlled UAT and record formal closure.
2. Configure and smoke-test the real Canadian managed PostgreSQL pooler,
   OIDC provider-enforced MFA, object storage and malware scanner, email,
   payment test/live separation, shared rate limiter, monitoring, alerts,
   secrets manager, and HTTPS edge.
3. Run the backup/PITR restore, rollback, provider-outage, alert-fire,
   access-review, incident, and offboarding drills with measured evidence.
4. Complete the independent or owner-approved security review and legal/privacy
   approval, including the subprocessor and data-location register.

Until those items are attached to the release record, this phase is
engineering-ready but not production-approved.
