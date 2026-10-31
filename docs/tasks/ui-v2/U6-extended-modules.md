# U6 — Extended modules (one GitHub issue each)

- **Engine:** GitHub Copilot coding agent (assign the issue to Copilot); overflow goes to Codex cloud or
  Antigravity · **Wave:** 3
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §3 ("More modules" row)
- **Base branch:** `ui/integration` (set this explicitly when assigning Copilot)

Each module gets the landing skeleton (KPI ×3–4, pipeline where meaningful, list and inspector, TaskPanel)
and `tier: "more"`, so it appears under **More** and behind its Settings → Features toggle.

| Issue  | Module                    | Classic workspace id                           | Research-matrix module                 | Slot |
| ------ | ------------------------- | ---------------------------------------------- | -------------------------------------- | ---- |
| ext-1  | Point of sale             | `pos-workspace`                                | point-of-sale                          | 20   |
| ext-2  | Inventory and products    | `inventory-workspace`                          | inventory-fixed-assets-and-catalog     | 21   |
| ext-3  | Projects, time, calendar  | `projects-workspace`                           | calendar-and-planning                  | 22   |
| ext-4  | Contracts                 | `contracts-workspace`                          | documents-capture-and-printing         | 23   |
| ext-5  | Orders and fulfilment     | `fulfilment-workspace`                         | shipping-and-carrier-operations        | 24   |
| ext-6  | Budgets and planning      | `planning-workspace`                           | reporting-budgeting-and-insights       | 25   |
| ext-7  | Fixed assets              | `fixed-assets-workspace`                       | inventory-fixed-assets-and-catalog     | 26   |
| ext-8  | Payroll                   | `payroll-workspace`                            | payroll-and-hr                         | 27   |
| ext-9  | Integrations and payments | `integrations-workspace`, `payments-workspace` | integrations-email-and-notifications   | 28   |
| ext-10 | Switching centre          | `portability-workspace`                        | imports-migration-and-data-portability | 29   |

## Issue body template

```
Implement UI v2 landing for <Module> per docs/tasks/ui-v2/U6-extended-modules.md (row ext-N).
Follow the agent contract in docs/tasks/ui-v2/README.md#agent-contract exactly.
Owned files: apps/web/src/workspaces/<module>.js, src/partials/<module>.html, styles/<module>.css,
apps/web/e2e/<module>.*.spec.ts. Do not touch any other file.
Done when: flag-on landing uses the ui-kit skeleton, ≤ 12 visible buttons, the Features toggle hides and
shows it, the deep link still works with it hidden, the existing specs pass with the flag on and off, and
the research-matrix record for <matrix module> is updated. Open the PR into ui/integration.
```

## Acceptance (per issue)

- Toggle off/on is e2e tested and there are no orphaned routes. Gate B and Gate C pass.
