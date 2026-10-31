# Improve secure client collaboration and document exchange

Status: created 2026-08-06

## Role

Act as a collaboration-product implementation team with:

- product manager
- accountant or advisor specialist
- backend engineer
- frontend engineer
- QA engineer
- security engineer

## Objective

Bring the secure document sharing experience of SmartVault or ShareFile into ClearLedger in a way that feels native to accounting workflows and is tied to invoices, bills, customer records, and evidence rather than acting like a generic portal.

## Why this matters

Accountants and advisors need a secure way to exchange documents with clients and collaborators. The current gap is not just file sharing; it is contextual access, revocation, auditability, and trust.

## Repository context to use

Extend existing attachment, invoice, bill, customer, and tenant-scoped permission patterns.

## Requirements

Implement the following experience upgrades:

1. Shared document workspaces tied to customer or organization records.
2. Expiring, revocable access links with clear audit trails.
3. Context-aware sharing for invoices, bills, receipts, and evidence.
4. Clear status and permission views so users know who can access what.
5. Secure handling of sensitive documents without over-exposing internal ledger data.

## UX principles to exceed competitors

The experience should feel better than generic document portals by being:

- more contextual because documents are linked to the actual accounting workflow
- more trustworthy because permissions and access history are visible
- more efficient because sharing is integrated instead of separate
- more secure because revocation and retention are first-class

## Acceptance criteria

1. Users can share documents with controlled access and clear expiry.
2. Access can be revoked and audited.
3. Shared documents remain tied to relevant accounting records.
4. Focused tests cover permissioning, revocation, and audit behavior.

## Implementation instructions

- Reuse existing tenant and authorization infrastructure.
- Keep the initial version focused on secure sharing and review, not a full external portal platform.
- Make the experience feel professional and trustworthy for accountants and clients.
- Verify the workflow with concrete evidence and clear access-control checks.
