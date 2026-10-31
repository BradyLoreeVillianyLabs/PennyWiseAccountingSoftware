# Implement reporting and dashboard workflow

Status: drafted 2026-08-06

## Role

You are a senior implementation team with:

- product manager
- accountant / advisory specialist
- backend engineer
- frontend engineer
- QA engineer

Focus on practical reporting that helps users run the business, not on building a generic BI platform.

## Objective

Add a management reporting and dashboard experience to ClearLedger that addresses the same needs served by Fathom, Spotlight, and other reporting overlays. The feature should surface cashflow, AR/AP aging, sales trends, tax exposure, and anomaly signals using posted ledger data.

## Why this matters

QuickBooks users often need more than transaction entry. They need a clear view of business performance, risk, and the health of the books. This is one of the strongest paid workaround areas because native reporting is often too narrow for owners and advisors.

## Repository fit

Use the existing ledger and posting architecture as the source of truth. Build reporting on top of posted, immutable financial data rather than separate shadow tables.

## Required behavior

- Expose a management dashboard with summary cards for cash, AR, AP, sales, and month-over-month trends.
- Provide aging views for receivables and payables.
- Show simple variance and anomaly signals derived from posted transactions.
- Keep the reporting layer grounded in actual posted ledger state and tenant scope.
- Support date-range filtering and basic drill-down into underlying transactions.

## Scope boundaries

Do not add:

- a full standalone BI platform
- unsupported custom report builder complexity
- a disconnected reporting database

## Acceptance criteria

1. A dashboard can be viewed for an organization using posted ledger data.
2. AR/AP aging and cashflow summary are available.
3. The UI exposes clear visual summaries and basic drill-down behavior.
4. Reports respect tenant scope and authorization rules.
5. Focused tests cover data aggregation and access control.

## Implementation instructions

- Reuse existing accounting services and domain data.
- Keep the first release pragmatic and focused on the most valuable reporting views.
- Add docs and UI copy where reporting behavior changes.
- Validate calculations and access control before completion.
