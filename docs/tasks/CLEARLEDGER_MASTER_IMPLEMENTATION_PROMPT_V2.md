# ClearLedger master implementation prompt v2

Status: revised for higher reliability 2026-08-06

## Mission

Build ClearLedger into a native replacement for the most common paid QuickBooks accountant workaround tools by extending the existing accounting platform rather than creating disconnected bolt-on products. The implementation should solve the same core user problems as Transaction Pro, SaasAnt, AutoEntry, Dext, Bill.com, A2X, Fathom, and SmartVault, while remaining accounting-safe, auditable, tenant-aware, and production-appropriate.

## Success criteria for this build

The build is successful only if all of the following are true:

- the implementation is grounded in the existing repository architecture
- the agent completes the work in a bounded, verifiable scope
- the user experience is guided and practical
- accounting integrity is preserved
- tenant isolation and security are preserved
- tests and verification evidence are produced
- documentation reflects the new behavior

## Critical failure modes to avoid

These are common reasons agent-led builds fail on accounting software:

- scope creep into unrelated product features
- building a parallel subsystem instead of extending the existing architecture
- bypassing posting rules or introducing unsafe auto-posting
- weakening auditability, provenance, or tenant controls
- producing code that compiles poorly or has no test coverage
- claiming completion without running verification commands

The agent must avoid all of the above.

## Product strategy

ClearLedger should become a native operating layer for migration, intake, review, reconciliation, reporting, and collaboration. The implementation should be designed as one cohesive workflow foundation rather than as separate point solutions.

## Workstreams

### 1. Migration and import experience

Implement a Switcher-like guided workflow for source selection, mapping, preview, dry run, commit, reconciliation, and acknowledgement.

Requirements:

- support QuickBooks Online, QuickBooks Desktop, CSV, and other supported import sources
- support common alias detection and visible field mapping
- preview imported data before commit
- run dry-run validation before posting
- preserve immutable provenance and idempotency
- keep the workflow fail-closed for unsupported or ambiguous data

### 2. Document intake and AP workflow

Implement document capture and review for bills, receipts, invoices, and supporting files.

Requirements:

- upload documents into a reviewable intake flow
- suggest vendor/account/category matches
- create review and approval queues
- preserve audit evidence for document-to-record decisions
- keep posting review-first and explicit

### 3. Connector and reconciliation inbox

Implement ingestion of commerce and payment-platform events into reviewable normalized records.

Requirements:

- support connectors, retries, conflicts, checkpoints, and idempotency
- normalize provider events into review-domain objects
- keep connector sync review-only until mapping or approval is explicit
- never silently create accounting records from raw provider data

### 4. Reporting and dashboards

Implement practical management reporting over posted ledger data.

Requirements:

- dashboard summaries for cash, AR, AP, sales, and trends
- aging views and variance indicators
- drill-down into underlying transactions
- tenant-scoped visibility and authorization

### 5. Secure collaboration and document portal

Implement a scoped document collaboration experience for advisors and collaborators.

Requirements:

- share documents securely within an organization context
- preserve tenant isolation and authorization boundaries
- link shared documents to relevant accounting records
- maintain version awareness and auditability

## Repository-first implementation rules

Use the repository as the source of truth. Start from the existing implementation in:

- docs/MIGRATION_AND_PORTABILITY.md
- apps/api/src/services/data-migration-service.ts
- apps/api/src/app.ts
- apps/web/app.js
- packages/db/src/index.ts
- existing connector, review, document, invoice, bill, audit, and permission modules

Do not invent a separate migration system, new frontend framework, or disconnected reporting stack. Extend the existing architecture in place.

## Engineering constraints

The agent must preserve the following at all times:

- accounting integrity
- immutability of posted financial history
- exact money handling and minor-unit storage rules
- tenant isolation and authorization
- auditability and source provenance
- idempotency and safe retries
- explicit human review where the data is uncertain

Do not bypass the domain services or ledger posting logic.

## Prompt behavior requirements for the agent

The agent should behave like a world-class delivery team and follow this execution order:

1. Inspect the repository and identify the smallest safe change set.
2. Understand the current import, connector, and document workflows before editing.
3. Implement the highest-value workstream first: migration and import experience.
4. Reuse infrastructure across workstreams to avoid duplicate systems.
5. Add or update tests alongside material behavior changes.
6. Run verification commands before claiming completion.
7. Report what changed, what was verified, and what remains as a risk.

## Required verification checklist

Before considering the work complete, the agent must verify:

- formatting/lint/typecheck pass where applicable
- focused tests for the affected modules pass
- import/migration or connector-related integration tests pass when relevant
- security and authorization behavior is preserved
- documentation is updated where business behavior changes

The agent must not claim completion without fresh verification evidence.

## Final instruction

Implement this work in a disciplined, evidence-based, production-safe manner. Prefer the smallest change that solves the real problem well. Do not overbuild. Do not drift. Do not claim success without running the checks that prove it.
