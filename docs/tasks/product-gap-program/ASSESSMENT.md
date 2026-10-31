# Product gap assessment — 2026-09-11

## Scope and method

> Competitor research and product decisions on currency views, reporting and invoice
> workflow were added on 2026-09-11 in
> [`DECISIONS-currency-reporting-workflow.md`](./DECISIONS-currency-reporting-workflow.md).
> That work also corrected G4 and added G11. A later panel review corrected R2 and added
> G12–G14; see [`REVIEW-panel-critique-2026-09-11.md`](./REVIEW-panel-critique-2026-09-11.md).

- **Source reviewed:** `C:\Users\EmceeHax\Desktop\clearledger-src`. This covers API
  services and routes (`apps/api/src`), the web client (`apps/web/app.js` and
  `index.html`), the Windows launcher (`distribution/windows-native/launcher.cjs`), and the
  status and task documents.
- **Method:** static reading, plus a read-only script comparing the 486 `/v1` route
  registrations in `app.ts` and `http/shipping-routes.ts` against every `/v1` URL the web
  client references.
  - The app, the tests and the builds were **not** run.
  - The source tree was **not** modified.
- **Route-comparison caveats:**
  - The comparison treats any `${id}` suffix as a wildcard, so it **under-reports** missing
    UI.
  - Invoice void, credit-note, resend and edit-draft do not show up in its output. A direct
    search of `app.js` confirms none of them is called.
  - Protocol endpoints are excluded by hand in section 3: auth redirects, OAuth, provider
    webhooks, and the commercial control plane.
- **Active program:** B2, the second beta. Issues B2 already owns are listed in section 2
  and not re-prompted. Examples: CPA-005 UTF-8 record widths, and PayPal `custom_id`
  handling.

---

## 1. The "send some invoices and get paid" client

### Today's journey on an installed build

| Step                | What happens today                                                                                                                                                                                                                                                                                         | Friction                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install and launch  | The Inno beta has installed on two machines (H2 field report).                                                                                                                                                                                                                                             | None                                                                                                                                                                                          |
| Set up the business | Company setup has eight tabs, and business type is required. The navigation markup holds 19 workspaces: POS, inventory, payroll, fixed assets, fulfilment, accountant and more (`index.html:26-209`).                                                                                                      | Far more than an invoice-only user needs. The default `SOLO_SERVICE` profile toggles optional workflows; it does not define a minimal product (`workflow-preferences-service.ts:47-85, 272`). |
| Add a customer      | A customer number is required and must be typed by hand (`index.html:2203`).                                                                                                                                                                                                                               | Unexpected bookkeeping field.                                                                                                                                                                 |
| Create an invoice   | The API accepts free-text lines (`http/schemas.ts:926`), but the invoice screen sends **exactly one line** and requires a saved product (`app.js:9159-9192`, `index.html:2416`). With no products, the picker is an empty required dropdown, and its "+ Add" leaves the invoice for the product workspace. | A three-item job can't be invoiced, and a first-time user hits a dead end (G11). Posting is also a separate step described in ledger language (`app.js:9495`).                                |
| Send it             | Email is disabled, so "Send" downloads a PDF with the message "attach it in your own email service" (`app.js:9433-9441`).                                                                                                                                                                                  | Nothing records that it was sent.                                                                                                                                                             |
| Share a link        | The public link is `http://127.0.0.1:<port>`, and the UI warns it only works on this computer (`app.js:9464-9471`).                                                                                                                                                                                        | The customer can't open it.                                                                                                                                                                   |
| Customer pays       | One free-text "Payment instructions" block can be set in branding or template settings, and it prints on the invoice. There is no structured list of methods, no per-invoice reference, and no protection for bank details. Online payment needs platform credentials (see G3).                            | Works only if the owner finds the setting; nothing prompts them.                                                                                                                              |
| Record payment      | Manual payment forms exist in the payments area (`index.html:3432, 3764`).                                                                                                                                                                                                                                 | Works, but disconnected from the invoice view.                                                                                                                                                |
| Follow up           | There are no reminders. The customer statement has an API but no screen (`app.ts:2852`).                                                                                                                                                                                                                   | The owner chases payment by hand.                                                                                                                                                             |
| Fix a mistake       | The UI has no void, credit note, or edit-draft action.                                                                                                                                                                                                                                                     | The owner is stuck.                                                                                                                                                                           |
| Bill monthly        | "Recurring invoice plans" (`index.html:2903`) never create invoices.                                                                                                                                                                                                                                       | The feature misleads.                                                                                                                                                                         |

### Findings

**G1 — Invoice email is off on every installed copy, and the owner can't turn it on.**
The launcher sets `CLEARLEDGER_BETA_RUNTIME=true` and never sets `EMAIL_DELIVERY_MODE`
(`launcher.cjs:722-741`). `emailDeliveryRuntimeFromEnvironment` returns `DISABLED` when
the mode is absent. In beta runtime it additionally requires
`PENNYWISE_BETA_EMAIL_DELIVERY_APPROVED=true` (`email-connection-service.ts:128-138`).
The refusal is at `invoice-document-service.ts:404-413`. The only way to change it is to
edit environment variables, which a non-technical owner will never do. → **I4**

**G2 — Customer-facing links point at the owner's own computer.**
The launcher sets `APP_BASE_URL` and `PAYMENT_PUBLIC_BASE_URL` to
`http://127.0.0.1:<webPort>` (`launcher.cjs:734-736`). Public invoice pages and payment
return URLs therefore can't reach a customer, and provider webhooks can't reach the app.
→ **I9**

**G3 — Online payment assumes a platform account a local business doesn't have.**
Stripe is integrated as a Connect platform: Accounts v2 connected accounts, account links,
and direct charges on `stripeAccount` (`stripe-payment-provider.ts:24, 42-107, 151`).
PayPal requires partner merchant and attribution IDs (`index.ts:40-77`). The installation
chooses a single provider from the environment (`index.ts:48-52`). → **I9**, after B2-2

**G4 — "How to pay me" is only a free-text box.** _(Corrected 2026-09-11.)_

- **What exists.** Branding and invoice-template settings hold one free-text "Payment
  instructions" field (`company-setup-service.ts:429-445`,
  `invoice-template-service.ts:40, 201`). It renders on the HTML and PDF invoice
  (`invoice-render-service.ts:335-336, 713`).
- **What's missing:**
  - a structured list of methods;
  - a per-invoice payment reference;
  - masking or encryption for bank details typed into the box;
  - a first-run prompt to fill it in.
- **Why it matters.** The only other e-Transfer mention is a hint on the manual-payment form
  (`app.js:806`). For a Canadian service business, e-Transfer, EFT and cheque are the
  realistic payment routes.

→ **I3**, **C1**

**G5 — Sending is a `window.prompt`.**
When email is available, the send action asks for one bare address (`app.js:9442`):

- no prefill from the customer record;
- no subject or message;
- no CC to self, and no preview.

Delivery history renders as pipe-joined text (`app.js:9479-9481`). A manual send creates
no record. → **I4**, **I2**

**G6 — Mistakes can't be fixed from the UI.**
The API offers edit-draft, validate, approve, void, credit notes, credit-note posting,
resend, attachments and link revoke (`app.ts:3880-4146`). The web client calls only
preview, PDF, send, public-link, delivery-history, post, picking-slip and shipment
(`app.js:9385-9496`, `21548-22632`).

Customer detail, edit, archive, balance and statement have routes, but the web calls only
contacts, timeline and activities (`app.js:12403-12590`). Credit notes appear only through
the returns workflow (`app.js:7772`). → **I5**

**G7 — Recurring invoices don't recur.**
Schedules store a cadence, a template, `nextRunAt`, and a per-occurrence idempotency key
(`estimate-service.ts:600-725`), but nothing turns a schedule into an invoice.
`IMPLEMENTATION_STATUS.md:16-18` says so explicitly. The UI heading promises more than
exists. → **I7**

**G8 — Nothing runs in the background.**
`index.ts` starts only the HTTP server. See R2 and R3. → **I6**

**G9 — No follow-up tooling.**
There are no reminders, overdue workflow or late fees. A search of services for
reminder, overdue, dunning and late fee finds only unrelated calendar and report uses.
Customer statements have an API but no screen. → **I8**

**G10 — Setup and vocabulary are sized for bookkeepers.** See the journey table above.
→ **I1**, **I2**

**G11 — The invoice screen is a one-line form, and creating a missing record leaves the
screen.**

- **One line only.** `createInvoice` sends a single line (`app.js:9159-9192`). Estimates
  follow the same pattern.
- **No path forward with an empty catalogue.** The product picker is required and has no
  empty state (`index.html:2416`, `app.js:8030-8042`).
- **"+ Add product or service" navigates away.** It opens the Sales-workspace product form
  (`app.js:2942-2975`), which requires an income account and can chain into a second
  detour.
- **Only account creation works in place,** using a dialog (`app.js:2923-2940`).
- **Description-only rows work only in the bulk grid,** which proves the API accepts them.
  But there, every row is its own one-line invoice (`app.js:8478-8488, 8820`).

→ **X3**, then **I2**

**G12 — Invoices miss two Canadian document requirements.** _(Found in review.)_

- **No GST/HST or QST registration number is printed.** The renderer prints only "Business
  number" (`invoice-render-service.ts:149, 542`), although tax registrations are stored
  (`schema.prisma:1851-1853`). The CRA requires the supplier's GST/HST registration number
  on invoices of $100 or more before the buyer can claim input tax credits.
- **No French documents.** No document-language handling was found in the renderer. Quebec's
  Charter of the French Language, s.57, requires invoices and receipts to be available in
  French on terms at least as favourable.

→ **I1**, **I2**

**G13 — A USD invoice can silently get a CAD price.** _(Found in review.)_ The invoice form
fills "Unit price (invoice currency)" with the selected product's base-currency price,
whatever the invoice currency (`app.js:8060-8062`). → **X1**

**G14 — A description-only line carries no tax unless a tax code is sent.** _(Found in
review.)_ Without a product, the tax code comes only from the request
(`invoice-calculation.ts:106-107`). Any editor that allows description-only lines must show
and default the tax code. → **X3**

---

## 2. Features that don't work as their surface implies

| ID  | Finding                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                | Prompt                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| R1  | Recurring invoice plans never create invoices.                                                                                                                                                                                                                                                                                      | `estimate-service.ts:600-725`; `IMPLEMENTATION_STATUS.md:16-18`                                                                         | I7                                          |
| R2  | _(Corrected in review.)_ In production mode, payment-provider webhook processing is deferred, and a failure is kept "for replay", but nothing replays it: the replay worker is only called from tests. Installed builds run with `NODE_ENV=development`, so they process inline. Queued payment-receipt emails also have no worker. | `payment-service.ts:812-828`; `launcher.cjs:724`; `payment-outbox-worker.ts:37, 78`; `phase4-sales.integration.test.ts:706, 1024, 1088` | I6                                          |
| R3  | Signed outbound webhooks only go out when something calls the dispatch route. No UI or process calls it.                                                                                                                                                                                                                            | `app.ts:2000`                                                                                                                           | I6, U3                                      |
| R4  | Invoice and estimate email is disabled on installed builds (G1).                                                                                                                                                                                                                                                                    | `launcher.cjs:722-741`; `email-connection-service.ts:128-138`                                                                           | I4                                          |
| R5  | Public invoice and pay links on installed builds are loopback-only (G2).                                                                                                                                                                                                                                                            | `launcher.cjs:734-736`                                                                                                                  | I9                                          |
| R6  | Payroll "due drafts" exist only as a manual route.                                                                                                                                                                                                                                                                                  | `app.ts:6230`                                                                                                                           | I6 (job hook only; payroll stays with B2-4) |
| R7  | **Resolved.** The Windows browser-test runner now invokes `pnpm.cmd` with `shell: true`; the focused Chrome runner completed successfully on 2026-09-15.                                                                                                                                                                            | `scripts/run-browser-tests.mjs:150-156`; current X3 run                                                                                 | Keep as regression coverage                 |
| R8  | `release-candidate.spec.ts` remains intentionally skipped on mobile-webkit. The single several-hundred-step walkthrough is nondeterministic on WebKit; focused Chrome coverage passes and the Windows desktop deliverable is covered by the configured desktop projects.                                                            | `apps/web/e2e/release-candidate.spec.ts:24-45`                                                                                          | Split into focused WebKit tests later       |
| —   | CPA-005 UTF-8 record widths and account truncation; PayPal `custom_id` and signature handling.                                                                                                                                                                                                                                      | `SECOND_BETA_PROGRESS_2026-09-09.md`                                                                                                    | Owned by B2-1                               |

---

## 3. API capabilities with no working UI

The route comparison found 136 of 486 `/v1` routes referenced nowhere in the web client
(`evidence/route-diff-v2.txt`). After excluding protocol and platform endpoints, about 120
are genuine product gaps.

**Excluded as not UI gaps:**

- `/v1/auth/sign-in|recover|reauthenticate|callback`, `/v1/auth/session/renew`
- `/v1/oauth/authorize|token`
- `/v1/webhooks/payments/*`
- `/v1/email-connections/callback`
- `/v1/commercial/*` (billing control plane; confirm with the owner)

| Area                       | Routes with no UI                                                                                                                                                                                                                                                                                                                                                                                                                                           | Prompt       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Invoices and customers     | Edit draft, void, credit notes and posting, resend, attachments, link revoke; customer detail, edit, archive, balance, statement                                                                                                                                                                                                                                                                                                                            | I5           |
| Recurring                  | Schedule edit (`PATCH /v1/recurring-schedules/:id`)                                                                                                                                                                                                                                                                                                                                                                                                         | I7           |
| Record maintenance         | Products (detail, edit, archive, image), vendors, chart of accounts, bank accounts, bank rules, inventory locations, fixed-asset classes (edit/archive); estimates (detail, edit, delivery history, link revoke); purchase and deposit requests (detail/edit)                                                                                                                                                                                               | U1           |
| Ledger, banking, reporting | Journals (list, detail, create, reverse); bills (detail, edit, approve); immediate-expense reverse; bill-payment reverse; bank-import history; duplicate override; match reverse; rule suggestions; reconciliation edit, reopen and report; vendor statements; report CSV exports; audit CSV; opening-balance mark-reversed; generic purchase attachments                                                                                                   | U2           |
| Security, team, developer  | Session list and revoke; invitation revoke; API credentials (list, create, revoke, rotate); OAuth clients; outbound webhook endpoints, deliveries and replay; migration runs                                                                                                                                                                                                                                                                                | U3           |
| Operations                 | Barcodes; scan resolve; label templates and preview; lots; serials; reservation release and fulfil; transfer-order actions; count-line edit and count approval; valuation, customs-readiness and address-review reports; inventory capabilities; POS devices; shift cash events and variance approval; POS sale detail, picking slip and shipment; carrier-account deactivate; inventory-sync observations; intercompany transactions; consolidation groups | U4           |
| Payroll                    | Codes, run creation, payment-batch exports                                                                                                                                                                                                                                                                                                                                                                                                                  | Left to B2-4 |

---

## 4. Multi-currency — what's released and what's left

**Released:**

- The CAD/USD pair with manual, dated, purpose-specific rate snapshots.
- Foreign invoices, bills, customer receipts and bill payments.
- Realized FX, and FIFO foreign cash lots.
- Closing-rate revaluation with automatic next-period reversal.
- A Bank of Canada USD/CAD suggestion that is never auto-saved.

Source: `docs/CAD_USD_OPERATOR_GUIDE.md`.

**Still fail-closed:**

| Gap                                                                                | Code and location                                                                                                                                                                                                                                                       | Prompt |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Foreign invoice void or correction                                                 | `FOREIGN_INVOICE_CORRECTION_WORKFLOW_REQUIRED`, `invoice-service.ts:629`                                                                                                                                                                                                | M1     |
| Foreign credit notes                                                               | `FOREIGN_CREDIT_NOTE_WORKFLOW_REQUIRED`, `invoice-service.ts:725`                                                                                                                                                                                                       | M1     |
| Partial or unapplied foreign payments (foreign payments must be fully allocated)   | `FOREIGN_PAYMENT_UNAPPLIED_UNSUPPORTED`, `payment-service.ts:1829`; guide line 45                                                                                                                                                                                       | M1     |
| Foreign customer-payment reversal and refunds                                      | Operator guide lines 77-81                                                                                                                                                                                                                                              | M1     |
| Foreign bill-payment and settlement reversal                                       | `FOREIGN_SETTLEMENT_REVERSAL_REQUIRES_CORRECTION`, `purchase-service.ts:1361`                                                                                                                                                                                           | M1     |
| Direct categorization of foreign bank lines                                        | `FOREIGN_BANK_CATEGORIZATION_REQUIRES_SOURCE_WORKFLOW`, `banking-service.ts:757`                                                                                                                                                                                        | M2     |
| Transfers between foreign accounts, and conversions                                | `FOREIGN_BANK_TRANSFER_REQUIRES_POSITION_TRANSFER`, `banking-service.ts:1105`                                                                                                                                                                                           | M2     |
| Foreign bank-feed import                                                           | `BANK_FEED_CURRENCY_NOT_RELEASED`, `bank-feed-service.ts:800`                                                                                                                                                                                                           | M2     |
| Foreign manual journals                                                            | `FOREIGN_MANUAL_JOURNAL_UNSUPPORTED`, `journal-service.ts:462`                                                                                                                                                                                                          | M2     |
| Statements in document currency (they stay in base today)                          | `CURRENT_PHASE.md`                                                                                                                                                                                                                                                      | M3     |
| Automatic or live rate modes                                                       | `FX_RATE_MODE_NOT_RELEASED` and `FX_RATE_METHOD_NOT_RELEASED`, `multi-currency-service.ts:114, 215`                                                                                                                                                                     | M3     |
| Inventory, fixed assets and projects in foreign currency; tax on foreign documents | MCFX-12 and MCFX-14 in `MULTI_CURRENCY_IMPLEMENTATION_PROMPTS.md`                                                                                                                                                                                                       | M3     |
| Any currency other than CAD/USD                                                    | Hard-coded in `currency-workflow-policy.ts:45-50`, `multi-currency-release-gate.ts:10-16`, `multi-currency-service.ts:125`, `commerce-normalization.ts:956`, `commerce-order-conversion-service.ts:426`; the customer form offers only CAD/USD (`index.html:2208-2212`) | M4     |

---

## 5. Where PennyWise can beat competitors

The structural advantage is that PennyWise runs **on the owner's computer, with verified
backups, immutable books, and no mandatory subscription or payment processor.**

Cloud invoicing tools tend to earn from card processing and push customers toward it.
PennyWise can instead make the cheapest route, Interac e-Transfer, the smoothest one.
It can also turn "the job is done" into an invoice without retyping anything.

The claims below are hypotheses. Each C prompt requires Codex to verify current competitor
behaviour from primary documentation, as `AGENTS.md` demands, before building.

| Prompt  | Differentiator                                                                                                                                               | Why it's credible here                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| C1      | A zero-fee get-paid loop: each invoice carries a payment reference, e-Transfer deposits are parsed from bank imports, and a match is confirmed in one click. | Bank import, matching and the review gate already exist. Only reference-aware parsing and suggestion scoring are missing. |
| C2      | "Job done → invoice" from a calendar appointment or work item, plus unbilled time and mileage.                                                               | CRM, calendar, projects, time and mileage are already built. They just don't flow into invoices.                          |
| C3      | Explainable "when will I get paid" per invoice and customer, fed into the 13-week forecast.                                                                  | The 13-week forecast exists. Payment history is in the ledger.                                                            |
| C4      | A verifiable accountant package: checksummed ZIP, tie-outs, and draft-only import of adjustments.                                                            | Portability and exports exist. A local install makes a handover package more valuable than an accountant login.           |
| (in I2) | A plain-language "what this did to your books" panel on every finalized document.                                                                            | Derived from posted journal lines. Cheap to build, and unusual in the category.                                           |
| (in I6) | An honest automations panel ("runs while PennyWise is open on this computer"), with a run log.                                                               | Makes the local-install trade-off visible instead of surprising.                                                          |

**Considered but not prompted:**

- Letting a phone on the local network reach the desktop install. It adds security
  exposure to a loopback-only design, so it needs its own threat model first.
- Customer self-service portals. These need hosting.

---

## 6. Competitor parity gaps (added in the build-handoff review)

The full register is in `COMPETITOR-MATRIX.md`, and the evidence is in
`VERIFICATION-LEDGER.md`.

**G15 — Estimates and contracts can't be signed.** Neither `estimate-service.ts` nor
`contract-service.ts` captures a signature. Jobber, Square and FreshBooks do. → **P2**

**G16 — Deposits and progress billing don't post.** They are non-posting requests and
plans (`IMPLEMENTATION_STATUS.md`; `GATED_FEATURE_RESOLUTION.md`). Square, Jobber, Zoho and
FreshBooks apply deposits and retainers to invoices. → **P3**

**G17 — The interface is English-only.** `app.js` has no French strings. QuickBooks ships
English and French. Quebec's Charter s.52.1 requires software to be available in French
unless no French version exists. → **P5**

**G18 — No automated accessibility checks.** No axe usage exists in `apps/web/e2e`. Human
acceptance was recorded once (2026-08-19), but nothing prevents regressions. → **X4**

**G19 — PennyWise can't be used from a phone.** The installed build binds to `127.0.0.1`
(`launcher.cjs:726, 751`), and a PWA needs HTTPS (MDN). Every competitor has a mobile app.
→ **P1**, **R1**

**G20 — No custom fields.** `schema.prisma` has no custom-field model. → **P4**
