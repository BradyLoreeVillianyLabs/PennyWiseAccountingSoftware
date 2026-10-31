# Product Requirements

## Product summary

ClearLedger is a lightweight accounting and operations platform for Canadian small businesses that sell services, products, or both.

The owner should not need to understand debits and credits. The accountant must still be able to inspect, trace, adjust, and export every accounting event.

## Primary personas

### Owner-operator

Needs to invoice customers, collect payment, record purchases, understand cash and profit, and avoid accounting complexity.

### Bookkeeper

Needs reliable source documents, reconciliation, correction workflows, tax detail, and review queues.

### Accountant

Needs a complete general ledger, trial balance, period controls, audit trail, tax reports, and exportable working data.

### Customer paying an invoice

Needs to open, understand, download, and pay an invoice without creating an account.

### Inventory business operator

Needs simple quantity, cost, valuation, reorder, purchase, sale, return, and adjustment workflows without warehouse-management complexity.

## Core workflows

### Sales

Estimate -> accepted estimate -> invoice -> payment -> receipt -> reconciliation

### Purchases

Purchase or receipt -> expense or bill -> payment -> reconciliation

### Accounting correction

Open transaction -> identify error -> create correction -> generate reversal or adjustment -> preserve original -> audit reason

### Banking

Import or fetch activity -> detect duplicate -> suggest match -> confirm or categorize -> reconcile -> lock statement

### Inventory

Purchase receipt -> increase quantity and value -> sale -> reduce quantity and value -> post cost of goods sold

## Business View navigation

- Home
- Sales
- Purchases
- Banking
- Products
- Customers
- Reports

## Accountant View navigation

- Chart of accounts
- General ledger
- Journal entries
- Trial balance
- Reconciliation
- Tax controls
- Period close
- Adjustments
- Audit trail
- Export centre

## MVP features

### Organization setup

- legal and operating name;
- address;
- business number;
- GST/HST and provincial registrations;
- fiscal year-end;
- default currency;
- industry preset;
- logo and brand settings;
- opening balances;
- accountant invitation.

### General ledger

- chart of accounts;
- double-entry journals;
- fiscal periods;
- posting and reversal;
- source linkage;
- period lock;
- audit trail;
- trial balance;
- profit and loss;
- balance sheet;
- general ledger;
- cash-flow summary.

### Sales

- customers;
- estimates;
- invoices;
- recurring invoices;
- deposits;
- partial payments;
- credit notes;
- refunds;
- statements;
- reminders;
- attachments;
- invoice status tracking.

### Invoice design

- professional templates;
- logo;
- header image;
- item images;
- controlled colours and fonts;
- custom fields;
- notes and terms;
- payment button;
- QR code;
- PDF, print, mobile, and email rendering.

### Payments

- connected processor account;
- hosted checkout;
- full and partial payment;
- receipts;
- refunds;
- chargebacks;
- processor-fee accounting;
- signed webhook verification;
- idempotent posting.

### Purchases

- vendors;
- bills;
- expenses;
- recurring bills;
- partial payment;
- vendor credits;
- attachments;
- accounts payable aging.

### Banking

- CSV import;
- OFX/QFX import where feasible;
- duplicate detection;
- matching;
- bank rules;
- split categorization;
- reconciliation;
- provider-neutral live bank adapter later.

### Products and inventory

- service, inventory, and non-inventory item types;
- SKU;
- picture;
- sales price;
- purchase cost;
- income and expense accounts;
- tax treatment;
- quantity on hand and available;
- reorder point;
- weighted-average cost;
- simple locations;
- purchase, sale, return, transfer, adjustment, and write-off;
- valuation and cost-of-goods reports.

## Explicit exclusions

- payroll;
- manufacturing;
- bills of materials;
- serial or lot tracking;
- tax return filing;
- native mobile applications;
- multi-country accounting;
- multi-entity consolidation;
- transaction-level multi-currency is enabled only for organizations that
  complete MCFX setup and policy checks; CAD remains the base reporting and tax
  currency;
- point-of-sale hardware;
- autonomous AI bookkeeping;
- unrestricted invoice HTML or canvas editing.

Provider-specific live rates, bank feeds, WooCommerce, and Etsy require their
own credentials, contracts, consent/revocation controls, replay tests, and
reconciliation evidence before production use.

## Success metrics

### Activation

A new user can create an organization, configure tax, add a customer, create an invoice, and send it within 15 minutes.

### Payment conversion

A payer can open and pay an invoice without registration and without support.

### Accounting quality

No unbalanced journal can be persisted. Control accounts reconcile to subledgers.

### Retention

At least 60 percent of activated beta organizations complete a second monthly reconciliation.

### Supportability

The top 20 support scenarios have deterministic diagnostics and documented resolution steps.
