# H6 — First-run backup destination: survive a wrong choice, and mean "second disk"

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

Found by installing the frozen `0.14.0.4` H2 candidate on the build machine on
2026-09-06. The package installed and launched correctly — deployment log clean,
signature validated as `CN=PennyWise Accounting QA`. The failure is entirely in
first-run experience.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `distribution/windows-native/native-operations.cjs:167-195` — `allowedBackupDestination`, `validateBackupDestination`
4. `distribution/windows-native/build/launcher.cjs:297-320` — `pickWithPowerShell`, `configureBackupInteractively`
5. `distribution/windows-native/build/launcher.cjs:590-600` — the first-run call site
6. `distribution/windows-native/build/launcher.cjs:355` — the second call site (Start menu entry)
7. `distribution/windows-native/native-operations.test.mjs` — where the new tests belong

## Exact intention

Three defects, in priority order. **Do not weaken the backup rule itself** —
refusing to keep the only backup on the same disk as the books is correct and
stays.

### 1. An invalid choice terminates the application (blocker)

`validateBackupDestination` (`native-operations.cjs:181`) throws. That throw
escapes `configureBackupInteractively` (`launcher.cjs:315`), passes the call site
at `launcher.cjs:591`, and reaches `main` — killing the process.

Observed on 2026-09-06:

```
FATAL PennyWise Accounting could not start: Error: Choose a second drive or a
recognized synced folder for backups. PennyWise will not keep the only backup on
the same disk as its books.
    at validateBackupDestination (native-operations.cjs:188:11)
    at Object.configureNightlyBackup (native-operations.cjs:531:18)
    at configureBackupInteractively (launcher.cjs:318:27)
    at main (launcher.cjs:591:26)
```

**The correct behaviour already exists eight lines away.** When the operator
_cancels_ the picker, `configureBackupInteractively` returns `null` and
`launcher.cjs:592-597` shows a plain-language message and continues without
backups. An invalid choice must land in that same place, not crash.

This is the first thing a new owner sees. The folder picker's description asks
for "a second drive or synced folder", but the dialog does not restrict the
choice, so picking `Documents` — the obvious guess — is a crash with a Node stack
trace, and the application cannot be opened at all.

### 2. "Second drive" is validated as a drive letter, not a disk (correctness)

`allowedBackupDestination` (`native-operations.cjs:167-170`) compares
`path.parse().root`. A second _partition_ of the same physical disk satisfies it.

Measured on the build machine:

```
C:  DiskNumber 0   333.2 GB
D:  DiskNumber 0   131.0 GB
Disk 0: NX-512 2280, 476.9 GB   (one NVMe SSD)
```

`D:\anything` is accepted and reported as `kind: "separate-volume"`, while
offering no protection against the disk failure the rule exists to prevent. For
an accounting product, a check that reads as a guarantee of disk independence
without providing it is worse than no check: it manufactures confidence.

Either compare the physical disk, or keep the volume check and state precisely
what was verified. Do not silently report `separate-volume` as though it were a
separate disk.

### 3. Build-machine paths reach client-visible errors (cosmetic)

The trace above shows `C:\Users\EmceeHax\Desktop\clearledger-src\...`. This was
checked and is **not** a runtime dependency: `launcher.cjs` is absent from the
installed package (`resources/` holds `app`, `node`, `postgresql`, `web`,
`license-public-key.pem`, `native-operations.cjs`, `package-release.json`), so
the path is the SEA blob's embedded build-time filename. Nothing to unblock — but
Destry would see the developer's directory layout in any crash.

## Boundary conditions

- **`0.14.0.4` is frozen and must not be rebuilt under the same version.** Its
  SHA-256 `e23949b11b00cc14dabe34535e0d838ca38931d51fff3309f8d02ac3c8cdbe40` is
  published in the H2 template. These fixes ship in the next versioned candidate,
  exactly as the tar hardening did.
- The backup policy does not relax. No same-disk destination becomes acceptable.
- Deferring backups already works and must keep working — an owner who cannot
  supply a second disk today still gets into their books, with a warning.
- No prompt may block a non-interactive or automated start.

## Tasks

### 1. Re-prompt instead of terminating

In `configureBackupInteractively`, catch the validation error, show the operator
what was wrong with the folder they chose, and offer the picker again. After a
small number of refusals, or on cancel, fall through to the existing
`launcher.cjs:592-597` deferral path.

Apply the same handling to the second call site at `launcher.cjs:355`.

The message must say why in the operator's terms — that the folder is on the same
disk as their books, and a backup there would be lost with them — not restate the
exception.

### 2. Report what was actually verified

Distinguish a separate physical disk from a separate volume on the same disk.
Prefer refusing a same-disk partition outright, since it does not deliver the
protection. If it is accepted, `kind` and the operator-facing text must both say
that only the volume was checked.

Removable and network destinations must keep working.

### 3. Consider the synced-folder allowlist

`native-operations.cjs:172` allows `OneDrive`, `OneDriveCommercial` and
`Dropbox` via environment variables. Google Drive sets no equivalent variable;
mounted as its own letter it already passes the volume test, but a Drive folder
on `C:` does not. Decide deliberately and record the decision — do not extend the
list without confirming the variable exists and the folder genuinely syncs.

### 4. Tests

Add to `native-operations.test.mjs`:

- a same-volume destination is refused, and the refusal is a value the caller can
  act on rather than a crash;
- a separate-volume-same-disk destination is reported honestly per task 2;
- a genuinely separate disk, and a synced folder, are both accepted;
- the write probe still runs and a read-only destination is refused.

Launcher behaviour: a refused folder followed by a cancel reaches the deferral
path and start-up continues.

## Constraints

- No change to the backup archive format, the manifest, or restore.
- Keep the absolute `%SystemRoot%\System32\tar.exe` resolution and its assertion.
- No new runtime dependency; this is a packaged app with an embedded Node.

## Acceptance criteria

- Choosing `Documents` at first run explains the problem and offers the picker
  again. It never terminates the application.
- Declining still starts, with the existing warning.
- A same-disk partition is either refused, or accepted with text that does not
  claim disk independence.
- `native-operations.test.mjs` passes, including the new cases.
- A new versioned candidate is built, hashed and signed; `0.14.0.4` is untouched.

## Out of scope

Backup scheduling, retention, restore, and the H2 clean-machine lifecycle
evidence. The SEA stack-trace paths (finding 3) — record it, fix it whenever the
launcher build is next touched.
