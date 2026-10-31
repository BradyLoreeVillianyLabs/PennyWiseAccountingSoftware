# Codex prompt pack — product gaps, invoice-only client, multi-currency, differentiators

Generated 2026-09-11 from a **read-only** review. Nothing in the application source was
changed. Findings, evidence, and the reasoning behind each prompt are in
[`ASSESSMENT.md`](./ASSESSMENT.md). The raw API-versus-UI route comparison is in
[`evidence/route-diff-v2.txt`](./evidence/route-diff-v2.txt).

Competitor research and the panel's product decisions on currency views, reporting and
invoice workflow are in
[`DECISIONS-currency-reporting-workflow.md`](./DECISIONS-currency-reporting-workflow.md).
They produced prompts X1–X3.

A panel review later the same day re-checked the whole pack against primary sources and the
code, and corrected it. See
[`REVIEW-panel-critique-2026-09-11.md`](./REVIEW-panel-critique-2026-09-11.md) for every
verdict, its evidence, and the files it changed.

## Start here (build handoff)

1. **[`HANDOFF-BUILD-PLAN.md`](./HANDOFF-BUILD-PLAN.md)** covers:
   - what "ready" means;
   - owner steps;
   - authorization text;
   - decision defaults;
   - the build waves;
   - the Definition of Done.
2. **[`PASTE-TO-CODEX.md`](./PASTE-TO-CODEX.md)** has the kickoff text for each session.
3. **[`VERIFICATION-LEDGER.md`](./VERIFICATION-LEDGER.md)** grades every claim the prompts
   rely on.
4. **[`COMPETITOR-MATRIX.md`](./COMPETITOR-MATRIX.md)** gives competitor features and
   reviews, and a disposition for every PennyWise gap.
5. **[`MODEL-TAKEOVER.md`](./MODEL-TAKEOVER.md)** records source setup and the next
   implementation work. The owner's 2026-09-11 "build all" continuation is now
   recorded in CURRENT_PHASE.md; engineering increments continue in dependency
   order with written reports. External and accounting decision gates remain.

## Target tree

**Every prompt targets `C:\Users\EmceeHax\Desktop\clearledger-src`** (PennyWise / ClearLedger,
0.14.0 line, 127 Prisma migrations, 490 `/v1` route registrations). That tree has **no git
history**. Back it up, or run `git init` and commit first, so each prompt's diff can be reviewed.

## Authorization — read before pasting anything

`AGENTS.md` says a prepared task file is **not** authorization. The active program in
`docs/status/CURRENT_PHASE.md` is **B2 — second-beta product-gap implementation**
(`docs/tasks/SECOND_BETA_IMPLEMENTATION_2026-09-09.md`). For each prompt you want run,
record it as authorized in `CURRENT_PHASE.md`, the same way H1 and D1–D6 were authorized.
Also state whether it runs after B2 or alongside it.

These prompts deliberately **do not duplicate** B2's work:

| B2 increment                      | Prompts that build on it                                      |
| --------------------------------- | ------------------------------------------------------------- |
| B2-UX contextual "+ Add" creation | I1, I2 reuse it                                               |
| B2-2 shared payment contracts     | I9 reuses contract evidence; own-account Square belongs to I9 |
| B2-3 SMTP and Flinks              | I4 depends on it (SMTP)                                       |
| B2-4 payroll exports              | none; payroll UI gaps stay with B2-4                          |
| B2-5 receipt OCR                  | none                                                          |

## Decisions only the owner can make

Each of these blocks a prompt. Record your decision in
`docs/DECISIONS_AND_OPEN_QUESTIONS.md`:

1. **Email on installed beta builds (I4).** Email is currently disabled on every installed
   copy by design. I4 lets the owner turn it on after a verified SMTP test-send. This
   reverses a deliberate beta boundary.
2. **New "Just invoicing" profile, or reshape `SOLO_SERVICE` (I1).**
3. **Online payments for local installs (I9).** Choose between the business's own
   provider account (recommended for local installs) and the existing platform/Connect
   model, which needs a hosted relay.
4. **Late fees (I8).** Decide whether to offer them at all, and how they are booked. If
   yes, invoice terms must state an annual rate (Interest Act, s.4). Have the wording, and
   any provincial rules, checked before enabling them.
5. **Accounting treatment of foreign-currency credit notes and reversals (M1).** Take
   this to the accountant.
6. **Which currencies come next, and the rate source for non-CAD base companies (M4).**
7. **Whether multi-currency is included on every plan (decision D3).** This is a pricing
   decision. The panel recommends it, because plan-gating is a top complaint about Xero and
   Sage.
8. **Vendor registrations for mailbox sign-in (I4).** Before "Connect with Microsoft" or
   "Connect with Google" can be offered to other organizations, PennyWise needs:

   - Microsoft publisher verification;
   - Google's sensitive-scope verification for `gmail.send`.

   Without them, installed builds rely on SMTP app passwords (Gmail and others). Microsoft
   accounts would have no reliable send path: Microsoft is retiring password SMTP for both
   personal accounts and Microsoft 365. Its dates have moved; see `VERIFICATION-LEDGER.md`.

9. **Deposits accounting (P3).** The default is two types: security deposits and advance
   or milestone invoices. See `HANDOFF-BUILD-PLAN.md` §4, D-09.
10. **Phone access (P1) and a hosted relay (R1).** Both default to design-only. Nothing is
    exposed beyond the PC, and no hosted service is created, without your sign-off.
11. **French interface (P5).** It needs a professional translation review. Quebec's Charter
    requires software to be available in French when a French version exists.

All decisions, with their defaults, are listed in `HANDOFF-BUILD-PLAN.md` §4.

## Current execution status

I1 through I9 are implemented locally and have reports under `docs/status/`. I6
added the local database-backed runner, startup catch-up, leases, retries, run
history, dead-letter state, and Automations controls. I7 materializes idempotent
recurring invoice occurrences with explicit draft/finalize/send modes. I8 adds
manual and scheduled reminders, overdue review, and statement PDFs. The I8
disposable PostgreSQL checks now pass; real mailbox and clean-machine gates remain
pending. The `0.14.0.15` installer remains frozen. A separate `0.14.0.16`
participant-03 candidate is prepared, but no clean-machine package acceptance is
implied by these source changes. I9 adds own-account Stripe/Square durable links,
safe invoice/PDF payment links, polling settlement, and the local payment controls.
The I9 disposable vertical slice and focused browser/API evidence pass; the full
48-file integration suite remains ungreen because the local PostgreSQL test port
intermittently became unreachable during two runs. A separate `0.14.0.17`
participant-04 candidate is prepared for supervised transfer testing, and the
X1 `0.14.0.18` participant-05 candidate is now prepared at
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.18`. See
`docs/status/I9_ONLINE_PAYMENTS_LOCAL_INSTALLS_REPORT_2026-09-12.md` for the
evidence and transfer set.

X1 is now implemented locally and reported in
`docs/status/X1_MONEY_DISPLAY_CURRENCY_VIEWS_REPORT_2026-09-12.md`. Its disposable
Chromium flow covers in-context CAD/USD enablement, the mocked no-key rate suggestion,
the real rate-snapshot POST, and desktop/mobile screenshots. X1 is packaged as
the new 0.14.0.18 candidate; its hash and exact verification boundary are in
`docs/status/X1_INSTALL_CANDIDATE_REPORT_2026-09-12.md`. X2 is next, while
0.14.0.15 and 0.14.0.17 remain unchanged.

X2 is now implemented and reported in
`docs/status/X2_REPORT_EXPERIENCE_REPORT_2026-09-12.md`. It adds the report shell,
in-place drill-down, persisted personal/shared saved views, accessible negative
amounts, dashboard amount privacy, and layout/performance evidence. Fresh migration,
API, focused reporting integration, web, Chromium, axe, and performance gates passed
within the report's stated boundaries. A new versioned candidate is prepared from
this source state; X3 inline creation and line-editor work is next. The frozen
0.14.0.15, 0.14.0.17, and 0.14.0.18 candidates are not replaced.

X3 is now implemented and reported in
`docs/status/X3_INLINE_CREATION_LINE_EDITOR_REPORT_2026-09-13.md`. Its
fresh-disposable Chrome evidence covers the invoice description-only and nested
product/account paths plus project creation from a time-entry context. The
shared picker overlay behavior was corrected under browser test, and the
targeted format, typecheck, accessibility, and performance gates are green.
Tax-code creation remains a deliberate structured setup-form fallback. The
existing X2 candidate is frozen; X3 packaging uses a new versioned candidate.

The X3 participant-05 candidate is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.20`. Transfer only its
installer, matching SHA-256 sidecar, and `START-HERE.txt`. The installer is
273,123,768 bytes, SHA-256
`26a3d7a5850b144802123b13811018cb20cf4f6b408e21409ce1de53af8f36fe`, and has
valid Authenticode from `PennyWise Accounting QA`. It is ready for supervised
transfer testing; clean Windows acceptance remains open.

The latest C1 slot-07 candidate is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.22`. Transfer only its
installer, matching SHA-256 sidecar, and `START-HERE.txt`. The installer is
273,179,232 bytes, SHA-256
`5655ef57a356d418c255736f604928948cb7d1a382c2e13becfccadc8e5c5079`, and has
valid Authenticode from `PennyWise Accounting QA`. It is ready for supervised
transfer testing; clean Windows acceptance remains open. The 0.14.0.21 folder
remains unchanged.

The C1 slot-06 candidate is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.21`. Transfer only its
installer, matching SHA-256 sidecar, and `START-HERE.txt`. The installer is
273,191,056 bytes, SHA-256
`968ad831874462d12b16406c1034dbcbf247f021e6eec0a2352653396c640b3c`, and has
valid Authenticode from `PennyWise Accounting QA`. It is ready for supervised
transfer testing; clean Windows acceptance remains open.

The X2 participant-05 candidate is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.19`; use only its executable,
SHA-256 sidecar, and `START-HERE.txt`. Hash and signature evidence are in the X2
completion report. It is ready for supervised transfer testing, not clean-machine
accepted.

## Prompt index

### Track I — "Do a job, send an invoice, get paid" (the invoice-only client)

| Prompt                                      | What it delivers                                                                                  | Closes     | Effort | Depends on           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | ------ | -------------------- |
| `I1-invoicing-only-mode.md`                 | Minimal profile and navigation, three-minute first run, auto customer numbers                     | G10        | M      | B2-UX                |
| `I2-invoice-composer-and-finalize.md`       | One-screen invoice with one "Finalize" step and a plain-language "what this did" panel            | G5, G10    | M      | —                    |
| `I3-payment-instructions-and-recording.md`  | e-Transfer/EFT/cheque/pay-link block on invoices; one-click "Record payment"; paid/overdue status | G4         | M      | I2 (recommended)     |
| `I4-invoice-delivery-on-local-installs.md`  | Owner-enabled SMTP, real send dialog, "send from my email app" with a delivery record             | G1, G5     | M      | B2-3                 |
| `I5-invoice-and-customer-corrections-ui.md` | Void, credit note, edit draft, resend, attachments; customer edit/archive/balance                 | G6         | M      | I2 (recommended)     |
| `I6-background-job-runner.md`               | Lease-safe runner: payment-webhook retries, outbound webhooks, email retries, catch-up at launch  | G8, R2, R3 | L      | —                    |
| `I7-recurring-invoices-that-run.md`         | Recurring plans that actually create, finalize and send invoices                                  | G7, R1     | M      | I6, I2, I4           |
| `I8-overdue-follow-up-and-statements.md`    | Reminders, overdue view, customer statements, optional reviewed late fees                         | G9         | M–L    | I4, I6               |
| `I9-online-payments-for-local-installs.md`  | Own-account provider mode, provider-hosted pay links, confirmation by polling                     | G2, G3     | L      | B2 contracts, I3, I6 |

### Track U — API features with no working UI

| Prompt                                       | Area                                                                                                                                    | Effort |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `U1-record-maintenance-ui.md`                | View/edit/archive for products, vendors, accounts, bank accounts and rules, locations, asset classes, estimates, requests               | M      |
| `U2-ledger-banking-reporting-controls-ui.md` | Journals, bill detail/approve/reverse, bank match reverse and duplicate override, reconciliation reopen/report, statements, CSV exports | M      |
| `U3-security-team-developer-settings-ui.md`  | Sessions, invitation revoke, API credentials, OAuth clients, outbound webhooks                                                          | M      |
| `U4-operations-depth-ui.md`                  | Barcodes, scans, labels, lots/serials, reservations, counts, valuation, POS devices and cash, intercompany                              | L      |

### Track M — Multi-currency completion

| Prompt                                         | Area                                                                                                   | Effort | Depends on    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ | ------------- |
| `M1-foreign-corrections.md`                    | Foreign voids, credit notes, refunds, payment reversals, partial/unapplied foreign payments            | L      | I5 for the UI |
| `M2-foreign-banking.md`                        | Foreign bank categorization, foreign transfers and conversions, foreign feeds, foreign manual journals | L      | M1            |
| `M3-multi-currency-reporting-and-documents.md` | Document-currency statements and aging, FX reports, reviewed rate automation, MCFX-12/14 closure       | L      | M1, I6        |
| `M4-currency-breadth.md`                       | Currencies beyond CAD/USD, minor-unit exponents, rate sources                                          | L      | M1–M3         |

### Track C — Differentiators: things competitors don't do well

| Prompt                            | Idea                                                                                                          | Effort | Depends on       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ | ---------------- |
| `C1-zero-fee-etransfer-loop.md`   | Payment reference on each invoice, e-Transfer deposit parsing, one-click confirm match                        | M      | I3               |
| `C2-job-done-to-invoice.md`       | Calendar appointment or work item, plus unbilled time and mileage, becomes an invoice, with no double billing | M      | I2               |
| `C3-get-paid-forecast.md`         | Explainable expected-payment dates and slow-payer signals, fed into the 13-week forecast                      | S–M    | I8 (partial)     |
| `C4-accountant-period-package.md` | Verifiable, checksummed year-end ZIP for the accountant, with draft-only import back                          | M      | U2 (recommended) |

### Track X — Cross-cutting UI decisions (from the 2026-09-11 research)

| Prompt                                   | What it delivers                                                                                                                                                                            | Decisions  | Effort         | Depends on                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------- | --------------------------- |
| `X1-money-display-and-currency-views.md` | One exact formatter (symbol on screen, ISO code on documents, plain numbers in exports), dual-amount component, enable-in-context, inline "Use this rate"                                   | D1–D4      | M              | —                           |
| `X2-report-experience-conventions.md`    | Report shell, in-place drill-down, saved views, parentheses for negatives, resizable dashboard tiles with "hide amounts", layout-stability policy                                           | D6–D8, D11 | M–L            | X1; M3 for the aging toggle |
| `X3-inline-creation-and-line-editor.md`  | **"+" beside every picker**, "Create '…'" in the dropdown, quick-create dialogs on the same screen, multi-line invoice/estimate/bill editor, description-only lines                         | D9–D10     | M–L            | — (coordinate with B2-UX)   |
| `X4-inclusive-ui-quality-bar.md`         | WCAG 2.2 AA bar, automated accessibility checks, keyboard, reflow, forced colors, 200 ms INP budget, string catalog, and usability rounds per persona. **Wave 0; applies to every prompt.** | D11        | M + continuous | —                           |

### Track P — Competitor parity (from `COMPETITOR-MATRIX.md`)

| Prompt                                         | What it delivers                                                                                                                     | Effort | Depends on                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------- |
| `P1-phone-access-for-local-installs.md`        | Threat model, ADR and a flagged prototype for using PennyWise from a phone                                                           | M      | X4; decision D-10 before any build |
| `P2-estimate-signature-and-deposit-request.md` | Signed estimate and contract approval (on this device, by link, or by email reply), an acceptance certificate, and a deposit request | M      | I2                                 |
| `P3-deposits-milestones-that-post.md`          | Security deposits (a liability, no GST/HST until applied) and advance or milestone invoices                                          | L      | I5; decision D-09                  |
| `P4-custom-fields.md`                          | Typed custom fields on customers, items and documents                                                                                | M      | —                                  |
| `P5-french-interface.md`                       | A complete fr-CA interface                                                                                                           | L      | X4 Part A, X1                      |

### Track R — Hosted option (design only)

| Prompt                                | What it delivers                                                                                                                | Effort | Depends on    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- |
| `R1-optional-relay-service-design.md` | Design, privacy, threat model, cost and go/no-go for an optional relay (portal, public pages, webhooks, phone tunnel). No code. | M      | Decision D-11 |

## Recommended order

The authoritative sequence is the wave plan in `HANDOFF-BUILD-PLAN.md` §5. What follows
is a summary.

1. **Minimum for the invoice-only client to go live:** X3 → I1 → I2 → I3 → I5, then I4.
   I4's "send from my email app" half does not need B2-3 and can ship first. With these five,
   the client can set up, invoice, deliver, tell the customer how to pay, record payment,
   and fix mistakes.
2. **Reliability and automation:** I6 → I7 (complete) → I8.
3. **Get-paid advantage:** C1 (after I3), C2 (after I2), C3 (after I8), I9 (after B2
   shared-contract evidence, I3 and I6; own-account Square is implemented in I9).
4. **UI coverage:** U1–U4 run sequentially because they share the web client. X2 applies the report
   conventions.
5. **Multi-currency:** X1 → M1 → M2 → M3 → M4. Breadth comes last, because every added currency
   multiplies the correction surface.
6. **C4** fits anywhere after U2.

## How to use

1. Read `ASSESSMENT.md` for the finding IDs each prompt closes.
2. Authorize the prompt in `CURRENT_PHASE.md`.
3. Open a Codex session in `clearledger-src/` and paste the prompt body verbatim. Each
   prompt is self-contained: context with file:line evidence, tasks, constraints, acceptance
   criteria, and out-of-scope.
4. Don't accept a prompt as done on a passing typecheck. Every acceptance criterion is
   written to be checked in the running app or by a test against a disposable database.

## Local verification notes, repeated in each prompt

- Build workspace packages before running the API:
  `npx tsc -b packages/shared packages/db packages/accounting-core`.
- `apps/web/serve.mjs` serves `apps/web/dist`, which is built once at boot. After web
  edits, run `node apps/web/scripts/verify-assets.mjs` and then
  `node apps/web/scripts/build-assets.mjs`.
- `verify-assets.mjs` matches exact multi-line source snippets. Keep **LF** line
  endings, and update its expectations deliberately.
- E2E specs need a **fresh disposable database** on every run. The current Windows browser runner has been repaired and used successfully.
  Prefer `corepack pnpm test:e2e`; diagnose a reproduced failure before bypassing it.
- Run native Windows tests from PowerShell. Recheck current runtime-path handling;
  historical Git Bash failures are prior evidence, not an assumed current defect.
