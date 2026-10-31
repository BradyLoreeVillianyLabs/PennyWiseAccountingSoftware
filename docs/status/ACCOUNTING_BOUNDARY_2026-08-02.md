# Accounting boundary verification

Date: 2026-08-02

Status: OWNER-ACCEPTED ENGINEERING PASS; LIVE-PROVIDER EVIDENCE GATED

## Owner authorization and representation

The project owner directed ClearLedger to complete and verify the software
accounting boundary and removed the mandatory accountant-signature gate in
favor of passing test evidence. The owner reports active review and advice from
professional accountants plus product-workflow input from a former Intuit
employee. This report records engineering evidence and that advisory context;
it is not tax/legal advice, a named professional attestation, an Intuit
endorsement, or WooCommerce/Etsy provider approval.

## Verified released boundary

- CAD is the base and financial-statement currency; CAD and USD are the
  released transaction currencies.
- Supported domain workflows post USD invoices, customer receipts, bills, and
  bill payments through exact immutable rate snapshots, monetary positions,
  realized FX, closing revaluation, and automatic next-period reversal.
- Foreign manual journals, unsupported currencies, missing closing rates, and
  cross-tenant currency references fail closed.
- WooCommerce and Etsy ingestion retains exact provider evidence, applies
  versioned mappings, detects replay/conflict conditions, and creates zero
  accounting entries while posting approval and live order-to-payout evidence
  remain absent.
- Organization bootstrap now uses non-returning inserts for the organization
  and initial owner membership. This preserves forced RLS while allowing the
  membership-access trigger to establish the first tenant locator before the
  records are read.
- Concurrent development/demo authentication now handles every normalized
  email uniqueness guard without weakening the database constraint.

## Fresh acceptance evidence

The following database-backed suites passed together against the isolated test
database on 2026-08-02:

- identity and tenant isolation: 22 tests;
- deterministic fictional demo company: 4 tests;
- CAD/USD accounting release: 2 tests;
- CAD/USD safety boundary: 2 tests;
- native commerce connector boundary: 3 tests; and
- commerce inbox boundary: 2 tests.

Result: 6 files and 35 tests passed. The evidence includes concurrent
organization creation, cross-instance fixture reuse, forced-RLS isolation,
balanced CAD/USD journals, foreign-cash positions, realized FX, revaluation and
reversal, replay-safe commerce ingestion, multi-store mapping, and the explicit
assertion that shadow connector activity creates no journals, invoices,
payments, or inventory movements.

The complete repository gate subsequently passed formatting, lint, TypeScript,
Prisma validation, 113 package/application tests, all 27 integration files with
175 PostgreSQL-backed tests, and every build. The release browser flow passed
all 7 applicable cases across Chrome, Edge, Firefox, mobile Chrome, and mobile
WebKit; 8 non-primary-project cases are intentionally skipped by the matrix.
Accessibility, release traceability, hygiene, browser performance, first-company
setup, and deterministic fictional demo creation all passed.

## Remaining organization and provider responsibilities

The following items remain outside an engineering self-approval:

1. The organization owner must confirm the entity-specific functional
   currency, rate hierarchy, GST/HST timing, foreign-cash FIFO policy,
   correction/refund treatment, deposits, bad debt, and close policy before
   real books are migrated. Professional review remains recommended and is
   already being used as advisory input according to the owner.
2. WooCommerce posting needs a named test store plus the actual payment gateway
   or settlement source because WooCommerce core does not expose universal fee
   and payout evidence.
3. Etsy posting needs an approved test app/shop and live receipt, payment,
   ledger-entry, payout, and bank-deposit reconciliation evidence.
4. Automatic commerce posting remains disabled until every provider/currency
   clearing balance reconciles to zero or an explained outstanding item and an
   actual bank deposit is proven not to be new revenue.

The CAD/USD accountant-signature gate is lifted. The remaining provider gates
protect the accounting books and must not be replaced with invented credentials
or simulated live evidence. The safe engineering boundary is ready for a
controlled live parallel close.
