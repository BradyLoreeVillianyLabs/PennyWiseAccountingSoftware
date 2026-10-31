# Windows Testing Handoff

This bundle is for local evaluation only. It is not a production deployment and must not process real customer payments.

## Prerequisites

- Windows with Node.js 22 or newer.
- pnpm 10.13.1 (`pnpm.cmd --version`).
- Docker Desktop running, or compatible PostgreSQL 17 instances.

## Start the application

Open PowerShell in the extracted bundle and run:

```powershell
pnpm.cmd install --frozen-lockfile
docker compose up -d postgres postgres-test
$env:DATABASE_URL = "postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public"
pnpm.cmd db:generate
pnpm.cmd db:migrate:deploy
pnpm.cmd --filter @clearledger/api dev
```

In a second PowerShell window in the same directory:

```powershell
$env:API_BASE_URL = "http://localhost:3001"
pnpm.cmd --filter @clearledger/web dev
```

Open `http://localhost:3000`. The localhost-only development identity adapter is available for testing. Keep the default development database credentials private to this test environment and do not add real payment-provider secrets.

## Test WooCommerce or Etsy webhooks

Live provider webhooks need a separate public HTTPS origin. Do not register the
browser application URL: a protected share uses Basic Authentication that
provider servers cannot answer. With a reserved LocalXpose name, set the
webhook origin before starting the local API:

```powershell
$env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = "retrieve a stable high-entropy value from your secret store"
$env:CONNECTOR_WEBHOOK_BASE_URL = "https://clearledger-hooks-brady.loclx.io"
pnpm.cmd --filter @clearledger/api dev
```

In another PowerShell window, relay only the signed commerce paths to the local
API. The normal development API port is `3001`:

```powershell
node scripts/start-loclx-webhook-share.mjs --subdomain clearledger-hooks-brady --reserved --api-port 3001 --relay-port 3500
```

Use one relay per API deployment. It serves every connector through a distinct
WooCommerce or Etsy installation-UUID path. It accepts only allowlisted `POST`
paths, has no browser Basic Authentication, and does not expose the application
interface or general API. Keep the relay window open.

In **More -> Integrations**, use **Webhooks** for WooCommerce, or copy the
generated URL into Etsy's Webhook Portal and save Etsy's signing secret. Verify
a signed test delivery appears in ClearLedger. If the origin changes,
re-register provider destinations and disable the stale URLs.

For the controlled browser-share command (API port `3101`), exact two-window
commands, and production caveats, see
[Controlled Loclx sharing](docs/CONTROLLED_LOCLX_SHARING.md).

## Release-candidate checks

With the API and web processes stopped, run the full quality gate against the disposable test database:

```powershell
$env:TEST_DATABASE_URL = "postgresql://clearledger:clearledger_dev_only@localhost:5433/clearledger_test?schema=public"
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm.cmd db:validate
pnpm.cmd db:generate
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd test:e2e
pnpm.cmd test:accessibility
pnpm.cmd test:performance
pnpm.cmd test:security
pnpm.cmd build
```

See `docs/USER_ACCEPTANCE_SCRIPTS.md` for owner, bookkeeper, accountant, payer, and inventory testing. This beta bundle must use only disposable organizations and Stripe test mode.

## Stop and clean up

Press `Ctrl+C` in each development process, then run:

```powershell
docker compose down
```

Use `docker compose down -v` only when you deliberately want to erase the local test databases.
