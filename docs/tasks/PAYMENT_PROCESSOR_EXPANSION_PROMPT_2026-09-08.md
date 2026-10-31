# Payment processor expansion — PayPal and Square alongside Stripe

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `apps/api/src/services/payment-provider.ts` — the existing `PaymentProviderAdapter`
   interface and `StripeTestModeAdapter`
4. `apps/api/src/services/payment-service.ts` (2,696 lines) — how the adapter is consumed
5. `apps/api/src/services/stripe-payment-provider.ts` — the live Stripe adapter's shape
6. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — payments entry

## Research already done — both are genuinely self-serve, no partnership needed to build

Both processors have real, public sandbox environments any developer can create today,
no business vetting required. This is what building against them actually looks like.

### PayPal — Partner Referrals + Orders API

Onboarding a merchant is a real, documented, two-call flow:

1. `POST https://api-m.sandbox.paypal.com/v1/oauth2/token` (Client Credentials grant,
   using your own PayPal Developer app's client ID/secret) returns a bearer token.
2. `POST https://api-m.sandbox.paypal.com/v2/customer/partner-referrals` with that
   bearer token, `Content-Type: application/json`, and a body naming the merchant's
   email, legal country, and the products they're onboarding for
   (`EXPRESS_CHECKOUT` covers cards, the PayPal button, and PayPal Credit):

   ```json
   {
     "email": "seller@example.com",
     "preferred_language_code": "en-US",
     "tracking_id": "org-<organizationId>",
     "individual_owners": [
       { "name": { "given_name": "…", "surname": "…" }, "role_type": "PRIMARY" }
     ],
     "business_entity": { "business_type": "INDIVIDUAL" },
     "legal_consents": [{ "type": "SHARE_DATA_CONSENT", "granted": true }],
     "operations": [{ "operation": "API_SIGNATURE_SETUP" }],
     "products": ["EXPRESS_CHECKOUT"],
     "legal_country_code": "US"
   }
   ```

   The response is `201 Created` with a HATEOAS `action_url` link — redirect the
   organization's owner there to complete onboarding in PayPal's own UI, exactly the
   role Stripe's `createOnboardingLink` plays today.

Sandbox account creation: sign up at `developer.paypal.com`, which gives you a sandbox
business (platform) account and can generate sandbox personal (buyer) and business
(merchant) test accounts from the dashboard — no approval wait, available immediately.

Reference: [Create partner referral](https://developer.paypal.com/api/partner-referrals/v2/partner-referrals-create),
[Seller onboarding](https://developer.paypal.com/docs/multiparty/seller-onboarding/before-payment/).

### Square — OAuth + Payments API

1. Authorization: `https://connect.squareupsandbox.com/oauth2/authorize?client_id=<SANDBOX_APP_ID>&scope=PAYMENTS_WRITE+MERCHANT_PROFILE_READ&state=<csrf>`
   — this is Square's equivalent of PayPal's `action_url` / Stripe's onboarding link.
2. Token exchange: `POST https://connect.squareupsandbox.com/oauth2/token` with the
   returned authorization code, exchanged for an access + refresh token pair.
3. Taking a payment: `POST /v2/payments` with a `source_id` (a payment token from
   Square's Web Payments SDK — never a raw card number), a required unique
   `idempotency_key`, and `amount_money` in the smallest currency unit. Requires the
   `PAYMENTS_WRITE` scope (`PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS` only if collecting a
   platform fee).

Sandbox account creation: any Square Developer account (`developer.squareup.com`) gets a
sandbox application and can generate sandbox seller test accounts and sandbox access
tokens directly from the dashboard — self-serve, no approval wait.

Reference: [OAuth API overview](https://developer.squareup.com/docs/oauth-api/overview),
[Create Payment](https://developer.squareup.com/reference/square/payments-api/create-payment),
[Sandbox](https://developer.squareup.com/docs/devtools/sandbox/overview).

## Exact intention

PennyWise accepts payment through Stripe only. An organization already using PayPal or
Square for their storefront or in-person sales has no reason to open a second merchant
account just to get paid through PennyWise's hosted checkout and invoice-payment links.
Add PayPal and Square as fully equal, selectable processors — not a Stripe-only product
with two names bolted on.

This is additive. Stripe stays exactly as it is; nothing about its behavior, its adapter,
or an organization already using it changes.

## Boundary conditions

- **Building the adapter is not the same as going live.** PayPal and Square each require
  their own merchant/partner agreement, API credentials, and webhook endpoint
  registration. Build both adapters against their sandbox environments with real,
  documented test credentials; going live for a real organization is a separate action
  gated on the owner actually holding production credentials for that processor.
- **The existing interface is shaped around Stripe Connect's vocabulary**
  (`createConnectedAccount`, `createOnboardingLink`) — a specific platform/marketplace
  onboarding model. PayPal's equivalent is Partner Referrals; Square's is OAuth plus a
  Square merchant account. Assess honestly whether `PaymentProviderAdapter` generalizes
  cleanly to both, or whether it needs to change shape. If it needs to change, do it
  without breaking `StripeTestModeAdapter` or any organization already configured for
  Stripe — add a migration path, not a parallel interface.
- **An organization picks its processor(s) explicitly.** Do not silently default a new
  organization to whichever adapter was implemented last. Extend the existing payment
  settings so an owner selects and configures one or more processors, matching the
  pattern `PaymentSettings` already uses for Stripe.
- **No card data ever touches PennyWise's own servers.** Both new adapters must use their
  processor's own hosted checkout/tokenization, exactly as the Stripe adapter already
  does. This is not a place to cut a corner for parity.
- Money stays in bigint minor units. Fees, refunds, and settlement timing differ by
  processor — do not average or approximate across them in reporting; show each
  processor's real numbers.

## Tasks

### 1. Confirm or adjust the adapter interface

Before writing either new adapter, decide whether `PaymentProviderAdapter` needs to
change to fit both PayPal and Square without distorting either one to look like Stripe.
Record the decision and why.

### 2. PayPal adapter

Implement `PaymentProviderAdapter` (or its adjusted form) against the Partner Referrals
and Orders/Payments APIs documented above, in sandbox mode: connected-account
onboarding (`createConnectedAccount`/`createOnboardingLink` → partner-referrals create →
`action_url`), hosted checkout, payment status, refunds, webhook signature verification,
and fee/settlement metadata. Create a sandbox developer account and both a sandbox
business and personal test account at `developer.paypal.com` to build and test against —
this takes minutes, not a partnership application. Mirror `StripeTestModeAdapter`'s
test-mode discipline — no real card or bank data surface in a development environment.

### 3. Square adapter

Same requirement against the OAuth and Payments API documented above, in sandbox mode.
Create a Square Developer account and generate a sandbox application, sandbox seller
test account, and sandbox access token from the dashboard at `developer.squareup.com` —
self-serve, no approval wait.

### 4. Organization-level processor selection

Add the setting and UI for an organization to enable one or more processors, see which
is active on a given invoice/checkout link, and switch without losing history on
payments already made through a processor they later disable.

### 5. Tests and documentation

- Adapter-level tests for both new processors mirroring the existing Stripe adapter
  test's coverage: checkout creation, refund, webhook verification (valid and tampered
  signature), and fee/settlement retrieval.
- An integration test proving an organization with two processors enabled routes each
  invoice/checkout correctly and reporting doesn't conflate their figures.
- Update `docs/COMPETITIVE_RESEARCH_MATRIX.md`'s payments entry with both new
  implementation contracts and any intentional exclusions.

## Constraints

- No change to Stripe's adapter behavior or to how an organization currently configured
  for Stripe operates.
- No live credentials, secrets, or production API keys committed anywhere.
- Reuse the existing encryption pattern (`AesPaymentAccountProtector` or its successor)
  for any stored processor credential — never a new, parallel secret-storage mechanism.

## Acceptance criteria

- An organization can enable PayPal and/or Square in settings, exactly like Stripe today.
- A hosted checkout, a refund, and a webhook event work end-to-end in sandbox mode for
  both new processors.
- Existing Stripe-only organizations see no behavior change.
- `corepack pnpm lint`, `typecheck`, and the relevant integration tests pass.

## Out of scope

Actually enabling any processor for a real, paying organization — that requires the
owner to hold real merchant credentials for that processor first. In-person/POS payment
processing beyond what `pos-service.ts` already does. A generic "any processor" plugin
system beyond these two named additions.
