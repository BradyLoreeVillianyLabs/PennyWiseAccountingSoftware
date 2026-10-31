# PennyWise Accounting Developer API v1

`/v1` is the supported integration API. Its machine-readable contract is
available at `/openapi.json`; responses from `/v1/*` and `/openapi.json` carry
`x-clearledger-api-version: 2026-07-29`.

## Compatibility

- Additive fields, new optional routes, and new enum values may be introduced
  within v1. Breaking changes require a new major API path and migration guide.
- Treat all UUID path and response IDs as opaque, stable identifiers for the
  lifetime of their resource. Do not infer database structure from them.
- Timestamps are RFC 3339. Money and exact quantities are strings where
  precision matters; never parse them through binary floating point.
- `x-request-id` is returned on every response. Supply a valid request ID to
  correlate your own logs, or retain the server-provided value for support.

## Authentication and organization scope

- Organization-owned server integrations use a named `cl_live_...` credential.
- Third-party applications use OAuth Authorization Code + S256 PKCE. OAuth
  access tokens begin `cl_oat_`, are short-lived, and refresh tokens rotate.
- API credentials and OAuth applications are fixed to the organization that
  approved them. Organization context is never accepted from a JSON body.
- Request only the smallest scope. OAuth cannot receive integration management,
  webhook control, high-risk posting, payment, financial-import, or export
  scopes. Those actions remain interactive-user controls.

## Supported v1 resources

| Resource group          | Supported use                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Organizations           | Read current organization and membership-scoped context.                                                             |
| Customers and products  | Read/create/manage customer and item master data.                                                                    |
| Estimates and invoices  | Read and create drafts; use existing approval/posting controls only when the granted scope permits them.             |
| Payments and bills      | Read operational state; sensitive payment and posting actions remain scope- and assurance-controlled.                |
| Attachments             | List/read authorized document attachments; use documented upload routes and media limits.                            |
| Projects and planning   | Read/manage projects, time, non-posting work items, dependencies, and the read-only calendar projection.             |
| Bank-import drafts      | Create, preview, and review bounded imports; financial commits remain controlled operations.                         |
| Multi-currency settings | Configure the released CAD/USD boundary and immutable manual rate snapshots; other foreign posting remains disabled. |
| Commerce inbox          | Stage provider-neutral, replay-safe non-posting commerce events for human review.                                    |
| Inventory operations    | Manage stock workflows, local product thumbnails, bin-ordered picking slips, and short-pick review records.          |
| Reports and exports     | Read reports and request/download authorized exports; export tokens are never returned in listing responses.         |

The OpenAPI document is the route-level source of truth. Provider tokens,
session material, raw payment secrets, and internal security metadata are never
part of this public contract.

Multi-currency keeps the organization base currency immutable. The released
accounting pair is CAD/USD with controlled manual rate snapshots. Connector
events in any other valid ISO currency can be preserved as review evidence,
but receive a blocking `CURRENCY_NOT_RELEASED` issue and cannot post.
Precision-sensitive rates, amounts, divisors, and IDs are strings. Commerce
inbox records are staging evidence only and cannot create accounting entries.

`GET /v1/settings/multi-currency/rate-suggestion` is an authenticated,
organization-scoped preview helper for a direct USD transaction / CAD base
orientation. Supply `date=YYYY-MM-DD&transactionCurrency=USD`. PennyWise Accounting
queries only the fixed Bank of Canada Valet `FXUSDCAD` endpoint for the seven
calendar days ending on that date and returns the latest published observation
on or before it. The response preserves the provider observation date and
decimal, reduced numerator/denominator strings, request provenance, retrieval
time, and an indicative disclaimer. It always reports `persisted: false` and
`accountingEntriesCreated: 0`; callers must not treat it as an approved rate.
Saving still requires a separate, explicit manual snapshot request through
`POST /v1/settings/multi-currency/rates`.

## Native commerce connector operations

WooCommerce and Etsy adapters are available to interactive organization users
through the connector runtime. API credentials and third-party PennyWise Accounting
OAuth clients cannot receive `integrations:manage`; they cannot connect,
reconnect, pause, disconnect, or rotate provider credentials.

Owners and administrators have connector-management permission. Accountants
may read connector status. Owners, administrators, accountants, and
bookkeepers may review commerce inbox evidence; read-only members may view the
inbox but cannot change its review state.

| Route                                                                              | Purpose                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /v1/organizations/current/connectors/providers`                               | Return native provider capabilities, connection requirements, and external gates. |
| `POST /v1/organizations/current/connectors`                                        | Create a provider installation draft. Multiple stores per provider are supported. |
| `POST /v1/organizations/current/connectors/{id}/connect`                           | Validate and encrypt WooCommerce credentials and record a bounded backfill range. |
| `POST /v1/organizations/current/connectors/{id}/etsy/oauth/start`                  | Start Etsy authorization-code OAuth with S256 PKCE.                               |
| `POST /v1/organizations/current/connectors/{id}/etsy/oauth/complete`               | Validate OAuth state, exchange the code, and commit encrypted rotating tokens.    |
| `PATCH /v1/organizations/current/connectors/{id}/mapping`                          | Optimistically update customer, SKU, and tax mappings using `version`.            |
| `POST /v1/organizations/current/connectors/{id}/sync`                              | Run a bounded, checkpointed, non-posting synchronization.                         |
| `POST /v1/organizations/current/connectors/{id}/catalog/poll`                      | Poll a bounded provider catalog into review without creating accounting.          |
| `POST /v1/organizations/current/connectors/{id}/catalog/ingest`                    | Ingest a validated catalog observation supplied by an authorized workflow.        |
| `GET /v1/organizations/current/catalog`                                            | List external variants, product links, images, and review state.                  |
| `GET /v1/organizations/current/catalog/variants/{variantId}/candidates`            | Return explainable, scored local-product candidates.                              |
| `POST /v1/organizations/current/catalog/variants/{variantId}/candidates`           | Recompute bounded candidates from normalized identifiers and history.             |
| `POST /v1/organizations/current/catalog/candidates/{candidateId}/confirm`          | Explicitly confirm a proposed external-to-local product link.                     |
| `POST /v1/organizations/current/catalog/candidates/{candidateId}/reject`           | Reject a proposed candidate while retaining evidence.                             |
| `POST /v1/organizations/current/catalog/variants/{variantId}/create-local-product` | Create and explicitly link a local item from reviewed provider evidence.          |
| `POST /v1/organizations/current/catalog/images/{imageId}/approve`                  | Approve a provider image for separately validated ingestion.                      |
| `POST /v1/organizations/current/catalog/images/{imageId}/reject`                   | Reject a provider image suggestion.                                               |
| `POST /v1/organizations/current/catalog/images/{imageId}/ingest`                   | Fetch and store an approved image through media and network safety checks.        |
| `GET /v1/organizations/current/inventory-sync`                                     | List policies, observations, conflicts, and retryable operations.                 |
| `PUT /v1/organizations/current/inventory-sync/policies`                            | Replace explicit per-channel inventory sync policies.                             |
| `POST /v1/organizations/current/inventory-sync/policies/{policyId}/observations`   | Record an idempotent provider quantity observation.                               |
| `POST /v1/organizations/current/inventory-sync/conflicts/{conflictId}/resolve`     | Ignore, adopt, or queue a reviewed conflict resolution.                           |
| `POST /v1/organizations/current/inventory-sync/operations/{operationId}/retry`     | Retry an eligible failed operation.                                               |
| `POST /v1/organizations/current/inventory-sync/operations/process`                 | Process a bounded batch of explicitly authorized inventory operations.            |
| `POST /v1/organizations/current/connectors/{id}/webhooks/register`                 | Create supported WooCommerce webhooks when the Woo key has read/write access.     |
| `PUT /v1/organizations/current/connectors/{id}/webhook-secret`                     | Store an Etsy Webhook Portal signing secret.                                      |
| `POST /v1/organizations/current/connectors/{id}/pause`                             | Stop synchronization while retaining credentials and evidence.                    |
| `POST /v1/organizations/current/connectors/{id}/resume`                            | Return a paused connector to ready state.                                         |
| `POST /v1/organizations/current/connectors/{id}/disconnect`                        | Remove provider credentials while retaining imported evidence.                    |
| `POST /v1/webhooks/commerce/{provider}/{id}`                                       | Receive a provider-signed WooCommerce or Etsy webhook.                            |
| `GET /v1/imports?importType={type}&limit={1..25}`                                  | List recent company-scoped import-batch summaries for the selected import type.   |
| `GET /v1/imports/{batchId}`                                                        | Read one company-scoped import batch to resume the Switching Centre workflow.     |
| `GET /v1/imports/{batchId}/item-match-suggestions?offset={n}&limit={1..25}`        | Page non-authoritative product or opening-inventory spreadsheet suggestions.      |
| `POST /v1/imports/{batchId}/commit`                                                | Claim the commit lease and commit a successful dry run.                           |
| `POST /v1/imports/{batchId}/resume`                                                | Resume a retryable or stale-lease financial import by deterministic unit.         |
| `GET /v1/imports/{batchId}/attempts`                                               | Read company-scoped current commit-unit attempt state.                            |
| `PUT /v1/imports/{batchId}/source-controls`                                        | Persist source report identity and required control totals for reconciliation.    |
| `POST /v1/imports/{batchId}/acknowledge`                                           | Finalize a committed import after its required source controls match.             |

Catalog candidate generation is source-neutral: WooCommerce, Etsy, demo,
spreadsheet, and future adapters first persist the same external product and
variant model. The matcher then compares normalized variant SKU and name plus
the parent product description with active local `ProductItem` SKU, name, and
description fields. Version 2 reasons expose `matches`, nullable
`skuSimilarityBasisPoints`, `nameSimilarityBasisPoints`, and
`descriptionSimilarityBasisPoints`, `compositeSimilarityBasisPoints`, and
`autoConfirmEligible: false`. Exact evidence uses `EXACT_GTIN`,
`EXACT_MANUFACTURER_PART_NUMBER`, or the compatibility code `NORMALIZED_SKU`;
fuzzy evidence uses `SKU_SIMILARITY`, `NAME_SIMILARITY`, or
`DESCRIPTION_SIMILARITY`. Every candidate, including an exact-identifier
candidate, remains a suggestion until an authorized user explicitly confirms
it. See [the catalog matching contract](./CATALOG_MATCHING_CONTRACT.md) for the
deterministic scores and retrieval bounds.

Catalog polling, authorized manual catalog ingestion, and the development commerce
demo automatically use that matcher for at most 50 observed variants and 10
candidates per variant. Deferred variant IDs are explicit and can be evaluated with
the per-variant candidate route. A confirmed candidate atomically feeds separate
provider-scoped catalog variant, stable-alias, unambiguous product, and SKU maps.
Conflicting manual or confirmed targets persist a connector conflict and return 409;
they are never overwritten. Order polling and webhooks consume only those prior
exact/manual confirmations and never fuzzy-match a line inline.

WooCommerce requires a public HTTPS store root plus a `ck_...` consumer key and
`cs_...` consumer secret. A read-only key is sufficient for health checks and
polling. Read/write is required only to let PennyWise Accounting create webhooks through
WooCommerce REST API v3. Store URLs are subject to HTTPS, redirect, DNS,
private-address, credential, query-string, timeout, response-size, and bounded
retry controls.

Etsy requires an app key/keystring and shared secret. The OAuth request asks
only for `shops_r transactions_r`, uses an exact registered HTTPS redirect URI,
and expires its pending state after ten minutes. Access tokens refresh through
the provider and are rotated in encrypted storage. Buyer-email access is not
requested. Broad multi-seller distribution remains subject to Etsy Commercial
Access review.

Synchronization accepts an optional completed `from`/`to` range of at most 90
days, `pageSize` from 1 to 100, `maxPages` from 1 to 10, and `scope` of
`ORDERS`, `SETTLEMENTS`, or `ALL`. Defaults are 30 days, 50 records, three
pages, and all provider-supported scopes. The initial range must stay within
the backfill consent recorded at connection. Later default ranges begin five
minutes before `lastSyncAt` so provider edits can replay safely.

`maxPages` is a per-request budget shared across the requested scopes. When
that budget is exhausted, the response has `complete: false`, `hasMore: true`,
and a `continuation` containing an opaque token, the fixed window, page size,
and remaining scopes. Resume with `continuationToken` and a new `maxPages`
budget; if `pageSize` is supplied again, it must match the saved plan. A
continuation cannot change its provider, date range, or requested scopes.
`lastSyncAt` advances only after every scope in that fixed plan is complete.

A short database lease prevents overlapping requests; provider HTTP is
performed outside the lease-acquisition and accounting transactions.
Checkpoints are advanced after each ingested page. Replays return the existing
immutable event instead of duplicating it.

Every normalized event declares schema version 1 and separates source,
payment, and settlement currencies; exact provider money; lines; taxes;
shipping; discounts; fees; payments; refunds; settlement references; mapping
state; reconciliation difference; and blocking/warning issues. WooCommerce
decimal strings and Etsy integer amount/divisor objects retain their provider
representation. Imported provider payloads redact buyer contact and address
objects, buyer identifiers, network identifiers, customer notes, arbitrary
metadata, order access keys, and secret-like fields that normalization does not
require. Verified webhook audit events have no interactive actor and instead
record provider, installation, and verified-delivery identity.

The synchronization response always reports `postingMode: SHADOW_REVIEW` and
`accountingEntriesCreated: 0`. Neither adapter calls invoice, payment,
inventory, tax-posting, journal, or bank-settlement services. Reviewing an
event changes only inbox review metadata.

Catalog candidate scores are suggestions, not identity. Exact SKU or provider IDs,
normalized identifiers, historical confirmations, titles, and option values contribute
explainable evidence. A candidate remains `PROPOSED` until an authorized user confirms
or rejects it. Provider images likewise remain references until approval and guarded
ingestion. Inventory policies declare the authoritative direction per connector and
variant; divergence becomes a visible conflict or queued operation rather than a
silent overwrite. None of these catalog or inventory-review routes creates a journal.

## Local product images and picking slips

The product image and picking-slip routes are organization-scoped and use the
existing permission and tenant controls. Product image uploads are binary requests
with an `image/png`, `image/jpeg`, or `image/webp` content type. They accept at most
5 MiB and 4,096 pixels per axis / 16,777,216 pixels total; the response identifies a
local JPEG thumbnail. `GET /v1/products/{productId}/image` returns that thumbnail
inline for downstream rendering. Provider catalog images use the separate review
sequence: approve first, then ingest through the bounded fetch path.

| Route                                               | Purpose                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST /v1/products/{productId}/image`               | Validate and store an idempotent local product-image thumbnail.        |
| `GET /v1/products/{productId}/image`                | Read the latest authorized local product-image thumbnail.              |
| `POST /v1/invoices/{invoiceId}/picking-slip`        | Generate or return the stable picking slip for a posted invoice.       |
| `POST /v1/pos/sales/{saleId}/picking-slip`          | Generate or return the slip for a completed sale linked to an invoice. |
| `GET /v1/picking-slips/{pickingSlipId}`             | Read line snapshots, generations, and short-pick review history.       |
| `GET /v1/picking-slips/{pickingSlipId}/pdf`         | Read the current locally rendered PDF for browser printing.            |
| `POST /v1/picking-slips/{pickingSlipId}/reprint`    | Render a traceable new generation without a new slip identity.         |
| `POST /v1/picking-slips/{pickingSlipId}/short-pick` | Record picked quantities and create count-review work for shortfalls.  |

Picking-slip quantities are precision-safe strings. The document is operational:
generation, reprint, and short-pick review create no invoice posting, journal,
inventory movement, or automatic on-hand change. Short-pick review is resolved later
through the existing count and adjustment workflow. The browser may print the inline
PDF locally; no print server, carrier, scanner hardware, or cloud rendering service is
part of this contract.

## Shipping labels

Shipping is organization-scoped and operator-owned. The API never holds a PennyWise
postage balance or buys postage on a platform account. Carrier credentials are encrypted
and are not returned by listing or shipment routes. The fixture carrier is for tests only;
the first real adapter is Canada Post. See `docs/SHIPPING_CARRIER_OPERATIONS.md` for
credential, customs, printing, and live-verification boundaries.

| Route                                                | Purpose                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /v1/shipping/carrier-accounts`                  | List connected carrier-account summaries without secrets.          |
| `POST /v1/shipping/carrier-accounts`                 | Validate and encrypt an operator-owned carrier credential.         |
| `POST /v1/shipping/carrier-accounts/{id}/deactivate` | Disable a carrier account for new shipments.                       |
| `POST /v1/invoices/{invoiceId}/shipment`             | Create a draft shipment from a posted invoice.                     |
| `POST /v1/pos/sales/{saleId}/shipment`               | Create a draft shipment from a completed POS sale.                 |
| `GET /v1/shipments/{shipmentId}`                     | Read shipment, parcel, label, tracking, void, and inventory links. |
| `POST /v1/shipments/{shipmentId}/quote`              | Validate addresses/customs and store a carrier quote.              |
| `POST /v1/shipments/{shipmentId}/purchase`           | Explicitly confirm the exact quote and buy one label.              |
| `GET /v1/shipment-labels/{labelId}`                  | Return the stored PDF or ZPL artifact inline for browser printing. |
| `POST /v1/shipments/{shipmentId}/void`               | Send a carrier-governed void request and record its answer.        |
| `POST /v1/shipments/{shipmentId}/track`              | Refresh and deduplicate carrier tracking events.                   |

Purchase confirmation requires the shipment version, `confirmed: true`, exact service
code, quoted cost/currency, expense and paying accounts, method, and expense date. The
carrier purchase key is stable per shipment; ambiguous results enter reconciliation before
retry. The returned cost is posted through the existing immediate-expense workflow and
linked by `shippingExpenseId`. Cross-border requests refuse before the carrier call when
the operator has not supplied HS code, origin, quantity, and declared value/currency for
each source line. PennyWise does not classify goods or calculate duty.

## Project work items and calendar

`GET /v1/project-work-items` returns at most 500 organization-scoped tasks, milestones,
and reminders, optionally filtered by project, assignee, kind, status, or archive state.
Create, update, status, archive, and dependency routes require `projects:manage` and use
positive optimistic versions. Dependencies remain in one organization, cannot point to
the same item, and cannot form a cycle. Milestones require a due date.

`GET /v1/calendar/events?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` is a bounded,
read-only projection over project dates, work items, invoice due dates, and bill due
dates. Every event declares source authority and whether it is financial. Moving a
work item updates that planning record only; calendar data never creates or edits a
journal, invoice, bill, tax result, or inventory movement.

## Switching Centre import provenance

### Recent batches and resume

`GET /v1/imports?importType={type}&limit={1..25}` returns
`{ "batches": [...] }`, an array of recent import-batch summaries for the
selected company and import type. `limit` defaults to 10 and is bounded from 1
through 25. Each summary includes the batch `id`, `importType`, `sourceSystem`,
`status`, `sourceFilename`, timestamps, and `rowCount`; it is summary metadata,
not the imported rows themselves.

The route is company-scoped as well as organization-scoped: a company must be
selected, and batches from another company are not returned. Access is also
permission-scoped by import type. Master-data types require
`data-imports:master`; financial types require `data-imports:financial`. A
caller without the permission for the requested type receives `403`.

The Switching Centre resumes a listed batch by calling
`GET /v1/imports/{batchId}`. That response contains the saved batch and its
mapped rows and persisted `sourceMetadata` so the browser can restore the
source, import type, preview, selected XLSX sheet, parser warnings, and saved
workflow stage. This GET is read-only: opening or resuming a batch does not
upload a file, change the batch status, or mutate accounting records.
Continue only through the explicit preview, dry-run, commit, and acknowledgement
operations. Commit remains the operation that can create reviewed records.

### XLSX provenance

When the uploaded file is XLSX, the batch stores `sourceMetadata` with this
shape:

```json
{
  "format": "XLSX",
  "sheet": {
    "name": "Invoices",
    "index": 0,
    "availableSheetCount": 3
  },
  "warnings": ["Formula in Invoices row 7 was imported from its cached value."]
}
```

The example is illustrative; clients must treat the returned values as source
evidence. PennyWise selects the first worksheet with a header and at least one
data row and does not merge worksheets. Warnings describe parser observations,
not accounting validation or source correctness. Uncached formula cells and
external formula references are rejected. `sourceMetadata` is persisted with
the batch and is not rewritten when a user opens or resumes it. No guarantee is
made for macros, formatting, external links, formulas beyond their accepted
cached values, or unselected sheets.

### Source controls and acknowledgement

For `OPENING_BALANCES`, `OUTSTANDING_INVOICES`, `OUTSTANDING_BILLS`, and
`INVENTORY_OPENING`, persist the source report control evidence with:

```http
PUT /v1/imports/{batchId}/source-controls
Content-Type: application/json
```

```json
{
  "sourceReportName": "Trial Balance at 2026-08-01",
  "sourceReportDate": "2026-08-01",
  "sourceReportChecksum": "<optional 64-character SHA-256>",
  "sourceDebitMinor": "1250000",
  "sourceCreditMinor": "1250000"
}
```

`sourceDebitMinor` and `sourceCreditMinor` are required only for
`OPENING_BALANCES`. The other three types require `sourceBalanceMinor` instead.
All amount fields are non-negative decimal strings in minor currency units.
The endpoint is permission- and company-scoped. It can be called before commit;
when called after commit, PennyWise recalculates the reconciliation evidence.
After acknowledgement, source controls are immutable.

Acknowledgement is intentionally a separate gate:

```http
POST /v1/imports/{batchId}/acknowledge
```

The batch must be `COMMITTED`. For the four source-control types, acknowledgement
requires `reconciliation.sourceControlStatus === "MATCH"`; missing evidence or
`"MISMATCH"` returns a conflict. A successful request changes the batch to
`RECONCILED`, stores `acknowledgedAt`, and records an audit event. This gate
compares the supplied report control total with PennyWise's relevant report; it
does not certify the originating system's report or replace an accountant's
review.

### Retryable commits, deterministic units, and leases

The import status `RETRYABLE` represents a recoverable commit failure after the
dry run. `COMPENSATION_REQUIRED` is different: it is terminal and cannot be
resumed, acknowledged, or moved back to an earlier state.

`POST /v1/imports/{batchId}/commit` may be called only from `DRY_RUN`. It claims
the batch's commit lease and sets `commitStartedAt` and
`commitLeaseExpiresAt`. The current lease duration is five minutes. A second
worker receives an in-progress conflict while the lease is live. A resume may
reclaim a `COMMITTING` batch only after `commitLeaseExpiresAt` has passed.

```http
POST /v1/imports/{batchId}/resume
GET  /v1/imports/{batchId}/attempts
```

Resume is permitted for `RETRYABLE` batches or stale `COMMITTING` batches. It
reuses the original deterministic idempotency keys and skips units already
recorded as successful. The attempts endpoint is read-only and exposes the
company-scoped current `DataImportCommitAttempt` records, including `unitKey`,
operation, attempt number, status, resource type/id, and error evidence where
present. The record is unique per unit; `attemptNumber` indicates retries and
the endpoint is not an append-only event log.

Commit units are stable across retries: simple row imports use
`row:<rowNumber>`; invoice groups use a SHA-256-derived unit from the explicit
external identifier (or the row fallback); bill groups use a SHA-256-derived
unit from vendor and document identity; opening balances use one
`opening-balances` unit; inventory opening uses a deterministic unit per source
row. Multi-line invoices and bills therefore remain one domain document per
group. The stable key is embedded in the migration idempotency key and is not
regenerated on resume.

These recovery controls protect against duplicate posting, but they do not make
an arbitrary external failure automatically safe. A successful domain post whose
attempt record cannot be reconciled must remain supervised; do not delete or
silently recreate the accounting resource.

Interactive import upload uses
`POST /v1/imports/upload?importType={type}&sourceSystem={source}` with raw
CSV or XLSX bytes and `x-file-name`. Supported source values are
`QUICKBOOKS_ONLINE`, `QUICKBOOKS_DESKTOP`, `XERO`, `WAVE`, `FRESHBOOKS`, `SAGE`,
`ZOHO_BOOKS`, and `OTHER`; the default is `OTHER`. The selected source is
immutable evidence.
An identical upload for the same organization, import type, and source reuses
the existing content-addressed batch. Identical content submitted with a
different source returns `409 IMPORT_SOURCE_MISMATCH` and does not relabel the
batch. Import routes remain unavailable to third-party OAuth clients.

After a `PRODUCTS` or `INVENTORY_OPENING` preview, the batch contains the first
bounded `itemMatchSuggestions` page with `nextOffset`, and the GET route above reads
subsequent pages from the already mapped batch. These suggestions always report
`authoritative: false` and `autoConfirmEligible: false`. Product import remains an
explicit create/review operation. Opening-inventory dry-run and commit still require
an exact tenant-scoped active SKU; the suggested nearest item is never used to post.

## Pagination, idempotency, and limits

- Cursor-based collection routes accept bounded `limit` values up to 100 and,
  where documented, an opaque `cursor`. Do not construct or decode cursors.
- Send `Idempotency-Key` for every create, posting, rotation, or retryable
  external operation. Reusing a key for different input returns a conflict.
- A one-time credential or rotated OAuth secret is never returned on an
  idempotent replay. Store the first response in your secret manager.
- Limits are route-specific and may tighten during abuse protection. Respect
  `429` responses with backoff; the OAuth token endpoint is additionally
  bounded to 30 requests per 10 minutes per client/IP subject.

## Webhooks

Register only HTTPS destinations in production. Webhook payloads are versioned,
have replay-safe event IDs, and use timestamped HMAC-SHA256 signatures. Verify
the timestamp and signature before processing, retain event IDs to deduplicate,
and use delivery inspection/replay controls instead of inventing a second
delivery channel.

The commerce webhook route uses the provider's native signature contract over
the exact raw request body, rate limiting, tenant-safe lookup, immutable event
identity, and replay deduplication. A provider UUID in the path is not
sufficient to ingest an event; signature verification must succeed first.

The controlled PennyWise browser-sharing server applies Basic Authentication to
every public application path before a request reaches the API. Provider webhook
servers cannot pass that browser challenge. For trusted integration testing, configure
`CONNECTOR_WEBHOOK_BASE_URL` with the separate HTTPS origin created by
`scripts/start-loclx-webhook-share.mjs`. That relay accepts only allowlisted
WooCommerce and Etsy webhook `POST` paths, preserves the provider-signed raw
body, and forwards to one loopback API; it does not expose organization APIs or
browser assets. Use one relay per API deployment and continue polling to catch
provider changes a webhook may omit. Production requires managed path-specific
ingress, supervision, monitoring, and stable DNS/TLS. Do not publish the
development API directly.

## Connector migration and rollout

Deploy `20260801010000_native_commerce_connectors` before running an API build
that exposes native connector controls. The migration adds multi-store
identity, mapping versions, sync leases, webhook lookup state, immutable raw
payload fingerprints, normalized schema versions, and commerce-webhook RLS
policies. Existing inbox evidence remains immutable. Existing connector drafts
remain but should be reconnected so the validated external account identity is
stored.

Set `CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET` from the environment's secret
manager before accepting real credentials. It must be stable, high entropy,
and at least 32 characters for a controlled LocalXpose share. Back up the
database, deploy the migration with the migration role, restart the API,
connect a test store, run a small date range, and confirm that inbox
counts/reconciliation match the provider while journal, invoice, payment, tax,
and inventory counts remain unchanged. Do not roll down after more than one
store for the same provider has been created; rollback deliberately refuses
that lossy transition.

In production, `CONNECTOR_WEBHOOK_BASE_URL` must also be a dedicated absolute
HTTPS origin without credentials, path, query, or fragment. The production
configuration verifier fails closed when either connector encryption or the
webhook origin is absent or malformed.
