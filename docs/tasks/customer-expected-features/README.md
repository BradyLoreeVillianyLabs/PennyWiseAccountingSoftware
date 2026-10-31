# Customer-Expected Feature Build Roadmap

This directory preserves the implementation prompts for customer capabilities that were
absent or incomplete when the original ClearLedger release candidate was assessed.

The owner subsequently authorized execution through Phases 15-25 and the later
public-beta completion program. These prompt files remain useful specifications and
historical sequencing evidence; current scope and completion are controlled by
`../OWNER_REQUEST_LEDGER_2026-08-03.md`, `../PUBLIC_BETA_COMPLETION_PROGRAM_2026-08-03.md`,
and actual passing release evidence. Authorization does not manufacture provider
credentials, legal rights, professional acceptance, native signing infrastructure, or a
passing test result.

For the proposed lowest-friction delivery order for replacing separate paid
services, see [Service-Replacement Delivery Order](SERVICE_REPLACEMENT_DELIVERY_ORDER.md).
It maps those increments back to Phase 17-25 without creating duplicate
accounting or integration scopes.

Current delivery evidence is in
[Implementation Status](IMPLEMENTATION_STATUS.md). Exact external and
professional decisions needed for the remaining gated work are in
[Gated Feature Resolution](GATED_FEATURE_RESOLUTION.md). The product,
accounting, and engineering decisions about presets, editable settings,
accountant-controlled policy, immutable safeguards, and provider gates are in
[Accounting Workflow Configuration Decisions](ACCOUNTING_WORKFLOW_CONFIGURATION_DECISIONS.md).

## Original fastest effective release path

This was the initial sequencing recommendation. The owner later authorized all phases;
the current build still uses the dependency and evidence ordering below while closing
safe provider-independent work in parallel.

1. **Marketable controlled beta:** Phase 15, then Phase 16.
2. **High-value product parity:** Phases 17 through 20, ordered by verified beta
   demand. The default order shown below targets service businesses and
   bookkeeper-led adoption.
3. **Scalable paid distribution:** Phase 21.
4. **Expansion:** Phases 22 through 25 only when their evidence gates pass.

Manual subscription billing, white-glove onboarding, and CSV bank imports are
acceptable during the first bounded beta. This avoids delaying customer
learning for infrastructure that is only necessary at scale.

## Prompt index

| Phase | Prompt                                        | Customer outcome                                                      | Release priority                 |
| ----- | --------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| 15    | `PHASE_15_CONTROLLED_BETA_LAUNCH.md`          | Secure, observable Canadian beta deployment                           | Must ship first                  |
| 16    | `PHASE_16_CUSTOMER_EXPERIENCE_ACTIVATION.md`  | Plain-language, guided owner experience                               | Must ship second                 |
| 17    | `PHASE_17_SALES_AUTOMATION.md`                | Estimates, recurring billing, reminders, deposits, progress billing   | Highest feature priority         |
| 18    | `PHASE_18_PROJECTS_FIELD_PRODUCTIVITY.md`     | Projects, time, job profit, receipt capture, mileage, installable PWA | Service-business priority        |
| 19    | `PHASE_19_BANK_FEEDS_CASH_PLANNING.md`        | Live feeds, consent management, budgets, cash forecast                | Build after provider approval    |
| 20    | `PHASE_20_MIGRATION_PRACTICE_PLATFORM.md`     | Guided switching and multi-client bookkeeper operations               | Channel-growth priority          |
| 21    | `PHASE_21_COMMERCIAL_PLATFORM.md`             | Trials, subscriptions, entitlements, support operations               | Required before self-serve scale |
| 22    | `PHASE_22_DEVELOPER_PLATFORM_INTEGRATIONS.md` | Stable API, webhooks, connectors, payroll integration boundary        | Demand-gated expansion           |
| 23    | `PHASE_23_COMMERCE_OPERATIONS.md`             | Purchase orders, sales orders, barcodes, commerce sync                | Product-business expansion       |
| 24    | `PHASE_24_FRENCH_QUEBEC_TAX.md`               | French Canada and professionally validated Quebec tax workflows       | Geography-gated expansion        |
| 25    | `PHASE_25_NATIVE_MOBILE_COMPANION.md`         | Native capture and approval companion                                 | Evidence-gated, last             |

## Coverage of expected capabilities

- Onboarding, readable money, guidance, help, and product analytics: Phase 16.
- Quotes/estimates, customer approval, invoice conversion, recurring documents,
  reminders, deposits, retainers, and progress billing: Phase 17.
- Time, projects, job profitability, expenses, OCR capture, mileage, and mobile
  web use: Phase 18.
- Connected banking, consent renewal, fallback imports, cash planning, and
  budgets: Phase 19.
- QuickBooks Online, Wave, Xero, FreshBooks, Sage, and CSV switching plus
  bookkeeper practice management: Phase 20.
- Trials, plans, billing, entitlements, lifecycle messaging, support diagnostics,
  and operational analytics: Phase 21.
- Public API, outbound webhooks, integration credentials, commerce and payroll
  connectors: Phase 22.
- Purchase and sales orders, receiving/fulfilment, barcodes, and ecommerce stock
  synchronization: Phase 23.
- French UI/documents, QST, province rules, and filing-ready exports: Phase 24.
- Native iOS/Android: Phase 25 only if the PWA fails validated field-use needs.

## Build-efficiency rules for every prompt

1. Inspect current behavior before editing. Reuse the existing posting,
   reversal, tax, payment, document, inventory, banking, outbox, authorization,
   RLS, import, and reporting services.
2. Add one shared domain capability before adding multiple UI entry points.
3. Establish schemas, permissions, API contracts, and failure semantics before
   parallel-safe UI/provider work.
4. Use feature flags for incomplete provider-dependent or demand-gated
   capabilities. Flags must default off in production.
5. Keep provider adapters behind narrow interfaces. The domain must be testable
   without network access.
6. Do not duplicate accounting logic in web, workers, connectors, or mobile
   clients. All posting uses the existing atomic domain services.
7. Default automation to a draft or review state. No OCR, recurrence, bank rule,
   connector, or AI suggestion may autonomously post.
8. Add fixture builders and contract tests once, then reuse them across a phase.
9. Run targeted tests while editing and the complete repository quality gate
   once at the phase merge gate.
10. Stop at the phase completion report. A passing phase does not authorize the
    next one.

## Scope that remains deliberately excluded or fail-closed

Tax-return submission, manufacturing, bills of materials, lot/serial tracking, advanced
warehouse management, multi-country accounting, multi-entity consolidation, unsupported
FX workflows, POS hardware, lending, stored-value wallets, a full storefront,
unrestricted invoice HTML/canvas editing, and autonomous bookkeeping remain excluded.

The earlier provider-only payroll boundary is superseded by ADR 006 and the native
payroll implementation program. Native payroll engineering may proceed one exact
jurisdiction pack at a time, but the public beta must not claim statutory payroll until
the required formula vectors, permissions, security, UI, reports, correction,
professional acceptance, and release evidence pass. Government filing/payment and bank
transmission remain separate external gates. Phase 24 may produce reviewed exports; it
does not authorize automatic tax filing.
