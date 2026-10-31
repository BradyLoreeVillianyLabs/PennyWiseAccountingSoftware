# Accounting Posting Rules

Examples below use CAD unless a multi-currency example says otherwise and use
simplified tax amounts. Final Canadian tax treatment must be reviewed by a CPA.

## Global rules

1. Every journal balances.
2. Every journal belongs to one organization.
3. Every journal has one effective date and one fiscal period.
4. Every generated journal links to exactly one source transaction.
5. A source transaction cannot generate the same posting twice.
6. Posted journals are immutable.
7. Reversals reference the original journal.
8. Control accounts are posted only through approved domain workflows.
9. Tax lines are explicit and traceable.
10. Inventory value changes create both quantity and accounting events where applicable.

Tax is calculated only through the centralized tax boundary. The selected
effective-dated tax-code version, treatment, jurisdiction components, rounding
adjustment, recoverability, configured control accounts, and source metadata
are stored as immutable evidence with the source document. Standard tax uses
exact integer minor-unit rounding; inclusive tax derives the net base and
assigns any residue deterministically. Zero-rated and exempt treatments never
create tax amounts, even when their configured component list contains rates.
Missing or inactive tenant-owned tax control accounts fail before posting.

## Account classes

- Asset
- Liability
- Equity
- Revenue
- Expense
- Contra asset
- Contra revenue

## Common control accounts

- Accounts receivable
- Accounts payable
- Undeposited funds
- Inventory asset
- GST/HST payable
- GST/HST recoverable
- Payment processor clearing
- Unrealized FX gain/loss
- Realized FX gain/loss

## Posting matrix

### 1. Service invoice

Customer is invoiced 1,000 plus 50 tax.

- Debit Accounts Receivable: 1,050
- Credit Service Revenue: 1,000
- Credit Tax Payable: 50

### 2. Inventory invoice

Customer is invoiced 1,000 plus 50 tax. Inventory cost is 600.

Sales journal:

- Debit Accounts Receivable: 1,050
- Credit Product Revenue: 1,000
- Credit Tax Payable: 50

Cost journal lines in the same posting transaction:

- Debit Cost of Goods Sold: 600
- Credit Inventory Asset: 600

### 3. Customer payment to undeposited funds

- Debit Undeposited Funds: amount
- Credit Accounts Receivable: amount

Allocate payment to one or more invoices.

### 4. Processor payment

At successful payment authorization or capture, depending on processor semantics:

- Debit Processor Clearing: gross amount
- Credit Accounts Receivable: gross amount

At settlement:

- Debit Bank: net settlement
- Debit Payment Processing Fees: fee
- Credit Processor Clearing: gross amount

### 5. Customer cash payment

- Debit Cash or Bank: amount
- Credit Accounts Receivable: amount

### 6. Partial payment

Use the same payment posting for the amount received. Invoice status becomes `PARTIALLY_PAID` until allocations equal the invoice balance.

### 7. Customer deposit before invoice

- Debit Bank or Processor Clearing: amount
- Credit Customer Deposits Liability: amount

When applied to invoice:

- Debit Customer Deposits Liability: amount
- Credit Accounts Receivable: amount

### 8. Credit note for service invoice

- Debit Sales Returns and Allowances or original Revenue: net
- Debit Tax Payable: tax
- Credit Accounts Receivable: gross

### 9. Credit note for returned inventory

Revenue reversal:

- Debit Sales Returns and Allowances: net
- Debit Tax Payable: tax
- Credit Accounts Receivable: gross

Inventory return at accepted cost policy:

- Debit Inventory Asset: returned cost
- Credit Cost of Goods Sold: returned cost

### 10. Customer refund

If refunding an existing customer credit:

- Debit Accounts Receivable or Customer Credit Liability: amount
- Credit Bank or Processor Clearing: amount

### 11. Bad debt write-off

- Debit Bad Debt Expense: net receivable written off
- Debit or adjust tax account according to approved tax policy
- Credit Accounts Receivable: gross amount

Requires elevated permission and reason.

### 12. Vendor bill for expense

Bill is 1,000 plus 50 recoverable tax.

- Debit Expense: 1,000
- Debit Tax Recoverable: 50
- Credit Accounts Payable: 1,050

Non-recoverable tax is added to the expense or asset basis. Tax is calculated and
rounded in integer minor units from the effective tax-version snapshot. Posted
bills preserve the vendor, account, and tax snapshots and never recalculate them.

### 13. Vendor bill for inventory

- Debit Inventory Asset: inventory net cost
- Debit Tax Recoverable: recoverable tax
- Credit Accounts Payable: gross bill

Through Phase 7, an inventory-designated account is only an account-classification
placeholder. A purchase does not create quantity, layer, or valuation movements.

### 14. Immediate expense payment

- Debit Expense: net
- Debit Tax Recoverable: recoverable tax
- Credit Bank or Cash: gross

### 15. Bill payment

- Debit Accounts Payable: amount
- Credit Bank: amount

Every payment is fully allocated to eligible bills in Phase 7. Immutable
allocations cannot exceed either the payment or the locked bill balance. A
reversal posts an exact inverse journal and restores the bill settlement
projection; it never edits the original payment journal.

### 16. Vendor credit

- Debit Accounts Payable: gross credit
- Credit Expense or Inventory Asset: net
- Credit Tax Recoverable: tax reduction

Credits are limited to the uncredited value of original bill lines. Posting
reduces Accounts Payable immediately; applying the credit links that existing
credit to bills without posting a second journal.

### 17. Inventory purchase paid immediately

- Debit Inventory Asset: net cost
- Debit Tax Recoverable: recoverable tax
- Credit Bank: gross paid

### 18. Inventory write-off

- Debit Inventory Shrinkage or Write-off Expense: current carrying cost
- Credit Inventory Asset: current carrying cost

Quantity movement is negative. Reason is mandatory.

### 19. Inventory transfer

No organization-level journal if both locations use the same inventory control account. Create paired quantity movements with one transfer identifier.

If location-specific control accounts are supported later, create a balanced reclassification journal.

### 20. Owner contribution

- Debit Bank or Asset: amount
- Credit Owner Contribution Equity: amount

### 21. Owner withdrawal

- Debit Owner Draw Equity: amount
- Credit Bank or Asset: amount

### 22. Loan proceeds

- Debit Bank: amount
- Credit Loan Payable: amount

### 23. Loan repayment

- Debit Loan Payable: principal
- Debit Interest Expense: interest
- Credit Bank: total payment

### 24. Bank fee

- Debit Bank Fees Expense: fee
- Credit Bank: fee

### 25. Bank transfer

- Debit Destination Bank: amount
- Credit Source Bank: amount

If timing requires clearing:

First side:

- Debit Transfer Clearing
- Credit Source Bank

Second side:

- Debit Destination Bank
- Credit Transfer Clearing

Phase 8 supports same-currency CAD transfers that post one journal with the
destination debit and source credit. Matching either imported side links to
that journal and never posts it again. A bank-to-credit-card payment uses the
same transfer rule: debit the credit-card liability and credit the bank asset.

### 25.1 Imported bank categorization

Imported activity starts unmatched. Categorization is the only Phase 8 import
operation that creates a journal:

- inflow: debit the linked bank ledger account and credit the selected
  category lines;
- outflow: debit the selected category lines and credit the linked bank ledger
  account;
- purchase tax: debit recoverable tax and include non-recoverable tax in the
  selected expense or asset, using the persisted tax-version snapshot.

All category-line totals must exactly equal the imported transaction. Amounts
are integer minor units. The categorization and posted journal are immutable;
correction uses journal reversal and a separately audited workflow.

### 25.2 Imported bank matching

Matching creates no journal. It links one imported transaction to one or more
existing posted journals whose linked bank-account line has the expected side
and sufficient amount. Active split amounts must exactly equal the imported
amount. A posted journal can be actively matched only once for a given bank
account. Reversal deactivates links append-only and returns the import to
unmatched status.

### 25.3 Reconciliation

Bank statement reconciliation uses the bank statement sign convention. A
reconciliation completes only at zero difference and cannot clear an unmatched
transaction. Completion stores an immutable, revisioned report snapshot.
Completed items, imported source data, and active matches are database-locked.
Owner, administrator, or accountant authorization plus reauthentication and a
reason are required to reopen; prior snapshots remain unchanged and reports
identify later-dated ledger adjustments.

### 26. Payment chargeback

On chargeback initiation:

- Debit Chargeback Receivable or Accounts Receivable: disputed amount
- Credit Processor Clearing or Bank: disputed amount

Processor fee:

- Debit Chargeback Fee Expense
- Credit Processor Clearing or Bank

Final resolution posts either recovery or bad-debt treatment.

### 27. Opening balances

Opening balances must post through a dedicated opening-balance journal with a balancing opening equity account. Opening subledger balances must reconcile to control accounts.

### 28. Manual journal

Allowed only for accountant/bookkeeper roles according to permissions. Direct posting to control accounts should be blocked unless a special override is explicitly enabled and audited.

### 29. Reversal

A reversal creates new lines with debit and credit swapped, references the original journal, and never modifies the original.

### 29.1 Perpetual inventory

Inventory uses weighted-average carrying value per product and location. Quantity
is stored in millionths and money in integer minor units; final depletion takes
the exact remaining carrying value so rounding residue cannot survive at zero
quantity.

- Goods receipt: debit Inventory Asset, credit Purchase Clearing at net
  acquisition cost plus non-recoverable purchase tax.
- Sale depletion: debit Cost of Goods Sold, credit Inventory Asset at weighted
  average carrying value.
- Customer restock: debit Inventory Asset, credit Cost of Goods Sold at the
  original sale cost allocated to the returned quantity.
- Customer-return write-off: post the restock, then debit Inventory Loss and
  credit Inventory Asset for the same returned cost.
- Vendor return: debit Purchase Clearing, credit Inventory Asset at current
  weighted-average carrying value.
- Increase adjustment: debit Inventory Asset, credit Adjustment Gain.
- Decrease, damage, theft, or spoilage: debit Inventory Loss, credit Inventory
  Asset.
- Location transfer: append equal and opposite quantity/value movements with no
  journal.

Purchase bills for inventory products debit Purchase Clearing rather than
Inventory Asset. Physical receipt performs capitalization, preventing billed
but unreceived goods from entering on-hand quantity. Every financial movement
has its own balanced two-line posted journal. Movement history is append-only;
correction uses an exact linked reversal.

### 30. Tax adjustment

Tax adjustments require a dedicated source type, period, reason, and accountant permission. They must not silently alter prior source documents.

## Phase 10 reporting conventions

- Posted journal lines are the source of truth for accrual financial
  statements. Draft sources never enter financial reports.
- Asset and expense balances use debit less credit. Liability, equity, and
  revenue balances use credit less debit. Contra accounts retain their declared
  account type and their signed balance is not silently made positive.
- Balance-sheet current earnings equal posted revenue less posted expenses
  through the as-of date. Assets must equal liabilities plus equity including
  current earnings.
- Cash-basis profit and loss is limited to settled invoice allocations,
  bill-payment allocations, and immediate cash expenses; the response labels
  that support boundary.
- AR, AP, tax, inventory, and clearing reports expose their source-derived
  balance, posted control-account balance, and difference. Differences remain
  visible and are never auto-adjusted.
- Aging buckets are calculated from immutable due dates against the requested
  organization-local as-of date.
- Tax detail uses the effective-dated tax snapshot persisted on each posted
  source line. Later tax-code edits do not rewrite history.
- All arithmetic remains `BigInt` integer minor units. CSV and browser
  formatting occur only after calculations are complete.

## Phase 11 accountant and close controls

- Manual journals begin as balanced, tenant-scoped drafts with an effective
  date, memo, reason, version, and exactly one debit or credit side per line.
  An authorized user may replace the complete balanced draft in place while
  its status is `DRAFT`; a version check and tenant row lock prevent stale or
  cross-tenant edits. Editing creates no journal or journal line. Cancellation
  retains the workpaper and its audit evidence but likewise creates no ledger
  record. Posting is the sole authority transition: it locks the draft,
  verifies the version and fiscal period, uses the shared journal poster, and
  makes the workpaper, journal, and lines immutable.
- Control-account posting is denied unless an authorized accountant explicitly
  records the override. It remains subject to balance, period, tenant,
  idempotency, and audit controls.
- Corrections never edit posted history. The guided action is a linked reversal,
  credit note, vendor credit, payment reversal, inventory correction, or
  permissioned tax adjustment, depending on the immutable source type.
- Close evidence records workflow warnings plus AR, AP, tax, and inventory
  control differences, bank reconciliation state, suspense or clearing
  balances, payment/webhook state, and incomplete imports. Warning
  acknowledgement is explicit and does not erase the warning evidence.
- Close and reopen records are append-only revisions. Reopening requires a
  reason, stronger permission, recent authentication, and an audit event; it
  never rewrites the prior close snapshot.
- Year-end retained earnings uses explicit, reviewed closing journals. Phase 11
  does not synthesize or auto-post a retained-earnings entry. The next fiscal
  year is created idempotently only after the final period is closed.

## Phase 12 migration controls

- Imported opening balances use the existing opening-balance poster, must be
  exactly balanced, and must use the configured accounting start date.
- Outstanding invoices and bills use the invoice and purchase domain posters.
  Their reconciliation compares source subledgers with posted AR and AP
  control-account balances.
- Inventory openings use the perpetual inventory adjustment workflow. Exact
  quantity and value projections must reconcile with the posted inventory
  control account.
- Financial import idempotency keys derive from immutable batch or row IDs.
  Imported posting cannot create a second effect when a request is retried.
- A source file may not silently become a journal. Unsupported opening credits
  without source/allocation detail are explicit non-posting history.
- Posted imported records remain subject to normal immutability, period locks,
  tenant checks, reversals, audit, and outbox controls.

## Multi-currency rules

The original transaction amount and the base-currency snapshot are both
retained. Rates are immutable rational snapshots; the orientation is one
transaction-currency major unit to base-currency major units. Every line must
balance in base minor units, while foreign amounts remain available for audit.

### 26. Foreign-currency invoice and settlement

For a USD 100 invoice at 1.35 CAD/USD:

- Debit Accounts Receivable: CAD 13,500 (USD 100 original amount)
- Credit Revenue: CAD 13,500 (USD 100 original amount)

If settled at 1.37:

- Debit Bank or Processor Clearing: CAD 13,700 (USD 100 settlement amount)
- Credit Accounts Receivable: CAD 13,500 (the receivable carrying amount)
- Credit Realized FX Gain: CAD 200

The analogous vendor bill/payment records a realized FX loss when settlement
requires more base currency than the payable carrying amount. A foreign bank
disposal uses the asset’s carrying amount and settlement amount, never a fresh
conversion of the historical entry.

### 27. Period-end revaluation

Registered monetary positions are remeasured at the approved valuation rate.
The difference between the new base carrying amount and prior carrying amount
posts to Unrealized FX Gain/Loss with a linked immutable rate snapshot. The
first-release policy automatically posts an exact inverse in the next period.
Backdated activity makes the valuation run stale and blocks close until a new
run and linked reversal are posted.

Inventory, fixed assets, revenue/expense/tax history, equity, and non-refundable
customer advances that are non-monetary contract liabilities/deferred revenue
are not revalued. Unsupported foreign loans are rejected until a separately
approved policy exists.

### 28. Cross-currency allocations and residuals

Cross-currency allocations require an explicit locked rate and produce a
realized FX difference. Splits use deterministic largest-remainder allocation;
no generic FX rounding account is used. External settlement variances require
provenance, configured materiality, and review evidence.

### 29. Bad debt and deposits

Bad-debt write-off extinguishes the receivable at carrying value, reverses or
reclassifies linked unrealized FX, applies the approved tax policy, and keeps
original revenue intact. Refundable deposits/customer credits are monetary and
revalued; non-refundable advances are non-monetary contract liabilities until
recognition. Progress invoices are ordinary monetary receivables with immutable
estimate/progress and rate snapshots.

## Required automated tests

For every rule:

- journal balances;
- source cannot post twice;
- reversal restores net ledger effect;
- tenant isolation holds;
- period lock is enforced;
- unauthorized roles are rejected;
- report balances change as expected;
- audit event is created;
- failure rolls back source, journal, and outbox together.
