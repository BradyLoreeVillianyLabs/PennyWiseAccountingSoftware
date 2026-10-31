# X1 — One money formatter, dual-amount views, and in-context currency and rate choices

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `apps/web/money.js` and `money.test.mjs`
- `apps/web/app.js`: every `formatMinor` call site, plus the currency controls in the
  invoice, estimate, bill and customer forms
- `apps/web/index.html`, `apps/web/styles.css`
- `apps/api/src/services/invoice-render-service.ts`: document money formatting
- The report CSV export code (read it first; change it only if it emits symbols)
- `multi-currency-service.ts` and `bank-of-canada-rate-service.ts`, for the inline rate
  (API only if needed)

**Closes:** decisions D1–D3 and the on-document part of D4 in
`DECISIONS-currency-reporting-workflow.md`
**Effort:** M
**Depends on:** nothing. M3 and M4 build on it.

## Context

- **One format everywhere.** `formatMinor` prints `CAD 1,234.56` for all amounts, with two
  decimals hard-coded (`money.js:1-31`).
- **This is noisy for single-currency businesses,** such as the invoice-only client. It also
  can't handle JPY (0 decimals) or KWD (3 decimals).
- **`Intl.NumberFormat` already solves the display question.** Checked locally with Node:
  - en-CA shows `$1,234.56` for CAD, `US$1,234.56` for USD, and `JP¥1,235` for JPY.
  - fr-CA shows `1 234,56 $` and `1 234,56 $ US`.
  - en-US shows `CA$` for CAD.
- **A bare `$` is ambiguous between Canada and the US.** Customer documents must therefore
  use ISO codes.
- **Foreign documents need a rate prepared elsewhere.** A foreign invoice requires a rate
  snapshot for the exact document date, created beforehand in settings
  (`currency-workflow-policy.ts:71-98`). The Bank of Canada suggestion exists only in
  settings.
- **Enabling is a separate settings step.** CAD/USD must be switched on in settings before
  USD can be chosen on a customer or document.

## Tasks

1. **Build one formatter:** `formatMoney(minor, currency, { context, locale })`.
   - **Money stays exact.** Build the decimal string from BigInt minor units using the
     currency's exponent. Get the exponent from
     `Intl.NumberFormat(..).resolvedOptions().maximumFractionDigits`, or from a table shared
     with the server.
   - **Pass a string to `Intl.NumberFormat.format`,** not a Number. Check support in the
     browsers the product targets and in the bundled Node runtime. Provide an exact fallback
     for engines without string support.
   - **Three contexts:**
     - `app`: `currencyDisplay: "symbol"` in the organization locale.
     - `document`: `currencyDisplay: "code"` in the document language.
     - `export`: a plain decimal, no grouping, with `.` as the separator.
   - **Keep `formatMinor` as a thin wrapper** during migration. Migrate every call site, and
     report the count.
2. **Customer documents** (PDF, HTML preview, public page, email bodies):
   - money column headers carry the code ("Amount (USD)");
   - totals and amount due use the `document` context;
   - never a bare symbol;
   - _(added in review)_ the `document` context formats numbers in the **document's
     language**, English or French (see I2 and D12), not the owner's screen locale.
     Existing issued documents keep their render snapshots.
3. **Mixed-currency tables** in the app:
   - add a currency (ISO) column;
   - right-align with `font-variant-numeric: tabular-nums`;
   - **never sum across currencies.** Totals go per currency, or in base using the stored
     base amounts.
4. **Dual-amount component** for documents, bank accounts and lists:
   - the primary amount in the document or account currency;
   - the secondary base amount, muted, below or beside it;
   - the word "Booked" for posted exact values, and `≈` (accessible name "approximately")
     for estimates. _(Changed in review: a bare `=` reads as arithmetic, and screen
     readers say "equals".)_
   - a popover showing the rate, rate date, source, and a link to the rate record. It must
     be keyboard-reachable and have an accessible name.
5. **Lists:** add an optional "Base amount" column to invoice and bill lists. It is on by
   default once multi-currency is enabled.
6. **Enable in context.** Choosing a non-base currency on a customer or document, before
   multi-currency is enabled, opens a dialog that explains the effect and enables it on
   confirmation.
   - Enabling must be reversible until the first foreign document posts. Check the current
     server rules and the rollback-refusal migration. If the server blocks reversal earlier,
     report it rather than changing accounting rules.
7. **Inline rate on foreign documents.** Show the suggested Bank of Canada observation for
   the document date: the latest published on or before it, with its observation date.
   - Offer **"Use this rate"**, which creates the TRANSACTION rate snapshot with provenance
     through the existing API and selects it.
   - Manual entry with a source note stays available.
   - Weekends and holidays are labelled.
   - Nothing is applied without the click.
8. **Fix the wrong-currency price prefill (G13).** _(Citation corrected in review.)_
   - The invoice form fills "Unit price (invoice currency)" with the selected product's
     base-currency price, whatever the invoice currency (`app.js:8060-8062`).
   - A second form does the same (`app.js:8080-8082`).
   - A foreign-currency document must not silently reuse the base-currency price. Leave it blank with the base price shown as a hint, or convert at the
     accepted rate with a visible note. Choose one approach, and document it.
9. **Accessibility:**
   - Amounts expose readable text; for example, add an accessible name that expands codes to
     currency names where needed.
   - Negative values are never shown by colour alone.

## Constraints

- **Server calculation stays authoritative.** The formatter is display only.
- **Money never passes through JavaScript `number`.**
- **Posted history is untouched.** No change to rates, positions or journals.
- **Documents already issued keep their checksums.**

## Acceptance criteria

- **Formatter unit tests:** en-CA, fr-CA and en-US × CAD, USD, EUR, JPY and KWD × the
  `app`, `document` and `export` contexts. Include very large values (above 2^53 minor
  units) and negatives.
- **Single-currency view:** a CAD-only company sees `$` amounts throughout the app.
- **Mixed view:** a CAD company with USD documents sees `US$` for those documents, and a
  currency column in mixed lists.
- **Documents:** a USD invoice PDF shows "Amount (USD)" headers and `USD` totals, with no
  bare `$`.
- **Inline rate (e2e):** create a USD invoice → "Use this rate" → the snapshot is created and
  selected → save → post. No settings detour is needed.
- **Enable in context (e2e):** choosing USD on a new customer enables multi-currency after
  confirmation.
- **Exports:** the CSV has numeric columns without symbols, plus a currency column.

## Out of scope

- New currencies (M4).
- Report layouts (X2).
- Aging and statement data changes (M3).

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
