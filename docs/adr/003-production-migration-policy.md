# ADR 003: Production Migration Policy

## Status

Accepted for Phase 1 closeout.

## Context

Phase 1 includes Prisma migrations and companion `down.sql` files. The rollback verifier intentionally applies down migrations only against throwaway databases. Production accounting data must be treated as durable evidence, so migration policy must avoid casual destructive rollbacks.

## Decision

- Production migrations are forward-only by default.
- `down.sql` files are for disposable development, local verification, and CI rollback-verification databases.
- Down migrations do not drop cluster-global roles that may still be required by other databases in the PostgreSQL cluster; role retirement is a separately approved administrative operation.
- Production defects normally receive corrective forward migrations.
- Destructive production migrations require a written backup, restoration, and rollout plan before execution.
- Destructive production migrations must define affected data, customer impact, validation queries, rollback or roll-forward strategy, owner approval, and communication plan.
- Migration deployment must run under a privileged migration role, not the ordinary application role.
- Production migration execution must be audited with migration name, actor or automation identity, environment, start and finish timestamps, result, and relevant deployment identifier.
- Clean migration deployment must be verified in CI from an empty database.
- Rollback verification must run only against disposable databases with names that make destructive intent explicit.

## Consequences

- Phase 1 rollback files remain useful for testing reversibility of the schema history, but they are not a production recovery mechanism.
- Production recovery depends on tested backups, point-in-time restore capability, and corrective forward migrations.
- Future migrations must include both forward deployment validation and, where applicable, disposable rollback verification.
