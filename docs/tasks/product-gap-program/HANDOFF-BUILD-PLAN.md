# Build handoff — PennyWise product-gap program

**Status:** imported and reconciled on 2026-09-11 under the owner's request to
correct the missing pieces and set up the build. The owner then authorized the
full continuation. I1 through I9 are implemented with local verification and
completion reports; external/provider and clean-machine acceptance remain gates.
Read
`RECONCILIATION-2026-09-11.md` and the latest `docs/status/` report before
implementation.

## 1. What "ready for build" means here

- **Every prompt is complete.** Each has verified context (see `VERIFICATION-LEDGER.md`),
  files, tasks, constraints, acceptance criteria, out-of-scope, and standard rules.
- **Wave 0 has no unresolved product decision.** D-05 remains open and blocks M1–M4.
  Later legal, provider, and deployment acceptance must be resolved in their own scope.
- **Every prompt is held to the same bar:** the Definition of Done (§6), including the X4
  accessibility and usability checks.
- **Parallel work is limited.** The web client is one very large file (`app.js`, about
  918 KB), so **web prompts run one at a time**. API-only work can run alongside.

## 2. Before the first session (owner, about 30 minutes)

1. **Back up `clearledger-src`,** or run `git init` and make a first commit. There is no
   version control today.
2. **Decide how this runs alongside B2,** the active second-beta program. B2-3 (SMTP) and
   B2-2 (payments) are dependencies for I4 and I9. B2-UX is compatible with X3.
3. **Copy the pack into the repository:**

   ```powershell
   $src = "C:\Users\EmceeHax\Desktop\ClearLedger-release-stale-20260901T213018Z-1-001\codex-product-gap-pack"
   $dst = "C:\Users\EmceeHax\Desktop\clearledger-src\docs\tasks\product-gap-program"
   New-Item -ItemType Directory -Force $dst | Out-Null
   Copy-Item "$src\*" $dst -Recurse
   ```

   Then run the repository's formatter over the new folder, because the quality gate
   includes a format check.

4. **Paste the authorization text (§3)** into `docs/status/CURRENT_PHASE.md`, under
   "Active Phase".
5. **Confirm or override the defaults** in §4.
6. **Start Codex** with `PASTE-TO-CODEX.md`.

## 3. Authorization text (draft — edit the date and scope, then paste)

> **Product-gap program (owner authorized YYYY-MM-DD).** Controlling index:
> `docs/tasks/product-gap-program/HANDOFF-BUILD-PLAN.md`. Execute the waves in order,
> one prompt per session, and stop after each completion report for owner review. The
> decision defaults in §4 apply unless recorded otherwise in
> `docs/DECISIONS_AND_OPEN_QUESTIONS.md`. Web-client prompts run sequentially.
>
> No provider, tax, legal, Store, signing, or accessibility gate is waived. Emulated
> provider results are test evidence only. No hosted service, open network listener, or
> live credential is created without a separate owner decision. The B2 second-beta program
> keeps priority for its own increments.

## 4. Decisions — recommended defaults

| ID   | Decision                                | Default, if not answered                                                                                                                                                                                 | Blocks       |
| ---- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| D-01 | Email on installed builds               | **Yes:** the owner enables it after a verified test-send; an environment kill switch stays                                                                                                               | I4 tasks 1–2 |
| D-02 | Invoice-only profile                    | **A new `INVOICING_ONLY` profile**                                                                                                                                                                       | I1           |
| D-03 | Online payments on local installs       | **The business's own account;** Stripe and Square durable links; PayPal through its static link                                                                                                          | I9           |
| D-04 | Late fees                               | **Built but off;** the Interest Act annual-rate wording is mandatory                                                                                                                                     | I8 task 5    |
| D-05 | Foreign credit-note and reversal policy | **No default.** An accounting policy is required, so M1 waits, and M2–M4 after it                                                                                                                        | M1–M4        |
| D-06 | Next currencies                         | **EUR and GBP,** then others the Bank of Canada publishes; USD-base companies use manual rates                                                                                                           | M4           |
| D-07 | Multi-currency on every plan            | **Yes** (pricing; doesn't block the build)                                                                                                                                                               | —            |
| D-08 | Microsoft and Google mailbox sign-in    | **Build the OAuth path behind a flag,** showing "not yet available" until publisher and scope verification exist                                                                                         | I4 OAuth     |
| D-09 | Deposits accounting                     | **Two types** (P3): a security deposit, held as a liability with no GST/HST until applied; and an advance or progress invoice, as a normal taxed invoice. Retainage stays off; forfeiture stays disabled | P3           |
| D-10 | Phone access                            | **Spike only.** Nothing listens beyond loopback without owner sign-off on the threat model                                                                                                               | P1 build     |
| D-11 | Hosted relay                            | **Design only**; no service                                                                                                                                                                              | R1           |
| D-12 | French interface                        | **Build fr-CA,** with human translation review before release                                                                                                                                            | P5           |
| D-13 | Signature evidence                      | **Typed name, optional drawn signature, and an acceptance certificate;** no claim of legal equivalence                                                                                                   | P2           |

## 5. Waves

### Readiness of each prompt

| Prompt                     | Readiness                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| X4 (Part A)                | **Ready now** — Wave 0                                                                    |
| X3, I1, I3, I6, X1, P4, R1 | **Ready now**                                                                             |
| I2                         | After X3                                                                                  |
| I5                         | After I2                                                                                  |
| I4                         | Tasks 3–5 after I2; tasks 1–2 after B2-3; OAuth needs D-08 registrations                  |
| I7                         | After I6 and I2; auto-send after I4                                                       |
| I8                         | Manual part after I4; scheduled part after I6; late fees need D-04                        |
| I9                         | After B2 shared-contract evidence, I3 and I6; own-account Square is implemented within I9 |
| C1                         | After I3                                                                                  |
| C2                         | After I2                                                                                  |
| C3                         | Ready (better after I8)                                                                   |
| C4                         | After U2                                                                                  |
| U1–U4                      | Ready (run after Wave 1, to avoid conflicts in `app.js`)                                  |
| X2                         | After X1; the aging toggle after M3                                                       |
| P1                         | Spike ready; the build needs D-10                                                         |
| P2                         | After I2                                                                                  |
| P3                         | After I5 and D-09                                                                         |
| P5                         | After X4 Part A and X1                                                                    |
| M1                         | Needs D-05; after I5                                                                      |
| M2                         | After M1                                                                                  |
| M3                         | After M1, I6 and X1                                                                       |
| M4                         | After M1–M3 and D-06                                                                      |

### Wave 0 — foundations (1–2 sessions)

- **Prompts:** X4 Part A — the axe harness, keyboard paths, viewport and forced-colors
  runs, INP measurement, the string catalog, and `UI_QUALITY_BAR.md`. Also record a
  **baseline run** of the existing test suites.
- **Exit gate:**
  - the accessibility baseline is checked in as a tracked source artifact (or a listed file while this tree has no git);
  - the baseline test results are recorded, including the known mobile-webkit bank-import
    failure;
  - the string catalog is in use.

### Wave 1 — the invoice-only client can go live

- **Prompts:** X3 → I1 → I2 → I3 → I5 → I4 tasks 3–5 ("send from my email app", history,
  resend).
- **Exit gate:**
  - **Scripted e2e:** fresh install → "Just invoicing" setup → a 3-line invoice with a new
    item created in place → finalize → manual send recorded → payment recorded → credit
    note on a second invoice.
  - **Quality:** the X4 checks pass on every touched screen.
  - **People:** a usability round with 5 owner-operators, with severe findings fixed.

### Wave 2 — reliability and follow-up

- **Prompts:** I6, I7, and I8 source implementation are complete; I8's disposable
  database checks pass, while provider and clean-machine acceptance remain external.
  Continue to X1 after reviewing the package candidate report.
- **Exit gate:**
  - a simulated 30-day clock shows the correct reminders and recurring invoices;
  - a transiently failed webhook is retried; repeated delivery produces exactly one accounting effect.

### Wave 3 — getting paid

- **Prompts:** I4 tasks 1–2 (after B2-3) → C1 → I9 (after B2 shared-contract evidence, I3 and I6) → C3 → C2.
- **Exit gate:**
  - an email is received by a local SMTP server;
  - an emulated provider payment is recorded once;
  - an e-Transfer CSV match is confirmed.

### Wave 4 — parity and completeness

- **Prompts:** P2 → P3 → P4 → P5 (by workspace) → U1 → U2 → U3 → U4 → X2. The P1 spike and
  R1 design can run as document or API work in between.
- **Exit gate:** the capability register in `COMPETITOR-MATRIX.md` is re-run, and every
  non-excluded ❌ is closed or has a recorded owner deferral.

### Wave 5 — multi-currency

- **Prompts:** M1 (needs D-05) → M2 → M3 → M4.
- **Exit gate:** the golden fixtures pass, and position registers equal the GL.

### Wave 6

- **Prompts:** C4, plus any deferred items.

## 6. Definition of Done — applies to every prompt

1. **The `AGENTS.md` quality gate**, with actual results:
   - format, lint, typecheck;
   - Prisma validation and generation;
   - clean migration deployment;
   - unit, integration, authorization and tenant tests;
   - build;
   - applicable e2e;
   - `corepack pnpm test:research`.
2. **The X4 checks on every changed screen:**
   - no new serious or critical axe violations;
   - a keyboard path;
   - screenshots at 390, 834 and 1440 px and in forced colors;
   - no reflow failure at 320 px;
   - interaction times within the 200 ms INP budget, or an issue filed;
   - new text in the string catalog.
3. **No regression** in the existing e2e specs: `release-candidate`,
   `owner-contracts-invoice`, `company-management`, `catalog-bulk-onboarding`,
   `fulfilment-*`, `payroll-scheduled-draft`, `tax-code-configuration`,
   `appearance-customization`, `calendar-crm-schedule`, `import-item-matching` and
   `inventory-thumbnails`.
4. **Documents updated:**
   - the research matrix entry;
   - any changed contract or decision;
   - `VERIFICATION-LEDGER.md` for any new external claim.
5. **A completion report under 1,200 words** (`AGENTS.md`). It covers:
   - the changed files (there is no git);
   - the commands and results;
   - unrun checks and why;
   - screenshots;
   - open issues.
6. **Stop after the report,** for owner review.

## 7. Environment notes (learned in earlier sessions)

- **Build packages first:** `npx tsc -b packages/shared packages/db packages/accounting-core`.
- **Rebuild the web bundle after web edits.** `apps/web/serve.mjs` serves `dist/`, built
  at boot. Run `node apps/web/scripts/verify-assets.mjs`, then `build-assets.mjs`.
- **Keep LF line endings.** `verify-assets.mjs` matches exact multi-line snippets.
- **Give every e2e run a fresh disposable database** (`prisma migrate deploy` into a new
  database). Never reset a shared one without consent.
- **Use the repository browser runner first:** `corepack pnpm test:e2e -- <spec>`.
  Its current implementation handles Windows package-manager invocation, isolated
  ports, database locking, and child-process cleanup. Use direct Playwright only
  when a newly reproduced runner failure requires it; preserve these protections.
- **Run the native Windows tests from PowerShell.** Under Git Bash, GNU `tar` breaks the
  backup round-trip.
- **A known, pre-existing failure:** `release-candidate.spec.ts` fails on mobile-webkit in
  the bank-import section.

## 8. Risks

| Risk                                                                                 | Mitigation                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Conflicts in the 918 KB `app.js`                                                     | Web prompts run sequentially. Refactoring into modules only if the owner authorizes it separately. |
| Overlap with B2 (SMTP, payments, contextual creation)                                | Dependencies are marked. I4 and I9 build on B2, not beside it.                                     |
| No git                                                                               | Back up or `git init` first. Changed-file lists in every report.                                   |
| External gates (Microsoft and Google verification, provider sandboxes, legal review) | Feature flags, and truthful "not yet available" states. Never fake credentials.                    |
| Legal: Interest Act, Charter s.52.1 and s.57, e-signatures, deposit GST/HST          | Defaults are conservative; the owner's advisor confirms before enabling.                           |
| Scope: 31 prompts                                                                    | Wave 1 alone makes the invoice-only client viable. Later waves are separable.                      |

## 9. Completion report template

```text
Prompt: <ID> — <title>          Wave: <n>          Date:
Result: complete | partial | blocked (why)
Changed files: <list>
Decisions used: <D-xx default | owner override>
Quality gate: format ✓/✗ · lint · typecheck · prisma · migrations · unit · integration ·
              authz/tenant · build · e2e (<specs>) · test:research
X4: axe (new serious/critical: 0) · keyboard path · 320px reflow · forced colors ·
    INP (<ms>) · catalog strings
Evidence: <screenshots, fixtures, logs>
Not run / not verifiable locally: <list and reason>
Open issues and follow-ups: <list>
```
