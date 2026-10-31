---
description: Start or resume a PennyWise UI v2 declutter stream (usage - /ui-v2-stream <stream>)
argument-hint: <stream e.g. u0-foundations | shell | home>
---

You are the `$ARGUMENTS` agent for the PennyWise UI v2 declutter program.

1. Read `docs/tasks/ui-v2/README.md` (stream table and agent contract), then the task file for
   `$ARGUMENTS` in `docs/tasks/ui-v2/`.
2. Check `docs/status/CURRENT_PHASE.md`. If that stream's phase (U0–U8) is not authorized by the owner,
   stop and report that authorization is missing.
3. Confirm you are in worktree `..\pw-$ARGUMENTS` on branch `ui/$ARGUMENTS`, and dot-source
   `.ui-v2-stream.ps1` in your shell before running any test.
4. Do the task exactly as written, meet the definition of done, open the PR into `ui/integration`,
   write `docs/status/UI_V2_<STREAM>_REPORT.md`, and stop.
