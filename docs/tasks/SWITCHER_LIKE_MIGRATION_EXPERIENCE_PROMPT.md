# Switcher-like migration experience prompt

Status: executed 2026-08-06

## Objective

Implement a Switcher-like migration experience in ClearLedger by extending the existing import and migration workflow rather than creating a parallel subsystem. The result should feel like a guided migration wizard while preserving ClearLedger's accounting safety, provenance, reconciliation, and audit controls.

## Goal

Deliver a polished migration journey that mirrors the core flow of a modern switching tool:

1. Connect or upload the source company file.
2. Detect the source type and supported entities.
3. Auto-detect or allow manual field mapping.
4. Preview imported data and mapping outcomes.
5. Run a dry run.
6. Review exceptions and fix issues.
7. Commit the migration.
8. Reconcile results and finish the cutover.

## Repository context to use

Use the existing implementation in:

- docs/MIGRATION_AND_PORTABILITY.md
- apps/api/src/services/data-migration-service.ts
- apps/api/src/app.ts
- apps/web/app.js
- packages/db/src/index.ts

Do not invent a new migration stack or a disconnected CRM/importer subsystem. Reuse the current staged workflow: upload → validation and mapping → preview → dry run → commit → reconciliation → acknowledgement.

## Required behavior

- Provide a guided, multi-step migration experience that feels like a Switcher-style workflow.
- Support source selection for QuickBooks Online, QuickBooks Desktop, CSV upload, and other supported import sources already referenced in the repository.
- Show clear source guidance, import templates, and mapping controls in the web UI.
- Make mapping more user-friendly by supporting default alias detection, visible field mapping, and preview-based review.
- Preserve immutable provenance, checksum-based idempotency, and source mismatch protection.
- Keep the import path fail-closed and accounting-safe: do not silently auto-post unsupported or ambiguous records.
- Use existing accounting domain services for invoice and bill creation. Do not bypass posting logic or create a separate ledger path.
- Preserve source evidence for tax, discount, quantity, SKU, and line-level values so the migration remains auditable.
- Ensure the user can review exceptions before commit and can reconcile balances after commit.

## Scope boundaries

Do not add:

- a separate standalone migration product;
- a new frontend framework;
- live connector-to-ledger auto-posting;
- foreign-currency migration beyond the existing approved policy;
- unrelated CRM or workflow features.

## Acceptance criteria

1. The web experience provides a guided migration flow with distinct steps for source selection, mapping, preview, dry run, commit, and reconciliation.
2. Source detection and import guidance are clearer than the current raw import screen.
3. The importer supports auto-mapping from common aliases and exposes manual mapping where needed.
4. Preview results include enough context for the user to understand what will be imported and what will be skipped or flagged.
5. Dry run and commit behavior remain safe, idempotent, and traceable to immutable source provenance.
6. Reconciliation results are surfaced clearly after commit.
7. Focused tests cover mapping, preview, dry run, commit, reconciliation, and source mismatch handling.

## Implementation instructions for the agent

- Start from the existing data migration service and web import UI.
- Reuse existing imports, types, validation logic, and retry/idempotency patterns.
- Keep the change narrow and implementation-oriented.
- Update docs and UI copy where behavior changes.
- Run formatting, type checks, and focused import/reconciliation tests before finishing.
- Do not claim completion without verification evidence.

## Execution prompt

> Implement a Switcher-like migration experience in the ClearLedger repository by extending the existing import workflow rather than building a separate subsystem. Add a guided multi-step migration wizard for source selection, mapping, preview, dry run, commit, and reconciliation. Reuse the current importer service, preserve immutable source provenance and idempotency, and keep all posting through the existing accounting services. Improve the web UI guidance and mapping experience, update relevant documentation, and add focused tests for mapping, preview, dry run, reconciliation, and source mismatch handling. Do not introduce a parallel migration architecture or bypass accounting safety controls.

## Execution result

- The Switching Centre now shows six explicit stages: choose source, map file, preview, test import,
  commit, and reconcile. The current stage and next action are announced to assistive technology.
- After server preview, a structured control summary shows source-row identifiers, ready/imported/
  flagged/skipped counts, row-level review notes, and reconciliation values without requiring the
  user to interpret a raw JSON status dump.
- CSV heading signals can suggest QuickBooks Online or Desktop, but the signal is explicitly
  non-authoritative and never changes the user-selected source provenance.
- Changing source or import type clears the browser's active batch so a reviewed file cannot be
  committed under a different provenance label.
- The server and visual mapper share the expanded deterministic alias table for common accounting
  exports (including contact/client, supplier/vendor, item/product, bill, tax, discount, and account
  headings). Manual mapping remains available for source-specific headings.
- Outstanding bills now preserve repeated line rows as one proper Bill through `PurchaseService`,
  carrying quantity, unit cost, discount, active tax-code mapping, account, and source-line evidence.
- Existing checksum idempotency, source mismatch protection, dry-run gate, compensation-required
  status, tenant authorization, and reconciliation behavior remain unchanged.

Verification run (2026-08-07): Prettier, API/web ESLint, web syntax check, and TypeScript typecheck
passed. The focused PostgreSQL migration suite passed 16/16 tests, including QuickBooks Desktop
invoice aliases, multi-line bill provenance, dry-run non-persistence, commit idempotency,
reconciliation, and QBO/QBD source mismatch protection. The Chrome release-candidate browser suite
passed 3/3 tests, including the full Switching Centre preview → dry run → commit → reconcile UI
path. Release-candidate contract verification passed.
