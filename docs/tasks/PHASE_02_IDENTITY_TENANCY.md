# Phase 2 Task: Production Identity, Membership Lifecycle, and Tenant Isolation

Execute Phase 2 only. Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.

Do not begin company setup, customers, products, invoices, payments, purchases, banking, inventory, or dashboard development.

## Required reading

- `docs/PERMISSION_MATRIX.md`
- `docs/SECURITY_AND_COMPLIANCE.md`
- `docs/ARCHITECTURE.md`
- relevant authentication, membership, organization, audit, and database code
- existing authentication and RLS ADRs, or create them if Phase 1 closeout did not
- `docs/status/PHASE_01_COMPLETION_SUMMARY.md`

## Objective

Replace development-only identity assumptions with a production-capable authentication boundary, complete the membership lifecycle, centralize authorization, and add database-level tenant isolation as defense in depth.

## Required implementation

### Authentication boundary

Implement the approved OIDC-compatible production authentication adapter with:

- verified email ownership;
- normalized provider identity linked to the internal user;
- secure sign-in and sign-out;
- short-lived sessions with controlled renewal;
- session revocation;
- account recovery integration;
- production rejection of the development identity adapter;
- no provider tokens or secrets in browser-visible responses or logs;
- recent-authentication state for sensitive actions.

Do not implement custom password storage unless an approved ADR explicitly requires it.

### Invitations and memberships

Implement:

- organization invitations using random hashed tokens;
- intended verified-email binding;
- expiration and single-use enforcement;
- membership activation and revocation;
- role changes with permission checks;
- final-owner removal and demotion protection;
- organization switching;
- immediate access loss after revocation;
- audit events for invitation and membership lifecycle actions.

### Authorization

Centralize permission evaluation:

- default deny;
- organization context derived from trusted membership;
- resource ownership checked independently of route parameters;
- no trust in client-supplied role or organization identifiers;
- no self-escalation;
- denied privileged actions audited;
- sensitive actions require recent authentication.

Use permissions rather than spreading role-name comparisons through domain services.

### PostgreSQL RLS

Implement RLS for applicable tenant-owned Phase 1 tables:

- fail closed when organization context is absent;
- transaction-scoped organization and actor context;
- ordinary runtime database role cannot bypass RLS;
- migration/maintenance role is distinct from runtime access;
- service-layer organization filters remain mandatory;
- connection-pool reuse cannot leak tenant context;
- privileged maintenance behaviour is explicit and tested.

### Minimal web flow

Implement only enough UI to verify:

1. sign in;
2. create or select an organization;
3. invite a member;
4. accept an invitation;
5. view members;
6. change an authorized role;
7. revoke membership;
8. sign out.

Do not build the general application dashboard.

## Required audit events

Record, without secrets or tokens:

- login outcome where appropriate;
- logout;
- invitation creation, acceptance, expiration/revocation;
- membership activation and revocation;
- role changes and denied escalation;
- session revocation;
- recent-authentication confirmation;
- organization switching where security-relevant.

## Required tests

Include unit, integration, database, authorization, and minimal end-to-end tests for:

- unauthenticated, expired, and revoked sessions;
- unverified-email restrictions;
- expired, reused, and wrong-email invitations;
- self-escalation and unauthorized role assignment;
- final-owner protection;
- revoked-member access;
- cross-tenant identifier substitution;
- RLS with absent, correct, and incorrect tenant context;
- connection-pool tenant-context leakage;
- denied-action audit records;
- organization switching;
- recent-authentication enforcement.

## Acceptance criteria

Phase 2 passes only when:

- production identity is isolated behind an adapter;
- development identity cannot run in production;
- invitations and memberships are secure and auditable;
- permissions deny by default;
- RLS fails closed and pool leakage tests pass;
- revocation removes access immediately;
- the minimal identity/membership flow works;
- all required verification passes.

Use the standard concise completion report and stop.
