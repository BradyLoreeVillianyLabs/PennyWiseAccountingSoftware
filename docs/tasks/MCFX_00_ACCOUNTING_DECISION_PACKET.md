# MCFX-00 Accounting Decision Packet

## Purpose and approval boundary

This packet records the owner-authorized CAD/USD engineering policy. The
project owner explicitly directed implementation on 2026-07-30. That direction
authorizes product work; it is not represented as accountant, tax, legal, or
provider approval. Production accounting use remains conditional on the
professional-judgment decisions listed below.

The operational `qbwoo-bridge` project is explicitly out of scope. No runtime
database, environment file, service, webhook, or source file in that project may
be changed by this program.

## Initial release boundary

- One legal entity per organization; no consolidation or intercompany journals.
- Existing organizations retain CAD as their immutable base/financial-statement
  currency. The first enabled transaction currencies are CAD and USD, with the
  schema extensible to other ISO 4217 codes.
- Reports, tax returns, period close, exports, and retained earnings are stated
  in the organization base currency. Transaction documents preserve their
  original currency and amount.
- Rates are exact rational snapshots, oriented as: **1 transaction-currency
  major unit = N base-currency major units**. A snapshot is immutable and
  records source, observed time, effective time, method, and approval metadata.
- Invoice and bill settlement must use the document currency. CAD-base
  settlement of USD AR/AP uses an explicit settlement-date rate. Spending USD
  held in a USD bank account additionally relieves receipt-date FIFO foreign
  cash lots at carrying value and identifies the separate cash-disposal FX.
- Payroll, loans/financing, crypto, multi-entity consolidation, and autonomous
  tax decisions remain outside this release.

## Currency, rounding, and ledger policy

- Persist money as signed integer minor units (`BIGINT`/`bigint`), never a
  JavaScript floating-point number.
- Persist each currency’s exponent in a versioned registry. Historical exponent
  snapshots are immutable; a future registry correction is additive.
- Convert with integer/rational arithmetic and deterministic half-up rounding.
  Allocation residuals use a documented largest-remainder order and must never
  be posted to a generic “FX rounding” account.
- Every posted line carries base amount, transaction amount/currency (when
  applicable), rate snapshot, and conversion policy snapshot. Reversals copy the
  original metadata and invert both amounts.
- Source creation, journal posting, audit evidence, idempotency, and outbox
  enqueue remain one atomic transaction.

## Monetary-position policy

Foreign AR, AP, foreign bank/card balances, undeposited funds, processor or
marketplace clearing, and refundable customer/vendor deposits are monetary
positions. They are remeasured at the approved valuation rate and produce
unrealized FX gain/loss with a linked valuation event.

Inventory, fixed assets, revenue/expense/tax history, equity, and a
non-refundable customer advance that is a non-monetary contract-liability or
deferred-revenue balance on the seller’s books are non-monetary. They remain at
their transaction-date/carrying basis unless a separately approved accounting
policy changes that treatment.

Unsupported foreign loans are rejected with an actionable setup error rather
than silently remeasured.

For the CAD/USD engineering release, foreign AR, AP, and manually received USD
bank cash are implemented. Card, undeposited-funds, processor, marketplace,
deposit, and loan posting remain fail-closed until their source workflows open
and settle the corresponding position types.

## Revaluation and close

The first release creates an automatic next-period reversal for every posted
revaluation. A backdated source transaction dated on or before the valuation
date marks the valuation run stale and blocks period close until the linked
reversal and a fresh valuation are posted. Revaluation runs and reversals are
idempotent and retain their source/rate snapshots.

## Deposits, progress billing, and bad debt

- A refundable customer credit/deposit is a monetary liability and is revalued.
- A non-refundable advance is a non-monetary contract liability/deferred revenue
  balance and is excluded from revaluation until the approved recognition event.
- A progress invoice is an ordinary monetary receivable; estimate/progress
  snapshots preserve the original transaction rate and do not mutate after
  posting.
- Bad-debt/write-off extinguishes the receivable at its carrying value, reverses
  or reclassifies unrealized FX for that position, applies the approved tax
  policy, preserves original revenue, and requires an elevated permission and
  reason.

## Required evidence before production

1. The organization owner confirms functional currency, rate-source hierarchy,
   tax timing, receipt-date FIFO foreign cash, corrections, deposits, bad debt,
   and close policy. Accountant review is recommended but is not a mandatory
   product gate under the owner test-evidence decision dated 2026-08-02.
2. Passing exact-arithmetic, ledger, tenant-isolation, idempotency,
   concurrency, migration, and report reconciliation tests.
3. Independent core release evidence. WooCommerce and Etsy connector evidence
   is additive and must not gate the provider-independent accounting core.
4. For live rates, banking, or commerce: approved provider contract, official
   documentation, credentials, consent/revocation controls, webhook replay
   tests, and a production runbook.

## Representative journal scenarios

The acceptance suite must cover at least:

1. USD 100 invoice at 1.35 CAD/USD: AR base 13,500; revenue base 13,500.
2. Receipt at 1.37: cash/clearing base 13,700, AR carrying base 13,500,
   realized FX gain 200.
3. USD bill/payment with the analogous realized loss/gain treatment.
4. Foreign bank disposal where the asset’s carrying rate differs from the
   settlement rate.
5. Period-end revaluation with a next-period reversal and stale-run detection.
6. Cross-currency transfer with explicit source and destination monetary
   positions and a balanced realized FX difference.

## Worked CAD-base fixtures

All values below use integer minor units.

| Event                               |                                        Debit |                                   Credit | Position effect                                         |
| ----------------------------------- | -------------------------------------------: | ---------------------------------------: | ------------------------------------------------------- |
| USD 100 invoice at 1.35             |                                AR CAD 135.00 |                       Revenue CAD 135.00 | Open AR USD 100 / CAD 135                               |
| Receipt at 1.37                     |                          USD bank CAD 137.00 | AR CAD 135.00 and realized gain CAD 2.00 | Close AR; open cash USD 100 / CAD 137                   |
| USD 50 bill at 1.36                 |                            Expense CAD 68.00 |                             AP CAD 68.00 | Open AP USD 50 / CAD 68                                 |
| Pay bill at 1.34 using the cash lot | AP CAD 68.00 and cash-disposal loss CAD 1.50 |  USD bank CAD 68.50 and AP gain CAD 1.00 | Close AP; cash becomes USD 50 / CAD 68.50               |
| Revalue remaining USD 50 at 1.36    |                     Unrealized loss CAD 0.50 |                        USD bank CAD 0.50 | Temporary carrying value CAD 68.00; reverse next period |

The bill payment balances at CAD 69.50 on each side and keeps the payable FX
separate from the foreign-cash disposal FX.

## Organization policies requiring an accountable owner decision

- Confirm CAD is the entity's functional currency under the applicable
  framework; selecting CAD in software is not sufficient evidence.
- Approve the authoritative transaction, settlement, average, and closing-rate
  source hierarchy and the treatment of weekends or unavailable dates.
- Approve receipt-date FIFO for foreign cash and the policy for opening foreign
  balances.
- Approve GST/HST and income-tax currency-conversion timing and evidence.
- Approve foreign credit-note, refund, write-off, void, and settlement-reversal
  treatments before those workflows are released.
- Decide the monetary/non-monetary classification of deposits, advances, and
  progress-billing balances.
- Approve card, loan, payroll, marketplace-clearing, cross-currency transfer,
  and consolidation policies before those domains are enabled.

The owner accepts these responsibilities for the released CAD/USD boundary in
`docs/OWNER_ACCOUNTING_EVIDENCE_ACCEPTANCE.md`. Unsupported domains remain
fail-closed until their own evidence passes.
