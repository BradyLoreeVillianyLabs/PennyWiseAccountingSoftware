# ClearLedger Public Beta Known Limitations

Read this before entering real records. `RELEASE_EVIDENCE.md` distinguishes the
checks completed on 2026-08-03 from checks that still must be repeated against the
final archive. The generated `release-manifest.json`, `SHA256SUMS.txt`, SBOM, and
sibling ZIP checksum identify the exact build; a package whose manifest says
`verificationSkipped: true` is not a verified public-beta release.

## Safe beta use

- Run ClearLedger on a supported computer you control and keep it bound to localhost.
  Remote sharing requires the documented controlled-share mode, a named tester, HTTPS,
  and a separately secured host; never expose the development API directly.
- Configure automatic backups and complete one restore drill before relying on the
  system. Keep source invoices, receipts, statements, marketplace exports, tax evidence,
  and the prior accounting system or a complete readable archive.
- Reconcile trial balance, AR, AP, bank, tax, inventory, and foreign-currency controls at
  migration and every close. Use the organization export regularly.
- Restrict access to trusted testers. The local beta identity flow is not production OIDC
  and is not a substitute for an internet-facing identity provider.

## Accounting and tax boundary

- The verified multi-currency boundary is CAD-base books with CAD and USD invoices,
  customer receipts, bills, bill payments, realized FX, closing revaluation, and linked
  next-period reversal. CAD is the financial-statement and Canadian-tax reporting
  currency. Other currencies, foreign manual journals, foreign opening-balance imports,
  and any money-bearing workflow not expressly listed are unsupported or
  base-currency-only.
- Drafts, estimates, budgets, forecasts, assumptions, project plans, calendar items,
  connector reviews, import previews, fixed-asset previews, deposit/progress plans, and
  unposted manual-journal workpapers are non-posting working information. Formal ledgers
  and financial/tax reports include posted authoritative records only.
- The tax engine calculates configured effective-dated codes and preserves evidence; it
  does not determine registration obligations, nexus, exempt status, filing elections,
  return adjustments, or advice for a business. Automated tax filing/remittance is not
  included.
- This public beta is English-Canadian and does not claim French-language, Quebec, QST,
  Revenu Quebec, or U.S. localization completeness. Do not use a configurable tax code
  as evidence that a jurisdiction, return, translation, or filing workflow is supported.
- Posted records are corrected through linked domain reversals, credits, refunds, voids,
  or adjustments. Direct editing of posted accounting history is intentionally blocked.
- Recurring invoice plans store cadence and template data only. This beta has no
  background scheduler or automatic invoice creation; users must create and review each
  invoice manually when it is due.
- Reminder rules, a unified customer-communication timeline, and a general customer
  portal are beta-deferred. Use the existing invoice/estimate delivery histories and
  statements, send reminders manually, and share only the existing document-scoped
  expiring/revocable links rather than giving a customer broad account access.
- Project profitability based on posted actuals and approved-time-to-invoice automation
  are beta-deferred. Continue recording project time, mileage, budgets, work items, and
  evidence; review approved time, create the invoice manually, and compare project
  records with posted ledger reports or exports.
- Purchase orders, partial-receipt commitment accounting, and automatic receipt-to-bill
  matching are beta-deferred. Use purchase requests for approval intent, inventory
  receipts and Bills for actual transactions, retain supplier evidence, and manually
  reconcile partial receipts and vendor bills.
- Fixed-asset and progress/deposit plans do not post automatically. Use the fixed-asset
  register and depreciation preview as workpapers, post only an explicitly reviewed
  manual journal when appropriate, and turn approved progress/deposit plans into
  explicit invoices and payments with manual reconciliation.
- The legacy payroll-summary workflow preference is disabled and hidden because no
  payroll-summary importer is connected to it. The separate native-payroll foundation is
  not a public-beta feature claim and has no supported native payroll UI. Continue using
  a payroll provider or retained payroll workpapers; enter only reviewed summaries
  through supported imports/manual journals and retain filing/remittance evidence.

## Provider-dependent features

- WooCommerce and Etsy require credentials created and supplied by the tester. Never
  reuse credentials from an operational store or include them in a beta archive.
- Etsy app availability and higher-volume/commercial access are controlled by Etsy and
  cannot be guaranteed by ClearLedger. WooCommerce sites vary by hosting, extensions,
  API permissions, taxes, refunds, fulfilment, and payout providers.
- Connector polling, mapping, catalog review, image inspection, inventory policy, retry,
  and conflict handling have automated fixture evidence. No named live store/shop,
  marketplace payout, gateway fee, or bank-deposit close has been accepted for this
  release. Connector data remains in a review/reconciliation boundary and must not
  silently create accounting.
- The provider-independent catalog matcher now ranks exact identifiers plus nearest SKU,
  product name, and description evidence for Etsy, WooCommerce, and other normalized
  sources. Similarity is a review suggestion only: fuzzy evidence never confirms a local
  mapping without explicit human approval.
- The evidence-inbox backend can convert one approved, clean receipt or bill capture
  exactly once into one linked **DRAFT** immediate-expense or Bill record. Conversion is
  versioned, tenant-scoped, idempotent, audited, and non-posting; users must still review
  and explicitly complete the normal accounting workflow.
- Live bank feeds, statutory payroll calculation/filing/remittance, production OCR,
  production email delivery, hosted payments, and mobile app-store packaging require
  separate providers, contracts, credentials, monitoring, privacy terms, and release
  evidence. Manual/native alternatives may be available; no unverified provider is
  represented as active.

## Tested platform boundary

- The 2026-08-03 container/package smoke host was 64-bit Windows 11 Pro build 26200 with
  Docker Desktop 4.83.0 / Engine 29.6.2. No Windows 10, macOS, Linux-host, ARM, or
  alternative container-engine release claim has been established.
- The recorded automated browser matrix covers Chrome, Edge, Firefox, mobile-Chrome
  emulation at 393 by 851 CSS pixels, and WebKit mobile emulation at 390 by 844 CSS
  pixels. At this evidence snapshot the host has Chrome 150.0.7871.187 and Edge
  150.0.4078.99, while the current Playwright 1.62.0 harness targets Firefox 153.0 and
  WebKit 26.5. A verified archive is assembled only after the builder reruns all five
  projects against the current source. Browser versions change rapidly; use a current
  patched version and treat this as evidence, not a perpetual compatibility promise.
- Builds are provenance-identified but are not guaranteed to be byte-for-byte
  reproducible: operating-system package indexes, inventory timestamps, container-save
  metadata, and ZIP metadata can change between otherwise equivalent builds. Trust the
  exact published archive and sibling SHA-256 pair, not a hash predicted from source alone.
- Automated static accessibility contracts and the recorded browser workflow passed.
  The release-owner sign-off record in `RELEASE_EVIDENCE.md` records human
  keyboard-only, screen-reader, 200 percent zoom, Windows high-contrast, and
  reduced-motion UAT as passed for this final package. ClearLedger does not claim a
  WCAG conformance certification or an assistive-technology certification.

## Current hard and tested limits

- No subscription cap or supported maximum is published for organizations, members,
  orders, or catalog items. That means **not capacity-certified**, not unlimited. The
  database-backed capacity fixture covered 200 customers, 200 vendors, 220 invoices,
  200 bills, 200 inventory products, 2,440 journal lines, and a 1,000-row bank import.
- CSV/XLSX migration uploads are limited to 5 MiB and 20,000 data rows. An XLSX archive
  is additionally limited to 1,000 entries, 5 MiB per expanded entry, 20 MiB total
  expanded data, and a 100:1 per-entry expansion ratio; the first non-empty data sheet
  is selected. Macros/OLE embeddings, external relationships, encrypted entries, and
  malformed archives are rejected. Formula cells are never calculated: a missing
  cached value is rejected, while a cached result is imported with a review warning.
- Invoice entry accepts at most 500 lines. Stored invoice PDF artifacts are limited to
  100 pages. There is no separately certified PDF byte-size ceiling.
- General-ledger detail is limited to the first 5,000 rows per request. Project work-item
  lists return at most 500 records, and calendar aggregation accepts at most 1,000 rows
  from each source before the user must narrow the date/filter range.
- Project capture files are limited to 10 MiB; company logos to 2 MiB and 2,048 by 2,048
  pixels; remotely inspected catalog images to 5 MiB, 4,096 pixels on either axis, and
  16,777,216 pixels total.
- Uploads enforce allowed types, byte/file signatures, active-content and archive-
  structure rules, checksums, and size limits. The local public beta does not include a
  real malware-scanning provider. Scan every file with trusted security software before
  uploading it; a stored `CLEAN` adapter status is not a malware-scan certification.
- Organization export v3 includes every portable organization model in the current
  Prisma schema with provider/auth secrets and internal storage keys removed. Security-
  only token/access locator tables are excluded. It is readable JSON, not a tested one-click
  ClearLedger restore. Organization closure requires an unexpired COMPLETE v3 export
  with attachments and revalidates the stored archive checksum.

## Package and operations

- The beta PowerShell launcher is not Authenticode-signed and may show a Windows
  downloaded-file warning. Verify the archive SHA-256 published on the official site;
  do not bypass organization security policy.
- A verified archive is assembled only after all 77 migrations, the complete unit and
  PostgreSQL integration harnesses, the five-project browser workflow, release/security/
  performance contracts, source reduction, and the production dependency audit pass.
  These are engineering tests, not an audit, penetration test, tax opinion, or
  professional certification.
- Fresh compose installation and health were exercised for an earlier candidate image.
  Repeat current-image restart, backup/restore, update/rollback, and uninstall drills on
  a disposable installation before treating a new archive as the public download.
- Exact archive SHA-256, SBOM SHA-256, runtime image ID/digest, image-tar checksum, and
  creation time do not exist until final assembly. Use only the generated manifest,
  `SHA256SUMS.txt`, and sibling `.zip.sha256` for those values; do not copy an earlier
  candidate's identifiers.
- The runtime inspection checks ClearLedger TypeScript, TSX, source maps, and compiler
  artifacts. Browser JavaScript must remain downloadable for the web application to
  work, and a local container cannot be made impossible for a determined tester to
  inspect.

## Reporting a defect

Use the in-product bug-report link. Include the ClearLedger version, browser/host
version, exact steps, expected and actual result, and a request ID where shown. Remove
names, emails, addresses, account numbers, tax identifiers, access tokens, invoices,
receipts, screenshots of private data, and provider secrets before submitting.

If a result could affect filings, payments, payroll, inventory valuation, customer
balances, supplier balances, or financial statements, stop the affected workflow,
preserve the evidence, export the organization, and have the result reviewed before
continuing.
