# I2 — One-screen invoice composer with a single "Finalize" step

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `apps/web/app.js`: the invoice functions around `9376-9496`, and the sales form
- `apps/web/index.html`: the sales workspace
- `apps/web/styles.css`
- `apps/api/src/services/invoice-service.ts`
- `apps/api/src/app.ts`: the invoice routes, `3880-4146`
- `apps/api/src/http/schemas.ts`: `invoiceLineInputSchema`, line 924

**Closes:** G10 (vocabulary and steps), and the composer part of G5
**Effort:** M
**Depends on:** **X3**, which supplies the multi-line editor, the creatable pickers and
in-place quick-create. I1 is recommended, but this change must work in every profile.

## Context

- **Lifecycle.** An invoice goes DRAFT → APPROVED (optional) → posted
  (`invoice-service.ts:180, 318`).
- **Posting is its own action, worded in ledger language.** The UI reports "Invoice posted
  to the receivables ledger." (`app.js:9495`).
- **Other actions are separate commands:** Preview, PDF, Send and Public link
  (`app.js:9385-9473`).
- **The API accepts free-text lines** (`productItemId` is optional, `schemas.ts:926`), but
  the invoice screen sends exactly one line and requires a saved product
  (`app.js:9159-9192`, `index.html:2416`).
- **X3 fixes the line editing and inline creation.** This prompt assembles those pieces
  into the composer, and adds Finalize, send and the books panel.
- **Two things confuse an owner-operator:**
  - the word "post";
  - the fact that an invoice must be posted before it's sent.

## Tasks

1. **Composer, on one screen:**
   - A customer picker with the X3 "+" button and quick-create dialog. The new customer is
     selected, and focus returns to the composer.
   - Issue date, and a due date derived from terms (editable).
   - The X3 line editor:
     - any number of lines;
     - description-only lines allowed;
     - saved items optional, with "+" to create one in place;
     - totals always visible.
   - A message and terms to the customer.
   - Live totals with a tax breakdown.
   - A live preview: to the right on desktop, below on mobile.
2. **Drafts autosave** through the versioned `PATCH /v1/invoices/:id`. A conflicting edit
   from another tab appears as a visible conflict; it is never silently overwritten.
3. **"Finalize" is one user action:** validate → approve (if required) → post.
   - One confirmation dialog, for example: "Finalize INV-0007 for $1,130.00? After this the
     invoice can't be edited. Fix mistakes with a credit note or a void."
   - Implement it either as a server-side orchestrating endpoint (one transaction, one
     idempotency key) or as a documented idempotent sequence of the existing endpoints.
     Record the choice in a short ADR note.
4. **After finalizing, "Send" is the primary next action.** I4 implements the real dialog.
   Until then, keep the existing PDF download and its truthful manual-send message.
5. **Add a "What this did to your books" panel** to finalized invoices, derived from the
   **posted journal lines**. Example: "Customers owe you $1,130.00 more · Sales $1,000.00 ·
   GST/HST you'll remit $130.00".
   - It is read-only.
   - It is never recomputed from the document.
   - For accountant roles, it links to the journal.
6. **Keep the expert commands** (preview, PDF, public link, delivery history) in an overflow
   menu.
7. **Add "Copy to new draft"** for repeat work.
8. _(Added in review)_ **Canadian document requirements** (decision D12):
   - **Registration numbers.** Print the GST/HST registration number, and the QST number
     where registered, on invoices, credit notes and receipts whenever the organization is
     registered. - The CRA requires the GST/HST number on invoices of $100 or more before the buyer can
     claim input tax credits. - Today the renderer prints only "Business number" (`invoice-render-service.ts:149,
542`).
   - **Document language.** Render documents in the customer's language: English, French or
     bilingual.
     - For Quebec customers, French must be at least as prominent as any other language
       (Charter s.57).
     - If the renderer has no French labels, add them for invoice, credit note, receipt and
       statement. Have the French wording reviewed by a fluent reviewer; don't rely on
       machine translation alone.
   - **Currency.** Totals state their currency (X1).

## Constraints

- **Posted invoices stay immutable.**
- **The server's calculation is authoritative** (`invoice-calculation.ts`). The client only
  displays totals.
- **Money travels as strings or minor units in DTOs.** Never use JavaScript `number` for
  persisted money.
- **Every create and finalize carries an idempotency key.**
- **Usability:** keyboard-operable, with labelled controls, and usable at 390 px.

## Acceptance criteria

- An invoice for a brand-new customer can be created and finalized without leaving the
  composer.
- A double-clicked Finalize produces exactly one posting (idempotency test).
- A stale draft edit returns a visible conflict and overwrites nothing.
- The "What this did" figures equal the posted journal lines (integration test, including
  a tax-inclusive case).
- `release-candidate.spec.ts` and `owner-contracts-invoice.spec.ts` still pass. Add a
  composer e2e covering desktop and mobile width.
- _(Added in review)_ A GST/HST-registered organization's invoice PDF shows its
  registration number.
- _(Added in review)_ An invoice for a customer whose document language is French renders
  its labels in French.

## Out of scope

- Email sending (I4).
- Payment instructions (I3).
- Void and credit notes (I5).

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
