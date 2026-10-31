# Acceptance Tests

## Ledger

### Balanced journal

Given valid accounts and an open period, when a journal with equal debits and credits is posted, then the journal is posted and appears in the trial balance.

### Unbalanced journal

Given valid accounts, when debits and credits differ, then the request fails and no journal, lines, audit event, or outbox event is committed.

### Immutability

Given a posted journal, when any user attempts to update or delete a journal line, then the operation fails.

### Reversal

Given a posted journal, when an authorized user reverses it, then a new linked journal is created with inverse lines and the original remains unchanged.

### Period lock

Given a closed period, when a user attempts to post into it, then the request fails unless the period is reopened by an authorized user.

### Idempotency

Given the same organization, operation, request body, and idempotency key, when the request is repeated, then the original result is returned and no duplicate journal is created.

### Tenant isolation

Given users from two organizations, when a user requests another organization's journal id, then the response is not found or forbidden without revealing the resource.

## Invoicing

### Invoice posting

Given a taxable service invoice, when it is approved, then accounts receivable, revenue, and tax payable are posted correctly.

### Invoice correction

Given a posted invoice with an error, when it is corrected, then the original remains, a credit or reversal is created, and the final customer balance and ledger are correct.

### Invoice payer access

Given a valid secure invoice link, when the payer opens it, then the invoice is visible without account creation and no other customer data is exposed.

## Payments

### Duplicate webhook

Given one processor event delivered twice, when both deliveries are processed, then exactly one payment and one journal effect exist.

### Out-of-order webhook

Given settlement and payment events delivered out of order, when processing completes, then final payment and settlement state is correct and traceable.

### Refund

Given an eligible payment, when an authorized refund is issued, then the processor request, refund record, customer balance, and journal entries agree.

## Inventory

### Purchase receipt

Given an inventory purchase, when received, then quantity and weighted-average carrying value increase and the inventory control account agrees.

### Sale

Given sufficient stock, when an inventory invoice is posted, then quantity decreases, revenue posts, and cost of goods sold equals released carrying cost.

### Negative stock

Given insufficient available quantity, when a user attempts a sale, then posting is blocked by default.

### Write-off

Given stock on hand, when an authorized adjustment writes off units, then quantity and inventory asset decrease and an expense is recorded.

## Banking

### Duplicate import

Given the same bank file imported twice, when duplicate detection runs, then duplicate transactions are not created.

### Reconciliation

Given a statement ending balance and complete matching activity, when reconciliation is completed, then the difference is zero and the reconciliation is locked.

## Security

### Role escalation

Given a non-admin user, when the user attempts to assign themselves an administrative role, then the request fails and is audited.

### Full export

Given an authorized owner, when a full export is requested, then the export is generated asynchronously, access is time-limited, and the action is audited.
