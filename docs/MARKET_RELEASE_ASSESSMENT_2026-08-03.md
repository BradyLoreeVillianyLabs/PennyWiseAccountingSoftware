# ClearLedger public-beta market release assessment - 2026-08-03

## Release decision

Keep the launch narrow: **ClearLedger Commerce Canada public beta** for Canadian
owner-operated product businesses and their bookkeepers that sell through WooCommerce,
Etsy, or both; keep books in CAD; receive some USD; and need light inventory. USD sales
do not make this a U.S. edition. U.S. sales-tax localization and payroll are separate
release programs.

The beta promise is:

> Review WooCommerce and Etsy evidence, manage CAD/USD books and inventory, issue
> polished invoices, and prove every import and accounting change in one local-first
> system - without a required per-order connector subscription.

This updates the release messaging in [the 2026-08-01 position](MARKET_POSITION_2026-08-01.md)
and applies the priorities in the owner-supplied
[North American demand report](<research/Accounting Software Feature Demand and Monetization in the United States and Canada.pdf>).
The release evidence and known limitations remain authoritative when marketing copy and
engineering status differ.

## Best initial customers

- Canadian WooCommerce/Etsy sellers with CAD functional currency, regular USD activity,
  light inventory, one to five finance/operations users, and an involved bookkeeper;
- approximately 50-5,000 monthly orders as a discovery range, not a certified capacity
  claim; and
- businesses willing to retain their old system and run one or two parallel closes.

Do not lead with freelancers, U.S.-domestic businesses, construction, manufacturing,
multi-entity groups, or employers seeking full-service payroll. FreshBooks and Wave are
simpler for many freelancers; Sage and Zoho are broader Canadian suites; QuickBooks and
Xero have much larger ecosystems.

## Workflow comparison

| Product           | Established workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ClearLedger position on 2026-08-03                                                                                                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QuickBooks Online | Setup/import, connect bank and sales channels, review integration transactions, then reconcile. Canadian plans span invoices, bills, multicurrency, time, inventory, projects, reports, and accountant access. Its rebuilt [Etsy and WooCommerce connectors](https://quickbooks.intuit.com/learn-support/en-ca/help-article/sales-channels/migrate-new-quickbooks-online-e-commerce/L1yLsHvLk_CA_en_CA) import detailed orders, products, customers, and tax mappings, but Intuit says payout-level reconciliation and two-way inventory sync are not yet available for those channels. | ClearLedger can be more transparent about source evidence, mapping, conflicts, inventory policy, and exact CAD/USD amounts. It is behind on live proof, bank feeds, support, mobile, and breadth. It must not imply that review-only connector data already completes the books.                                                          |
| Xero              | Dashboard and advisor-led setup, invoices/bills, daily bank reconciliation, reports, projects, inventory and an app ecosystem. Xero lists these in its [Canadian feature catalogue](https://www.xero.com/ca/accounting-software/all-features/) and supports many separate [CSV/statement imports](https://central.xero.com/0/article/Import-data-in-to-Xero).                                                                                                                                                                                                                           | ClearLedger's strongest contrast is local-first control, staged imports, immutable evidence, and one seller-specific review surface. Xero remains substantially ahead in bank connectivity, mobile delivery, app coverage, managed operations, and its [accountant practice ecosystem](https://www.xero.com/ca/accountants-bookkeepers/). |
| Wave              | Owner-first bookkeeping: import or connect transactions, categorize, mark reviewed, invoice, and read simple reports. Wave emphasizes approachable double-entry accounting in its [accounting workflow](https://www.waveapps.com/accounting).                                                                                                                                                                                                                                                                                                                                           | ClearLedger is deeper in inventory, controlled close, accountant review, projects and CAD/USD posting. Wave is easier to start, cloud-managed, and already integrates payments/payroll. ClearLedger should not compete on "free"; it should prove control and commerce time saved.                                                        |
| FreshBooks        | Client/project/time/expense to polished invoice and payment, with bank reconciliation and accounting reports. Its [Canadian plan matrix](https://www.freshbooks.com/en-ca/pricing) makes the service-business focus clear.                                                                                                                                                                                                                                                                                                                                                              | ClearLedger now has premium invoice rendering plus project/time foundations, but FreshBooks is still the usability benchmark for service billing, mobile capture, payment collection, and supported onboarding. Commerce inventory is the better ClearLedger wedge.                                                                       |
| Sage Accounting   | Canadian setup, invoices/purchases, bank feeds and rules, GST/HST, reporting, receipt capture, then inventory and multicurrency in the broader plan. Sage offers [guided migration and two years of transaction conversion](https://www.sage.com/en-ca/sage-business-cloud/accounting/).                                                                                                                                                                                                                                                                                                | ClearLedger offers more explicit posted-versus-working boundaries and a focused Woo/Etsy review model. Sage is ahead in Canadian localization, English/French support, bank/OCR operations, human support, and production maturity.                                                                                                       |
| Zoho Books        | Broad native suite: invoicing, bills, bank reconciliation, tax returns, projects, inventory, multicurrency, roles, workflows, fixed assets, dashboards and higher-tier online-sales channels, as shown in its [Canadian feature matrix](https://www.zoho.com/ca/books/pricing/).                                                                                                                                                                                                                                                                                                        | Zoho is the hardest value/breadth benchmark. ClearLedger can differentiate through an uncluttered commerce-close workflow, traceable accounting and capacity-based future packaging, but it does not yet match Zoho's localization, automation, mobile apps, analytics or support.                                                        |
| A2X               | Specialist workflow: connect a sales channel and ledger, map accounts/tax, review a payout entry, post, then match the bank deposit. The official [setup checklist](https://support.a2xaccounting.com/en/articles/6163889-getting-started-with-a2x-checklist) makes payout reconciliation the completion event. A2X supports Etsy but says it [does not support WooCommerce](https://support.a2xaccounting.com/en/articles/1137020-does-a2x-handle-sales-and-fees-from-other-channels-such-as-magento-or-woocommerce).                                                                  | Supporting both WooCommerce and Etsy in one ledger could be distinctive. ClearLedger cannot claim to replace A2X until real-store tests prove sales, tax, fees, refunds, reserves, timing differences, payouts and bank deposits end to end.                                                                                              |

## What the candidate can prove - and what it cannot

Engineering evidence currently supports a double-entry ledger; AR/AP; file-based bank
reconciliation; posted-only formal reports; weighted-average inventory; estimates,
invoices and PDFs; projects/time; budgets and forecasts; audit/period controls;
source-labelled CSV/XLSX staging and portable export; a bounded CAD-base/CAD-USD posting
model; and fixture-tested Woo/Etsy catalog, SKU, image, inventory-policy and review
flows. The dashboard, help, demo-company and appearance work reduce first-use friction.

The material gaps are accepted Woo/Etsy order-to-payout accounting, named live-provider
evidence, live bank feeds, production OCR/email/payments, statutory payroll, French and
Quebec depth, a U.S. tax edition, native mobile distribution, managed hosting/support,
and an accountant portfolio workspace. The precise boundary is maintained in
[release evidence](../distribution/public-beta/RELEASE_EVIDENCE.md) and
[known limitations](../distribution/public-beta/KNOWN_LIMITATIONS.md).

## Switching strategy

Migration must be a product, not an upload button. Competitor documentation shows why:
QuickBooks accepts a fixed set of imports in a required sequence and warns that some
imports cannot be bulk-undone ([Intuit](https://quickbooks.intuit.com/learn-support/en-ca/help-article/import-export-files/common-questions-importing-data-quickbooks-online/L4OYJRFdj_CA_en_CA));
Xero imports record families separately and a chart import can archive omitted accounts
([Xero](https://central.xero.com/s/article/Import-a-chart-of-accounts)); Wave's own move
guide requires recreating open invoices and bills ([Wave](https://support.waveapps.com/hc/en-us/articles/360029600711-Move-Your-Data-Between-Wave-Accounts)); FreshBooks routes broader conversion through a
service partner ([FreshBooks](https://support.freshbooks.com/hc/en-us/articles/115007020007-How-do-I-import-data-into-my-account)); and both
[Sage](https://www.sage.com/en-ca/sage-business-cloud/accounting/) and
[Zoho](https://www.zoho.com/ca/books/migration.html) sell assisted migration as part of
the offer.

Use this beta cutover:

1. Create a Canadian commerce preset or explore the fictional demo.
2. Follow source-specific export instructions; upload copies only. Never write to the
   former system.
3. Map in the GUI, dry-run, resolve duplicates, and retain immutable source provenance.
4. Reconcile trial balance, AR, AP, inventory, tax and FX controls to the source.
5. Connect stores in shadow mode and compare a complete closed period.
6. Agree a cutover date with the bookkeeper; keep the prior system read-only and retain
   the migration evidence and source documents.

Next, add downloadable vendor checklists/sample exports, saved mapping templates,
source-to-target variance certificates, attachment migration, and a bookkeeper-led
migration clinic. Direct API migrations can follow; do not advertise "one-click
conversion" while the supported path is export files.

## Free-beta package, value proof and reach

Offer one clearly labelled free beta package, not pricing tiers: localhost-only Windows
11/Docker distribution, browser UI and installable PWA shell, backup/restore/export
instructions, known limitations, licence, SBOM and SHA-256. Publish it at
`typewritingmonkeys.com`; use LocalXpose only for named trusted tests. A managed web
edition comes after production identity, monitoring, backups, privacy/support operations
and an independent security review. Native app stores come later.

Recruit 5-10 design partners through ecommerce bookkeepers/accountants, WooCommerce
agencies and Canadian Etsy seller communities. Then use high-intent content (QuickBooks
or Wave export checklists, WooCommerce accounting in Canada, Etsy CAD/USD close,
GST/HST evidence and month-end templates), accountant webinars, successful-customer
referrals and permissioned case studies. Delay broad paid search and review-site pushes
until activation and two-close retention are measured.

Prove value with a before/after shadow close: time to first reconciled period; mapping
acceptance rate; manual corrections; duplicate/missing events found; inventory, tax, FX
and payout variances; hours saved; support time; successful backup/restore/export; and a
bookkeeper-confirmed close. Engineering test counts and hashes prove artifact identity,
not accounting certification or customer value.

## Claims boundary

Do not claim: a general QuickBooks/Xero replacement; A2X replacement; production-ready,
audited, certified, compliant, secure-by-certification, or WCAG-conformant status; Etsy
approval or Commercial Access; automatic payout accounting; live banking, OCR,
payments, email, payroll, remittance or filing; U.S. or Quebec tax completeness; support
for currencies beyond the documented CAD/USD boundary; unlimited scale; managed cloud
backups; or protection from determined code inspection.

## Highest-leverage post-beta order

1. Finish the exact archive/restart/restore/update/uninstall/browser/accessibility and
   dependency-audit release gates.
2. Complete named Woo/Etsy live acceptance, then implement and accept order-to-payout
   clearing, refunds, fees, reserves and bank matching.
3. Productize source-specific migration reconciliation and assisted cutover.
4. Launch managed Canadian hosting with production OIDC, monitoring, backups, incident
   response, privacy terms and deadline-aware support.
5. Add the accountant portfolio/review workspace; make bookkeepers the primary channel.
6. Validate bank-feed, OCR, payment and email providers while retaining no-fee manual
   paths.
7. Complete French/Quebec localization before a Quebec claim, then build a separately
   evidenced U.S. edition. Keep payroll and tax filing on their own statutory gates.
