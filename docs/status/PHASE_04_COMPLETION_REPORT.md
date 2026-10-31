# Phase 4 Completion Report

## 1. Phase result

Phase 4 sales and invoice accounting implementation and required verification are complete. With owner authorization, the development API process PID `12552` was stopped and normal `pnpm.cmd db:generate` passed. The report is ready for owner approval. No Phase 5 functionality was started.

## 2. Materially changed files

Core and database: `packages/accounting-core/src/money.ts`, `packages/accounting-core/src/money.test.ts`, `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`, `packages/db/src/test-utils.ts`, and the three Phase 4 migration directories.

API: `apps/api/src/app.ts`, `apps/api/src/openapi.ts`, `apps/api/src/http/schemas.ts`, `apps/api/src/auth/permissions.ts`, `apps/api/src/services/customer-service.ts`, `product-service.ts`, `invoice-calculation.ts`, `invoice-service.ts`, `receivables-service.ts`, `idempotency-service.ts`, `journal-service.ts`, `apps/api/src/app.test.ts`, and `phase4-sales.integration.test.ts`.

Web and documentation: `apps/web/index.html`, `app.js`, `styles.css`, `README.md`, `scripts/verify-assets.mjs`, `docs/tasks/PHASE_04_SALES_INVOICE_ACCOUNTING.md`, `docs/status/CURRENT_PHASE.md`, `docs/00_DOCUMENT_INDEX.md`, and this report.

## 3. Migrations

Applied successfully to clean PostgreSQL database `clearledger_phase4_clean_closeout`:

- `20260723030000_phase_4_sales_invoice_accounting`
- `20260723032000_phase_4_accounting_invariant_hardening`
- `20260723034000_phase_4_posting_trigger_casts`

All seven repository migrations deployed and Prisma reported the schema up to date. Rollback verification passed against disposable `clearledger_rollback_verify_phase4_closeout`; all seven `down.sql` files were exercised through two complete deploy-and-rollback cycles.

## 4. Final test counts

Unit tests: 17 passing (`shared` 2, accounting core 8, API 7), plus the web asset contract check. PostgreSQL integration: 66 passing across four files: ledger 28, identity/tenancy 22, company setup 12, Phase 4 sales 4. Build passed.

## 5. Command summary

Passed: `pnpm.cmd format`, `format:check`, `lint`, `typecheck`, `db:validate`, `db:generate`, `test`, `test:integration`, `build`, `db:migrate:deploy` on a clean database, Prisma migration status, and `db:rollback:verify`.

The rollback verifier correctly refused an initially misnamed disposable database, then passed without a bypass flag when rerun against the required `clearledger_rollback_verify_*` name.

## 6. Invoice posting rules

Drafts never create journals. Posting revalidates customer, item, period, ownership, tax, and totals; allocates a number under row lock; creates one balanced journal debiting AR and crediting revenue and tax payable; links the journal; writes audit and outbox records; and commits atomically with idempotency. Posted records are immutable. Void creates one exact journal reversal. Credit notes debit revenue/tax and credit AR, with full and partial eligibility bounds.

## 7. Tax and rounding

Money uses integer minor units and quantities use six-decimal micro-units. Signed half-up rounding is deterministic. Tax versions are effective-dated and copied with component amounts and account references onto lines. Inclusive tax derives the taxable base and adjusts the final component for exact total agreement.

## 8. Number allocation

Invoice and credit-note sequences use Phase 3 prefixes and placeholders. `BusinessDefaults` is locked with `FOR UPDATE`, incremented in the same posting transaction, protected by organization-scoped unique indexes, and retried on PostgreSQL serialization conflicts.

## 9. Unresolved risks

Production OIDC secrets, operational database-role provisioning, production migration approval, and production observability remain deployment responsibilities. Payments, inventory valuation, and customer payment allocations remain intentionally unimplemented.

## 10. Phase 5 prerequisites

Owner approval of this report and an explicit Phase 5 task. Phase 5 may then address templates, PDFs, email delivery, and public viewing; payments, purchases, banking, inventory quantities, and dashboard work remain separately gated.
