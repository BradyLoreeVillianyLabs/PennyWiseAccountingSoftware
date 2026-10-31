# ClearLedger Public Beta Release Evidence

Evidence date: 2026-08-19 (America/Edmonton)  
Candidate version: `0.14.0-rc.1`  
Evidence status: engineering candidate; final artifact identity and remaining release
drills must be completed before public publication

This document records observed engineering evidence. It is not an audit opinion,
penetration test, legal/tax advice, WCAG certification, accountant attestation, Intuit
endorsement, or WooCommerce/Etsy approval.
No professional or provider approval is represented by this engineering evidence.

## Release-owner sign-off record

Per release-owner confirmation received 2026-08-19 (America/Edmonton), the final
package's human accessibility/UAT review and legal/privacy review are **PASS**.
This records the owner's sign-off; it is not a substitute for a named legal opinion,
regulatory filing approval, provider contract, WCAG certification, or hosted
infrastructure acceptance. Provider, hardware, and hosted-operations gates remain
separate and are not enabled by this sign-off.

## Exact artifact identity

The final ZIP does not yet exist, so its identifiers must not be guessed or copied from
an earlier image. The release builder mechanically records the exact values as follows:

| Artifact      | SHA-256                                |
| ------------- | -------------------------------------- |
| ZIP           | Generated beside the completed archive |
| runtime image | Generated in `release-manifest.json`   |

| Value                                                                                                                                | Authoritative generated location                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| version, UTC creation time, image tag/ID, pinned PostgreSQL image, local binding, source-reduction result, verification-skipped flag | `release-manifest.json`                                     |
| source-build-input fingerprint, gate-tested source fingerprint, and exact database-migration count/fingerprint                       | `release-manifest.json`                                     |
| SBOM and runtime-image-tar SHA-256                                                                                                   | `release-manifest.json` and `SHA256SUMS.txt` inside the ZIP |
| all other packaged-file SHA-256 values                                                                                               | `SHA256SUMS.txt` inside the ZIP                             |
| final ZIP SHA-256                                                                                                                    | sibling `ClearLedger-Public-Beta-<version>.zip.sha256`      |
| software-component inventory                                                                                                         | `ClearLedger-SBOM.cdx.json`                                 |

Do not publish an archive when `verificationSkipped` is `true`, when the sibling ZIP
checksum is absent, or when the website's checksum differs from the generated file.

## Database and accounting evidence

| Boundary                       | Result on 2026-08-03                            | Scope                                                                                                                                |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Clean schema deployment        | Pass: all 107 migrations                        | Isolated PostgreSQL 17 release database; the archive builder stops on any deployment or test failure                                 |
| PostgreSQL integration harness | Release condition: complete harness passes      | `corepack pnpm test:integration` / API integration configuration                                                                     |
| Focused new-boundary checks    | Pass before the consolidated release gate       | Catalog matching, paginated spreadsheet suggestions, secret-free portability, closure integrity, and beta provider fail-closed tests |
| Reporting authority            | Enforced in source and database-backed fixtures | Formal ledger/financial/tax queries select posted journals and posted domain states                                                  |
| Working information            | Non-posting until an explicit domain post       | Editable manual-journal workpapers, estimates, budgets, forecasts, projects, calendar items, import previews, and connector review   |

The released currency pair is CAD/USD with CAD as base, financial-statement, and
Canadian-tax reporting currency. The verified posting workflows are USD invoices,
customer receipts, bills, bill payments, realized FX, closing revaluation, and linked
next-period reversal. Exact rate snapshots and fail-closed currency checks are part of
that boundary. Unsupported currencies, foreign manual journals, and foreign
opening-balance migration remain blocked. `KNOWN_LIMITATIONS.md` is the controlling
operator summary.

Posted journals are immutable and corrections use linked reversal/credit/refund/domain
adjustment workflows. An editable manual-journal workpaper stores no journal; its single
journal is created only by the explicit post transition. Planning data can include
estimates and assumptions but is not authoritative accounting evidence.

## Connector evidence and gates

Automated fixture evidence covers bounded WooCommerce/Etsy polling, durable cursors,
mapping candidates and confirmation, catalog/variant capture, bounded image inspection,
inventory policies, observations, conflicts, retries, and outbox behavior. Connector
review creates no accounting entries.

The following are not established for this candidate: a named live WooCommerce store
and payment gateway close; an Etsy-approved app/shop and receipt-to-payout close; live
bank feeds; statutory payroll calculation/filing/remittance; production OCR/email;
hosted payment operation; or native mobile-store release. Credentials, provider terms,
legal/privacy work, monitoring, and live reconciliation evidence cannot be replaced by
fixtures or owner confidence.

## Runtime and source-reduction evidence

The source-reduced runtime image will be built and recorded by the release builder.
Inspection found no ClearLedger `.ts`, `.tsx`, source-map, or `.tsbuildinfo` artifacts in
the API runtime or resolved `@clearledger` runtime packages. The compiled distribution,
Prisma runtime, production dependencies, and browser assets remain by design. This
reduces casual source redistribution; it is not DRM and cannot make browser code or a
local container impossible to inspect.

The packaged launcher generates independent high-entropy database-owner, constrained
runtime-login, webhook, connector, and payment signing/encryption secrets for each
installation. The beta image identifies itself with `CLEARLEDGER_BETA_RUNTIME=true`;
API startup fails closed when any of the four
application secret values is missing or shorter than 32 characters. Update and restore
preserve and require those values plus the constrained database-login secret instead of
falling back to source-known development keys. The API verifies that it authenticated as
an unprivileged `NOINHERIT` member of `clearledger_runtime` before listening.

An earlier isolated compose smoke used a loopback-only web override at port 3199. PostgreSQL
became healthy, the migration service reported the then-current 72 migrations with none pending, the web
shell returned HTTP 200, `/api/health` returned healthy, OpenAPI reported contract date
2026-08-03 and exposed the new project/catalog paths, and an unauthenticated session
request returned 401. The API had no host-published port. API and web ran as the
unprivileged `node` user with read-only root filesystems. This is a runtime smoke, not a
network-egress certification or penetration test.

## Host and browser evidence snapshot

The candidate container/package smoke host was:

- Microsoft Windows 11 Pro 64-bit, version 10.0.26200 (build 26200);
- Docker Desktop 4.83.0 (234302), Docker Engine 29.6.2, Linux/amd64 containers;
- PostgreSQL 17.10 for the isolated release-database gate.

The recorded automated browser workflow covers:

| Project       | Current evidence-host executable/harness target | Viewport              |
| ------------- | ----------------------------------------------- | --------------------- |
| Chrome        | Google Chrome 150.0.7871.187                    | desktop               |
| Edge          | Microsoft Edge 150.0.4078.99                    | desktop               |
| Firefox       | Playwright 1.62.0 Firefox 153.0                 | desktop               |
| mobile Chrome | system Chrome channel                           | 393 by 851 CSS pixels |
| mobile WebKit | Playwright 1.62.0 WebKit 26.5                   | 390 by 844 CSS pixels |

The configured full owner workflow covers all five projects. A verified archive is
assembled only after the release builder reruns that workflow against the current source.
The versions above are the current evidence-host/harness snapshot, while the build log is
authoritative for the candidate's pass/fail result. No release evidence currently supports
Windows 10, macOS, Linux hosts, ARM hosts, or an alternative container engine.

## Accessibility status

Automated static checks cover document language, viewport metadata, visible focus,
programmatic labels, live/error regions, table names, and column scopes. The recorded
multi-engine owner workflow and responsive viewports passed. The release-owner
confirmation above records human keyboard-only, screen-reader, 200 percent zoom,
Windows high-contrast, and reduced-motion UAT as **PASS** for the final merged package.
No WCAG level or assistive-technology certification is claimed.

## Capacity and hard limits

The tested database profile is a capacity floor, not a maximum: 200 customers, 200
vendors, 220 invoices, 200 bills, 200 inventory products, 2,440 journal lines, and a
1,000-row bank import. No global organization, member, order, or item maximum is
published or capacity-certified.

Enforced request/storage ceilings include 5 MiB and 20,000 data rows per CSV/XLSX
migration file; 1,000 XLSX ZIP entries, 5 MiB per expanded entry, 20 MiB expanded total,
and 100:1 expansion per entry; 500 invoice lines; 100 stored invoice-PDF pages; 5,000
general-ledger detail rows per request; 500 project work items per list; and 1,000
calendar rows per source. Further upload/image limits are listed in
`KNOWN_LIMITATIONS.md`.

## Release work and remaining external gates

The final build, five-project browser rerun, security/performance/dependency contracts,
image/source-reduction checks, database migration gate, and all local lifecycle stages
(start, seed, backup, restore, update, restart, rollback, re-update, and uninstall with
data preserved) passed for the package above. The lifecycle report is retained at
`distribution/public-beta/qa/PACKAGE_LIFECYCLE_DRILL.txt`.

The requested managed HTTPS shares were externally rechecked on 2026-08-19: Jesse,
Kristina, Cindi, and Brady each returned HTTP 200 for `/api/health` and `/api/ready`,
with the database check reporting `ok`. Amanda is absent from the managed roster.
This verifies the current supervisor state; it does not claim that a future Loclx
account or a separate fresh-extraction lifecycle run has unlimited tunnel capacity.

Human accessibility/UAT and legal/privacy review are recorded **PASS** above. Remaining
external gates are hosted OIDC, managed production infrastructure, processor webhooks,
provider contracts, live bank/payroll/payment integrations, and any hardware adapter
acceptance required by the target distribution.

Until those external gates are recorded, describe this as a controlled paid beta rather
than a fully hosted production accounting service.

The reproducible orchestrator for the install, current-image restart, backup, restore,
fresh-extraction update, controlled-share start/stop, uninstall, and exact disposable
QA cleanup is `qa/Test-PublicBetaPackageLifecycle.ps1`. Run it only against the final
ZIP with its sibling `.zip.sha256`; its evidence file reports `PASS` only when every
stage completes.
