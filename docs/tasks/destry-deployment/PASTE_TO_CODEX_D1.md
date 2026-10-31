# Paste to Codex — authorize and execute D1

Copy everything below the line into a fresh Codex session opened at the repository
root (`C:\Users\EmceeHax\Desktop\clearledger-src`).

Run one phase per session. When D1 reports complete, use the same pattern for
D2 — change the phase file, the phase name, and the `CURRENT_PHASE.md` entry.

---

You are continuing implementation of **PennyWise Accounting** (repository name
ClearLedger), a Canada-first small-business accounting, inventory and commerce
platform. This session executes exactly one authorized phase.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/status/CURRENT_PHASE.md`
4. `docs/tasks/destry-deployment/README.md`
5. `docs/tasks/destry-deployment/D1-native-package-hardening.md` — **the authorized task**
6. The files that task lists under its own "Read first"

## Authorization

The project owner authorizes **Phase D1 — Native Windows package hardening for a
single-owner install**, defined in
`docs/tasks/destry-deployment/D1-native-package-hardening.md`.

Execute only that phase. Do not begin D2–D6; they are prepared tasks, not
authorizations. Stop after the D1 completion report.

## Exact intention

The first real deployment of this product is a single Canadian business —
Destry Workwear, a women's workwear brand selling from a WooCommerce store and
shipping from a small warehouse — running PennyWise locally on the owner's own
computer. That owner is not technical and has no administrator supporting them.

`distribution/windows-native/` already bundles the API, web interface, a pinned
Node runtime and PostgreSQL into an MSIX that keeps data under
`%LOCALAPPDATA%\PennyWiseAccounting` on loopback only. What has never been shown is
that it survives ordinary life on that machine: reboots, Windows updates, a full
disk, an upgrade in place, and the day the owner needs yesterday's books back.

Make it a package someone installs once and relies on for years. Add no product
features in this phase.

## Boundary conditions

- Listeners bind to `127.0.0.1` only, with no option to change that.
- Never ship a private signing key. The QA build's throwaway key stays under the
  ignored `build` directory. A self-signed MSIX is QA-only; public distribution
  requires Store signing, which this phase documents but does not perform.
- Backups must be restorable without PennyWise: documented layout, checksummed,
  and never written only to the same disk as the data.
- A restore must refuse a foreign installation with a clear message rather than
  silently crossing installation-specific secrets.
- The owner must never need a terminal, a config file, or a port decision.
- Do not weaken the PowerShell execution policy.
- Every accounting invariant in `AGENTS.md` still holds. This phase touches
  packaging, not posting.

## Development discipline

Follow `docs/tasks/TASK_EXECUTION_STANDARD.md` exactly.

- Give the pre-edit response first: likely files, critical risks, blocking
  decisions. Do not restate this task.
- Record the applicable module entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md` for
  packaging and deployment before declaring the module complete.
- Where a drill cannot run in this environment — no clean Windows 11 machine, no
  Store account — build the script, prove it against what is available, and
  document the exact manual steps and prerequisites required. Do not fake a passing
  drill, and do not report an unverified step as verified.
- Run the required quality gate in `AGENTS.md` and report actual results including
  failures and anything skipped, with the reason.
- Update documentation for every contract, command, environment variable or
  procedure this phase changes. Use an ADR for irreversible packaging decisions.
- Keep the final report under 1,200 words. Do not emit whole source files.

## Development environment on this machine

Verified 2026-09-01: Node v24.18.0, npm 11.16.0, corepack 0.35.0, Docker 29.7.2
with Compose v5.4.0 and a running Linux engine. PostgreSQL and Redis come from
`docker-compose.yml` (ports 5432, 5433, 6379).

Docker is a development dependency of this machine only. The shipped product is
the native MSIX and must not acquire a container dependency.

Setup and debugging are documented in
`docs/tasks/destry-deployment/DEV_DEBUG_SETUP.md`.
Run `docs/tasks/destry-deployment/Check-DevPrereqs.ps1` to confirm the environment.
