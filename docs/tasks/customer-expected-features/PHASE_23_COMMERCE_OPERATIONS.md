# Phase 23 Codex Task — Commerce Operations

Execute only after Phase 22 acceptance, beta evidence from product businesses,
and explicit owner authorization.

## Objective

Add the operational documents product sellers expect—purchase orders, sales
orders, receiving, fulfilment, barcodes, and ecommerce synchronization—without
turning ClearLedger into manufacturing, warehouse, POS, or storefront software.

## Domain rules

- Purchase orders and sales orders are non-posting commitments.
- Receiving inventory uses the existing inventory receipt/valuation service.
  Vendor bills use the existing payables service. One may reference the other
  but neither duplicates the other's accounting event.
- Fulfilment reserves/releases available quantity. Shipment does not recognize
  revenue or COGS unless the existing approved invoice/posting policy explicitly
  performs those events.
- Partial receive/fulfil/convert operations must be quantity bounded,
  idempotent, and traceable.
- External orders first enter a mapped review state. Connector replay must not
  duplicate customer, item, tax, invoice, payment, or inventory movement.

## Requirements

- Purchase order lifecycle: draft, approve, send, acknowledge, partially/fully
  receive, close/cancel, vendor bill matching, landed note attachments, and
  open-order reporting.
- Sales order lifecycle: draft/import, confirm, reserve, partial fulfil, back
  order, cancel, convert to invoice, return linkage, packing slip, and status.
- Barcode aliases for items and locations, camera/scanner keyboard input,
  receiving/count/lookup workflows, duplicate validation, and printable labels.
- Provider-neutral commerce connector using Phase 22 contracts. Implement only
  the approved first platform, with Shopify as the default candidate if demand
  supports it.
- Map taxes, discounts, shipping, tips, refunds, payment clearing, fees,
  customers, SKUs, locations, and order status explicitly. Unmapped data goes to
  review, never to guessed posting.
- Add stock availability and oversell conflict rules with visible source of
  truth. Avoid claiming real-time synchronization unless measured.

## Non-goals

No manufacturing, BOM, work orders, lot/serial tracking, advanced warehouse
waves, landed-cost allocation engine, POS hardware integration, full storefront,
shipping-rate marketplace, or autonomous tax mapping.

## Tests and acceptance

- State, quantity invariant, partial-operation, concurrency, cancellation,
  conversion, replay, and correction tests.
- PO receipt/bill and SO fulfilment/invoice paths proving inventory, AP/AR,
  revenue, tax, COGS, returns, and control accounts reconcile exactly once.
- Barcode collision, input hardening, mobile scanner, and accessibility tests.
- Connector contract and sandbox tests for backfill, webhooks, status loops,
  refunds, edits, unknown SKU/tax, rate limits, and reconnect.
- Cross-tenant location/item/order adversarial tests.

Acceptance requires exact-once accounting effects under replay, deterministic
partial quantities, visible review of unmapped commerce data, and no excluded
warehouse/manufacturing scope.

Write the Phase 23 completion report, update current phase, and stop.
