# Phase 6 Completion Report

## Result

**PASS.** Phase 6 customer payments, Stripe integration, allocations, refunds, disputes, receipts, and the required verification gate are complete. Phase 7 has not started.

## Material Changes

- Added a provider-neutral payment contract, a deterministic test adapter, and a Stripe Accounts v2/Checkout adapter selected from server-side environment configuration.
- Added organization payment-account connection state, encrypted provider identifiers, settings, public invoice checkout, return-state verification, payment records, allocations, manual payments, refunds, disputes, receipts, and outbox workers.
- Added internal payment screens for connection, settings, manual entry, history, detail, refunds, receipts, and dispute review.
- Added raw-body Stripe signature verification, timestamp checks, one-way account lookup, redacted durable events, replay handling, provider-state hydration, and exactly-once financial posting.
- Added direct PostgreSQL immutability and tenant-reference controls and expanded database-backed negative, concurrency, signature, replay, delivery, and cross-tenant tests.

## Migrations

The 18 Phase 6 migrations from `20260723110000_phase_6_customer_payments` through `20260723130000_phase_6_payment_integrity_hardening` are applied. All have `down.sql` verification files. A clean database applied all 28 repository migrations, and all 28 rollback files passed two deploy/down cycles.

## Tests

- Unit: 25 Vitest tests plus the web asset verification.
- Integration: 70 PostgreSQL-backed tests.
- Payment coverage includes concurrent idempotent manual payments and refunds, checkout bounds and replay, invalid and stale signatures, failed-event replay, fee and clearing journals, allocation immutability, AR reconciliation, receipt queue/delivery idempotency, public-data redaction, terminal dispute ordering, direct database mutation rejection, and cross-tenant denial.

## Accounting And Funds Flow

- Hosted capture: debit payment clearing for gross payment; credit accounts receivable for gross payment.
- Processor fee: debit payment-processing expense; credit payment clearing. Fees never reduce the customer's payment or allocation.
- Manual payment: debit the explicitly selected asset account; credit accounts receivable.
- Refund: debit accounts receivable; credit the original receiving or configured clearing account through a new linked journal. Original payment journals remain unchanged.
- Stripe direct-charges the organization's connected account. ClearLedger takes no platform fee and does not hold funds. Settlement to bank remains in clearing for Phase 8.
- Disputes enter review without automatically writing off revenue. Won/lost status is retained; settlement accounting awaits provider settlement/bank evidence.

## Idempotency, Security, And Tenancy

- Checkout, manual payment, refund, receipt resend, provider resource creation, provider events, posting keys, and organization receipt sequences are idempotent and concurrency constrained.
- Raw signed webhooks are verified before normalization. Only redacted normalized fields are stored. Accepted production events are scheduled after durable receipt and remain replayable through the worker/outbox path.
- Internal routes use permissions and recent-authentication controls. Public checkout is token-bound, rate-limited, server-priced, and cannot choose a provider account.
- Payment tables use forced PostgreSQL RLS. Composite tenant foreign keys, account lookup hashes, encrypted provider identifiers, and organization filters prevent cross-tenant identifier substitution.
- Posted payment attributes, allocations, completed refunds, receipts, checkout identity, webhook identity, disputes, journals, and audit records are protected from direct mutation.

## Verification Commands

All passed after fixes:

```powershell
pnpm.cmd format
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd db:validate
pnpm.cmd db:generate
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd build
pnpm.cmd db:migrate:deploy
pnpm.cmd db:rollback:verify
```

Targeted API unit and Phase 4/6 PostgreSQL integration runs also passed. `DATABASE_URL`/`TEST_DATABASE_URL` pointed only to local PostgreSQL 17 test databases.

## Remaining Risks And Phase 7 Prerequisites

- Live Stripe network onboarding, Checkout, refund, and webhook delivery were not executed because no external credentials were used. Validate the pinned Stripe API `2026-06-24.dahlia` in a dedicated test account before production.
- Production still requires deployment-provided object storage, malware scanning, email, shared webhook rate limiting, and receipt-worker email adapters. The in-process webhook schedule relies on provider redelivery or the durable worker after a process crash.
- Bank settlement and dispute cash movements intentionally remain in clearing until Phase 8. No bank-reconciliation functionality was added.
- Before Phase 7, approve this report, preserve the Phase 6 migrations, configure production secret management and workers, and define AP control-account and vendor-number policies.
