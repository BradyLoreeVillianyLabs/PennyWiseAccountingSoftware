# Backup and Recovery

## Production Standard

Use managed PostgreSQL encrypted backups with point-in-time recovery enabled,
separate backup credentials, immutable or versioned backup storage, and
documented key recovery. Back up authorized attachment/object storage with the
same organization-independent retention policy. Restrict backup and restore
access to named operators and audit every restore.

The recovery-time objective and recovery-point objective require controller,
security, and counsel approval before production launch. A proposed starting
point is an RPO of 15 minutes and an RTO of four hours; it is not a commitment
until the hosting design and restoration measurements are approved.

## Restore Drill

`pnpm.cmd db:backup:verify` requires a migrated source database URL and a
disposable target URL named `clearledger_restore_verify_*`. It creates a
PostgreSQL custom-format archive, verifies its SHA-256, restores it with
`pg_restore --clean --if-exists`, and checks restored Prisma migration history.
The temporary archive is deleted by default. Set
`KEEP_BACKUP_RESTORE_ARTIFACTS=true` only in an approved encrypted workspace.

The CI drill validates schema and migration restoration. Production drills must
also validate a representative encrypted data restore in an isolated account,
attachment recovery, application login/RLS behavior, report integrity, key
availability, measured RPO/RTO, and secure cleanup of the drill environment.

## Native Windows MSIX (D1)

The native PennyWise package stores its private PostgreSQL cluster, append-only
document store, installation identity, and recovery secrets under
`%LOCALAPPDATA%\PennyWiseAccounting`. The **Backup** application creates an
access-controlled ZIP archive containing a PostgreSQL custom archive, documents,
a manifest with per-member SHA-256 digests, and the recovery metadata needed to
reopen the same installation. The archive includes installation recovery secrets;
protect the selected destination with the owner's Windows/sync-provider access
controls and do not email or upload it to an unapproved location. It writes a
sibling `.sha256` file and verifies a fresh extraction before reporting success.

Choose a different physical disk or a known sync folder (OneDrive/Dropbox).
The controlled beta also permits automatic local recovery copies in the dedicated
`%LOCALAPPDATA%\PennyWiseRecovery` folder, clearly labelled as same-PC recovery
without disk-failure protection. Other folders on the books' volume are rejected.
PennyWise may accept a
separate volume on the same physical disk, but labels it as such because it does
not protect against disk failure; keep a verified copy on another disk or in an
approved synced folder before relying on recovery. Google Drive is not currently
allowlisted by a local environment signal, though a Drive location mounted as its
own volume remains usable. First use registers the nightly task; cancellation is
shown as a visible warning, not a successful backup configuration. Keep the
destination available at the scheduled time and retain the resulting archive
outside the device before relying on it for recovery.

**Restore** refuses a corrupt archive or missing checksums, but not an archive made
by a different PennyWise installation — recovering onto a replacement machine
after hardware failure is the point of having a backup at all, so a mismatch is
logged for diagnostics rather than blocked. The backup's encryption keys are
recovered while the destination retains its own database passwords, identity,
and activation; this avoids breaking login or installation-bound activation on
the replacement machine. It uses `pg_restore` with single-transaction,
clean/exit-on-error semantics, checks completed Prisma
migrations, restores documents, then tells the owner to relaunch so newer forward
migrations can run.
Use **Support Diagnostics** to create a redacted Desktop archive; it excludes
database URLs, passwords, email addresses, and local data paths.

The clean-Windows-11/MSIX lifecycle drill remains manual and gated. Run
`distribution/public-beta/qa/Test-PennyWiseMsixLifecycle.ps1` against the signed
MSIX, then manually record first launch, backup, restore, reboot, upgrade, and
uninstall observations. Do not mark this drill passing until that machine and a
Store/QA signing identity are available.

## Recovery Sequence

1. Declare the incident, preserve evidence, and freeze destructive changes.
2. Restore PostgreSQL and attachments into an isolated environment using a
   named, approved backup point.
3. Verify migration history, tenant RLS, authentication, ledger balances,
   attachment checksums, audit history, and report/control-account agreement.
4. Obtain controller and incident-commander approval before production cutover.
5. Record timing, data loss window, validation evidence, and follow-up actions
   in the breach/incident register.
