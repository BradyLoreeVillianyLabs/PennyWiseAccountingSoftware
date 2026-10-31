# ADR 010: Receivables follow-up and statement boundaries

**Status:** Implemented locally, provider and professional acceptance pending  
**Date:** 2026-09-11

## Decision

PennyWise keeps receivables follow-up inside the existing tenant-scoped accounting and
delivery boundaries:

- manual reminders use the existing invoice PDF delivery service, including its truthful
  own-email-app fallback;
- scheduled reminders are opt-in, lease-run through I6, one per invoice per local day,
  constrained by organization quiet hours, and suppressed for archived/do-not-remind
  customers and paid, voided, or fully credited invoices;
- customer follow-up exposes overdue age buckets and a review step before a provider batch
  is queued;
- statements are derived from the AR activity records, expose activity and open-item
  views, and can be downloaded as a PDF or recorded as a manual/provider communication;
- no tracking pixels, portal, SMS, or collection-agency behavior is introduced.

The statement report carries an opening balance for activity statements and uses allocated
payments rather than treating an unapplied customer payment as an AR reduction. Open-item
statements list the remaining invoice balances as of the selected end date. The initial
release remains CAD-base for statement presentation, consistent with the existing report
boundary; document-currency statements remain a later multi-currency increment.

## Late-fee safety boundary

Late-fee settings are stored off by default so the UI can be extended without silently
creating a legal or accounting promise. No late-fee amount is automatically posted. Any
future implementation must:

1. require explicit owner enablement and a finance-charge income account;
2. produce a draft-only invoice or line for review;
3. require a separate user finalization before it can affect the ledger;
4. include the agreed annual equivalent when a rate is expressed per month or another
   shorter period, with an operator-facing note that provincial rules differ; and
5. record the source invoice, calculation inputs, cap/grace-period decision, and approval
   in the audit trail.

PennyWise does not hard-code a legal maximum or provide legal advice. The owner and a
qualified Canadian professional must approve the contractual wording and posting account
before the setting is enabled for a shipped build.

## Evidence

Primary product documentation reviewed on 2026-09-11:

- Intuit documents automatic/manual reminders and balance-forward, open-item, and
  transaction statements.
- Xero describes reminders and statements as a follow-up for unpaid invoices.
- FreshBooks documents automatic reminders and flat/percentage late-fee options.

The implementation adds a disposable integration acceptance for overdue grouping, manual
delivery, suppression, statement balance, and PDF bytes. A real provider mailbox and a
clean-machine acceptance remain external gates.
