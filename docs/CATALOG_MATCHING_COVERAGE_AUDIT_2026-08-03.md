# Catalog matching coverage audit

Date: 2026-08-03

## Result

Every implemented external catalog/product matching entry point now reaches the
central `CatalogMappingService` ranking contract. No WooCommerce, Etsy, demo, CSV,
or XLSX path contains its own fuzzy matcher. Automatic matches remain review-only;
order and accounting paths consume only prior exact/manual or human-confirmed
identity mappings.

## Covered entry points

| Entry point                                                                              | Evidence normalized                                                                                | Matcher path                                                                                                            | Work bound                                                                        | Authoritative effect                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| WooCommerce catalog poll                                                                 | Product/variation IDs, SKU, GTIN, manufacturer/MPN when present, name, parent description          | `WooCommerceConnector.catalogPage` -> `CatalogAutomationService.poll` -> `CatalogMappingService.suggestCandidatesBatch` | 50 variants and 10 candidates per automatic batch; deferred IDs returned          | Suggestions only                                                             |
| Etsy catalog poll                                                                        | Listing ID, offering ID, stable product-ID alias, SKU, variant name/signature, listing description | `EtsyConnector.catalogPage` -> the same automation and matcher path                                                     | Same                                                                              | Suggestions only                                                             |
| Authorized manual catalog ingest                                                         | Validated provider product/variant DTO, including aliases and identifiers                          | Route -> `upsertObservedCatalog` -> `suggestCandidatesBatch`                                                            | Same                                                                              | Suggestions only                                                             |
| Development commerce demo                                                                | Fictional Woo product/variant evidence                                                             | `CommerceDemoService` -> `upsertObservedCatalog` -> `suggestCandidatesBatch`                                            | Same                                                                              | Suggestions and shadow-review event only                                     |
| CSV/XLSX `PRODUCTS` preview from QBO, Xero, Wave, FreshBooks, Sage, Zoho Books, or Other | Mapped SKU, name, description                                                                      | `DataMigrationService` -> `nearestLocalCatalogSuggestions`                                                              | 25 rows per page, 5 candidates per row; `nextOffset` and a continuation GET route | Non-authoritative duplicate review only; no merge or skip                    |
| CSV/XLSX `INVENTORY_OPENING` preview from every supported source system                  | Mapped SKU                                                                                         | Same read-only central helper                                                                                           | Same                                                                              | Non-authoritative review only; dry-run/commit still require exact active SKU |

The Switching Centre exposes the spreadsheet results as review cards with source
evidence, candidate identity, and separate SKU, name, and description similarities.
A narrowly scoped Chrome-only browser case covers a 26-row product file, the first
25-row page, and navigation through `nextOffset` to the final source row.

The adapter capability guard requires order polling, webhook verification, catalog
normalization, and inventory operations together. A future registered commerce
adapter therefore cannot enter the commerce runtime while omitting the normalized
catalog boundary. Provider adapters return evidence; they do not query `ProductItem`
or rank candidates.

## Confirmation and runtime consumption

- A reviewer confirmation writes provider-scoped `catalogVariantMappings`, stable
  variant aliases, an unambiguous single-variant `catalogProductMappings` entry, and
  `catalogSkuMappings` in the same tenant transaction as the decision.
- Existing manual maps use separate namespaces and take precedence. Any differing
  target persists a `ConnectorConflict`, leaves the candidate unconfirmed, and
  returns `409 CATALOG_ITEM_MAPPING_CONFLICT`.
- WooCommerce and Etsy order polling and webhooks do not call fuzzy matching.
  Normalization resolves only prior manual/confirmed variation ID, product ID, alias,
  or SKU mappings. Multiple disagreeing identities produce a blocking conflict.
- A no-SKU Woo line can resolve through a confirmed variation ID. A no-SKU Etsy line
  can resolve through its confirmed product-ID alias while the offering ID remains
  available for inventory writes.

## Intentionally separate boundaries

These are not external product matching and must not call the catalog fuzzy matcher:

- sales invoices, estimates, bills, purchases, and inventory operations receive a
  user-selected tenant `ProductItem.id` and validate it exactly;
- opening-inventory commit resolves the imported SKU exactly and refuses missing or
  incompletely configured inventory items;
- bank transaction matching compares financial transactions, not products;
- customer, vendor, chart-of-accounts, tax, payroll, project, and fixed-asset imports
  belong to their own identity and accounting rules;
- the fully seeded company demo creates its own explicit internal product fixture;
  it is not provider catalog evidence;
- commerce order normalization never guesses an item from line text during a poll or
  webhook because doing so could make a suggestion appear authoritative.

## Verification evidence

Focused tests cover deterministic exact/fuzzy ranking and tie-breaking, Woo/Etsy
catalog normalization, automatic bounded suggestion calls, provider-ID aliases,
no-SKU order mapping, mapping conflicts, the development demo pipeline, spreadsheet
pagination past row 25, and the exact-SKU opening-inventory boundary. Database-backed
integration cases remain isolated-test-database work and must never run against a
shared or demo database.
