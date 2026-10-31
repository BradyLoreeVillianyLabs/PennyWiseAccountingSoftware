# Wave 1 — Read-only summary endpoints

- **Engine:** Codex · **Wave:** 1 · **Slot:** 4 · **Branch:** `ui/api-summary`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §2 (Home), §3 (landing KPIs)
- **Owns:** new read-only route module(s) under `apps/api/src/` for summaries, plus their tests.
  **Must not** modify posting, journal, invoice/bill mutation code, `packages/accounting-core`, or `packages/db`.

## Deliverables

Before adding anything, check (with `rg`) whether existing report and dashboard routes already return each
figure. If one does, reuse it and document it rather than duplicating it.

| Endpoint (GET, tenant-scoped, default-deny auth)                               | Returns                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/ui/home-summary`                                                          | cash on hand, money in (30d), money out (30d), profit MTD with prior-period comparison; 12-month income vs expense series; AR and AP aging buckets (current, 1–30, 31–60, 61–90, 90+)          |
| `/v1/ui/attention-queue`                                                       | ranked items: overdue invoices, bills due ≤ 7d, unreconciled bank lines, uncategorized transactions, tax/remittance due dates, failed syncs, each with a deep-link `workspaceId` and target id |
| `/v1/ui/landing/:module` (`sales`, `expenses`, `banking`, `contacts`, `taxes`) | 3–4 KPIs and pipeline stage counts per 02 §3                                                                                                                                                   |
| `/v1/ui/tax-calendar`                                                          | upcoming GST/HST and payroll remittance due dates from existing configuration and filing frequency                                                                                             |

- All money is serialized as **strings of minor units** (existing API convention). Derive every figure from
  posted ledger entries or existing report services (AGENTS.md "Reports derive from posted ledger entries").
- Add the routes to the v1 OpenAPI document.

## Acceptance

- Integration tests against the stream DB prove the following:
  - totals equal the existing report endpoints for the same period (contract tests);
  - RLS/tenant isolation holds;
  - unauthorized requests are rejected.
- No diff in frozen paths. `corepack.cmd pnpm test:integration` is green.
- A response example is committed in `docs/status/UI_V2_API_SUMMARY_REPORT.md` for the Wave 2 streams.
