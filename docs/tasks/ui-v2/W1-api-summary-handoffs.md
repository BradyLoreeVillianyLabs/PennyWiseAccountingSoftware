# Wave 1 API Summary — Claude and Gemini Handoffs

Prepared 2026-11-02 before the Codex `api-summary` implementation slice. These are copy-ready,
review-only assignments for the two independent agents. Neither agent owns or edits the API-summary
implementation.

## Shared context

- Issue: [#4](https://github.com/BradyLoreeVillianyLabs/PennyWiseAccountingSoftware/issues/4)
- Stream: `api-summary`; branch `ui/api-summary`; worktree `D:\codex-temp\pw-api-summary`
- PR target: `ui/integration`
- Worktree command: `scripts\ui-v2\new-stream.ps1 -Stream api-summary -Slot 4`
- Web/API ports: `3518/3519`; test database: `clearledger_test_api_summary`
- Read `AGENTS.md`, `docs/status/CURRENT_PHASE.md`, `docs/tasks/ui-v2/README.md`,
  `docs/tasks/ui-v2/W1-api-summary.md`, and `docs/pennywise/declutter/02_TARGET_UX_SPEC.md` §§2–3.
- The owner authorized all UI v2 phases and cleared phase-start gates on 2026-11-02. PR #38
  (dependency maintenance) and PR #39 (U0 foundations) are still open in GitHub as of this handoff;
  do not describe either as merged or CI-green.
- Codex owns implementation and the stream worktree. These reviews must not edit files, push
  branches, or alter accounting behavior.

## Claude Code — security and accounting-contract review

Paste-ready handoff:

> Review the planned Wave 1 API summary slice for PennyWise issue #4. Read `AGENTS.md`,
> `docs/status/CURRENT_PHASE.md`, `docs/tasks/ui-v2/README.md`,
> `docs/tasks/ui-v2/W1-api-summary.md`, `docs/pennywise/declutter/02_TARGET_UX_SPEC.md` §§2–3,
> and the relevant existing API route, authorization, report-service, and integration-test code.
> Return a concise review-only report covering (1) existing routes/services that should be reused,
> (2) authorization and tenant-isolation patterns each proposed GET route must follow, (3) posted-ledger
> sources and period boundaries for each figure, (4) contract tests needed to compare with existing
> reports, and (5) scope risks or blockers. Do not modify files or implement code. Do not use any
> production or beta database. Preserve money as strings of minor units. Flag any requirement that
> would need a schema, migration, posting, UI, or accounting-logic change instead of expanding scope.

The same checklist should be used for Gate B review of the eventual PR. Report findings with file and
line references; do not approve the PR on behalf of its owner.

## Gemini / Antigravity — UX-to-response contract review

Paste-ready handoff:

> Review the Wave 1 API summary contract for PennyWise issue #4 against
> `docs/pennywise/declutter/02_TARGET_UX_SPEC.md` §§2–3 and
> `docs/tasks/ui-v2/W1-api-summary.md`. Read only the relevant existing dashboard, report, tax,
> authorization, and API response contracts. Return a review-only field map for `/v1/ui/home-summary`,
> `/v1/ui/attention-queue`, `/v1/ui/landing/:module`, and `/v1/ui/tax-calendar`: UX use, period or
> ordering semantics, empty state, source-of-truth service/route, and expected money representation.
> Identify gaps or duplications that Codex should resolve before coding. Do not implement or edit
> files, do not invent new accounting semantics, and do not use production or beta data. Keep the
> response compatible with the existing API contracts and preserve money as strings of minor units.

Return any uncertainty as a question for the owner; do not infer tax due dates or accounting rules
that are absent from existing configuration and services.
