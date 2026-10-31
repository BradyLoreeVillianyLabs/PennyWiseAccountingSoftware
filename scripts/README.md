# Scripts Location

Place repeatable development and CI scripts here. Scripts should be idempotent, documented, safe by default, and fail clearly.

Examples later may include:

- waiting for PostgreSQL health;
- resetting integration-test databases;
- validating migration safety;
- checking generated OpenAPI changes;
- creating sanitized development fixtures.

## Phase 1 scripts

- `run-integration-tests.mjs` requires an explicit disposable `TEST_DATABASE_URL`, sets `DATABASE_URL` to that value, applies Prisma migrations there, and runs the API PostgreSQL integration suite. It refuses the PennyWise beta database (`127.0.0.1:55432/clearledger`) so an integration run cannot reset the active beta.
- `verify-migration-rollbacks.mjs` applies all Prisma migrations, applies each migration's `down.sql` in reverse order, reapplies the migrations, and rolls them back again. It refuses to run unless `DATABASE_URL` points at a database named `clearledger_rollback_verify_*` or `ALLOW_DESTRUCTIVE_ROLLBACK_VERIFY=true` is set.
- `verify-backup-restore.mjs` creates a PostgreSQL custom-format backup from
  `BACKUP_RESTORE_SOURCE_DATABASE_URL`, restores it into the disposable
  `BACKUP_RESTORE_TARGET_DATABASE_URL`, and verifies the restored migration
  history. The target must be named `clearledger_restore_verify_*` unless
  `ALLOW_DESTRUCTIVE_BACKUP_RESTORE=true` is explicitly set. It removes the
  temporary archive unless `KEEP_BACKUP_RESTORE_ARTIFACTS=true`.
- `verify-d6-evidence.mjs` validates the sanitized 15-drill Destry Workwear
  evidence ledger. It rejects unknown or duplicate drills, secret-like fields,
  and unsupported `PASS` entries. A structurally valid ledger can still contain
  `UNVERIFIED` or `NOT_RUN` results; use `--require-complete` only for the
  owner-supplied final evidence file.
