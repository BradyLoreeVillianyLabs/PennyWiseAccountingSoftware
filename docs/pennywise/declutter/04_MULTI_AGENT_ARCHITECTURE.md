# Multi-Agent Execution Architecture

Goal: run every available AI engine **at the same time** without them overwriting each other in a
27k-line `app.js`. The key enabler is phase U0, which splits the monolith into files that each have
exactly one owner.

> Phase names use the `U` prefix (UI v2) so they do not collide with the existing D1–D6 fulfilment
> phases recorded in `docs/status/`.

Repository: <https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware>

## 1. Engines and roles

| Engine                                                   | Strength                                          | Role                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Claude Code** (Claude desktop / CLI)                   | Large careful refactors, architecture             | **Integrator**: U0 module split, U1 shell, ui-kit, merges, cross-review of Codex work        |
| **Codex** (Codex desktop / CLI / cloud, parallel tasks)  | Fast precise feature code and tests               | **Feature builders**: API summary endpoints, Home, Sales, Expenses, Banking, Contacts, Taxes |
| **Antigravity** (Gemini models + built-in browser agent) | Visual reasoning, browser automation, screenshots | **Charts + Reports + Visual QA**: `charts.js`, Reports landing, Gate C, U7 density audit     |
| **GitHub Copilot** (VS Code / CLI agents, coding agent)  | Research, review, async GitHub issues             | **Research lane, QA metrics, Gate B review**, and U6 extended modules as GitHub issues       |
| **Human owner**                                          | Authority                                         | Authorizes phases in `CURRENT_PHASE.md`, signs off each wave, runs U8 usability test         |

Rule: **no engine reviews its own engine's work.** Codex output is reviewed by Claude or Copilot,
Claude output by Copilot or Codex, Antigravity output by Claude.

## 2. Workspace isolation

- Source lives on GitHub. Baseline commit tagged `ui-v2-baseline`; integration branch
  `ui/integration`; `main` only receives signed-off waves.
- One **git worktree per local stream**: `scripts/ui-v2/new-stream.ps1 -Stream <name>` creates
  `..\pw-<name>` on branch `ui/<name>` and writes `.ui-v2-stream.env` with that stream's ports and DB.
  Cloud agents (Codex cloud, Copilot coding agent) get the same isolation automatically.
- Each stream uses its **own disposable database** `clearledger_test_<stream>` (the existing
  `scripts/require-isolated-test-database.mjs` guard enforces `clearledger*_test` names) and its own
  `PLAYWRIGHT_WEB_PORT` / `PLAYWRIGHT_API_PORT` pair (see `BOARD.md`).
- Never point a worktree at `127.0.0.1:55432/clearledger` (beta data), QBWooBridge, or production.

## 3. File ownership matrix (after U0)

| Path                                                                                              | Owner stream                          | Others may                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `apps/web/src/shell.js`, `nav.js`, `index.html` shell partial                                     | `shell` (Claude)                      | Request via issue                          |
| `apps/web/src/ui-kit/*` (KpiCard, Pipeline, ListInspector, TaskPanel, AttentionQueue, EmptyState) | `shell` (Claude)                      | Consume only                               |
| `apps/web/src/charts.js`                                                                          | `charts` (Antigravity)                | Consume only                               |
| `apps/web/styles.css` tokens section                                                              | `shell`                               | Module rules only in `styles/<module>.css` |
| `apps/web/src/workspaces/home.js` + partial + `styles/home.css`                                   | `home` (Codex)                        | —                                          |
| `apps/web/src/workspaces/{sales,expenses,banking,contacts,taxes}.js` + partials + css             | one Codex task each                   | —                                          |
| `apps/web/src/workspaces/reports.js` + partial + css                                              | `reports` (Antigravity)               | —                                          |
| `apps/web/src/workspaces/<extended>.js`                                                           | `ext-<module>` (Copilot coding agent) | —                                          |
| `apps/web/e2e/<module>.*.spec.ts`                                                                 | that module's stream                  | —                                          |
| `apps/web/e2e/support/*`, `scripts/ui-v2/*`, `docs/pennywise/declutter/metrics.json`              | `qa` (Copilot)                        | —                                          |
| `apps/api` **read-only** summary endpoints (dashboard summary, aging, trends, tax calendar)       | `api-summary` (Codex)                 | Request via issue                          |
| `packages/accounting-core`, `packages/db`, posting code                                           | **Frozen**                            | Nobody                                     |
| `docs/COMPETITIVE_RESEARCH_MATRIX.md`                                                             | `research` (Copilot)                  | —                                          |
| `docs/pennywise/declutter/BOARD.md`                                                               | Integrator (Claude)                   | Comment on the stream's issue instead      |
| `docs/status/CURRENT_PHASE.md`                                                                    | **Human owner only**                  | —                                          |

The shared contract is `apps/web/src/ui-kit/README.md` (component props, created in U0) plus
`02_TARGET_UX_SPEC.md`. Contract changes go through the integrator.

## 4. Dependency graph and parallel waves

```
Wave 0  U0 foundations ................................ Claude (serial, alone)
          module split · ui-kit stubs · charts.js stub · nav tiers · uiV2 flag
                         │ merge to ui/integration, all existing specs green
Wave 1  ┌──────────────┬───────────────┬──────────────┬─────────────┬──────────────┐
        │ U1 shell     │ charts.js     │ api-summary  │ qa harness  │ research     │
        │ Claude       │ Antigravity   │ Codex        │ Copilot     │ Copilot      │
        └──────┬───────┴───────┬───────┴──────┬───────┴──────┬──────┴──────┬───────┘
Wave 2  ┌──────┴─┬───────┬─────┴────┬─────────┬──────────┬───┴────┬────────┴┐
        │ home   │ sales │ expenses │ banking │ contacts │ taxes  │ reports │
        │ Codex  │ Codex │ Codex    │ Codex   │ Codex    │ Codex  │ Antigr. │
        └────────┴───────┴──────────┴─────────┴──────────┴────────┴─────────┘
Wave 3  U6 extended modules, one GitHub issue each (Copilot coding agent; Codex/Antigravity overflow)
Wave 4  U7 density + polish (Antigravity audit → Claude fixes) → U8 usability test (human)
```

Peak concurrency: 5 agents in Wave 1, 7 in Wave 2, ~10 async in Wave 3.

## 5. Agent task contract

Every stream task file in `docs/tasks/ui-v2/` references the shared contract in
[`docs/tasks/ui-v2/README.md`](../../tasks/ui-v2/README.md#agent-contract). Engines load it via:

| Engine      | Entry point                                                       |
| ----------- | ----------------------------------------------------------------- |
| Codex       | `AGENTS.md` → "UI v2 program" section                             |
| Antigravity | `AGENTS.md` (read natively) + `.agents/workflows/ui-v2-stream.md` |
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`) + `/ui-v2-stream` command       |
| Copilot     | `AGENTS.md` + `.github/prompts/ui-v2-stream.prompt.md`            |

## 6. Integration protocol

1. Streams push `ui/<stream>` and open a PR **into `ui/integration`** (never `main`), titled
   `[UI v2][<stream>] …` and linked to the stream's GitHub issue.
2. **Gate A (automatic):** `corepack.cmd pnpm check`, `test:e2e`, `test:accessibility`,
   `test:performance`, `test:research`, plus `node scripts/ui-v2/measure-ui.mjs --check`.
3. **Gate B (cross-engine review):** ledger-logic diffs, deleted IDs/`data-workspace-target`,
   new dependencies, CSP violations, money formatting bypassing `money.js`, storage-key changes.
4. **Gate C (visual, Antigravity):** 1366×768 and 1920×1080 screenshots vs `02_TARGET_UX_SPEC.md`
   and the budgets in `metrics.json`.
5. Integrator merges in wave order; every open stream then runs `git rebase origin/ui/integration`.
6. End of wave: build the installer, smoke-install on one clean Windows 11 machine, human sign-off,
   merge `ui/integration` → `main`, owner updates `CURRENT_PHASE.md`.

## 7. Coordination artifacts

- [`BOARD.md`](BOARD.md) — one row per stream: engine, branch, ports, DB, status, blocker.
- [`metrics.json`](metrics.json) — baseline and per-wave values from `scripts/ui-v2/measure-ui.mjs`.
- [`05_LAUNCH_RUNBOOK.md`](05_LAUNCH_RUNBOOK.md) — exact owner steps to start each wave.
- [`docs/tasks/ui-v2/`](../../tasks/ui-v2/README.md) — one self-contained task file per stream.
- GitHub labels `ui-v2`, `wave-0`…`wave-4`, `engine:claude|codex|antigravity|copilot`; one issue per stream.
