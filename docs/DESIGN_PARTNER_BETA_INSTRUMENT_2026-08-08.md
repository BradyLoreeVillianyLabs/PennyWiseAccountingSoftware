# ClearLedger paid-beta design-partner instrument

This is the first commercial execution artifact for the controlled beta. It is designed
for a founder, bookkeeper, or implementation specialist to use with one organization at a
time. It does not grant production access, enable live provider posting, or collect secrets.

## Ideal first partners

Choose one of these profiles:

1. A Canadian bookkeeper/accountant managing 10–50 small-business clients.
2. A Canadian WooCommerce or Etsy seller who needs CAD/USD visibility and monthly review.
3. An Alberta or British Columbia service business moving from QuickBooks Desktop/Online or
   spreadsheets and needing invoices, bills, bank reconciliation, and a clean close.

Avoid regulated payroll, high-volume settlement, or multi-entity consolidation pilots until
the relevant provider and production controls are separately accepted.

## Consent and safety script

Before access, say:

> ClearLedger is a controlled beta. It supports review-first imports and accounting
> workflows, but some live providers and production sign-in controls are not enabled. We
> will never ask for a password, API secret, bank credential, payroll credential, or private
> key in chat or a spreadsheet. You control what sample or redacted data is uploaded. Any
> accounting entry remains subject to the normal review and posting controls. You may stop
> the pilot and request export or deletion of pilot data.

Record explicit consent for: pilot participation, storing workflow telemetry, using aggregate
outcomes, and publishing a case study. Each is optional and must be independently revocable.

### Consent record and feedback boundary

Use one tenant-scoped onboarding record per partner. It may contain only the following
non-financial fields:

| Field                  | Allowed value                                                              | Do not collect                              |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| Partner type           | `BOOKKEEPING_FIRM`, `SERVICE_BUSINESS`, or `COMMERCE_SELLER`               | Customer lists or employee data             |
| Migration source       | Source-system label and date range                                         | Uploaded source contents in notes           |
| Workflow selected      | Migration, invoicing, payables, reconciliation, inventory, or books health | Transaction values or account balances      |
| Review exception count | Integer count or range                                                     | Exception payloads or free-form source rows |
| Close time             | Hours/days or range                                                        | Financial-statement detail                  |
| Commercial signal      | `NOT_ASKED`, `INTERESTED`, `DECLINED`, or a price range                    | Card, bank, or payment credentials          |
| Consent choices        | Independent boolean choices with timestamp and actor                       | Bundled or implied consent                  |

Product-event consent is an organization-level choice that only an owner or administrator
can change. If it is withdrawn, stop future product-event collection, delete that
organization's stored product-event telemetry, and record the withdrawal in the existing
tenant audit trail. Honor any export/deletion request through the organization portability
and closure workflow; do not delete immutable financial history or audit evidence outside
that approved workflow.

Route information deliberately:

- Use the in-product help or private WordPress bug/security intake for defects and security
  issues. Do not paste credentials, bank data, source exports, or accounting documents.
- Use moderated public feedback only for non-sensitive product ideas. It is not a support or
  security channel.
- Keep onboarding notes in the selected organization's private implementation record and
  make every staff access tenant-scoped and auditable.

## 45-minute discovery interview

1. What system is used today, and what is the most expensive monthly workaround?
2. Which source must be migrated first (QuickBooks Online/Desktop, CSV, WooCommerce, Etsy,
   bank statement, or another source)?
3. How many customers, vendors, transactions, invoices, bills, and currencies are typical?
4. Which records must be reviewed by a human before posting?
5. Where does the current close or reconciliation process stall?
6. What result would justify paying C$199–C$399 for setup and C$49–C$99 per organization per
   month during beta?
7. Who approves accounting software, and what security or export evidence do they require?
8. What would make the partner refer another business after 30 days?

Do not request raw customer lists or financial amounts in the interview. Ask for ranges and
workflow descriptions; use a tenant-scoped demo company for the first walkthrough.

## Assisted onboarding checklist

- [ ] Confirm organization owner and permitted beta users.
- [ ] Select the first workflow: migration, invoices, bills, bank reconciliation, inventory,
      or books-health review.
- [ ] Create/select the demo company or a redacted pilot organization.
- [ ] Record source system and reporting period; do not mix source labels.
- [ ] Upload a redacted sample or use the demo dataset.
- [ ] Review aliases, tax fields, SKU/product matches, skipped rows, and exceptions.
- [ ] Run preview and dry run; record the unresolved count.
- [ ] Commit only reviewed records through existing accounting services.
- [ ] Reconcile the resulting batch and export the evidence.
- [ ] Schedule a 30-day review and capture the partner's stop/continue decision.

## Proof-of-value scorecard

Capture values as counts, durations, or ranges—not names, document contents, or raw money.

| Metric                                    | Baseline | Pilot result | Evidence                                |
| ----------------------------------------- | -------- | ------------ | --------------------------------------- |
| Time from source upload to reviewed batch |          |              | migration batch/reconciliation evidence |
| Rows requiring manual review              |          |              | preview and exception summary           |
| Reconciliation variance                   |          |              | reconciliation result                   |
| Days to monthly close                     |          |              | partner estimate and close record       |
| Hours spent on workaround/import          |          |              | partner estimate                        |
| Invoice delivery or collection delay      |          |              | partner estimate or report              |
| Willingness to pay/referral               |          |              | consented interview response            |

The primary beta success condition is not “all rows auto-posted.” It is a smaller, safer
review queue with a traceable zero or explained reconciliation variance.

### Success metric schema

Calculate the five commercial proof points from the scorecard without storing financial
amounts or identity data in product analytics:

| Metric                       | Formula                                                           | Evidence source                       | Success direction               |
| ---------------------------- | ----------------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| Time to first reviewed batch | Reviewed-batch timestamp minus onboarding start                   | Migration activity and partner record | Decrease                        |
| Review burden                | Rows needing review divided by source rows                        | Import preview summary                | Decrease without silent posting |
| Reconciliation confidence    | Count of zero or explained variances divided by completed batches | Reconciliation evidence               | Increase                        |
| Close speed                  | Partner-reported days to close before minus after pilot           | Consent-backed interview record       | Decrease                        |
| Commercial proof             | Paid/continue/referral decision after 30 days                     | Consent-backed follow-up              | Increase                        |

Use ranges or counts in a founder dashboard. Do not aggregate a metric across fewer than
five organizations, and do not use it to make an automated eligibility, pricing, or
accounting decision.

## Commercial follow-up

Offer the first 5–10 partners a fixed setup price (C$199–C$399), then a grandfathered
organization subscription (C$49–C$99/month) that includes assisted review. Write the exact
scope, beta limitations, export path, support response expectation, and cancellation terms
before accepting payment. Do not call this a tax, payroll, bank, or provider guarantee.

## 30-day partner review

- [ ] Compare the five proof points with the pre-pilot baseline.
- [ ] Confirm the migration batch has either zero variance or an explained, exported variance.
- [ ] Confirm the partner can export their data and evidence without founder assistance.
- [ ] Reconfirm product-event and case-study consent separately.
- [ ] Record one decision: continue paid beta, extend evaluation, pause, or exit/export.
- [ ] Route defects through private bug intake and product ideas through moderated feedback.
