# Current Project Phase

## Completed

- Phase 0/1: repository foundation and ledger core
- Phase 1 closeout/remediation: treated as complete after owner approval of the final remediation report
- Phase 2: production identity, membership lifecycle, centralized authorization, and PostgreSQL RLS
- Phase 3: company setup and accounting configuration
- Phase 4 implementation and required verification: customers, products, invoices, credit notes, and receivables
- Phase 5 implementation and required verification: invoice templates, PDFs, email delivery, public viewing, and attachments
- Phase 6 implementation and required verification: connected payment accounts, hosted checkout, webhooks, allocations, manual payments, refunds, disputes, and receipts
- Phase 7 implementation and required verification: vendors, bills, immediate expenses, bill payments, vendor credits, secure attachments, and accounts payable
- Phase 8 implementation and required verification: bank/card accounts, CSV and
  OFX/QFX imports, duplicate review, matching, categorization, transfers, and
  statement reconciliation
- Phase 9 implementation and required verification: perpetual weighted-average
  inventory, locations, receipts, sales depletion, returns, adjustments,
  transfers, valuation, low-stock reporting, and database invariants
- Phase 10 implementation and required verification: financial and operational
  reports, reconciliations, CSV exports, printable report workspace, and owner
  dashboard
- Phase 11 implementation and required verification: accountant workspace,
  controlled manual journals, correction guidance, period close and reopen,
  deterministic review queues, source traceability, year-end period creation,
  and audit exploration
- Phase 12 implementation and required verification: staged data migration,
  structured imports, complete organization export, and closure/retention
  portability controls
- Phase 13 implementation and required verification: security, privacy,
  resilience, and production-hardening controls
- Phase 14 engineering implementation and required automated verification:
  release-candidate browser matrix, PostgreSQL capacity profile, accessibility,
  migration/recovery drills, and release hygiene
- Phase 15 engineering implementation: fail-closed production configuration,
  readiness evidence, and thresholded privacy-safe product event storage
- Phase 16 engineering implementation: exact CAD presentation boundary,
  activation checklist, help/support diagnostics, and consent-aware product
  learning
- Provider-independent advanced-workflow safety increment: four editable
  audience-profile presets, one-time account-preset seeding, exact purchase
  approval thresholds, classified non-posting deposits, estimate-snapshot
  progress plans, a tenant-scoped fixed-asset register with deterministic
  non-posting book-depreciation previews, and an installable data-safe PWA
  shell. See the
  [accounting workflow configuration decisions](../tasks/customer-expected-features/ACCOUNTING_WORKFLOW_CONFIGURATION_DECISIONS.md).
- QuickBooks-comparable, better six-phase roadmap completed and release-verified
  on 2026-08-09: decisive Home, compressed bookkeeping, spreadsheet-style
  workspaces, accountant control plane, explainable/privacy-safe Books Health,
  migration, backup/restore, and production-trust gates. See
  [the cumulative roadmap completion report](QUICKBOOKS_BETTER_ROADMAP_COMPLETION_REPORT_2026-08-09.md).
- Phase D5 engineering implementation and local automated verification: shipping
  labels on operator-owned carrier accounts, neutral carrier adapters, fixture
  recovery paths, customs refusal, browser label retrieval, shipment-linked
  expense and inventory evidence. See
  [the D5 shipping-labels report](D5_SHIPPING_LABELS_REPORT_2026-09-02.md).
- Phase D6 engineering runbook, evidence ledger, and local verification recorded;
  real-store, clean-machine, physical-device, and non-developer go-live acceptance
  remain evidence-gated. See
  [the D6 go-live drill report](D6_GO_LIVE_DRILL_REPORT_2026-09-02.md).
- H1 fulfilment operator UI engineering implementation and local automated
  verification completed on 2026-09-05: the reviewed-order workspace now drives
  draft conversion, explicit invoice posting, picking, shipment quote/purchase/
  void, short-pick handling, and derived progression. See the
  [H1 fulfilment operator UI report](H1_FULFILMENT_OPERATOR_UI_REPORT_2026-09-05.md).
- H6 first-run backup-destination engineering implementation and versioned QA
  candidate preparation completed on 2026-09-06. Same-volume choices now recover
  to backup deferral, same-disk volumes are described truthfully, and `.5` was the
  initial H2 acceptance candidate. See the
  [H6 first-run backup-destination report](H6_FIRST_RUN_BACKUP_DESTINATION_REPORT_2026-09-06.md).
- H7 packaged PostgreSQL first-run repair completed on 2026-09-06. The verified
  local PostgreSQL runtime resolves the MSIX grandchild-process denial, and the
  `.9` candidate reaches HTTP 200 API and web health on this build machine.
  See the [H7 packaged database-init report](H7_PACKAGED_DATABASE_INIT_ACCESS_DENIED_REPORT_2026-09-06.md).
- Product-gap I1 invoicing-only first-run completed on 2026-09-11. A new owner can
  choose the minimal workspace, persist Canadian business and invoice defaults,
  create customers with race-safe automatic numbers, and create an invoice draft
  without leaving the composer. The built first-run flow passes on a fresh database;
  the existing frozen installer remains unchanged. See the
  [I1 invoicing-only report](I1_INVOICING_ONLY_REPORT_2026-09-11.md).
- Product-gap I2 invoice composer and Finalize completed on 2026-09-11. The one-screen
  composer now supports versioned autosave, editable terms, authoritative server
  totals, one-step idempotent Finalize, journal-derived books impact, customer
  document language, and GST/HST/QST registration output. The existing frozen
  installer remains unchanged. See the
  [I2 invoice composer report](I2_INVOICE_COMPOSER_REPORT_2026-09-11.md) and
  [Finalize ADR](../adr/007-i2-invoice-finalize.md).
- Product-gap I2 composer usability and document presentation follow-up completed
  on 2026-09-15. Essentials-first invoice and estimate entry, short estimate
  numbering, UUID-free draft presentation, controlled customer-facing rich text,
  print-safe template variations, quick template picks, and optional exact
  preview are implemented and locally verified. These changes require the new
  versioned installer candidate; the previously tested 0.14.0.22 package remains
  frozen. See the [I2 UI and release report](I2_INVOICE_COMPOSER_UI_AND_RELEASE_REPORT_2026-09-15.md).
- Product-gap I3 payment instructions and recording completed on 2026-09-11.
  Structured offline payment methods, encrypted and masked EFT settings,
  per-invoice method selection, immutable “How to pay” document snapshots, and
  finalized-invoice manual payment recording are implemented and browser-verified
  on a fresh disposable database. The existing frozen installer remains
  unchanged. See the
  [I3 payment instructions report](I3_PAYMENT_INSTRUCTIONS_REPORT_2026-09-11.md).

- Product-gap I5 invoice and customer corrections completed on 2026-09-11. The
  Sales workspace now supports versioned draft correction, evidence attachments
  before issue, invoice detail, unpaid void/reversal, full or selected-amount
  credit notes, customer edit/archive guards, balance and statement activity, and
  permission-aware controls. A fresh disposable browser acceptance flow passed,
  including partial payment followed by a selected credit to zero balance. The
  existing frozen installer remains unchanged. See the
  [I5 invoice and customer corrections report](I5_INVOICE_CUSTOMER_CORRECTIONS_REPORT_2026-09-11.md).

- Product-gap I4 local invoice delivery completed on 2026-09-11. Posted invoices
  now support customer-prefilled own-email-app preparation, multiple recipients,
  explicit manual-send recording, truthful MANUAL delivery history, and resend
  dialog wiring. The beta provider-email kill switch and external SMTP/provider
  gates remain unchanged. A fresh disposable browser flow, 123 migrations,
  API/unit suite, integration suite, release accessibility/performance contracts,
  typecheck, lint, format, research check, and workspace build passed. The
  existing frozen installer remains unchanged. See the
  [I4 invoice delivery report](I4_INVOICE_DELIVERY_REPORT_2026-09-11.md).

- Product-gap I6 background job runner completed on 2026-09-11. The API now
  starts a lease-safe, database-backed local runner with startup catch-up,
  bounded retries, run/dead-letter records, pause and Run now controls, and
  graceful shutdown lease release. Payment webhooks, receipt and document
  delivery retries, outbound webhooks, payroll due drafts, and applicable
  checkout expiry are scheduled; recurring invoices (I7) and reminders (I8)
  remain visibly unavailable reservations. A disposable 124-migration database,
  focused runner concurrency tests, the full integration suite, all package
  tests, build, typecheck, lint, format, research, and web verification passed.
  The current RLS model uses the active owner membership as the automation
  access surrogate; no separate null/system actor mode is claimed. The frozen
  0.14.0.15 installer remains unchanged. See the
  [I6 background job runner report](I6_BACKGROUND_JOB_RUNNER_REPORT_2026-09-11.md)
  and [automation runner ADR](../adr/008-background-automation-runner.md).

- Product-gap I7 recurring invoices completed on 2026-09-11. Due invoice
  occurrences now materialize through the I6 runner with unique occurrence and
  invoice identities, default draft mode, explicit finalize/send modes,
  missed-occurrence policy, schedule history, next-date previews, composer-based
  template capture, and visible FX/period/email blockers. A disposable
  126-migration integration run passed, including concurrent Run now calls and
  SEND-mode fallback when email is unavailable; the full API integration suite
  also passed with 46 files and 253 tests. The frozen 0.14.0.15 installer
  remains unchanged. See the
  [I7 recurring invoice report](I7_RECURRING_INVOICES_REPORT_2026-09-11.md) and
  [recurring materialization ADR](../adr/009-recurring-invoice-materialization.md).
- Product-gap I8 overdue follow-up and statements implemented on 2026-09-11 and
  package-prepared on 2026-09-12. Manual and opt-in scheduled reminders, quiet hours,
  customer/invoice suppression, overdue review, activity/open-item statements,
  deterministic statement PDFs, truthful provider/manual communication records, and
  setup BigInt serialization are now covered in source. Late fees remain off by default
  and review-only pending owner/accountant approval. Unit/build/format/research gates
  passed; disposable evidence includes 127 migrations, I8 1/1, Phase 3 14/14, Phase 12
  21/21, and Books Health 2/2. The default full-suite rerun was not called green after
  a transient disposable PostgreSQL outage; see the exact boundary in the package report.
  The frozen 0.14.0.15 installer remains unchanged. New candidate:
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.16`, SHA-256
  `86e742f4e1c82b0f1682010ae785fcd724b418ee39026ba25c40292273a31914`. See the
  [I8 report](I8_OVERDUE_FOLLOW_UP_AND_STATEMENTS_REPORT_2026-09-11.md), [package
  report](I8_PACKAGE_CANDIDATE_REPORT_2026-09-12.md), and [receivables follow-up ADR](../adr/010-receivables-follow-up-statements.md).
- Product-gap I9 online payments for local installs implemented on 2026-09-12.
  Own-account Stripe and Square durable provider-hosted links, safe invoice/PDF
  links, polling settlement, exact accounting idempotency, and the local payment
  workspace are covered by SDK emulators, a disposable end-to-end vertical slice,
  and a focused browser smoke. The full integration suite remains explicitly
  ungreen because the local PostgreSQL test port intermittently became unreachable
  during two runs; affected suites pass in isolation. The frozen 0.14.0.15
  installer and existing 0.14.0.16 candidate remain unchanged. A separate
  0.14.0.17 participant-04 installer is prepared for supervised transfer testing.
  A new X1 participant-05 installer, version 0.14.0.18, is prepared at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.18`; see the
  [I9 report](I9_ONLINE_PAYMENTS_LOCAL_INSTALLS_REPORT_2026-09-12.md) and
  [X1 install-candidate report](X1_INSTALL_CANDIDATE_REPORT_2026-09-12.md).
- Product-gap X1 money display and currency views implemented on 2026-09-12. The
  exact formatter now separates app symbols, ISO-coded document output, and plain
  decimal exports; invoice/bill lists expose currency and base amounts; foreign
  selection can enable CAD/USD in context; and the invoice offers a preview-only
  Bank of Canada suggestion with explicit **Use this rate** snapshot creation.
  Fresh disposable Chromium Playwright acceptance passed, including the real rate
  snapshot POST and release accessibility/performance contracts. See the
  [X1 report](X1_MONEY_DISPLAY_CURRENCY_VIEWS_REPORT_2026-09-12.md).
- Product-gap X2 report-experience conventions are authorized for execution on
  2026-09-12 under the owner's build-all continuation. Scope is X2 only:
  report shell, in-place drill-down state, persisted saved views,
  negative-number accessibility, dashboard amount privacy, and
  layout-stability/performance evidence. M3 aging currency toggle remains
  hidden until M3; later increments remain planning artifacts; tax/provider/
  clean-machine gates are unchanged.
- Product-gap X2 is complete in source and documented in the
  [X2 completion report](X2_REPORT_EXPERIENCE_REPORT_2026-09-12.md). Fresh
  migration, API, web, reporting-integration, browser, accessibility, and
  performance gates passed within their recorded boundaries. A new versioned
  supervised-transfer installer is being prepared; X3 is next and the clean
  Windows acceptance gate remains open.
- X2 candidate `0.14.0.19` is prepared at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.19`. Its exact three-file
  transfer set, SHA-256, signature evidence, and install instructions are recorded
  in the X2 completion report. It is supervised-transfer ready, not clean-machine
  accepted; prior candidates remain frozen.
- Product-gap X3 inline creation and multi-line editor work is authorized for
  execution on 2026-09-12 under the owner's build-all continuation. Scope is the
  X3 prompt: creatable customer/item/tax/vendor/account pickers, in-place quick
  creation with draft preservation, invoice/estimate/bill line editing, explicit
  description-only tax/account behavior, totals, permissions, accessibility, and
  speed evidence. No new posting rule, provider gate, tax-policy decision, or
  clean-machine acceptance is waived.
- Product-gap X3 is complete in source and documented in the
  [X3 completion report](X3_INLINE_CREATION_LINE_EDITOR_REPORT_2026-09-13.md).
  Fresh disposable Chrome evidence passed for the invoice description-only,
  nested product/account, and project-context creation paths. Candidate
  `0.14.0.20` is prepared at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.20` with SHA-256
  `26a3d7a5850b144802123b13811018cb20cf4f6b408e21409ce1de53af8f36fe`;
  Authenticode and `signtool verify /pa` passed. Clean Windows acceptance,
  human assistive-technology checks, and external provider/tax gates remain
  open.
- Product-gap C1 e-Transfer reference matching is authorized for execution on
  2026-09-15 under the owner's continuing “build all” instruction. Scope is
  invoice payment references, synthetic local statement parser profiles,
  explainable suggestions, explicit customer-payer alias capture, and an
  idempotent one-click human confirmation path. No bank-feed provider,
  e-Transfer initiation, auto-posting, live banking credential, or
  clean-machine acceptance is authorized or implied.
- Product-gap C1 is complete in source for the current release candidate on
  2026-09-15. Durable invoice references, synthetic Canadian import profiles,
  explainable suggestions, tenant-scoped payer aliases, atomic idempotent
  payment/match confirmation, web controls, and focused database acceptance are
  recorded in the [feature audit](PENNYWISE_FEATURE_AUDIT_2026-09-15.md).
- Product-gap C1 candidate `0.14.0.21` was packaged on 2026-09-15 at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.21` as supervised
  beta slot 06. Its installer is 273,191,056 bytes with SHA-256
  `968ad831874462d12b16406c1034dbcbf247f021e6eec0a2352653396c640b3c`, and
  Authenticode validation passed for `PennyWise Accounting QA`. The frozen
  0.14.0.20 candidate was not changed; clean-machine acceptance remains open.
- Product-gap C1 candidate `0.14.0.22` supersedes 0.14.0.21 as the latest
  supervised beta slot 07. It is at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.22`; the installer is
  273,179,232 bytes with SHA-256
  `5655ef57a356d418c255736f604928948cb7d1a382c2e13becfccadc8e5c5079`, and
  Authenticode plus `signtool verify /pa` passed for `PennyWise Accounting QA`.
  The frozen 0.14.0.20 candidate and prior 0.14.0.21 folder were not changed;
  clean-machine acceptance remains open.

## Active Phase

- UI v2 declutter program authorized by the owner on 2026-10-31: phase **U0 foundations** only
  (module split with zero behaviour change). See `docs/pennywise/declutter/03_REVISION_PLAN.md` and
  `docs/tasks/ui-v2/U0-foundations.md`. Later U phases need separate authorization. No changes to
  `packages/accounting-core`, `packages/db`, or posting code are authorized by this entry.

- Dependency maintenance authorized by the owner on 2026-10-31: the `deps` Wave 0 stream in
  issue #35 may update package manifests, `pnpm-lock.yaml`, and `pnpm.overrides` to resolve
  dependency vulnerabilities that block CI. No application, UI, schema, migration, or accounting
  behavior changes are authorized by this entry.
- **Full product-gap build continuation (owner authorized 2026-09-11).**
  The owner instructed "build all" after the Wave 0 handoff. Execute the
  reconciled product-gap program in dependency order, recording each increment's
  results and continuing without a new approval between engineering increments.
  I1 through I9 are now recorded as locally implemented; I9's disposable vertical
  slice passes, and the fresh disposable full integration rerun passed 48/48 files
  and 256/256 tests on 2026-09-15. External mailbox/provider/clean-machine gates
  remain explicit follow-up work. Continue with
  later prompts only after those results are reviewed, preserving the I6/I7/I8/I9
  runner and provider boundaries.
  X1 is complete in source and verified locally, and its 0.14.0.18 installer
  candidate is prepared for supervised transfer testing. X2 is the next
  dependency-ordered source increment; no external provider/accounting decision is
  implied by X1. The full integration suite remains recorded with its exact
  contention boundary in the X1 install-candidate report.
  X2 is complete and its report records the exact browser and performance evidence;
  X3 is now complete in source and has a separately versioned supervised-transfer
  candidate recorded above. This supersedes
  the pack's one-prompt stop wording. Independent agent work is
  authorized; shared web edits remain serialized. Existing accounting decisions,
  unresolved D-05/deposit-tax choices, and external acceptance gates still apply.
  Complete available work without silently inventing those decisions. Packaging was
  explicitly resumed for the separate 0.14.0.16 candidate and has since advanced
  through versioned supervised-transfer candidates, with the current C1 candidate
  recorded above. Installer 0.14.0.15 and its transfer folder remain frozen. Do not
  treat any new candidate as clean-machine accepted until the supervised host run is
  recorded.

- **Product-gap program setup and Wave 0 (owner authorized 2026-09-11).**
  The owner requested correction of the missing pack, assessment of conflicts,
  and setup of the build. The controlling index is
  `docs/tasks/product-gap-program/HANDOFF-BUILD-PLAN.md`, supplemented by
  `RECONCILIATION-2026-09-11.md` in that folder. Complete setup first; Wave 0
  (X4 Part A and baseline evidence) is the next implementation increment.
  Later prompts follow the dependency order and completion-report checkpoints.
  Serialize changes to the web client. B2 evidence and existing implementations
  must be reused; further Square wiring is coordinated with I6/I9 to avoid a
  circular dependency. Packaging remains on hold and 0.14.0.15 stays frozen.
  Section 4 engineering defaults apply subject to existing accounting decisions;
  D-05 remains unresolved. No human, provider, tax, legal, or deployment
  acceptance is inferred from local tests. No hosted service or non-loopback
  listener is authorized by this setup.

- **Second-beta product-gap implementation (owner authorized 2026-09-09).**
  The owner instructed Codex to fact-check Claude's work, repair confirmed
  defects, implement the provider/product gaps, use SDKs, API documentation,
  emulators and available sandboxes without requiring user signups, keep the
  documents current, and build the product. The controlling execution prompt is
  `docs/tasks/SECOND_BETA_IMPLEMENTATION_2026-09-09.md`; progress is recorded in
  `docs/status/SECOND_BETA_PROGRESS_2026-09-09.md`. Execute its increments in order
  and continue between them under this authorization. The existing H2 first-beta
  artifact remains frozen; second-beta packaging uses a new version. Emulated
  provider results are test evidence, never proof of real payments, bank access,
  mail delivery, government filing, or external-provider acceptance.

- Owner continuation: complete the no-terminal beta setup, create and retain all
  local issuer secrets, issue twenty offline participant installers, repair
  startup/dependency/recovery defects, and verify the actual installed build.
  Setup may install the embedded Microsoft runtime and trust its embedded QA
  certificate after normal Windows administrator consent. The build itself
  does not change certificate trust. Participant identities may be preissued to
  eliminate activation exchanges; offline issuance limits are not a global
  hardware-enforced installation counter. Default local recovery copies are
  permitted with truthful same-PC wording. No live provider credentials are
  generated or provider acceptance claimed by this authorization.

- **H2 — Installable package acceptance (resumed 2026-09-06; current candidate
  updated 2026-09-08).** Defined in
  `docs/tasks/destry-deployment/H2-installable-package-acceptance.md`. The
  controlling supervised-beta artifact is the direct Inno Setup participant-02
  installer in `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`, not
  the earlier MSIX handoff. Its signed setup file is
  `PennyWise-Beta-02-Setup.exe`, SHA-256
  `7f0d0a6ae0c17ab1092dfd5db99ed3558c3b9be76d0b49ef191b3f9b88b84211`; see the
  [current direct beta candidate report](H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md).
  `.4` and `.5` remain frozen historical artifacts, `.6`–`.8` are failed
  internal candidates, `.9` resolved H7's MSIX first-run boundary, and `.13` is
  a superseded MSIX setup candidate. The exact 0.14.0.15 staged payload has
  passed isolated activation, database initialization, migration, API/web
  health, verified backup, task registration, and controlled shutdown checks.
  The owner has since reported successful fresh Windows 11 install/first launch,
  reboot continuity, and installation on a second independent Windows system
  from the removable-drive transfer folder; see the [H2 clean-install field
  report](H2_CLEAN_INSTALL_FIELD_REPORT_2026-09-08.md).
  The remaining update, backup/restore (currently deferred), interruption,
  second-launch, and uninstall evidence gates remain open and must be recorded
  individually before H2 closes.
  H2 also owns the local scheduled-backup XML and lifecycle-harness remediation
  recorded in the [H2 local remediation report](H2_PACKAGE_LOCAL_REMEDIATION_REPORT_2026-09-06.md).
  On 2026-09-06 the owner additionally authorized a narrow BETA_20 package
  boundary: offline, Ed25519-signed, package-provisioned activation files for no
  more than twenty operationally issued beta slots, with no user credentials,
  reusable codes, or issuer private key embedded in the package. The current
  offline route is not a hardware-enforced machine cap: slot 02 has now worked
  on two systems. This does not waive any H2
  clean-machine, signing, recovery, or Store gate. No provider, tax,
  Store-signing, or app-store gate is waived. The 0.14.0.15 participant-02
  transfer folder is frozen as the first-beta acceptance candidate. Claude's
  pending product-gap work belongs in a later second-beta version; an update for
  this same participant must retain slot-02 activation and installation identity,
  while a different fresh tester should be assigned an unused slot for
  operational tracking rather than relying on technical copy prevention.

## Historical H1 Authorization

- **H1 - Fulfilment operator UI (authorized 2026-09-05).** Defined in
  `docs/tasks/destry-deployment/H1-fulfilment-operator-ui.md`. The owner
  authorized H1 after the D6 engineering report. This authorization was scoped
  to the already-landed fulfilment workspace's remaining shipment
  create/quote/purchase/void flow, short-pick handling, derived order
  progression, and the commerce/shipping research interaction contract. It
  authorized no new API, schema, migration, live-provider, tax, Store, or
  production gate. H1 is complete; see the H1 completion report above.

## Historical D6 Authorization

- **Phase D6 — Destry Workwear go-live drill (authorized 2026-09-02).**
  Defined in `docs/tasks/destry-deployment/D6-go-live-drill.md`.
  The owner authorized D6 after the D5 engineering report. The D6 engineering
  report is recorded and its remaining acceptance gates are owner-operated; D1-D5
  completion reports remain the controlling record for their local
  engineering evidence and open external gates. This authorization is scoped to
  the disposable-installation go-live drill, store-preparation and migration
  runbook, backup/restore and lifecycle drill harnesses, end-to-end evidence
  recording, and human-acceptance runbook. It waives no live-store, provider,
  tax, evidence, physical-device, clean-machine, signing, accessibility, or
  app-store gate.

## Historical D5 Authorization

- **Phase D5 — Shipping labels on operator-owned carrier accounts (authorized 2026-09-02).**
  Defined in `docs/tasks/destry-deployment/D5-shipping-labels.md`.
  The owner authorized D5 after the D4 engineering report and authorizes the
  Destry Workwear deployment phases one at a time. D5 was the only active phase
  at that time; D6 had not yet been authorized. D1's
  clean-machine, reboot, upgrade, uninstall, Store, and real restore evidence
  gates remain open and are not represented as accepted by this D5 authorization.
  D2's repository format and historical rollback exceptions remain open. D3's
  external provider, tax, Store, rollback, and format gates remain open. D4's
  physical-printer evidence remains open. This authorization is scoped to
  operator-owned carrier credentials, neutral shipping adapters, shipment/label
  records, fixture verification, the Canada Post boundary, browser printing,
  customs refusal, and shipment-linked expense posting; it waives no provider,
  tax, evidence, signing, or app-store gate.

- No engineering work remains in the six-phase QuickBooks-comparable, better
  roadmap. Remaining launch work is evidence-gated operational/provider setup and
  production credentials. Human accessibility/UAT and product legal/privacy review
  were recorded as passed on 2026-08-19; provider-adapter legal/security acceptance
  remains separate for any live payment, payroll, banking, or filing integration.

- CRM and calendar foundation (2026-08-06): customer contacts, append-only
  relationship activity, client timelines, configurable non-posting meeting,
  appointment, follow-up, reminder, task, and milestone records, and linked
  read-only calendar metadata are implemented in the existing customer/project
  architecture. See `CRM_AND_CALENDAR.md` and
  `tasks/IMPLEMENT_CRM_AND_CLIENT_ACTIVITY_PROMPT_V3.md`.

- The owner-authorized accounting boundary was freshly verified and accepted
  under the owner test-evidence rule on 2026-08-02.
  Organization/demo bootstrap now preserves forced RLS without relying on an
  unavailable pre-membership SELECT policy, concurrent local identity creation
  is normalized-email safe, and the combined identity, demo, CAD/USD, commerce
  inbox, and connector acceptance set passes 35 database-backed tests. The full
  gate passes 113 package/application tests, 175 PostgreSQL integration tests,
  all builds, and the five-browser release flow. See
  `ACCOUNTING_BOUNDARY_2026-08-02.md`. The owner reports active professional-
  accountant advice plus product-workflow input from a former Intuit employee;
  this is not represented as Intuit endorsement or live-provider posting proof.

- The project owner authorized the CAD/USD implementation on 2026-07-30.
  Manual-rate CAD/USD accounting is implemented for invoices, bills, customer
  receipts, bill payments from base or tracked USD cash, realized FX,
  monetary-position evidence, closing-rate revaluation, and automatic
  next-period reversal. Customer documents retain their original currency;
  statements remain in the organization base currency.

- Migration `20260730015000_cad_usd_accounting_release` replaces the prior
  foreign-posting safety lock with a CAD/USD-only, organization-enabled gate.
  It adds exact source/base components, immutable position events, composite
  tenant foreign keys, and rollback refusal after foreign adoption. The
  operational QBWooBridge remains untouched.

- Native WooCommerce and Etsy adapters are implemented in fixture-backed
  shadow/review mode. They support multiple stores, encrypted credentials,
  resumable fixed-window synchronization, exact provider money, redacted raw
  evidence, verified webhook contracts, reconciliation issues, versioned
  mappings, and a dedicated web workspace. The first sync is bounded by the
  consented backfill range; later defaults use a five-minute overlap. Page-limit
  exhaustion returns a continuation for the same window and does not advance
  `lastSyncAt` until every requested scope is complete. Synchronization always
  reports zero accounting entries and cannot create invoices, payments,
  inventory movements, tax entries, journals, or bank deposits.

- Migration `20260801010000_native_commerce_connectors` adds multi-store
  identity, versioned mappings, short synchronization leases, webhook lookup
  controls, raw-payload fingerprints, normalized schema evidence, and narrow
  webhook RLS policies. WooCommerce polling requires only a core REST API read
  key; automatic webhook creation requires read/write. Etsy uses S256 PKCE with
  `shops_r transactions_r`, encrypted token refresh, and manual Webhook Portal
  setup. Buyer-email access is not requested. Saved customer, SKU, and tax
  mappings apply to polling and webhook normalization. Verified provider
  deliveries have a null system actor in audit history rather than inheriting
  the member who created the connector.

- Retained provider payloads remove buyer contact/address data, user and buyer
  identifiers, IP and user-agent values, customer notes, arbitrary metadata,
  order access keys, and secret-like fields that accounting normalization does
  not require. Exact product, tax, fee, payment, refund, settlement, and money
  evidence remains available for review.

- The settings workspace can now request a no-key, indicative Bank of Canada
  USD/CAD observation and prefill the existing manual rate form with exact
  provenance. The observation is never saved or posted until the user reviews
  and explicitly submits it. A provider-gated Plaid bank-feed adapter now also
  supports hosted consent, encrypted token storage, cursor-based manual sync,
  and review-only CAD/USD import. It is disabled in the controlled beta unless
  an approved Sandbox configuration is supplied; production activation, signed
  webhook/worker handling, and live provider acceptance remain gated. See
  `../CONNECTED_BANK_FEEDS.md`.

- Marketplace tax normalization now requires every observed WooCommerce/Etsy
  rate to map to an approved tax code and requires the operator to confirm
  `SELLER` or `MARKETPLACE` remittance responsibility. Missing or incomplete
  evidence stays blocking in the review inbox; it never turns into a tax
  journal, a return, or a filing. See
  `../NORTH_AMERICAN_TAX_AND_MARKETPLACE_REMITTANCE.md`.

- Live WooCommerce/Etsy acceptance evidence is gated until separately supplied
  test-store/app credentials are exercised against provider environments. Etsy
  Commercial Access remains an external gate for broad multi-seller
  distribution. Trusted LocalXpose deployments can expose provider webhooks
  through a separate webhook-only relay restricted to allowlisted delivery
  paths while the browser application stays behind Basic Authentication. Raw
  bodies still require provider signature verification; the relay does not
  expose organization APIs or static application assets. The controlled sharing
  launcher also requires a stable, high-entropy connector credential encryption
  secret of at least 32 characters. Foreign credit notes/refunds, foreign
  settlement reversals, direct foreign bank categorization, and foreign-bank
  transfers remain fail-closed pending linked correction/position-transfer
  models.

- The Switching Centre now persists an immutable source-system choice for
  QuickBooks Online, Xero, Wave, FreshBooks, Sage, Zoho Books, or other
  spreadsheet exports. Identical same-source uploads reuse the existing batch;
  identical content labelled as a different source is rejected with
  `IMPORT_SOURCE_MISMATCH`. Development and trusted-preview environments also
  offer a deterministic commerce sample that stages review evidence while
  creating zero accounting entries.

- Home now includes persistent Books Health guidance across commerce review and
  mappings, unreconciled bank activity, import completion and reconciliation
  variance, tax/settings readiness, and period-close blockers. It is a
  tenant-scoped `dashboard:read` projection only: every finding links to the
  matching workspace, creates zero accounting entries, and cannot acknowledge,
  reconcile, post, or close records. An empty automated result is explicitly
  not professional approval or live-provider validation.

- Home now opens on a compact, action-oriented dashboard rather than large explanatory
  cards. Six financial indicators, review exceptions, cash movement, Books Health, and
  frequent actions appear first; setup and help remain available in collapsed sections.
  The Switching Centre also presents source-specific export and reconciliation guidance
  before a user uploads data from QuickBooks Online, Xero, Wave, FreshBooks, Sage, Zoho
  Books, or a spreadsheet source.

- The native QuickBooks-workaround replacement increment is implemented in-place. The
  Accountant Workbench links the Switching Centre, evidence/AP review, WooCommerce/Etsy
  commerce review, and posted-ledger reports without a second subsystem. Capture reviews
  can be filtered by tenant-scoped review status, evidence type, and whether exactly one
  purchase draft is linked. These controls remain non-posting and preserve source evidence,
  authorization, idempotency, and audit boundaries. See
  `../tasks/NATIVE_QUICKBOOKS_WORKAROUND_REPLACEMENT_PROMPT_2026-08-06.md`.

- The former mandatory accountant-signature gate is removed. Production use of
  the released CAD/USD model is accepted when the exact accounting evidence
  passes and the organization owner confirms functional currency, rate sources,
  tax timing, foreign-cash FIFO, corrections, and close policy. Professional
  review is recommended and is currently being used as advisory input according
  to the owner. Live provider posting retains independent evidence gates.

## Historical audit state (superseded by the active CAD/USD implementation)

The bullets in this section preserve the dated 2026-07-29 audit result. They do
not describe the current posting boundary; the Active Phase above is the
controlling status.

- The 2026-07-29 independent MCFX post-implementation audit is complete with
  status FAIL. The former MCFX PASS reports did not satisfy their phase
  contracts or prerequisite chain. See
  `MCFX_POST_IMPLEMENTATION_AUDIT.md`.

- CAD remains the only supported posting boundary. Migration
  `20260730014000_mcf_review_safety` database-locks multi-currency off, rejects
  foreign journal lines, hardens composite tenant references and rollback
  safety, and protects commerce raw evidence. The API rejects foreign posting
  and FX revaluation, and the web controls are visibly locked.

- The review also repaired company-setup usability: business type is visibly
  required, setup errors are no longer overwritten by success notices, and the
  eight setup tabs retain the intended Business-to-Review order after saves and
  reloads. The complete repository check, 162-test integration suite,
  five-project browser matrix, destructive 67-migration rollback/redeploy,
  foreign-evidence rollback refusal, and Docker backup/restore drill pass on
  disposable databases. Production configuration remains externally gated.

- MCFX-00 must be redone. MCFX-01 is GATED because the required user-supplied
  `docs/approvals/MCFX_00_APPROVAL.md` is absent. MCFX-02 through MCFX-09,
  MCFX-13, MCFX-15, and MCFX-17 fail reviewed acceptance. MCFX-10 through
  MCFX-12, MCFX-14, and MCFX-16 remain GATED. MCFX-18 and MCFX-19 now have
  fixture-backed shadow implementations but retain live-provider evidence
  gates. Both MCFX-20 posting scopes and MCFX-21 production acceptance remain
  GATED. No live provider or marketplace credentials were invented, and the
  operational QBWooBridge remains untouched.

- Phase 22 is authorized and in progress: scoped API credentials, signed
  outbound webhooks, and the OAuth 2.1 authorization-code/PKCE installation
  foundation, including replay-safe client-secret rotation, are implemented and
  locally verified. The v1 OpenAPI contract and developer integration guide are
  published locally. Native WooCommerce and Etsy shadow adapters and their
  review workspace are implemented; public developer onboarding and live
  production provider evidence remain open. Phase 25 remains evidence-gated
  and has no native scaffolding.

- Phase 17–21 staged implementation authorized by the owner on 2026-07-25.
  Phase 15/16 engineering evidence remains recorded in
  `PHASE_15_COMPLETION_REPORT.md` and `PHASE_16_COMPLETION_REPORT.md`.
  Phase 17 local foundation now includes estimates, secure customer-facing
  links with expiry/revocation, versioned acceptance, draft conversion,
  recurring schedules, replay-safe invoice linkage, and idempotent estimate
  email queueing with secure-link payloads and retry state. Phase 20/21 local
  control-plane persistence now includes migration runs and commercial
  subscriptions/provider events. Phase 22 now includes organization-scoped,
  hashed, expiring API credentials with one-time secrets, scopes, rotation,
  revocation, audit/outbox events, and bearer authentication. The next Phase 22
  increment adds encrypted per-endpoint webhook secrets, versioned signed
  outbox delivery, FIFO ordering, bounded retries, dead-letter inspection,
  replay, endpoint disablement, and tenant-scoped lifecycle routes. This
  increment is implemented and verified locally. The following OAuth increment
  adds organization-owned client installations, exact redirect-URI validation,
  explicit consent, S256 PKCE authorization codes, hashed short-lived access
  tokens, refresh-token rotation, scope enforcement, RLS lookup policies,
  audit evidence, client revocation, and idempotent OAuth client-secret
  rotation. The OpenAPI document is versioned and served with a matching
  response header, and the supported surface, compatibility policy, scopes,
  pagination, idempotency, limits, and webhook expectations are documented.
  A provider-neutral connector runtime now has tenant-isolated multi-store
  installations, encrypted credential storage, consent, bounded backfill,
  health, mappings, sync leases, checkpoints, conflicts, verified webhook
  lookup, and redacted logs. Native WooCommerce and Etsy adapters stage exact,
  non-posting evidence into the commerce inbox. Developer onboarding, live
  provider reconciliation, and production external evidence remain open;
  legal/provider gates still apply to production acceptance.
  The owner authorized continuation through the remaining phases on 2026-07-26;
  execution continues in dependency order and does not bypass provider, tax,
  beta-evidence, or native-platform gates.
  Phase 18 local foundation now includes projects, approved time entries,
  mileage drafts, and human-reviewed capture records. Phase 19 requires an approved
  Canadian aggregation provider and legal review; Phase 21 requires approved
  plans, prices, terms, tax treatment, and a hosted billing provider. Those
  external gates remain required before production acceptance.
  The provider-independent Phase 19 planning increment now includes versioned
  weekly/monthly budgets, posted budget-versus-actual detail, source-labelled
  13-week cash forecasts, and explicit manual assumptions. The operations
  increment now includes non-posting purchase requests with tenant-scoped
  submit/approve/reject/cancel transitions. A positive approval threshold
  automatically approves only requests strictly below the threshold; zero or a
  request at/above a positive threshold requires an authorized approver.
  Provider-dependent bank feeds and later purchase-order receiving/matching
  remain open. Deposit/progress and fixed-asset journal posting, Canadian tax
  and CCA treatment, live bank/payroll/OCR providers, and native app-store
  packaging remain explicitly gated.

## Scope rule

The owner authorized continuation through the remaining phases on 2026-07-26.
Execution continues in dependency order and does not bypass provider, tax,
beta-evidence, or native-platform gates; this authorization extends the earlier
Phase 17–21 scope for continued work through Phases 22–25.

Prepared task files outside the authorized Phase 17–25 scope remain planning
artifacts. The 2026-07-25 authorization covered Phases 17–21, and the
2026-07-26 authorization extended continuation through Phases 22–25 without
waiving any external acceptance gate.
