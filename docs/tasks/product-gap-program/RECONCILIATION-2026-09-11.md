# Product-gap build setup and reconciliation

Setup completed under the owner's 2026-09-11 instruction to correct missing
pieces, assess conflicts, and set up the build. This is a setup report, not a
Wave 0 completion report. No installer was generated.

## Current source evidence

- Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`; no git metadata.
- Imported 41 source pack files, including the route evidence and its script.
  The original external pack is retained unchanged.
- Prior B2 run: 335 root tests and 247 integration tests across 44 files passed;
  115 migrations were applied to the isolated test database. Build, lint,
  typecheck, formatting, schema validation, and research checks passed at that
  checkpoint. These are prior evidence, not a newly run Wave 0 baseline.
- Contextual creation and company management have targeted Chromium evidence.
  Full browser-matrix acceptance is not established by those runs.
- SMTP has a real local TLS server test. Square remains disabled. A checkout
  expiry worker and lease migration exist but the worker is not scheduled.

## Conflicts resolved for execution

1. Missing pack and authorization: imported the pack into the source tree and
   recorded the owner's setup instruction in CURRENT_PHASE.md.
2. Windows runner guidance: prefer the current repository runner, which now
   handles Windows invocation, isolated ports, and database locks. The historical
   EINVAL issue is not evidence that the current runner fails.
3. Parallelism: serialize every prompt touching app.js, including I6's UI.
   Independent API investigation can proceed without concurrent web edits.
4. Payment dependencies: I6 supplies scheduling; I9 implements own-account
   adapters and durable invoice links using B2's shared-contract evidence.
   Completing a separate platform Square implementation is not a prerequisite.
5. Expiry: a sleeping or offline PC cannot guarantee provider cancellation at
   a deadline. Durable invoice links need their own lifecycle and reconciliation
   of late/excess receipts. Rejecting a verified receipt on arrival time alone
   can leave collected money unrecorded.
6. Job semantics: retry delivery as needed and guarantee one accounting effect;
   do not promise exactly one network attempt. Reserve future job identifiers
   without running success-reporting placeholders. Recovery controls readiness.
7. Accessibility: baseline specific existing violations while keeping all axe
   rules enabled. Fail new serious/critical violations. Human usability and
   assistive-technology acceptance remain separate from Part A automation.
   Lab interaction samples are not population p75 INP.
8. Decisions: D-05 is unresolved despite the pack's original broad readiness
   claim. Existing CAD-base and deposit-tax decisions outrank proposed defaults.
9. Fresh configuration: commented PAYPAL_MODE in .env.example; its nonempty
   default armed the startup configuration gate while required keys were blank.

## Work that must be addressed before enabling payments

The current expiry worker is foundation work, not a complete lifecycle guarantee.
Its batch claim uses timestamps; I6 must assess lease fencing and renewal for
slow provider calls and batches exceeding the lease. Restart tests must create a
new worker and exercise persisted state. SQL/RLS concurrency needs real database
tests; a fake client does not prove SKIP LOCKED behavior. Audit cancellation and
failure transitions. Verify provider outcomes before treating a cancellation
as final, and reconcile late successful payments. Do not expose Square until
these controls and SDK/emulator acceptance exist.

## Next build increment

The setup and Wave 0 work, I1 through I8 source implementation, are now complete.
The I6, I7, and I8 completion reports are
`docs/status/I6_BACKGROUND_JOB_RUNNER_REPORT_2026-09-11.md`,
`docs/status/I7_RECURRING_INVOICES_REPORT_2026-09-11.md`, and
`docs/status/I8_OVERDUE_FOLLOW_UP_AND_STATEMENTS_REPORT_2026-09-11.md`.
The disposable I8 database checks are complete; finish provider and clean-machine
acceptance before moving to I9. Preserve the frozen 0.14.0.15 installer. The separate
0.14.0.16 participant-03 candidate and its report are now the supervised install target.

## Changed files in this setup

- All 41 imported files under this directory (including evidence/); substantive
  instruction corrections are in HANDOFF-BUILD-PLAN.md, README.md, I6, I9, and X4.
- This reconciliation report.
- MODEL-TAKEOVER.md and evidence/route-diff.mjs (portable repository resolution;
  stdout only, preserving historical evidence).
- docs/status/CURRENT_PHASE.md.
- docs/status/I6_BACKGROUND_JOB_RUNNER_REPORT_2026-09-11.md.
- docs/DECISIONS_AND_OPEN_QUESTIONS.md.
- .env.example (optional PayPal mode default).

External legal/provider claims in the imported verification ledger retain their
original evidence grades; importing them is not independent re-verification.

## Setup verification and continuation

Setup format, lint and research checks passed; research covered 21 modules.
The route evidence script ran successfully (486 routes, 136 unreferenced,
276 web references; regex evidence is a heuristic). Full application suites
were not rerun in setup. A fresh baseline is being captured for implementation.

The owner subsequently instructed "build all" on 2026-09-11. CURRENT_PHASE.md
records continuation across engineering increments in dependency order. The
source snapshot at
`C:\Users\EmceeHax\Desktop\clearledger-source-snapshot-20260911-product-gap`
contains 983 non-generated source files; app.js was hash-compared successfully.
Dependencies, local environment files, generated payloads and signing material
are excluded. The tested installer remains frozen.
