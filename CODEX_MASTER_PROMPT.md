# Codex Master Prompt: Build ClearLedger

You are implementing ClearLedger, a Canada-first small-business accounting and invoicing platform.

The repository is the source of truth. Follow the active task's required-reading list rather than reading all documentation on every phase.

## Core design rules

1. Use a modular monolith.
2. Use TypeScript strict mode.
3. Never use JavaScript floating-point numbers for persisted money.
4. Store money as integer minor units or an approved fixed-precision decimal type.
5. Every posted journal must balance before commit.
6. Posted journal lines must never be updated or deleted.
7. Reversals and adjustments preserve original transactions.
8. Financial posting occurs inside database transactions.
9. External side effects use a transactional outbox.
10. External create operations support idempotency.
11. Tenant-owned records carry organization scope.
12. Enforce tenant isolation in service authorization and database policy where practical.
13. Never store card numbers, CVVs, or online-banking credentials.
14. Do not create an unrestricted invoice HTML editor.
15. Payroll, manufacturing, and multi-entity consolidation remain outside the
    current release. Transaction-level multi-currency and foreign-exchange
    revaluation may be implemented only through the approved MCFX program,
    with its phase gates, exact-arithmetic rules, and accountant/provider
    evidence requirements.
16. Do not add autonomous AI bookkeeping before deterministic workflows are complete.
17. Write tests before or alongside accounting and security-sensitive features.
18. Every material financial or privileged user action creates an audit event.
19. Prefer explicit domain services over ORM calls from route handlers.
20. Keep generated code production-oriented and documented.

## Phase execution

- The authorized task file defines scope, required reading, deliverables, tests, and exit criteria.
- Follow `docs/tasks/TASK_EXECUTION_STANDARD.md`.
- Do not restate the task specification.
- Do not begin a later phase without explicit owner authorization. A general
  request to execute the MCFX plan does not replace the named owner/accountant
  approval artifacts, prerequisite PASS reports, or one-phase stop gates in the
  MCFX prompt pack. The 2026-07-29 review reset MCFX to phase 00 and
  database-locked foreign posting off.
- Do not conceal skipped checks or unresolved risks.

## Definition of done

A phase is complete only when:

- strict TypeScript compilation passes;
- migrations apply cleanly to a disposable database;
- required tests pass;
- accounting invariants pass;
- authorization and tenant-isolation tests pass;
- idempotency and concurrency tests pass where relevant;
- no secrets or generated build output are committed;
- documentation reflects changed contracts and procedures;
- the implementation matches the phase acceptance criteria;
- the concise completion report is produced;
- Codex stops and waits for approval.
