# PennyWise Accounting UI refactor guide

## Purpose

This guide defines the shared visual and interaction foundation for PennyWise Accounting. It applies the supplied Visual Atlas to the existing semantic HTML, CSS, and ES-module application without altering accounting rules, API contracts, authentication, tenant isolation, or browser-state compatibility.

## Core tokens

| Role            | Token                                         | Value                           | Use                                                  |
| --------------- | --------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| Canvas          | `--pw-canvas`                                 | `#F7F3ED`                       | Warm application background                          |
| Working surface | `--pw-surface`                                | `#FFFDF9`                       | Forms, tables, work panes                            |
| Grouped context | `--pw-surface-muted`                          | `#F1ECE5`                       | Toolbars and supporting context                      |
| Ink             | `--pw-ink`                                    | `#142A3B`                       | Text and persistent shell                            |
| Supporting teal | `--pw-teal`                                   | `#356E75`                       | Interactive support and selected work context        |
| Primary accent  | `--pw-copper`                                 | `#B8673D`                       | One focal primary action or brand detail             |
| Border          | `--pw-border`                                 | `#DDD7CE`                       | Quiet separators                                     |
| Semantic status | `--pw-success`, `--pw-warning`, `--pw-danger` | `#247454`, `#A96514`, `#B43B36` | Status with an accompanying label, never color alone |
| Keyboard focus  | `--pw-focus`                                  | `#1F6F83`                       | Visible focus outline                                |

Spacing uses 4, 8, 12, 16, 24, and 32px. The desktop toolbar is 56px, the main rail is 224px, standard controls are 36px, and panels use a 10px radius with only meaningful elevation.

## Shared shell

- Desktop keeps the PennyWise mark in a single navy rail, with a compact, neutral toolbar beside it.
- The desktop rail is the primary task navigation. It opens by default only above the mobile breakpoint; the phone navigation remains a closed drawer.
- Global search, create, company context, utility menus, and the existing permission controls stay in the toolbar.
- Workspace tabs remain available as local context below the toolbar, not as a second primary-navigation band.
- One visible `h1` identifies each route. Additional headings identify genuinely distinct work regions and should be short, sentence-case nouns.

## Reusable CSS primitives

The primitives are CSS contracts for the existing framework-free markup. They can be added to a semantic element without changing its data attributes or event bindings.

| Class               | Role                              | Required behavior                                                                   |
| ------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `.pw-panel`         | Quiet grouped content             | Surface, separator, 10px radius; no unnecessary shadow                              |
| `.pw-work-window`   | Focused, consequential task       | Same panel base with soft elevation, compact header, and explicit close/cancel path |
| `.pw-table-toolbar` | Local table controls              | Filter/view/columns/actions together; no duplicate page title                       |
| `.pw-action-bar`    | Persistent contextual action band | Stays at the bottom of a long work surface; only one visually primary action        |
| `.pw-inspector`     | Selected record context           | Persistent on wide desktop; becomes a drawer/sheet on compact layouts               |

## Composition rules

### Recurring-accounting work

Use **queue + table + inspector** for banking, payables, receivables, inventory review, and ledger work. The table is the primary working surface; queues filter the table and inspectors show the selected record’s evidence, reasoning, correction path, and next action.

### One-off documents

Use a compact header grid for party/date/reference/status fields, a true line-item table, live totals, and an anchored action bar. Attachments, notes, and advanced configuration are secondary disclosures, but required validation stays visible.

### Reports and analysis

Keep one stable filter/action strip above the primary report. Put export, print, share, or schedule controls in one contained action group. Drill-down appears beside or below the output rather than replacing it.

## Accessibility and safety checklist

- Preserve semantic landmarks, labels, validation associations, live notices, focus return, and existing test selectors.
- Every status includes text; positive, warning, and danger colors supplement rather than replace the label.
- All menus, drawers, dialogs, row actions, and inspector actions work with keyboard navigation and visible focus.
- Use the existing reduced-motion preference and do not use motion as the sole meaning carrier.
- Keep accounting totals, balance/difference states, evidence, posting restrictions, and destructive-action guards visible during the relevant task.

## Migration evidence

`UI_REFACTOR_AUDIT.md` is the source inventory. Every migrated row must ultimately have corresponding viewport/state evidence in `UI_VISUAL_COVERAGE.md`, including 1440×900, compact desktop, mobile, populated, empty, error, permission/read-only, and disabled/destructive states when applicable.

## Verification baseline

- `node --check apps/web/app.js`
- `corepack.cmd pnpm --filter @clearledger/web test`
- `corepack.cmd pnpm --filter @clearledger/api typecheck`
- `corepack.cmd pnpm --filter @clearledger/api test`
- Targeted browser regression followed by the full browser/accessibility/release suite as workspaces migrate
