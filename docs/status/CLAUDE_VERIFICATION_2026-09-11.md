# Independent verification of Wave 0 and I1–I5 — 2026-09-11

> Historical snapshot. The later X3 completion report dated 2026-09-13 supersedes
> the partial-X3 wording below; current candidate evidence is recorded in
> `docs/status/PENNYWISE_FEATURE_AUDIT_2026-09-15.md`.

Verified by reading the source, not the completion reports. No application code was
changed, and no suites were rerun, because an implementation session was active in the
same tree. Findings are written up as `docs/tasks/product-gap-program/F1-bank-detail-secret-and-test-fidelity.md`.

## Confirmed in source

- **Wave 0 (X4 Part A).** `apps/web/strings.js`, the axe harness and baseline fixture,
  keyboard, viewport, target-size and lab-timing specs, and `docs/pennywise/UI_QUALITY_BAR.md`
  all exist.
- **X3.** The invoice line editor builds its payload from `invoiceLineState`, supports
  description-only lines, and quick-creates products and customers in place. The report
  correctly calls itself partial: estimate, bill and purchase-request editors are untouched.
- **I1.** The `INVOICING_ONLY` profile, first-run wizard, GST/HST and QST capture, and
  automatic `CUST-0001` numbering inside a serializable transaction.
- **I2.** `POST /v1/invoices/:invoiceId/finalize` and `GET /v1/invoices/:invoiceId/books-impact`
  exist; drafts autosave through versioned `PATCH`; the renderer emits French registration
  labels.
- **I3.** `payment-instruction-service.ts` encrypts and masks EFT values; 121 migrations.
- **I5.** The web client now calls void, credit-note create and post, resend, attachments,
  public-link revoke, customer `PATCH`, archive, balance and the receivables statement.
  `void` requires a reason, a version and an idempotency key, and asserts
  `invoices:correct`. A genuine API projection gap was fixed: the invoice list omitted
  posted credit notes, which would have left stale badges after a credit.

Route registrations went 486 to 490; migrations 114 to 121.

## Findings — see F1

1. **Bank details can be encrypted with a constant published in this repository.** The
   payment-instruction service falls back to `"development-payment-account-encryption-secret"`
   with no guard. Installed builds are safe, because beta runtime requires a 32-character
   secret and the launcher sets it. A production deployment without a payment provider
   configured is not: `index.ts` ties the requirement only to provider configuration.
   `payment-service.ts` shares the fallback. **Recommendation: fail closed.**
2. **The accessibility error-state scan fills a hidden legacy input.** It drives
   `unitPriceMinor` inside the `aria-hidden`, `tabindex="-1"` compatibility block, so the
   scanned state is not the one a user reaches. Nothing double-submits.

## Still open before the Wave 1 exit gate

- The human X4 round: five owner-operators, plus NVDA and VoiceOver. None has been run.
- X3's remaining scope: estimate, bill and purchase-request editors, "save as item",
  per-line income account, and permission-aware create affordances.
- Two known colour-contrast fingerprints, review dated 2026-09-18.
- I4 tasks 3 to 5 complete Wave 1.
