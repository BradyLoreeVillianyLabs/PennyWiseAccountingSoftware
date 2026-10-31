# Model takeover — 2026-09-11

## Start here

Latest checkpoint (2026-09-15): C1 implementation is complete for the current
release candidate. Read `docs/status/PENNYWISE_FEATURE_AUDIT_2026-09-15.md` and
`docs/status/C1_PROGRESS_2026-09-15.md` before changing it. The complete program
remains unfinished where the audit lists provider-gated or future work;
0.14.0.20 is the frozen X3 candidate. The latest C1 slot-07 installer is prepared
at `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.22`; its exact
transfer instructions and hash are in `START-HERE.txt` and the feature audit.

Work only in `C:\Users\EmceeHax\Desktop\clearledger-src`. The session's default
working directory is an unrelated stale release tree. Pass the source root
explicitly to terminal commands. This source tree has no git metadata.

The owner requested: correct missing pieces in Claude's product-gap pack,
assess conflicts with current implementation, and set up the build. The latest
instruction is to prepare this handoff for another model. Resume by finishing
the small setup reconciliation items below, then execute Wave 0 / X4 Part A.
Authorization is recorded in `docs/status/CURRENT_PHASE.md`; do not ask again
merely because the external pack still contains draft authorization wording.

Read in order:

1. `AGENTS.md`, `CODEX_MASTER_PROMPT.md`, `docs/tasks/TASK_EXECUTION_STANDARD.md`.
2. `docs/status/CURRENT_PHASE.md` and `docs/DECISIONS_AND_OPEN_QUESTIONS.md`.
3. This folder's `RECONCILIATION-2026-09-11.md`, `HANDOFF-BUILD-PLAN.md`,
   `PASTE-TO-CODEX.md`, and `X4-inclusive-ui-quality-bar.md`.
4. `docs/status/SECOND_BETA_PROGRESS_2026-09-09.md` and
   `docs/tasks/PROVIDER_INTEGRATIONS_HANDOFF_2026-09-08.md` for existing B2 evidence.

## Constraints and collaboration

- The owner later authorized a new install candidate after source verification.
  Installer 0.14.0.15 and its USB transfer folder remain frozen; the separate
  0.14.0.16 participant-03 candidate is at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.16`.
- I9 online payments for local installs is now implemented and reported in
  `docs/status/I9_ONLINE_PAYMENTS_LOCAL_INSTALLS_REPORT_2026-09-12.md`. A separate
  participant-04 installer is prepared at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.17`; it is ready for
  supervised transfer testing, not clean-machine-accepted. X1 participant-05 is
  now packaged as `0.14.0.18` at
  `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.18`; use its
  `START-HERE.txt` and the X1 install-candidate report for transfer details.
- Preserve other agents' work. Serialize edits to the large `apps/web/app.js`.
  Parallel read-only/API investigation is fine if files do not overlap.
- Use apply_patch for edits, preserve LF, and keep progress updates meaningful.
- Do not read `.env` or put secrets in reports. `.env.example` is public fixture
  configuration and can be inspected. No signup is needed for local emulators.
- Use disposable databases and the repository test isolation guards. Never reset
  the beta database or an unknown/shared database.
- PowerShell 5 does not support `&&` in commands. Run separate commands and
  inspect exit codes; a final assignment can mask a failing shell command.
- Do not infer external acceptance from SDK fixtures or emulator success.

## Continuation checkpoint — 2026-09-11

The owner-authorized continuation has completed I1 through I7. I1 invoicing-only
first run, I2 composer and Finalize, I3 payment instructions and manual
recording, I5 invoice/customer corrections, I4 own-email-app
preparation/history/resend wiring, I6 local background automation, and I7
recurring invoice materialization are
implemented and documented under `docs/status/`. Fresh disposable browser and
database runs, 124-migration deployment, the release accessibility/performance
contracts, API/unit and integration suites, typecheck, lint, format, research,
and workspace build passed. The frozen 0.14.0.15 installer and transfer folder
remain unchanged.

I8 overdue follow-up and statements are implemented locally and documented in
`docs/status/I8_OVERDUE_FOLLOW_UP_AND_STATEMENTS_REPORT_2026-09-11.md`. The isolated
I8, Phase 3, Phase 12, and Books Health database checks pass; the full-suite rerun
was interrupted by a transient disposable PostgreSQL outage. The real mailbox and
clean-machine gates remain pending. I4 provider-enabled tasks remain gated by D-01, verified
SMTP credentials, and external provider evidence; do not treat local SMTP or
browser-provider fixtures as real delivery or production acceptance.

## Completed in setup

- Imported all 41 pack files, including two evidence files, from
  `C:\Users\EmceeHax\Desktop\ClearLedger-release-stale-20260901T213018Z-1-001\codex-product-gap-pack`
  into this folder. The external originals were not changed.
- Added the Product-gap setup/Wave 0 entry to CURRENT_PHASE.md and recorded
  ordering and existing accounting-policy precedence in the decision document.
- Added RECONCILIATION-2026-09-11.md. It lists conflicts and the known limitations
  of the newly implemented B2 checkout-expiry worker.
- Corrected the authoritative plan: current Windows browser runner is preferred;
  web edits are sequential; I6 owns scheduling and I9 owns durable own-account
  payment links; retry delivery but enforce one accounting effect; do not report
  successful placeholder jobs. Recovery must gate dependent payment readiness.
- Clarified X4: retain all axe rules and compare explicit existing violation
  fingerprints; lab timing is not population p75 INP; human usability/assistive
  technology acceptance is not fabricated and is distinct from Part A tooling.
- Commented out `PAYPAL_MODE=test` in `.env.example`: the nonempty default armed
  startup's incomplete-configuration gate while its required keys were blank.
  This is a configuration-template correction; fresh startup was not rerun yet.
- Made `evidence/route-diff.mjs` resolve the repo relative to its own path and
  print results without overwriting its historical evidence file. It ran and
  reported 486 routes, 136 unreferenced, 276 web references. Regex route coverage
  is a lower-bound heuristic, not proof that every listed route needs a button.

## Small setup follow-ups

1. Original pack legal/provider claims were imported, not independently checked
   this turn. D-05 remains open; CAD-base and unresolved deposit tax decisions
   in the existing decision document override proposed pack defaults.
2. Update the reconciliation report's validation results and changed-file list
   to include the evidence script and this handoff. Add this handoff to the
   local README if helpful.
3. Preserve a recoverable source snapshot before substantial application edits.
   No backup or git initialization was performed during setup.

## Validation at takeover

- Setup `pnpm lint`: passed (terminal session 34234 exited 0).
- Setup `pnpm test:research`: passed, 21 modules.
- Initial setup format check flagged I2; a subsequent targeted Prettier run
  formatted that file. Final repository format:check passed (session 67128,
  exit 0). This handoff also passed targeted formatting. No pending processes
  from this setup need collecting.
- Route evidence script ran successfully after the portability/read-only fix.
- Full application suites were not rerun for this documentation/template setup.
  Prior B2 evidence below must not be relabelled a fresh Wave 0 baseline.

## B2 state inherited from earlier work

Prior B2 checkpoint: 335 root-suite tests passed; 44 integration files / 247
tests passed in 323.96 seconds with 115 migrations. Formatting, lint, typecheck,
Prisma generation/validation, research check and workspace build passed then.
Targeted company-management/contextual-creation Chromium E2E passed earlier.

Existing implementations include PayPal async raw-body webhook verification,
explicit POST capture, provider-matched refunds, payment connection network
calls outside tenant transactions, two synchronized Prisma client generators,
SMTP tested through a real local TLS server, and contextual add flows that
preserve drafts. Reuse them and inspect current source before duplicating work.

The latest B2 addition is a foundation only:

- `apps/api/src/services/payment-checkout-expiry-worker.ts` and its unit test.
- `apps/api/src/payment-checkout-expiry-worker.integration.test.ts`.
- Optional `cancelHostedCheckout` in `payment-provider.ts`.
- Three cancellation lease/error fields and index in Prisma schema.
- Migration `20260911120000_payment_checkout_expiry_leases` and down.sql.

Worker unit tests: 4; integration tests: 2. It is not scheduled, no real adapter
implements the new cancellation operation, and Square remains disabled. Known
review issues: timestamp claims need fencing/renewal analysis for slow batches;
real database concurrent-claim and new-instance restart tests are still needed;
audit transitions; receipt-arrival expiry must not silently discard collected
money. No claim that an offline PC can enforce a provider deadline. Coordinate
these with I6/I9 instead of building a conflicting platform-only Square path.

## X1 checkpoint — 2026-09-12

X1 is implemented and documented in
`docs/status/X1_MONEY_DISPLAY_CURRENCY_VIEWS_REPORT_2026-09-12.md`. The exact money
formatter, ISO-coded invoice document output, plain-decimal visible-table exports,
currency/base-amount list columns, in-context CAD/USD enablement, foreign-product price
hint, and inline reviewed-rate path are source-complete. Fresh disposable Chromium
Playwright acceptance passed with release accessibility/performance contracts. A real
Bank of Canada network call remains intentionally unclaimed; the acceptance mocked the
suggestion response and exercised the real rate-snapshot write. The new
`docs/status/X1_INSTALL_CANDIDATE_REPORT_2026-09-12.md` records the 0.14.0.18
installer hash, package checks, and the exact integration-suite boundary.

## X2 checkpoint — 2026-09-12

X2 is implemented and documented in
`docs/status/X2_REPORT_EXPERIENCE_REPORT_2026-09-12.md`. The report shell, in-place
drill-down, server-persisted personal/shared saved views, accessible negative
amounts, dashboard amount privacy, and layout/performance evidence are source-
complete. Fresh 130-migration deployment, API/web tests, focused reporting
integration, Chromium acceptance, Reports/Home axe checks, and the controlled
performance gate passed. The full integration and clean-machine boundaries remain
explicit in the completion report.

The source state is packaged as participant-05 candidate `0.14.0.19` at
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.19`; use its executable,
sidecar, and `START-HERE.txt` only. It is supervised-transfer ready and remains
unverified on a clean Windows host.

## X3 checkpoint — 2026-09-13

X3 is implemented and documented in
`docs/status/X3_INLINE_CREATION_LINE_EDITOR_REPORT_2026-09-13.md`. The source
now supports same-screen customer, product/service, vendor, account, and project
creation; shared creatable pickers; multi-line invoice/estimate/bill editors;
description-only lines; and idempotent estimate/bill create propagation. Fresh
Chrome evidence passed for the two invoice paths and for project creation from
the time-entry form. The 0.14.0.19 X2 candidate remains frozen; 0.14.0.20 is
the new supervised-transfer candidate.

The X3 candidate is at
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.20`. Its exact three-file
transfer set is `PennyWise-Beta-05-Setup.exe`, its `.sha256` sidecar, and
`START-HERE.txt`; the installer is 273,123,768 bytes with SHA-256
`26a3d7a5850b144802123b13811018cb20cf4f6b408e21409ce1de53af8f36fe`.
Authenticode and `signtool verify /pa` passed for the QA certificate. This is
supervised-transfer evidence only; a clean Windows host run remains unverified.

The release performance contract uses a bounded 1.215 MB X3 asset budget after
measuring the built client at 1,210,139 bytes. Tax-code creation remains a
structured setup-form fallback. Clean Windows, human assistive-technology,
provider, and full-suite acceptance gates remain open as recorded in the report.

Next work resumes after X3 at the next authorized product prompt. Reuse the
current runner, browser runner, and fresh disposable databases. Do not repeat
Wave 0 setup or the completed I1 through I9, X1, X2, and X3 source work; inspect
current source first and preserve the frozen installer boundary. The full
integration suite has an explicit 30-second hook timeout. After Docker was
restarted and a fresh disposable database was created, the current rerun passed
all 48 files and 256 tests; retain the earlier contention result only as
historical diagnostic evidence.

Stop at the per-prompt completion report. Record exact files, tests and unrun
human acceptance. Later feature prompts follow their dependencies and the
owner's review checkpoints. Do not replace the `0.14.0.17` or `0.14.0.18`
candidate in place; build a new versioned candidate if source changes require
repackaging.

The latest C1 slot-07 candidate `0.14.0.22` was subsequently built from the
verified source state. Its transfer folder is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.22`; the installer is
273,179,232 bytes with SHA-256
`5655ef57a356d418c255736f604928948cb7d1a382c2e13becfccadc8e5c5079` and valid
QA Authenticode. Use only the executable, matching sidecar, and `START-HERE.txt`.
It is ready for supervised transfer testing, not clean-machine accepted. The
prior 0.14.0.21 folder remains unchanged.
