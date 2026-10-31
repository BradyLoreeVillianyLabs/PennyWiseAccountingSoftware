# H7 — Packaged first launch: initdb cannot spawn its own bundled postgres.exe

Historical task record. H7 was authorized, implemented, and its resolution is
recorded below; `docs/status/CURRENT_PHASE.md` controls the remaining H2 scope.

Found 2026-09-06 installing the H6-fixed `0.14.0.5` candidate on the build
machine. This is the first time any install attempt on any machine has gotten
past first-run backup configuration — H6 fixed that crash, and this is a new
failure one step further in, inside `initializeDatabase`.

## Resolution and current handoff — completed 2026-09-08

H7 is resolved. PennyWise now verifies and copies its bundled PostgreSQL runtime
to the installation's private local-data directory before executing PostgreSQL
tools. This avoids the immutable `WindowsApps` grandchild-process boundary while
preserving a bundled, hash-verified runtime. The regression coverage is in
`distribution/windows-native/native-operations.test.mjs`.

The active controlled-beta delivery also changed from an MSIX transfer to the
direct Inno Setup candidate at
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`. Its exact staged
payload has successfully initialized the copied runtime, deployed migrations,
reached API/web HTTP 200, made a verified backup, and shut down cleanly in a
disposable profile. The setup itself is signed and ready for the remaining H2
physical clean-host run.

Do not reopen this task by modifying ACLs in a historical MSIX or by swapping
PostgreSQL binaries. If a future physical-clean-host run fails, preserve the
log and reproduce against the frozen 0.14.0.15 artifact first; issue a later
candidate only after the cause is known. See
`docs/status/H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md` for the current
handoff boundary.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `distribution/windows-native/launcher.cjs:388-500` — `initializeDatabase`
4. `distribution/windows-native/Build-PennyWiseMsix.ps1:89-92` — how PostgreSQL is staged into the package

## Observed failure

```
2026-09-06T19:55:27.046Z RUN initdb.exe -D C:\Users\EmceeHax\AppData\Local\PennyWiseAccounting\postgresql
  --username=pennywise_owner --pwfile=...\.owner-password --auth=scram-sha-256 --encoding=UTF8 --locale=C
2026-09-06T19:55:27.110Z FATAL PennyWise Accounting could not start: Error: initdb.exe failed (1): Access is denied.
no data was returned by command ""C:/Program Files/WindowsApps/TypeWritingMonkeys.PennyWiseAccounting_0.14.0.5_x64__td20hrdjk2ck0/resources/postgresql/bin/postgres.exe" -V"
child process exited with exit code 1
initdb: error: program "postgres" is needed by initdb but was not found in the same directory as
".../resources/postgresql/bin/initdb.exe"
```

`initdb.exe` itself launched successfully as `launcher.cjs`'s child (the `RUN
initdb.exe ...` line is `run()`'s own pre-flight log, so the process started).
It then tries to run its own bundled `postgres.exe -V` as a health probe, as
part of normal `initdb` behaviour, and that spawn is refused by Windows with
`Access is denied` — not a missing-file error; `initdb`'s "was not found"
wording is its generic wrapper text for any failed probe, not literal.

## What was ruled out

Evidence gathered directly on the build machine before writing this up, so the
next session doesn't repeat the same dead ends:

- **Not file corruption.** `Get-FileHash` on the packaged `postgres.exe` and on
  the live system install at `C:\Program Files\PostgreSQL\17\bin\postgres.exe`
  produce the **identical** SHA-256
  (`8ae8bb442e8a4c4fb2c8e9ad38c19aca610ee3cba33afd69249de769f905329`). The system
  copy runs fine (`postgres (PostgreSQL) 17.11`, exit 0). The bytes are correct.
- **Not a truncated/unreadable file.** `[System.IO.File]::ReadAllBytes` on the
  packaged copy succeeds, all 9,939,456 bytes.
- **Not Smart App Control** (confirmed `Off`), **not AppLocker** (`Get-AppLockerPolicy
-Effective` returns 0 rule collections), **not Software Restriction Policy** (no
  `Safer\CodeIdentifiers` key in HKLM or HKCU), **not a third-party antivirus**
  (`root\SecurityCenter2` `AntiVirusProduct` is empty), **not an ASR block**
  (no Event ID 1121-1124 in `Microsoft-Windows-Windows Defender/Operational`
  around the failure time).
- **Not simply "you can't run a packaged exe directly."** True, but a red
  herring here: an ordinary unpackaged process (an interactive PowerShell
  session) gets `Access is denied` trying to run **any** binary out of
  `...\resources\...` directly — including `node.exe`, the same binary that
  _is_ the app's own launcher when started properly through the package. That's
  normal MSIX package-identity enforcement (only a process descended from the
  package's own declared entry point may execute its bundled files) and is not
  the bug. The real question is why the denial happens **one level deeper than
  it should**: `launcher.cjs`'s `node.exe` (package-context) successfully spawns
  `initdb.exe` (package-context, confirmed by its own `RUN` log line), but when
  `initdb.exe` spawns `postgres.exe` as _its_ child, that grandchild spawn is
  refused. First-level package-context spawn works; second-level does not.
- **ACL comparison is the one real lead.** `icacls` on the packaged copy shows
  entries the working system copy does not have, including
  `BUILTIN\Users:(R)` (read only, no execute) as a **separate** ACE alongside
  `BUILTIN\Users:(Rc,S,RD,REA,X,RA)` (which does list `X`), plus a package-scoped
  `S-1-19-512-4096:(RX,D,WDAC,WO,WA)` entry absent from the system copy. The
  system copy's ACL is the plain, ordinary Program Files pattern
  (`SYSTEM:(F)`, `Administrators:(F)`, `Users:(RX)`,
  `ALL APPLICATION PACKAGES:(RX)`, `ALL RESTRICTED APPLICATION PACKAGES:(RX)`).
  The packaged copy is missing a plain `ALL APPLICATION PACKAGES:(RX)` entry
  entirely — it only has `ALL RESTRICTED APPLICATION PACKAGES:(RX)`. Whether
  `initdb.exe`'s child-spawn of `postgres.exe` runs under a _restricted_
  capability set that the plain `ALL APPLICATION PACKAGES` group would have
  covered but `ALL RESTRICTED APPLICATION PACKAGES` does not is the leading
  hypothesis, not yet confirmed.

## Suggested next steps

- Reproduce with Sysinternals Process Monitor filtered to `postgres.exe`,
  capturing the `CreateProcess`/`Process Create` result and the exact NTSTATUS,
  which will show precisely which ACE or capability check fails, rather than
  reasoning about it from `icacls` alone.
- Compare `initdb`'s own process-creation call (it uses `CreateProcess`
  directly, not a shell) against how `launcher.cjs`'s `run()`/`spawnSync`
  invokes `initdb.exe` itself — if the launcher's spawn passes flags or a
  token `initdb` does not, that would explain a difference between the two
  levels.
- Consider whether `pg_ctl`, `psql`, `pg_dump`, and `pg_restore` — every one of
  which `launcher.cjs` and `native-operations.cjs` invoke as a **grandchild**
  the same way `initdb` invokes `postgres.exe` — have the same problem. If so
  this blocks the entire native package, not just first-run database creation,
  and is not specific to `initdb`/`postgres.exe`.
- If the `ALL APPLICATION PACKAGES` vs `ALL RESTRICTED APPLICATION PACKAGES`
  distinction is confirmed as the cause, the fix likely belongs in
  `Build-PennyWiseMsix.ps1`'s PostgreSQL staging step (`:89-92`) — either an
  explicit ACL grant after copying, or an `AppxManifest.xml` capability change
  affecting which package-SID group Windows assigns these files at install
  time.

## Constraints

- `0.14.0.5` is the current H2 candidate and its hash is already published;
  do not rebuild it under the same version. This needs its own next candidate.
- No change to PostgreSQL itself or to which binaries are bundled — this is a
  packaging/permissions question, not a database question.

## Acceptance criteria

- A clean first launch reaches a running database and completes first-run
  setup on this same build machine, without disabling any Windows security
  feature to get there.
- Whatever grandchild-process pattern was actually broken (initdb→postgres,
  and potentially pg_ctl/psql/pg_dump/pg_restore's own child spawns) is
  covered by a regression test in `native-operations.test.mjs` or the MSIX
  lifecycle drill, not just fixed ad hoc.
