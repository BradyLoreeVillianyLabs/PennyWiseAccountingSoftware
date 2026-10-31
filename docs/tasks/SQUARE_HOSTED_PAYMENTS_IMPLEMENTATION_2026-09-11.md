# Square hosted-payment implementation - 2026-09-11

## Read first

Work only in `C:\Users\EmceeHax\Desktop\clearledger-src`. Read `AGENTS.md`,
`TASK_EXECUTION_STANDARD.md`, `SECOND_BETA_IMPLEMENTATION_2026-09-09.md`, and
`PROVIDER_INTEGRATIONS_HANDOFF_2026-09-08.md`. The field-tested `0.14.0.15`
installer and transfer folder are frozen. Do not package, create provider
credentials, use a real seller account, or read `.env`.

## Authorization and goal

This is the remaining B2-2 payment lane: add a truthful Square hosted-payment
adapter only if its account model and expiry lifecycle can be made safe. Local
SDK/emulator proof is required; Square sandbox or live acceptance is not
implied by this task.

## Facts verified independently

- `apps/api/package.json` already locks the official `square` Node SDK at
  `45.1.0`, the current release documented by Square on 2026-09-11. Its
  `SquareClient`, `WebhooksHelper`, Checkout Payment Links, Payments, Refunds,
  and Locations clients are installed.
- Square's `POST /v2/online-checkout/payment-links` creates a Square-hosted
  page. It needs an idempotency key and location and returns a payment-link ID
  and URL, but has no expiry field. See the [official Checkout
  reference](https://developer.squareup.com/reference/square/checkout/create-payment-link).
- Square validates the exact raw body plus configured notification URL and
  `x-square-hmacsha256-signature`, using `WebhooksHelper.verifySignature` in
  SDK 40+. See the [official validation
  guide](https://developer.squareup.com/docs/webhooks/step3validate).
- Completed payment events use `payment.updated`; refunds use
  `refund.updated`; disputes use `dispute.created` and
  `dispute.state.updated`. See Square's [Payments webhook
  guide](https://developer.squareup.com/docs/payments-api/webhooks), [Refunds
  webhook guide](https://developer.squareup.com/docs/refunds-api/webhooks), and
  [Disputes guide](https://developer.squareup.com/docs/disputes-api/process-disputes).
- `PaymentProvider` already has a `SQUARE` database enum, but
  `apps/api/src/index.ts` correctly rejects `PAYMENT_PROVIDER=SQUARE`. No Square
  adapter or route exists.

## Mandatory lifecycle repair

`PaymentService` expires public checkout sessions after 30 minutes and refuses
a verified webhook that cannot match an active session. That correctly prevents
false posting, but Square payment links remain payable until deleted. A naïve
adapter could therefore charge a customer after PennyWise has expired the
session, leaving the books to correctly refuse the event. That is unacceptable.

Do not make Square selectable until all of these are true:

1. The shared provider contract includes an explicit provider-side checkout
   cancellation/expiry operation where supported.
2. A durable, restart-safe, RLS-safe expiry worker finds due sessions and
   deletes their Square payment links before or at PennyWise expiry. An
   in-memory `setTimeout` is insufficient because a restart loses it.
3. The worker marks a session cancelled only after Square confirms deletion,
   records/retries failures, and never exposes an access token or encrypted
   account ciphertext.
4. Startup recovery runs the same due-session sweep before hosted payments are
   served.
5. Local tests exercise expiration, restart recovery, provider-delete failure,
   and events from expired links.

The current RLS design correctly prevents a blank-context runtime query from
scanning all payment rows. Do not bypass RLS or use a superuser query. Design a
narrow audited access mode and migration with tenant-bound tests, or retain
Square as disabled.

## Account model after the lifecycle is safe

Square payment links are paid to the seller represented by the authorization
token and `location_id`; they are not Stripe Connect accounts. The first safe
scope is a pre-provisioned single-seller, single-location runtime:

- Require complete, non-blank configuration for mode, access token, location,
  webhook signature key, webhook notification URL, and account encryption.
- Use the installed `SquareClient` to retrieve and confirm that exact active
  location. Do not infer payout readiness where this path does not expose it.
- Prevent that location being connected to more than one PennyWise organization.
  Return `PAYMENT_ACCOUNT_CONNECTED_ELSEWHERE`, not a leaked unique-constraint
  failure.
- A preconfigured location has no onboarding redirect. Extend the shared
  contract to allow no URL rather than returning a fake local redirect.
- Per-organization Square OAuth is future work: it requires a real Square app,
  consent redirect, token encryption/rotation/revocation, public callback, and
  seller acceptance. Do not substitute an application token for delegated
  seller consent.

## Adapter requirements

Use the installed `SquareClient`, not handwritten REST requests:

1. Create links through `client.checkout.paymentLinks.create` using the exact
   configured location, positive minor units, a bounded idempotency key,
   redirect URL, and a payment note containing the opaque PennyWise checkout
   UUID. Recover that UUID only from the returned Square Payment note; browser
   return is never payment authority.
2. Use `client.payments.get` during hydration. Require a `COMPLETED` payment,
   exact amount/currency/location, and valid checkout UUID before posting. Sum
   processing fees and reconcile net = gross - fee.
3. Use `client.refunds.refundPayment` and `client.refunds.get`; retrieve the
   original payment currency before a refund.
4. Verify raw webhooks with `WebhooksHelper.verifySignature`; reject a missing
   or invalid signature and a wrong location. Pending/approved payment and
   pending refund events must be ignored, never posted.
5. Add `/v1/webhooks/payments/square` to the exact-raw-body parser and route it
   through `processPaymentWebhook`. Preserve one selected provider per running
   instance and the cross-provider refund refusal.

## Required local proof

Build a loopback HTTP emulator reached through the real installed Square SDK,
not a mocked adapter. Assert serialized authorization, idempotency, integer
money, link deletion, payment lookup, refund creation/retrieval, and location
retrieval. Generate webhook signatures through `WebhooksHelper` or the same
documented HMAC input and cover valid, missing, wrong-body, wrong-URL,
wrong-location, duplicate, pending, completed, failed, refund, and dispute
events. Keep credentials test-only.

Run focused tests and the full source gate. Record exact evidence in the
second-beta ledger and provider handoff. External Square acceptance remains
unrun unless the owner supplies existing authorized access.
