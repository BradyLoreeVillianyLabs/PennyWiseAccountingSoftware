# CAD/USD multi-currency completion report

Status: PASS — OWNER TEST-EVIDENCE RULE ACCEPTED

Date: 2026-07-30

## Released engineering scope

- CAD remains the organization base and reporting currency.
- CAD and USD can be enabled together through organization settings.
- Explicit dated manual rates support document, settlement, and closing-rate
  purposes without silent fallback.
- USD customers, vendors, invoices, bills, payments, bank accounts, imported
  bank activity, foreign-cash lots, FIFO disposals, realized foreign exchange,
  period-end revaluation, and next-period reversals are implemented.
- Posted journals preserve transaction-currency amounts and their immutable
  base-currency conversion evidence.
- Accounts receivable, accounts payable, aging, and reporting reconcile in CAD
  while preserving the related USD amounts.
- Invoice previews and rendered invoice documents identify USD explicitly.
- Portable archive version 2 contains the related foreign-exchange evidence.
- Database controls include composite tenant references, row-level-security
  coverage, immutable valuation evidence, posting gates, and deterministic
  transaction locking.

## Validation evidence

- Repository check: formatting, lint, TypeScript, Prisma schema validation, unit
  tests, all 24 integration files with 164 tests, and all builds passed.
- Browser release flow: Chrome, Edge, Firefox, mobile Chrome, and mobile WebKit
  passed.
- Manual walkthrough: a USD 100.00 invoice at 1.370000 posted as CAD 137.00 to
  accounts receivable, with the invoice preview remaining denominated in USD.
- All 68 migration rollback files passed on an isolated disposable database.
- The CAD/USD rollback guard correctly refused to remove the release after USD
  accounting evidence was seeded.

## Acceptance boundary

The project owner authorized the engineering scope and, on 2026-08-02, removed
the mandatory accountant-signature gate in favor of passing acceptance
evidence. No external provider or adapter approval is required to use the
included manual CAD/USD rate workflow. Accountant review remains recommended,
and the application does not represent automated evidence as professional or
tax advice.

Live banking, payroll, OCR, WooCommerce, or Etsy adapters remain separate
releases requiring their applicable provider credentials and terms plus
product, security, legal, and live reconciliation evidence.

## Deliberate safety limits

- Estimates remain CAD-only.
- Unsafe foreign manual journals, direct foreign account transfers, and
  unsupported foreign credit, void, or correction paths remain blocked until
  linked reversal workflows are implemented and approved.
- No production database was migrated by this engineering release.
