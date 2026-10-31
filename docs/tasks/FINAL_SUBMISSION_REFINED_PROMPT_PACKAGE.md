# Final submission refined prompt package

Status: refined for production handoff 2026-08-06

## Purpose

This package consolidates the implementation handoff prompts into a more production-ready form for submission to the development environment. The wording has been refined to be more explicit, more implementation-oriented, and more aligned with the repository’s existing architecture.

## Refinement goals

The prompts were reviewed from three perspectives:

1. Professional developer perspective

- emphasize repository-first implementation
- prefer extension of existing services over rebuilding
- keep the work narrow, testable, and maintainable

2. Prompt engineering perspective

- make requirements explicit and unambiguous
- reduce ambiguity around scope, architecture, and success criteria
- ensure the agent knows what to do, what not to do, and how to verify it

3. Accounting / finance perspective

- preserve auditability, tenant isolation, and accounting safety
- avoid silent posting or unsupported assumptions
- keep the user experience trustworthy and review-first

## Recommended submission order

1. Import, migration, and connector intake
2. CRM and calendar experience
3. Document capture and AP review
4. Connector reconciliation inbox
5. Advisory reporting and dashboards
6. Secure collaboration and document exchange
7. Onboarding and cutover confidence
8. Error recovery and resolution UX
9. Mobile and accessibility improvements
10. Workbench unification

## Submission guidance for the development environment

Each implementation prompt should be treated as a scoped build request for a senior agent. The agent should:

- inspect the repository before changing code
- extend current services and schemas where possible
- avoid creating disconnected subsystems
- preserve accounting correctness and tenant safety
- add only focused tests for the affected behavior
- verify work with concrete test or build evidence before reporting completion

## Deliverables expected from the agent

For each prompt, the agent should produce:

- implementation changes in the relevant API and web surfaces
- focused tests for the new core behavior
- documentation or copy updates where user-facing behavior changes
- verification evidence from relevant checks

## Final note

The prompts should be used to drive implementation, not just planning. They are intended to produce concrete, reviewable work in the repository rather than a speculative design artifact.
