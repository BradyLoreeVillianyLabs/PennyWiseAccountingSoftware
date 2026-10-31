# D1 — Native Windows package hardening for a single-owner install

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `distribution/windows-native/README.md`
4. `distribution/windows-native/Build-PennyWiseMsix.ps1`
5. `distribution/windows-native/launcher.cjs` and `sea-config.json`
6. `distribution/public-beta/qa/Test-ClearLedgerMsiLifecycle.ps1`
7. `docs/BACKUP_AND_RECOVERY.md`
8. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — packaging/deployment entry

## Exact intention

Make the native MSIX something a non-technical business owner can install once and
rely on for years, on a computer nobody administers. The package already bundles
the API, web interface, a pinned Node runtime and PostgreSQL, and keeps data under
`%LOCALAPPDATA%\PennyWiseAccounting` on loopback only. What it has not been shown
to do is survive ordinary life on that machine: reboots, Windows updates, a full
disk, an upgrade, and the day the owner needs yesterday's books back.

The target is a package the owner installs from a file, launches from the Start
menu, and never thinks about again — where backups happen without being asked and
a restore is a supported, rehearsed operation rather than an improvisation.

This phase does not add product features. It makes the existing ones deployable.

## Boundary conditions

- Listeners bind to `127.0.0.1` only. No configuration option may expose them.
- The bundled PostgreSQL instance is private to this installation: its own data
  directory, its own port selection, its own credentials generated per install.
- Never ship a private signing key. The QA build's throwaway key stays under the
  ignored `build` directory; production injects the fulfillment service's public
  key only.
- A self-signed MSIX is for QA. Public distribution requires Store signing.
- Backups must be recoverable without PennyWise: readable formats, documented
  layout, checksummed.
- The installer must not require the owner to use a terminal, edit a file, or
  choose a port.
- Do not weaken the user's PowerShell execution policy.

## Build order

1. **Prove the current build.** Build the MSIX, install it on a clean Windows 11
   x64 machine, and record what actually happens: first launch, trial start,
   database initialization, the ports chosen, where data lands. Write the observed
   result into the package README. If a step fails, fix it before continuing.
2. **Lifecycle.** Reboot with the app installed; confirm it starts cleanly and the
   database recovers. Install over an existing install and confirm data survives
   and migrations apply forward. Uninstall and confirm data is preserved unless
   deletion is explicitly chosen. Extend
   `distribution/public-beta/qa/` with a native-package lifecycle drill script that
   asserts each of these.
3. **Backup that happens on its own.** `Backup-ClearLedger.ps1` targets Compose
   volumes and cannot serve this package. Add a native backup that captures the
   PostgreSQL database, the document store, and the recovery secrets together,
   writes a checksummed archive, and verifies it. Register a Windows scheduled task
   at install time that runs it nightly to a location the owner picks during setup
   — a second drive or a synced folder, never the same disk only. Keep a bounded
   number of generations and prune the oldest.
4. **Restore that has been rehearsed.** A restore path that takes an archive,
   validates its checksum, and puts the books back — with a drill script proving it
   round-trips. Never let a restore silently cross installations: a backup carries
   installation-specific secrets and must refuse a foreign target with a clear
   message.
5. **Failure states the owner can act on.** Disk full, port already taken,
   PostgreSQL refusing to start, a corrupt data directory, an interrupted upgrade.
   Each needs a message that says what happened and what to do — not a stack trace.
   Add a diagnostics action that collects logs and versions into one file the owner
   can send for support, with secrets and personal data removed.
6. **Store-signing path.** Document exactly what changes between the QA build and a
   Store-signed build: Partner Center identity, publisher value, dropping
   `-SelfSign`, and certification requirements. Leave the QA path working.

## Acceptance

- The MSIX installs on a clean Windows 11 x64 machine with no developer tooling,
  no Docker, and no terminal use, and reaches a working sign-in.
- Reboot, upgrade-over-install, and uninstall drills pass and are scripted.
- A nightly backup runs unattended to a second location; a restore drill recovers
  the database and documents together and is verified by checksum.
- Every failure state above produces an actionable message.
- The full quality gate in `AGENTS.md` passes, including `corepack pnpm test:research`.

## Out of scope

Any product feature. Store signing itself (document the path, do not perform it).
macOS, Linux, Windows 10, and ARM. Multi-user or networked deployment.
