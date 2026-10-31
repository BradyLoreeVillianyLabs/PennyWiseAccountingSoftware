# H2 package candidate preparation

Date: 2026-09-05  
Phase: H2 installable package acceptance  
Result: **candidate prepared; acceptance not run**

> Superseded for testing by the independently verified `0.14.0.4` candidate in
> `H2_PACKAGE_CANDIDATE_VERIFICATION_2026-09-06.md`. Do not use this older,
> pre-tax-work candidate for H2 acceptance.

## Candidate

- Artifact: `distribution/windows-native/output/PennyWise-Accounting-0.14.0.2-x64.msix`
- SHA-256: `4cebd49373161f10e87db175256bb5dd0412545386b4a2fdd09c7f1b6cfca855`
- Sidecar: `PennyWise-Accounting-0.14.0.2-x64.msix.sha256`
- QA certificate: `PennyWise-Accounting-QA.cer`
- MSIX identity: `TypeWritingMonkeys.PennyWiseAccounting`, version `0.14.0.2`,
  x64, publisher `CN=PennyWise Accounting QA`

This is the first candidate built after H1. Its archive contains the H1
Fulfilment workspace together with the primary, Backup, Restore, and Support
Diagnostics executables.

## Local preparation evidence

- Native package contract tests passed: 5/5.
- `Test-PennyWiseMsixLifecycle.ps1` PowerShell syntax check passed.
- `Build-PennyWiseMsix.ps1 -Version 0.14.0.2 -SelfSign` completed successfully.
- The MSIX SHA-256 matched its sidecar; archive identity, release metadata,
  companion executables, native operations, and H1 web payload were verified
  without installing the package.

The build intentionally did not import the QA certificate, install the MSIX,
start PennyWise, create package runtime data, or run lifecycle acceptance. The
self-signed chain is therefore untrusted on this machine. That is expected for a
QA artifact and is not Store signing.

## Ready-for-test boundary

Run the controlled QA test only on a clean Windows 11 x64 machine, using the
evidence template and `Test-PennyWiseMsixLifecycle.ps1`. Verify the hash before
any certificate import or installation. Record all user-visible prompts and keep
the final status **UNVERIFIED** until the clean-install, restart, update,
backup/restore, failure-state, and uninstall observations are captured.

The current deliverability verdict is **NO — not yet accepted for a
non-technical owner**. This is an honest evidence gate, not a build failure.
