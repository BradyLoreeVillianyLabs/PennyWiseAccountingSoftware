# H1 — The operator interface for order fulfilment

> **Status: a first implementation has landed (2026-09-05).** The workspace,
> navigation entry, order queue, preflight review, convert/reject, picking and
> carrier panels, styles and a review-boundary Playwright spec are in the tree.
> **Do not rebuild it.** What remains is listed under "Remaining work" at the
> foot of this file. The rest of the document is the specification it was built
> against and stays the contract for any further change.

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/tasks/destry-deployment/README.md` and `README-HANDOFF.md`
4. D3, D4, D5 task files and their completion reports
5. `apps/api/src/services/commerce-order-conversion-service.ts`,
   `services/picking-slip-service.ts`, `services/shipping/`,
   `http/shipping-routes.ts`, `http/shipping-schemas.ts`
6. `apps/web/index.html` — how an existing workspace is declared and navigated
7. `apps/web/app.js` — `activateWorkspace`, `buildWorkspaceSubnavigation`,
   the commerce inbox/review rendering
8. `docs/COMMERCE_CATALOG_OPERATIONS.md`, `docs/SHIPPING_CARRIER_OPERATIONS.md`
9. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — commerce and shipping entries

## Exact intention

D3, D4 and D5 built the fulfilment engine and no way to drive it. Counted in
`apps/web/`: `picking` 0, `shipment` 0, `carrier` 0, `commerce/orders` 0. The
owner of Destry Workwear opens the app after an order arrives and there is nothing
on screen that turns it into a sale, a picking slip, or a label.

Give the daily loop a home. One person, at one screen, should be able to take a
WooCommerce order from "arrived" to "shipped" without leaving it, and without
PennyWise ever having posted anything they did not choose to post.

This phase adds no new accounting behaviour and no new API surface. Every action
it exposes already exists and is already tested. If a screen needs an endpoint
that does not exist, that is a finding to report, not a licence to add one.

## Boundary conditions

- **The review boundary is the point.** Provider data stays non-posting until a
  human acts. The screen must make the un-posted state obvious and the posting
  action deliberate and explicit. No auto-post, no "post all" that skips review,
  no posting as a side effect of navigation.
- A picking slip and a shipping label are **operational documents**. Producing
  them must not post, alter, or imply an accounting entry.
- Postage bills the owner's own carrier account. The UI must never suggest
  PennyWise is charging, reselling, or refunding postage.
- Money renders through the existing exact-CAD presentation path. Never format a
  minor-unit integer by hand, and never with a JavaScript `number`.

## Tasks

### 1. A fulfilment workspace

Add one workspace — suggested id `fulfilment-workspace` — declared the way the
existing 19 are, reachable from the left navigation, and included in
`buildWorkspaceSubnavigation` like any other. Follow the established pattern
exactly; do not invent a second navigation mechanism.

It holds the loop in the order the work happens:

1. **Orders to review** — what the connector has fetched and nobody has acted on.
   Per order: store reference, customer, lines with quantity and price, totals,
   and the matching state the conversion service already computes. Unmatched
   products and unmatched customers must be visible as such before any posting
   action is offered.
2. **Convert to invoice** — one explicit action per order, with a confirmation
   that states what will be created. On success, link to the created invoice.
   Errors surface the service's own message; do not invent friendlier text that
   loses the reason.
3. **Picking** — for converted orders, produce the bin-ordered picking slip and
   open or download the rendered PDF. Show which slip generation this is, since
   the service already versions them.
4. **Shipping** — quote, purchase, and void through the existing shipping routes,
   against the owner's configured carrier account. Show the label, the tracking
   number and the carrier's own error text verbatim when a call fails.

### 2. Make the state legible

Each order carries an obvious status through the loop — awaiting review,
converted, picked, shipped — derived from data that already exists. Do not add a
status column to the database to make the UI easier; if the state cannot be
derived, report that rather than inventing storage.

### 3. Empty and unavailable states

Follow the convention already established on the dashboard: never render a zero or
a blank where the truth is "not available". If no carrier account is configured,
say so and link to where it is configured. If the connector has never run, say
that. An operator must never be unable to tell "nothing to do" from "this is
broken".

### 4. Accessibility and layout parity

The workspace matches what the rest of the app now meets:

- every control reachable and operable by keyboard, with the existing 3px focus
  outline;
- all text at WCAG AA contrast (4.5:1 normal, 3:1 large) in every appearance
  theme;
- no horizontal overflow at 1440, 1280, 1024, 834 and 390 px, except inside a
  container that deliberately scrolls;
- no currency value wrapped across lines;
- tap targets at least 44px in the smaller dimension.

### 5. Tests

- Playwright coverage of the loop end to end against fixtures: an order appears,
  is reviewed, converts to a posted invoice, produces a picking slip, and reaches
  a purchased label. Assert the **review boundary**: an unconverted order creates
  no journal.
- Assert the negative: loading the workspace, and navigating within it, posts
  nothing.
- Follow the existing spec conventions in `apps/web/e2e/`.

### 6. Documentation

Update `docs/COMPETITIVE_RESEARCH_MATRIX.md` for the commerce and shipping
modules with the interaction contract, as section 3 of the execution standard
requires for user-facing modules.

## Constraints

- No new API endpoints, no schema changes, no migrations.
- Reuse existing services, permissions and rendering helpers. Do not duplicate the
  money formatter, the workspace machinery, or the status/announcement regions.
- Vanilla JS and hand-written CSS, matching the file's idiom. No framework, no new
  build step, no new runtime dependency.
- `apps/web/styles.css` has recently been consolidated: dashboard grid geometry has
  a single owner section near the end of the file. Add fulfilment styles in their
  own clearly commented section; do not scatter them.

## Acceptance criteria

- A non-developer can take a fixture order from arrived to shipped without leaving
  the workspace and without using an API client.
- No accounting entry exists for any order the operator did not explicitly
  convert; proven by a test, not by inspection.
- Picking slip and label actions produce no journal.
- The five accessibility and layout checks in task 4 pass at all five viewports.
- Playwright suite green on a **fresh** database (see the verification note in
  `README-HANDOFF.md`); judge on the Playwright result line, not the exit code.
- `corepack pnpm lint` and `corepack pnpm typecheck` pass.

## Out of scope

Anything requiring a live carrier or live store credential — keep the adapter and
fixture discipline. POS, payroll, and the dashboard. New accounting behaviour of
any kind.

---

## What landed on 2026-09-05

- `apps/web/index.html` — `#fulfilment-workspace`: order queue, order detail,
  picking and shipping panels.
- `apps/web/app.js` — registered in `workspaceIds`, `leftNavigationDefinitions`
  and `ownerNavigationKeys`; `loadFulfilment()` on activation; the queue,
  preflight, convert/reject, picking-slip and carrier-account rendering.
- `apps/web/styles.css` — one commented "Orders & fulfilment workspace" section.
- `apps/web/e2e/fulfilment-review-boundary.spec.ts` — asserts an order shows as
  Review required, its gaps render, Convert is disabled while the preflight says
  not ready, and **no invoice is created** by opening the workspace or selecting
  an order.

Verified against the real endpoints with the staged sample order: preflight
returns six gaps and they render verbatim; contrast, overflow and target checks
pass at 1440, 1280, 1024, 834 and 390 px.

Two pre-existing defects were found and fixed while building it:

1. `readLeftNavigationState` merged new navigation keys into `order` but into
   `visibleKeys` only when `stored.visibleKeys` was absent entirely — so **any
   destination added after a user first customised their rail was permanently
   invisible to them**. New keys are now shown; an explicit hide is still honoured.
2. The mobile bottom navigation bar (`<=560px`) had `background: transparent`
   because `.app-header .workspace-navigation` overrode its own
   `background: var(--surface)`, and its buttons kept the dark-header near-white
   foreground. Page content scrolled visibly through the labels, nothing was
   readable, and no bottom padding kept content clear of the fixed bar. Once
   legible, the six fixed columns proved too narrow and the labels overlapped;
   the bar now sizes columns to content and scrolls.

## Remaining work (archived after 2026-09-05 completion)

The checklist below records the work that was pending when this task was
prepared. It is complete; see
`docs/status/H1_FULFILMENT_OPERATOR_UI_REPORT_2026-09-05.md` for the evidence.

- **Shipment creation, quoting, purchase and void.** The carrier panel lists
  configured accounts and explains the empty state, but does not yet create a
  shipment. `shipmentPurchaseSchema` requires `confirmed: true`, a service code,
  the quoted cost and currency, and an expense account, paying account, method
  and date — buying postage records an expense, so this needs the account
  pickers and a confirmation that states what will be posted. Treat it as its
  own increment.
- **Short-pick handling.** `/v1/picking-slips/:id/short-pick` is unused by the UI.
- **Order status through the loop.** The queue shows the inbox status; it does
  not yet show converted/picked/shipped progression.
- **`docs/COMPETITIVE_RESEARCH_MATRIX.md`** — the commerce and shipping entries
  still need the interaction contract recorded, per section 3 of the execution
  standard.
