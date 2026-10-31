# Point of sale operating guide

## Scope and release boundary

PennyWise Accounting POS is an **online, server-authoritative cash checkout
workflow**. A completed sale is not a browser-only receipt: it uses the central
tax engine, creates and posts an invoice, records payment, moves inventory when
the item is inventory-tracked, and leaves journal and audit evidence.

This is a controlled-beta workflow, not a substitute for a production retail
platform yet. It supports cash and manually recorded tender only. It does not
accept card data, integrate a card terminal, or work offline. The beta supports
up to 100 server-calculated cart lines, up to 10 cash/manual tenders, cash change
calculation, and an in-browser print surface for the posted receipt. Device
printing, external receipt delivery, exchange, suspended-sale, and camera-
scanning workflows remain outside this boundary. Do not use it for unattended
retail or live card acceptance until those release gates have passed.

The authoritative capability boundary is `GET /v1/pos/capabilities`. A client
must not advertise a tender, adapter, or offline workflow that endpoint does
not report.

## Who may do what

| Activity                               | Minimum current role                           | Why                                                             |
| -------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| View POS records                       | Read-only or an operational accounting role    | Read-only access only.                                          |
| Open or close a shift; make a sale     | Sales, Bookkeeper, Accountant, Admin, or Owner | The sale posts through the normal accounting workflow.          |
| Configure registers and devices        | Accountant, Admin, or Owner                    | Registers bind a cash account and inventory location.           |
| Record a custody drop or safe transfer | Bookkeeper, Accountant, Admin, or Owner        | The action needs an auditable cash-control decision.            |
| Return and refund a sale               | Bookkeeper, Accountant, Admin, or Owner        | A return creates a posted credit note and can refund a payment. |

Do not grant a cashier broad accounting or refund permissions merely to make a
sale. The current workflow deliberately makes a manager-level operator own a
return until a dedicated delegated-return approval design exists.

## One-time setup

1. Complete the company profile, fiscal year, chart of accounts, tax setup,
   and opening balances. Keep the cash drawer account as an active asset
   account and do not reuse a clearing or liability account.
2. Create the inventory location that physically supplies the register. Stock
   inventory there before selling inventory items. Services may be sold without
   stock.
3. Review every product: active status, exact SKU/GTIN/MPN, sales price,
   revenue account, tax code, and—in the case of stock—the inventory asset,
   cost-of-goods, and default location. POS deliberately refuses ambiguous
   scanner identifiers rather than guessing an item.
4. In **Point of sale**, create a register with its company, inventory location,
   asset cash account, code, name, and receipt prefix. A register can have only
   one active shift at a time.
5. Enrol a device only after assigning its physical custodian. Device enrolment
   records identity and revocation state; it is not a terminal-key, PIN, or
   payment-terminal integration.
6. Run the acceptance script below with a fictional company first. Reconcile
   its final POS shift, inventory movement, invoice, payment, and journal before
   using the workflow with real cash.

## Daily cash workflow

### Open

1. Count the physical opening float with a second person where practical.
2. Select the register, enter the business date and counted opening float, then
   open the shift. PennyWise creates an immutable opening-float cash event.
3. Confirm the register, inventory location, cash account, and shift status are
   displayed as **Open** before accepting a payment.

### Sell

1. Look up the item by exact SKU, GTIN, or manufacturer part number, or select
   the known product. Resolve duplicate identifiers before retrying; do not
   choose a similarly named item.
2. Add each product or service as a cart line. Check the quantities and authoritative preview. A price, discount, or tax
   override requires the corresponding role and should be independently
   approved under the business's cash policy.
3. Enter one or more tenders. Split tender is limited to cash and manually
   recorded tender; change is issued only against cash. The server calculates
   the final tax and total, posts the invoice and payments, records cash/change,
   and writes the POS sale evidence.
4. Print the posted receipt from the browser when a paper copy is needed. The
   receipt is linked to the posted invoice; no device or external delivery is
   implied.
5. If the page reports a network problem or the result is unclear, **do not
   enter the sale again**. Leave the item, amount, and shift unchanged and retry
   from the same browser tab. PennyWise retains the checkout idempotency intent
   for that payload across a page refresh, so the server returns the original
   sale instead of posting a second one. If that tab is no longer available,
   stop and locate the receipt or sale record before attempting another sale.

### Drawer custody during an open shift

Use only **Drop** and **Safe transfer** for a documented cash-custody movement.
Enter the actual amount and a specific reason; paid-ins and paid-outs are
blocked because they require a linked bank, expense, reimbursement, or other
accounting workflow. The current release does not automatically create the
deposit, safe, or bank-side accounting document. Record that separately and
reconcile it to the POS evidence.

### Return and refund

1. A manager-level operator selects the completed original sale, exact line,
   quantity, disposition (**Restock** or **Write-off**), and a factual reason.
2. For a cash refund while the original shift is still open, the original drawer
   is the normal refund drawer.
3. For a cash refund after the original shift is closed, first open a current
   shift on a register that uses the **same cash account**, then select that
   open shift. PennyWise stores the refund-shift evidence and rejects a refund
   against a closed drawer. Never reopen or alter a closed shift to make a
   return fit.
4. A completed return posts a credit note, refunds eligible original tender,
   writes an auditable cash refund event in the actual refund drawer, and
   records the inventory return where applicable. Retry an unclear return from
   the same browser tab and unchanged form; it has the same idempotency safety
   as a sale.

The release does not support exchange, cash-to-different-tender, partial
tender rerouting, or offline returns. Use a separately approved accounting
workflow for those cases rather than improvising in POS.

### Close and reconcile

1. Stop sales for the register and verify no payment-pending sale remains.
2. Count physical cash, including the opening float, with a second person where
   possible. Enter the counted amount and close the shift.
3. A zero difference closes the shift. A difference moves it to **Pending
   review**. Record the investigation and have an authorized operator approve
   the variance only after the business has made its separate controlled ledger
   resolution. Variance approval currently closes the operational shift; it does
   not itself post a cash-over/short journal.
4. Review the shift reconciliation, POS sales, related invoices/payments,
   inventory movements, and the subsequent bank deposit together. The deposit
   must be matched in Banking; POS does not automatically reconcile it to a
   bank feed.

## Required acceptance test before real-cash use

Run this in the isolated test company and retain the results with the register
setup record.

| Test                                                        | Expected evidence                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Open a shift with a known float                             | One opening-float event and an Open shift.                                                                                                     |
| Sell a taxable service                                      | One completed sale, posted invoice, payment, balanced journal, correct tax, and expected cash.                                                 |
| Sell stocked inventory                                      | The above plus exactly one sale inventory movement at the register location.                                                                   |
| Sell a multi-line basket with split tender                  | One posted invoice containing every line, one payment per tender, cash change only where applicable, and one receipt.                          |
| Retry an unchanged checkout after a simulated response loss | One completed POS sale and one receipt only.                                                                                                   |
| Print a completed receipt                                   | Browser print surface shows the receipt number, every line, total, and tender summary linked to the posted invoice.                            |
| Close with exact cash                                       | Closed status, zero variance, and a reconciliation total that agrees with physical cash.                                                       |
| Refund before close                                         | Posted credit note, payment refund, one negative cash event in the open drawer, and an inventory return where relevant.                        |
| Refund after close                                          | A closed original drawer is rejected without a selected open compatible shift; with one, the refund event belongs only to the new open drawer. |
| Attempt ambiguous scanner lookup                            | A conflict/error; no sale is created.                                                                                                          |
| Attempt a card, offline, exchange, or paid-out workflow     | The client/API refuses it clearly; no misleading accounting entry is created.                                                                  |

## API reference

The POS routes live under `/v1/pos`:

- Registers and devices: `GET/POST /registers`, `GET/POST /devices`.
- Shifts: `POST /shifts/open`, `POST /shifts/:shiftId/close`, variance approval,
  cash events, and reconciliation.
- Checkout: exact product resolve, cart preview, completed sale, sale lookup,
  and return.

Every sale, return, and cash event requires an idempotency key. Retain it for a
retry, never reuse it with changed data, and treat an idempotency mismatch as an
operational investigation—not permission to submit a second transaction.

## Remaining production gates

Before calling POS production-ready, PennyWise still needs device-key lifecycle,
receipt delivery and device printing, cash-over/short ledger posting, append-only
protection for every completed POS operational record, delegated return approval,
a card-terminal adapter, offline-safe design, and full browser/UAT coverage for
the new cart, split-tender, and receipt flows. Those boundaries are exposed by
`GET /v1/pos/capabilities` rather than silently implied by the current cash
workflow.
