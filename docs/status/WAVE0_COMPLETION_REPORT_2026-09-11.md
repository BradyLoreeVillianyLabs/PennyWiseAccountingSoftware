# Product-gap Wave 0 completion report - 2026-09-11

Prompt: X4 Part A - inclusive UI quality bar
Result: complete for the automated Part A; human acceptance remains open.

## Changed files

- `package.json`, `pnpm-lock.yaml`
- `apps/web/app.js`, `apps/web/index.html`, `apps/web/package.json`,
  `apps/web/strings.js`, `apps/web/strings.test.mjs`
- `apps/web/e2e/quality-workspace.ts`, `accessibility-utils.ts`,
  `accessibility-quality.spec.ts`, `keyboard-workflows.spec.ts`,
  `viewport-quality.spec.ts`, `target-size-quality.spec.ts`,
  `inp-lab-quality.spec.ts`, and `fixtures/axe-baseline.json`
- `docs/pennywise/UI_QUALITY_BAR.md`
- `docs/COMPETITIVE_RESEARCH_MATRIX.md`
- `docs/status/WAVE0_AXE_BASELINE_2026-09-11.md`
- Product-gap reconciliation and handoff documents, plus the active-phase record.

## What shipped in source

- A small English-Canadian string catalog is now used by the invoice workspace and
  service-error notices, with unit coverage and a fallback test.
- The existing invoice renderer now exposes a keyboard-reachable credit-note action.
  It creates and posts a full credit through the existing API and refreshes sales and
  payment projections. It does not move money.
- Journal reports expose keyboard-reachable detail links to the existing accountant
  trace endpoint.
- Axe scans run with all rules enabled and reject new serious or critical fingerprints.
  The checked-in baseline records two pre-existing serious colour-contrast findings;
  it is not a WCAG conformance claim.
- Viewport/reflow, forced-colour, target-size, lab interaction timing, and five
  keyboard workflows are automated. The target-size report keeps all small controls
  as evidence while asserting the critical invoice/new-menu controls are not below
  the measured minimum.

## Quality gate

- `corepack pnpm format:check` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm typecheck` passed, including the browser e2e TypeScript project.
- `corepack pnpm test` passed: 18 native/root tests, 7 web tests, 9 shared tests,
  35 accounting-core tests, and 267 API tests (336 total).
- `corepack pnpm test:research` passed.
- Web asset verification and production bundle build passed.
- Fresh-database browser runner: the focused Chromium keyboard suite passed 5/5:
  first invoice, manual payment, credit note, bank match, and journal detail.
  The target-size spec also passed on a fresh database. The runner's release
  accessibility and performance contracts passed after each run.

## Not run / not verifiable locally

- Moderated usability sessions, NVDA/Chrome, and VoiceOver/Safari were not run.
  No participants, quotes, or assistive-technology results are claimed.
- Human review of the attached screenshots remains an acceptance gate.
- The remaining axe contrast findings are intentionally tracked for a later web-UI
  pass and do not permit an accessibility-conformance claim.

## Open issues and follow-ups

- Run the human X4 acceptance round before the affected Wave 1 exit gate.
- Continue shrinking the axe baseline rather than adding exceptions.
- Keep installer 0.14.0.15 and its USB transfer folder frozen; no packaging was done
  in Wave 0.
