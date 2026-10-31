# Supplied external integration and import completion prompt

This is the supplied 2026-08-06 prompt. The assessed execution contract is in
[`EXTERNAL_INTEGRATION_AND_IMPORT_COMPLETION_PROMPT_2026-08-06.md`](./EXTERNAL_INTEGRATION_AND_IMPORT_COMPLETION_PROMPT_2026-08-06.md).

You are implementing the remaining external integration and import/migration completion work in the ClearLedger repository at `ClearLedger-Codex-Ready`.

Your job is to finish the feature set in a focused, production-quality way with minimal drift, minimal token waste, and no speculative scope.

Important operating rules:

- Do not build unrelated features.
- Do not create a separate app, prototype, or parallel subsystem unless the existing architecture clearly requires it.
- Prefer small, high-confidence changes over broad refactors.
- Reuse the existing services, patterns, and domain models already present in this repository.
- Do not over-test. Add only the tests necessary to prove the feature works.
- If you are uncertain about a requirement, inspect the existing code and docs first before acting.
- If you identify a problem, fix it directly rather than reporting it without action.
- Do not claim success without running the relevant verification steps.

## Repository context

Inspect these first:

- `apps/api/src/services/data-migration-service.ts`
- `apps/api/src/app.ts`
- `apps/web/app.js`
- `packages/db/src/index.ts`
- `apps/api/src/services/calendar-service.ts`

Review:

- `docs/MIGRATION_AND_PORTABILITY.md`
- `docs/API_GUIDELINES.md`
- `docs/DECISIONS_AND_OPEN_QUESTIONS.md`

## Primary objective

Complete:

1. CSV-based import/migration support for common source-system exports.
2. End-to-end external connector workflow support for at least one real provider path.

Do not treat this as a generic CRM task. Keep scope tightly focused on import/migration and external integration completion.

## Required behavior

### A. CSV import and migration support

- Ensure the existing flow works end to end: upload, validation, field mapping, preview, dry run, commit, reconciliation.
- Preserve immutable source-system provenance.
- Keep source handling consistent with the current architecture.
- Support common CSV export patterns from QuickBooks Online, QuickBooks Desktop, Xero, Wave, FreshBooks, Sage, Zoho Books, and spreadsheet-style sources.
- Normalize common header aliases deterministically.
- Import invoices and bills as their proper financial object types.
- Preserve customer/vendor identifiers, invoice/bill number or external ID, dates, due dates, descriptions/memos, amounts, line items, and safely representable tax/discount fields.
- If a field cannot be mapped safely, fail clearly or use a conservative fallback rather than silently misimporting data.

### B. External connector workflow

- Support connection setup, authentication handling, status reporting, provider fetching/syncing, mapping into ClearLedger domain objects, and error handling.
- Keep the implementation modular and provider-based.
- Complete at least one real provider path end to end rather than leaving a stub.
- Align with existing security patterns and never expose secrets in responses.
- Use environment-based configuration where appropriate and preserve organization/tenant isolation.

## Constraints

- Extend existing import and connector services rather than inventing a new subsystem.
- Do not change unrelated accounting behavior or the financial posting model.
- Do not add a new frontend stack or disconnected prototype UI.
- Keep the UI simple and functional.
- Avoid broad refactors and unnecessary abstraction.

## Testing constraints

Add only targeted tests for CSV upload/provenance, representative QuickBooks mapping, invoice behavior, connector connection/sync behavior, and bad input or failed authentication. Do not add unrelated test suites.

## Verification requirements

Run relevant checks, fix failures, and use targeted verification rather than full-repository churn. Add a focused test if an existing test file does not cover new behavior.

## Expected output

- Working focused CSV import/migration support.
- Working end-to-end external connector workflow for at least one real provider path.
- Clear mapping behavior.
- No loose ends, placeholder-only integration, or unrelated scope.
