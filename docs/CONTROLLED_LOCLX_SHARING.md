# Controlled PennyWise beta sharing

This is a controlled-beta sharing mode for a person you trust. It is not a production deployment and must not be used for real financial records, real payments, or untrusted viewers.

The PennyWise beta supervisor creates one separate API and web process per named tester, all bound only to `127.0.0.1`. LocalXpose publishes only the web process over HTTPS. Every public request is challenged by the PennyWise web server before it can reach an asset or API route; the password therefore never appears in a LocalXpose or Node command line. The proxy discards browser-supplied development identity headers and injects one fixed identity and company for that tester.

## Before sharing

The canonical Windows beta path is `C:\Users\ancho\V1.VsStudioAccountingSoftwareBuild\PennyWise-Accounting-Beta`. The initializer maintains that junction against the active source checkout, and the logon task stores that stable path so a dated or secondary distribution folder cannot silently become the live tunnel source. Run the commands below from that canonical path after updating the active checkout. The public `distribution\public-beta` archive intentionally does not contain beta tunnel credentials or tester shares.

1. Create or verify a dedicated tester and an active membership in the local app. Give the tester the lowest role that lets them test what you need.
2. Add the tester's fixed email, organization UUID, local port pair, and `pennywise*` subdomain to `infrastructure/beta/pennywise-controlled-shares.json`. The checked-in configuration contains no passwords.
3. Install and sign in to the LocalXpose CLI. `loclx.exe` must be available on `PATH`.
4. Use the loopback development database only. The initializer refuses a non-loopback host, unexpected port, or unexpected database name.

## Install the persistent beta supervisor

From the canonical PennyWise beta path, run the initializer once while the loopback development database is available:

```powershell
$betaRoot = "C:\Users\ancho\V1.VsStudioAccountingSoftwareBuild\PennyWise-Accounting-Beta"
Set-Location $betaRoot
$env:DATABASE_URL = "retrieve the approved loopback development connection value from your local setup"
node scripts/pennywise-beta-access.mjs init --install-task
```

The initializer reserves the configured PennyWise domains, creates high-entropy passwords and a stable connector-credential encryption key, then stores them with Windows EFS when available (otherwise a user-only NTFS ACL) under `%LOCALAPPDATA%\PennyWiseAccounting\beta`. The beta directory and its tunnel logs are restricted to the signed-in Windows user. It installs **PennyWise Beta Tunnel Supervisor**, which starts at this user's sign-in and restarts a failed tester share. It does not change execution policy, run as an administrator, or manage QBWooBridge.

Before starting a public beta share, provision its separate runtime database login. The ordinary beta connection is intentionally not allowed to create database roles, so this one-time step requires an approved local migration/admin connection. Keep that connection only in the current shell; it must still point to `127.0.0.1:55432/clearledger`, is never printed, and is not persisted by the script.

```powershell
# Never put the administrator password in a command, file, or chat message.
# This prompt does not echo it or add it to PowerShell history.
$adminUsername = Read-Host "Local PostgreSQL administrator username [postgres]"
if ([string]::IsNullOrWhiteSpace($adminUsername)) { $adminUsername = "postgres" }
$adminPassword = Read-Host "Local PostgreSQL administrator password" -AsSecureString
$adminPasswordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPassword)
try {
  $adminPasswordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPasswordBstr)
  if ([string]::IsNullOrWhiteSpace($adminPasswordText)) {
    throw "A local PostgreSQL administrator password is required."
  }
  $adminUserEscaped = [uri]::EscapeDataString($adminUsername)
  $adminPasswordEscaped = [uri]::EscapeDataString($adminPasswordText)
  $env:PENNYWISE_BETA_ADMIN_DATABASE_URL = "postgresql://${adminUserEscaped}:${adminPasswordEscaped}@127.0.0.1:55432/clearledger?schema=public"
  corepack pnpm beta:provision-runtime
  if ($LASTEXITCODE -ne 0) { throw "Runtime-role provisioning failed." }
}
finally {
  Remove-Item Env:PENNYWISE_BETA_ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
  if ($adminPasswordBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPasswordBstr)
  }
  $adminPasswordText = $null
  $adminPasswordEscaped = $null
}
node scripts/pennywise-beta-access.mjs init --install-task --start
```

The provisioner creates or rotates only the `pennywise_beta_runtime` login, confirms it is a `NOINHERIT` member of `clearledger_runtime`, and writes its generated password only to the existing EFS-protected beta secret store. It refuses to run while the supervisor is active. Do not weaken the beta API's database-login verification or reuse the migration credential for browser traffic.

Use this local-only command to see the URLs and usernames. Add `--reveal` only when you are ready to send a tester password through a private channel:

```powershell
node scripts/pennywise-beta-access.mjs access
```

From any folder on the beta host, the policy-free launcher also works without
changing into the repository. Use `--reveal` only in a private local console:

```powershell
& "C:\Users\ancho\V1.VsStudioAccountingSoftwareBuild\ClearLedger-Test-Bundle-0.14.0-rc.1-20260725\ClearLedger-Codex-Ready\scripts\show-pennywise-beta-access.cmd" --reveal
```

To rotate access safely, rerun the initializer with `--rotate-access`. If the
supervisor is already running, it is stopped and restarted before the command
returns so no old password remains active in memory. Check `status` shows every
required share as `READY` before distributing the replacement password:

```powershell
node scripts/pennywise-beta-access.mjs init --rotate-access --install-task --start
node scripts/pennywise-beta-access.mjs status
```

Each protected share opens its configured fresh company automatically. The demo company remains an explicit in-product test option; it is not selected by the tunnel.

To stop the beta shares without affecting QBWooBridge or any non-PennyWise tunnel:

```powershell
node scripts/pennywise-beta-access.mjs stop
```

Add `--uninstall` to remove the logon task as well. The share host must remain powered on, signed in as that Windows user, connected to the internet, and not asleep. A continuously available staging service requires a separately hosted deployment.

## One-off maintenance share

For short-lived maintenance only, set the access password in the process environment rather than passing it on the command line:

```powershell
$env:DATABASE_URL = "retrieve the approved 127.0.0.1:55432/clearledger connection value from your local setup"
$env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = "retrieve the stable beta key from the local encrypted store"
$env:SHARE_ACCESS_PASSWORD = "retrieve the tester's current password from the local encrypted store"
$env:PENNYWISE_ALLOW_ONE_OFF_SHARE = "1"
node scripts/start-loclx-share.mjs --email trusted.tester@example.test --name "Trusted Tester" --organization YOUR-ORGANIZATION-UUID --subdomain pennywise-maintenance --reserved --username trusted-tester
```

`--password` is intentionally retired because Windows process listings can expose command-line arguments. The launcher accepts only a `pennywise*` domain, the loopback beta database at `127.0.0.1:55432/clearledger`, and the protected port band `3100-3701`; use the persistent supervisor for ordinary beta access.

## Add live commerce webhooks

The protected browser share cannot receive provider webhooks because
WooCommerce and Etsy cannot answer its Basic Authentication challenge. For
trusted integration testing, run one separate LocalXpose (`loclx`) relay for
the API deployment. The relay has no browser Basic Authentication and must
never be used as a browser or general API URL. Do not put the browser share's
Basic Authentication credentials in a provider webhook URL, and do not give
the webhook-only origin to a browser tester.

Choose a second, distinct subdomain. Start the protected application share in
the first PowerShell window and tell its API which public webhook origin to
advertise:

```powershell
node scripts/start-loclx-share.mjs --email trusted.tester@example.test --name "Trusted Tester" --organization YOUR-ORGANIZATION-UUID --subdomain pennywise-maintenance --reserved --username trusted-tester --webhook-base-url https://pennywise-hooks-test.loclx.io
```

In a second PowerShell window, start the webhook-only relay. Port `3101` is the
controlled-share API default; choose another unused relay port if `3500` is
occupied.

```powershell
node scripts/start-loclx-webhook-share.mjs --subdomain pennywise-hooks-test --reserved --api-port 3101 --relay-port 3500
```

Omit `--reserved` from both commands when using temporary, unreserved
subdomains. Keep both windows open. `CONNECTOR_WEBHOOK_BASE_URL` (or the
launcher's equivalent `--webhook-base-url`) only changes the HTTPS origin shown
by ClearLedger; it does not start the relay.

Run only one relay for each ClearLedger API deployment, not one per company or
store. All WooCommerce and Etsy connectors on that API use the same origin and
their own installation UUID path. A second API deployment needs a different
relay, subdomain, and `CONNECTOR_WEBHOOK_BASE_URL`.

### Relay boundary

The relay forwards only provider-signed requests matching these allowlisted webhook
paths:

- `POST /v1/webhooks/commerce/woocommerce/INSTALLATION-UUID`
- `POST /v1/webhooks/commerce/etsy/INSTALLATION-UUID`

An optional `/api` prefix is also accepted for compatibility. Other paths and
HTTP methods return `404`. The relay forwards only the provider signature and
delivery headers, limits bodies to 1 MiB, applies the LocalXpose rate limit,
and sends requests only to the loopback API. The UUID is routing information,
not authentication; ClearLedger still verifies the provider signature over
the exact raw body.

### Register and verify provider delivery

After the relay and API are running, refresh **More -> Integrations**:

- For WooCommerce, use **Webhooks** on the connected-store row. The connector
  needs read/write REST API credentials to create the three supported order
  webhooks. Read-only credentials remain suitable for polling only.
- For Etsy, use **Webhook setup**, copy the generated relay URL into Etsy's
  Webhook Portal, subscribe to `order.paid`, `order.canceled`, `order.shipped`,
  and `order.delivered`, then save Etsy's signing secret in ClearLedger.

Send a provider test delivery or a disposable order and confirm the connector
records a verified webhook. Continue periodic polling because it catches
provider edits or refunds that a webhook may omit. If the public origin
changes, restart the API with the new base URL, update or re-register every
provider destination, disable stale destinations, and verify another signed
delivery.

## Production boundary

This relay is a controlled-test convenience, not production ingress. It stops
with its PowerShell window, computer, network, or LocalXpose session. Production
requires stable DNS and TLS, a managed reverse proxy or equivalent path-specific
ingress, service supervision, health monitoring, alerting, request logging,
rate limiting, availability planning, and verified raw-body preservation.
Expose only the signed commerce webhook paths; never publish the development
API port, protected browser share, or full web proxy without authentication.

## Safety notes

- Use a dedicated non-owner test member whenever possible. The shared person has the permissions assigned to the selected member.
- Do not use your owner email unless you intentionally want the shared person to have owner-level access.
- The persistent initializer retains the generated password on ordinary restarts. Use `--rotate-access` only when deliberately rotating tester access, then distribute the new password privately.
- Never replace `CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET` after provider
  credentials have been stored. Disconnect the affected connector before a
  deliberate key change, then reconnect it using the new key.
- If Loclx says the subdomain is unavailable, choose another unused subdomain.
- Never send the webhook-only URL to a browser user or add Basic Authentication
  to it; provider signatures are its authentication boundary.
- Stop the share immediately when testing is complete.
