# ClearLedger multi-company accounting implementation prompt

## Objective

Extend ClearLedger so one authenticated workspace can contain multiple legal
companies without weakening tenant isolation, accounting integrity, auditability,
or the existing organization-scoped workflows.

## Required behavior

- Keep organization/workspace identity separate from legal-company identity.
- Allow one user to belong to multiple companies with a company-specific role.
- Provide safe company selection and switching backed by server-side membership
  checks; never trust a browser-selected identifier by itself.
- Give each company its own legal name, base currency, locale, timezone, fiscal
  year-end, setup state, chart/period context, and accounting reports.
- Backfill existing organizations into one deterministic default company without
  changing posted history, source provenance, or balances.
- Carry company context through requests, sessions, jobs, imports, connectors,
  reports, exports, caches, and ledger operations as each surface is migrated.
- Keep intercompany transfers explicit, reviewable, balanced, and auditable;
  unsupported automation must remain visibly unsupported rather than silently
  posting.
- Keep consolidation and eliminations explicit and fail closed until the required
  configuration and account mappings exist.

## Scope boundaries

Do not create a separate accounting product, bypass existing domain services, or
silently duplicate/post journals. Extend the existing organization, permission,
RLS, session, setup, ledger, import, connector, tax, reporting, and audit paths.

## Acceptance evidence

Focused verification must demonstrate default-company migration, per-company
membership authorization, safe switching, company-scoped core ledger reads and
posts, rejection of cross-company references, unchanged posted history, and
tenant/company isolation under concurrent requests. Any workflow not yet migrated
must be documented as organization-compatible rather than represented as fully
company-isolated.

## Implementation note

The first implementation slice adds `Company` and `CompanyMembership`, a
company-aware session/request context, default-company backfill, protected company
APIs, and optional company provenance on core ledger records. Subsequent domain
surfaces should require the trusted company context before creating or posting
company-owned records.
