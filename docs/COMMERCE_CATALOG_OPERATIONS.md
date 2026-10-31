# WooCommerce and Etsy catalog operations

Provider installation, scopes, webhook verification, polling, retries, rollback, and
normalized payloads are documented in [Commerce provider setup](COMMERCE_PROVIDER_SETUP.md)
and [Commerce provider payloads](COMMERCE_PROVIDER_PAYLOADS.md). This document is the
day-to-day catalog and stock operator procedure.

## Scope and safety boundary

PennyWise Accounting treats WooCommerce and Etsy as review-first commerce/catalog
sources. Catalog polling can observe products, variants, offerings, source images,
and available quantities. It can create reviewed local inventory-product definitions
and display an approved thumbnail beside inventory items. It does not create initial
stock, inventory movements, journals, sales invoices, payments, tax filings, or
marketplace settlements merely because a channel was connected or polled.

Orders and receipts enter the commerce inbox as retained, non-posting evidence. A
reviewer may approve a normalized order, inspect the server-built preflight, and
explicitly convert it to one DRAFT invoice when every catalog, tax, customer, account,
currency, fiscal-period, and exact-total check passes. The reviewer must then use the
existing invoice-post action deliberately; conversion never posts by itself. Provider
settlement, fee, refund, marketplace-tax, and bank-reconciliation workflows remain
separate release gates. Do not market this as autonomous WooCommerce or Etsy
accounting sync.

## What each channel supports now

| Capability             | WooCommerce                                                                 | Etsy                                                                       | PennyWise Accounting control                                                                                |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Catalog discovery      | Products and variations                                                     | Listings and offerings                                                     | Source records are scoped to one connector installation.                                                    |
| Item matching          | Exact product/variation identity, approved mappings, and review suggestions | Exact listing/offering identity, approved mappings, and review suggestions | Fuzzy scores are never used to match an order line or write inventory.                                      |
| Local product creation | Yes                                                                         | Yes                                                                        | Create one to 100 reviewed inventory-product definitions at a time.                                         |
| Product image          | Yes                                                                         | Yes                                                                        | Only an approved and ingested HTTPS source image can be selected in the catalog workflow.                   |
| Inventory quantity     | Poll and explicitly queue an approved exact quantity                        | Poll and explicitly queue an approved exact quantity                       | A named source of truth and a review decision are required.                                                 |
| Accounting posting     | Reviewed order may become a DRAFT invoice; posting is separate              | Shared order contract; provider-specific extensions remain gated           | Explicit reviewer action, exact totals, idempotent event/document link, and existing invoice posting rules. |

## First-time setup

1. Finish the company, chart of accounts, taxes, inventory locations, and product
   permissions before connecting a channel. A channel connection does not replace
   product, tax, or inventory accounting setup.
2. Complete [provider setup](COMMERCE_PROVIDER_SETUP.md), including the exact WooCommerce
   key permission or Etsy OAuth scopes, HTTPS callback, signature test, polling checkpoint,
   and rollback owner. Connect only a store/shop the business controls.
3. Confirm the connector is Ready and check health before importing. Webhooks are
   notifications; polling remains the recovery source for changes a webhook can miss.
4. Poll a deliberately small catalog page first. Review product titles, variation
   signatures, SKUs, source status, and any rate-limit or connector warning before
   opening a larger batch.

## Safe catalog-to-inventory workflow

1. In Integrations > Catalog, filter to the connected store and select only the
   observed variants the reviewer has checked. A variable Woo product must be reviewed
   at the variation level; a parent product is not a substitute for a colour or size
   variation.
2. Review match candidates. An exact SKU, GTIN, MPN, alias, or text similarity is
   evidence only. Confirm an existing local product only after comparing the source
   item and local item; reject or leave ambiguous candidates unresolved.
3. For new items, use Create reviewed items. Choose the shared accounts, inventory
   location, price/cost policy, and reorder policy. The dialog accepts one through 100
   selected variants and shows every selected item before submission.
4. Optionally attach the first ingested source image. Do not attach an image that has
   not completed image review/ingestion. The creation workflow copies only the source
   description, selected configuration, and approved image reference.
5. Decide separately whether to confirm the source-to-local mapping. The default is
   unconfirmed: PennyWise Accounting creates the item and leaves a suggested mapping for review.
   Selecting confirmation is an explicit, auditable decision; it is never inferred
   from a fuzzy score.
6. Review the results row by row. CREATED means the local definition exists;
   CREATED_REVIEW_REQUIRED means the item exists but confirmation needs attention;
   ALREADY_CREATED and ALREADY_MAPPED are safe retry outcomes. NOT_CREATED identifies
   only the failing source row, so correct rows are not rolled back.
7. Set opening stock through the normal controlled inventory-opening/adjustment
   workflow. Catalog creation intentionally leaves quantity at zero. This prevents an
   unreviewed channel count from changing inventory valuation or the general ledger.

## Safe order-to-invoice workflow

1. Review the retained provider evidence in Integrations > Review and resolve every
   blocking normalization finding. Mark the event `NORMALIZED` only after the order,
   revision, product identities, tax observations, and provider totals are understood.
2. Select Preview draft. The preflight checks the connector mapping, supported CAD/USD
   currency, customer policy, open fiscal period, product and revenue/inventory
   accounts, tax remittance evidence, line arithmetic, and the provider total with zero
   tolerance. A failed preflight lists the exact gap and creates nothing.
3. Compare the provider evidence with the proposed invoice lines. Confirm the customer,
   matched product, quantity, unit price, discount, mapped income account, tax code,
   tax amount, subtotal, and total. If the evidence is wrong or incomplete, Reject
   conversion with a reason; the event remains reviewable and no accounting changes.
4. Confirm and create draft only when the comparison is correct. The event links to the
   new DRAFT invoice in both directions, records the provider-total snapshot, writes an
   audit event, and remains unposted.
5. Use the normal invoice review/post workflow to post the draft. Existing posting
   rules create the balanced journal, tax lines, and weighted-average inventory sale
   movement. A posted invoice is marked back on the commerce event as `POSTED`.
6. Use the batch conversion endpoint for ordinary reviewed orders. It applies the same
   preflight independently to every event and returns a per-event result; one refusal
   does not create a partial invoice for that event or prevent other ready events from
   being handled.

Later cancellations, refunds, and edits are new review evidence. They do not mutate a
linked draft or posted invoice. Resolve them through the existing credit-note, refund,
reversal, or correction workflows after reviewing the provider evidence.

## Matching rules for WooCommerce

Woo matching is deliberately stricter than name or SKU matching:

1. A simple product maps by its reviewed product identity.
2. A variable product maps by its reviewed variation identity.
3. Woo variation_id 0 is no variation, never a global 0 mapping key.
4. If Woo sends a stable product or variation ID, an SKU-only mapping is blocked and
   the line is review-required. This prevents duplicate or skewed SKUs from choosing
   the wrong item.
5. If product, variation, and SKU references disagree, the line is blocking and no
   automatic conversion occurs.
6. Fuzzy suggestions never convert an order or create a ledger entry. They are only a
   reviewer aid in the catalog workspace.
7. Polling and a signed webhook for the same Woo order revision share one canonical
   identity. If their retained content differs, PennyWise Accounting records an integrity conflict
   rather than creating two review records or guessing which is correct.

## Images and inventory thumbnails

The inventory table shows a compact thumbnail when the product has an approved image
reference. Images lazy-load, require HTTPS in the browser, and fall back to a neutral
no-image state if the reference cannot be displayed. Thumbnails are presentation only;
they do not affect product identity, stock, tax, price, or accounting.

Current media is a reviewed remote reference, not a first-party media library. Keep
the source URL stable and do not treat it as archival product media. A production media
phase should add internal object storage, source provenance, hashes, thumbnail
derivatives, expiration/deletion handling, and a channel-host allowlist.

## Inventory quantity synchronization

Before enabling a quantity policy, confirm the catalog-to-product mapping and select
one PennyWise Accounting inventory location. Then choose a source of truth:

- `MANUAL_REVIEW`: records observations only; it cannot change either system. This is
  required for staging, ambiguous mappings, multiple locations, bundles, and unresolved
  conflicts.
- `LOCAL`: PennyWise Accounting is authoritative; a reviewed difference can queue PennyWise Accounting's
  exact available count to the channel. The channel write requires the provider's approved
  write permission, current revision, idempotency, and a post-write re-read.
- `CHANNEL`: the sales channel is authoritative; a reviewed difference can queue a dated
  local inventory adjustment through the controlled inventory workflow. It does not create
  opening stock or silently change valuation.

Automation stays off until an authorized reviewer explicitly enables `LOCAL` or `CHANNEL`.
Provider delivery is queued and retryable; a failed or response-unknown write is verified
by re-reading the provider before retrying, and a concurrent edit opens a conflict. Never
enable a rule merely to make two totals look equal. Investigate cancelled orders, returns,
bundles, reserved stock, multiple locations, and fulfilment timing first. See the
[provider payload retry/conflict workflow](COMMERCE_PROVIDER_PAYLOADS.md#conflict-and-retry-workflow).

## Daily operator checklist

1. Check connector health, last successful sync, and open connector conflicts.
2. Poll the narrowest practical window and retain the non-posting review evidence.
3. Resolve blocking item, tax, identity, and quantity differences in the appropriate
   review workspace. Do not bypass a conflict by recreating the product.
4. Review new channel variants and create local products only after the item/account
   configuration is known.
5. Confirm mappings deliberately, configure inventory policy only for approved pairs,
   and process the bounded delivery queue.
6. Compare order, refund, fee, payout, reserve, marketplace tax, and bank evidence
   before approving any future settlement posting workflow. Current PennyWise Accounting builds
   do not automate this last step.

## Acceptance checklist before live connector claims

- A representative sandbox/store export covers simple products, variables, duplicate
  SKUs, missing SKU, refunds, cancelled orders, discounts, shipping, fees, and taxes.
- Each accepted Woo variation has a unique reviewed variation mapping; no SKU-only
  fallback is relied upon when Woo identity exists.
- Poll and webhook copies replay one canonical revision; altered content for the same
  revision opens an integrity conflict. See [payload normalization](COMMERCE_PROVIDER_PAYLOADS.md).
- A reviewer can create products, inspect thumbnails, set opening stock separately,
  and retry a partial batch without duplicate product definitions.
- Quantity writes are tested with rate limits, response loss, provider errors, and
  concurrent channel edits. Etsy full inventory replacement must read-modify-write the
  complete products/offering set while changing only the approved offering, and the live
  offering quantity must equal the last reviewed `expectedQuantityMicros`. A changed value
  returns `CONNECTOR_INVENTORY_CHANGED` and requires refresh/review.
- A CPA/accounting owner signs the seller-collected versus marketplace-facilitated tax,
  fee, payout, reserve, refund, and bank-clearing policy for the exact jurisdiction.

Until every relevant acceptance item is complete with real provider evidence, keep the
connector in its present review-first, non-posting operating mode. Follow [safe staging
and rollback](COMMERCE_PROVIDER_SETUP.md#staging-acceptance-and-rollback) for any
credential, webhook, scope, policy, or worker change.
