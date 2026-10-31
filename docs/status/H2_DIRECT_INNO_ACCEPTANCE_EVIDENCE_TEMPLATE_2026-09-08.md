# H2 direct Inno beta acceptance evidence

Status: clean install, first launch, and reboot are **owner-reported field
passes**; every remaining row is **UNVERIFIED** or explicitly **DEFERRED** until
it has a recorded run or owner decision. This is evidence storage, not a test
result.

## Current first-beta artifact

| Field               | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Transfer folder     | `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`                   |
| Installer           | `PennyWise-Beta-02-Setup.exe`                                                 |
| Version             | `0.14.0.15`                                                                   |
| Size                | `233,046,512` bytes                                                           |
| SHA-256             | `7f0d0a6ae0c17ab1092dfd5db99ed3558c3b9be76d0b49ef191b3f9b88b84211`            |
| Signer              | `CN=PennyWise Accounting QA` (self-signed controlled-beta certificate)        |
| Assigned activation | BETA_20 slot 02; supervised allocation, not a hardware-enforced one-host lock |

Copy only the EXE, its `.sha256` sidecar, and `START-HERE.txt` to the USB drive.
Do not add an MSIX, `.cer`, activation JSON, Docker installer, Node.js,
PostgreSQL, or manual runtime dependency. Recompute the hash before launch.

Required machine: an otherwise ordinary, fresh 64-bit Windows 10 or Windows 11
computer with no previous PennyWise installation. Record Windows edition/build,
tester, date/time, exact executable hash, and a redacted log or screenshot
location for every row. Do not place books, credentials, activation contents, or
backup contents in this file.

Normal UAC and a self-signed SmartScreen reputation screen may appear. Record
their wording verbatim. In this owner-supervised beta, a tester may accept them
only after the recorded hash is confirmed. Do not disable SmartScreen, Defender,
UAC, firewall controls, or install a dependency manually in order to make a row
pass.

## Recorded field result

The owner reported on 2026-09-08 that this exact EXE installed successfully on a
fresh Windows 11 host, PennyWise functioned as intended, and reboot continuity
worked. The owner also reported a successful installation on a second Windows
system after carrying the prepared folder on a removable drive. The two hosts
are independent machines, not a same-host reinstall. See
`H2_CLEAN_INSTALL_FIELD_REPORT_2026-09-08.md`. The Windows build,
prompt wording, and hash-check transcript were not captured, so that report
preserves the results and their limits without reconstructing evidence.

## Required run record

| Drill                                  | Status                                       | Required evidence and owner procedure                                                                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Clean install and first launch      | PASS (owner report, two independent systems) | The prepared removable-drive folder installed and launched successfully on fresh Windows 11, followed by a reported successful installation on a second independent Windows system. Prompt wording, Windows builds, explicit hash transcripts, and a named disposable-company action were not captured. |
| 2a. Reboot                             | PASS (owner report)                          | A normal reboot on the fresh Windows 11 host was reported to work, with PennyWise continuing to function afterward. Detailed reboot/launch transcript remains uncaptured.                                                                                                                               |
| 2b. Windows update                     | UNVERIFIED                                   | Install one normal Windows update, restart if requested, launch PennyWise, and record whether the same data opens without a repair step.                                                                                                                                                                |
| 2c. Disk full                          | UNVERIFIED                                   | On a disposable machine or volume, exhaust storage during a disposable action, record the owner-facing refusal, free space, relaunch, and verify data integrity.                                                                                                                                        |
| 2d. Process interruption               | UNVERIFIED                                   | On disposable data, terminate PennyWise during a write, relaunch, record recovery messaging, and verify the last completed action remains intact.                                                                                                                                                       |
| 2e. Second launch                      | UNVERIFIED                                   | Start PennyWise twice, record the second-instance result, and confirm no duplicate listener or database corruption.                                                                                                                                                                                     |
| 3. In-place second-beta upgrade        | PENDING SECOND BETA                          | Install the later, version-bumped direct Inno candidate over this first-beta installation. Preserve the same participant-02 activation for that tester, recognizable disposable data, backup setting, and installation identity. Record data, migration, activation, and backup continuity.             |
| 4a. Unattended native backup           | UNVERIFIED                                   | Choose an allowed separate disk, sync folder, or truthfully disclosed recovery destination; confirm the task exists; allow it to run; retain only archive/checksum paths and hashes.                                                                                                                    |
| 4b. Restore and cross-machine recovery | DEFERRED                                     | The owner has not attempted restore and has marked it not currently a priority. When resumed, follow `docs/BACKUP_AND_RECOVERY.md` on a second fresh direct installation and record known-state recovery and any installation-identity disclosure.                                                      |
| 4c. Corrupt-backup refusal             | UNVERIFIED                                   | Alter only a copy of a disposable archive, attempt restore, record checksum/refusal wording, and prove the intact books were not changed.                                                                                                                                                               |
| 5. Uninstall                           | UNVERIFIED                                   | Uninstall through Windows, verify no PennyWise process, listener, or scheduled task remains, and record whether `%LOCALAPPDATA%\PennyWiseAccounting` books/backups are retained exactly as documented.                                                                                                  |

## Coordination with the second beta

Claude's product-gap work belongs in the **second beta**, not in the frozen
0.14.0.15 transfer folder. When that source work is merged and independently
verified, build a later four-part installer version. For an update intended for
this same participant-02 computer, embed the **same issued slot-02 activation**
so the existing installation identity and books continue; do not consume a new
slot for that update. For a different tester, operationally issue and track an
unused slot, but do not describe the current offline package as a hardware lock:
the slot-02 package has now been reported to install successfully on two systems.

Never overwrite the 0.14.0.15 EXE, sidecar, or `START-HERE.txt`. Record the later
candidate's version, hash, signature, slot assignment, and all upgrade results
in a new dated candidate report.

## Verdict rule

The first-beta transfer artifact is ready for an owner-supervised installation
attempt, but H2 is not complete until the required rows are evidenced or
explicitly marked unverified with the reason. It is not public-release or
Store-signing acceptance.
