# U2 — Home dashboard

- **Engine:** Codex · **Wave:** 2 · **Slot:** 7 · **Branch:** `ui/home`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §2 (layout and rules)
- **Owns:** `src/workspaces/home.js`, `src/partials/home.html`, `styles/home.css`, `e2e/home.*.spec.ts`
- **Consumes:** ui-kit (AttentionQueue, KpiCard, EmptyState), `charts.js`, `/v1/ui/home-summary`,
  `/v1/ui/attention-queue`

## Deliverables (flag on)

1. **Needs attention:** at most 5 rows, one verb button each, deep-linking via `shell.navigateTo`.
2. **4 KPI cards:** Cash, Money in (30d), Money out (30d), Profit MTD. Each shows a value, a comparison
   and a sparkline, and clicks through to the filtered list.
3. AR and AP aging bars with the top 3 overdue customers and the top 3 bills due.
4. A 12-month income vs expenses bar chart.
5. Empty states replace `$0` (for example "No bank account connected yet. [Connect]").
6. Keep amount privacy and layout reorder/hide. Retire the duplicate Reports "dashboard summary" behind
   the flag; it stays visible in classic mode.

## Acceptance

- `e2e/home.dashboard.spec.ts`:
  - no vertical scroll at 1366×768;
  - KPI values equal the API (and the report endpoints) for a seeded company;
  - the attention rows navigate correctly;
  - the 0-click "how am I doing" test (everything visible on load).
- Accessibility scan clean. The UI does no accounting math: values are formatted only.
