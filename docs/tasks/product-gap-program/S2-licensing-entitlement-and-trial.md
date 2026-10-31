# S2 — Turn the beta activation mechanism into something you can sell

Commercial-readiness prompt. Prepared, not authorized: record it in
`docs/status/CURRENT_PHASE.md` before starting.

## Why

PennyWise cannot be sold until it can be licensed, and the groundwork already exists. What
is missing is everything between "a 20-slot beta file" and "a customer paid for this".

The market evidence, with sources in
`codex-product-gap-pack/MONETIZATION-AND-FEATURE-ASSESSMENT-2026-09-12.md`:

- **Sage 50** ended perpetual licences and drops to **read-only** when a subscription
  lapses. Owners resent it, and it is the single most repeated complaint in the desktop
  refugee market.
- **AccountEdge** still sells a perpetual licence at roughly **$499** plus **$150–199/year**
  for updates. Perpetual licensing is not dead.
- **QuickBooks Online** has raised prices every year — roughly **12–17% annually per plan**
  since 2023.

That combination is PennyWise's opening: **buy it once, it never stops working, your data is
never held hostage, and the price doesn't climb every year.** The software has to make that
promise enforceable and true.

## What exists today

- `distribution/windows-native/application-activation.cs`, `provision-beta.cjs`, and
  `scripts/pennywise-beta-activation.mjs` with its test: offline, Ed25519-signed,
  package-provisioned activation for at most twenty operationally issued beta slots.
- `apps/api/src/services/commercial-service.ts` and `/v1/commercial/*` routes: subscription
  and provider-event records, with **no user interface**.
- No paid tiers, renewal, seat or company limits, machine transfer, or lapse behaviour.

## Tasks

1. **Licence model.** Support, as data rather than hard-coded branches:

   - **Owner perpetual** — a one-time licence, optionally with a dated updates-and-support
     term.
   - **Firm per-client** — a count of active client organizations (S3 consumes this).
   - **OEM deployment** — issued per partner build (S4 consumes this).

   Each licence carries: product edition, limits, issue and expiry dates, the issuing key
   id, and a human-readable summary.

2. **Offline activation, productized.** Keep the existing Ed25519 signing, and add:

   - issue, verify, revoke, and reissue;
   - **transfer to a new computer** with an explicit deactivation step;
   - tolerance for ordinary hardware changes, so a new disk doesn't void a licence;
   - clear errors that say what happened and how to fix it.

3. **Lapse behaviour, and make the promise real.** When an updates term ends or a
   subscription lapses:

   - the software **keeps working** for reading, reporting and **full export**, always;
   - only _new posting_ is restricted, and only where a paid edition says so;
   - the UI states exactly what changed, before it changes.

   Never brick the product, and never withhold the owner's data.

4. **Trial.** A full-featured trial, time-boxed, with no crippled accounting and no data
   deletion at the end. When it ends, it degrades to the lapse behaviour above.

5. **Entitlements gate features, never integrity.** A licence may hide a module. It may
   never weaken an accounting invariant, an audit record, tenant isolation, or an export.

6. **Licence screen.** Settings shows the licence, its limits, what happens at expiry, the
   transfer action, and an offline activation flow that a non-technical owner can complete.

7. **Honest anti-tamper.** Verify signatures and record failures in the audit trail. Do not
   claim the scheme is unbreakable, and do not add covert phone-home checks. Document the
   threat model: this deters casual copying, not a determined attacker.

8. **Commercial records.** Reuse `commercial-service` for the subscription or licence record
   and its events, and add the missing screen.

## Constraints

- **No network requirement.** Activation must complete fully offline, as the beta mechanism
  already does.
- **No hidden telemetry.** Anything sent is opt-in and visible (S5).
- Secrets and issuer private keys never enter the repository or the package.
- The frozen `0.14.0.15` installer stays frozen; this is source work.

## Acceptance criteria

- A licence is issued, activated on a clean machine with no network, and verified.
- Transfer: deactivate on machine A, activate on machine B; machine A drops to lapse state.
- Lapse: reporting and **full export still work**; new posting is blocked with a clear
  message; nothing is deleted.
- Trial start, expiry and conversion each behave as documented.
- A tampered licence file is refused and audited.
- Limits are enforced: an extra client organization beyond a firm licence is refused
  clearly.
- The licence screen is usable without documentation, and meets the X4 checks.

## Standard rules

- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.
- Meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` section 6.
- Keep LF endings; rebuild web assets; there is no git, so list every changed file.
