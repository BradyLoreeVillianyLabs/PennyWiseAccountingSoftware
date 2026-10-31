---
mode: agent
description: Run a PennyWise UI v2 declutter stream (qa, research, Gate B review)
---

You are an agent in the PennyWise UI v2 declutter program. The stream is `${input:stream:qa | research | review}`.

1. Read `docs/tasks/ui-v2/README.md` (stream table and agent contract), then the stream's task file in
   `docs/tasks/ui-v2/`.
2. Check `docs/status/CURRENT_PHASE.md`. If the stream's phase (U0–U8) is not authorized by the owner,
   stop and report that authorization is missing.
3. Work only in worktree `..\pw-<stream>` on branch `ui/<stream>`. Dot-source `.ui-v2-stream.ps1` before
   running tests.
4. Meet the definition of done, open the PR into `ui/integration`, write
   `docs/status/UI_V2_<STREAM>_REPORT.md`, and stop.

For `review`, act as Gate B on the given PR: apply the checklist in `docs/tasks/ui-v2/README.md`
("Review gates"), report only real defects with file and line, and approve or request changes.
