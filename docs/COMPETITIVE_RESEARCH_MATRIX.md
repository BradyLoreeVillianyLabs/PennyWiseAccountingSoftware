# Competitive Research Matrix

This is the mandatory research baseline for every PennyWise Accounting module. It does
not grant permission to copy a competitor, make a feature-parity claim, or weaken an
accounting, security, tenancy, privacy, or regulatory rule in this repository.

Before a module changes, refresh the applicable entry from primary sources, add the
change-specific interaction or implementation contract to that module's documentation,
and link focused acceptance coverage. Provider and regulated workflows require official
provider or regulator documentation as well as an established-product or open-source
reference.

`corepack pnpm test:research` proves catalog completeness. It deliberately does not
pretend that a generic reference proves a feature is production-ready.

## identity-and-access

**References:** [Keycloak](https://github.com/keycloak/keycloak), [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

**PennyWise translation:** explicit local/OAuth identity, least-privilege memberships,
session revocation, privacy-safe recovery, and a separately tested authorization boundary.

**Required evidence:** tenant isolation, role-escalation rejection, session/recovery
negative tests, and audit evidence for privileged changes.

## organizations-and-company-lifecycle

**References:** [ERPNext](https://github.com/frappe/erpnext), [Keycloak Organizations](https://www.keycloak.org/docs/latest/server_admin/#_organization).

**PennyWise translation:** create a genuinely blank company, choose a separate optional
demo company, make switching obvious, and archive/delete only after safe checks and clear
confirmation.

**Required evidence:** membership scoping, no automatic demo selection, create/switch/
archive flows, and preservation of required accounting history.

## accounting-ledger-and-close

**References:** [ERPNext accounting](https://github.com/frappe/erpnext), [LedgerSMB](https://github.com/ledgersmb/LedgerSMB).

**PennyWise translation:** double-entry posting is explicit and explainable; journals are
balanced and immutable, corrections are reversals/adjustments, and close blockers appear
before a period locks.

**Required evidence:** balance, immutability, correction, closed-period, idempotency,
concurrency, and tenant-isolation tests.

## tax-and-compliance

**References:** [ERPNext tax workflow](https://github.com/frappe/erpnext), [Canada Revenue Agency place-of-supply rules](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html), [Etsy U.S. marketplace tax guidance](https://help.etsy.com/hc/articles/360000343968?segment=selling), and [Streamlined Sales Tax marketplace-facilitator guidance](https://www.streamlinedsalestax.org/for-businesses/marketplace-facilitator).

**PennyWise translation:** jurisdiction, tax authority, remitter, inclusive/exclusive
calculation, filing evidence, marketplace-remitted tax, and adjustments are distinct.
Imported Woo/Etsy tax requires every observed rate to be mapped and an explicit
seller-versus-marketplace remitter decision; it is blocked rather than inferred. Advice and
filing are provider/regulator-gated until primary evidence is verified.

**Required evidence:** deterministic calculations, marketplace remittance allocation,
period control, correction, and jurisdiction-specific negative cases.

## sales-invoicing-estimates-and-payments

**References:** [Invoice Ninja](https://github.com/invoiceninja/invoiceninja), [ERPNext sales](https://github.com/frappe/erpnext).

**PennyWise translation:** estimates convert through reviewable states; invoices have
readable lines, flexible original templates, delivery history, payment status, and safe
correction instead of mutable financial history.

**Required evidence:** estimate-to-invoice, tax/revenue posting, document render,
webhook idempotency, refund/credit, and payer-access tests.

**Currency-view evidence (X1, 2026-09-12):** screen amounts use the organization
locale's currency symbol, customer documents use ISO currency codes in the document
locale, and visible-table CSV exports use ungrouped decimal values plus currency
columns. Foreign-currency choice is explicit and rate application is a separate,
reviewable action. This is a local implementation contract, not a claim of external
provider or accountant acceptance; M1-M4 remain for foreign corrections, banking,
reporting, and currency breadth.

**Current beta evidence boundary (2026-09-11):** Stripe and PayPal adapter
boundaries have local evidence, but no hosted processor is enabled in the beta.
The installed Square SDK and official hosted-payment/webhook contracts were
checked; Square remains disabled because payment links have no native expiry and
would require a durable, RLS-safe provider-link expiry worker before a customer
could be sent to one safely.

**Inline-entry evidence (X3, 2026-09-13):** The product interaction contract
now keeps the user in the active invoice, estimate, bill, and project-work
context while adding a missing customer, item, vendor, account, or project.
Creatable pickers expose keyboard-searchable listboxes and a typed create action;
tax-code creation intentionally falls back to the structured setup form because
its jurisdiction/component data cannot be safely reduced to a one-field modal.
Fresh Chrome evidence covers two-line description-only invoices, nested product
plus revenue-account creation, and project creation from a time-entry form.
This is local product evidence, not a claim that competitor workflow or any
external provider is accepted.

**Fast composer and document-layout evidence (2026-09-15):**
[QuickBooks' official estimate guidance](https://quickbooks.intuit.com/learn-support/en-ca/sales-customers/set-up-and-use-estimates/00/262143)
places customer and product selection in the estimate workflow and supports an
estimate-to-invoice handoff. Its
[official form-customization guidance](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-forms/customize-invoices-estimates-sales-receipts-online/L57kKA6b6_US_en_US?uid=lvtvfv3b)
describes controlled layout, font, colour, logo, and field visibility choices;
its
[numbering guidance](https://quickbooks.intuit.com/learn-support/en-us/help-articles/change-the-number-on-invoices-or-other-transactions/00/239181)
distinguishes automatic numbering from deliberately entered customer-facing
numbers. PennyWise adopts the workflow lessons without copying a form: the
composer puts customer, lines, dates, currency, and draft action first; its
customer preview is a collapsible review step; and missing customer/item entry
remains in context. A finalized invoice number remains server-allocated and
immutable. Estimates instead receive an atomic short sequence on creation and
may take one validated custom number at that point; neither a UUID-like internal
identifier nor a mutable legal invoice number appears in the document header.
All supported document text remains fillable through bounded fields. The
renderer accepts only escaped `**bold**`, `_italic_`, `## heading`, and `- list`
markers rather than arbitrary HTML, and its eight constrained print templates
provide purposefully different hierarchy while retaining the same render data.
Focused coverage: `apps/api/src/invoice-documents.test.ts`,
`apps/api/src/phase17-sales-automation.integration.test.ts`, and
`apps/web/e2e/x3-inline-invoice.spec.ts`. This is local implementation and
browser/PDF evidence; it is not a claim that a competitor design or a customer
document format has legal or accountant approval.

## purchases-expenses-and-accounts-payable

**References:** [ERPNext purchasing](https://github.com/frappe/erpnext), [Odoo](https://github.com/odoo/odoo).

**PennyWise translation:** bill capture, coding, approval, duplicate warning, attachments,
payment, and correction belong in one understandable AP workflow.

**Required evidence:** duplicate prevention, approval permissions, AP posting, attachment
access control, payment allocation, and reversal tests.

## banking-reconciliation-and-cashflow

**C1 research and partial implementation (2026-09-15):**
[QuickBooks](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/match-transactions-quickbooks-online/L0MF3Fn6y_US_en_US),
[Zoho Books](https://www.zoho.com/ca/books/help/banking/matching-transactions.html), and
[FreshBooks](https://support.freshbooks.com/hc/en-us/articles/360039682172-How-do-I-reconcile-simple-transactions-in-bank-reconciliation)
already support reviewed bank matching; Zoho explicitly supports matching several
records whose total equals the deposit. C1 therefore makes no uniqueness or
universal zero-fee claim. The initial pure matcher explains reference/amount/name
evidence and same-customer invoice pairs, with mandatory confirmation. Its read-only
endpoint uses eligible CAD invoices and downgrades confidence when its candidate
window is incomplete. Tests: `apps/api/src/services/etransfer-matching.test.ts`.
Atomic payment confirmation, persisted aliases, parser profiles, and UI acceptance
are still pending. Bank export layouts and message availability require profile
validation; synthetic fixtures must not be described as verified bank exports.

**References:** [Firefly III](https://github.com/firefly-iii/firefly-iii), [ERPNext reconciliation](https://github.com/frappe/erpnext), [Plaid Link](https://plaid.com/docs/link/), and [Plaid Transactions Sync](https://plaid.com/docs/transactions/).

**PennyWise translation:** a dense reconciliation workspace distinguishes matched, ruled,
suggested, and manual decisions; hosted-consent feeds use encrypted provider tokens and
cursor-based review imports, never automatic posting; cash forecasts remain visibly
non-posting projections.

**Required evidence:** import/feed deduplication, cursor pagination/restart, consent expiry,
concurrent-sync denial, changed/removed transaction treatment, match/rule explanation,
zero-difference reconciliation, undo/lock behavior, account scope, and posted-versus-forecast boundary.

**Current beta evidence boundary (2026-09-11):** the Flinks adapter has encrypted
credential handling, hosted-consent/polling/account-mapping boundaries, local protocol
tests, and a public sandbox-token check. It has not completed a real financial-institution
consent journey, so it remains an explicitly external acceptance item; CSV/OFX import is
the usable account-free path.

## inventory-fixed-assets-and-catalog

**References:** [ERPNext stock](https://github.com/frappe/erpnext), [Medusa inventory](https://docs.medusajs.com/resources/commerce-modules/inventory/inventory-in-flows).

**PennyWise translation:** products retain SKU/variant/source evidence, stock and
valuation are separable from images, thumbnails display safely beside inventory items, and
fixed assets use their own depreciation/audit workflow. The barcode increment adds a
tenant-scoped alias registry with exact collision handling, a camera/hardware-neutral scan
payload contract, and deterministic preview-only label templates. The picking increment
adds local approved/manual thumbnails, bin-ordered operational slips with barcode and
variant snapshots, traceable reprints, and short-pick review records that do not alter
stock by themselves. FIFO, landed-cost, and kit/assembly remain explicit scaffolds until
their movement and posting models are approved.

**Required evidence:** purchase/sale/adjustment valuation, no negative stock by default,
image authorization/fallback, source matching confidence, bounded approved-image ingestion,
asset lifecycle tests, barcode normalization and organization collision rejection,
cross-tenant scan denial, deterministic label preview, bin-ordered picking-slip rendering,
traceable reprint, unchanged-stock short-pick review, and visible capability gates for
unfinished costing/assembly workflows.

**Observed comparable workflow and deliberate boundary (2026-08-18):** ERPNext and Medusa
both treat the sellable item identity and stock ledger as separate concerns; this increment
follows that boundary by making aliases and label definitions non-posting records. It does
not claim camera permission handling, printer drivers, FIFO, landed-cost allocation, or
assemblies. Focused acceptance is linked from `docs/ADVANCED_INVENTORY.md`,
`apps/api/src/inventory-barcode-api-contract.test.ts`,
`apps/api/src/phase-d4-picking-slip.integration.test.ts`, and
`apps/api/src/services/picking-slip-render-service.test.ts`.

## shipping-and-carrier-operations

**References:** [Canada Post shipping documentation](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/ship-parcels),
[Canada Post tracking API](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/product/tracking/api/tracking-api-1.0.0),
[Canada Post service information API](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/product/serviceinfo/api/service-info-api-1.0.0),
and [ERPNext stock](https://github.com/frappe/erpnext).

**PennyWise translation:** a neutral carrier adapter validates the operator's
own account, quotes and buys only after explicit quote confirmation, stores the
carrier-returned PDF or ZPL label, and records its cost through the existing
expense workflow. A shipment is linked to its posted sale and any relieving
inventory movement. Timeout reconciliation, carrier-governed void answers, and
deduplicated tracking events remain visible states. Cross-border HS code,
origin, and declared value are operator-supplied customs data; PennyWise does
not classify goods or calculate duty.

**Interaction contract:** the fulfilment workspace exposes shipment creation and
quote as non-posting actions. Purchase is the single shipping action that can
post an accounting entry: the operator must review the exact carrier quote,
expense account, paying account, method, and date, then confirm `confirmed: true`.
Label open/download, tracking refresh, and carrier void are operational actions
and must not create a journal. Carrier error text stays visible, and an absent
or inactive carrier account is an explicit unavailable state linked to External
integrations.

**Required evidence:** encrypted credential boundary, fixture contract and
failure modes, live provider quote/buy/print/void/track evidence, duplicate-buy
reconciliation, cross-border refusal, shipment-linked expense and inventory
records, browser-print acceptance, provider rate-limit/error handling, and
separate research entries before adding USPS or FedEx. D5 automated evidence is
linked from `docs/SHIPPING_CARRIER_OPERATIONS.md`,
`apps/api/src/services/shipping/carrier-adapter.test.ts`, and
`apps/api/src/phase-d5-shipping.integration.test.ts`; live provider and
physical-printer gates remain open.

## reporting-budgeting-and-insights

**References:** [ERPNext reports](https://github.com/frappe/erpnext), [Firefly III reports](https://github.com/firefly-iii/firefly-iii).

**PennyWise translation:** formal financial reports derive from posted ledgers; budgets,
forecasts, and health signals are labelled estimates with drill-through evidence.

**Required evidence:** report control totals, currency/date filters, permissions,
posted-versus-projected separation, export accessibility, and performance coverage.

**X2 interaction contract (2026-09-12):** the report shell keeps period/basis/comparison/
currency context visible, uses server-authoritative CSV export, preserves report state while
an in-place inspector loads source detail, and persists personal or permitted shared views.
Negative values use parentheses with a non-colour accessible negative cue; dashboard money
can be masked per user/device and foreign exposure is shown only when multi-currency is on.
Focused coverage is `apps/web/e2e/x2-report-experience.spec.ts`, the report-view API service,
and the phase-10 reporting integration suite. Budget views, scheduled reports, and aging
original-currency display remain outside X2/M3 boundaries.

## documents-capture-and-printing

**References:** [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx), [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF).

**PennyWise translation:** preserve the original document, make extraction an untrusted
suggestion, expose a clear review route, support printable documents, and never leak
documents across companies.

**Required evidence:** upload/type/size authorization, malware/OCR failure paths,
source-preview access, print/PDF rendering, retention, and extraction-review tests.

**Current beta evidence boundary (2026-09-11):** bundled local Tesseract recognizes
ordinary receipt images and rasterized image-only PDFs without a cloud account. Its output
is still an untrusted suggestion that requires human review before accounting action.
Azure Document Intelligence is not part of the beta and has no implied cloud acceptance.

## crm-contacts-projects-and-time

**References:** [Frappe CRM](https://github.com/frappe/crm), [Invoice Ninja](https://github.com/invoiceninja/invoiceninja).

**PennyWise translation:** contacts, notes, jobs, time, and estimates form one client
context; business screens use client/job language rather than backend IDs.

**Required evidence:** contact/activity permissions, append-only history, cross-record
links, client timeline, time/project boundaries, and non-posting tests.

## calendar-and-planning

**References:** [FullCalendar](https://github.com/fullcalendar/fullcalendar), [Cal.com](https://github.com/calcom/cal.com).

**PennyWise translation:** professional Day/Week/Month/Agenda views, duration-aware timed
blocks, readable details, keyboard access, mobile touch operation, and drag/drop only for
reschedulable CRM planning records. See `CRM_AND_CALENDAR.md` for the active contract.

**Required evidence:** timed placement, overlap layout, click/tap detail, keyboard move,
drag/drop, time-zone/DST handling, optimistic concurrency, role limits, and no accounting
side effects.

## payroll-and-hr

**References:** [Frappe HR](https://github.com/frappe/hrms), [Canada Revenue Agency payroll](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll.html).

**PennyWise translation:** employee, attendance, leave, earnings, deductions, approvals,
pay run, remittance, filing, and direct deposit are separate accountable stages. An
organization-scoped `payroll:automation` credential may prepare only a due **DRAFT** from
an explicit period; it cannot calculate, review, approve, post, export payment, move funds,
or file. No live payment or filing claim is made without certified provider/legal evidence.

**Required evidence:** jurisdiction table versioning, calculation snapshots, approval,
correction/reversal, remittance ledger, narrow scheduler-scope denial, provider idempotency,
filing receipts, and legally reviewed fixtures. The current implementation adds a
non-secret `capabilities.providerGates` contract for direct deposit and tax filing; both
remain `PROVIDER_REQUIRED` until adapter, consent, approval, acknowledgement/receipt,
reconciliation, and legal evidence are complete. This is an evidence boundary, not a
provider-parity claim.

The CPA-005 fixed-record generator is byte-compared to the checked-in `moov-io/cadeft`
reference fixture, but it intentionally cannot generate a downloadable payroll batch yet:
the worker bank envelope is client-encrypted and there is no approved API decryption
boundary. There is no CRA export or submission claim. These are design and legal gates,
not evidence that direct deposit or filing is available.

## point-of-sale

**References:** [ERPNext POS](https://github.com/frappe/erpnext), [Odoo Point of Sale](https://github.com/odoo/odoo).

**PennyWise translation:** a fast cashier flow explicitly handles tax, a bounded multi-line
cart, split cash/manual tender with cash-only change, refunds, cash-close variance, offline/
provider boundaries, browser receipt printing, and inventory linkage. The interaction contract
is exposed by `GET /v1/pos/capabilities`; clients must use it instead of inferring support from
request shape.

**Required evidence:** basket-to-invoice posting, bounded multi-line cart, split-tender and
cash-change validation, tender/refund idempotency, cash-close control, browser receipt print,
inventory impact, role limits, and provider outage behavior. Focused acceptance coverage now
asserts the published cart/tender/receipt contract and posts a two-line sale with cash plus
manual tender while ensuring only the cash tender affects the drawer. Device printing,
external delivery, card terminals, and offline posting remain explicit future gates.

## commerce-woo-etsy-and-catalog-import

**References:** [Medusa](https://github.com/medusajs/medusa), [WooCommerce webhooks](https://developer.woocommerce.com/docs/apis/rest-api/v2/webhooks), [Etsy webhooks](https://developers.etsy.com/documentation/essentials/webhooks/).

**PennyWise translation:** map product variants, thumbnails, orders, fees, tax, payouts,
and rate-level remitter evidence into a reviewable inbox. A normalized order can be
assembled into a human-reviewed DRAFT invoice only after exact catalog, customer,
account, tax, currency, fiscal-period, and provider-total checks; deliberate invoice
posting remains separate. Verify signatures, preserve raw payload evidence safely, block
missing seller-versus-marketplace tax treatment, and deduplicate event identifiers
before any posting.

**Interaction contract:** the operator sees the provider order and its conversion
gaps before any invoice exists. Review and conversion are explicit per order;
conversion creates a draft, and posting is a separate confirmed accounting action.
The same selected order then shows its derived converted, picked, short-pick, or
shipped state, with picking and shipping controls kept in the workspace. Loading,
navigating, producing a picking slip, and opening a label remain non-posting.

**Required evidence:** captured real-provider fixtures, signature failure, replay,
out-of-order/duplicate delivery, preflight refusal, reviewed draft assembly, concurrent
idempotent conversion, deliberate posting, product/image import, marketplace-tax
allocation, revision/refund/cancellation review, and reconciliation tests.

## integrations-email-and-notifications

**References:** [Nodemailer](https://github.com/nodemailer/nodemailer), [OAuth 2.0 RFC 6749](https://www.rfc-editor.org/rfc/rfc6749).

**PennyWise translation:** connections use least-privilege OAuth, encrypted tokens, clear
state, queued delivery, retries, sent evidence, and an honest disabled state when provider
credentials are unavailable.

**Required evidence:** OAuth state/PKCE, encrypted token rotation, tenant binding,
outbox idempotency, retry/backoff, provider failure, and no-send safety tests.

**Current beta evidence boundary (2026-09-11):** SMTP configuration encrypts relay
credentials and performs a test-send before save; a real local implicit-TLS SMTP server
and protocol fixtures cover the native submission contract. A real relay must still be
accepted by the owner's mail provider before delivery can be described as verified.

## background-automation-and-recovery

**References:** [QuickBooks scheduled recurring transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/memorize-transactions/schedule-recurring-transactions-created-template/L13EAlBk8_US_en_US), [QuickBooks recurring transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/recurring-transactions/create-recurring-transactions-quickbooks-online/L3WoKX2R8_US_en_US), [QuickBooks automatic invoice reminders](https://quickbooks.intuit.com/learn-support/en-global/help-article/invoicing/send-invoice-reminders-automatically-manually/L84cQjpxo_ROW_en?uid=m43vc68d), [QuickBooks customer statements](https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-statements/create-send-customer-statements-quickbooks-online/L8bvb69Gg_US_en_US), [Xero invoicing process](https://www.xero.com/us/guides/invoicing/invoicing-process/), and [FreshBooks payment reminders and late fees](https://support.freshbooks.com/hc/en-us/articles/227559727-What-are-payment-reminders-and-late-fees).

**PennyWise translation:** recurring and reminder work must be explicit about whether it
creates a draft, sends a document, or only reminds an operator. QuickBooks' own guidance
distinguishes scheduled transactions from reminder templates and notes that scheduled
work may be created ahead of the transaction date. PennyWise therefore uses a named,
auditable, tenant-scoped runner with bounded batches, a pause control, a run history,
and no claim that a sleeping installed computer will execute work. I7 now materializes
idempotent invoice occurrences with draft, finalize, and provider-gated send modes;
I8 now adds manual and scheduled reminders, quiet hours, per-customer and per-invoice
suppression, overdue review, and open-item/activity statement downloads. Late fees remain
off by default and review-only until the owner and accountant approve their terms and
posting treatment.

**Required evidence:** startup catch-up, one-accounting-effect idempotency, lease safety
with two processes, retry/backoff/dead-letter, pause and Run now controls, graceful
shutdown release, `JOBS_ENABLED=false`, closed-period preservation, occurrence identity,
missed-occurrence policy, reminder deduplication and suppression, statement balance
accuracy, PDF output, and a clean provider-enabled delivery fixture. The I6/I7/I8 source
and disposable integration tests cover the local runner, materialization, and follow-up
boundaries; provider acceptance, clean-machine evidence, and external mailbox acceptance
remain open.

## imports-migration-and-data-portability

**References:** [ERPNext data import](https://github.com/frappe/erpnext), [LedgerSMB](https://github.com/ledgersmb/LedgerSMB).

**PennyWise translation:** imports map, validate, preview, dry-run, reconcile, and only
then commit with evidence and a safe rollback plan.

**Required evidence:** malformed input, mapping, duplicate identity, dry-run/commit,
idempotency, tenant isolation, reconciliation totals, export, and restore verification.

## table-grid-and-workspace-experience

**References:** [Carbon data tables](https://carbondesignsystem.com/components/data-table/usage/), [USWDS tables](https://designsystem.digital.gov/components/table/).

**PennyWise translation:** compact accessible tables allow columns, sensible widths, saved
views, batch actions, spreadsheet input where it helps, and an inspector without clutter.

**Required evidence:** keyboard/screen-reader behavior, responsive fallback, persisted
column choices, large paste/import, all-at-once validation/posting, and selection safety.

The Wave 0 interface contract adds keyboard-only invoice, payment, credit-note, bank-match,
and report-drilldown paths; 320px reflow; forced-colors screenshots; visible target-size
inspection; and lab Event Timing samples. Playwright's accessibility guidance recommends
combining automated axe checks with manual assessment, and the W3C target-size guidance permits
adequate spacing as an alternative to a 24px target. PennyWise records those checks without
claiming conformance from automation. Focused coverage lives in
`apps/web/e2e/accessibility-quality.spec.ts`, `keyboard-workflows.spec.ts`,
`viewport-quality.spec.ts`, and `target-size-quality.spec.ts`.

**X2 layout-stability policy:** report drill-down, source detail, and saved-view changes must
stay in the current report workspace. They may open a contained inspector below or beside the
table, but must not navigate away or reset the selected dates, comparison, collapsed groups,
currency, or scroll position. Sticky headers/first columns are allowed only when the table
retains a usable responsive overflow path; print output remains a greyscale report, not an
interactive dashboard.

## navigation-settings-appearance-and-owner-mode

**References:** [QuickBooks navigation guidance](https://quickbooks.intuit.com/learn-support/en-us/help-article/bookkeeping-processes/understand-navigation-menu-quickbooks-online/L310NeoHY_US_en_US), [USWDS](https://designsystem.digital.gov/).

**PennyWise translation:** an original, compact, adaptable shell puts settings and
appearance where expected, keeps active context visible, and lets owner mode hide
accountant complexity without concealing required review or control.

**Required evidence:** desktop/mobile navigation, task-search links, customizable layouts,
preference persistence, role-based mode routing, contrast, and keyboard tests.

## audit-security-and-administration

**References:** [OpenFGA](https://github.com/openfga/openfga), [OWASP ASVS](https://github.com/OWASP/ASVS).

**PennyWise translation:** organization-scoped audit evidence explains meaningful business
actions while operational logs protect secrets; settings and administration use least
privilege and explicit confirmation.

**Required evidence:** authorization matrix, audit completeness, secret/log redaction,
CSRF/input validation, rate limiting, recovery, and destructive-action tests.

## deployment-desktop-and-beta-operations

**References:** [Microsoft MSIX signing](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide), [Microsoft Store publishing](https://learn.microsoft.com/en-us/windows/apps/publish/get-started), [MSIX updates](https://learn.microsoft.com/en-us/windows/msix/app-package-updates), [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html), [Windows Scheduled Tasks](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create), [Node.js `crypto.sign`/`crypto.verify`](https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key-callback), and [OpenSSF Best Practices](https://bestpractices.coreinfrastructure.org/).

**PennyWise translation:** the D1 x64 MSIX packages the pinned Node runtime and PostgreSQL
17, keeps the application on loopback, reports QA self-signing versus Store submission
truthfully, preserves installation identity across updates, and uses a least-privilege
interactive scheduled task for nightly backup. Native backup archives contain the
database custom dump, append-only document store, recovery metadata, and per-member
checksums; restore verifies the sibling checksum, rejects foreign installations, and
checks Prisma migration history. The public-beta payload retains a non-secret
prerequisite diagnostic, while owner-facing diagnostics redact secrets, database URLs,
email, and local data paths. QA package builds never mutate Windows certificate trust;
the QA certificate is trusted only by an administrator on a disposable test machine,
with that action recorded as evidence. First-run backup selection keeps same-volume
destinations blocked, identifies separate physical disks where Windows reports them,
and permits a separate volume on the same disk only with explicit wording that it is
not disk-failure protection; Google Drive is not allowlisted without a reliable local
sync-root signal, while a separately mounted Drive volume remains usable.
The package also records a SHA-256 manifest for every PostgreSQL runtime file. Before
first use, PennyWise verifies the immutable packaged source, stages a verified runtime
under its private local data, and verifies that copy before running PostgreSQL tools.
This preserves the pinned bundled PostgreSQL version while allowing `initdb` and the
other PostgreSQL tools to create their own child processes outside the MSIX immutable
file boundary; a stale or modified local runtime is replaced only after a verified
staging copy has been made.
Nightly backup tasks use the documented `schtasks /create /XML` contract with a
UTF-16LE byte-order mark, least-privilege interactive-token principal, and a
runtime package-location wrapper. Backup configuration is persisted only after
Task Scheduler accepts that XML, so a registration failure cannot be represented
as an enabled nightly backup.
The BETA_20 variant embeds only an Ed25519 public verification key and a
`BETA_20` activation policy. A separate offline issuer tool keeps its private
key and slot ledger outside the repository, issues no more than twenty signed
activation files, and binds every file to the installation request code shown
by the package. The package imports an activation file through a dedicated
Start-menu entry, verifies its signature and installation binding locally, and
never embeds beta user accounts, passwords, private keys, or reusable codes.
Replacement-machine recovery requires a deliberate participant reissue; a
copied activation file must not authorize a different installation.

The owner-authorized beta setup now follows Microsoft's documented
[VC++ redistribution](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170)
and TrustedPeople MSIX signing workflow: a self-contained, signed setup EXE
contains the signed MSIX, Microsoft-signed x64 VC runtime installer, publisher
certificate, and one preissued participant activation. It verifies embedded
hashes and the MSIX signature, installs prerequisites with normal UAC consent,
registers the package for the initiating user, provisions the signed identity,
and waits for API/web health. No terminal, developer tool, download, or separate
activation exchange is required during installation. Issuance is capped at
twenty ledger slots; copying one offline participant installer can clone its
identity, so this is controlled distribution rather than hardware enforcement.
Existing mismatched identities are rejected without replacing books. The beta
automatically schedules recovery copies to OneDrive or the explicitly labelled
same-PC `PennyWiseRecovery` folder. Replacement-machine restore retains target
database credentials and activation while recovering source encryption keys;
PostgreSQL restore uses a single transaction. Focused coverage is in
`native-operations.test.mjs`, with actual setup/lifecycle evidence recorded in
the H2 beta candidate report. Windows trust prompts and a prerequisite-requested
reboot remain OS requirements, not bypasses.

**Required evidence:** clean-machine installer smoke test, BETA_20 activation-file
issuance/import/refusal on a different installation, first-launch sign-in, reboot,
upgrade/uninstall/rollback, signature verification result, dependency/license inventory,
nightly second-location backup, real PostgreSQL/document restore, diagnostics-redaction
result, restricted beta runtime, tunnel health, and production-separation checks. The
repository evidence currently covers source-level contracts and disposable fake-tool
round-trip tests; the clean-machine and Store gates remain open and are recorded in
`docs/status/D1_NATIVE_PACKAGE_HARDENING_REPORT_2026-09-01.md`. H2 prepared the
post-H1 QA candidate and records its hash, archive inspection, and owner-operated
evidence template in `docs/status/H2_PACKAGE_CANDIDATE_PREPARATION_2026-09-05.md`;
that static preparation is not clean-machine acceptance.

## destry-workwear-go-live

**References:** [WooCommerce REST API](https://developer.woocommerce.com/docs/apis/rest-api/),
[WooCommerce authentication](https://developer.woocommerce.com/docs/apis/rest-api/authentication),
[WooCommerce orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/),
[WooCommerce products](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/),
[PostgreSQL backup and restore](https://www.postgresql.org/docs/17/backup.html), and
the repository's `docs/USER_ACCEPTANCE_SCRIPTS.md`.

**PennyWise translation:** the Destry Workwear cutover is review-first and
read-only until a disposable installation, verified backup/restore, store catalog
reconciliation, tax mapping, opening-balance agreement, complete order trace, and
human acceptance are recorded. The runbook uses the existing connector review,
Switching Centre, invoice, inventory, picking-slip, shipping, backup, and lifecycle
boundaries. It deliberately excludes live-store writes, postage resale, duty or tax
advice, automatic cancellation mutation, and production cutover authorization.

**Required evidence:** SKU and variation-stock reconciliation, scoped/revocable
WooCommerce key, redacted import timing, tax-to-the-cent comparison, trial balance/
AR/AP/inventory agreement, one complete order-to-label trace, backup/restore,
restart/upgrade/uninstall, refund, short-pick, post-posting cancellation, non-
developer UAT, accessibility passes, and a followed disposable-machine runbook.
The D6 evidence ledger and exact operator procedure are in
`docs/status/D6_DRILL_EVIDENCE_TEMPLATE.json`,
`scripts/verify-d6-evidence.mjs`, and `docs/D6_GO_LIVE_RUNBOOK.md`; no live-store,
clean-machine, physical-device, or human evidence is claimed by repository tests.
