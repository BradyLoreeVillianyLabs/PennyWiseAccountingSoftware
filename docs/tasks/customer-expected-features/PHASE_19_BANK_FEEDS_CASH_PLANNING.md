# Phase 19 Codex Task — Bank Feeds and Cash Planning

Execute only after Phase 18 acceptance, an approved Canadian aggregation
provider, legal review of its terms/data flows, and explicit owner authorization.

## Objective

Add reliable connected bank/card feeds without making the books dependent on a
single provider, and add useful budgets and cash forecasts that never alter the
ledger.

## Requirements

### Provider-neutral feed foundation

- Extend the existing live-bank interface with provider/customer/account
  identity mappings, encrypted refresh/access credentials, consent scope and
  expiry, connection health, cursor/checkpoint, webhook receipt, rate limits,
  and normalized transaction provenance.
- Use hosted provider consent. Never collect or store online-banking usernames,
  passwords, security answers, or raw provider secrets in logs.
- Add connect, select accounts, map, initial sync, incremental sync, refresh
  consent, disconnect, reconnect, provider outage, and account-closure flows.
- Normalize feed activity through the existing bank-import transaction model so
  duplicate detection, matching, categorization, splits, transfers, and
  reconciliation have one source of truth.
- Preserve provider transaction IDs and immutable raw hashes. A feed import does
  not post; existing explicit confirmation rules remain.
- Keep CSV/OFX/QFX fully functional and make degraded fallback clear.

### Cash planning

- Add monthly/weekly budgets by account and optional project/tag using versioned
  plans, import/export, comparison, and roll-forward.
- Add 13-week cash forecasting from current bank balance, open AR/AP, recurring
  schedules, and explicit user-entered assumptions.
- Label forecast values as projected; show source drivers and confidence. No
  forecast or budget row may create or modify a journal.

## Failure and security behavior

Webhook verification, replay protection, cursor advancement, transaction
upserts, and outbox work must be idempotent. Expired consent or provider outage
must pause cleanly, alert the organization, preserve the last good checkpoint,
and never silently delete activity.

## Tests and acceptance

- Adapter contract suite for initial/incremental sync, pagination, late changes,
  pending-to-posted transitions, duplicate webhooks, deletion notices, rate
  limits, expired consent, and outage recovery.
- Encryption/redaction, scope, RLS, cross-tenant mapping, and disconnect tests.
- Replay and concurrency tests proving one normalized bank transaction.
- Feed-to-reconciliation E2E plus CSV fallback E2E.
- Forecast tests reconciling opening cash and every driver, with projected and
  posted values visibly separate.
- Provider sandbox smoke test and operational alert/runbook evidence.

Acceptance requires no credential leakage, no duplicate or missing normalized
activity in tested transitions, continued manual-import operability, and
explainable non-posting cash forecasts.

Write the Phase 19 completion report, update current phase, and stop.
