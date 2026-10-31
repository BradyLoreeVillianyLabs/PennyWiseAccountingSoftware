# Running and debugging PennyWise on this development machine

Written 2026-09-01 for `C:\Users\EmceeHax\Desktop\clearledger-src`. Complements
`WINDOWS_TESTING.md`, which covers the same ground generically; this file records
what is actually installed here and what is not.

## What this machine already has

| Requirement                   | Status                                           |
| ----------------------------- | ------------------------------------------------ |
| Node.js ≥ 22                  | **v24.18.0** — fine                              |
| npm                           | 11.16.0                                          |
| corepack                      | 0.35.0                                           |
| PostgreSQL 17 packaging tools | **installed** (`C:\Program Files\PostgreSQL\17`) |
| Redis 7                       | **Docker service healthy** on 6379               |
| Docker                        | **installed**; compose services healthy          |

The local Compose data services and native packaging toolchain are ready. The
native MSIX still requires a clean-machine lifecycle drill before release claims
can be made.

## Choose how to provide Postgres and Redis

`docker-compose.yml` expects three services: `postgres` (5432), `postgres-test`
(5433) and `redis` (6379).

**Option A — Docker Desktop.** One install, and the compose file works untouched,
including the separate test database that `scripts/require-isolated-test-database.test.mjs`
insists on. This is the least fiddly path.

> Installing Docker here does **not** contradict the Docker-free deployment goal.
> Docker is a development dependency on this machine only. The shipped product is
> the native MSIX from `distribution/windows-native/`, which bundles its own Node
> runtime and PostgreSQL and requires no container engine on the owner's computer.

**Option B — native services.** PostgreSQL 17 natively (two instances, or one
instance with two databases on different ports), plus a Redis-compatible service —
on Windows that means Memurai or Redis running under WSL. More moving parts, and
the test-isolation check is easy to trip. Choose this only if Docker is unwanted on
this machine.

Run `.\Check-DevPrereqs.ps1` from this folder to see current status at any time.

## First run

From the repository root in PowerShell:

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose up -d postgres postgres-test redis
corepack pnpm db:generate
# Prisma runs from packages/db, so explicitly load the root DATABASE_URL.
$env:DATABASE_URL = ((Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '')
corepack pnpm db:migrate:deploy
```

`.env` already points at the compose ports and development credentials, so no
editing is needed for a local run.

Then start the two processes in separate windows:

```powershell
corepack pnpm --filter @clearledger/api dev
```

```powershell
corepack pnpm --filter @clearledger/web dev
```

Web on <http://localhost:3000>, API on <http://localhost:3001>. The loopback
development identity adapter handles sign-in.

To get a populated organization rather than an empty one:

```powershell
node scripts/seed-full-demo-company.mjs
```

## Debugging

**API.** Start it under the inspector and attach from VS Code:

```powershell
$env:NODE_OPTIONS = "--inspect"
corepack pnpm --filter @clearledger/api dev
```

Attach to port 9229. A minimal `.vscode/launch.json` attach configuration is enough;
the API is plain Node, so breakpoints in TypeScript resolve through source maps in
the dev build.

**Web.** Browser devtools. `apps/web` is served as static assets with its own dev
process, so a hard reload picks up changes.

**Database.** With Docker, `docker exec -it <postgres-container> psql -U clearledger -d clearledger`.
Prisma Studio also works: `corepack pnpm --filter @clearledger/db exec prisma studio`.

**Logs.** `LOG_LEVEL=debug` in `.env` for verbose API logging. Pino output is JSON;
pipe it through a formatter if you want it readable.

## Running the checks

Point the tests at the **test** database, never the development one — the isolation
guard will refuse otherwise:

```powershell
$env:TEST_DATABASE_URL = "postgresql://clearledger:clearledger_dev_only@localhost:5433/clearledger_test?schema=public"
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
```

The full gate before declaring a phase complete:

```powershell
corepack pnpm check
```

That runs format, lint, typecheck, Prisma validation, the research matrix check,
unit tests, integration tests and build in sequence. It is slow; run the targeted
commands during development and this one at the gate.

## Optional local services

Several features can be exercised without any external provider:

- **Bank feeds** — `PENNYWISE_ENABLE_TEST_BANK=true` with `BANK_FEED_PROVIDER` set
  to the synthetic provider. It never contacts a financial institution.
- **Payments** — `STRIPE_MODE=test` with test keys, or leave blank and use manual
  payment recording.
- **Commerce connectors** — polling works over loopback with no public origin.
  Webhooks need `CONNECTOR_WEBHOOK_BASE_URL` and the LocalXpose relay described in
  `WINDOWS_TESTING.md`.

## Things that will bite

- Under PowerShell, `AGENTS.md` directs the use of `corepack.cmd` / `pnpm.cmd` when
  bare `.ps1` shims are blocked. If a command silently does nothing, try the `.cmd`
  form.
- `.env` is gitignored and must never be committed. Neither may generated Prisma
  clients or build output.
- The repo has a nested `packages/db/packages/db/` path carrying one stray
  migration. It came from the original tree and is harmless — the real migration set
  is the 107 under `packages/db/prisma/migrations`.
- `corepack pnpm dev` at the root starts every workspace in parallel, which
  interleaves output. Running api and web in separate windows is easier to read.
