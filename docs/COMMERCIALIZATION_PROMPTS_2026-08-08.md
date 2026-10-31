# ClearLedger commercialization implementation prompts

These prompts are ordered for a senior implementation agent. Each prompt is a bounded
build request, not permission to bypass the current phase gate. Execute one prompt at a
time, inspect the repository first, reuse existing services and contracts, and stop if a
security, tenancy, accounting, legal, or external-provider decision cannot be resolved by
repository evidence.

Every prompt must deliver only the smallest useful API/web/schema change, focused tests,
updated documentation, and concrete verification evidence. No prompt may weaken immutable
posted history, exact money handling, tenant isolation, default-deny authorization,
idempotency, review-first imports, or the existing centralized tax boundary.

## 1. Product truth and evidence audit — executed now

> Inspect the current ClearLedger repository, release evidence, active phase, integrations,
> and controlled-beta limitations. Produce an evidence-backed product truth report that
> separates implemented, review-only, gated, and missing capabilities. Do not inflate claims.
> Identify the narrowest paid wedge and the five metrics that prove customer value. Update
> docs only, run formatting, and link every conclusion to repository evidence.

**Deliverable:** `docs/PRODUCT_VALUE_AND_GO_TO_MARKET_2026-08-08.md`.

## 2. ICP and design-partner discovery instrument

> Add a repository-native, privacy-safe design-partner checklist and feedback contract for
> Canadian service businesses, commerce sellers, and bookkeeping firms. Reuse the existing
> bug-report/help and tenant audit patterns. Capture workflow, migration source, exception
> count, close time, and willingness-to-pay without collecting unnecessary financial values
> or secrets. Add focused validation tests if code changes are required.

**Exit evidence:** a completed interview script, consent language, success metric schema,
and a repeatable onboarding checklist.

## 3. Production identity and tenant access

> Implement production OIDC/session configuration and owner/admin membership access using
> the existing identity and authorization services. Fail closed when configuration is
> absent, keep localhost identity development-only, test revoked sessions and cross-tenant
> access, and document deployment secrets without committing them. Do not add a second auth
> system.

## 4. Billing and entitlements

> Add a provider-agnostic subscription/entitlement boundary that can support hosted billing
> later. Keep plans and limits out of accounting posting, verify webhook signatures and
> idempotency, and fail closed for unverified billing events. Start with a manual beta plan
> flag if a live billing contract is not available; do not invent payment credentials.

## 5. Migration concierge and onboarding

> Extend the existing Switching Centre with a narrow paid-beta onboarding checklist,
> source-selection guidance, mapping review, preview, dry run, commit, reconciliation, and
> export handoff. Preserve immutable source provenance and never silently post ambiguous
> records. Add focused tests for source mismatch, replay, review exceptions, and completed
> reconciliation.

## 6. Proof-of-value telemetry

> Extend the existing privacy-safe product-event path with events for onboarding completion,
> import preview, dry run, review resolution, reconciliation variance, invoice delivery,
> and close readiness. Store no raw documents, customer names, emails, or financial amounts;
> respect consent and tenant scope. Add retention and export/delete documentation.

## 7. Security and compliance readiness

> Create a threat model and operational control map covering tenant isolation, secrets,
> backups, restore drills, audit logs, incident response, vendor risk, DPA, terms, and
> support access. Reuse existing release/security scripts. Add only actionable controls;
> do not claim SOC 2, ISO, PCI, or tax certification without an independent assessment.

## 8. Connector/provider gate matrix

> Document and enforce separate readiness gates for WooCommerce, Etsy, banks, payroll, OCR,
> and tax providers: credentials, contracts, scopes, rate limits, webhook verification,
> retention, failure handling, and acceptance evidence. Keep adapters review/shadow mode
> until each gate passes. Never enable live connector-to-ledger posting from a client flag.

## 9. Accountant partner console

> Extend the existing accountant and multi-company workspaces with client onboarding status,
> books-health findings, migration batches, exception queues, reconciliation state, and
> export handoff. Reuse membership permissions and keep every organization query tenant
> scoped. Add focused authorization and usability tests.

## 10. Production operations

> Define a supported deployment with managed PostgreSQL, migrations, backups, restore,
> monitoring, alerting, audit review, rate limits, support runbooks, and incident response.
> Verify readiness in a clean environment and document rollback. Do not treat a tunnel or
> local always-on computer as production hosting.

## 11. Marketing, demo, and case-study surfaces

> Build a small, truthful public demo and beta landing surface using the existing web
> client/documentation conventions. Explain review-first imports, CAD/USD scope, current
> provider gates, data export, and beta limitations. Add permissioned case-study capture;
> do not publish customer or accounting data by default.

## 12. Exit readiness

> Prepare an IP/dependency inventory, architecture diagram, data export guide, security
> evidence index, customer/revenue cohort report, provider-contract register, support
> metrics, cap-table/legal checklist, and buyer diligence packet. Preserve the ability to
> operate independently; do not optimize for a sale before retention and customer value are
> demonstrated.

## Execution order and current status

1. Product truth/evidence audit — **completed in this repository update**.
2. Design-partner instrument — next narrow implementation target.
3. Production identity — prerequisite for self-serve beta, separately gated.
4. Billing, onboarding, telemetry, security, provider gates, partner console, operations,
   marketing, and exit readiness — execute only after their prerequisites are verified.

The immediate commercial experiment is five to ten paid, founder-assisted design partners;
the prompts above are intentionally sequenced so distribution and evidence arrive before
high-risk infrastructure or broad provider enablement.
