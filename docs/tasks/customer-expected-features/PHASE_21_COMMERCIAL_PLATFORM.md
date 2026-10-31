# Phase 21 Codex Task — Commercial Platform

Execute only after Phase 20 acceptance, approved plans/prices/terms, an approved
billing provider, and explicit owner authorization.

## Objective

Replace manual beta administration with self-serve trials, subscriptions,
entitlements, lifecycle messaging, support operations, and privacy-safe product
analytics suitable for a paid Canadian launch.

## Boundary

Commercial billing records belong to the ClearLedger SaaS operator, not to a
customer organization's accounting ledger. Keep the commercial control plane
logically and authoritatively separate from tenant books. A customer may
download ClearLedger's subscription invoices/receipts and choose to record them
in its books, but no automatic self-posting is permitted.

## Requirements

- Add versioned plans, prices, billing intervals, trials, coupons/partner codes,
  taxes applicable to ClearLedger's own sale, subscription state, cancellation,
  grace periods, and effective-dated entitlements.
- Use hosted billing-provider checkout/portal and signed, idempotent webhooks.
  Do not store card data.
- Entitlements must be checked server-side through one capability service.
  Financial data remains readable/exportable during a billing grace period;
  never hold legally required exports hostage.
- Add trial start/end, upgrade/downgrade, renewal, payment failure, dunning,
  cancellation, reactivation, refund, and plan-retirement behavior with complete
  operator audit.
- Add self-serve organization creation under configurable abuse limits, email
  verification/OIDC, consent/terms versions, and deletion/export entry points.
- Add a support console for tenant-safe metadata, redacted diagnostics,
  provider/job health, consented support access, access expiry, and audit.
  Support staff must not gain standing access to financial content.
- Add lifecycle email preferences and privacy-safe aggregate activation,
  retention, conversion, cancellation-reason, reliability, and support metrics.
- Add a public pricing/plan comparison and in-product usage/limit explanations.
  Do not make unsupported compliance or automation claims.

## Efficiency constraints

Ship only the owner-approved launch plans. Do not build a general pricing rules
engine. Use manual credits/refunds and support workflows for rare cases. Keep
marketing content static unless measured editing frequency justifies a CMS.

## Tests and acceptance

- Billing state-machine, webhook replay/order, price-version, proration policy,
  tax, entitlement, grace, cancellation, refund, and provider-outage tests.
- Tests proving commercial workers cannot access tenant ledger tables and
  customer export remains available under billing restrictions.
- Abuse/rate-limit, support-consent expiry, audit, analytics minimization, and
  privacy-request tests.
- Provider sandbox E2E from trial through paid renewal and failed-payment
  recovery.
- Reconciliation between provider subscription events and the commercial
  control plane, without posting to tenant ledgers.

Acceptance requires deterministic entitlements, recoverable webhook processing,
clear customer billing UX, no card storage, and no commercial-to-ledger
privilege escalation.

Write the Phase 21 completion report, update current phase, and stop.
