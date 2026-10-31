# Architecture

## Architectural style

Use a modular monolith with clear domain boundaries.

Do not introduce microservices until production load or organizational structure requires independent deployment.

## Proposed modules

- identity
- organizations
- ledger
- tax
- sales
- payments
- purchases
- banking
- inventory
- reporting
- documents
- notifications
- audit
- integrations

## Application boundaries

### Web application

- Next.js;
- responsive progressive web application;
- Business View and Accountant View;
- customer invoice and payment pages;
- accessible component library;
- no direct database access.

### API

- structured TypeScript framework;
- REST API with OpenAPI;
- authentication and authorization middleware;
- domain services;
- request id and idempotency support;
- no accounting logic in controllers.

### Database

- PostgreSQL;
- all tenant-owned data contains `organization_id`;
- unique constraints protect duplicate posting;
- database transactions protect source and journal consistency;
- row-level security considered as defence in depth;
- append-only posted journals and audit events.

### Background jobs

Use a durable queue for:

- email delivery;
- PDF generation;
- imports;
- exports;
- payment webhook processing;
- bank synchronization;
- report materialization;
- malware scanning.

Use a transactional outbox so that a committed financial transaction cannot lose its external side effects.

## Money and quantities

- Never use binary floating point for money.
- Use integer minor units for single-currency amounts when possible.
- Multi-currency postings retain the original transaction-currency minor amount
  and an immutable base-currency minor snapshot on the source and journal line.
- Currency exponents are versioned registry data. Rates are immutable exact
  rational snapshots oriented as one transaction major unit to base major units;
  conversion and allocation use bigint/integer arithmetic only.
- Use fixed-precision decimal values for tax rates, unit prices, quantities, and inventory costing.
- Currency must be explicit on all monetary documents.
- Rounding rules must be deterministic and tested.

`TaxCalculationService` is the native provider-neutral calculation boundary.
Sales, purchases, expenses, and banking purchase classifications resolve one
effective-dated tax-code version through it and persist the engine/version,
source, purpose, taxable base, rounding adjustment, and exact components.
Credits, refunds, and adjustments call its original-tax allocation boundary;
they preserve and proportionally allocate the original evidence rather than
recalculating history from a later tax configuration. Component residues are
allocated deterministically and remain exactly equal to the credited tax total.
Reports read posted source snapshots and never invoke a live calculation.

Tax calculation is fail-closed at the boundary. Standard treatments calculate
each configured jurisdiction component with integer half-up rounding; inclusive
codes derive the taxable base and assign any residue deterministically to the
final component. Zero-rated and exempt treatments preserve their configured
component and source evidence but always produce zero tax. Purchase tax records
recoverable and non-recoverable portions and requires active tenant-owned asset
accounts for recoverable amounts. Sales tax requires active tenant-owned
liability control accounts for every non-zero component. Invalid dates, missing
effective versions, missing control accounts, and cross-tenant account IDs are
rejected before a posting workflow can proceed.

The base ledger is the source of truth for statements, tax reports, period close,
and exports. A registered monetary position (AR, AP, foreign bank/card,
undeposited funds, processor/marketplace clearing, or refundable deposit) may be
revalued with a linked unrealized FX journal and automatic next-period reversal.
Non-monetary carrying values are not silently remeasured. A backdated source
dated on or before a valuation date marks the affected run stale and blocks
close until it is rerun.

## Ledger posting service

The posting service must:

1. validate organization and permissions;
2. validate the fiscal period;
3. validate source status;
4. validate account eligibility;
5. calculate journal lines deterministically;
6. ensure debits equal credits;
7. enforce idempotency;
8. persist source changes, journal, and audit event atomically;
9. enqueue external side effects through the outbox;
10. return a stable posting result.

## Implemented foundation

The Phase 1 API lives in `apps/api` and keeps route handlers limited to authentication, schema validation, and service delegation. Domain services enforce organization membership before accessing tenant data.

Pure journal arithmetic lives in `packages/accounting-core`; it validates line shape, prevents mixed debit and credit amounts on one line, requires at least two lines, and balances totals using `BigInt` minor units.

The database package owns the Prisma schema and initial migration. PostgreSQL triggers reinforce critical invariants for append-only audit events, immutable posted journals and lines, journal-line tenant consistency, closed-period rejection, and balanced posted journals.

Financial posting creates a draft journal, inserts journal lines, marks the journal posted, writes an audit event, writes an outbox event, and stores idempotency replay data in one transaction.

Phase 2 isolates production identity behind an OIDC adapter. Authorization-code requests use PKCE, nonce, hashed one-time state, provider discovery, and JWKS validation. The API stores only opaque session-token hashes and applies idle, absolute, renewal, recovery, and revocation controls.

Organization context comes from an active membership. Tenant database work runs in a short transaction that uses `SET LOCAL ROLE clearledger_runtime` and transaction-local actor and organization settings. Forced RLS policies independently verify active membership through database-maintained locator rows. Invitation acceptance is bound to a hashed invitation context, while organization bootstrap uses a same-transaction database grant that cannot target an existing tenant. Service-level organization filters remain required.

Production API credentials are distinct from migration credentials. Startup rejects privileged, inheriting, table-owning, or non-member database logins before accepting traffic.

## Immutability

After `POSTED`:

- journal headers cannot change except non-financial metadata explicitly approved by policy;
- journal lines cannot be updated or deleted;
- source financial fields cannot be edited in place;
- correction creates a linked reversal or adjustment;
- audit history records actor, timestamp, reason, and correlation id.

## Reporting

The ledger is the source of truth.

Reports query posted journal lines, account metadata, and fiscal periods.

Materialized views or snapshots may improve performance but must be rebuildable from the ledger.

Phase 10 implements tenant-scoped query services inside short RLS transactions.
Financial statements read posted journal lines directly. Operational reports
read immutable posted source snapshots and independently compare their totals
with ledger control accounts. Detailed result sets are capped at 5,000 rows;
general-ledger and journal results are paginated with deterministic ordering.
Report exports are authorization checked, recently authenticated, audited, and
formula-safe. No cross-request report cache is used.

Dashboard values compose the same report services used by the report endpoints,
so cards cannot drift into a competing accounting calculation. Organization
currency and time zone govern labels and month boundaries.

## Accountant review and period close

Phase 11 reuses the posted ledger, source snapshots, and Phase 10 control
reports. Manual journals are versioned drafts until the shared journal service
posts them; posted drafts, close records, review dismissals, journals, and audit
events are append-only at the database layer.

Period close acquires a row lock before calculating evidence and changing
status. Ordinary posting acquires a shared period lock, so concurrent posting
and closing serialize through PostgreSQL's row-lock protocol. Close stores the
full warning and reconciliation snapshot. Review queues derive
deterministic fingerprints from category and supporting record state; a
reasoned dismissal suppresses that exact fingerprint but cannot change source
records or future materially different findings.

Accountant queries remain organization-filtered inside forced-RLS transactions.
Audit search and export apply field-name redaction before serialization, and
exports are capped, recently authenticated, permission checked, formula-safe,
and audited.

## Migration and portability

Phase 12 stores each uploaded source as immutable evidence identified by a
tenant-scoped batch ID, import type, and SHA-256. Mapping, validation, dry run,
commit, reconciliation, and acknowledgement are explicit states. PostgreSQL
composite foreign keys prevent a row, historical record, export, or closure
request from being linked across organizations. Forced RLS remains active on
every Phase 12 tenant table.

Master-data and historical batches commit atomically. Financial imports call
the existing invoice, purchase, opening-balance, and inventory domain posting
services and use deterministic migration idempotency keys. Finalized import
evidence and historical records are database-immutable. Incomplete opening
credits are retained as non-posting history rather than synthesized financial
events.

Full exports are background-job records coupled to an outbox event. The current
development worker runs in process; production must consume the outbox through
a durable worker. Each archive has a versioned manifest and per-file and
whole-archive SHA-256 checksums. Expiring download tokens are stored only as
hashes. Attachment names become safe path segments and only clean,
checksum-valid content is included.

Closure is retention scheduling, not deletion. A guarded security-definer
database function verifies tenant context, active ownership, and stored
retention state before revoking sessions. Payment accounts are disconnected in
the same tenant transaction. Legal holds fail closed.

## Production Hardening

Phase 13 applies bounded, route-aware request limiting before expensive public,
authentication, import, export, invitation, and report work. Production must
inject a shared limiter; the in-memory limiter is development-only. API
responses carry correlation IDs and security headers. Production logs use
structured redaction for authorization, cookies, export tokens, webhook
signatures, request bodies, and session cookies; domain audit events remain the
source of actor and organization attribution.

Production deployment requires HTTPS origin configuration, HSTS at the API,
managed OIDC and MFA, production object storage/scanning/email/payment
adapters, durable outbox workers, managed PostgreSQL backup/PITR, and distinct
runtime, migration, maintenance, and backup credentials. The restore-drill
script verifies PostgreSQL archive restoration only against named disposable
databases; managed backup encryption and attachment recovery are operational
controls documented in `BACKUP_AND_RECOVERY.md`.

## External integrations

### Catalog matching and inventory automation

Every commerce catalog source adapter, including WooCommerce, Etsy, demo
fixtures, and future providers, ends at the same `ExternalCatalogProduct` and
`ExternalCatalogVariant` boundary. The runtime capability guard requires every
commerce adapter to expose catalog normalization as well as order, webhook, and
inventory operations. Adapters may normalize provider data, but may not implement
their own local-item ranking or confirmation policy. Variant identifiers and name
are combined with the parent product description as observed evidence; matching
compares that evidence with the identifiers, name, and description on
`ProductItem`. CSV/XLSX product and opening-inventory previews call this same
matcher directly for non-authoritative review suggestions without creating fake
provider catalog records.

Tenant-predicated, active-item-only database retrieval supplies bounded nearest
SKU, name, and description pools. The application produces deterministic
integer-basis-point explanations and persists a versioned reason object. The
candidate list API returns historical reason objects without rewriting them:
version 1 remains a supported display contract, while newly generated or
regenerated unresolved `SUGGESTED` candidates use version 2. `CONFIRMED` and
`REJECTED` reasons are historical decision evidence and are never recalculated.

All candidates are reviewer-only. No exact identifier or fuzzy score may
auto-confirm a mapping, post accounting, create an inventory movement, or write
quantity back to a provider. Those effects belong to separately authorized
domain workflows after a human confirmation. The complete reason and scoring
contract is documented in `CATALOG_MATCHING_CONTRACT.md`.

Automatic commerce ingestion is bounded to 50 observed variants and 10 candidates
per variant; deferred variants are returned and remain addressable through the
per-variant candidate route. Spreadsheet review is independently paged at 25 rows
through `/v1/imports/{batchId}/item-match-suggestions`.

Human confirmation feeds separate provider-scoped catalog mapping namespaces used
by order normalization. It never replaces a differing manual mapping. Variant
aliases support provider order identities that differ from inventory identities;
ambiguous multi-variant product IDs are not promoted to product-level mappings.
Order polling and webhooks never invoke fuzzy matching inline. Opening-inventory
posting likewise retains an exact active-SKU lookup regardless of any preview
suggestion.

### Payments

- hosted checkout;
- signed webhook verification;
- raw event retention with sensitive-field filtering;
- idempotent event processing;
- explicit settlement and fee reconciliation.

### Banking

Phase 8 uses provider-neutral CSV and OFX/QFX file adapters. Imported source
rows and file hashes are retained as normalized, immutable evidence; full bank
credentials and account numbers are never stored. Matching, categorization,
transfers, and reconciliation operate on the normalized banking domain and do
not depend on a provider SDK.

The interface below is a future live-feed boundary, not a Phase 8
implementation:

Define a provider-neutral interface:

```ts
interface BankProvider {
  connectInstitution(input: ConnectInstitutionInput): Promise<ConnectionResult>;
  refreshConnection(connectionId: string): Promise<RefreshResult>;
  listAccounts(connectionId: string): Promise<BankAccount[]>;
  fetchTransactions(input: FetchTransactionsInput): Promise<BankTransactionPage>;
  fetchBalances(connectionId: string): Promise<BalanceResult[]>;
  renewConsent(connectionId: string): Promise<ConsentResult>;
  disconnect(connectionId: string): Promise<void>;
  getConnectionHealth(connectionId: string): Promise<ConnectionHealth>;
}
```

Do not expose provider-specific fields to core banking domain services.

## Deployment

- Canadian-region primary database and object storage;
- infrastructure as code;
- separate development, staging, and production environments;
- managed database with point-in-time recovery;
- encrypted backups;
- centralized logs and alerts;
- no production secrets in source control;
- deploy through CI after tests and migration checks.
