# MCFX post-implementation audit

Date: 2026-07-29

Result: FAIL — foreign posting and revaluation are fail-closed

## Executive finding

The prior build was not a completed multi-currency accounting implementation.
It added useful experimental primitives and persistence scaffolding, but its
PASS reports did not match the authorized phase contracts or the code that was
actually tested. The existing CAD workflows remain the supported accounting
boundary. No production database was migrated during this review.

Review remediation deliberately disables all foreign journal posting and FX
revaluation at the API and database boundaries. The schema and non-posting
preparation code are retained for controlled future repair. The known-incorrect
revaluation implementation was removed so deleting one gate cannot expose it;
none of these artifacts are production evidence.

## Authorization and prerequisite failure

- `docs/approvals/MCFX_00_APPROVAL.md` is absent. MCFX-01 was required to return
  GATED and dependent phases could not use it as a PASS prerequisite.
- The MCFX-00 packet omitted the exhaustive impact inventory, complete worked
  journal fixtures, and explicit unresolved professional judgments required by
  its acceptance criteria.
- MCFX-13, MCFX-15, and MCFX-17 were marked PASS despite direct prerequisites
  that were incomplete or already GATED.
- The former completion reports listed summary claims rather than the required
  changed-file inventory, command evidence, tenancy/idempotency/concurrency
  proof, residual risk, and next-phase gate.

## Accounting defects

### Arithmetic and registry

- The exact rational conversion primitive is useful, but major-unit parsing,
  exponent-aware formatting/serialization, registry versioning, historical
  definition drift protection, full overflow fixtures, and property-style
  allocation coverage are missing.
- The currency registry silently accepts duplicate codes and does not persist
  a versioned definition identity.

### Schema and ledger

- Posted sources do not persist the required original/base component amounts
  and currency-definition snapshots.
- `JournalLine` has one signed `transactionMinor` rather than distinct
  transaction debit and credit evidence. The implementation cannot provide the
  mixed-transaction-currency behavior its report claimed.
- `MonetaryPosition` and `MonetaryPositionEvent` lack the required outstanding
  transaction amount, historical/current base carrying values, cumulative
  realized/unrealized values, sequence/version, and complete provenance.
- Invoice and bill posting convert components independently and do not use the
  required deterministic control-total allocation. A valid foreign document
  can therefore reach an unbalanced converted journal instead of receiving a
  reconciled allocation.
- Foreign invoice/bill posting does not open AR/AP monetary positions.

### Settlement and revaluation

- Customer receipt relief recalculates proportional base amounts without a
  position projection or final-residue event. It does not prove the receiving
  account's foreign carrying value and cannot distinguish AR FX from disposal
  FX on pre-existing foreign cash.
- Vendor settlement, card disposal, foreign banking/transfers, and statement
  currency reconciliation were not implemented.
- Revaluation silently selected the latest available rate, omitted positions
  when a rate was missing, and did not implement a complete eligibility
  watermark.
- Revaluation gain/loss classification was inverted for both debit-normal
  assets and credit-normal liabilities.
- The automatic reversal created no corresponding position event restoring
  the prior carrying value, and settlement-versus-revaluation serialization
  was absent.

### Reporting, documents, and portability

- Dedicated exposure, realized/unrealized FX, rate-audit, revaluation, foreign
  aging, and statement-currency reconciliation reports do not exist.
- Web money parsing and customer document rendering still assume two decimal
  places. JPY and KWD amounts would render incorrectly.
- Customer, vendor, invoice, estimate, bill, and payment screens do not provide
  the controlled currency/rate workflow claimed by MCFX-15.
- The portable archive remains schema version 1 and omits currency
  definitions, rate snapshots, positions/events, revaluation runs, and FX
  mappings.

## Database and commerce defects

- FX rate, journal, source, monetary-position, and account references used
  single-column foreign keys, permitting cross-organization references when a
  foreign UUID was known.
- The MCFX foundation down script dropped evidence without first refusing
  rollback after foreign adoption.
- Organization currency exponents were mutable.
- Commerce inbox raw evidence was mutable.
- Commerce replay identity ignored `eventVersion`, so a legitimate update
  could be collapsed into the first event. Concurrent duplicate requests could
  both be reported as new.
- The provider-neutral normalized monetary contract, checkpoint/backfill
  linkage, conflict evidence, and required fixture matrix remain incomplete.

## Review remediation

Migration `20260730014000_mcf_review_safety`:

- forces the organization multi-currency flag off and manual rate mode only;
- adds a database release-gate constraint and rejects foreign journal lines;
- replaces affected FX/account/journal references with composite
  organization-scoped foreign keys;
- makes organization currency exponents immutable;
- adds exact rate-orientation comments and same-currency 1:1 validation;
- makes commerce raw evidence immutable; and
- preserves distinct event versions under a version-aware replay key.

Application remediation:

- rejects attempts to enable foreign posting;
- rejects imported/provider rate modes and undocumented manual snapshots;
- rejects foreign journals before accounting work begins;
- disables revaluation preview and posting;
- visibly locks unsafe controls in the web application; and
- serializes commerce replay with a transaction-scoped advisory lock.

Rendered workflow remediation:

- makes the service-required business type visibly required in company setup;
- preserves setup-step API errors instead of replacing them with a false
  success notice;
- returns the eight setup steps in a deterministic accounting workflow order;
  and
- replaces copy that implied foreign invoices could already be posted with a
  clear preparation-only boundary.

The original MCFX foundation down script now refuses to remove the structures
when foreign sources, journals, positions, or referenced rates exist.

## Verification evidence

- `pnpm check` passed formatting, lint, type checking, Prisma validation, all
  builds, 13 API unit files, six accounting-core unit files, three shared unit
  files, the web asset/money tests, and 23 integration files with 162 passing
  database-backed tests.
- The Playwright release-candidate matrix passed in Chrome, Edge, Firefox,
  mobile Chrome, and mobile WebKit. It now asserts the required business type,
  stable setup progress, and visibly disabled multi-currency controls.
- A separate in-app Chrome walkthrough created a disposable company, reproduced
  the two setup defects before repair, and then verified the corrected
  submission behavior, stable eight-step order after reload, desktop/mobile
  layout without horizontal overflow, disabled posting/revaluation controls,
  and an empty warning/error console.
- The empty-database drill rolled all 67 migrations down and redeployed them
  twice. The foreign-adoption drill separately proved that the MCFX foundation
  down migration refuses a USD monetary position.
- The Docker-native backup drill restored a 1,678,757-byte custom archive with
  SHA-256
  `02e57b48b531804548f57143a33048331e8603edec7dc4ea85c593ac6c22af21`
  and all 67 migration records.
- Accessibility, security, and controlled-beta performance contracts passed.
  Production configuration remains unverified because real production
  credentials, approved external adapters, and dated legal/security evidence
  were not supplied.

## Status matrix

| Phase | Reviewed status | Reason                                                      |
| ----- | --------------- | ----------------------------------------------------------- |
| 00    | FAIL            | Decision packet incomplete                                  |
| 01    | GATED           | Required owner/accountant approval artifact absent          |
| 02–09 | FAIL            | Acceptance criteria and tests incomplete                    |
| 10–12 | GATED           | Settlement, banking, and remaining domains incomplete       |
| 13    | FAIL            | Incorrect and incomplete revaluation                        |
| 14    | GATED           | Required FX reports and close controls absent               |
| 15    | FAIL            | UI, documents, contracts, and portability incomplete        |
| 16    | GATED           | No approved provider artifact                               |
| 17    | FAIL            | Inbox contract incomplete; prerequisites not PASS           |
| 18–20 | GATED           | No approved marketplace test environments/posting artifacts |
| 21    | GATED           | Core prerequisite chain and production evidence incomplete  |

## Required restart point

Restart at MCFX-00. Complete the impact inventory and worked accounting
fixtures, obtain the exact user-supplied MCFX-00 approval artifact required by
MCFX-01, and then execute one phase at a time. Do not remove the database
release gate until MCFX-02 through MCFX-14 have valid PASS reports and the
foreign-posting acceptance suite proves source, position, ledger, tax, report,
tenant, replay, concurrency, and rollback behavior.
