# I3 — "How to pay me" on every invoice, and one-click payment recording

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `packages/db/prisma/schema.prisma`, plus a migration
- `apps/api/src/services/company-setup-service.ts` or a new `payment-instruction-service.ts`
- `invoice-render-service.ts`, `invoice-template-service.ts`, `invoice-document-service.ts`
- `payment-service.ts`: the manual payments route is `app.ts:4285`
- `app.ts`, `apps/web/app.js`, `apps/web/index.html`

**Closes:** G4, and the offline half of G3
**Effort:** M
**Depends on:** none. I2 is recommended, so "Record payment" lives on the finalized-invoice
view.

## Context

- **Only free text exists today.** _(Corrected 2026-09-11.)_
  - Branding and invoice-template settings hold one free-text "Payment instructions" field
    (`company-setup-service.ts:429-445`, `invoice-template-service.ts:40, 201`). It renders
    on the HTML and PDF invoice (`invoice-render-service.ts:335-336, 713`).
  - There is no structured method list and no per-invoice reference.
  - Bank details typed into the box have no masking or encryption.
  - Nothing prompts the owner to fill it in.
  - The only other e-Transfer mention is a hint on the manual-payment form (`app.js:806`).
- **Online payment is not available on installed builds** (see I9). For a Canadian service
  business, the realistic routes are Interac e-Transfer, EFT/direct deposit, and cheque.
  The invoice has to tell the customer which one to use.
- **Manual payments and receipts already exist:** `POST /v1/payments/manual`, plus the
  receipt routes around `app.ts:4211-4216`.

## Tasks

1. **Organization setting: "Payment methods you accept".** It is versioned, audited, and
   ordered, with a default selection. The methods:
   - **Interac e-Transfer:** the recipient email, and whether autodeposit is on. If
     autodeposit is off, show a standard note that the security answer will be shared
     separately. **Never store a security answer.**
   - **Direct deposit/EFT:** institution, transit and account numbers. Encrypt them at rest
     using the existing protector pattern. Mask them in settings for anyone without the
     payment-settings permission, and show them in full only on the rendered document.
   - **Cheque:** "payable to" and a mailing address.
   - **Pay online link:** an owner-supplied `https://` URL, such as their own Stripe Payment
     Link, Square or PayPal link. Validate that it is https and not a loopback or private
     host. Display it; **never fetch it**.
   - **Cash** and **Other** (free text).
   - **The existing free-text field keeps working.**
     - Offer to convert its text into the structured methods.
     - Until then, render it as an additional note under "How to pay".
     - Existing invoices' render snapshots never change.
2. **Per-invoice override** of which methods appear. By default, all enabled methods show.
3. **Render a "How to pay" block** on the PDF, the preview and the public page.
   - It includes a **payment reference** the customer should quote, for example "Put
     INV-0007 in your e-Transfer message".
   - Store the rendered instructions in the document's **render snapshot**, so later
     settings changes never alter an issued invoice.
   - If the template designer supports movable blocks, add this as one. Otherwise use a
     fixed footer block.
4. **"Record payment" on a finalized invoice.** It opens a dialog prefilled with the
   balance as the amount, today's date, the default accepted method, and the invoice
   number as the reference.
   - Partial payments are allowed. Overpayment follows the existing unapplied or credit
     behaviour.
   - Post through the **existing** manual-payment service.
5. **Status badges derived from ledger allocations:** Draft, Awaiting payment, Partially
   paid, Paid, Overdue (past the due date with a balance above zero), Void. They appear in
   the invoice list and the detail view.
6. **Receipts:** after a payment, offer to download the receipt, or send it once I4 lands.

## Constraints

- PennyWise never moves money. These are instructions only.
- Bank details are encrypted, permission-gated, and redacted from logs and exports, except
  on the rendered document the owner chose to issue.
- Changing settings never mutates an issued document's snapshot or checksum.
- Foreign-currency invoices follow the existing CAD/USD rules. Payments must be fully
  allocated until M1 lands, so surface that rule clearly.

## Acceptance criteria

- The PDF shows the configured instructions and the reference. After the settings change,
  a re-download of an already-issued invoice keeps the same checksum.
- Recording a partial and then a full payment moves the status Awaiting → Partially paid →
  Paid. The AR balance is correct and the journals balance (integration test).
- A viewer role cannot read full bank numbers from settings (authorization test).
- **E2E:** finalize → the PDF text contains "Interac e-Transfer" and the recipient email →
  record payment → the status is Paid.
- A loopback or private "pay online" URL is rejected (test).

## Out of scope

- Automatic matching of e-Transfer deposits (C1).
- Card payments (I9).
- Reminders (I8).

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
