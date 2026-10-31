# Commerce provider setup

This is the operator runbook for connecting an owner-controlled WooCommerce store or
Etsy shop to PennyWise Accounting. A connection stages catalog, order, inventory, tax, fee, and
payout evidence for review. It does not by itself create customers, invoices, payments,
inventory movements, journals, tax liabilities, returns, filings, remittances, or payouts.

The default installation mode is `MANUAL_REVIEW`. Enable `LOCAL` or `CHANNEL` only after
the exact item mappings, location, stock rules, tax policy, and provider evidence have
been reviewed. See [Commerce provider payloads](COMMERCE_PROVIDER_PAYLOADS.md) for the
normalized contract and [Commerce catalog operations](COMMERCE_CATALOG_OPERATIONS.md) for
daily operation.

## Installation gate

Before asking a seller for credentials, record an installation ticket containing:

- organization, connector, store/shop identity, owner, environment (`STAGING` or
  `PRODUCTION`), and intended first sync window;
- provider API version and endpoint family;
- requested permissions and why each one is needed;
- callback URL, webhook event list, signature-verification test, polling cadence, and
  retention/redaction decision;
- selected authority policy for catalog and stock: `LOCAL`, `CHANNEL`, or
  `MANUAL_REVIEW`;
- tax registrations/nexus questions, tax-code map, seller-versus-marketplace remitter
  decision, and evidence owner;
- rollback owner and the exact disable/revoke procedure.

If any item is unknown, leave the connector in `MANUAL_REVIEW` and do not enable writes.
Credentials must be stored by the configured secret/encryption adapter; never put keys,
tokens, webhook secrets, or signed bodies in tickets, logs, fixtures, screenshots, or
source control.

## Authority policies

| Policy          | Authority                                                         | Read behavior                                                     | Write behavior                                                                                                                 | Safe use                                                                                          |
| --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `LOCAL`         | PennyWise Accounting inventory and approved local product mapping | Poll/channel changes become review evidence and conflict checks   | A reviewed, idempotent quantity delivery may set the channel quantity from local available stock                               | Use only for one mapped location, exact variants/offerings, and an approved stock calculation     |
| `CHANNEL`       | WooCommerce or Etsy channel quantity                              | Channel quantity is observed and compared with local availability | A reviewed channel difference may queue a controlled local stock adjustment; it never silently opens stock or posts accounting | Use when the channel is the operational stock authority and local adjustment approval is required |
| `MANUAL_REVIEW` | Neither system                                                    | Record observations, mappings, tax evidence, and differences      | No automatic write to either system                                                                                            | Default, staging, ambiguous mappings, multi-location/bundle cases, and all unresolved conflicts   |

Changing policy is a controlled change. Pause queued writes, capture a checkpoint, review
open conflicts, and record the new effective time. A policy change never rewrites prior
evidence or posted history.

## Common prerequisites

1. Use a developer-owned or seller-authorized staging store/shop first. Create test
   products/listings, one variable/multi-offering item, one paid test order, a refund, a
   tax line, and a stock change. Do not start with production customer data.
2. Confirm PennyWise Accounting company, base/reporting currency, tax codes, inventory location,
   account mapping, roles, and review permissions. Catalog import leaves opening stock at
   zero; it is not an inventory receiving or opening-balance workflow.
3. Use a publicly reachable HTTPS callback for webhooks. The callback must accept the raw
   request body, verify the provider signature before JSON parsing, enforce replay checks,
   and enqueue a bounded review event quickly.
4. Define the poll checkpoint and overlap window before the first import. Polling is the
   recovery source for missed, delayed, or disabled webhooks; webhook delivery is a
   notification, not the sole source of truth.
5. Run a narrow initial sync, inspect normalized payloads and conflicts, then expand the
   window. Keep `MANUAL_REVIEW` until the staging acceptance checklist passes.

## WooCommerce setup

### Store requirements

The current WooCommerce REST API documentation requires WooCommerce 3.5+, WordPress
4.4+, and pretty permalinks; default permalinks do not work. Use HTTPS. The current API
family is `v3`, addressed under `/wp-json/wc/v3`. Verify the store root, WordPress REST
API reachability, timezone, currency, tax settings, product variations, and inventory
management before connecting.

Read the official [WooCommerce REST API overview](https://developer.woocommerce.com/docs/apis/rest-api/),
[authentication guide](https://developer.woocommerce.com/docs/apis/rest-api/authentication),
[orders reference](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/), and
[products reference](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/).

### Key and permission requirements

WooCommerce REST keys are not OAuth scopes. In **WooCommerce > Settings > Advanced >
REST API**, add a key for a dedicated WordPress user, select the smallest key permission,
and record the user, store root, key ID, and expiry/revocation owner. WooCommerce keys
inherit the associated WordPress user’s roles/capabilities.

- `read`: required for catalog, variation, order, refund, and status polling. Use this
  for the initial connection and `MANUAL_REVIEW`.
- `write`: only when a narrowly scoped operation needs writes and the adapter/provider
  supports it; do not use it as a substitute for a read permission.
- `read_write`: required when the approved connector both reads and updates channel stock
  or another approved resource. It is not required merely to receive webhooks.

Do not use query-string credentials except as a last-resort HTTPS compatibility measure;
the key and secret can leak into URLs and logs. Prefer HTTPS Basic authentication as
documented by WooCommerce. HTTP requires the documented one-legged OAuth 1.0a signing
flow and is not an acceptable production setup for this connector.

### Woo webhooks

In **WooCommerce > Settings > Advanced > Webhooks**, create active webhooks with:

- an HTTPS PennyWise Accounting callback URL;
- a dedicated random webhook secret, not a reused application secret;
- the minimum topics needed for the installation, normally `product.updated`,
  `order.created`, and `order.updated` for review-first operations;
- a delivery record and owner for the initial ping and failure history.

WooCommerce sends a ping when an active webhook is first saved. Verify the ping and each
delivery from the exact raw body using the configured secret and the WooCommerce signature
header (`X-WC-Webhook-Signature`, HMAC-SHA256/base64). Reject invalid signatures, wrong
store installations, malformed JSON, and replayed delivery IDs. Persist only redacted
evidence and the verification result. A refund is obtained from the order/refund REST
resources; do not invent a refund webhook topic.

Use the official [WooCommerce webhooks guide](https://woocommerce.com/document/webhooks/)
for topic, delivery URL, secret, activation, and delivery-history administration.

### Woo polling and stock

Use `/wp-json/wc/v3/products`, the variation resource described by the products reference,
and `/wp-json/wc/v3/orders` with bounded pagination and an overlap window. Poll catalog
and order changes at a configured cadence recorded in connector health; a 15-minute
staging default is acceptable only after rate-limit and response-time checks. Poll after
webhook outages, after a failed callback, and before resolving a revision conflict.

For a stock write, require an exact reviewed product/variation mapping, one PennyWise Accounting
location, a current channel revision, and `LOCAL` authority. Send only the approved
quantity operation, verify the response, and re-poll the resource. If the response is
lost, read the resource before retrying. A concurrent channel edit becomes a conflict;
never overwrite it to make counts match.

## Etsy setup

### App and OAuth requirements

Create or select the authorized Etsy app in the Etsy developer portal. The callback must
be HTTPS and registered exactly, including path and trailing slash. Etsy Open API v3
requires OAuth 2.0 authorization code flow with PKCE on every authorization request.
Generate a fresh state and S256 code verifier/challenge per installation, validate state
on return, exchange the one-time code server-side, and store encrypted access/refresh
tokens. Refresh before expiry and rotate/revoke the old token family according to the
connector’s credential policy.

Every API request needs `Authorization: Bearer <access token>` and
`x-api-key: <keystring>:<shared secret>`. The access token response documents a one-hour
access-token lifetime; do not expose either token or the shared secret to the browser.

Use the official [Etsy authentication guide](https://developers.etsy.com/documentation/essentials/authentication/)
and [Etsy API reference](https://developers.etsy.com/documentation/reference/) to confirm
the required scope for each endpoint at installation time. Scope changes require a new
authorization-code grant.

### Scope matrix

Request only the scopes needed by the enabled operations. The following is the controlled
PennyWise Accounting baseline; the API reference remains authoritative if an endpoint changes:

| Operation                                                                   | Scope(s)                                                            | Write enabled?                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| Shop identity/description needed to bind the installation                   | `shops_r`                                                           | No                                      |
| Listing/catalog and inactive/expired listing discovery                      | `listings_r`                                                        | No                                      |
| Listing inventory and offering quantity update                              | `listings_w` in addition to the read scope required by the endpoint | Only with `LOCAL` and explicit approval |
| Receipt/order, transaction, payment, and ledger evidence                    | `transactions_r`                                                    | No                                      |
| Listing creation/editing/deletion, shop editing, address, profile, or email | Not requested for PennyWise Accounting catalog/order review         | No                                      |

The official listing tutorial currently documents `listings_r listings_w` for its listing
endpoints and `listings_w` for inventory updates; the payments tutorial documents
`transactions_r`. Do not add `listings_d`, `shops_w`, `address_r`, `profile_r`, or
`email_r` for convenience. If a seller wants a capability outside this matrix, stop for
a separate provider/security review.

### Etsy webhooks

In **Manage your apps > commercial app > Webhook portal**, add an HTTPS callback and only
the required events: `order.paid`, `order.canceled`, `order.shipped`, and
`order.delivered`. Record the event, callback URL, subscription ID, creation time, and
masked secret. Prefer disabling an endpoint during a staged pause; deletion is permanent
in Etsy’s portal and removes its delivery history.

For every POST, retain the raw body only in protected short-lived processing memory or
redacted evidence. Verify:

1. `webhook-id`, `webhook-timestamp`, and `webhook-signature` exist;
2. `abs(current_unix_time - webhook-timestamp) <= 300` seconds;
3. the signed content is `webhook-id + "." + webhook-timestamp + "." + raw_body`;
4. the HMAC-SHA256 over that content with the base64-decoded secret (after removing
   `whsec_`) matches one of the signature values.

Only then parse the JSON and enqueue it. Etsy retries failed deliveries on its documented
schedule (immediately, 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, and twice at
10 hours). Acknowledge only after durable enqueue; the PennyWise Accounting event identity still
deduplicates retries and coalesces the webhook with a poll observation.

Read the official [Etsy webhooks guide](https://developers.etsy.com/documentation/essentials/webhooks/),
[listing and inventory tutorial](https://developers.etsy.com/documentation/tutorials/listings/),
and [payments and ledger tutorial](https://developers.etsy.com/documentation/tutorials/payments/).

### Etsy polling and stock

Poll the shop’s listings/inventory with bounded pagination and poll receipts plus payment
and ledger evidence with the provider’s supported time/offset parameters. Keep an overlap
window and a durable checkpoint; a webhook only identifies the resource that must be
re-read. For inventory, identify the exact `listing_id`, product, and offering. Etsy
inventory is a list of products with nested offerings and property values, so a write
must change only the approved offering. The inventory update body represents the
complete products/offering set: read the current set, change only the approved offering,
preserve unchanged products and offerings, submit the complete safe body, and verify it
by read-back. Do not send a one-off partial array that could remove or overwrite siblings.

Use `LOCAL` only after the Etsy stale-write guard passes: immediately before a full
inventory replacement, the live offering quantity must equal the last reviewed
`expectedQuantityMicros`. If the live value differs, the connector returns
`CONNECTOR_INVENTORY_CHANGED`; do not retry the replacement blindly. Refresh the listing,
recalculate the expected quantity, and require a new review. If the provider response is
lost, re-read before retrying the same idempotent operation. If the listing has multiple
offerings, no SKU, a changed property signature, or a concurrent update, hold
`MANUAL_REVIEW`.

## Staging acceptance and rollback

### Staging acceptance

Run this sequence with fictional or owner-controlled test data:

1. connect read-only, verify tenant and store/shop identity, and run a one-page catalog
   poll;
2. capture a simple item, variable/multi-offering item, missing/duplicate SKU, paid order,
   cancellation, partial/full refund, shipping, discount, tax, fee, and payout evidence;
3. exercise each webhook with a valid signature, invalid signature, stale/replayed
   delivery, duplicate delivery, out-of-order event, and provider retry;
4. confirm poll and webhook observations coalesce to one canonical resource/revision;
5. review every mapping, tax rate, remitter decision, and inventory difference;
6. if stock writes are approved, send one bounded quantity change, verify it by re-read,
   simulate response loss and rate limit, and confirm idempotent retry;
7. verify zero journals, invoices, payments, POS events, tax filings, remittances, and
   opening-stock entries were created by the connector.

Do not declare production readiness from synthetic examples alone. Record sanitized,
owner-authorized fixtures, hashes, provider version, endpoint, scope, capture date, and
redaction review as evidence.

### Safe rollback

To pause safely: disable `LOCAL`/`CHANNEL` writes, stop the connector worker, leave polling
in `MANUAL_REVIEW`, and preserve the last checkpoint and open conflicts. Disable the
provider webhook endpoint or remove the callback route only after the queue is drained or
marked paused. Revoke/rotate provider keys, OAuth tokens, and webhook secrets if exposure
is suspected. Never delete normalized evidence needed for reconciliation.

To resume, fix the cause, restore credentials through the secret manager, verify the
callback, poll from an overlap window, re-check conflicts, and send no queued write until
an operator explicitly re-approves it. To reverse an already accepted stock write, use a
new reviewed quantity operation based on the current provider state; do not edit history
or replay the old request blindly.

## Troubleshooting

| Symptom                      | Check first                                                                     | Operator action                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Woo `401`/`403`              | Store root, pretty permalinks, key permission, associated WordPress user, HTTPS | Revoke and recreate a dedicated least-privilege key; do not paste secrets into logs                       |
| Woo `404` or `501`           | `/wp-json/wc/v3`, REST reachability, permalink/server method configuration      | Correct WordPress/Woo routing and retry a read-only health check                                          |
| Woo webhook not arriving     | Active status, HTTPS callback, initial ping, topic, delivery history            | Fix callback and replay through a poll; do not assume missed webhooks are recoverable from delivery alone |
| Etsy authorization fails     | Exact HTTPS redirect, state, PKCE verifier/challenge, app keystring             | Restart OAuth; do not reuse a code or print tokens                                                        |
| Etsy `403`                   | Actual token scope and `x-api-key` header                                       | Re-authorize with only the endpoint’s required scope; keep writes disabled                                |
| Etsy webhook rejected        | Raw body, three headers, secret decoding, 300-second timestamp window           | Reject and investigate; poll the referenced receipt/listing instead                                       |
| Duplicate order or event     | Provider/install/resource/revision identity and delivery ID                     | Coalesce to the canonical event; never create a second local transaction                                  |
| Unknown SKU/variant/offering | Stable provider IDs, variation/property signature, confirmed mapping            | Leave `MANUAL_REVIEW`; do not use fuzzy matching for a write                                              |
| Quantity mismatch            | Location, reservations, bundles, returns, cancellation, last revision           | Pause writes and reconcile; choose one authority policy explicitly                                        |
| Tax or remitter mismatch     | Rate-level map, destination, registration, marketplace report, fee tax          | Block review with `TAX_RATE_MAPPING_REQUIRED` or `TAX_REMITTANCE_CONFIRMATION_REQUIRED`                   |
| Repeated 429/5xx             | Provider delivery history, rate limits, `Retry-After`, worker backlog           | Exponential backoff and bounded retry; preserve checkpoint; escalate after dead-letter                    |

## Official references

- [WooCommerce REST API authentication](https://developer.woocommerce.com/docs/apis/rest-api/authentication)
- [WooCommerce REST API](https://developer.woocommerce.com/docs/apis/rest-api/)
- [WooCommerce webhooks](https://woocommerce.com/document/webhooks/)
- [WooCommerce orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/)
- [WooCommerce products](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/)
- [Setting up taxes in WooCommerce](https://woocommerce.com/document/setting-up-taxes-in-woocommerce/)
- [WooCommerce Tax](https://woocommerce.com/document/woocommerce-shipping-and-tax/woocommerce-tax/)
- [Etsy authentication](https://developers.etsy.com/documentation/essentials/authentication/)
- [Etsy API reference](https://developers.etsy.com/documentation/reference/)
- [Etsy listings and inventory](https://developers.etsy.com/documentation/tutorials/listings/)
- [Etsy webhooks](https://developers.etsy.com/documentation/essentials/webhooks/)
- [Etsy payments and ledger](https://developers.etsy.com/documentation/tutorials/payments/)
- [Etsy Canadian tax remittance guidance](https://help.etsy.com/hc/en-us/articles/6633345416215-What-Does-Etsy-Remit-to-Canadian-Tax-Authorities?segment=selling)
- [Etsy U.S. sales-tax and fee guidance](https://help.etsy.com/hc/articles/360000343968?segment=selling)
