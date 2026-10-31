# U1 — Every record you can create, you can view, edit and archive

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Files:** `apps/web/app.js`, `apps/web/index.html`, `apps/web/styles.css`. Touch the API
only if a real gap is found.
**Closes:** the record-maintenance rows in `ASSESSMENT.md` section 3
**Effort:** M
**Depends on:** nothing. Customers are handled in I5.

## Context

The routes below exist in `apps/api/src/app.ts`, but the web client never calls them
(`evidence/route-diff-v2.txt`). Users can create these records but cannot correct or
retire them.

| Record                    | Routes with no UI                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Products                  | `GET/PATCH /v1/products/:id`, `POST …/archive`, `POST/GET …/image`                            |
| Vendors                   | `PATCH /v1/vendors/:id`, `POST …/archive`                                                     |
| Chart of accounts         | `PATCH /v1/accounts/:id`, `POST …/archive`                                                    |
| Bank accounts             | `PATCH /v1/bank-accounts/:id`, `POST …/archive`                                               |
| Bank rules                | `PUT /v1/bank-rules/:id`, `POST …/archive`                                                    |
| Inventory locations       | `PATCH /v1/inventory/locations/:id`, `POST …/archive`                                         |
| Fixed-asset classes       | `GET/PUT /v1/fixed-asset-classes/:id`, `POST …/archive`                                       |
| Estimates                 | `GET/PATCH /v1/estimates/:id`, `GET …/delivery-history`, `POST …/public-links/:linkId/revoke` |
| Purchase requests         | `GET/PUT /v1/purchase-requests/:id`                                                           |
| Customer deposit requests | `GET/PUT /v1/customer-deposit-requests/:id`                                                   |

## Tasks

1. **Build one record-detail pattern** (drawer or panel) and reuse it for every row above.
   Use the existing grid and workspace components rather than new ones. It provides:
   - **View:** all fields, with created/updated metadata.
   - **Edit:** a versioned save. A stale version shows the other change and lets the user
     reload. It never overwrites.
   - **Archive:** a confirmation. When the API refuses, for example because the account has
     postings or the product has stock, show the API's reason verbatim in plain words.
   - **Restore:** only where the API supports it. Don't invent endpoints.
2. **Products:** image upload with a preview, reusing the existing product-image contract
   and thumbnails.
3. **Chart of accounts:** edits are limited to what the service permits. Control accounts
   and system accounts show why they're locked.
4. **Estimates:** edit a draft, view delivery history, and revoke a public link.
5. **Rows in every list link to the detail view.**

## Constraints

- **Permissions:** edit and archive are hidden, or disabled with a stated reason.
- **No accounting changes:** editing an account never rewrites posted history. The service
  already enforces this; surface its errors clearly.
- **Accessibility:** keyboard-operable, and usable at 390 px.

## Acceptance criteria

- **Per record type,** an e2e test covers edit → reload shows the change, archive, and a
  refused archive shows the reason.
- **Conflicts:** the stale-version path is shown for at least products and accounts.
- **Route comparison:** rerunning it shows every route in the table referenced.
- **Regression:** the existing catalog, inventory and banking e2e specs still pass.

## Out of scope

- Bulk edit.
- Merge duplicates. This is worth a later prompt.
- Custom fields.

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
