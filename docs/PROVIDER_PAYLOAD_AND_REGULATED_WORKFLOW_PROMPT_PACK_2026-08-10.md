# Provider payload and regulated-workflow prompt pack

This pack is for an implementation agent working in this repository. It is deliberately
fail-closed: **actual payload verification means sanitized payloads captured from a store or
shop controlled by the project owner.** It never means scraping public data, using a customer
store, or substituting invented examples for provider acceptance.

## Current truth to preserve

- WooCommerce and Etsy adapters are `SHADOW_REVIEW`: provider evidence must not create a
  journal, invoice, payment, inventory movement, POS sale/return, tax filing, remittance, or
  payout without a later explicit, approved workflow.
- Product/catalog mapping and thumbnail ingestion are review-controlled. An approved image can
  become a compact local inventory thumbnail; importing evidence must not set opening stock.
- Manual CSV/OFX/QFX bank import and reconciliation are available. Live bank feeds are disabled.
- Native payroll has internal CA-AB regular-payroll foundations, but no released API/UI payroll
  workflow. Direct deposit, government filing/remittance, ROE/T4 submission, and other
  jurisdictions are separate gates.
- Do not call matching “flawless” yet. The current synthetic tests do not prove real native HTTP
  adapter parsing. Etsy poll and webhook copies now use the same receipt/version identity, and
  the inbox has regression coverage for cross-channel replay plus legacy webhook identities;
  sanitized owner-controlled provider fixtures are still required before any posting workflow.

## Official source roster

- WooCommerce REST API and current testing guidance: [REST API](https://developer.woocommerce.com/docs/apis/rest-api/) and [contribution testing](https://developer.woocommerce.com/docs/contribution/testing/).
- Woo resource contracts: [products](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/), [variations](https://developer.woocommerce.com/docs/apis/rest-api/v3/product-variations/), [orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/), [refunds](https://developer.woocommerce.com/docs/apis/rest-api/v3/refunds/), and [webhooks](https://developer.woocommerce.com/docs/apis/rest-api/v3/webhooks/).
- Etsy OAuth and API references: [authentication](https://developers.etsy.com/documentation/essentials/authentication/), [API reference](https://developers.etsy.com/documentation/reference/), [listing/inventory tutorial](https://developers.etsy.com/documentation/tutorials/listings/), [payments and ledger tutorial](https://developers.etsy.com/documentation/tutorials/payments/), and [webhooks](https://developers.etsy.com/documentation/essentials/webhooks/).
- Canadian payroll authorities for a later scoped release: [CRA T4001 employer guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html), [current T4127 index](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/t4127-payroll-deductions-formulas-computer-programs.html), [2026 payroll-deductions formulas](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html), [ROE Web access](https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/ei-roe/access-roe.html), and [Payments Canada Standard 005](https://www.payments.ca/sites/default/files/standard005eng.pdf).

The agent must reread current official provider documentation at execution time. APIs, OAuth
scopes, webhook contracts, payroll formulas, and government processes change.

---

## Prompt 1 — Capture authorized real provider evidence

> You are the provider-evidence lead for PennyWise Accounting. Work only with a developer-owned, non-production WooCommerce store and an authorized developer-owned Etsy shop/app. Start read-only. Do not request, copy, print, commit, or retain production credentials, customer data, browser sessions, payment tokens, address data, or raw production webhooks.
>
> First, read `docs/CATALOG_MATCHING_CONTRACT.md`, `docs/COMMERCE_CATALOG_OPERATIONS.md`, `docs/PROVIDER_GATE_MATRIX_2026-08-09.md`, `docs/DEVELOPER_API_V1.md`, and the current WooCommerce/Etsy official documents linked in `docs/PROVIDER_PAYLOAD_AND_REGULATED_WORKFLOW_PROMPT_PACK_2026-08-10.md`. State the exact API versions, endpoint URLs, OAuth scopes, test-account attestation, and capture time before collecting anything.
>
> WooCommerce: use an owner-controlled test store and its current `/wp-json/wc/v3` API to capture a simple product, variable parent, variation, paid order, partial refund, full refund, catalog pagination, and signed `product.updated`, `order.created`, and `order.updated` webhook deliveries. Capture a refund via the documented order/refund resources; do not invent a `refund.*` core webhook. Verify each actual delivery from raw bytes using `X-WC-Webhook-Signature` (base64 HMAC-SHA256), then discard the raw signed delivery.
>
> Etsy: use an authorized test shop with the least read-only scopes the official references require for shop, listing, listing inventory, receipt, transaction, payment, and ledger evidence. Capture listing pagination, listing detail, multi-product/multi-offering inventory, a paid receipt, a receipt with fees/tax/payout evidence when the test shop can produce one, and Webhook Portal test deliveries. Do not claim a general Etsy public sandbox exists. Verify `webhook-id`, `webhook-timestamp`, and `webhook-signature` over the documented raw message; reject values outside Etsy's documented timestamp window.
>
> Before export, deterministically sanitize each payload: remove API keys, OAuth tokens, cookies, webhook secrets/signatures, buyer/seller names, emails, phone numbers, addresses, IP/user-agent, notes/messages, tracking, payment identifiers, order keys, private URLs/query strings, and unreviewed metadata. Preserve JSON shape, null/optional behavior, numeric types, pagination, provider IDs rebased to clearly fictional values, monetary fields, tax/refund totals, and unknown fields. Do not keep a reversible mapping file. Re-sign webhook fixtures using a new fixture-only secret after sanitization.
>
> Produce no application code in this phase. Create a short evidence report with the capture manifest, a SHA-256 for every sanitized fixture, exact redaction rules, missing scenarios, and a hard stop if authorization or real test data is unavailable. Documentation examples alone are not “real payload verification.”

**Expected capture matrix**

```text
woo.product.simple
woo.product.variable-parent
woo.product.variation
woo.order.paid
woo.refund.partial
woo.refund.full
woo.webhook.product.updated
woo.webhook.order.created
woo.webhook.order.updated

etsy.listing.page
etsy.listing.detail
etsy.listing.inventory
etsy.receipt.paid
etsy.receipt.transaction
etsy.receipt.payment-and-ledger (when authorized test evidence exists)
etsy.webhook.order.paid
etsy.webhook.order.canceled
etsy.webhook.order.shipped
etsy.webhook.order.delivered
```

---

## Prompt 2 — Turn sanitized evidence into a native-adapter regression suite

> You are the senior test engineer for PennyWise Accounting. You have received only the sanitized, manifested fixtures created by Prompt 1. Implement the fixture harness and regression suite; do not add provider credentials, disable review gates, make live requests, or change QBWooBridge/any production deployment.
>
> Read the existing WooCommerce/Etsy connectors, commerce normalization, catalog mapping service, sync service, POS service, current integration tests, and the contract/operations documents. Preserve the existing `SHADOW_REVIEW` accounting boundary.
>
> Create this fixture layout exactly, with a readable README and a manifest schema:
>
> ```text
> apps/api/src/services/connectors/__fixtures__/provider-payloads/
>   README.md
>   manifest.v1.json
>   _shared/redaction-sentinels.json
>   _shared/expected-schema-version.json
>   _shared/approved-image.png
>   woocommerce/wc-v3/
>     simple-paid/
>     variable-duplicate-sku/
>     variable-no-sku/
>     refunds-and-rounding/
>     cancelled-and-deleted/
>     catalog-pagination/
>     inventory-write/
>     webhook-retry-and-revision-conflict/
>   etsy/open-api-v3/
>     receipt-product-alias-no-sku/
>     receipt-marketplace-tax/
>     receipt-payments-and-refunds/
>     ledger-fees-reserves-refunds/
>     catalog-states-pagination/
>     catalog-multi-product-offerings/
>     inventory-write-multi-offering/
>     webhook-retry-and-poll/
> ```
>
> Every scenario has `request.json`, `response.json`, `headers.json` when applicable, and `expected-normalized.json`. `manifest.v1.json` records provider, endpoint/event, API version, capture date, fixture SHA-256, test-account attestation, sanitization reviewer, and intentionally rebased identifiers. The suite must reject a fixture containing an email, address, token, real signature, order key, IP, personal `.com` data, or a mismatch between its declared and actual SHA-256.
>
> Add the following tests:
>
> ```text
> apps/api/src/services/connectors/provider-payload-fixtures.test.ts
> apps/api/src/services/connectors/woocommerce-real-payload.regression.test.ts
> apps/api/src/services/connectors/etsy-real-payload.regression.test.ts
> apps/api/src/commerce-provider-payloads.integration.test.ts
> apps/api/src/catalog-provider-payloads.integration.test.ts
> apps/api/src/commerce-pos-boundary.integration.test.ts
> apps/web/e2e/provider-catalog-inventory-regression.spec.ts
> ```
>
> Use actual `WooCommerceConnector` and `EtsyConnector` with deterministic fixture HTTP clients, not fake adapters, for provider parsing tests. Preserve raw-body signature verification and delivery-id idempotency. Test invalid, stale, wrong-shop, duplicate, tampered, unsupported, and replayed callbacks.
>
> Required assertions:
>
> 1. Woo `variation_id: 0` means no variation. Store/product/variation identity wins over a conflicting duplicated SKU or title. Missing identity becomes review-required, never a guessed match.
> 2. Woo products/variations paginate without loss. Partial/full refunds reconcile exactly, including tax/shipping/fee rounding. Same revision with changed content becomes an integrity conflict.
> 3. Etsy uses shop + listing + inventory product/offering identity and preserves integer `amount/divisor` money without floating-point drift. Product aliases resolve only through confirmed mappings. No-SKU records remain safe.
> 4. Etsy multi-product/multi-offering writes change only the requested offering and have response-loss/concurrency coverage. Payment, fee, reserve, refund, payout, and marketplace-tax evidence remains review-required until a separately accepted settlement policy exists.
> 5. Verify the canonical provider-event identity: polling and webhook evidence for the same Etsy receipt/revision must coalesce, a webhook delivery ID alone must not create a second event, legacy `webhook:` identities must replay safely, and the stored raw evidence must retain the webhook envelope when it is the first observation. Retain traceability to both observations through audit/delivery evidence.
> 6. Provider catalog → image review → safe ingestion → bulk local-product creation → `productImageReference` → inventory thumbnail works end to end. It creates zero opening stock, journals, invoices, payments, POS records, inventory movements, tax filings, remittances, or payouts.
> 7. A commerce import never creates a POS shift, tender, sale, return, or cash event. A separately stocked local item may only be sold through the existing server-authoritative POS workflow.
> 8. Etsy marketplace-facilitated versus seller-remitted tax is explicitly `review-required`; no test may call it remitted, excluded, filed, or posted automatically. WooCommerce Core must not be treated as a universal processor-fee or settlement source.
>
> Keep the change focused. Do not label the matching engine flawless until all tests pass with real, sanitized controlled-store evidence and the reconciliation gaps are closed.

---

## Prompt 3 — Execute the evidence-backed verification and issue a release verdict

> You are the independent release verifier. Use an isolated disposable database only. Do not run against the Brady share database, a production database, or QBWooBridge. First confirm that all fixtures were captured from authorized test accounts and satisfy the redaction manifest. If not, report `BLOCKED — AUTHORIZED REAL PAYLOADS MISSING`; do not downgrade to synthetic examples.
>
> Run the smallest focused suite first, then integration and browser coverage. Capture command output, test count, and failures. Suggested commands, adjusted only if the repository scripts require it:
>
> ```powershell
> corepack pnpm typecheck
>
> corepack pnpm --filter @clearledger/api exec vitest run --config vitest.config.ts `
>   src/services/connectors/provider-payload-fixtures.test.ts `
>   src/services/connectors/woocommerce-real-payload.regression.test.ts `
>   src/services/connectors/etsy-real-payload.regression.test.ts
>
> $env:DATABASE_URL = $env:TEST_DATABASE_URL
> corepack pnpm --filter @clearledger/db run migrate:deploy
> corepack pnpm --filter @clearledger/api exec vitest run --config vitest.integration.config.ts `
>   src/commerce-provider-payloads.integration.test.ts `
>   src/catalog-provider-payloads.integration.test.ts `
>   src/commerce-pos-boundary.integration.test.ts
>
> corepack pnpm test:e2e -- apps/web/e2e/provider-catalog-inventory-regression.spec.ts --project=chrome
> corepack pnpm test:release
> ```
>
> Report: fixture provenance/redaction result; exact provider behavior observed; unit/integration/UI outcomes; normalizations and conflicts exercised; image/thumbnail proof; no-write/POS-boundary proof; remaining unknown payload fields; and a verdict using only `PASS`, `FAIL`, or `BLOCKED`. A `PASS` here means _review-first provider acceptance for the tested scenarios_, not production posting, tax remittance, payroll, banking, direct deposit, or filing acceptance.

---

## Prompt 4 — Implement a narrow, robust Canadian payroll product (Luna 5.6, xhigh)

> You are `gpt-5.6-luna` with extra-high reasoning, acting as the payroll release engineer for PennyWise Accounting. Build only a bounded Canadian payroll release: **regular payroll for Alberta employees paid in CAD**, based on a current official CRA rule pack. Do not claim or implement CRA filing/remittance, ROE/T4 submission, direct deposit, Quebec, other provinces, U.S. payroll, contractor tax determination, or payroll-provider certification in this scope.
>
> Before modifying code, read `docs/adr/006-native-payroll-boundary.md`, `docs/research/PAYROLL_STATUTORY_RULES_2026.md`, the payroll services/migrations/integration tests, `docs/PROVIDER_GATE_MATRIX_2026-08-09.md`, and current official CRA material. Recheck the current T4127 index and the in-force edition/date before choosing any formula or vector. Treat formula/rule input as versioned data with effective dates and provenance—not hard-coded constants.
>
> Start with a written implementation plan and a gap table for: employee/pay-group setup; TD1 and province-of-employment inputs; earnings/deductions; CPP/CPP2/EI/income-tax calculations; employer contributions; pay-period/YTD handling; exact money; payslip; review/approval/segregation of duties; correction/reversal; immutable journal/audit/outbox; remittance obligations; reporting/export; security/privacy; and a web/API workflow. Preserve the existing service foundations only when their behavior is verified by tests.
>
> Implement in phases:
>
> 1. **Rule and data integrity:** versioned Alberta 2026 (or current approved effective-date) rules, exact decimal/integer money, official test vectors plus edge cases, annual/YTD limits, negative/reversal behavior, deterministic recalculation, and no silent rounding.
> 2. **Governed pay-run workflow:** draft → calculated → exception review → approval → posting with immutable snapshot, role checks, audit records, idempotency, period locks, and a small-business separation-of-duties exception only when explicitly authorized/audited.
> 3. **Accounting and obligations:** atomically create balanced journals and open remittance obligations only after approved posting; make corrections linked reversals/adjustments, never mutable posted history.
> 4. **API/UI:** expose a tightly bounded payroll workbench with employee setup, pay-run grid, exception panel, preflight, payslips, audit trail, remittance-obligation view, and clear unavailable-feature labels. Do not expose a button that implies funds are sent or a government return is filed.
> 5. **Test and release proof:** unit, integration, permission/RLS, concurrency/idempotency, calculation-vector, posting/reversal, privacy, browser accessibility, and migration tests. Use a disposable database. Produce a release evidence table containing the source/version/date of every rule and the test result it supports.
>
> Stop and report `BLOCKED` rather than guessing if an official rule, required data model decision, or test vector is unclear. Do not reuse GPL/AGPL payroll code, formulas, schemas, or UI; independently author the implementation and review dependency licenses. The public claim after this work may be no stronger than the exact accepted Alberta scope.

---

## Prompt 5 — Design, but do not prematurely ship, live bank feeds, direct deposit, and filing

> You are the regulated-integration architect for PennyWise Accounting. Produce an implementation-ready design and test plan; do not connect a real institution, transmit money, file a return, or market the capability as available.
>
> Use three separate programs with separate release gates:
>
> 1. **Live Canadian bank feeds:** select an approved aggregation provider only after owner approval, contract, cost, privacy/residency, consent, deletion, reconnect, outage, webhook, cursor, duplicate/pending-to-posted, and sandbox/live-fixture acceptance decisions. Preserve CSV/OFX/QFX as the supported fallback. Store consent, encrypted connection material, sync cursor, and audit events with strict tenancy; provider data must not create postings without existing review rules.
> 2. **Direct deposit:** choose a sponsoring financial institution/payment processor and obtain its explicit technical/compliance program. Do not infer that a stored payment-batch/export record is a payment rail. A future implementation needs payee verification, secure bank-data handling, authorization, file/transmission generation or API initiation, idempotency, funding/settlement, acknowledgement, rejects/returns, reversals, cutoffs, reconciliation, incident response, and sandbox certification. For a Canadian file route, assess Standard 005 only with the sponsoring institution's rules and approval.
> 3. **Government filing/remittance:** treat CRA remittance, T4/T4A, and ROE as authority-specific integrations. Implement an obligation/reporting workflow first, then obtain government/provider authorization, submission format and test environment, receipt/acknowledgement, amendment/correction, outage/manual fallback, record retention, access control, and accountant/legal acceptance. Never infer that a calculated obligation has been paid or filed.
>
> For each program, return: owner decisions needed; data classification/threat model; provider and legal prerequisites; proposed API/UI/event/state model; non-production test fixtures; sandbox acceptance tests; operations/runbook; exact public claim allowed before/after the gate; and a `NOT RELEASED` verdict until every dependency is evidenced.
