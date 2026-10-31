# U4 — Inventory, POS and multi-company operations UI

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Files:** `apps/web/app.js`, `apps/web/index.html`, `apps/web/styles.css`
**Closes:** the operations row in `ASSESSMENT.md` section 3
**Effort:** L. Split it into three sessions: inventory, POS and shipping, then
multi-company.
**Depends on:** nothing.

## Context — routes with no UI (`evidence/route-diff-v2.txt`)

- **Inventory:**
  - Barcodes: `GET/POST /v1/inventory/barcodes`, `POST …/:id/deactivate`
  - Scans: `POST /v1/inventory/scans/resolve`
  - Label templates: list, create, `POST …/:id/preview`
  - Lots: `GET/POST /v1/inventory/lots`; serials: `POST /v1/inventory/serials`
  - Reservations: `POST …/reservations/:id/release|fulfill`
  - Transfer orders: `POST …/transfer-orders/:id/:action`
  - Counts: `PATCH …/count-lines/:id`, `POST …/counts/:id/approve`
  - Reports: `GET …/reports/valuation`, `GET …/reports/customs-readiness`
  - Other: `GET …/capabilities`, and `POST …/inventory-sync/policies/:id/observations`
- **Customers:** `GET /v1/customers/reports/address-review`
- **POS:**
  - Devices: `GET/POST /v1/pos/devices`
  - Shifts: `POST …/shifts/:id/cash-events`, `POST …/shifts/:id/approve-variance`
  - Sales: `GET …/sales/:id`, `POST …/sales/:id/picking-slip`, `POST …/sales/:id/shipment`
- **Fulfilment:** `GET /v1/picking-slips/:id`, and
  `POST /v1/shipping/carrier-accounts/:id/deactivate`
- **Multi-company:**
  - Intercompany transactions: list, create, transition
  - Consolidation groups: list, create

## Priority

Destry Workwear (a WooCommerce apparel brand with size/colour variants that ships physical
goods) is the live deployment. Build these first:

1. Barcodes and scan resolve.
2. Count entry and approval.
3. Valuation report.
4. Reservations release and fulfil.
5. Customs-readiness and address-review reports.
6. POS cash events and variance approval.

Lots and serials, label templates, and multi-company come after.

## Tasks

1. **Scan-first inventory.**
   - A scan field that resolves through `scans/resolve` to a product or variant and
     location, then offers count, receive, transfer or look-up.
   - Barcode assignment and deactivation on the product/variant detail view.
   - Use a keyboard-wedge scanner as the baseline. Camera scanning only if already
     supported.
2. **Cycle counts:** enter counts per line, show variances, and approve (with a permission
   check). Approval posts through the existing service.
3. **Reports:** valuation and customs readiness, each with a CSV export if the service
   offers one. Address review sits on the customer list.
4. **Reservations:** view, release and fulfil from the order or fulfilment workspace.
5. **POS:**
   - Register devices.
   - Record cash events (float, pay-in, pay-out, drop) during a shift.
   - Show the variance at close, with an approval that requires a reason.
   - Sale detail, with picking-slip and shipment actions.
6. **Carrier accounts:** deactivate, with a confirmation.
7. **Lots and serials; label templates:**
   - Capture lots and serials at receipt, where capabilities say they're enabled.
   - Label-template preview and print.
8. **Multi-company:**
   - Intercompany transactions: create, then move through the transitions the service
     permits.
   - Consolidation groups: create, and list their members.
   - Label these clearly as advanced.

## Constraints

- **Capabilities:** respect `GET /v1/inventory/capabilities`. Hide features an
  organization hasn't enabled; don't show dead controls.
- **Posting:** every quantity or cost change posts through the existing services, with
  idempotency keys.
- **Hardware:** printing uses browser print. No new hardware drivers.

## Acceptance criteria

- **Scan and count (e2e):** scan a barcode → count → approve a variance → the valuation
  report reflects it.
- **POS (e2e):** open a shift → cash events → close with a variance → approve with a
  reason.
- **Reservations (e2e):** a fulfilled reservation reduces available-to-sell, and a released
  one restores it.
- **Existing specs:** the fulfilment and POS e2e specs still pass.
- **Route comparison:** each route listed above is now referenced, or documented as
  API-only with a reason.

## Out of scope

- Hardware drivers.
- Camera barcode libraries.
- Consolidated financial statements, beyond listing groups.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
