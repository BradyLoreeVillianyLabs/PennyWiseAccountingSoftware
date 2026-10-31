# PennyWise Accounting Document Index

## Repository-wide instructions

- `../AGENTS.md`
- `../CODEX_MASTER_PROMPT.md`
- `tasks/TASK_EXECUTION_STANDARD.md`
- `status/CURRENT_PHASE.md`

Codex should not read every document for every phase. Each authorized task lists its required reading.

## Core specifications

| File                                                  | Purpose                                                                                               | Primary reviewer                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| `PRODUCT_REQUIREMENTS.md`                             | Product scope, users, workflows, and MVP limits                                                       | Product lead                      |
| `ACCOUNTING_POSTING_RULES.md`                         | Deterministic accounting consequences                                                                 | CPA/controller                    |
| `ARCHITECTURE.md`                                     | System boundaries and technical patterns                                                              | Principal engineer                |
| `SECURITY_AND_COMPLIANCE.md`                          | Security and Canadian compliance controls                                                             | Security/privacy lead             |
| `PERMISSION_MATRIX.md`                                | Role and permission baseline                                                                          | Security + product                |
| `API_GUIDELINES.md`                                   | API conventions                                                                                       | API lead                          |
| `MIGRATION_AND_PORTABILITY.md`                        | Imports, exports, and closure operations                                                              | Operations + product              |
| `CATALOG_MATCHING_CONTRACT.md`                        | Source-neutral catalog candidate scoring and safeguards                                               | Product + engineering             |
| `PRODUCTION_OPERATIONS.md`                            | Privacy, incident, access-review, and secrets procedures                                              | Security + privacy                |
| `BACKUP_AND_RECOVERY.md`                              | Backup, restoration, and recovery drill controls                                                      | Security + operations             |
| `ACCEPTANCE_TESTS.md`                                 | Behavioural release gates                                                                             | QA + CPA                          |
| `IMPLEMENTATION_PLAN.md`                              | Phase order and exit gates                                                                            | Engineering lead                  |
| `DECISIONS_AND_OPEN_QUESTIONS.md`                     | Decisions and unresolved issues                                                                       | Product + engineering             |
| `CRM_AND_CALENDAR.md`                                 | Contacts, relationship timeline, configurable non-posting planning                                    | Product + engineering             |
| `PAYROLL_OPERATIONS_AND_AUTOMATION.md`                | Controlled CA-AB payroll setup, scheduled-draft credential, human controls, and provider gates        | Payroll operations + security     |
| `CONNECTED_BANK_FEEDS.md`                             | Provider-gated hosted-consent bank-feed setup, review-only import, and production acceptance          | Security + operations             |
| `COMMERCE_PROVIDER_SETUP.md`                          | Exact WooCommerce/Etsy credentials, OAuth/scopes, webhooks, polling, authority policies, and rollback | Commerce operations + security    |
| `COMMERCE_PROVIDER_PAYLOADS.md`                       | WooCommerce/Etsy payload normalization, identity, evidence, tax, retry, and conflict rules            | Commerce engineering + controller |
| `COMMERCE_CATALOG_OPERATIONS.md`                      | Review-first catalog, matching, product creation, image, and quantity operations                      | Commerce operations + product     |
| `NORTH_AMERICAN_TAX_AND_MARKETPLACE_REMITTANCE.md`    | US/Canada marketplace tax/remitter evidence controls and operating checklist                          | Controller + tax advisor          |
| `COMPETITIVE_RESEARCH_MATRIX.md`                      | Required comparable-product research baseline and update contract for every module                    | Product + engineering             |
| `QUICKBOOKS_DESKTOP_FEATURE_GAP_REVIEW_2026-08-13.md` | Current QuickBooks Desktop settings/functionality comparison and phased PennyWise response            | Product + engineering             |

## Status

| File                                                               | Purpose                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `status/PHASE_01_COMPLETION_SUMMARY.md`                            | Concise Phase 1 evidence and carried risks                                      |
| `status/PHASE_02_COMPLETION_REPORT.md`                             | Phase 2 implementation and verification evidence                                |
| `status/PHASE_03_COMPLETION_REPORT.md`                             | Phase 3 implementation and verification evidence                                |
| `status/PHASE_04_COMPLETION_REPORT.md`                             | Phase 4 implementation and verification evidence                                |
| `status/PHASE_05_COMPLETION_REPORT.md`                             | Phase 5 implementation and verification evidence                                |
| `status/PHASE_06_COMPLETION_REPORT.md`                             | Phase 6 implementation and verification evidence                                |
| `status/PHASE_07_COMPLETION_REPORT.md`                             | Phase 7 implementation and verification evidence                                |
| `status/PHASE_08_COMPLETION_REPORT.md`                             | Phase 8 implementation and verification evidence                                |
| `status/PHASE_09_COMPLETION_REPORT.md`                             | Phase 9 implementation and verification evidence                                |
| `status/PHASE_10_COMPLETION_REPORT.md`                             | Phase 10 implementation and verification evidence                               |
| `status/PHASE_11_COMPLETION_REPORT.md`                             | Phase 11 implementation and verification evidence                               |
| `status/PHASE_12_COMPLETION_REPORT.md`                             | Phase 12 implementation and verification evidence                               |
| `status/PHASE_13_FINDINGS.md`                                      | Phase 13 adversarial review findings register                                   |
| `status/PHASE_13_COMPLETION_REPORT.md`                             | Phase 13 implementation and verification evidence                               |
| `status/CURRENT_PHASE.md`                                          | Completed, next expected, and blocked phases                                    |
| `status/QUICKBOOKS_BETTER_ROADMAP_COMPLETION_REPORT_2026-08-09.md` | Six-phase QuickBooks-comparable, better roadmap and final verification evidence |

## Product and market research

| File                                                                                               | Purpose                                                                       |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `MARKET_RELEASE_ASSESSMENT_2026-08-03.md`                                                          | Current public-beta segment, competitor workflows, claims, and go-to-market   |
| `MARKET_POSITION_2026-08-01.md`                                                                    | Launch wedge, competitive position, switching, and release gates              |
| `HELP_AND_DEMO_EXPERIENCE.md`                                                                      | Guided help, visual hierarchy, and isolated demo-company contract             |
| `PRODUCT_VALUE_AND_GO_TO_MARKET_2026-08-08.md`                                                     | Evidence-backed value, market, beta pricing, and exit assessment              |
| `COMMERCIALIZATION_PROMPTS_2026-08-08.md`                                                          | Ordered implementation prompts for revenue and production readiness           |
| `DESIGN_PARTNER_BETA_INSTRUMENT_2026-08-08.md`                                                     | Consent-safe partner interview, onboarding, and value scorecard               |
| `PRODUCT_ANALYTICS_PRIVACY.md`                                                                     | Organization consent, telemetry minimization, withdrawal, and report boundary |
| `PAID_BETA_RELEASE_RUNBOOK_2026-08-08.md`                                                          | Verified package, paid-beta operations, and external launch gates             |
| `PROVIDER_PAYLOAD_AND_REGULATED_WORKFLOW_PROMPT_PACK_2026-08-10.md`                                | Authorized Woo/Etsy payload, regression, payroll, banking, and filing prompts |
| `research/README.md`                                                                               | Durable source registry and PennyWise Accounting product implications         |
| `research/Accounting Software Feature Demand and Monetization in the United States and Canada.pdf` | Owner-supplied North American feature, pricing, and acquisition report        |

## Phase tasks

The cumulative no-drop inventory for owner steering is
`tasks/OWNER_REQUEST_LEDGER_2026-08-03.md`; the public-beta execution gate is
`tasks/PUBLIC_BETA_COMPLETION_PROGRAM_2026-08-03.md`.

| File                                                   | Status                 | Purpose                                                                  |
| ------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------ |
| `tasks/PHASE_1_CODEX_TASK.md`                          | Completed/historical   | Ledger foundation assignment                                             |
| `tasks/PHASE_02_IDENTITY_TENANCY.md`                   | Completed              | Production identity, memberships, permissions, and RLS                   |
| `tasks/PHASE_03_COMPANY_SETUP.md`                      | Completed              | Business setup, taxes, presets, opening balances, and branding           |
| `tasks/PHASE_04_SALES_INVOICE_ACCOUNTING.md`           | Completed/historical   | Customers, products, invoices, credit notes, and receivables             |
| `tasks/PHASE_05_INVOICE_DOCUMENTS.md`                  | Completed/historical   | Invoice templates, PDFs, email delivery, public viewing, and attachments |
| `tasks/IMPLEMENT_CRM_AND_CLIENT_ACTIVITY_PROMPT_V3.md` | Implemented 2026-08-06 | Flexible CRM and calendar foundation                                     |

## Prepared customer-expected feature prompts

The concise ordered product-improvement roadmap is
`tasks/QUICKBOOKS_BETTER_PHASED_PROMPTS.md`.

The roadmap and Phase 15-25 prompts are under
`tasks/customer-expected-features/`. They began as planning artifacts; the owner later
authorized execution through Phase 25 and the subsequent public-beta completion work.
The current implementation/release authority is the cumulative owner-request ledger and
public-beta completion program above. External provider, legal, accounting, identity,
and native-platform evidence is not manufactured or waived merely because engineering
work was authorized. Start with `tasks/customer-expected-features/README.md` for the
original dependency and exclusion rationale.

## Change policy

Specifications may be refined when implementation exposes a defect, but Codex must:

1. identify the conflict;
2. assess accounting, security, migration, and product impact;
3. choose the conservative solution;
4. record the decision;
5. update affected tests and documentation.
