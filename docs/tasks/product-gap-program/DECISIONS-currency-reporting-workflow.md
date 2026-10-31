# Currency views, reporting and invoice workflow — research and product decisions

Date: 2026-09-11, revised the same day after a panel review (see
[`REVIEW-panel-critique-2026-09-11.md`](./REVIEW-panel-critique-2026-09-11.md)).
This is a planning record, and nothing in the application source was
changed. The decisions below are carried out by prompts **X1**, **X2** and **X3**, and by
amendments to **I2**, **I3**, **M3** and **M4**.

## Decisions at a glance

| #   | Area                                   | Decision                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Showing money                          | On screen, use the organization's own symbol (`$1,234.56` for a CAD company) and an explicit marker for anything else (`US$`, `€`). On customer documents, always state the ISO code (`USD 1,130.00`). Exports use plain numbers with a separate currency column. **Never a bare `$` on a customer document. Never flags.**                                            |
| D2  | Two currencies at once                 | The document currency is primary; the base equivalent is secondary. Show the rate, its date and source on demand. Label posted, exact values "Booked", and use `≈` only for estimates.                                                                                                                                                                                 |
| D3  | Turning multi-currency on              | Enable it from where you need it, for example when choosing USD on a customer. It is reversible until the first foreign document posts, and enabling it never switches another feature off. A customer can hold documents in more than one currency.                                                                                                                   |
| D4  | Exchange rates                         | On the document itself, offer the published Bank of Canada rate for the date, and create the rate with one click on "Use this rate". A rate is never applied silently, and a posted document keeps its rate forever.                                                                                                                                                   |
| D5  | Revaluation                            | Keep the reviewed, posted period-end revaluation with automatic reversal. Add a **non-posting** "value at today's rate" preview, marked `≈`. Report-time live revaluation is rejected as the book of record. The prompt comes at fiscal year-end by default (ASPE 1651); monthly is optional.                                                                          |
| D6  | Reports                                | Financial statements are in base currency. Aging defaults to base, with an **"Original currency" toggle** and per-currency subtotals. **Customer statements default to the customer's currency.**                                                                                                                                                                      |
| D7  | Report screens                         | A dense table first, drill-down in place with filters preserved, saved views, and CSV and print on every report. Negatives go in parentheses, and colour is never the only signal. **No forced layout migrations.**                                                                                                                                                    |
| D8  | Dashboard                              | Compact, resizable tiles. A "hide amounts" privacy switch. A base-currency label, and a foreign-exposure tile when multi-currency is on.                                                                                                                                                                                                                               |
| D9  | Invoice lines                          | A real multi-line editor: description-only lines allowed, totals always visible, full keyboard flow, insert/duplicate/reorder, and one-click delete with undo.                                                                                                                                                                                                         |
| D10 | Missing records                        | **Every picker gets a visible "+" beside it**, plus a "Create '…'" option when typing finds nothing. Both open a **quick-create dialog on the same screen**, prefilled with what was typed. Longer forms move to a side panel that keeps the invoice visible. The new record is selected and the cursor moves on. An empty picker says why it is empty and what to do. |
| D11 | Changing screens                       | Redesigns ship opt-in, the old layout stays available for a release, and nothing that worked is removed.                                                                                                                                                                                                                                                               |
| D12 | Canadian documents _(added in review)_ | Print the GST/HST (and QST) registration number on every invoice, credit note and receipt when registered. Render documents in the customer's language, with French available for Quebec customers.                                                                                                                                                                    |

---

## How this was decided

A five-person review panel weighed the evidence. Each decision below records the
disagreements and how they were resolved.

| Role                         | Represents                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Accountant (CPA)**         | Ledger integrity, IAS 21 foreign-currency rules, audit trail, and what accountants reviewing PennyWise books will expect. |
| **Product designer**         | Workflow speed, clarity, density, and consistency with the PennyWise workbench.                                           |
| **Accessibility specialist** | WCAG, screen readers, colour-vision deficiency, and keyboard-only use.                                                    |
| **Engineering lead**         | Fit with the current code and data model, testability, and delivery risk.                                                 |
| **Owner advocate**           | The invoice-only client, Destry Workwear, and non-accountant owners generally.                                            |

**Evidence gathered on 2026-09-11:**

- vendor help centres;
- vendor idea forums, with their vote counts;
- vendor community threads;
- review-site summaries;
- UX references;
- a read-through of PennyWise's current web client.

**Limits of the evidence:**

- The panel did not use competitor products hands-on.
- Some limitations come from third-party blogs; these are marked "reported".
- Vote counts change over time.
- Treat this as direction, not a feature-parity audit. Each prompt still requires Codex to
  re-verify from primary documents, as `AGENTS.md` demands.

---

## Part A — What competitors do

| Product                | Currency per contact                                                          | Rates                                                                                              | Revaluation                                                                                                                                           | Reports                                                                                                                                                                     | Notable limits                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QuickBooks Online**  | One currency per customer, vendor and account.                                | Downloaded automatically and editable. Historic rates must be typed in if they weren't downloaded. | "Home currency adjustment" posts a revaluation.                                                                                                       | Always in home currency. Aging can add an "Unrealized gain or loss" column. Transaction forms show both the foreign total and the home total.                               | **Cannot be turned off once enabled** (Intuit). Intuit lists QuickBooks Payments, Bill Pay and Commerce as incompatible, and says the cash-flow planner is switched off. Community and third-party sources also report limits on foreign-currency recurring or memorized transactions, Insights, the income and bill trackers, and batch invoices; Intuit has not confirmed these. |
| **Xero**               | Contacts have a default currency, and documents can use any enabled currency. | XE.com, refreshed hourly.                                                                          | Unrealised gains are **calculated when a report is run, at the current rate**. Manual adjustments are needed for accounts other than bank, AR and AP. | Aged reports are in base currency only. A currency icon opens a rate popover, and the rates are listed in a footer that can be hidden (which also removes it from exports). | **Only on the top plan** (in Canada, Premium at $80/month per xero.com/ca, checked 2026-09-11). The "Add original currency to aged reports" idea has **109 votes, not planned**. "Statements in a foreign currency" has 19 votes. "Revalue per accounting standards" has **95 votes**.                                                                                             |
| **Zoho Books**         | A currency is set per customer when it is created.                            | A feed from Open Exchange Rates, on by default and able to be switched off.                        | "Base currency adjustment" in the Accountant menu.                                                                                                    | Statements break balances down by currency.                                                                                                                                 | Changing a customer's currency after transactions exist is restricted.                                                                                                                                                                                                                                                                                                             |
| **FreshBooks**         | Invoices can be in many currencies.                                           | —                                                                                                  | None (reported).                                                                                                                                      | **One currency at a time**, with no conversion. A third-party plugin exists to consolidate.                                                                                 | Not real multi-currency accounting.                                                                                                                                                                                                                                                                                                                                                |
| **Wave**               | Foreign bank accounts are supported.                                          | xe.com.                                                                                            | Manual account revaluation.                                                                                                                           | The foreign account balance is the sum of historic conversions, so it "may not match the value you expect".                                                                 | Owners find the balances confusing.                                                                                                                                                                                                                                                                                                                                                |
| **Sage Accounting**    | —                                                                             | —                                                                                                  | Bank-account revaluation.                                                                                                                             | A bank account shows its balance in the account currency, **with the base amount underneath**.                                                                              | Multi-currency only on the Plus tier.                                                                                                                                                                                                                                                                                                                                              |
| **Odoo** (open source) | Optional "Amount in currency" column on journal items.                        | —                                                                                                  | —                                                                                                                                                     | Reconciliation shows both amounts.                                                                                                                                          | The list view doesn't total the foreign-amount column.                                                                                                                                                                                                                                                                                                                             |
| **Stripe**             | —                                                                             | Shows the exact rate applied.                                                                      | —                                                                                                                                                     | The dashboard shows the original charge amount **and** the converted settlement amount.                                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                  |

## Part B — What customers like and dislike

### Multi-currency

**Liked:**

- **Automatic rates**, as in Xero's hourly feed and Zoho's feed.
- **Seeing both amounts** on a transaction, as QuickBooks does.
- **Statements in the customer's currency**, as QuickBooks and Zoho do.
- **Being told the exact rate that was used**, as Stripe does.

**Disliked:**

- **Irreversible switches and silent feature loss** (QuickBooks).
- **One currency per customer** (QuickBooks).
- **Paying a higher tier** just to invoice one foreign client (Xero, Sage).
- **Aging with no original-currency amounts** (Xero, 109 votes; one user wrote that a
  financing deal was at risk).
- **Reports whose values move every day** because they are revalued at run time, and manual
  revaluation for other accounts (Xero, 95 votes).
- **"Incorrect exchange rates, slow currency updates"** in Xero's redesigned invoicing.
- **Balances that don't match expectations** (Wave).
- **Currency silos with no conversion** (FreshBooks).

### Reporting and visuals

**Reporting matters most.** Software Advice analysed 1,700+ verified reviews
(January 2025–January 2026). It found that 93 % rate income statement and balance sheet
features, and 91 % rate financial reporting, as critical or high importance. It describes
reporting failures as a common driver of upgrades.

**Forced report redesigns drew the loudest backlash in the category:**

- **QuickBooks "Modern View"** became mandatory, with no way to keep "Classic". Users
  describe "a window within a window", slower drill-down, drill-down that snaps back to the
  new view, filters that drop wanted columns, and slowness on large date ranges.
- **Xero** retired its old reports on 31 July 2023. Custom layouts could no longer be shared
  across formats, and new reports showed extra rows.

**Xero's new homepage was mixed:**

- **Liked:** 70 % said it made staying on top of the business easier, and quick-glance
  positioning was appreciated.
- **Disliked:** widgets that were too big and busy, and large numbers "readable by anybody
  passing by". Xero then added resizable widgets.

**Negative numbers:**

- Accounting convention is **parentheses**.
- **Red alone fails** roughly 8 % of men, who have red-green colour-vision deficiency, so
  profit and loss must be encoded in a second way.

### Invoice workflow

**Creating a missing item without leaving the invoice is normal practice:**

- **Xero:** "+ New item" in the item field opens a dialog.
- **Zoho:** "+ Add New Item" in the dropdown.
- **Wave:** "Create new product or service" at the bottom of the dropdown, with the income
  account defaulting to Sales.
- **FreshBooks:** typing a new item on a line saves it to the item list automatically.
- **QuickBooks:** "+ Add new" for customers on the invoice.

**Description-only lines matter.** Xero's idea to allow description-only lines has **569
votes** and was accepted in September 2025, after new invoicing forced quantity and price
onto every line. One user said: "The majority of my invoices are description only."

**Redesigns that slowed people down:**

- **Xero new invoicing:** more clicks, keyboard behaviour that broke for fast typists,
  awkward date picking, and a typed invoice number that doesn't stick. Xero responded with
  one-click line delete, better Tab/Enter/arrow handling, and one-click PDF.
- **QuickBooks new invoice:** **the total is not visible while creating the invoice**;
  users can't insert rows; copy, delete and PDF were lost; and there was no opt-out.

**What simple tools are loved for.** Invoice Simple and FreshBooks are praised for speed,
simplicity and mobile use. Price increases and usage caps are the common complaint.

---

## Part C — Where PennyWise stands today (verified in source)

- **Money formatting:** amounts print as `CAD 1,234.56` everywhere, with two decimals
  hard-coded (`apps/web/money.js:1-31`).
- **One line only:** the **invoice screen sends exactly one line**
  (`app.js:9159-9192`).
- **A product is required, with no empty state.** The product picker is required
  (`index.html:2416`) and is filled with no placeholder or empty-state text
  (`app.js:8030-8042`). With no products, it is an empty required dropdown.
- **"+ Add product or service" leaves the invoice** for the product form in another
  workspace, then returns (`app.js:2942-2975`). That form requires an income account and a
  price (`index.html:2262-2339`). Only account creation uses an in-place dialog
  (`app.js:2923-2940`).
- **The API already accepts lines without a product.** The bulk-entry grid proves it:
  description-only rows are allowed (`app.js:8478-8488, 8820`), but each row makes a
  separate one-line invoice.
- **Foreign documents need a rate created elsewhere first,** dated exactly on the document
  date (`currency-workflow-policy.ts:71-98`). The Bank of Canada suggestion lives in
  settings, not on the invoice.
- **What's already strong:**
  - Posted revaluation with automatic reversal, and immutable position events.
  - Multiple currencies per customer, since the currency is chosen on each document.
  - A free-text "Payment instructions" block on invoices.
- **Statements are in base currency only.**
- _(Added in review)_ **Lines without an item post to the `sales` account.** The
  calculation falls back from the product's income account, to an optional line account,
  to the system `sales` account (`invoice-calculation.ts:108-116`). The public line schema
  doesn't let the UI choose another account (`schemas.ts:924-933`).
- _(Added in review)_ **Lines without an item get no tax unless a tax code is sent**
  (`invoice-calculation.ts:106-107`).
- _(Added in review)_ **The invoice form prefills the product's base-currency price** into
  "Unit price (invoice currency)", even on a USD invoice (`app.js:8060-8062`).
- _(Added in review)_ **Invoices print "Business number" but no GST/HST or QST
  registration number** (`invoice-render-service.ts:149, 542`), although registrations are
  stored (`schema.prisma:1851-1853`). **No document-language handling was found** in the
  renderer.

---

## Part D — Panel decisions

### D1 — How money is written

**Decision:**

- **On screen, for the owner:** use `Intl.NumberFormat` in the organization's locale with
  `currencyDisplay: "symbol"`.
  - Checked locally: en-CA gives `$1,234,567.89` for CAD, `US$1,234,567.89` for USD,
    `€…` for EUR and `JP¥1,234,568` for JPY. fr-CA gives `1 234 567,89 $` and
    `1 234 567,89 $ US`.
  - The organization's own currency gets its familiar symbol, and anything else is
    automatically distinguishable.
  - Tables that mix currencies also carry an ISO-code column.
- **On customer documents and emails:** the reader's locale is unknown; a Canadian `$` reads
  as US dollars to an American. So:
  - column headers state the currency ("Amount (USD)");
  - the amount due uses the ISO code (`USD 1,130.00` or `1 130,00 USD`);
  - never a bare `$`.
- **Exports** (CSV and data): a plain decimal with `.`, no grouping, and a separate
  currency column.
- **Inputs** show the field's currency code beside the box.
- **Decimal places** come from the currency. `Intl` already renders JPY with 0 and KWD with
  3; the two-decimal code must go (M4).

**Rejected:**

- **Flags,** because a currency isn't a country: EUR, and USD used in many places.
- **Bare symbols on documents.**
- **The current `CAD 1,234.56` everywhere.** It is unambiguous, but noisy for a
  single-currency business: the invoice-only client would read "CAD" on every number of
  their own.

**Dissent and resolution:**

- **Designer:** wanted symbols everywhere.
- **CPA:** insisted on codes everywhere, citing the CAD/USD ambiguity noted by UXmatters.
- **Resolved:** split the rule by audience. The owner's screen is always in the owner's
  locale; a customer's document is not.

### D2 — Showing two currencies at once

**Decision:**

- **Layout:** a primary/secondary pattern. The document or account currency is large; the
  base equivalent is small and muted underneath, as Sage shows bank accounts.
- **Rate on demand:** a popover gives the rate, its date, its source and a link to the rate
  record.
- **A word for exact values, `≈` for estimates:**
  - Posted, exact carrying values are labelled **"Booked"**, for example "Booked $1,523.40
    at 1.3540 on 2026-09-11".
    _(Changed in review: a bare `=` reads as arithmetic to owners, and screen readers
    announce it as "equals".)_
  - `≈` is used only for estimates (unposted previews, and valuation at today's rate). Its
    accessible name is "approximately".
- **Lists:** invoice and bill lists show a currency column, with an optional "Base amount"
  column that is on by default once multi-currency is enabled.

**Why:**

- Users like seeing both amounts (QuickBooks, Stripe).
- Accountants need to tell exact from estimated.
- The Xero icon-and-popover pattern shows the rate without cluttering the table.

**Rejected:** always showing both amounts at full size, which doubles table width and
harms scanning.

### D3 — Enabling multi-currency, and currency per customer

**Decision:**

- **Enable in context.** Choosing USD on a customer or document offers "Enable US dollars
  for this company?", explaining that FX gain and loss accounts will be added.
- **Reversible until the first foreign document posts.** After that it is locked, with an
  explanation, consistent with the existing rollback refusal.
- **Enabling never disables any feature.** Recurring invoices, reminders, online payment
  and every report must work in every enabled currency, or refuse precisely for that
  currency.
- **Customers keep a default currency but may hold documents in others.** Balances and
  statements are shown per currency.
- **Multi-currency is not a paid tier.** This is an owner pricing decision; the panel
  recommends it.

**Why:** QuickBooks' irreversibility and feature loss, and the Xero and Sage plan-gating,
are the most repeated complaints.

**Dissent and resolution:**

- **CPA:** warned that multiple currencies per customer complicates AR.
- **Engineering:** confirmed the schema already chooses the currency per document.
- **Resolved:** keep it, and require per-currency subtotals everywhere a customer balance
  appears (D6).

### D4 — Exchange rates

**Decision:**

- **Suggest the rate on the foreign document itself.** On a USD invoice in a CAD company,
  show: "Bank of Canada: 1.3540 (published 2026-09-10) — Use this rate".
- **One click creates the dated rate record** with its provenance, and saves the document.
- **Manual entry is always possible,** with a required source note.
- **Weekends and holidays** use the previous published rate, and say so.
- _(Added in review)_ **Today's rate appears after 16:30 ET.** The Bank of Canada publishes
  indicative daily averages once each business day, by 16:30 ET. Its rates page lists 24
  currencies, and its data service's daily group holds 27 series; read the group rather
  than hard-coding a list (checked 2026-09-11). Earlier
  in the day, offer the previous business day's rate and label it.
- _(Added in review)_ **It fits tax rules.**
  - CRA Income Tax Folio S5-F4-C1 names the Bank of Canada rate for the day as the
    relevant spot rate.
  - Other sources (the folio's examples are Bloomberg, Thomson Reuters and OANDA) are
    accepted only if they meet every listed condition, including consistent use from year
    to year.
  - One-click Bank of Canada rates keep the books and tax filings aligned.
- **A rate is never applied silently.** Posted documents keep their rate. Differences from
  what the bank actually paid become realized FX at payment, and the UI explains this in one
  sentence.

**Why:**

- **Owners like automatic rates:** the owner advocate cited the Xero and Zoho feeds.
- **Silently changing rates cause the "incorrect exchange rates" complaints.**
- **Today's PennyWise flow is too strict:** it forces a detour to settings to create a
  snapshot before the invoice can be saved.

**Dissent and resolution:**

- **Owner advocate:** wanted rates applied automatically.
- **CPA:** refused unreviewed rates on posted records.
- **Resolved:** a one-click accept on the document. Owners get the automation, and the audit
  trail stays intact.

### D5 — Revaluation

**Decision:**

- **Keep the current model.** It is reviewed, posts at the closing rate on a chosen date,
  and reverses automatically on the first day of the next period, which is IAS 21's
  closing-rate treatment.
- **Add a non-posting "value at today's rate" preview,** marked `≈`, on bank accounts, aging
  and the position register.
- **Extend revaluation scope as M2/M3 close.** It covers bank, AR and AP today; other
  monetary accounts come later.
- _(Added in review)_ **Default cadence: fiscal year-end.**
  - ASPE Section 1651, which most Canadian private businesses follow, adjusts foreign
    monetary items to the rate at the balance-sheet date; IAS 21 treats monetary items the
    same way.
  - PennyWise prompts for revaluation at fiscal year-end, and offers monthly revaluation as
    an option for management reporting.

**Why:** Xero's report-time revaluation makes reports change daily. Accountants have asked
for standards-based period-end revaluation (95 votes).

**Rejected:** live report-time revaluation as the book of record.

### D6 — Reports in more than one currency

**Decision:**

- **Financial statements are base only:** P&L, balance sheet, trial balance and GL, as every
  competitor does. Drill-down transactions show the original currency and amount.
- **AR/AP aging (summary and detail):**
  - base by default;
  - an **"Original currency" toggle** that adds currency, original amount and open original
    amount columns;
  - **per-currency subtotals**, and a currency filter.
- **Customer and vendor statements:** **the customer's transaction currency by default.**
  One section per currency, with an optional base summary line.
- **FX reports:** realized FX, unrealized FX (as at the last posted revaluation, plus the
  labelled `≈` preview), the open position register, and rate history with who approved
  each rate.
- **Report header:** always states "Amounts in CAD (base currency)", or the currency shown.

**Why:**

- It directly answers the Xero 109-vote and 19-vote requests.
- It matches the QuickBooks and Zoho statement behaviour users like.

**Deferred:** paying several invoices in different currencies with one payment in a third
currency (a Xero request). It needs a cross-currency settlement model.

### D7 — Report screens

**Decision:**

- **Dense table first:**
  - a sticky header and first column;
  - tabular numerals, right-aligned;
  - indentation for account hierarchy;
  - emphasized subtotals.
- **Drill-down in place:** a side panel or same-page detail, with a breadcrumb. **Back
  returns with filters and scroll position intact.**
- **Comparison columns:** previous period, previous year, and budget where budgets exist.
- **Saved report views,** per user and optionally shared.
- **CSV and print on every report.**
- **Negatives in parentheses in reports,** plus a hidden "negative" label for screen
  readers. Colour is never the only signal.
- **Layout stability:** no forced migration. A redesigned report ships beside the old one
  for at least one release, with a layout importer.

**Why:** the QuickBooks Modern View and Xero report retirements are the category's clearest
lessons. Reporting is the most valued capability.

### D8 — Dashboard

**Decision:**

- Compact tiles in small, medium and large sizes, with a per-user layout.
- A **"hide amounts" privacy switch.**
- A base-currency label on money tiles.
- When multi-currency is on, a foreign-exposure tile: "Owed to you in USD: US$12,400
  (≈ $16,800 at today's rate)".
- Charts label values directly, and never rely on colour alone.

**Why:** the Xero homepage feedback — too big, too busy, numbers visible to passers-by — and
its fix, resizing.

### D9 — The invoice line editor

**Decision.** Invoices, estimates and bills get a multi-line table:

- **Columns:**
  - Item (optional, with a creatable picker; see D10)
  - Description
  - Quantity
  - Rate
  - Discount
  - Tax code
  - Amount
- **Description-only lines are allowed.** _(Verified in review.)_
  - **Account.** They post to the system `sales` account (`invoice-calculation.ts:108-116`),
    so no new setting is needed.
  - **Tax.** They carry tax only when a tax code is sent (`invoice-calculation.ts:106-107`).
    The editor must show the tax code on every line, and default it to the organization's
    usual code.
- **Line actions:** add a line, insert below, duplicate, reorder (drag handle plus
  Alt+↑/↓), and **one-click delete with undo**.
- **Keyboard:** Tab and Enter move through the row, and Enter on the last cell adds a line.
  Fast typing must never lose characters.
- **The totals panel is always visible:** subtotal, discount, tax per code and total, with
  "estimated until saved" before the server calculates.
- **"Save as item" on a line is opt-in.** Rejected: FreshBooks-style automatic saving, which
  clutters the item list.

**Why:**

- Today's invoice screen is one line long.
- Xero's 569-vote description-only demand.
- The QuickBooks complaints about hidden totals and lost row insertion.
- The Xero fast-typist complaints.

### D10 — Creating a missing record without leaving the screen (owner request)

**Decision:**

- **Every record picker on a working screen gets two entry points** to the same quick-create
  dialog. This covers customer, item, tax code, account, vendor and project.
  1. **A visible "+" button beside the field.** Its accessible name is specific, for
     example "Create a new product or service". When the picker is empty, it is emphasized.
  2. **A "+ Create '<typed text>'" option** at the end of the dropdown whenever the typed
     text has no exact match. It is the only option when nothing exists yet.
- **The dialog opens on the same screen.** Never navigate away.
  - It is prefilled with the typed text.
  - It asks only for what is needed. For an item: name, price, and type (Service by
    default). The income account defaults to the preset Sales account, and the tax code to
    the organization default.
  - _(Changed in review)_ **"More options" moves the form into a side panel** that keeps
    the invoice visible. NN/g: use a modal only for short, focused tasks, and a nonmodal
    panel when users need the screen behind it.
- _(Changed in review)_ **Nested creation is a step, not a second pop-up.** Creating a
  revenue account from inside the item form replaces the form with an account step and a
  "Back" button, then returns. Stacked modals disorient keyboard and screen-reader users.
- **On save:**
  - the record is created with an idempotency key;
  - the picker selects it;
  - the price fills the line;
  - focus moves to Quantity;
  - the draft is untouched.
- **Cancel (Esc)** returns to the draft exactly as it was.
- **Empty states explain themselves.** For example: "No saved products or services yet.
  Type a description on the line, or create an item to reuse."
- **Permissions:** without create permission, the "+" is hidden. Description-only lines still
  work, and the picker says who can add items.

**Why:**

- Xero, Zoho and Wave all create items from the invoice. Wave also defaults the income
  account.
- The NN/g empty-state guidelines: communicate status, teach in context, and offer a direct
  path.
- **PennyWise's current flow leaves the invoice** and can chain into a second detour for
  the income account.

**Dissent and resolution:**

- **Engineering:** noted B2-UX already built a navigate-and-return flow.
- **Resolved:** X3 replaces that detour with the dialog. It reuses the same API calls and
  validation, and keeps the full form only behind "More options". Coordinate with the B2-UX
  lane.

### D11 — Changing screens people already use

**Decision:**

- **Ship any redesign of a daily-use screen as opt-in first.** This covers invoice, bill,
  banking and reports.
- **Measure** keystrokes and time for a standard task before and after.
- **Never remove a working capability** in the redesign.
- **Keep the previous layout** for at least one release.

**Why:** the QuickBooks invoice and Modern View backlash, and Xero's forced new invoicing and
reports.

### D12 — Canadian document requirements _(added in review)_

**Decision:**

- **Registration numbers.** Print the GST/HST registration number (the 9-digit business
  number, `RT` and a 4-digit account, for example `123456789RT0001`) on every invoice,
  credit note and receipt whenever the organization is registered. Print the QST number
  too, when registered in Quebec.
- **Document language.** Each customer has a document language: English, French or
  bilingual. It defaults to French or bilingual for a customer with a Quebec address, with
  French at least as prominent as any other language.
- **Currency.** Totals always state their currency (D1).

**Why:**

- **Tax credits.** The CRA requires the supplier's GST/HST registration number on invoices
  of $100 or more before the buyer can claim input tax credits. Printing it every time is
  simpler and never wrong.
- **Language.** Quebec's Charter of the French Language, s.57, requires invoices and
  receipts to be available in French on terms at least as favourable.
- **Today's gap.** The renderer prints only "Business number", and no document-language
  handling was found (ASSESSMENT G12).

---

## Part E — Changes to the prompt pack

| Change                                                                                     | Where                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| New: money display, dual amounts and currency views (D1–D3, the UI side of D4)             | `X1-money-display-and-currency-views.md`                              |
| New: report and dashboard experience (D7, D8, the UI side of D6)                           | `X2-report-experience-conventions.md`                                 |
| New: multi-line editor, creatable pickers, quick-create dialogs and empty states (D9, D10) | `X3-inline-creation-and-line-editor.md`                               |
| I2 now depends on X3                                                                       | `I2-invoice-composer-and-finalize.md`                                 |
| I3 builds on the existing free-text payment instructions                                   | `I3-payment-instructions-and-recording.md`                            |
| M3 adopts D2 and D4–D6                                                                     | `M3-multi-currency-reporting-and-documents.md`                        |
| M4 uses the X1 formatter                                                                   | `M4-currency-breadth.md`                                              |
| G4 corrected; G11 added                                                                    | `ASSESSMENT.md`                                                       |
| Panel-review corrections and additions (D12, R2, G12–G14, provider and legal constraints)  | `REVIEW-panel-critique-2026-09-11.md`, which lists every file changed |

---

## Sources

**QuickBooks Online:**

- [Webgility — QuickBooks multicurrency limitations](https://www.webgility.com/blog/quickbooks-multicurrency) (third party)
- [QuickBooks Community — multicurrency unavailable features](https://quickbooks.intuit.com/learn-support/en-us/other-questions/quickbooks-online-multi-currency-unavailable-features/00/973700)
- [Intuit — Set up and use Multicurrency](https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US)
- [Intuit — Learn about exchange rates](https://quickbooks.intuit.com/learn-support/en-us/help-article/currency/learn-exchange-rates-quickbooks-online/L97rmEAdR_US_en_US)
- [Intuit — Home currency adjustments](https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/enter-home-currency-adjustments-foreign-balances/L40cB0sr4_US_en_US)
- [QuickBooks Community — Foreign exchange amount on reports](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/foreign-exchange-amount-on-reports/00/212790)
- [QuickBooks Community — disappointment with the removal of Classic view](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/who-else-is-incredibly-dissapointed-qbo-is-doing-away-with/00/1432145)
- [QuickBooks Community — make Classic view the default](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-to-make-classic-view-the-default-for-reports-in-quickbooks/00/1552865)
- [Intuit — Create invoices](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/create-invoices-quickbooks-online/L7gSzvCld_US_en_US)
- [QuickBooks Community — New invoice issues](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/new-invoice-issues/00/1442173)
- [QuickBooks Community — new invoice format complaints](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/is-anyone-happy-with-this-new-terrible-update-to-the-invoices/00/1432295)

**Xero:**

- [Xero idea — original currency in aged reports (109 votes)](https://productideas.xero.com/forums/967133-reports-tax/suggestions/47335214-reports-add-original-currency-in-the-aged-payabl)
- [Xero idea — customer statement in a foreign currency (19 votes)](https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/44994712-customer-statement-show-in-a-foreign-currency)
- [Xero idea — change exchange-rate behaviour (95 votes)](https://productideas.xero.com/forums/967121-users-setup/suggestions/45722329-foreign-currency-change-exchange-rate-behaviour)
- [Accsys — how Xero deals with multi-currency](https://www.accsysltd.co.uk/your-xero-training-course/understanding-how-xero-deals-with-multi-currency/) (third party)
- [Xero idea — multi-currency as an add-on](https://productideas.xero.com/forums/967142-security-support/suggestions/45419647-subscription-option-multi-currency-as-an-add-on)
- [Xero — Established plan](https://www.xero.com/us/pricing-plans/established/)
- [Xero blog — why we can't keep old reports](https://blog.xero.com/us/news-events/why-we-cant-keep-old-reports/)
- [Xero idea — saved layouts across formats](https://productideas.xero.com/forums/967133-reports-tax/suggestions/45660607-reporting-saved-customised-report-layout-across)
- [Xero blog — new dashboard](https://blog.xero.com/us/news-events/new-look-xero-dashboard/)
- [Xero idea — new homepage feedback](https://productideas.xero.com/forums/966063-new-homepage/suggestions/50866565-new-home-page-feedback)
- [Xero idea — resize homepage widgets](https://productideas.xero.com/forums/966063-new-homepage/suggestions/50284800-homepage-resize-widgets)
- [Xero Central — add an inventory item](https://central.xero.com/0/article/Add-an-inventory-item)
- [Xero idea — description-only lines (569 votes)](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/47698133-invoicing-allow-item-and-description-only-lines)
- [Xero blog — improving new invoicing from feedback](https://blog.xero.com/product-updates/feedback-helping-improve-new-invoicing-experience/)
- [Ratiobox — problems with Xero's new invoicing](https://www.ratiobox.co.uk/blogs/problems-with-xeros-new-invoicing/) (third party)
- [Xero idea — new invoicing: reduce steps and clicks](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/47714132-new-invoicing-reduce-number-of-steps-and-clicks)

**Zoho Books:**

- [Currencies](https://www.zoho.com/us/books/help/settings/currencies.html)
- [Base currency adjustment](https://www.zoho.com/us/books/help/accountant/base-currency.html)
- [Contact preferences](https://www.zoho.com/us/books/help/contacts/contact-preferences.html)
- [Zoho Invoice — new invoice](https://www.zoho.com/us/invoice/help/invoice/new-invoice.html)

**FreshBooks:**

- [Multi-currency blog](https://www.freshbooks.com/blog/bring-clarity-to-your-multi-currency-accounting)
- [FreshCurrencies plugin](https://www.freshcurrencies.com/) (third party)
- [What are items](https://support.freshbooks.com/hc/en-us/articles/360004173612-What-are-items)
- [Capterra reviews](https://www.capterra.com/p/142390/FreshBooks/reviews/)

**Wave:**

- [Foreign currency account balances](https://support.waveapps.com/hc/en-us/articles/360052935171-Foreign-currency-account-balances)
- [Create a product or service](https://support.waveapps.com/hc/en-us/articles/208621766-Create-a-product-or-service)

**Sage:**

- [How to set up multi-currency](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191542963)

**Odoo:**

- [Multi-currency system](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/multi_currency.html)

**Stripe:**

- [Presentment vs settlement currency](https://stripe.com/resources/more/presentment-currency-and-settlement-currency-explained-what-every-business-needs-to-know)

**Invoice Simple:**

- [Capterra reviews](https://www.capterra.com/p/165683/Invoice-Simple/reviews/)

**Buyer research:**

- [Software Advice — accounting software selection criteria](https://www.softwareadvice.com/resources/accounting-software-selection-criteria/)

**UX and accessibility:**

- [UXmatters — regionalizing designs (CAD/USD ambiguity)](https://www.uxmatters.com/mt/archives/2021/01/regionalizing-your-mobile-designs-part-2.php)
- [UX Pickle — currency formatting](https://uxpickle.com/guidelines-for-currency-formatting-with-iso-4217-table/)
- [NN/g — empty states in complex applications](https://www.nngroup.com/articles/empty-state-interface-design/)
- [USWDS — combo box](https://designsystem.digital.gov/components/combo-box/)
- [WAI-ARIA APG — combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [shadcn — create-new option inline](https://www.shadcn.io/examples/combobox-create-new-option-inline)
- [Deque — negative numbers for everyone](https://www.deque.com/blog/ensuring-negative-numbers-are-available-for-everyone/)
- [ColorArchive — financial UI colour](https://colorarchive.org/guides/financial-ui-color-guide/)

**Added in the panel review** (the full list is in `REVIEW-panel-critique-2026-09-11.md`):

- [Intuit — multicurrency](https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US)
- [Xero Canada pricing](https://www.xero.com/ca/pricing-plans/)
- [Xero — Unrealised gains and losses report](https://central.xero.com/0/article/Unrealised-gains-and-losses-report)
- [CRA Income Tax Folio S5-F4-C1](https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/series-5-international-residency-folio-4-foreign-currency/income-tax-folio-s5-f4-c1-income-tax-reporting-currency.html)
- [CRA input tax credits](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html)
- [Bank of Canada daily exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/)
- [BDO — ASPE Section 1651](https://www.bdo.ca/insights/accounting-knowledge-center/aspe/section-1651-foreign-currency-translation)
- [Charter of the French Language (CanLII)](https://www.canlii.org/en/qc/laws/stat/cqlr-c-c-11/latest/cqlr-c-c-11.html)
- [NN/g — modal and nonmodal dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/)
