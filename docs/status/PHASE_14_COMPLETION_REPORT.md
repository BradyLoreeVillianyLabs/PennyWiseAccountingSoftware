# Phase 14 Release-Candidate Evidence

## Result

**ENGINEERING ACCEPTANCE PASSED.** Phase 14 quality, performance, accessibility, browser, migration, recovery, and release-hygiene gates passed against fresh disposable PostgreSQL databases. The release candidate is ready for owner-controlled beta UAT and formal Phase 14 closure. No Phase 15 work has started.

## Automated Evidence

- Formatting, lint, strict TypeScript, Prisma validation, Prisma client generation, and build: pass.
- Unit tests: 52 passing tests across 15 files.
- PostgreSQL integration tests: 129 passing tests across 11 files.
- Capacity profile: 1 passing test using 200 customers, 200 vendors, 220 invoices, 200 bills, 200 inventory products, 2,440 journal lines, and a 1,000-row bank import.
- Static release, accessibility, and security contracts: pass.
- Dependency audit: no known vulnerabilities.
- Clean migration deployment: all 38 migrations pass on a new database.
- Rollback verification: all 38 `down.sql` files pass on a disposable rollback database.
- Backup-restore drill: 1,361,438-byte archive, SHA-256 `7277d1646218b9a2500aae4440a1f89615a7aaa858a8a8a881578faea417b3e6`, restored with 38 migrations.

## Browser And Performance Evidence

- Chrome, Edge, Firefox, mobile Chrome, and mobile WebKit each passed the complete owner workflow: organization and fiscal setup, preset application, customer and item creation, invoice posting, receivables verification, manual payment allocation, bank-deposit match, zero-difference reconciliation completion, reporting, and export download.
- Browser p95 initial load/authenticated navigation in milliseconds: Chrome `99.42/52.24`, Edge `162.68/53.68`, Firefox `324.40/72.12`, mobile Chrome `95.04/54.27`, mobile WebKit `112.91/179.10`.
- Capacity metrics in milliseconds: invoice post p95 `46.81`, trial balance p95 `10.20`, inventory query p95 `451.62`, bank import preview `1,122.32`, import commit `1,520.48`, reconciliation workspace p95 `12.84`, export `355.66`, and 500-line journal post p95 `245.69`.
- Peak measured heap growth was `42.93 MiB`; every Phase 14 target passed.

## Phase 14 Remediation

- Replaced the trial-balance account-by-account ledger scan with one tenant-scoped database aggregate while retaining zero-balance accounts and `bigint` minor-unit arithmetic.
- Added a forward PostgreSQL migration and disposable rollback file that evaluates the stable membership RLS check once per statement for `Account`, `Journal`, and `JournalLine`; organization context and active membership remain mandatory.
- Fixed inventory-quantity serialization to return exact string fields rather than leaking Prisma `bigint` values.
- Added a zero-balance trial-balance regression test, a generated capacity suite, and browser timing assertions.
- Expanded the browser matrix from control visibility checks to a database-backed payment, bank-match, and completed reconciliation journey.
- Corrected the preset-refresh asset verifier to require every affected workspace refresh.

## Remaining Release Activities

1. Owner executes the controlled-beta UAT scripts, including assistive-technology, keyboard-only, and 200% zoom checks, and records outcomes.
2. Deployment owner configures production OIDC, managed PostgreSQL roles/RLS, object storage, email, malware scanning, monitoring, alerting, backup retention, and incident operations.
3. Legal and privacy owners review public notices before general availability.

These are release-management and production-operations prerequisites, not open engineering defects in Phase 14.
