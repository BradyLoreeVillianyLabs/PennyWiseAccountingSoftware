# Phase 7 Completion Report

## Result

**PASS.** Vendors, bills, immediate expenses, bill payments, vendor credits,
secure purchase attachments, accounts-payable aging/reconciliation, the minimal
web workflow, and all Phase 7 verification are complete.

## Material Changes

- Added the `Vendor`, `Bill`, `BillLine`, `BillPayment`,
  `BillPaymentAllocation`, `VendorCredit`, `VendorCreditLine`,
  `VendorCreditApplication`, `ImmediateExpense`, `ImmediateExpenseLine`, and
  `PurchaseAttachment` models and API/UI workflows.
- Added deterministic inclusive/exclusive purchase-tax calculation with
  recoverable and non-recoverable component snapshots.
- Added purchasing permissions, recent-authentication enforcement, audit/outbox
  events, idempotent financial mutations, secure attachment adapters, AP aging,
  vendor balances, and GL reconciliation.
- Added PostgreSQL RLS, tenant-reference checks, posted-history protection,
  settlement projections, document-total checks, allocation ceilings, and
  direct-database negative tests.

## Migration

`20260724100000_phase_7_purchasing` is migration 29. It deploys from a clean
database and its `down.sql` passed both rollback-verification cycles with all 29
repository migrations.

## Tests

- Unit: 26 Vitest tests plus the Phase 7 web asset verification.
- Integration: 79 PostgreSQL-backed tests, including 9 Phase 7 tests.
- Phase 7 covers exact tax journals, draft isolation, duplicate identifiers,
  closed periods, permissions, RLS, immutable history, idempotency mismatch,
  simultaneous posting/payment/reversal, direct allocation and projection
  attacks, AP reconciliation, credits, immediate-expense reversal, and
  attachment spoofing/scanning/isolation.

## Posting And Allocation Rules

- Bill: debit expense/asset for net plus non-recoverable tax, debit configured
  recoverable-tax assets, credit AP for gross. Inventory accounts create no
  quantity or valuation movements.
- Immediate expense: the same debits, with credit to the selected cash, asset,
  liability, or owner account. Duplicate references return a warning.
- Bill payment: debit AP and credit the selected paying account. Allocations are
  positive, fully equal the payment, tenant/vendor consistent, and cannot exceed
  locked bill balances.
- Vendor credit: debit AP; credit original expense/asset basis and recoverable
  tax. Posting affects AP once; applications only connect available credit to
  eligible bills.
- Reversals create exact inverse journals and preserve original records.

## Attachment Controls

Files are limited to 10 MiB and an allow-list, verified by byte signature,
scanned through an adapter, stored under organization/document keys, retained
append-only, permission checked, tenant isolated, and downloaded with
`nosniff`, sandbox, no-store, and attachment disposition headers.

## Unresolved Risks

- Recurring bills are deferred post-MVP.
- Vendor cash refunds, bill voiding, and voiding an unapplied vendor credit need
  explicit future workflows; direct mutation remains blocked.
- Production object storage and malware scanning still require deployed
  adapters. Development storage may leave an orphaned object if the subsequent
  database insert fails.
- The Phase 7 UI intentionally supports one line per form; the API supports
  multi-line documents and multi-bill allocations.

## Phase 8 Prerequisites

Preserve all 29 migrations and AP invariants. Phase 8 must define bank-account
ownership, import idempotency, transfer pairing, clearing-account treatment,
matching concurrency, and reconciliation-close controls before implementation.
