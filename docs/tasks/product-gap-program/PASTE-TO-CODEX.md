# Paste to Codex

## Session 1 — Wave 0 kickoff

Setup is now recorded in CURRENT_PHASE.md. Read RECONCILIATION-2026-09-11.md
alongside the build plan; it corrects historical runner and payment assumptions.

Paste this after the pack has been copied to `docs/tasks/product-gap-program/` and the
authorization text in `HANDOFF-BUILD-PLAN.md` §3 has been added to
`docs/status/CURRENT_PHASE.md`.

```text
Work only in C:\Users\EmceeHax\Desktop\clearledger-src.

Read, in order:
1. AGENTS.md and docs/tasks/TASK_EXECUTION_STANDARD.md
2. docs/status/CURRENT_PHASE.md — confirm the "Product-gap program" authorization is present.
   If it is not, stop and say so.
3. docs/tasks/product-gap-program/HANDOFF-BUILD-PLAN.md (§1, §4, §5 Wave 0, §6, §7)
4. docs/tasks/product-gap-program/X4-inclusive-ui-quality-bar.md

Task: execute Wave 0 only.
- Record a baseline run of the existing unit, integration and e2e suites on a fresh
  disposable database, following the environment notes in §7. Report the actual results,
  including known failures.
- Implement X4 Part A exactly as written: axe harness with a committed baseline, keyboard
  paths, viewport and forced-colors runs, target-size script, INP measurement, the t("key")
  string catalog, and docs/pennywise/UI_QUALITY_BAR.md.

Rules:
- Before editing, give the brief pre-edit plan the task execution standard requires.
- Do not touch other prompts' scope.
- Do not suppress axe rules to pass.
- There is no git: list every changed file.
- Finish with the completion report template in HANDOFF-BUILD-PLAN.md §9, then stop.
```

## Every later session — one prompt at a time

```text
Work only in C:\Users\EmceeHax\Desktop\clearledger-src.
Read AGENTS.md, docs/tasks/TASK_EXECUTION_STANDARD.md, docs/status/CURRENT_PHASE.md,
docs/tasks/product-gap-program/HANDOFF-BUILD-PLAN.md (§4, §6, §7), and the prompt file
docs/tasks/product-gap-program/<PROMPT-FILE>.md.

Confirm that the prompt's dependencies in HANDOFF-BUILD-PLAN.md §5 are complete. If any is
not, stop and report which.
Use the §4 decision defaults unless docs/DECISIONS_AND_OPEN_QUESTIONS.md records an owner
override.
Execute only this prompt. Meet the Definition of Done in §6. Use the §9 report template.
Stop after the report.
```
