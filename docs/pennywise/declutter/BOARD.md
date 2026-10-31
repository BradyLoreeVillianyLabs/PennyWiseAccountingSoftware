# UI v2 Coordination Board

The integrator (Claude Code) edits this file. Other streams report status on their GitHub issue.
Statuses: `blocked-auth` (waiting for CURRENT_PHASE authorization) · `waiting` (dependencies) · `ready` ·
`in-progress` · `review` (PR open) · `merged` · `done`.

Repository: <https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware> · Integration branch:
`ui/integration` · Baseline tag: `ui-v2-baseline`

| Stream      | Phase | Wave | Engine               | Branch              | Web/API ports | Test DB                         | Status       | Depends on            | Issue                                                                                  |
| ----------- | ----- | ---- | -------------------- | ------------------- | ------------- | ------------------------------- | ------------ | --------------------- | -------------------------------------------------------------------------------------- |
| foundations | U0    | 0    | Claude Code          | `ui/u0-foundations` | 3512 / 3513   | `clearledger_test_foundations`  | blocked-auth | git baseline, U0 auth | [#1](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/1)   |
| shell       | U1    | 1    | Claude Code          | `ui/shell`          | 3514 / 3515   | `clearledger_test_shell`        | waiting      | U0                    | [#2](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/2)   |
| charts      | U1    | 1    | Antigravity          | `ui/charts`         | 3516 / 3517   | `clearledger_test_charts`       | waiting      | U0                    | [#3](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/3)   |
| api-summary | U1    | 1    | Codex                | `ui/api-summary`    | 3518 / 3519   | `clearledger_test_api_summary`  | waiting      | U0                    | [#4](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/4)   |
| qa          | U1    | 1    | Copilot              | `ui/qa`             | 3520 / 3521   | `clearledger_test_qa`           | waiting      | U0                    | [#5](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/5)   |
| research    | U1    | 1    | Copilot (research)   | `ui/research`       | —             | —                               | waiting      | U1 auth (docs only)   | [#6](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/6)   |
| home        | U2    | 2    | Codex                | `ui/home`           | 3524 / 3525   | `clearledger_test_home`         | waiting      | Wave 1                | [#7](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/7)   |
| sales       | U3    | 2    | Codex                | `ui/sales`          | 3526 / 3527   | `clearledger_test_sales`        | waiting      | Wave 1                | [#8](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/8)   |
| expenses    | U3    | 2    | Codex                | `ui/expenses`       | 3528 / 3529   | `clearledger_test_expenses`     | waiting      | Wave 1                | [#9](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/9)   |
| banking     | U3    | 2    | Codex                | `ui/banking`        | 3530 / 3531   | `clearledger_test_banking`      | waiting      | Wave 1                | [#10](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/10) |
| contacts    | U4    | 2    | Codex                | `ui/contacts`       | 3532 / 3533   | `clearledger_test_contacts`     | waiting      | Wave 1                | [#11](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/11) |
| taxes       | U4    | 2    | Codex                | `ui/taxes`          | 3534 / 3535   | `clearledger_test_taxes`        | waiting      | Wave 1                | [#12](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/12) |
| reports     | U5    | 2    | Antigravity          | `ui/reports`        | 3536 / 3537   | `clearledger_test_reports`      | waiting      | Wave 1                | [#13](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/13) |
| ext-1…10    | U6    | 3    | Copilot coding agent | `ui/ext-<module>`   | 3550+         | `clearledger_test_ext_<module>` | waiting      | Wave 2                | #16–#25                                                                                |
| polish      | U7    | 4    | Antigravity → Claude | `ui/polish`         | 3538 / 3539   | `clearledger_test_polish`       | waiting      | Wave 3                | [#14](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/14) |
| usability   | U8    | 4    | Human                | —                   | —             | demo DB                         | waiting      | U7                    | [#15](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/15) |

Ports come from `scripts/ui-v2/new-stream.ps1 -Slot <n>` (web = 3510 + 2n, api = web + 1); slots are listed in
[`docs/tasks/ui-v2/README.md`](../../tasks/ui-v2/README.md).

## Metrics snapshot

| Metric                       | Baseline (2026-10-31) | Target   | Latest |
| ---------------------------- | --------------------- | -------- | ------ |
| Top nav items (desktop)      | 16                    | 0        |        |
| Rail items, owner mode / all | 14 / 20               | ≤ 10     |        |
| Buttons in markup            | 463                   | ↓        |        |
| Dialogs                      | 22                    | ↓        |        |
| Chart elements               | 0                     | > 0      |        |
| Largest JS file (lines)      | 27,656                | ≪        |        |
| CSS lines                    | 13,447                | ≤ 13,447 |        |

## Log

- 2026-10-31 — Program prepared: task files, board, metrics baseline and stream tooling. Waiting for
  the git baseline (Codex) and owner authorization of U0.
- 2026-10-31 — GitHub labels and issues #1–#26 created; owner checklist is [#26](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/26).
