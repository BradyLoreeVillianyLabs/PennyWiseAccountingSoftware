# Phase 15 Codex Task — Controlled Beta Launch

Execute this phase only after the owner explicitly accepts Phase 14 and
authorizes Phase 15. This file's presence is not authorization.

## Required reading

Read `AGENTS.md`, `CODEX_MASTER_PROMPT.md`,
`docs/tasks/TASK_EXECUTION_STANDARD.md`, `docs/status/CURRENT_PHASE.md`,
`docs/status/PHASE_14_COMPLETION_REPORT.md`,
`docs/status/PHASE_14_DEFECT_REGISTER.md`, `docs/PRODUCTION_OPERATIONS.md`,
`docs/SECURITY_AND_COMPLIANCE.md`, `docs/BACKUP_AND_RECOVERY.md`,
`docs/THREAT_MODEL.md`, and the roadmap `README.md` in this directory.

## Objective

Deploy a bounded, supportable Canadian beta without changing accounting
behavior. Prove production identity, tenancy, storage, email, payments,
monitoring, recovery, privacy, and customer support against real managed
services.

## Work packages

Build the deployment contract first. After it is stable, provider configuration,
observability, recovery, and beta operations may be implemented as independent
work packages and merged through one release gate.

### A. Production environment

- Define versioned environment contracts for web, API, worker, migration, and
  scheduled jobs. Fail startup on missing or unsafe production settings.
- Deploy behind HTTPS with HSTS, secure cookies, explicit origins, edge rate
  limiting, health/readiness endpoints, and zero-downtime migration policy.
- Configure Canadian-region managed PostgreSQL using the existing migration and
  constrained `NOINHERIT` runtime roles. Verify forced RLS with the actual pooler.
- Configure managed OIDC and provider-enforced MFA. Do not store passwords.
- Configure private object storage, malware scanning, lifecycle retention,
  transactional email, test/live payment separation, and encrypted secrets.

### B. Operations and resilience

- Add structured redacted logs, request correlation, service metrics, traces,
  queue/outbox lag, provider health, and business-safe alerts.
- Add error tracking and actionable diagnostics without customer financial data
  or secrets.
- Automate encrypted backups, retention, restore drills, and documented RPO/RTO.
- Add deployment rollback, migration approval, incident, provider outage, access
  review, privacy request, and customer offboarding runbooks.
- Publish a subprocessor/data-location register and production data-flow record
  for owner legal review.

### C. Bounded beta controls

- Add an invite-only organization allowlist or equivalent controlled
  provisioning gate, beta terms acknowledgement, support contact, feedback
  capture, status messaging, and kill switches for email, payments, and uploads.
- Add a beta health view containing counts and latency only—never cross-tenant
  financial content.
- Prepare a 5–10 organization onboarding checklist and deterministic support
  scripts for the top 20 scenarios.

## Non-goals

Do not add new accounting features, self-serve subscriptions, custom passwords,
production debug bypasses, broad super-admin data access, or unapproved vendors.
Do not weaken localhost-only development identity behavior.

## Required tests and evidence

- Production configuration and unsafe-default tests.
- Real OIDC/MFA, email, storage/scanning, payment test mode, rate limit, session,
  and provider-failure smoke tests.
- Cross-tenant and database-role tests against the deployed pooler.
- Backup/PITR restore into an isolated environment and measured recovery time.
- Alert-fire drills for API errors, outbox lag, database saturation, backup
  failure, and provider outage.
- Full repository quality gate plus the Phase 14 browser and accounting matrix.
- Independent penetration test or documented owner-approved security review.

## Acceptance

The owner can onboard the bounded beta, monitor it, recover it, suspend risky
integrations, answer privacy/support requests, and roll back a release. Every
production provider has validated failure behavior and an accountable owner.
No critical/high security finding or accounting discrepancy remains open.

Write the Phase 15 completion report at
`docs/status/PHASE_15_COMPLETION_REPORT.md`, update
`docs/status/CURRENT_PHASE.md`, record residual operational risks, and stop.
