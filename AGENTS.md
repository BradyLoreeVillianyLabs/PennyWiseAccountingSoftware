# Repository Instructions for Codex

These instructions apply to the complete ClearLedger repository.

## Source-of-truth order

When requirements conflict, use this priority:

1. Accounting integrity, tenant isolation, security, and legal constraints
2. The explicitly authorized phase task in `docs/tasks/`
3. `CODEX_MASTER_PROMPT.md`
4. `docs/ACCOUNTING_POSTING_RULES.md`
5. `docs/SECURITY_AND_COMPLIANCE.md`
6. `docs/PRODUCT_REQUIREMENTS.md`
7. `docs/ARCHITECTURE.md`
8. Existing implementation

Record material conflicts in `docs/DECISIONS_AND_OPEN_QUESTIONS.md` or an ADR.

## Active-phase control

- `docs/status/CURRENT_PHASE.md` records project status.
- Execute only the phase explicitly authorized by the project owner.
- A prepared future task file is not authorization to execute it.
- Do not scaffold or implement later phases unless the active phase needs a narrow interface boundary.
- Stop after the active phase completion report.

## Accounting invariants

- A posted journal must balance before commit.
- Posted journals and lines are immutable.
- Corrections create linked reversals or adjustments.
- Source updates, posting, idempotency, audit events, and outbox records commit atomically.
- Closed periods reject posting.
- Control accounts require explicit domain workflows or authorized accountant action.
- Persisted money uses bigint minor units or an approved fixed-precision decimal type.
- Never use JavaScript `number` for persisted money.
- Reports derive from posted ledger entries.

## Engineering rules

- TypeScript strict mode.
- pnpm workspace.
- Modular monolith.
- Thin controllers and explicit domain services.
- PostgreSQL integration tests for database invariants.
- Default-deny authorization.
- Organization scope comes from authenticated membership, not request bodies.
- Validate every external boundary.
- Use idempotency for external create operations.
- Use a transactional outbox for side effects.
- Every product module has a baseline in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Before
  changing, adding, or declaring any module complete, review the applicable comparable
  established software or open-source implementations and their primary documentation.
  Update that module's research record with the observed workflow, PennyWise translation,
  deliberate exclusions, and focused acceptance coverage. For provider or regulated paths,
  include the provider's or regulator's primary documentation as well. Use research for
  context only: never copy proprietary branding, code, visual assets, or wording.
- Run `corepack pnpm test:research` with release validation. A passing baseline catalog does
  not claim feature parity; the task-specific record and tests are still required before a
  module can be called complete.
- Do not commit secrets, generated credentials, build output, or local environment files.
- Under Windows PowerShell, use `npm.cmd`, `pnpm.cmd`, `npx.cmd`, and `corepack.cmd` when bare `.ps1` shims are blocked.
- Do not weaken the user's PowerShell execution policy.

## Token and context efficiency

Use repository context economically without reducing implementation quality.

1. Read only files required by the active task and directly relevant source files.
2. Prefer targeted `rg` searches over reading entire directories.
3. Do not restate or summarize specifications unless resolving a contradiction.
4. Inspect existing implementations before creating abstractions or duplicate models.
5. Modify existing files rather than regenerating unchanged files.
6. Exclude `node_modules`, `dist`, coverage, generated clients, logs, and temporary files from broad searches.
7. Keep the pre-edit plan to files likely to change, critical risks, and blocking decisions.
8. Keep progress updates brief and event-driven.
9. Run targeted tests during implementation; run the complete suite at the phase gate and after final fixes.
10. Summarize passing command output. Include full failure output only when needed for diagnosis.
11. Do not emit complete source files in reports.
12. Avoid broad refactors unless required by the active phase.
13. Reuse decisions recorded in ADRs rather than reopening settled architecture.
14. Final reports should normally remain under 1,200 words.
15. Stop after the approved phase; do not prebuild future features.

## Task execution standard

Every phase must follow `docs/tasks/TASK_EXECUTION_STANDARD.md` unless its task file explicitly tightens a requirement.

## Required quality gate

Before reporting a phase complete, run the relevant commands for:

- format check;
- lint;
- TypeScript typecheck;
- Prisma validation and generation;
- clean migration deployment;
- unit tests;
- PostgreSQL integration tests;
- authorization and tenant-isolation tests;
- idempotency and concurrency tests where applicable;
- rollback verification where applicable;
- build;
- applicable end-to-end tests.
- `corepack pnpm test:research`.

Report actual results, including failures and skipped checks.

## Documentation

Update documentation when code changes a contract, invariant, decision, command, environment variable, or development procedure.

Use ADRs for material, irreversible, or difficult-to-reverse choices.

## UI v2 declutter program (multi-agent)

The UI declutter program runs several AI engines in parallel: Claude Code, Codex, Antigravity and GitHub Copilot.

- **Plan:** `docs/pennywise/declutter/` (start with `README.md`).
- **Stream tasks and shared agent contract:** `docs/tasks/ui-v2/README.md`.
- **Phases:** U0–U8 (prefix `U`, distinct from the earlier D1–D6 fulfilment phases). Each requires owner
  authorization in `docs/status/CURRENT_PHASE.md`, like every other phase.
- **Isolation:** work only in your own worktree and branch `ui/<stream>`. Edit only the files your stream
  owns (`docs/pennywise/declutter/04_MULTI_AGENT_ARCHITECTURE.md` §3). Open PRs into `ui/integration`,
  never `main`.
- **Frozen paths:** UI v2 work never changes `packages/accounting-core`, `packages/db`, or posting code.
