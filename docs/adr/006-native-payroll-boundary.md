# ADR 006: Native Payroll Core with Versioned Jurisdiction Packs

Status: accepted and owner-authorized; implementation active, public feature claim gated by the Definition of Done
Date: 2026-08-03

## Context

The owner has superseded the prior provider-only payroll boundary. ClearLedger will implement native payroll as a product capability. Its current ledger, RLS, audit/outbox, exact BIGINT money, period locks, role authorization, and controlled imports are foundations; it lacks payroll records, calculation rules, pay-run approvals, statutory packs, and payroll reports.

Payroll is legally and operationally sensitive. The [CRA employer guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html) assigns deduction, remittance, reporting, T4/T4A and ROE duties to the employer and describes Quebec's separate route. The [IRS 2026 employer guide](https://www.irs.gov/publications/p15) and [2026 withholding methods](https://www.irs.gov/publications/p15t) show that federal calculation is versioned and state/local requirements are separate.

## Decision

ClearLedger will build a native TypeScript payroll core with a versioned calculation and jurisdiction-pack boundary.

1. The core owns employees, employment/pay setup, approved time and earnings, pay schedules, immutable calculation snapshots, review/approval/post transitions, payslips, remittance obligations, accounting, reports, corrections, and YTD migration.
2. A jurisdiction pack is a signed/versioned, effective-dated data-plus-rule release: scope, authoritative URLs, formulas/tables, supported inputs, declarations, caps, outputs, source checksum, golden vectors, change notes and retirement policy. A pay run permanently records its pack and input snapshot.
3. P0 is Canada - Alberta, calendar year 2026. It calculates supported gross-to-net, produces payslips/liabilities, and posts only after review/approval. It supports regular/hourly pay, approved overtime, bonuses, vacation, approved deductions, reimbursements, and statutory Alberta/federal amounts defined in the P0 pack.
4. Canada expands one province/territory pack at a time; Quebec is an independent QPP/QPIP/Revenu Quebec program. The US expands as federal core plus one named state pack at a time, with locality as another explicit pack. Unknown work locations fail closed.
5. P0 creates reviewable payment/remittance instructions only. Direct deposit and automated government submission require separate money-movement/submission certifications, partner agreements, scoped authorization, security review, sandbox/production evidence, and jurisdiction acceptance.
6. Provider pay-run-summary file import remains a migration, historical/YTD, comparative-validation and outage fallback. It is labelled EXTERNAL_PROVIDER and never becomes the authority for a native calculation.

## Approval and posting

Preparer calculates; reviewer resolves exceptions; approver authorizes the locked snapshot; authorized payroll poster atomically commits the pay run/payslips, balanced journal, audit event and outbox. A member cannot prepare and approve/post their own run unless an owner enables a documented small-business exception with recent MFA and an audit reason.

Posted pay runs and payslips are immutable. Corrections are linked adjustment/reversal runs with matching accounting corrections. A pack or employee setup change cannot rewrite history.

## Consequences

- P0 may claim only "Native Alberta 2026 payroll calculation" after acceptance. It may not claim CRA filing, direct deposit, certification/compliance, all Canada, all states, or full-service payroll without exact supporting evidence.
- "Free/native" means a local ClearLedger calculation option; it does not eliminate employer legal duties, bank costs, advisor costs, or later provider/service costs.
- Pack capability is explicit and independent: CALCULATION_SUPPORTED, PAYMENT_EXPORT_SUPPORTED, DIRECT_DEPOSIT_SUPPORTED, and GOVERNMENT_SUBMISSION_SUPPORTED. A lower capability never implies a higher one.
- The payroll task must add a dedicated threat model, schema/RLS migration, vector suite, release owner, operations and privacy evidence.

Frappe HRMS/ERPNext GPL/AGPL-family repositories are workflow reference only: no code, schemas, formulas, UI, documentation, linking, embedding, distribution or derivation. The MIT [Payroll Engine](https://payrollengine.org/About/) is architectural reference only for effective-dated rules. ClearLedger will not add its .NET packages, backend, SDK, WebApp, container, database, or .NET sidecar. All shipped implementation is independently authored native TypeScript, with dependency license review.

## Sources

- [CRA T4032AB Alberta 2026](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032ab-jan.html/1000?wbdisable=true)
- [CRA 2026 CPP/EI tables](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032oc-jan/t4032oc-january-general-information.html)
- [CRA employer payroll guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html)
- [IRS Publication 15](https://www.irs.gov/publications/p15) and [Publication 15-T](https://www.irs.gov/publications/p15t)
- [Frappe HRMS GPL-3.0 repository](https://github.com/frappe/hrms) and [Payroll Engine MIT overview](https://payrollengine.org/About/)
