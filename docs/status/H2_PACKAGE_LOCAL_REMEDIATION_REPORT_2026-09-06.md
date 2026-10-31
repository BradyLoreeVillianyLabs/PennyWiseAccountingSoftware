# H2 package local remediation report

Date: 2026-09-06  
Phase: H2 installable package acceptance  
Result: **local remediation and package controls passed; clean-machine acceptance remains unverified**

## Candidate for the clean-machine drill

- Artifact: `distribution/windows-native/output/PennyWise-Accounting-0.14.0.10-x64.msix`
- SHA-256: `4d0e9ea7a10b89759b1abccf145ad4c280db6d7d2ddb4626705639ff99cdb5c5`
- Sidecar checksum: matched the recomputed SHA-256.
- Signature: valid; signer subject `CN=PennyWise Accounting QA`.
- Identity: `TypeWritingMonkeys.PennyWiseAccounting`, x64, version `0.14.0.10`.
- Certificate: `PennyWise-Accounting-QA.cer` beside the artifact.

Copy only the artifact, its `.sha256` sidecar, and the QA certificate to the
clean Windows 11 machine. This self-signed QA certificate is not Store signing;
manual, administrator-performed trust is a documented QA prerequisite and is not
an ordinary owner-install workflow.

## Remediated H2 defects

- The scheduled-backup task XML is written as UTF-16LE with a BOM, which
  `schtasks.exe /Create /XML` accepts. Backup configuration is persisted only
  after Task Scheduler accepts the task; a registration failure leaves no saved
  backup configuration.
- The lifecycle drill now reads `AppxManifest.xml` from the MSIX archive rather
  than using an installed-package cmdlet on an archive path. It compares the
  manifest package name and publisher explicitly and uses one archive reader to
  avoid PowerShell XML enumeration at helper boundaries.

## Local evidence actually performed

- `node --test distribution/windows-native/native-operations.test.mjs`: 12/12
  passed, including XML BOM/failed-registration, runtime repair, backup/restore,
  and native package-contract coverage.
- The lifecycle harness installed signed `0.14.0.9` and upgraded it in place to
  signed `0.14.0.10`; the registered package version was `0.14.0.10`.
- The installed `PennyWiseAccounting.exe` started successfully. Its API health
  endpoint and web endpoint each returned HTTP 200; the API reported
  `{"status":"ok"}`.
- The registered `PennyWise Accounting Nightly Backup` task was invoked once.
  It completed with `LastTaskResult` `0`; the next scheduled run is 02:00 local
  time.

These are build-machine observations. They do not establish a clean install or
prove an ordinary user can install the package.

## Required next evidence

Run every row in
`H2_PACKAGE_ACCEPTANCE_EVIDENCE_TEMPLATE_2026-09-05.md` on a clean Windows 11
x64 computer with no prior PennyWise installation or development toolchain.
Record prompts verbatim, including certificate, SmartScreen, installer, and
first-run behavior. The reboot, Windows update, disk-full, interruption,
second-launch, backup/restore/corrupt-backup, and uninstall drills remain open.

## Verdict

**NO — not deliverable to a non-technical owner yet.** The candidate is ready
for the controlled clean-machine H2 drill only. No clean-machine result is
represented as verified by this report.
