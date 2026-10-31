# I8 — Overdue follow-up: reminders, statements, and optional late fees

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- A new `reminder-service.ts`
- `invoice-document-service.ts`, and the I4 send dialog
- `phase10-report-service.ts` or `report-service.ts` (statements; the route is
  `app.ts:2852`)
- `invoice-render-service.ts`
- `packages/db/prisma/schema.prisma`, plus a migration
- The I6 jobs
- `apps/web/app.js`, `apps/web/index.html`

**Closes:** G9
**Effort:** M–L
**Depends on:**

- **I4**, for email.
- **I6**, for scheduled reminders.

Manual reminders and statements can ship before I6.

## Context

- **No follow-up capability exists.** A search of `apps/api/src/services` for reminder,
  overdue, dunning and late fee finds only unrelated calendar, estimate and report uses.
- **Customer statements have an API but no UI:**
  `GET /v1/reports/receivables/customers/:customerId/statement` (`app.ts:2852`).
- **Statements are in base currency only** (`CURRENT_PHASE.md`). M3 adds statements in
  document currency.
- **Research first.** Before building, record in the research matrix how at least three
  comparable invoicing products handle reminders, statements and late fees, using their
  current primary documentation.

## Tasks

1. **Manual reminder.** A "Send reminder" action on any unpaid, finalized invoice.
   - It opens the I4 send dialog with a reminder template.
   - If email is off, use the manual-send fallback. It is recorded the same way.
2. **Reminder plan:**
   - **Scope.** An organization default, with a per-customer override and a per-invoice
     opt-out.
   - **Example timing:** 3 days before the due date, on the due date, then 7 and 14 days
     overdue.
   - **Templates:** "friendly" and "firm" tones.
   - **Stop conditions:** reminders stop automatically when the invoice is paid, voided or
     fully credited.
   - **Limits:** at most one reminder per invoice per day, and quiet hours in the
     organization's timezone.
   - **Opt-out:** a per-customer "Do not send reminders" flag.
3. **Overdue view.** Overdue invoices grouped by age bucket.
   - Bulk "Send reminders" opens a review step listing every recipient and amount before
     anything is sent.
4. **Customer statement:**
   - **Types:** open-item and activity statements for a date range.
   - **Output:** a PDF using the existing renderer patterns, which can be downloaded or
     sent through I4.
   - **Accuracy:** figures come from the AR subledger and ledger, not recomputed from
     documents.
5. **Late fees** — only if the owner approves them. They are off by default.
   - **Settings:** flat or percentage per period, grace days, and a cap.
   - _(Added in review)_ **Interest Act disclosure.**
     - When interest is expressed per month, or per any period shorter than a year, the
       terms must also state the equivalent **annual** rate, for example "1.5 % per month
       (18 % per year)".
     - Without it, recoverable interest is capped at 5 % a year (Interest Act, s.4). The
       case cited in the research involved an invoice at 1.5 % a month.
     - The terms must appear on the invoice, and should be agreed before the work. A new
       charge cannot simply be added to an invoice that is already overdue.
     - Show this guidance next to the setting, and generate the annual figure
       automatically.
   - **Booking:** produced as a **reviewed draft** finance-charge invoice or line that the
     owner finalizes. They are **never auto-posted.**
   - **Records:** write the accounting treatment into `ACCOUNTING_POSTING_RULES.md`, or an
     ADR.
   - **No legal advice:** don't hard-code legal limits. Surface a note that the rules
     differ by province.
6. **Home tiles:** "Owed to you", "Overdue" (count and amount), and "Paid in the last 30
   days".

## Constraints

- Reminders use I4's truthful delivery states.
- No tracking pixels.
- Every automated send is audited with the job run id.
- A reminder never goes to an archived customer or a customer flagged "do not remind".

## Acceptance criteria

- **Reminder schedule:** over a simulated 30-day clock, the plan sends exactly the expected
  reminders (integration test with an injectable clock).
- **Stop condition:** paying the invoice stops further reminders.
- **Statement accuracy:** statement totals equal the customer's AR subledger balance on
  the statement date.
- **Late-fee safety:** a late-fee draft never posts without a user's finalize.
- **E2E:** a manual reminder is received by a local SMTP server; the statement PDF
  downloads.

## Out of scope

- SMS.
- Collections agencies.
- Customer portals.

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
