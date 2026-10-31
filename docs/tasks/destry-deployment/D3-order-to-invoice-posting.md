# D3 — Reviewed store orders become posted sales

Authorized implementation task as of 2026-09-01. D3 is the sole active phase in
`docs/status/CURRENT_PHASE.md`; D4–D6 remain planning artifacts until separately
authorized.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/ACCOUNTING_POSTING_RULES.md`
4. `docs/COMMERCE_CATALOG_OPERATIONS.md` and `docs/CATALOG_MATCHING_CONTRACT.md`
5. `apps/api/src/services/connectors/` — the WooCommerce connector and inbox
6. `packages/db/prisma/schema.prisma` — `CommerceInboxEvent`, `CatalogMatchDecision`,
   `InventorySyncPolicy`, invoice and tax models
7. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — commerce entry

## Exact intention

Today a WooCommerce order arrives in the commerce inbox as evidence and stops
there. The only operation on an inbox event is `/review`. Everything downstream —
revenue, tax, inventory relief, cost of goods — has to be typed in by hand from the
inbox, for every order, forever. For a store with real order volume that is the
difference between a system that runs the business and a chore somebody performs
daily.

Close that gap without breaking the boundary that makes this product trustworthy.
The connector must still never create accounting on its own. What changes is that a
human reviewing an order gets to say "yes, book this" once, and PennyWise assembles
the correct draft invoice from evidence it already holds — approved catalog match,
mapped tax code, configured customer policy — instead of making a person retype it.

The reviewer stays the author of the accounting. The software stops being a
transcription exercise.

## Boundary conditions

- **Nothing posts without an explicit human action.** Conversion produces a DRAFT.
  Posting remains the existing separate, deliberate transition.
- **No unmapped guessing.** If a line has no approved catalog match, or a provider
  tax rate has no mapped tax code, or a required account is unset, conversion stops
  and says exactly what is missing. A partial or approximated invoice is worse than
  none.
- **Exactly once.** Conversion is idempotent per inbox event. A retry, a double
  click, or a re-sync never produces a second invoice. Follow the existing
  idempotency and transactional-outbox patterns.
- The link between inbox event and resulting document is recorded in both
  directions and is auditable.
- Refunds, cancellations and edits arriving later must not silently mutate a posted
  document. Surface them as review items; corrections use the existing linked
  reversal, credit-note and refund workflows.
- Foreign-currency documents obey the existing CAD/USD boundary and its fail-closed
  correction rules. If the order currency is unsupported, refuse with a clear
  reason.
- Money stays bigint minor units.

## Build order

1. **Conversion contract.** Define precisely what an inbox event must carry before
   it is convertible: an approved catalog match per line, a tax mapping per provider
   rate, a resolvable customer per the configured policy, a known currency, and a
   date inside an open fiscal period. Express it as a preflight that returns either
   "ready" or a specific, actionable list of what is missing. Build this first; the
   rest depends on it.
2. **Customer resolution.** Honour the existing import-rule setting — ask during
   review, use one marketplace customer, or create individual customers. Where an
   individual customer is created, use the D2 structured address so the record is
   shippable, not just printable.
3. **Draft assembly.** From a preflight-clean event, build a draft invoice: one line
   per order line against the matched product, quantities and unit prices in the
   order's currency, provider tax rates through their mapped codes, shipping and
   discount handled explicitly rather than folded into line prices. Record the
   provider's own totals alongside, and refuse to convert when the assembled total
   disagrees with the provider total beyond a zero tolerance — a mismatch means an
   assumption is wrong.
4. **Review surface.** In the commerce inbox, show the assembled draft next to the
   provider evidence before anything is created: what will be booked, to which
   accounts, at what tax, against which products. The reviewer confirms or rejects.
   Rejection records a reason and leaves the event reviewable.
5. **Batch, for the ordinary case.** A day's orders reviewed and converted together,
   with the same preflight applied per event and a clear per-event result. This is
   the workflow an owner will actually use; make it the comfortable path, not an
   afterthought.
6. **Downstream links.** The posted invoice relieves inventory through the existing
   perpetual weighted-average path — do not introduce a second inventory mechanism.
   Ensure the resulting document is discoverable from the order and the order from
   the document.

## Acceptance

- A fixture WooCommerce order with approved matches and mapped taxes converts to a
  draft invoice whose totals equal the provider totals exactly.
- An order missing a catalog match, a tax mapping, or an account produces a refusal
  naming the specific gap, and creates nothing.
- Converting the same event twice produces one invoice. Proven by an integration
  test with concurrent attempts.
- Posting the resulting invoice relieves inventory and books revenue, tax and cost
  of goods through the existing posting rules, with journals balanced and immutable.
- A later refund or cancellation appears as a review item and never mutates the
  posted document.
- Full quality gate passes, including PostgreSQL integration, authorization and
  tenant-isolation, idempotency and concurrency tests, and
  `corepack pnpm test:research`.

## Out of scope

Automatic conversion without human action, under any setting. Etsy-specific work
beyond what the shared contract already covers. Payout, gateway-fee and
bank-deposit reconciliation. Picking and shipping — D4 and D5.
