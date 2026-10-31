# Improve advisory reporting and dashboard experience

Status: created 2026-08-06

## Role

Act as a reporting and advisory workflow implementation team with:

- product manager
- accountant or advisor specialist
- backend engineer
- frontend engineer
- QA engineer

## Objective

Make ClearLedger’s reporting experience feel like a polished advisory workspace rather than a basic accounting report screen. The UI should feel richer and more actionable than Fathom, Spotlight, or similar overlays while staying grounded in posted ledger data.

## Why this matters

Accountants and advisors need more than raw transaction reports. They need a succinct view of business health, trends, anomalies, and what requires attention.

## Repository context to use

Extend the existing ledger reporting and books-health patterns already present in the repo.

## Requirements

Implement the following experience upgrades:

1. A dashboard with executive-friendly summary cards.
2. Clear cashflow, AR aging, AP aging, sales trend, and variance views.
3. Simple anomaly and risk highlights derived from posted ledger data.
4. Drill-down from summary values into underlying transactions.
5. Date-range filters and reporting context that feel effortless.
6. Visual hierarchy that helps owners and advisors understand the story quickly.

## UX principles to exceed competitors

The experience should feel better than competitor reporting overlays by being:

- more connected to the accounting workflow
- less abstract and less “BI-like”
- more immediate because it uses the system of record
- more actionable because it surfaces what needs attention next

## Acceptance criteria

1. Users can view a polished management dashboard grounded in posted ledger data.
2. AR/AP aging and cashflow summaries are clear and easy to understand.
3. The UI supports basic drill-down and context.
4. Reporting respects tenant scope and authorization rules.
5. Focused tests cover aggregation, filtering, and access control.

## Implementation instructions

- Build on existing accounting services rather than creating a separate reporting database.
- Make the experience useful for owners and advisors rather than just technically complete.
- Prioritize clarity and narrative over visual clutter.
- Verify the calculations and the workflow end to end.
