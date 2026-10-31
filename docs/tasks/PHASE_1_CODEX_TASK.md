# Phase 1 Codex Task

Copy the prompt below into Codex after placing this repository in its workspace.

---

Implement Phase 1 of ClearLedger using this repository as the source of truth.

Read these files first:

- `CODEX_MASTER_PROMPT.md`
- `docs/ARCHITECTURE.md`
- `docs/ACCOUNTING_POSTING_RULES.md`
- `docs/PERMISSION_MATRIX.md`
- `docs/SECURITY_AND_COMPLIANCE.md`
- `docs/ACCEPTANCE_TESTS.md`
- `packages/db/prisma/schema.prisma`

Your task is limited to the ledger foundation. Do not implement invoices, payments, banking, or inventory yet.

Required implementation:

1. Establish a functional pnpm monorepo.
2. Create a structured API application.
3. Add authentication interfaces and a development-only test identity adapter. Do not invent production authentication secrets.
4. Implement organization-scoped memberships and authorization.
5. Implement account creation, listing, archival, and control-account protections.
6. Implement fiscal-period creation, lookup, closing, and reopening.
7. Implement atomic journal posting using the accounting package.
8. Enforce balanced lines, open periods, valid organization accounts, immutable posted entries, and unique posting keys.
9. Implement idempotency storage and replay behaviour.
10. Implement reversal journals.
11. Implement append-only audit events.
12. Implement trial balance and general ledger endpoints.
13. Add database constraints or triggers where they materially strengthen invariants.
14. Add unit, integration, authorization, idempotency, rollback, and tenant-isolation tests.
15. Update OpenAPI and repository documentation.
16. Run all checks and report results.

Important constraints:

- Use bigint or decimal-safe representations for money.
- Do not expose arbitrary organization ids as trusted authorization inputs.
- Do not allow direct mutation or deletion of posted journal lines.
- Do not permit ordinary users to post to control accounts.
- Do not silently reopen periods.
- Do not use mocks where a PostgreSQL integration test is required to prove a financial invariant.
- Keep route handlers thin and domain logic in services.

Before coding, produce a short implementation note identifying any schema defects or unresolved decisions. Make conservative choices, document them, and continue without expanding scope.

At completion, provide:

- files changed;
- architecture decisions;
- migrations created;
- tests added;
- commands run and results;
- known limitations;
- exact next task recommended.

---
