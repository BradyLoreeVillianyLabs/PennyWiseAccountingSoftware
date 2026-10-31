# H1 fulfilment operator UI — engineering report

Date: 2026-09-05  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Authorization: H1 was recorded as the sole active phase in
`docs/status/CURRENT_PHASE.md` before implementation. H2-H4 remain planning
artifacts and are not authorized by this report.

## Result

**H1 is complete as a local engineering increment.** The Orders & fulfilment
workspace now takes a reviewed fixture order through draft conversion, explicit
invoice posting, picking, shipment creation, carrier quote, one confirmed
shipping-expense purchase, and carrier void. The queue derives converted,
picked, shipped, and post-void progression from the existing invoice, picking,
and shipment records. No API endpoint, database column, migration, dependency,
or live-provider credential was added.

## Implemented surface

- `apps/web/index.html` and `apps/web/app.js` keep the complete daily loop in
  one workspace: order evidence and line items, preflight gaps, review,
  draft conversion, explicit invoice posting, picking-slip creation/reprint,
  short-pick quantities for every line, shipment draft creation, quote,
  purchase, label retrieval, tracking refresh, and void.
- The purchase form requires the exact carrier quote, postage expense account,
  paying account, payment method, and date. Its confirmation names the amount,
  accounts, method, date, carrier call, and the single immediate expense. The
  purchase request sends `confirmed: true` and the required quoted values.
- Picking, picking-slip PDF retrieval, label retrieval, tracking, and void are
  visibly non-posting. Carrier absence, inactive accounts, unavailable reads,
  provider errors, and draft-invoice prerequisites have explicit states.
- `apps/web/styles.css` contains one dedicated fulfilment section with keyboard
  focus, 44px controls, responsive tables/forms, and the five required viewport
  bands.
- `docs/COMPETITIVE_RESEARCH_MATRIX.md` records commerce and shipping
  interaction contracts, including the single shipping posting action and the
  review-only conversion boundary.
- `apps/web/e2e/fulfilment-review-boundary.spec.ts` retains the negative
  review-boundary assertion. New `apps/web/e2e/fulfilment-happy-path.spec.ts`
  covers the full fixture path and the required viewport overflow checks.
- `eslint.config.js` and `tsconfig.eslint.json` exclude all generated Prisma
  client trees, including the active D5 clients. This keeps generated
  declarations out of source lint/typecheck without changing application code.

## Verified evidence

| Check                            | Result                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh-database Playwright suite  | **Passed: 3 tests.** Review boundary, full order → posted invoice → picking → purchased label → void, and the five viewport layout check. |
| Playwright release contracts     | **Passed:** accessibility and performance contracts from `run-browser-tests.mjs`.                                                         |
| D3 order-conversion integration  | **Passed: 3 tests.**                                                                                                                      |
| D4 picking-slip integration      | **Passed: 3 tests.**                                                                                                                      |
| D5 shipping integration          | **Passed: 3 tests.** Quote, explicit purchase, label/tracking/void, expense/inventory linkage, timeout recovery, and customs refusal.     |
| Web unit tests                   | **Passed: 6 tests.**                                                                                                                      |
| Web build and asset verification | **Passed.**                                                                                                                               |
| Root lint                        | **Passed:** `corepack pnpm lint`.                                                                                                         |
| Root typecheck                   | **Passed:** repository build/typecheck and web E2E TypeScript configuration.                                                              |
| Research verifier                | **Passed:** 21 module baselines.                                                                                                          |
| Database setup                   | **Passed:** Prisma client generated; 112 migrations deployed to the development database with no pending migrations.                      |

The isolated browser run used the dedicated `clearledger_test` database on the
test PostgreSQL service at port 5433. It was recreated between attempts after
the repository's Prisma reset fallback failed on a pre-existing policy
dependency; the development database at port 5432 was not reset.

## Known limitations and external gates

- The UI reloads a previously created shipment through its ID retained in
  browser session state because the existing API has no tenant-scoped shipment
  list/source query. A future API increment may provide durable shipment
  discovery; H1 does not invent that endpoint.
- No live WooCommerce/store, carrier, tax, Store-signing, clean-machine,
  physical-printer, or non-developer accessibility/UAT evidence was claimed.
  D6's real-store, lifecycle, restore, physical-device, signing, and owner
  acceptance gates remain open.
- The fixture purchase is local test behavior only; no real postage account was
  contacted. Live carrier acceptance remains governed by D5/D6 evidence.

## Stop condition

H1 engineering work stops here. H2 package acceptance, H3 first-run/migration,
and H4 handoff kit work require their own active-phase authorization and must
consume the evidence in this report plus the existing D6 report. No provider,
tax, Store, or production gate is waived.
