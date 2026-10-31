# Phase 16 Customer Experience and Activation - Engineering Completion

## Result

**ENGINEERING IMPLEMENTATION PASSED; RELEASE ACCEPTANCE REMAINS OPEN.**

The owner-facing experience now presents CAD values instead of storage
terminology, keeps exact minor-unit API/storage boundaries, provides activation
and support guidance, and adds opt-in privacy-safe product learning. The
existing top navigation, invoice preview, logo/branding controls, and theme
system remain in place.

## Implemented

- Added one shared `apps/web/money.js` parser/formatter using `BigInt` minor
  arithmetic. It supports English and French Canadian separators, rejects
  ambiguous thousands separators and more than two decimals, and preserves
  signed accountant differences.
- Converted owner-facing product, invoice, payment, purchasing, banking,
  inventory, reconciliation, and journal amount fields to decimal CAD entry.
  API field names remain compatible with the existing minor-unit contract.
- Added a resumable activation checklist with setup-step navigation,
  completion/skip state, progress copy, and activation event hooks.
- Added contextual help articles and a downloadable support diagnostic bundle
  that explicitly excludes customer, invoice, amount, account, organization,
  and authentication data.
- Added an explicit organization-level, owner/admin-controlled opt-in for
  product analytics. Events contain only a random client event id, allowlisted
  event type/version, and timestamp; the API stores them under forced
  organization RLS and rejects pre-consent events.
- Added `/ready`, product-event routes, API OpenAPI entries, and the ProductEvent
  database migration.
- Removed the earlier key-protected cross-organization funnel endpoint. A
  separately credentialed, thresholded offline reporting script is documented
  instead, so the application runtime cannot aggregate tenant telemetry.
- Updated the static web server and verifier to serve the shared money module,
  preventing a bootstrap failure on the local/browser entry path.
- Kept the implementation framework-free and incremental, as required by the
  task: no frontend migration was introduced.

## Evidence

- CAD parser/formatter tests: 3 passing tests covering zero, large values,
  negatives, English/French formatting, comma decimal input, ambiguity, and
  rounding rejection.
- Product analytics service tests: 3 passing tests covering allowlisting,
  timestamp bounds, and invalid events.
- Full repository unit test command: pass (40 API tests, shared/core tests,
  and web/static/money tests).
- Browser release-candidate matrix: 5 passing projects (Chrome, Edge,
  Firefox, mobile Chrome, and mobile WebKit), including the existing owner
  workflow with decimal CAD entry and formatted reconciliation output.
- Formatting, lint, typecheck, API build, web asset build, and database build:
  pass.
- Updated browser release-candidate fixtures to enter decimal CAD values and
  assert formatted invoice/reconciliation output.

## Remaining acceptance evidence

The full Phase 16 acceptance still requires the owner-controlled browser
matrix at desktop and 390px, keyboard/screen-reader/200% zoom/reduced-motion,
all-theme and print review, five representative owner tasks, analytics opt-out
verification in the deployed environment, and Phase 15 production acceptance.
Those checks require the real browser/provider environment and cannot be
honestly marked complete from this local repository run alone.

## 2026-08-09 privacy hardening amendment

The original local/member analytics wording and internal funnel endpoint were
superseded. Consent is now organization-scoped, the owner/admin withdrawal
deletes non-authoritative telemetry, and legacy telemetry without provable
organization-level consent is purged. See `../PRODUCT_ANALYTICS_PRIVACY.md`.
This is an intentionally irreversible data-classification transition; it does
not affect posted accounting history.
