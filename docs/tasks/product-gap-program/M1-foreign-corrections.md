# M1 — Foreign-currency corrections: voids, credit notes, refunds, reversals, partial payments

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `invoice-service.ts`, `payment-service.ts`, `purchase-service.ts`
- `monetary-position-service.ts`, `fx-revaluation-service.ts`
- `packages/accounting-core`
- `packages/db/prisma/schema.prisma`, plus migrations
- `docs/ACCOUNTING_POSTING_RULES.md`, `docs/CAD_USD_OPERATOR_GUIDE.md`
- A new ADR under `docs/adr/`
- UI in `apps/web/app.js`, on the I5 surfaces

**Closes:** the M1 rows in `ASSESSMENT.md` section 4
**Effort:** L
**Depends on:** I5 for the correction UI surfaces. **An accounting-policy decision from the
owner and their accountant** (see below).

## Context

**What CAD/USD already supports** (`docs/CAD_USD_OPERATOR_GUIDE.md`):

- Foreign invoices, bills, receipts and bill payments.
- Realized FX, and FIFO foreign cash lots.
- Closing-rate revaluation, with automatic next-period reversal.

**What is still fail-closed:**

- Foreign invoice void or correction: `FOREIGN_INVOICE_CORRECTION_WORKFLOW_REQUIRED`
  (`invoice-service.ts:629`).
- Foreign credit notes: `FOREIGN_CREDIT_NOTE_WORKFLOW_REQUIRED` (`invoice-service.ts:725`).
- Partial or unapplied foreign customer payments: `FOREIGN_PAYMENT_UNAPPLIED_UNSUPPORTED`
  (`payment-service.ts:1829`). The guide says "Foreign payments must be fully allocated in
  this release."
- Foreign customer-payment reversals and refunds (guide lines 77-81).
- Foreign bill-payment and settlement reversals:
  `FOREIGN_SETTLEMENT_REVERSAL_REQUIRES_CORRECTION` (`purchase-service.ts:1361`).

The guide explicitly tells operators not to work around these with manual journals. Users
therefore have no correct path at all.

_(Added in review)_ **Standards.**

- Most Canadian private businesses report under **ASPE Section 1651**.
- ASPE 1651 adjusts foreign monetary items to the balance-sheet-date rate, and takes
  exchange gains and losses to net income. IAS 21 treats monetary items the same way.
- Write the ADR against ASPE 1651 first, and note any IAS 21 difference.

## Decision required first

Record it in an ADR and in `ACCOUNTING_POSTING_RULES.md`, together with worked numeric
examples:

1. **Foreign credit-note rate.** What rate measures a foreign credit note? The reference
   approach is the original invoice's transaction rate for the portion that reverses
   revenue and tax. The remaining difference against the AR position's current carrying
   value — after any revaluation — becomes a position event with FX gain or loss.
2. **Voids across a revaluation.** How does voiding an unpaid foreign invoice interact with
   a revaluation already posted, and with its automatic reversal?
3. **Refund lots.** When a foreign receipt is refunded, which cash lots are consumed? Lots
   must be restored or consumed deterministically, and the FIFO rule must be applied.
4. **Unapplied foreign payments.** They open a **customer foreign-credit position** in
   document currency. Decide how it revalues and how it is applied later.

The owner has advised that the accountant's review is advisory, not a release gate
(`CURRENT_PHASE.md`). The ADR must still record who reviewed it.

## Tasks

1. **Linked monetary-position correction model:**
   - Every correction writes an immutable position event linked to the original.
   - Position balances must reconcile to the GL control accounts at every step.
2. **Foreign invoice void,** when unpaid: reverse the AR position at its carrying value,
   and reverse revenue and tax at the original rate. Post any difference as FX.
3. **Foreign credit notes,** full or partial, applied or held as credit, following the ADR.
4. **Partial foreign allocation and unapplied foreign credit;** apply that credit to later
   invoices.
5. **Foreign customer-payment reversal:** restore the AR position, and reverse the exact
   cash lots the payment opened. Refuse the reversal if those lots were already consumed,
   explaining why and what to do.
6. **Foreign refunds:** consume cash lots, and record realized FX against lot cost.
7. **Foreign bill-payment reversal:** the AP mirror of the customer case.
8. **Remove each fail-closed error only once its path passes.** Keep the error for any
   sub-case that is still unsupported.
9. **UI:** I5's void and credit-note surfaces work for foreign documents, showing both the
   document-currency and base amounts.

## Constraints

- **Money:** bigint minor units, and exact rational rates (existing numerator/denominator
  snapshots). No floating point.
- **Rates:** every rate is used for the purpose it was captured for, and the date must
  match.
- **Periods:** closed periods refuse; corrections go to the current open period.
- **Rollback refusal after foreign adoption is preserved**
  (`20260730015000_cad_usd_accounting_release`).

## Acceptance criteria

- **Golden fixtures.** There is at least one fixture per worked ADR example, and the
  posted lines and position events match exactly. Cases include:
  - a credit note after a revaluation;
  - a partial payment, then a credit note;
  - a refund consuming two lots;
  - a reversal refused because a lot was consumed.
- **Invariant test:** after every fixture, the AR/AP/cash position registers equal the GL
  control balances.
- **Concurrency:** idempotent retries of each correction post exactly once.
- **Browser:** e2e for foreign credit note and foreign payment reversal.
- **Documentation:** `CAD_USD_OPERATOR_GUIDE.md` is updated, and removed boundaries are
  deleted from its fail-closed list.

## Out of scope

- Foreign banking (M2).
- Reports (M3).
- New currencies (M4).

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
