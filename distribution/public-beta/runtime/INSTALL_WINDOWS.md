# Install ClearLedger Public Beta on Windows

## Before you start

You need a 64-bit Windows 11 computer with hardware virtualization enabled, at least
8 GB RAM, 10 GB free disk space, and a current Docker Engine or Docker Desktop. The
2026-08-03 package smoke used Windows 11 Pro build 26200 with Docker Desktop 4.83.0 /
Engine 29.6.2. Windows 10, Windows on ARM, macOS, Linux hosts, and alternative container
engines do not yet have release evidence. Docker Desktop licensing is separate from
ClearLedger; confirm that its terms fit your personal or business use. Keep the
downloaded ZIP and its `.sha256` file together, and read `RELEASE_EVIDENCE.md` for the
exact evidence boundary.

ClearLedger is bound to `127.0.0.1:3000` by default, so other computers cannot reach it.
Do not alter that binding or publish the API port. Use only the separately documented
named-tester controlled-share procedure when remote beta access is intended.

## Install

1. Compare the ZIP's SHA-256 hash with the value published on the official download
   page. In PowerShell:

   ```powershell
   Get-FileHash -Algorithm SHA256 .\ClearLedger-Public-Beta-*.zip
   ```

2. After the hash matches, right-click the downloaded ZIP, select **Properties**, and
   choose **Unblock** if Windows shows that option. This removes the downloaded-file
   marker from this verified package without weakening PowerShell's execution policy.
3. Extract the complete ZIP to a durable folder such as
   `C:\ClearLedger-Public-Beta`. Do not run it from inside the ZIP or a temporary folder.
4. Read `BETA_LICENSE.txt`, `KNOWN_LIMITATIONS.md`, and `RELEASE_EVIDENCE.md`.
5. Start Docker and wait until its engine is ready.
6. Run `Test-ClearLedgerPrerequisites.ps1` from PowerShell (or use **Check ClearLedger
   Prerequisites** from the MSI Start Menu folder). It reports Docker/Compose, payload,
   verified-manifest, and disk checks without printing credentials.
7. Right-click `Start-ClearLedger.ps1`, choose **Run with PowerShell**, and type
   `ACCEPT` when prompted. Windows may ask whether to allow this downloaded script;
   first verify the downloaded archive hash against the official page. This beta's
   PowerShell scripts are not yet Authenticode-signed.
8. Wait for the browser to open at <http://localhost:3000>. The first start loads the
   local runtime image, creates private random secrets, initializes PostgreSQL, and
   applies the verified schema. Later starts are faster.
9. Enter your own email in the local sign-in screen, create a company or the fictional
   demo company, and follow the guided setup. This local beta sign-in is not intended
   for direct internet exposure.
10. Run `Backup-ClearLedger.ps1`, copy the resulting ZIP and checksum to protected
    storage, and complete one test restore before relying on real records.

If another local program already uses port 3000, initialize a fresh extraction from
PowerShell with a different loopback port, for example:

```powershell
.\Start-ClearLedger.ps1 -LocalPort 3200
```

The selected port is validated, stored with that installation, and preserved through
backup, restore, and update. Open `http://localhost:3200` in this example. Once an
installation is initialized, ordinary starts reuse its stored port; do not edit
`beta.env` manually.

## Ordinary use

- Start on the installation's stored loopback port: `Start-ClearLedger.ps1`
- Stop without deleting data: `Stop-ClearLedger.ps1`
- Update from a newly downloaded and hash-verified release:
  `Update-ClearLedger.ps1 -PreviousInstallPath C:\path\to\previous\install`
- Inspect status and recent logs: `Diagnose-ClearLedger.ps1`
- Check host and package prerequisites: `Test-ClearLedgerPrerequisites.ps1`
- Create a complete database/document/recovery-secret backup:
  `Backup-ClearLedger.ps1`
- Restore a verified backup: `Restore-ClearLedger.ps1 -BackupZip <path>`
- Temporarily share one test company with one named tester through Loclx:
  `Share-ClearLedger.ps1` (see **Protected remote beta testing** below)
- Stop only the packaged remote-share services after a tunnel-window problem:
  `Stop-ClearLedgerShare.ps1`
- Remove services while preserving data: `Uninstall-ClearLedger.ps1`
- Permanently remove Docker data after a safety backup:
  `Uninstall-ClearLedger.ps1 -DeleteData`

For an update, extract the new package to a different folder and run its update script.
The script first creates a backup with the old release, preserves the existing database
owner password, constrained runtime-login password, and all webhook, connector, and
payment signing/encryption secrets, stops the
old containers without deleting volumes, loads the new runtime, applies forward
migrations, and starts the new release.
Do not initialize the new folder separately or copy only the database; doing so can
separate encrypted connector records from their recovery secrets.

If an update does not become healthy, do not point the old program image at the possibly
forward-migrated database. The update script prints the exact verified pre-update backup.
Use the previous folder's `Restore-ClearLedger.ps1` with that backup to restore the old
database and document set together, then reconcile before resuming work.

Do not email a backup or attach it to a bug report. A complete backup contains private
business data and the secrets needed to recover encrypted connector credentials.
Those stable per-installation secrets also protect stored payment-account references and
the packaged test-payment webhook boundary; restoring or updating without them is refused.

A backup briefly pauses the local web/API writers while PostgreSQL and document data are
captured together, then restores the local service state that existed before the backup.
Any active package-owned remote share is ended and must be started again deliberately
after the backup. A failed backup removes its partial archive and staging data.

## Protected remote beta testing

Remote testing is optional and is for a person you trust using fictional beta data. It
does not turn this local beta into a production hosted service. First add the tester as
a dedicated, least-privileged member of a demo/test company and accept that invitation
locally. Install and sign in to the LocalXpose (`loclx`) CLI.

Run this from the extracted package folder, using a Loclx subdomain available to your
account:

```powershell
.\Share-ClearLedger.ps1 `
  -Email "trusted.tester@example.test" `
  -DisplayName "Trusted Tester" `
  -Subdomain "clearledger-demo"
```

Add `-Reserved` when the full `clearledger-demo.loclx.io` name is reserved on your Loclx
account. If the tester belongs to more than one company, the launcher presents a numbered
company chooser; `-OrganizationId` can instead select one explicitly. The launcher creates
a separate fixed-identity API/web pair on loopback, checks that the tester belongs to the
chosen company, generates a strong Basic Authentication
password, and publishes only that web proxy through HTTPS. It does not replace or sign
out the owner's local session. Browser-supplied identity headers are discarded by the
proxy. Send the printed URL, username, and password privately; keep the window open; and
press `Ctrl+C` to end access. Each launch generates a new password unless you deliberately
supply `-Password` with at least 20 characters.

The share proxy uses loopback port 3100 by default. If that separate port is occupied,
choose another with `-SharePort`; this does not change the owner's stored local port.

The launcher records only the package-owned Loclx process identity and target, never the
tester password. Starting a new share first cleans up a stale share recorded by this
package. `Stop-ClearLedgerShare.ps1` validates that exact process and command before
stopping it; it does not scan for or terminate unrelated Loclx sessions.

Do not publish port 3001, the database, or a general API tunnel. Commerce provider
webhooks cannot pass the browser share's Basic Authentication challenge; use polling in
this packaged beta unless a separately reviewed signed-webhook relay has been configured.

## Troubleshooting

Run `Diagnose-ClearLedger.ps1`. If Docker reports that port 3000 is occupied, stop the
other local program before retrying; do not expose a different port without reviewing
the security/origin configuration. If a schema migration fails, preserve the logs and
backup, then stop—do not reset the database.

Bug reports should include the release version, Windows/browser/Docker versions,
request ID, and reproducible steps. Remove names, emails, addresses, account numbers,
tax IDs, transactions, screenshots of real records, tokens, and provider secrets.
