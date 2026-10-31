# Implement document capture and AP workflow

Status: drafted 2026-08-06

## Role

You are a senior implementation team with:

- product manager
- accountant / bookkeeping domain expert
- backend engineer
- frontend engineer
- QA engineer
- security engineer

Treat this as a practical feature build for finance users, not a generic file-upload experiment.

## Objective

Bring the experience of document-capture and AP-automation tools such as AutoEntry, Dext, and Bill.com into ClearLedger as a review-first, auditable workflow. The feature should help users capture bills, receipts, and invoices, suggest coding and vendor matching, and route exceptions for approval without silently posting.

## Why this matters

A major pain point for accountants is not just data entry; it is the intake pipeline. Documents arrive as PDFs, photos, emails, and scanned files. The system needs to reduce manual handling while preserving control.

## Repository fit

Use existing domains around:

- invoices
- bills
- documents or attachments
- review workflows
- audit events
- tenant-scoped permissions

If the repo already has a document or attachment concept, extend it. If not, introduce a narrowly scoped document intake domain that is tied to bills and expenses rather than creating a broad content-management system.

## Required behavior

- Allow users to upload bills, receipts, and invoices into ClearLedger.
- Extract basic metadata such as vendor name, date, amount, and reference.
- Suggest matching to an existing vendor, account, category, or bill.
- Create a review queue for low-confidence matches or missing data.
- Preserve audit evidence for the uploaded document and the final decision.
- Keep posting human-reviewed and explicit. Do not auto-post from document ingestion alone.
- Support approval routing for bills or expense documents when appropriate.

## Scope boundaries

Do not add:

- a full OCR platform from scratch
- a generic document-management suite
- autonomous posting from unverified documents
- a separate external service dependency unless it is already part of the repository architecture

## Acceptance criteria

1. Users can upload a document and see a reviewable intake record.
2. The system suggests likely vendor/account/category matches.
3. The workflow supports review and approval before a document becomes an accounting action.
4. Audit evidence links the document to the resulting bill or expense decision.
5. Focused tests cover upload, metadata extraction suggestions, review/approval, and audit linkage.

## Implementation instructions

- Start from the existing bill/invoice/accounting workflow and extend it with a document intake layer.
- Reuse existing permissions, audit, and tenant-isolation patterns.
- Keep the first implementation pragmatic: metadata capture, review queue, and human approval.
- Update docs and UI copy where behavior changes.
- Run relevant tests and verify the workflow end to end.
