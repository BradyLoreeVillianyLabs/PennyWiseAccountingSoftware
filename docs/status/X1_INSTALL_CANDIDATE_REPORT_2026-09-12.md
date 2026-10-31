# X1 install candidate report — 0.14.0.18

Date: 2026-09-12  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`

## Transfer candidate

The X1 source changes are packaged as a new, immutable supervised beta
installer. The earlier `0.14.0.15`, `0.14.0.16`, and `0.14.0.17` folders were
not overwritten.

- Folder: `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.18`
- Installer: `PennyWise-Beta-05-Setup.exe`
- BETA_20 allocation: slot 05
- Size: 273,150,512 bytes
- SHA-256: `387b8de656badaf708ed838b995b614e05aa78b5170c920da9bf658d09e78c79`
- Authenticode signer: `CN=PennyWise Accounting QA`
- `signtool verify /pa`: passed
- Sidecar hash comparison: passed

The handoff folder contains exactly `PennyWise-Beta-05-Setup.exe`, its
`.sha256` sidecar, and `START-HERE.txt`. The certificate, Visual C++ runtime,
PostgreSQL 17, application payload, and offline activation are embedded in the
installer; no extra dependency or sign-up is required for the supervised beta
install.

## Payload checks

- Staged release metadata reports package version `0.14.0.18` and
  `self-contained-inno` distribution.
- 129 Prisma migration directories are present in the staged application.
- The staged web bundle contains the X1 inline-rate panel, CAD/USD controls,
  KWD handling, and tax/fulfilment UI markers.
- The build pipeline regenerated Prisma, rebuilt the web and API packages,
  deployed production dependencies, loaded the staged database module, signed
  the runtime executables, and compiled the Inno setup successfully.

## Verification boundary

Post-patch `format:check`, `lint`, and `typecheck` passed. The focused X1 unit,
invoice-document, web, and Playwright fallback acceptance passed earlier in the
X1 report; Chromium was 1/1 and the release accessibility/performance contracts
passed. The full integration run completed 242/255 tests: 13 failures were
concentrated in long-suite database reachability/concurrency paths. A fresh,
migrated targeted rerun of the affected ledger file passed 28/28, so this is
recorded as a test-environment/contention boundary rather than relabelled as a
full-suite green result.

The all-mode release hygiene check also correctly stopped on the existing local
`.env` file. It was not read, changed, or included in the staged payload. A
clean-machine install, first-run launch, and human Windows acceptance still
need to be recorded on the receiving host; this build-machine report does not
claim those gates.

## Test-machine instruction

Use only the three files in the candidate folder and follow
`START-HERE.txt`. Verify the SHA-256 before running setup, then launch from the
Start menu after installation. Record SmartScreen/UAC wording, first-run
company creation/deletion, tax/currency/report/fulfilment flows, and the backup
destination invalid-choice check.
