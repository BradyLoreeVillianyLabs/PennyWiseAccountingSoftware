# Public Beta Completion Program

Date: 2026-08-03  
Target: a source-reduced, self-hostable ClearLedger public-beta package that is safe
enough for informed small-business testers and honest about provider-dependent limits.

The cumulative owner-request inventory is maintained in
`OWNER_REQUEST_LEDGER_2026-08-03.md`. Later steering changes work order but does not
silently remove an earlier requirement; the final no-drop audit must reconcile both
documents.

This program consolidates the current phase reports, market assessment, customer-feature
plan, multi-currency audit, accounting-boundary decision, beta feedback, and the
2026-08-03 implementation review. It replaces phase-number sequencing for the beta
finish: work may proceed concurrently, but every release gate below must pass.

## Product position used for beta decisions

The first admitted customer is a Canadian owner-operated WooCommerce or Etsy business
that keeps its books in CAD, sells in CAD and USD, carries light inventory, and works
with an owner plus a bookkeeper or accountant. The default experience must also remain
usable for service companies. ClearLedger must not claim to replace a marketplace
settlement product until order-to-payout reconciliation has passed provider-backed
fixtures and supervised live evidence.

The product promise for beta is one coherent workspace for migration, invoices,
expenses, inventory, marketplace review, projects, tax evidence, forecasting, and
accountant handoff. Optional provider connections enhance that workspace; they must not
be required to perform ordinary bookkeeping manually or through spreadsheets.

## Parallel delivery lanes

| Lane                         | Required beta outcome                                                                                                                                                                                 | Accounting authority                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Spreadsheet migration        | CSV and safe `.xlsx`, visual column mapping, row preview, validation, saved mapping profiles, dry run, reconciliation, and reversible pre-commit editing                                              | Imports remain staged until an explicit successful commit                          |
| Tax engine                   | One versioned calculation service used by sales, purchases, expenses, credits, refunds, banking, marketplace review, and future filing workflows                                                      | Effective-dated evidence snapshots; reports derive from posted facts               |
| Catalog and SKU intelligence | First-class external listings/variants, exact identifier matching, ranked suggestions, manual confirmation, match history, and safe image metadata                                                    | Fuzzy results never auto-confirm and never post accounting                         |
| Inventory automation         | Woo/Etsy catalog discovery, per-source policy, observed/desired quantities, idempotent jobs, retries, conflict review, and reconciliation                                                             | Quantity/value movements use existing inventory services only                      |
| Workpapers and forecasts     | Editable drafts, cancellation, planning assumptions, forecasts, budgets, and clear provenance without corrective journal noise                                                                        | Only explicit posting creates authoritative journals; posted facts stay immutable  |
| Calendar and projects        | Unified project, task, milestone, invoice, bill, and reminder views with accessible list alternatives                                                                                                 | Calendar items link to sources and never create accounting merely by moving a card |
| Premium documents            | Rich invoice themes, logo and typography controls, exact preview, faithful multi-page PDF, currency/tax/payment clarity, immutable sent snapshots                                                     | Issued-document snapshots remain reproducible and integrity checked                |
| Dashboard and workflow UI    | Invoice-inspired visual hierarchy, configurable tiles, tabs for sprawling workspaces, interactive explanations, docked help, and responsive menus                                                     | Status and actions distinguish draft, planned, approved, posted, and voided        |
| Public-beta distribution     | Source-reduced runtime, repeatable start/stop/backup/restore, versioned manifest/checksums published from the official HTTPS site, third-party notices, beta terms, known limits, and clean uninstall | No production secret, provider credential, or customer data is bundled             |

## Required architecture decisions

1. Store amounts as integer minor units and quantities/rates using the existing exact
   decimal conventions. Never use binary floating point for accounting decisions.
2. Keep posted journals and issued document snapshots immutable. Correction uses the
   domain reversal/credit/void workflow; ordinary draft edits update the same draft.
3. Treat forecasts and estimates as explicitly non-authoritative planning records.
   Formal financial statements, tax reports, and ledgers include posted records only.
4. Resolve taxes through the central tax service. Each result records engine version,
   purpose, effective tax-code version, inputs, rounding method, and components.
5. Match SKUs in descending evidence order: confirmed mapping; GTIN; manufacturer plus
   MPN; normalized exact SKU; variant signature; fuzzy candidate. Only a user or an
   unambiguous durable identifier can confirm a new mapping.
6. Keep external listing/variant IDs separate from internal SKUs. Preserve source data
   and a full decision history so mappings can be changed without rewriting history.
7. Generate marketplace inventory changes through a transactional outbox/durable job
   path with idempotency keys. Expose desired, observed, pending, failed, and conflicted
   states; do not hide a provider failure behind optimistic UI.
8. Reject active-content workbooks, formulas without cached values, unsafe archives,
   unsupported legacy Excel types, and spreadsheet formulas in exported text.
9. Restrict product-image downloads to authenticated connector hosts with byte, pixel,
   type, redirect, and private-network limits. Images are descriptive assets, never
   matching authority by themselves.
10. Package without embedded Etsy, WooCommerce, Stripe, OIDC, email, bank, payroll, or
    OCR credentials. A tester supplies their own credentials only in server-side
    configuration. Etsy commercial-access approval remains an external launch gate.

## Release gates

The distributable may be labelled public beta only when all applicable gates pass on a
fresh beta installation:

- formatting, lint, strict TypeScript, Prisma validation, unit tests, and builds;
- every database integration suite on the isolated test PostgreSQL instance;
- central-tax equivalence and evidence tests for sales, purchases, credits, refunds,
  expenses, and marketplace review paths;
- tenant isolation, permissions, idempotency, concurrency, closed-period, and
  immutability tests for every new table and mutation;
- safe CSV/XLSX fixtures including leading zeroes, decimals, formulas, zip bombs,
  external links, macros, malformed XML, duplicates, and source mismatches;
- browser flows for desktop and mobile: new company, demo company, import mapping,
  invoice design/preview/PDF, dashboard configuration, calendar/list view, help,
  connector catalog review, and draft-to-post transitions;
- keyboard, visible focus, accessible names, 200 percent zoom, reduced motion, high
  contrast, semantic tables/list alternatives, and narrow-screen menus;
- performance targets retained from `docs/RELEASE_CANDIDATE.md` and new bounded-load
  profiles for workbook preview, catalog matching, calendar queries, and PDF rendering;
- dependency licence inventory, production dependency audit, SBOM, checksums, and
  source-reduced package manifest;
- clean-install, restart, backup, restore, export, update, rollback, and uninstall
  drills with written evidence;
- no secrets, real customer data, operational bridge data, private certificates, or
  development-only authentication bypasses in the archive.

## Claims permitted in the beta

Permitted claims must be tied to passing evidence: CAD/USD accounting, manual and safe
spreadsheet migration, perpetual weighted-average inventory, invoice/payment/purchase/
banking workflows, posted-only financial reports, projects/workpapers, and
provider-specific features that have actually passed supported sandbox or live tests.

Do not claim automated tax filing, statutory payroll, live bank feeds, production OCR,
native mobile-store delivery, guaranteed Etsy availability, or fully automated
order-to-payout accounting until the corresponding credentials, contracts, accounting
fixtures, operational monitoring, and supervised evidence exist.

## Completion record

Each delivery lane must add its changed-file list, migration and rollback evidence,
test commands/results, remaining external gates, and manual verification notes to a
dated status report. The final package must name the exact commit/source snapshot,
database migration set, archive hash, SBOM hash, supported platforms, and recovery
procedure. A passed automated gate is engineering evidence; professional or provider
approval is recorded only when it actually exists.
