# UI v2 Declutter Program — Stream Tasks

These task files implement `docs/pennywise/declutter/03_REVISION_PLAN.md` using the parallel
architecture in `docs/pennywise/declutter/04_MULTI_AGENT_ARCHITECTURE.md`.

> **Authorization gate.** A task file here is _not_ authorization (AGENTS.md "Active-phase
> control"). A stream may start only when `docs/status/CURRENT_PHASE.md` lists its phase (U0…U8)
> as authorized by the owner. If it is not listed, stop and report.

## Streams

| #   | Stream file                                      | Phase | Wave | Engine               | Slot | Research-matrix module                        |
| --- | ------------------------------------------------ | ----- | ---- | -------------------- | ---- | --------------------------------------------- |
| 1   | [U0-foundations.md](U0-foundations.md)           | U0    | 0    | Claude Code          | 1    | table-grid-and-workspace-experience           |
| 2   | [U1-shell.md](U1-shell.md)                       | U1    | 1    | Claude Code          | 2    | navigation-settings-appearance-and-owner-mode |
| 3   | [W1-charts.md](W1-charts.md)                     | U1    | 1    | Antigravity          | 3    | reporting-budgeting-and-insights              |
| 4   | [W1-api-summary.md](W1-api-summary.md)           | U1    | 1    | Codex                | 4    | reporting-budgeting-and-insights              |
| 5   | [W1-qa-harness.md](W1-qa-harness.md)             | U1    | 1    | Copilot              | 5    | table-grid-and-workspace-experience           |
| 6   | [W1-research.md](W1-research.md)                 | U1    | 1    | Copilot (research)   | —    | all modules touched in Wave 2                 |
| 7   | [U2-home.md](U2-home.md)                         | U2    | 2    | Codex                | 7    | reporting-budgeting-and-insights              |
| 8   | [U3-sales.md](U3-sales.md)                       | U3    | 2    | Codex                | 8    | sales-invoicing-estimates-and-payments        |
| 9   | [U3-expenses.md](U3-expenses.md)                 | U3    | 2    | Codex                | 9    | purchases-expenses-and-accounts-payable       |
| 10  | [U3-banking.md](U3-banking.md)                   | U3    | 2    | Codex                | 10   | banking-reconciliation-and-cashflow           |
| 11  | [U4-contacts.md](U4-contacts.md)                 | U4    | 2    | Codex                | 11   | crm-contacts-projects-and-time                |
| 12  | [U4-taxes.md](U4-taxes.md)                       | U4    | 2    | Codex                | 12   | tax-and-compliance                            |
| 13  | [U5-reports.md](U5-reports.md)                   | U5    | 2    | Antigravity          | 13   | reporting-budgeting-and-insights              |
| 14+ | [U6-extended-modules.md](U6-extended-modules.md) | U6    | 3    | Copilot coding agent | 20+  | per module                                    |
| —   | [U7-polish.md](U7-polish.md)                     | U7    | 4    | Antigravity + Claude | 14   | table-grid-and-workspace-experience           |
| —   | [U8-usability.md](U8-usability.md)               | U8    | 4    | Human (+ Copilot)    | —    | —                                             |

Wave 2 starts only after U0 **and** all Wave 1 streams are merged into `ui/integration`.

## Agent contract

Paste-equivalent rules for every UI v2 agent, regardless of engine:

1. **Scope.** You are the `<stream>` agent. Work only in your worktree (`..\pw-<stream>`) on branch
   `ui/<stream>`, or in the cloud environment created for your issue. Edit only paths your stream owns
   (04 §3). Need a change elsewhere? Comment on your GitHub issue and continue with a stub.
2. **Read first, in this order:** `AGENTS.md`; your stream file; `docs/pennywise/declutter/02_TARGET_UX_SPEC.md`
   (the sections your file cites); `docs/pennywise/UI_QUALITY_BAR.md`; `apps/web/src/ui-kit/README.md` (after U0).
   Do not read the whole of `app.js`; use `rg` for the symbols you need.
3. **Frozen.** Never change `packages/accounting-core`, `packages/db`, posting/journal code in `apps/api`,
   `docs/status/CURRENT_PHASE.md`, or any `clearledger_*` / `pennywise_*` storage key. No new runtime
   dependencies. No inline scripts or styles that violate the CSP.
4. **Preserve.** Keep existing element IDs, `data-workspace-target` values, form `name`s and event
   bindings. If an element moves, move the node — do not recreate it. Hide, never delete.
5. **Money.** Format through `apps/web/money.js`; never do arithmetic on money with JS `number`.
6. **Flag.** All new UI renders only when `isUiV2Enabled()` from `apps/web/src/ui-flags.js` returns true
   (localStorage key `pennywise_ui_v2_v1`). The classic layout must keep working with it off.
7. **Isolation.** Before running tests: `. .\.ui-v2-stream.ps1` (sets your DB and ports). Never use the
   beta database `127.0.0.1:55432/clearledger`.
8. **Definition of done.**
   - `node --check` on every changed `.js`/`.mjs` file
   - `corepack.cmd pnpm format:check` and `corepack.cmd pnpm lint`
   - your `apps/web/e2e/<module>.*.spec.ts` (including the click-budget test where applicable)
   - `corepack.cmd pnpm test:e2e` (all existing specs still pass) and `corepack.cmd pnpm test:accessibility`
   - `node scripts/ui-v2/measure-ui.mjs --check`
   - screenshots at 1366×768 and 1920×1080 attached to the PR
   - your research-matrix module record updated (or a linked request to the research stream)
9. **Hand-off.** Push `ui/<stream>`, open a PR **into `ui/integration`** titled `[UI v2][<stream>] <summary>`,
   link the stream issue, list changed files, commands run with results, and any open requests.
   Write a short completion note at `docs/status/UI_V2_<STREAM>_REPORT.md`. Then stop.

## Review gates (who reviews whom)

| Author engine | Gate B reviewer        | Gate C (visual)                  |
| ------------- | ---------------------- | -------------------------------- |
| Codex         | Claude Code or Copilot | Antigravity                      |
| Claude Code   | Copilot or Codex       | Antigravity                      |
| Antigravity   | Claude Code            | Copilot (Playwright screenshots) |
| Copilot       | Claude Code            | Antigravity                      |

Gate B checklist: no frozen-path diff; no removed IDs/`data-workspace-target`; no new dependencies;
money via `money.js`; no storage-key renames; uiV2 flag respected; tests added, not weakened.
