# QuickBooks Switching Centre import prompt

Status: implemented 2026-08-06

This file records the supplied implementation prompt and the execution contract
used for the ClearLedger build. The accidental second-company prompt attachment
was intentionally excluded.

## Goal

Make structured QuickBooks Online and QuickBooks Desktop CSV exports usable in
the Switching Centre while preserving immutable provenance, accurate invoice
line mapping, and the existing upload → preview → dry run → commit →
reconciliation → acknowledgement workflow.

## Required behavior

- Keep `QUICKBOOKS_ONLINE` and add explicit `QUICKBOOKS_DESKTOP` source
  provenance. Identical bytes uploaded under a different source must fail with
  `IMPORT_SOURCE_MISMATCH`.
- Accept QuickBooks aliases for customer, invoice date, transaction date, due
  date, invoice number, item, quantity, rate, amount, tax, discount, terms,
  memo, and payment terms.
- Treat repeated invoice-number rows as line items on one real ClearLedger
  invoice. A row without an invoice number remains a separate invoice so that
  unrelated rows cannot be silently merged.
- Preserve source identifiers, SKU, source amounts, tax, discount, and raw
  mapped values in the immutable import batch. Resolve a SKU only when an exact
  active local product exists; fuzzy suggestions never post or auto-confirm.
- Create and post invoices through `InvoiceService` and `invoices.post(...)`.
  ClearLedger’s central tax service remains authoritative. A source tax amount
  is evidence unless the user maps it to an active local tax code; it must not
  be injected directly into a journal.
- Remain base-currency-only for this migration path (`CAD`/`USD` policy is
  unchanged). Do not add live QuickBooks sync, connector runtime, or a live
  QuickBooks API adapter.

## Added safety and acceptance criteria

The original prompt did not explicitly state these controls; they are part of
the implementation because they prevent a migration from changing the books
silently:

1. Uploads remain content-addressed and idempotent by organization, import type,
   and SHA-256 checksum. Source provenance is immutable in the database.
2. Preview and dry run validate dates, positive money, quantities, exact unit
   prices, payment terms, duplicate invoice identifiers, customers, local tax
   codes, and accounting dependencies before posting.
3. Each committed invoice line remains traceable to its source row through the
   immutable `DataImportRow` mapped data and audit evidence. A failed financial
   commit keeps the existing `FAILED`/`COMPENSATION_REQUIRED` boundary.
4. Multi-line invoices are grouped only by an explicit source invoice number.
   Amount-only legacy rows continue to work when quantity is one; fractional
   quantities require an exact minor-unit unit price.
5. The UI provides separate Online/Desktop export guidance, a canonical
   multi-line invoice template, and recognizable QuickBooks aliases while
   leaving advanced manual mapping available.
6. Tests cover Online end-to-end posting, Desktop posting, source mismatch,
   multi-line quantity/price/discount mapping, reconciliation totals, aliases,
   and immutable source evidence.

## Execution prompt

> Complete the QuickBooks Switching Centre import feature in the
> `ClearLedger-Codex-Ready` repository. Keep the current staged import workflow
> and accounting boundaries. Add `QUICKBOOKS_DESKTOP` beside
> `QUICKBOOKS_ONLINE`, migrate the enum safely, reject same-content source
> mismatches, normalize QuickBooks Online/Desktop aliases, group repeated
> invoice numbers into one posted invoice with line-level SKU/quantity/rate/
> amount/discount evidence, and use `InvoiceService` plus the central tax
> service for posting. Update templates, UI guidance, migration documentation,
> and focused integration tests. Do not add live QuickBooks APIs, connector
> runtime behavior, foreign-currency migration, or unrelated scope. Finish by
> running formatting, type checks, focused portability tests, and the relevant
> release verification gates.
