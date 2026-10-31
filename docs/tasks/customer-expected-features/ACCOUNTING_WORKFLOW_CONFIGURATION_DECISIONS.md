# Accounting workflow configuration decisions

Date: 2026-07-29

This decision record captures the joint product, accounting, engineering,
security, support, and small-business usability position for ClearLedger's
remaining advanced workflows. It distinguishes a convenient starting
experience from accounting policy. A profile may simplify what a new business
sees; it must never silently choose how a transaction posts or when tax is
recognized.

## Final configuration rule

ClearLedger will use five different control types:

1. **Audience profiles** seed workflow visibility once during setup. The owner
   can edit those choices later. Applying another account preset must not
   overwrite customized workflow preferences.
2. **Organization preferences** show or hide optional workspaces and set
   operational approval controls. They do not alter posted accounting.
3. **Accountant-controlled policies** define classifications, effective-dated
   account mappings, tax treatment, calculation methods, and correction rules.
   Values become locked once used and change through a new version.
4. **Immutable safeguards** are not settings. Human review, balanced posting,
   period controls, tenant isolation, idempotency, audit evidence, and
   reversal-based correction always remain enabled.
5. **Provider and release gates** live in Connections or release operations,
   not in general Company settings. A visible preference must never imply that
   an unapproved provider is connected.

## What established products teach us

### Deposits, retainers, and progress billing

QuickBooks treats progress invoices as invoices linked to estimates and tracks
the amount already invoiced and remaining. It documents retainers and deposits
separately, initially recording them as liabilities. See
[QuickBooks progress invoicing](https://quickbooks.intuit.com/learn-support/en-ca/help-article/invoicing/set-send-progress-invoices-quickbooks-online/L0Ymm6WjR_CA_en_CA)
and
[QuickBooks retainers and deposits](https://quickbooks.intuit.com/learn-support/en-ca/help-article/service-items/record-retainer-deposit/L6B5RsY6l_CA_en_CA).

Xero distinguishes a project deposit invoice from an ordinary online-invoice
deposit request. FreshBooks also exposes deposits, payment schedules, and
retainers as related but distinct workflows. See
[Xero project deposits](https://central.xero.com/s/article/Create-a-deposit-invoice-in-Projects),
[Xero online invoice deposits](https://central.xero.com/s/article/Request-a-deposit-from-a-customer),
[FreshBooks deposits](https://support.freshbooks.com/hc/en-us/articles/223512188-How-do-I-request-a-deposit-on-an-invoice),
[FreshBooks payment schedules](https://support.freshbooks.com/hc/en-us/articles/115013879027-What-are-payment-schedules),
and
[FreshBooks retainers](https://support.freshbooks.com/hc/en-us/articles/360015379391-What-are-retainers).

The product conclusion is that "deposit" cannot be a single accounting toggle.
ClearLedger requires an explicit transaction classification:

- `REFUNDABLE_DEPOSIT`: an amount expected to remain repayable until stated
  conditions are met;
- `ADVANCE_PAYMENT`: an amount intended for later application to customer work;
- `PROGRESS_INVOICE`: a real invoice for a portion of an accepted estimate; and
- `HOLDBACK_RETAINAGE`: a separate future transaction type that remains
  disabled until Canadian construction and tax treatment is professionally
  reviewed.

The visibility of deposit requests and progress planning is adjustable in
Company settings. The classification, liability or receivable mapping, tax
timing, application order, forfeiture/refund behavior, and correction examples
are not audience defaults. They require an accountant-controlled policy before
financial posting is enabled.

### Fixed assets and depreciation

Xero uses asset-type defaults with per-asset details, while QuickBooks Online
Advanced provides fixed-asset records and depreciation tracking. Wave documents
a more manual depreciation workflow. See
[Xero fixed assets](https://central.xero.com/s/article/Set-up-fixed-assets),
[Xero asset types](https://central.xero.com/s/article/Add-edit-or-delete-a-fixed-asset-type),
[QuickBooks Online Advanced fixed assets](https://quickbooks.intuit.com/learn-support/en-ca/help-article/fixed-assets/add-manage-fixed-assets-quickbooks-online-advanced/L19788yU0_CA_en_CA),
and [Wave depreciation](https://support.waveapps.com/hc/en-us/articles/208623506-Depreciation-in-Wave).

ClearLedger will therefore provide editable asset-class defaults and copy those
defaults onto a new asset. The asset may be overridden while it is a draft.
Registering an asset freezes its book-depreciation inputs and provenance;
corrections create a reviewed new version rather than rewriting history.

Book depreciation and Canadian capital cost allowance are separate. CRA CCA
classes, rates, additions, dispositions, and special rules are tax-workpaper
concerns, not automatic book journal settings. See
[CRA CCA classes](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/report-business-income-expenses/claiming-capital-cost-allowance/classes.html)
and
[CRA CCA fundamentals](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/report-business-income-expenses/claiming-capital-cost-allowance/basic-information-about-capital-cost-allowance.html).

The fixed-asset-register visibility is an organization preference. Asset
classes, useful-life defaults, book method, convention, residual value,
capitalization guidance, and account mappings are accountant-controlled.
ClearLedger will not auto-post depreciation or CCA until mappings, period
behavior, reversal examples, and roll-forward reconciliation pass professional
acceptance.

### Banking, payroll, and document extraction

Bank activity should enter a review queue, retain source identity, and support
manual file import when a live connection is unavailable. Plaid and Flinks are
candidate Canadian data providers, not product defaults. See
[Plaid Transactions](https://plaid.com/docs/transactions/),
[Plaid institution coverage](https://plaid.com/docs/institutions/), and
[Flinks API documentation](https://docs.flinks.com/api-home).

ClearLedger will not build a payroll engine. It will import an approved
provider's pay-run summary into a balanced journal draft for accountant review.
Individual employee banking details, government identifiers, and payslips are
outside this accounting-summary boundary. Canadian payroll obligations remain
with the employer and approved payroll provider; see the
[CRA payroll deductions and remittances guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html).

OCR remains an optional extraction aid. The original file, duplicate hash,
confidence per field, total/tax checks, and human approval are mandatory.
Provider failure leaves the document available for manual entry. Azure Document
Intelligence is one candidate; see
[Azure invoice extraction](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/invoice?view=doc-intel-4.0.0).
Electronic document retention must continue to satisfy CRA recordkeeping
requirements; see
[CRA imaging and electronic records](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/acceptable-format-imaging-paper-documents-backing-electronic-files.html).

Provider credentials, consent, retention, usage cost, reconnect, deletion, and
outage handling belong in Connections. Bank review and OCR review remain
immutable safeguards. Payroll-summary visibility may be an organization
preference, but provider mapping and posting require owner-confirmed mappings,
balanced golden fixtures, correction tests, and provider evidence. Accountant
review is recommended rather than a mandatory software gate.

### Mobile delivery

The universal default is an installable PWA with no financial API response
cached for offline replay. Native packaging is not an appearance setting.
Capacitor is a possible wrapper only after field testing proves that camera,
secure storage, deep linking, or store distribution justify it. See
[Capacitor documentation](https://capacitorjs.com/docs),
[Google Play developer registration](https://support.google.com/googleplay/android-developer/answer/6112435),
[Apple Developer Program enrollment](https://developer.apple.com/help/account/membership/program-enrollment/),
and [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Audience profiles

Profiles control the initial interface only. `customizedAt` marks the point
after which preset application cannot change the owner's workflow choices.

| Profile              | Initial audience                                         | Cash planning | Purchase requests | Deposits | Progress plans | Fixed assets | Payroll summary |
| -------------------- | -------------------------------------------------------- | ------------: | ----------------: | -------: | -------------: | -----------: | --------------: |
| `SOLO_SERVICE`       | Consultants and owner-operated service firms             |            On |               Off |      Off |            Off |          Off |             Off |
| `PROJECT_TRADES`     | Contractors, trades, repair, and project businesses      |            On |                On |       On |             On |           On |             Off |
| `BOOKKEEPER_MANAGED` | Businesses with an external or internal bookkeeping team |            On |                On |       On |             On |           On |              On |
| `PRODUCT_OPERATIONS` | Small product sellers and operational businesses         |            On |                On |      Off |            Off |           On |              On |

All profiles keep automatic posting off, bank/OCR review on, holdbacks off, and
provider connections disconnected. `BOOKKEEPER_MANAGED` starts with a different
authorized purchase approver. Every profile may be edited by an Owner or Admin.

Purchase approval thresholds are an operational preference: requests below a
positive threshold may be automatically approved, while requests at or above
it require an authorized approval. A threshold of zero requires approval for
every request. Automatic approval records system evidence rather than naming
the submitter as a human approver.

## Implemented safe boundary

The current provider-independent increment includes:

- versioned workflow profiles and owner-editable preferences;
- one-time account-preset seeding that never overwrites customization;
- immutable disclosure of bank review, OCR review, automatic-posting, and
  holdback controls;
- thresholded purchase requests with optional different-person approval;
- explicitly classified, non-posting customer deposit requests;
- deterministic progress plans linked to accepted estimate snapshots;
- exact milestone and estimate-line reconciliation for net, tax, and total;
- a lock preventing full estimate conversion while an active progress plan
  exists;
- deterministic book-depreciation schedule calculation; and
- an installable, data-safe PWA shell.

Approving a deposit request or progress plan does not record receipt of money,
recognize tax, create an invoice, or create a journal. Registering a fixed asset
in the first safe increment is a register action only.

## Release order

1. Verify profiles, purchase controls, non-posting deposit/progress workflows,
   fixed-asset register, and PWA end to end.
2. Obtain an accountant-approved deposit/progress memo and depreciation/mapping
   memo with Canadian examples and correction cases.
3. Add posting only through existing atomic invoice, payment, journal,
   period-control, and reversal services, then reconcile every affected
   subledger and report.
4. Select one provider at a time using coverage, privacy, retention, cost,
   outage, deletion, sandbox, and contract evidence. Keep manual fallbacks.
5. Continue the separately authorized native payroll program through exact
   jurisdiction-pack, route/UI, correction, reporting, security, and acceptance gates.
   Retain a redacted provider-summary importer only as migration, comparison, and outage
   fallback; do not let it define or silently authorize native calculations.
6. Validate the PWA with real field users before funding native store releases.

This order gives the target audiences useful planning and control workflows
now, while keeping professional judgment and external-provider risk fail-closed.
