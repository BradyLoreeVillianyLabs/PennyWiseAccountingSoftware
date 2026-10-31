A documentation and phase-control update has been copied into this repository.

Do not implement Phase 2 or Phase 3 yet.

Perform only this integration check:

1. Read `AGENTS.md`, `CODEX_MASTER_PROMPT.md`, `docs/tasks/TASK_EXECUTION_STANDARD.md`, `docs/status/CURRENT_PHASE.md`, and `UPDATE_MANIFEST.md` if present.
2. Inspect the Git diff for the replaced and new documentation files.
3. Confirm that the updated phase sequence is:
   - Phase 2: production identity, membership lifecycle, authorization, and RLS
   - Phase 3: company setup and accounting configuration
4. Confirm that the new instructions do not conflict with implemented Phase 1 accounting invariants.
5. Fix only documentation-path, naming, or internal-reference errors.
6. Do not alter Phase 1 source code, migrations, or tests.
7. Report the integration result in no more than 400 words and stop.
