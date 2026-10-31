# Target UX: Information Architecture, Dashboards, Landing Pages, Reports

Evidence: [UX_RESEARCH_FINDINGS.md](UX_RESEARCH_FINDINGS.md). The patterns adopted here are
generic and must not copy branding or wording: Xero-style status pipelines, a
FreshBooks/QBO-style single "+ New", Wave-style minimal home, NN/g progressive disclosure,
and a cap of 3–5 KPIs.

## 1. Shell (one navigation layer)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PennyWise  [Company ▾]   [ Search or jump… Ctrl+K ]   [+ New ▾]  🔔  ⚙  👤 │
├────────────┬─────────────────────────────────────────────────────────────┤
│ Home       │  <Landing page: KPI strip · pipeline · list · inspector>      │
│ Sales      │                                                             │
│ Expenses   │                                                             │
│ Banking    │                                                             │
│ Contacts   │                                                             │
│ Taxes      │                                                             │
│ Reports    │                                                             │
│ ───────    │                                                             │
│ More ▸     │  (flyout: enabled extended modules)                         │
│ Help       │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
```

- **Remove the top nav** (`index.html` lines 20–80). The rail is the only module navigation.
  Keep the old `data-workspace-target` anchors as hidden and test-addressable until
  specs migrate.
- **Primary (7):** Home, Sales, Expenses, Banking, Contacts, Taxes, Reports.

  | Rail item | Existing workspace(s)                                      |
  | --------- | ---------------------------------------------------------- |
  | Home      | `overview` (and the owner workspace merges here)           |
  | Sales     | `sales` (invoices, estimates, customer payments)           |
  | Expenses  | `purchases` (bills, expenses, vendor payments)             |
  | Banking   | `banking` (+ `payments` refunds/disputes as a tab)         |
  | Contacts  | customers + vendors (+ CRM tab when enabled)               |
  | Taxes     | the tax part of `accountant` + payroll remittance calendar |
  | Reports   | `reports`                                                  |

- **More ▸ (extended features, off by default unless the business profile enables them):**
  POS, Inventory, Projects & time, Calendar, Contracts, Orders & fulfilment, Budgets,
  Fixed assets, Payroll, Integrations, Switching centre, Accountant tools.
  - Each module has a toggle in Settings → _Features_, stored in `workflowPreferences`.
  - Modules that are enabled _and_ used in the last 30 days may be pinned into the rail by the user.
- **Utility zone (bottom of rail / header icons):** Settings, Appearance, Help, Notifications.
  Move these out of the main surface: layout customization, zoom/window controls,
  print and refresh go to the ⚙ / ⋯ menus. Floating-window mode becomes a Settings option.
- **"+ New" menu (global, Ctrl+N):** Invoice, Payment received, Expense/receipt, Bill,
  Estimate, Customer, Vendor, Journal entry (accountant role only). Keep the familiar "New"
  label, because research shows relabeling was a top complaint.
- **Owner/Accountant mode** becomes a _preset_ for which modules appear in More and
  which advanced controls are expanded. It is no longer a separate rail. It is never authorization.
- **Implementation hook:** extend `leftNavigationDefinitions` with `tier: "primary" | "more" | "utility"`
  and `featureKey`. `visibleLeftNavigationDefinitions()` remains the single filter.

## 2. Home dashboard (the one business overview)

Replaces both `#overview-workspace` content and the Reports "dashboard summary". It fits
one 1366×768 screen without scrolling.

```
┌ Needs attention (max 5, ranked by deadline/amount) ────────────────────────┐
│ ⚠ GST/HST return due Apr 30 · est. $2,140 owing   [Review]                  │
│ 3 invoices overdue · $4,860                        [Send reminders]          │
│ 18 bank transactions to categorize                  [Categorize]            │
└─────────────────────────────────────────────────────────────────────────────┘
┌ Cash ──────────┐┌ Money in (30d) ┐┌ Money out (30d) ┐┌ Profit (MTD) ───────┐
│ $24,310        ││ $18,200 ▲12%   ││ $11,950 ▼4%     ││ $6,250 vs $4,900 LM │
│ ▁▂▃▅▆▇ 90d     ││ sparkline      ││ sparkline       ││ ▲ 28%               │
└────────────────┘└────────────────┘└─────────────────┘└─────────────────────┘
┌ Who owes me (AR aging bar) ─────────┐┌ Who I owe (AP aging bar) ────────────┐
│ Current ████ 1-30 ██ 31-60 █ 60+ ▌  ││ Due this week $3,200 · next 30d ...  │
│ Top 3 customers by overdue          ││ Top 3 bills due                       │
└─────────────────────────────────────┘└──────────────────────────────────────┘
┌ Income vs expenses, last 12 months (bar chart) ──────────────────────────────┐
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules:

- Use 4 KPI cards. Each card shows a value, its comparison and a sparkline, and clicks through to the filtered list.
- The "Needs attention" queue is computed from existing deterministic review queues, tax period
  due dates and the bank unreviewed count. It shows at most 5 rows and uses one verb per row.
- Missing data shows "No bank account connected yet. [Connect]" instead of `$0`.
- Amount privacy and the configurable layout are retained. Widgets are reorder/hide only.
- All figures come from existing report endpoints (ledger-derived). The UI must not do any accounting math.

## 3. Category landing pattern (identical skeleton for every module)

```
┌ <Module>  ───────────────────────────────────────────── [Primary action] [⋯] ┐
│ KPI ×3–4 (value + comparison, clickable filters)                              │
│ Pipeline:  Draft (2) → Sent (14) → Overdue (3) → Paid (41 this month)          │
├───────────────────────────────────────────┬──────────────────────────────────┤
│ List (filtered by pipeline step)           │ Inspector (selected record):      │
│ search · 1 filter chip row · bulk actions  │ summary, next step button,        │
│ dense table, 25 rows, keyboard nav         │ activity, attachments, "More ▾"   │
└───────────────────────────────────────────┴──────────────────────────────────┘
Task panel: create/edit opens as a right-side panel or full-height drawer. It never
appears inline above the list.
```

| Module       | KPIs                                                             | Pipeline steps                                       | Primary action               |
| ------------ | ---------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| Sales        | Outstanding, Overdue, Paid 30d, Avg days to pay                  | Estimate → Draft → Sent → Overdue → Paid             | New invoice                  |
| Expenses     | Bills due 7d, Overdue bills, Spent 30d, Receipts to review       | Receipt inbox → Draft bill → Awaiting payment → Paid | New expense                  |
| Banking      | Cash across accounts, To review, Unreconciled since, Last import | Import → Review/match → Categorized → Reconciled     | Import / Review transactions |
| Contacts     | Customers owing, Vendors owed, New this month                    | (segment tabs: Customers / Vendors / All)            | New contact                  |
| Taxes        | Next return + due date, Est. owing, Last filed                   | Open period → Review → Filed → Paid                  | Prepare return               |
| Reports      | (favourites grid, see §4)                                        | n/a                                                  | Run report                   |
| More modules | Same skeleton with module-specific KPIs and steps                |                                                      |                              |

Rules:

- ≤ 12 visible buttons per landing page. Secondary actions go in the ⋯ menu or the inspector "More ▾".
- One create form at a time. The Sales customer and product forms move into Contacts and Products,
  and "Add new customer" opens as an inline quick-create inside the invoice panel.
- Pipeline counts are links. They set the list filter and persist it to `clearledger_*` session storage.
- Advanced fields (classes, multi-currency, custom numbering, tax overrides) stay collapsed under
  "More options" inside the task panel.

### Daily one-screen workflows (click budget, measured by Playwright)

| Job                     | Path                                                            | Budget                |
| ----------------------- | --------------------------------------------------------------- | --------------------- |
| Create + send invoice   | + New → Invoice → pick customer → lines → Send                  | ≤ 6 clicks, 1 screen  |
| Record payment received | Sales → Overdue/Sent row → Record payment → Save                | ≤ 4 clicks            |
| Enter expense/receipt   | + New → Expense → drop receipt → category → Save                | ≤ 5 clicks            |
| Categorize bank txns    | Home attention row → Banking review → accept suggestion (Enter) | ≤ 1 keystroke per txn |
| Pay bills               | Expenses → Due 7d → select → Pay                                | ≤ 4 clicks            |
| Check "how am I doing"  | Home                                                            | 0 clicks              |
| Prepare GST/HST         | Home attention row → Taxes → Review → Mark filed                | ≤ 4 clicks            |

## 4. Reporting

- **Landing:** a _Favourites_ row (default: Profit & loss, Balance sheet, Who owes me, Who I owe,
  GST/HST summary, Cash flow), then _All reports_ grouped as Business overview / Sales &
  customers / Expenses & vendors / Tax / Accountant (GL, TB, Journal, audit).
- **Plain-language titles, with the accounting term as a subtitle.** Examples: "Who owes me" with
  "Accounts receivable aging"; "Profit & loss" with "Income statement".
- **Report page layout:** a filter bar with _Period_ (preset chips) and _Compare to_
  (Previous period / Same period last year / None), then a chart, then the table. Basis, currency,
  saved views and jurisdiction move into a collapsed "More filters". Export (PDF/CSV/Print) goes in one menu.
- **Chart per report:** P&L uses monthly bars with a net line. Balance sheet uses a stacked bar. Aging uses a
  bucket bar. Cash flow uses a waterfall. Expenses use a top-categories bar. The table remains the source of truth
  and every chart element drills down to the same rows.
- Delta columns (Δ and Δ%) appear automatically when Compare is set.
- **Chart helper:** add `apps/web/src/charts.js` (stubbed in U0, implemented by the Wave 1 charts stream), a dependency-free SVG module for bar, line, sparkline,
  stacked bar and waterfall. It must be accessible (title/desc, table fallback, pattern fills for
  grayscale print) and take minor units from the API, formatting them through `money.js`. No external chart library is needed,
  which keeps the CSP and offline/MSIX constraints simple.

## 5. Visual and density rules (additions to `UI_QUALITY_BAR.md`)

- One primary button per view. All other actions use secondary or ghost styles.
- Card headings (h2) are used only for dashboard widgets. Work surfaces use the table + inspector pattern.
- 8-px spacing grid with a compact density token. Status colors are used only for state (overdue, due soon, ok).
- Every empty state has one sentence and one action.
