# ClearLedger Robust Payroll Build Prompt

## Handoff

Use this document as the execution prompt for **Luna 5.6 Extra High**. It is written for the current ClearLedger repository, not for a greenfield application. The goal is a production-grade, Canada-first payroll workspace that feels as immediate as QuickBooks Payroll while being more transparent, safer to approve, easier to audit, and honest about jurisdiction and filing boundaries.

This prompt is intentionally phased. Complete each phase, run its required tests, record the result, and then continue. Do not stop at a mock, a happy-path demo, or a polished screen that is not connected to the existing tenant-scoped accounting core.

## Research and evidence collected before implementation

Treat these sources as the starting evidence set. Re-check them at implementation time and record the retrieval date, effective date, source URL, source checksum, and interpretation in the rule-pack documentation. Do not hard-code a tax rate or employment-standard rule from memory.

### Government and statutory sources

- [CRA T4127 Payroll Deductions Formulas](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html) — current formula editions and effective periods.
- [CRA T4127 January 2026 computer-program formulas](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html) — federal/provincial tax, CPP, EI, special payments, rounding, and software-calculation guidance.
- [CRA T4001 Employers’ Guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html) — employer accounts, TD1/SIN inputs, deductions, employer contributions, remittance schedules, due dates, payment methods, and penalties.
- [CRA How to calculate deductions](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/how-to-calculate.html) — choosing T4127, PDOC, and Quebec WebRAS paths.
- [CRA Alberta 2026 payroll deductions table](https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-ab-1-26e.pdf) — official Alberta calculation table and test-vector source.
- [CRA RC4120 T4 guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4120/employers-guide-filing-t4-slip-summary.html) — T4 slip/summary and information-return requirements.
- [CRA T4 2026 XML specification](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2026/t4-2026.html) — machine-readable year-end output contract.
- [CRA Web Forms](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/filing-information-returns-electronically-t4-t5-other-types-returns-file/filing-web-forms.html) — filing boundary and account/access context.
- [Service Canada Record of Employment](https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/ei-roe.html) and [ROE completion guide](https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/reports/roe-guide.html?=undefined) — ROE data, employer workflow, and ROE Web boundary.
- [Alberta vacations and vacation pay](https://www.alberta.ca/vacation-pay) — accrual, percentage, payment timing, and termination payout rules.
- [Alberta general holidays](https://www.alberta.ca/alberta-general-holidays) — eligibility, holiday calendar, regular-day rules, average daily wage, and holiday-pay options.
- [Alberta termination and lay-off](https://www.alberta.ca/employment-standards-termination-and-lay-off) — notice/termination pay, final-earnings timing, and final-pay components.

### Successful product workflow references

- [QuickBooks Payroll Canada](https://quickbooks.intuit.com/ca/payroll/) — pay schedules/automation, direct-deposit boundary, CRA/Revenu Québec filing claims, time tracking, employee self-service, T4/RL-1, ROE, and integrated bookkeeping.
- [QuickBooks payroll run guide](https://quickbooks.intuit.com/learn-support/en-ca/help-article/direct-deposits/run-payroll-quickbooks-desktop-payroll/L4q6koYLd_CA_en_CA) — the proven task sequence: choose scheduled/unscheduled/final pay, verify dates/account, select workers, enter hours, inspect paycheque detail, review, create paycheques, distribute pay stubs.
- [QuickBooks payroll reports](https://quickbooks.intuit.com/learn-support/en-ca/help-article/payroll-reports/run-payroll-reports/L13oTu2Ps_CA_en_CA) and [payroll summary](https://quickbooks.intuit.com/learn-support/en-ca/help-article/payroll-reports/create-payroll-summary-report/L5VdgcgrR_CA_en_CA) — report discoverability, filtering, customization, exports, gross/net, deductions, contributions, and employer-cost reporting.
- [Wagepoint Payroll](https://www.wagepoint.com/payroll/) — guided payroll, remittances, T4/T4A, ROE, and small-business self-service workflow.
- [Humi payroll reports guide](https://support.humi.ca/hc/en-us/articles/4410193525271-Payroll-Reports-Guide) — payroll register, T4 preview, remittance review, PDF/Excel exports, and employee-level reporting.
- [Humi payroll overview](https://embed.humi.ca/payroll-2?lng=en) — off-cycle payroll, CSV hours, PTO/vacation, employee access, payroll digest, and reporting expectations.
- [ADP Canada payroll](https://www.adp.ca/en/what-we-offer/payroll.aspx) — payroll plus employee self-service, tax/reporting support, and scalable workforce operations.

These references inform information architecture and task order only. Do not copy their branding, source code, proprietary content, or claims. ClearLedger’s advantage must be explainable calculations, evidence-linked review, strict approvals, tenant isolation, and an explicit “what is and is not submitted” boundary.

## Execution prompt for Luna

> You are Luna 5.6 Extra High acting as the lead product engineer, payroll-domain engineer, security engineer, QA lead, and release manager for this repository. Build the requested feature directly in the existing ClearLedger codebase. Inspect the repository and current tests before editing. Preserve working user changes and existing accounting behavior. Work in small verified increments, use parallel workstreams where files do not overlap, and never claim a capability that is only mocked or partially implemented.
>
> The product is Canada-first small-business accounting software. Build a robust payroll capability with **Canada–Alberta as the first shippable jurisdiction and tax year**, while designing a versioned rule-pack boundary for future provinces and countries. The system must calculate, explain, review, approve, post, pay/export, reconcile, report, correct, and retain payroll records without rewriting history.
>
> ### Repository entry points you must use
>
> Start by reading these files and their nearby tests:
>
> - `packages/db/prisma/schema.prisma`
> - `packages/db/prisma/migrations/20260804030000_payroll_domain_foundation/migration.sql`
> - `apps/api/src/services/payroll-service.ts`
> - `apps/api/src/services/payroll-statutory-service.ts`
> - `apps/api/src/payroll-core.integration.test.ts`
> - `apps/api/src/services/payroll-statutory-service.test.ts`
> - `apps/api/src/services/demo-company-service.ts` (`ensureExpandedPayroll`)
> - `apps/api/src/auth/permissions.ts`
> - `apps/api/src/app.ts`
> - `apps/api/src/http/schemas.ts`
> - `apps/web/index.html`, `apps/web/app.js`, `apps/web/styles.css`
> - `apps/web/README.md`
> - `docs/adr/006-native-payroll-boundary.md`
>
> The repository already contains payroll schema models, a tenant-scoped `PayrollService`, a statutory calculator, an Alberta rule pack, approval/posting primitives, payment-batch records, payslip snapshots, remittances, audit/outbox behavior, payroll permissions, a payroll integration test, and demo payroll seeding. Do not replace that foundation.
>
> The first confirmed integration gap is that `apps/api/src/app.ts` does not yet expose a complete payroll route/controller boundary, and the existing web shell has no dedicated payroll workspace. Wire the existing service into the established API and web conventions. Confirm the current state with search before changing it; do not assume this document is newer than the checkout.
>
> Current limitations that must be surfaced honestly and either completed or explicitly gated:
>
> - Native calculation/posting currently releases only regular periodic Canada–Alberta runs with complete supported inputs.
> - Off-cycle and correction runs require their own tested rule-pack behavior.
> - Canada–Quebec and US rule-pack definitions must not be presented as complete support unless their formulas, vectors, forms, and filing boundaries are actually implemented and tested.
> - Payment batches and exports are instructions/exports until a separately certified money-movement connector exists.
> - Government filing must remain preview/export/manual-submission or provider-gated until credentials, contracts, sandbox evidence, security review, and production acceptance exist.

## Non-negotiable engineering and compliance rules

1. Use tenant-scoped transactions and authorization on every read and write. Enforce organization IDs in queries, relations, unique keys, and tests. Add or preserve RLS/composite-key protections where this repository uses them.
2. Store money as integer minor units and time as integer micro-hours or another exact representation already used by the repository. Never use floating-point arithmetic for payroll. Define rounding at every statutory boundary and test it.
3. Store effective-dated worker profile, jurisdiction, tax elections, compensation, benefits, deductions, PTO policy, and bank details. A posted run must contain immutable worker, input, component, rule-pack, explanation, YTD, and payslip snapshots.
4. Encrypt SIN/government identifiers and bank details through the existing protection pattern; return only masked values; never write secrets or full identifiers to logs, analytics, browser storage, screenshots, fixtures, or error messages.
5. Separate preparer, reviewer, approver, poster, payment operator, and filing operator. Preserve the existing payroll permissions and implement a two-person control by default. If a small-business exception is supported, require recent re-authentication/MFA, an explicit reason, and an audit event.
6. Draft, calculated, reviewed, and approved states must remain off-ledger. Only the authorized post transition may atomically create the balanced journal, payslip snapshots, remittance obligations, audit event, and outbox event.
7. Posted payroll is immutable. Corrections are linked adjustment/reversal runs. A later rule-pack release or worker change must never rewrite a historical result.
8. Every statutory result must include rule-pack ID/version, effective period, source URLs, source hash, calculation inputs, output components, rounding explanation, warnings, and diagnostics.
9. Fail closed for unknown work location, unsupported worker type, missing tax setup, missing YTD, unsupported pay frequency, invalid dates, duplicate run, stale optimistic version, and incomplete rule-pack capability. Do not silently approximate.
10. Do not submit money, CRA forms, ROEs, or bank files to a live external system. Build adapters behind interfaces and safe development/test fakes with explicit dry-run mode.
11. Keep product copy precise: “calculated,” “ready for review,” “export generated,” and “submitted” are distinct states. Never say “filed,” “paid,” “compliant,” or “direct deposit” when ClearLedger only prepared an instruction.
12. Use the existing coding style, Fastify/Zod/Prisma patterns, error model, audit utilities, idempotency service, journal service, date utilities, and browser testing harness. Do not add a large framework or sidecar without a documented reason and license/security review.

## Phased build prompts

### Phase 0 — discovery, design control, and evidence ledger

> Produce a short implementation inventory before coding. Map existing payroll models, service methods, routes, permissions, demo data, migrations, journal posting, audit/outbox, report patterns, UI navigation, and tests. Identify every missing capability and its owner file. Create an ADR or implementation note containing the CA-AB scope, supported and unsupported components, state machine, threat model, filing/payment boundary, migration plan, and release claims. Build a source ledger from the links above with retrieval date, effective date, source hash, and golden-vector provenance. Stop only for a genuinely unsafe legal ambiguity; otherwise use a safe explicit assumption and document it.

Required output: an updated gap matrix, state diagram, API/UI contract sketch, threat model, source ledger, and a test plan committed under `docs/`.

### Phase 1 — API boundary and domain completeness

> Expose the existing payroll service through the repository’s normal Fastify route structure. Add typed Zod schemas, organization context, authorization, pagination/filtering, idempotency, optimistic concurrency, structured errors, and OpenAPI coverage. Prefer existing service methods; extend them only when a real workflow gap is found.

Implement or complete tenant-scoped endpoints for:

- settings, jurisdiction/rule-pack capabilities, and payroll setup status;
- workers and effective-dated profiles/compensation, including activate, leave, terminate, rehire, and masked sensitive fields;
- payroll codes, statutory attributes, account mapping, remittance authority, and active/version transitions;
- schedules, periods, cutoffs, pay dates, holiday calendars, and duplicate-period protection;
- run creation, worker/time/earning input, CSV hours import with preview/validation, calculation, explanation, variance comparison, review, approval, post, cancel, and correction;
- run details with per-worker gross-to-net trace, components, warnings, rule-pack evidence, YTD, journal, payslip, remittance, and payment relationships;
- payment-batch preview/export/status and remittance obligations/status/reconciliation;
- payroll register, summary, liability, employer-cost, YTD, variance, PTO, payment, remittance, and year-end report endpoints.

Do not create a “god route.” Keep controllers thin and domain transitions in services/transactions. Ensure all mutations are idempotent and all transitions emit auditable events.

### Phase 2 — payroll workspace and interaction design

> Add a dedicated Payroll workspace inside the existing `apps/web` shell and navigation. Follow the established ClearLedger layout, responsive behavior, themes, density controls, accessibility conventions, test selectors, and organization/session model. Do not create a second application or bypass the existing API.

Build the following screens and task order:

1. **Payroll home**: upcoming pay date, cutoff countdown, next action, draft/in-review/approved runs, net pay, gross wages, employer cost, source deductions, remittances due, PTO exceptions, and a compact activity/audit feed. Every card links to the action that resolves it.
2. **Setup checklist**: jurisdiction/work location, payroll account identifiers, tax year/rule-pack, ledger accounts, pay schedules, earning/deduction/contribution codes, remittance calendar, payment method, employee documents, and approval roles. Show “calculation,” “export,” “payment,” and “filing” capabilities separately.
3. **Employees**: searchable/filterable table with worker number, name, kind, status, jurisdiction, compensation, next effective change, missing setup flags, and masked identifiers. Use a profile drawer/page with effective-dated timeline, tax elections, compensation, PTO, documents, banking, and audit history.
4. **Run payroll wizard**: select scheduled/off-cycle/correction type; choose period and workers; import or enter hours; add earnings, overtime, bonuses, vacation, holiday pay, reimbursements, benefits, deductions, garnishments, and employer contributions; validate; calculate; inspect explanations; compare prior run; resolve exceptions; submit for review.
5. **Review and approval**: a dense but readable payroll register with expandable workers, gross-to-net waterfall, prior-run variance, component explanations, YTD impact, source links, unresolved exceptions, and a clear “what will post/pay/export” summary. Require review completion before approval and approval before posting.
6. **Post-run control center**: immutable journal link, payslip distribution state, payment batch, remittance obligations, reconciliation status, and correction action. Keep export, payment, and filing actions visibly separate.
7. **Reports and year-end**: report picker/search, date and worker filters, saved views, PDF/CSV export, payroll summary, register, deductions/contributions, liability aging, employer cost, YTD, PTO, variance, T4 preview, and ROE preparation.
8. **Employee self-service**: read-only payslips, year-end forms, profile/tax-document tasks, PTO balance, and bank-detail change request flow. Sensitive changes require verification and approval; do not expose decrypted identifiers.

The interface should reduce clicks with sensible defaults, a visible next action, bulk selection, keyboard-accessible tables, saved filters, clear empty/loading/error states, and inline explanations. It must feel calmer and more trustworthy than a typical accounting app: no surprise posting, no ambiguous “submit” button, and no hidden statutory assumptions.

### Phase 3 — calculation engine and CA-AB 2026 rule pack

> Treat the existing `PayrollStatutoryCalculator` as the starting implementation, not as evidence that the domain is finished. Refactor only as needed to make rule packs data-driven, effective-dated, traceable, deterministic, testable, and safe to update.

For the first release, implement and evidence the supported Canada–Alberta path for the current tax year, including the applicable federal and Alberta income-tax calculations, CPP/CPP2 where applicable, EI, employer contributions, claim codes/TD1 inputs supported by the source, pay-frequency annualization, YTD caps, taxable/non-taxable components, rounding, zero/maximum/boundary cases, and the product’s explicitly supported Alberta employment-standard features:

- hourly and salary regular pay;
- approved hours and overtime;
- bonus/commission and retroactive pay treatment where sourced and tested;
- vacation accrual/pay and termination payout behavior;
- Alberta general-holiday eligibility and pay options;
- approved deductions, benefits, reimbursements, and employer contributions;
- termination/final-pay components and final-pay timing warnings;
- corrections and reversals linked to the original posted run.

Use the official CRA tables/formulas and Alberta pages as the authority. Create golden vectors for ordinary, zero, high-income/cap, first/last period, leap-year, 53-pay-period, claim-code, additional-tax, vacation, holiday, termination, bonus, retro, correction, and YTD-boundary cases. Where a rule cannot be safely derived, produce a diagnostic and block calculation/posting rather than inventing a result.

Model each rule pack with at least: ID, jurisdiction, effective-from/to, version, source URLs, retrieval metadata, checksum, supported components, capability flags, formula/table version, rounding policy, test-vector IDs, change notes, and retirement status. Historical runs retain the exact pack identity and input snapshot.

Do not expose Quebec, other provinces, US federal, state/local, workers’ compensation, or filing support as complete merely because an enum or placeholder pack exists. Each expansion requires its own authoritative sources, formulas, forms, vectors, UI copy, and acceptance sign-off.

### Phase 4 — people, time, PTO, and lifecycle records

> Complete the minimum records needed for real payroll operations without turning this phase into an unrelated HR suite. Add effective-dated onboarding, worker status, employment/jurisdiction changes, multiple compensation changes, approved time inputs, PTO policies/balances, vacation pay settings, termination/rehire, documents, and worker-level audit history. Preserve snapshot semantics for every run.

Support CSV time import with a dry-run preview that reports unknown workers, invalid dates, duplicate rows, unsupported codes, out-of-period entries, and rounding. Make all corrections explicit and auditable. Show PTO/vacation warnings before calculation and never allow an overdraw or termination payout to disappear silently.

### Phase 5 — remittances, year-end, and government boundaries

> Build the operational records and previews employers need even when live submission is not enabled. Calculate remittance obligations from posted runs, apply the correct remitter cadence configured for the employer, account for weekends/holidays where the authoritative source requires it, reconcile period/YTD totals, track due/paid/exported states, and provide a printable/exportable remittance package.

Build T4/T4A preview and validated export structures from the current CRA guides/specifications. Build ROE data preparation and validation from the Service Canada guide. Keep each flow visibly labeled as preview, export-ready, manually submitted, or provider-submitted. Do not send to CRA, Revenu Québec, Service Canada, or a bank in development. If a live connector is later added, require scoped credentials, consent, re-authentication, idempotency, webhook reconciliation, sandbox evidence, failure recovery, audit events, and a production feature flag.

### Phase 6 — accounting, payment exports, and reconciliation

> Reconcile payroll to the existing accounting core. On post, create balanced debit/credit lines for wages, employer costs, employee deductions, remittance liabilities, reimbursements, and net-pay clearing using configured accounts. Link the journal to the run and preserve traceability by worker/component. Validate period locks, currency, duplicate posting keys, and reversal behavior.

Create payment batches from posted net pay only. Show total, worker count, masked destination, payment date, export sequence, file hash, and status. Generate safe development exports behind a provider interface; never treat file generation as payment completion. Add bank-reconciliation hooks and duplicate-export protection.

### Phase 7 — security, privacy, controls, and operations

> Add a payroll-specific threat model and verification evidence. Cover tenant breakout, IDOR, PII exfiltration, overbroad employee access, malicious CSVs, formula tampering, duplicate posting/payment, stale approvals, replayed webhooks, log leakage, export leakage, backups, retention, deletion/closure, key rotation, and incident response.

Require recent authentication for high-risk actions, mask sensitive data by default, use safe redaction in structured logs, protect exports, validate file types and sizes, rate-limit sensitive endpoints, and make security-sensitive UI actions accessible without revealing secrets. Test authorization for every payroll permission and role, including cross-organization negative cases.

### Phase 8 — complete verification and release evidence

> Do not declare completion until the implementation passes the repository’s normal gates plus the payroll gates below. Run tests after each phase and at the end. Use parallel agents for independent unit, API, UI, accessibility, security, performance, and documentation review, but integrate changes centrally and resolve conflicts deliberately.

Required verification:

- typecheck, lint, formatting check, build, database validation, migration-up, rollback verification, and backup/restore verification;
- statutory unit and golden-vector tests, including deterministic repeatability and rule-pack replay;
- property tests for conservation of gross, deductions, employer cost, and net pay;
- API integration tests for tenant isolation, permissions, idempotency, optimistic concurrency, state transitions, period locks, correction links, posting, remittances, and payment exports;
- browser tests for setup, employee onboarding, CSV preview, regular run, review/approval/post, payslip, report filters/export, remittance, correction, and self-service;
- accessibility tests for keyboard flow, focus, labels, table semantics, contrast, reduced motion, responsive/mobile navigation, and screen-reader announcements;
- visual tests at desktop, tablet, and mobile widths across the existing themes and density settings;
- security tests confirming no SIN/bank plaintext in API responses, logs, browser storage, analytics, fixtures, or screenshots;
- performance tests for a representative small-business run and a larger batch, with no N+1 query or unbounded export behavior;
- failure/recovery tests for stale approvals, partial connector failures, duplicate requests, rule-pack mismatch, timeout, retry, and database transaction rollback.

Record commands, environment assumptions, pass/fail counts, known limitations, screenshots, and release owner in a payroll completion report. Update the README/doc index and the release checklist. Keep unsupported capability flags visible in product docs and UI.

## Definition of done

The build is complete only when all of the following are true:

1. A new organization can configure CA-AB payroll, create an employee with masked sensitive data and effective-dated compensation, create a schedule/period, enter or import time, calculate a regular run, understand every worker’s gross-to-net result, resolve warnings, route it through review and approval, and post it to a balanced journal.
2. The exact rule-pack identity, sources, hash, inputs, outputs, rounding, YTD, and explanation are retained and visible to authorized reviewers.
3. Posted runs produce immutable payslip snapshots, remittance obligations, accounting links, and a payment-batch/export path without claiming that funds moved.
4. Corrections and reversals are first-class linked runs and never mutate a posted result.
5. Payroll reports cover register, summary, deductions/contributions, employer cost, liability/remittance, YTD, variance, PTO, journal, payslip, and year-end previews with filters and safe exports.
6. CA-AB vacation, holiday, and termination behavior is either implemented from current authoritative evidence with vectors or blocked with a visible diagnostic; it is never silently approximated.
7. T4/T4A and ROE flows produce validated previews/exports with clear manual/provider submission boundaries.
8. The UI is responsive, accessible, theme-compatible, discoverable from the existing shell, and supports the exposed fictional localhost test identities without exposing any real credential or PII.
9. No tenant, role, approval, posting, payment, export, or audit test fails. No existing non-payroll release gate regresses.
10. Every remaining gap has a named phase, explicit feature flag/capability state, source requirement, and test—not a vague TODO.

## Final handoff format

When complete, report:

- changed files and migrations;
- supported jurisdiction/tax-year/rule-pack capabilities;
- API and UI entry points;
- test commands and results;
- security/privacy evidence;
- screenshots or visual QA artifacts;
- migration/rollback and backup evidence;
- known limitations and disabled external actions;
- exact next step for any deferred province, filing connector, payment connector, or year-end feature.

Do not end with “the foundation is ready” if the user-facing workflow, tests, or release evidence are incomplete. Continue phase by phase until the Definition of Done is met or a concrete external dependency prevents the next gated capability.
