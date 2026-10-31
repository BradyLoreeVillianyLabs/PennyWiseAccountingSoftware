# Release Candidate Engineering Baseline

Version: `0.14.0-rc.1`  
Status: historical Phase 14 engineering baseline. The current public-beta build and its
post-merge verification state are controlled by
`docs/status/PUBLIC_BETA_RELEASE_EVIDENCE_2026-08-03.md` and
`distribution/public-beta/RELEASE_EVIDENCE.md`; do not infer a final artifact pass from
the older measurements below.

## End-to-End Traceability

| Scenario                               | Database-backed evidence                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| New service business setup             | `phase3-company-setup.integration.test.ts` setup completion and presets                    |
| New inventory business setup           | `phase9-inventory.integration.test.ts` inventory configuration and controls                |
| User invitation and role assignment    | `phase2-identity.integration.test.ts` invitation, MFA, revocation, and role tests          |
| Customer creation                      | `phase4-sales.integration.test.ts` customer isolation and unique identifiers               |
| Service invoice creation and posting   | `phase4-sales.integration.test.ts` invoice posting and AR reconciliation                   |
| Invoice PDF and email delivery         | `phase5-documents.integration.test.ts` snapshot, PDF, queue, and retry tests               |
| Public invoice viewing                 | `phase5-documents.integration.test.ts` secure public-link isolation                        |
| Hosted payment and receipt             | `phase4-sales.integration.test.ts` checkout, verified webhook, and receipt tests           |
| Partial payment                        | `phase4-sales.integration.test.ts` manual allocation and AR tests                          |
| Credit note and refund                 | `phase4-sales.integration.test.ts` credit and refund control tests                         |
| Vendor and bill creation               | `phase7-purchasing.integration.test.ts` bill posting and tax control tests                 |
| Partial bill payment                   | `phase7-purchasing.integration.test.ts` concurrent partial payment and AP tests            |
| Immediate expense                      | `phase7-purchasing.integration.test.ts` exact expense and reversal tests                   |
| Bank import and matching               | `phase8-banking.integration.test.ts` CSV/OFX import, duplicate, and match tests            |
| Reconciliation                         | `phase8-banking.integration.test.ts` save, complete, lock, reopen tests                    |
| Inventory purchase, sale, and return   | `phase9-inventory.integration.test.ts` receipt, sale, customer and vendor return tests     |
| Inventory adjustment and transfer      | `phase9-inventory.integration.test.ts` idempotent adjustment and transfer tests            |
| Financial and tax reports              | `phase10-reporting.integration.test.ts` financial, tax, AR, AP, and dashboard tests        |
| Period close and correction            | `phase11-accountant.integration.test.ts` close evidence, reopen, and linked reversal tests |
| Full export                            | `phase12-portability.integration.test.ts` tenant-scoped, integrity-checked export tests    |
| Migration from sample legacy data      | `phase12-portability.integration.test.ts` staged CSV import, validation, and commit tests  |
| Cross-tenant access attempt            | Phase 2, 4, 7, 8, 9, 10, 11, and 12 PostgreSQL isolation tests                             |
| Duplicate webhook and duplicate import | Phase 4 webhook replay and Phase 8 import replay tests                                     |
| Backup restoration smoke test          | `scripts/verify-backup-restore.mjs` PostgreSQL archive restore drill                       |

## Independent Accounting Evidence

The reporting integration fixture uses fixed minor-unit expectations rather than values produced by report code. It verifies a balanced trial balance, balance sheet, profit and loss, AR and AP control balances, tax payable/recoverable controls, inventory control valuation, payment-clearing movement, bank reconciliation, credit/refund effects, and closed-period behavior. Supporting tests also query journal lines and database constraints directly, so a service-only result cannot make the release pass.

## Performance Targets

The controlled-beta target is p95 under 3 seconds for initial page load and authenticated navigation, under 2 seconds for invoice post and inventory query, under 5 seconds for standard reports and reconciliation workspace, under 10 seconds for a 1,000-row bank import, and under 30 seconds for a tenant export. `pnpm.cmd test:performance` executes the database-backed capacity profile against PostgreSQL, not mocks.

The fresh-database Phase 14 profile used 200 customers, 200 vendors, 220 invoices, 200 bills, 200 inventory products, 2,440 journal lines, and a 1,000-row bank import. It measured invoice-post p95 `46.81 ms`, trial-balance p95 `10.20 ms`, inventory-query p95 `451.62 ms`, bank import preview `1,122.32 ms`, import commit `1,520.48 ms`, reconciliation-workspace p95 `12.84 ms`, export `355.66 ms`, 500-line journal-post p95 `245.69 ms`, and heap growth `42.93 MiB`. All asserted budgets passed. A tenant RLS policy optimization keeps the membership check fail-closed while evaluating it once per statement for ledger scans.

The static web asset budget remains below 1.180 MB. The additional allowance covers the reviewed vanilla bulk-entry workbench, indexed screen/record search, accessible left navigation rail, contextual organization access, spreadsheet-friendly entry grids, browser draft recovery, visible-table exports, resizable/zoomable desktop work surfaces, the localhost-only fictional test-account picker, and the X2 report inspector/saved-view/privacy controls without introducing a frontend framework or a second client runtime. Browser performance evidence across the matrix is recorded below.

## Accessibility And Browser Coverage

The web client enforces document language, responsive viewport, visible keyboard focus for all native form controls, live result regions, an assertive error target, named tables, column scope, and programmatic control names. `pnpm.cmd test:accessibility` verifies these controls. Manual beta validation must cover setup, invoice, hosted-payment, reconciliation, reporting, upload, and export at 200%, keyboard-only, and 320 CSS-pixel widths.

The full local browser matrix passed the owner workflow: Chrome desktop, Edge desktop, Firefox, mobile Chrome at 393 CSS pixels, and Safari-compatible WebKit at 390 CSS pixels. Each run created and selected an organization, initialized a fiscal year, applied an account preset, created a customer and service item, posted an invoice, verified receivables, created a financial account, recorded and allocated a manual payment, imported and matched its bank deposit, completed a zero-difference statement reconciliation, ran a report, and downloaded a tenant export.

Measured initial-page/authenticated-navigation p95 values in milliseconds were Chrome `99.42/52.24`, Edge `162.68/53.68`, Firefox `324.40/72.12`, mobile Chrome `95.04/54.27`, and mobile WebKit `112.91/179.10`. Every result is below the 3-second target. These automated engine checks do not replace human assistive-technology and 200% zoom UAT.

## Reliability And Security

Existing PostgreSQL tests cover temporary email-provider failure, durable webhook retry/outbox replay, duplicate requests, concurrent journal and invoice posting, concurrent reversal and import commit, stale/revoked sessions, storage integrity failure, malformed uploads, and immutable financial records. Production debug endpoints are disabled; local identity is localhost-only and production rejects it. Feature flags and external adapters are environment-controlled, not enabled by a client request. CI provisions PostgreSQL from a clean checkout and runs migrations, unit and integration tests, the capacity profile, static security/accessibility contracts, browser E2E, build, rollback verification, and backup/restore verification.

No production secrets, customer credentials, or unverified generated build output belong
in a public-beta archive. The beta licence and privacy/security summaries are operator
disclosures, not legal opinions; counsel review remains recommended before a general
commercial release.
