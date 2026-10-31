# P3 — Deposits, retainers and milestone invoices that actually post

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files, likely:**

- `apps/api/src/services/customer-deposit-service.ts`, `progress-billing-service.ts`,
  `invoice-service.ts`, `payment-service.ts`
- `packages/db/prisma/schema.prisma`, plus migrations
- `docs/ACCOUNTING_POSTING_RULES.md`, and a new ADR
- `apps/web/app.js`, `apps/web/index.html`

**Closes:** G16 (and capabilities 11–12 in `COMPETITOR-MATRIX.md`)
**Effort:** L
**Depends on:**

- **Decision D-09.** A recommended default is given below.
- **I5**, the invoice detail view.
- **P2**, optionally, for deposits requested on acceptance.

## Context

- **Competitors take deposits and milestone payments.**
  - Square: deposits, and up to 12 milestone payments on Plus.
  - Jobber: deposits on quotes.
  - Zoho: retainer invoices applied to later invoices.
  - FreshBooks: retainers.
- **PennyWise's versions don't post.** Deposit requests are "explicitly classified,
  non-posting" and progress plans don't post (`IMPLEMENTATION_STATUS.md`;
  `GATED_FEATURE_RESOLUTION.md`, "Progress billing, deposits, and retainers"). That section
  asks for a liability-account decision and a tax memo. Holdback/retainage remains
  disabled.
- **Tax rules (verified, CRA and ETA):**
  - A **deposit**, meaning an amount given as security, "is not regarded as consideration
    for the supply unless and until the supplier applies the deposit against the
    consideration". Tax is payable when it is applied (CRA GST 300-6-8; ETA s.168).
  - Otherwise, tax is payable on the earlier of the day the consideration is paid and the
    day it becomes due (ETA s.168(1)). **An advance payment of the price is taxed when paid;
    a security deposit is not.**

## Recommended treatment (default for D-09; record it in an ADR and the posting rules)

Two distinct types, so the owner never has to know the law to choose correctly:

1. **Security deposit** — refundable or not; held as security.
   - **Receipt:** Dr Cash / Cr **Customer deposits** (liability). No GST/HST.
   - **Applied to an invoice:** Dr Customer deposits / Cr AR. The invoice carries its normal
     tax. The deposit becomes consideration at application.
   - **Refund:** Dr Customer deposits / Cr Cash.
   - **Forfeited:** handled by an explicit, accountant-reviewed workflow. Recognizing it,
     and its tax, needs a decision; leave it disabled until one is recorded.
2. **Advance or progress invoice** — part of the price, billed in advance or at a
   milestone.
   - It is a normal invoice, with tax when issued and paid, per the existing posting.
   - Milestone schedules on an estimate generate these invoices manually, or through I6 on
     a date. They are reconciled so their total never exceeds the estimate without an
     explicit change.

**Retainage/holdback stays disabled.** Construction prompt-payment rules are out of scope.

## Tasks

1. **Implement the two types above.** Include:
   - the liability account in the presets;
   - an "Apply deposit" action on invoices, with partial application;
   - refunds;
   - statements that show deposits held.
2. **Milestones:** a schedule on the estimate (percentage or amount, and a date or event),
   with "Create milestone invoice" and optional I6 automation. Show progress: billed, paid,
   remaining.
3. **Reporting:** a customer-deposits liability report that ties to the GL, and aging of
   deposits held.
4. **Foreign currency:** refuse foreign-currency deposits with a clear message until M1
   defines foreign liability positions.
5. **Wording:** plain-language choices in the UI, such as "Holding money as security" and
   "Billing part of the price now", with a short explanation of the tax consequence.

## Constraints

- **Posting integrity:** balanced, immutable postings, idempotent receipt and application,
  and closed-period enforcement.
- **Decision record:** the ADR records who approved the treatment. Under the 2026-08-02
  owner decision, an accountant's review is advisory, not mandatory, but it should be
  recorded if given.

## Acceptance criteria

- **Golden journal tests:** deposit receipt; partial and full application; refund; and a
  milestone invoice sequence totalling the estimate.
- **Tax timing:** there's no tax line on deposit receipt, and tax appears on the invoice the
  deposit is applied to.
- **Reconciliation:** the liability report equals the GL control balance.
- **E2E:** estimate → deposit on acceptance (P2) → receipt → final invoice with the
  deposit applied → balance due is correct.
- **Quality:** the X4 checks pass.

## Out of scope

- Holdbacks and retainage.
- Forfeiture posting, until it is decided.
- Foreign deposits (M1).

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Quality bar:** meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` §6.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
