# ClearLedger UX gap analysis and prompt package

Status: created 2026-08-06

## Executive summary

The ClearLedger repository already has a strong accounting foundation, and several of the most valuable workaround-product capabilities are already partially present in the codebase. The remaining gap is not raw capability alone; it is the experience layer. The product needs to feel faster, clearer, more reassuring, and more guided than the tools accountants currently use as workarounds.

The goal is not to build a generic CRM, document-management suite, or BI platform. The goal is to make ClearLedger feel like the best operating layer for migration, collaboration, review, and advisory work while staying audit-safe and accounting-first.

## What the repository already does well

The current codebase already shows strong foundations in:

- staged import and migration flows through the data migration service
- immutable provenance and source-system evidence for imports
- review-oriented connector and commerce inbox workflows
- customer and calendar services that can support relationship and scheduling use cases
- a tenant-scoped audit pattern that can support trust and accountability

## Where the experience still lags competitor products

The biggest gaps are the areas where paid workaround tools feel more polished and more “done” for the user:

1. Guided migration and switching experience
2. Document capture and AP review flow
3. Connector reconciliation inbox usability
4. Advisory reporting and management dashboards
5. Secure collaboration and client document exchange
6. CRM-like client activity and calendar experience
7. Onboarding and cutover guidance
8. Clear error recovery and resolution workflow
9. Mobile and accessibility-first finance usability
10. Single-workbench workflow unification and speed

## Comparison against the market

### Migration and import tools: Transaction Pro, SaasAnt, and similar tools

Strengths they commonly have:

- guided step-by-step migration flows
- clear mapping UI with preview and validation
- visible next steps and error resolution paths
- strong confidence around cutover and reconciliation

ClearLedger’s advantage:

- ClearLedger can be more trustworthy because it preserves auditability, tenant scope, and accounting safety.

### Document capture tools: AutoEntry, Dext, Bill.com

Strengths they commonly have:

- frictionless capture from documents and emails
- instant suggestion of vendor, account, and amount
- review queues that feel lightweight and fast

ClearLedger’s advantage:

- ClearLedger can be more deliberate and more audit-friendly than tools that auto-post aggressively.

### Connector reconciliation tools: A2X, Synder, Webgility

Strengths they commonly have:

- clear reconciliation inboxes
- visible mapping and exception handling
- rapid resolution of marketplace and payment events

ClearLedger’s advantage:

- ClearLedger can make these workflows more trustworthy because every action can be linked to a review, a source record, and an accounting rule.

### Advisory reporting tools: Fathom, Spotlight

Strengths they commonly have:

- polished dashboards and KPI storytelling
- clear management summaries
- simple drill-down and interpretation

ClearLedger’s advantage:

- ClearLedger can connect reporting directly to the ledger and the accounting workflow rather than being a disconnected overlay.

### Secure collaboration tools: SmartVault, ShareFile

Strengths they commonly have:

- shared client document workspaces
- clear permissioning for external users
- simple document exchange for advisors and clients

ClearLedger’s advantage:

- ClearLedger can tie shared documents directly to invoices, bills, customer records, and accounting evidence.

## Prompt package

Use the following prompts as implementation handoffs for a high-reasoning coding agent:

1. Improve switching-centre usability and guided migration workflow
2. Improve document capture, AP review, and bill intake experience
3. Improve connector reconciliation inbox and exception handling
4. Improve advisory reporting and dashboard polish
5. Improve secure client collaboration and document exchange
6. Improve CRM-like client activity and calendar experience
7. Improve onboarding, cutover guidance, and migration confidence
8. Improve error recovery, explanations, and resolution UX
9. Improve mobile and accessibility-first finance workflows
10. Improve workbench unification, speed, and perceived reliability

Each prompt below is written to make the agent optimize for user experience quality, trust, and differentiation versus existing market products.
