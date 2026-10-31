# C3 — "When will I get paid?" Explainable payment forecasting

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `planning-service.ts` (the 13-week cash forecast)
- `receivables-service.ts`, `books-health-service.ts`
- A new `payment-behaviour-service.ts`
- `apps/web/app.js`, `apps/web/index.html`

**Closes:** differentiator C3 in `ASSESSMENT.md` section 5
**Effort:** S–M
**Depends on:** nothing hard. It is more useful after I3 (payment statuses) and I8
(reminders).

## Why this can beat competitors

An owner-operator's real question isn't "what's my AR balance?" but "when will this money
actually arrive?".

PennyWise already has a source-labelled 13-week cash forecast built from ledger cash, open
invoices and open bills (`IMPLEMENTATION_STATUS.md`), and the full payment history is in
the ledger.

A **transparent, deterministic** forecast, with the arithmetic visible, is a trust
advantage over opaque "insights". Verify how comparable products present cash-flow
forecasting, and record it in the research matrix.

## Tasks

1. **Payment behaviour per customer,** computed from finalized invoices and their payment
   allocations:

   - the median days from issue to full payment;
   - the median days late relative to the due date;
   - the percentage paid late;
   - the trend over the last N invoices;
   - the sample size.

   Below a minimum sample (for example, fewer than 3 paid invoices), mark it "not enough
   history" and fall back to the due date.

2. **Expected payment date for each open invoice:** the due date plus the customer's median
   lateness, bounded at no earlier than today. Show "why": "Usually pays 9 days late
   (median of 7 invoices)".
3. **Forecast integration.** Add "expected from customer history" as a **labelled**
   inflow method, next to the existing due-date method. It is never silently substituted.
   The owner chooses which method the headline uses.
4. **Slow-payer signal** on the customer and invoice views, and in Books Health as
   informational. It suggests reminder timing, which feeds I8 if it is present.
5. **Home:** "Expected this week / next 30 days" from the open invoices, with a link to the
   breakdown.

## Constraints

- **Nothing posts.** This is a projection only, derived from posted data.
- **No machine learning or black box.** Every figure is reproducible from the displayed
  inputs.
- **Money:** exact minor units, and date arithmetic in the organization's timezone.
- **Privacy:** behaviour stays per organization, and is never pooled across tenants.

## Acceptance criteria

- **Fixtures (unit tests):** synthetic payment histories produce the documented medians,
  including even-count medians, partial payments and credit-note-closed invoices.
- **Forecast labelling:** the forecast shows both methods with their labels, and switching
  the headline method changes only the presentation.
- **Fallback:** a customer with too little history falls back to the due date, with the
  stated reason.
- **Tenant isolation:** a test proves behaviour isn't computed across organizations.

## Out of scope

- Credit scoring.
- External data.
- Automatic reminder scheduling (I8 owns sending).

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
