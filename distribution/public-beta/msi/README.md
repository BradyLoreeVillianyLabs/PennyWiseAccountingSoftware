# ClearLedger Public Beta MSI

This WiX source wraps an existing, verified public-beta ZIP. It does not rebuild
the application or replace the ZIP release gate.

The MSI is deliberately per-user and installs to
`%LOCALAPPDATA%\Programs\ClearLedger Public Beta`. The runtime can therefore
create `beta.env`, `.license-accepted`, and `Backups` without administrator
rights. Those generated files are not MSI-owned and are preserved on removal.
Docker volumes and images are also preserved because the MSI contains no Docker
custom actions. Docker is never downloaded, installed, or started by the MSI.

## Build

Requirements: Windows, a .NET 6 or newer SDK, and the verified ZIP with its
sibling `.zip.sha256` file.

Restore the repository-pinned WiX 6.0.2 tool explicitly once:

```powershell
dotnet tool restore
```

Then build the MSI:

```powershell
.\scripts\Build-ClearLedgerMsi.ps1 `
  -PackageZip .\distribution\public-beta\output\ClearLedger-Public-Beta-<version>.zip
```

The script verifies the sibling checksum, every checksum inside the ZIP, and the
release manifest before extraction. The ZIP must contain the exact public-beta
top-level allowlist. The only nested files permitted are narrowly named licence
files, and that set must exactly match the paths recorded in
`THIRD_PARTY_NOTICES.md`. State-bearing, secret-bearing, extra, malformed,
case-colliding, traversal, and symbolic-link entries are rejected. The script
then safely expands the ZIP, adds MSI-specific guidance and provenance,
generates stable per-user WiX components, builds the MSI, and runs WiX MSI
validation. `-RestoreWixTool` is available as an explicit opt-in shortcut for
the restore step; the normal build never downloads tools.

A successful unsigned development build promotes these four files together:

- `ClearLedger-Public-Beta-<version>-x64.msi`
- `ClearLedger-Public-Beta-<version>-x64.msi.sha256`
- `ClearLedger-Public-Beta-<version>-x64.msi.provenance.json`
- `ClearLedger-Public-Beta-<version>-x64.msi.provenance.json.sha256`

The installed payload also contains `MSI_INSTALLATION.md` and
`MSI_PROVENANCE.json`. The installed provenance links the wrapper to the exact
verified ZIP without attempting the impossible recursive step of embedding the
final MSI hash inside the MSI. The external provenance records that final hash
and successful WiX validation.

The builder maps SemVer releases monotonically into MSI's three numeric fields.
It derives ProductCode only from the exact display version and uses a fixed
ClearLedger UpgradeCode; neither identity depends on the ZIP hash. Rebuilding
the same version therefore cannot create a second Windows Installer product
registration. The ZIP hash remains separately recorded in provenance. Never
silently republish different ZIP or MSI bytes under an existing display version;
`-Force` is for controlled recovery of a local artifact set, not version reuse.

The MSI intentionally blocks MSI-to-MSI version upgrades. ClearLedger's update
workflow must create a protected backup, preserve the generated secret file, and
coordinate the old and new Docker images. A Windows Installer file replacement
cannot safely perform those operations. Use the verified ZIP's
`Update-ClearLedger.ps1` from a separate folder for a version change. Do not
uninstall the current MSI until that update has completed and the new release is
healthy.

The MSI adds Start Menu shortcuts for Start, Diagnose, Backup, and MSI removal.
MSI removal does not call Docker and cannot delete ClearLedger's Docker volumes.
If the services should be stopped first, run `Uninstall-ClearLedger.ps1` without
`-DeleteData` before removing the MSI.

The shortcuts respect the computer's configured PowerShell execution policy;
the installer does not bypass or change it. Authenticode-sign the packaged
PowerShell scripts for managed environments that require signed scripts.

The generated MSI and provenance identify an unsigned development output.
Before public distribution, Authenticode-sign the MSI with the release owner's
protected signing identity. Signing changes the MSI hash, so the signing
pipeline must regenerate the `.msi.sha256` file and finalize external provenance
with the signed artifact's hash and signature state; the builder's pre-signing
sidecars must not be published afterward. Publish the final evidence through the
authenticated release channel (and add a detached signature when the project
establishes that format). The sibling ZIP and MSI checksums prove integrity only,
not publisher identity. Obtain all artifacts from the same controlled release
pipeline and authenticate the final MSI before treating it as public software.

## Lifecycle QA

Run the MSI lifecycle drill only on a Windows user profile without an existing
ClearLedger Public Beta MSI, install folder, or Start Menu folder:

```powershell
.\distribution\public-beta\qa\Test-ClearLedgerMsiLifecycle.ps1 `
  -MsiPath .\distribution\public-beta\output\ClearLedger-Public-Beta-<version>-x64.msi
```

The drill requires the sibling `.msi.sha256`, rejects installation collisions,
installs quietly for the current user, validates the installed payload and all
four shortcuts, and uninstalls by the MSI ProductCode. Before installation it
creates uniquely named state and backup sentinels; after removal it proves that
all observed MSI-owned files and shortcuts are gone while those sentinels are
byte-for-byte unchanged. It statically rejects custom/service actions and file
deletion rows, scans verbose MSI logs for destructive Docker commands, and only
records the Docker client identity without querying or changing Docker resources.
Evidence and verbose logs are written to a unique `qa\evidence` directory. The
three QA sentinels are removed precisely after a passing run; use
`-KeepSentinels` to retain them for manual inspection.
