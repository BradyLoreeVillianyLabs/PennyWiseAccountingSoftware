# D2 Structured addresses and customs attributes — engineering report

Date: 2026-09-01  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Authorization: D2 is the only Destry Workwear deployment phase recorded as active in
`docs/status/CURRENT_PHASE.md`. D3–D6 remain planning artifacts.

## Result

**D2 implementation is complete and its feature acceptance checks pass.** The
structured address model, legacy review path, product customs references, API
validation, import/export portability, and operator-facing readiness reports are
implemented and exercised against PostgreSQL.

The repository-wide format check remains open: it reports 16 files after the two
D2 documentation files were formatted. The remaining warnings include pre-existing
or concurrent files and larger shared files touched by this work; they were not
mass-reformatted to avoid overwriting unrelated changes. This is recorded as a
quality-hygiene exception, not reported as a clean full `pnpm check`.

## Implemented surface

- `packages/db/prisma/schema.prisma` adds `CustomerAddress` with BILLING,
  SHIPPING, and SERVICE roles, one default per role, ISO subdivision/country
  fields, and `needsReview`/`legacyValue` retention. Customer address JSON
  columns are removed; invoice/estimate render snapshots remain intentional
  historical JSON snapshots.
- Migration
  `packages/db/prisma/migrations/20260901100000_d2_structured_addresses_customs/`
  creates the model and RLS policy, backfills billing/service values, normalizes
  legacy AB/WA-style subdivisions, retains unparseable source JSON, and adds
  optional operator-supplied HS tariff and country-of-origin fields to
  `ProductItem`. Its `down.sql` restores the former customer columns and product
  shape.
- `apps/api/src/services/customer-address.ts` centralizes CA/US structural
  validation, ISO normalization, field-level errors, snapshots, and DTO review
  handling. `CustomerService` persists multiple role-aware addresses and exposes
  `GET /v1/customers/reports/address-review` for retained legacy values.
- Product create/update/import/catalog paths persist customs fields. The
  `GET /v1/inventory/reports/customs-readiness` report lists products missing
  either field and states that PennyWise does not classify goods, determine duty,
  or provide tariff advice.
- Spreadsheet imports accept canonical role address columns and customs columns;
  the schema-driven organization export v3 includes the new tenant table and
  columns. Invoice, estimate, and contract snapshots now source structured
  customer addresses.
- Product editor and inventory product forms expose HS tariff code and country of
  origin with the operator-supplied disclaimer.
- `apps/api/src/phase-d2-addresses-customs.integration.test.ts` covers the D2
  workflow end to end.

## Verified evidence

| Check                                         | Result                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2 migration deploy to development database   | Passed: 108 migrations applied/no pending migrations after local migration-history reconciliation                                                                                                                                      |
| D2 migration deploy to isolated test database | Passed: 108 migrations applied                                                                                                                                                                                                         |
| D2 unit validation                            | Passed: 3 address tests in the 40-file/209-test API unit suite                                                                                                                                                                         |
| D2 PostgreSQL integration drill               | Passed: 1 test covering address roles, CA/US validation, review listing, customs readiness, and CSV import                                                                                                                             |
| Full PostgreSQL integration suite             | Passed: 39 files, 233 tests, including D2 and Phase 12 portability/export coverage                                                                                                                                                     |
| Full workspace unit suite                     | Passed: native/script 8, web 6, shared 9, accounting-core 35, API 209                                                                                                                                                                  |
| Typecheck                                     | Passed: root TypeScript and web E2E TypeScript configuration                                                                                                                                                                           |
| ESLint                                        | Passed                                                                                                                                                                                                                                 |
| Prisma schema validation                      | Passed                                                                                                                                                                                                                                 |
| Competitive research baseline                 | Passed: 21 PennyWise module baselines                                                                                                                                                                                                  |
| Web asset verification/build                  | Passed                                                                                                                                                                                                                                 |
| D2 down migration structural proof            | Passed on `clearledger_rollback_verify_d2_20260901`: legacy columns restored, `CustomerAddress` removed, customs columns removed                                                                                                       |
| D2 legacy round-trip proof                    | Passed with seeded malformed `90210` Canadian billing data: `needsReview=true`, original JSON retained, down migration restored `90210:AB`; valid service data normalized to `CA-AB`                                                   |
| Repository-wide `pnpm format:check`           | Open: 16 warnings remain in shared/pre-existing or concurrent files; not claimed as passed                                                                                                                                             |
| Repository-wide rollback verifier             | Open before execution because three pre-existing migrations have no `down.sql`: `20260810100000_pos_cash_refund_integrity`, `20260813100000_workflow_bank_feed_review_toggle`, and `20260813140000_switching_centre_recovery_controls` |

The D2 rollback proof did not use the development or integration databases.
The local development migration metadata was reconciled to the corrected D2
migration checksum before its final `migrate deploy`; no development tables were
reset.

## Boundary and non-claims

D2 validates structure only. It does not perform carrier deliverability checks,
shipping, labels, duty calculation, tariff classification, or tax advice. HS
codes and origin are entered by an operator. D1 clean-machine, reboot, upgrade,
uninstall, Store signing, and real backup/restore evidence remain open and were
not waived by D2 authorization.

Stop here. D3 requires a separate owner authorization in
`docs/status/CURRENT_PHASE.md`.
