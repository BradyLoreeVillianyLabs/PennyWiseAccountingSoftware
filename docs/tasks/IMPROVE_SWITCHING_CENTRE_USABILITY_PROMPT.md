# Improve switching-centre usability and guided migration workflow

Status: created 2026-08-06

## Role

Act as a product-led implementation team with:

- product designer
- migration specialist
- backend engineer
- frontend engineer
- QA engineer
- accounting workflow specialist

## Objective

Make the Switching Centre feel like a premium, guided migration experience instead of a raw importer. The experience should feel easier, clearer, and more reassuring than Transaction Pro, SaasAnt, and similar migration tools while preserving ClearLedger’s accounting safety.

## Why this matters

Many users do not want to think about import mechanics. They want to know:

- what source they are migrating from
- which fields are being mapped
- what will be created
- what is risky or blocked
- what they should do next

The current repository already has strong staging and reconciliation logic, but the user experience still needs to feel more like a guided migration workspace and less like a technical import screen.

## Repository context to use

Extend the implementation already present in:

- apps/api/src/services/data-migration-service.ts
- apps/web/app.js
- docs/MIGRATION_AND_PORTABILITY.md
- apps/api/src/app.ts

## Requirements

Implement the following experience upgrades:

1. A step-based guided flow with strong progress visibility.
2. Clear source-specific guidance before the user uploads anything.
3. Human-readable mapping summaries with visible alias recognition.
4. A preview that clearly shows what will be imported, skipped, or blocked.
5. A non-posting test-import state that feels decisive and safe.
6. Explicit next-step messaging after dry run, commit, and reconciliation.
7. Friendly but strict error recovery with targeted next actions.

## UX principles to exceed competitors

The implementation should feel superior to other products by being:

- more transparent than a black-box importer
- less intimidating than a spreadsheet-oriented tool
- more trustworthy because every action is evidence-backed
- more helpful because it explains what is happening and why

## Acceptance criteria

1. The wizard clearly guides the user through source selection, mapping, preview, dry run, commit, and reconciliation.
2. The user can understand the current step, previous steps, and next required action without reading technical documentation.
3. Mapping errors and blockers are explained with clear remediation guidance.
4. The flow preserves accounting safety, provenance, idempotency, and reconciliation evidence.
5. Focused tests cover the new UI flow and the core import lifecycle.

## Implementation instructions

- Reuse the existing migration service rather than building a parallel flow.
- Make the UI feel calm, structured, and confidence-building.
- Use plain language for import outcomes, not raw technical status messages.
- Make the experience feel like the system is helping the user complete a safe cutover rather than merely accepting files.
- Verify the result with concrete evidence and do not claim completion without fresh checks.
