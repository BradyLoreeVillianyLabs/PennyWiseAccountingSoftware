# External integration and import completion prompt

Status: assessed and executed 2026-08-06

## Objective

Complete the existing ClearLedger CSV import/migration flow and verify at least
one real provider-based external connector path without creating a parallel
subsystem or changing the accounting posting model.

## Execution result

The repository already contains the requested connector workflow in its
provider architecture:

- provider catalog and tenant-scoped connector installation drafts;
- credential validation, encrypted persistence, credential rotation, and
  secret-free DTOs;
- health/status reporting and connector logs/conflicts;
- WooCommerce REST and Etsy OAuth/provider adapters;
- checkpointed order/settlement pagination with continuation tokens;
- verified webhooks and idempotent commerce-inbox ingestion;
- normalized provider events mapped into ClearLedger review-domain objects;
- catalog polling, nearest SKU/name/description suggestions, explicit human
  confirmation, and review-only inventory synchronization.

The QuickBooks Online/Desktop CSV completion is recorded in:
[`QUICKBOOKS_SWITCHING_CENTRE_IMPORT_PROMPT.md`](./QUICKBOOKS_SWITCHING_CENTRE_IMPORT_PROMPT.md).

## Focused acceptance contract

1. Imports remain `upload -> preview -> dry run -> commit -> reconciliation ->
acknowledgement`, with immutable checksum/source provenance.
2. Common source aliases map deterministically; unsupported fields fail clearly
   or remain immutable evidence rather than being silently posted.
3. Invoices and bills use their domain services. QuickBooks invoice line rows
   with the same explicit invoice number are grouped into one invoice; source
   amounts, tax, discount, SKU, and row evidence remain traceable.
4. At least one provider path must be exercised with a real adapter contract:
   credentials -> health -> paged fetch -> normalized inbox event -> review.
   Provider credentials and raw secrets never appear in API responses.
5. Provider sync remains review/shadow mode until explicit mapping or inventory
   approval; no fuzzy match or connector fetch silently creates a journal,
   invoice, inventory movement, or payment.
6. Tenant authorization, credential encryption, idempotency, pagination
   checkpoints, retry/error status, webhook signatures, and source provenance
   are required before calling a connector path complete.

## Deliberately excluded scope

- live QuickBooks API synchronization;
- direct connector-to-ledger auto-posting;
- foreign-currency migration beyond the existing CAD/USD policy;
- a new frontend stack, CRM, or unrelated accounting features;
- external provider credentials or commercial approval that are not available
  in this repository.

## Verification plan

Run targeted unit tests, type checks, formatting/lint, and release-contract
verification on every change. Run database-backed import and connector
integration tests when a PostgreSQL/Docker test environment is available; do
not claim those tests passed when that environment is absent.
