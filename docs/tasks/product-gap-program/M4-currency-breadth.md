# M4 — Currencies beyond CAD/USD

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `currency-workflow-policy.ts`: `45-50`
- `multi-currency-release-gate.ts`: `10-16`
- `multi-currency-service.ts`: `125`
- `connectors/commerce-normalization.ts`: `956`
- `commerce-order-conversion-service.ts`: `426`
- `packages/accounting-core`
- `apps/web/money.js`
- `apps/web/index.html`: `2208-2212`
- `packages/db/prisma/schema.prisma`, plus a migration

**Closes:** the M4 row in `ASSESSMENT.md` section 4
**Effort:** L
**Depends on:** M1, M2 and M3. Adding currencies multiplies every correction and banking
surface, so close those first. The X1 money formatter must land first.

## Context

- **The CAD/USD pair is hard-coded in several places:**
  - `currency-workflow-policy.ts:45-50`
  - `multi-currency-release-gate.ts:10-16`
  - `CURRENCY_NOT_RELEASED` in `multi-currency-service.ts:125`,
    `commerce-normalization.ts:956` and `commerce-order-conversion-service.ts:426`
- **The UI offers only these two.** The customer form's currency select offers only CAD
  and USD (`index.html:2208-2212`).
- **Commerce orders in other currencies are refused.** WooCommerce and Etsy stores selling
  in EUR or GBP are rejected at normalization.

## Tasks

1. **Audit minor-unit handling first, and report what you find before changing anything.**
   - Search `packages/accounting-core`, `apps/web/money.js`, the invoice renderer and the
     CSV/PDF formatters for two-decimal assumptions: `/ 100`, `toFixed(2)`, regexes
     allowing exactly two decimals, `100n`.
   - Every hit must become exponent-driven.
2. **ISO 4217 catalogue:** code, minor-unit exponent (0, 2 or 3), symbol, and display name.
   - Organizations can enable any catalogue currency against their base currency.
   - Cross-currency documents between two non-base currencies stay refused unless
     triangulation is explicitly designed. Record that in the ADR.
3. **Generalize the gates.** Replace the pair checks with "enabled currency plus a
   purpose- and date-matched rate to base". Keep every existing fail-closed rule for
   corrections that M1 and M2 haven't generalized.
4. **Rate sources:**
   - The Bank of Canada Valet API covers many currencies against CAD. Verify which series
     exist, and map each supported currency to its series.
   - For organizations whose base isn't CAD, the rate source is an **owner decision**.
     Leave it manual-only until one is chosen.
5. **Commerce:** allow the enabled currencies through normalization and order conversion,
   using the same rate rules.
6. **UI:**
   - Currency selectors list the organization's enabled currencies.
   - Amounts render through the X1 formatter, which uses `Intl.NumberFormat` with an
     explicit currency. The exponent and symbol come from the currency itself.
7. **Parameterize the existing CAD/USD test suites** over currencies with exponent 0
   (JPY), 2 (EUR, GBP) and 3 (KWD or BHD), at least for invoice, payment, revaluation and
   reversal.

## Constraints

- **Exact arithmetic.** Rounding at each exponent must follow a documented rule. No
  floating point anywhere.
- **Existing CAD/USD evidence stays valid.** Do not rewrite historical rates or positions.
- **Rollback refusal** after foreign adoption stays in force.

## Acceptance criteria

- **Audit report:** the audit lists every two-decimal assumption found, and each one is
  fixed or justified.
- **Exponent coverage:** a JPY invoice (exponent 0) and a KWD invoice (exponent 3) each post,
  get paid, revalue and reverse correctly (golden fixtures).
- **Commerce:** a EUR WooCommerce fixture order normalizes and converts once EUR is
  enabled, and is refused while it's disabled.
- **UI:** the customer form lists enabled currencies only.
- **Regression:** all existing CAD/USD tests pass unchanged.

## Out of scope

- Crypto assets.
- Triangulated cross-rates.
- Paid rate providers.

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
