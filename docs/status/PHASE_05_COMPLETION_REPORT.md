# Phase 5 Completion Report

## 1. Phase result

Phase 5 is technically complete and all required local verification gates pass. Owner approval is still required before Phase 6. No payment, vendor, banking, inventory, or dashboard functionality was started.

## 2. Materially changed files

- `apps/api/src/app.ts`, `apps/api/src/http/schemas.ts`, `apps/api/src/openapi.ts`
- `apps/api/src/auth/permissions.ts`
- `apps/api/src/services/invoice-template-service.ts`
- `apps/api/src/services/invoice-render-service.ts`
- `apps/api/src/services/invoice-document-service.ts`
- `apps/api/src/services/invoice-service.ts`, `apps/api/src/services/idempotency-service.ts`
- `apps/api/src/invoice-documents.test.ts`, `apps/api/src/phase5-documents.integration.test.ts`
- `apps/web/index.html`, `apps/web/app.js`, `apps/web/styles.css`
- `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`, `packages/db/src/test-utils.ts`, `packages/db/src/runtime-context.ts`
- `.github/workflows/ci.yml`, `.gitignore`, `README.md`
- `docs/tasks/PHASE_05_INVOICE_DOCUMENTS.md`, `docs/00_DOCUMENT_INDEX.md`, `docs/status/CURRENT_PHASE.md`
- `docs/status/PHASE_05_COMPLETION_REPORT.md`

## 3. Migrations

Applied successfully to the development test database and to the clean rollback-verification database:

- `20260723100000_phase_5_invoice_documents`
- `20260723101500_phase_5_attachment_constraint_fix`
- `20260723103000_phase_5_public_audit_rls`

The latter two are corrective forward migrations. All 10 repository migrations also passed the disposable forward/down/forward/down rollback verification.

## 4. Final test counts

- Unit tests: 20 Vitest tests passed across shared, accounting-core, and API packages; web asset verification passed.
- Integration tests: 68 database-backed tests passed across five integration files.
- Formatting, linting, TypeScript, Prisma validation, Prisma generation, build, clean migration deployment, and rollback verification passed.

## 5. Render and PDF architecture

Posted invoices persist immutable render data, template key/version, and a canonical SHA-256 render hash in the posting transaction. Rendering uses constrained section configuration, escaped text, approved colors/fonts/page sizes, and no executable HTML, JavaScript, or unrestricted CSS. PDFs are produced through a renderer adapter, stored outside PostgreSQL through an organization-scoped storage key, and recorded with checksum, size, page count, and audit metadata.

## 6. Email adapter and retry behaviour

Queueing creates one idempotent delivery, outbox event, queued event, and audit record after commit. Dispatch claims a delivery transactionally, limits attempts to five, records sent or failed provider events, and retries temporary failures. Recipient validation and CRLF/header-injection checks are enforced. Development uses an in-memory email adapter; production must supply an idempotent provider adapter.

## 7. Public-link security controls

Public links use 32 random bytes, persist only a SHA-256 token hash, bind to one organization and invoice, support expiration and revocation, rate-limit requests, use no-store/noindex/nosniff/CSP headers, and record view/download events without raw tokens. Public RLS policies fail closed without token context. Attachments require allow-listed media types, matching magic bytes, size limits, clean scanner status, tenant authorization, and safe filenames.

## 8. Unresolved risks

- Development storage, email, and malware-scanning adapters are not production integrations.
- The deterministic PDF adapter is intentionally minimal; production needs a pinned, resource-isolated PDF engine and object-storage implementation with operational cleanup for orphaned blobs.
- Provider-side idempotency is still required to eliminate the narrow duplicate-send window after a provider accepts a message but before the database records `SENT`.
- Asset selection is tenant-validated; production rendering still needs the approved object-storage asset embedding path for logos, header images, and item images.
- Rate limiting is process-local and must move to shared infrastructure for a multi-instance deployment.

## 9. Phase 6 prerequisites

Owner approval of this report, production identity/session configuration, Stripe account and webhook design, payment allocation policy, receipt numbering rules, and a reviewed migration/financial-posting design are required before Phase 6 begins. Phase 6 has not started.
