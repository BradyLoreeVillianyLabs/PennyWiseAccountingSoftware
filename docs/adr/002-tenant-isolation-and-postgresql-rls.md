# ADR 002: Tenant Isolation And PostgreSQL RLS

## Status

Accepted and implemented in Phase 2.

## Context

Phase 1 enforced tenant isolation through organization-scoped services, membership context, scoped constraints, and cross-tenant ledger triggers. Phase 2 adds PostgreSQL RLS as an independent defense-in-depth boundary.

## Decision

- Application-level organization authorization remains mandatory even after RLS is enabled.
- PostgreSQL RLS provides defense in depth for tenant-owned Phase 1 tables, memberships, invitations, organizations, and organization-scoped authentication audit records.
- Every tenant operation runs in a transaction, enters `clearledger_runtime` with `SET LOCAL ROLE`, and sets `app.organization_id` and `app.actor_user_id` with transaction-local `set_config` calls.
- Policies fail closed when tenant context is absent, malformed, or does not correspond to a database-maintained active-membership locator.
- Connection pooling may reuse sessions because role and context are transaction-local. Tests must continue to prove that context is empty after commit and cannot leak into the next transaction.
- Migrations and maintenance jobs run under separately managed privileged credentials. The production API login must be a non-owning, unprivileged `NOINHERIT` member of the `NOLOGIN` `clearledger_runtime` role; startup rejects unsafe credentials.
- Privileged roles may bypass RLS only for migrations, verified maintenance, backup, restore, and controlled operational workflows. The disposable rollback deliberately retains the cluster-global runtime role.
- Bypassing RLS casually from application code is prohibited.
- Tests must cover allowed tenant access, denied cross-tenant reads and writes, missing tenant context, invalid tenant context, privileged migration roles, and connection reuse after transaction completion.

## Implementation

- Active-membership and invitation-token locator tables are maintained by restricted security-definer triggers and are not granted to runtime SQL.
- Invitation acceptance is limited to the hashed invitation context. Organization creation receives a same-transaction bootstrap grant that can initialize only the newly inserted tenant and initial owner.
- RLS is enabled and forced. The runtime role is `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, and `NOBYPASSRLS`.
- Service methods retain explicit organization predicates and independent permission checks; RLS is not treated as application authorization.

## Consequences

- Production provisioning must create separate migration and application logins, then grant only runtime-role membership to the application login.
- New tenant tables require organization indexes, explicit grants, forced RLS policies, service filters, absent/wrong/correct-context tests, and pool-reuse tests before release.
- Casual `BYPASSRLS`, table-owner, superuser, or migration credentials are prohibited for the API.
