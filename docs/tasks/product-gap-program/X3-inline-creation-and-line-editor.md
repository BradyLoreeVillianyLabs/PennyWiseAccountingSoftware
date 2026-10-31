# X3 — "+" beside every empty field: in-place creation and a real line-item editor

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `apps/web/app.js`:
  - `beginContextualCreation`, `2916-2975`
  - `completeContextualCreation`, `3010-3027`
  - `renderSalesSelects`, `8030-8083`
  - `createInvoice` and `createEstimate`, `9159-9230`
  - the bill form
- `apps/web/index.html`:
  - the invoice form, `2396-2450`
  - the product form, `2262-2339`
  - the customer form, `2201-2229`
  - the estimate and bill forms
- `apps/web/styles.css`
- `apps/api/src/services/invoice-service.ts`, **read first**. Change it only for the narrow
  default-sales-account case below, and document the change.

**Closes:** D9 and D10 in `DECISIONS-currency-reporting-workflow.md`, and G11 in
`ASSESSMENT.md`. It is the owner's explicit request: a "+" beside a vacant field on the
invoice screen that creates the missing item there.
**Effort:** M–L
**Depends on:** nothing. **I2 builds on this.** Coordinate with the B2-UX
contextual-creation lane; this prompt replaces its navigate-away step with an in-place
dialog.

## Context (verified in source)

- **The invoice screen sends exactly one line.** `createInvoice` posts `lines: [ { … } ]`
  with a single product, quantity, price and discount (`app.js:9159-9192`). Estimates
  follow the same one-line pattern.
- **The product picker is `required`** (`index.html:2416`). It is filled with no
  placeholder or empty-state text (`app.js:8030-8042`). A new business with no saved items
  sees an empty, required dropdown.
- **"+ Add product or service" already exists** (`index.html:2418-2427`), but it **leaves
  the invoice.**
  - It switches to the Sales workspace product form and asks the user to come back
    (`app.js:2942-2975`).
  - That form requires an income account and a sales price (`index.html:2262-2339`). If no
    suitable account exists, the user is sent through a second contextual step.
  - Only account creation uses an in-place dialog (`app.js:2923-2940`).
- **The API accepts lines without a saved item** (`productItemId` optional,
  `http/schemas.ts:926`). The bulk-entry grid already allows description-only invoice rows
  (`app.js:8478-8488, 8820`), but each row is a separate one-line invoice.
- _(Verified in review)_ **Where those lines post, and how they are taxed.**
  - **Account.** A line without an item falls back from the product's income account, to
    an optional line account, to the system `sales` account
    (`invoice-calculation.ts:108-116`). The public line schema accepts no account
    (`schemas.ts:924-933`).
  - **Tax.** Without a product, the tax code comes only from the request
    (`invoice-calculation.ts:106-107`). A description-only line with no tax code posts
    **no tax** (G14).
- **This is standard elsewhere:**
  - Xero: "+ New item" dialog.
  - Zoho: "+ Add New Item" in the dropdown.
  - Wave: "Create new product or service" at the bottom of the list, with the income account
    defaulting to Sales.
  - FreshBooks: new items typed on a line.
- **Users punish slow redesigns:**
  - Xero's description-only lines idea has **569 votes**.
  - The QuickBooks new invoice hid the total and lost row insertion.
  - Xero's new invoicing broke for fast typists.

## Tasks

1. **Creatable picker component.** Follow the WAI-ARIA combobox pattern with a listbox, and
   use it for customer, item, tax code, account, vendor and project pickers on working
   screens.
   - Typing filters the list.
   - Arrow keys move, Enter selects, and Escape closes.
   - Search is debounced, and the component **never steals focus or drops typed
     characters.**
   - When the typed text has no exact match, the last option is **"+ Create '<typed
     text>'"**.
   - When there are no records at all, the list shows an empty-state line and that create
     option.
   - **A visible "+" icon button sits beside the field.** It has a specific accessible name
     and tooltip, for example "Create a new product or service", and is emphasized when the
     list is empty.
2. **Quick-create dialogs,** using the existing `<dialog>` approach seen in the account
   dialog:
   - They open **on the same screen, never navigating away**, with the focus trapped and
     then returned.
   - They are prefilled with the typed text.
   - They ask only what's needed, with defaults. Every field default comes from existing
     settings, and none is invented.
     - **Product or service:** Name*, Sales price*, and Type (Service by default).
       - The income account defaults to the organization's preset Sales/revenue account.
         Show it with "Change", and pick from the account list, with "+" for a new account.
       - The tax code defaults to the organization default.
       - "More options" opens the remaining product fields in a side panel (see below).
     - **Customer:** Display name\*, Email, and Currency (default: base).
       - Number: automatic if I1 has landed. Otherwise, the field is shown and required.
     - **Tax code, vendor, project:** only the minimum fields their API requires.
     - **Account:** reuse the existing account dialog.
   - _(Revised in review)_ **Nested creation is a step, not a second pop-up.** Creating a
     revenue account from inside the item dialog replaces its content with an account step
     and a "Back" button, then returns to the item. Stacked modals disorient keyboard and
     screen-reader users.
   - _(Revised in review)_ **"More options" opens a side panel** (nonmodal) that keeps the
     invoice visible, rather than growing the dialog. NN/g: modals suit short, focused
     tasks; nonmodal panels suit work where the screen behind matters.
   - **On save:**
     - the API create carries an idempotency key;
     - the picker list refreshes;
     - the new record is selected in the **originating line**;
     - the price fills that line (respecting X1's foreign-currency prefill rule);
     - focus moves to Quantity.
   - **Escape or Cancel** returns to the draft exactly as it was.
3. **Retire the navigate-away step.** In `beginContextualCreation`, replace the non-account
   branch (`app.js:2942-2975`) with the dialog.
   - Keep the full form only as a "Open full form" fallback. It must still preserve the
     draft, using the existing browser-draft mechanism and "Return to draft".
4. **Multi-line editor on invoice, estimate and bill:**
   - **Columns:** Item (creatable picker, optional), Description, Qty, Rate, Discount, Tax
     code, Amount.
   - **Line actions:**
     - add a line, and insert a line below;
     - duplicate;
     - reorder with a drag handle and Alt+↑/↓;
     - **one-click delete with an undo notice.**
   - **Keyboard:** Tab and Shift+Tab move across the row. Enter on the last cell adds a new
     line and focuses its first cell.
   - **Description-only lines are allowed** when no item is chosen. _(Revised in review.)_
     - **Account.** They post to the system `sales` account. Show "Sales" as the line's
       account. If a company has no `sales` account, show the server's error clearly.
       - Choosing a different account per line would need `incomeAccountId` added to the
         public line schema. That is a separate API change that needs owner approval; it is
         not part of this prompt.
     - **Tax.** The tax-code cell must be visible on every line, and default to the
       organization's usual sales tax code (from company setup). Otherwise the line posts
       with no tax.
       - Clearing the tax code on a taxable line needs an explicit "No tax" choice.
   - **"Save as item" on a line is opt-in.** It creates a product from the line's
     description and rate through the same quick-create path.
   - **The totals panel is always visible:** subtotal, discount, tax by code and total.
     - It is sticky on desktop, and a pinned summary bar at 390 px.
     - Before the server calculates, label figures "estimated until saved". After saving,
       show the server's exact figures.
   - Submit sends all lines in one create or update request. Server validation errors map
     back to the specific line and field.
5. **Empty states** for each picker and list on these screens, following NN/g: state what's
   empty, why, and the direct next action. On an invoice with no saved items: "No saved
   products or services yet. Type a description on the line, or use + to create one you can
   reuse."
6. **Permissions.** A user without create permission for a record type doesn't see its "+"
   or the create option. The empty state says who can add them. Description-only lines still
   work, if the user may create invoices.
7. **Speed check.** Measure keystrokes and time to create a 3-line invoice for an existing
   customer, before and after, and report both. The new editor must not need more
   keystrokes per line than today's single-line form.

## Constraints

- **No posting changes,** except the narrowly documented default sales account, if it is
  needed.
- **The server calculates totals and tax.** The client total is a labelled estimate.
- **Every create goes through the existing API,** with idempotency keys and existing
  authorization. Tenant scope comes from the session, as today.
- **Draft preservation.** The unsaved draft survives dialog open, cancel, nested creation
  and page reload (existing browser draft).
- **Accessibility:**
  - combobox, listbox and dialog roles are correct;
  - every "+" has a specific accessible name;
  - focus order is logical;
  - it is usable at 390 px.

## Acceptance criteria

- **Zero products (e2e):** a fresh company creates and saves an invoice with **two
  description-only lines**, without leaving the invoice screen.
- **Typed create (e2e):**
  - type "Window cleaning" in Item; there is no match;
  - choose "+ Create 'Window cleaning'"; the dialog opens prefilled;
  - enter a price and save;
  - the item is selected on that line, the price fills in, focus is on Qty, and the other
    lines are unchanged.
- **Nested create:** create a product that needs a new revenue account from inside the
  dialog; both are created and selected, and the draft is intact.
- **Cancel:** pressing Escape in the dialog changes nothing in the draft.
- **Line editing (e2e):** insert, duplicate, reorder by keyboard, and delete then undo, on a
  4-line invoice. The saved invoice has the lines in the displayed order.
- **Totals:** visible at all times at 1366×768 and 390×844. After saving, they equal the
  server's totals (integration).
- **Permissions:** a viewer, or a role without item-create, sees no "+" for items and can
  still enter description-only lines if they may create invoices.
- **Accessibility:** axe checks pass on the invoice, estimate and bill screens.
- **Regression:** the existing specs `release-candidate.spec.ts`,
  `owner-contracts-invoice.spec.ts`, `catalog-bulk-onboarding.spec.ts` and
  `company-management.spec.ts` pass.
- **Speed:** keystroke and time measurements are reported.

## Out of scope

- Finalize, send, and the plain-language panel (I2).
- Payment instructions (I3).
- Foreign-rate UI (X1).

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
