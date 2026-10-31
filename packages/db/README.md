# Database Package Location

This package owns:

- Prisma schema;
- generated database client;
- migrations;
- companion `down.sql` rollback files for Phase 1 migrations;
- seed data;
- PostgreSQL integration-test helpers;
- database constraints and triggers approved during Phase 0.

The starter schema at `prisma/schema.prisma` is not automatically authoritative. Codex must review it against all specifications before creating the initial migration.

Phase 1 adds the initial PostgreSQL migration for users, organizations, memberships, accounts, fiscal periods, journals, journal lines, audit events, idempotency records, and outbox events.

The migration includes database constraints and triggers for:

- CAD-only organizations;
- valid fiscal-period ranges;
- valid debit or credit journal lines;
- tenant-consistent journal lines;
- tenant-consistent journal fiscal periods and reversal links;
- non-overlapping fiscal periods;
- posted journal balance checks;
- closed-period posting rejection;
- single reversal per original journal;
- posted journal and journal-line immutability;
- append-only audit events.

Rollback verification is intentionally destructive and must run against a throwaway database:

```powershell
$env:DATABASE_URL = "postgresql://clearledger:clearledger_dev_only@localhost:5433/clearledger_rollback_verify_local?schema=public"
corepack pnpm db:rollback:verify
```
