# Advanced inventory

ClearLedger's inventory path is a company-scoped, append-only movement ledger. Balances are projections of those movements; users never edit an on-hand quantity directly. Every quantity-changing command requires an idempotency key, runs inside the existing tenant transaction, and uses the existing journal service when a movement has an accounting consequence.

## Supported workflows

- Locations, bins, and configurable inventory statuses (`sellable` and `allocatable` flags)
- Posted bill receipts, customer/vendor returns, adjustments, and the existing direct transfer path
- Reservations with expiry, release, and fulfillment
- Two-stage transfer orders (`DRAFT -> APPROVED -> SHIPPED -> PARTIALLY_RECEIVED/RECEIVED`) with partial quantities and source/destination locations
- Lots and serial registration (leading-zero identifiers are preserved)
- Cycle counts with a snapshot, blind-count option, counted lines, and approval movements
- Moving weighted-average valuation, cost-of-goods reporting, inventory-to-GL reconciliation, low-stock and reorder suggestions
- Tenant-scoped barcode aliases with collision-safe registration, exact scan resolution, and primary-code selection
- Versioned label templates with exact field selection and preview-only rendering; printer/device delivery remains an explicit adapter gate
- Local product-image thumbnails and bin-ordered picking slips generated from posted invoices or completed sales
- Short-pick review records linked to inventory counts without an automatic quantity or ledger change

## Quantity definitions

`on hand` is the signed movement projection at a location. `reserved` is the sum of active, unexpired reservations. `available` is on hand less active reservations. Transfer shipments leave the source on-hand and remain visible through the transfer order until destination receipt. Count approval creates explicit adjustment movements; it never overwrites a balance.

## Accounting and safety boundaries

Inventory uses company and organization context on every read and write, plus database RLS. Product costing is locked after the first movement. Posted movements are immutable and corrections use reversal or replacement movements. Direct internal transfers suppress revenue/COGS journals; purchase receipts, sale fulfillment, returns, and adjustments continue through `JournalService`. Cross-company references, closed periods, insufficient stock, stale workflow state, and idempotency-key reuse fail closed.

The current release intentionally does not post unfinished FIFO, landed-cost allocation, or kit/assembly workflows. Their capability status is exposed as `SCAFFOLD_ONLY` so clients cannot present them as available. Barcode aliases and label previews are now implemented through `ProductBarcode` and `InventoryLabelTemplate`; they never create inventory movements, change on-hand quantities, or bypass product identity. Camera integrations send a `CAMERA` scan payload to the exact resolve endpoint; no browser camera permission or printer side effect is implied by that protocol.

## API surface

The UI uses these routes:

`/v1/inventory/bins`, `/v1/inventory/statuses`, `/v1/inventory/lots`, `/v1/inventory/serials`, `/v1/inventory/reservations`, `/v1/inventory/transfer-orders`, `/v1/inventory/counts`, `/v1/inventory/reports/reorder-suggestions`, `/v1/inventory/barcodes`, `/v1/inventory/scans/resolve`, `/v1/inventory/label-templates`, `/v1/inventory/label-templates/:templateId/preview`, `/v1/inventory/capabilities`, `/v1/products/:productId/image`, `/v1/invoices/:invoiceId/picking-slip`, `/v1/pos/sales/:saleId/picking-slip`, and `/v1/picking-slips/:pickingSlipId` with its `pdf`, `reprint`, and `short-pick` actions.

## Barcode and label interaction contract

1. A barcode registration retains the supplied source code and stores a canonical comparison key. The organization-wide canonical key is unique, so a scan cannot silently select between two products.
2. A scan resolves an active registered alias first, then an exact normalized product GTIN. Ambiguous GTIN matches fail closed. `captureMode` is `MANUAL`, `HARDWARE`, or `CAMERA`; the response includes `RESOLVE_PAYLOAD_V1` for a future device adapter.
3. A label template is tenant/company scoped, has positive dimensions in micrometres, and declares only known fields. Preview returns deterministic elements and `PREVIEW_ONLY`; a printer is not invoked.

**Focused acceptance:** `apps/api/src/inventory-barcode-api-contract.test.ts` covers punctuation normalization, camera payload contract, deterministic label preview, and explicit FIFO/landed-cost/kit capability gates. Integration coverage must additionally exercise the database migration, RLS, barcode uniqueness, and cross-tenant resolution before printer or camera adapters are enabled.

## Picking slips and product-image interaction contract

1. A catalog image remains `OBSERVED` or `APPROVED` evidence until an authorized
   ingestion request fetches it once, validates the bounded media, and stores only a
   local JPEG thumbnail. The limits are 5 MiB, 4,096 pixels per axis, and 16,777,216
   pixels total. Re-ingestion is keyed by the catalog URL hash; an unapproved image
   is never persisted as a product asset.
2. Manual product images use the same limits and thumbnail path. Picking-slip rendering
   reads the local product reference only, so a warehouse can render and print without
   reaching a provider. Products without an image render as ordinary item rows.
3. One picking slip is stable per posted invoice or completed POS sale. Its lines are
   snapshots of product identity, variant attributes, SKU, barcode, quantity, location,
   bin, and image asset. Lines sort by location, bin priority, and bin code; unassigned
   bins appear last. A reprint adds a generation record and retains the same slip ID.
4. A short pick records the picked quantity and creates a released inventory-count
   review item for the shorted product. It does not adjust on-hand, create a movement,
   post accounting, or silently fulfill the missing quantity.

**Focused acceptance:** `apps/api/src/phase-d4-picking-slip.integration.test.ts` covers
posted-invoice generation, local PDF retrieval, traceable reprint, short-pick review
with unchanged stock, and idempotent manual thumbnail upload. The renderer unit test
also covers image/no-image rows and Code 128 module generation. Browser printing is a
local operator action over the inline PDF response; printer hardware is not invoked.

The legacy direct-transfer endpoint remains available for compatibility. New operational flows should use transfer orders so shipment and receipt are separately attributable.
