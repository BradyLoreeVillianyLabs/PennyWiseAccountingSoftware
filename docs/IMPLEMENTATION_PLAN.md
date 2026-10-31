# ClearLedger Implementation Plan

No later phase may begin until the current phase acceptance criteria pass and the project owner explicitly authorizes the next task.

## Phase 0/1 — Foundation and ledger core

Status: reported complete and remediated.

Includes workspace, CI baseline, organizations/memberships, chart of accounts, fiscal periods, journals, posting/reversal, idempotency, audit events, outbox records, trial balance, general ledger, database invariants, migrations, and rollback verification.

## Phase 2 — Production identity and tenant isolation

Task: `docs/tasks/PHASE_02_IDENTITY_TENANCY.md`

Deliver production authentication boundary, invitation/membership lifecycle, centralized permissions, recent-authentication controls, PostgreSQL RLS, database role separation, and minimal identity UI.

## Phase 3 — Company setup and accounting configuration

Task: `docs/tasks/PHASE_03_COMPANY_SETUP.md`

Deliver business profile, currency/fiscal settings, Canadian tax configuration foundation, industry account presets, opening balances, branding/defaults, and resumable setup.

## Phase 4 — Customers, products, services, and invoice accounting

Deliver customer records, sellable items, estimates, invoice state machine, tax calculation, accounts-receivable posting, credit notes, and customer statements. Drafts do not post; approved documents post atomically.

## Phase 5 — Invoice rendering and delivery

Deliver constrained professional templates, PDF/print/mobile rendering, email delivery through outbox, delivery/view events, and accessibility/layout fixtures.

## Phase 6 — Payments

Deliver connected-account abstraction, hosted checkout, signed/idempotent webhooks, allocations, receipts, refunds, processor fees, settlements, chargebacks, and payment reconciliation.

## Phase 7 — Vendors, bills, and expenses

Deliver vendors, bills, expenses, partial payments, credits, attachments, approval states, and accounts-payable aging.

## Phase 8 — Banking and reconciliation

Deliver CSV/OFX imports, mapping, duplicate detection, matching, bank rules, splits, transfers, reconciliation history, and provider-neutral live-bank interfaces. Reliable imports may ship before live feeds.

## Phase 9 — Inventory

Deliver inventory items, locations, movements, weighted-average cost, purchases, sales consumption, returns, transfers, adjustments, valuation, cost of goods sold, and low-stock controls.

## Phase 10 — Reports and dashboard

Deliver financial statements, ledgers, aging, tax detail, inventory reports, sales/expense reporting, and a focused owner dashboard. Reports must reconcile to the ledger and subledgers.

## Phase 11 — Accountant tools and period close

Deliver Accountant View, manual/adjusting/reversing entries, corrections, review queues, close/reopen controls, audit drill-down, and working-paper exports.

## Phase 12 — Migration and complete export

Deliver validated imports for master/opening data, outstanding receivables/payables, inventory openings, migration reconciliation, complete organization export, and attachment manifest.

## Phase 13 — Security, privacy, and operational hardening

Complete threat-model review, dependency/secret/container scanning, backup and restore exercises, incident response, retention/deletion workflows, administrative logging, and independent security assessment.

## Phase 14 — End-to-end quality assurance

Run full business scenarios, concurrency/load tests, browser/mobile accessibility checks, migration rollback/failure tests, payment replay tests, cross-tenant adversarial tests, and report reconciliation fixtures.

## Phase 15 — Controlled beta and MVP release

Run a bounded Canadian beta with service and product businesses, bookkeepers, and CPAs. Resolve ledger, tenancy, payment, tax, migration, support, and usability blockers before MVP release.

## MVP exclusions

Do not add payroll, tax-return filing, manufacturing, bills of materials, advanced warehouse management, native mobile apps, foreign-exchange revaluation, multinational consolidation, lending, stored-value wallets, a full storefront, or autonomous AI bookkeeping.
