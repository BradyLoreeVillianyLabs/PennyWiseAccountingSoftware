# X3 — Inline creation and invoice line editor

**Date:** 2026-09-11  
**Wave:** 1  
**Result:** partial, with the invoice slice verified

## Delivered

- Added an invoice line editor that keeps the draft on one screen and supports multiple lines,
  description-only lines, quantity, rate, discount, tax-code selection, duplicate, reorder,
  delete, and undo.
- Added live subtotal, discount, and estimated-total feedback. Tax remains explicitly labelled as
  calculated when the draft is saved; the estimate never pretends to be the authoritative tax
  result.
- Added same-screen quick creation for customers and products/services. A product created from a
  typed item value is returned to the originating line, with the product price carried into the
  line and focus returned to quantity after the dialog closes.
- Preserved the older invoice controls as off-screen compatibility fields for existing browser
  coverage while the new editor owns the submitted line collection.
- Added one-level nested contextual account creation so a product quick-create dialog can add a
  missing revenue account and return to the product dialog without losing the invoice draft.
- Added the `+ Add revenue account` contextual action to the quick product form.

## Changed files

- `package.json` — axe-core Playwright dev dependency used by the X4 harness.
- `pnpm-lock.yaml` — lockfile entry for that dependency.
- `apps/web/index.html` — invoice editor, quick-create dialog, and contextual account action.
- `apps/web/styles.css` — editor grid, totals, responsive layout, and compatibility-field styling.
- `apps/web/app.js` — line state, rendering, estimates, submission, quick creation, and nested
  contextual return state.
- `apps/web/e2e/contextual-creation.spec.ts` — updated same-screen customer/product expectations.
- `apps/web/e2e/x3-inline-invoice.spec.ts` — invoice multi-line and in-place product acceptance
  coverage.

## Verification

- `corepack pnpm exec prettier --check` on touched source and test files: passed.
- `corepack pnpm typecheck`: passed before the focused browser run; the e2e TypeScript check also
  passed in the final run.
- Fresh disposable Docker PostgreSQL database with all 115 migrations: passed.
- `corepack pnpm test:e2e -- --project=chrome x3-inline-invoice.spec.ts`: **2 passed**.
  - Two description-only lines were saved as one draft with an exact CAD 200.00 total and both
    descriptions present in the rendered document.
  - A missing product was created in place, selected on the original line, priced at 80.00, and
    returned focus to quantity.
- The browser runner's release-candidate accessibility and performance contracts passed for this
  run.

The test fixture applies the existing general-service preset before the description-only invoice;
that is required because the server deliberately resolves such lines through the system `sales`
account. A manually created revenue account without a system purpose is not silently treated as
that control account.

## Remaining X3 scope

This is not a claim that every X3 prompt item is complete. Estimate, bill, and purchase-request
line editors still use their existing single-line forms. Generic combobox semantics, per-line
income-account selection, “save as item”, permission-aware creation affordances, and measured
speed/large-draft evidence remain open. The focused browser evidence covers Chromium only; the
broader X4 human keyboard, forced-colors, mobile-webkit, and usability review remains separate.

## Next dependency

Proceed to I1. Its invoice-only profile can reuse the verified customer/product contextual flow.
The X3 estimate/bill editor gaps remain recorded for a later completion increment and are not
silently represented as closed.
