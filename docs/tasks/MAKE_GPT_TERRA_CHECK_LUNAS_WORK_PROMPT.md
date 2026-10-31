# Make GPT Terra check Lunas work

Status: created 2026-08-06

## Role

You are a senior implementation agent working in a production codebase. Act as a decisive cross-functional engineer with strong product, debugging, and execution judgment. You are not here to speculate, complain, or defer. You are here to find the problem, fix it, and leave the system working.

## Objective

Use GPT Terra to quickly identify defects in the Lunas-related work and correct them decisively. The goal is not to complain about problems or produce a speculative analysis. The goal is to inspect the repository, find the actual issues, fix them immediately, and leave the workflow working correctly, safely, and in a way that fits the existing ClearLedger architecture.

## Context

The user wants a prompt that can be used to make GPT Terra audit and verify the work of GPT Luna. In this setup, GPT Luna may attempt to implement or fix the Lunas-related workflow, but GPT Terra should not merely report problems. It should quickly detect the issue, correct the implementation, and ensure the workflow is actually working. There is no excuse for leaving broken or incomplete work behind.

## What the agent should do

1. Inspect the repository for any existing Lunas-related references, routes, services, schemas, UI elements, tests, or documentation.
2. Determine whether Lunas is intended to be:
   - a feature workflow,
   - a validation or check workflow,
   - a connector or integration path,
   - a user-facing capability,
   - or a placeholder requiring implementation.
3. Review the current state of the Lunas-related work, whether it was produced by GPT Luna or another agent.
4. Find the concrete defects, broken assumptions, or missing integrations quickly.
5. Fix the problems directly in the codebase rather than describing them at length.
6. If the feature is already partially implemented, repair, connect, and verify it rather than rebuilding from scratch.
7. If the feature is missing or clearly broken, implement the smallest robust version that fits the current patterns and is safe for real use.
8. Do not stop after identifying an issue. Make the change, verify it, and move on.

## Required behavior

- The Lunas workflow should be discoverable and usable in the relevant part of the product.
- The implementation must follow the repository’s existing patterns for services, routing, permissions, and data modeling.
- The change must be safe, testable, and understandable.
- The workflow should not bypass accounting safety, auth, or audit expectations.
- If the feature depends on external systems, the implementation should handle missing or invalid configuration gracefully.

## Scope boundaries

Do not add:

- unrelated product features
- a separate standalone subsystem for Lunas
- speculative architecture that does not fit the current codebase
- unsafe or auto-posting behavior that bypasses review or accounting rules

## Acceptance criteria

1. GPT Terra has quickly identified and corrected the real problems in the Lunas-related work.
2. The repository contains a clear, working implementation or verification path for the Lunas workflow.
3. The implementation integrates with existing architecture rather than being isolated or duplicated.
4. The relevant API, service, or UI surface is wired up appropriately.
5. Focused tests or validation steps exist for the core behavior.
6. The implementation is documented clearly enough that another engineer can understand and extend it.
7. The agent does not stop at complaints; it leaves the work improved and corrected.
8. The agent demonstrates progress through actual fixes, not just analysis.

## Implementation instructions

- Start by searching the repository for any Lunas-related references.
- Prefer extension of existing services and patterns over introducing new abstractions.
- Keep the change narrow and implementation-oriented.
- Add or update focused tests where appropriate.
- Verify the result with concrete evidence before reporting completion.
- If something is unclear, make a reasonable implementation choice that aligns with the rest of the codebase and document the assumption.

## Final execution prompt

Act as GPT Terra and review, validate, and verify the Lunas-related work in this repository, including any implementation that may have been produced by GPT Luna. Do not merely report problems. Quickly find the real defects, fix them directly in the codebase, and leave the workflow working. Inspect the codebase for existing Lunas references and determine whether the current implementation is correct, incomplete, or broken. If the work is already partially present, repair and complete it in a way that fits ClearLedger’s existing architecture. If it is missing or incorrect, implement the smallest robust version that is safe for real use. Integrate the solution with the appropriate services, routes, data model, and UI surfaces, preserve tenant safety and accounting constraints, and verify the result with concrete evidence. No excuses, no hand-waving, and no incomplete reports.

## GPT Terra execution record

Audit date: 2026-08-07

- A repository-wide search, excluding dependencies, generated output, and VCS
  metadata, found no Lunas runtime implementation, route, service, schema,
  UI surface, test, connector, or product documentation. The only matches are
  this prompt itself.
- Lunas therefore represents GPT Luna’s prior work, not a defined ClearLedger
  product capability. There is no safe domain contract from which to invent
  accounting behavior, permissions, or a data model.
- No code was fabricated or changed under an undefined feature name. The
  verification path is the repository search above plus the standard release
  gates below; any future Luna-produced change can be audited against this
  prompt without silently becoming a financial workflow.
- Current repository verification remains green: formatting, lint, TypeScript
  type checking, Prisma validation, unit tests, PostgreSQL integration tests,
  build, and release-contract verification. A future implementation should
  add a concrete feature brief or source references before code is introduced.
