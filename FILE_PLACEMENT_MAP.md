# File Placement Map

All paths are relative to the ClearLedger repository root opened in Visual Studio Code.

## Root control files

| File                     | Location                  | Purpose                                      |
| ------------------------ | ------------------------- | -------------------------------------------- |
| `README.md`              | `/README.md`              | Project overview and current status          |
| `START_HERE.md`          | `/START_HERE.md`          | Human continuation instructions              |
| `COPY_THIS_TO_CODEX.md`  | `/COPY_THIS_TO_CODEX.md`  | Reusable phase-control prompt template       |
| `AGENTS.md`              | `/AGENTS.md`              | Persistent repository rules and token policy |
| `CODEX_MASTER_PROMPT.md` | `/CODEX_MASTER_PROMPT.md` | Core engineering and accounting constraints  |
| `PROJECT_CHECKLIST.md`   | `/PROJECT_CHECKLIST.md`   | Phase gates and completion tracking          |

## Core specifications

| File                     | Location                                |
| ------------------------ | --------------------------------------- |
| Document index           | `/docs/00_DOCUMENT_INDEX.md`            |
| Product requirements     | `/docs/PRODUCT_REQUIREMENTS.md`         |
| Accounting posting rules | `/docs/ACCOUNTING_POSTING_RULES.md`     |
| Architecture             | `/docs/ARCHITECTURE.md`                 |
| Security and compliance  | `/docs/SECURITY_AND_COMPLIANCE.md`      |
| Permission matrix        | `/docs/PERMISSION_MATRIX.md`            |
| API guidelines           | `/docs/API_GUIDELINES.md`               |
| Acceptance tests         | `/docs/ACCEPTANCE_TESTS.md`             |
| Implementation plan      | `/docs/IMPLEMENTATION_PLAN.md`          |
| Decisions/open questions | `/docs/DECISIONS_AND_OPEN_QUESTIONS.md` |

## Task and status control

| File                       | Location                                      |
| -------------------------- | --------------------------------------------- |
| Task execution standard    | `/docs/tasks/TASK_EXECUTION_STANDARD.md`      |
| Historical Phase 1 task    | `/docs/tasks/PHASE_1_CODEX_TASK.md`           |
| Phase 2 task               | `/docs/tasks/PHASE_02_IDENTITY_TENANCY.md`    |
| Phase 3 task               | `/docs/tasks/PHASE_03_COMPANY_SETUP.md`       |
| Current phase status       | `/docs/status/CURRENT_PHASE.md`               |
| Phase 1 completion summary | `/docs/status/PHASE_01_COMPLETION_SUMMARY.md` |

## Code locations

| Area                     | Location                     |
| ------------------------ | ---------------------------- |
| API application          | `/apps/api/`                 |
| Web application          | `/apps/web/`                 |
| Accounting core          | `/packages/accounting-core/` |
| Database package         | `/packages/db/`              |
| Prisma schema/migrations | `/packages/db/prisma/`       |
| Shared package           | `/packages/shared/`          |
| Infrastructure           | `/infrastructure/`           |
| Repeatable scripts       | `/scripts/`                  |
| CI                       | `/.github/workflows/ci.yml`  |

Do not move `AGENTS.md` from the repository root.
