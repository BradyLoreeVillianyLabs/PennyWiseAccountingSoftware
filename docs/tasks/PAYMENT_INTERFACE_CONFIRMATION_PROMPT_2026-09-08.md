# Confirm and reshape PaymentProviderAdapter — three real mismatches found building PayPal

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Why this exists

`PAYMENT_PROCESSOR_EXPANSION_PROMPT_2026-09-08.md`'s task 1 asked whoever built
the PayPal adapter to "assess honestly whether `PaymentProviderAdapter`
generalizes cleanly... or whether it needs to change shape." It's been built
now (`apps/api/src/services/paypal-payment-provider.ts`), and the honest answer
is: not cleanly. Three concrete mismatches, each with a workaround already in
place that satisfies the interface's types but is worth a deliberate decision
rather than leaving as an implicit accident. This touches shared, already-
shipped code (`payment-provider.ts`, `stripe-payment-provider.ts`,
`payment-service.ts`), which is exactly why it's a separate, confirm-first task
rather than something changed silently as a side effect of adding a second
processor.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `apps/api/src/services/payment-provider.ts` — the shared interface
4. `apps/api/src/services/stripe-payment-provider.ts` — the existing, shipped
   implementation
5. `apps/api/src/services/paypal-payment-provider.ts` — the new implementation
   this task is about; its class-level doc comment already names all three
   mismatches below in more detail
6. `apps/api/src/services/payment-service.ts` — every call site that consumes
   `PaymentProviderAdapter` generically; read this fully before proposing a
   fix, since that's where the real blast radius lives

## The three mismatches, precisely

### 1. `verifyWebhook` cannot be synchronous for PayPal

Stripe's webhook signature is a local HMAC check (`stripe.webhooks.constructEvent`,
no network call). PayPal's is a live API call
(`POST /v1/notifications/verify-webhook-signature`) — there is no local
signature-verification path PayPal offers; verifying without that call means
not verifying at all. `PayPalPaymentProviderAdapter.verifyWebhook` currently
throws unconditionally, with a separate `verifyWebhookAsync` doing the real
work — satisfying the interface's type signature while making the interface's
synchronous contract a lie for this provider. This is not a hypothetical risk:
`payment-service.ts:600` already calls
`this.provider.verifyWebhook(rawBody, signature)` with no `await`, and
`payment-service.ts:1978`/`:2058` type the result as
`ReturnType<PaymentProviderAdapter["verifyWebhook"]>`, not
`Awaited<ReturnType<...>>` — the existing code already treats this method as
synchronous for every provider. The day a PayPal-connected organization's
webhook reaches this exact call site, it gets PayPal's deliberate throw
instead of a processed event.

### 2. `connectedAccountId` means a different kind of thing per provider

Stripe Connect's `createConnectedAccount` returns Stripe's own real account ID
synchronously. PayPal's Partner Referrals flow has no synchronous "create and
get an ID back" step — creating a referral only returns an approval link, and
PayPal's own merchant ID for that seller doesn't exist until they finish
onboarding, which can be hours or days later. The PayPal adapter's
`createConnectedAccount` returns PennyWise's own locally-generated tracking
reference instead, and every other method resolves PayPal's real merchant ID
from that reference internally when it's actually needed. This satisfies
`Promise<string>` but means `connectedAccountId` is a real provider-issued
identifier for Stripe and a purely local reference for PayPal — a caller
storing or comparing this value without knowing which provider it came from
could reasonably not expect that.

### 3. `providerSessionId`/`providerPaymentId` map onto two different PayPal object types

For Stripe, both names refer to facets of the same PaymentIntent. For PayPal,
`providerSessionId` (from `createHostedCheckout`) is an **order** ID, while
`providerPaymentId` (received by `retrievePaymentStatus`, `createRefund`,
`retrieveFeeAndSettlementMetadata`) needs to be a **capture** ID for refund
operations specifically — two different PayPal resource types passed through
one interface parameter name, with no compiler check that a caller passes the
right one to the right method.

## Boundary conditions

- **Do not weaken Stripe's contract to accommodate PayPal.** Stripe's
  synchronous webhook verification and synchronous connected-account creation
  are real, correct properties of how Stripe works — the interface change
  should let PayPal be honest about being different, not force Stripe to
  pretend it has PayPal's limitations.
- **A breaking change to a shared, already-shipped interface needs every call
  site checked, not just the two adapters.** This is the actual reason this
  is its own task instead of a same-day fix alongside the adapter.
- Money stays in bigint minor units and existing accounting/posting behavior
  for Stripe-based payments does not change.

## Options worth weighing, not a prescribed answer

For (1): either make `verifyWebhook` return `Promise<NormalizedProviderEvent>`
for every provider (Stripe's synchronous implementation trivially wraps in
`Promise.resolve(...)`, so this is likely the lower-risk direction, but every
caller in `payment-service.ts` needs to `await` it now), or split the
interface into a required sync method and an optional async one with a
documented rule for which providers use which.

For (2) and (3): the cleanest fix may be to stop assuming `connectedAccountId`,
`providerSessionId`, and `providerPaymentId` are interchangeable strings across
providers at all — branded/opaque types per provider, or accepting that each
adapter's internal bookkeeping (exactly what the PayPal adapter already does
with its tracking-id-to-merchant-id resolution) is the right place for this
complexity to live, with the interface staying as opaque strings and this
class-level documentation being the actual contract. Don't default to the
most elaborate option without checking what `payment-service.ts`'s real usage
pattern actually needs.

## Tasks

1. Read every `PaymentProviderAdapter` call site in `payment-service.ts` and
   record, concretely, what would break under each option above.
2. Decide, and record why, for each of the three mismatches.
3. Implement the interface change and update `stripe-payment-provider.ts` and
   `paypal-payment-provider.ts` (removing the latter's throwing synchronous
   `verifyWebhook` stub once the interface itself is async) to match.
4. Update every affected test — `payment-service`'s existing test suite,
   `stripe-payment-provider.test.ts` if one exists, and both files this
   session added.

## Acceptance criteria

- No caller anywhere can reach `PayPalPaymentProviderAdapter.verifyWebhook`'s
  current throw-always stub — either it's gone because the interface is now
  async, or every call site is confirmed to route PayPal through the async
  path already.
- `stripe-payment-provider.ts`'s behavior is unchanged for real Stripe
  organizations.
- `corepack pnpm lint`, `typecheck`, and the full payment-related test suite
  pass.

## Out of scope

Building a third payment processor. Changing anything about how Stripe itself
authenticates, checks out, or refunds.
