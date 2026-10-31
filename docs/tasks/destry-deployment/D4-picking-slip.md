# D4 — Picking slip with product images

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `apps/api/src/services/invoice-render-service.ts`,
   `invoice-document-service.ts`, `invoice-template-service.ts`
4. `packages/db/prisma/schema.prisma` — `ProductItem.productImageReference`,
   `CatalogImageReference`, `InventoryLabelTemplate`, `ProductBarcode`,
   inventory location and bin models
5. `docs/ADVANCED_INVENTORY.md`
6. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — inventory entry

## Exact intention

Someone has to walk into a small warehouse and come back with the right garment in
the right size and colour. Right now PennyWise gives them nothing to walk in with.

Produce a picking slip for a sale: what to pick, how many, where it is, and — for
apparel where a size 8 and a size 10 in the same colourway look identical on a
shelf — a picture of it. Order the slip by bin so the walk is efficient rather than
alphabetical, and print a barcode so the pick can be scan-verified instead of
eyeballed.

The image is the part that needs real thought. `CatalogImageReference` currently
stores a remote URL, a hash and dimensions — a pointer to an image on the store,
not the image. A picking slip that fetches from `destryworkwear.com` at print time
fails the moment the warehouse network does, and PennyWise is otherwise a local,
loopback-first application that works offline. The ingestion enum already
anticipates this with an `INGESTED` state. Finish that path.

## Boundary conditions

- A picking slip is an operational document, not an accounting record. It posts
  nothing, changes no quantity, and never appears in a ledger report.
- Printing is local. The document renders to PDF through the existing pdfkit
  pipeline; the browser prints it. No print server, no cloud service.
- Only approved images are stored. Honour the existing
  `OBSERVED → APPROVED → REJECTED → INGESTED` review flow — ingestion follows human
  approval, never precedes it.
- Respect the existing image bounds: 5 MiB, 4,096 px per axis, 16,777,216 px total.
  Store a thumbnail sized for print, not the original.
- Slips must render correctly with no image at all. Images are an aid, never a
  dependency — manually created products will not have one.
- Reprinting is always allowed and always leaves a trace.

## Build order

1. **Local image ingestion.** Complete the `INGESTED` path: for an approved catalog
   image, fetch once, validate type and bounds, generate and store a print-sized
   thumbnail in the existing document store, and record the link on the product.
   Re-ingestion is idempotent by URL hash. A failed fetch leaves the prior state
   untouched and is retryable.
2. **Manual product images.** A product created by hand — which the owner will do
   as the range grows — can have an image uploaded directly, through the same
   validation and the same storage. Channel-sourced and hand-made products must
   behave identically downstream.
3. **Picking slip document.** A new document type on the existing renderer, with a
   template following the established pattern. Per line: thumbnail, product name,
   the variant attributes that distinguish it (size, colour), SKU, barcode,
   quantity to pick, and bin. Header carries the order reference, date, and customer
   name. Leave a check column — people tick things.
4. **Bin ordering.** Sort lines by location and bin so the pick follows the
   warehouse rather than the invoice. Where an item has no bin, group it clearly at
   the end rather than hiding it.
5. **Generation and reprint.** Generate from a sale or invoice; keep a record of
   each generation with who and when. Support reprint without creating a duplicate
   document identity.
6. **Short picks.** The picker will sometimes not find everything. Give them a way
   to record what was actually picked, and surface a shortfall as an inventory
   review item using the existing count and adjustment workflows — never as an
   automatic quantity change.

## Acceptance

- A slip generated from a multi-line sale prints one page per reasonable order,
  ordered by bin, with a legible thumbnail and a scannable barcode per line.
- A product with no image renders a clean slip with no gap or broken placeholder.
- Image ingestion is idempotent, bounded, and follows approval; an unapproved image
  is never stored.
- Reprints are traceable and do not duplicate the document.
- A recorded short pick produces an inventory review item and changes no quantity
  by itself.
- Full quality gate passes, including the accessibility contracts for any new
  screen and `corepack pnpm test:research`.

## Out of scope

Packing slips for the customer, and anything that goes in the box. Shipping labels
and carriers — D5. Wave or batch picking across multiple orders. Handheld scanner
hardware integration beyond the existing barcode field.
