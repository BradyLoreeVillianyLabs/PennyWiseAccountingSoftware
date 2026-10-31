# Phase 16 Codex Task — Customer Experience and Activation

Execute only after Phase 15 acceptance and explicit owner authorization.

## Required reading

Read the repository instruction hierarchy, task execution standard, product
requirements, current phase, Phase 15 completion report, accessibility and UAT
evidence, and this directory's roadmap.

## Objective

Let a non-accountant create an organization, finish setup, create and preview an
invoice, and understand the dashboard without seeing storage terminology such
as "minor units" or needing accounting knowledge. Preserve exact minor-unit
storage and all accountant detail behind the presentation layer.

## Requirements

### Shared experience foundation

- Add one locale-aware money input/display component and server boundary parser.
  Users enter `123.45`; APIs continue to exchange decimal-string minor units.
  Reject ambiguity and never use floating point for accounting arithmetic.
- Add shared page headers, section headers, field help, validation summaries,
  loading/empty/error/success states, confirmation patterns, and accessible
  focus management.
- Preserve the top navigation requested by the owner. Make every primary
  Business and Accountant section reachable with clear active state, keyboard
  support, responsive overflow, and no loss of deep links.
- Apply the existing theme system consistently. Meet WCAG 2.2 AA contrast in
  every theme and in PDF/print previews.

### Guided activation

- Build a resumable activation checklist: organization, tax, opening data,
  branding, customer, item, invoice preview, send/test payment, bank import, and
  accountant invitation.
- Explain consequences before irreversible or posting actions. Show plain
  language first and optional accounting detail second.
- Add safe sample/demo data in a disposable organization only. Never mix it with
  live books.
- Add contextual help, searchable help centre, first-run tours that can be
  dismissed, support escalation with a redacted diagnostic bundle, and clear
  recovery paths for common errors.

### Product learning

- Add consent-aware, organization-pseudonymous product events for activation,
  time-to-first-invoice, workflow completion, error codes, feature use, and
  reconciliation retention.
- Do not collect amounts, names, addresses, invoice content, account names,
  uploaded documents, or other financial/customer content.
- Add an internal aggregate funnel view with minimum cohort thresholds so it
  cannot expose a single organization.

## Efficiency constraints

Do not migrate the frontend framework solely for this phase. Extract reusable
components incrementally from current HTML/CSS/JavaScript. Use one formatting
and validation path everywhere; remove duplicated presentation helpers only
after equivalence tests pass.

## Tests and acceptance

- Unit and property tests for parsing/formatting CAD amounts, negatives, zero,
  large values, rounding rejection, and French/English separators.
- Browser tests for the entire 15-minute activation path at desktop and 390px.
- Keyboard-only, screen-reader labels, zoom/reflow, contrast, reduced-motion,
  print, and all-theme visual regression tests.
- Tests proving raw minor units remain in API/storage but never appear in owner
  UI, public invoice/payment UI, or ordinary validation errors.
- Analytics privacy schema tests and opt-out tests.

Acceptance requires five representative owner tasks to be understandable
without accounting instruction, no critical accessibility issue, no raw
storage terminology in customer-facing surfaces, and preserved ledger/report
results.

Write the Phase 16 completion report, update current phase, and stop.
