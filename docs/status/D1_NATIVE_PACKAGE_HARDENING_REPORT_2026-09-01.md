# D1 Native Windows package hardening — engineering report

Date: 2026-09-01  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Authorization: D1 is the only Destry deployment phase recorded as active in
`docs/status/CURRENT_PHASE.md`.

## Result

**Engineering implementation is ready for the remaining package/lifecycle
acceptance evidence. D1 is not release-accepted yet.**

The native path now has installation identity, private loopback-only runtime
startup, backup/restore/diagnostics companion modes, a bounded nightly task,
checksum-verified PostgreSQL/document archives, foreign-installation restore
refusal, actionable startup failures, QA-versus-Store signing separation, and a
scripted clean-machine lifecycle drill. D2–D6 remain planning artifacts and were
not implemented.

## Implemented surface

- `distribution/windows-native/native-operations.cjs` contains the native backup,
  restore, diagnostics, destination policy, scheduled-task wrapper, archive
  manifest, complete member checksums, and retention logic. Verification rejects
  tampered, duplicate, or unlisted archive members.
- `distribution/windows-native/launcher.cjs` exposes the main app plus Backup,
  Restore, and Support Diagnostics modes; persists installation identity; recovers
  stale locks; records startup state; and keeps listeners on `127.0.0.1`.
- `distribution/windows-native/AppxManifest.template.xml` includes the companion
  operation applications and package-integrity declaration.
- `distribution/windows-native/Build-PennyWiseMsix.ps1` finds the installed SDK,
  bundles PostgreSQL 17, keeps QA private keys under ignored build output, and
  creates an unsigned Store-submission path requiring an injected public license
  key. The package path removes the source Node signature before SEA injection so
  the resulting executable can be signed by SignTool; `-SkipPrismaGenerate` is a
  guarded diagnostic option for a caller that has a locked generated client.
- `distribution/public-beta/qa/Test-PennyWiseMsixLifecycle.ps1` asserts package
  identity, publisher continuity, install, upgrade-version continuity, and
  uninstall registration using the exact MSIX package identity. Reboot,
  first-launch, backup, restore, data retention, and sign-in observations remain
  explicit manual evidence steps.
- `docs/BACKUP_AND_RECOVERY.md` and `distribution/windows-native/README.md`
  document the owner workflow, recovery-secret handling, QA/Store boundary, and
  clean-machine evidence gate.

## Verified evidence

| Check                                                     | Result                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows SDK `makeappx.exe` and `signtool.exe`             | Installed and present under `Windows Kits\10\bin\10.0.22621.0\x64`                                                                                                                                                                                   |
| PostgreSQL 17 `initdb`, `pg_ctl`, `pg_dump`, `pg_restore` | Installed and present under `C:\Program Files\PostgreSQL\17\bin`                                                                                                                                                                                     |
| Dependencies and generated Prisma client                  | Installed/generated; frozen lockfile install passed                                                                                                                                                                                                  |
| Development migrations                                    | 107 migrations applied to the disposable dev database with root `DATABASE_URL` loaded explicitly                                                                                                                                                     |
| Research matrix                                           | Passed: 21 module baselines                                                                                                                                                                                                                          |
| Native contract tests                                     | Passed: 5/5, including archive tamper/completeness detection, wrapper policy, diagnostics redaction, round-trip restore, and boundary contracts                                                                                                      |
| Full workspace unit test                                  | Passed: root isolation/native tests, web tests, shared tests, accounting-core tests, and 206 API tests                                                                                                                                               |
| PostgreSQL integration test                               | Passed: 38 files and 232 tests against the isolated test database on port 5433; all 107 migrations applied                                                                                                                                           |
| Typecheck                                                 | Passed                                                                                                                                                                                                                                               |
| D1-scoped ESLint                                          | Passed for the changed native/API files; ignored test-script warnings are non-failing                                                                                                                                                                |
| Prisma schema validation                                  | Passed with the disposable root `DATABASE_URL` supplied to the Prisma child process                                                                                                                                                                  |
| PowerShell/Node syntax checks                             | Passed for the build script, lifecycle drill, launcher, and native operations                                                                                                                                                                        |
| Guarded QA MSIX build                                     | Passed with `-SelfSign -SkipPrismaGenerate`; MakeAppx packed 12,831 files and SignTool signed the 360.63 MB artifact                                                                                                                                 |
| QA MSIX artifact hash and package inspection              | Passed: SHA-256 `45c13d02f7215a22eaf509484b0c3027e36b869fab798da003248716f2140d5a`; sidecar matched; 12,831 unpacked files, manifest, and `PennyWiseAccounting.exe` plus three companion entry points checked                                        |
| Isolated default QA MSIX build                            | Passed from a fresh source copy without `-SkipPrismaGenerate`; root Prisma generation, staged generation, MakeAppx, SEA injection, and SignTool completed                                                                                            |
| Isolated default QA artifact hash and inspection          | Passed: SHA-256 `1ddcc100fa25406914877679b28eaf860b66ec264d13278f7019c23533659a12`; durable copy under `output/default-build-20260901`, sidecar matched, 12,804 files unpacked and package contract passed                                           |
| QA certificate trust verification                         | Not claimed: the self-signed certificate is not trusted by this machine; as of 2026-09-06 the build no longer supports automated certificate trust, and controlled QA trust is a separately recorded test-machine action. This is not Store signing. |

## Open acceptance evidence

The latest repository-wide quality rerun is not fully clean because
`pnpm format:check` reports 13 existing/out-of-scope files, including the
unauthorized D2 task and a concurrent `.review-pre-d6d7` snapshot. `pnpm lint`
now passes after excluding only the archived `.review-backup-*` snapshot pattern.
The D1-scoped files format and lint cleanly; the unrelated files were not
rewritten as part of D1.

The source-tree default package build was blocked by existing ClearLedger API
development processes holding `packages/db/generated-client/query_engine-windows.dll.node`
open. The default unskipped path was nevertheless completed from a fresh
isolated source copy and preserved under `output/default-build-20260901`; the
source-tree processes were not terminated.

A clean Windows 11 x64 machine without Docker, developer tooling, or terminal
access is not available in this environment. Therefore the following are not
claimed as passed:

- clean-machine MSIX install and first-launch sign-in;
- reboot and interrupted-startup recovery;
- upgrade-over-install with data and backup configuration preserved;
- uninstall with the documented data-retention choice;
- unattended scheduled backup to a second volume/synced folder;
- interactive restore against a real bundled PostgreSQL instance;
- Store certification/signing.

Run `distribution/public-beta/qa/Test-PennyWiseMsixLifecycle.ps1` on the clean
machine and append observed output plus screenshots/log hashes here. Do not turn
the result into a pass until each manual item has direct evidence. After D1's
completion report is accepted, update `CURRENT_PHASE.md` with the next owner-
authorized phase before starting it.
