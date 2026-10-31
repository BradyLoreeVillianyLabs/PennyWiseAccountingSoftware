# ClearLedger windowed workbench and navigation prompt package

Status: refined and executed 2026-08-08

## Design research signals

The implementation takes the useful parts of the QuickBooks interaction model without copying its product: a persistent left navigation area, a clear home/task-centre entry point, a visible create action, and keyboard-friendly navigation. QuickBooks Online documents a customizable navigation menu and a left-side navigation bar; QuickBooks Desktop documents returning to Home through its icon bar and provides keyboard shortcuts for moving between work areas. Those patterns are useful transition cues, but ClearLedger keeps its existing review-first accounting flow and tenant permissions.

## Critical review of the original request

The original wording is directionally right but too broad to execute safely as written:

| Request wording                         | Risk                                                                                                         | Executable correction                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Every single element” is a window      | Hundreds of nested controls become overlapping, slow, and difficult to use with a keyboard or screen reader. | Window only a named, independently useful work surface or section. Keep fields, tables, dialogs, and helper content inside their owning surface.     |
| “Zoom” every window                     | Per-window scaling can make financial totals unreadable and can diverge from printed invoices.               | Use maximize/fullscreen plus the existing text-scale, density, and content-width preferences. Keep money and print rendering deterministic.          |
| Free movement everywhere                | A user can lose an important panel or create an unusable layout.                                             | Persist browser-local positions, clamp bounds, provide restore defaults, and provide lock/minimize/close controls.                                   |
| Navigation customization without limits | A user can hide the only path to settings or reconciliation.                                                 | Allow visibility customization but require one visible destination, preserve role/permission filtering, and retain global search as a recovery path. |
| Desktop window behavior on every device | Floating panels are poor on narrow screens and touch devices.                                                | Use floating work surfaces only on desktop; use normal stacked sections or a drawer on mobile.                                                       |

## Refined implementation prompts

### Prompt 1 — Window surface foundation

Extend the existing ClearLedger platform-window manager. Use a typed allowlist of independently useful work surfaces. Each surface may be moved, resized, minimized, maximized, closed, restored, and locked. Persist only layout preferences in browser-local storage, clamp positions to the viewport, and restore safe defaults when a layout is invalid. Do not wrap every input or table in a window. Do not change accounting posting, money calculations, audit evidence, tenant scope, or permission checks. On mobile, render the same surface as a normal full-width section. Add focused keyboard, focus-trap, reduced-motion, and restore-default tests.

### Prompt 2 — Surface coverage registry

Review each workspace and register only sections with their own title, workflow, and actions (for example invoice designer, estimate designer, purchase request, calendar, and future review workbenches). Use one host and one stable identifier per surface. Exclude nested fields, tables, static cards, dialogs, and transient notices. Ensure close/minimize never destroys draft state, reopening returns the user to the same safe draft, and role-gated workspaces remain role-gated. Add a registry audit that rejects duplicate identifiers and missing labels.

### Prompt 3 — Left navigation pane

Add an additive left navigation rail inside the existing web client. It must have icons and clear labels for Home, Receivables & Sales, Payables & Purchases, POS, Payments & Refunds, CRM & Clients, Calendar, Project Planning, Banking, Inventory, Tax Centre, Switching Centre, External Integrations, Reports, Company Settings, and Help. It must be collapsible, closable, reopenable, keyboard accessible, role-aware, and a drawer on mobile. Allow browser-local visibility customization while keeping at least one destination visible. Highlight the active workspace or planning tab and preserve the existing top navigation for transition familiarity.

### Prompt 4 — Search and task recovery

Add a global screen-and-record search that opens from Ctrl/Cmd+K or `/`, plus contextual find-in-list fields for major tables. Search must be tenant-scoped, use only loaded or explicitly fetched records, expose the destination type and context, and never mutate records. Selecting a result opens the existing workspace/tab and applies the contextual filter. Keep the task finder as the action-oriented companion to record search.

### Prompt 5 — Verification and release evidence

Run formatting, lint, type checks, asset verification, release checks, focused web tests, and the release-candidate browser matrix on desktop and mobile. Verify that window layouts survive refresh, lock prevents accidental movement, closed navigation can be reopened, customization persists, active labels update, keyboard search works, and mobile navigation does not intercept bottom actions. Record performance and accessibility evidence. Confirm that no test or navigation action creates an accounting entry.

## Execution result

The existing floating workbench was retained and the prompt package was applied in place. ClearLedger now also has a left navigation rail with active-state highlighting, collapse/close/reopen controls, browser-local visibility customization, desktop content reflow, and a mobile drawer fallback. Global screen/record search and contextual list search remain available as the recovery path when a section is hidden. The deliberately bounded surface registry avoids turning every form control into a separate floating window.
