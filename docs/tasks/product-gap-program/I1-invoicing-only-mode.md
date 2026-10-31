# I1 — "Just invoicing" mode and a three-minute first run

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files, likely:**

- `apps/api/src/services/workflow-preferences-service.ts`
- `apps/api/src/services/company-setup-service.ts`
- `apps/api/src/services/account-presets.ts`
- `apps/api/src/services/customer-service.ts`
- `apps/web/app.js`, `apps/web/index.html`, `apps/web/styles.css`
- `packages/db/prisma/schema.prisma`, plus a migration if a new profile key is persisted

**Closes:** G10. It is also the foundation for I2–I8.
**Effort:** M
**Depends on:** B2-UX contextual creation. Reuse its "+ Add" and return-to-draft mechanism
(`data-cancel-contextual-create`, `index.html:2223`).

## Context

A real client wants one thing: after a job, send the customer an invoice and get paid.
Today, that person must work through:

- **The full navigation.** The markup contains 19 workspaces, including POS, inventory,
  payroll, fixed assets, fulfilment and accountant tools (`index.html:26-209`).
- **Profiles that don't minimize anything.** `SOLO_SERVICE` is the default profile
  (`workflow-preferences-service.ts:47-52, 272`). Like the other three profiles, it only
  toggles optional workflows (deposits, progress billing, purchase requests, fixed assets,
  cash planning). None of them defines a minimal product.
- **An eight-tab company setup** with a required business type.
- **A hand-typed customer number**, required on every customer (`index.html:2203`).

## Tasks

1. **Add a "Just invoicing" profile.** Either add `INVOICING_ONLY` to `workflowProfileKeys`,
   or reshape `SOLO_SERVICE` if the owner prefers. Record the decision in
   `docs/DECISIONS_AND_OPEN_QUESTIONS.md`.
   - The profile controls **navigation visibility only.** Show Home, Invoices, Customers,
     Payments received, a short Reports list (Owed to you, Sales by customer, GST/HST
     summary, Profit & loss), Settings and Help.
   - Every other workspace stays reachable through Settings → "Show more of PennyWise".
     Nothing is disabled server-side.
2. **First-run choice: "What do you need PennyWise for?"** Make "Just send invoices and get
   paid" the first option.
   - It asks only for: business name, address, email, phone, logo (optional), province,
     and GST/HST registration number. "I'm not registered" is an allowed answer.
   - _(Added in review)_ **Store registration numbers properly.** Save the GST/HST number,
     and the QST number for Quebec registrants, as tax registrations in the existing model
     (`schema.prisma:1851-1853`), not only as the "Business number".
     - Validate the GST/HST format: 9 digits, `RT`, 4 digits (for example
       `123456789RT0001`).
     - Confirm the QST format from Revenu Québec.
     - I2 prints these numbers on documents (decision D12).
   - _(Added in review)_ **Ask the default document language:** English, French, or both.
     Customers with a Quebec address default to French or bilingual (Charter of the French
     Language, s.57).
   - It also asks "How do customers usually pay you?" (a checklist). Persist the answer for
     I3; if I3 hasn't landed, store it in a field I3 will adopt.
   - Everything else defaults: calendar fiscal year, the `general-service` account preset,
     invoice numbering `INV-0001`, and Net 30 terms, all editable later.
   - Check the accounting-basis default against `docs/ACCOUNTING_POSTING_RULES.md`.
3. **Auto-generate customer numbers** (`CUST-0001`…) when the field is left blank.
   - Keep the field editable under "More details".
   - Generation must be race-safe (a unique constraint plus retry, or a sequence), matching
     the existing invoice-numbering pattern.
4. **Profile switching is reversible.** Switching to a fuller profile reveals workspaces;
   switching back hides them. No data changes, and the switch is audited.
5. **Measure it.** Add an e2e spec that runs from a fresh database through first run to a
   saved invoice draft. Targets: 12 user actions or fewer, and under three minutes for a
   scripted run. Report the actual numbers.

## Constraints

- The short flow writes **the same records** as the full setup. It must still create a
  balanced chart of accounts, the AR control account, sales income, and tax control
  accounts.
- Hiding a workspace never hides a posted amount from any report.
- **"Not registered" means no tax lines.** It must not become a zero-rated code unless
  posting rules say so. Check `docs/NORTH_AMERICAN_TAX_AND_MARKETPLACE_REMITTANCE.md`.
- Permissions and server authorization are unchanged. A profile is presentation only.
- The four existing profiles and their tests keep working.

## Acceptance criteria

- A fresh install that chooses "Just send invoices" lands on an invoice-first Home. No POS,
  inventory, payroll, fulfilment or fixed-asset navigation is visible.
- A customer can be created with only a name (and optionally an email). Two concurrent
  creates never collide (integration test).
- The profile can switch there and back without changing data, and an audit event is
  recorded.
- The new e2e spec passes on desktop Chromium and at 390 px width.
- The existing company-management and release-candidate specs still pass.

## Out of scope

- The invoice composer (I2).
- Payment instructions (I3).
- Email (I4).

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
