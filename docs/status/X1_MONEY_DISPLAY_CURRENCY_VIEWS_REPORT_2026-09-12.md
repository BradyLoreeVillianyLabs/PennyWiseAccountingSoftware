# X1 money display and currency views — completion report

Date: 2026-09-12  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`

## Outcome

X1 is implemented in source and locally verified. The web app now has one exact
minor-unit formatter with separate screen, customer-document, and export contexts;
invoice documents identify every monetary column with the ISO currency code; mixed
invoice and bill lists expose currency and base-amount columns; and a user can enable
CAD/USD from the invoice or customer context after an explicit confirmation.

The invoice composer also has an inline Bank of Canada suggestion path. The suggestion
is preview-only until **Use this rate** is clicked; that action creates the existing
manual, provenance-bearing transaction snapshot and selects it on the invoice. No
provider key or sign-up is required. The API remains authoritative for calculation and
posting.

## Changed files

- `apps/web/money.js`, `apps/web/money.test.mjs` — BigInt decimal construction,
  CAD/USD/EUR/GBP/JPY/KWD exponents, app/document/export contexts, negatives and large
  values.
- `apps/web/app.js` — currency-aware lists and reports, plain-decimal visible-table
  CSV export, in-context enablement, inline rate suggestion/use flow, response-order
  protection for multi-currency settings, and foreign-product price hints.
- `apps/web/index.html`, `apps/web/styles.css` — inline rate controls, currency/base
  amount list headers, money alignment, and screen-format defaults.
- `apps/web/e2e/x1-currency-views.spec.ts` — fresh-database Chromium Playwright
  acceptance flow, mocked Bank of Canada suggestion, real rate-snapshot POST, and
  screenshots at desktop and mobile widths.
- `apps/api/src/services/invoice-render-service.ts` — exact locale-aware document
  formatting and ISO-coded PDF/HTML monetary headers.
- `apps/api/src/invoice-documents.test.ts` — updated document assertions for the
  explicit ISO-code output.
- `docs/COMPETITOR-MATRIX.md`, `docs/COMPETITIVE_RESEARCH_MATRIX.md`, and this report
  — status and evidence boundaries.

## Verification

- Web money unit tests: 3/3 passed.
- Web package tests: 7/7 passed.
- Focused invoice document tests: 14/14 passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- Web asset verification/build: passed.
- Playwright fallback (Browser plugin unavailable): X1 Chromium flow passed 1/1;
  Edge, Firefox, and WebKit projects were skipped by the spec. The flow created a
  fresh company, opened Sales, selected USD, confirmed in-context enablement, mocked
  the no-key Bank of Canada suggestion, clicked **Use this rate**, and verified that a
  real transaction rate snapshot was selected. Accessibility and performance release
  contracts passed in the same runner. The run captured desktop and mobile screenshots;
  no human or assistive-technology acceptance is claimed.

## Accounting and release boundaries

The foreign product-price fix deliberately leaves the invoice-currency price blank and
shows the base-currency catalog price as a hint. It never silently converts or reuses a
CAD price. Existing issued-document snapshots and posting rules were not changed.

The frozen `0.14.0.15` installer and prior `0.14.0.17` transfer candidate were not
modified. A new `0.14.0.18` participant-05 installer is now prepared; see the
[install-candidate report](X1_INSTALL_CANDIDATE_REPORT_2026-09-12.md) for its
hash and verification boundary. External Bank of Canada availability,
clean-machine install, real provider settlement, accountant review, and human
accessibility review remain separate evidence gates.

## Next

Continue to X2 only after the root checks and new candidate packaging are recorded.
M1/M2/M3/M4 remain dependency-ordered; X1 does not authorize new accounting policy,
new currencies, or a change to the frozen package.
