# ClearLedger MSI installation and maintenance

This optional MSI is a per-user Windows wrapper around the verified ClearLedger
Public Beta ZIP. It installs the same release payload in
`%LOCALAPPDATA%\Programs\ClearLedger Public Beta` and adds Start Menu shortcuts.
It does not rebuild the application, install or start Docker, accept the beta
licence, or create an account for you.

## Before installation

- The currently evidenced target is Windows 11 x64.
- Install Docker Desktop and make sure Docker is running.
- PowerShell must be allowed to run the included signed or locally approved
  scripts under your organization's execution policy.
- Read `BETA_LICENSE.txt`, `KNOWN_LIMITATIONS.md`, `PRIVACY_AND_DATA.md`, and
  `INSTALL_WINDOWS.md` before using real books. Keep a tested backup.
- Obtain the MSI and its sidecars from the same authenticated release channel.
  Verify the publisher signature when a signed beta is provided, then verify
  the published SHA-256 value.

## First start

Open **Start ClearLedger** from the ClearLedger Public Beta Start Menu folder.
The startup script performs the runtime checks and any licence-acceptance step
described in `INSTALL_WINDOWS.md`. Use **Diagnose ClearLedger** if startup does
not complete. The diagnostic output distinguishes missing Docker/Compose,
stopped Docker, incomplete package files, an unverified manifest, and low disk
space without printing runtime credentials. Use **Backup ClearLedger** before
upgrades or risky testing.

## Evidence and provenance

`MSI_PROVENANCE.json` identifies the exact verified ZIP, release-manifest hash,
source and gate fingerprints, image and SBOM hashes, MSI identity, and pinned
WiX version used by the wrapper build. It intentionally cannot contain its own
final MSI hash: embedding that value would change the MSI again. The sibling
`.msi.sha256` file and external `.msi.provenance.json` are the authoritative
records for the final MSI artifact. Neither provenance file contains runtime
credentials.

Builder output is explicitly an unsigned development artifact. WiX standard
validation is run before promotion; ICE64 is the sole suppressed check because
WiX flags the intentionally per-user generated payload tree (and its standard
per-user parent) as removable-profile directories. Public release
requires the release owner's protected Authenticode identity. Signing changes
the MSI hash, so the signing pipeline must regenerate or finalize the MSI
checksum and external provenance after signing. A checksum proves integrity,
not publisher identity.

## Updates

MSI-to-MSI upgrades are deliberately blocked. A ClearLedger version update must
coordinate a backup, generated secrets, database migrations, and Docker images.
Extract the new verified ZIP to a separate folder and run its
`Update-ClearLedger.ps1` as documented in `INSTALL_WINDOWS.md`. Do not silently
republish a different ZIP or MSI under an existing version, and do not remove
the current MSI until the update reports healthy.

## Removal and retained data

The **Uninstall ClearLedger (keep Docker data)** shortcut removes MSI-owned
files and shortcuts for the current user. It does not call Docker and does not
delete Docker images, volumes, generated `beta.env`, `.license-accepted`, or
backup data. If the services should be stopped first, run
`Uninstall-ClearLedger.ps1` without `-DeleteData`, then remove the MSI.

Only use `-DeleteData` after an explicit decision to destroy the local
ClearLedger data and after verifying a restorable backup. MSI removal by itself
is intentionally non-destructive.
