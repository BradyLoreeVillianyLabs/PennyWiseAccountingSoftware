# Service-Replacement Delivery Order

This is a proposed delivery order for capabilities that let a small business
remove separate paid tools. It does not renumber, replace, or authorize the
existing Phase 17-25 tasks. Each proposed phase maps to existing scoped work so
the product does not acquire competing domain models or duplicate accounting
logic.

## Reassessment against the current build

The repository is no longer starting these capabilities from zero:

- Phase 17 already has estimates, secure customer responses, conversion, and
  recurring-schedule foundations.
- Phase 18 already has project, approved-time, mileage, and human-reviewed
  capture records.
- Phase 19 already has deterministic 13-week forecast arithmetic and a
  provider-neutral bank-feed contract.
- Phase 22 already has OAuth, scoped credentials, signed webhooks, and a
  provider-neutral connector runtime.

The fastest path is therefore to productize and close existing workflows before
creating another broad platform layer. A domain foundation does not count as a
customer feature until it has a complete interface, correction path, reports,
support evidence, and end-to-end acceptance.

Phase 22 also needs an explicit decision gate. If an approved first connector
and provider evidence are available, complete it. If they are not, record the
external blocker, keep all adapters disabled, and formally park the phase rather
than continuing speculative connector infrastructure.

## Market-demand evidence

The roadmap uses current Canadian competitor and integration-market evidence,
not engineering convenience alone:

- QuickBooks Canada treats automated bank feeds, receipt capture, estimates,
  recurring invoices, project profitability, mileage, purchase orders, cash
  planning, fixed assets, and integrations as expected accounting capabilities.
  See [QuickBooks Canada plans](https://quickbooks.intuit.com/ca/pricing/).
- Xero Canada includes bank reconciliation, document capture, reporting, and
  cash forecasting, while charging separately for expenses and projects. See
  [Xero Canada plans](https://www.xero.com/ca/pricing-plans/).
- Xero's 2026 most-connected app list is led by reporting/forecasting,
  approvals, jobs/time, ecommerce accounting, receipt capture, payments, and
  workforce tools. See
  [Xero's most popular apps](https://apps.xero.com/ca/collection/most-popular-apps-2026).

This evidence creates three demand tiers:

- **P0 - broadly expected:** invoicing automation, customer payments, receipt
  capture, banking/reconciliation, and useful financial reporting. ClearLedger
  already has payments and file-based reconciliation, so the missing P0 work is
  sales automation, evidence capture/OCR, and optional live feeds.
- **P1 - common high-value extensions:** forecasting, purchasing approvals,
  projects/time, mileage, payroll handoff, and the first commerce/payment
  connector.
- **P2 - important segment features:** progress billing and fixed assets. Build
  these after the broad workflows unless beta evidence elevates the target
  segment.

Rank implementation with **customer demand first, current readiness second, and
external/regulatory risk third**. Provider discovery for P0 bank feeds and OCR
starts in SR-0 even though production activation remains later and gated.

## Ordering rule

Order work by the lowest external dependency and the smallest safe extension of
the existing ledger, document, reporting, and import services. "Easier" means
less provider, regulatory, money-movement, or irreversible-data risk; it does
not mean lower customer value.

Build a complete, reviewable workflow before adding automation. Suggestions,
OCR, imports, recurring runs, and connectors must create drafts or review items
until an authorized person approves the accounting effect.

Use these additional sequencing rules:

1. Finish the web workflow and acceptance evidence for an existing foundation
   before adding another schema foundation.
2. Release a coherent customer bundle after SR-4; do not wait for bank feeds,
   payroll, native mobile, or multiple connectors.
3. Split optional provider automation from the manual workflow it enhances.
4. Require a correction/reversal path and report reconciliation before calling
   an accounting feature complete.
5. Require a cost owner and fallback path before enabling any metered provider.

## Proposed delivery phases

| Order | Demand | Proposed phase                               | Current readiness            | Paid tools displaced                                           | External gate                                                         |
| ----- | ------ | -------------------------------------------- | ---------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| SR-0  | Gate   | Productization and active-phase decision     | Foundations exist            | Prevents unfinished-work cost; creates no new feature          | Phase 22 complete-or-park decision                                    |
| SR-1  | P0     | Sales automation and customer self-service   | Strong Phase 17 foundation   | Recurring-invoice, reminder, statement, and portal tools       | None                                                                  |
| SR-2  | P0     | Evidence inbox and human review              | Capture model exists         | Document-chasing, storage, and manual receipt-entry tools      | Approved object storage and malware scanning                          |
| SR-3  | P1     | Projects, time, mileage, and job profit      | Strong Phase 18 foundation   | Time tracking, mileage, and project-profitability add-ons      | None for the web workflow                                             |
| SR-4  | P1     | Budgets and cash planning without live feeds | Forecast arithmetic exists   | Spreadsheet-based cash planning and entry-level forecast tools | None; CSV/manual bank data remains supported                          |
| SR-5  | P1     | Purchase requests and approvals              | Existing AP/inventory base   | Lightweight purchasing and AP approval tools                   | None                                                                  |
| SR-6  | P0     | Optional OCR automation                      | Review records exist         | Receipt extraction services                                    | OCR cost, privacy, accuracy, and retention approval                   |
| SR-7  | P2     | Deposits, retainers, and progress billing    | Payment/invoice base exists  | Specialized progress-billing tools                             | Accountant validation of liability and tax treatment                  |
| SR-8  | P2     | Fixed assets and depreciation                | New bounded domain           | Fixed-asset spreadsheets and higher-tier accounting tools      | Accountant validation of methods and reports                          |
| SR-9  | P1     | First customer-validated connector           | Phase 22 runtime exists      | Automation/integration subscriptions                           | Demand evidence, provider terms, and production security review       |
| SR-10 | P0     | Connected bank feeds                         | Adapter contract exists      | Bank-feed upgrade tiers                                        | Canadian aggregation provider, legal/privacy review, sandbox evidence |
| SR-11 | P1     | Payroll provider-summary fallback            | Superseded by native program | Payroll migration, comparison, and outage-entry tools          | Redacted provider fixture and accepted mapping/correction evidence    |

## SR-0 - Productization and active-phase decision

**Customer outcome:** existing work becomes discoverable, usable, supportable,
and testable from the interface instead of remaining an API or persistence
foundation.

**Complete first:**

1. Decide whether Phase 22 can complete with one approved connector. If not,
   formally park its provider-dependent remainder with adapters disabled.
2. Start non-code provider/cost/privacy assessments for OCR and Canadian bank
   feeds because both are P0 expectations; do not enable either yet.
3. Inventory every Phase 17-19 foundation as complete, partial, hidden, or
   provider-blocked.
4. Add missing user-interface paths, plain-language states, correction paths,
   reports, permissions, help, and support diagnostics for the first release
   bundle.
5. Run one owner journey per workflow from creation through correction and
   reporting. Record defects before expanding scope.
6. Remove or feature-flag controls whose backend workflow is not acceptance
   ready.

**Exit evidence:** the status documents agree with actual routes and UI; no
visible control ends in a foundation-only or placeholder state; each included
workflow has desktop/mobile evidence and an owner-verifiable test script.

## SR-1 - Sales and collection automation

**Customer outcome:** a business can quote, obtain a customer decision, convert
to an invoice, schedule repeat work, send controlled reminders, and let the
customer retrieve their own documents without adding a separate billing or
client-portal subscription.

**Build:** finish estimate PDF/email delivery, invoice-conversion UI, recurring
invoice generation, reminder rules, customer statements, communication history,
and a narrow customer portal. Reuse the current estimate foundation, document
renderer, email outbox, invoice status machine, and audit history.

**Defer from this phase:** deposits, retainers, and progress billing move to
SR-7 because they introduce control-account and tax consequences. Do not build
full contract authoring or a generic e-signature platform. Versioned estimate
acceptance is the bounded substitute for a paid proposal-approval tool.

**Exit evidence:** no duplicate document under scheduler replay; recurring runs
default to draft; a portal token cannot access another customer's data; every
communication is traceable and can be suppressed or resent.

## SR-2 - Evidence inbox and receipt review

**Customer outcome:** receipts and supplier documents arrive in one inbox,
become a reviewable expense or bill draft, and retain the original evidence.
This reduces the need for a dedicated receipt-capture subscription.

**Build in this order:**

1. Email/file/mobile upload inbox, ownership, hash-based duplicate hints,
   retention, malware scanning, and attachment-to-draft workflow.
2. Human review for vendor, date, total, tax, currency, account, project, and
   duplicate state.
3. Optional camera crop/rotation and offline draft capture after the core
   review flow is proven.

**Defer from this phase:** OCR automation moves to SR-6 so the manual evidence
workflow can ship without a metered provider. Do not build automatic expense
posting or a model that silently changes a reviewed amount.

**Exit evidence:** original files remain accessible; duplicates are visible;
manual extraction and categorization edits are auditable; a reviewed document
creates a draft bill or expense exactly once.

## SR-3 - Projects, time, mileage, and job profit

**Customer outcome:** service businesses can track a job from estimate through
approved time, expenses, mileage, and invoice, then see actual margin without a
separate time-clock or project-profitability subscription.

**Build:** customer-linked projects, rate-snapshotted time entries, approval and
locking, invoice-line conversion, mileage drafts, project links on existing
documents, and profitability views that clearly separate posted actuals from
unposted estimates.

**Do not build:** payroll calculations, statutory mileage/tax advice, employee
surveillance, or an autonomous mobile posting flow.

**Exit evidence:** approved time converts exactly once; corrections preserve
history; job actuals reconcile to the underlying documents and ledger; a user
can complete time, mileage, and receipt review on a phone-sized web view.

## SR-4 - Budgets and cash planning without live feeds

**Customer outcome:** owners get a weekly cash outlook and budget-versus-actual
view before committing to a paid bank-feed or forecasting service.

**Build:** versioned monthly/weekly budgets, CSV import/export, a 13-week cash
forecast using reconciled bank balances, open receivables/payables, approved
recurring schedules, and explicit manual assumptions. Show the source drivers
and label every future value as projected.

**Sequence note:** this deliberately splits the useful planning portion of
Phase 19 from provider-dependent live feeds. Existing CSV/OFX/QFX import is the
initial data path.

**Do not build:** predictions that write journals, hide manual assumptions, or
claim cash certainty.

**Exit evidence:** forecast opening cash and every driver reconcile; planned,
projected, and posted numbers are visually distinct; changing a budget never
changes financial history.

## SR-5 - Purchase requests and approvals

**Customer outcome:** a business can request, approve, send, receive, and
match purchases without adopting a separate lightweight procurement tool.

**Build:** non-posting purchase requests and purchase orders, amount/role
approval policy, attachments, supplier communication, partial receipt, bill
matching, cancellation, and open-commitment reporting. Use existing inventory
receipt and payables services for all accounting consequences.

**Do not build:** payment execution, autonomous approval, manufacturing, or a
warehouse-management system.

**Exit evidence:** approval authority is tenant-scoped; purchase orders do not
post; partial receive and bill matching are bounded and idempotent; inventory
and AP reconcile to the existing services.

## SR-6 - Optional OCR automation

**Customer outcome:** receipt and bill images prefill the SR-2 review form,
reducing typing without making automated bookkeeping decisions.

**Build:** provider-neutral OCR adapter, extraction provenance, confidence by
field, total/tax arithmetic checks, low-confidence queue, usage metering, and a
self-hosted/provider cost switch where operationally practical.

**Provider rule:** preserve the original file, send only disclosed data, record
provider/version, and provide a fully functional manual fallback. OCR output
remains a suggestion until a person confirms it.

**Exit evidence:** deterministic adapter fixtures pass without network access;
low-confidence and conflicting fields are prominent; provider failure leaves
the document in manual review; usage and cost can be measured per organization.

## SR-7 - Deposits, retainers, and progress billing

**Customer outcome:** contractors and project businesses can request deposits,
hold retainers, invoice milestones, apply funds, and produce a final invoice
without a specialized billing tool.

**Build:** deposit requests, unapplied customer-retainer balances, milestone or
percentage progress invoices, application/refund workflow, final invoice, and
control-account reconciliation. Use existing invoice, payment, allocation,
refund, and reversal services.

**Accounting rule:** a deposit or unapplied retainer is a liability until
applied. Progress invoices recognize only the invoiced amount. No workflow may
recognize the same revenue or tax twice.

**Exit evidence:** deposits, applications, refunds, progress invoices, and final
invoices reconcile across AR, cash, liability, revenue, tax, receipts, and
reports under replay and correction.

## SR-8 - Fixed assets and depreciation

**Customer outcome:** equipment, vehicles, furniture, and other capital assets
have a reliable register and roll-forward instead of living in a spreadsheet or
an expensive accounting tier.

**Build:** asset classes, acquisition-document links, in-service date, cost,
residual value, useful life, supported depreciation methods, monthly schedule,
draft depreciation journals, disposals, gains/losses, attachments, and an
asset/depreciation roll-forward report.

**Accounting rule:** schedules are calculations, not journals. An authorized
reviewer approves each depreciation or disposal entry through existing journal
services. Posted history is corrected through reversal or adjustment.

**Exit evidence:** schedule totals reproduce deterministically; posted
depreciation and disposal entries reconcile to the asset register and general
ledger; closed periods remain protected; method changes do not rewrite posted
history.

## SR-9 - First customer-validated connector

**Customer outcome:** the highest-demand source system can enter ClearLedger
through a transparent review workflow, removing the need for a generic
automation subscription or manual rekeying.

**Build:** complete the provider-neutral connector runtime first, then select
one connector using beta evidence. Start with a narrow import surface--for
example customers, items, orders, payments, or payouts--with mapping,
checkpoints, conflict review, replay protection, and redacted diagnostics.

**Selection rule:** choose the first connector only after counting demand from
active users. WooCommerce/Shopify and a payment processor are candidates; do
not ship several speculative connectors.

**Exit evidence:** repeat/backfill/webhook replay does not duplicate records or
journals; unknown tax, SKU, payout, or account mappings stop in review; customer
credentials are encrypted and never exposed in logs.

## SR-10 - Connected bank feeds

**Customer outcome:** customers who need automatic transaction retrieval can
connect a supported bank or card while everyone else keeps a dependable file
import route.

**Build only after:** an approved Canadian aggregation provider, privacy and
terms review, hosted consent, clear pricing, encrypted credential handling,
consent-expiry/reconnect flows, provider outage handling, and sandbox evidence.
Normalize activity into the existing bank-import workflow rather than creating a
parallel bank ledger.

**Commercial rule:** this is an integration cost, not a feature that can safely
be promised as free and unlimited. Offer it as an optional pass-through or
metered connection while retaining CSV/OFX/QFX at no additional product fee.

**Exit evidence:** no online-banking credentials are collected; disconnect and
expiry are safe; duplicate and pending-to-posted transitions are handled; manual
imports continue during an outage.

## SR-11 - Payroll provider-summary fallback

This bounded import is retained as a migration, comparison, historical/YTD, and outage
fallback. It no longer defines the product's payroll boundary: ADR 006 and the native
payroll implementation program supersede the earlier provider-only decision.

**Customer outcome:** a bookkeeper can bring an approved payroll-provider
summary into ClearLedger as a balanced, traceable draft instead of paying for a
separate accounting export or manually keying payroll journals.

**Build:** provider-generated pay-run import, account mapping, source evidence,
duplicate prevention, reviewable journal draft, and accountant-only posting.

**Do not build inside this fallback:** gross-to-net calculations, employee tax
withholding, CRA or Revenu Quebec remittance, direct deposit, ROEs, T4/RL-1
preparation, benefits, or payroll compliance advice. Native calculation is a separate,
versioned jurisdiction-pack workflow and never derives authority from a provider import.

**Exit evidence:** every imported pay run has a provider identifier and source
evidence; the resulting draft balances; no payroll journal posts without
explicit review; reversing or correcting a provider run remains traceable.

## Release checkpoints

### Release A - Service-business replacement bundle

Ship after SR-0 through SR-4 pass. Package sales automation, the customer
portal, evidence inbox, time/mileage, projects, job profit, budgets, and cash
planning together. This is the first coherent offer that can replace several
subscriptions without depending on a bank, payroll, commerce, or OCR provider.

Required evidence:

- five complete owner journeys with correction and report verification;
- two migrated test organizations and one clean-start organization;
- desktop and phone-sized browser evidence;
- support diagnostics and a tested export/exit path; and
- a pricing page that distinguishes included features from provider charges.

### Release B - Operations replacement bundle

Ship after SR-5, SR-7, and SR-8 pass where those workflows match the selected
buyer. Add purchase requests, purchase orders, approvals, receipt/bill matching,
progress billing, fixed assets, and commitment reporting. Target
bookkeeper-led businesses, contractors, and product/service companies with
controlled purchasing.

### Release C - Connected automation options

Enable SR-6 and SR-9 through SR-11 independently only when each provider gate passes.
One failed or uneconomic provider must not block the core product or disable the
manual workflow.

## Packaging principles

After Release A, the product can credibly be packaged as an accounting workspace
that includes invoices, collections, receipt review, time/mileage, projects,
job profit, budgets, and forecasts without per-seat feature gates. Keep these
outside the integration surcharge.

Use separate, transparent pricing only for:

- payment processing transaction fees;
- connected-bank provider usage;
- paid OCR volume if self-hosted capacity is not sufficient;
- third-party commerce connector costs; and
- payroll-provider service fees.

Do not advertise that a paid service has been replaced until the corresponding
release checkpoint passes with real customer data and the manual fallback has
been tested. Provider fees must be visible before connection, and disabling a
provider must not trap the organization's accounting evidence.

## Stop and reassess rules

Stop a proposed phase and reassess when any of these occurs:

- the workflow cannot be completed from the interface without direct API or
  database intervention;
- two beta users do not identify the paid tool or manual task it replaces;
- a provider cost cannot be recovered transparently;
- accounting or tax treatment lacks professional review;
- the feature creates a second posting, document, or import path instead of
  reusing the approved domain service; or
- usability defects in an earlier release bundle remain open while a later
  provider-dependent phase is being expanded.

## Authorization and active-phase rule

This document is a planning artifact. It does not authorize code changes to a
future phase. The active phase and its completion report remain governed by
`docs/status/CURRENT_PHASE.md`; each implementation increment still needs the
owner authorization and evidence gate required by its mapped task.
