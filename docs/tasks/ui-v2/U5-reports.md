# U5 — Reports landing and report pages

- **Engine:** Antigravity · **Wave:** 2 · **Slot:** 13 · **Branch:** `ui/reports`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §4 (all of it)
- **Owns:** `src/workspaces/reports.js`, its partial, `styles/reports.css`, `e2e/reports.*.spec.ts`

## Deliverables (flag on)

1. **Landing:**
   - a Favourites row (Profit & loss, Balance sheet, Who owes me, Who I owe, GST/HST summary, Cash flow);
   - then All reports in 5 groups;
   - plain-language titles, with the accounting term as a subtitle.
2. **Report page:**
   - a filter bar with Period preset chips and Compare to (previous period, same period last year, none);
   - then a chart, then the table;
   - Basis, currency, saved views and jurisdiction under a collapsed "More filters";
   - one Export menu (PDF, CSV, Print).
3. **Charts per report** using `charts.js`:
   - P&L: monthly bars with a net line;
   - Balance sheet: stacked bar;
   - Aging: bucket bar;
   - Cash flow: waterfall;
   - Expenses: top categories.
   - Each chart element drills down to the same table rows.
4. Δ and Δ% columns appear automatically when Compare is set. Delta calculation comes from the API or
   uses bigint; never use float money.
5. Remove the duplicate "dashboard summary" from Reports when the flag is on (Home owns it now).

## Acceptance

- Golden-file test: report totals are byte-identical before and after for a seeded company.
- Every chart has an accessible table fallback, and the axe scan is clean.
- At most 2 clicks from the Reports landing to any core report with a chart.
- Update the research matrix module `reporting-budgeting-and-insights`.
