# ADR 007: I2 invoice Finalize reuses the atomic posting transaction

Date: 2026-09-11  
Status: Accepted for the I2 beta increment

## Decision

Expose `POST /v1/invoices/:invoiceId/finalize` as the owner-facing one-step action,
but reuse the existing `InvoiceService.post` transaction. The endpoint validates the
draft, recalculates authoritative server-side lines and tax, creates exactly one
posted journal, snapshots the customer document, and depletes inventory where
applicable. It requires the same `Idempotency-Key` contract as posting.

This release has no mandatory approval gate between DRAFT and POSTED. If a future
approval policy is enabled, the endpoint is the orchestration boundary where that
policy can be inserted without changing the composer contract.

## Why

The existing post transaction already protects the accounting invariants and has
concurrent idempotency coverage. Creating a second posting implementation would
risk divergent tax, foreign-currency, inventory, render-snapshot, and reversal
behaviour. Keeping the established transaction as the single posting path also
means a double-click cannot create a second journal.

## Consequences

- The UI presents one confirmation and one Finalize action; the older `/post` route
  remains available for expert and compatibility clients.
- A retry with the same key replays the original response. Concurrent requests with
  the same key are covered by the existing serializable idempotency record.
- The endpoint is one server operation and one idempotent posting transaction; it
  does not claim a separate approve transaction when no approval policy applies.
- After finalization, delivery remains the existing truthful beta boundary: the user
  can download the PDF and send it through their own mail service until I4.
