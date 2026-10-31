# I3 payment instructions and recording report — 2026-09-11

## Result

I3 is complete for the implemented offline-payment scope. Owners can configure
structured payment methods, select an optional narrower set per invoice, issue
documents with an immutable “How to pay” snapshot, and record a manual payment
from a finalized invoice. The frozen 0.14.0.15 installer and packaging hold were
not changed.

## Delivered

- Added versioned, ordered, audited organization payment instructions for
  Interac e-Transfer, EFT/direct deposit, cheque, public HTTPS pay links, cash,
  and other instructions.
- Preserved the existing free-text payment note as an additional rendered note.
- Encrypted EFT transit and account values at rest, masked them in settings, and
  revealed them only in a document snapshot the owner chose to issue.
- Rejected non-HTTPS, loopback, and private-network pay-link hosts without
  fetching the URL.
- Added an invoice-level method selection override; an empty selection uses all
  configured organization methods.
- Added “How to pay” output to invoice HTML, PDF, preview, and public rendering,
  including the invoice reference.
- Reused `POST /v1/payments/manual` for the finalized-invoice Record payment flow.
  Invoice badges are derived from allocated ledger amounts and include Awaiting
  payment, Partially paid, Paid, Overdue, Draft, and Void.
- Added a request-version and dirty-form guard so background payment refreshes do
  not overwrite payment instructions while an owner is editing them.
- Added migrations `20260911160000_structured_payment_instructions`,
  `20260911161000_payment_instruction_rls_grant`, and
  `20260911162000_invoice_payment_method_selection`; the tree now contains 121
  migrations and 490 `/v1` route registrations.

## Verification

- Focused API tests: 20/20 passed, including payment-link safety and invoice
  document rendering.
- Fresh disposable PostgreSQL browser database: 121 migrations applied cleanly.
- Fresh Chromium acceptance path: 1/1 passed. It configured e-Transfer and cash,
  selected only e-Transfer on the invoice, finalized the invoice, found the
  rendered “How to pay” block and recipient email, recorded the manual payment,
  and observed the Paid badge.
- Release-candidate accessibility and performance contracts: passed.
- Web asset verification/build passed during the browser run; typecheck, lint,
  and format are rerun in the final gate after documentation changes.

## Boundaries

- This is offline/manual collection only. Card collection, automatic matching,
  reminders, email delivery, and provider acceptance remain later increments or
  external gates.
- EFT values are intentionally not returned in full by the settings API. The
  document snapshot contains the chosen document values so an issued invoice is
  stable and reproducible; changing settings does not mutate it.
- The tested browser run used regular Playwright because the browser connector
  was unavailable. Human assistive-technology review and clean-machine evidence
  remain separate release gates.
- The frozen 0.14.0.15 package remains unchanged. I3 changes require a later
  versioned candidate.
