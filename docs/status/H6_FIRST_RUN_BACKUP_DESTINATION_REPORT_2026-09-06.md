# H6 first-run backup destination report

Date: 2026-09-06  
Result: **PASS — engineering implementation and versioned QA candidate prepared**

## Delivered

- A same-volume folder is refused with an actionable error instead of allowing a
  first-run exception to terminate PennyWise.
- The picker retries up to three refused choices; cancel or exhausted retries
  return to the existing backup-deferral path, so the owner can start the books.
- Windows physical-disk detection labels destinations as a separate physical disk,
  separate volume on the same disk, or a separate volume whose physical disk could
  not be determined. The owner-selected policy permits the same-disk volume only
  with an explicit warning that it does not protect against disk failure.
- Recognised OneDrive/Dropbox folders and network locations remain accepted.
  Google Drive remains deliberately unallowlisted because no reliable local
  sync-root signal was verified; a separately mounted Drive volume remains usable.
- Native ZIP creation/restoration continues to use the absolute
  `%SystemRoot%\System32\tar.exe` path.

## Candidate

- Artifact: `distribution/windows-native/output/PennyWise-Accounting-0.14.0.5-x64.msix`
- SHA-256: `c1484d772f65856d5bf371fcb78c1673d07b94879b5089ec3e0604997cc2e442`
- Signer: `CN=PennyWise Accounting QA`
- Package version: `0.14.0.5`
- Bundled migrations: 112

The frozen `0.14.0.4` artifact remains byte-for-byte unchanged at its published
SHA-256. The `.5` archive was verified for the H6 picker-recovery and absolute-tar
contracts before any clean-machine installation.

## Verification

- Native operations tests: **9/9 passed**.
- Prettier checks and Node syntax checks: **passed**.
- Root ESLint and TypeScript typecheck: **passed**.
- Competitive research verifier: **21/21 baselines passed**.
- `Build-PennyWiseMsix.ps1 -Version 0.14.0.5 -SelfSign`: **passed**; MSIX signing
  and verification passed.

No schema, migration, accounting, tenant, provider, or archive-format change was
made. H2 clean-machine acceptance remains unverified and must now use `.5`, with
the H2 evidence template's full lifecycle drill.
