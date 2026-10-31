# Provider integrations handoff - current execution map

Owner authorization is in
[`SECOND_BETA_IMPLEMENTATION_2026-09-09.md`](SECOND_BETA_IMPLEMENTATION_2026-09-09.md).
Read the current evidence ledger at
[`../status/SECOND_BETA_PROGRESS_2026-09-09.md`](../status/SECOND_BETA_PROGRESS_2026-09-09.md)
before treating any adapter as usable. This document supersedes the stale
2026-09-08 prepared-only status language.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `SECOND_BETA_IMPLEMENTATION_2026-09-09.md`
4. The task named for the current lane below.

## Current status

| Lane                         | Controlling task                                      | Current state                                                                                                                                                                                                                                                                                      | Acceptance boundary                                                                                                                     |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PayPal and payment contracts | `PAYMENT_PROCESSOR_EXPANSION_PROMPT_2026-09-08.md`    | Implemented locally for one selected PayPal runtime: hosted order, explicit return-page capture, async verification route, capture-ID lookups, and provider-matched refunds.                                                                                                                       | No PayPal sandbox account or live transaction has been run. `customId` propagation and refund linkage remain external acceptance items. |
| Square                       | `SQUARE_HOSTED_PAYMENTS_IMPLEMENTATION_2026-09-11.md` | The installed official SDK and webhook/payment-link contracts were verified. The durable tenant-scoped checkout-expiry lease worker is implemented and RLS-tested. Square remains unimplemented and unselectable until the real provider-side cancellation adapter and startup recovery are wired. | Do not expose Square as available or substitute an app token for seller OAuth.                                                          |
| Payroll export and partners  | `PAYROLL_PROVIDER_CONNECTORS_PROMPT_2026-09-08.md`    | CPA-005 is byte-verified as a standalone builder. Provider gates correctly fail closed.                                                                                                                                                                                                            | No approved server-side bank-detail decryption boundary, downloadable batch export, CRA export, or live payroll provider exists.        |
| SMTP and Flinks              | `CUSTOMER_REQUIRED_INTEGRATIONS_PROMPT_2026-09-08.md` | SMTP has encrypted configuration, test-send-before-save, and a native encrypted submission to a real local implicit-TLS SMTP server. Flinks has hosted-consent/polling/account-map boundaries and local tests.                                                                                     | Local server and public token issuance are not real relay delivery or financial-institution acceptance.                                 |
| Receipt recognition          | `RECEIPT_OCR_UPGRADE_PROMPT_2026-09-08.md`            | Bundled local Tesseract recognizes real receipt images and image-only PDFs.                                                                                                                                                                                                                        | Azure OCR is intentionally absent; every extracted value remains review-first.                                                          |
| Independent payment review   | `PAYMENT_ADAPTERS_REVIEW_PROMPT_2026-09-08.md`        | Fact-checked against installed PayPal SDK types and current code.                                                                                                                                                                                                                                  | Retain the external PayPal sandbox items below.                                                                                         |
| Shared interface review      | `PAYMENT_INTERFACE_CONFIRMATION_PROMPT_2026-09-08.md` | Resolved: `verifyWebhook` accepts provider header maps and is awaited; Stripe compatibility remains tested.                                                                                                                                                                                        | Do not treat this as multi-provider routing.                                                                                            |

## Material repairs completed

- The Prisma runtime client previously lagged its public generated client and
  rejected `PAYPAL`/`SMTP`. The schema now contains two generators, so both
  clients are generated from the same schema in every build.
- The PayPal webhook route now preserves the exact body before JSON parsing and
  passes its required header set to the selected provider adapter.
- A PayPal-style approved order receives capture only on an explicit,
  token-bound POST. It does not post accounting before a verified webhook.
- A hosted payment from a different configured provider now fails refund with
  `PAYMENT_REFUND_PROVIDER_MISMATCH`; no local success or journal is created.
- The adapter distinguishes an order ID from a capture ID and retrieves a
  capture for status, fee, settlement, and refund work.
- Payment-account creation, provider status lookup, and onboarding-link creation
  no longer hold a tenant database transaction open while the external provider
  responds. The account state and audit event remain one short tenant transaction.
- Expired hosted-checkout cancellation now has durable claim timestamps, retry
  attempts, and redacted failure codes. `PaymentCheckoutExpiryWorker` processes
  one organization at a time through `payment_webhook` RLS, calls the provider
  only after the claim commits, and recovers abandoned claims after its lease.

## Evidence already run

- Full isolated database suite: 44 files / 247 tests passed in 323.96 seconds
  after the contextual-creation, payment-boundary, local SMTP-server,
  payment-connection transaction-boundary, and checkout-expiry lease changes.
- The focused expiry worker suites passed 4/4 unit tests and 2/2 database
  integration tests after migration `20260911120000_payment_checkout_expiry_leases`.
- API tests include PayPal adapter, Flinks adapter, local OCR, SMTP, and payment
  gate coverage. The ordinary root suite (335 tests), formatting, lint,
  typechecking, Prisma generation/validation, research verification, full
  integration suite, and workspace build passed on 2026-09-11. Packaging remains
  on hold.

## Do not overstate these items

- PayPal REST SDK response types are not webhook-event schemas. Capture and
  refund normalization remains hand-validated at the adapter boundary.
- `customId` is the uniform local correlation design, but its real PayPal
  webhook round-trip and refund linkage must be demonstrated in a sandbox
  before hosted PayPal payments are enabled for users.
- The application selects one hosted payment provider per running instance;
  it does not dispatch multiple processors per organization at once.
- Local SMTP/Flinks/OCR tests, source SDK inspection, and a public sandbox
  token do not prove a third party accepted an actual owner account or data.

## Packaging state

`0.14.0.15` remains frozen. Do not build a new transfer folder until the owner
ends the current source-change phase and the complete format, lint, typecheck,
Prisma, unit, integration, research, build, and installed-startup gates have
been rerun for a separately versioned candidate.
