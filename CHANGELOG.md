# Changelog

## Unreleased - trusted commerce preview

- Retains the owner-supplied North American accounting-software feature-demand and
  monetization report unchanged under `docs/research`, records its source hash and
  limitations, and aligns the market-position notes to its evidence.
- Replaces the first-page Home hero and large cards with a compact dashboard: six
  immediate financial indicators, prioritized exceptions, cash activity, read-only
  Books Health, four quick actions, and collapsed setup/help details.
- Adds source-specific pre-export and cutover checklists in the Switching Centre for
  QuickBooks Online, Xero, Wave, FreshBooks, Sage, Zoho Books, and spreadsheet sources.
- Moves source selection ahead of the checklist, adds downloadable canonical CSV
  templates and live workflow progress, keeps raw JSON mapping under Advanced, and
  warns rather than inventing conversions for unsupported foreign opening balances.
- Adds a persistent, tenant-scoped Books Health card with read-only findings for
  commerce mappings/review, banking reconciliation, import variance, tax/settings
  readiness, and period close, plus direct navigation to each review workspace.
- Corrects bank close/review logic so an active item in an in-progress reconciliation
  remains unreconciled until that reconciliation is completed.
- Adds native WooCommerce and Etsy multi-store connectors with encrypted credentials,
  resumable fixed-window synchronization, provider-signed webhooks, exact provider
  money, versioned mappings, replay protection, and a non-posting review inbox.
- Keeps the first synchronization inside the consented backfill range, returns a
  continuation when the page budget is exhausted, and advances the connector's
  completed-through time only after every requested scope is complete.
- Applies saved customer, SKU, and tax mappings to polling and webhook normalization;
  verified provider deliveries use a null system actor instead of attributing the event
  to the member who created the connector.
- Redacts buyer/contact/address data, identifiers, network and user-agent values, notes,
  arbitrary metadata, order access keys, and secret-like fields from retained provider
  payloads when those fields are not needed for accounting normalization.
- Adds a webhook-only LocalXpose relay for provider-signed deliveries on allowlisted
  paths so callbacks remain separate from the password-protected browser preview.
- Adds an indicative, no-key Bank of Canada USD/CAD rate suggestion that requires explicit
  review and saving before it can affect accounting.
- Persists immutable source-system evidence for Switching Centre imports from QuickBooks
  Online, Xero, Wave, FreshBooks, Sage, Zoho Books, and other spreadsheet sources.
  Identical same-source uploads reuse the existing batch; identical content labelled as
  a different source is rejected with `IMPORT_SOURCE_MISMATCH`.
- Adds a deterministic development sample order for evaluating the connector review
  workflow without external credentials or changes to the books.
- Makes the controlled LocalXpose share fail closed unless it receives a stable,
  high-entropy connector credential encryption secret of at least 32 characters.
- Replaces the production OIDC buttons with an automatic test-company loading state in
  controlled shares, preventing trusted testers from reaching an unconfigured sign-in flow.
- Separates page titles, nested section headings, primary navigation, section tabs,
  text actions, and financial drill-downs with distinct shapes, borders, active states,
  focus treatment, and high-contrast fallbacks.
- Adds a searchable Help & learning workspace with a persistent six-step tutorial,
  direct task links, and a collapsible desktop companion beside the Home dashboard.
- Adds a non-production, one-per-user fictional Canadian service-company fixture so
  evaluators can open completed setup and realistic balanced sample books without
  changing an existing organization.

## 0.14.0-rc.1 - 2026-07-25

- Release candidate for controlled beta after Phases 1 through 14.
- Adds release traceability, accessibility safeguards, user-acceptance scripts, and quality gates.
- Adds a forward PostgreSQL RLS policy optimization for ledger report scans, with a disposable-environment rollback file.
- Adds database-backed capacity evidence and the complete Chrome, Edge, Firefox, mobile Chrome, and mobile WebKit browser matrix.
- Extends the browser matrix through payment allocation, bank matching, and completed zero-difference reconciliation.

## Pre-release history

- Phases 1 through 13 established the accounting, identity, setup, sales, payments, purchasing, banking, inventory, reporting, accounting-close, portability, and production-hardening foundations.
