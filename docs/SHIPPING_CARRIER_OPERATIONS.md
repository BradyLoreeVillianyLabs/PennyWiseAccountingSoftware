# Shipping carrier operations

This is the operator and support contract for D5 shipping labels. Shipping is
operator-owned: PennyWise never holds a postage balance, buys postage on its
own account, resells postage, or refunds a void. The connected carrier account
is billed directly by that carrier.

## Supported boundary

The API uses one neutral carrier adapter for credential validation, address
validation, quotes, purchases, reconciliation, voids, and tracking. `FIXTURE`
is a deterministic test adapter. `CANADA_POST` is the first real adapter in
this deployment. USPS and FedEx remain future adapters against the same
interface; their absence is visible rather than inferred.

Canada Post's developer material describes separate shipping, rating, tracking,
and service-information APIs. The implementation keeps those operations behind
the adapter and uses OAuth client credentials supplied by the operator. Review
the current [Canada Post shipping documentation](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/ship-parcels),
[shipping backgrounder](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/api/info/shipping/shipping-backgrounder),
[tracking API](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/product/tracking/api/tracking-api-1.0.0),
and [service information API](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/product/serviceinfo/api/service-info-api-1.0.0)
before enabling a production account.

## Credential handling

Create a carrier account from the Shipping workspace using an operator-owned
credential. For Canada Post, the current request shape is:

```json
{
  "clientId": "<operator client id>",
  "clientSecret": "<operator client secret>"
}
```

The API encrypts the JSON with the existing
`CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET` protection pattern. Credential values
are never returned in account DTOs, audit metadata, logs, exports, or label
responses. Production requires an explicitly configured high-entropy secret (at
least 32 characters) or an injected protected store. Do not put live carrier
secrets in `.env.example`, source control, screenshots, fixtures, or an
unencrypted backup.

For a local fixture drill, use `carrierKey: "FIXTURE"` and
`credentials: { "apiKey": "fixture-key" }`. That key proves application
control flow only; it is not a carrier credential and must never be described as
a live shipping result.

## Buy and print flow

1. Open a posted invoice or completed POS sale and create one shipment with the
   carrier account, parcel dimensions, weight, and label format default.
2. Review the returned quote, carrier service, currency, and cost.
3. Purchase only after the operator sends `confirmed: true` together with the
   exact quote version, service code, currency, cost, expense account, paying
   account, method, and expense date. There is no automatic or batch postage
   purchase.
4. The returned PDF or ZPL is stored as a document reference. The browser opens
   the label inline so the operator can print it to the selected local printer.
   PDF is the default; ZPL is available for thermal printers when selected as
   the carrier-account default. Printer drivers and physical printer success
   require a manual operator drill.
5. The purchased carrier cost is recorded through the existing immediate
   expense workflow with idempotency key `shipping-expense:<shipmentId>` and
   linked back to the shipment. The shipment also retains links to source
   inventory movements where stock was relieved.

If the carrier request times out after it may have persisted, the shipment is
marked `PURCHASE_UNKNOWN` and the next attempt reconciles the purchase key
before another buy request. A confirmed reconciliation stores the one returned
label. A failed accounting write after a confirmed carrier purchase is retained
as `PURCHASED_EXPENSE_PENDING`; retry completes the existing expense link
without buying another label.

## Voids and tracking

Voids are carrier-governed and may be time-limited. PennyWise records every
attempt and the provider answer. An accepted answer produces `VOIDED`; a
rejection produces `VOID_REJECTED`; an unanswered request remains
`VOID_PENDING` and requires operator reconciliation. PennyWise never assumes a
refund or void from a request being sent.

Tracking is an explicit refresh. Provider events are stored by deterministic
event hash and duplicate refreshes do not create duplicate events.

## Cross-border customs

When origin and destination countries differ, the operator must review and
supply each line's HS tariff code, country of origin, quantity, declared value,
and declared currency. The product record supplies HS code and origin where
available; parcel customs lines supply the declared values. The service refuses
the quote before calling the carrier when required values are missing or do not
match the product record.

PennyWise does not classify goods, calculate duty, determine tax treatment, or
act as the customs declarant. The operator is responsible for the declaration
and for reviewing the carrier's final customs representation.

## Verification status

Automated evidence is recorded in
`apps/api/src/services/shipping/carrier-adapter.test.ts` and
`apps/api/src/phase-d5-shipping.integration.test.ts`. Those tests cover the
fixture contract, failure modes, encrypted credential boundary, normal label
flow, timeout reconciliation, linked expense/inventory records, tracking,
voids, and missing-customs refusal.

No Canada Post sandbox account or operator credential was available for this
environment. Therefore live Canada Post quote, purchase, label print, void,
and tracking are not claimed as verified. To perform that manual gate, set the
operator-owned `clientId` and `clientSecret` in the Shipping UI, select the
carrier's test environment, run one test shipment, inspect the quote before
purchase, print the returned artifact in the browser, run tracking, and attempt
a carrier-supported void. Record request IDs, results, and screenshots with
customer data redacted; do not commit credentials or live business data.
