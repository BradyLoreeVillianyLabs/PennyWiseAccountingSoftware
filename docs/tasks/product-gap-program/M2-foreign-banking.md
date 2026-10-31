# M2 — Foreign banking: categorization, transfers, conversions, feeds, manual journals

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `banking-service.ts`, `bank-feed-service.ts`, `journal-service.ts`
- `monetary-position-service.ts`
- `packages/accounting-core`
- `packages/db/prisma/schema.prisma`, plus migrations
- The M1 ADR
- `apps/web/app.js`
- `docs/CAD_USD_OPERATOR_GUIDE.md`

**Closes:** the M2 rows in `ASSESSMENT.md` section 4
**Effort:** L
**Depends on:** M1, which supplies the position-correction model and ADR.

## Context

All four of these are fail-closed today:

- **Categorizing a line on a USD bank statement** (bank fee, interest, a sale deposited
  directly) is refused: `FOREIGN_BANK_CATEGORIZATION_REQUIRES_SOURCE_WORKFLOW`
  (`banking-service.ts:757`).
- **Transfers between foreign accounts**, and USD↔CAD conversions, are refused:
  `FOREIGN_BANK_TRANSFER_REQUIRES_POSITION_TRANSFER` (`banking-service.ts:1105`).
- **Importing foreign transactions from bank feeds** is refused:
  `BANK_FEED_CURRENCY_NOT_RELEASED` (`bank-feed-service.ts:800`).
- **Foreign manual journals** are refused: `FOREIGN_MANUAL_JOURNAL_UNSUPPORTED`
  (`journal-service.ts:462`).

A business with a real USD account therefore can't finish reconciling it inside PennyWise.
Only lines that match previously posted foreign receipts or payments can be handled.

## Tasks

1. **Position-opening categorization.**
   - A USD deposit categorized to income opens a USD cash lot at the transaction-date rate.
   - A USD withdrawal categorized to an expense consumes lots FIFO, and posts realized FX
     against lot cost.
   - Tax on these lines follows the existing tax-code rules. Where tax on foreign lines
     isn't supported, refuse precisely.
2. **Position transfer between two USD accounts.** Lots move with their original cost and
   date, so there is no FX.
3. **Currency conversion, USD→CAD and CAD→USD:**
   - Record both legs, with the bank's effective rate derived from the two amounts.
   - Realized FX is posted against the cost of the consumed lots.
   - An optional fee line.
   - The transfer UI shows the implied rate next to the day's reference rate, for
     information only.
4. **Foreign bank-feed import.** Review-only, like the CAD feeds: no auto-posting, and the
   immutable bank-import review gate stays on.
5. **Foreign manual journals,** for the accountant role only.
   - An explicit rate snapshot, and an explicit position impact (which position, and
     whether it opens or consumes).
   - Refuse any foreign journal whose position effect is ambiguous.
6. **Reconciliation in account currency.** A USD account reconciles to zero difference in
   USD, while the base-currency GL shows the carrying value. The report shows both.

## Constraints

- Same as M1: exact arithmetic, purpose- and date-matched rates, and immutable events.
- Closed-period enforcement.
- No change to the CAD-only paths.
- Every newly unlocked path gets golden fixtures before its fail-closed error is removed.

## Acceptance criteria

- **Golden fixtures, at minimum:**

  - a USD bank fee;
  - a USD interest deposit;
  - a USD→USD transfer;
  - a USD→CAD conversion with a fee;
  - a CAD→USD purchase of USD;
  - a foreign manual journal.

  Each fixture's posted lines and lot movements must match exactly.

- **Invariant:** lot registers equal the USD bank balance and the GL carrying value after
  every fixture.
- **E2E:** import a USD statement → categorize one line → match one line → convert one →
  reconcile to zero.
- **Operator guide:** its fail-closed list is updated.

## Out of scope

- Other currencies (M4).
- Live FX rate providers (M3).

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
