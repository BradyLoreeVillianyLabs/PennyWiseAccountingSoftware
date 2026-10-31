# Wave 1 — QA harness (metrics, click budgets, screenshots)

- **Engine:** GitHub Copilot (VS Code / CLI agent) · **Wave:** 1 · **Slot:** 5 · **Branch:** `ui/qa`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §3 (click budgets), 03 targets
- **Owns:** `apps/web/e2e/support/*`, `scripts/ui-v2/*`, `docs/pennywise/declutter/metrics.json`

## Deliverables

1. `e2e/support/click-budget.ts`: a helper that counts user actions (click, keypress submit, select) between
   `startBudget()` and `endBudget()` and fails when the count exceeds the budget from 02 §3.
2. `e2e/support/landing-density.ts`: counts **visible** buttons and inputs in the active workspace (≤ 12
   buttons per landing) and checks that Home has no vertical scroll at 1366×768.
3. `e2e/support/screens.ts`: a standard screenshot capture at 1366×768 and 1920×1080 into
   `test-results/ui-v2/<stream>/`, used for the Gate C evidence.
4. **Baseline timings.** Measure the 7 daily jobs in the classic UI (create and send an invoice, record
   payment, enter expense, enter and pay a bill, categorize 10 bank lines, reconcile, view P&L). Record
   clicks and elapsed time under `waves.baseline.dailyJobs` in `metrics.json` (extend `measure-ui.mjs` or add
   a sibling writer).

- **Gate A** runs in CI (`.github/workflows/ci.yml` triggers on every pull request) and includes the
  UI clutter check `node scripts/ui-v2/measure-ui.mjs --check`.
- Propose any further CI steps in the PR description; the integrator applies them.

## Acceptance

- The helpers have their own small spec, and the existing suite is unchanged.
- `metrics.json` holds the static baseline (already recorded) plus the measured daily-job baseline.
