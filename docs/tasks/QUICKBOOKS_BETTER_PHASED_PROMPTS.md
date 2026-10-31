# ClearLedger: QuickBooks-Comparable, Better — Phased Build Prompts

Use these prompts in order. Each phase is independently reviewable; do not start the
next phase until the current phase's acceptance evidence is attached. Preserve the
existing posting, tenant-isolation, audit, privacy, and provider-gating boundaries.

## Phase 1 — Make the daily dashboard decisive

> Improve the existing Home workspace for a Canadian small-business owner. Keep the
> compact dashboard, but make every card answer: what needs attention, why it matters,
> and what is the safest next action? Add loading, empty, stale, permission-denied,
> and error states. Make all financial totals drill into the exact source records and
> preserve the selected date range on return. Do not invent balances or silently post
> anything. Add keyboard navigation, screen-reader labels, responsive layouts at 390,
> 768, and 1440px, and tests for every action and state.

Definition of done: a new owner can understand cash, receivables, payables, tax,
reconciliation, and close blockers in under two minutes; every KPI has a traceable
source; browser tests pass on desktop and mobile.

## Phase 2 — Compress the core bookkeeping loop

> Audit and improve the complete loop: customer → estimate → invoice → payment →
> deposit/reconciliation → receipt, and vendor → bill → payment → reconciliation.
> Reduce unnecessary navigation with safe inline creation, saved defaults, keyboard
> shortcuts, duplicate detection, clear status transitions, and an undo-safe draft
> model. Show the accounting preview before posting and make tax, currency, rounding,
> and allocation decisions explicit. Preserve immutable posted records and idempotency.
> Add end-to-end tests that prove the ledger, customer/vendor balances, document PDFs,
> audit trail, and reports agree after each transition.

Definition of done: a trained QuickBooks user can complete common sales and purchase
workflows without a tutorial, while a reviewer can still inspect every posting.

## Phase 3 — Replace spreadsheet friction with guided workspaces

> Make Customers, Products, Vendors, Banking, and Switching Centre feel like safe,
> powerful spreadsheets: sticky headers, column selection, saved views, bulk edit,
> multi-row paste, CSV mapping, validation before commit, and reversible drafts.
> Keep row-level errors beside the offending value. Never guess an account, tax code,
> customer, SKU, or currency; show the candidate and require confirmation. Support
> pagination beyond 25 rows, stable sorting, URL/shareable filters, and an export that
> exactly matches the visible view. Add performance tests for 10k-row datasets.

Definition of done: import, review, correction, and export are understandable without
opening developer tools, and no invalid row can reach the posting boundary.

## Phase 4 — Build the accountant-grade control plane

> Turn Accountant Workbench, Books Health, reports, review queues, period close, and
> audit exploration into one coherent control plane. Add exception ownership,
> evidence links, aging, bulk-safe triage, close checklist snapshots, report-to-ledger
> drill-down, and a clear distinction between draft, reviewed, posted, reversed, and
> locked. Provide professional report print/export layouts and a period comparison
> mode. Enforce permissions and reauthentication for sensitive actions; log every
> decision with actor, timestamp, reason, and source evidence.

Definition of done: a bookkeeper can close a period and explain every exception from
the resulting evidence package without relying on hidden application state.

## Phase 5 — Deliver the better-than-QuickBooks intelligence layer

> Add explainable assistance, not autonomous bookkeeping. Detect unusual changes,
> duplicate bills, missing documents, tax-readiness issues, overdue patterns, and
> reconciliation anomalies. For each suggestion show the evidence, confidence,
> expected accounting impact, and a one-click route to review; require explicit human
> approval before edits or posting. Add configurable notification digests, user-level
> dismissal/snooze, and tenant-scoped privacy controls. Store only allowlisted,
> privacy-safe events and never send customer content or secrets to an external model.

Definition of done: every suggestion is reproducible from ledger/source evidence,
explainable to an accountant, reversible, and covered by false-positive tests.

## Phase 6 — Earn migration and production trust

> Finish the QuickBooks/Xero/Wave/FreshBooks/Sage/Zoho/spreadsheet migration journey:
> source-specific templates, preflight diagnostics, opening-balance reconciliation,
> immutable source evidence, resumable imports, export parity, and a human-readable
> cutover report. Add production authentication, invitation and recovery flows,
> rate limits, backups/restore drills, support diagnostics, and release monitoring.
> Keep live provider, tax, legal, and marketplace claims explicitly evidence-gated.

Definition of done: a pilot can migrate, reconcile, approve, export, and recover with
an auditable runbook; release evidence covers security, accessibility, performance,
browser matrix, and database-backed integration tests.

## Required handoff for every phase

> Before reporting completion, inspect the current status and owner-request ledger;
> implement only the authorized phase; update tests and documentation; run lint,
> typecheck, unit/integration, accessibility, and relevant browser tests; report files
> changed, commands run, pass/fail evidence, known gates, and the exact next prompt.
> Stop after the phase report and wait for approval unless the owner has explicitly
> authorized the complete ordered roadmap; in that case, continue phase-by-phase and
> do not report completion until every definition of done and final release gate passes.
