# X2 Report Experience Conventions — Completion Report

Date: 2026-09-12  
Status: source-complete and locally verified  
Next candidate: versioned supervised-transfer installer after the source gates below

## Result

X2 is implemented for the existing report surfaces. Reports now share a consistent
shell for period presets, basis, comparison, currency context, zero-row handling,
save/CSV/Print actions, sticky headings, first-column context, and tabular numeric
alignment. Detail links open an in-place drill-down panel that preserves the report
state and table scroll position; closing the panel restores the report workspace.

Personal and permitted shared report views are persisted server-side, with owner,
default, sharing, update, and delete controls. Dashboard amount privacy is persisted
per user and organization, masking amounts without relying on color. Negative values
use parentheses visually and expose an explicit “negative” announcement to assistive
technology. The aging currency toggle remains hidden pending M3.

Dashboard privacy, report layout stability, and performance decisions are recorded in
`docs/pennywise/COMPETITIVE_UI_REFERENCE.md`,
`docs/COMPETITIVE_RESEARCH_MATRIX.md`, and
`docs/DECISIONS_AND_OPEN_QUESTIONS.md`.

## Evidence

- Prisma schema and migration: `ReportView` plus tenant/RLS policy in migration
  `20260912120000_report_saved_views`; fresh disposable databases applied all 130
  migrations successfully.
- API unit suite: 50 files, 280 tests passed.
- Focused reporting integration: `phase10-reporting.integration.test.ts`, 8/8
  passed against a fresh PostgreSQL test database.
- Web unit suite: 7/7 passed.
- Focused Chromium browser acceptance: 1 passed, 4 intentional non-Chromium skips.
  It covered report shell, in-place drill-down, saved-view persistence after reload,
  dashboard amount hiding, and release accessibility/performance contracts.
- Serious/critical axe violations: none on Reports or Home.
- Browser measurements: P&L 429 ms; General Ledger 348 ms with 77 rendered rows.
- Controlled API performance fixture: report p95 137 ms; the full performance gate
  passed, including release-candidate performance verification.
- Formatting, typecheck, lint, research checks, web build, and release asset checks
  passed before packaging.

## Boundaries

The complete integration suite remains not green from the earlier X1 run because 13
long-running tests lost reachability to the disposable PostgreSQL test port; the
focused reporting integration and fresh migrations pass. This is reported as a test
environment contention boundary, not relabeled as a product pass.

The clean Windows 10/11 machine install and supervised transfer run remain human
acceptance gates. The browser plugin was unavailable in this session, so Playwright
Chromium was used as the documented fallback. No provider, tax, Store-signing, or M3
aging decision is waived by X2.

## Handoff

Build a new versioned installer from this source state. Keep `0.14.0.15`,
`0.14.0.17`, and `0.14.0.18` unchanged. Transfer only the new installer's three
artifacts and record its hash; do not call it clean-machine accepted until the
supervised host run is recorded. X3 inline creation and line-editor work is next in
the dependency-ordered product-gap program.

## Install candidate

The X2 source state is packaged as participant-05 candidate `0.14.0.19` at
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.19`. The folder contains
exactly `PennyWise-Beta-05-Setup.exe`, its `.sha256` sidecar, and `START-HERE.txt`.
The installer is 273,119,888 bytes and has SHA-256
`984ebf71ab695e044d57c52a23886caff0bed07957df22e49a49040822a673bf`. Authenticode
and `signtool verify /pa` passed for `CN=PennyWise Accounting QA`. This is ready
for supervised transfer testing, not clean-machine accepted.
