# PennyWise Accounting — Visual Atlas

## Purpose and coverage

This is a visual implementation reference for a high-density, original PennyWise Accounting product. It covers each major accounting-screen family and the shared application shell. These are **design references**, not mock functionality: implementation must recreate all labels, controls, states, and interactions as real, accessible UI components.

The actual PennyWise repository is not mounted in this task. When its audit is run, map every real route, tab, modal, drawer, and state to the closest atlas pattern; create an additional screen reference for every unmatched route before declaring the build complete.

External product research is documented in [COMPETITIVE_UI_REFERENCE.md](COMPETITIVE_UI_REFERENCE.md). It informs workflow patterns only—never copy third-party branding, screenshots, text, assets, or exact layout geometry.

## Visual system present in every screen

- **Brand:** original PennyWise triple-beam/pillar mark, deep navy shell, warm ivory canvas, muted teal for support, copper only for primary emphasis.
- **Shell:** compact side navigation, ~48px toolbar, global search/create/help/notifications, company context, contained workspace.
- **Density:** tables and queues are the dominant working surface; metric cards are limited to decision summaries. A desktop user sees task context, data, selected-record detail, and next action at once.
- **Surface hierarchy:** quiet separators, 8–12px radii, and selective soft elevation; no hard boxed web-form look.
- **Field geometry:** short date/amount/reference inputs; medium customer/account selects; flexible descriptions; repeated lines in true tables.
- **Safety:** totals, status, validation, audit activity, disabled conditions, and high-consequence actions stay visible and do not rely on color alone.

## Screen catalogue

| #   | Screen family                    | Visual reference                                               | What is deliberately enriched                                                                                                       |
| --- | -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Command center / Home            | [Open image](pennywise-ui-atlas/01-command-center.png)         | Global toolbar, grouped navigation, action center, compact cash snapshot, activity table, one contextual work window.               |
| 02  | Cash workbench / Bank review     | [Open image](pennywise-ui-atlas/02-cash-workbench.png)         | Queue + dense transaction table + inspector + selection action bar, local filtering/columns/views, source-document context.         |
| 03  | Reconciliation cockpit           | [Open image](pennywise-ui-atlas/03-reconciliation-cockpit.png) | Persistent balance/difference context, paired statement/book views, match controls, exceptions inspector, completion guardrail.     |
| 04  | Sales / Invoice list             | [Open image](pennywise-ui-atlas/04-sales-list.png)             | Account/customer context, filters, invoice status, bulk actions, row menus, receivables detail without page hopping.                |
| 05  | Bills & expense workbench        | [Open image](pennywise-ui-atlas/05-bills-workbench.png)        | Approval queue, source preview, vendor/coding context, due-state clarity, safe batch action controls.                               |
| 06  | Contact / Customer workspace     | [Open image](pennywise-ui-atlas/06-contact-workspace.png)      | Record header, open items, activity, contacts, notes, documents, and direct financial actions in one contextual surface.            |
| 07  | Chart of accounts / Ledger       | [Open image](pennywise-ui-atlas/07-ledger-workbench.png)       | Dense account register, account context, selected transaction inspector, reconciliation and correction cues.                        |
| 08  | Report studio                    | [Open image](pennywise-ui-atlas/08-report-studio.png)          | Compact parameter bar, financial report canvas, drill-down, compare, export/share/schedule actions, saved-report context.           |
| 09  | Tax center                       | [Open image](pennywise-ui-atlas/09-tax-center.png)             | Period checklist, deadline/status clarity, tax totals, evidence, actions and source transactions without dashboard clutter.         |
| 10  | Operations workspace             | [Open image](pennywise-ui-atlas/10-operations-workspace.png)   | Products/services, inventory, projects, or job work: operational rows, related financial status, inspector, and contextual actions. |
| 11  | Settings & administration        | [Open image](pennywise-ui-atlas/11-settings-admin.png)         | Scope navigation, company/users/roles/integrations, clear save state, permission boundaries, progressive advanced options.          |
| 12  | Invoice editor                   | [Open image](pennywise-ui-atlas/12-invoice-editor.png)         | Compact metadata grid, line-item table, customer balance/activity context, accurate totals, persistent save/preview/send bar.       |
| 13  | Journal entry                    | [Open image](pennywise-ui-atlas/13-journal-entry.png)          | Balanced debit/credit grid, difference guardrail, attachments/rationale, audit history, row menu, keyboard hints, post control.     |
| 14  | Month-end close                  | [Open image](pennywise-ui-atlas/14-month-close.png)            | Checklist, blockers, variance table, assigned-owner detail, evidence, audit trail, safe period lock/unlock.                         |
| 15  | Payroll workbench (if supported) | [Open image](pennywise-ui-atlas/15-payroll-workbench.png)      | Pay-run summary, employee exception queue, payroll grid, employee inspector, preflight checks, safe submit action.                  |
| 16  | Onboarding / Import              | [Open image](pennywise-ui-atlas/16-onboarding-import.png)      | Setup checklist, import mapping, source validation, row-level error recovery, company/connection status, recoverable actions.       |

## Screen-by-screen interaction requirements

### 01. Command center

- Toolbar: company switcher, global search, quick-create, notifications/activity, help, profile.
- Action center links into the filtered workbench that resolves the issue; counts and totals must update after an action.
- Keep KPIs economical: cash position, net income, overdue or uncategorized work—not a card wall.
- A focused inner work window may surface the highest-priority task; it must remain keyboard accessible and closeable.

### 02–03. Banking, transaction review, and reconciliation

- Local menu: account/date range, saved view, search, filter, columns, row actions, bulk selection, export, refresh/auto-match only if supported.
- Queue categories must open a filtered table state rather than a disconnected page.
- Inspector must show selected record, supporting document/contact context, suggested match/category reasoning, status, undo/correction path, and next actions.
- Reconciliation must pin statement balance, cleared balance, and live difference. Do not enable finish/close when accounting rules are unmet.

### 04–06. Sales, bills, and contacts

- Lists need searchable/filterable status, sortable amounts/dates, compact row actions, selection-aware batch action bars, and a related-object inspector.
- Invoice/bill documents use a compact header grid + line-item table + totals + persistent action bar. Attachments, notes, and advanced fields are secondary disclosures.
- Contact records need open receivables/payables, activity, documents, notes, relationships, and permission-aware financial actions without forcing a multi-page hunt.

### 07 & 13. Ledger and journal work

- Registers prioritize account/period context, filter/sort/search, stable numerical alignment, detail inspector, audit provenance, and correction safeguards.
- Journal entry must keep debit total, credit total, and difference visible while editing. Post only after validation; preserve rationale and attachment evidence.

### 08–11. Reports, tax, operations, and administration

- Reports: one compact period/filter/action band, output first, drill-down beside or below, export/share/schedule grouped together.
- Tax and month-close workflows: checklist + source detail + deadlines + evidence + safe irreversible action. Status labels must include text.
- Operations: use a list/inspector/workspace pattern, not a mini dashboard. Show related inventory/project/time/financial context in the same view.
- Settings: low-frequency but still concise. Keep a clearly scoped left index, small form groups, visible save/sync state, and progressive advanced controls.

### 14–16. Close, payroll, and onboarding

- Close: blockers, owners, related transactions, exception explanation, and period-lock prerequisite must be discernible without page hopping.
- Payroll: show payroll totals, funding, exceptions, employee details, preflight results, audit signals, and the submit guardrail at once.
- Onboarding/import: make validation recoverable. Keep source row, issue, why it matters, correction control, preview, and import state in the same task surface.

## Mature-product comparison: what we retain and what we improve

| Mature pattern                                            | Evidence                                                                                                                                                                 | PennyWise application                                                                                                    | PennyWise differentiation                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Dense bank-table review with visibility of matching state | [QuickBooks 2026 update](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-subscriptions/new-quickbooks-online/L66q5XLC5_US_en_US)                   | Sticky headers, statuses, compact rows, filter/column tools, batch action bar.                                           | Original workbench, toolbar hierarchy, naming, iconography, spacing, and brand—no visual copying. |
| Statement line vs. book transaction match                 | [Xero reconciliation guide](https://central.xero.com/s/article/Bank-reconciliation-in-Xero)                                                                              | Paired reconciliation cockpit with visible reasoning and correction/undo path.                                           | PennyWise adds a consistent inspector/evidence pattern and its own contained work-window design.  |
| Match-method confidence/reasoning                         | [Xero bank-records guide](https://central.xero.com/0/guide/a5B3m00000F5CItEAN/keep-your-bank-records-accurate-and-up-to-date)                                            | Labels tell users whether a match was rule-based, suggested, manual, or needs review.                                    | Explanations stay plain-language and non-proprietary; status uses text plus icon/color.           |
| Bill approval and duplicate awareness                     | [Xero bill workflow](https://central.xero.com/0/article/Add-and-approve-bills)                                                                                           | Bills workspace uses visible draft/approval/payment state, attachment and duplicate-warning context.                     | PennyWise is designed as one queue/table/inspector surface rather than a copied document flow.    |
| AP workflow visibility and control                        | [Sage AP workflow overview](https://us-marketplace.sage.com/en-US/apps/59394/sage-ap-automation-for-sage-50cloud/overview)                                               | Show POs, invoices, expenses, payments, approval blockers, funding context, and exceptions in the same workbench.        | PennyWise uses only the workflow lesson; no Sage text, assets, or layout is reused.               |
| Data-table usability                                      | [USWDS table guidance](https://designsystem.digital.gov/components/table/) and [Carbon data-table guidance](https://carbondesignsystem.com/components/data-table/usage/) | Semantic tables, restrained toolbar, batch action pattern, intentional horizontal handling, columns appropriate to task. | Tables are calibrated for accounting and PennyWise tokens, not copied component styling.          |

## Visual acceptance gate for every real project screen

Before the build is declared complete, Codex must produce a route-level review table with:

| Required evidence            | Standard                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Route/matching atlas pattern | Every visible route, nested screen, modal, drawer, popover, and shared state is mapped.                                                      |
| Wide desktop screenshot      | 1440×900; global shell, local context, key data and primary action visible.                                                                  |
| Compact desktop screenshot   | 1280×800 or 1024×768; no crushed columns, lost context, or toolbar clipping.                                                                 |
| Responsive screenshot        | Tablet/mobile; inspector reflows into a sheet/drawer, primary task remains completable.                                                      |
| State screenshots            | Populated, selected, empty, loading, validation/API error, permission/read-only, and disabled/destructive-action state where applicable.     |
| Interaction review           | Menus, keyboard focus, row selection, dialogs, tooltips, overflow controls, save/unsaved state, and status messages are real and accessible. |
| Functional proof             | Existing tests/build/lint plus happy-path and error-path verification for the actual workflow.                                               |

## Do not extract UI from the images

Image text, data, and icons are illustrative. Build them as semantic text and reusable components, use real application data, preserve current data contracts, and fit the actual repository’s UI stack.
