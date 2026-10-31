# ADR 008: Tenant-scoped background automation uses leases, not pg-boss

## Status

Accepted for the I6 implementation. This ADR does not authorize hosted queues,
OS wake tasks, or provider delivery gates.

## Context

The API previously exposed durable outbox and scheduled-draft records but had no
process that replayed them while the application was running. The installed
application is intentionally interactive and local, so its automations must catch
up when the API starts and must state that they run only while PennyWise is open.
Two API processes may share one database during development or a controlled beta.

The runtime database role is deliberately constrained. A queue library that creates
its own schema or runs startup DDL would violate the migration and least-privilege
boundary.

## Decision

Use a small Prisma-migrated lease and run-log pair:

- `AutomationJobLease` is unique by organization and job name, has an expiry,
  pause state, next-run time, bounded failure count, and dead-letter state.
- `AutomationJobRun` records start, finish, counts, error code, and status.
- The runner claims leases with one atomic `INSERT ... ON CONFLICT ... WHERE`
  statement and performs work inside the existing tenant transaction helpers.
- Organization discovery uses the migration-owned, identifier-only
  `list_automation_organizations()` security-definer function. Data work remains
  tenant-scoped and uses the existing runtime role and owner membership as the
  database access surrogate required by the current RLS contract.
- Jobs use bounded batches, exponential retry delay, and no Redis or OS wake task.
  Reserved I7/I8 jobs are listed as unavailable and never recorded as successful.
- `JOBS_ENABLED=false` disables the runner. Shutdown releases leases owned by the
  current process. `/ready` stays closed until startup catch-up has completed.

## Rejected alternative

`pg-boss` was rejected because its normal startup migration creates and manages a
separate schema. Disabling that migration would move schema ownership outside the
repository's Prisma migration chain and conflict with the constrained runtime role.

## Consequences

This is reliable while the API process is alive, including catch-up after launch,
but it does not wake a sleeping Windows machine. Provider SMTP/OAuth delivery remains
gated; the beta's own-email-app fallback remains the honest path when delivery is not
configured. A future hosted deployment can replace the process loop with a queue
adapter without changing accounting services or idempotency keys.
