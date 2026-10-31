# Destry Workwear — chart of accounts and the sale-to-ledger workflow

Researched 2026-09-05 against this source tree. Every claim about PennyWise
behaviour below was read out of the code, and the file/line is given so it can be
checked rather than trusted.

**This is an engineering design, not tax advice.** Rates and treatments must be
confirmed with Destry's accountant and against CRA and provincial primary sources
before they are configured. PennyWise itself enforces this: every tax version
requires `sourceName` and `sourceRetrievedAt`
(`company-setup-service.ts:380`), so whoever configures a rate records where it
came from.

---

## 1. What the engine already does correctly

Do not rebuild any of this.

| Capability                                                                                                                         | Where                                          | Consequence for design                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tax codes are **versioned** with non-overlapping effective dates and mandatory source provenance                                   | `company-setup-service.ts:335-395`             | A rate change is a new version, not an edit. History stays correct.                             |
| A tax code has **components**, each with `jurisdiction`, `rate`, `recoverablePercent`, `payableAccountId`, `recoverableAccountId`  | `schema.prisma:1907`                           | GST and PST are two components of one code, and **each can post to its own liability account**. |
| The invoice journal credits **each component to its own payable account**, and refuses to post if any component lacks one          | `invoice-service.ts:1095-1107`                 | Per-jurisdiction tax liabilities work **today**, purely by configuration.                       |
| Every posted line stores a `taxSnapshot` carrying the full component breakdown — jurisdiction, rate, accounts, recoverable split   | `tax-calculation-service.ts:196-234`           | The data needed to file GST separately from PST already exists on every line.                   |
| Treatments `STANDARD`, `ZERO_RATED`, `EXEMPT`                                                                                      | `schema.prisma:443`                            | Zero-rated exports to the US are representable and distinguishable from exempt.                 |
| Foreign-currency documents require an **approved, dated FX snapshot**; rates are exact rationals with provenance and an approver   | `schema.prisma:5715`                           | A USD sale cannot post on a guessed rate.                                                       |
| Realized and unrealized FX gain/loss accounts ship in the base preset                                                              | `account-presets.ts:66-95`                     | 7200/7201/7210/7211 already exist.                                                              |
| Conversion **refuses to guess**: an order with more than one mapped tax code raises `TAX_ALLOCATION_UNSUPPORTED`                   | `commerce-order-conversion-service.ts:1005`    | No silent misallocation across jurisdictions.                                                   |
| Provider **fees are excluded from revenue** — `FEES_OUT_OF_SCOPE`                                                                  | `commerce-order-conversion-service.ts:552`     | Gateway fees will not be netted against sales.                                                  |
| Discounts must reconcile to explicit line discounts; no order-level discount is inferred                                           | `commerce-order-conversion-service.ts:519-525` | Coupon handling is exact or it stops.                                                           |
| Connector mapping carries `taxRemittanceResponsibility` (`SELLER` / `MARKETPLACE` / `REVIEW_REQUIRED`) and per-component overrides | `connector-runtime-service.ts:1100`            | Marketplace-collected tax can be distinguished from seller-collected.                           |

---

## 2. Recommended chart of accounts

Destry is a Canadian product seller: physical goods, own WooCommerce store,
inventory, shipping, CAD base, US and Canadian buyers.

Start from the **`small-product-seller`** preset — it adds Inventory (1300),
Product sales (4100) and Cost of goods sold (5000) to the base — then add the
accounts below. The preset is applied from Setup → Industry preset.

### Accounts the preset already creates

| Code        | Name                      | Type              | Notes                                                    |
| ----------- | ------------------------- | ----------------- | -------------------------------------------------------- |
| 1000        | Cash                      | Asset             |                                                          |
| 1100        | Accounts receivable       | Asset             | control                                                  |
| 1200        | Sales tax recoverable     | Asset             | control — ITCs on purchases                              |
| 1300        | Inventory                 | Asset             | control                                                  |
| 1500        | Equipment                 | Asset             |                                                          |
| 2000        | Accounts payable          | Liability         | control                                                  |
| 2100        | Sales tax payable         | Liability         | control — **see §3, this must not stay a single bucket** |
| 2300        | Loans payable             | Liability         |                                                          |
| 3000        | Opening balance equity    | Equity            |                                                          |
| 3100        | Retained earnings         | Equity            |                                                          |
| 4000        | Sales                     | Revenue           | fallback revenue account                                 |
| 4100        | Product sales             | Revenue           |                                                          |
| 5000        | Cost of goods sold        | Expense           |                                                          |
| 6000        | General expenses          | Expense           |                                                          |
| 7200 / 7201 | Unrealized FX loss / gain | Expense / Revenue |                                                          |
| 7210 / 7211 | Realized FX loss / gain   | Expense / Revenue |                                                          |

### Accounts to add

**Bank and clearing**

| Code | Name                                 | Type  | Why                                                                                                            |
| ---- | ------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------- |
| 1010 | Bank — chequing (CAD)                | Asset | the real operating account                                                                                     |
| 1020 | Bank — USD                           | Asset | only if a USD account exists; otherwise USD settles to CAD                                                     |
| 1050 | Undeposited funds / payment clearing | Asset | a store order is paid at the gateway days before the payout lands; without this, cash and bank never reconcile |

**Receivables and tax**

| Code | Name                           | Type      | Why                                   |
| ---- | ------------------------------ | --------- | ------------------------------------- |
| 2110 | GST/HST payable                | Liability | remitted to CRA                       |
| 2120 | PST payable — British Columbia | Liability | remitted to BC, separate return       |
| 2130 | PST payable — Saskatchewan     | Liability | separate authority                    |
| 2140 | RST payable — Manitoba         | Liability | separate authority                    |
| 2150 | QST payable — Quebec           | Liability | Revenu Québec, separate return        |
| 2190 | US state sales tax payable     | Liability | only if nexus is established — see §5 |

Create only the provincial accounts Destry is actually registered in. An account
that exists but is never used invites a wrong mapping.

**Revenue detail**

| Code | Name                         | Type           | Why                                                                                        |
| ---- | ---------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| 4110 | Shipping revenue             | Revenue        | shipping charged to customers is revenue, not a cost offset                                |
| 4200 | Sales returns and allowances | Contra revenue | `CONTRA_REVENUE` is a supported type; returns should reduce revenue visibly, not be buried |
| 4300 | Discounts and promotions     | Contra revenue | coupons are a marketing cost worth seeing                                                  |

**Cost and operating**

| Code | Name                                | Type    | Why                                                                                      |
| ---- | ----------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| 5100 | Freight and postage out             | Expense | what carriers charge Destry; the D5/H1 label purchase posts here                         |
| 5200 | Merchant and gateway fees           | Expense | Stripe/PayPal/Woo fees — the connector deliberately refuses to net these against revenue |
| 5300 | Packaging and shipping supplies     | Expense |                                                                                          |
| 6100 | Platform and software subscriptions | Expense | WooCommerce, hosting, apps                                                               |
| 6200 | Advertising and marketing           | Expense |                                                                                          |
| 6300 | Inventory shrinkage and write-offs  | Expense | pairs with the inventory adjustment workflow                                             |

**Liabilities**

| Code | Name                                 | Type      | Why                                                  |
| ---- | ------------------------------------ | --------- | ---------------------------------------------------- |
| 2200 | Customer deposits / unearned revenue | Liability | pre-orders and gift cards are not revenue when taken |
| 2400 | Gift card liability                  | Liability | only if gift cards are sold                          |

### One constraint that shapes all of this

`schema.prisma:1619` declares `@@unique([organizationId, companyId, systemPurpose])`.
**Only one account may carry `systemPurpose = "tax-payable"`**, and the tax report
reconciles against exactly that account
(`phase10-report-service.ts:896`, `controlPeriodActivity`).

So when the tax liabilities are split across 2110–2190:

- keep **2110 GST/HST payable** as the `tax-payable` control account (it is the
  largest and most frequent return), and
- the provincial and US accounts are ordinary liability accounts.

The consequence is honest and must be understood: the tax report's
`isReconciled` flag will then only prove that **GST/HST** collected agrees with
the control account. It says nothing about PST or QST. That is a reporting gap,
not a posting error — the postings are still exact. §6 covers the fix.

---

## 3. Tax codes to configure

One code per destination tax regime. Each is a **tax code with components**, and
each component points at its own payable account.

| Code        | Name                          | Treatment      | Components → payable account |
| ----------- | ----------------------------- | -------------- | ---------------------------- |
| `CA-AB`     | GST only (AB, NT, NU, YT)     | STANDARD       | GST → 2110                   |
| `CA-ON`     | HST Ontario                   | STANDARD       | HST → 2110                   |
| `CA-ATL`    | HST Atlantic (NB, NL, NS, PE) | STANDARD       | HST → 2110                   |
| `CA-BC`     | GST + PST British Columbia    | STANDARD       | GST → 2110; PST → 2120       |
| `CA-SK`     | GST + PST Saskatchewan        | STANDARD       | GST → 2110; PST → 2130       |
| `CA-MB`     | GST + RST Manitoba            | STANDARD       | GST → 2110; RST → 2140       |
| `CA-QC`     | GST + QST Quebec              | STANDARD       | GST → 2110; QST → 2150       |
| `EXPORT-US` | Export to United States       | **ZERO_RATED** | none (0%)                    |
| `EXEMPT`    | Exempt supply                 | EXEMPT         | none                         |

Notes that matter:

- **Rates are deliberately omitted.** Confirm each against CRA and the provincial
  authority, and record the source URL and retrieval date when creating the
  version — the API requires it.
- **HST provinces post to 2110**, not to a provincial account: HST is a single
  federal-administered tax remitted to CRA.
- **`EXPORT-US` must be `ZERO_RATED`, not `EXEMPT`.** Both produce no tax, but
  zero-rated sales preserve input tax credits and exempt sales do not. The tax
  report already reports the two separately
  (`phase10-report-service.ts:891-896`), so getting this wrong is visible and
  costly.
- Place of supply for goods shipped within Canada is generally the **destination
  province**, not Destry's own. The tax code is chosen by where the parcel goes.

### The one-code-per-order constraint

`commerce-order-conversion-service.ts:1005` refuses to convert an order that maps
to more than one tax code. This is correct and rarely a problem: one order ships
to one address, so one destination regime applies. It becomes a problem only if a
single order is split across destinations — treat that as two orders.

---

## 4. The workflow: WooCommerce sale → posted ledger

### Step 1 — Order arrives (no accounting)

The connector polls Woo and stages the order in the commerce inbox as
`REVIEW_REQUIRED`. **Nothing posts.** The review boundary is enforced in the
service, not just the UI, and the H1 workspace has a Playwright test asserting
that opening and selecting an order creates no invoice.

### Step 2 — Review (no accounting)

The operator opens **Orders & fulfilment**, selects the order, and reads the
preflight: `ready`, `gaps[]`, `customerStrategy`, provider totals. Typical gaps
on a first run are an unmapped tax rate, an unmatched product, an unresolved
customer, and — for a USD order — a missing FX rate.

### Step 3 — Convert (this posts)

Converting creates and posts a customer invoice. For a CAD order to Ontario,
1 item at 100.00, shipping 15.00, HST 13%:

```
Dr  1100 Accounts receivable            129.95
    Cr  4100 Product sales                      100.00
    Cr  4110 Shipping revenue *                  15.00
    Cr  2110 GST/HST payable                     14.95
```

\* Shipping currently lands in the **fallback `sales` account (4000)**, not 4110.
See §6 — this is a real gap.

Cost of sale posts from the inventory module on the same event (perpetual
weighted average):

```
Dr  5000 Cost of goods sold               42.00
    Cr  1300 Inventory                            42.00
```

### Step 4 — Payment

The customer paid the gateway at checkout, before any payout. Post to clearing,
not to bank:

```
Dr  1050 Payment clearing                129.95
    Cr  1100 Accounts receivable                129.95
```

### Step 5 — Payout and fees

When the gateway settles, typically net of fees:

```
Dr  1010 Bank — chequing                 125.85
Dr  5200 Merchant and gateway fees         4.10
    Cr  1050 Payment clearing                   129.95
```

This is why 1050 exists, and why the connector refuses to fold fees into revenue.

### Step 6 — Fulfilment (no accounting)

Picking slip and shipping label are operational documents. Producing them posts
nothing — asserted in the H1 test. Buying postage **does** post, to 5100:

```
Dr  5100 Freight and postage out          18.40
    Cr  1010 Bank / 2000 Accounts payable        18.40
```

`shipmentPurchaseSchema` requires an expense account, paying account, method and
date precisely because this is a real posting.

---

## 5. United States sales

### The GST/HST side — usually straightforward

Goods exported to a US customer are generally **zero-rated** for GST/HST. Use
`EXPORT-US`. Zero-rated is not the same as "no tax applies": the sale still
appears in the return as a zero-rated supply, and input tax credits survive.
Keep the export evidence — the shipping label and customs declaration from D5/D2
are that evidence, which is a good reason to buy labels through PennyWise.

### The US sales tax side — a decision, not a default

A US state can require a remote seller to collect its sales tax once an economic
nexus threshold is crossed (commonly a dollar amount or transaction count per
state per year, varying by state). Below those thresholds a Canadian seller
generally collects nothing.

**This is a legal determination for Destry's accountant, not a setting.** What
the engineering should do:

- default to collecting **no** US tax (`EXPORT-US`, zero-rated GST, no US
  component);
- if nexus is later established in a state, add a component pointing at **2190 US
  state sales tax payable**, with its own code per state;
- if Destry ever sells through a marketplace such as Etsy, the **marketplace
  facilitator** collects and remits — set the connector's
  `taxRemittanceResponsibility` to `MARKETPLACE` for that connector so the tax is
  not double-counted as Destry's liability. Their own WooCommerce store is
  **`SELLER`**.

The `taxRemittanceByComponent` map exists for the mixed case, where one channel
remits and another does not.

### Currency

A USD order cannot post without an **approved FX snapshot** dated to the
transaction. The preflight raises this as a gap. Two consequences:

- someone must record a documented USD→CAD rate before US orders convert;
- the receivable is held in USD and revalued, producing entries in 7200/7201
  (unrealized) and 7210/7211 (realized on settlement). Those accounts already
  exist.

Decide up front whether USD receipts land in a **USD bank account (1020)** or are
converted on receipt. It changes which FX accounts move and how often.

---

## 6. Screens and buttons — what exists, what does not

This is the part that determines whether Destry can actually operate the design
above.

### Exists

| Capability                                                                 | Where                                         |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| Apply an industry preset (creates the base chart)                          | Setup → Industry preset                       |
| Record a tax **registration** (GST_HST / PROVINCIAL, jurisdiction, number) | Setup → Tax, `index.html:1793`                |
| Connector tax **mapping**: provider rate → PennyWise tax code              | Integrations, `index.html:7310`               |
| Connector **remittance responsibility** and per-tax overrides              | Integrations, `index.html:7310-7330`          |
| Tax **report** for a date range                                            | Reports                                       |
| FX rate entry and approval                                                 | present in `app.js` (`fxRate`, 10 references) |
| Order review, convert, picking, carrier accounts                           | Orders & fulfilment (H1)                      |

### Missing — and blocking

> **Gaps 1 and 2 were fixed on 2026-09-05.** A tax code screen now exists in
> Setup → Tax, and the tax report groups by authority. Both are described as
> found, below, so the reasoning stays checkable; see "What was built" at the
> foot of this file for what changed.

**1. ~~There is no screen to create a tax code.~~ (fixed)**
`POST /v1/setup/tax-codes/versions` is API-only. Counted in `apps/web/`:
`tax-code` 0, `tax-component` 0, `payableAccount` 0. The Setup → Tax step records
a _registration_ only.

Without this screen Destry cannot create `CA-BC` with a GST component posting to
2110 and a PST component posting to 2120 — which is the entire mechanism that
makes per-jurisdiction remittance work. **This is the single highest-value
accounting gap.** Everything in §3 is unreachable without it.

Needs: create/version a tax code; add components with name, jurisdiction, rate,
recoverable percent, payable account and recoverable account; effective dates;
mandatory source name, URL and retrieval date; and a preview of which accounts a
sale would credit.

**2. ~~The tax report cannot be filed from.~~ (fixed)**
`taxReport` returns one aggregate — `collectedMinor`, `recoverableMinor`,
`netTaxPositionMinor` — reconciled against the single `tax-payable` control
(`phase10-report-service.ts:888-921`). There is **no grouping by jurisdiction**,
even though every line's `taxSnapshot` already carries
`components[].jurisdiction` and `components[].payableAccountId`.

Destry files GST/HST with CRA and PST with a province on different schedules.
Today that means exporting the detail and grouping it by hand.

The fix is a report change, not a data change: group the existing detail by
component jurisdiction and payable account, and reconcile each group against its
own account rather than only the control.

**3. There is no sales-tax remittance workflow.**
`remittance` appears 21 times in `app.js` — all payroll. Payroll has remittance
records and a payment export; sales tax has a report and nothing else. There is
no "mark this period filed", no record of what was remitted, and nothing that
clears the liability against a payment.

**4. Shipping revenue cannot be separated.**
A shipping line is created with `productItemId: null`
(`commerce-order-conversion-service.ts:534`), and income account resolution is
`product?.incomeAccount ?? account with systemPurpose "sales"`
(`invoice-calculation.ts:100-105`). With no product, shipping always credits
**4000 Sales**. Account 4110 in §2 cannot receive it without either a shipping
product item or a change to that fallback.

**5. A product's default tax code cannot be set from the UI.**
`ProductItem.incomeAccountId` is required and **is** editable — a
`select[name="incomeAccountId"]` appears in four product forms, so products can
be pointed at 4100. Good.

But `ProductItem.defaultTaxCodeId` (`schema.prisma:2146`) has **zero** references
in `index.html` or `app.js`. It is the fallback the line calculator uses when a
line does not specify a code (`invoice-calculation.ts:99`), so it matters for
manually created invoices. For converted store orders the connector's tax mapping
supplies the code, so this is a lesser gap than 1 — but it means a hand-keyed
invoice always falls back to whatever the line specifies, with no per-product
default.

---

## 7. What to do, in order

1. **Build the tax code screen** (gap 1). Nothing else in this design is usable
   without it. Everything it needs already exists on the API.
2. **Confirm rates and treatments** with Destry's accountant; create the codes in
   §3 with recorded sources.
3. **Add the accounts** in §2, keeping 2110 as the `tax-payable` control.
4. **Group the tax report by jurisdiction** (gap 2) so returns can be prepared.
5. **Decide the US position** (§5) — nexus, currency handling, USD bank account.
6. Then a sales-tax remittance workflow (gap 3) and shipping revenue (gap 4).

Items 1, 4 and 6 are engineering and belong in a phase task. Items 2 and 5 are
decisions only Destry and their accountant can make, and item 3 cannot start
until item 2 is answered.

---

## What was built — 2026-09-05

### Tax code configuration (gap 1)

`apps/web/index.html` gained a **Sales tax codes** section in the Setup → Tax
step; `apps/web/app.js` gained its logic; both are styled in one commented block.

- Lists existing codes with their effective version, treatment, components,
  each component's authority, rate and **payable account**, and the recorded
  source. A component with no payable account is flagged in the list.
- Creates a code, or a new version of an existing one, with components carrying
  name, authority, rate, recoverable percent, payable account and recoverable
  account.
- **Refuses to submit a component without a payable account**, because
  `invoice-service.ts:1101` refuses to post one — the operator learns at
  configuration time rather than when an invoice fails.
- **Shows the double-entry consequence before saving**: "On a 100.00 sale, GST at
  5% credits 2100 Sales tax payable." Zero-rated and exempt each state their
  effect on input tax credits rather than being two similar words in a dropdown.
- Requires the source name and retrieval date the API already demands. **No rate
  table ships** — rates change, and a stale hardcoded rate on a customer invoice
  is a liability.

**Percentages are converted to the API's 0–1 decimal by shifting the decimal
point on the string, never by dividing a float.** `9.975 / 100` is not exactly
`0.09975` in binary floating point. Verified end to end: entering `9.975` stores
`0.099750` exactly.

### Tax report by authority (gap 2)

`phase10-report-service.ts` gained `taxJurisdictionGroups`, which reads the
`components[]` already stored in every line's tax snapshot and groups by
`jurisdiction` and `payableAccountId`. The report now returns a `jurisdictions`
array alongside the existing aggregate — the existing fields are unchanged and
mean exactly what they did.

Each authority is reconciled **against the account its own component posts to**,
not against the single `tax-payable` control, which is the constraint §2
describes. Credits are handled by applying the row's direction to the stored
component amounts, since a credit keeps the original snapshot's positive values.

The reports screen shows it above the detail as "What you file, by authority".

Verified against the seeded company: the per-authority rows **sum exactly to the
aggregate** they were derived from — collected 33589 = 33589, recoverable
6976 = 6976.

Covered by `apps/web/e2e/tax-code-configuration.spec.ts`, which builds a
two-component `CA-BC` code through the form and asserts both stored rates are
exact and both components carry an account.

### Gap 4 — shipping revenue, fixed

`LineCalculationInput` gained an optional `incomeAccountId`, used only when a
line has **no product item** (a product's own income account stays
authoritative). The `small-product-seller` preset gained **4110 Shipping
revenue** with `systemPurpose: "shipping-revenue"`, and the order conversion
routes a store order's shipping line to it when the organization has one.

Backward compatible by construction: an organization without that account gets
exactly the previous behaviour, which
`apps/api/src/services/invoice-calculation.test.ts` asserts directly — including
that a named account which does not resolve falls back rather than failing to
invoice. Preset version bumped to 2; verified that applying it creates 4110.

### Gap 5 — product default tax code, fixed

`defaultTaxCodeId` was already accepted by the product API and had no UI. The
product form now offers it, populated from the configured tax codes, with a note
that store orders take their code from the connector mapping instead.

### Gap 3 — remittance: **not blocked, and narrower than it looked**

The earlier reading — that there is "no sales-tax remittance workflow" — was
correct about the absence of a filing register but wrong about the consequence.
**Remitting is possible today.** `AccountantService.createManualDraft`
(`accountant-service.ts`) validates that the accounts exist and carries a
`manual-journals:create` permission, but places **no control-account
restriction** on the lines. So an accountant records the remittance as a manual
journal — debit the authority's payable account, credit the bank — and posts it.
That is precisely the "authorized accountant action" the `AGENTS.md` invariant
_"control accounts require explicit domain workflows or authorized accountant
action"_ names.

Destry is therefore not blocked on filing. The report now gives the per-authority
figures, and the tax report screen explains how to record the payment and links
to the accountant workspace.

What genuinely remains is a **filing register**: a record of which period was
filed with which authority, for how much, on what date, linked to the journal
that paid it. That is a new model and a migration, and it is convenience and
auditability rather than capability. It was deliberately **not** built in this
pass: a schema change to a product days from a client handoff, touching the tax
liability story, belongs in an authorized phase designed against
`docs/ACCOUNTING_POSTING_RULES.md` — not improvised. `H5` carries it.
