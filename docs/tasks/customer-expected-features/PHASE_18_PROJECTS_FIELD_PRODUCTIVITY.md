# Phase 18 Codex Task — Projects and Field Productivity

Execute only after Phase 17 acceptance and explicit owner authorization.

## Objective

Give service businesses one fast field-to-books workflow: projects, time,
billable expenses, mileage, receipt/bill capture, job profitability, and an
installable mobile web app.

## Requirements

### Projects, time, and job economics

- Add customer-linked projects with status, dates, estimate/budget, assignees,
  billing method, and optional tags.
- Add timer and manual time entries with approval, locking, correction audit,
  billable status, rate snapshot, and invoice-line conversion.
- Add project links to estimates, invoices, bills, expenses, inventory
  consumption, and attachments without duplicating those source records.
- Add job profitability and work-in-progress views derived from posted actuals
  plus clearly labelled unposted estimates/time. Never mix the two totals.
- Add mileage logs with date, purpose, distance, vehicle label, attachment, and
  configurable reimbursement rate. Produce an expense draft; do not calculate
  statutory deductions or tax claims.

### Capture and review

- Add camera/file capture for receipts and bills, private object storage,
  malware scanning, content hashing, duplicate hints, rotation/crop, and
  retention.
- Put OCR behind a provider-neutral adapter. Store provider/version/confidence
  and extracted evidence. OCR may create a draft suggestion only.
- Require human review of vendor, date, tax, currency, totals, line
  categorization, project, and duplicate status before existing bill/expense
  services can post.
- Make low-confidence and arithmetic/tax disagreements prominent. Preserve the
  original image and review trail.

### Installable PWA

- Make capture, time entry, project lookup, approvals, and basic customer/invoice
  lookup installable and responsive.
- Allow offline creation of encrypted-at-rest local drafts with explicit pending
  status and conflict handling. Never post, approve, email, or apply payments
  while offline.
- Purge sensitive caches on sign-out/session revocation and do not cache reports,
  tokens, public payment pages, or attachments unnecessarily.

## Efficient implementation order

Create project references and a shared draft-review model first. Time/mileage,
OCR, reporting, and PWA UI may then proceed independently. Reuse uploads,
scanning, authorization, audit, invoice, purchase, and reporting services.

## Tests and acceptance

- Permission/RLS tests for projects, time, OCR evidence, and attachments.
- Timer concurrency, approval, rate-snapshot, correction, invoice-conversion,
  and duplicate prevention tests.
- OCR adapter contract tests with deterministic fixtures; no network in normal
  tests; malicious file and low-confidence cases.
- Profitability reconciliation to posted ledger/subledgers and clear separation
  of projected/unposted values.
- PWA install, offline draft, reconnect conflict, cache purge, mobile
  accessibility, and revoked-session tests.
- End-to-end mobile flow: photograph receipt, review draft, assign project,
  submit; record time; convert approved time to invoice; inspect job profit.

Acceptance requires no autonomous posting, no lost/duplicated offline draft,
traceable OCR edits, and job actuals that reconcile exactly.

Write the Phase 18 completion report, update current phase, and stop.
