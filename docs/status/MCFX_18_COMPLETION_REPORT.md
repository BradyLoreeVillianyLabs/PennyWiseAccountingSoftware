# MCFX-18 completion report

Status: IMPLEMENTED (FIXTURE-BACKED) — LIVE PROVIDER EVIDENCE GATED

## Implemented shadow scope

ClearLedger now includes a native WooCommerce REST API v3 adapter and web
workspace. It validates a public HTTPS store and core WooCommerce consumer
credentials, supports multiple stores per organization, imports bounded pages
of orders ordered by modification time, hydrates refunds, and stages provider
evidence through the provider-neutral commerce inbox.

The normalized schema preserves exact WooCommerce decimal strings and currency
precision; orders, edits, cancellations, products/variations, SKUs, coupons,
discounts, shipping, fees, taxes, payment methods, and refunds are visible.
Unknown SKU/tax mappings, unsupported currency, invalid precision, and
reconciliation differences become explicit review issues instead of guessed
accounting.

Synchronization is checkpointed, replay-safe, rate-limit aware, and protected
by a short lease. A request is bounded to a completed range of 90 days or less,
10 pages or fewer, and at most 100 records per page. Provider HTTP occurs
outside database transactions. Credentials are encrypted, responses never
return secrets, and operational evidence is redacted.

WooCommerce raw-body HMAC verification is implemented for `order.created`,
`order.updated`, and `order.deleted`. ClearLedger can create those webhooks when
the consumer key has read/write permission; polling and health checks require
only read permission. WooCommerce core does not provide universal processor
fee or payout data, so settlement scope reports that limitation rather than
inventing payout evidence.

## Safety and privacy result

The adapter is fixed to `SHADOW_REVIEW`. A synchronization reports
`accountingEntriesCreated: 0`. It cannot create invoices, payments, inventory
movements, tax entries, journals, clearing entries, or bank deposits. Provider
payload storage removes buyer contact and address fields that accounting
normalization does not need; immutable event identity, version, payload, and
fingerprint remain available for review.

CAD and USD are the released accounting currencies. Other valid ISO currencies
can be staged but receive a blocking `CURRENCY_NOT_RELEASED` issue and cannot
post.

## Remaining live gate

No separately supplied WooCommerce test-store credentials were used, and no
claim of live provider reconciliation is made. Live acceptance still requires
a named test store, least-privilege credentials, a bounded shadow comparison of
order/refund/component totals and mappings, and webhook delivery evidence where
webhooks are in scope.

The controlled Loclx share can run polling, but its Basic Authentication
challenge prevents WooCommerce servers from delivering webhooks. Live webhook
evidence requires a separate minimal signed-webhook ingress or production
path-specific proxy. The operational QBWooBridge was not inspected, called,
imported, or modified.
