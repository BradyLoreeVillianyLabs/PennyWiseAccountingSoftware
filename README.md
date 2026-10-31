# ClearLedger

ClearLedger is a Canada-first accounting and invoicing application for small businesses. It is designed to remain simple for owners while preserving accountant-grade double-entry bookkeeping, auditability, tenant isolation, and exportability.

## Current status

Phases 1 through 14 are engineering-complete. `0.14.0-rc.1` is a controlled-beta release candidate covering the accounting MVP, accessibility safeguards, release traceability, capacity evidence, browser coverage, and recovery verification. Owner UAT approval is still required before public registration or unrestricted production use.

Development now follows gated task files:

- Phase 2: completed; see `docs/status/PHASE_02_COMPLETION_REPORT.md`
- Phase 3: completed; see `docs/status/PHASE_03_COMPLETION_REPORT.md`
- Phase 4: completed; see `docs/status/PHASE_04_COMPLETION_REPORT.md`
- Phase 5: completed; see `docs/status/PHASE_05_COMPLETION_REPORT.md`
- Phase 6: completed; see `docs/status/PHASE_06_COMPLETION_REPORT.md`
- Phase 7 through 13: completed; see their respective `docs/status/PHASE_*_COMPLETION_REPORT.md` files
- Phase 14: engineering verification complete; owner UAT and formal closure are pending; see `docs/status/PHASE_14_COMPLETION_REPORT.md`

See `docs/status/CURRENT_PHASE.md` for what is completed, expected next, and blocked.
The dated [market position](docs/MARKET_POSITION_2026-08-01.md) records the
recommended Canadian commerce launch wedge, competitor workflow comparison,
switching plan, distribution approach, and external release gates.
The [research index](docs/research/README.md) retains owner-supplied market evidence and
the product decisions derived from it.

## How Codex should work

Codex must read:

1. `AGENTS.md`
2. `CODEX_MASTER_PROMPT.md`
3. `docs/tasks/TASK_EXECUTION_STANDARD.md`
4. the explicitly authorized phase task

Each task defines its own limited required-reading list. Codex should not reread the entire repository or all specifications for every phase.

## Non-negotiable product rules

- Every posted journal balances.
- Posted journal lines are immutable.
- Corrections use linked reversals or adjustments.
- Financial posting is atomic and idempotent.
- Tenant-owned data is organization-scoped and default-deny.
- Persisted money never uses binary floating point.
- ClearLedger does not hold customer funds in the MVP.
- No autonomous AI posting is allowed.
- Complete customer data export is required before MVP release.

## Books Health

Home includes a persistent, read-only **Books Health** review. It checks commerce
events and mapping conflicts, unreconciled bank activity, import progress and
recorded variances, tax/accounting setup readiness, and period-close blockers.
Each finding explains why it matters and links to the matching workspace. The
check never posts, closes a period, changes a mapping, acknowledges an import,
or creates an accounting entry. A result with no findings is not accountant,
tax, provider, or professional approval.

## Local commands on Windows PowerShell

Use `.cmd` shims when bare npm/pnpm scripts are blocked:

```powershell
pnpm.cmd install
pnpm.cmd db:generate
$env:DATABASE_URL = "postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public"
pnpm.cmd db:migrate:deploy
pnpm.cmd --filter @clearledger/api dev
```

Phase 22 integration credentials are created from an authenticated organization
context at `POST /v1/organizations/current/api-credentials`. Supply an
`idempotency-key`, a name, and the smallest required scopes. The returned
`secret` is shown only on the create/rotate response; store it in the
integration's secret manager and send it as `Authorization: Bearer
cl_live_...`. Credential listing never returns secret material. API keys are
fixed to one organization, expire by default after 90 days, and cannot perform
recent-authentication or high-risk accounting actions.

Signed outbound webhooks are managed at `POST /v1/organizations/current/webhooks`.
Create requests require an `idempotency-key`; the `whsec_...` signing secret is
returned only once, and endpoint secrets are encrypted at rest. Use the
`/webhooks/dispatch` operation for the local worker harness. Each delivery has
an event ID, version, timestamped HMAC-SHA256 signature, FIFO-per-endpoint
ordering, bounded exponential retry, dead-letter inspection, replay, and
disable/enable controls. Production requires `WEBHOOK_SECRET_ENCRYPTION_SECRET`
through the configured secret-protector adapter; never commit it.

OAuth client installations are managed at
`/v1/organizations/current/oauth-clients`. An organization administrator
registers exact redirect URIs and the smallest allowed scopes; the
`cl_app_secret_...` value is returned only once. The authenticated owner then
uses `POST /v1/oauth/authorize` to record explicit organization consent and
issue a five-minute PKCE S256 authorization code. Clients exchange that code
at `POST /v1/oauth/token` using standard form fields (`grant_type`,
`client_id`, `client_secret`, `code`, `redirect_uri`, and `code_verifier`).
Access tokens are short-lived, refresh tokens rotate, and revoking the client
invalidates both. OAuth scopes cannot grant integration administration,
webhook control, high-risk accounting posting, payments, imports, or exports.
Rotate an exposed client secret at
`POST /v1/organizations/current/oauth-clients/{oauthClientId}/rotate` with an
`idempotency-key`. The public client ID does not change, the old secret stops
working immediately, and a replay never returns the replacement secret.

## Native WooCommerce and Etsy shadow connectors

WooCommerce and Etsy are built-in commerce connectors. They import provider
evidence into the Commerce integrations review inbox; they do not create or
post invoices, payments, inventory movements, tax entries, journals, or bank
deposits. Marking an inbox event reviewed also has no accounting effect. This
is deliberately a shadow/review release until the separate marketplace
clearing and payout-posting acceptance gates are satisfied.

Before connecting a real test store, deploy migration
`20260801010000_native_commerce_connectors` and provide
`CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET` from a secret manager. Do not rely on
the development fallback encryption key for real provider credentials. Use a
stable, high-entropy value of at least 32 characters.
The controlled LocalXpose sharing launcher also fails closed unless this value
is stable and at least 32 characters; it never stores or prints the secret.

```powershell
$env:DATABASE_URL = "the explicitly selected ClearLedger database"
$env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = "a high-entropy secret from the deployment secret manager"
pnpm.cmd db:migrate:deploy
pnpm.cmd --filter @clearledger/api dev
```

The migration is additive. It permits multiple stores per provider, adds
versioned mappings, bounded synchronization leases, webhook lookup controls,
and immutable payload fingerprints. Existing connector drafts remain present
but must be reconnected to populate their validated external shop identity.
Do not roll the migration down after multiple stores exist; the down migration
refuses to restore the former one-provider-per-organization constraint in that
state.

Use the **More -> Integrations** workspace. Organization owners and
administrators manage credentials, mappings, synchronization, and connector
status. Accountants can read connector status, and accountants or bookkeepers
can review inbox evidence; read-only users can view the inbox but cannot mark
events reviewed.

1. Add a WooCommerce store or Etsy shop.
2. Complete the provider-specific connection below.
3. Configure customer, SKU, and tax import rules. Unknown or ambiguous values
   stay in review and are never guessed.
4. Synchronize a completed date range. A range may not exceed 90 days; one run
   is limited to 10 pages of at most 100 records per page. The interface
   defaults to a 30-day window, three pages, and 50 records per page. If the
   page budget is exhausted, the result is visibly incomplete and **Continue
   sync** resumes the same fixed date range from its saved cursor.
5. Review health, checkpoints, redacted logs, replay counts, mapping conflicts,
   and the Commerce review inbox. Pause or disconnect a connector if required;
   disconnecting removes stored credentials but retains imported evidence.

The first synchronization cannot exceed the backfill range accepted when the
store was connected. Later default runs overlap the prior completed time by
five minutes so late provider edits can replay safely. An incomplete run does
not advance `lastSyncAt`; it advances only after every requested scope reports
complete. Starting a new synchronization replaces any waiting continuation,
so finish or intentionally abandon the displayed range first.

### WooCommerce setup

WooCommerce uses the REST API included in WooCommerce core; no paid connector
plugin or marketplace adapter approval is required. In WordPress, open
**WooCommerce -> Settings -> Advanced -> REST API**, create a key for the store
owner, and begin with **Read** access. Enter the public HTTPS store root,
consumer key, and consumer secret in ClearLedger. Polling imports orders,
edits, cancellations, refunds, products/variations, SKUs, coupons, discounts,
shipping, fees, taxes, and payment-method facts.

Read/write access is needed only if ClearLedger is asked to create the three
WooCommerce order webhooks. Keep read-only access and use scheduled/manual
polling when webhook automation is unnecessary. Store URLs must be public
HTTPS endpoints; redirects, embedded credentials, query strings, local hosts,
and private/reserved network destinations are rejected.

### Etsy setup

Create an Etsy developer application and register the exact HTTPS ClearLedger
browser origin, including its trailing `/`, as the OAuth redirect URI. Enter
the app key/keystring and shared secret, then choose **Authorize with Etsy**.
ClearLedger uses OAuth authorization code with S256 PKCE and requests only
`shops_r` and `transactions_r`. Access and refresh tokens are encrypted and
refresh automatically. Buyer-email access is not requested.

Polling imports shop receipts, receipt transactions, payment/refund facts, and
payment-account ledger entries used to review fees and settlement activity.
Etsy webhooks require the generated URL and signing secret to be configured in
Etsy's Webhook Portal. Subscribe only to the supported order events shown in
the interface. An Etsy app is required; Etsy Commercial Access review remains
an external requirement before broad multi-seller distribution. The Etsy name
is a trademark of Etsy, Inc.; ClearLedger uses the Etsy API but is not endorsed
or certified by Etsy, Inc.

### Currency, privacy, and posting boundary

Provider money is retained using exact decimal or amount/divisor evidence and
is never parsed through binary floating point. CAD and USD are the released
accounting currencies. Other valid ISO currencies may be imported as review
evidence, but they receive a blocking `CURRENCY_NOT_RELEASED` finding and
cannot post. Missing currency precision, unreconciled totals, unknown SKUs,
and unknown taxes also remain blocking review items.

For a CAD-base company entering a USD rate snapshot, the settings interface can
preview the latest published `FXUSDCAD` observation on or before a selected
date from the Bank of Canada Valet API. The lookup uses no API key, a fixed
official endpoint, and a seven-day window. It is an indicative convenience:
the preview does not persist a rate, change settings, or create accounting
entries. The user must review the provider date, exact decimal, purpose, and
source, then explicitly add the existing immutable manual snapshot.

Credentials and OAuth material are encrypted and omitted from API responses.
Logs and checkpoints redact secrets. Stored provider payloads remove buyer
contact/address objects, user or buyer identifiers, IP/user-agent values,
customer notes, arbitrary metadata, order access keys, and secret-like fields
that are not required for accounting normalization. Normalized product, tax,
fee, payment, refund, and exact-money facts remain available for review. Raw
evidence, its fingerprint, event version, and provider identity are immutable
after ingestion, and provider calls occur outside accounting database
transactions. Verified provider deliveries use a null system actor in audit
history and retain the provider, installation, and delivery identity instead of
being attributed to the person who originally created the connector.

### LocalXpose browser share and webhook relay

The controlled LocalXpose (`loclx`) browser share retains Basic Authentication.
Provider servers cannot answer that challenge, so live WooCommerce or Etsy
delivery uses a second webhook-only HTTPS relay with no browser Basic
Authentication. Set `CONNECTOR_WEBHOOK_BASE_URL` to that relay's HTTPS origin;
it must not contain credentials, a path, query, or fragment. The relay exposes
only allowlisted commerce `POST` paths for provider-signed deliveries and
forwards them to the loopback API. Use one relay per API deployment, not one
per connector.

See [Controlled Loclx sharing](docs/CONTROLLED_LOCLX_SHARING.md) for exact
commands, provider registration, verification, and production limitations.
Never register the protected browser URL as a provider webhook, publish the
development API directly, or treat the test relay as production ingress.

### Switching Centre source provenance

Switching Centre uploads retain the selected source system as immutable
evidence: QuickBooks Online, Xero, Wave, FreshBooks, Sage, Zoho Books, or
other/spreadsheet. Re-uploading identical content for the same import type and
source reuses the existing batch. Labelling that same content as a different
source returns `IMPORT_SOURCE_MISMATCH` instead of silently changing its
provenance. Preview and dry-run remain non-posting; use the reconciliation
evidence and explicit commit controls before changing the books.

In a second PowerShell window:

```powershell
$env:API_BASE_URL = "http://localhost:3001"
pnpm.cmd --filter @clearledger/web dev
```

Open `http://localhost:3000`. On localhost, the web flow offers a development-only email identity. Production uses OIDC and rejects the development adapter. Do not weaken PowerShell execution policy as an application setup step.

Run the controlled-beta contract checks after PostgreSQL integration tests:

```powershell
pnpm.cmd test:e2e
pnpm.cmd test:accessibility
pnpm.cmd test:performance
pnpm.cmd test:security
```

Use `docs/USER_ACCEPTANCE_SCRIPTS.md` for role-specific beta validation. `docs/RELEASE_CANDIDATE.md` maps each MVP workflow to automated PostgreSQL, browser, and capacity evidence plus the remaining production-operations prerequisites.

Start PostgreSQL first with `docker compose up -d postgres postgres-test`, or provide equivalent PostgreSQL 17 databases. Production must use separate migration credentials and an unprivileged `NOINHERIT` application login that is a member of `clearledger_runtime`; never run the API with the migration owner or a superuser.

## Stripe test mode

The keyless development adapter supports automated tests only. To exercise real hosted Checkout, set these server-side values to Stripe test-mode credentials before starting the API:

```powershell
$env:STRIPE_MODE = "test"
$env:STRIPE_SECRET_KEY = "a Stripe test secret from your local secret store"
$env:STRIPE_WEBHOOK_SECRET = "the Stripe test webhook signing secret"
$env:PAYMENT_ACCOUNT_ENCRYPTION_SECRET = "a random secret of at least 24 characters"
$env:PAYMENT_PUBLIC_BASE_URL = "http://localhost:3000"
pnpm.cmd --filter @clearledger/api dev
```

Never put those values in source control. Stripe Checkout charges the organization's connected account directly. ClearLedger takes no application fee and never receives or holds the customer funds. On verified capture, ClearLedger debits payment clearing and credits accounts receivable for the gross customer payment; provider fees debit processing expense and credit payment clearing separately. Bank settlement remains in payment clearing until Phase 8 reconciliation.
