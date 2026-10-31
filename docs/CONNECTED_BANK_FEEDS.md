# Connected bank feeds

Status: **implemented as provider-gated, review-only activity import.** A company-level
review setting controls whether unambiguous, approved bank-feed rules may be applied. The
setting defaults to **on**; turning it off permits only unambiguous approved-rule processing,
while exceptions and ambiguous activity remain reviewable. No setting permits unrestricted
posting, automatic matching, payment, or reconciliation. An eligible rule may create a
categorized journal through the same guarded posting path used by manual categorization.

The local PennyWise test-bank simulator is separate from Plaid Sandbox. It never contacts a
financial institution, accepts bank credentials, or represents Plaid coverage. It is useful
for development and controlled-beta workflow testing only. Production may enable an approved
live provider when the owner, security, legal, and provider gates are complete and
`BANK_FEED_PRODUCTION_APPROVED=true` is set.

## User-visible workflow

1. An owner, admin, or accountant first creates an active PennyWise bank or credit-card
   account with matching CAD or USD currency.
2. The user chooses **Connect securely**. PennyWise requests a short-lived Link token from
   the server and opens the provider-hosted window.
3. The provider—not PennyWise—handles the bank sign-in, MFA, OAuth, and account selection.
4. The user confirms the matched PennyWise and provider accounts in PennyWise.
5. The server exchanges the short-lived public token, encrypts the provider access token,
   and stores only the encrypted credential plus safe provider references.
6. **Sync now** imports activity into banking. With the default review setting, every item
   remains unmatched. If the company turns review-everything off, one unambiguous approved
   rule may categorize an eligible item through the normal posting controls. Every exception
   remains unmatched; matching, payment, and reconciliation are never automatic.

Plaid documents Link as the required production end-user account-authentication path and
describes the Link-token, public-token, access-token exchange used here.
[Plaid Link overview](https://plaid.com/docs/link/)

## What is implemented

- Provider-neutral adapter contract with a Plaid implementation for CAD/USD Transactions.
- Hosted Link token creation, public-token exchange, account validation, encrypted access
  token storage, consent-expiry handling, and disconnect/revocation.
- Cursor-based `/transactions/sync` pagination; added, modified, and removed provider facts
  are observed without silently rewriting reviewed source evidence.
- One in-flight refresh per connection, replay-safe import identities, cross-tenant denial,
  and a safe failure path when a user disconnects while a request is in flight.
- Imported activity arrives as `UNMATCHED`. It stays there by default. An owner-controlled
  policy can allow one exact, active, account-scoped rule to invoke guarded categorization;
  all other activity uses the existing manual categorization, matching, and reconciliation
  controls.

Plaid's Transactions guidance requires storing the returned cursor, walking every page,
and restarting from the prior cursor if the provider reports a mutation during pagination.
The adapter performs the cursor walk; the service refuses a changed source transaction for
review rather than modifying accounting evidence.
[Plaid Transactions integration guidance](https://plaid.com/docs/transactions/)

## Configuration boundary

Do not add these values to source control, a browser, an installer, or a shared tunnel.
Store them in the secret manager for the API host.

For local development, use the simulator explicitly. These values create synthetic CAD/USD
accounts and deterministic review-queue activity; they do not create a Plaid connection:

```text
NODE_ENV=development
BANK_FEED_PROVIDER=PENNYWISE_TEST_BANK
PENNYWISE_ENABLE_TEST_BANK=true
BANK_FEED_CREDENTIAL_ENCRYPTION_SECRET=<at least 32 random characters>
```

For the controlled beta, use the same simulator only when the beta operator has approved the
test-provider path:

```text
NODE_ENV=development
CLEARLEDGER_BETA_RUNTIME=true
BANK_FEED_PROVIDER=PENNYWISE_TEST_BANK
PENNYWISE_ENABLE_TEST_BANK=true
PENNYWISE_BETA_BANK_FEEDS_SANDBOX_APPROVED=true
BANK_FEED_CREDENTIAL_ENCRYPTION_SECRET=<at least 32 random characters>
```

The simulator is rejected by a production runtime even when its opt-in is present. A live
provider uses its own provider credentials and remains disabled until the production approval
setting is enabled:

```text
BANK_FEED_PROVIDER=PLAID
PLAID_CLIENT_ID=<provider server credential>
PLAID_SECRET=<provider server credential>
PLAID_ENV=sandbox|development|production
BANK_FEED_CREDENTIAL_ENCRYPTION_SECRET=<at least 32 random characters>

# Optional, HTTPS only. Required when the accepted production design uses webhooks/OAuth.
BANK_FEED_WEBHOOK_URL=https://app.example.com/api/v1/bank-feed-webhooks/plaid
PLAID_REDIRECT_URI=https://app.example.com/banking

# Required in a controlled beta before a Sandbox feed is shown.
PENNYWISE_BETA_BANK_FEEDS_SANDBOX_APPROVED=true

# Required in a non-beta runtime before a production provider is enabled.
BANK_FEED_PRODUCTION_APPROVED=true
```

`BANK_FEED_PRODUCTION_APPROVED=true` is an operational approval toggle, not a substitute for
provider credentials, signed webhook handling, consent controls, encryption, auditability, or
the acceptance checklist below. The live provider must be selected explicitly; the local
simulator cannot be promoted by changing this setting.

The browser receives only a short-lived Link token and, after user completion, a transient
public token. It never receives the provider app secret or an encrypted/stored access token.
PennyWise does not ask for online-banking usernames or passwords.

## What is intentionally not enabled yet

- No production Plaid credentials, provider approval, terms acceptance, or live bank
  customer data has been supplied to this repository.
- No public webhook receiver with provider signature verification, durable worker, retry
  queue, alerting, or operator runbook is accepted for production yet. Current refresh is
  user-triggered **Sync now**.
- No balance-based posting, automated reconciliation, money movement, or finance decision is
  enabled by the feed. Rule-based categorization is available only when an owner or admin turns
  off **Keep all connected bank activity in review** for that company. It accepts one
  unambiguous, active, account-scoped exact rule; duplicates, changed provider evidence,
  ambiguous rules, invalid mappings, foreign-currency direct categorization, and every posting
  error remain in review.

Plaid notes that transaction updates can be added, modified, or removed after initial
retrieval and that webhooks are used to notify integrations of updates. A production
worker must therefore authenticate webhooks, queue the sync, preserve the cursor, handle
delays/rate limits/reconnects, and leave all accounting decisions reviewable.
[Plaid Transactions update model](https://plaid.com/docs/transactions/)

## Production acceptance checklist

1. Obtain the correct provider environment/production access, contracts, pricing, coverage,
   and approved product scopes for the intended U.S. and Canadian institutions.
2. Publish the API on a stable HTTPS domain; do not use a temporary tunnel as the production
   webhook or authorization boundary.
3. Store and rotate secrets in an approved secret manager; perform encryption-key rotation,
   access review, backup/restore, and incident exercises.
4. Implement and test signed webhook verification, replay rejection, durable job queue,
   cursor restart, item reconnect/update mode, retries/backoff, alerting, and support
   recovery.
5. Run accepted sandbox and live-design-partner tests for duplicate, pending/posted,
   modified, removed, consent-expired, rate-limited, disconnect-race, cross-tenant, and
   full reconciliation cases.
6. Record owner/security/privacy/legal approval before `BANK_FEED_PRODUCTION_APPROVED=true`
   can be set.

## Verification

```powershell
corepack pnpm --filter @clearledger/api run typecheck
corepack pnpm --filter @clearledger/api exec vitest run src/services/plaid-bank-feed-adapter.test.ts src/services/bank-feed-service.test.ts
$env:TEST_DATABASE_URL="postgresql://clearledger:clearledger_dev_only@127.0.0.1:5433/clearledger_test?schema=public"
corepack pnpm --filter @clearledger/api exec vitest run --config vitest.integration.config.ts src/bank-feed.integration.test.ts
```

The integration suite proves no auto-posting, exactly-once replay behavior, tenant isolation,
reviewed-source preservation, consent expiry, concurrent-sync denial, and disconnect-race
safety.
