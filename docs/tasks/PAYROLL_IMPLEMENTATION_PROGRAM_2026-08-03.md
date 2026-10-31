# Native Payroll Implementation Program

Status: owner-authorized and active; public feature claim requires the complete acceptance matrix
Date: 2026-08-03
Supersedes: provider-only payroll boundary.
Decision: native ClearLedger payroll with versioned jurisdiction packs. Provider summary import is migration/fallback, not the product boundary.

## 1. Product decision and competitive parity

ClearLedger will own employee/pay records, gross-to-net calculation, payslips, accounting, remittance register, reviews, approvals, corrections, reports and YTD migration. This is the local, native alternative to paying for an external payroll calculation subscription. It does not mean filings, tax advice, payment transport, benefits administration, or government/bank services are free.

| Market workflow                                                                                                                                                                                                     | Native ClearLedger target                                                   | Initial boundary                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [QuickBooks](https://quickbooks.intuit.com/payroll/core/), [Wave](https://www.waveapps.com/payroll), [Wagepoint](https://www.wagepoint.com/payroll)                                                                 | employees, schedules, calculations, pay statements, remittances, accounting | calculation/payslips/accounting/instructions; no direct deposit or filing |
| [Gusto](https://gusto.com/product/payroll/features), [Rippling](https://www.rippling.com/en-CA/products/payroll), [ADP](https://www.adp.com/what-we-offer/payroll.aspx), [Paychex](https://www.paychex.com/payroll) | approvals, payroll/HR change control, taxes, payment and reporting          | approval/audit calculation core first; HR/payment/filing separately gated |
| [Xero with Gusto](https://www.xero.com/us/accounting-software/payroll/)                                                                                                                                             | account mapping and payroll-journal review                                  | native run is the accounting source, then posts balanced journal          |
| [Frappe HR](https://docs.frappe.io/hr/payroll-setup)                                                                                                                                                                | salary setup, assignment, payroll entry, YTD and accrual/payment separation | independent TypeScript workflow only                                      |

Customer pain points addressed: recurring provider cost for simple payroll, disconnected time/pay/accounting data, manual pay journals, uncertain liability/cash timing, opaque corrections, and mid-year migration/YTD cap errors. Customer pain not addressed in P0: provider-operated deposits, agency filing, all-jurisdiction compliance or HRIS breadth.

Release copy must name the exact active pack and capability. Prohibited without exact evidence: "CRA filed," "direct deposit," "certified/compliant in Canada," "all provinces/states," "full-service payroll," or "free payroll."

## 2. P0 functional target: CA-AB 2026

P0 supports an Alberta employer paying Alberta employees in CAD on weekly, biweekly, semimonthly or monthly schedules with 2026 pay dates. The pack is based on [CRA T4032AB 2026](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032ab-jan.html/1000?wbdisable=true), [CRA 2026 CPP/EI data](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032oc-jan/t4032oc-january-general-information.html), [Alberta deduction/pay-statement rules](https://www.alberta.ca/ar/deductions-from-earnings), and [Alberta vacation pay](https://www.alberta.ca/vacation-pay). Pack source, retrieval date, legal effective date, signer, checksum and golden vectors are persisted.

### Supported P0 function

- Employee identity/contact, employment dates, Alberta work location, classification, effective salary/hourly rate, masked/encrypted SIN, TD1 data, manual/payment-export method and authorized deductions.
- Regular hourly/salary earnings, approved overtime, bonus, taxable/non-taxable reimbursement, vacation accrual/payout, fixed/percentage deductions with authority metadata.
- Exact 2026 federal/Alberta withholding, CPP/CPP2, EI and employer contributions from the active pack, including annual caps and employee YTD carry-forward.
- Draft, calculated, reviewed, approved and posted runs; secure payslips with earning/deduction/net/employer/YTD detail; liability/remittance register; accounting, correction and reporting.
- Payment/remittance instructions as reviewable CSV/PDF only. No transmission to banks, CRA or any government service.

### P0 fail-closed scope

Reject Quebec, all other provinces/territories, US, non-CAD, multi-province employment, collective agreement rules, benefits-carrier enrollment, workers compensation, non-approved garnishment logic, ROE/T4/T4A generation/submission, government submission, direct deposit, unsupported earning/deduction, retroactive tax-table correction and worker-classification advice. Route users to provider import/manual approved fallback without calculating a best guess.

The P0 pack encodes rather than hard-codes: 2026 CPP regular/first additional 5.95% employee/employer up to $74,600 after the $3,500 exemption; CPP2 4% from $74,600 to $85,000; EI outside Quebec employee 1.63% and employer 2.282%; plus the exact T4032AB federal/Alberta tables and claim codes. Alberta vacation policy is effective-dated, with supported 4%/6% rules as stated in the pack. Any source change needs a new reviewed pack before calculation.

## 3. Canada/US jurisdiction and certification matrix

| Scope           | Calculation                      | Payslip/accounting/remittance register | Payment/submission             | Required acceptance                                                                                       |
| --------------- | -------------------------------- | -------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| CA-AB 2026      | P0                               | P0                                     | instruction export only        | payroll-specialist/accountant pack review, CRA/AB vectors, security/accessibility/reconciliation evidence |
| Canada non-QC   | one province/territory at a time | after exact pack acceptance            | separate bank/CRA gate         | current T4032/labour rules, vectors, effective-date migration and release approval                        |
| Quebec          | deferred separate program        | deferred                               | deferred                       | QPP/QPIP/RQ/RL-1/ROE specialist and operational evidence                                                  |
| US federal 2026 | deferred federal core            | after federal acceptance               | no EFTPS/IRS submit by default | IRS Pub. 15/15-T vectors, W-4, FICA/FUTA, privacy/legal review                                            |
| US state        | one named state at a time        | after state acceptance                 | separately certified           | registration, withholding/SUI/PFL/SDI and locality scope tests                                            |
| US local        | explicit locality only           | after locality acceptance              | deferred                       | employer/local agency validation                                                                          |
| Global/EOR      | unsupported                      | provider import only                   | provider only                  | new ADR/program                                                                                           |

The future US federal 2026 pack uses [IRS Publication 15](https://www.irs.gov/publications/p15), [Publication 15-T](https://www.irs.gov/publications/p15t), and their applicable forms. IRS sources currently state Social Security 6.2% each to the $184,500 wage base, Medicare 1.45% each without wage base, and 0.9% employer withholding of Additional Medicare over $200,000. This is a test baseline, not enabled US coverage.

## 4. Domain, calculation, and accounting contract

Every payroll record is organization-scoped/RLS-protected, versioned and audited. Persist amounts in BIGINT minor units and use rational/approved fixed precision for rates/hours; never persist JavaScript number.

| Record                      | State/invariant                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| JurisdictionPack            | DRAFT -> REVIEWED -> ACTIVE -> RETIRED; immutable after review; one effective active pack; source/checksum/vector required |
| Employee                    | effective-dated employment/tax/pay setup; termination preserves history; sensitive fields encrypted                        |
| PaySchedule                 | effective frequency, period boundaries, pay date and cutoff; cannot mutate a posted run                                    |
| Earning/DeductionDefinition | code, taxability, authority, pack compatibility, mappings and effective date                                               |
| PayrollInput                | approved time/one-off earning/deduction; immutable when snapshotted                                                        |
| PayRun                      | DRAFT -> CALCULATED -> REVIEWED -> APPROVED -> POSTED; REJECTED before post; POSTED -> REVERSED or ADJUSTED                |
| Payslip                     | encrypted/authorized immutable document from pay-run snapshot; no public URL                                               |
| RemittanceObligation        | OPEN -> INSTRUCTED -> MARKED_PAID -> RECONCILED or CANCELLED; no agency payment in P0                                      |
| ProviderImportRun           | separate external/migration status and evidence; never overwrites native history                                           |

Calculation resolves one active pack by employee work location and pay date; validates approved inputs/YTD/declarations; computes earnings, taxable bases, employee deductions, employer contributions, net and remittance obligations deterministically; and retains a trace of pack rule, inputs, base, rounding and output. Approval blocks negative net, missing declaration, cap anomaly, material variance, unmapped account, duplicate period, retired/new pack, unauthorized input and closed period.

Posting atomically commits immutable pay run/payslips, source-linked balanced journal, liabilities, audit and outbox. Standard accrual: debit wage/benefit/vacation/employer-payroll expense; credit net-pay clearing/payable, employee deductions payable and employer contribution liabilities. Funding separately debits net-pay clearing and credits bank when confirmed. Remittance separately debits liability and credits bank. Never infer settlement from calculation.

Corrections create a linked adjustment/reversal run. They never mutate a posted run, payslip, journal, pack or YTD snapshot.

## 5. UI and workflow contract

| Screen                        | Required behavior                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Payroll overview              | active pack and capability badge, next run, approval queue, remittance/clearing exceptions, YTD status                             |
| Employees                     | effective employment/location/pay/declaration/deduction setup; masked sensitive values; termination/correction reason              |
| Pay schedules and definitions | frequency/calendar/pay date/cutoff/approvers; pack-compatible earnings/deductions and GL mappings                                  |
| Prepare run                   | select schedule/period, ingest approved inputs, calculate, show exceptions, gross/net/employer/remittance totals and variance      |
| Review/approve                | calculation trace, pack/source versions, exceptions, account preview; send-back creates new draft; no silent calculated-value edit |
| Payslip                       | secure employee-specific detailed view/download; no public URL; employee self-service is later scope                               |
| Remittances                   | obligations/due dates/instruction export/record-paid reference/bank match; no agency-submit control P0                             |
| Reports                       | register, employee YTD, employer cost, liabilities, remittances, clearing and GL reconciliation, labelled with pack/version        |
| Switching/YTD                 | controlled provider/history import, map-preview-reconcile-approve-commit; no raw provider HR/paystub/bank files                    |

Accessibility is release-blocking: semantic form/table labels, linked error summaries, keyboard calculation/review/approval, visible focus, non-colour status, responsive tables/detail at 200% zoom, accessible payslip print/PDF and zero sensitive text in URL/toast/aria label.

## 6. API and permission contract

All routes use organization context from membership, strict Zod validation, bounded pagination, optimistic version, audit correlation, and Idempotency-Key on create/transitions.

| Route                                          | Operations                                                | Permission                                            |
| ---------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| /v1/payroll/capability and /jurisdiction-packs | read scope; create/review/activate/retire pack            | payroll:read; payroll:pack-manage                     |
| /v1/payroll/employees                          | list/create/update/terminate/effective settings           | payroll:read; payroll:employees:manage                |
| /schedules, /definitions, /inputs              | configure and submit/approve inputs                       | payroll:configure; payroll:inputs:manage/approve      |
| /runs                                          | draft/calculate/review/approve/post/reject/reverse/adjust | payroll:runs:prepare/review/approve/post/correct      |
| /runs/:id/payslips                             | secure document metadata/download                         | payroll:payslips:read                                 |
| /remittances and /reports                      | obligation/instruction/mark-paid/reconcile and reports    | payroll:remittances:read/manage; payroll:reports:read |
| /migrations and /provider-imports              | YTD/provider upload-preview-reconcile-commit              | payroll:migrate; payroll:provider-import              |
| /payment-exports                               | approved instructions only                                | payroll:payment-export                                |

Add default-deny permissions: payroll:read, payroll:pack-manage, payroll:employees:manage, payroll:configure, payroll:inputs:manage, payroll:inputs:approve, payroll:runs:prepare, payroll:runs:review, payroll:runs:approve, payroll:runs:post, payroll:runs:correct, payroll:payslips:read, payroll:remittances:read, payroll:remittances:manage, payroll:reports:read, payroll:migrate, payroll:provider-import and payroll:payment-export.

OWNER/ADMIN/ACCOUNTANT configure/activate/post. A future PAYROLL role may prepare inputs/runs but is not silently granted to sales, purchases, inventory or read-only roles. Pack activation, YTD commit, correction, post and payment export require recent auth/MFA. Same-person prepare/approve/post is blocked except audited owner exception.

## 7. Migration and provider fallback

Provider summary import accepts only redacted aggregate run/history data: provider/run/correction ID, dates, currency, category totals and accounting evidence. Reject bank account/routing data, SIN/SSN, TD1/W-4, addresses, raw payslips and raw HR files. It creates an EXTERNAL_PROVIDER reconciliation/journal only and never a native payslip/calculation.

The YTD wizard records old provider/legal entity/last paid-remitted date/first native date/cutover authority; ingests redacted register, YTD totals, liabilities, remittance and clearing evidence; maps to encrypted controlled employee YTD fields and GL; creates non-posting reconciliation; blocks variance without accountant-approved correction; atomically posts opening/cutover journal + immutable YTD/audit/outbox; prevents overlap; and validates first native run/caps/funding/remittance reconciliation.

## 8. Security, privacy, tests, and Definition of Done

Encrypt government identifiers, declarations and payslips; mask on display; use isolated object keys/no-store responses/no indexing; never log payroll input, trace, payslip, identifier or payment detail. Audit employee access/change, pack activation, calculation/review/approval/post, payslip access, exports, remittance, correction and migration. Update the threat model for salary disclosure, rule tampering/stale packs, duplicate funding, malformed imports, remittance fraud, ransomware and privileged misuse.

Required evidence: authoritative P0 vectors for every rule/pay frequency/cap/CPP2/EI/claim code/rounding/YTD; pack immutability/effective-date tests; input/schedule/segregation/concurrency tests; journal/reconciliation/idempotency/rollback/correction/period-lock tests; RLS/MFA/PII/log/export tests; import scanner tests; browser/accessibility tests; 500-employee run performance baseline; restore/recalculation evidence.

P0 DoD: Alberta 2026 vectors calculate exactly; normal and exception pay runs complete prepare-review-approve-post; payslip/YTD/liability/clearing reports reconcile; correction is immutable; unsupported provinces reject; bank/CRA submission controls are absent/disabled; payroll specialist + accountant accept pack/mapping; security review accepts privacy/authorization; release copy says "Alberta 2026 native calculation - payment and government submission not included."

Phased order:

1. Foundation: feature flag, permissions, threat model, fail-closed capability, payroll source/account controls.
2. Pack engine + CA-AB 2026: independently authored rule engine, signed packs, CRA/AB source snapshots/vectors.
3. Employees/setup/inputs: effective data, declarations, rates, approved time/deductions and accessible UI.
4. Pay runs/payslips/accounting: segregation, immutable source/docs, journals/liabilities/reports/corrections.
5. YTD/provider fallback: controlled migration/import and cutover reconciliation.
6. Payment/remittance transport: only with bank/agency partner certification and live evidence.
7. Canada one pack at a time; Quebec separate; then US federal plus one state at a time.

## 9. License policy and sources

Frappe HRMS GPL-3.0 and all GPL/AGPL repositories are workflow reference only. Do not copy, link, embed, distribute or derive code, schema, formulas, UI or documents. [Payroll Engine](https://payrollengine.org/About/) is MIT architectural reference only; do not use its .NET code, packages, backend, SDK, WebApp, database, container or .NET sidecar. ClearLedger remains native TypeScript in the modular monolith, with dependency license review.

Primary sources: [CRA Alberta 2026](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032ab-jan.html/1000?wbdisable=true), [CRA CPP/EI](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032oc-jan/t4032oc-january-general-information.html), [CRA T4001](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html), [Alberta deductions](https://www.alberta.ca/ar/deductions-from-earnings), [Alberta vacation](https://www.alberta.ca/vacation-pay), [IRS Pub. 15](https://www.irs.gov/publications/p15), [IRS Pub. 15-T](https://www.irs.gov/publications/p15t), [Frappe HRMS](https://github.com/frappe/hrms), and [Payroll Engine](https://payrollengine.org/About/).
