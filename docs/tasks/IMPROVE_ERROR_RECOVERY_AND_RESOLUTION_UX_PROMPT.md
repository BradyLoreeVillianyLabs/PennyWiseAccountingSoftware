# Improve error recovery and resolution UX

Status: created 2026-08-06

## Role

Act as a product and engineering team specializing in trust-building workflow design with:

- product manager
- implementation specialist
- frontend engineer
- backend engineer
- QA engineer

## Objective

Make failures, retry paths, and blocked actions feel calm, actionable, and recoverable rather than confusing or frightening. This should help users recover from import warnings, connector conflicts, mapping issues, and review blockers more effectively than competitor tools.

## Why this matters

Many users abandon workflows when the system fails without explanation. The best products reduce anxiety by showing exactly what happened, what it means, and what the user should do next.

## Repository context to use

Extend the existing review, reconciliation, import validation, and connector conflict handling paths.

## Requirements

Implement the following experience upgrades:

1. Clear, human-readable explanations for blocked or failed actions.
2. Actionable recovery steps for each error category.
3. A visible distinction between warnings, blockers, and critical failures.
4. Retry and escalation paths that feel guided rather than technical.
5. A calm, confidence-building recovery experience.

## UX principles to exceed competitors

The experience should feel better than competitor tools by being:

- more understandable
- less frightening
- more actionable
- more trustworthy because it explains tradeoffs and limits

## Acceptance criteria

1. Errors and blockers are understandable to non-technical users.
2. Recovery instructions are explicit and relevant.
3. The workflow does not leave the user guessing about next steps.
4. Focused tests cover message clarity and recovery guidance where relevant.

## Implementation instructions

- Reuse existing validation and exception patterns rather than adding ad hoc error handling.
- Make each error message speak to the user’s task, not just the technical issue.
- Ensure the recovery experience feels supportive and professional.
- Verify the flow with concrete evidence and do not claim completion without fresh checks.
