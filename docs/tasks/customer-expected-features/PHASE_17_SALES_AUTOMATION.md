# Phase 17 Codex Task — Sales Automation

Execute only after Phase 16 acceptance and explicit owner authorization.

## Objective

Complete the sales capabilities customers already expect: estimates, customer
approval, invoice conversion, recurring invoices, reminders, deposits,
retainers, progress billing, and a focused customer portal.

## Domain rules

- An estimate is non-posting. Acceptance freezes a versioned commercial
  snapshot but never creates a journal.
- Estimate-to-invoice conversion is atomic and idempotent, copies source/tax
  evidence, and links both documents. Conversion creates a draft invoice unless
  an already-approved policy explicitly permits posting.
- Recurrence defaults to draft generation. A separately authorized organization
  policy may schedule sending/posting only with clear preview, limits, audit,
  pause, failure handling, and revocation. Never infer approval.
- A customer deposit or unapplied retainer posts to a configured current
  liability/control account until applied. It is not revenue on receipt.
- Progress invoices post only their invoiced amount. Deposits applied to an
  invoice reduce the receivable through existing payment/allocation services.
- Reminders and statements are communications, not accounting events.

## Work packages

1. **Estimate lifecycle:** draft, send, view, expire, revise, accept/decline,
   cancel, PDF/email, public token, audit, conversion, and status reporting.
2. **Recurring engine:** reusable schedules for invoices and bills, timezone and
   date rules, next-run preview, pause/resume/end, deterministic catch-up,
   idempotent scheduler/outbox processing, and failed-run queue.
3. **Collections:** configurable pre-due/overdue reminders, customer statements,
   delivery suppression, contact preferences, resend, and communication history.
4. **Deposits and progress billing:** deposit request, retainer balance,
   milestone/percentage/fixed progress lines, application/refund, final invoice,
   control-account reconciliation, and reversal-safe corrections.
5. **Customer portal:** token or verified-email access limited to that customer's
   estimates, invoices, payments, receipts, statements, and approval actions.
   Do not expose organization navigation or unrelated customer records.

Establish shared document status, schedule, communication, and public-access
contracts before implementing the work packages. Reuse the invoice renderer,
email outbox, tax snapshots, payment service, and posting service.

## Non-goals

No e-signature platform, contract authoring, revenue-recognition engine,
autonomous collections, unrestricted templates, or card storage.

## Required verification

- State-machine, idempotency, concurrency, scheduler timezone/DST, retry, and
  outbox replay tests.
- Estimate conversion tests proving zero journals before invoice posting and
  exact source/tax traceability after posting.
- Deposit/retainer/progress scenarios proving AR, liability, revenue, tax,
  payment allocation, refund, reversal, and reports reconcile.
- Cross-tenant/customer-token adversarial tests and rate limits.
- PDF/email/mobile/accessibility fixtures for every new document state.
- End-to-end paths for quote-to-cash, recurring failure/recovery, overdue
  collection, deposit-to-final-invoice, and cancellation/correction.

Acceptance requires deterministic schedules, no duplicate document or journal
under replay/concurrency, and accountant drill-down from every posted amount to
its originating commercial document.

Write the Phase 17 completion report, update current phase, and stop.
