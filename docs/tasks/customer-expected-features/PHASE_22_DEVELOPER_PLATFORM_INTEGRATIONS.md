# Phase 22 Codex Task — Developer Platform and Integrations

Execute only after Phase 21 acceptance, documented customer demand for the
first connectors, and explicit owner authorization.

## Objective

Offer a stable, secure integration surface and build only the first
customer-validated connectors. Preserve ClearLedger as the accounting system of
record and route every accounting effect through existing domain services.

## Requirements

### Public API

- Version and document a supported subset of existing APIs using OpenAPI:
  organizations, contacts, items, estimates, invoices, payments, bills,
  attachments, projects/time, bank-import drafts, reports, and exports.
- Add OAuth 2.1 authorization for third-party apps where feasible. For
  organization-owned server integrations, use named scoped credentials whose
  secrets are shown once and stored only as strong hashes.
- Add least-privilege scopes, organization installation consent, expiry,
  rotation/revocation, recent-auth for sensitive grants, rate limits, pagination,
  idempotency keys, correlation IDs, and audit.
- Never expose provider tokens, session material, internal database IDs where a
  stable public identifier is required, or unrestricted journal posting.

### Webhooks and connector runtime

- Add signed outbound webhooks built on the outbox with versioned schemas,
  per-installation secrets, replay-safe event IDs, ordering semantics, retry with
  backoff, dead-letter inspection, endpoint disablement, and replay tools.
- Add connector checkpoints, encrypted provider credentials, health, consent,
  backfill bounds, mapping, conflict handling, rate-limit control, and redacted
  logs behind shared interfaces.
- Implement no more than the owner-approved top two connectors in this phase.
  Suggested candidates are Shopify and a payroll-provider accounting export;
  select them from beta evidence rather than assumption.

### Payroll boundary

- A payroll connector may import a provider-generated pay-run summary and source
  evidence into a reviewable journal draft with explicit account mappings.
- Require a bookkeeper/accountant to review and post using existing journal
  permissions. Preserve provider run IDs and prevent duplicates.
- Do not calculate gross-to-net pay, deductions, benefits, remittances, ROEs,
  T4s, payroll tax, direct deposit, or payroll compliance.

## Efficient implementation order

Stabilize public identifiers, scopes, idempotency, webhook schemas, and the
connector SDK/test harness first. Each approved connector then becomes a narrow
adapter using those contracts. Do not write bespoke posting logic per connector.

## Tests and acceptance

- API contract/backward-compatibility, scope matrix, credential lifecycle,
  tenancy/RLS, enumeration, pagination, and rate-limit tests.
- Outbound webhook signature, replay, retry, ordering, secret rotation,
  dead-letter, SSRF/DNS rebinding, and endpoint abuse tests.
- Connector golden fixtures, backfill/reconnect/replay/conflict tests, and
  provider sandbox smoke tests.
- Payroll summary tests proving balanced draft creation, explicit review, source
  traceability, duplicate prevention, and absence of payroll calculations.

Acceptance requires no integration-specific accounting implementation, no
cross-tenant grant, recoverable event delivery, and published limits/versioning.

Write the Phase 22 completion report, update current phase, and stop.
