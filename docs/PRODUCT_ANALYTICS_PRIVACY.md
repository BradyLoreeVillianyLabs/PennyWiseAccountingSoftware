# Product Analytics Privacy Boundary

## Purpose

ClearLedger's optional product analytics help the beta team understand whether
workflows are usable. They are not accounting records, customer records,
support tickets, or a behavioral advertising system.

## What is collected

When an organization owner or administrator enables the setting, the product
can record only these fields for a fixed allowlist of workflow events:

- organization identifier used solely for tenant isolation;
- random client event identifier for retry idempotency;
- allowlisted event type and schema version; and
- event timestamp.

It does not accept amount, customer, vendor, document, account, SKU, email,
free-text, attachment, browser fingerprint, or IP-address payloads through
the product-event API.

## Consent and withdrawal

- The choice is organization-scoped and starts disabled.
- Only an owner or administrator may change it.
- Members may view the current organization choice so the application can
  honor it consistently.
- Events before the recorded consent timestamp are rejected.
- Withdrawing consent stops future collection and deletes the organization's
  stored product-event telemetry in the same transaction. The withdrawal is
  retained in the tenant audit trail; telemetry itself is not accounting or
  audit evidence.
- The 2026-08-09 scope-change migration deliberately purges legacy telemetry
  that cannot be proven to have organization-level consent. That privacy
  transition is intentionally irreversible at the data level.

## Access and reporting

Application reads and writes occur only in the current tenant transaction and
are protected by forced row-level security. There is no cross-organization
product-event endpoint in the application runtime.

For an approved internal learning report, use:

```powershell
$env:PRODUCT_ANALYTICS_REPORT_DATABASE_URL = "postgresql://separate_readonly_reporting_role:..."
corepack.cmd pnpm product-analytics:report
```

The reporting connection must be separately provisioned by a database
administrator. It must not be the runtime, application, or test credential.
The script refuses `DATABASE_URL`, `TEST_DATABASE_URL`, and usernames that
identify a runtime credential. Its output contains only event type, event
count, and organization count for event types observed in at least five
organizations. It never prints organization IDs or event-level data.

Do not lower the five-organization threshold, use the report for automated
pricing/eligibility decisions, or merge it with customer, support, payment,
or advertising data.

## Operational checks

Before enabling the setting in a beta:

1. Confirm the help copy matches this document.
2. Verify a non-owner cannot change consent.
3. Verify a pre-consent event is rejected.
4. Verify withdrawal removes event rows and leaves a tenant audit event.
5. If aggregate reporting is needed, have a DBA independently review the
   reporting role and keep its output access-controlled.
