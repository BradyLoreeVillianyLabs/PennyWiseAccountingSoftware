# D3 Reviewed order-to-invoice posting - engineering report

Date: 2026-09-02  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Authorization: D3 is the only Destry Workwear deployment phase recorded as active in
`docs/status/CURRENT_PHASE.md`. D4-D6 were not activated or implemented in this
session.

## Result

**D3 engineering implementation is complete and its local acceptance checks pass.**
WooCommerce order evidence can now be preflighted, reviewed, explicitly converted
to one DRAFT invoice, and deliberately posted through the existing invoice workflow.
The connector remains non-posting: synchronization and normalization do not create
accounting records.

## Implemented surface

- `packages/db/prisma/schema.prisma` and migration
  `packages/db/prisma/migrations/20260901120000_d3_commerce_order_conversion/`
  add conversion state, refusal evidence, provider-total snapshots, and a tenant-safe
  two-way inbox-event/invoice link.
- `apps/api/src/services/commerce-order-conversion-service.ts` implements the exact
  preflight contract, supported CAD/USD and open-period checks, approved catalog and
  tax mapping checks, customer policy resolution, D2 structured-address customer
  creation, bigint minor-unit line assembly, zero-tolerance provider-total matching,
  transactional draft creation, audit/outbox records, rejection notes, and event-level
  idempotency under a row lock.
- `apps/api/src/app.ts` exposes:
  `GET .../conversion-preflight`, `POST .../:eventId/convert`, and
  `POST .../batch-convert`. Batch conversion applies the same preflight independently
  and returns a result for every event.
- `apps/api/src/services/invoice-service.ts` marks the linked commerce event `POSTED`
  after the existing invoice posting transaction succeeds. Inventory relief, revenue,
  tax, COGS, balanced journals, and immutability remain in the existing posting path.
- `apps/web/index.html` and `apps/web/app.js` add a commerce inbox review dialog. It
  shows retained provider totals beside the proposed invoice customer, lines,
  quantities, prices, discounts, income accounts, tax codes, tax amounts, and totals.
  The reviewer has separate Confirm and Reject-with-reason actions; Confirm creates a
  draft and never posts it.
- `docs/COMMERCE_CATALOG_OPERATIONS.md` documents the order-to-invoice procedure,
  batch boundary, revision handling, and posting separation. The commerce entry in
  `docs/COMPETITIVE_RESEARCH_MATRIX.md` now reflects the reviewed-draft boundary and
  required evidence.

## Acceptance coverage

`apps/api/src/phase-d3-order-conversion.integration.test.ts` proves:

- a fixture WooCommerce order with approved product/tax/customer configuration
  preflights to exact CAD totals (`19950` total, `950` tax) and creates one DRAFT;
- two concurrent confirmations produce one invoice and one event link;
- deliberate posting produces a balanced immutable journal, weighted-average inventory
  sale movement, and the reverse event status `POSTED`;
- an unmapped order returns named blocking gaps and creates no invoice;
- a rejection records the operator reason and creates no invoice;
- batch conversion returns independent per-event results, converting the ready event and
  refusing the blocked event; and
- a later cancelled revision is surfaced as `ORDER_REVISION_REVIEW_REQUIRED` and does
  not mutate or duplicate the posted invoice.

## Verified evidence

| Check                                      | Result                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused D3 integration                     | Passed: 1 file, 3 tests                                                                                                                                                             |
| Full PostgreSQL integration                | Passed: 40 files, 236 tests against the disposable test database on port 5433                                                                                                       |
| Full workspace unit/general suite          | Passed: 8 native checks, 6 web checks, 9 shared tests, 35 accounting-core tests, and 209 API unit tests                                                                             |
| Root typecheck                             | Passed: `tsc -b` and web E2E TypeScript configuration                                                                                                                               |
| API lint and typecheck                     | Passed with Node heap explicitly set to 8192 MB                                                                                                                                     |
| Prisma schema validation                   | Passed against the disposable development database on port 5432                                                                                                                     |
| Web asset/build verification               | Passed: assets verified and minified web assets built                                                                                                                               |
| Competitive research baseline              | Passed: 21 PennyWise module baselines                                                                                                                                               |
| D3-scoped formatting and JavaScript syntax | Passed for touched HTML/JS/test/docs files; `node --check apps/web/app.js` passed                                                                                                   |
| Repository-wide `format:check`             | Open: 36 warnings remain in pre-existing/shared files, archived `.review-pre-d6d7` snapshots, and generated Prisma output; no broad cleanup was claimed                             |
| Repository root build                      | Open in this working tree: Prisma generation cannot rename the locked `query_engine-windows.dll.node`; the owner processes were not terminated. The standalone web build passed.    |
| Rollback verifier                          | Not run destructively: the safety guard refused the development database before execution. The historical repository exception of three migrations without `down.sql` remains open. |

## External gates and non-claims

No live WooCommerce or Etsy credentials, provider settlement evidence, marketplace
tax/remittance sign-off, clean Windows 11 machine, Store account, Store signing,
reboot/upgrade/uninstall evidence, or real backup/restore evidence was invented or
treated as passed. D1's clean-machine/package lifecycle gates remain open. D2's
repository-format and historical rollback exceptions remain open. D3 does not waive
provider, tax, beta-evidence, production, or app-store gates.

The Prisma client regeneration troubleshooting created a temporary sibling at
`packages/db/generated-client-rebuilt` and a Prisma `.tmp` engine beside the locked
native engine. They are generated artifacts, not source changes; the running owner
processes prevented safe shell cleanup in this session.

## Stop condition

D3 is complete as an engineering phase. Stop here. D4 picking-slip work, D5 shipping
labels, and D6 go-live drills remain outside this session's implementation and require
the next phase authorization to be recorded in `docs/status/CURRENT_PHASE.md` before
work begins.
