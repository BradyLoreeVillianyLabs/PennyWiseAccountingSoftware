# U2 — Ledger, banking and reporting controls that exist only in the API

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Files:** `apps/web/app.js`, `apps/web/index.html`, `apps/web/styles.css`. Touch the API
only if a real gap is found.
**Closes:** the ledger, banking and reporting rows in `ASSESSMENT.md` section 3
**Effort:** M
**Depends on:** nothing.

## Context — routes with no UI (`evidence/route-diff-v2.txt`)

- **Journals:** `GET /v1/journals`, `GET /v1/journals/:id`, `POST /v1/journals`,
  `POST /v1/journals/:id/reverse`.
  - First inspect the accountant workbench. If manual-journal **drafts** are the intended
    way to create journals, expose list, detail and reverse only.
  - Document why `POST /v1/journals` stays API-only.
- **Purchases:**
  - `GET/PUT /v1/bills/:id`, `POST /v1/bills/:id/approve`
  - `GET /v1/immediate-expense-drafts/:id`
  - `POST /v1/immediate-expenses/:id/reverse`
  - `POST /v1/bill-payments/:id/reverse`
  - Generic purchase attachments: `/v1/${parent.path}/:id/attachments` and
    `GET /v1/purchase-attachments/:id`. Find the parent list in `app.ts` and expose
    attachments on each.
- **Banking:**
  - `GET /v1/bank-imports` (import history)
  - `POST /v1/bank-transactions/:id/duplicate-override`
  - `POST /v1/bank-transactions/:id/matches/reverse`
  - `GET /v1/bank-transactions/:id/rule-suggestions`
  - `PUT /v1/bank-reconciliations/:id`, `POST …/reopen`, `GET …/report`
- **Reports:**
  - `GET /v1/reports/payables/vendors/:id/statement`
  - `GET /v1/reports/exports/:reportName.csv`
  - `GET /v1/accountant/audit-events.csv`
- **Setup:** `POST /v1/setup/opening-balances/:draftId/mark-reversed`

## Tasks

1. **Ledger browser** in the accountant workspace.
   - Filter by date, account, source type and amount.
   - Open a journal to see its lines, source document link, audit trail and linked
     reversals.
   - Authorized roles can **reverse with a reason**. Honour reauthentication where
     `permissions.ts` marks the action sensitive.
2. **Bills:** a detail view with edit (draft), approve, and payment history. Payments can be
   **reversed with a reason**. Immediate expenses can be reversed too.
3. **Banking:**
   - Import history, with each file's counts and duplicates.
   - A duplicate override with a mandatory reason.
   - Undo a match.
   - Show rule suggestions on unmatched lines (the owner accepts them explicitly).
   - Reconciliation edit and reopen, and a printable reconciliation report.
4. **Reports:** a "Download CSV" action on each report that has an export. The vendor
   statement goes on the vendor detail view. The audit-events CSV goes in the accountant
   workspace.
5. **Opening balances:** "Mark reversed" appears where the draft state allows it.

## Constraints

- **Reversals go through the existing services only.** They create linked reversals and
  never mutate posted lines.
- **Closed periods:** refusals are shown with the period name and a path to reopen, for
  authorized roles.
- **Downloads:** CSVs keep the server's column contract; the client never rebuilds them.

## Acceptance criteria

- **Bill-payment reversal (e2e):** the bill returns to open, and a linked reversal journal
  is visible.
- **Reconciliation (e2e):** reopen a reconciliation, edit it, and complete it again; the
  report prints.
- **Matching (e2e):** undo a bank match, and the line returns to unmatched.
- **Journal reversal (e2e):** the reversal is linked both ways, and reversing again is
  refused.
- **CSV exports:** each export downloads with the expected header row (test per report).
- **Route comparison:** every route above is now referenced.

## Out of scope

- A new manual-journal creation path (the workbench drafts own it).
- Custom report builders.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
