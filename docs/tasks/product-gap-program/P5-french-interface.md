# P5 — A complete French (fr-CA) interface

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Files:** `apps/web/app.js`, `apps/web/index.html`, and the X4 string catalog and message
files. Server error messages shown to users: `apps/api/src` (`AppError` messages) and the
renderers.
**Closes:** G17 (and capability 24 in `COMPETITOR-MATRIX.md`)
**Effort:** L. Deliver it by workspace, "Just invoicing" screens first.
**Depends on:**

- **X4 Part A,** for the string catalog.
- **X1,** for number and date formatting.

Coordinate with I2, which produces French documents.

## Context

- **The interface is English-only.** `app.js` has no French strings or `fr-CA` handling.
  Only `money.js` formats `fr-CA` numbers.
- **QuickBooks is offered in English and French.**
- **Quebec law:**
  - The Charter of the French Language, s.52.1, requires software to be available in
    French unless no French version exists. Any other language version must not be on more
    favourable terms.
  - Invoices and receipts must also be available in French (s.57, handled in I2).
  - Have counsel confirm the obligations for the owner's sales model.
- **The scale is large:** `index.html` is about 390 KB and `app.js` about 918 KB of mostly
  English literals. Extraction must be incremental, and verified.

## Tasks

1. **Pseudo-localization first.** Add a locale that wraps and lengthens every catalog
   string, to find text that isn't in the catalog and layouts that break with longer text.
2. **Extract strings by workspace,** into the X4 catalog, in this order:

   - Home, Sales and invoice, Customers, Payments, Settings;
   - then Purchases, Banking, Reports;
   - then the remaining workspaces.

   This covers static HTML text, `app.js` messages, notices, `aria-label` text and error
   text.

3. **Translate to fr-CA,** reviewed by a fluent reviewer with accounting vocabulary.
   - Keep a glossary: _facture_, _note de crédit_, _comptes clients_, _TPS/TVH_, _TVQ_, and
     so on.
   - Machine translation may draft; it may not ship unreviewed.
4. **Language settings:**
   - **Interface language** is per user: English or Français.
   - **Document language** is per customer (I2, D12).
   - Set `lang` on `<html>` and on any mixed-language fragments.
5. **Formatting** comes from the locale: numbers and currency (X1), dates, and plurals
   (`Intl.PluralRules`).
6. **Server messages:** give user-facing `AppError` messages stable codes, and translate them
   in the client catalog.
7. **Layout:** fix the truncation and overflow that pseudo-localization finds, at 390, 834
   and 1440 px widths.

## Constraints

- **Parity:** the French version has the same features, not a subset.
- **Code:** no string concatenation for sentences; use parameterized messages.
- **Legal text** (terms, privacy) needs professional translation.
- **Accessibility:** screen readers must announce French correctly, which needs the right
  `lang` attributes.

## Acceptance criteria

- **Coverage:** the pseudo-locale run shows no uncatalogued text on the translated
  workspaces.
- **E2E in fr-CA:** the first-invoice and record-payment paths pass.
- **Screenshots** in fr-CA at three widths, with no truncation.
- **Accessibility:** the X4 axe and keyboard checks pass in fr-CA.
- **Glossary** committed, and translation-review sign-off recorded.

## Out of scope

- Languages other than French.
- French marketing materials.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Quality bar:** meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` §6.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
