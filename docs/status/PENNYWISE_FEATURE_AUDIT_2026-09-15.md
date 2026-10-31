# PennyWise feature audit and release-candidate assessment

Date: 2026-09-15  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Scope: current product surface, confirmed unfinished paths, and the next Windows beta candidate.

## Executive result

The product is buildable and the previously shipped Windows candidate remains frozen and installable. The confirmed unfinished path found in this audit was Canadian e-Transfer deposit handling: PennyWise could import and suggest a bank transaction, but it did not yet provide the safe, atomic action that creates the customer payment and match. That path is now implemented for CAD statement imports and is explicitly confirmed by the operator before posting.

The audit did not remove functioning accounting features or fake live-provider credentials. Live bank-feed, card processor, carrier, email, payroll filing, and marketplace credentials remain guarded at their adapter boundaries. Local test adapters, synthetic statements, and the repository's existing fixtures are used where a provider account is not available.

## What was reviewed

| Area                                                                | Current state                                                         | Evidence                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Identity, tenancy, permissions, RLS                                 | Implemented and exercised                                             | Existing integration coverage; API suite                                 |
| Chart of accounts, journals, periods, tax, reports                  | Implemented                                                           | Existing phase integration suites and research verification              |
| Customers, products, invoices, estimates, recurring invoices        | Implemented                                                           | Existing API/unit/integration coverage                                   |
| Payments, refunds, hosted-provider boundaries                       | Implemented with provider gates                                       | API suite; no live credential was invented                               |
| CSV/OFX/QFX import, bank matching, categorization, reconciliation   | Implemented; e-Transfer payment completion added in this release      | Phase 8 integration and new C1 test                                      |
| Inventory, purchasing, shipping, POS, projects, payroll preparation | Implemented or explicitly review-gated by domain                      | Existing phase suites; live filing/carrier actions remain gated          |
| Packaged Windows runtime                                            | Previously verified on two independent Windows machines for 0.14.0.20 | Frozen candidate record; new candidate requires fresh-machine acceptance |

## Changes in this audit

- Added a durable `Invoice.paymentReference`, generated for new invoices and backfilled for existing invoices by migration.
- Added persisted `CustomerPaymentAlias` records, tenant-scoped with RLS, created only after the operator chooses to remember a sender.
- Added bounded, explainable e-Transfer suggestions using exact references, exact outstanding amounts, payer names/aliases, and same-customer two-invoice combinations.
- Added `POST /v1/bank-transactions/:bankTransactionId/confirm-invoice-deposit`. It locks the imported transaction and invoices, calls the existing manual-payment posting path, creates the bank match, updates status, audits, emits outbox evidence, and supports idempotent replay in one transaction.
- Added explicit Canadian CSV profile mappings for synthetic RBC-generic, ScotiaConnect-style debit/credit, and TD Business-style debit/deposit fixtures. They are mappings, not claims of live bank APIs.
- Added the web review action “Confirm and post payment” plus the optional “remember sender” checkbox. Suggestions are never auto-posted.
- Corrected invoice render instructions to show the durable payment reference rather than only the invoice number.

## Research basis

The workflow follows the common accounting pattern that imported bank activity is reviewed, matched to existing receivables, and then confirmed rather than silently posted: [QuickBooks matching guidance](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/match-transactions-quickbooks-online/L0MF3Fn6y_US_en_US), [Zoho Books transaction matching](https://www.zoho.com/ca/books/help/banking/matching-transactions.html), [FreshBooks reconciliation](https://support.freshbooks.com/hc/en-us/articles/360039682172-How-do-I-reconcile-simple-transactions-in-bank-reconciliation), and [Sage bank feeds](https://www.sage.com/en-ca/sage-business-cloud/accounting/features/connect-my-bank/).

The import boundary was checked against Canadian export documentation rather than treating a guessed parser as a live integration: [ScotiaConnect export formats](https://www1.scotiaconnect.scotiabank.com/help/secured/en_US/transaction_lookup.htm), [RBC Express download formats](https://www.rbcroyalbank.com/rbcexpress/core-services-pre-read.pdf), and [Scotiabank's Interac e-Transfer guide](https://www.scotiabank.com/content/dam/gtb/documents/etransferguide.pdf). The implementation therefore keeps a visible mapping/review step and uses synthetic fixtures for the three profile shapes.

## Verification record

- `corepack pnpm typecheck`: passed.
- `corepack pnpm format:check`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed, including workspace compilation, web assets,
  API output, and native staging.
- Release, security, accessibility, and performance contracts: passed in their
  isolated local runs; no live provider credentials were used.
- `corepack pnpm --filter @clearledger/api test`: 52 files / 290 tests passed.
- `corepack pnpm test:research`: 21 modules passed.
- Prisma migration `20260915130000_etransfer_payment_references`: applied successfully to the isolated Postgres test container.
- Focused database suite `phase8-banking.integration.test.ts`: 9/9 passed, including the new e-Transfer test.
- The full 48-file integration run was rerun on a fresh disposable database after
  restarting the local Docker services: 48/48 files and 256/256 tests passed in
  387.14 seconds. The earlier 18 failures were test-database/Docker reachability
  contention, not product failures. A clean isolated-machine run remains required
  before release acceptance.

## Release boundary

The new installer candidate must use a new version and must not overwrite the frozen `PennyWise-TestMachine-0.14.0.20` artifact. No live bank, processor, carrier, email, payroll, or marketplace account is required for the C1 path. A clean Windows 10/11 host still needs to verify installation, first launch, invoice reference display, synthetic statement import, explicit e-Transfer confirmation, and the normal beta activation/trust steps.

## Candidate produced

The source state above was packaged as supervised beta candidate `0.14.0.22`,
slot 07, without changing the frozen 0.14.0.20 folder or the prior 0.14.0.21
candidate:

`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.22`

The transfer set is `PennyWise-Beta-07-Setup.exe`, its matching `.sha256` sidecar,
and `START-HERE.txt`. The installer is 273,179,232 bytes with SHA-256
`5655ef57a356d418c255736f604928948cb7d1a382c2e13becfccadc8e5c5079`.
Authenticode validation and `signtool verify /pa` passed for `PennyWise
Accounting QA`. The staged payload contains the C1 route/reference/alias code
and all 131 migrations. This remains supervised-transfer evidence, not
clean-machine acceptance.
