# PennyWise Accounting native Windows package

## Current supervised beta delivery

The current H2 beta transfer route is the direct Inno Setup installer built by
`Build-PennyWiseInnoSetup.ps1`, not a bare MSIX. It installs PennyWise under
Program Files, keeps mutable books and the verified private PostgreSQL runtime
under `%LOCALAPPDATA%\PennyWiseAccounting`, and starts the app as the original
user. It bundles the Microsoft-signed VC++ x64 runtime, the public QA
certificate, and one offline BETA_20 activation; it does **not** bundle issuer
private material, Docker, Node.js, or a separately administered PostgreSQL
server.

Build a new participant installer only from a clean, verified source state and
with a new four-part versioned output path:

```powershell
.\distribution\windows-native\Build-PennyWiseInnoSetup.ps1 `
  -Version 0.14.0.16 `
  -LicensePublicKeyPath <issuer-public-key.pem> `
  -ActivationPath <one-participant.activation.json> `
  -RedistPath <Microsoft-signed-vc_redist.x64.exe> `
  -OutputPath <new-versioned-folder\PennyWise-Beta-XX-Setup.exe>
```

The script requires stable Inno Setup 6 (not the preview compiler), validates the
VC++ redistributable signature, stages the runtime, signs the runtime and final
installer with the local QA code-signing certificate, verifies the setup
signature, and writes its SHA-256 sidecar. Never rebuild or replace an issued
candidate under the same version and filename.

The current frozen handoff is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`. It carries slot 02
and is a supervised beta allocation, not a hardware-enforced one-host lock. It
has owner-reported successful installs on fresh Windows 11 and a second Windows
system. Its transfer instructions are in the adjacent `START-HERE.txt`; do not
add a separate certificate or dependency to that folder. On a fresh host, normal
UAC and a self-signed SmartScreen prompt may appear before setup can install the
QA certificate. Record them; do not disable Windows protections to avoid them.

For a later update of that same beta computer, build a later version with the
same issued participant activation so the existing installation identity and
books continue. Operationally assign a different fresh tester an unused slot,
but do not rely on the current offline package to technically prevent copying.
Do not reuse the frozen slot-02 package as an update: build a later version.

The MSIX instructions below are retained for historical and future Store-package
work. They are not the current controlled-beta handoff.

This package replaces the Docker-dependent beta installer with a self-contained x64 MSIX. It bundles the PennyWise API and web interface, a pinned Node runtime, and PostgreSQL. Runtime data stays under `%LOCALAPPDATA%\PennyWiseAccounting` and listeners bind only to `127.0.0.1`.

The build can emit a self-signed MSIX and public certificate for controlled QA. The build never imports that certificate into any trust store. On a disposable QA machine, an administrator may manually import the `.cer` into `Cert:\LocalMachine\TrustedPeople` before installing the QA MSIX and must record the exact confirmation prompt. Public customers must use the Microsoft Store-signed package; a self-signed package is not suitable for public distribution.

For controlled QA only, open an elevated PowerShell prompt on the disposable test
machine and run:

```powershell
Import-Certificate -FilePath .\PennyWise-Accounting-QA.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

This is neither a build step nor an owner-install instruction. Do not suppress or
bypass the confirmation dialog; capture its exact wording in H2 evidence.

The first launch starts a no-card 30-day local trial unless the package is built
with `-RequireBeta20Activation`. A Founder license is an Ed25519-signed JSON
envelope copied to `%LOCALAPPDATA%\PennyWiseAccounting\license.json`. The QA
build creates a throwaway signing key under the ignored `build` directory.
Production and BETA_20 builds must inject the public key belonging to the
protected fulfillment service or beta operator and must never ship its private
key.

Build from the repository root:

```powershell
powershell -File .\distribution\windows-native\Build-PennyWiseMsix.ps1 -SelfSign
```

## Offline BETA_20 activation

### Prepared participant setup

The owner has authorized twenty preissued participant installers. The signed
setup EXE bundles the MSIX, Microsoft-signed Visual C++ x64 runtime, QA publisher
certificate, and the participant's signed activation. Run the participant's
`PennyWise-Beta-XX-Setup.exe` and choose **Install and open**. Windows may require
administrator consent to trust the beta publisher and install the runtime. No
terminal, Node, Docker, PostgreSQL installation, internet connection, or separate
activation exchange is required. Existing books are preserved; another
participant's installer is refused on an already initialized installation.

The issuer key and ledger are retained at
`C:\Users\EmceeHax\AppData\Local\PennyWiseBetaIssuer` on the build machine.
They are not included in setup or MSIX. Slot 01 is assigned to the owner's
existing installation; slots 02 through 20 have preissued identities. Distribute
one participant installer per tester. Offline software cannot prevent a tester
from copying their entire preactivated installer to another machine; the ledger
limits issuance to twenty participants, not cryptographically unique hardware.

Nightly recovery copies use OneDrive when configured or
`%LOCALAPPDATA%\PennyWiseRecovery` otherwise. Same-PC copies protect against
some accidental changes, not physical disk failure. Setup describes that limit.
The original manual activation workflow below remains available for support.
The earlier manual-certificate prerequisite applies to a bare MSIX; the new
participant setup performs the approved certificate trust step itself.

Build a participant setup after building the MSIX:

```powershell
.\distribution\windows-native\Build-BetaSetup.ps1 `
  -PackagePath <signed-msix> -ActivationPath <participant-activation.json> `
  -RedistPath <Microsoft-signed-vc_redist.x64.exe> -OutputPath <new-setup.exe>
```

Setup logs are stored under `%LOCALAPPDATA%\PennyWiseSetup\logs`. The internal
`--unattended` and `--no-launch` switches support automated QA. They do not bypass
UAC or signing. A runtime result requiring restart is reported explicitly.

The BETA_20 package supports twenty operator-issued beta slots. It does not
contain user accounts, shared passwords, reusable activation codes, or the issuer
private key. It verifies a signed, package-provisioned activation file entirely
offline. That lets the operator track issuance, but it is not a global
hardware-enforced installation count once an installer is copied; slot 02 was
successfully installed on two systems during supervised beta. Do not represent
this offline arrangement as device-bound enforcement.

On the protected issuer computer, create the Ed25519 key pair once. Keep the
private key and issued-slot ledger outside the repository and back them up
securely; neither can be recovered from the MSIX.

```powershell
node .\scripts\pennywise-beta-activation.mjs generate-key `
  --private-key D:\PennyWiseBetaIssuer\beta-issuer-private.pem `
  --public-key D:\PennyWiseBetaIssuer\beta-issuer-public.pem
```

Build the QA MSIX with the public key and required activation:

```powershell
powershell -File .\distribution\windows-native\Build-PennyWiseMsix.ps1 `
  -Version 0.14.0.11 `
  -SelfSign `
  -RequireBeta20Activation `
  -LicensePublicKeyPath D:\PennyWiseBetaIssuer\beta-issuer-public.pem
```

The beta tester installs the MSIX and opens **PennyWise Activation** from Start.
Cancel the file picker once to display the installation request code. The tester
sends that code to the beta operator, who issues one unused slot:

```powershell
node .\scripts\pennywise-beta-activation.mjs issue `
  --private-key D:\PennyWiseBetaIssuer\beta-issuer-private.pem `
  --ledger D:\PennyWiseBetaIssuer\issued-slots.json `
  --install-id <tester-request-code> `
  --slot 1 `
  --out D:\PennyWiseBetaIssuer\PennyWise-Beta-01.activation.json
```

Send the resulting activation file to that tester. They reopen **PennyWise
Activation**, select the file, and then start PennyWise Accounting. The issuer
tool refuses to reuse a recorded slot and only accepts slots 1 through 20.
Because the signed file is bound to the installation request code, copying it to
another Windows installation is refused. A replacement computer requires a
deliberate reissue for the same beta participant; do not silently reuse or erase
the issuer ledger.

The packager regenerates Prisma inside the staged application and imports the staged database module before creating the MSIX. This is required because the client is generated beside the database package, not in a shared development `node_modules` location.

The public Store build must use the Partner Center identity Publisher value,
provide `-LicensePublicKeyPath`, and omit `-SelfSign`. It produces an unsigned
submission package because Partner Center applies the Store signature. Do not
automate QA certificate trust as part of a build; certificate trust is a
controlled test-machine action and is not an owner-install workflow.

First launch creates an installation identity and prompts for another physical disk, a separate volume, or a cloud-synced backup destination; it then registers the nightly backup task. A separate volume on the same physical disk is labelled honestly and does not protect against disk failure, so the owner still needs a verified copy on another disk or approved synced folder. The `Backup`, `Restore`, and `Support Diagnostics` app entries are companion executables in the same MSIX. Restore refuses a backup made by another installation. See `docs/BACKUP_AND_RECOVERY.md` for the recovery procedure and `distribution/public-beta/qa/Test-PennyWiseMsixLifecycle.ps1` for the clean-machine-gated lifecycle script.
