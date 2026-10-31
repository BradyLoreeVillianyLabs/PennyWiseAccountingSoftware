# Implement import, migration, and connector intake workflow

Status: executed and verified 2026-08-06

## Role

You are a cross-functional product and engineering team composed of:

- product manager
- accounting implementation specialist
- backend engineer
- frontend engineer
- QA engineer
- security architect

Treat this as a senior implementation handoff, not a narrow feature request. Inspect the repository before editing, use high reasoning, and deliver an implementation that is safe for accounting data.

## Objective

Implement a Switcher-like migration experience for ClearLedger by extending the existing import workflow and connector intake pipeline. The solution should address the same user problems as Transaction Pro, SaasAnt, and similar migration tools, but within ClearLedger’s accounting-safe architecture.

## Why this matters

These tools are widely used by accountants because importing data into QuickBooks is often one of the hardest parts of moving a company or onboarding a new client. The problem is not just CSV parsing. It is the combination of:

- source detection
- field mapping
- data validation
- previewing consequences
- dry-run safety
- reconciliation and exception review

ClearLedger already has strong conceptual foundations for this. The implementation should extend those foundations rather than creating a disconnected importer.

## Repository context to use

Use the existing implementation in:

- docs/MIGRATION_AND_PORTABILITY.md
- apps/api/src/services/data-migration-service.ts
- apps/api/src/app.ts
- apps/web/app.js
- packages/db/src/index.ts

Also review existing connector patterns and review-domain objects already present in the repository.

## Required behavior

- Deliver a guided migration wizard with steps for source selection, mapping, preview, dry run, commit, and reconciliation.
- Support QuickBooks Online, QuickBooks Desktop, CSV upload, and other existing supported import sources.
- Improve mapping by supporting alias detection and visible field mapping with preview-based review.
- Preserve immutable provenance, checksum-based idempotency, and source mismatch protection.
- Keep the workflow fail-closed and review-first: unsupported or ambiguous records must not silently post.
- Preserve source evidence such as tax, discount, quantity, SKU, and line-level values.
- Ensure reconciliation results are visible after commit.
- Reuse existing accounting services for posting. Do not bypass the ledger or create a parallel posting path.

## Scope boundaries

Do not add:

- a separate standalone migration product
- a new frontend framework
- live connector-to-ledger auto-posting
- foreign-currency migration beyond the existing approved policy
- unrelated CRM or workflow features

## Acceptance criteria

1. The web experience exposes a guided multi-step migration flow.
2. Import guidance is clearer and more structured than the current raw importer screen.
3. Mapping supports common aliases and manual override where needed.
4. Preview shows what will be imported, what is skipped, and what needs review.
5. Dry run and commit remain safe, traceable, and idempotent.
6. Reconciliation results are surfaced clearly after commit.
7. Focused tests cover mapping, preview, dry run, commit, reconciliation, and source mismatch handling.

## Implementation instructions

- Start from the existing importer service and web UI.
- Reuse existing validation, retry, and idempotency patterns.
- Keep the change narrow and implementation-oriented.
- Update UI copy and docs where behavior changes.
- Run formatting, type checks, and focused import/reconciliation tests before finishing.
- Do not claim task completion without fresh verification evidence.

## Execution result

The existing staged importer now presents a complete Switching Centre workflow for source
selection, local mapping, secure upload, server preview, non-posting dry run, explicit commit,
and reconciliation acknowledgement. Source-specific export guidance covers QuickBooks Online,
QuickBooks Desktop, Xero, Wave, FreshBooks, Sage, Zoho Books, and generic CSV/XLSX input. The
visual mapper uses the same deterministic aliases as the server, while the browser can show a
non-authoritative QBO/QBD heading signal without changing immutable source provenance.

The web preview now includes row-level status and source identifiers, ready/imported/flagged/skipped
counts, review notes, and a structured reconciliation card. Connector intake remains review-first:
provider evidence and catalog suggestions stay outside ledger posting and require existing human
confirmation boundaries.

Verification evidence (2026-08-07): `corepack pnpm format:check`, `corepack pnpm lint`,
`corepack pnpm typecheck`, and `node --check apps/web/app.js` passed; the focused PostgreSQL
`phase12-portability.integration.test.ts` passed 16/16; the Chrome release-candidate browser
suite passed 3/3 including preview → dry run → commit → reconciliation; and release-candidate
contract verification passed. The complete PostgreSQL integration matrix also passed 31 files and
196 tests, including the connector runtime, commerce inbox, catalog matching, and tenant-isolation
boundaries.
