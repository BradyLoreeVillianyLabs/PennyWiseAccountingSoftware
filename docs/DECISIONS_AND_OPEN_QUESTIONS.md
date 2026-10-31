# Decisions and Open Questions

Codex must not silently decide the following product or legal questions.

## Approved decisions

- Product-gap setup (2026-09-11): use the reconciled pack under
  `tasks/product-gap-program/`. Wave 0 precedes feature work; shared web edits
  are sequential. I6 owns scheduling and I9 owns durable own-account invoice
  links. The existing 30-minute checkout lifecycle does not define durable
  invoice-link expiry. Existing CAD-base policy takes precedence over the
  pack's proposed USD-base wording. D-05 and customer-deposit tax decisions
  remain unresolved and must not be silently converted into release approvals.

- Canada-first launch.
- CAD remains the immutable base reporting/tax currency for the initial
  Canadian release. Organization-enabled CAD/USD transaction accounting is
  implemented with exact manual rate snapshots; currencies and foreign
  workflows outside the released boundary remain fail-closed.
- Modular monolith.
- PostgreSQL source of truth.
- Business View and Accountant View share one ledger.
- Posted financial records are immutable.
- Phase 1 stores money as integer minor units (`BIGINT` in PostgreSQL and `BigInt` in TypeScript).
- Phase 1 uses a development-only identity adapter until a managed production identity provider is selected.
- Phase 1 journal posting, audit events, outbox events, and idempotency replay state commit in one database transaction.
- Phase 1 idempotent posting and fiscal-period creation use serializable transactions for race-sensitive writes.
- Direct control-account manual journals are blocked by default in Phase 1 and require an explicit owner/admin/accountant override with a reason.
- Phase 1 database hardening rejects overlapping fiscal periods, cross-tenant journal period/reversal references, direct posted journal inserts without lines, duplicate reversals, and minor-unit values outside PostgreSQL `BIGINT`.
- Phase 1 migrations include companion rollback SQL and a destructive verifier that is restricted to throwaway rollback databases by default.
- Weighted-average inventory costing initially.
- Hosted payment checkout and connected business accounts.
- ClearLedger does not intentionally hold customer funds initially.
- Bank imports precede live bank feeds.
- Complete data export is an MVP requirement.
- Native payroll is owner-authorized under ADR 006 and the dated payroll implementation
  program. The current schema, permissions, statutory-calculation, approval, payslip,
  remittance-register, payment-export, and accounting foundation is not a public payroll
  claim until its exact jurisdiction vectors, security, UI, reports, correction, and
  professional acceptance gates pass. Manufacturing and autonomous posting remain out of
  scope.
- Dual-amount immutable source/journal snapshots, exact rational rates,
  monetary-position revaluation, and automatic next-period reversal are the
  implemented CAD/USD model. The owner accepted this released boundary on
  passing test evidence; accountant review is recommended rather than a
  mandatory software gate. See ADR 004 and
  `OWNER_ACCOUNTING_EVIDENCE_ACCEPTANCE.md`.

## Open decisions requiring owner or professional approval

### Accounting and tax

- Final supported provincial sales-tax combinations.
- Cash versus accrual configuration boundaries.
- Recoverable and non-recoverable tax allocation rules.
- Bad-debt tax recovery workflow.
- Customer deposit tax timing.
- Owner confirmation of MCFX tax timing, deposit classification, bad debt, and
  revaluation policy for each legal entity, informed by professional advice
  where appropriate.
- Whether direct control-account journals are ever allowed.

### Payments

- Initial payment processor.
- Platform fee strategy.
- Refund approval thresholds.
- Chargeback accounting policy.
- Legal opinion on the selected funds flow.

### Banking

- First live-feed provider.
- Institution coverage requirements.
- Consent renewal and degraded connection UX.

### Product

- Trademark clearance for the working product name, ClearLedger.
- The first beta segment is a Canadian owner-operated service or light-inventory business,
  with a particular WooCommerce/Etsy CAD/USD adoption path; later segment expansion is
  evidence-driven.
- Multiple inventory locations and eight invoice themes are implemented engineering
  decisions rather than remaining product questions.
- Support hours and service level.

### Infrastructure

- Cloud provider and Canadian region.
- Managed authentication provider.
- Email provider.
- Object storage and malware-scanning provider.
- Observability platform.
- Public-beta Docker Compose keeps the database/API services on the internal
  network and attaches only the read-only web listener to a separate
  `public_ingress` bridge. This is required for host-port forwarding on both
  Docker Compose v2 and the standalone Windows `docker-compose.exe`; it does
  not authorize direct API or database exposure. Revalidate the network policy
  during hosted deployment and penetration testing.

## Architecture decision records

### D11 — X2 report layout stability and personal privacy controls (2026-09-12)

Report drill-down stays in place so a user can inspect source detail and return without losing
filters, comparison, collapsed groups, selected currency, saved view, or scroll position. Saved
views are tenant-scoped, owner-editable records; shared views are visible only to members who
can read reports and sharing is restricted to owner/admin/accountant roles. Dashboard amount
masking is a per-user/per-organization browser preference and is not treated as an accounting
security boundary. The M3 aging original-currency toggle remains hidden until its source and
conversion contract is implemented.

- `adr/0001-phase-1-ledger-foundation.md`
- `adr/004-multi-currency-accounting-model.md`
- `adr/005-calendar-project-work-items.md`
- `adr/006-native-payroll-boundary.md`

## Engineering rule

Where an open decision blocks implementation, create an interface and use a local development adapter. Do not tightly couple the domain to an unapproved vendor.
