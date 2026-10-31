# ClearLedger Project Checklist

## Foundation and ledger

- [x] Product, accounting, architecture, security, permission, and acceptance specifications
- [x] Functional pnpm workspace and strict TypeScript configuration
- [x] PostgreSQL/Prisma foundation and migrations
- [x] Organizations, users, memberships, chart of accounts, and fiscal periods
- [x] Balanced posting, immutable journals, reversals, idempotency, audit, and outbox records
- [x] Trial balance and general-ledger reporting
- [x] Unit and PostgreSQL integration tests
- [x] Clean migration and rollback verification
- [x] Phase 1 completion report
- [x] Phase 1 remediation/closeout accepted by project owner

## Phase 2 — Identity and tenant isolation

- [ ] Explicit owner authorization
- [ ] Production authentication adapter and session lifecycle
- [ ] Verified-email invitation workflow
- [ ] Membership activation, revocation, and final-owner protection
- [ ] Centralized default-deny permissions
- [ ] Sensitive-action recent authentication
- [ ] PostgreSQL RLS and runtime/migration role separation
- [ ] Connection-pool tenant leakage tests
- [ ] Minimal identity/membership UI
- [ ] Phase 2 completion report and approval

## Phase 3 — Company setup

- [ ] Phase 2 approved
- [ ] Business profile, locale, time zone, and base currency
- [ ] Fiscal-year and accounting-start configuration
- [ ] Canadian tax configuration foundation
- [ ] Versioned industry chart-of-accounts presets
- [ ] Opening-balance workflow through the ledger
- [ ] Secure logo/branding storage adapter
- [ ] Document defaults and numbering placeholders
- [ ] Resumable setup UI and server state machine
- [ ] Phase 3 completion report and approval

## Future MVP phases

- [ ] Phase 4 customers/items/invoice accounting
- [ ] Phase 5 invoice rendering and delivery
- [ ] Phase 6 payments
- [ ] Phase 7 vendors/bills/expenses
- [ ] Phase 8 banking/reconciliation
- [ ] Phase 9 inventory
- [ ] Phase 10 reports/dashboard
- [ ] Phase 11 accountant tools/period close
- [ ] Phase 12 migration/export
- [ ] Phase 13 security/privacy/operations hardening
- [ ] Phase 14 end-to-end QA
- [ ] Phase 15 controlled beta and MVP release

## Stop gate

- Prepared task files do not authorize execution.
- Codex must stop after each phase report.
