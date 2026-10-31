# API Guidelines

## General

- REST with JSON;
- OpenAPI 3.1;
- versioned routes under `/v1`;
- supported third-party contract and compatibility policy in `DEVELOPER_API_V1.md`;
- organization context derived from authenticated membership;
- UUID or ULID identifiers;
- RFC 3339 timestamps;
- explicit currency codes;
- decimal values serialized as strings when precision matters;
- consistent error envelope;
- request correlation id;
- idempotency key for financial creates.

## Error format

```json
{
  "error": {
    "code": "PERIOD_LOCKED",
    "message": "The transaction date is in a locked fiscal period.",
    "details": {
      "periodId": "..."
    },
    "requestId": "..."
  }
}
```

## Suggested route groups

### Organizations

- `POST /v1/organizations`
- `GET /v1/organizations/current`
- `PATCH /v1/organizations/current`
- `POST /v1/organizations/current/members`

### Accounts

- `GET /v1/accounts`
- `POST /v1/accounts`
- `PATCH /v1/accounts/{accountId}`
- `POST /v1/accounts/{accountId}/archive`

### Journals

- `GET /v1/journals`
- `GET /v1/journals/{journalId}`
- `POST /v1/journals`
- `POST /v1/journals/{journalId}/reverse`

### Fiscal periods

- `GET /v1/fiscal-periods`
- `POST /v1/fiscal-periods/{periodId}/close`
- `POST /v1/fiscal-periods/{periodId}/reopen`

### Reports

- `GET /v1/reports/trial-balance`
- `GET /v1/reports/general-ledger`
- `GET /v1/reports/profit-and-loss`
- `GET /v1/reports/balance-sheet`
- `GET /v1/reports/journals`
- `GET /v1/reports/cash-flow`
- `GET /v1/reports/receivables`
- `GET /v1/reports/receivables/customers/{customerId}/statement`
- `GET /v1/reports/payables`
- `GET /v1/reports/payables/vendors/{vendorId}/statement`
- `GET /v1/reports/tax`
- `GET /v1/reports/banking`
- `GET /v1/reports/sales`
- `GET /v1/reports/expenses`
- `GET /v1/reports/exports/{reportName}.csv`
- `GET /v1/dashboard`
- `GET /v1/books-health?asOf={YYYY-MM-DD}`

Phase 10 range reports require ISO `from` and `to` dates. Point-in-time reports
require `asOf`; profit and loss accepts `basis=ACCRUAL|CASH`. General-ledger and
journal detail use bounded pagination. Monetary values are base-currency
integer minor units serialized as decimal strings. CSV responses use `private,
no-store`, neutralize spreadsheet formula prefixes, and require recent
authentication plus report-export permission.

Books Health uses `dashboard:read` and returns organization-scoped, aggregate
findings with a stable code, severity, plain-language reason, and web navigation
target. It exposes no raw provider payload, bank description, import filename,
tax registration number, or credential state. The response always declares
`mode: READ_ONLY` and `accountingEntriesCreated: 0`; the GET must not audit,
post, acknowledge, reconcile, close, or otherwise mutate accounting data.

### Customers and invoices

- `GET /v1/customers`
- `POST /v1/customers`
- `GET /v1/invoices`
- `POST /v1/invoices`
- `POST /v1/invoices/{invoiceId}/approve`
- `POST /v1/invoices/{invoiceId}/send`
- `POST /v1/invoices/{invoiceId}/credit`
- `POST /v1/invoices/{invoiceId}/void`

### Payments

- `POST /v1/payment-accounts/connect`
- `POST /v1/invoices/{invoiceId}/checkout-session`
- `POST /v1/webhooks/payments/{provider}`
- `POST /v1/payments/{paymentId}/refund`

### Vendors and bills

- `GET /v1/vendors`
- `POST /v1/vendors`
- `GET /v1/bills`
- `POST /v1/bills`
- `POST /v1/bills/{billId}/approve`
- `POST /v1/bills/{billId}/payments`

### Banking

- `POST /v1/bank-imports`
- `GET /v1/bank-transactions`
- `POST /v1/bank-transactions/{transactionId}/match`
- `POST /v1/reconciliations`
- `POST /v1/reconciliations/{reconciliationId}/complete`

### Inventory

- `GET|POST /v1/inventory/locations`
- `PATCH /v1/inventory/locations/{inventoryLocationId}`
- `POST /v1/inventory/locations/{inventoryLocationId}/archive`
- `GET /v1/inventory/quantities`
- `GET /v1/inventory/movements`
- `POST /v1/inventory/purchase-receipts`
- `POST /v1/inventory/adjustments`
- `POST /v1/inventory/transfers`
- `POST /v1/inventory/customer-returns`
- `POST /v1/inventory/vendor-returns`
- `GET /v1/inventory/reports/valuation`
- `GET /v1/inventory/reports/cost-of-goods`
- `GET /v1/inventory/reports/control-reconciliation`
- `GET /v1/inventory/reports/low-stock`

### Point of sale

- `GET /v1/pos/capabilities`
- `GET|POST /v1/pos/registers`
- `GET|POST /v1/pos/devices`
- `POST /v1/pos/shifts/open`
- `POST /v1/pos/shifts/{shiftId}/close`
- `POST /v1/pos/shifts/{shiftId}/approve-variance`
- `POST /v1/pos/shifts/{shiftId}/cash-events`
- `POST /v1/pos/preview`
- `GET|POST /v1/pos/sales`
- `GET /v1/pos/sales/{saleId}`
- `POST /v1/pos/sales/{saleId}/returns`
- `GET /v1/pos/shifts/{shiftId}/reconciliation`

## Idempotency

Require `Idempotency-Key` for:

- journal posting;
- journal reversal;
- invoice approval;
- payment creation;
- refund creation;
- bill payment;
- inventory adjustment;
- import finalization.

Persist:

- organization id;
- route or operation name;
- idempotency key;
- request hash;
- response status and body;
- created resource id;
- expiry policy.

## Phase 1 implemented routes

Implemented in `apps/api`:

- `POST /v1/organizations`
- `GET /v1/organizations/current`
- `POST /v1/organizations/current/members`
- `GET /v1/accounts`
- `POST /v1/accounts`
- `PATCH /v1/accounts/{accountId}`
- `POST /v1/accounts/{accountId}/archive`
- `GET /v1/fiscal-periods`
- `POST /v1/fiscal-periods`
- `POST /v1/fiscal-periods/{periodId}/close`
- `POST /v1/fiscal-periods/{periodId}/reopen`
- `GET /v1/journals`
- `GET /v1/journals/{journalId}`
- `POST /v1/journals`
- `POST /v1/journals/{journalId}/reverse`
- `GET /v1/reports/trial-balance`
- `GET /v1/reports/general-ledger`
- `GET /openapi.json`

Development requests authenticate with `x-clearledger-user-email` and select an
organization through `x-clearledger-organization-id`. Those headers are
restricted to the local development adapter. Production uses the Phase 2 OIDC
session adapter and must not accept development headers as identity.

## Phase 11 accountant routes

- `GET|POST /v1/accountant/manual-journals`
- `PATCH|PUT /v1/accountant/manual-journals/{draftId}`
- `POST /v1/accountant/manual-journals/{draftId}/cancel`
- `POST /v1/accountant/manual-journals/{draftId}/post`
- `GET /v1/accountant/review-queue`
- `POST /v1/accountant/review-queue/dismiss`
- `GET /v1/accountant/audit-events`
- `GET /v1/accountant/audit-events.csv`
- `GET /v1/accountant/journals/{journalId}/trace`
- `GET /v1/accountant/journals/{journalId}/correction-guide`
- `GET /v1/fiscal-periods/{periodId}/close-preview`
- `POST /v1/fiscal-periods/{periodId}/close`
- `POST /v1/fiscal-periods/{periodId}/reopen`
- `POST /v1/fiscal-periods/{periodId}/next-year`

Manual-journal posting requires an idempotency key and the submitted draft
version. Period close requires a reason and explicit acknowledgement when the
stored checklist has warnings. Review-item dismissal and period reopening
require a reason. Audit CSV export is recently authenticated, permission
controlled, formula-safe, redacted, and itself audited.

## Phase 12 portability routes

- `POST /v1/imports/upload?importType={type}&sourceSystem={source}`
- `POST /v1/imports/{importBatchId}/preview`
- `POST /v1/imports/{importBatchId}/dry-run`
- `POST /v1/imports/{importBatchId}/commit`
- `POST /v1/imports/{importBatchId}/acknowledge`
- `GET /v1/imports/{importBatchId}`
- `GET /v1/imports/{importBatchId}/errors.csv`
- `POST /v1/exports`
- `GET /v1/exports/{exportJobId}`
- `GET /v1/exports/{exportJobId}/download`
- `POST /v1/organization-closure`
- `POST /v1/organization-closure/{closureRequestId}/finalize`

Import upload sends raw `text/csv` with `x-file-name`. The source is one of
`QUICKBOOKS_ONLINE`, `QUICKBOOKS_DESKTOP`, `XERO`, `WAVE`, `FRESHBOOKS`, `SAGE`,
`ZOHO_BOOKS`, or `OTHER` and becomes immutable provenance for the batch. Identical same-source
content reuses the existing content-addressed batch; identical content labelled
as another source returns `409 IMPORT_SOURCE_MISMATCH`. Preview accepts a
`mapping` object. Financial commits reuse domain posting services; the batch
response contains reconciliation evidence. Full export requests return a job
and download token. The token is supplied only in `x-export-token`, is not
persisted by the web client, and is checked together with permission, recent
authentication, expiry, tenant scope, and archive integrity.
