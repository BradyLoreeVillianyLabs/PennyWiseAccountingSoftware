# PennyWise Accounting UI quality bar

This document defines the measurable interface checks for the product-gap program. Automated
checks cover common regressions; they do not establish WCAG conformance by themselves. Human
usability and assistive-technology acceptance remain separate release evidence.

## Required behaviour

- Meet WCAG 2.2 A and AA requirements that apply to the interface, including focus visibility,
  target size, consistent help, redundant-entry reduction, and accessible authentication.
- Complete the supported workflows with a keyboard. Focus order must follow the task, Escape
  closes an open dialog or panel, and no task depends on drag or colour alone.
- Keep the page usable at 320 CSS pixels and 400% zoom. Tables may scroll inside their own
  container when the data requires it; the page itself must not gain two-dimensional scrolling.
- Keep controls visible and states understandable in Windows forced-colors mode. Honour reduced
  motion preferences and provide a 44px target on touch-oriented layouts.
- Measure lab interaction timing for invoice typing, report opening, and list filtering. The
  200ms threshold is a lab budget; it is not a population p75 INP claim.
- Use plain-language errors that say what happened, why it happened, and what the person can do
  next. Explain accounting terms in place where a new owner needs the context.

## Running the checks

From `C:\Users\EmceeHax\Desktop\clearledger-src`, provide a fresh disposable database whose
name matches the repository test guard and run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @clearledger/db run migrate:deploy
corepack pnpm --filter @clearledger/web run build
corepack pnpm test:e2e -- apps/web/e2e/accessibility-quality.spec.ts
corepack pnpm test:e2e -- apps/web/e2e/keyboard-workflows.spec.ts
corepack pnpm test:e2e -- apps/web/e2e/viewport-quality.spec.ts
corepack pnpm test:e2e -- apps/web/e2e/target-size-quality.spec.ts
corepack pnpm test:e2e -- apps/web/e2e/inp-lab-quality.spec.ts
```

The browser runner owns isolated ports, applies migrations, checks that the database is empty,
builds the served web assets, and stops its child processes. The axe baseline lives at
`apps/web/e2e/fixtures/axe-baseline.json`. To intentionally record a new baseline after a
reviewed screen change, run the accessibility spec with `AXE_UPDATE_BASELINE=true`, inspect the
attached raw JSON, and document each retained fingerprint with its screen, owner, reason, and
review date. All axe rules remain enabled.

The viewport spec attaches screenshots at 390, 834, and 1440px and in forced-colors mode. The
target-size spec attaches a complete list of visible controls below 24px in either dimension.
The INP spec attaches browser and sample data. Unsupported Event Timing APIs are recorded as
unavailable instead of being presented as a passing measurement.

## Error-message style

Write errors as a short sentence in the user's terms. Include the failed action, the reason when
known, and the next safe action. Do not expose stack traces, database identifiers, credentials,
or provider payloads. Keep financial failures fail-closed and explain whether anything was
posted or saved.

## Glossary tips

Use a short in-place explanation beside the first unfamiliar accounting term in an owner flow.
The explanation must remain available to keyboard and screen-reader users, use ordinary text,
and avoid changing the underlying accounting meaning. Do not hide a required review behind a
tooltip.

## String catalog

New or changed interface text goes through `apps/web/strings.js` and a stable key. The current
catalog is English Canadian and is deliberately ready for the later `fr-CA` translation work.
The invoice workspace is the first migrated surface; later prompts must extend the same catalog
instead of adding a second translation mechanism.

## Human acceptance

For every wave that changes owner screens, conduct a moderated round with five affected
owner-operators and include a keyboard-only or screen-reader participant. Run the same task
script with NVDA plus Chrome or Edge on Windows; use VoiceOver plus Safari for phone work. Record
success rate, time on task, errors, and anonymized observations. Severe findings are fixed before
the next wave. Automated evidence must never invent participants, quotes, or assistive-technology
results.

## Change management

Interface changes follow the D11 policy: opt in before a broad redesign, measure the affected
workflow, preserve a clear way back, and keep required accounting controls visible. A passing
axe scan is not permission to remove a user control or to claim that the product serves every
persona.
