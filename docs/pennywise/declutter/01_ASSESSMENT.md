# PennyWise UI Assessment (beta 0.14.x)

Status: functional, installable and passing release gates on Windows 11. The problem is
not missing capability. The problem is that every capability is presented at the same
visual weight, so the 5–6 daily jobs are hard to find among about 40 destinations.

## Measured clutter (apps/web/index.html, apps/web/app.js)

| Metric                                                     | Today                                                           | Research target                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Top-nav items (`index.html` nav)                           | 15                                                              | 0 (merged into one rail)                             |
| Left-rail items (`leftNavigationDefinitions`, app.js ~965) | 20                                                              | 7 primary, plus "More"                               |
| Navigation layers visible at once                          | 4 (top nav, rail, tabs, banners)                                | 2 (rail, page tabs)                                  |
| Buttons in the DOM                                         | 463                                                             | ≤ 12 visible per landing page                        |
| Form controls                                              | 779                                                             | Shown only inside the active task panel              |
| Forms / tables / dialogs                                   | 121 / 59 / 22                                                   | One primary table per landing page                   |
| Charts                                                     | 0 (no chart helper exists)                                      | Home + every landing + every core report             |
| Dashboards                                                 | 2, overlapping (Home `#overview-workspace` and Reports summary) | 1 Home dashboard, plus a mini-dashboard per category |

## Root causes

1. **Flat information architecture.** POS, Fixed assets, Contracts, Fulfilment, Integrations,
   Switching centre and Payroll sit at the same level as Sales and Banking. Research shows
   that 8–12 top-level items is the ceiling, and that progressive disclosure is the
   fix (see [UX_RESEARCH_FINDINGS.md](UX_RESEARCH_FINDINGS.md) §4–5).
2. **Pages are "all forms at once."** Sales renders the customer form, product form, invoice
   editor, preview and list together. Banking shows many equal-weight actions. There is no
   shared _list → inspector → task panel_ pattern (also flagged in `UI_REFACTOR_AUDIT.md`).
3. **No visual summary layer.** Reports are tables plus metric blocks only. Owners must read
   numbers instead of seeing trends.
4. **Duplicated and competing entry points.** Top nav, rail, task finder, quick actions,
   workspace-mode switch and floating-window mode all lead to the same places.
5. **Compliance is hidden.** GST/HST/QST and payroll remittance deadlines live in
   "Accountant tools / Tax centre". Research identifies these as the highest-stakes
   deadlines, so they should appear as reminders on Home.

## What already helps (reuse it, don't rebuild it)

- `visibleLeftNavigationDefinitions()` and `ownerNavigationKeys` (app.js ~2279) already filter
  the rail by profile (`INVOICING_ONLY`) and Owner mode. Extend this as the single
  visibility mechanism.
- Owner workspace / Accountant mode (`OWNER_MODE_IMPLEMENTATION_PROMPT.md`) is the right
  idea. It needs to become the default shell, not a third mode.
- Task finder, configurable Home layout, amount privacy and token-based `styles.css`.
- Playwright coverage (25 specs in `apps/web/e2e`) to protect IDs and bindings while the
  layout changes.

## Constraints that bind the revision

- Accounting integrity first. Reports must derive from the posted ledger, and money uses bigint minor units.
- Preserve element IDs, `data-workspace-target`, form names, event bindings and
  `clearledger_*` storage keys until tests migrate (`UI_REFACTOR_GUIDE.md`).
- Each module change needs a refreshed `docs/COMPETITIVE_RESEARCH_MATRIX.md` entry and
  owner authorization in `docs/status/CURRENT_PHASE.md` (AGENTS.md).
- Hidden is not deleted. Advanced features stay reachable through "More", the task finder and
  deep links, and authorization is unchanged.
