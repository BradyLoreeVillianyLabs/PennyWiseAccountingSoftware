# I5 — Fix mistakes: the invoice and customer lifecycle in the UI

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Files:** `apps/web/app.js`, `apps/web/index.html` and `apps/web/styles.css`. Touch the
API only if you find a real gap, and document it.
**Closes:** G6
**Effort:** M
**Depends on:** none. I2 is recommended, for a shared invoice-detail surface.

## Context

The API has these routes, but the web client never calls them. This was verified by
searching `app.js`: for invoices, it calls only preview, pdf, send, public-link,
delivery-history, post, picking-slip and shipment.

- **Invoices** (`app.ts:3880-4146`):
  - `PATCH /v1/invoices/:id` (edit draft)
  - `GET …/validate`, `POST …/approve`
  - `POST …/void`, `POST …/credit-notes`, `POST /v1/credit-notes/:id/post`
  - `POST …/resend`
  - `POST|GET …/attachments`
  - `POST …/public-links/:linkId/revoke`
- **Customers:**
  - `GET|PATCH /v1/customers/:id`, `POST …/archive`, `GET …/balance`
  - `GET /v1/reports/receivables/customers/:id/statement` (`app.ts:2852`)
  - The web calls only contacts, timeline and activities (`app.js:12403-12590`).
- **Credit notes** currently arise only from the returns workflow (`app.js:7772`).

## Tasks

1. **Invoice detail view** (drawer or page) showing:
   - status, totals and balance;
   - payments and allocations;
   - delivery history;
   - attachments;
   - linked credit notes;
   - a journal link for accountant roles.
2. **Edit a draft** through the versioned PATCH. **Validate**, with readable field-level
   errors. **Attach files.**
3. **Void**, where the service allows it.
   - Require a reason.
   - The confirmation explains the effect in plain language.
   - After voiding, show the resulting reversal.
   - Where the service refuses (for example, once a payment is applied), show why and offer
     a credit note instead.
4. **Credit note from an invoice**, for the full amount, selected lines, or an amount.
   - Review, then post.
   - Apply it to the invoice balance, or keep it as customer credit, per existing service
     rules.
   - Offer a PDF if the renderer supports credit notes. If it doesn't, record that as a
     follow-up; don't fake a document.
5. **Resend** a delivered invoice. **Revoke** a public link.
6. **Customer detail:**
   - Edit, versioned.
   - Archive. When there is an open balance, the archive is refused and the reason shown.
   - Balance, invoices, payments, and a statement link. I8 builds the statement document;
     until then, link to the API output or hide the link.
7. **Foreign-currency documents.** Show the existing fail-closed refusals as clear
   explanations, not generic errors:

   - `FOREIGN_INVOICE_CORRECTION_WORKFLOW_REQUIRED`, `invoice-service.ts:629`
   - `FOREIGN_CREDIT_NOTE_WORKFLOW_REQUIRED`, `:725`

   M1 lifts these later.

## Constraints

- No new posting semantics. Everything goes through the existing services.
- Posted documents stay immutable. Corrections are linked reversals or credit notes.
- Buttons are permission-aware: hidden, or disabled with a stated reason.
- Stale versions produce a visible conflict.

## Acceptance criteria

- **E2E, void path:** edit a draft → finalize → void (unpaid) → the status is Void, and AR
  is unchanged overall.
- **E2E, credit path:** finalize → partial payment → credit note for the remainder → the
  balance is zero and the status is Paid or Closed.
- **E2E, customers:** edit a customer; the archive is refused with an open balance and
  succeeds after settlement.
- **Authorization tests:** a viewer role cannot void, credit or edit.
- **Route comparison:** rerun the script in `codex-product-gap-pack/evidence`. The
  invoice and customer routes listed above are now referenced.

## Out of scope

- Products, vendors and accounts maintenance (U1).
- The statement document (I8).
- Foreign corrections (M1).

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
