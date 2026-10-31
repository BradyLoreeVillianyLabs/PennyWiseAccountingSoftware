# ADR 0001: Phase 1 Ledger Foundation

## Status

Accepted for Phase 1 implementation.

## Context

The starter repository defined the ledger entities but did not enforce all Phase 1 invariants at the application and database layers. The specification requires tenant isolation, immutable posted journals, deterministic money arithmetic, idempotent posting, auditability, and atomic financial writes before later domains are started.

## Decision

- Use integer minor units (`BigInt` in TypeScript, `BIGINT` in PostgreSQL) for Phase 1 money values.
- Keep accounting validation in `@clearledger/accounting-core` so API handlers do not contain debit and credit logic.
- Use a development-only identity adapter based on request headers. It creates local users for development and is disabled when `NODE_ENV=production`.
- Derive tenant context from authenticated membership plus `x-clearledger-organization-id`; every service query includes `organizationId`.
- Require `Idempotency-Key` for journal posting and reversal. Store request hash, response status/body, and created resource id.
- Create journals as `DRAFT`, insert lines, then mark the journal `POSTED` inside one serializable database transaction with audit and outbox rows.
- Add PostgreSQL triggers and constraints to enforce append-only audit events, immutable posted journals and lines, line/account/journal tenant consistency, journal/period/reversal tenant consistency, balanced posted journals, one reversal per original journal, and non-overlapping fiscal periods.
- Keep companion `down.sql` rollback files for Phase 1 migrations and verify them only against throwaway rollback databases.
- Default-deny direct manual posting to control accounts unless an owner, admin, or accountant supplies an explicit override and reason.
- Provide Phase 1 REST routes only; invoices, payments, banking, and inventory remain out of scope.

## Consequences

- PostgreSQL integration tests are required to prove database invariants; unit tests alone are not sufficient.
- Failed postings roll back the idempotency record, journal rows, lines, audit events, and outbox rows together.
- Reversals preserve the original journal and create a linked inverse journal.
- Minor-unit inputs outside the PostgreSQL `BIGINT` range are rejected before persistence.
- Rollback SQL is intentionally destructive and is not a substitute for production backup and point-in-time recovery.
- A production authentication provider remains an open infrastructure decision.
