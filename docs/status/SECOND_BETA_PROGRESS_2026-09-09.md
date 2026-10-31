# Second-beta progress - 2026-09-11

Controlling prompt: `../tasks/SECOND_BETA_IMPLEMENTATION_2026-09-09.md`.
Owner authorization remains recorded in `CURRENT_PHASE.md`. The frozen and
field-tested `0.14.0.15` installer is not modified. The owner has explicitly
placed new packaging on hold while source work continues.

| Increment                             | State                                   | Evidence and remaining boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B2-1 review and adapter repairs       | Implemented locally                     | CPA-005 fixed-record generation is byte-compared to the checked-in `moov-io/cadeft` fixture. PayPal uses the official installed SDK, async verification, an explicit capture POST, capture-ID retrieval, exact raw webhook bytes, and fail-closed cross-provider refunds. External PayPal sandbox acceptance is still unrun.                                                                                                                                                                                                                                                                                                   |
| B2-2 payment integration              | In progress; Square design investigated | The database supports `PAYPAL` and `SQUARE`; the selected runtime supports Stripe or PayPal. PayPal's locally exercised hosted return/capture and webhook boundaries are present. Payment connection setup now keeps provider calls out of the tenant write transaction. A durable, tenant-scoped checkout-expiry lease worker is now implemented and RLS-tested, but Square remains unimplemented and unselectable until its real provider-side cancellation adapter and startup recovery are wired. See `../tasks/SQUARE_HOSTED_PAYMENTS_IMPLEMENTATION_2026-09-11.md`. No hosted payments are enabled in the packaged beta. |
| B2-3 mail and bank feeds              | Implemented locally                     | SMTP encrypts the relay credential, test-sends before saving, and dispatches through a real local implicit-TLS SMTP-server acceptance test as well as protocol fixtures. Flinks implements hosted consent, encrypted credentials, polling, account mapping, and a public sandbox-token check. Neither a real email relay nor a real financial-institution consent journey has been accepted externally.                                                                                                                                                                                                                        |
| B2-4 payroll exports                  | Deliberately gated                      | The CPA-005 builder is real and byte-verified, but a posted batch cannot be turned into a real payroll file until an approved bank-detail decryption design exists. Worker bank details are client-encrypted and the API intentionally has no decryption path. CRA exports and every live submission remain unimplemented.                                                                                                                                                                                                                                                                                                     |
| B2-5 receipt recognition              | Implemented locally                     | Bundled Tesseract recognizes real image receipts and rasterized image-only PDFs without a cloud account. Extraction remains review-first. Azure Document Intelligence is not included and no cloud OCR claim is made.                                                                                                                                                                                                                                                                                                                                                                                                          |
| B2-UX company and contextual creation | Implemented; Chromium acceptance passed | Trial-company create/delete and contextual add flows for prerequisite customer, product, vendor, account, and tax records are wired and exercised against a fresh database. The contextual flow preserves the interrupted draft, refreshes the relevant selector, returns there, and keeps the explicit archive confirmation / final-company protection. Other browser engines remain unrun because the current specs intentionally skip them.                                                                                                                                                                                 |
| B2-6 validation and installer         | In progress; packaging on hold          | Current quality gates are recorded below. A new USB candidate must not be built until source changes stop and the post-change full gate is clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Current verified evidence

- `corepack pnpm db:generate` now regenerates both `generated-client` and the
  runtime `generated-client-d5` from one Prisma schema. This repaired the
  runtime enum mismatch that rejected valid `PAYPAL` and `SMTP` data despite
  typechecking successfully.
- `corepack pnpm test:integration` passed 44 files / 247 tests in 323.96 seconds
  on 2026-09-11 after the contextual-creation, payment-boundary, local SMTP
  server, payment-connection transaction-boundary, and checkout-expiry lease
  changes. It ran only against the isolated `clearledger_test` database on port
  5433, with all 115 migrations applied.
- The complete post-change source gate passed on 2026-09-11:
  `corepack pnpm format:check`, `corepack pnpm lint`,
  `corepack pnpm typecheck`, `corepack pnpm test` (335 tests),
  `corepack pnpm db:generate`, `corepack pnpm db:validate`,
  `corepack pnpm test:research`, and `corepack pnpm build`. The build refreshed
  both Prisma clients and built every workspace package; it did not package or
  modify the frozen installer.
- Migration `20260911120000_payment_checkout_expiry_leases` adds durable
  cancellation claims, attempt counts, and redacted failure codes without
  weakening the append-only checkout-history trigger. The expiry worker's unit
  suite passed 4/4 tests, and its database suite passed 2/2 tests through the
  payment-webhook RLS mode, including tenant isolation, provider failure
  persistence, and safe idempotency-key handling. Square is still disabled until
  the actual provider adapter and startup sweep are complete.
- `corepack pnpm test:e2e -- apps/web/e2e/company-management.spec.ts` passed the
  Chromium company create/archive journey on a clean database, including typed-name
  confirmation and the final-company guard.
- `corepack pnpm test:e2e -- apps/web/e2e/contextual-creation.spec.ts` passed three
  Chromium journeys on a fresh database: invoice-to-customer; product-to-revenue-account,
  product, and tax-code; and bill-to-supplier plus expense account. The run also passed
  the repository accessibility and performance release contracts. The remaining project
  browser configurations are intentionally skipped by these Chromium-only specs.
- `apps/api/src/smtp-local-server.integration.test.ts` starts a real local
  implicit-TLS SMTP server and passes an encrypted socket handshake, `AUTH PLAIN`,
  sender/recipient envelope, MIME message transfer, and `QUIT` through the native
  client transport. Its self-signed server certificate is trusted only by that test
  connector; this is not real-relay acceptance.

## Audit corrections retained as release conditions

- The PayPal review was fact-checked against the installed SDK. A capture has
  no merchant/payee field; a refund has an inconsistent optional payer/payee
  shape. `customId` is the code's uniform correlation field, but its webhook
  round trip has not been confirmed with a PayPal sandbox account.
- PayPal's return flow may request capture only by a token-bound POST. A
  verified webhook remains the only accounting-posting authority.
- The payment runtime is one selected provider at a time. It is not a
  multi-processor router, and any hosted payment belonging to another provider
  is rejected for refund rather than locally recorded as successful.
- A real email provider, bank institution, PayPal sandbox order, CRA filing,
  payroll-bank acceptance, or Azure OCR run is not implied by local tests.

## Current execution discipline

Keep actual local emulation, SDK/type validation, database integration, public
sandbox token issuance, and independent external acceptance as separate
evidence classes. Do not create credentials, transfer funds, submit filings, or
describe an unverified external step as passed.
