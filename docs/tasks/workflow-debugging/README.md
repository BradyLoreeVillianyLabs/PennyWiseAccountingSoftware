# Workflow debugging prompts (WD0–WD8)

These prompts point Codex and GitHub Copilot (agent mode) at defects in PennyWise's real Windows
workflows: launch, close, update, nightly backup, restore, diagnostics and local sign-in.

Every WD1–WD8 prompt starts from evidence collected on 2026-10-18 from:

- the owner's installed beta (MSIX 0.14.0.13);
- its launcher log;
- its 14 nightly backups in `D:\PennyWiseBackups`;
- the source in this tree.

WD0 is a reusable template for symptoms that aren't listed here.

## Order and lanes

| ID                                                    | Workflow                                       | Severity                         | Lane      | Effort | Run after |
| ----------------------------------------------------- | ---------------------------------------------- | -------------------------------- | --------- | ------ | --------- |
| [WD1](WD1-stale-launcher-lock.md)                     | Restore and update with a stale launcher lock  | High, reproducible today         | native    | S      | —         |
| [WD2](WD2-launcher-shutdown-and-child-supervision.md) | Launcher shutdown and child supervision        | High                             | native    | M      | WD1       |
| [WD3](WD3-nightly-backup-reliability.md)              | Nightly backup gaps and upgrade drift          | High                             | native    | M      | WD2       |
| [WD4](WD4-closed-app-backup-and-restore-drill.md)     | Backup with the app closed, full restore drill | Medium                           | native    | M      | WD3       |
| [WD5](WD5-secrets-in-logs-and-diagnostics.md)         | Secrets in logs and support bundles            | Medium (security)                | native    | S      | WD2       |
| [WD6](WD6-local-identity-trust-boundary.md)           | Packaged local identity trust boundary         | Medium–High (security, unproven) | api / web | M      | —         |
| [WD7](WD7-setup-and-support-legibility.md)            | Setup and support error legibility             | Low–Medium                       | installer | S      | —         |
| [WD8](WD8-native-lifecycle-drill.md)                  | End-to-end lifecycle drill (regression net)    | —                                | QA        | M      | WD1–WD5   |
| [WD0](WD0-triage-a-workflow-symptom.md)               | Triage any new workflow symptom                | Template                         | any       | S      | —         |

The native-lane prompts all edit `distribution/windows-native/launcher.cjs` or
`native-operations.cjs`, so run them one at a time. WD6 and WD7 touch other files and can run in
parallel with the native lane.

Run PB0 (source control) first if you can, so each WD prompt gets its own branch (`wd/WD1`, …).

## How to launch

Each launch line below is the owner's authorization for that one prompt (see `AGENTS.md`,
"Active-phase control").

**Codex** (PowerShell, from the tree root):

```powershell
codex.cmd "Owner authorizes WD1. Follow docs/tasks/workflow-debugging/WD1-stale-launcher-lock.md."
```

**Copilot in VS Code**: open this folder, switch Chat to Agent, and type `/wd1-stale-launcher-lock`.
The prompt files are in `.github/prompts/`.

**Copilot CLI or another agent**: paste the Codex launch line.

**WD0** also needs the symptom:

```powershell
codex.cmd "Owner authorizes WD0. Symptom: <what happened, when (local time), which build, which workflow>. Follow docs/tasks/workflow-debugging/WD0-triage-a-workflow-symptom.md."
```

## Shared rules

These apply to every WD prompt, on top of `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.

1. **The live install holds real books.** Treat these as read-only evidence:

   - `%LOCALAPPDATA%\PennyWiseAccounting`;
   - `D:\PennyWiseBackups`;
   - the scheduled task `PennyWise Accounting Nightly Backup`.

   Never start, stop, back up, restore, update or delete anything there. Never create or delete
   `launcher.lock` or `shutdown-request.json` there. Reproduce problems in a temp directory
   (`node:test` with `mkdtempSync`), the isolated test database on port 55432, or a disposable
   profile that redirects `LOCALAPPDATA`, as
   `distribution/public-beta/qa/Test-PennyWiseInstalledFirstRun.ps1` does.

2. **Never open, print, copy or hash secret material.** That means:

   - `.env`;
   - `runtime-secrets.json`, `license.json`, `.owner-password`;
   - anything under `%LOCALAPPDATA%\PennyWiseBetaIssuer`, including the slot activation files;
   - signing keys.

   Inside a backup ZIP, read only `backup-manifest.json` and `files.sha256`, or list the entries.
   `launcher.log` lines 87 and 97 contain a plaintext password, so read that log only through a
   filter that masks `*password*=`, `*secret*=` and `*token*=` values.

3. **Reproduce first.** Show a failing test or scripted repro before changing code. If you can't
   reproduce the problem, stop and report what you tried. Don't fix a different bug from the one
   the evidence proves.
4. **Keep evidence and hypotheses apart.** Each prompt labels its claims. Confirm or refute every
   hypothesis with evidence, and say which it was.
5. **Stay in scope.** Fix only the stated defect, and don't refactor. Native tests go in
   `distribution/windows-native/*.test.mjs` (`node:test`) and must be added to the root `test`
   script. API tests use vitest.
6. **Use the Windows tooling rules.** Use `corepack.cmd`, `pnpm.cmd` and `npx.cmd` when shims
   are blocked, and don't change the execution policy. Don't run installers, `Add-AppxPackage`,
   `certutil`, or `schtasks /Create`, `/Change` or `/Delete` on real tasks. Read-only
   `Get-ScheduledTask*` and `Get-WinEvent` calls are fine.
7. **Work without git if you must.** If `git status` fails because the tree has no `.git` (PB0
   not done), copy every file you will edit to `%TEMP%\pennywise-wd\<ID>\` before the first
   edit, and give that path in your report.
8. **Verify before you report.** Run targeted tests while working. At the end, run:

   - `node --test` on the native test files you touched;
   - `corepack pnpm lint`;
   - `corepack pnpm format:check`;
   - any other gate the prompt names.

   Report actual results, including skipped checks.

9. **Report, then stop.** Write `docs/status/<ID>_REPORT_<yyyy-mm-dd>.md` in under 1,200 words.
   Include:

   - the root cause, with `file:line` evidence;
   - the fix;
   - the tests and commands you ran, with their results;
   - anything still unverified;
   - **owner actions**.

   Then stop. Don't start another WD prompt.

## Evidence sources (read-only)

- `%LOCALAPPDATA%\PennyWiseAccounting\logs\launcher.log`: 250 lines, 2026-09-06 to 2026-10-18,
  timestamps in UTC. The machine runs at UTC−6, so the 02:00 local backup logs as 08:00Z.
- `%LOCALAPPDATA%\PennyWiseAccounting\` files `backup-config.json`, `launcher.lock`,
  `operations\Run-NightlyBackup.cmd` and `operations\nightly-backup-task.xml`.
- `%LOCALAPPDATA%\PennyWiseSetup\logs\*.log`.
- `D:\PennyWiseBackups\PennyWise-Backup-*.zip`, each with its `.sha256` sidecar.
- `D:\PennyWiseBetaCandidates\0.14.0.11` to `0.14.0.13`: installers and their checksums only.
  Don't run them.
