# D5 shipping labels — engineering report

Date: 2026-09-02  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Authorization: D5 was recorded as the sole active Destry Workwear deployment phase
in `docs/status/CURRENT_PHASE.md`. D6 was separately authorized after this work
started and remains the next phase; this report does not claim D6 acceptance.

## Result

**D5 engineering implementation is complete and the local automated acceptance set
passes.** PennyWise can quote and explicitly purchase a label through a neutral
carrier boundary, persist PDF or ZPL label data, track and record carrier-governed
void attempts, require operator-supplied cross-border customs data, and post the
operator's shipping cost through the existing expense workflow. PennyWise never
buys, holds, transfers, or refunds postage money.

## Implemented surface

- `packages/db/prisma/schema.prisma` and migrations
  `20260902140000_d5_shipping_labels` and
  `20260902140500_d5_shipping_inventory_links` add organization-scoped carrier
  accounts, shipments, parcels, labels, tracking events, void attempts, and
  shipment-linked inventory movement evidence. The migrations are applied on both
  local PostgreSQL databases with 112 migrations and no pending migrations.
- `apps/api/src/services/shipping/carrier-adapter.ts` defines the neutral adapter
  contract and a complete fixture carrier with quote, purchase, timeout-after-
  persistence, invalid-credential, quote-failure, purchase-failure, void,
  ambiguous-void, and tracking outcomes. It also contains the Canada Post HTTP/OAuth
  boundary; credentials are required and no request is made without them.
- `apps/api/src/services/shipping/shipping-service.ts` implements credential
  protection, shipment creation from invoices/POS sales, explicit quote and
  purchase confirmation, timeout reconciliation before retry, PDF/ZPL persistence,
  browser retrieval, tracking, void-attempt evidence, customs refusal, inventory
  linkage, and existing immediate-expense posting. An expense-posting failure is
  retained as `PURCHASED_EXPENSE_PENDING` for operator recovery.
- `apps/api/src/http/shipping-schemas.ts`, `shipping-routes.ts`, `app.ts`,
  `openapi.ts`, and `auth/permissions.ts` expose the scoped carrier-account,
  shipment, quote, purchase, label, tracking, and void operations. Purchase is
  always an explicit operator action.
- `docs/SHIPPING_CARRIER_OPERATIONS.md`,
  `docs/COMPETITIVE_RESEARCH_MATRIX.md`, `docs/SECURITY_AND_COMPLIANCE.md`, and
  `docs/DEVELOPER_API_V1.md` document the credential, printing, customs, recovery,
  and provider boundaries. The research verifier continues to pass all 21 module
  baselines.

The runtime keeps the checked-in legacy Prisma namespace for the established
application type surface while using the D5-generated client for database execution.
Explicit raw-query fragments use the matching D5 runtime helper, and the runtime
known-request error constructor is aligned so existing conflict classifiers retain
their intended 409 responses.

## Verified evidence

| Check                             | Result                                                                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture carrier adapter suite     | **Passed: 9 tests.** Covers complete PDF/ZPL flow and every documented fixture failure/recovery mode.                                                                                                                                                    |
| D5 PostgreSQL integration         | **Passed: 3 tests.** Covers quote → explicit purchase → label retrieval → tracking → void, one-label timeout reconciliation, linked expense/journal/inventory evidence, and customs refusal before carrier quote.                                        |
| Full PostgreSQL integration       | **Passed: 42 files, 242 tests.** Includes D2, D3, D4, D5, and all prior concurrency/tenant/accounting suites.                                                                                                                                            |
| Full workspace unit/general suite | **Passed:** native 8, web 6, shared 9, accounting-core 35, API 220 tests.                                                                                                                                                                                |
| Root typecheck                    | **Passed:** `tsc -b` and web E2E TypeScript configuration.                                                                                                                                                                                               |
| Database schema validation        | **Passed:** `prisma validate`; dev/test migration deployment reports no pending migrations.                                                                                                                                                              |
| Source-only lint                  | **Passed** with generated Prisma output and archived review snapshot excluded.                                                                                                                                                                           |
| Research verifier                 | **Passed:** `corepack pnpm test:research`; 21 PennyWise module baselines.                                                                                                                                                                                |
| Repository-wide format check      | **Open:** 13 pre-existing/shared files and `pnpm-lock.yaml` report formatting warnings. D5-touched source and documentation files are formatted; no unrelated broad cleanup was claimed.                                                                 |
| Normal Prisma generate            | **Open in this Windows session:** Prisma cannot rename the locked native `query_engine-windows.dll.node` (`EPERM`). A separately generated `packages/db/generated-client-d5` client was created for D5 verification without terminating owner processes. |

## External and manual gates

The Canada Post adapter is implemented against its documented OAuth/rating/shipping
boundary, but no operator-owned Canada Post sandbox credentials were supplied.
Live Canada Post credential validation, quote, purchase, PDF/ZPL delivery, void, and
tracking are therefore **not verified**. No live capability is claimed. USPS and
FedEx are not implemented in D5; their future adapters must implement the same
neutral interface and receive separate provider evidence.

Browser printing is locally verified by stored label retrieval and remains an
operator action. A physical printer/thermal ZPL device, clean Windows lifecycle,
Microsoft Store signing, human UAT/accessibility, tax/provider acceptance, and
production backup/restore evidence remain outside this report and remain gated by
D1–D4 or D6 requirements.

## Operator boundary

Before a real connection, an owner must provide the carrier account, store it only
through the encrypted connector secret, confirm the carrier service and quoted cost,
review declared values and customs data as the declarant, and handle any void or
expense-pending reconciliation. Carrier postage is billed directly to that carrier
account. Credentials, labels containing live business data, and provider responses
must not be placed in logs, fixtures, screenshots, exports, or unapproved backups.

## Stop condition

D5 is complete as an engineering phase. The next authorized phase is D6, whose
separate report must distinguish automated evidence from unavailable disposable-
machine, live-store, physical-device, and non-developer human acceptance evidence.
