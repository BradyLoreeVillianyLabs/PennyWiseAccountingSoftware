# H3 — Destry Workwear's own books, on their own data

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/MIGRATION_AND_PORTABILITY.md`
4. `docs/COMMERCE_PROVIDER_SETUP.md`
5. `docs/CAD_USD_OPERATOR_GUIDE.md` if present, or the multi-currency entry in
   `docs/COMPETITIVE_RESEARCH_MATRIX.md`
6. `H1` and `H2` completion reports
7. `docs/USER_ACCEPTANCE_SCRIPTS.md`

## Exact intention

Everything so far has been exercised against fictional data. This phase configures
the real business — a Canadian women's workwear brand selling variable products
with size and colour variants from `destryworkwear.com` in CAD, shipping physical
goods from a small warehouse — and moves their existing records in.

The measure is not that an import ran. It is that the owner can open the app on
any ordinary morning and trust what it says: the bank balance matches, the
receivables are the ones they are actually owed, and stock on hand matches what is
on the shelf.

Getting this wrong is worse than not doing it. A migration that half-succeeds and
looks complete produces confidently wrong books, and the owner has no way to know.

## Boundary conditions

- **Never post to make a number match.** If the imported trial balance does not
  balance, the correct outcome is a reported discrepancy, not a plug entry.
- Opening balances enter through the supported opening-balance path with a real
  date, not as invented transactions.
- The connector review boundary holds. Historical store orders imported for
  reference must not silently become posted sales.
- Money stays in bigint minor units. Variant products keep their size and colour
  identity through the import; do not collapse variants into one SKU.
- No production credential is committed, logged, or written into a report. Record
  the variable name and where the owner sets it.

## Tasks

### 1. Company setup for the real entity

Complete setup with the business's actual legal name, operating name, fiscal year,
CAD base currency, timezone, and tax registration. Record any field where the real
answer did not fit the form — that is a product finding worth having.

### 2. Chart of accounts

Start from the preset closest to a Canadian product-selling business and adapt.
Record every deviation and why. The owner's accountant must be able to read the
result and recognise it.

### 3. Catalogue with variants

Import the store catalogue including size and colour variants, with HS tariff code
and country of origin where the goods are Canadian-made (D2 delivered those
fields). Reconcile the imported count against the store's own count and explain
any difference. A variant that loses its identity is a failed import.

### 4. Opening balances

Bank, receivables, payables and inventory as at a stated cutover date. Produce a
trial balance and demonstrate it balances. If it does not, stop and report the
discrepancy with its composition.

### 5. Historical records

Whatever the owner needs for continuity — open invoices, unpaid bills, customer
history. State plainly what was imported, what was deliberately left behind, and
what the owner must keep in their previous system for reference.

### 6. Connect the store

Configure the WooCommerce connector against the real store. First fetch lands in
the review queue and posts nothing. Confirm on screen, through `H1`'s workspace,
that orders arrive un-posted and require an explicit action.

### 7. Reconcile before declaring done

Against the owner's own records, not the app's: bank balance, receivables total,
payables total, and stock on hand for a sample of at least twenty SKUs across
several variants. Record each comparison and its result.

## Constraints

- Do not modify product code. Findings go to the owning phase.
- Do not import anything the owner has not agreed to move.
- Every irreversible step is preceded by a backup taken through the documented
  path from `H2`, and the report says where that backup is.

## Acceptance criteria

- A trial balance at the cutover date that balances, with its composition shown.
- Catalogue counts reconciled against the store, variants intact, differences
  explained.
- Bank, receivables, payables and a twenty-SKU stock sample reconciled against the
  owner's own records, each with a stated result.
- The store connector fetches into review and posts nothing, demonstrated.
- A written statement of exactly what was **not** migrated and what the owner must
  retain elsewhere.
- No plug entries. If anything failed to reconcile, it is reported as an open item
  rather than closed by an adjusting entry.

## Out of scope

Product changes. Carrier credentials (`D5`/`H1` fixtures cover the mechanism).
Payroll. The handoff kit itself (`H4`).
