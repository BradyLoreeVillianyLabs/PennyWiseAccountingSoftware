# D4 Picking slips and product images - engineering report

Date: 2026-09-02  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Authorization: D4 is the only Destry Workwear deployment phase recorded as active in
`docs/status/CURRENT_PHASE.md`. D5-D6 were not activated by this report.

## Result

**D4 engineering implementation is complete and its focused and full local acceptance
checks pass.** PennyWise can create a bin-ordered operational picking slip from a
posted invoice or completed POS sale, render it as a local PDF, reprint it with a
traceable generation, use approved or manually uploaded local product thumbnails, and
record short picks as count-review work without changing stock or posting accounting.

## Implemented surface

- `packages/db/prisma/schema.prisma` and migration
  `packages/db/prisma/migrations/20260902100000_d4_picking_slips_and_product_images/`
  add tenant-scoped product image assets, picking slips/lines/generations, image-source
  and slip-status enums, and the link from short-pick inventory counts.
- `apps/api/src/services/product-image-service.ts` completes approved catalog ingestion
  and manual image upload. Both paths validate type, 5 MiB size, 4,096-pixel axes, and
  16,777,216 total pixels, then store only a local JPEG thumbnail (maximum 1,600 px).
  Catalog ingestion is approval-gated, URL-hash idempotent, and records the local
  product reference; failed provider fetches do not advance approval state.
- `apps/api/src/services/picking-slip-service.ts` creates one stable slip per posted
  invoice or completed sale, snapshots product/variant/SKU/barcode/quantity/location/bin
  and image identity, orders lines for the warehouse walk, renders through the existing
  PDF storage path, audits generations, and creates released count review items for
  shortfalls. No picking-slip operation creates a journal or inventory movement.
- `apps/api/src/services/picking-slip-render-service.ts` renders image and no-image rows,
  variant details, quantities, bins, check boxes, and Code 128-B barcodes. The browser
  receives the inline local PDF; no printer, carrier, scanner, or cloud service is used.
- `apps/api/src/app.ts` and `apps/api/src/openapi.ts` expose product-image, invoice/POS
  picking-slip, PDF, reprint, and short-pick routes. `apps/web/app.js` accepts only the
  same-origin product-image reference for downstream display.
- `docs/ADVANCED_INVENTORY.md`, `docs/DEVELOPER_API_V1.md`, and the inventory entry in
  `docs/COMPETITIVE_RESEARCH_MATRIX.md` document the interaction and non-posting
  contracts.

## Verified evidence

| Check                             | Result                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4 focused integration            | Passed: 1 file, 3 tests against PostgreSQL test on port 5433. Covers invoice generation/PDF/reprint, unchanged-stock short-pick review, and idempotent manual JPEG thumbnail upload.               |
| Renderer unit test                | Passed: 2 tests covering image/no-image PDF rows and Code 128 module generation.                                                                                                                   |
| Catalog ingestion unit test       | Passed: 3 tests covering bounded media validation and safe provider-fetch behavior.                                                                                                                |
| Full PostgreSQL integration       | Passed: 41 files, 239 tests; D4 is included.                                                                                                                                                       |
| Full workspace unit/general suite | Passed: native 8, web 6, shared 9, accounting-core 35, API 211 tests.                                                                                                                              |
| Root typecheck                    | Passed: `tsc -b` and web E2E TypeScript configuration.                                                                                                                                             |
| D4 source lint                    | Passed: touched-file lint and source-only repository lint with temporary generated-client directories excluded; 12 GiB Node heap was required for the latter.                                      |
| Schema and migrations             | Passed: `db:validate`; 110 migrations applied with no pending migrations on development 5432 and test 5433.                                                                                        |
| Research verifier                 | Passed: `corepack pnpm test:research`, 21 PennyWise module baselines.                                                                                                                              |
| Web verification/build            | Passed: asset verification, minified web build, and `node --check apps/web/app.js`.                                                                                                                |
| D4 formatting scope               | Passed: all D4-touched source and documentation files formatted.                                                                                                                                   |
| Repository-wide format check      | Open: 37 warnings remain in pre-existing/shared files, the archived `.review-pre-d6d7` snapshot, `pnpm-lock.yaml`, and temporary generated Prisma output. No broad cleanup was claimed.            |
| Repository root build             | Open in this working tree: `prisma generate` cannot rename the locked Windows `query_engine-windows.dll.node` (`EPERM`). The owner processes were not terminated; the standalone web build passed. |

## Controls and non-claims

All new records carry organization scope, permission checks, and migration RLS/grants.
Slip identity is unique per invoice, line snapshots are immutable after creation, and
reprints append generation evidence rather than duplicating a slip. Short-pick review
does not alter `InventoryBalance`, create `InventoryMovement`, post a journal, or
silently fulfill a shortage. Catalog bytes are bounded in memory and only the approved
thumbnail is persisted; unapproved images remain review evidence.

No live provider credentials, provider image fetch, tax/remittance result, Store account,
Store signing, clean Windows 11 install, reboot/upgrade/uninstall drill, or real
backup/restore drill was claimed. D1-D3 external evidence gates remain open. Browser
printing is specified and locally PDF-verified, but a physical printer was not available
and no successful hardware print is reported.

The existing Prisma troubleshooting artifacts remain at
`packages/db/generated-client-rebuilt` and as a native-engine `.tmp` file because the
running owner processes prevented safe cleanup. They are not required source inputs.

## Exact local verification and startup

From the repository root, install dependencies and ensure `.env` is copied from
`.env.example`. Set the development `DATABASE_URL` and test `TEST_DATABASE_URL` to the
local PostgreSQL services, then run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
$env:DATABASE_URL = $env:TEST_DATABASE_URL
corepack pnpm db:migrate:deploy
corepack pnpm test:integration
corepack pnpm dev
```

On this machine the two migrate-deploy commands and all tests pass; `db:generate` and
the root build require the locked Prisma engine to be released first. For the manual
operator drill, create/post an inventory invoice or complete a POS sale, generate its
slip through the documented route, open `/v1/picking-slips/{pickingSlipId}/pdf` in the
authenticated local browser, and use the browser print command. Verify the second
print uses the same slip ID while adding a generation record. Physical printing and
clean-machine lifecycle evidence remain unverified.

## Next-phase prerequisite

Record D5 as the sole active phase in `docs/status/CURRENT_PHASE.md` after reviewing
this report. D5 may then implement shipping labels and carrier boundaries; it must not
expand D4 into packing, fulfillment waves, provider credentials, Store signing, or tax
acceptance.

## Stop condition

D4 is complete as an engineering phase. Stop here. D5 and D6 remain outside this
phase report and require the next active-phase record before implementation.
