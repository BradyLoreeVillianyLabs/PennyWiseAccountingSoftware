# Apply This Update to the Live VS Code Workspace

This is an overlay package. It intentionally contains documentation and task-control files only; it does not replace the Phase 1 code Codex produced in your live workspace.

## Recommended method

1. Make sure the current Codex task is stopped.
2. Create a Git commit or backup of the current workspace.
3. Extract this update package to a temporary folder.
4. Copy the package contents into the root folder currently open in VS Code.
5. Allow the listed documentation files to be replaced.
6. Do not replace or delete `apps/`, `packages/`, migrations, tests, lockfiles, or environment files from the live workspace.
7. Review the resulting Git diff.
8. Give Codex the contents of `PASTE_TO_CODEX.md`.

## PowerShell example

From the live ClearLedger project root, after extracting this pack beside the project:

```powershell
Copy-Item -Path "..\ClearLedger-Phase2-3-Update-Pack\*" -Destination "." -Recurse -Force
```

Delete the copied pack-only helper files from the project if you do not want them retained:

```powershell
Remove-Item .\APPLY_UPDATE.md, .\PASTE_TO_CODEX.md, .\UPDATE_MANIFEST.md -ErrorAction SilentlyContinue
```

## Files that should be reviewed as replacements

- `AGENTS.md`
- `CODEX_MASTER_PROMPT.md`
- `PROJECT_CHECKLIST.md`
- `README.md`
- `START_HERE.md`
- `COPY_THIS_TO_CODEX.md`
- `FILE_PLACEMENT_MAP.md`
- `docs/00_DOCUMENT_INDEX.md`
- `docs/IMPLEMENTATION_PLAN.md`

The package does not assume that a prepared phase is authorized. `docs/status/CURRENT_PHASE.md` preserves the stop gate.
