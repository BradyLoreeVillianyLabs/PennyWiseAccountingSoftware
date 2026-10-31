# I4 invoice delivery report — 2026-09-11

## Result

The local invoice-delivery increment is complete for the installed-beta fallback
scope. A posted invoice can now be prepared for the owner's own email app, with
customer recipients prefilled, multiple recipients validated, a merge-filled
subject and message, a PDF download/mailto handoff, an explicit Mark as sent
action, and visible MANUAL delivery history. Resend is wired to the same dialog.
The frozen 0.14.0.15 installer and transfer folder were not changed.

## Delivered

- Added `POST /v1/invoices/:invoiceId/manual-delivery` with tenant authorization,
  recipient normalization and validation, bounded recipient count, subject
  validation, PDF artifact generation, idempotency, audit evidence, and a
  truthful `MANUAL` delivery/event state.
- Added the `MANUAL` Prisma enum value and split its migration into an enum
  migration followed by a constraint migration. The second migration updates the
  pre-existing delivery-state and event-type checks so PostgreSQL accepts manual
  delivery without weakening queued/sending/sent/failed invariants.
- Added the invoice send dialog with customer-email prefill, CC-me, multiple
  recipients, editable merge-filled subject/message, PDF/mailto preparation, and
  explicit Mark as sent wording that says PennyWise did not send the email.
- Added posted-invoice delivery history with recipient, state, timestamp, and
  attempts, plus a visible resend action. Attachment upload controls remain
  limited to editable invoices while delivery actions remain available on posted
  invoices.
- Added the manual-delivery route to the OpenAPI route inventory and extended the
  invoice correction browser flow to exercise manual recording, history, and
  resend-dialog wiring.

## Verification

- Fresh disposable PostgreSQL browser database
  `clearledger_i4_test_20260911_m`: all 123 migrations applied successfully.
- Fresh Chrome acceptance flow: 1/1 passed. It created and finalized an invoice,
  opened the own-email-app dialog, recorded a manual delivery, verified MANUAL
  history, opened and cancelled the resend dialog, then completed the existing
  invoice/customer correction flow.
- Browser-run accessibility and performance release contracts passed.
- API/unit suite: 49 files, 277 tests passed.
- Full disposable integration suite on
  `clearledger_i4_test_20260911_j`: 44 files, 250 tests passed with all 123
  migrations applied.
- `test:research` passed for 21 modules.
- Prisma generation, schema validation with an explicit disposable database URL,
  full workspace build, typecheck, lint, and format check passed.

## Boundaries and unrun gates

- This increment does not enable provider-backed SMTP on installed builds. The
  existing beta kill switch remains fail-closed; D-01, verified SMTP credentials,
  owner enablement, provider presets, and external Google/Microsoft gates remain
  open. No credentials were added to source or package output.
- The browser run used `EMAIL_DELIVERY_MODE=disabled` to exercise the fallback.
  A packaged-mode launch still requires the existing independent beta secrets and
  constrained `clearledger_runtime` database role; those were not fabricated in a
  local test database and no packaged clean-machine claim is made here.
- No real mailbox, provider acceptance, assistive-technology review, or clean
  machine was used. `mailto` handoff is implemented, but the browser acceptance
  intentionally used Mark as sent so it did not launch an external mail client.
- No installer was rebuilt, signed, copied, or placed in the frozen transfer
  folder.

## Changed files

- `apps/api/src/app.ts`
- `apps/api/src/http/schemas.ts`
- `apps/api/src/openapi.ts`
- `apps/api/src/services/invoice-document-service.ts`
- `apps/web/app.js`
- `apps/web/index.html`
- `apps/web/e2e/i5-invoice-customer-corrections.spec.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260911170000_manual_invoice_delivery/migration.sql`
- `packages/db/prisma/migrations/20260911171000_manual_invoice_delivery_constraints/migration.sql`
- `docs/status/CURRENT_PHASE.md`
- `docs/status/I4_INVOICE_DELIVERY_REPORT_2026-09-11.md`
- `docs/tasks/product-gap-program/MODEL-TAKEOVER.md`
- `docs/tasks/product-gap-program/HANDOFF-BUILD-PLAN.md`
