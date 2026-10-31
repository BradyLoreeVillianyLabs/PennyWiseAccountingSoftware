# H7 packaged database-init access-denied report

Date: 2026-09-06  
Phase: H7 packaged database-init access denial  
Result: **engineering repair passed; H2 acceptance remains open**

## Delivered

- The MSIX build now generates a BOM-free SHA-256 manifest for all 1,752 bundled
  PostgreSQL runtime files.
- Before first use, PennyWise verifies the immutable packaged runtime, stages it
  under `%LOCALAPPDATA%\PennyWiseAccounting\runtime\postgresql`, verifies that
  copy, and replaces a stale or altered local copy only after staging verifies.
- All launcher, backup, and restore PostgreSQL tools resolve to that verified
  local runtime. This preserves PostgreSQL 17 and the bundled binaries while
  allowing `initdb.exe` to execute its own `postgres.exe` child.
- `pg_ctl` startup ignores inherited capture pipes, so its background server does
  not hold the synchronous launcher call open. Launcher command logging now
  redacts argument values named password, token, or secret.

## Candidate and evidence

- Artifact: `distribution/windows-native/output/PennyWise-Accounting-0.14.0.9-x64.msix`
- Size: `457,663,398` bytes
- SHA-256: `d5d8a050f2610800fb7d18232174675d35af1194b999ed05ea3fe2aa1a4be4a6`
- Signer: `CN=PennyWise Accounting QA`; local signature status: Valid.
- Archive inspection confirmed a BOM-free runtime manifest containing 1,752 file
  hashes.
- Same-machine MSIX test: package version `0.14.0.9` installed, seven PostgreSQL
  processes ran from the verified private runtime, and both
  `http://127.0.0.1:32101/health` and `http://127.0.0.1:32100` returned HTTP 200.

The initial clean bootstrap was observed before the final lifecycle polish:
`initdb` created `PG_VERSION` from the staged local runtime, and the following
final `.9` start validated the repaired `pg_ctl` boundary and both services. No
Windows security setting was disabled. This is build-machine evidence, not the
required clean-machine H2 acceptance.

## Verification

- `node --test distribution/windows-native/native-operations.test.mjs` — 11/11 passed.
- Prettier check for changed native files — passed.
- MSIX build with web/API production builds and staged Prisma generation — passed
  using `-SkipPrismaGenerate` because the generated Windows client was already
  current and active local processes must not be interrupted.
- Signature, sibling checksum, embedded manifest count, and BOM check — passed.

## Open H2 blocker

During the same-machine setup, `configureNightlyBackup` wrote the configuration
but `schtasks.exe` refused the generated task XML with `ERROR: The task XML is
malformed. (1,2)::ERROR: one root element`. This pre-existing lifecycle defect is
outside H7's PostgreSQL boundary but blocks H2 drill 4a. It must be corrected and
re-tested in H2 before `.9` is supplied for client testing.

Frozen `0.14.0.4` and `0.14.0.5` remain unchanged. Failed internal candidates
`0.14.0.6`–`0.14.0.8` are not H2 artifacts.
