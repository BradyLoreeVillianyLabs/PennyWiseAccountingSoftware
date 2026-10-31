# ClearLedger bulk-entry and windowed-workspace implementation prompts

Status: execution-ready product and engineering handoff, 2026-08-08

## Purpose

Extend ClearLedger with two familiar accounting-workbench capabilities:

1. spreadsheet-style bulk entry for invoices, bills, expenses, and other supported transactional drafts; and
2. a reusable window shell with explicit Save, Save & Close, Clear, minimize, maximize/restore, resize, drag, and close behavior.

The goal is a faster, more familiar workflow for users moving from QuickBooks Desktop and similar accounting products, while keeping ClearLedger's tenant isolation, immutable posted history, exact money handling, tax boundary, audit trail, review-first controls, and idempotency guarantees.

This package is intentionally a build sequence, not a request to copy QuickBooks code, branding, or implementation. The current ClearLedger repository is the source of truth.

## Non-negotiable product decisions

- A grid is a draft-entry workbench, not a second ledger-posting system.
- Typing, pasting, clearing, minimizing, or closing a window must never create a journal entry or post accounting history.
- `Save` persists a validated draft through the existing domain service. It does not post unless the existing workflow explicitly defines Save as posting, in which case the agent must preserve that contract and document it before changing it.
- `Save & Close` performs the same save, waits for a confirmed response, then closes the window. On failure, the window remains open with the errors visible.
- `Clear` clears only unsaved grid changes after a confirmation when data would be lost. Clearing a saved draft must not silently delete it; provide a separate, permission-checked discard/delete action if the existing domain supports one.
- `Post`, `Approve`, `Send`, or equivalent existing accounting actions remain explicit and continue to use the current posting services.
- Money remains exact and serialized according to current API contracts. Do not use binary floating point for calculations.
- Tax is calculated only through the existing centralized tax engine. The grid may display tax results, but it must not implement a second tax formula.
- Every draft and commit remains tenant/company scoped, auditable, source-traceable, and idempotent.
- Ambiguous, invalid, unsupported, or incomplete rows are visible and reviewable; they are never silently auto-posted.

## Repository starting points

Before editing, inspect the actual current names and contracts in:

- `apps/web/index.html`
- `apps/web/app.js`
- `apps/web/styles.css`
- the existing invoice, bill, purchase, expense, customer, tax, audit, permission, and idempotency services under `apps/api/src`
- `packages/db/prisma/schema.prisma` and `packages/db/src/index.ts`
- existing import/migration and reconciliation services, especially `apps/api/src/services/data-migration-service.ts`
- `docs/ACCOUNTING_POSTING_RULES.md`, `docs/API_GUIDELINES.md`, and the relevant module documentation

Do not assume a path or endpoint from this document exists. Discover the current implementation and extend it in place.

## Recommended execution order

Run the prompts in order. Each phase must leave the repository in a buildable state and must record verification before the next phase begins.

### Prompt 0 — repository audit and contract inventory

```text
Act as the lead ClearLedger architect. Inspect the repository before changing code.

Inventory the existing invoice, bill, purchase, expense, customer, tax, audit,
permission, idempotency, import, draft, and reconciliation flows. Identify the
canonical create/update/validate/post services, request schemas, database models,
company/tenant guards, and current web forms. Trace one invoice and one bill from
browser input through persistence and posting. Identify whether drafts already
exist and what Save currently means in each workflow.

Produce a short architecture note naming the exact files and contracts that the
later phases must reuse. Call out any incompatible existing behavior before
editing it. Do not build a parallel ledger path, a new frontend framework, or a
new tax implementation. Do not make product changes in this phase.

Verification: the note must be based on repository evidence, include the current
idempotency/audit behavior, and list focused tests that can prove the later work.
```

### Prompt 1 — draft and bulk-entry contract

```text
Using the phase-0 inventory, define the smallest reusable bulk-entry contract for
ClearLedger. Extend existing draft/domain models when possible; do not create a
disconnected transaction subsystem.

Define the row lifecycle (for example blank, dirty, valid, invalid, needs-review,
saved, posted) and the batch lifecycle (draft, validation-failed, ready, committed,
partially-reviewed, cancelled) using names compatible with the existing schema.
Define how a batch identifies its company, actor, source/provenance, version, and
idempotency key. Define stable row IDs so errors remain attached when rows are
sorted, pasted, inserted, or deleted.

Specify the exact Save, Save & Close, Clear, Post/Approve, retry, and conflict
semantics. Save must be safe to retry and must not post unless the existing
workflow explicitly requires it. A stale version or company mismatch must fail
closed. A rejected row must be returned with a stable row reference and field
error code. Preserve immutable source values and audit evidence.

Use exact money/tax serialization and the central tax-engine contract. Document
whether the implementation uses one transaction per batch or bounded row-level
transactions, and why that choice is safe for the existing services.

Add focused contract tests before wiring the UI: tenant/company rejection,
idempotent retry, stale version rejection, row-level validation, and proof that
draft save creates no journal entry.
```

### Prompt 2 — reusable spreadsheet/grid workbench

```text
Implement a vanilla web spreadsheet-style draft-entry workbench using the current
ClearLedger HTML, app.js, and CSS architecture. Do not add a frontend framework.

The component must support keyboard navigation, tab/enter row movement, adding,
duplicating, deleting, and reordering rows, copy/paste of TSV and CSV data, clear
column headers, column widths, visible required fields, inline validation, row
status, an error summary, and a preview of normalized values. It must handle
quoted CSV values and pasted line breaks safely. Do not evaluate pasted formulas or
HTML. Keep unsaved edits in browser state until the user explicitly saves.

Make the grid accessible: semantic grid/table roles, labels, keyboard operation,
focus indication, screen-reader error text, no color-only state, and a usable
mobile fallback. Prevent accidental browser navigation or data loss with a dirty
state prompt. Avoid an unbounded page-height scroll trap.

Expose a small adapter contract so invoice, bill, and expense grids can supply
their column definitions, row validator, normalizer, preview renderer, and save
action while sharing the interaction code.

Add focused browser/unit tests for paste parsing, keyboard movement, row identity,
invalid-row display, safe formula text handling, and dirty-state behavior. Keep
server calls out of the component until the save adapter is invoked.
```

### Prompt 3 — bulk invoice workflow

```text
Add bulk invoice draft entry by adapting the existing invoice/customer/tax and
posting services. Support multiple invoice rows and, where the current model
requires it, a clear line-item editing surface for each invoice. Preserve customer,
invoice date, due date, description, quantity, rate/amount, account, SKU/item,
discount, tax code, and currency fields that the current contract supports.

Provide source-column aliases for common names such as Customer/Client, Invoice
Number/No., Date/Invoice Date, Due/Due Date, Item/SKU, Description/Memo, Qty/
Quantity, Rate/Price, Amount/Total, Tax/VAT/GST, and Account. Alias detection may
suggest a mapping but must show it to the user and require review for ambiguous or
unsupported fields.

Use the canonical invoice validation and tax services. Show normalized preview
totals, tax-component breakdown, missing references, duplicate invoice numbers,
unsupported currencies, and rows that will be skipped or need review. Save only a
validated draft through the existing service. Commit/post only through the existing
explicit accounting action, with the existing audit and idempotency evidence.

Add focused API and browser tests for valid multi-row entry, alias mapping,
ambiguous mapping, invalid customer, exact totals, dry-run/no-journal behavior,
idempotent retry, and explicit commit/reconciliation.
```

### Prompt 4 — bulk bill, payable, and expense workflows

```text
Implement the same workbench adapter for bills, payables, and expenses using the
existing vendor, bill, expense, tax, document, and accounting services. Reuse the
grid and lifecycle contract; do not duplicate posting logic.

Support the fields already valid for each domain, including vendor/payee, bill
number, transaction date, due date, account/category, item/SKU, description,
quantity, rate/amount, tax, payment terms, project/customer linkage, and document
reference where applicable. Use common aliases but expose every suggested mapping.

Preview must identify duplicate source numbers, missing vendors/accounts, tax
issues, document mismatches, unsupported records, and rows requiring human review.
Draft Save and dry run must not create payable ledger entries, inventory movements,
payments, or bank transactions. Explicit post/approve continues through existing
services and records immutable provenance, audit actor, and idempotency evidence.

Add focused tests for bills and expenses, including tax inclusive/exclusive modes
through the central tax engine, recoverable/non-recoverable tax where supported,
company isolation, retry, partial invalid batches, and reconciliation output.
```

### Prompt 5 — Save, Save & Close, Clear, and recovery semantics

```text
Implement a consistent command bar for all targeted draft-entry windows. Reuse
current button and permission patterns, but make the following actions explicit:
Save, Save & Close, Clear, and the existing Post/Approve/Send action when available.

Save validates the current draft and reports row-level errors without closing.
Save & Close awaits a successful save before closing. Clear confirms before
discarding dirty edits and never silently deletes a saved draft. If a recoverable
browser draft exists, offer restore or discard with clear wording. Display saving,
saved-at, failed, and conflict states. Disable duplicate submits while a request is
in flight and use the existing idempotency key/retry contract.

Do not change accounting meaning merely to imitate another product. If current
single-entry screens treat Save as posting, document the compatibility decision and
use a distinct Save Draft action where needed. Every command must have keyboard
accessibility, disabled/error states, and an audit-safe server response.

Add tests for save failure, save-and-close failure, clear confirmation, duplicate
clicks, stale-version conflict, refresh/recovery, and proof that clear/draft save
do not post accounting history.
```

### Prompt 6 — reusable window manager

```text
Build a small browser window shell in the existing web application, not a desktop
operating system and not a new frontend framework. Initially integrate it only
with the bulk invoice and bill/expense workbenches and any existing form that is
safe to migrate.

Each window needs a title, close, minimize, maximize/restore, drag, and resize
controls; predictable z-order and focus; a visible active-window state; and a
usable content region. Keep action buttons reachable when the content is long.
Prevent clipping by the app header, top menus, and narrow containers. Do not let a
window escape the viewport or trap the user in nested scrolling.

Use pointer and keyboard interactions, ARIA labels, focus restoration, Escape
close with a dirty-state confirmation, and reduced-motion support. Persist only
safe browser-local layout preferences (position, size, minimized state) keyed by
route/user interface context; never persist secrets or accounting data in layout
state. On small screens, switch to a full-screen or stacked layout rather than
forcing desktop dragging/resizing.

Add unit/browser tests for open/focus, z-order, drag bounds, resize minimums,
minimize/restore, maximize, close confirmation, keyboard controls, refresh
restoration, mobile fallback, and header/submenu collision.
```

### Prompt 7 — integrate windows with navigation and existing screens

```text
Integrate the window shell and bulk adapters with the current home command center,
top navigation, task finder, section tabs, and existing deep links. The user must
be able to open a bulk invoice/bill/expense window from a clearly named task,
switch to existing list/detail views, and return without losing a saved draft.

Keep existing routes and API contracts compatible unless a documented migration is
required. Do not put the entire application in one modal or hide important
sections inside a generic More menu. Use clear labels such as Sales > Invoices,
Purchases > Bills, Expenses, Bulk entry, Projects, Budget, CRM, Calendar, and
Switching Centre where those concepts exist in the repository.

Verify the wrapped content is not clipped in desktop, tablet, and mobile layouts;
that the header/submenu remains in view; and that task-finder results open the
correct workbench. Update help text and UI copy to explain draft versus posting
behavior.
```

### Prompt 8 — accessibility, performance, and data-loss review

```text
Audit the completed grid and windowed workflows as an accessibility, performance,
and accounting-safety reviewer. Test keyboard-only use, screen readers where the
existing harness supports them, 200% zoom, high contrast, reduced motion, mobile
widths, long descriptions, large pasted batches, and slow/failing network calls.

Ensure large batches do not freeze the browser. Bound payload sizes and row counts
according to existing API limits, provide progress, and avoid rendering work that
is not visible. Do not add client-side virtualisation unless it preserves keyboard
and screen-reader semantics. Ensure unsaved values are not silently lost and that
server validation remains authoritative.

Fix only evidenced issues. Record any intentional limits, unsupported columns, or
mobile differences in the relevant documentation.
```

### Prompt 9 — focused verification and evidence gate

```text
Verify the feature from the repository and user-flow perspective. Run the smallest
useful focused checks first, then the required project gates:

- formatting and lint checks for changed files;
- TypeScript/type checks for changed packages;
- focused API/service tests for batch validation, idempotency, company isolation,
  tax use, draft save, commit, and reconciliation;
- focused web/unit tests for paste parsing, row lifecycle, command buttons, and
  window behavior;
- browser tests for desktop, narrow/mobile, keyboard, error recovery, and the
  home/task-finder entry path.

Prove with database or service evidence that draft Save, Save & Close, Clear, and
dry run create no unintended journal entries, inventory movements, payments, or
bank transactions. Prove explicit posting still uses the existing accounting
services and produces audit/reconciliation evidence. Prove retries are idempotent
and a batch cannot be previewed in one company and committed in another.

Do not claim completion if a required check is unavailable. Record exact commands,
pass/fail results, known limitations, and any follow-up work in a concise evidence
report.
```

### Prompt 10 — documentation and release handoff

```text
Update the affected user help, API/domain documentation, and operator notes. Explain
the grid paste format, supported columns and aliases, row statuses, preview and
dry-run meaning, Save versus Save & Close versus Clear, explicit posting, window
controls, keyboard shortcuts, mobile behavior, batch limits, and recovery behavior.

Include a short migration note for users coming from QuickBooks Desktop/Online or
other accounting systems: the interaction is familiar, but ClearLedger's draft,
review, tax, audit, and posting boundaries remain authoritative. Do not copy their
branding or claim feature parity that was not verified.

Link the evidence report and list any unsupported source columns or workflows. Make
the release handoff repeatable for a beta tester using fictional data.
```

## Combined execution prompt

Use this when asking an implementation agent to execute the whole package in one controlled run:

```text
Implement the ClearLedger bulk-entry and windowed-workspace feature set described
in docs/tasks/IMPLEMENT_BULK_ENTRY_AND_WINDOWED_WORKSPACE_PROMPTS.md.

First inspect the repository and write the phase-0 contract inventory. Then execute
the phases in order: draft/batch contract; shared spreadsheet grid; bulk invoices;
bulk bills/payables/expenses; Save/Save & Close/Clear semantics; reusable draggable,
resizable, minimizable window shell; navigation integration; accessibility and
performance review; focused verification; and documentation/handoff.

Extend existing ClearLedger services, schemas, tax engine, audit, permission,
idempotency, reconciliation, and vanilla web architecture. Do not create a
parallel ledger posting path, a separate importer, a new frontend framework, a
hidden auto-post route, or an unreviewed second tax calculation. Preserve exact
money, immutable posted history, tenant/company isolation, source provenance,
review-first handling of uncertainty, and fail-closed behavior.

Do not silently change the meaning of existing Save actions. Make draft Save,
Save & Close, Clear, and explicit Post/Approve behavior visible and documented.
Treat pasted input as untrusted text. Validate server-side, return stable row/field
errors, use idempotency for retries, and show preview/dry-run consequences before
commit.

Keep the implementation narrow. At every phase, run focused checks and stop to fix
failures before continuing. At the end, report changed files, schema migrations,
commands and versions used, focused test results, browser-flow results, accounting
evidence, and known limitations. Do not claim completion without fresh evidence.
```

## Acceptance checklist

The implementation is ready for review only when all applicable items are true:

- Invoices and bills/payables can be entered as multiple draft rows in one workbench.
- TSV/CSV paste, row insertion, duplication, deletion, sorting, keyboard navigation, and inline validation work without unsafe HTML or formula evaluation.
- Alias suggestions and manual mappings are visible; ambiguous fields and records require review.
- Preview and dry run show accepted, skipped, invalid, and needs-review rows with stable row references and normalized money/tax totals.
- Save persists a draft; Save & Close saves before closing; Clear cannot silently destroy saved work.
- Draft, clear, and dry run produce no journal, payment, inventory, or bank side effects.
- Explicit posting uses existing accounting services and produces audit and reconciliation evidence.
- Tax results come from the central tax engine, including supported inclusive/exclusive and recoverability behavior.
- Retries are idempotent; stale versions, source mismatches, tenant mismatches, and company mismatches fail closed.
- Windows can be dragged, resized, minimized, restored, maximized, and closed with safe dirty-state handling; focus and z-order are predictable.
- Window layout never clips under the header or traps users in nested scrolling; mobile falls back to a usable full-screen layout.
- Keyboard, accessibility, zoom, reduced-motion, and error-recovery behavior are tested.
- Focused tests, formatting, type checks, and browser evidence are recorded, with no unsupported claim of completion.

## Explicit non-goals

- No new frontend framework or separate desktop runtime.
- No parallel ledger, tax, reconciliation, or importer subsystem.
- No silent posting, automatic approval, or automatic resolution of ambiguous rows.
- No client-side trust of money, tax, permissions, company identity, or accounting state.
- No broad rewrite of unrelated screens merely to add a window shell.
- No deletion of saved drafts through a Clear button.
- No copying of QuickBooks code, branding, proprietary assets, or undocumented behavior.

## Product rationale

The prompt sequence bridges the familiar QuickBooks Desktop pattern—visual task
centers, grouped accounting activities, and configurable work areas—with ClearLedger's
review-first accounting model. Intuit describes Desktop's Home page as a task-oriented
overview with grouped Centers and an icon/menu navigation system, and documents Home
customization through Preferences. The implementation should borrow the interaction
principles, not the proprietary implementation or branding:

- [QuickBooks Desktop getting started](https://quickbooks.intuit.com/learn-support/en-ca/help-article/product-setup/getting-started-quickbooks-desktop/L9o53ewxM_CA_en_CA)
- [Getting around QuickBooks Desktop](https://quickbooks.intuit.com/learn-support/en-us/help-article/product-setup/get-around-quickbooks-desktop/L6KOfBxuF_US_en_US)
