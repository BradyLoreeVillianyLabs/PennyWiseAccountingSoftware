# H2 clean Windows installation field report — 2026-09-08

**Result:** first clean-host install and first launch passed, as reported by the
owner who performed the installation.

## Artifact

| Field            | Recorded value                                                      |
| ---------------- | ------------------------------------------------------------------- |
| Transfer folder  | `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`         |
| Installer        | `PennyWise-Beta-02-Setup.exe`                                       |
| Version          | `0.14.0.15`                                                         |
| SHA-256          | `7f0d0a6ae0c17ab1092dfd5db99ed3558c3b9be76d0b49ef191b3f9b88b84211`  |
| Transfer method  | Removable drive carrying the prepared 0.14.0.15 transfer folder     |
| Intended host    | Fresh Windows 11 machine; then a second independent Windows machine |
| Source of result | Owner report in this project conversation                           |

## Recorded outcome

The owner reported that the EXE package installed successfully on a fresh
Windows 11 host and that PennyWise is functioning as intended after installation.
This closes the previously missing basic clean-install and first-launch field
finding for this exact first-beta artifact.

The owner subsequently reported that a normal reboot succeeded and PennyWise
continued to work afterward. This closes the basic reboot field finding for the
same fresh-host installation.

The owner then took the removable drive containing this package to a second
independent Windows machine and reported another successful installation. This
is evidence of the actual USB-transfer delivery path on two independent hosts,
not a same-host reinstall or a cross-machine restore drill. Restore was not
attempted and is deliberately deferred as not currently a priority.

## Evidence limits retained deliberately

The report did not include the Windows edition/build, the verbatim UAC or
SmartScreen wording, a screenshot, a captured installer log, or a separately
recorded hash-check transcript. It also did not capture the second system's
edition/build or whether its package copy was hash-checked. Do not invent those
details after the fact. The results are therefore recorded as owner-reported
field passes, not as a complete H2 acceptance transcript.

The following H2 drills remain open: Windows update, disk-full handling, process
interruption, second launch, second-beta in-place upgrade, unattended backup,
cross-machine restore (deferred), corrupt-backup refusal, and uninstall. Each
needs its own recorded outcome before H2 can be closed.
