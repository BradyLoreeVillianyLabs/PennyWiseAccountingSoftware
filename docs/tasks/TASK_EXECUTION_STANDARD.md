# ClearLedger Task Execution Standard

This standard applies to every phase task.

## 1. Inspect

Read only:

- `AGENTS.md`;
- `CODEX_MASTER_PROMPT.md`;
- files explicitly listed by the active phase task;
- directly relevant source, migrations, tests, and ADRs.
- for every changed module, the applicable entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`,
  comparable established software or open-source implementations, and their primary
  documentation. Provider and regulated workflows also require their provider or regulator's
  primary documentation.

Use targeted search before opening large files or directories.

## 2. Pre-edit response

Before editing, provide no more than:

1. likely files or modules to change;
2. critical accounting, tenancy, security, migration, or data-integrity risks;
3. blocking decisions that cannot be resolved from repository evidence.

Do not summarize the task or restate specifications.

## 3. Implement

- Execute only the active phase.
- Reuse existing types, services, permissions, adapters, and test infrastructure.
- Do not add placeholder implementations in financial or security-sensitive paths.
- Do not perform unrelated cleanup or broad refactors.
- Add or update tests with every material behaviour change.
- Update contracts and documentation when behaviour changes.
- Update the module record in `docs/COMPETITIVE_RESEARCH_MATRIX.md` with the comparable-product
  workflow or implementation contract, the PennyWise translation, intentional exclusions, and
  focused test locations. The catalog is mandatory for every module, including technical,
  integration, security, deployment, and regulated modules; user-facing modules must also record
  the interaction contract. Do not copy another product's branding, code, visual assets, or text.

## 4. Test efficiently

During development, run targeted tests for changed modules.

At the phase gate, run the complete required suite once. Fix failures, then rerun affected checks and one final complete suite.

Run `corepack pnpm test:research` as part of each release or complete-work gate.

Do not repeatedly run the full suite after every small edit.

## 5. Review

Before completion, review the diff for:

- accounting invariant violations;
- cross-tenant access;
- missing authorization;
- race conditions;
- unsafe migrations;
- non-idempotent creates;
- mutable financial history;
- sensitive data in logs;
- missing negative tests;
- unnecessary scope expansion.

Correct confirmed defects only.

## 6. Completion report

Keep the report concise and evidence-based, normally under 1,200 words.

Include:

1. phase result: pass or fail;
2. files created or materially changed;
3. migrations added;
4. tests added and final counts;
5. commands run with pass/fail status;
6. material accounting, security, tenancy, and migration controls;
7. unresolved blockers or risks;
8. exact local verification or startup steps;
9. prerequisites for the next phase.

Do not reproduce source code, specifications, or long command logs. Include full failure output only when a failure remains unresolved.

## 7. Stop gate

Stop after the report. A future task file is not permission to execute it.
