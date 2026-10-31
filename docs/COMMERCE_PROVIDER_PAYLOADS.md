# Commerce provider payloads and normalization

This document defines the review-first payload contract for WooCommerce and Etsy. It is
an operational normalization contract, not a promise that every provider field is
available in every account or API revision. The provider response, endpoint, API version,
headers, capture time, and normalized result must remain traceable.

The connector boundary is:

```text
raw request/response
  -> authenticate and verify signature
  -> bind provider installation and tenant
  -> canonical identity and revision check
  -> normalize exact money, quantities, taxes, fees, and statuses
  -> review/conflict inbox
  -> explicitly approved stock delivery or future accounting workflow
```

No normalized payload creates a journal, invoice, payment, POS sale/return, tax filing,
remittance, payout, or opening stock by itself.

## Evidence envelope

Every observation carries an envelope like this. Names are contract concepts; adapters may
store them in provider-neutral tables or events.

```json
{
  "schema_version": "commerce-observation.v1",
  "provider": "WOOCOMMERCE",
  "installation_id": "installation-fictional-001",
  "tenant_id": "tenant-bound-server-side",
  "environment": "STAGING",
  "api_version": "wc/v3",
  "endpoint_or_event": "products/42",
  "observed_at": "2026-08-13T18:00:00Z",
  "provider_identity": {
    "store_or_shop_id": "shop-fictional-001",
    "resource_type": "PRODUCT",
    "resource_id": "product-fictional-042",
    "revision": "provider-modified-time-or-checksum"
  },
  "observation_source": "POLL",
  "delivery_id": null,
  "signature_verified": null,
  "raw_evidence_ref": "protected-redacted-evidence-id",
  "normalized": {},
  "unknown_fields": [],
  "review_state": "REVIEW_REQUIRED"
}
```

Rules for the envelope:

- `tenant_id` and `installation_id` come from authenticated server context and stored
  installation metadata, never from a user-supplied payload;
- provider IDs are strings at the boundary so large IDs cannot lose precision;
- `revision` must distinguish a changed resource from a repeat delivery. If the provider
  supplies no revision, use a deterministic canonical-content hash plus observed provider
  timestamp and retain the limitation;
- `POLL` and `WEBHOOK` observations for the same installation/resource/revision share one
  canonical identity. A webhook delivery ID is evidence of delivery, not a second order;
- raw payloads are encrypted/redacted according to retention policy. Never retain OAuth
  tokens, API keys, webhook secrets/signatures, cookies, authorization headers, addresses,
  emails, phone numbers, payment tokens, IPs, user agents, private URLs, or free-text
  customer notes unless a separately approved evidence policy requires a redacted form;
- unknown fields may be retained in a non-posting inspection area with a field name and
  type, but unknown money, tax, fee, refund, identity, or quantity fields block review.

## Provider-specific identity

### WooCommerce

Use the strongest available identity in this order:

1. store installation + product ID + variation ID;
2. store installation + product ID for a simple product;
3. a reviewed SKU/alias only when the provider did not supply a usable product/variation
   identity.

`variation_id: 0` means no variation. It is not a global variation key. A variable parent
is not a substitute for a colour/size variation. If product ID, variation ID, and SKU
disagree, mark the line `CONFLICT`/`REVIEW_REQUIRED`; do not select the item by title or
fuzzy similarity.

Normalize product and variation responses from the documented [WooCommerce products
endpoints](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/), and order,
line, status, tax, shipping, and refund responses from the [WooCommerce orders
endpoints](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/). Preserve
provider status and timestamps as evidence; do not treat a status as proof that money
settled or that a tax was remitted.

### Etsy

Use shop + listing + inventory product + offering identity. An Etsy inventory response is
not one flat SKU row: products contain property values and nested offerings. An inventory
write must name the exact listing and offering. Because Etsy's inventory update request
represents the complete products/offering set, use a read-modify-write operation: change
only the approved offering and preserve every unchanged product, offering, and property
value. Never submit a partial set that could remove or overwrite siblings.
Missing SKU is safe when the stable listing/product/offering identity is present; it is
not permission to invent a SKU.

For webhook observations, normalize the common `event_type`, `resource_url`, and `shop_id`
then re-read the resource using the authorized API. Treat the webhook envelope as a
notification and evidence of delivery, not the complete receipt. Use the official [Etsy
webhook payload structure](https://developers.etsy.com/documentation/essentials/webhooks/)
and [listing/inventory structure](https://developers.etsy.com/documentation/tutorials/listings/)
as the provider source of truth.

For a full Etsy inventory replacement, carry the last reviewed `expectedQuantityMicros`
for each approved offering. Immediately before replacement, the live offering quantity
must equal that expected value. If it differs, return `CONNECTOR_INVENTORY_CHANGED`, do
not replace sibling offerings or retry blindly, and send the listing back through refresh
and review.

## Normalized business payload

The normalized object is deliberately provider-neutral and review-oriented:

```json
{
  "resource": {
    "kind": "ORDER",
    "provider_id": "resource-fictional-100",
    "revision": "revision-fictional-1",
    "status": "PAID",
    "occurred_at": "2026-08-13T17:59:00Z",
    "currency": "CAD"
  },
  "lines": [
    {
      "provider_line_id": "line-fictional-1",
      "product_identity": {
        "provider_product_id": "product-fictional-42",
        "provider_variant_or_offering_id": "offering-fictional-7",
        "sku": "SKU-REVIEWED-1",
        "mapping_state": "CONFIRMED"
      },
      "description": "Provider description evidence",
      "quantity": "2",
      "unit_amount_minor": "1250",
      "line_subtotal_minor": "2500",
      "discount_minor": "0",
      "tax_minor": "325",
      "shipping_minor": "0"
    }
  ],
  "adjustments": {
    "shipping_minor": "500",
    "discount_minor": "0",
    "fees_minor": "0",
    "refunds_minor": "0",
    "tax_minor": "325",
    "gross_minor": "3325",
    "net_or_payout_minor": null
  },
  "tax_lines": [
    {
      "provider_rate_id_or_label": "provider-rate-fictional-1",
      "jurisdiction_hint": "CA-AB",
      "tax_type": "SALES_TAX",
      "amount_minor": "325",
      "rate": "0.130000",
      "remitter": "REVIEW_REQUIRED",
      "mapping_state": "REVIEW_REQUIRED",
      "evidence_refs": []
    }
  ],
  "taxRemittanceMappings": {
    "provider-rate-fictional-1": "REVIEW_REQUIRED"
  },
  "taxRemittanceByComponent": {
    "provider-rate-fictional-1": "REVIEW_REQUIRED"
  },
  "taxRemittanceResponsibility": "REVIEW_REQUIRED",
  "stock": {
    "available_quantity": "8",
    "location_ref": null,
    "authority_policy": "MANUAL_REVIEW",
    "write_state": "NOT_QUEUED"
  }
}
```

For a fully evidenced mixed order, the normalized result preserves each component while
deriving the aggregate responsibility:

```json
{
  "taxRemittanceMappings": {
    "seller-tax-rate": "SELLER",
    "marketplace-tax-rate": "MARKETPLACE"
  },
  "taxRemittanceByComponent": {
    "seller-tax-rate": "SELLER",
    "marketplace-tax-rate": "MARKETPLACE"
  },
  "taxRemittanceResponsibility": "MIXED"
}
```

`taxRemittanceMappings` is keyed by provider rate ID when available, otherwise by the
stable provider rate/label. Its only values are `SELLER`, `MARKETPLACE`, and
`REVIEW_REQUIRED`. `taxRemittanceByComponent` remains attached to the normalized order or
tax evidence, including when the aggregate is `MIXED`; an aggregate field must not erase
component responsibility. If Etsy provides tax only as one aggregate amount that cannot be
separated into components, normalize it as `REVIEW_REQUIRED` and preserve the aggregate
evidence. Do not infer `MARKETPLACE` from Etsy documentation or an Etsy tax amount alone.

### Money and quantity rules

- Persist money as integer minor units or an approved fixed-precision decimal; never use
  JavaScript floating-point numbers for persisted money.
- Keep the provider currency and any currency conversion evidence separate. Do not convert
  to reporting currency during parsing unless the approved FX policy and rate evidence are
  present.
- Woo decimal strings are parsed with exact decimal rules and rounded only at an explicit,
  versioned boundary. Etsy `amount`/`divisor` values remain exact integer/divisor values
  until the approved currency policy converts them.
- Quantities are non-negative exact values. A negative quantity is a refund/return or an
  invalid payload, not a stock write. Partial refunds retain original line identity and
  refunded quantity/amount.
- Reconciliation must prove: line amounts + shipping + tax - discounts - refunds = the
  provider total, with a documented rounding difference of zero or an approved tolerance.

## Catalog normalization

| Normalized field                  | WooCommerce source concept            | Etsy source concept                  | Review rule                                                |
| --------------------------------- | ------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `provider_product_id`             | product ID                            | listing ID + inventory product ID    | Stable provider identity required when supplied            |
| `provider_variant_or_offering_id` | variation ID; `0` means none          | offering ID                          | Exact child identity wins over SKU/title                   |
| `sku`                             | product/variation SKU                 | inventory product SKU, may be absent | SKU is evidence, never sole identity when stable IDs exist |
| `title`, `description`            | product/variation text                | listing text                         | Display evidence only until mapping is reviewed            |
| `quantity`                        | stock quantity and manage-stock state | offering quantity                    | One offering/location per approved write                   |
| `price`, `currency`               | product/variation price               | listing/offering price               | Do not infer cost or accounting price                      |
| `image_refs`                      | product images                        | listing images                       | HTTPS image must pass image review/ingestion               |
| `status`                          | publish/catalog/stock status          | listing state                        | Status does not authorize posting                          |

Catalog import can create a reviewed local product definition and approved thumbnail. It
must not set opening stock, create an inventory movement, or confirm a fuzzy mapping.

## Order, refund, fee, and payout normalization

Keep these categories distinct even when the provider combines them in one response:

- sale lines and order totals;
- discounts, shipping, tips, and other adjustments;
- sales tax collected on the order;
- platform/payment/listing fees and tax on fees;
- partial/full refunds and returns;
- reserves, deposits, and payout/settlement amounts;
- bank evidence used later to reconcile the payout.

WooCommerce Core order data is not a universal processor-fee or settlement source. Etsy
payment and shop-ledger data are read-only reporting evidence in the documented [Etsy
payments tutorial](https://developers.etsy.com/documentation/tutorials/payments/); a
payment record may reflect fulfillment timing and does not by itself prove bank receipt.
Keep gross, fees, tax, refund, reserve, and net/payout facts separately linked to their
provider IDs and dates.

## Tax and remittance normalization

Each observed tax line needs a provider rate ID or stable label, amount, currency, tax
class/type, source resource, and a PennyWise Accounting tax-code mapping. It also needs one of:

- `SELLER`: seller evidence supports collection/remittance responsibility;
- `MARKETPLACE`: the platform evidence supports collection/remittance for that exact sale,
  jurisdiction, date, product, and tax type;
- `REVIEW_REQUIRED`: evidence is incomplete or conflicting.

Never infer a remitter from the existence of a tax amount, an Etsy order status, a
WooCommerce tax class, or a payment processor. Separate sales tax from tax charged on
platform fees, customs/import tax, and income-tax withholding. See
[North American tax and marketplace remittance](NORTH_AMERICAN_TAX_AND_MARKETPLACE_REMITTANCE.md)
for the review workflow and evidence checklist.

The provider source material is operational evidence, not universal legal certainty:
[WooCommerce tax setup](https://woocommerce.com/document/setting-up-taxes-in-woocommerce/),
[WooCommerce Tax](https://woocommerce.com/document/woocommerce-shipping-and-tax/woocommerce-tax/),
[Etsy Canadian remittance guidance](https://help.etsy.com/hc/en-us/articles/6633345416215-What-Does-Etsy-Remit-to-Canadian-Tax-Authorities?segment=selling),
and [Etsy U.S. sales-tax guidance](https://help.etsy.com/hc/articles/360000343968?segment=selling).

## Webhook and polling normalization

### Verification order

1. Resolve callback to an enabled installation and tenant.
2. Read raw body and provider headers without parsing or reserializing.
3. Verify signature and replay/timestamp requirements.
4. Validate content type, provider event type, shop/store identity, and payload size.
5. Compute canonical provider resource/revision identity.
6. Persist a redacted evidence reference, delivery record, and idempotency key.
7. Enqueue normalization; return success only after durable enqueue.

For WooCommerce, use the webhook secret and signature header documented in the [Woo
webhook guide](https://woocommerce.com/document/webhooks/). For Etsy, use
`webhook-id`, `webhook-timestamp`, `webhook-signature`, the raw body, the documented
five-minute replay margin, and the `webhook-id.timestamp.raw_body` HMAC input from the
[Etsy webhook guide](https://developers.etsy.com/documentation/essentials/webhooks/).

### Polling

Polling always uses bounded pages, a durable checkpoint, and an overlap window. Store
provider pagination tokens/offsets as checkpoint evidence. On a timeout or rate limit,
retry the same page; do not advance the checkpoint. After a successful page, advance only
after all observations are durably normalized or placed in a conflict/dead-letter state.

Polling after a webhook is expected: re-read the current resource, coalesce to the same
canonical identity, and retain both observation sources. Polling can discover a change
that has no webhook; it cannot resolve a disagreement without a review decision.

## Conflict and retry workflow

### States

`RECEIVED` -> `VERIFIED` -> `NORMALIZED` -> `REVIEW_REQUIRED` -> `APPROVED` ->
`QUEUED` -> `DELIVERED` is the happy path for an explicit stock write. Use `CONFLICT` for
same-resource different-content/revision, identity disagreement, tax/remitter mismatch,
or concurrent stock edits. Use `RETRY_WAIT` for transient transport failure and
`DEAD_LETTER` after the bounded retry policy is exhausted.

### Conflict handling

1. Freeze writes for the affected resource and policy.
2. Show both observations, source, provider revision, timestamps, mapping, tax, stock,
   and any response body needed to investigate; redact secrets and personal data.
3. Re-read the provider resource and compare to the last accepted local checkpoint.
4. Ask an authorized operator to choose the source of truth or correct the mapping.
5. Record the decision, actor, reason, effective time, and evidence references.
6. Re-normalize the staged event. Do not mutate the original evidence or silently choose
   the newest message.

### Retry handling

- Retry network failures, timeouts, 408, 429, and 5xx with bounded exponential backoff,
  jitter, and provider `Retry-After` when present.
- Do not retry authentication, authorization, validation, unsupported-resource, or
  signature failures until the configuration is corrected.
- For an outbound stock write with an unknown response, read the resource first. If the
  desired exact quantity and revision are already present, mark the operation delivered;
  otherwise retry with the same idempotency key only after the provider’s concurrency
  precondition is still valid.
- Every attempt records request hash, provider/install/resource identity, idempotency key,
  response class, retry count, and redacted error code. Never log the body with secrets.
- A retry must not create a second product, order, refund, inventory movement, journal,
  or tax event. Provider event delivery IDs and canonical resource identity are separate
  deduplication keys and both are retained.

## Safe fixture and rollback rules

Provider fixtures must come from an authorized non-production store/shop or a provider
portal test event. Sanitize deterministic payloads before export: remove secrets,
signatures, tokens, cookies, personal/contact/address data, private URLs, payment
identifiers, and free text; preserve JSON shape, null/optional behavior, numeric types,
pagination, tax/refund totals, unknown fields, and a manifest SHA-256. Do not keep a
reversible redaction map.

To roll back a connector, pause writes, stop polling/worker delivery, preserve the last
checkpoint and open conflicts, disable or pause webhooks, and revoke credentials if
needed. Do not delete raw evidence or rewrite normalized history. Resume only after a
read-only health check and overlap poll. Any stock correction is a new reviewed operation,
never an edit or blind replay of a prior request.

## Operator acceptance checklist

- Woo simple, variable, variation `0`, duplicate-SKU, no-SKU, order, cancellation,
  partial/full refund, tax, fee, and webhook fixtures normalize without precision loss.
- Etsy listing, multi-product/multi-offering inventory, receipt, payment, ledger, refund,
  marketplace-tax, and all four documented webhook events normalize without flattening
  offerings or financial categories.
- Per-rate remittance overrides preserve `taxRemittanceByComponent`; resolved seller and
  marketplace components derive aggregate `MIXED`, while an inseparable Etsy aggregate tax
  remains `REVIEW_REQUIRED`.
- Valid, invalid, stale, duplicated, tampered, out-of-order, and replayed deliveries are
  verified and handled idempotently.
- Poll and webhook copies coalesce; changed content for the same revision opens a conflict.
- Unknown SKU, tax rate, remitter, currency, location, or provider field blocks review
  rather than guessing.
- `MANUAL_REVIEW`, `LOCAL`, and `CHANNEL` each have a tested no-write/write boundary.
- Etsy inventory replacement rejects a changed live offering quantity with
  `CONNECTOR_INVENTORY_CHANGED`, then requires refresh/review; response loss, 429/5xx,
  partial retries, and dead-letter recovery are also evidenced.
- The connector creates zero accounting/POS/tax/remittance/payout effects until a later,
  separately accepted workflow authorizes them.
