# ClearLedger paid-beta release runbook

**Decision:** release the software as a verified local/controlled-share beta with an
optional paid assisted onboarding service. Do not represent the current package as a
hosted, fully automated accounting service until the external gates below are complete.

## What is ready in-repository

- Accounting-safe CAD/USD beta with immutable posting, audit, tenant controls, migration,
  reconciliation, inventory, CRM/calendar, tax, documents, and demo-company workflows.
- Current source-based release builder with source reduction, SBOM, checksums, Docker
  runtime, Windows scripts, backup/restore, update, controlled share, and uninstall paths.
- Guarded WordPress marketing/download plugin with support, private security intake,
  moderated community feedback, checksum gating, and assisted-beta offer copy.
- Commercial subscription control-plane boundary with tenant authorization, versioned
  transitions, idempotent provider events, and no accounting side effects.
- Paid-beta pricing and design-partner workflow documented in the accompanying marketing
  and design-partner instruments.

## Release operator sequence

1. Run from a clean, stable checkout on the supported Windows/Docker host.
2. Ensure PostgreSQL test services and Docker are available.
3. Run the full builder with verification enabled:

   ```powershell
   .\scripts\run-final-public-beta-build.ps1 `
     -TestDatabaseUrl "postgresql://clearledger:clearledger_dev_only@localhost:5433/clearledger_test?schema=public"
   ```

4. Confirm the resulting ZIP is under `distribution/public-beta/output/`,
   `verificationSkipped` is `false`, and the sibling `.zip.sha256` exists.
5. Run the disposable package lifecycle gate against that exact ZIP:

   ```powershell
   .\distribution\public-beta\qa\Test-PublicBetaPackageLifecycle.ps1 `
     -PackageZip .\distribution\public-beta\output\ClearLedger-Public-Beta-<version>.zip
   ```

   The drill requires one available Loclx tunnel slot in addition to any operational
   tunnels. If the provider returns HTTP 503 for the temporary authenticated share,
   treat that as an account-capacity gate: do not stop another user's tunnel, increase
   the concurrent-tunnel allowance (or schedule a controlled window), and rerun the
   same command. The local start, backup/restore, update/rollback, and uninstall stages
   remain valid evidence even when this external share assertion is unavailable.

6. Publish the ZIP and sibling checksum only from a trusted HTTPS origin. Keep the app
   bound to localhost; use the controlled-share launcher only for named testers.
7. Build the WordPress package and run its static, PHP, JavaScript, and disposable runtime
   checks before uploading the new plugin ZIP.

## Paid-beta operating model

The download remains a beta software licence. Revenue comes from the assisted service:
C$199–C$399 setup and C$49–C$99 per organization/month during the pilot. Before accepting
payment, provide the partner with the written scope, beta limitations, support response
expectation, export path, cancellation/refund terms, and invoice. Provision the commercial
record manually through the authorized commercial endpoint only after payment is confirmed;
never grant entitlements from an unverified browser request.

The current commercial API is a control-plane record, not a complete billing provider. A
payment processor, tax treatment, webhook verification, refund process, and customer
notification workflow must be added and accepted before automatic subscriptions are sold.

## External work that cannot be completed without owner accounts

### Production identity

Create an OIDC application with a supported identity provider. Configure HTTPS issuer,
client ID/secret, callback, logout, and recovery URLs. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_POST_LOGOUT_REDIRECT_URI`, and
`OIDC_RECOVERY_URL` in the production secret store. Verify discovery, login, logout,
revocation, recovery, invitation acceptance, MFA policy, and cross-tenant denial from a
second account. Never use the local identity adapter in production.

### Billing and tax

Select a processor, obtain counsel-approved terms/refund language, configure merchant and
tax registration details, create plans, and implement signed webhook delivery to the
commercial event boundary. Test duplicate, delayed, out-of-order, refunded, cancelled,
and chargeback events. Reconcile processor payouts separately; commercial status must never
create or alter accounting entries without an explicit reviewed accounting workflow.

### Hosting and operations

Provide a managed PostgreSQL service, encrypted object storage, secret manager, TLS/domain,
monitoring, alerting, backups, restore drills, incident response, access reviews, support
mailbox, and a documented RTO/RPO. A local always-on PC or Loclx tunnel is not production
hosting. Complete an independent security review and counsel review of privacy, DPA, terms,
beta licence, data retention, and Canadian anti-spam obligations.

### Provider integrations

For each WooCommerce, Etsy, bank, payroll, OCR, email, or payment provider, obtain an
approved test account, minimum scopes, contract/terms, rate-limit plan, retention decision,
signature verification evidence, failure/retry tests, and a reconciled live fixture. Keep
review/shadow mode enabled until that evidence is recorded. Never reuse credentials from an
operational store.

### Website launch

Build `distribution/wordpress-site`, upload the versioned plugin ZIP, configure the exact
application ZIP URL and `.sha256` URL in **Settings > ClearLedger Beta**, verify the computed
hash from a separate download, and only then publish the landing/support/community pages.
Keep the site’s download gate closed while either URL or hash is missing.

## Go/no-go checklist

- [ ] Current archive has verification enabled and exact checksums.
- [ ] Package lifecycle, backup/restore, update/rollback, and controlled-share drills pass.
- [x] Human UAT passes keyboard-only, screen reader, 200% zoom, high contrast, and reduced
      motion checks; see `distribution/public-beta/RELEASE_EVIDENCE.md`.
- [ ] OIDC, hosting, monitoring, and support are accepted for the target jurisdiction;
      legal/privacy review is recorded as passed, but these operational gates remain open.
- [ ] At least five design partners have paid, completed a core workflow, and accepted the
      export/reconciliation evidence.
- [ ] Public claims match the exact release manifest and known limitations.
