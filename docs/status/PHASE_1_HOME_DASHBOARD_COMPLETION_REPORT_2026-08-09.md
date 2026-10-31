# Phase 1 Home Dashboard Completion Report — 2026-08-09

## Result

Implementation complete for the QuickBooks-comparable “decisive daily dashboard”
increment. The Home workspace now keeps a business-specific as-of date, shows explicit
loading, ready, stale/error, and permission states, and routes financial KPI clicks to
the matching report with the selected date context.

## Files changed

- `apps/web/index.html` — added the Home as-of control, data-state status region, and
  accessible date guidance.
- `apps/web/app.js` — added validated tenant-scoped browser persistence, local-calendar
  date handling, request race protection, explicit failure states, and KPI-to-report
  drill-down routing.
- `apps/web/styles.css` — added responsive styling for the date control and status region.
- `apps/web/e2e/appearance-customization.spec.ts` — added date selection, report drill-down,
  and reload persistence assertions.
- `docs/tasks/QUICKBOOKS_BETTER_PHASED_PROMPTS.md` — phased product prompt roadmap.
- `docs/00_DOCUMENT_INDEX.md` — linked the roadmap.

No database migration was required. No accounting posting path was changed.

## Controls preserved

- Dashboard data remains read-only and comes from the existing tenant-scoped API.
- No zero balances are substituted for unavailable data.
- 401/403 responses are presented as permission states without a misleading retry.
- Previous successful values remain visible only as explicitly labelled stale data after
  a refresh failure.
- KPI drill-down uses the API-provided report links and carries the selected as-of/from/to
  context into the reports workspace.
- Date preferences are keyed by normalized user email and active organization ID.

## Verification

Passed:

- `corepack pnpm exec prettier --check` on all changed files.
- `node --check apps/web/app.js`.
- `corepack pnpm --filter @clearledger/web test` — 3 passed.
- `corepack pnpm test` — 217 tests passed: web 3, shared 9, accounting-core 35,
  API 175.
- `corepack pnpm lint`.
- `corepack pnpm typecheck`.
- `corepack pnpm --filter @clearledger/web build`.

Blocked or pre-existing repository gates:

- `corepack pnpm test:e2e` — blocked before startup because neither
  `TEST_DATABASE_URL` nor `DATABASE_URL` is configured.
- `corepack pnpm db:validate` — blocked by the same missing `DATABASE_URL`.
- Full `corepack pnpm format:check` — existing warnings remain in seven unrelated
  release/commercial documents; all changed files pass targeted formatting.

## Startup for final browser verification

Set a disposable PostgreSQL connection in `TEST_DATABASE_URL`, then run:

```powershell
corepack.cmd pnpm test:e2e
```

The next authorized roadmap phase is Phase 2, the core bookkeeping loop. Stop here until
the owner reviews this report and authorizes continuation.
