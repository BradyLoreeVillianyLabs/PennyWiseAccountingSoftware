# I2 invoice composer and Finalize report — 2026-09-11

## Result

I2 is complete for the implemented product scope. The invoice composer now keeps
customer creation, due-date terms, multi-line editing, customer message, terms,
server-calculated totals, preview, draft autosave, and Finalize in one workflow.
The frozen 0.14.0.15 installer and packaging hold were not changed.

## Delivered

- Added `POST /v1/invoices/:invoiceId/finalize` and `GET
/v1/invoices/:invoiceId/books-impact`.
- Finalize reuses the existing authoritative, serializable, idempotent posting
  transaction. The choice is recorded in [ADR 007](../adr/007-i2-invoice-finalize.md).
- Added concurrent Finalize coverage proving one posted invoice journal and safe
  replay of the same idempotency key.
- Added versioned draft autosave through `PATCH /v1/invoices/:id`, with a visible
  stale-edit conflict and no silent overwrite.
- Added editable payment terms and due date, customer-facing message, terms, server
  totals, Copy to new draft, and a single confirmation before Finalize.
- Added the read-only books-impact panel from posted journal lines, with an
  Accountant workspace link.
- Moved invoice preview/PDF/public-link/history actions into a More menu while
  keeping the truthful beta Download & send action available after Finalize.
- Added customer-specific document language (English, French, bilingual), with the
  company default as fallback, and persisted language snapshots on invoices.
- Added GST/HST and QST registration numbers to immutable invoice render data and
  HTML/PDF labels.
- Added migration `20260911150000_customer_invoice_document_language`; the tree now
  contains 118 migrations.

## Verification

- `corepack pnpm typecheck` — passed.
- Web asset verification and build — passed.
- Invoice renderer unit suite — 12/12 passed.
- Fresh disposable PostgreSQL integration database — 11/11 Phase 4 sales tests
  passed, including Finalize concurrency and journal-derived books impact.
- Fresh disposable browser database, first-run composer — 1/1 passed with draft
  autosave; the existing X4 viewport suite covers 320/390px reflow and accessibility
  and performance contracts passed.
- Fresh disposable browser database, release candidate — 4/4 passed; accessibility
  and performance contracts passed.

## Boundaries

- Actual email delivery remains the I4 boundary. The UI states that PDF delivery is
  manual in this beta.
- French wording is implemented and covered by automated output checks; a fluent
  human language review remains a release-quality gate.
- The release candidate was exercised with regular Playwright because the browser
  connector was unavailable in this session. Human NVDA/VoiceOver and clean-machine
  review remain separate evidence gates.
- The 0.14.0.15 package remains frozen. These changes require a new versioned
  candidate after the remaining authorized product-gap increments are complete.
