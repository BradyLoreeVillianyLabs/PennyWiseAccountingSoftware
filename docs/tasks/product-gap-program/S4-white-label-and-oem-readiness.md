# S4 — Make PennyWise something another company can ship

Commercial-readiness prompt. Prepared, not authorized: record it in
`docs/status/CURRENT_PHASE.md` before starting.

## Why, and the warning that comes with it

Sources are in `codex-product-gap-pack/MONETIZATION-AND-FEATURE-ASSESSMENT-2026-09-12.md`,
Part 6 and Part 7, Option 3.

**The opportunity is real:**

- **Reckon republished and distributed Intuit's QuickBooks desktop software in Australia for
  over 25 years** under licence. An entire business ran on someone else's ledger engine.
- **Vertical software deliberately avoids building accounting.** Jobber — Edmonton,
  200,000+ service professionals, over $40B invoiced — integrates QuickBooks and Xero
  instead. ServiceTitan earns roughly **$81k per customer** in those same trades.
- **De-branding is directly monetisable at small scale:** Invoice Ninja sells a white-label
  licence for **$30–40 per year**.
- **The Canadian bank channel is open:** RBCx's Ownr bundles FreshBooks for new
  incorporators.

**The warning is equally documented:**

- Intuit **revoked Reckon's licence in 2014** and entered the market directly.
- **"Bill Pay powered by Melio" was discontinued inside QuickBooks on 20 May 2024** and
  replaced by Intuit's own product.

So build for white-label, but never let a single licensee become the only distribution, and
write the exit terms before the first deal.

## What exists today

- Invoice template designer, logo storage, and eight invoice themes.
- PWA manifest and icons; Inno Setup installer with its own branding.
- Scoped API credentials, OAuth 2.1, signed webhooks, and a published OpenAPI contract.
- Workflow profiles that already hide or show whole workspaces.
- **No brand configuration, no per-deployment feature flags, no partner update channel.**

## Tasks

1. **Brand configuration as data**, applied consistently to:

   - application chrome (product name, logo, colours, support link);
   - documents (invoice, credit note, receipt, statement);
   - the installer and its shortcuts;
   - the PWA manifest and icons;
   - email subjects and bodies (I4).

   One source of truth. No hard-coded product name in the UI or documents.

2. **Per-deployment feature flags.** A partner build can hide modules it doesn't sell — POS,
   payroll, inventory depth, commerce. Hiding a module must never change posting behaviour
   or hide a posted amount from reports.

3. **Deployment licence.** Each OEM build carries an S2 licence identifying the partner and
   its limits.

4. **Update channel per partner.** A partner's customers receive that partner's builds.
   Document how a partner publishes an update and how a customer verifies its signature.

5. **Attribution control.** A configurable "powered by" line, with a written note that
   removing it is a contractual matter, not a technical one.

6. **Partner exit plan — write it before selling anything.** A short document stating what
   happens to the partner's customers if the agreement ends: their data stays local, exports
   keep working, licences remain valid for a stated period, and migration is supported. This
   is the direct answer to what Intuit did to Reckon and to Melio's integration.

7. **Partner technical pack.** Setup, branding, flags, support boundaries, and the security
   expectations for partner-supplied assets.

## Constraints

- **No third-party trademarks** in any build, and no implication of endorsement.
- **Partner-supplied assets are untrusted input:** sanitize SVG and image uploads, bound
  sizes, and never allow active content in a document or the app shell.
- Branding never alters accounting behaviour, audit records, or export contents.
- Accessibility survives re-branding: a partner palette must still pass the X4 contrast
  checks, and the build fails if it doesn't.

## Acceptance criteria

- Two visibly distinct branded builds are produced from one source tree, differing only in
  configuration.
- Each shows correct branding in app, documents, installer and PWA manifest.
- A feature-flagged build hides a module while posting, reports and exports stay correct
  (integration test).
- A malicious SVG logo is rejected.
- A partner palette that fails contrast fails the build.
- The exit plan and partner pack are published in `docs/`.

## Standard rules

- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.
- Meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` section 6.
- Keep LF endings; rebuild web assets; there is no git, so list every changed file.
