# I7 — Recurring invoices that actually create invoices

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `apps/api/src/services/estimate-service.ts`: the recurring-schedule code, `600-725`
- `invoice-service.ts`
- The recurring routes in `app.ts`
- The I6 job registry
- `packages/db/prisma/schema.prisma`, plus a migration for occurrence runs if none exists
- `apps/web/app.js`
- `apps/web/index.html`: the recurring section, `~2900-2954`

**Closes:** R1, G7
**Effort:** M
**Depends on:**

- **I6**, the runner.
- **I2**, the composer, reused as the template editor.
- **I4**, for the auto-send mode.

## Context

- **The data is there, but nothing uses it.** Schedules store a cadence, a template JSON,
  and `nextRunAt`. They also compute a per-occurrence idempotency key: `previewSchedule`
  and `recurrenceRunIdempotencyKey` in `estimate-service.ts:714-725`. **Nothing turns a
  schedule into an invoice.**
- **The docs admit it; the UI doesn't.** `IMPLEMENTATION_STATUS.md:16-18` says "No
  background scheduler or automatic invoice creation is implemented." The UI still labels
  the section "Recurring invoice plans" (`index.html:2903`).
- **Schedules can't be edited in the UI.** `PATCH /v1/recurring-schedules/:id` has no UI.

## Tasks

1. **Materialization job.** For each ACTIVE schedule with `nextRunAt ≤ now`:
   - Create the invoice from the template using that occurrence's idempotency key. The
     result is exactly one invoice per occurrence, even under retries or concurrency.
   - Advance `nextRunAt`.
   - Record an occurrence run: date, invoice id, and outcome.
2. **Missed occurrences.** The app may have been closed for weeks. Add an owner setting:
   "create every missed occurrence" or "only the latest". The default is **every missed
   occurrence, as drafts, with a Home notice**.
3. **Mode per schedule:**

   - **Create a draft for review** (the default).
   - **Create and finalize.**
   - **Create, finalize and send.** This requires I4 email to be enabled. Otherwise, fall
     back to a draft and a notice.

   Finalizing and sending use the same services a user action uses.

4. **Edit a schedule** in the UI, using the I2 composer as the template editor. Keep
   pause, resume and end.
5. **Schedule detail:** the next three dates, the history of generated invoices, and
   failures with their reasons.
6. **Occurrence-date correctness:**
   - Recalculate lines at the occurrence date, so tax-code effective dates apply.
   - A foreign-currency schedule needs a transaction rate **for that date**. Without one,
     create a draft carrying a blocking reason. **Never guess a rate.**
   - A closed period produces a draft with an explanation.

## Constraints

- Idempotent per occurrence.
- Audited, with the job run id.
- Uses the timezone per schedule (already modeled).
- No automatic send unless the owner explicitly chose that mode for that schedule.

## Acceptance criteria

- **Concurrency:** two concurrent job runs for the same occurrence produce one invoice
  (integration test).
- **Month-end:** a monthly schedule on the 31st follows the existing recurrence rule for
  short months (test).
- **Missed occurrences:** the policy is exercised with an injectable clock.
- **Auto-send:** the auto-send mode delivers to a local SMTP server. Without email, it
  degrades to a draft and a notice.
- **E2E:** create a schedule → "Run now" in Automations → a draft appears and is linked in
  the schedule history.

## Out of scope

- Recurring bills, cheques or journals. This is a QuickBooks-gap item for later.

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
