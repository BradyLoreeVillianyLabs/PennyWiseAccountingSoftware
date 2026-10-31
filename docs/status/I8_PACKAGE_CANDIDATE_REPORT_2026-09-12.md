# I8 package candidate report

**Date:** 2026-09-12  
**Source:** `C:\Users\EmceeHax\Desktop\clearledger-src`  
**Candidate:** PennyWise Accounting `0.14.0.16`, participant slot 03

## Outcome

I8 is implemented in source and has a new self-contained Inno Setup candidate for
supervised Windows testing. The frozen `0.14.0.15` installer and its transfer folder
were not changed.

## Corrections made during final verification

- Scheduled reminders now include configured pre-due dates, use organization-local
  calendar dates, honor customer offset overrides, and skip invoices whose payments or
  posted credits leave no balance.
- Organization setup and setup completion now serialize the new late-fee minor-unit
  settings as strings instead of leaking PostgreSQL `BigInt` values through JSON.

## Verification

Passed:

- `corepack pnpm test`: 18 native, 7 web, 9 shared, 35 accounting-core, and 277 API
  unit tests.
- `corepack pnpm test:research`: 21 modules.
- Root lint, typecheck, format check, Prisma validation, Prisma generation, and workspace
  build.
- Disposable PostgreSQL migration deployment: 127 migrations.
- Focused I8 acceptance: 1 test passed.
- Phase 3 setup regression acceptance: 14 tests passed.
- Phase 12 portability acceptance with a 30-second database hook budget: 21 tests passed.
- Books Health acceptance after the disposable PostgreSQL container recovered: 2 tests
  passed.

The default full integration harness was not recorded as a clean final pass: one run
before the setup serializer fix caught the expected 500 regression; a later run had
database-reset timing failures and a subsequent high-budget run was interrupted by a
transient loss of the disposable PostgreSQL connection. Those results are not reported
as product passes. The focused affected suites above are the final evidence for the
changed paths.

## Installer artifact

Folder:

`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.16`

Transfer these files:

- `PennyWise-Beta-03-Setup.exe`
- `PennyWise-Beta-03-Setup.exe.sha256`
- `START-HERE.txt`

Artifact facts:

- Size: 272,955,536 bytes
- SHA-256: `86e742f4e1c82b0f1682010ae785fcd724b418ee39026ba25c40292273a31914`
- Authenticode: valid on the build machine
- Signer: `CN=PennyWise Accounting QA`
- Distribution: self-contained Inno Setup
- Activation: one-time offline BETA_20 participant slot 03
- Includes the Microsoft-signed VC++ x64 runtime, verified during build
- Does not include Docker, Node.js, a PostgreSQL installation, or issuer private material

## Remaining external gate

No clean Windows 10/11 machine was available in this session. The installer is ready
for a supervised clean-host attempt, but install, first launch, fresh trial-company
create/delete, and packaged tax/statement/reminder/fulfilment flows remain manual
acceptance evidence. Follow `START-HERE.txt` and record every UAC or SmartScreen prompt;
do not describe those steps as verified until performed on the clean host.
