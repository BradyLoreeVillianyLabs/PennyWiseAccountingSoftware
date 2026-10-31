# Migration and Portability

## Import sequence

Use this order for a new organization:

1. Complete the company profile, base currency, accounting start date, fiscal
   year, account preset, and tax setup.
2. Import additional chart-of-account rows.
3. Import customers and vendors.
4. Configure inventory locations and inventory accounting accounts.
5. Import products and services. Configure inventory products through the
   product workflow before importing quantities.
6. Import one balanced opening-balance batch dated exactly on the accounting
   start date.
7. Import outstanding invoices and bills.
8. Import opening inventory quantities and unit costs.
9. Import opening customer or vendor credits and historical records.
10. Review every reconciliation result and acknowledge each committed batch.

Do not import foreign balances through the current structured importer. CAD/USD
posting, settlement, and revaluation are released, but migration remains
base-currency-only and the portable archive does not yet round-trip the evidence
required for a foreign opening balance. A future accepted implementation must
preserve original amounts, base carrying amounts, exact rate snapshots, currency
exponents, monetary-position events, and revaluation/reversal lineage. Never
invent a historical rate for an opening foreign balance; require both the
outstanding foreign amount and an accountant-approved base carrying amount.

Do not combine a full opening trial balance with outstanding documents or
inventory values that are already represented in that trial balance. The
migration owner is responsible for defining the cutover convention and
preventing duplicated AR, AP, and inventory balances.

## Staged workflow

Every import follows upload, validation and mapping, preview, dry run, commit,
reconciliation, and acknowledgement. The immutable batch ID and SHA-256 source
hash make an identical organization/type/file upload idempotent. CSV input is
limited to 5 MiB and 20,000 data rows. The upload boundary checks allowed media
type, file signature, archive structure, size, and row limits. A deployment-
configured malware scanner can reject content, but the local public beta has no
real malware-scanning provider; users must scan files with trusted security
software before upload.

Master-data and historical commits are one database transaction: any failed
row rolls back the entire domain batch. Recoverable financial imports use
deterministic commit units, persisted commit attempts, and stable idempotency
keys. A recoverable failure moves the batch to `RETRYABLE`; a later resume continues
only incomplete units. A failure that requires compensation is recorded as
`COMPENSATION_REQUIRED`; that state is terminal. Posted financial history is
corrected by linked reversal, never deletion. No failed batch is silently
treated as complete.

### Switching Centre wizard

The web Switching Centre presents the migration as six explicit stages:

1. **Choose source** — select the previous system and read its export checklist.
2. **Map file** — inspect the local CSV/XLSX shape and review deterministic alias suggestions.
3. **Preview** — upload the unchanged file, review representative rows, warnings, ignored fields,
   row-level outcomes, and the immutable source batch before any posting action. The control
   summary identifies each source row, its status, and any review note without exposing a raw
   implementation payload.
4. **Test import** — run the non-posting dry run; invalid rows and dependency errors must be fixed
   before the commit action is enabled.
5. **Commit** — post only through the existing invoice, bill, inventory, and master-data services;
   the batch checksum and each source row remain attached to the created resource.
6. **Reconcile** — compare the returned control totals and acknowledge the completed migration.

Changing the selected source system or import type clears the active review batch in the browser so
that a file cannot accidentally be committed under a different provenance label. For CSV files,
the browser may show a non-authoritative QBO/QBD heading signal; it never changes the selected
source system. The server still enforces source immutability and same-file idempotency.

#### Resume a saved batch

The Switching Centre shows recent batches for the selected company and import type through
`GET /v1/imports?importType=<type>&limit=<1..25>`. The response is a `batches` array of summaries,
including the batch ID, source, status, timestamps, and `rowCount`; it does not expose another
company's batches or replace the detailed batch view. The selected import type controls the
permission check: master-data imports require `data-imports:master`, while financial imports
require `data-imports:financial`.

Selecting **Resume** or **Open** calls `GET /v1/imports/:id` and restores the saved source, import
type, mapped preview, rows, and workflow stage. Opening a batch is read-only and does not upload,
reprocess, post, or otherwise mutate records. The user can then continue the staged workflow from
the saved stage; only the explicit commit action changes accounting records. A company must be
selected for both the recent-batch summary and batch-open requests, and the batch remains scoped
to that company.

#### XLSX sheet and warning provenance

For an XLSX upload, PennyWise persists parser provenance in the import batch's
`sourceMetadata` alongside the immutable file name, media type, byte size, and
SHA-256 checksum. The metadata identifies the selected worksheet by `name` and
zero-based `index`, records `availableSheetCount`, and stores parser warnings.
The parser selects the first worksheet containing a header and at least one
data row; it does not merge multiple worksheets. A warning such as a formula
being imported from its cached value is evidence about how the source was read,
not proof that the formula is current or correct. External formula references
and uncached formula cells are rejected at upload validation.

The metadata is returned when the batch is opened or resumed, so a reviewer can
see which worksheet was used and which parser warnings were present. It is
source evidence, not a substitute for reviewing the workbook in its originating
application. PennyWise does not claim to preserve Excel formulas, macros,
external links, formatting, or worksheets that were not selected.

#### Source controls and the acknowledgement gate

For `OPENING_BALANCES`, `OUTSTANDING_INVOICES`, `OUTSTANDING_BILLS`, and
`INVENTORY_OPENING`, provide the source report's control total before final
acknowledgement. The endpoint is:

```http
PUT /v1/imports/{importBatchId}/source-controls
Content-Type: application/json
```

The body requires `sourceReportName` and `sourceReportDate` (`YYYY-MM-DD`). An
optional `sourceReportChecksum` may contain the source report's SHA-256 value.
Opening balances require `sourceDebitMinor` and `sourceCreditMinor`; the other
three types require `sourceBalanceMinor`. Monetary values are non-negative
integer minor units, not formatted currency strings. PennyWise stores the
submitted report identity and recomputes the relevant comparison when the batch
is already committed. A source-control difference is recorded as `MISMATCH`,
not silently rounded away.

Acknowledgement is a separate, explicit operation:

```http
POST /v1/imports/{importBatchId}/acknowledge
```

The batch must be `COMMITTED`. For the four control-total import types above,
the recalculated reconciliation must be `MATCH`; missing controls or a
`MISMATCH` return a conflict and cannot be acknowledged. A successful request
moves the batch to `RECONCILED`, records `acknowledgedAt`, and writes an audit
event. A reconciled batch is finalized: its source controls and reconciliation
evidence cannot be changed.

#### Recoverable financial commits, units, and leases

`POST /v1/imports/{importBatchId}/commit` is allowed after a successful dry run
and claims a short-lived commit lease. The lease is five minutes from
`commitStartedAt`; `commitLeaseExpiresAt` is returned in the batch and prevents
two workers from committing the same batch concurrently. A resume may reclaim a
`COMMITTING` batch only after that lease has expired. A non-expired lease remains
in progress and should be retried after the service reports the conflict.

Financial posting uses deterministic units so a process interruption does not
require creating a new accounting document:

- simple row-based types use `row:<rowNumber>`;
- invoice lines with the same explicit `external_id` form one invoice unit;
- bill lines form one unit per vendor and document identity;
- opening balances form one `opening-balances` unit;
- inventory opening rows use one deterministic row unit per source row.

Each unit is recorded in `DataImportCommitAttempt` with its operation,
deterministic idempotency key, status, attempt number, and any created resource
reference. A completed unit is skipped on resume and its row markers can be
repaired from the recorded resource. Invoice and bill groups remain grouped;
resuming must not split their lines into separate documents.

Use these recovery endpoints:

```http
POST /v1/imports/{importBatchId}/resume
GET  /v1/imports/{importBatchId}/attempts
```

Resume is available for `RETRYABLE` batches and for a stale `COMMITTING` batch.
It continues incomplete deterministic units using the original idempotency
keys. The attempts endpoint is read-only and returns the company-scoped current
unit-attempt records, including `STARTED`, `SUCCEEDED`, or `FAILED` status,
attempt number, and resource references where available.

`COMPENSATION_REQUIRED` is deliberately terminal and cannot be resumed or
acknowledged. It means a financial effect requires supervised compensation or
linked reversal; it does not mean that the migration completed. The original
posted history remains, and correction must preserve its audit trail.

## CSV conventions

The Switching Centre provides a downloadable UTF-8 CSV template for every supported
import type. Each template includes the canonical headers and one clearly labelled
example row. Delete or replace that row before upload, retain an unchanged copy of the
source-system export, and use the Advanced mapping disclosure only when automatic alias
detection cannot match a source heading.

The source selector appears before the export checklist and is retained as immutable
batch provenance. QuickBooks Online, QuickBooks Desktop, Xero, Wave, FreshBooks, Sage,
and Zoho Books each show a source-specific export/control checklist and official help
where an exact source page is available. QuickBooks Online and QuickBooks Desktop are
separate source values; replaying identical bytes under the other value is rejected with
`IMPORT_SOURCE_MISMATCH`.

- Encoding: UTF-8, optionally with a byte-order mark.
- Header matching is case-insensitive and punctuation-normalized.
- Monetary columns are integer minor units in the explicitly named currency.
  `12345` means 123.45 only for a two-decimal currency; currency code and
  exponent must travel with every foreign amount.
- Quantities are decimal strings and use the inventory service's exact
  fixed-scale conversion.
- Dates use `YYYY-MM-DD`.
- A mapping JSON object may map a PennyWise Accounting field to a source header.
- Duplicate organization identifiers are row errors; existing database
  identifiers fail the atomic commit.
- `external_id` is retained where the target supports reconciliation metadata.

### QuickBooks invoice CSV shape

The downloadable `OUTSTANDING_INVOICES` template uses these canonical columns:

```text
customer_number,issue_date,due_date,amount_minor,external_id,description,sku,quantity,unit_price_minor,tax_amount_minor,discount_amount_minor,tax_code,payment_terms_days,terms
```

`customer_number`, `issue_date`, `due_date`, and `amount_minor` are required. The
remaining columns are optional, although an invoice line must have either
`description` or `sku`. `quantity` defaults to `1`; an amount-only row can therefore
continue to use the legacy importer shape. A fractional quantity must include an exact
`unit_price_minor`. All money values are non-negative integer minor units.

QuickBooks Online and Desktop exports commonly use these aliases, which the importer
recognizes automatically or exposes in the mapping editor:

| PennyWise Accounting field | QuickBooks Online/Desktop examples                |
| -------------------------- | ------------------------------------------------- |
| `customer_number`          | `Customer`, `Customer Name`                       |
| `issue_date`               | `Invoice Date`, `Txn Date`                        |
| `due_date`                 | `Due Date`                                        |
| `external_id`              | `Invoice Number`, `Invoice No`, `Document Number` |
| `sku`                      | `Item`, `Item Name`, `Product`                    |
| `quantity`                 | `Qty`, `Quantity`                                 |
| `unit_price_minor`         | `Rate`, `Unit Price`                              |
| `amount_minor`             | `Amount`, `Line Amount`                           |
| `tax_amount_minor`         | `Tax Amount`, `Sales Tax`                         |
| `discount_amount_minor`    | `Discount`, `Discount Amount`                     |
| `description` / `terms`    | `Description`, `Memo`, `Terms`                    |

For multi-line invoices, repeat the source invoice number on every line. PennyWise Accounting
groups only rows with the same explicit `external_id` into one posted invoice and
preserves each source row in the immutable import batch. Rows without an invoice number
are intentionally kept separate. Source tax totals remain reconciliation evidence unless
the row is mapped to an active PennyWise Accounting `tax_code`; posting still runs through the
central tax calculation service and never writes a source tax amount directly to a journal.

The current structured importer is base-currency only for customer/vendor defaults and
open financial records. When a selected import type can contain foreign balances, the
web application displays a fail-closed warning: do not relabel or convert those records
as CAD. Preserve transaction currency, exact source amount, base carrying amount,
historical rate, and rate provenance for a supervised CAD/USD migration.

These templates accept reviewed CSV/XLSX exports from QuickBooks Online and QuickBooks Desktop
where listed. PennyWise Accounting does not accept QBW, QBB, QBM, or IIF files as import files and
does not claim universal or direct QuickBooks compatibility. For a QuickBooks Desktop migration,
retain a verified QBB backup separately from the reviewed export and maintain a separate audit trail
for the migration. The reviewed export and audit trail do not replace source history that PennyWise
Accounting does not import, including attachments, payroll, jobs/classes, fixed assets, memorized
transactions, and bank-feed history. QuickBooks export variants must always be previewed and
reconciled.

Customer spreadsheet imports may also populate one structured address per role with the
`billing_address_*`, `shipping_address_*`, and `service_address_*` columns. Each populated role
requires `line1`, `city`, `subdivision_code` for CA/US, `postal_code`, and `country_code`; country
uses ISO 3166-1 alpha-2 and subdivision uses ISO 3166-2. Products may include the optional
operator-supplied `hs_tariff_code` and `country_of_origin` columns. These fields are shipping
references only: PennyWise Accounting does not classify goods, calculate duty, or provide tariff
advice.

| Import               | Required PennyWise Accounting columns                                                                   | Common accepted aliases                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart                | `code,name,type`                                                                                        | `number`, `account number`, `account name`, `account type`                                                                                                                                                             |
| Customers            | `customer_number,display_name`                                                                          | `customer`, `customer no`, `customer ID`, `customer name`, `contact name`, `client name`, `company`; structured address columns use canonical `billing_address_*`, `shipping_address_*`, and `service_address_*` names |
| Vendors              | `vendor_number,legal_name,display_name`                                                                 | `vendor`, `vendor no`, `vendor ID`, `vendor name`, `supplier name`, `name`, `company`                                                                                                                                  |
| Products/services    | `name,item_type,sales_price_minor,income_account_code`                                                  | `item name`, `product name`, `service name`, `type`, `sales price`, `rate`, `income account`, `sales account`; optional `hs_tariff_code`, `country_of_origin`                                                          |
| Opening balances     | `account_code,debit_minor,credit_minor,effective_date`                                                  | `account`, `account number`, `nominal code`, `debit`, `credit`, `date`                                                                                                                                                 |
| Outstanding invoices | `customer_number,issue_date,due_date,amount_minor`                                                      | `Customer`, `Contact Name`, `Invoice Date`, `Txn Date`, `Due Date`, `Invoice Number`, `Item Code`, `Item Name`, `Qty`, `Rate`, `Line Amount`, `Tax`, `Discount`, `Memo`                                                |
| Outstanding bills    | `vendor_number,vendor_invoice_number,issue_date,due_date,amount_minor,expense_account_code,description` | `Vendor Name`, `Supplier Name`, `Bill Number`, `Invoice Number`, `Due Date`, `Account Code`, `Item`, `Qty`, `Rate`, `Tax`, `Discount`, `Memo`                                                                          |
| Customer credits     | `customer_number,amount_minor,effective_date`                                                           | `customer`, `amount`, `date`                                                                                                                                                                                           |
| Vendor credits       | `vendor_number,amount_minor,effective_date`                                                             | `vendor`, `amount`, `date`                                                                                                                                                                                             |
| Inventory opening    | `sku,quantity,unit_cost_minor,effective_date`                                                           | exact headings recommended                                                                                                                                                                                             |
| Historical archive   | `record_type,external_id`                                                                               | `transaction_type`, `transaction_id`                                                                                                                                                                                   |

Optional columns currently consumed include `subtype`, `is_control`,
`legal_name`, `email`, `payment_terms_days`, `sku`, `description`, `quantity`,
`unit_price_minor`, `unit_cost_minor`, `tax_amount_minor`,
`discount_amount_minor`, `tax_code`, `tax_code_id`, `terms`, `unit_of_measure`,
`note`, `occurred_at`, and `external_id`. Repeated bill rows with the same vendor
and document number are grouped into one posted bill, preserving each source row;
the purchase domain applies the mapped expense account, discount, and active tax
code per line.

## Financial reconciliation

- Opening balances compare total posted debits and credits.
- Outstanding invoices compare the AR subledger with the AR control account.
- Outstanding bills compare the AP subledger with the AP control account.
- Inventory openings compare perpetual inventory value with configured
  inventory control accounts.
- Every result includes imported, skipped, failed, and unsupported counts.

Opening credits without source documents and allocation detail are preserved as
explicit non-posting historical records. PennyWise Accounting does not fabricate
payments, vendor credits, source documents, or allocations from incomplete
data.

## Export package

A full export is a UTF-8 JSON archive that can be read without PennyWise Accounting.
Version 3 discovers every current portable organization model in the Prisma
schema, applies the authenticated organization filter to every table query,
and records exact table and column coverage. Security-only token/access locator
tables are not Prisma customer-data models and are excluded. The top-level
`manifest` records schema version,
generation time, organization, logical file path, media type, row count, byte
size, and SHA-256 for every entry. `files` contains canonical, deterministically
ordered JSON datasets plus optional base64 attachment objects.

Passwords, session tokens, provider secrets, encrypted payment/payroll
identifiers, lookup hashes, internal storage keys, full bank credentials, and
payment-card details are excluded. Nested secret-named values and URL
credentials/query strings are removed. Customer-owned tax registration and
vendor business identifiers remain portable. Clean authorized attachments use
sanitized, collision-resistant relative paths. Quarantined attachment content
is excluded and reported in the manifest. A requested attachment that is
missing or checksum-mismatched fails the export instead of producing an
apparently complete backup.

The archive is open, readable JSON, not an in-product one-click restore format.
Current CSV/XLSX import workflows do not restore a v3 archive. Keep the archive
and its checksum for portability or supervised conversion rather than treating
it as a tested disaster-recovery restore path.

Export creation and download require permission and recent authentication.
Downloads require the one-time-disclosed high-entropy token, expire after 24
hours, and verify the stored archive hash before release.

## Closure and retention

Only an active owner with recent authentication may request or finalize
organization closure. A current, unexpired v3 full export with attachments is
mandatory; finalization rereads the stored archive and verifies its checksum
and COMPLETE manifest. Legal hold prevents deletion scheduling. Finalization
revokes organization sessions, disconnects
payment integrations, and schedules a 30-day retention period while preserving
the organization and financial records. Hard deletion and
jurisdiction-specific anonymization remain production retention-policy
operations, not an API-side immediate delete.
