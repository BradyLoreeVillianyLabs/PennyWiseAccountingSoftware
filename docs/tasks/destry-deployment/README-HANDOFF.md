# Destry Workwear handoff pack (H1–H7)

Prepared 2026-09-05. Four sequenced tasks that take the tree from "D1–D5 built" to
**an artifact the owner installs and uses**, ready to hand to Destry Workwear.

Like `D1`–`D6`, these are **prepared tasks, not authorizations**. `AGENTS.md`
requires the owner to record a task as the active phase in
`docs/status/CURRENT_PHASE.md` before Codex runs it, and to run one per session.

## Why this pack exists — the gap D1–D6 leaves open

`README.md` in this directory states the goal as "a working local install on the
Destry Workwear owner's computer." Measured against the tree on 2026-09-05, D3, D4
and D5 are **API-only**, and none of them scoped any operator interface:

| Feature                      | API                                                              | Web UI   |
| ---------------------------- | ---------------------------------------------------------------- | -------- |
| Order → invoice posting (D3) | `CommerceOrderConversionService`, wired in `app.ts`              | **none** |
| Picking slip (D4)            | `PickingSlipService`, `PickingSlipRenderService`, PDFs generated | **none** |
| Shipping labels (D5)         | `apps/api/src/services/shipping/`, `http/shipping-routes.ts`     | **none** |

Counted in `apps/web/`: `picking` 0, `packing` 0, `shipment` 0, `carrier` 0,
`waybill` 0, `commerce/orders` 0. `apps/web/index.html` declares 19
`data-workspace-target` values and none of them is a fulfilment or shipping
workspace. Grep the D3/D4/D5 task files for `apps/web`, `web UI`, `workspace`,
`button` or `screen`: no matches. The UI was never in scope, so its absence is a
specification gap rather than incomplete execution.

The consequence for the handoff is concrete: with D1–D6 complete as written, the
owner installs a package in which store orders can be converted, picking slips
rendered and labels purchased — **and cannot do any of it**, because there is no
screen that reaches those endpoints. `H1` closes that gap and is the largest item
in this pack.

## The tasks

| #   | File                                         | Delivers                                                            | Depends on |
| --- | -------------------------------------------- | ------------------------------------------------------------------- | ---------- |
| H1  | `H1-fulfilment-operator-ui.md`               | The screens that make D3–D5 reachable: orders, picking, shipping    | D3, D4, D5 |
| H2  | `H2-installable-package-acceptance.md`       | Proof the package installs, updates, backs up and restores          | D1, H1     |
| H3  | `H3-destry-first-run-and-migration.md`       | The owner's real business configured and their data migrated        | D2, H1, H2 |
| H4  | `H4-client-handoff-kit.md`                   | What Destry actually receives, in their hands                       | H1–H3, D6  |
| H6  | `H6-first-run-backup-destination.md`         | First run must survive a wrong backup folder instead of crashing    | H2 install |
| H7  | `H7-packaged-database-init-access-denied.md` | initdb cannot spawn its own bundled postgres.exe inside the package | H2 install |

`H1` adds product surface; `H6` and `H7` repair it. `H2`–`H4` turn a build into
a delivery.

`H6` was found by installing the frozen `0.14.0.4` candidate on 2026-09-06: the
package installs and launches, then terminates if the operator picks a backup
folder on the same disk as their books. It blocks the client handoff.

`H7` was found immediately after, installing the H6-fixed `0.14.0.5` candidate:
first launch now gets past backup configuration for the first time on any
machine, then fails inside `initializeDatabase` — `initdb.exe` cannot spawn its
own bundled `postgres.exe` (`Access is denied`), even though the same bytes run
fine as the system's own PostgreSQL install. It blocks first launch entirely,
so it supersedes H2 acceptance testing until resolved.

H7 completed on 2026-09-06 with `0.14.0.9`: PennyWise verifies and stages its
bundled PostgreSQL runtime in private local data before execution, allowing
PostgreSQL child processes to run outside the immutable MSIX file boundary. The
same-machine API and web health checks passed. At that time H2 resumed with
`.9`; its scheduled-backup XML acceptance defect and clean-machine evidence
remained open. The current 2026-09-08 H2 candidate is recorded immediately
below.

## Current H2 beta handoff — 2026-09-08

The previous MSIX candidate language above is historical. The current H2
supervised-beta handoff is a direct, self-contained Inno Setup installer rather
than an MSIX transfer:

`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`

Its only transfer files are `PennyWise-Beta-02-Setup.exe`, its `.sha256` sidecar,
and `START-HERE.txt`. The setup is 0.14.0.15, signed by `PennyWise Accounting
QA`, carries BETA_20 participant slot 02, and has SHA-256
`7f0d0a6ae0c17ab1092dfd5db99ed3558c3b9be76d0b49ef191b3f9b88b84211`.

The exact staged payload passed a disposable-profile first run: activation,
private PostgreSQL initialization, migration, API and web health, verified
backup, scheduled-task wrapper registration, and controlled shutdown. The
installer itself has a valid post-build Authenticode signature and the native
test suite passed 14/14. Owner field reports now add successful fresh Windows 11
install/launch, reboot continuity, and installation on a second Windows system;
see `docs/status/H2_CLEAN_INSTALL_FIELD_REPORT_2026-09-08.md`. H2 still needs
prompt/host metadata and the remaining lifecycle drills. Restore is deliberately
deferred, not attempted. Do not use an old `.4`, `.5`, `.9`, or `.13` package to
create further evidence; do not replace 0.14.0.15 in place if a repair is needed.

Claude is preparing product-gap prompts for the second beta. Keep that work out
of the frozen first-beta transfer folder. When it is merged, the same
participant-02 machine must receive a later version built with its existing
slot-02 activation to prove in-place upgrade. Assign a different fresh tester an
unused slot for operational tracking, but do not claim the current offline
package technically blocks copying: slot 02 has now worked on two systems.

See `docs/status/H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md` for the
evidence ledger and exact next-agent procedure.

`H2-MSIX-CLEAN-INSTALL-STARTUP-REMEDIATION-PROMPT.md` is retained only for a
separately authorized return to MSIX/Store work. The current direct-installer H2
session instead starts with the 2026-09-08 candidate report. Both routes retain
the rule that build-machine success is not clean-machine acceptance evidence.

## Relationship to D1–D6

These do not replace the D tasks and do not duplicate them.

- `D1` hardens the MSIX. `H2` **accepts** it — on a clean machine, by a
  non-developer path, including the upgrade and the restore.
- `D6` is the go-live drill on a disposable machine against the real store. `H4`
  is the **handoff artifact and its documentation**, which D6's runbook feeds.
- If `D6` has already run, `H2` and `H4` consume its evidence rather than
  repeating it; say so in the completion report instead of re-running drills.

## Constraints inherited from this program

Every constraint in `README.md` still applies and is not restated per task:

- The connector review boundary holds. Provider data stays non-posting until a
  human explicitly acts. **`H1` must not add a screen that posts automatically.**
- PennyWise does not move money. Postage bills to the operator's own carrier
  account.
- No accounting invariant in `AGENTS.md` weakens. Posted journals stay immutable
  and balanced.
- Money stays in bigint minor units. Never a JavaScript `number`.
- Where credentials are unavailable, build the adapter, fixtures and tests, and
  document the required environment variables. Never fake a live integration.

## Verification note that applies to all four

`scripts/run-browser-tests.mjs` **exits non-zero on a developer machine even when
every test passes**: after Playwright it runs `verify-release-candidate.mjs`, whose
security mode rejects any `.env` on disk, and local development requires `.env`.
Judge these tasks on the Playwright result line, not the exit code.

The browser specs also require an **empty** database — they use fixed identities
(`phase14-<project>@example.test`), so a reused database produces widespread false
failures. The script now fails fast with an explanatory message when it detects
this; create a fresh database (name still matching `clearledger*_test`) per run.

`release-candidate.spec.ts:21` is unreliable on `mobile-webkit`, failing at five
different assertions across runs of identical code. Do not treat it as a signal
without reproducing it on a second clean run.

## Later product-gap transfer candidate — 2026-09-12

X1 source work is packaged separately from the frozen H2 candidate as
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.18`.
Use only its `PennyWise-Beta-05-Setup.exe`, `.sha256` sidecar, and
`START-HERE.txt`. The candidate is BETA_20 slot 05, SHA-256
`387b8de656badaf708ed838b995b614e05aa78b5170c920da9bf658d09e78c79`, and is
ready for supervised transfer testing, not clean-machine-accepted. See
`docs/status/X1_INSTALL_CANDIDATE_REPORT_2026-09-12.md` for package evidence
and the exact integration-suite boundary. Do not replace the frozen H2 folder.

## X2 report-experience handoff — 2026-09-12

X2 is complete in source and recorded in
`docs/status/X2_REPORT_EXPERIENCE_REPORT_2026-09-12.md`. It adds the report shell,
in-place drill-down, persisted report views, accessible negatives, dashboard amount
privacy, and layout/performance evidence. The next candidate must be versioned from
this source state; keep all earlier transfer candidates unchanged and do not report
clean-machine acceptance until the supervised Windows run is recorded.

The prepared X2 participant-05 candidate is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.19`. Its SHA-256 is
`984ebf71ab695e044d57c52a23886caff0bed07957df22e49a49040822a673bf`; use only
the executable, sidecar, and `START-HERE.txt` for transfer.
