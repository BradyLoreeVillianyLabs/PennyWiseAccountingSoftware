# I9 — "Pay online" that works when PennyWise runs on the owner's PC

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `stripe-payment-provider.ts`, `paypal-payment-provider.ts`, and the Square provider from
  B2-2
- `payment-provider.ts`, `payment-service.ts`
- `apps/api/src/index.ts`: provider selection, `35-107`
- `distribution/windows-native/launcher.cjs`, `734-736`
- `invoice-render-service.ts`
- The I6 jobs
- `apps/web/app.js`

**Closes:** G2, G3
**Effort:** L
**Depends on:**

- **B2 shared payment-contract review and local tests.** A finished platform Square
  adapter is not a prerequisite: implement the own-account adapter in this prompt.
- **I3**, for the "How to pay" block.
- **I6**, for polling.
- **The owner's decision below.**

## Context

- **The Stripe integration is a Connect platform.**
  - It uses Accounts v2 connected accounts, account links, and direct charges on
    `stripeAccount` (`stripe-payment-provider.ts:24, 42-107, 151`).
  - It needs a platform secret key in the environment (`index.ts:35-63`).
- **PayPal needs partner credentials:** a partner merchant ID and an attribution ID
  (`index.ts:40-77`).
- **One provider per installation,** chosen by an environment variable
  (`index.ts:48-52`).
- **Result:** a single business running PennyWise on its own PC has no platform account,
  so "Pay online" is effectively unavailable.
- **Links point at the owner's PC.** On installed builds, public invoice pages and payment
  return URLs are `http://127.0.0.1:<port>` (`launcher.cjs:734-736`). The UI already warns
  that the link only works on that computer (`app.js:9468-9471`).
- **Provider webhooks can't reach the PC either.**

## Owner decision (record before coding)

- **A. Platform model** (the current design). The vendor operates a Connect/partner
  platform and a hosted relay for public pages and webhooks. That relay is new hosted
  infrastructure and is out of scope here.
- **B. Own-account model** for local installs.
  - The business enters its own provider credentials. For Stripe, a _restricted_ key with
    minimal scopes; confirm the scopes from Stripe's docs.
  - Money goes straight to the business's own account.
  - PennyWise creates **provider-hosted** payment links or checkout on the provider's
    domain, and confirms payment by **polling**.

**Recommendation:** B for installed builds. Keep A for hosted deployments.

## Tasks (option B)

1. **Account mode per organization and provider:** `PLATFORM_CONNECTED` (existing) or
   `OWN_ACCOUNT`.
   - Credentials are encrypted with the existing protector and never returned by the API
     after they are saved.
   - A test-connection call.
   - In-product guidance on least-privilege keys.
2. **Several providers per organization** in OWN_ACCOUNT mode. The owner chooses per
   invoice, with an organization default. This replaces the single environment-chosen
   provider for this mode.
3. **Durable provider-hosted pay links.**
   - Keep durable invoice links separate from the existing 30-minute checkout lifecycle.
     Never expire a link printed on a PDF using that checkout timer.
   - An offline or sleeping PC cannot guarantee immediate provider deactivation.
     Persist pending changes, reconcile on reconnect, and handle verified late or excess
     receipts through an explicit unapplied/review path. Do not discard real payments
     merely because their notification arrives after local expiry.
     _(Rewritten in review: a link printed on a PDF
     must still work weeks later.)_
   - **Stripe:** use a **Payment Link**, not a Checkout Session. Checkout Sessions expire
     within 24 hours at most.
     - A Payment Link needs a Price, so create a one-off Product and Price for the invoice
       balance.
     - Set `restrictions.completed_sessions.limit = 1`.
     - Put the invoice id in `metadata`; it is copied to every Checkout Session the link
       creates.
     - Switch the link off with `active=false`.
     - Confirm the restricted-key permissions this needs from Stripe's docs.
   - **Square:** Checkout API payment links don't expire until they are deleted.
   - **PayPal:** orders left in `CREATED` expire after 3 hours by default, so an order
     approve link must never go in a document. Choose one of these, and record which:
     - use the Invoicing API share link (`send_to_recipient: false`), after confirming how
       long its payer link lasts; or
     - support PayPal only through the owner's static link (I3), with manual confirmation.
   - **When the balance changes** (a partial payment, credit note or void):
     - deactivate the old link and issue a new one;
     - a resend carries the new link;
     - the old link's inactive message tells the customer to contact the business.
   - Put the link in the email and in the PDF's "Pay online" block (I3).
   - The **renderer refuses loopback and private hosts** in customer-facing links. Add a
     test.
4. **Confirmation without inbound webhooks.**
   - An I6 job polls open sessions and links with backoff, and once on app start.
   - On success, it records the payment through the **same service path as webhooks**,
     using the same idempotency-key derivation from the provider payment id. A later
     webhook, in hosted mode, can then never double-apply.
5. **Fees:** record provider fees the way the existing fee handling does. If there is no
   fee handling yet, record that as a follow-up, and show the expected net deposit.
6. **Refunds** go through the provider API. Keep the fail-closed unsupported-provider rule
   recorded in `SECOND_BETA_PROGRESS_2026-09-09.md`.

## Constraints

- **Secrets:** no secrets in logs, exports or API responses.
- **Simulations:** clearly labelled and isolated from real organizations.
- **Money:** exact amounts only.
- **Currency:** foreign currency follows the CAD/USD rules.
- **Evidence:** an emulator run is test evidence, never proof of real provider acceptance
  (B2 evidence policy).

## Acceptance criteria

- **Emulator run:** local HTTP emulators for each supported provider exercise create link →
  paid → poll → the payment is recorded once. The run must use the real service and SDK
  paths.
- **Idempotency:** a webhook arriving after a poll-based payment does not double-apply.
- **Link safety:** loopback and private-host links are refused in documents.
- **Credential secrecy:** a saved key is never returned by any endpoint (test).
- **E2E:** finalize → the PDF contains the provider-domain link → the emulated payment →
  the invoice shows Paid.

## Out of scope

- Building the option A hosted relay.
- Card-present payments.
- Payment plans.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
