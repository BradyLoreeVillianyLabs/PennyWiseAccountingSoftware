# ClearLedger master implementation prompt

Status: drafted 2026-08-06

## Mission

Build ClearLedger into a native replacement for the most common paid QuickBooks accountant workaround tools by extending the existing accounting platform rather than creating separate bolt-on products. The implementation should solve the same core user problems as tools like Transaction Pro, SaasAnt, AutoEntry, Dext, Bill.com, A2X, Fathom, and SmartVault, but inside ClearLedger's accounting-safe, auditable, tenant-aware architecture.

## Strategic objective

The product should feel like a modern, guided switching and accounting operating system for small businesses and accountants. It should cover:

- switching and migration from other systems
- bulk import and historical data intake
- document capture and AP workflow
- commerce and payment reconciliation
- reporting and dashboard visibility
- secure document collaboration for advisors and clients

## Core product principle

Do not build isolated feature silos. Build a shared workflow foundation that supports intake, review, approval, reconciliation, and reporting. ClearLedger should become the system of record, not a collection of disconnected add-ons.

## Workstreams

### 1. Migration and import experience

Solve the same problems as migration/import tools.

Requirements:

- guided multi-step migration workflow
- source selection for QuickBooks Online, QuickBooks Desktop, CSV, and other supported sources
- common alias detection and field mapping
- preview and dry run before commit
- reconciliation and exception review
- immutable provenance and idempotency
- no silent posting of ambiguous records

### 2. Document intake and AP workflow

Solve the same problems as document capture and AP automation tools.

Requirements:

- upload bills, receipts, invoices, and supporting files
- suggest vendor/account/category matches
- create review and approval queues
- preserve audit evidence and link documents to accounting actions
- keep posting review-first and explicit

### 3. Connector and reconciliation inbox

Solve the same problems as commerce sync and reconciliation tools.

Requirements:

- ingest provider events into reviewable normalized objects
- handle retries, conflicts, checkpoints, and idempotency
- keep provider sync review-only until mapping or approval is explicit
- never silently create journal entries or invoices from raw provider data

### 4. Reporting and dashboards

Solve the same problems as reporting overlay tools.

Requirements:

- management summary dashboard
- cashflow, AR/AP aging, sales, and variance views
- reporting over posted ledger data
- basic drill-down and date filtering
- tenant-scoped reporting access

### 5. Secure collaboration and document portal

Solve the same problems as document workspace tools.

Requirements:

- shared document access for advisors and collaborators
- scoped permissions and tenant isolation
- document version awareness and links to accounting records
- secure review without broad public access

## Repository-first implementation rules

Use the repository as the source of truth.

Relevant starting points:

- docs/MIGRATION_AND_PORTABILITY.md
- apps/api/src/services/data-migration-service.ts
- apps/api/src/app.ts
- apps/web/app.js
- packages/db/src/index.ts
- any existing connector, review, document, invoice, bill, or audit-related modules

Do not invent a new migration stack, a new frontend framework, or a disconnected BI platform. Extend the existing architecture.

## Engineering constraints

- Preserve accounting integrity, immutability, tenant isolation, security, and auditability.
- Keep all financial posting through the existing accounting services.
- Use review-first and fail-closed behavior over silent automation.
- Reuse existing validation, permissions, retry, idempotency, and audit patterns.
- Keep the first release practical and focused on the highest-value workflows.

## Delivery team behavior

Act as a full senior implementation team with:

- product manager
- accounting implementation specialist
- backend architect
- frontend engineer
- QA engineer
- security engineer
- release reviewer

Research the public product space, identify recurring pain points, and implement the most practical ClearLedger-native solution. Use high reasoning, avoid scope creep, and verify the work with evidence before claiming completion.

## Acceptance bar

The implementation is successful only if:

- the user experience is guided and practical
- the accounting model remains safe and auditable
- tenant isolation and authorization are preserved
- the workflow feels native to ClearLedger rather than like a bolt-on workaround
- the implementation is verifiable with tests and concrete evidence

## Final instruction

Implement the highest-value workstream first: migration and import experience. Then continue through document intake, connector review, reporting, and collaboration in a way that shares infrastructure and avoids duplicate systems. Finish with verification, documentation, and a concise completion report.
