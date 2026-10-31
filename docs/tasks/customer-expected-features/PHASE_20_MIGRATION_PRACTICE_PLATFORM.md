# Phase 20 Codex Task — Migration and Bookkeeper Practice Platform

Execute only after Phase 19 acceptance and explicit owner authorization. If beta
evidence shows migration or bookkeeper operations are a more urgent blocker,
the owner may authorize a separately reviewed reordering plan; do not reorder
silently.

## Objective

Make switching from common small-business accounting products predictable and
let a bookkeeper manage many client organizations without weakening tenant
isolation.

## Requirements

### Switching centre

- Extend the existing staged import service with source-adapter contracts,
  source/version metadata, resumable uploads, dry run, mapping templates,
  validation, reconciliation, commit, and downloadable exception reports.
- Add adapters and fixtures for QuickBooks Online exports, Wave, Xero,
  FreshBooks, Sage 50/Accounting exports, and a documented canonical CSV
  workbook. Only claim fields verified against supported export versions.
- Import in dependency order: organization/tax settings, accounts, contacts,
  items, projects/tags where supported, opening balances, open AR/AP, inventory
  openings, and optional historical transactions.
- Distinguish a balanced opening migration from reconstructed history. Do not
  fabricate source detail.
- Provide mapping assistance for accounts, taxes, contacts, item types, payment
  terms, statuses, and duplicate identities. Require explicit confirmation for
  ambiguous mappings.
- Before commit, show record counts, control totals, trial balance, AR/AP,
  inventory, tax, unsupported records, and expected differences.
- Commit atomically by bounded stage with idempotency and restart checkpoints.
  Posted imported results remain immutable and correction uses reversal.

### Practice platform

- Add a practice/firm entity separate from accounting organizations, with firm
  members, roles, client relationships, invitations, access requests, and
  relationship termination.
- Client access must still materialize as explicit, scoped organization
  membership checked by existing permissions and RLS. No firm-wide RLS bypass,
  cross-tenant SQL, or hidden support impersonation.
- Add a multi-client dashboard containing only authorized aggregate workflow
  status: onboarding, uncategorized banking, overdue AR/AP, reconciliation,
  review items, close readiness, deadlines, and feed health.
- Add client provisioning templates, standardized chart/tax mappings,
  assignments, notes/tasks, batch communication, and bulk export requests.
- Batch operations may queue drafts or review tasks but may not post across
  organizations. Each organization action needs independent authorization,
  audit, idempotency, and failure reporting.

## Efficient implementation order

Build the canonical import manifest and practice/client authorization model
first. Source adapters and dashboard work may then proceed independently.
Reuse migration staging, complete export, invitation, membership, review queue,
outbox, and report-summary services.

## Tests and acceptance

- Golden-file adapter tests and version/encoding/date/locale/currency edge cases.
- Dry-run/commit equivalence, replay, interruption/resume, rollback-before-post,
  and concurrent commit tests.
- Reconciled fixtures for each supported source including explicit unsupported
  data reports.
- Adversarial firm/client authorization, relationship removal, session
  revocation, pooled RLS context, aggregate privacy, and batch partial-failure
  tests.
- E2E: migrate representative service and product companies, reconcile source
  control totals, invite bookkeeper, review both clients, remove one relationship
  and prove access ends immediately.

Acceptance requires reproducible migration evidence, zero silent data loss,
clear unsupported-data disclosure, and no route from a practice relationship to
unrelated organization data.

Write the Phase 20 completion report, update current phase, and stop.
