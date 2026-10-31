# Supplied QuickBooks Switching Centre prompt

This is the prompt supplied with the 2026-08-06 attachment. The improved,
execution-ready version is in
[`QUICKBOOKS_SWITCHING_CENTRE_IMPORT_PROMPT.md`](./QUICKBOOKS_SWITCHING_CENTRE_IMPORT_PROMPT.md).

You are completing the ClearLedger Switching Centre QuickBooks import feature in the
`ClearLedger-Codex-Ready` repository.

## Goal

- Make QuickBooks import work for both QuickBooks Online and QuickBooks Desktop exports.
- Ensure imported QuickBooks invoices become real ClearLedger invoices with correct invoice line mapping.
- Preserve immutable import provenance and field mapping correctness.

## Context

- The repo already has a CSV-based Switching Centre importer in `apps/api/src/services/data-migration-service.ts`.
- `apps/api/src/app.ts` currently supports `QUICKBOOKS_ONLINE` as an import source.
- The current invoice import type `OUTSTANDING_INVOICES` creates one invoice line only.
- The repo already has CSV header normalization and alias logic.
- The UI is in `apps/web/app.js`. It currently exposes QuickBooks Online guidance and import templates.
- Documentation is in `docs/MIGRATION_AND_PORTABILITY.md` and `docs/API_GUIDELINES.md`.
- Current tests live in `apps/api/src/phase12-portability.integration.test.ts`.

## Requirements

1. Maintain the existing import workflow:

   - `upload`
   - `preview`
   - `dry run`
   - `commit`
   - `acknowledge/reconciliation`

2. Support both QuickBooks sources:

   - keep `QUICKBOOKS_ONLINE`
   - add explicit `QUICKBOOKS_DESKTOP`
   - preserve `sourceSystem` in `dataImportBatch`
   - reject identical file contents uploaded with a different `sourceSystem` using `IMPORT_SOURCE_MISMATCH`

3. Extend invoice import capability:

   - support line-item invoice imports, not just a single description/amount
   - preserve:
     - `customer_number` / customer identifier
     - `issue_date`
     - `due_date`
     - `external_id` / invoice number
     - `description` / memo
     - line item `sku` / product identifier
     - line item `quantity`
     - line item `unit_price_minor`
     - line item `amount_minor`
     - line item `tax_amount_minor` / `tax_amount` where available
     - line item `discount_amount_minor` / `discount_amount` where available
     - payment terms / terms if present
   - keep the imported invoice as a real posted invoice through `InvoiceService` and `invoices.post(...)`

4. Improve field mapping for QuickBooks variants:

   - accept QuickBooks-style aliases in `data-migration-service.ts`, including:
     - `Customer`, `Customer Name` -> `customer_number`
     - `Invoice Date`, `Txn Date` -> `issue_date`
     - `Due Date` -> `due_date`
     - `Invoice Number` -> `external_id`
     - `Item`, `Item Name`, `Product` -> `sku` or line description
     - `Qty`, `Quantity` -> `quantity`
     - `Rate`, `Unit Price` -> `unit_price_minor`
     - `Amount`, `Line Amount` -> `amount_minor`
     - `Tax Amount`, `Sales Tax` -> `tax_amount_minor`
     - `Discount` -> `discount_amount_minor`
   - update both backend alias normalization and UI import field alias guidance if needed

5. Add import templates and docs:

   - update `docs/MIGRATION_AND_PORTABILITY.md` with exact QuickBooks Online and QuickBooks Desktop invoice import template columns
   - document the supported QBO/QBD CSV export shape
   - preserve the existing template guidance for other import types
   - update `apps/web/app.js` source list to include `QUICKBOOKS_DESKTOP` and user-facing QuickBooks Desktop guidance if required

6. Preserve current ClearLedger import constraints:

   - do not change the existing CAD/USD posting boundary or accounting model
   - do not add real-time QuickBooks sync, connector runtime, or a live QuickBooks API adapter
   - keep the solution within the structured CSV import/migration path
   - do not introduce unsupported invoice constructs that cannot map to ClearLedger invoices

7. Add tests:
   - end-to-end QuickBooks Online invoice import in `apps/api/src/phase12-portability.integration.test.ts`
   - source mismatch test for `QUICKBOOKS_ONLINE` vs `QUICKBOOKS_DESKTOP`
   - QuickBooks Desktop source import mapping test
   - invoice field mapping coverage test showing imported invoice line items and correct reconciliation totals
   - alias normalization test for at least one QBO/QBD header variant

## Implementation hints

- `apps/api/src/app.ts` currently defines the import source enum and upload route.
- `apps/api/src/services/data-migration-service.ts` contains alias lookup, `upload`, `preview`, `dryRun`, `commit`, and `commitRow(...)` for `OUTSTANDING_INVOICES`.
- The current invoice `commitRow` uses one line with `description` and `amount_minor`; replace or extend this to use line-level invoice creation.
- Keep audit events and batch status transitions unchanged.
- Use `InvoiceService.create` plus `InvoiceService.post` to create posted invoices.

## Deliverable

- a working QuickBooks invoice import feature for QBO and QBD CSV sources
- accurate field mapping
- immutable source provenance
- documentation updates
- tests to prove the import works and rejects mismatched source provenance

Do not make unrelated scope changes. Focus only on completing the QuickBooks import feature in the Switching Centre.
