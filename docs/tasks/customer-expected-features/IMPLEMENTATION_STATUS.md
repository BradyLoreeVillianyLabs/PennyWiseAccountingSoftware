# Customer-expected features implementation status

This increment implements the highest-demand, provider-independent workflows from the delivery order.

## Delivered

- Four audience-profile presets (`SOLO_SERVICE`, `PROJECT_TRADES`,
  `BOOKKEEPER_MANAGED`, and `PRODUCT_OPERATIONS`) that seed workflow visibility
  once, remain owner/admin editable, and are not overwritten after
  customization.
- Workflow preferences for cash planning, purchase requests, customer deposits,
  progress billing, and the fixed-asset register. The legacy payroll-summary flag is
  forced off and hidden because it has no implemented importer.
  Automatic posting, bank-import review, OCR review, and holdbacks remain
  immutable safeguards rather than editable preferences.
- Recurring invoice planning records in Sales, including cadence, start/end dates,
  customer selection, template JSON, and pause/resume controls. No background scheduler
  or automatic invoice creation is implemented.
- Project and field-work workspace with project budgets, time entries, mileage drafts, project status controls, and activity review.
- Binary capture upload with file-name normalization, media-type/signature/structure
  checks, malware-scanner adapter support, SHA-256 checksums, tenant-scoped storage, and
  review status. The local beta has no real malware-scanning provider.
- Evidence inbox in Purchases for reviewing uploaded receipts and bills before accounting treatment.
- Tenant-authenticated capture download for evidence inspection.
- Tenant-safe JSON DTOs for project and capture endpoints, including string serialization for money values.
- OpenAPI and integration coverage for capture listing and real binary upload.
- Versioned weekly/monthly budgets with posted budget-versus-actual reporting.
- Source-labelled 13-week cash forecasts using ledger cash, open invoices,
  open bills, and explicit owner assumptions.
- Non-posting purchase request drafts with submit, approve, reject, and cancel
  transitions, tenant-scoped authorization, and audit history. A positive
  threshold automatically approves only requests strictly below it; zero and
  requests at or above the threshold require authorized approval.
- Explicitly classified customer deposit requests and accepted-estimate
  progress plans with deterministic milestone/line reconciliation. Approval is
  non-posting: it does not receive money, recognize tax, create an invoice, or
  create a journal.
- Tenant-scoped fixed-asset classes and register lifecycle with copied class
  defaults, manual provenance, account-mapping validation, and deterministic
  `NONE` or straight-line book-depreciation previews. Registration remains
  non-posting. The role-aware workspace freezes registered assets and keeps
  depreciation visibly preview-only.
- Forced row-level security, authenticated actor-provenance checks, and
  database reconciliation constraints protect the new workflow records;
  registered fixed-asset rows are immutable.
- Installable PWA shell with a data-free offline fallback. Organization and
  financial data are not cached for offline mutation or replay.

## Deliberately gated

Journal posting for deposits, progress billing, and fixed assets; Canadian tax
and CCA treatment; provider-specific bank feeds, production OCR, payment
processors; native app-store packaging; and production email/SMS remain gated
by missing accounting evidence, credentials, contracts, legal review, or
release infrastructure. Native payroll supersedes the earlier provider-only
boundary: its schema, service, permissions, and CA-AB 2026 calculation
foundation exist, while complete routes/UI/corrections/reports and the exact
acceptance matrix remain required before any public feature claim. Direct
deposit and government filing/remittance remain separate external gates. Under
the 2026-08-02 owner decision, accountant review is recommended but is not
itself a mandatory software gate. No workflow preference silently enables an
unfinished capability.

The exact decisions and evidence needed to unlock those remaining boundaries
are recorded in [Gated feature resolution](GATED_FEATURE_RESOLUTION.md). The
product and accounting rationale is in
[Accounting workflow configuration decisions](ACCOUNTING_WORKFLOW_CONFIGURATION_DECISIONS.md).

## Verification

Verification covers workflow-preference and approval-threshold integration,
non-posting deposit/progress workflows, fixed-asset tenancy and lifecycle,
deterministic depreciation calculations, and the installable/offline-safe PWA
asset contract, in addition to formatting, lint, and TypeScript checks.
