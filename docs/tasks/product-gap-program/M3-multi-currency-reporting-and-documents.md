# M3 — Multi-currency reporting, documents, rate automation, and remaining domain closure

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `phase10-report-service.ts`, `report-service.ts`, `receivables-service.ts`
- `multi-currency-service.ts`: `114`, `125`, `215`
- `bank-of-canada-rate-service.ts`
- `inventory-service.ts`, `fixed-asset-service.ts`, `project-service.ts`
- `tax-calculation-service.ts`
- The I6 jobs
- `apps/web/app.js`

**Closes:** the M3 rows in `ASSESSMENT.md` section 4
**Effort:** L. Split it into reports and documents, then rate automation, then domain
closure.
**Depends on:** M1, and I6 for scheduled rate retrieval.

## Context

- **Statements are base-currency only** (`CURRENT_PHASE.md`). A US customer receives a
  statement in CAD, even though every invoice they got was in USD.
- **Rate automation is refused:** `FX_RATE_MODE_NOT_RELEASED` and
  `FX_RATE_METHOD_NOT_RELEASED` (`multi-currency-service.ts:114, 215`). Only a manual Bank
  of Canada USD/CAD _suggestion_ exists; it prefills a form and is never saved.
- **Two MCFX phases are still open** in `docs/tasks/MULTI_CURRENCY_IMPLEMENTATION_PROMPTS.md`,
  according to the historical audit in `CURRENT_PHASE.md`:

  - **MCFX-12:** inventory, fixed assets and projects in foreign currency.
  - **MCFX-14:** tax, reports, dashboards and close controls.

  Confirm which parts later increments already covered.

## Product decisions this prompt must follow

These come from `DECISIONS-currency-reporting-workflow.md`, decisions D2 and D4–D6.

- **Customer statements** default to the customer's transaction currency, with one section
  per currency and an optional base summary.
- **AR/AP aging** defaults to base, with an **"Original currency" toggle** and per-currency
  subtotals. X2 draws it; this prompt supplies the data.
- **Posted revaluation stays the book of record.** "Value at today's rate" is a
  non-posting preview, marked `≈`.
- _(Added in review)_ **Revaluation is prompted at fiscal year-end by default**, the
  balance-sheet date under ASPE 1651. Monthly is optional.
- _(Added in review)_ **Bank of Canada timing.** The Bank publishes indicative daily
  averages by 16:30 ET each business day. The rates page lists 24 currencies; the Valet
  daily group holds 27 series, some no longer published. Read the group rather than
  hard-coding a list.
  - Schedule the rate fetch after that time.
  - Label any suggestion made earlier in the day with the previous business day's date.
- **Rate suggestions are accepted with one click on the document itself** (X1), creating the
  dated snapshot. Nothing is applied silently.
- **All amounts use the X1 formatter and dual-amount component.**

## Tasks

1. **Customer and vendor statements in document currency.** A statement per currency the
   customer has transacted in, plus an optional base summary.
2. **Aging in both currencies.** AR/AP aging shows transaction currency and base carrying
   value, and can be filtered by currency.
3. **FX reports:**
   - realized FX by period and source;
   - unrealized FX from the last revaluation;
   - an open monetary-position register;
   - rate-snapshot history, showing who approved each rate, its source and purpose.
4. **Invoice option:** show the base-currency equivalent at the invoice rate, for customers
   who want it. It is informational and stored in the render snapshot.
5. **Reviewed rate automation:**
   - An I6 job retrieves Bank of Canada Valet observations for each enabled currency
     against CAD. Verify the series list and the terms of use from Bank of Canada's primary
     docs.
   - It creates **suggested** snapshots, which an authorized user approves. Approval
     creates a normal manual snapshot with provenance.
   - Nothing posts from a suggestion.
   - A non-CAD base currency needs a different source. That is an owner decision; record it
     and leave it fail-closed.
6. **MCFX-12 closure:**
   - A USD inventory receipt is valued in base at the receipt rate, and weighted-average
     cost stays in base.
   - USD fixed-asset acquisitions use the acquisition-date rate.
   - Project costs and billings carry both amounts.
7. **MCFX-14 closure:**
   - Sales tax on foreign documents is computed in document currency and reported in base,
     with source-currency evidence.
   - Dashboards label figures as base currency.
   - Close checklists include the revaluation.

## Constraints

- Reports derive from posted ledger entries and position events, never from document
  recomputation.
- Rate suggestions are not rates until approved.
- No auto-posting.
- Fail-closed errors are removed only for paths that pass.

## Acceptance criteria

- **Statements:** a USD customer's statement in USD equals the sum of their USD documents
  and allocations (integration test).
- **Aging:** the base totals equal the AR/AP control balances.
- **Unrealized FX:** the report equals the latest revaluation journal.
- **Rate job:** a local emulator of the Valet response produces suggestions; approving one
  creates a snapshot; rejecting leaves nothing.
- **Domain closure:** MCFX-12 and MCFX-14 each have golden fixtures.

## Out of scope

- New currencies (M4).
- Paid rate providers.

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
