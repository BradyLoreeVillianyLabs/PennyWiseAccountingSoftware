# Two adoption barriers: SMTP email delivery and a second bank-feed aggregator

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `apps/api/src/services/email-connection-service.ts` — `emailConnectionProviders`,
   `EmailProviderRuntimeConfig`, `EmailOAuthHttpClient`
4. `apps/api/src/services/connected-mailbox-email-provider.ts`
5. `apps/api/src/services/bank-feed-adapter-config.ts`,
   `apps/api/src/services/plaid-bank-feed-adapter.ts` — `BankFeedProviderAdapter`
6. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — email and banking entries

## Exact intention

Two independent gaps, bundled here because both are the same shape of problem: an
organization that doesn't already use the one specific vendor PennyWise wired up cannot
use the feature at all — not a degraded experience, a wall.

1. **Invoice email requires a Gmail or Microsoft mailbox.**
   `emailConnectionProviders = ["GMAIL", "MICROSOFT"]` is the complete list. An
   organization on any other mail provider, or one that doesn't want to OAuth-grant
   PennyWise access to their inbox at all, cannot send an invoice email from the
   product today.
2. **Bank feeds mean Plaid, or nothing live.**
   `PlaidBankFeedAdapter` is the only live aggregator. Plaid's institution coverage is
   good but not universal, especially for smaller Canadian credit unions — an
   organization whose bank Plaid doesn't cover has no live-feed path, only the existing
   manual CSV/OFX import.

Close both the same way the rest of this codebase already closes a single-vendor gap:
add a second, real, independently useful path behind the existing pluggable interface.

## Research already done — Flinks has a genuine free self-serve sandbox

Confirmed directly against Flinks' own documentation, not assumed:

1. `POST` to Flinks' `/GenerateAuthorizeToken` endpoint using a `flinks-auth-key`
   (obtained from a free Flinks developer/Toolbox account — no partnership approval,
   sign up and get credentials immediately) returns a temporary authorize token.
2. That token is passed to the `/Authorize` endpoint, which returns a `requestId` valid
   for 30 minutes.
3. That `requestId`, alongside an `x-api-key` (API Secret), authenticates calls to the
   aggregation endpoints — `/GetAccountDetails` and the transaction/attribute endpoints
   `PlaidBankFeedAdapter`'s Plaid equivalent already covers.

Flinks' "Toolbox" environment is exactly Plaid's sandbox equivalent: real institution
connection flows against Flinks' own test data, no real bank account required to build
and test the adapter end-to-end.

Reference: [Fetching your API credentials](https://help.flinks.com/support/solutions/articles/43000646259-fetching-your-api-credentials),
[/Authorize endpoint](https://docs.flinks.com/api/authorize/endpoints/authorize),
[docs.flinks.com](https://docs.flinks.com/).

## Boundary conditions

- **SMTP does not require an OAuth grant to the organization's mailbox at all** — that is
  precisely its advantage over adding a third OAuth provider. An organization enters
  their own SMTP host, port, credentials, and from-address; PennyWise sends through it
  directly. This is a genuinely different, simpler trust model than Gmail/Microsoft's
  OAuth flow, not a third entry in the same list.
- **Credential handling for SMTP is a real security surface.** An SMTP password is a
  plain credential, not an OAuth token PennyWise never sees in the clear. Store it
  through the exact same encryption-at-rest pattern already used for connector and
  payment credentials — never a new, weaker storage path because it "is just SMTP."
- **A second bank-feed aggregator, and no partnership is needed to build or test it.**
  Flinks — Canadian-focused, a natural fit alongside Plaid's broader-but-thinner Canadian
  coverage — has a free, self-serve developer sandbox (see Research above). Build and
  fully test the adapter against it now; only connecting a real organization's real bank
  account in production is a separate, later step.
- **An organization picks explicitly**, matching the existing pattern: SMTP as a third
  email-sending option next to Gmail/Microsoft, and Flinks as a second selectable
  aggregator next to Plaid — never a silent default that changes existing behavior for
  an organization already connected to Gmail, Microsoft, or Plaid.
- Never claim a live capability is connected when it isn't. An organization that hasn't
  configured SMTP or a second aggregator sees exactly today's behavior.

## Tasks

### 1. SMTP email provider

Add `"SMTP"` to `emailConnectionProviders`, and its own `EmailProviderRuntimeConfig`
shape: host, port, encryption mode (STARTTLS/implicit TLS), username, encrypted password,
and from-address, validated with a real test-send before being marked connected. Wire it
into `connected-mailbox-email-provider.ts`'s send path alongside Gmail/Microsoft.

### 2. Flinks bank-feed adapter

Implement `BankFeedProviderAdapter` (`providerKey = "FLINKS"`) against the
`GenerateAuthorizeToken` → `Authorize` → `requestId` flow documented above, using a free
Flinks Toolbox sandbox account created for this build — institution connection, sync,
and transaction retrieval, mirroring `PlaidBankFeedAdapter`'s existing shape and
test-mode discipline.

### 3. Organization-level selection for both

Settings and UI for an owner to configure SMTP (with a test-send confirmation before
it's usable) and to connect a bank account through Flinks instead of or alongside Plaid.

### 4. Tests

- SMTP adapter tests against a fixture/mock SMTP server, including a wrong-credential
  failure path that reports clearly rather than silently.
- Flinks adapter tests mirroring the existing Plaid adapter test's coverage.
- Update `docs/COMPETITIVE_RESEARCH_MATRIX.md`'s email and banking entries.

## Constraints

- No change to existing Gmail/Microsoft email behavior or existing Plaid-connected
  organizations.
- SMTP credentials encrypted through the existing protection pattern; never logged.
- No live send or live bank connection from any automated test.

## Acceptance criteria

- An organization can configure SMTP, send a test email, and then send a real invoice
  through it — with no Gmail or Microsoft account involved at any point.
- An organization can connect a bank account through Flinks the same way they connect one
  through Plaid today.
- `corepack pnpm lint`, `typecheck`, and the relevant integration tests pass.

## Out of scope

Any other email or bank-feed provider beyond these two named additions. Actually
connecting a real organization's real bank account through Flinks in production — the
sandbox build and test above needs no partnership at all, but a live customer connection
is a separate, later step, exactly as it was for Plaid.
