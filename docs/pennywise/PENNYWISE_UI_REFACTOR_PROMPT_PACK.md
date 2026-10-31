# PennyWise Accounting — Codex UI Refactor Prompt Pack

> **Purpose:** Use this pack from the root of the PennyWise Accounting repository to transform the entire existing product into a high-density, polished desktop accounting workspace. It preserves behavior and data flows while replacing generic web-form presentation with a coherent, original PennyWise interface.
>
> **Important:** This is inspired by proven accounting-software workflow patterns, not a request to reproduce QuickBooks. Do not copy QuickBooks or Intuit names, copy, colors, icons, layout geometry, screenshots, or proprietary assets. See [COMPETITIVE_UI_REFERENCE.md](COMPETITIVE_UI_REFERENCE.md) for external, link-only research.

## How to use this pack

1. Start with **Prompt 1**. It is audit-only; it discovers the real codebase before changing it.
2. Apply **Prompts 2–5** in order. Each one requires Codex to keep an explicit route/component inventory, so no existing UI surface is silently skipped.
3. Use **Prompt 6** for the final cross-project quality pass.
4. Use the **Future-screen prompt** whenever a new PennyWise screen is added.

If the repository already has a relevant design system, component library, routing solution, test suite, or accessibility helpers, extend them rather than replacing them unnecessarily.

---

## Product north star

PennyWise Accounting is an agile accounting workspace for small-business owners and accounting teams. It should feel like well-made desktop software inside a browser:

- **High useful density, not visual crowding.** A user should be able to review a queue, work with transaction rows, see contextual detail, and take the next action without navigating away.
- **Task-first organization.** Group work by business task: Work, Money, Accounting, and Insights. Keep settings and setup out of the primary task flow.
- **Original PennyWise identity.** The visual language is calm, deliberate, and dependable: a subtle three-beam balance plus Roman-pillar motif, deep navy, restrained copper, muted teal, warm ivory, and clear data typography.
- **Functional terrain.** Every important object has a dependable place: global create/search at the top, task navigation at the side, dense records in the center, and details/actions in an inspector or contained work pane.
- **Preserved functionality.** Existing calculations, validation, APIs, authorization, routing, persistence, and accounting semantics must continue to work exactly as before unless a defect is found and documented.

---

## Non-negotiable UI rules

### Space and layout

| Area                | Rule                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell           | 48–56px top toolbar; 208–224px expanded navigation; 56–64px collapsed navigation. Do not stack multiple decorative headers.                                                                                                     |
| Content canvas      | 24px desktop outer inset, 16px between primary panels, 8px internal micro-spacing. Use a predictable 8px grid.                                                                                                                  |
| Page heading        | Exactly one visible `h1` per route. On desktop, target 26–30px / 32–36px. Pair it with concise page actions; do not repeat the same title in card headers.                                                                      |
| Dense workspace     | Prefer a queue + table + inspector composition for recurring accounting work. A table should show roughly 9–14 useful rows at a 1440×900 viewport when the workflow is row-oriented.                                            |
| Work panes          | Use one elevated active work pane or inner window where it helps focus (for example reconciliation or invoice editor). Do not surround every section with a heavy outlined box.                                                 |
| Panels              | Use 8–12px radius, a subtle 1px separator, and a low soft shadow only when elevation is meaningful. Most sibling panels should be separated by spacing and dividers, not stacked shadows.                                       |
| Responsive behavior | At >=1200px, allow the three-pane desktop workbench. Between 960–1199px, collapse the inspector into a drawer. Below 960px, prioritize the active table/form and use a modal/drawer for secondary detail. Preserve all actions. |

### Typography and visual hierarchy

| Token role       | Suggested desktop size | Use                                                             |
| ---------------- | ---------------------- | --------------------------------------------------------------- |
| Page title       | 28/34                  | One `h1` per route                                              |
| Section title    | 18/24                  | Major distinct sections only                                    |
| Panel title      | 15–16/20               | Header of a work pane or compact summary                        |
| Body / table row | 13–14/18–20            | Default working text                                            |
| Label / metadata | 12/16                  | Field labels, timestamps, secondary context                     |
| Numeric emphasis | 14–18                  | Totals, balances, variance; use tabular figures where available |

- Never use a heading merely to label a field group that is already visually obvious.
- Favor short noun labels: `Review queue`, `Transactions`, `Inspector`, `Line items`, `Activity`.
- Use sentence case. Avoid title-case noise, decorative taglines, or serial subtitles.
- Maintain semantic HTML heading order even when visual labels are compact.

### Color, surfaces, and brand cues

Establish tokens in the repository’s existing theming mechanism. These values are a starting direction, not a reason to hard-code colors throughout components:

```text
canvas:          #F7F3ED   warm ivory
surface:         #FFFDF9   clean working surface
surface-muted:   #F1ECE5   subtle grouped context
ink:             #142A3B   deep navy
ink-muted:       #65707A   secondary text
teal:            #356E75   navigation/interactive support
copper:          #B8673D   sparing primary emphasis
border:          #DDD7CE   quiet separator
success:         #247454   semantic success only
warning:         #A96514   semantic warning only
danger:          #B43B36   semantic error/overdue only
focus:           #1F6F83   visible keyboard focus
```

- The three-beam/pillar mark must be original and only used once per persistent brand location (for example app shell, loading state, or empty state), not repeated as decoration.
- Copper is an accent, not an entire screen background.
- Never use bright QuickBooks-style green as a brand color. Use green only for explicit positive financial status.
- Avoid gradients, glassmorphism, thick black borders, default browser shadows, and random rounded rectangles.

### Inputs, tables, and actions

| Control/data type           | Desktop width guideline    | Behavior                                                                   |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| Amount / rate / quantity    | 72–128px                   | Right align values; support keyboard entry; use tabular numerals.          |
| Date                        | 128–156px                  | Short, stable format and calendar control.                                 |
| ID / reference / code       | 96–160px                   | Do not stretch across the page.                                            |
| Status / tax / terms        | 128–180px                  | Compact select or combobox.                                                |
| Contact / account / project | 220–320px                  | Searchable select; show key context.                                       |
| Search                      | Fluid, 260–480px max       | Global search belongs in the toolbar; local search belongs near the table. |
| Description / memo          | Fluid within its grid cell | Use a 2–3 row maximum before expandable editing.                           |
| Long narrative              | Full available column      | A deliberate exception, with character guidance if relevant.               |

- Use a field grid for one-off forms: identity/contact fields on the left; dates, reference, terms, and status on the right; line items in a table below; primary actions in a persistent lower action bar.
- Do not create single-column forms with every input at 100% width unless the viewport or data type requires it.
- Make tables primary for repeated records and repetitive entry. Include sticky column headers, sortable columns, sensible default columns, column visibility controls, a local filter row, zebra or hover readability treatment, and non-color status labels.
- Use a selected-row action bar for batch work. Do not duplicate each row action as a large button.
- One action per focal area may be visually primary. Secondary actions should be text, outline, or an overflow menu.

### Accessibility and interaction rules

- Meet WCAG 2.2 AA color contrast and focus-visibility requirements.
- Every interaction must work by keyboard: logical Tab order, Enter to invoke row/edit actions where appropriate, Escape to close a dialog/drawer, arrow-key support in composite controls, and no keyboard traps.
- Never communicate financial state with color alone. Pair it with labels, icons with accessible names, or text.
- Preserve form labels, validation relationships, error summaries, live regions, and existing test IDs unless deliberately migrated everywhere.
- Keep dialogs focused, labeled, and dismissible; restore focus to the launching control.
- Respect reduced-motion preferences and do not use motion for essential meaning.

---

# Prompt 1 — Full audit before editing

Copy this prompt into Codex from the repository root:

```text
You are auditing the PennyWise Accounting codebase before a project-wide UI refactor. Do not edit application code yet.

Goal: map every existing user-facing interface so we can replace generic web-form presentation with a high-density, polished desktop accounting workspace while preserving all working behavior.

First, inspect the full repository. Identify:
1. UI framework, build/test/lint commands, router, state/data layer, component library, icon system, CSS/theme strategy, and authentication/authorization boundaries.
2. Every route, screen, nested view, modal, drawer, form, table, dashboard, empty/loading/error state, and reusable UI component. Include hidden/secondary routes reachable from navigation, menus, and row actions.
3. The existing accounting workflows: dashboard, banking/feed review, reconciliation, invoices/sales, bills/purchases/expenses, contacts, chart of accounts, journals, reports, taxes, inventory, payroll, fixed assets, settings, and any project-specific modules actually present.
4. Existing functionality that must not regress: APIs, validation, calculations, currency/date handling, route parameters, permissions, persistence, keyboard support, test selectors, and data attributes.
5. Visual debt: redundant headings, oversized inputs, uncontrolled margins, card/border overuse, inconsistent density, broken responsiveness, and inaccessible interactions.

Create a concise `UI_REFACTOR_AUDIT.md` in the project root. It must include a route/component inventory table with columns: surface, source file(s), workflow role, current implementation pattern, functionality-risk notes, target PennyWise pattern, and migration status. Add a test/build command section. Do not make UI changes in this step.

Use `rg` or equivalent fast search first. Preserve unrelated user changes. At the end, report the inventory count and the exact implementation order you recommend.
```

---

# Prompt 2 — Create the shared PennyWise design system

Run this after the audit has been reviewed:

```text
Implement the PennyWise Accounting shared UI foundation described below, using the existing technology and component conventions found in `UI_REFACTOR_AUDIT.md`. Preserve working behavior. Do not create a parallel design system or rewrite unrelated business logic.

Design objective: dense, calm, desktop-grade accounting workspaces—not generic web forms and not a QuickBooks clone. Use PennyWise’s original visual language: warm ivory canvas, deep navy, muted teal, sparse copper emphasis, quiet separators, and the abstract three-beam/Roman-pillar brand motif.

Create or modernize reusable primitives, naming them to fit the repository’s conventions:
- AppShell: 48–56px toolbar, functional left navigation, responsive content frame.
- TopToolbar: company context, date context where relevant, global search, quick-create, utility actions.
- SideNav: grouped into Work, Money, Accounting, Insights, plus Settings; supports expanded and collapsed states without losing accessible labels.
- PageFrame and PageHeader: one `h1`, compact contextual actions, no duplicated page title bands.
- WorkspacePanel / WorkWindow: restrained elevated pane for focused tasks; 8–12px radius, quiet separator, only meaningful elevation.
- DataTable: sticky header, density variants, sort/filter/column controls, row selection, bulk action bar, status cells, empty/loading/error states.
- InspectorPanel: persistent contextual detail at desktop; responsive drawer at narrower widths.
- FormGrid and FieldGroup: field widths follow data type; no universal full-width input rule.
- ActionBar: persistent context-sensitive lower actions for long forms and selected table rows.
- Dialog/Drawer/Popover/Toast/EmptyState/ErrorState primitives that preserve keyboard and ARIA behavior.

Implement design tokens for color, type, spacing, radii, borders, shadows, focus, z-index, and control heights. Use the following operational scales:
- spacing: 4, 8, 12, 16, 24, 32px;
- toolbar/control heights: 32, 36, 40, 48, 56px;
- table rows: compact 32px, standard 40px;
- desktop outer content inset: 24px;
- panel gap: 16px;
- input sizing: amounts 72–128px, dates 128–156px, references 96–160px, selects 128–180px, contacts/accounts 220–320px, fluid search capped at 480px.

Do not use gradients, thick outlines, generic box shadows, huge inputs, repeated headings, or gratuitous card grids. Make WCAG 2.2 AA, semantic landmarks, visible focus, reduced motion, and keyboard interaction part of each primitive—not an afterthought.

Document the finalized tokens and component rules in `UI_REFACTOR_GUIDE.md`, including concise usage examples. Add or update tests/stories where the project supports them. Run the appropriate typecheck, tests, lint, and build before reporting results.
```

---

# Prompt 3 — Refactor the shell, navigation, and global terrain

```text
Using the audited route inventory and the new PennyWise UI primitives, refactor every shared application-chrome surface: root layout, toolbar, navigation, global search, quick-create entry points, notifications, account/company context, route breadcrumbs/context, and all shared dialogs/drawers.

The application must now behave as a coherent desktop accounting workspace:
- Top toolbar stays compact (48–56px) and never turns into a second marketing header.
- Navigation groups current routes into Work, Money, Accounting, and Insights. Preserve every existing destination and permission rule. Put low-frequency setup in Settings; do not hide existing features.
- Desktop uses a collapsible rail. Tablet uses an accessible overlay or drawer. Mobile preserves all navigation but prioritizes the active task.
- Global create is a single reliable entry point; route-specific actions are contextual, not duplicates.
- Global search is useful and bounded in width. It must retain or improve its existing result behavior.
- Provide an original PennyWise wordmark/mark location without importing, copying, or resembling competitor assets.
- Remove redundant page titles, decorative banners, arbitrary outlines, and oversized empty margins across shared layouts.

Do not claim completion until every shared chrome component from `UI_REFACTOR_AUDIT.md` has a migration status. Exercise existing routes after the refactor, preserve auth/permissions, and run build/lint/tests.
```

---

# Prompt 4 — Refactor every accounting workflow

```text
Refactor every existing PennyWise Accounting route and UI state in the audit inventory. This is a whole-project migration, not a dashboard redesign. Keep a visible migration checklist in `UI_REFACTOR_AUDIT.md` and do not mark it complete until each existing route, modal, form, table, loading state, empty state, error state, and responsive variant is covered.

For each surface, use the fitting pattern below. Apply only to modules that actually exist; do not invent business features or remove existing ones.

1. Dashboards and home surfaces
   - One concise page heading.
   - Use an economical metric strip and an action queue, not a field of large tiles.
   - Keep the most urgent workflow reachable in one click.
   - Favor useful activity tables and trend views over decorative summaries.

2. Banking, transaction feeds, categorization, and reconciliation
   - Build the primary desktop view as Review Queue + Transaction DataTable + Inspector.
   - Keep account/date/filter context visible, make matching/categorization status scannable, and expose batch actions only after selection.
   - Reconciliation belongs in a focused WorkWindow containing statement and book views, filters, match state, difference, and a compact lower action bar.
   - Do not force the user to navigate away to see source-document/contact context.

3. Sales, invoices, quotes, payments, and customer records
   - Use a contained invoice/form workspace: compact customer/project and date/reference grid, line-item DataTable, totals context, optional customer inspector, persistent draft/preview/send action bar.
   - Make identifiers, dates, terms, amounts, and taxes compact; make descriptions flex within a deliberate table/form grid.
   - Preserve every calculation, validation, template, status transition, action, and customer link.

4. Bills, purchases, expenses, suppliers, and receipt capture
   - Use lists/queues for repeated work, inspector context for document/contact detail, and compact entry forms for one-off work.
   - Surface due dates, approval/payment state, amounts, attachments, and actions without separate detail pages whenever the viewport supports it.

5. Contacts, products/services, chart of accounts, general ledger, and journals
   - Make the register/table the working surface. Show a right-side inspector or detail pane for a selected row.
   - Prefer inline row actions, filters, saved views, and a bulk action bar over card grids.
   - Journal entry and account-edit forms must use column-aligned, account-aware fields; preserve balance validation and debits/credits semantics.

6. Reports, budgets, taxes, payroll, inventory, fixed assets, and project-specific modules
   - Retain all existing business logic and data views.
   - Make report filters a compact, stable toolbar; render the report/table/chart as the primary content; put export/share/schedule actions in a contained action group.
   - Use tables for dense financial data; give charts enough room to be legible; allow an inspector/drawer for drill-down.

7. Settings, setup, help, and low-frequency administration
   - Keep these visually calmer and lower-density than transactional screens, but use the same tokens and components.
   - Never let setup patterns leak into primary accounting workflows.

Across all routes:
- One visible `h1` per page. Use panel titles only for truly distinct work regions.
- Keep titles, filters, actions, and active data within the first viewport at 1440×900 whenever feasible.
- Use input widths appropriate to data type. Remove universal 100%-width desktop form controls.
- Preserve every existing state: initial, loading, empty, populated, validation error, API error, read-only, disabled, and permission-restricted.
- Maintain high contrast, semantic headings/landmarks, keyboard access, focus behavior, and screen-reader labels.

After each workflow group, run its relevant tests and manually exercise the most important happy path plus validation/error state. Do not replace real data with mock content or sever existing integration points.
```

---

# Prompt 5 — Visual-density and responsiveness pass

```text
Perform a cross-project PennyWise density and responsiveness pass. Do not add features or remove existing behavior; improve the way existing work fits and flows on screen.

For every route in `UI_REFACTOR_AUDIT.md`, inspect it at these viewport classes where the project supports local preview or screenshots:
- 1440×900: dense desktop workbench. Aim for 9–14 data rows for record-heavy views and all critical context/actions in the first viewport.
- 1280×800: standard desktop. Maintain usable table columns; move nonessential inspector context into a drawer only if necessary.
- 1024×768: compact desktop/tablet. Preserve tasks and keyboard workflow; avoid crushed controls.
- <= 768px: responsive task view. Prioritize active content; expose secondary panels/actions through accessible drawers or menus.

Correct all instances of:
- repeated page/card/section titles;
- giant empty bands or input controls;
- arbitrary panel padding or inconsistent margins;
- hard, bolted-on outlines and duplicate shadows;
- card grids where a data table or grouped list is more useful;
- columns that hide critical state or actions without a discoverable alternative;
- tables lacking sticky context, row selection, keyboard navigation, or clear status labels;
- responsive layouts that merely shrink desktop forms instead of reflowing the workflow.

Use screenshots or visual inspection to verify alignment, crop, overflow, hierarchy, focus states, loading states, and empty/error states. Record the exact checks and any intentional exceptions in `UI_REFACTOR_GUIDE.md`.
```

---

# Prompt 6 — Final functional and quality gate

```text
Complete a final PennyWise Accounting UI refactor quality gate. Treat the route/component inventory in `UI_REFACTOR_AUDIT.md` as a contract: every existing user-facing surface must show a final migration status, source file(s), and verification evidence.

Verify and fix:
1. All routes, navigation paths, deep links, permissions, and route parameters still work.
2. Every form keeps its submit/save/cancel/delete behavior, validation, errors, keyboard handling, and data binding.
3. Calculations, currency/date formatting, tax rules, accounting balances, statuses, exports, and API flows remain intact.
4. Desktop workspaces use the PennyWise density system: compact shell, single H1, useful tables, inspector/drawer context, no generic full-width form look.
5. Responsive layouts keep every feature reachable and do not create unexpected horizontal page scroll.
6. WCAG 2.2 AA basics: contrast, semantics, labels, focus, keyboard operation, dialogs, announcements, and non-color status communication.
7. Build, typecheck, lint, automated tests, and any supported browser/screenshot tests all pass.

Update `UI_REFACTOR_GUIDE.md` with a before/after summary, exact test commands/results, remaining intentional exceptions, and links to `COMPETITIVE_UI_REFERENCE.md`. Do not report completion if any audited surface is unreviewed, any failing check is ignored, or a known behavior regression remains.
```

---

## Proven workflow patterns to require in implementation

### The Cash Workbench

Use this pattern for high-volume banking, transaction, categorization, and reconciliation tasks:

```text
Compact toolbar + page context
└─ Economic financial snapshot strip (only actionable metrics)
   └─ Review queue | Transaction table | Inspector
      └─ Selection-aware lower action bar
         └─ Optional focused reconciliation work window
```

- Queue: 5–8 prioritized categories with count, amount, urgency, and direct filtering.
- Table: the dominant surface, with sticky controls/headings, 8–12 useful columns, 9–14 visible rows, selection, match status, filters, inline actions, and column configuration.
- Inspector: selected item, suggested match, contact/document context, and 2–3 next actions.
- Action bar: only appears for a selected item/set; it exposes bulk categorizations, matching, assignment, export, or note actions.

### Compact accounting form

```text
Form/work-window title + state + close
└─ Contextual actions
   └─ Identity/party grid | dates/references/terms grid
      └─ Line-item table + live totals + related-object inspector
         └─ Persistent Save / Preview / Primary action bar
```

- Keep basics above the fold.
- Do not make customers, dates, amounts, references, and statuses full-width fields.
- Place repeated products/services into a table, not stacks of fields.
- Collapse secondary details (`attachments`, `custom fields`, `internal notes`) until needed, without hiding required data or validation errors.

### Reporting workspace

```text
Report heading + saved-view/context actions
└─ Compact filter toolbar
   └─ Primary report table/chart
      └─ Drill-down inspector or split pane
```

- Filter controls must be concise and persistent.
- Give financial tables enough line-height and numeric alignment to scan.
- Offer export/print/share/schedule via a contained action group, preserving existing functionality.

---

## Future-screen prompt template

Use this whenever adding or redesigning a screen after the refactor:

```text
Build/refactor the [SCREEN NAME] screen in PennyWise Accounting using the established UI system in `UI_REFACTOR_GUIDE.md`.

Workflow: [describe the real accounting task, its inputs, output, and completion action].
Existing behavior to preserve: [routes, APIs, validation, calculations, permissions, tests].
Primary working object: [transaction/invoice/bill/contact/report/etc.].
High-frequency decisions: [list 3–5 decisions/actions a user must make].

Design the screen as a desktop accounting workspace, not a generic web form:
- one visible H1; concise contextual actions;
- use the appropriate pattern: queue + table + inspector for repeated records, compact form grid + line-item table for one-off entry, or report toolbar + data view for analysis;
- apply fixed data-type input widths; do not use blanket full-width fields;
- preserve a 24px desktop canvas inset, 16px panel gap, 8px micro-grid, quiet separators, 8–12px radii, and restrained elevation;
- keep high-frequency task context and primary action visible in the first desktop viewport;
- support 1440×900, 1280×800, 1024×768, and <=768px layouts with progressive disclosure rather than lost actions;
- meet accessibility requirements (semantics, labels, visible focus, keyboard operation, non-color status, dialog behavior).

Use original PennyWise brand tokens only. Do not copy QuickBooks/Intuit branding, assets, wording, or screen geometry.

Before coding, identify existing analogous components and preserve their contracts. After coding, test the happy path, validation/error state, empty/loading state, permissions/read-only state, keyboard behavior, and responsiveness. Update the route inventory and guide with the completed screen.
```

---

## Definition of done

The refactor is complete only when all of the following are true:

- Every user-facing surface in `UI_REFACTOR_AUDIT.md` is migrated or has an explicitly justified exception.
- UI components are reusable, token-driven, accessible, and consistent across all existing modules.
- Important flows retain their original accounting/business behavior and pass relevant tests.
- Record-heavy workflows use dense workspaces rather than card-heavy pages.
- Forms use intentionally constrained widths and grouped field grids.
- There is a single, original PennyWise visual identity—not a copied competitor interface.
- The build, lint, typecheck, tests, and supported visual checks pass.
- `UI_REFACTOR_GUIDE.md` and `COMPETITIVE_UI_REFERENCE.md` are current and placed with the project deliverable.

---

# Prompt 7 — Route-by-route visual atlas and screenshot gate

```text
Use `PENNYWISE_VISUAL_ATLAS.md` as a visual implementation reference and carry out a route-by-route visual verification of the actual PennyWise repository.

First, map every audited real route, nested screen, dialog, drawer, popover, empty state, loading state, error state, read-only state, and permission variant from `UI_REFACTOR_AUDIT.md` to the closest visual-atlas pattern. Do not assume a screen is covered because it shares a route prefix. Any unmatched route must receive its own original PennyWise visual reference before implementation is called complete.

For every actual route/surface, capture or inspect visual evidence at:
- 1440×900 wide desktop;
- 1280×800 or 1024×768 compact desktop;
- tablet/mobile layout where the surface is reachable;
- populated, selected, empty, loading, validation/API-error, permission/read-only, and disabled/destructive-action states when applicable.

Use the visual atlas to verify—not copy—the following:
- compact PennyWise app shell, one meaningful H1, and original three-beam/pillar identity;
- task-relevant toolbar/menu/overflow controls and no duplicate primary actions;
- purpose-sized fields, tables, side inspectors, line-item grids, and sticky actions;
- good data density: key workflow context, records, totals/status, and next action visible together;
- original navigation, spacing, colors, icons, surface hierarchy, and language—never competitor layouts or assets;
- accessibility: visible focus, keyboard operation, semantic labels, non-color status, accessible menus/dialogs.

Add a `UI_VISUAL_COVERAGE.md` document containing a route-by-route evidence table with source file(s), atlas pattern, screenshots/viewport checks, states checked, visual issues found, functional verification, and final status. Fix all discovered visual regressions before completion. Do not report a route as covered until it has actual evidence.
```
