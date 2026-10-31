# H2 native package acceptance evidence

> **Historical MSIX evidence template.** Do not fill this template for the
> current direct 0.14.0.15 beta candidate. Use
> [`H2_DIRECT_INNO_ACCEPTANCE_EVIDENCE_TEMPLATE_2026-09-08.md`](H2_DIRECT_INNO_ACCEPTANCE_EVIDENCE_TEMPLATE_2026-09-08.md)
> instead. Retain this file only as evidence design for any separately authorized
> return to MSIX/Store work.

Status: **UNVERIFIED** until each row contains a recorded run on the named clean
Windows 11 x64 machine. This template is evidence storage, not a test result.

Candidate artifact: `PennyWise-Accounting-0.14.0.10-x64.msix`  
Candidate SHA-256: `4d0e9ea7a10b89759b1abccf145ad4c280db6d7d2ddb4626705639ff99cdb5c5`  
Candidate signing: QA self-signed (`CN=PennyWise Accounting QA`); this is not
Microsoft Store signing and requires a controlled QA certificate workflow. Before
testing, a machine administrator manually imports the supplied `.cer` into
`Cert:\LocalMachine\TrustedPeople` and records the exact confirmation prompt. That
QA-only prerequisite is not an owner-install workflow and must not be automated by
the build.
Required machine: Windows 11 x64 with no previous PennyWise installation, Node,
Docker, PostgreSQL, developer toolchain, or package manager.

## Artifact custody

Copy only these files to the clean machine:

- `PennyWise-Accounting-0.14.0.10-x64.msix`
- `PennyWise-Accounting-0.14.0.10-x64.msix.sha256`
- `PennyWise-Accounting-QA.cer`

Do not substitute `0.14.0.1`, `0.14.0.2`, frozen `0.14.0.4`, frozen `0.14.0.5`,
or superseded/failed internal candidates `0.14.0.6`–`0.14.0.9`. They could otherwise
produce misleading H2 evidence.
Recompute and compare the SHA-256 before trusting the certificate or installing.

## Required run record

For every row, record the operator, date/time, Windows edition/build, package
SHA-256, and redacted log or screenshot location. Record prompt text verbatim;
do not put customer data, credentials, recovery secrets, or backup contents here.

| Drill                                  | Status     | Required evidence and owner procedure                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Clean install and first launch      | UNVERIFIED | Verify `<msix>.sha256`, record signature/SmartScreen/installer prompts verbatim, install by double-clicking without admin or terminal use, launch from Start, complete a disposable-company action, and record the local data folder and loopback-only listener observation.                                                                                                                                                                            |
| 2a. Reboot                             | UNVERIFIED | Run `Test-PennyWiseMsixLifecycle.ps1 -Package <msix> -ExpectedPublisher <publisher> -RebootAfterInstall`; after Windows starts, rerun it with `-ResumeAfterReboot`. Launch PennyWise and confirm the known disposable data remains.                                                                                                                                                                                                                     |
| 2b. Windows update                     | UNVERIFIED | Install a normal Windows update, restart if requested, launch PennyWise, and record whether the same data opens without repair.                                                                                                                                                                                                                                                                                                                         |
| 2c. Disk full                          | UNVERIFIED | Use only a disposable test machine/volume. Exhaust storage during a disposable action, record the exact owner-facing refusal, free storage, relaunch, and verify data integrity.                                                                                                                                                                                                                                                                        |
| 2d. Process interruption               | UNVERIFIED | On disposable data, terminate PennyWise while it is writing, relaunch, record recovery messaging, and verify the last completed action is intact.                                                                                                                                                                                                                                                                                                       |
| 2e. Second launch                      | UNVERIFIED | Start PennyWise twice and record the second-instance message plus absence of duplicate listener/database corruption.                                                                                                                                                                                                                                                                                                                                    |
| 3. Upgrade in place                    | UNVERIFIED | Install an earlier same-publisher MSIX, create recognizable disposable data and backup configuration, then run `Test-PennyWiseMsixLifecycle.ps1` with `-UpgradePackage <newer-msix>`. Launch and record data, migration, and backup-setting continuity.                                                                                                                                                                                                 |
| 4a. Unattended native backup           | UNVERIFIED | Choose a separate volume or recognised synced folder, confirm the scheduled task exists, allow it to run unattended, and preserve only archive/checksum paths and hashes.                                                                                                                                                                                                                                                                               |
| 4b. Restore and cross-machine recovery | UNVERIFIED | Follow `docs/BACKUP_AND_RECOVERY.md` using the package **Restore** entry, restoring onto a second, freshly-installed machine (its own new installation identity, never used before). Record known-state restoration and confirm the restore succeeds rather than being refused for the identity mismatch — this is the primary supported recovery path as of 2026-09-06; the earlier same-installation-only restriction was removed at owner direction. |
| 4c. Corrupt backup refusal             | UNVERIFIED | On a copied disposable archive, truncate or alter the copy, retain its original backup untouched, attempt restore, and record the checksum/refusal message and proof that books were not changed.                                                                                                                                                                                                                                                       |
| 5. Uninstall                           | UNVERIFIED | Run `Test-PennyWiseMsixLifecycle.ps1 -Package <msix> -ExpectedPublisher <publisher> -UninstallAtEnd`, then verify package registration is absent, no PennyWise listener/process remains, and `%LOCALAPPDATA%\\PennyWiseAccounting` data retention matches the documented warning.                                                                                                                                                                       |

## Verdict rule

The package is deliverable to a non-technical owner only when every required
drill is directly evidenced, all observed prompts and warnings are documented,
and no drill requires bypassing Defender, SmartScreen, firewall, signing, or
security controls. Until then the verdict is **NO — not deliverable**.
