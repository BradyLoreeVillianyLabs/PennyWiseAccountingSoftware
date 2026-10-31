# Independent review — CPA-005 generator and PayPal payment adapter

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Why an independent review, not a repeat of Claude's own

Claude wrote `apps/api/src/services/cpa005-eft-file-service.ts` and
`apps/api/src/services/paypal-payment-provider.ts` this session, then ran
`/code-review` against its own work and fixed everything the first pass found:
a hardcoded CAD refund currency that would corrupt a USD refund, a missing
non-negative/digits-only check that let a negative amount embed a literal `-`
inside a fixed-width bank field, unstripped control characters that could
fabricate a fake record boundary in a real payroll file, a webhook merchant-id
resolution built on a field (`resource.merchant_id`/`resource.payee`) that
the real `PaymentsCapture`/`Refund` SDK types don't actually have, and a
misleading doc comment claiming dispute-webhook coverage that was never
implemented. All of that is fixed and covered by new tests (29 passing across
both files as of this writing).

A reviewer re-reading their own fresh code for a second time is a weak check —
the same blind spots that let a mistake through the first time tend to survive
a second look by the same author. This task is that second, independent look,
specifically valuable here because this is money-movement code: a real bank
file format and a real payment processor's webhook contract.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `apps/api/src/services/cpa005-eft-file-service.ts` and its test
4. `apps/api/src/services/paypal-payment-provider.ts` and its test
5. `apps/api/src/services/payment-provider.ts` — the shared interface both
   `stripe-payment-provider.ts` and the new PayPal adapter implement
6. `docs/tasks/PAYMENT_INTERFACE_CONFIRMATION_PROMPT_2026-09-08.md` — a
   related, separate task about the interface mismatches this review's
   findings fed into; read it, but this task is about the two files above,
   not that interface decision

## What to actually verify, not just read

- **Re-derive the CPA-005 byte layout independently.** Don't trust this
  file's own comments about `moov-io/cadeft`'s field offsets — clone it,
  read `record_header.go`, `credit.go`, `file_header.go`, `file_footer.go`,
  and `utils.go` yourself, and confirm every offset in
  `cpa005-eft-file-service.ts` against that source directly. Better still:
  build a small Go program against the real library with a fixture of your
  own choosing (not the one already checked into
  `__fixtures__/cadeft-reference-output.txt`, so this isn't just re-checking
  the same known-good case) and diff its output against this file's.
- **Confirm the PayPal SDK assumptions against the installed package, not
  against this file's comments about it.** `@paypal/paypal-server-sdk` is
  already installed at `apps/api/node_modules/@paypal/paypal-server-sdk`.
  Read `dist/esm/types/models/paymentsCapture.d.ts` and
  `dist/esm/types/models/refund.d.ts` yourself and confirm neither carries a
  merchant/payee identifier — this file's `customId`-based design depends on
  that being true.
- **Check whether `customId` survives a real order→capture round trip
  unmodified.** This file assumes a `PurchaseUnitRequest.customId` set at
  order creation reappears verbatim on the resulting `PaymentsCapture` and
  `Refund` resources. That's a reasonable reading of the SDK's own field
  descriptions ("Used to reconcile API caller-initiated transactions"), but
  it has not been confirmed against a real sandbox order→capture→webhook
  sequence. If a real sandbox account is available, this is the single most
  valuable thing to verify — everything else in the design depends on it.
- **The refund webhook's capture-id extraction is explicitly flagged as
  unconfirmed** (`normalizePayPalEvent`'s "up" link parsing, in
  `paypal-payment-provider.ts`). Confirm the `PAYMENT.CAPTURE.REFUNDED`
  resource's actual shape against a real sandbox delivery if possible, or at
  minimum against a second independent documentation source beyond what this
  session found.
- **Confirm the dispute-webhook gap is real, not an excuse.** This file's
  comment says `CUSTOMER.DISPUTE.*` events are deliberately unhandled because
  no Dispute model is exported by the SDK and PayPal's docs page for it
  wasn't fetchable. Verify both claims — check the SDK's actual model
  directory for anything dispute-shaped, and try fetching PayPal's dispute
  docs again; if it's now confirmable, implement the mapping rather than
  leave the gap.
- **Check every place in `payment-service.ts` (or elsewhere) that consumes
  `PaymentProviderAdapter` generically** to see whether anything already
  assumes `verifyWebhook` is synchronous for every provider, since PayPal's
  adapter cannot honestly implement it that way — see the interface
  confirmation task for the design question this raises; this review should
  confirm whether the _current_ code (before that's resolved) has any latent
  call path that would actually invoke PayPal's synchronous `verifyWebhook`
  and get the deliberate throw, and whether that's acceptable as a stopgap.

## Constraints

- Do not weaken any of the validation this session's fixes added (digits-only
  numeric fields, control-character rejection, non-null currency checks) to
  make a test pass more easily.
- Do not fabricate a resolution for the two explicitly-flagged unconfirmed
  pieces (the refund "up"-link capture-id shape, the dispute-webhook shape)
  without a real, cited source — an unverified guess replacing an honest gap
  is worse than the gap.
- No live call to PayPal's sandbox from an automated test.

## Acceptance criteria

- A written record of what was independently re-derived and confirmed
  (the CPA-005 byte layout from source, the SDK model shapes) versus what
  remains genuinely unconfirmed and why.
- Either a real sandbox account was used to confirm the `customId` round-trip
  and the refund resource shape, or both are still explicitly flagged as
  unconfirmed — not silently assumed correct by omission.
- Any new finding is fixed with a test proving it, the same discipline this
  session's own fixes followed.
- `corepack pnpm lint`, `typecheck`, and both test files pass.
