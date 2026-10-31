# C1 — The zero-fee get-paid loop: Interac e-Transfer with reference matching

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `bank-import-parser.ts`
- `banking-service.ts`: match suggestions, `/match-suggestions`
- `payment-service.ts`
- `workflow-preferences-service.ts`, read only (lines `96-102`)
- The I3 payment-reference field
- `apps/web/app.js`, `apps/web/index.html`
- Test fixtures under `apps/api/src/**/fixtures`

**Closes:** differentiator C1 in `ASSESSMENT.md` section 5
**Effort:** M
**Depends on:** I3, which puts the payment reference and e-Transfer instructions on the
invoice.

## Why this can beat competitors

- **Cloud invoicing tools tend to earn from card processing,** so their "get paid" path
  steers customers toward fee-bearing payments.
- **Canadian customers commonly pay small businesses by Interac e-Transfer.** _(Wording
  corrected in review.)_
  - Scotiabank's own page says receiving costs nothing when the recipient banks with
    Scotiabank or a partner institution (BMO, CIBC, RBC, TD). Recipients elsewhere "may be
    charged a fee". A third-party comparison reports receiving as free at every major bank.
  - The _sender_ may pay a fee, typically $1.00–$1.50 from a business account (biller.ca
    comparison, 2026, a third party).
  - "Fee-free" means free **to the business being paid**. Check the banks' own fee
    schedules before any marketing claim.
- **PennyWise already has the pieces:** bank import, match suggestions, and an immutable
  review gate. It can make the fee-free route the _easiest_ one.

**Before building:** verify in primary documentation how three or more comparable
products handle e-Transfer and bank-deposit matching today, and record it in the research
matrix. Adjust this design if a competitor already does it well.

## Tasks

1. **Payment reference per invoice.** It is short, unambiguous and typeable, with no 0/O or
   1/I confusion, and ends in a check character. For example `P7K-4Q`, or the invoice number
   if the owner prefers.
   - It is stored on the invoice and printed in the I3 "How to pay" block:
     "Put P7K-4Q in the e-Transfer message".
   - It is unique per organization.
2. **Parse e-Transfer deposits from bank imports** (CSV and OFX/QFX already exist):
   - Extract the sender name, and the message or reference text where the export includes
     it.
   - Build a **configurable parser profile set** for the major Canadian banks' export
     formats.
   - Research the formats from each bank's public help pages and published sample exports.
     **Never use real customer data;** fixtures are synthetic.
3. **Match suggestions, scored and explained:**
   - _(Revised in review: exports usually include the sender's name, but only some carry
     the payer's message — for example Scotiabank's long descriptions, or some OFX `MEMO`
     fields. Matching must work without a reference.)_
   - **High:** exact reference and exact amount. Or: exact amount, a sender name matching
     the customer or a saved payer alias, and exactly one open invoice for that amount.
   - **Medium:** exact amount, a sender name resembling the customer, and several candidate
     invoices.
   - **Low:** amount only.
   - **Payer aliases.** When the owner confirms a match, offer to remember the sender name
     as an alias for that customer, for example a spouse, or a company's accounts-payable
     clerk.
   - Show _why_ each suggestion was made. One deposit paying several invoices is supported
     when the amounts sum exactly.
4. **One-click confirm.** Bank-import review is an **immutable safeguard**
   (`bankImportReviewRequired: true`, `workflow-preferences-service.ts:96-102`), so nothing
   posts silently.
   - Confirming records the customer payment and the bank match **atomically,** through
     the existing services.
   - The invoice status updates.
   - A receipt is offered (I3 or I4).
5. **"Deposits to confirm" on Home,** with a count and one-click confirm for high-confidence
   matches. Each confirm still posts one at a time, and each is audited.
6. **Unmatched e-Transfer deposits** stay in the normal categorization flow.

## Constraints

- **No auto-posting.**
- **No new bank-feed provider.** File import is enough, and feeds plug in later through
  the same parser.
- **Data minimization.** Sender names and message text are stored only on the bank
  transaction. They are redacted from exports that don't need them.

## Acceptance criteria

- **Fixtures:** at least three bank CSV formats, with e-Transfer rows that include and omit
  the message field.
- **Matching precision:** exact reference and amount ranks first. A different amount with
  the same reference is flagged, never high-confidence. Two invoices summing to one deposit
  are suggested together.
- **Idempotency:** a double-clicked confirm applies once.
- **E2E:** invoice with reference → import a CSV containing the deposit → a suggestion
  appears → confirm → the invoice is Paid.

## Out of scope

- Initiating e-Transfers.
- Request-money APIs.
- Scraping bank websites.

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
