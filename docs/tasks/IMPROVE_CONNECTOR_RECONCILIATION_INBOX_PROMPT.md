# Improve connector reconciliation inbox and exception handling

Status: created 2026-08-06

## Role

Act as a connector-product implementation team with:

- product manager
- reconciliation specialist
- backend engineer
- frontend engineer
- QA engineer
- security engineer

## Objective

Make the connector inbox feel like a premium reconciliation workspace for commerce and marketplace data. It should feel clearer and more actionable than A2X, Synder, Webgility, or similar tools while staying review-first and audit-safe.

## Why this matters

Connector-driven activity is often noisy and confusing. Users need to understand what happened, why it is pending, and what should be done next. The current repo already has connector runtime and commerce review infrastructure, but the user experience still needs to feel more resolution-oriented.

## Repository context to use

Extend the existing connector runtime, commerce inbox, normalization, and conflict handling services:

- apps/api/src/services/connector-runtime-service.ts
- apps/api/src/services/commerce-inbox-service.ts
- apps/api/src/services/connectors/commerce-normalization.ts
- apps/api/src/app.ts

## Requirements

Implement the following experience upgrades:

1. A clear reconciliation inbox that groups issues by type and severity.
2. Distinct treatment for pending, reviewed, conflicted, and mapped items.
3. Explainable normalization issues so users can see why an event needs attention.
4. Fast action paths for mapping, ignoring, retrying, or escalating.
5. Clear evidence of source values, fees, taxes, refunds, and settlement outcomes.
6. Visible status updates that reduce anxiety and confusion.

## UX principles to exceed competitors

The workflow should feel better than competitor products by being:

- easier to trust because every event can be traced to source evidence
- faster to resolve because actions are obvious and grouped
- less manual because the system learns and suggests
- more transparent because the user can see what is safe and what is not

## Acceptance criteria

1. Users can review connector events without ambiguity about what needs action.
2. Conflict and mapping issues have clear remediation guidance.
3. The inbox supports fast review and resolution workflows.
4. Sensitive provider data is never exposed in the UI.
5. Focused tests cover inbox grouping, conflict handling, and review workflow.

## Implementation instructions

- Reuse existing connector and normalization services.
- Make the inbox feel like an operational command center rather than a raw queue.
- Keep the UI strict about review-before-posting and show why a record is pending.
- Verify the workflow with concrete evidence and ensure there are clear recovery paths for failed syncs.
