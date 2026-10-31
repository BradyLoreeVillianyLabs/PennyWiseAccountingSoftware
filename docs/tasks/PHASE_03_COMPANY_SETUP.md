# Phase 3 Task: Company Setup and Accounting Configuration

Execute Phase 3 only. Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.

Do not begin customers, vendors, invoices, bills, payments, banking, inventory transactions, or the general dashboard.

## Required reading

- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/ACCOUNTING_POSTING_RULES.md`
- `docs/PERMISSION_MATRIX.md`
- `docs/SECURITY_AND_COMPLIANCE.md`
- `docs/ARCHITECTURE.md`
- relevant ADRs
- Phase 2 completion report
- existing organization, ledger, account, fiscal-period, authorization, upload, and audit code

## Objective

Allow an authorized Canadian business owner or administrator to configure a new organization so it is ready for bookkeeping.

The completed phase must support:

1. business profile;
2. fiscal-year configuration;
3. base currency;
4. Canadian tax-registration settings;
5. versioned industry chart-of-accounts presets;
6. opening balances;
7. default document settings;
8. logo and brand settings;
9. resumable setup completion;
10. complete audit history.

## A. Organization profile

Implement validated, tenant-isolated settings for:

- legal and operating names;
- business type and industry preset;
- business number and applicable tax-registration identifiers;
- business and mailing addresses;
- telephone, email, and website;
- locale and time zone;
- base currency;
- fiscal year-end and accounting start date;
- logo reference and brand colours;
- setup progress and completion state.

Requirements:

- derive organization context from authenticated membership;
- audit material changes;
- avoid unnecessary logging of tax identifiers;
- prevent base-currency change after posted financial activity without an approved migration workflow;
- prevent fiscal-setting changes that invalidate or overlap existing periods;
- use optimistic concurrency or version checks for settings updates.

## B. Industry account presets

Implement versioned presets for:

- general service business;
- contractor and trades;
- ranch and agriculture;
- repair business;
- tourism and experiences;
- small product seller.

Each entry defines stable system purpose, account code, display name, account type/subtype, normal balance, control-account status, and active state.

Requirements:

- organization-scoped application;
- idempotent reapplication;
- no duplicate accounts;
- no overwrite of user-created accounts;
- stable purpose identifiers rather than display-name matching;
- recorded preset version;
- safe user editing where accounting constraints permit.

## C. Fiscal-period initialization

Create the first fiscal year from the accounting start date and fiscal year-end.

Enforce:

- valid date ranges;
- no overlap;
- authorized changes only;
- preservation of closed-period controls;
- audit events for creation and material changes.

## D. Canadian tax configuration foundation

Implement effective-dated organization tax structures supporting:

- GST and HST;
- provincial components where configured;
- zero-rated and exempt treatment;
- tax-inclusive or tax-exclusive preference;
- recoverable and non-recoverable components;
- active/inactive codes;
- associated ledger control accounts;
- registration status and identifiers.

Requirements:

- do not embed unverified current rates in domain logic;
- isolate seeded rates as versioned configuration with source/effective-date metadata;
- historical posted transactions retain the exact code, rate, components, and basis used;
- later configuration changes cannot alter historical postings;
- validate required control accounts;
- do not implement tax filing or remittance submission.

## E. Opening balances

Implement a guided draft, validation, and posting workflow for bank, credit-card, receivable-control, payable-control, loans, equity, retained earnings/opening equity, and other asset/liability accounts.

Requirements:

- post one balanced, clearly identified opening-balance journal at the accounting start date;
- authorized permission required;
- immutable after posting;
- corrections use reversal and reposting;
- idempotency prevents duplicate posting;
- warn when receivable, payable, or inventory control totals lack future subledger detail;
- do not fabricate customer, vendor, or inventory records;
- record unresolved control-account differences for later migration phases.

## F. Default business settings

Implement validated defaults for:

- payment terms;
- invoice and estimate prefixes and next-number placeholders;
- tax-inclusive/exclusive preference;
- customer-facing notes and payment instructions;
- date and number formats;
- document branding preferences.

Do not allocate invoice numbers or generate invoices in this phase.

Store plain text or sanitized structured content. Do not permit active HTML or scripts.

## G. Logo and branding uploads

Implement a storage adapter with safe local development storage and a production object-storage interface.

Requirements:

- approved file formats only;
- content-based file verification;
- size and dimension limits;
- reject executable or active content, including unsafe SVG;
- organization-isolated storage keys and retrieval authorization;
- database metadata without exposing internal paths;
- replacement preserves audit history;
- malware-scanning interface where production storage requires it.

## H. Resumable setup workflow

Implement a minimal setup UI and server-authoritative state machine:

1. business profile;
2. fiscal and currency settings;
3. tax registration;
4. industry preset;
5. chart-of-accounts review;
6. opening balances;
7. branding and defaults;
8. final review;
9. completion.

Requirements:

- save and resume each step;
- enforce mandatory validation;
- explicit optional-step skipping;
- completed organizations may edit permitted settings later;
- accounting-history-sensitive changes require stricter authorization and validation.

Do not build the general dashboard.

## I. Permissions and API

Add only permissions required to view/edit organization settings, configure fiscal periods/taxes, apply presets, manage opening balances/branding, and complete setup.

Use permissions rather than role-name checks.

Provide authenticated, tenant-derived API contracts for setup state, profile/fiscal/tax settings, preset preview/application, opening-balance validation/posting, logo replacement, defaults, and setup completion.

Require:

- consistent validation errors;
- idempotency for posting and preset application;
- version checks for mutable settings;
- no mass assignment;
- no client-trusted tenant scope.

## Required tests

Add focused unit, integration, database, authorization, upload, and minimal end-to-end coverage for:

- unauthorized and cross-tenant settings access;
- stale-version conflicts;
- base-currency change after posting;
- each preset and idempotent reapplication;
- preservation of existing accounts;
- fiscal initialization and overlap rejection;
- effective-dated tax codes and historical safety;
- invalid tax control accounts;
- balanced, unbalanced, duplicate, concurrent, corrected, and closed-period opening balances;
- allowed, spoofed, oversized, active-content, and cross-tenant logo cases;
- setup save/resume, required-step enforcement, completion, and protected post-completion edits.

## Acceptance criteria

Phase 3 passes only when:

- a new organization can complete setup;
- an industry preset applies safely and idempotently;
- fiscal periods initialize correctly;
- tax settings are effective-dated and historically safe;
- opening balances post through the Phase 1 ledger;
- setup is resumable and permission-controlled;
- logo uploads are safely isolated;
- material changes are audited;
- all required verification passes.

Use the standard concise completion report and stop.
