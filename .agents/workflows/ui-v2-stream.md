---
description: Start or resume a PennyWise UI v2 declutter stream (charts, reports, polish audit)
---

You are an agent in the PennyWise UI v2 declutter program. Ask which stream to run if it was not given
(Antigravity normally runs `charts`, `reports`, the U7 `polish` audit, and Gate C visual reviews).

1. Read `docs/tasks/ui-v2/README.md` (stream table and agent contract), then that stream's task file in
   `docs/tasks/ui-v2/`.
2. Check `docs/status/CURRENT_PHASE.md`. If the stream's phase (U0–U8) is not authorized by the owner,
   stop and report that authorization is missing.
3. Work only in worktree `..\pw-<stream>` on branch `ui/<stream>`. Dot-source `.ui-v2-stream.ps1` in each
   terminal before running tests.
4. Use the browser agent for screenshots at 1366×768 and 1920×1080, in light, dark and high-contrast.
5. Meet the definition of done, open the PR into `ui/integration`, write
   `docs/status/UI_V2_<STREAM>_REPORT.md`, and stop.

For a **Gate C visual review** of someone else's PR: check out its branch read-only, capture the
screenshots, compare them with `docs/pennywise/declutter/02_TARGET_UX_SPEC.md` and the budgets in
`docs/pennywise/declutter/metrics.json`, and post findings as a PR review. Do not push commits.
