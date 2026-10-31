# C2 — "Job done → invoice": billing from the calendar, time and mileage

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `calendar-service.ts`, `project-service.ts`, `project-work-item-service.ts`
- The time-entry and mileage code paths (find them with `rg "time-entries|mileage"` in
  `apps/api/src`)
- `invoice-service.ts`
- `packages/db/prisma/schema.prisma`, plus a migration for billed-source links
- `apps/web/app.js`, `apps/web/index.html`

**Closes:** differentiator C2 in `ASSESSMENT.md` section 5
**Effort:** M
**Depends on:** I2, the composer that receives the prefilled draft.

## Why this can beat competitors

For a service or trades owner, the job already lives in PennyWise:

- the appointment is in the calendar;
- the work sits in a project or work item;
- hours are time entries;
- kilometres are mileage drafts.

These exist today (`docs/CRM_AND_CALENDAR.md`, `project-service.ts`,
`project-work-item-service.ts`, and the time-entry approval at `app.js:13250`). Yet the
invoice is typed from scratch.

Closing that loop — "finish the job, and the invoice is already written" — is exactly the
invoice-only client's use case.

**Before building,** verify in primary documentation how comparable products handle
unbilled time and expenses, and record it in the research matrix.

## Tasks

1. **"Create invoice"** on a calendar appointment, a project work item, and a project. It
   opens the I2 composer, prefilled with:

   - the customer, date and description from the appointment or work item;
   - **approved, unbilled** time entries as lines, with hours × rate (rate precedence:
     work item → project → worker default → product; document the order);
   - **unbilled** mileage at the configured rate;
   - unbilled project costs marked billable, if the model supports them. Otherwise, record
     that as a follow-up.

   The owner can remove or edit any line before finalizing.

2. **Billed-source links.**
   - When the invoice is finalized, each source item links to the invoice line and becomes
     _billed_.
   - A billed item can't be billed again.
   - Voiding the invoice, or crediting the line (I5), returns it to _unbilled_.
3. **"Unbilled work" view:** unbilled work per customer, with totals, and a "Bill all for
   this customer" action.
4. **Mobile-width "Finish job" flow,** for use on a phone (only when the app is reachable;
   see the README note on local installs):
   - Mark the appointment complete.
   - Attach photos (using the existing attachments).
   - Create the invoice draft.

## Constraints

- **Money:** the invoice's amounts come from the server's calculation. Source rates are
  inputs, not authority.
- **Concurrency:** billing is atomic with finalizing. Two concurrent invoices can't claim
  the same time entry (a unique link and a test).
- **Unapproved time** is never billed.

## Acceptance criteria

- **Link integrity (integration):** create an invoice from a project with three approved
  time entries and one mileage draft → finalize → all four are linked and billed → a
  second invoice attempt excludes them.
- **Void restores:** voiding the invoice restores all four to unbilled.
- **Concurrency test:** two parallel finalizes claiming the same entry → one succeeds, one
  gets a clear conflict.
- **E2E:** calendar appointment → "Create invoice" → edit one line → finalize.

## Out of scope

- Payroll effects of time.
- Signature capture.
- Customer-facing job portals.

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
