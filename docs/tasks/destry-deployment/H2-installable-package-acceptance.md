# H2 — Accept the package on a machine nobody has prepared

Prepared task. The historical authorization requirement is satisfied: H2 is
recorded as active in `docs/status/CURRENT_PHASE.md`. That status file controls
the current candidate and scope.

## Current handoff state — 2026-09-08

H2 is authorized and remains active. The current controlled-beta artifact is not
the older MSIX package named elsewhere in this historical task. It is the direct
Inno Setup package in:

`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`

Use only `PennyWise-Beta-02-Setup.exe`, its SHA-256 sidecar, and
`START-HERE.txt`. The exact executable is version `0.14.0.15`, BETA_20 slot 02,
and its expected SHA-256 is
`7f0d0a6ae0c17ab1092dfd5db99ed3558c3b9be76d0b49ef191b3f9b88b84211`.

The direct installer includes its private PostgreSQL runtime, Microsoft Visual
C++ runtime, QA trust certificate, and offline activation. A fresh host must not
need a separate certificate import, Docker, Node.js, PostgreSQL, or terminal
command. Normal UAC and self-signed SmartScreen UI are evidence to record, not
controls to bypass. Do not use a historical MSIX candidate to close H2.

Before continuing, read
`docs/status/H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md` and
`docs/status/H2_CLEAN_INSTALL_FIELD_REPORT_2026-09-08.md`. They distinguish the
owner-reported successful two-system installation and reboot results from the
remaining unrun or deferred lifecycle drills.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `D1-native-package-hardening.md` and its completion report
4. `distribution/windows-native/README.md`, `Build-PennyWiseMsix.ps1`,
   `launcher.cjs`, `native-operations.cjs`, `sea-config.json`
5. `distribution/public-beta/qa/Test-PennyWiseMsixLifecycle.ps1`
6. `docs/BACKUP_AND_RECOVERY.md`
7. `docs/D6_GO_LIVE_RUNBOOK.md` if D6 has run

## Exact intention

D1 hardens the package. This phase decides whether it is deliverable, on the only
evidence that counts: a Windows machine that has never seen this project, driven
by the steps a non-developer would actually follow.

The question is not "does it build". It is: after the owner double-clicks the
installer, closes the laptop, gets a Windows update, fills the disk, and comes
back a month later wanting last Tuesday's books — does the software still work,
and can they get their data back?

Produce evidence, not assurances. A claim in a completion report that is not
backed by a recorded run of a named script on a stated machine does not count.

## Boundary conditions

- The install must not require administrator rights beyond what the MSIX itself
  requests, a package manager, a developer toolchain, or a terminal.
- Data stays under `%LOCALAPPDATA%\PennyWiseAccounting`, loopback only. Nothing
  listens on a routable interface.
- No step may instruct the owner to disable Defender, SmartScreen, or a firewall
  prompt. If the package cannot be installed without that, it is not deliverable
  and that is the finding.
- Backup and restore must work against the **native** data location. D1 recorded
  that `Backup-ClearLedger.ps1` targets Docker volumes; confirm which path the
  shipped scripts now take before trusting either.

## Tasks

### 1. Clean-machine install

On a Windows install with no Node, no Docker, no PostgreSQL and no prior
PennyWise: install the package from the artifact alone. Record every prompt the
owner sees, verbatim, including any SmartScreen or signing warning. Launch from
the Start menu. Reach the dashboard and complete one real action end to end.

### 2. Survive ordinary life

Each of these is a separate recorded result, not a general assertion:

- reboot, then launch — data intact, no repair step;
- Windows update cycle, then launch;
- disk full during normal use — the failure is refused cleanly and does not
  corrupt the database;
- kill the process mid-write, then relaunch;
- launch twice — the second instance does not corrupt or double-bind.

### 3. Upgrade in place

Install the previous package version, create recognisable data, upgrade to the new
one. The data survives, migrations apply, and the owner is not asked to do
anything. Record what the migration step shows them, if anything.

### 4. Backup and restore, rehearsed

Follow `docs/BACKUP_AND_RECOVERY.md` exactly as written, as a non-developer would.
Where the documented step does not match the native install, fix the
**documentation and the script**, not the transcript.

- an unattended backup happens without being asked;
- a restore returns a known earlier state;
- restoring onto a _different_ machine works, since that is what happens after
  hardware failure;
- a corrupted or truncated backup is refused with a clear message rather than
  half-restored.

### 5. Uninstall

Uninstall leaves no service running and no listener bound. State plainly whether
it removes the owner's data or leaves it, and make sure the uninstall dialog says
which — a bookkeeping product silently deleting books is unacceptable, and
silently keeping them is a privacy claim that must be accurate.

## Constraints

- No product features. If a defect blocks acceptance, report it against the phase
  that owns it rather than fixing it here.
- Do not weaken a security or signing control to make a step pass.
- Where a step cannot be executed for want of hardware or a second machine, say so
  explicitly and mark it unverified. Do not describe an untested path as working.

## Acceptance criteria

- A written record, per numbered step, of what was run, on what, and what
  happened — including the exact text of every prompt the owner sees.
- Install, upgrade, backup, cross-machine restore and uninstall each demonstrated
  or explicitly marked unverified with the reason.
- `Test-PennyWiseMsixLifecycle.ps1` passes, or its failures are itemised with a
  judgement on whether each blocks handoff.
- A single stated verdict: **is this package deliverable to a non-technical owner,
  yes or no**, with the blocking items if no.

## Out of scope

Store, carrier and payroll integrations. The go-live drill against real data
(`D6`). Anything in `apps/`.
