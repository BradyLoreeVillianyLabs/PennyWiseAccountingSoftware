# Native QuickBooks workaround replacement

Status: executed 2026-08-06

## Source prompt

Build ClearLedger into a native replacement for the most common paid QuickBooks
accountant workaround tools by extending the existing accounting platform rather
than creating disconnected bolt-on products. Solve the same core user problems as
Transaction Pro, SaasAnt, AutoEntry, Dext, Bill.com, A2X, Fathom, and SmartVault
while remaining accounting-safe, auditable, tenant-aware, and production-appropriate.

Use the repository as the source of truth. Start from:

- `docs/MIGRATION_AND_PORTABILITY.md`
- `apps/api/src/services/data-migration-service.ts`
- `apps/api/src/app.ts`
- `apps/web/app.js`
- `packages/db/src/index.ts`
- the existing connector, review, document, invoice, bill, audit, and permission modules

Do not invent a separate migration system, frontend framework, or disconnected
reporting stack. Preserve posted-history immutability, exact money handling,
tenant isolation, auditability, idempotency, and explicit human review when data
is uncertain. Keep all posting inside the existing accounting services.

## Execution adjustment

Repository review showed that the major capability clusters are already native:

| Customer problem                    | ClearLedger path                                                  | Safety boundary                                        |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| Transaction Pro / SaasAnt bulk work | Switching Centre and data migration service                       | immutable source hash, dry run, commit, reconciliation |
| AutoEntry / Dext / Bill.com intake  | CaptureReview evidence inbox and PurchaseService conversion       | scanner and review approval before one linked draft    |
| A2X-style commerce reconciliation   | WooCommerce/Etsy connector review inbox                           | shadow/review mode; no connector auto-posting          |
| Fathom-style reporting              | posted-ledger reports, Books Health, dashboard, accountant review | report output is read-only evidence                    |
| SmartVault-style document context   | tenant-scoped attachments, capture evidence, invoice links        | scoped authorization and explicit sharing              |

The implementation therefore extends the existing surfaces instead of creating
parallel products. A compact Accountant Workbench now links the existing paths
from one review-oriented entry point. The evidence inbox adds server-side filters
for review status, evidence type, and draft-link state so an accountant can work
exceptions without downloading or mutating source files. The API accepts only
the documented filter enums and keeps the organization authorization boundary.

The following remain deliberately gated rather than simulated: live QuickBooks
provider credentials, live bank/payroll/OCR contracts, connector-to-ledger
auto-posting, foreign-currency migration outside the approved policy, and a
generic public document portal. The product must expose those as configuration or
review boundaries until the required provider, security, and accounting evidence
exists.

## Acceptance criteria

1. Existing migration, capture, connector, reporting, and document workflows are
   reachable from a clear accountant workbench.
2. The Switching Centre remains a guided source, mapping, preview, dry-run,
   commit, and reconciliation flow.
3. Capture review can be filtered by status, type, and whether a single linked
   draft exists; filtering is tenant-scoped and fail-closed.
4. Suggestions and imports never silently create authoritative ledger effects.
5. Existing source provenance, idempotency, audit, permission, and posting
   services remain the only accounting path.
6. Focused API and UI checks cover the new filter contract and navigation wiring.
7. Verification reports actual database/runtime gates separately when Docker or
   PostgreSQL is unavailable.

## Verification record

- Added `CaptureListFilters` to `ProjectService` and strict query validation to
  `GET /v1/capture-reviews`.
- Added status/type/draft-link controls and an evidence count summary to the AP
  evidence inbox.
- Added Accountant Workbench cards linking switching, evidence/AP, commerce
  review, and reports to the existing workspaces.
- Added API integration assertions for filtered, unlinked receipt evidence.

No new schema, posting path, frontend framework, connector authority, or public
credential surface was introduced.
