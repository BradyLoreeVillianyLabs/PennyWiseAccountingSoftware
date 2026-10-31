# I1 — Invoicing-only mode and first run

Prompt: I1 — “Just invoicing” mode and a three-minute first run  
Wave: 1  
Date: 2026-09-11  
Result: complete for the implemented I1 scope

## Delivered

- Added the `INVOICING_ONLY` workflow profile and persisted its navigation behavior.
  Owners can choose “Just send invoices and get paid” during organization creation,
  then use the reduced Home, Sales, Payments, Reports, Settings, and Help workspace.
- Added the first-run wizard for Canadian address, contact details, GST/HST and QST
  registration capture, document language, payment methods, CAD defaults, Net 30,
  and the `INV-0001` invoice sequence. The wizard applies the balanced
  `general-service` chart preset and completes the setup checklist without requiring
  an external signup.
- Added server validation and normalization for GST/HST and QST registration numbers.
  Registered GST/HST numbers use the CRA format; registered Quebec QST numbers use the
  Revenu Québec format. Numbers are stored normalized for document rendering.
- Made customer numbers optional at the HTTP and UI boundary. When omitted, the API
  allocates the next `CUST-0001`-style value in a serializable transaction and retries
  transient unique conflicts.
- Added persisted `paymentMethods` and `documentLanguage` business defaults with
  migration coverage.
- Added “Show more of PennyWise” so an owner can leave the minimal workspace later;
  the existing workflow-preference audit records the change.

## Changed files

`apps/web/index.html`, `apps/web/styles.css`, `apps/web/app.js`,
`apps/web/e2e/i1-invoice-only-first-run.spec.ts`, the organization-creation call sites
in the existing browser specs, `apps/api/src/http/schemas.ts`,
`apps/api/src/services/company-setup-service.ts`,
`apps/api/src/services/customer-service.ts`,
`apps/api/src/phase4-sales.integration.test.ts`,
`apps/api/src/workflow-preferences.integration.test.ts`,
`packages/db/prisma/schema.prisma`,
`packages/db/prisma/migrations/20260911133000_invoice_first_run_preferences/migration.sql`,
`packages/db/prisma/migrations/20260911140000_allow_invoicing_only_workflow_profile/migration.sql`,
`apps/web/scripts/build-assets.mjs`, and the linked status/pack documents.

The PostgreSQL check-constraint migration was required after an independent browser
run exposed that the TypeScript profile list had advanced ahead of the original raw
SQL constraint. That finding was fixed and covered by an API regression test.

## Verification

- Typecheck: passed.
- Prisma generation and schema validation: passed.
- Fresh migration deployment: passed, all 117 migrations applied.
- Workflow-preferences integration: 5/5 passed, including persisted
  `INVOICING_ONLY` and authorization coverage.
- Sales integration: 10/10 passed, including concurrent automatic customer numbers.
- Fresh-database browser flow: 1/1 Chromium test passed. It created an organization,
  completed the wizard, created a customer, created an invoice draft, and confirmed
  the minimal navigation and later workspace expansion.
- Built web bundle: passed asset verification and the release performance contract.
  The build now minifies only safe inter-tag HTML whitespace/comments while preserving
  `pre` and `textarea` contents; total initial assets are 1,086,515 bytes, below the
  1.165 MB gate.
- Targeted formatting for all changed source/test files: passed.

## Not run or not verifiable locally

No clean-machine, NVDA/VoiceOver, 200% zoom, or five-person usability round was
performed. External tax/legal review and production identity/provider acceptance remain
gates. No new package was produced; installer 0.14.0.15 remains frozen.

## Follow-ups

I2 should add the single Finalize action, posted-journal “What this did to your books”
panel, document registration-number rendering, and French/bilingual document labels.
X3’s estimate, bill, and purchase-request editors remain outside this I1 report.
