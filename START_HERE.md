# Start Here: Continuing ClearLedger in Visual Studio Code

ClearLedger is no longer a skeletal starter. Phase 1 established the ledger foundation. Work now proceeds through explicitly authorized, file-based phase tasks.

## Workspace root

Open the ClearLedger repository root itself in Visual Studio Code. It should contain:

```text
AGENTS.md
CODEX_MASTER_PROMPT.md
COPY_THIS_TO_CODEX.md
PROJECT_CHECKLIST.md
apps/
packages/
docs/
```

## Current control files

Read:

1. `docs/status/CURRENT_PHASE.md`
2. `PROJECT_CHECKLIST.md`
3. `docs/00_DOCUMENT_INDEX.md`

Codex follows:

1. `AGENTS.md`
2. `CODEX_MASTER_PROMPT.md`
3. `docs/tasks/TASK_EXECUTION_STANDARD.md`
4. the explicitly authorized phase task

## Windows command note

When PowerShell blocks bare npm/pnpm `.ps1` shims, use:

```powershell
node.exe --version
npm.cmd --version
pnpm.cmd --version
corepack.cmd --version
```

Use `.cmd` shims for project commands. Do not weaken PowerShell execution policy.

## Expected next phase

After Phase 1 remediation and owner approval, the expected next task is:

```text
docs/tasks/PHASE_02_IDENTITY_TENANCY.md
```

Phase 3 is prepared at:

```text
docs/tasks/PHASE_03_COMPANY_SETUP.md
```

It remains blocked until Phase 2 passes and is approved.

## Stop rule

Codex must stop after every phase completion report. Prepared task files never authorize themselves.
