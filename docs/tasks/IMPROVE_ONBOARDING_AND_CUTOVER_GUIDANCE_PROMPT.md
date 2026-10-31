# Improve onboarding, cutover guidance, and migration confidence

Status: created 2026-08-06

## Role

Act as a product and implementation team with:

- product manager
- implementation specialist
- frontend engineer
- backend engineer
- QA engineer

## Objective

Make the onboarding and cutover experience feel more like a guided professional implementation rather than a technical setup. The flow should help users feel confident that they are moving data safely and correctly.

## Why this matters

Users are often not just importing data; they are switching systems, changing workflows, and trying to avoid mistakes. The onboarding experience must reassure them and explain the next step clearly.

## Repository context to use

Extend the migration and portability documentation already present in the repository and connect it to the current import workflow.

## Requirements

Implement the following experience upgrades:

1. Clear cutover checklists and progress checkpoints.
2. Source-specific preparation guidance before import begins.
3. Clear explanation of what should happen before, during, and after a migration.
4. Reassuring summary pages for dry run, commit, and reconciliation.
5. Suggested follow-up actions after a successful import.

## UX principles to exceed competitors

The experience should feel better than current migration tools by being:

- less intimidating
- more structured and less ambiguous
- more confidence-building
- more clearly tied to accounting correctness

## Acceptance criteria

1. New users can follow a clear onboarding and cutover path.
2. The system explains preparation and review steps before posting.
3. The UI offers clear guidance after each major stage.
4. Focused tests cover onboarding and guidance content behavior where relevant.

## Implementation instructions

- Reuse the existing migration and portability guidance rather than duplicating it.
- Make guidance contextual and actionable.
- Ensure the experience feels supportive rather than technical-only.
- Verify that the flow is understandable and useful for first-time migration users.
