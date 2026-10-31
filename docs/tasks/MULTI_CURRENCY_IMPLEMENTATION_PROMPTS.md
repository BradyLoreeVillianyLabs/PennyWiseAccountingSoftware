# ClearLedger Multi-Currency Implementation Prompt Pack

Status: planning artifact. This file does not authorize implementation by itself.

This program adds transaction-level multi-currency accounting to one
organization with one immutable accounting base currency. It does not add
multi-entity consolidation, foreign subsidiaries, presentation-currency
translation, crypto accounting, hedging, derivatives, or automated
multi-country tax compliance.

The recommended first production boundary is:

- an existing Canadian organization keeps CAD as its immutable base currency;
- CAD and USD are the first enabled transaction and settlement currencies;
- the design supports zero-, two-, and three-decimal currencies without
  assuming every currency has cents;
- financial statements and Canadian tax reports remain in CAD;
- foreign invoices, bills, payments, bank accounts, processor clearing, and
  marketplace clearing retain both their original currency and their CAD
  accounting value; and
- WooCommerce and Etsy remain non-posting shadow integrations until the
  accounting foundation and payout reconciliation are proven.

## Risk assessment

A big-bang implementation is high risk. Merely removing the existing CAD
validation would corrupt receivables, payables, tax, banking, inventory, and
reports because the current journal contains only one debit/credit amount set.

The staged program below reduces this to medium, controllable implementation
risk. The highest-risk increments remain:

1. realized foreign-exchange gain and loss on partial settlement;
2. period-end revaluation and reversal;
3. foreign bank reconciliation and cross-currency transfers; and
4. marketplace fee, refund, reserve, and payout accounting.

Each of those increments has its own stop gate and accountant-verifiable
acceptance criteria.

## How to use this pack

1. Give the implementation model the **mandatory prefix** below.
2. Append exactly one phase prompt.
3. Explicitly state: `I authorize MCFX-XX only.`
4. Do not authorize the next phase until the prior completion report is
   reviewed and its prerequisites are satisfied.
5. If the implementation model returns `GATED`, supply the missing decision or
   evidence. Do not tell it to guess.

One pasted prompt authorizes one phase only. A model must never continue into
the next phase because it finished early.

## Mandatory prefix for every phase

```text
Implement only ClearLedger phase [MCFX-XX: TITLE] in:

C:\Users\ancho\V1.VsStudioAccountingSoftwareBuild\ClearLedger-Test-Bundle-0.14.0-rc.1-20260725\ClearLedger-Codex-Ready

This prompt is owner authorization for this phase only. Stop after its
completion report. Do not begin, scaffold, or partially implement a later
phase.

PRODUCTION-SAFETY BOUNDARY

Do not read, write, copy, query, run, stop, restart, configure, inspect
credentials for, or send traffic to:

C:\Users\ancho\Desktop\QB Bridge VS Code - Brady\qbwoo-bridge

Do not alter that project's database, source files, services, webhooks,
WooCommerce configuration, QuickBooks configuration, LocalXpose configuration,
credentials, or runtime. It is an operational production program.

Do not touch the sibling release archive or another extracted ClearLedger
bundle outside ClearLedger-Codex-Ready. Do not access live WooCommerce, Etsy,
exchange-rate, banking, or payment accounts unless this phase explicitly
authorizes a named sandbox or public read-only endpoint and the required
credentials or approval have been supplied.

FIRST ACTIONS

1. Resolve and verify the repository root shown above.
2. Read AGENTS.md, CODEX_MASTER_PROMPT.md,
   docs/tasks/TASK_EXECUTION_STANDARD.md, docs/status/CURRENT_PHASE.md, and this
   phase prompt. For MCFX-02 onward, also read the approved multi-currency ADR
   and every direct prerequisite completion report named by the dependency
   table; every prerequisite must say PASS. MCFX-00 has neither. MCFX-01
   instead requires the approved MCFX-00 decision packet and approval artifact.
   Read only directly relevant source, schema, migrations, tests, and contracts
   after that.
3. If a .git directory exists, run git status --short and preserve unrelated
   user changes. If this bundle has no .git directory, record that fact and use
   a before/after file inventory instead of treating it as an error.
4. If a prerequisite, approved accounting decision, disposable database, or
   required external approval is missing, stop with GATED status. Do not invent
   policy, rates, credentials, provider behavior, or production evidence.
5. Before editing, report only likely files, critical accounting/tenancy/
   migration risks, and genuine blockers.

PERMANENT ACCOUNTING AND ENGINEERING RULES

- One organization has one immutable accounting base currency. Do not implement
  base-currency conversion or multi-entity consolidation.
- Preserve transaction/original currency, settlement currency, and accounting
  base currency as distinct concepts.
- Existing JournalLine.debitMinor and creditMinor remain base-currency ledger
  amounts. Base debits and credits must balance before commit.
- Never use JavaScript number, parseFloat, Math.round, or binary floating point
  for money or exchange-rate calculations. Use bigint minor units and exact
  rational or approved fixed-precision arithmetic.
- Never silently assume a rate of 1 except a validated same-currency conversion.
- Define rate orientation exactly as the approved ADR specifies. Reject inverse
  or ambiguous rates.
- Never fetch a live exchange rate inside a posting transaction.
- Posted sources, rate snapshots, journals, and journal lines are immutable.
  Corrections use linked reversals or adjustments.
- Posting, source state, idempotency, audit, and outbox evidence commit
  atomically.
- Closed periods reject posting and correction.
- Organization scope comes from authenticated membership, never request data.
- Add tenant filters, composite tenant foreign keys, forced RLS, authorization,
  cross-tenant tests, replay tests, and concurrency tests where applicable.
- Schema changes are additive and backward-compatible. Add a new forward/down
  migration; never edit a historical migration or rewrite posted history.
  Down-migration verification is limited to a disposable database before
  multi-currency adoption. Once foreign rates, positions, or postings exist,
  rollback means organization-level disablement, backward-compatible
  application deployment, forward repair, or complete backup restoration—
  never dropping foreign-currency evidence.
- Never run db:reset, rollback verification, or destructive SQL against a
  non-disposable database.
- Do not manually edit generated Prisma client output.
- Do not use TODOs, placeholders, fake provider success, or broad unrelated
  refactors.
- Do not claim a command passed unless its observed exit code was zero.

TEST AND REPORT RULES

Run targeted tests while working. At the phase gate, run the relevant repository
checks, normally:

corepack.cmd pnpm format:check
corepack.cmd pnpm lint
corepack.cmd pnpm typecheck
corepack.cmd pnpm db:validate
corepack.cmd pnpm db:generate
corepack.cmd pnpm test
corepack.cmd pnpm test:integration
corepack.cmd pnpm build

Schema phases also require clean migration deployment and rollback verification
on a clearly named disposable PostgreSQL database. UI phases require applicable
browser and accessibility tests. Release phases require backup/restore and
release verification.

Write docs/status/MCFX_XX_COMPLETION_REPORT.md containing the items below.
Exceptions: MCFX-20 must use
docs/status/MCFX_20_WOOCOMMERCE_COMPLETION_REPORT.md or
docs/status/MCFX_20_ETSY_COMPLETION_REPORT.md. MCFX-21 must use
docs/status/MCFX_21_<RATE_MODE>_<CONNECTOR_SET>_COMPLETION_REPORT.md, replacing
the placeholders with the selected values and never creating a filename that
contains brackets.

- PASS, FAIL, or GATED;
- materially changed files and migrations;
- tests added and observed results;
- every command with pass/fail/skipped status;
- accounting, tenancy, authorization, migration, idempotency, and concurrency
  evidence;
- unresolved risks;
- exact prerequisites for the next phase; and
- git status or the no-git before/after file summary.

At the start of authorized work, update docs/status/CURRENT_PHASE.md additively
to mark this MCFX phase authorized and in progress without erasing unrelated
history. At completion, update it to the observed PASS, FAIL, or GATED result
without claiming another phase complete, then stop.
```

## Dependency order

```text
00 -> 01 -> 02 -> 03 -> 04 -> 05 -> 06
                                  |-> 07 -> 08 --\
                                  |-> 09 -> 10 ---+-> 11 -> 12 -> 13 -> 14 -> 15
                                  \--------------/

04 + 06 -> 16
05 + 06 -> 17 -> 18
               \-> 19
08 + 10 + 11 + 14 + 18 -> 20-WOO
08 + 10 + 11 + 14 + 19 -> 20-ETSY
00 through 15 -> 21
16 -> 21 when Rate mode = AUTOMATIC
17 + 18 + 20-WOO -> 21 when WooCommerce is selected
17 + 19 + 20-ETSY -> 21 when Etsy is selected
```

| Phase   | Direct prerequisite reports and approvals                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| MCFX-00 | None                                                                                                         |
| MCFX-01 | MCFX-00 plus owner/accountant decision approval                                                              |
| MCFX-02 | MCFX-01                                                                                                      |
| MCFX-03 | MCFX-02                                                                                                      |
| MCFX-04 | MCFX-02, MCFX-03                                                                                             |
| MCFX-05 | MCFX-03, MCFX-04                                                                                             |
| MCFX-06 | MCFX-05                                                                                                      |
| MCFX-07 | MCFX-06                                                                                                      |
| MCFX-08 | MCFX-07                                                                                                      |
| MCFX-09 | MCFX-06                                                                                                      |
| MCFX-10 | MCFX-09                                                                                                      |
| MCFX-11 | MCFX-06, MCFX-08, MCFX-10                                                                                    |
| MCFX-12 | MCFX-07, MCFX-09, MCFX-11                                                                                    |
| MCFX-13 | MCFX-08, MCFX-10, MCFX-11, MCFX-12                                                                           |
| MCFX-14 | MCFX-13                                                                                                      |
| MCFX-15 | MCFX-14                                                                                                      |
| MCFX-16 | Optional: MCFX-04, MCFX-06 plus approved provider and terms                                                  |
| MCFX-17 | MCFX-05, MCFX-06                                                                                             |
| MCFX-18 | MCFX-17 plus approved WooCommerce test store                                                                 |
| MCFX-19 | MCFX-17 plus approved Etsy app/test shop                                                                     |
| MCFX-20 | Per provider: MCFX-08, MCFX-10, MCFX-11, MCFX-14, and either MCFX-18 or MCFX-19 plus posting approval        |
| MCFX-21 | Always MCFX-00–15; add MCFX-16 for AUTOMATIC rates; add MCFX-17/18/20-WOO and/or 17/19/20-ETSY per selection |

## MCFX-00: Impact inventory and accounting decision packet

```text
I authorize MCFX-00 only.

This is a documentation-only phase. Do not modify runtime code, Prisma schema,
migrations, tests, or package dependencies.

Create the multi-currency impact inventory and accountant decision packet.
Inspect every money-bearing model, service, API schema, report, import/export,
document renderer, UI formatter, and database constraint. Use targeted searches
for CAD, currency, Minor, amount, debit, credit, price, cost, tax, payment,
refund, bank, transfer, inventory, asset, budget, forecast, and rate.

The decision packet must resolve or explicitly gate:

1. immutable organization base/functional currency;
2. transaction, settlement, and base currency definitions;
3. initial enabled currencies and currency exponent source;
4. exact exchange-rate quote direction;
5. initial-recognition rate date and allowed sources;
6. weekend/holiday fallback and stale-rate behavior;
7. exact rounding and converted-component allocation;
8. manual-rate entry, approval, correction, and provenance;
9. monetary versus non-monetary classifications;
10. realized FX on partial and final settlement;
11. unrealized FX, closing rates, automatic first-day next-period reversal, and
    period-close behavior; any different first-release policy requires an
    explicit approved decision;
12. tax conversion policy, owner confirmation, and acceptance evidence;
13. foreign bank, card, undeposited-funds, processor, and marketplace clearing
    treatment;
14. credit note, refund, dispute, overpayment, and write-off treatment;
15. inventory and fixed-asset historical-cost treatment;
16. historical/opening foreign balance migration;
17. unsupported cases and the staged rollout boundary; and
18. exact journal examples for invoice, bill, partial settlement, refund,
    cross-currency transfer, revaluation, and settlement after revaluation.

Recommended first-release boundary: existing Canadian companies retain CAD
base currency; CAD and USD are initially enabled; same-currency allocations
only; financial statements and Canadian tax reports remain CAD. Design the
arithmetic for other currency exponents but do not promise unsupported
currencies.

Record unresolved accounting judgments as explicit blocking questions for the
organization owner.
Produce docs/tasks/MCFX_00_ACCOUNTING_DECISION_PACKET.md and the completion
report.

Acceptance: every money-bearing domain and hard-coded CAD assumption is
classified, no professional judgment is disguised as an implementation detail,
and the packet is ready for owner test-evidence acceptance. Stop. No
implementation is permitted.
```

## MCFX-01: Approved architecture, ADR, and executable specifications

```text
I authorize MCFX-01 only after the owner-approved MCFX-00 packet and its
required test-evidence rule are present.

This remains documentation-only. Resolve the current source-of-truth conflict
where CODEX_MASTER_PROMPT.md and docs/PRODUCT_REQUIREMENTS.md exclude foreign
exchange from the MVP.

Require the recorded owner decision and passing accounting acceptance evidence
for the exact revision. Accountant review is recommended but is not a mandatory
ClearLedger gate. If the owner decision or required evidence is absent or
incomplete, return GATED.

Create an ADR for the approved multi-currency accounting model. Update only the
authoritative requirements, architecture, posting rules, decisions/open
questions, migration/portability contract, and phase status necessary to make
the approved program executable.

Reconcile the existing Phase 23 commerce task with the owner's declared
platform order: WooCommerce first, direct Etsy second, and Shopify deferred
unless separately re-prioritized. Update planning documentation only; do not
implement or imply that provider gates have passed.

The ADR must specify:

- one immutable base currency per organization;
- the meaning of every existing and new money field;
- the exact rate representation and orientation;
- currencies and exponents;
- source-document versus ledger amounts;
- immutable rate snapshots;
- monetary-position event history;
- realized/unrealized FX algorithms;
- the first-release automatic next-period revaluation-reversal policy and
  settlement-after-reversal behavior;
- tax, inventory, and fixed-asset boundaries;
- account mappings;
- migration/backfill/rollback strategy;
- feature-stage rollout;
- provider gates and the owner test-evidence acceptance rule; and
- explicitly unsupported cases.

Include worked, balanced examples with integer minor units. Define acceptance
fixtures that later phases must reuse.

Do not change production code, schema, migrations, or tests.

Acceptance: no accounting semantic is left for a coding model to invent.
Produce the completion report and stop.
```

## MCFX-02: Exact currency and FX arithmetic core

```text
I authorize MCFX-02 only.

Implement pure TypeScript currency and conversion primitives in
packages/accounting-core. Inspect the existing money and rounding utilities
before adding new modules.

Add:

- CurrencyDefinition with uppercase code and minor-unit exponent;
- a controlled, versioned supported-currency registry that is easy to extend
  but never permits an already-used code's exponent to change in place;
- strict decimal-string-to-minor-unit parsing and canonical serialization;
- exponent-aware formatting support for zero-, two-, and three-decimal
  currencies;
- an exact positive rational exchange rate using bigint numerator/denominator;
- the ADR-approved quote orientation;
- conversion that adjusts both source and base currency exponents;
- deterministic half-unit rounding using the approved existing policy;
- deterministic largest-remainder allocation so converted components equal the
  converted control total exactly; and
- overflow/range checks before PostgreSQL BIGINT persistence.

Do not add database, service, route, or UI changes. Do not add a floating-point
money library.

Test CAD, USD, EUR, GBP, JPY, and KWD; 1:1 conversion; positive and negative
reversals; ambiguous/inverse rates; zero and invalid denominators; half-unit
boundaries; very large values; overflow; deterministic remainder allocation;
registry extension without historical-definition drift; and repeated
byte-identical serialization. Add property-style test loops proving sum
preservation without introducing a new test dependency unless justified.

Acceptance: no conversion path uses JavaScript number and every converted
component set sums exactly to its converted total. Complete the phase report and
stop.
```

## MCFX-03: Additive multi-currency schema and base-currency backfill

```text
I authorize MCFX-03 only.

Implement the approved additive database foundation. Do not edit any historical
migration. Create a new forward migration and its verified down path.

Add the approved core structures for:

- organization currency feature stage and enabled currencies;
- immutable exchange-rate snapshots and provenance;
- rate-policy and FX-account configuration;
- base-currency snapshots on journals;
- transaction-currency metadata and optional rate linkage on journal lines;
- persisted currency-definition/version and exponent snapshots on immutable
  rates, posted sources, and journal currency metadata;
- original and base amount fields required by currently posted financial
  sources; and
- organization-scoped MonetaryPosition and append-only MonetaryPositionEvent
  persistence, including source/account identity, currency, original and
  outstanding transaction amounts, historical/current base carrying amounts,
  cumulative realized/unrealized amounts, sequence/version, journal/rate
  linkage, and immutable event provenance.

This phase owns the persistence models, migrations, RLS, constraints, and
backfill. MCFX-05 and MCFX-06 must wire behavior to these structures and must
not create competing journal, position, rate, or organization-currency models.

Use exact bigint/rational storage from the ADR. Add database comments defining
rate orientation. Add composite organization foreign keys, checks, useful
pair/date indexes, forced RLS, runtime grants, and immutability triggers.
Preserve the existing base-currency lock.

Use expand/backfill/validate/contract steps. Backfill every existing
same-currency record as an explicit validated 1:1 conversion using its
organization base currency. Preserve every ID, posting key, amount, timestamp,
and journal balance. Never reinterpret historical CAD values using an external
rate.

The down migration must explicitly refuse to remove the structures if any
referenced rate, foreign monetary position/event, or foreign journal/source
record exists. It may succeed only on a verified disposable pre-adoption
database containing compatible same-currency backfill data.

Add migration verification for clean install, upgrade from the current schema,
row counts, totals, constraints, tenant isolation, posted-history immutability,
down migration on a disposable database, and unchanged CAD reports.

Acceptance: pre/post control totals and existing CAD behavior are identical.
Foreign posting remains disabled. Complete the phase report and stop.
```

## MCFX-04: Exchange-rate catalog and manual-rate workflow

```text
I authorize MCFX-04 only.

Implement the provider-neutral exchange-rate service and authorized manual
workflow using the MCFX-03 schema.

Support rate purposes TRANSACTION, CLOSING, AVERAGE, and ACTUAL_SETTLEMENT;
manual entry and deterministic CSV import; requested effective date; actual
observation date; base and transaction currencies; exact numerator/denominator;
source; provider reference; provenance; approval; creator; supersession; and
retrieval timestamp.

Rules:

- same-currency conversion is explicit and exactly 1:1;
- an approved or referenced rate is immutable and cannot be deleted;
- correction creates a superseding record and never rewrites a posted source;
- unavailable or disallowed rates fail closed;
- weekend fallback records both requested and observed dates;
- “latest” is never silently substituted for a historical date;
- concurrent duplicate imports are idempotent; and
- secrets or complete imported files never enter logs.

Add permissions, tenant-derived routes, optimistic concurrency where mutable
draft policy exists, audit/outbox events, redacted logs, OpenAPI contracts, and
unit/PostgreSQL integration tests. Do not implement a live provider yet.

Acceptance: cross-tenant access fails, rate corrections preserve referenced
history, and no posting service fetches or selects a rate implicitly. Complete
the phase report and stop.
```

## MCFX-05: Dual-currency ledger posting foundation

```text
I authorize MCFX-05 only.

Extend the journal and posting services without changing the meaning of
JournalLine.debitMinor and creditMinor: they remain base-currency amounts and
are the only values used to prove ledger balance and prepare financial
statements.

Wire and validate the existing MCFX-03 journal persistence; do not create a
second journal-currency schema:

- use Journal.baseCurrencySnapshot;
- use line transactionCurrency, transactionDebitMinor,
  transactionCreditMinor, and optional immutable rate-snapshot reference;
- exact base/transaction line validation;
- an FX posting builder that converts approved components deterministically;
- an explicit residual-allocation rule from the ADR;
- atomic rate locking with source state, journal, audit, idempotency, and outbox;
- reversal that swaps both amount sets and retains the original rate evidence;
- base-only manual journals and opening balances unless a later dedicated
  workflow authorizes foreign monetary openings; and
- mixed-transaction-currency support within one journal without ever summing
  unlike currencies to test balance.

Implement the shared MonetaryPositionService over the MCFX-03 persistence:

- immutable ORIGIN, SETTLEMENT, CREDIT, WRITE_OFF, REVALUATION,
  REVALUATION_REVERSAL, and CORRECTION events;
- a lockable/rebuildable projection rather than mutable accounting evidence;
- exact proportional carrying relief with the final event consuming all
  transaction/base residue;
- optimistic versioning plus row locks for settlement/revaluation races; and
- rejection of out-of-sequence or unsupported backdated events.

Add database and service negative tests for missing/ambiguous rates, unbalanced
base entries, invalid sides, currency mismatch, mutation, closed periods,
position reconstruction, over-settlement, final-residue allocation,
cross-tenant references, replay, and concurrent posting.

Acceptance: all journals balance in base currency, old CAD journal/report
fixtures remain identical, and transaction amounts are traceable but never
mistaken for ledger balance. Complete the report and stop.
```

## MCFX-06: Organization, account, and party currency settings

```text
I authorize MCFX-06 only.

Wire services, validation, routes, and authorization to the MCFX-03
organization-currency persistence. Do not create competing enabled-currency,
feature-stage, rate-policy, or account-mapping tables.

Support:

- an owner/admin-managed enabled-transaction-currency allowlist;
- customer and vendor default currencies;
- international customer/vendor billing and shipping addresses using explicit
  ISO country codes and country-appropriate region/postal validation, without
  weakening the Canadian organization/tax-registration boundary;
- rate-source/manual-override permissions and stale-rate policy;
- effective-dated, validated account mappings for realized gain, realized loss,
  unrealized gain, unrealized loss, and transfer clearing, with referenced
  versions locked against mutation;
- explicit currency on foreign bank/card, undeposited-funds,
  processor-clearing, and marketplace-clearing accounts;
- control-account eligibility and currency rules; and
- a disabled-by-default rollout stage such as OFF, DISPLAY, DRAFT, and POSTING.

Keep the organization base currency visibly and technically locked after any
posted activity. Do not add a base-currency conversion workflow. Do not enable
foreign posting in this phase.

Do not create a generic FX-rounding account. Internal conversion residuals must
be eliminated by the approved deterministic allocation. An external settlement
difference needs explicit source provenance, an accountant-approved threshold,
and review; it must never hide a missing rate, fee, mapping, or source amount.

Replace only directly relevant CAD literals in organization/customer/vendor
contracts. Do not perform the later full UI cleanup. Add version checks,
authorization, audit evidence, tenant consistency, RLS tests, invalid account
mapping tests, unsupported currency tests, and base-lock regression tests.

Acceptance: no user can select a currency not enabled for the organization, no
invalid account can become an FX control account, and existing CAD organizations
behave unchanged. Complete the report and stop.
```

## MCFX-07: Foreign sales documents and receivables

```text
I authorize MCFX-07 only.

Enable transaction currency on customers, estimates, recurring invoice
templates, invoices, credit notes, customer deposits, and progress billing.

Rules:

- all existing document/line Minor fields are transaction-currency amounts;
- a draft can preview a newly selected approved rate;
- issue/post locks the rate snapshot and persisted base net, discount,
  shipping, tax, and total components plus the currency-definition/exponent
  snapshot;
- lines in one document cannot mix currencies;
- tax is calculated in document currency and converted using the approved tax
  policy;
- AR posts in base currency while preserving the foreign control amount;
- revenue and tax remain at historical recognized base amounts and are not
  revalued later;
- estimate conversion preserves currency but obtains the correct rate under the
  ADR rather than blindly copying a stale draft rate;
- recurring generation resolves the generation-date rate, not the template
  creation rate; and
- linked credit notes follow the approved original-document/correction policy.

Until per-currency product price books are implemented in MCFX-12, require
explicit document-currency unit prices. Do not silently convert or relabel a
product's base-currency catalog price.

Require deposit classification at creation under the approved ADR:

- refundable deposit or unapplied customer credit is a foreign monetary
  liability/credit position and is eligible for revaluation;
- a non-refundable customer advance for future goods/services is a
  non-monetary contract liability/deferred-revenue balance on the seller's
  books, mapped to the approved liability account, retained at historical base
  value, and not revalued; and
- a progress invoice is monetary AR.

Persist the classification and historical rate evidence. Define guarded
application, refund, cancellation, forfeiture, and reclassification paths; do
not let a later setting silently change the classification.

Open the approved append-only foreign monetary position when an invoice posts.
Use exact component allocation so base credits equal the AR base control amount.

Add tests for base and foreign documents, zero-/three-decimal rejection or
support according to the allowlist, tax rounding, issue/post immutability,
conversion, recurring generation, credit notes, closed periods, replay,
concurrency, and tenant attacks.

Acceptance: the USD 100.00 fixture at 1 USD = 1.350000 CAD retains USD 100.00
and posts balanced CAD 135.00. Complete the report and stop.
```

## MCFX-08: Customer receipts, refunds, and realized FX

```text
I authorize MCFX-08 only.

Extend manual and hosted customer payments, allocations, processor clearing,
refunds, disputes, receipts, chargebacks, and unapplied customer money.

First-release rules:

- an allocation currency must equal the invoice currency;
- a foreign receipt uses an approved settlement-date rate or documented actual
  settlement conversion;
- each allocation stores foreign amount, invoice base carrying amount relieved,
  settlement base amount, and realized FX;
- partial allocations use exact proportional carrying relief;
- the final allocation consumes every remaining foreign/base rounding residue;
- realized gain/loss is never hidden in processing fees, revenue, tax, or
  rounding;
- unapplied foreign receipts use the immutable monetary/non-monetary
  classification established in MCFX-07 rather than always being treated the
  same;
- refunds and disputes use their own dated valuation and linked correction
  events; and
- webhook replay or concurrent allocation cannot over-apply or double-post.

When a receipt enters a foreign bank account, create/increase that bank
monetary position at the receipt-date base value. When it relieves an existing
processor/marketplace clearing balance, also relieve that clearing position at
its actual carrying value and recognize its separate FX difference.

Example: assuming the receipt creates a new USD bank position, a USD 100
invoice carried at CAD 135 and collected at CAD 137 posts debit foreign bank
137, credit AR 135, and credit realized FX gain 2. Do not reuse this shortcut
when disposing of foreign cash or clearing that already has a different base
carrying value.

Implement foreign bad-debt/write-off workflow: extinguish AR at its current base
carrying value, reverse or reclassify attributable unrealized FX under the ADR,
apply the accountant-approved tax adjustment, preserve original revenue, and
record immutable reason/authorization evidence.

Add provider-currency mismatch, partial/final settlement, overpayment, refund,
deposit classification/application, bad debt/write-off, prior-rate clearing,
dispute, reversal, stale event, out-of-order event, idempotency, concurrency,
closed-period, authorization, and tenant-isolation tests.

Acceptance: the monetary position, AR control account, payment, and realized FX
reconcile exactly after every scenario. Complete the report and stop.
```

## MCFX-09: Foreign purchases, bills, and payables

```text
I authorize MCFX-09 only.

Enable vendor default currency and transaction/rate snapshots on purchase
documents, bills, immediate expenses, vendor credits, and relevant purchase
tax components.

Rules:

- document Minor fields remain transaction-currency values;
- posting persists converted base expense, asset/inventory acquisition,
  recoverable tax, non-recoverable tax, and AP control amounts;
- a foreign bill opens one append-only AP monetary position;
- later FX never rewrites recognized expense, tax, inventory cost, or source
  history;
- vendor credits follow the ADR-approved linked-document rate/correction policy;
- lines and applications cannot mix currencies; and
- foreign immediate expenses require an explicitly compatible bank/card/
  clearing currency and settlement treatment.

Add deterministic component allocation and exact base balancing. Add tests for
foreign service and inventory bills, purchase taxes, discounts/shipping,
credits, corrections, closed periods, immutable posting, replay, concurrency,
authorization, and cross-tenant references.

Acceptance: the USD 100 fixture at 1.35 posts debit the approved base
expense/asset CAD 135 and credit AP CAD 135 while retaining USD 100. Complete
the report and stop without implementing bill settlement.
```

## MCFX-10: Vendor settlement, cards, and realized FX

```text
I authorize MCFX-10 only.

Implement foreign bill payments, partial/final allocations, vendor-credit
applications, card settlements, reversals, and payment fees.

Rules:

- settlement/allocation currency must match the bill or credit currency in the
  first release;
- allocation stores transaction amount, AP base carrying amount relieved,
  settlement base amount, and realized FX;
- payment from a foreign bank/card/clearing account relieves that account's own
  base carrying value; AP settlement FX and disposal FX on foreign cash/
  clearing are calculated and identified separately;
- final settlement consumes the exact remaining residue;
- payment fees are separate from FX;
- replays and concurrent payments cannot over-settle or duplicate journals;
- reversals retain original rate snapshots and position-event lineage; and
- no payment uses a new rate to rewrite the original bill.

Examples:

- If the USD 100 cash position is carried at CAD 137, a USD 100 bill carried at
  CAD 135 posts debit AP 135, debit AP realized FX loss 2, and credit foreign
  bank 137.
- If that same USD cash is carried at CAD 130, post debit AP 135, debit AP
  realized FX loss 2, credit foreign bank carrying value 130, and credit
  realized FX gain on disposal of foreign cash 7.

Do not credit a foreign bank at the current spot value unless that equals the
bank position's proven carrying value.

Add partial/final payment, vendor credit, fee, refund, failed payment,
prior-rate/prior-revaluation foreign cash disposal, reversal, closed-period,
duplicate provider event, idempotency, concurrency, authorization, and
tenant-isolation tests.

Acceptance: AP position events and the AP control account reconcile exactly,
with no unexplained foreign or base residue. Complete the report and stop.
```

## MCFX-11: Foreign banking, transfers, and reconciliation

```text
I authorize MCFX-11 only.

Enable foreign bank/card accounts, CSV and OFX/QFX import, matching,
categorization, same-currency transfers, cross-currency transfers, and statement
reconciliation.

Requirements:

- each financial account has one explicit account/statement currency;
- every foreign bank/card/undeposited-funds/clearing balance is backed by
  monetary-position events recording acquisition, disposal, transfer,
  revaluation, and reversal of its transaction and base carrying amounts;
- imported rows retain exact statement currency and exponent;
- missing currency never defaults a foreign statement to CAD;
- a file currency that conflicts with the selected account fails visibly;
- statement reconciliation operates in statement currency;
- a separate GL proof reconciles the account's base carrying amount;
- matching compares compatible transaction amounts/currencies and linked base
  journals rather than comparing unlike numbers;
- categorization uses an approved dated rate;
- same-currency transfers preserve both transaction and base amounts;
- cross-currency transfers require explicit source amount, destination amount,
  both currencies, actual conversion provenance, and separate fees;
- disposal of the source foreign balance uses its proven base carrying value
  and separately identifies realized FX on foreign cash/clearing;
- acquisition of the destination foreign balance establishes its new base
  carrying value from the actual conversion;
- never infer an actual bank conversion from a generic daily rate; and
- use transfer clearing when source and destination dates differ.

Add tests for USD statements, currency mismatch, duplicates, matching,
categorization, same/cross-currency transfers, fee/rounding treatment,
prior-rate and prior-revaluation acquisitions/disposals, reconciliation
close/reopen, locked periods, replay, concurrency, RLS, and tenant attacks.

Acceptance: statement balances reconcile in their own currency and the base GL
reconciles independently without manufactured FX or fees. Complete the report
and stop.
```

## MCFX-12: Inventory, fixed assets, projects, and remaining-domain closure

```text
I authorize MCFX-12 only.

Close every remaining money-bearing domain deliberately.

Inventory:

- quantity and weighted-average carrying value remain in organization base
  currency;
- foreign receipts retain source currency/rate and enter inventory at approved
  historical converted cost;
- later AP FX goes to FX gain/loss, never inventory;
- returns use stored historical base carrying cost; and
- COGS remains base currency and is independent of sales-invoice currency.

Fixed assets:

- retain foreign acquisition evidence and approved acquisition rate;
- book cost, accumulated depreciation, and depreciation remain base historical
  cost; and
- do not revalue an asset merely because exchange rates change.

Products and planning:

- add approved per-currency sale/purchase price support without silently
  converting catalog values;
- classify projects, time rates, mileage, budgets, forecasts, purchase
  requests, fixed-asset previews, deposits, opening balances, and other
  remaining models as multi-currency, explicitly base-only, or rejected with a
  clear error;
- replace CAD labels with base-currency semantics where a workflow remains
  base-only; and
- add foreign monetary opening balances only if the ADR provides both foreign
  outstanding amount and accountant-approved base carrying amount.

Foreign loans are outside the first-release boundary unless this phase adds a
complete approved loan principal/interest/payment monetary-position workflow.
Otherwise reject them explicitly and do not include them in revaluation.

Run a targeted hard-coded-CAD and divide-by-100 scan across source, schema,
migrations, tests, and UI. Document every remaining result as required,
historical, test fixture, or defect; no unexplained result may remain.

Acceptance: inventory-to-GL, asset-to-GL, and every affected control report
reconcile after foreign transactions. Complete the report and stop.
```

## MCFX-13: Period-end revaluation and close

```text
I authorize MCFX-13 only.

Implement preview, approve, post, reverse, and supersede workflows for
period-end revaluation of open foreign monetary positions.

Include only approved monetary balances such as AR, AP, foreign bank/card,
foreign undeposited funds, processor clearing, marketplace clearing, foreign
refundable deposits, and any separately implemented approved loan workflow.
Exclude revenue, expense, tax history, inventory, fixed assets, non-refundable
customer-advance/contract-liability balances, equity, unsupported foreign loans,
and other historical-cost non-monetary items.

A revaluation run must snapshot:

- organization, period, and valuation date;
- included position/account and outstanding foreign amount;
- prior base carrying amount;
- approved closing-rate ID and provenance;
- target base carrying amount;
- posted delta; and
- unrealized gain/loss account and journal lineage.

Also persist an eligibility watermark/hash covering every included position
event, relevant account balance, rate, and source through the valuation date.
Any later-posted or corrected source dated on or before that valuation date
makes the run stale. Block period close and require an authorized linked
reversal plus rerun; never silently patch the old batch.

Post only the delta. Position events, journal, audit, idempotency, and outbox
must commit atomically. Implement automatic exact reversal on the first day of
the next open period. A later-dated settlement must not proceed while its
revaluation reversal is pending; execute the approved reversal first. Runs are
immutable; changed rates require a linked reversal/superseding run.

Serialize payment-versus-revaluation races. Reject missing closing rates,
settled positions, stale projections, unauthorized overrides, and closed-period
changes.

Add a mandatory fixture: USD 100 initially carried at CAD 135, revalued to CAD
136 at period end, automatically reversed to CAD 135 on the first day of the
next period, then settled at CAD 137 with CAD 2 realized gain and zero remaining
unrealized balance. Add a backdated invoice/payment/correction fixture proving
the prior run becomes stale and cannot close until reversed and rerun.

Acceptance: same-rate rerun is idempotent, changed-rate correction is linked,
the eligibility watermark detects backdated changes, next-period reversal is
exact, settlement cannot bypass a pending reversal, settled positions retain no
unrealized residue, and every monetary-position carrying value reconciles to
its control account. Complete the report and stop.
```

## MCFX-14: Tax, reports, dashboards, and period-close controls

```text
I authorize MCFX-14 only.

Update reporting and accountant controls so no report ever sums unlike
currencies without approved conversion and explicit labeling.

Rules:

- trial balance, general ledger, profit/loss, balance sheet, cash-flow views,
  Canadian tax reports, and dashboard totals remain base-currency reports
  derived from posted base journal amounts;
- general-ledger detail may show transaction currency/amount and rate
  provenance beside base debit/credit;
- AR/AP aging shows original and outstanding foreign amount, historical base,
  current carrying base, realized FX, unrealized FX, and rate/date;
- bank reconciliation is printed in statement currency with a separate base
  carrying proof;
- add currency-exposure, realized/unrealized FX, rate-audit, and revaluation-run
  reports;
- customer/vendor statements do not combine currencies into an unlabeled
  total;
- Canadian tax output remains CAD using persisted approved tax conversion
  snapshots; and
- FX changes never rewrite posted tax liability/recoverable amounts.

Period close must detect missing approved closing rates, incomplete
revaluations, unreconciled position/control balances, and unresolved foreign
clearing differences and block with actionable details.

Update CSV exports with unambiguous names such as transactionCurrency,
transactionAmountMinor, baseCurrency, baseAmountMinor, rateId, and rateDate.

Acceptance: every report reconciles to the base ledger, uses stored historical
rates, and exposes foreign detail without relabeling it as base currency.
Complete the report and stop.
```

## MCFX-15: Product UI, documents, API, and portability

```text
I authorize MCFX-15 only.

Complete the user-facing and external contract layer.

UI:

- replace free-text currency entry with controlled accessible selectors;
- show ISO code wherever $, ¥, or another symbol is ambiguous;
- format and parse using the currency exponent rather than hardcoded cents;
- show transaction amount, approved rate, rate source/date, base preview, and
  rounding result where appropriate;
- make missing, stale, fallback, manual, and actual settlement rates visibly
  distinct;
- require reason and permission for manual overrides; and
- keep base currency visibly locked.

Documents:

- estimates, invoices, credit notes, receipts, statements, and emails show the
  customer/vendor document currency correctly;
- internal/accountant views may show base equivalents without exposing
  confusing duplicate totals to customers; and
- remove Number(value)/100 and other floating formatting paths.

Contracts and portability:

- update Zod schemas, routes, OpenAPI, webhooks, CSV/import templates, migration
  adapters, and organization export;
- precision-sensitive values and rates are strings;
- increment the portable schema version; and
- round-trip original amounts, base amounts, rate snapshots, monetary-position
  events, revaluations, account mappings, and currency-definition/exponent
  snapshots.

Run browser, keyboard, screen-reader labeling, document-render, import/export,
backward-compatibility, and API contract tests.

Acceptance: a user cannot post until currency/rate/account requirements are
satisfied, and no rendered/API amount is ambiguous. Complete the report and
stop.
```

## MCFX-16: Approved live exchange-rate provider

```text
I authorize MCFX-16 only if the provider, terms, accounting policy, and network
use have been explicitly approved. Otherwise return GATED.

Require a user-supplied docs/approvals/MCFX_FX_PROVIDER_APPROVAL.md identifying
the provider, official documentation and terms/version reviewed, permitted use
and licensing decision, approved currency pairs and rate purposes, approver
name/role, approval date, and exact ADR revision. Do not create or sign this
artifact for the approver. If it is absent or incomplete, return GATED.

Implement the approved provider behind the MCFX-04 interface. For a CAD-base
pilot, the recommended candidate is the public Bank of Canada Valet API:
https://www.bankofcanada.ca/valet-api-how-to/

Before editing, verify the current official provider documentation and terms at
execution time. Record direct official URLs, access date, confirmed series/
orientation, and fixture provenance in the phase report. If these cannot be
confirmed, return GATED rather than relying on this planning document.

Requirements:

- use official documented endpoints and quote orientation;
- retain raw provider observation, series, requested date, observed date,
  retrieval time, and provenance;
- cache daily observations and never call the provider during posting;
- use bounded timeouts, retry/backoff, circuit/outage behavior, and rate-limit
  respect;
- implement the approved weekend/holiday fallback visibly;
- reject missing/stale/unsupported currency observations;
- require explicit manual fallback rather than fabricating a rate;
- make import idempotent under concurrent scheduler runs;
- redact logs and emit health/last-success diagnostics; and
- use recorded official fixtures for tests, not live network calls.

Do not claim the provider supports non-CAD base currencies unless proven and
approved. Do not silently construct cross rates. A separately approved
cross-rate policy requires its own fixtures and provenance.

Acceptance: provider outage cannot corrupt or partially post a transaction,
cached rates remain immutable after use, and a user can see the exact source
and observation date. Complete the report and stop.
```

## MCFX-17: Commerce monetary-event contract and staging inbox

```text
I authorize MCFX-17 only.

Implement a provider-neutral, non-posting commerce inbox using the Phase 22
connector runtime. Do not implement WooCommerce or Etsy HTTP clients yet.

Permit multiple installations/shops per provider. Add immutable raw-event
evidence, provider/shop/resource identity, event/version deduplication,
checkpoints, bounded backfill jobs, retry/dead-letter state, mapping versions,
external-resource links, conflicts, and redacted logs.

The normalized monetary contract must distinguish:

- order/sale currency and exact source amounts;
- payment currency;
- settlement/payout currency;
- organization base currency;
- products, shipping, discounts, tips, fees, and taxes;
- marketplace-collected/remitted tax;
- refunds, cancellations, chargebacks, reserves, and adjustments;
- fulfilment/inventory facts;
- payment and payout identifiers; and
- missing currency/rate/SKU/tax/account/location mappings.

Preserve the raw provider amount representation before conversion. Unknown
data enters human review and never guesses or posts. The inbox may create only
review records/drafts; it must not create a journal, payment, invoice, tax
entry, or inventory movement.

Add contract fixtures for out-of-order updates, duplicates, edits, refunds,
unknown precision, multiple stores, and mismatched order/payment/payout
currencies.

Acceptance: replay cannot duplicate an inbox record, cross-tenant provider IDs
cannot collide, and no canonical contract field assumes provider-specific
behavior. Complete the report and stop.
```

## MCFX-18: Independent WooCommerce shadow connector

```text
I authorize MCFX-18 only.

Build a new ClearLedger WooCommerce adapter. Do not inspect, copy, import,
modify, call, or reuse the runtime, credentials, database, webhook, or
configuration of the operational QBWooBridge.

Use separate ClearLedger credentials and webhook secrets only when supplied.
Until then, implement against sanitized fixtures and an explicitly named test
store. Start with read-only REST permissions.

Before editing provider behavior, verify current official WooCommerce
documentation for the REST version, authentication, pagination, webhook headers
and signature scheme, refunds, and test-store capabilities. Record direct URLs,
access date, and fixture provenance. If a required behavior or approved test
store cannot be confirmed, return GATED and do not infer it from QBWooBridge.

Implement:

- WooCommerce REST API v3 authentication and bounded pagination/backfill;
- raw-body HMAC webhook verification;
- delivery/event deduplication;
- order-created/order-updated plus scheduled reconciliation;
- refunds and canceled/edited orders;
- exact parsing of string monetary values and provider currency precision;
- products/SKUs/variations, shipping, discounts, coupons, fees, taxes, payment
  methods, and source metadata;
- multiple independent stores per organization;
- checkpoints, rate-limit/backoff behavior, reconnect, health, and redacted
  diagnostics; and
- normalized staging into MCFX-17 only.

Official references:

- https://developer.woocommerce.com/docs/apis/rest-api/
- https://developer.woocommerce.com/docs/apis/rest-api/authentication/
- https://developer.woocommerce.com/docs/best-practices/urls-and-routing/webhooks

Do not write stock/order state back to WooCommerce. Do not create accounting
entries. Run shadow comparisons of order count, gross, discounts, shipping,
fees, tax, refunds, currency, and SKU mapping.

Acceptance: sanitized and test-store totals reconcile to WooCommerce while the
production QBWooBridge remains untouched. Complete the report and stop.
```

## MCFX-19: Direct Etsy shadow connector

```text
I authorize MCFX-19 only.

Implement a direct Etsy Open API v3 adapter. Do not infer Etsy activity from
WooCommerce or LitCommerce metadata.

Use Etsy app credentials only when supplied and approved. Implement against
recorded/sanitized official-shape fixtures first.

Before editing provider behavior, verify current official Etsy documentation
for access level, app approval, OAuth endpoints/scopes, token rotation, webhook
signature/replay scheme, receipts, payments, ledger entries, refunds, payouts,
rate-limit headers, and test-shop capabilities. Record direct URLs, access date,
and fixture provenance. If a required endpoint, scope, webhook, financial field,
or approved test environment cannot be confirmed, return GATED.

Implement:

- Etsy API key plus OAuth 2.0 authorization-code flow with S256 PKCE;
- encrypted access/refresh token storage, rotation, revocation, reconnect, and
  least-privilege scopes;
- shop identity and multiple shops per organization;
- signed Etsy webhooks, replay/timestamp checks, deduplication, and scheduled
  reconciliation;
- receipts, receipt transactions, payments, shop payment-account ledger
  entries, refunds/cancellations, fees, shipping, taxes, and payouts;
- Etsy integer amount/divisor/currency semantics without floating point;
- application QPS/QPD headers, bounded retries, backoff, and checkpointed
  pagination;
- privacy-aware handling of buyer data; do not request buyer email access
  unless separately justified and approved; and
- normalized staging into MCFX-17 only.

Official references:

- https://developers.etsy.com/documentation/essentials/authentication/
- https://developers.etsy.com/documentation/essentials/webhooks/
- https://developers.etsy.com/documentation/essentials/rate-limits/
- https://developers.etsy.com/documentation/tutorials/payments/

Do not create journals, invoices, payments, or inventory movements. Reconcile
receipt/payment/ledger totals and surface missing provider data for review.

Acceptance: OAuth, webhook, rate-limit, replay, refund, fee, tax, and payout
fixtures reconcile without guessed fields. Complete the report and stop.
```

## MCFX-20: Marketplace clearing and payout posting

```text
I authorize MCFX-20 only for this selected provider:
[WOOCOMMERCE or ETSY].

Require the selected provider's MCFX-18 or MCFX-19 shadow report to say PASS.
Do not require or enable the other provider.

Convert reconciled commerce staging records through explicit domain workflows.
Do not let adapters post directly.

Require the recorded owner decision plus passing provider-specific
order/refund/fee/tax/payout golden tests and live reconciliation evidence for
the exact revision. Accountant review is recommended but is not a mandatory
ClearLedger gate. If the provider selection, tests, or live evidence are absent
or incomplete, return GATED.

Model and reconcile separately:

- recognized sale/order;
- customer or marketplace payment;
- seller tax versus marketplace-collected/remitted tax;
- shipping, discounts, tips, and adjustments;
- provider/processor fees and tax on fees;
- refunds, cancellations, chargebacks, and reserves;
- provider/currency-specific clearing balance;
- payout batch;
- actual bank deposit and conversion; and
- realized FX between recognition, payment, payout, and bank settlement.

Use distinct clearing accounts by provider and currency where approved.
Aggregated, partial, split, delayed, withheld, and multi-order payouts must link
to their component records. An unexplained difference remains visible in review
and cannot be forced into revenue, fees, tax, or FX.

Require complete mapping and reconciliation before optional draft conversion.
Automatic posting remains disabled until deterministic order-to-payout-to-bank
tests pass. Ensure replay/out-of-order provider events cannot duplicate
customers, invoices, payments, refunds, inventory movements, fees, or journals.

Add golden selected-provider scenarios covering CAD sale/CAD payout, USD
sale/USD payout into a USD bank, USD sale converted to CAD payout, fees, tax
remittance, refunds, reserves, chargebacks, partial payouts, and final clearing
reconciliation.

Acceptance: every selected-provider/currency clearing account reconciles to zero
or an explained outstanding item, and the bank deposit is not counted as new
revenue. For WooCommerce write
docs/status/MCFX_20_WOOCOMMERCE_COMPLETION_REPORT.md; for Etsy write
docs/status/MCFX_20_ETSY_COMPLETION_REPORT.md. Do not overwrite a different
provider's evidence, then stop.
```

## MCFX-21: Compatibility migration, accountant pilot, and production gate

```text
I authorize MCFX-21 only.

Rate mode: [MANUAL or AUTOMATIC].
Connectors: [NONE, WOOCOMMERCE, ETSY, or BOTH].

If either selection is absent, return GATED. Every selection requires PASS
reports for MCFX-00 through MCFX-15. MANUAL uses the approved MCFX-04
manual-rate SOP and does not require MCFX-16. AUTOMATIC also requires MCFX-16.
WOOCOMMERCE or BOTH also requires MCFX-17, MCFX-18, and
MCFX_20_WOOCOMMERCE_COMPLETION_REPORT.md. ETSY or BOTH also requires MCFX-17,
MCFX-19, and MCFX_20_ETSY_COMPLETION_REPORT.md. Do not block core
multi-currency because an unselected provider lacks credentials, approval, or
evidence, and never enable an unselected/unproven connector.

Create an organization-level pilot and scope-specific final release evidence.
Do not globally enable multi-currency. "Reversible" means feature disablement,
compatible application rollback/forward repair, or complete backup restoration.
After any foreign rate, position, or posting exists, never run a schema down
migration that drops its evidence.

Before enablement:

1. backup PostgreSQL and complete a restore test;
2. reconcile trial balance, AR, AP, tax, inventory, fixed assets, every bank/
   card account, processor clearing, and any marketplace clearing included in
   the selected scope;
3. prove the additive migration/backfill preserves existing CAD records and
   posted journals exactly;
4. configure USD, rate policy, FX accounts, and permissions;
5. import open foreign balances only with both the actual outstanding foreign
   amount and accountant-approved base carrying amount; never invent a
   historical rate; and
6. keep the organization feature stage disabled until prerequisites pass.

Pilot stages:

1. read-only dual display;
2. selected-provider shadow ingestion, only for connector scopes;
3. foreign drafts without posting;
4. accountant-approved manual posting;
5. payments and foreign banking;
6. marketplace payout reconciliation, only for connector scopes;
7. period-end revaluation and reversal; and
8. at least one complete parallel close before opt-in production approval.

Run full format, lint, typecheck, Prisma, clean migration, rollback, unit,
PostgreSQL integration, RLS/adversarial, authorization, replay, concurrency,
browser, accessibility, security, performance, backup/restore, and release
verification. Compare pre/post CAD reports byte-for-byte where contracts are
unchanged.

Run and report these exact commands where applicable:

corepack.cmd pnpm format:check
corepack.cmd pnpm lint
corepack.cmd pnpm typecheck
corepack.cmd pnpm db:validate
corepack.cmd pnpm db:generate
corepack.cmd pnpm db:migrate:deploy
corepack.cmd pnpm test
corepack.cmd pnpm test:integration
corepack.cmd pnpm test:e2e
corepack.cmd pnpm test:accessibility
corepack.cmd pnpm test:security
corepack.cmd pnpm test:performance
corepack.cmd pnpm db:backup:verify
corepack.cmd pnpm db:rollback:verify
corepack.cmd pnpm verify:production-config
corepack.cmd pnpm test:release
corepack.cmd pnpm build

Run db:rollback:verify only against the named disposable pre-adoption database.

Produce operator runbooks for rate outage, stale rate, failed connector,
unreconciled payout, revaluation correction, rollback, restore, credential
rotation, and emergency organization-level pause. Connector-specific runbooks
are required only for a selected connector scope.

Produce a go/no-go checklist but do not sign it for the owner or accountant.
Actual opt-in posting requires a user-supplied
docs/approvals/MCFX_<RATE_MODE>_<CONNECTOR_SET>_PRODUCTION_GO_LIVE.md naming
both approvers, roles, date, tested organization, exact release/task revision,
reconciled control totals, and explicit opt-in scope. If it is absent, finish
GATED with all completed technical evidence and leave that scope disabled.
Replace the placeholders with the combined selection, for example MANUAL_NONE,
AUTOMATIC_WOOCOMMERCE, or MANUAL_BOTH; do not create a filename containing
brackets.

Acceptance: zero unexplained control-account differences, zero foreign positions
without provenance, successful restore/rollback evidence, and written
accountant/owner go/no-go approval for the selected scope. The operational
QBWooBridge remains untouched and running independently. Write
docs/status/MCFX_21_<RATE_MODE>_<CONNECTOR_SET>_COMPLETION_REPORT.md, replacing
the placeholders with values such as MANUAL_NONE or AUTOMATIC_WOOCOMMERCE.
Never overwrite another selection's evidence, then stop.
```

## Shortcuts that invalidate a phase

Any phase must fail review if it:

- merely removes a CAD check;
- changes an organization's base currency after posting;
- recalculates posted history using today's rate;
- keeps only the foreign amount or only the base amount;
- uses one mutable “current rate”;
- assumes every currency has two decimal places;
- treats an inverse rate as interchangeable without explicit conversion;
- fetches a provider rate inside a financial posting transaction;
- silently chooses “latest” for a missing historical/weekend rate;
- allocates a payment across currencies without an explicit conversion
  workflow;
- records FX differences as fees, revenue, tax, inventory, or unexplained
  rounding;
- revalues inventory, fixed assets, revenue, expense, or equity held at
  historical cost;
- performs aggregate-only AR/AP revaluation without item-level carrying
  history;
- mutates a posted journal during revaluation;
- permits settlement and revaluation to race;
- connects commerce before original currencies and payouts can reconcile;
- posts a marketplace bank deposit as new revenue;
- uses fake live-provider evidence; or
- touches the operational QBWooBridge.

## Prompt-quality check

Before giving a modified phase prompt to a lesser model, score it from 0 to 2
in each category below. Require at least 18/20. A zero in scope/safety,
accounting invariants, or verification automatically rejects the prompt.

1. One bounded phase and explicit stop gate.
2. Exact prerequisites and GATED behavior.
3. Exact repository and production-system boundary.
4. Approved accounting policy and invariants.
5. Tenant, authorization, and secret controls.
6. Additive migration/backfill/rollback requirements.
7. Positive, negative, rounding, replay, and concurrency tests.
8. Exact commands and observed evidence.
9. Explicit exclusions and no-live-system boundary.
10. Completion report and next-phase handoff.
