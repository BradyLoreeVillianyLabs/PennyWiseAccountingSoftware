# Phase 9 Completion Report

## 1. Phase Result

**PASS.** Perpetual weighted-average inventory, locations, receipts, sales
depletion, customer and vendor returns, adjustments, write-offs, transfers,
inventory reporting, control-account reconciliation, permissions, tenant
isolation, database invariants, concurrency controls, and the minimal browser
workflow are complete. Phase 10 has not begun.

## 2. Materially Changed Files

- Domain and API: `apps/api/src/app.ts`,
  `apps/api/src/services/inventory-service.ts`,
  `apps/api/src/services/invoice-service.ts`,
  `apps/api/src/services/invoice-calculation.ts`,
  `apps/api/src/services/purchase-service.ts`,
  `apps/api/src/services/purchase-calculation.ts`,
  `apps/api/src/services/product-service.ts`,
  `apps/api/src/services/journal-service.ts`,
  `apps/api/src/services/idempotency-service.ts`,
  `apps/api/src/http/schemas.ts`, and `apps/api/src/auth/permissions.ts`
- Valuation core: `packages/accounting-core/src/inventory-valuation.ts` and
  `packages/accounting-core/src/index.ts`
- Tests: `packages/accounting-core/src/inventory-valuation.test.ts` and
  `apps/api/src/phase9-inventory.integration.test.ts`
- Database: `packages/db/prisma/schema.prisma` and
  `packages/db/prisma/migrations/20260725010000_phase_9_inventory/`
- Web: `apps/web/index.html`, `apps/web/app.js`, and
  `apps/web/scripts/verify-assets.mjs`
- Documentation: `docs/ACCOUNTING_POSTING_RULES.md`,
  `docs/PERMISSION_MATRIX.md`, `docs/API_GUIDELINES.md`,
  `docs/status/CURRENT_PHASE.md`, and this report

## 3. Migration

`20260725010000_phase_9_inventory` is migration 31. It adds inventory enums,
locations, balances, append-only movements, product and source-line
configuration, RLS, grants, constraints, deferred projection checks, source and
journal-shape validation, transfer-pair validation, and immutability triggers.
All 31 migrations deployed on the empty `clearledger_phase9_clean` database;
Prisma reported the schema current. All 31 checked-in `down.sql` files passed
rollback verification on `clearledger_rollback_verify_phase9_closeout`.

## 4. Final Test Counts

- Unit: 37 Vitest tests passed, including 5 inventory valuation tests with 200
  generated receipt/depletion sequences; the Phase 9 web asset verifier passed.
- Integration: 101 PostgreSQL-backed tests passed across 8 files, including 14
  Phase 9 end-to-end scenarios.
- Formatting, ESLint, TypeScript, Prisma validation, Prisma Client generation,
  clean migration deployment, build, and rollback verification passed.

## 5. Valuation Algorithm And Rounding Policy

Quantity is an integer count of millionths; money is integer minor units.
Weighted-average carrying value is maintained per product and location as exact
quantity and total value. Receipt value and proportional depletion use integer
half-up ratio rounding. Full depletion takes the exact residual carrying value,
so zero quantity always has zero value. Maximum quantity and value bounds are
checked before persistence; floating point is never used.

## 6. Posting Rules

- Purchase receipt: debit Inventory Asset and credit Purchase Clearing for net
  acquisition cost plus non-recoverable tax; partial receipts are capped and
  the final receipt takes the exact remaining bill-line value.
- Sale: debit Cost of Goods Sold and credit Inventory Asset at carrying value.
  Insufficient stock rolls back the invoice, journals, movements, audit, outbox,
  and idempotency state.
- Customer restock: debit Inventory Asset and credit Cost of Goods Sold at the
  exact original sale cost. A write-off then debits Inventory Loss and credits
  Inventory Asset for that same cost.
- Vendor return: debit Purchase Clearing and credit Inventory Asset at current
  weighted-average cost.
- Increase/opening adjustment: debit Inventory Asset and credit configured
  Adjustment Gain or equity account. Decreases, damage, theft, and spoilage
  debit Inventory Loss and credit Inventory Asset.
- Transfer: append equal and opposite quantity/value movements atomically with
  no revenue, expense, gain, loss, or journal.

## 7. Concurrency Controls

Product rows and affected balance rows are locked before valuation changes.
Fiscal periods are share-locked while movements post and exclusively locked
during close. Serializable idempotent operations retry bounded PostgreSQL
serialization conflicts and deadlocks. Database uniqueness protects event
identity, posting keys, exact reversals, transfer pairs, journal ownership, and
organization-scoped location codes. Tests prove simultaneous last-unit sales
cannot oversell, duplicate adjustment requests create one movement, close/post
races remain consistent, and duplicate location codes produce one winner.

## 8. Unresolved Risks

- MVP valuation is weighted average only; FIFO, specific identification,
  lot/serial tracking, landed-cost allocation, manufacturing, and multi-currency
  inventory are out of scope.
- Quantity available currently equals quantity on hand. Reservations,
  commitments, in-transit states, and autonomous replenishment are deferred.
- Vendor returns use carrying value; differences from the commercial credit
  remain visible in Purchase Clearing and require normal reconciliation.
- The browser workflow is intentionally compact and uses posted source-line IDs
  for receipts and returns. Rich source-document pickers are deferred.
- Production-volume inventory history, report, and lock-contention load testing
  remains for the release-hardening phase.

## 9. Phase 10 Prerequisites

Preserve immutable movements, integer quantity and money arithmetic, exact
reversals, product/balance locking, fiscal-period locking, RLS, tenant filters,
and the inventory-to-control-account reconciliation. Phase 10 reports must
derive historical inventory and cost-of-goods values from append-only movements
and posted journals, surface discrepancies rather than hiding them, and add no
new posting paths. Dashboard summaries must remain drillable to tenant-scoped
source evidence.
