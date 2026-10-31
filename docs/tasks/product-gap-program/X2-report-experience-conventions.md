# X2 — Report and dashboard experience: dense, drillable, stable, accessible

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `apps/web/app.js`: the reports workspace and the Home dashboard
- `apps/web/index.html`, `apps/web/styles.css`
- Read only, unless a narrow API addition is justified: `phase10-report-service.ts`,
  `report-service.ts`, and the report export routes

**Closes:** D7, D8, and the presentation side of D6 in
`DECISIONS-currency-reporting-workflow.md`
**Effort:** M–L. Split into: the report shell and drill-down; saved views and number
conventions; then the dashboard.
**Depends on:**

- **X1**, the money formatter.
- **M3**, for the "Original currency" data on aging. Until then, keep that toggle hidden.

## Context

- **Reporting is what buyers value most.** Software Advice analysed 1,700+ verified reviews
  (January 2025–January 2026). It found that 93 % rate income statement and balance sheet
  features, and 91 % rate financial reporting, as critical or high importance. It describes
  reporting failures as a common driver of upgrades.
- **The category's biggest recent backlash was forced report redesigns:**
  - **QuickBooks Modern View:** "window within a window", slower drill-down, drill-down that
    snaps back to the new view, filters that drop columns, slowness on large ranges, and no
    way to keep the old view.
  - **Xero's retirement of old reports:** lost cross-format layouts, and extra rows.
- **Xero's widget homepage** was liked for at-a-glance status. It was disliked for oversized
  widgets and large numbers readable by passers-by, until resizing was added.
- **PennyWise already has formal reports,** comparison, printing and CSV export. This prompt
  sets conventions and applies them to the existing reports. It adds no new report
  calculations.

## Tasks

1. **Report shell,** applied to every report in the reports workspace:
   - **Filter bar:** period presets plus custom range, basis where relevant, comparison
     (previous period, previous year, budget if one exists), and a currency filter where
     the report has currency data.
   - **Header line:** always "Amounts in CAD (base currency)", or the currency shown.
   - **Table:**
     - sticky header and first column;
     - tabular numerals, right-aligned;
     - hierarchy indentation, and collapse/expand for account groups;
     - subtotal and total rows visually emphasized;
     - "Hide zero rows" option.
   - **Actions:** Save view, Download CSV, Print or PDF.
2. **Drill-down in place.** Selecting an amount opens its transactions in a side panel, or
   below on narrow screens, with a breadcrumb (for example "Profit & loss › Sales ›
   Transactions").
   - Opening a source document and coming back **restores the report, its filters and
     scroll position.**
   - Never switch the report into a different layout when drilling.
3. **Saved views** ("memorized reports"):
   - They save filters, comparison, collapsed groups and columns.
   - They are per user, optionally shared with the organization, and permission-aware.
   - A default view can be set per report.
4. **Number conventions:**
   - Negatives in reports use **parentheses**, with a visually hidden "negative" for screen
     readers.
   - Inputs use a minus sign.
   - **Colour is never the only signal.** Overdue, loss and variance carry text or an icon
     too.
5. **Multi-currency presentation,** after M3 supplies the data:
   - An **"Original currency" toggle** on AR/AP aging (summary and detail) adds currency,
     original amount and open original amount columns, with per-currency subtotals.
   - Revalued foreign figures carry an X1 rate popover.
   - Customer statements default to the customer's currency.
6. **Dashboard (Home):**
   - **Tiles:** small, medium and large sizes, with a saved per-user layout. Chart on or
     off for small tiles.
   - **Privacy:** a **"Hide amounts"** switch masks figures until it is turned off. It is
     remembered per user and per device.
   - **Currency label:** money tiles state the base currency.
   - **Foreign exposure:** when multi-currency is on, a tile such as "Owed to you in USD:
     US$12,400 (≈ $16,800 at today's rate)".
   - **Charts:** values labelled directly, and never colour-only.
7. **Layout-stability policy.** Add it to `docs/pennywise/COMPETITIVE_UI_REFERENCE.md` and
   to the decisions log:
   - no forced migration of a daily-use screen;
   - a redesign ships opt-in beside the old one for at least one release, with a layout
     importer;
   - no removal of a working capability;
   - measure task time and keystrokes before and after.
8. **Performance budget.** On the reference build machine, with the full demo company
   (`scripts/seed-full-demo-company.mjs`):
   - a 12-month P&L with comparison renders in under 1 second;
   - a GL detail of 5,000 lines renders its first screen in under 1 second, and scrolls
     smoothly.
     Record the measured times.

## Constraints

- Figures come from the existing report services. **No client-side recalculation of
  totals.**
- CSV keeps the server's column contract.
- Print output stays legible in greyscale.
- Keyboard:
  - every table and control is keyboard-operable;
  - drill-down is reachable with Enter;
  - Escape closes the panel.

## Acceptance criteria

- **Drill-down (e2e):** P&L → drill into an account → open a transaction → back. The
  filters, comparison and scroll position are unchanged.
- **Saved views:** a saved view survives sign-out and sign-in. A shared view is visible to
  another permitted user and hidden from a viewer without report permission.
- **Negatives:** they render in parentheses in reports (snapshot test), and the accessible
  text includes "negative".
- **Hide amounts:** masks every money tile, and the setting persists.
- **Accessibility:** axe checks pass on the reports workspace and Home.
- **Performance:** the recorded times meet the budget, or the report explains any gap.
- **Regression:** the existing report e2e specs and CSV exports still pass.

## Out of scope

- New report types.
- Scheduled or emailed reports; worth a later prompt.
- A custom report builder.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
