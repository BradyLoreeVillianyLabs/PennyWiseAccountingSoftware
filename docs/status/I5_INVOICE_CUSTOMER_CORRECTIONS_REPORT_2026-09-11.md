# I5 invoice and customer corrections report — 2026-09-11

## Result

I5 is complete for the local beta correction scope. The Sales workspace now gives
authorized users a usable invoice and customer lifecycle: review and edit drafts,
attach evidence before issue, finalize, inspect posted history, void an unpaid
invoice with a reason, create and post full or selected-amount credit notes, and
inspect or edit customers with open-balance archive protection. The frozen
0.14.0.15 installer and packaging hold were not changed.

## Delivered

- Added an invoice detail dialog with status, totals, paid/credited/open balances,
  payment allocations, delivery history, attachments, linked credit notes, and a
  journal link for authorized accounting roles.
- Added versioned draft editing through the existing PATCH service, with the
  existing readable API errors and a fix for the background-autosave versus
  explicit-save race.
- Added draft-state attachment upload. The UI now explains the existing invariant
  that attachments must be added before an invoice is issued; posted detail remains
  read-only for attachments.
- Added permission-aware Finalize, Void, Credit note, Record payment, Edit, and
  customer actions. Void requires a reason and explains that it reverses the posted
  receivables journal; the payment-applied refusal points users to credit notes.
- Added credit-note review for the full remaining invoice or selected invoice lines
  with explicit amounts, then posts through the existing credit-note service. The
  UI does not invent a separate posting or refund path.
- Added Resend and public-link revoke actions in invoice detail. Delivery remains
  subject to the existing beta email/provider capability boundary.
- Added customer detail with balance, receivables, statement activity, and a link
  to the existing statement API output; added versioned edit and archive behavior.
- Fixed a real API projection gap: the invoice list now includes posted credit notes
  so list badges and balances update after a credit note rather than showing a stale
  partially-paid state.
- Added a focused viewer permission contract covering invoice posting/correction,
  credit notes, and customer management.

## Verification

- Fresh disposable PostgreSQL browser database `clearledger_i5_test_20260911_k`:
  all 121 migrations applied cleanly.
- Fresh Chrome acceptance flow: 1/1 passed. It edited a draft from CAD 130.00 to
  CAD 140.00, uploaded a draft attachment, finalized and voided the unpaid invoice,
  edited a customer, proved open-balance archive refusal, recorded a CAD 50.00
  partial payment, posted a selected CAD 150.00 credit against a CAD 200.00 invoice,
  observed a zero balance/Paid state, and archived the settled customer.
- Browser-run accessibility and performance release contracts passed.
- Web asset verification/build passed during the browser run.
- API/unit suite after the viewer contract change: 49 files, 277 tests passed.
- Full disposable integration suite: 44 files, 250 tests passed after all 121
  migrations applied.
- `test:research` passed for 21 modules; Prisma generation and the full workspace
  build passed, including API, web, database, shared, and accounting-core packages.
- Repository `typecheck`, `lint`, and `format:check` passed after the implementation
  changes. The route comparison reported 490 registrations; the I5 invoice and
  customer routes are now referenced by the web client. Other unrelated API-only
  routes remain intentionally listed in the route-diff evidence.

## Boundaries

- This does not implement foreign-currency corrections. The existing
  `FOREIGN_INVOICE_CORRECTION_WORKFLOW_REQUIRED` and
  `FOREIGN_CREDIT_NOTE_WORKFLOW_REQUIRED` refusals remain fail-closed and are
  surfaced through the existing error path; M1 owns that accounting decision.
- A customer statement document is not invented here; I8 owns that document. I5
  shows statement activity and links to the existing authorized statement output.
- Actual email delivery and provider-backed resend evidence remain external or
  capability-gated. The local acceptance flow verifies the buttons and route
  wiring, not a real mailbox or payment provider.
- A separate clean-machine install and assistive-technology review remain release
  evidence gates. No package was rebuilt, copied, signed, or placed in the frozen
  transfer folder.

## Changed files

- `apps/api/src/auth/permissions.test.ts`
- `apps/api/src/services/customer-service.ts`
- `apps/api/src/services/invoice-service.ts`
- `apps/web/app.js`
- `apps/web/index.html`
- `apps/web/e2e/i5-invoice-customer-corrections.spec.ts`
- `docs/status/CURRENT_PHASE.md`
- `docs/status/I5_INVOICE_CUSTOMER_CORRECTIONS_REPORT_2026-09-11.md`
- `docs/tasks/product-gap-program/MODEL-TAKEOVER.md`
- `docs/tasks/product-gap-program/HANDOFF-BUILD-PLAN.md`
