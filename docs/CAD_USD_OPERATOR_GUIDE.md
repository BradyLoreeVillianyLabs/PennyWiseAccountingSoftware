# CAD/USD operator guide

ClearLedger can keep its ledger and financial statements in the organization's
base currency while preserving CAD or USD on customer and vendor documents.
The current release supports the CAD/USD pair with documented manual rates.

## One-time setup

1. Confirm the organization's base currency and fiscal calendar in Business
   settings. Do not change the base currency to imitate a transaction currency.
2. In **CAD and USD accounting**, select **Enable CAD and USD accounting** and
   save.
3. Add the required dated manual rate snapshots. The orientation is always:
   **1 foreign major unit = N base-currency major units**.
4. For a CAD-base company entering a USD rate, you may choose **Suggest Bank of
   Canada rate** after selecting the effective date. ClearLedger prefills the
   latest published `FXUSDCAD` observation on or before that date. Check the
   observation date and exact decimal; the suggestion is indicative and has
   not been saved.
5. Record a source or approval note for every rate. A useful note identifies
   the source, series, retrieval date, and reviewer.
6. Create separate CAD and USD financial accounts when money is actually held
   in both currencies. Link each bank record to its appropriate ledger account.

Rate purposes are not interchangeable:

- **Invoice or bill**: the document's transaction date.
- **Customer or bill payment**: the actual settlement date.
- **Period-end revaluation**: the exact valuation date.
- **Reporting reference only**: not accepted for posting or settlement.

## Sales and receipts

1. Give a customer a CAD or USD default.
2. Create the invoice, choose its currency and issue date, and select the rate
   offered for that exact date. CAD-base invoices do not need an FX rate.
3. Review the exact customer preview. The invoice shows its currency code and
   all customer-facing amounts in that currency.
4. Post the invoice. A foreign invoice opens an AR monetary position at its
   base carrying value.
5. Record the payment in the invoice currency. A USD payment requires a rate
   for the payment date, recognizes realized AR FX, closes or reduces the AR
   position, and opens a USD cash lot in the receiving account.

Foreign payments must be fully allocated in this release.

## Purchases and USD bank spending

1. Give a vendor a CAD or USD default.
2. Create and post a bill using its transaction-date rate.
3. Record payment in the bill currency using a settlement-date rate.
4. If the paying account is base-currency cash, the base cash amount is the
   settlement-date value.
5. If the paying account is a linked USD bank account, ClearLedger consumes
   tracked USD receipt lots in receipt-date FIFO order. It posts the payable FX
   and the foreign-cash disposal FX separately.

An imported USD statement can be matched to a previously posted foreign
receipt or bill payment using transaction-currency evidence. Direct
categorization of a foreign statement item and transfers between foreign bank
accounts remain blocked because they need their own position-opening or
position-transfer workflow.

## Period-end revaluation

1. Create the next open fiscal period; the automatic reversal needs it.
2. Add a closing-rate snapshot for the exact valuation date.
3. In **Accountant review**, choose the valuation date and matching closing
   rate, then preview.
4. Resolve any missing FX gain/loss accounts or rates.
5. Post only after reviewing every position. ClearLedger writes the valuation
   journal, immutable position events, and first-day next-period reversal
   atomically.

## Corrections and current fail-closed boundaries

Do not work around a blocked foreign correction with an unrelated manual
journal. Foreign invoice voids, credit notes/refunds, customer-payment
reversals, bill-payment reversals, direct foreign bank categorization, and
foreign-bank transfers remain disabled until their linked monetary-position
correction models are released.

Manual CAD/USD accounting does not require a third-party adapter. The settings
screen includes a no-key Bank of Canada suggestion helper for direct USD/CAD,
but it is not an automatic provider-rate mode: it only prefills a review form,
never persists or posts, and still requires an explicit manual snapshot. Other
live exchange rates, bank feeds, WooCommerce, and Etsy require separate provider credentials,
contracts or terms, consent/security controls, and adapter acceptance tests.
The product owner approves scope, credentials, and the organization accounting
policy; the provider controls access to its service; and security/legal
reviewers approve the integration boundary. Professional-accountant review is
recommended and is active advisory input for this build according to the
owner, but an accountant signature is no longer a mandatory ClearLedger
release gate when the accounting acceptance evidence passes.

The Bank of Canada publishes the no-key Valet API and its terms here:

- <https://www.bankofcanada.ca/valet-api-how-to/>
- <https://www.bankofcanada.ca/terms/>

IAS 21's official standard page describes transaction-date recognition,
closing-rate remeasurement of monetary items, and exchange differences:
<https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/>.
