# H2 package candidate verification

Date: 2026-09-06  
Phase: H2 installable package acceptance  
Result: **static candidate verification passed; clean-machine acceptance pending**

> Historical record only. H7 superseded this candidate with
> `0.14.0.9` (`d5d8a050f2610800fb7d18232174675d35af1194b999ed05ea3fe2aa1a4be4a6`)
> after repairing packaged PostgreSQL initialization. Do not use this artifact
> for H2 evidence.

## Candidate

- Artifact: `distribution/windows-native/output/PennyWise-Accounting-0.14.0.4-x64.msix`
- Size: `457,594,379` bytes
- SHA-256: `e23949b11b00cc14dabe34535e0d838ca38931d51fff3309f8d02ac3c8cdbe40`
- Publisher and signer subject: `CN=PennyWise Accounting QA`
- Package identity: `TypeWritingMonkeys.PennyWiseAccounting`, x64, version `0.14.0.4`
- QA certificate: `PennyWise-Accounting-QA.cer` beside the artifact

The archive hash matched its sibling sidecar. Archive inspection verified the
primary, Backup, Restore, and Support Diagnostics executables; H1's
`fulfilment-workspace`; the tax-code form, tax-jurisdiction report, product default
tax-code, tax-by-authority export, tax-jurisdiction grouping, and shipping-revenue
account-preset payload markers; and exactly 112 Prisma migrations.

The local certificate API reports the expected untrusted self-signed-chain status
before the QA certificate is manually trusted. This is not a signing failure and
does not represent Microsoft Store signing.

## Build-safety correction

`Build-PennyWiseMsix.ps1` no longer accepts `-TrustQaCertificate` and never
imports a certificate. This prevents an unattended build from hanging before
signing or mutating a trust store. On the disposable QA machine, an administrator
must manually trust the supplied certificate and record the exact confirmation
prompt before installation. That QA-only step is not acceptable as an ordinary
owner-install flow.

The absolute-SystemRoot `tar.exe` hardening was made after this candidate was
frozen. It is source-verified but intentionally not backported into `0.14.0.4`,
whose hash and version must remain immutable for this H2 run. Package that change
only in a new versioned candidate if the owner elects to replace this test build.

## Remaining H2 evidence

Run the clean-machine drills in
`H2_PACKAGE_ACCEPTANCE_EVIDENCE_TEMPLATE_2026-09-05.md` against this exact
artifact. Until install, first launch, reboot, update, disk-full, interruption,
second-instance, upgrade, backup/restore, corrupt-backup refusal, and uninstall
are directly recorded, the deliverability verdict remains **NO — unaccepted**.
