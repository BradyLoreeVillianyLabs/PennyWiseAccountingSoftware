# Gated feature resolution

This record converts the remaining broad gates into concrete implementation
decisions. Provider and professional-review gates remain fail-closed; no visible
control may imply that an unavailable provider is connected.

The configuration model and competitor-informed rationale are recorded in
[Accounting workflow configuration decisions](ACCOUNTING_WORKFLOW_CONFIGURATION_DECISIONS.md).

## Fixed assets

The provider-independent safe boundary is delivered:

- tenant-scoped asset classes and a register with manual source references,
  in-service date, cost, residual value, useful life, audit history, versioning,
  and account-mapping validation;
- class defaults copied onto each asset so later class edits do not rewrite the
  asset's inputs; and
- deterministic non-posting previews for `NONE` and straight-line book
  depreciation using full-month or next-month conventions.

`REGISTERED` means register-only: it does not create a depreciation batch or
journal. Draft depreciation batches, asset roll-forward reporting, disposal,
trade-ins, and attachments remain future work.

Required authorized-review decisions before journal generation (owner, administrator,
or accountant under the current permission model; professional review is recommended):

1. supported methods and conventions, including partial first/last periods;
2. capitalization thresholds and treatment of tax/recoverable tax;
3. asset, accumulated-depreciation, depreciation-expense, and disposal
   gain/loss mappings;
4. method-change policy and prior-period correction handling; and
5. disposal and trade-in treatment.

The application must never rewrite posted depreciation. Approved corrections
use the existing reversal/adjustment workflow.

Book depreciation is not Canadian capital cost allowance. CCA classes, tax
treatment, additions, dispositions, and special rules remain a separate
professional-review gate; no organization setting enables CCA or tax posting.

## Progress billing, deposits, and retainers

The provider-independent safe boundary is delivered:

- explicitly classified, non-posting deposit requests;
- deterministic progress plans tied to accepted estimate snapshots, with
  milestone and estimate-line net/tax/total reconciliation; and
- guarded submit/approve/reject/cancel lifecycles with audit and idempotency
  evidence.

Approval does not receive money, recognize tax, create an invoice, apply a
deposit, or create a journal. Holdback/retainage remains disabled.

Required authorized-review decisions before posting (owner, administrator, or
accountant under the current permission model; professional review is recommended):

1. deposit/retainer liability account and whether separate accounts are needed;
2. GST/HST/PST/QST recognition timing for each supported transaction;
3. application ordering across subtotal, tax, and invoice balances;
4. cancellation, forfeiture, refund, and chargeback treatment; and
5. final-invoice and credit-note correction examples.

Acceptance requires reconciliation across cash, accounts receivable, the
liability account, revenue, tax, payments, and customer statements.

## Live Canadian bank feeds

The provider-neutral adapter and file-import fallback already exist. Production
activation requires:

- an approved Canadian aggregation provider and sandbox credentials;
- privacy, consent, retention, residency, and provider-terms review;
- per-connection pricing and an owner for usage costs;
- hosted consent, reconnect, disconnect, outage, and deletion evidence; and
- fixtures for duplicate identities and pending-to-posted transitions.

Until those items are approved, CSV/OFX/QFX remains the supported path and the
live adapter stays disabled.

## Native payroll and provider fallback

The former provider-only payroll boundary is superseded by
[ADR 006](../../adr/006-native-payroll-boundary.md) and the
[native payroll implementation program](../PAYROLL_IMPLEMENTATION_PROGRAM_2026-08-03.md).
ClearLedger now has a tenant-scoped native payroll data model, exact-money service,
permissions, immutable calculation/accounting foundation, and independently authored
CA-AB 2026 statutory-calculation vectors. This foundation is not yet a public-beta
feature claim because complete routes, user interface, correction/reporting journeys,
security review, and the program acceptance matrix still have to pass together.

The first releasable native scope is Alberta employment paid in CAD using the exact
named 2026 rule pack. Direct deposit, CRA filing/remittance, ROE/T4 submission, Quebec,
other provinces, U.S. payroll, and unsupported earnings or deductions remain
fail-closed. Those capabilities require their own current jurisdiction evidence,
credentials or partner contracts, operational monitoring, and release acceptance.

Provider summary import remains a bounded migration, comparison, historical/YTD, and
outage fallback. It accepts redacted aggregate evidence and must create a balanced,
reviewable draft with stable provider/run identifiers and correction/replay controls;
it never silently becomes the authority for a native calculation. Employee bank
details, government identifiers, and raw payslips are not required for that fallback.

## Optional OCR

The manual evidence inbox, original-file retention, scanning, duplicate hash,
and human review path are implemented. OCR activation requires:

- provider selection or an approved self-hosted model;
- data-processing/privacy review and retention limits;
- credentials, cost limits, per-organization usage measurement, and outage
  behavior;
- field-level confidence and total/tax consistency thresholds; and
- deterministic fixtures proving that low-confidence output remains a
  suggestion.

Provider failure must leave the file available for manual review.

## Mobile packaging

The installable progressive web app shell is delivered using the same review
and authorization controls as desktop. Offline behavior is limited to the
static application shell and a data-free fallback; financial mutations require
a live authenticated API response.

Native Android/iOS distribution remains a separate Phase 25 gate requiring:

- signing identities and protected signing-key storage;
- store accounts, privacy disclosures, screenshots, and release ownership;
- device-level secure-storage and deep-link decisions; and
- emulator/device evidence for authentication, file/camera permissions,
  upgrade, rollback, and data removal.

## Next decision package

The owner can unblock implementation by supplying:

1. an accountant-approved deposit/progress-billing posting and tax memo;
2. an accountant-approved book-depreciation, mapping, correction, and CCA
   boundary memo;
3. the preferred Canadian bank-feed provider;
4. the preferred payroll provider plus a redacted sample export;
5. the preferred OCR approach and monthly cost ceiling; and
6. whether native store distribution is required after PWA testing.
