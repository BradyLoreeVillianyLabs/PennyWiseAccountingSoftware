# Source-neutral catalog matching contract

Date: 2026-08-03

## Boundary

Catalog matching is provider-neutral. WooCommerce, Etsy, commerce demo data,
manual catalog ingestion, spreadsheet product/inventory previews, and future
commerce connectors call the same ranking implementation. Commerce adapters
normalize products and variants into `ExternalCatalogProduct` and
`ExternalCatalogVariant`; spreadsheet previews call the same read-only matcher
without fabricating provider records. Provider-specific code must not rank or
confirm local products.

For a variant, the observed evidence is:

- identifiers and name from `ExternalCatalogVariant`; and
- description from its parent `ExternalCatalogProduct`.

The local evidence is the identifiers, name, and description on `ProductItem`.
Candidate retrieval is tenant-predicated, active-item-only, and bounded to at most 125
nearest records from each of the exact-identifier, normalized-SKU, normalized-name, and
normalized-description pools, followed by a deduplicated maximum of 500 records. The
database uses tenant-aware `pg_trgm` GiST indexes. Application code performs the final
deterministic scoring so database planner or floating-point differences cannot change
the persisted explanation.

## Ranking and explanation

Durable evidence always ranks above fuzzy evidence:

1. exact normalized GTIN: `100000`;
2. exact normalized manufacturer plus manufacturer part number: `98000`;
3. exact normalized SKU: `90000`; and
4. weighted fuzzy evidence: below `80000`.

Fuzzy scores are integer basis points from `0` through `10000`. Normalized SKU, name,
and description use deterministic trigram Dice similarity. The composite weights are
45 percent SKU, 35 percent name, and 20 percent description. Missing fields have a
`null` score and their weights are removed before the remaining weights are normalized.
Final ties sort by local `ProductItem.id`.

Catalog polling, manual catalog ingestion, and the commerce demo automatically
evaluate at most 50 newly observed variants and retain at most 10 candidates per
variant. The response identifies deferred variant IDs; an authorized reviewer can
request candidates for any deferred variant through the existing per-variant
candidate endpoint. The limit is a request-work bound, not a silent loss of rows.

New suggested candidates persist this compatible JSON reason contract:

```json
{
  "version": 2,
  "matches": ["SKU_SIMILARITY", "NAME_SIMILARITY", "DESCRIPTION_SIMILARITY"],
  "skuSimilarityBasisPoints": 7500,
  "nameSimilarityBasisPoints": 8200,
  "descriptionSimilarityBasisPoints": null,
  "compositeSimilarityBasisPoints": 7800,
  "autoConfirmEligible": false
}
```

`matches` may also contain `EXACT_GTIN`, `EXACT_MANUFACTURER_PART_NUMBER`, or the
existing compatibility code `NORMALIZED_SKU`. Persisted version 1 reasons remain valid
historical evidence. A new suggestion may update an unresolved version 1 candidate to
version 2 through its existing optimistic version increment; resolved decisions are not
rewritten.

## Safety rule

No score, including exact durable identifiers, automatically confirms a mapping. Only
an authorized human confirmation changes a candidate to `CONFIRMED`. Suggestion and
confirmation create no journal, accounting entry, inventory movement, or provider
inventory write. Confirmed mappings can later be used only by an explicit domain
workflow with its own authorization and accounting/inventory safeguards.

Confirmation atomically copies the reviewed local `ProductItem.id` into separate
provider-scoped `catalogVariantMappings`, `catalogProductMappings`, and
`catalogSkuMappings`. Stable variant aliases (for example Etsy `product_id` beside
its inventory `offering_id`) participate in that bridge. Product-level mapping is
written only for a product with one observed variant. A different existing manual
or confirmed target is never overwritten: the candidate remains suggested, a
reviewable connector conflict is retained, and the request returns
`409 CATALOG_ITEM_MAPPING_CONFLICT`.

Order polling and webhooks do not run fuzzy matching. They may consume only a prior
manual mapping or human-confirmed provider ID/SKU mapping; disagreeing references
block the line as a mapping conflict. WooCommerce has two additional fail-closed
rules: `variation_id: 0` is treated as no variation (not as a reusable mapping key),
and an order line with a real variation ID must have an exact variation mapping. A
parent-product mapping or SKU-only mapping cannot silently choose a size, colour, or
other variation while Woo supplied a stable provider identity. SKU-only fallback is
reserved for malformed/legacy source payloads that genuinely omit both product and
variation identifiers.

Woo polling and signed webhooks use the same canonical order-revision identity. A
delivery retry or a polling copy of the same revision replays one inbox record; if
two copies for that identity carry different retained provider content, the inbox
opens an integrity conflict rather than silently choosing one or creating duplicate
review evidence. Older and newer revisions remain separate immutable evidence until
a future posting/reconciliation workflow has an explicit supersession policy.

## Spreadsheet boundary

`PRODUCTS` and `INVENTORY_OPENING` CSV/XLSX previews return an additive
`itemMatchSuggestions` object. It is explicitly `authoritative: false` and
`autoConfirmEligible: false`, evaluates at most 25 mapped rows per page, and exposes
`nextOffset`. Remaining rows are available from
`GET /v1/imports/{batchId}/item-match-suggestions?offset={n}&limit={1..25}`.

The Switching Centre renders every source row beside each candidate local item and
shows separate nearest-SKU, nearest-name, and nearest-description evidence. Its
Previous and Next controls follow `offset` and `nextOffset`, so deferred rows remain
available for review instead of disappearing after the first page.

Product rows use nearest normalized SKU, name, and description only to help a human
spot likely duplicates before the create/import workflow. They do not silently merge
or skip a row. Opening-inventory rows may show nearest-SKU review suggestions, but
dry-run and commit continue to resolve the configured local item by an exact,
tenant-scoped, active SKU. A fuzzy candidate can never select an inventory item or
create a movement.
