# H2 direct Windows beta candidate — 0.14.0.15

**Status:** owner-reported successful installs on two Windows systems, including
fresh Windows 11 first launch and reboot continuity; remaining H2 lifecycle work
is still open.

This report supersedes `H2_BETA_INSTALLER_CANDIDATE_2026-09-07.md` as the
current beta-transfer handoff. It does not erase the MSIX investigation or claim
that an unrun clean-machine drill passed.

## Transfer artifact

Transfer the complete folder below to one assigned tester's USB drive, without
adding older candidates:

`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`

| File                                 | Purpose                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| `PennyWise-Beta-02-Setup.exe`        | Single signed, self-contained installer                        |
| `PennyWise-Beta-02-Setup.exe.sha256` | SHA-256 sidecar for the transfer check                         |
| `START-HERE.txt`                     | Exact supervised install instructions and failure-log location |

The setup executable is 233,046,512 bytes. Its SHA-256 is
`7f0d0a6ae0c17ab1092dfd5db99ed3558c3b9be76d0b49ef191b3f9b88b84211`.
An independent post-build `Get-AuthenticodeSignature` result was `Valid`, with
subject `CN=PennyWise Accounting QA` and thumbprint
`505118E3C933608FB6B6E16846A32AFBFE959E8C`; the sidecar matched the recomputed
hash.

This is **BETA_20 slot 02**. It is a supervised beta-allocation label, not a
hardware-enforced one-machine limit: the owner has now reported successful use on
two systems. A source change requires a new four-part version and new output
folder. Reuse slot 02 for an update to an existing slot-02 installation; for a
different tester, issue and track an unused slot operationally. Do not overwrite,
rebuild, or relabel this candidate.

## Packaging model

The current controlled-beta route is a direct, unpackaged Inno Setup installer,
not an MSIX handoff. It contains the PennyWise runtime, the copied private
PostgreSQL runtime, the Microsoft-signed VC++ x64 runtime, the public QA
certificate, and the slot-02 offline activation. It installs the QA certificate
only after normal setup elevation and starts the installed app as the original
user. No separate certificate import, Docker, Node.js, PostgreSQL, activation
file, or terminal step belongs in the tester procedure.

The QA certificate is self-signed. A fresh computer can therefore display normal
administrator consent and SmartScreen reputation UI before setup has a chance to
install the QA certificate. The `START-HERE.txt` procedure permits supervised
acceptance of those prompts only after the recorded hash is verified. Do not
disable SmartScreen, Defender, UAC, or a firewall to make the drill pass.

## Build and local evidence

- `Build-PennyWiseInnoSetup.ps1` used stable Inno Setup 6.7.3, rejected the
  preview compiler, required a valid Microsoft VC++ redistributable signature,
  and signed the staged executables, uninstaller, and setup with the QA
  certificate.
- The final installer compiled successfully and was independently signature- and
  hash-verified after the compiler finished.
- The exact staged 0.14.0.15 payload was run in a fresh disposable local profile.
  Slot 02 provisioned successfully; the private PostgreSQL executable was copied
  to local data; migrations completed; API `/health` and web `/` both returned
  HTTP 200.
- `PennyWiseBackup.exe --scheduled` produced a verified archive and a matching
  SHA-256 sidecar. The registered nightly task pointed to the generated wrapper,
  whose direct-install path invokes the installed `PennyWiseBackup.exe` and does
  not reference `WindowsApps`.
- A controlled `shutdown-request.json` stopped the launcher and test PostgreSQL,
  removed runtime state and the lock, and the test-created scheduled task was
  deleted. No test process or task remained.
- `node --test distribution/windows-native/native-operations.test.mjs` passed
  all 14 tests after the packaging changes.

This is strong build-machine and isolated-payload evidence. Owner field reports
now additionally cover successful Inno installation and first launch on fresh
Windows 11, reboot continuity, and successful installation on a second Windows
system. The second install used the prepared removable-drive folder on an
independent host. They do not yet cover the captured prompt wording, upgrade,
uninstall, or recovery drills.

## Next agent / H2 acceptance instructions

1. Take **only** the three files in the transfer folder to a fresh 64-bit
   Windows 10 or Windows 11 computer with no PennyWise installation. Verify the
   recorded SHA-256 before launch.
2. Run `PennyWise-Beta-02-Setup.exe` as the ordinary tester. Record every prompt
   verbatim, including UAC and SmartScreen wording, and whether the installer
   completes without any developer tool or manual dependency installation.
3. Launch from Start, wait for first-run database setup, and record whether the
   browser reaches PennyWise. On failure preserve
   `%LOCALAPPDATA%\PennyWiseAccounting\logs\launcher.log`; do not preinstall
   Docker, Node.js, PostgreSQL, a certificate, or runtime components as a
   workaround.
4. Continue the numbered H2 clean-machine, reboot, interruption, backup/restore,
   update, and uninstall drills from
   `docs/tasks/destry-deployment/H2-installable-package-acceptance.md`, recording
   them in `docs/status/H2_DIRECT_INNO_ACCEPTANCE_EVIDENCE_TEMPLATE_2026-09-08.md`.
   Mark every unrun drill explicitly unverified.
5. If the package needs repair, keep 0.14.0.15 frozen and issue the repair as a
   later versioned candidate. Reuse slot 02 for a known slot-02 upgrade; issue
   and track an unused slot for a new tester, without claiming the current
   offline package technically prevents copying. Never silently replace the file
   in this handoff folder.

## Explicit remaining boundary

The owner has now reported successful installation and functioning first launch
on a fresh Windows 11 host, reboot continuity, and successful installation on a
second independent Windows system from the removable-drive transfer folder; see
`H2_CLEAN_INSTALL_FIELD_REPORT_2026-09-08.md`. That closes the basic clean-install
and reboot field findings, but not the remaining H2 lifecycle drills or detailed
prompt evidence. Cross-machine restore is explicitly deferred, not attempted. H2
therefore remains active and the package is a supervised beta candidate, not a
public-release or Store-signing acceptance result.
