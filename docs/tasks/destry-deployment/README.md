# Destry Workwear deployment task pack

Created 2026-09-01. Six sequenced phase tasks that take PennyWise from the current
tree to a working local install on the Destry Workwear owner's computer.

Destry Workwear is a Canadian women's workwear brand selling from a WooCommerce
store (`destryworkwear.com`, base currency CAD, variable products with size and
colour variants) and shipping physical goods from a small warehouse.

## Authorization

`AGENTS.md` requires that Codex execute only the phase the project owner has
explicitly authorized, and stop after that phase's completion report. These files
are **prepared tasks, not authorizations**. Before running one, the owner must add
it to `docs/status/CURRENT_PHASE.md` as the active phase.

Run one phase per Codex session, in order. Each depends on the one before it.

## The phases

| #   | File                                   | Delivers                                                      | Depends on |
| --- | -------------------------------------- | ------------------------------------------------------------- | ---------- |
| D1  | `D1-native-package-hardening.md`       | An MSIX the owner can actually install and keep               | —          |
| D2  | `D2-structured-address-and-customs.md` | Structured shipping addresses; HS code and origin on products | —          |
| D3  | `D3-order-to-invoice-posting.md`       | Store orders become reviewed, posted sales                    | D2         |
| D4  | `D4-picking-slip.md`                   | A bin-ordered picking slip with product images                | D2, D3     |
| D5  | `D5-shipping-labels.md`                | Canada Post / USPS / FedEx labels on the owner's own accounts | D2, D4     |
| D6  | `D6-go-live-drill.md`                  | Onboarding, migration, backup/restore drill, UAT              | D1–D5      |

D1 and D2 are independent of each other and can run in either order.

## What the owner's deployment needs that this tree does not yet have

Established by review on 2026-09-01 against this source and the shipped
`0.14.0-rc.1` image:

1. **Store orders never post.** The only commerce operation is
   `/v1/organizations/current/commerce/inbox` plus `/review`. There is no
   order-to-invoice path, so every sale would be hand-keyed. This is D3 and it is
   the largest gap between the product and the owner's expectation.
2. **No picking or packing document.** No `picking`, `pick list` or `packing slip`
   anywhere in the tree. D4.
3. **No shipping.** No carrier, label, postage, waybill or shipment concepts. D5.
4. **Addresses are unstructured.** `Customer.billingAddress` and `serviceAddress`
   are `Json?`. Carriers require structured, validated addresses. D2.
5. **No customs data.** Canadian-made goods shipping to US customers need HS code,
   country of origin and declared value per line. D2.
6. **Backup targets Docker.** `Backup-ClearLedger.ps1` operates on Compose volumes;
   the native package keeps data under `%LOCALAPPDATA%\PennyWiseAccounting`. D1.

## Constraints that apply to every phase

- The connector review boundary holds. Provider data stays non-posting until a
  human explicitly acts. No phase may make a connector create accounting silently.
- PennyWise does not move money. Postage is billed to the operator's own carrier
  account; PennyWise never buys, resells, or refunds it.
- No phase may weaken an accounting invariant in `AGENTS.md`. Posted journals stay
  immutable and balanced; corrections stay linked reversals.
- Every external boundary keeps the adapter/fixture discipline: where credentials
  are unavailable, build the adapter, fixtures, mocks and tests, and document the
  exact environment variables required. Never fake a live integration.
- Money stays in bigint minor units. Never a JavaScript `number`.
