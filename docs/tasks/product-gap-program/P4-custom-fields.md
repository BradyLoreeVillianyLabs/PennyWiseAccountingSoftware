# P4 — Typed custom fields on customers, items and documents

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files, likely:**

- `packages/db/prisma/schema.prisma`, plus a migration
- A new `custom-field-service.ts`
- `customer-service.ts`, `product-service.ts`, `invoice-service.ts`, `estimate-service.ts`,
  `purchase-service.ts`
- The invoice and estimate renderers
- `organization-portability-service.ts`, `openapi.ts`
- `apps/web/app.js`, `apps/web/index.html`

**Closes:** G20 (and capability 26 in `COMPETITOR-MATRIX.md`)
**Effort:** M
**Depends on:** nothing. U1 is recommended first, for record-detail views.

## Context

- **PennyWise has no custom-field model.** `schema.prisma` has none, and the 2026-08-13
  QuickBooks gap review reached the same conclusion.
- **Competitors differ, and users notice.**
  - Xero users complain it offers only two tracking categories.
  - Square offers custom fields on Plus.
  - QuickBooks Desktop shows custom fields on forms and reports.

## Tasks

1. **Field definitions per organization,** for customers, vendors, items, invoices,
   estimates and bills.
   - **Types:** text, number, date, single-select, checkbox.
   - **Rules:** required or optional, default value, help text, and an order.
   - **Lifecycle:** archive, never delete once values exist.
2. **Values** are stored per record, validated on the server by type, and versioned with the
   record.
3. **Placement:** fields appear in record forms and detail views (U1 pattern) and in list
   columns, which are filterable and sortable.
4. **Documents:** a "Show on document" setting per field, rendered in a fixed block. They are
   captured in the render snapshot, so later changes never alter issued documents.
5. **Data paths:** fields work in exports (organization portability and CSV), in imports
   (the Switching Centre mapping), and in the API (OpenAPI).
6. **Permissions:** who can define fields (owner and admin), and who can edit values (anyone
   who can edit the record).

## Constraints

- **Custom fields never affect posting, tax, or totals.**
- **Tenant-scoped, under RLS.**
- **Limits:** a sensible per-entity limit on the number of fields and on value length, to
  protect performance.
- **Localization:** field labels are owner-entered; if P5 has landed, offer an optional
  French label.

## Acceptance criteria

- **Integration:** define fields of all five types → set values → export, import and read
  them back through the API.
- **Documents:** an invoice PDF shows the fields marked "show on document", and an
  already-issued PDF is unchanged after a definition is edited.
- **Filtering:** a list can be filtered by a custom field.
- **Quality:** the X4 checks pass.

## Out of scope

- Formula fields.
- Custom fields on journal lines, and reporting dimensions (see the QuickBooks gap review,
  Phase 2).

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Quality bar:** meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` §6.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
