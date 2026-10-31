# ClearLedger market position — 2026-08-01

## Decision

Do not launch ClearLedger as a generic QuickBooks or Xero replacement yet. Launch the
controlled beta as **ClearLedger Commerce Canada** for Canadian WooCommerce and Etsy
sellers that keep their books in CAD, sell in USD, carry inventory, and currently need
separate accounting and ecommerce-reconciliation subscriptions.

The product promise should be:

> Native WooCommerce and Etsy review, CAD/USD accounting, inventory, invoicing, and
> source-labelled switching controls in one system—with no required per-order connector
> plugin.

The current connector release deliberately stops at evidence ingestion and review. A
marketable paid release must complete the accepted order-to-payout accounting workflow
before claiming that it replaces A2X, Synder, or a bookkeeper's marketplace clearing
work.

Implementation note, 2026-08-02: the trusted preview now resumes page-limited
synchronization across one fixed provider window without advancing completion time until
every requested scope finishes. It applies saved mappings to polling and webhooks,
removes unneeded private/secret provider fields, and rejects conflicting source labels on
identical import content. These are meaningful completeness, privacy, and migration-safety
improvements; they do not replace live-provider validation or implement order-to-payout
posting.

## Research alignment

The owner-supplied 27-page
[North American feature-demand and monetization report](<research/Accounting Software Feature Demand and Monetization in the United States and Canada.pdf>)
is retained unchanged with review notes in [the research index](research/README.md).
It supports the current emphasis on reconciliation, reporting, migration, auditability,
light inventory, and multicurrency. It also reinforces three commercial decisions:

- the Canadian commerce offer is a focused launch wedge, not the full long-term market;
- accountants and bookkeepers should be the primary trust and portfolio-acquisition
  channel; and
- paid plans should vary by capacity and service, not by withholding accounting
  correctness, reports, reconciliation, audit history, accountant access, or export.

The report's broader long-term segment is U.S. and Canadian service businesses,
contractors, professional firms, and light-inventory companies with roughly 1–100
employees. ClearLedger should expand toward that segment only after the narrower
commerce workflow, migration evidence, managed operations, support, and country-specific
tax controls are proven. Full payroll, manufacturing, complex consolidation, and
automated tax filing remain separate compliance programs.

## Competitive workflow

| Product                                                                                                                                                        | Workflow strength                                                                                                                                                               | ClearLedger opportunity                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-ca/help-article/sales-channels/migrate-new-quickbooks-online-e-commerce/L1yLsHvLk_CA_en_CA) | Mature connect-configure-sync-review ecommerce flow and a large accountant ecosystem.                                                                                           | Make Woo/Etsy order-to-payout exceptions and exact CAD/USD evidence easier to understand.                                                                                                                                        |
| [Xero](https://www.xero.com/ca/accounting-software/connect-your-bank/)                                                                                         | Excellent bank reconciliation, rules, advisors, and document capture; [multi-currency is plan-dependent](https://www.xero.com/ca/accounting-software/use-multiple-currencies/). | Bundle seller-specific reconciliation rather than requiring another app.                                                                                                                                                         |
| [Zoho Books](https://www.zoho.com/ca/books/pricing/)                                                                                                           | Strong value, inventory, multi-currency, fixed assets, and a broad suite; it offers [migration help](https://www.zoho.com/ca/books/migration.html).                             | Provide a shorter, accounting-first seller workflow with fewer suite boundaries.                                                                                                                                                 |
| [Wave](https://www.waveapps.com/pricing)                                                                                                                       | Very low-friction entry and a compelling free tier.                                                                                                                             | Win inventory and marketplace sellers who outgrow simple bookkeeping; Wave's [base currency cannot be changed after creation](https://support.waveapps.com/hc/en-us/articles/208621316-Why-can-t-I-change-my-business-currency). |
| [FreshBooks](https://www.freshbooks.com/en-ca/pricing)                                                                                                         | Polished invoicing, projects, time, receipts, and mobile experience.                                                                                                            | Serve inventory commerce rather than competing first for invoice-only freelancers.                                                                                                                                               |
| [Sage Accounting](https://www.sage.com/en-ca/sage-business-cloud/accounting/)                                                                                  | Canadian accounting, inventory, support, and optional payroll.                                                                                                                  | Make ecommerce native instead of relying on a separate marketplace integration.                                                                                                                                                  |
| [A2X](https://www.a2xaccounting.com/etsy/pricing) and [Synder](https://synder.com/pricing/)                                                                    | Proven specialist demand for payout reconciliation across sales channels.                                                                                                       | Remove the second subscription only after ClearLedger reconciles orders, tax, fees, refunds, payouts, and deposits reliably.                                                                                                     |

ClearLedger already compares well in accounting integrity, invoice/PDF customization,
inventory foundations, audit evidence, controlled imports, CAD/USD exactness, and
organization-level roles. It remains behind mature products in live bank feeds, reviewed
receipt extraction, payroll, native mobile distribution, managed hosting, support, and
proven production connector operations.

## Initial customer and package

Target Canadian product businesses with:

- one to five finance or operations users;
- approximately 50–5,000 WooCommerce/Etsy orders per month as a discovery range, with
  higher-volume admission gated on provider-specific capacity evidence;
- CAD functional currency and regular USD transactions;
- inventory or fulfilment complexity;
- a willingness to run a supervised migration and beta reconciliation period.

Offer one early-access package rather than a confusing tier matrix. Include one company,
two stores, ordinary bookkeeping volume without per-order pricing, file-based bank
imports, CAD/USD, inventory, invoices, Switching Centre imports, and accountant access.
A future C$39–59 monthly range is a hypothesis to validate—not a published price—after
hosting, support, storage, provider, and incident-response costs are known. The proposed
two-store package is positioning guidance, not an implemented entitlement or published
commercial offer.

## How customers switch

1. Create a test company from a Canadian commerce preset.
2. Select the source system and upload exports to the Switching Centre; the selection is
   retained as immutable provenance, and conflicting relabelling of identical content is
   rejected.
3. Dry-run account, customer, vendor, product, open AR/AP, inventory, and opening-balance
   imports.
4. Resolve duplicates and mapping ambiguities without changing the books.
5. Compare trial balance, aging, inventory, and tax controls to the source system.
6. Connect stores in shadow mode and compare a closed sample period.
7. Choose a cutover date, preserve the migration evidence report, and keep the former
   system read-only for the agreed retention period.
8. Do not automate marketplace posting until order-to-payout acceptance tests pass for
   the customer's real payment gateways and tax configuration.

## Reach and distribution

- Recruit 5–10 Canadian design partners through WooCommerce agencies, Etsy seller
  communities, independent bookkeepers, and inventory-focused accountants.
- Lead with a concrete comparison: accounting subscription plus A2X/Synder versus one
  seller workflow. Demonstrate an order, refund, fee, payout, and bank difference—not a
  generic dashboard tour.
- Publish migration checklists and accountant-reviewed reconciliation examples as the
  primary acquisition content.
- Use `typewritingmonkeys.com` for the product site and documentation when ready, with
  the application on a dedicated subdomain and managed application infrastructure.
- Keep LocalXpose for named trusted testers only. It is not the paid hosting platform.
- Ship the web application and installable PWA first. Native app stores should follow
  only when camera/offline/notification value and signing/release operations justify
  them.

## Release gates and next product order

1. Validate WooCommerce and Etsy with disposable real-provider accounts and signed
   webhook deliveries.
   Include resumable backfill, late edits, refunds, mapping changes, provider rate limits,
   and the proposed customer-volume range in the acceptance evidence.
2. Build the accepted marketplace clearing and payout model, including fees, refunds,
   reserves, timing differences, gateway payouts, and bank matching.
3. Persistent read-only Books Health guidance is now implemented for commerce review
   and mappings, unreconciled bank activity, import differences, tax/settings readiness,
   and close blockers. Extend it with payout-specific checks only after the marketplace
   clearing model in gate 2 is accepted; an automated result is not professional approval.
4. Complete reviewed receipt extraction; a local option may reduce subscription cost,
   but confidence and human approval must remain mandatory.
5. Establish managed Canadian hosting, backups, monitoring, incident response, privacy
   terms, support, and an independent security review.
6. Add live banking only through an approved provider and consent/privacy contract;
   retain CSV/OFX as the no-additional-subscription path.
7. Treat payroll calculations/remittance, broad US tax, and native mobile distribution as
   separate regulated/release programs rather than toggles.

No internal review can substitute for Etsy Commercial Access, provider credentials,
bank-feed contracts, legal/privacy review, qualified-accountant acceptance, or app-store
signing. Those gates should be made easy to satisfy and visible in the product, never
silently bypassed.
