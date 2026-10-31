# MCFX-19 completion report

Status: IMPLEMENTED (FIXTURE-BACKED) — LIVE PROVIDER EVIDENCE GATED

## Implemented shadow scope

ClearLedger now includes a direct Etsy Open API v3 adapter and web workspace.
It starts authorization-code OAuth with S256 PKCE, validates one-time state and
expiry, requests only `shops_r transactions_r`, encrypts access/refresh tokens,
refreshes expiring tokens, validates the shop identity, and supports multiple
Etsy shops per ClearLedger organization.

Bounded synchronization imports updated receipts, receipt transactions,
payments/refunds, and payment-account ledger entries. Exact Etsy Money
`amount`/`divisor`/`currency_code` evidence is retained without binary floating
point. Orders, shipping, discounts, taxes, payments, refunds, fees, ledger
entry types, references, and payout IDs are normalized where Etsy supplies
them. Missing mappings, unsupported currency, invalid precision, and
unreconciled totals become visible review issues.

Synchronization uses checkpoints, short leases, encrypted token rotation,
bounded retry/backoff, provider rate-limit metadata, and replay-safe immutable
inbox identity. A request is limited to a completed range of 90 days or less,
10 pages or fewer, and at most 100 records per page.

Etsy webhook verification supports the provider signature/timestamp/replay
contract for the supported order events. Webhook setup remains a manual Etsy
Webhook Portal operation using the generated URL and signing secret.

## Safety, privacy, and platform boundary

The adapter is fixed to `SHADOW_REVIEW` and reports zero accounting entries. It
cannot create invoices, payments, inventory movements, tax entries, journals,
marketplace clearing entries, or bank deposits. Buyer-email access is not
requested. Stored provider payloads redact buyer contact, personal name, and
address fields that accounting normalization does not require.

CAD and USD are the released accounting currencies. Other valid ISO currencies
can be staged but receive a blocking `CURRENCY_NOT_RELEASED` issue and cannot
post.

An Etsy application is required. Etsy Commercial Access review is an external
provider gate before broad multi-seller distribution; ClearLedger cannot
self-approve it. The term “Etsy” is a trademark of Etsy, Inc. ClearLedger uses
the Etsy API but is not endorsed or certified by Etsy, Inc.

## Remaining live gate

No supplied Etsy app credentials or test shop were used, no Etsy network
traffic was represented as verification, and no live reconciliation claim is
made. Live acceptance requires an approved test app/shop, OAuth and refresh
evidence, bounded receipt/payment/ledger reconciliation, rate-limit evidence,
and webhook delivery evidence where webhooks are in scope.

The controlled Loclx share supports the browser OAuth redirect and polling,
but its Basic Authentication challenge prevents Etsy's webhook servers from
delivering events. Live webhook evidence requires a separate minimal
signed-webhook ingress or production path-specific proxy.
