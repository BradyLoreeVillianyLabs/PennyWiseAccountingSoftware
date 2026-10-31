# Improve document capture, AP review, and bill intake experience

Status: created 2026-08-06

## Role

Act as a finance-product implementation team with:

- product manager
- AP specialist
- backend engineer
- frontend engineer
- QA engineer
- security engineer

## Objective

Bring the experience of AutoEntry, Dext, and Bill.com into ClearLedger as a review-first, audit-safe workflow that feels faster and less manual than traditional bill entry.

## Why this matters

For accountants and bookkeepers, the real pain is not just data entry. It is the intake pipeline: receiving bills, receipts, and invoices from many channels and turning them into trusted accounting actions without losing control.

## Repository context to use

Extend the existing invoice, bill, attachment, audit, and review patterns already present in the repository.

## Requirements

Implement the following capabilities:

1. Upload documents for bills, receipts, invoices, and related evidence.
2. Suggest likely vendor, account, amount, date, and reference values.
3. Present a lightweight review queue for low-confidence matches and incomplete data.
4. Link the document to a bill, expense, or accounting action with clear audit evidence.
5. Preserve human approval before the action becomes a posting decision.
6. Make the review experience feel fast and low-friction but not reckless.

## UX principles to exceed competitors

The product should feel better than current tools by being:

- less error-prone than opaque OCR-style capture
- more trustworthy because it shows why a suggestion was made
- more efficient because it reduces clicks and manual re-entry
- more accountable because every decision is auditable

## Acceptance criteria

1. Users can upload and review documents in a guided intake experience.
2. Suggested matches are visible and explainable.
3. Low-confidence items appear in a queue for review.
4. The system records evidence linking the document to the accounting decision.
5. Focused tests cover upload, suggestion quality, review flow, and audit linkage.

## Implementation instructions

- Reuse existing document, invoice, bill, and audit services rather than introducing a disconnected document system.
- Make the first release pragmatic: upload, suggestion, review, and approval.
- Keep the experience calm and structured, with explicit confirmation before posting.
- Verify that the workflow is fast and understandable for accountants, not just technically functional.
