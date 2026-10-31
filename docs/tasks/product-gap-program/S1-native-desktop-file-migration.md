# S1 — Read the files desktop refugees actually have

Commercial-readiness prompt. Prepared, not authorized: record it in
`docs/status/CURRENT_PHASE.md` before starting.

Evidence for this prompt is in
`codex-product-gap-pack/MONETIZATION-AND-FEATURE-ASSESSMENT-2026-09-12.md`, Part 7,
Option 2.

## Why

Intuit stopped selling new QuickBooks Desktop subscriptions in the US on 30 September 2024,
and in Canada in April 2025. Sage 50 ended perpetual licences and goes read-only when a
subscription lapses. Those owners are being pushed somewhere, and PennyWise is the only
product in our comparison that keeps their data on their own machine.

Migration friction is what decides whether they can move.

## What exists today

- The Switching Centre records an immutable source-system choice, including
  `QUICKBOOKS_DESKTOP` (`apps/web/index.html`), and imports **reviewed CSV or XLSX
  exports**, with source evidence and control totals.
- The product states plainly that it "does not open QBW, QBB, QBM, or IIF files"
  (`apps/web/app.js`).
- `phase12-portability.integration.test.ts` covers QuickBooks Desktop multi-line invoice
  import from exports.

So the gap is narrow and specific: **the owner must first produce clean exports**, which is
exactly where non-technical owners stall.

## Tasks

1. **IIF import.** `.IIF` is a documented Intuit text format.
   - Parse lists and transactions: accounts, customers, vendors, items, invoices, bills,
     payments, journal entries.
   - Map to the existing staged-import model, with the same review, control totals and
     source evidence as CSV.
   - Reject unknown headers loudly rather than importing partial rows. Intuit's own
     documentation warns that IIF import has limited error checking; PennyWise must not
     repeat that.
2. **A guided export assistant for QuickBooks Desktop and Sage 50.** For each supported
   version, give exact click-paths for the reports and lists to export, with a checklist,
   a file-drop target per item, and a completion state. Verify the paths against current
   vendor documentation and record retrieval dates.
3. **Direct company-file extraction — spike first, behind a decision.** Intuit's Desktop
   SDK (qbXML with QBFC, COM on Windows) can read a live `.QBW` company file when
   QuickBooks Desktop is installed on that machine.
   - Deliver a spike: licensing terms of the Intuit Developer programme, what the user must
     have installed, what consent prompts appear, and which entities are readable.
   - Only then propose an optional Windows helper. Do not ship an extractor before the
     licensing question is answered in writing.
4. **Reconciliation report for every migration.** Opening balances, AR and AP aging, and
   trial balance compared against the source reports, with an explicit sign-off screen. A
   migration that doesn't tie out must say so.
5. **Time it.** Record the elapsed time for a full test migration of a realistic file. The
   commercial target is under one working day per client.

## Constraints

- Imports stay non-posting until reviewed, matching existing behaviour.
- Never fabricate a missing account or amount to make a file balance.
- No customer data in tests: build synthetic fixtures.
- Sage 50 and QuickBooks are third-party trademarks: describe compatibility factually, and
  never imply endorsement.

## Acceptance criteria

- A synthetic IIF file containing lists and transactions imports, reviews and posts, with
  control totals matching.
- A malformed IIF file is refused with a readable explanation, and nothing is imported.
- The export assistant walks a tester through a QuickBooks Desktop export without outside
  help.
- The reconciliation report shows a tie-out, and flags a deliberately broken fixture.
- The SDK spike is delivered as a written decision, not code.

## Standard rules

- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.
- Meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` section 6.
- Keep LF endings; rebuild web assets; there is no git, so list every changed file.
