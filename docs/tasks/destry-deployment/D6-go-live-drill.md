# D6 — Destry Workwear go-live drill

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/USER_ACCEPTANCE_SCRIPTS.md`
4. `docs/COMMERCE_PROVIDER_SETUP.md`
5. `docs/MIGRATION_AND_PORTABILITY.md`
6. `docs/BACKUP_AND_RECOVERY.md`
7. D1–D5 completion reports

## Exact intention

Everything before this was built against fixtures. This phase is the first time
PennyWise meets a real store, real products, real money and a real person who is
not a developer — and it happens on a disposable machine, not the owner's, so that
what goes wrong goes wrong somewhere it does not matter.

Produce two things: evidence that the whole path works end to end against
`destryworkwear.com`, and a cutover runbook precise enough that the person doing
the real install is following steps rather than improvising.

Nothing here is engineering-complete until a non-developer has done it.

## Boundary conditions

- Run against a **disposable installation** and a **read-only** WooCommerce key
  until the final cutover. Never point a drill at the owner's live books.
- The store's live data is real business information. Use it under the same privacy
  rules as any customer data; do not copy it into bug reports, screenshots or
  fixtures.
- Do not enter real records anywhere until a backup and a verified restore have both
  been demonstrated on that installation.
- Provider terms govern. Confirm the WooCommerce REST key is scoped and revocable.
- Where a drill fails, record it and stop. A drill that is "mostly fine" is a drill
  that failed.

## Build order

1. **Store preparation checklist.** The store-side work that gates everything, as a
   document the owner can execute: a SKU on every product and every variation;
   per-variation stock management confirmed and counted; a scoped read-only REST key
   created. Note the observed catalog state as of 2026-09-01 — three products on
   `/shop/`, two returned by the public Store API, no SKUs anywhere — and have the
   owner reconcile that discrepancy before import.
2. **Connect and import.** Connect the store in manual-review mode. Import the
   catalog, approve each match, create inventory items with their account mappings
   and default location, ingest approved images. Record how long it actually takes,
   because that number is what tells the owner whether the range can grow.
3. **Tax configuration.** GST/HST and provincial registration with numbers and
   effective dates. Map every WooCommerce tax rate to a PennyWise tax code through
   import rules. Verify a sample order's tax matches the store's own calculation to
   the cent. Confirm and document the Quebec position — the build makes no QST or
   Revenu Québec completeness claim.
4. **Opening balances.** Migrate through the switching centre in the documented
   order: chart of accounts, contacts, products, opening balances, open receivables
   and payables, opening inventory quantities. Reconcile trial balance, AR, AP and
   inventory control against the previous system and record the agreement.
5. **The whole path, once.** A real order from the store, through the inbox, to a
   reviewed and posted invoice, to a picking slip, to a picked and packed parcel, to
   a purchased and printed label, to a recorded shipment — with inventory, tax and
   cost of goods correct at the end. This single trace is the phase's core evidence.
6. **Drills.** Backup and restore. Restart. Upgrade over an install. Uninstall
   preserving data. A refund. A short pick. A cancelled order arriving after
   posting. Each with a recorded result.
7. **Human acceptance.** A non-developer completes the owner scripts in
   `docs/USER_ACCEPTANCE_SCRIPTS.md` unaided, plus keyboard-only, screen-reader,
   200% zoom, high-contrast and reduced-motion passes — the human accessibility work
   the release evidence has always listed as outstanding.
8. **Cutover runbook.** Ordered steps for the real install, with the point of no
   return marked, a rollback for each step, and the weekly operating routine the
   owner will actually follow: what to review, what to reconcile, what to check.

## Acceptance

- Every drill in step 6 passes and is recorded with its result.
- The end-to-end trace in step 5 is complete, with matching figures at each stage.
- Trial balance, AR, AP and inventory control agree with the previous system at
  cutover and the evidence is retained.
- A non-developer completes the acceptance scripts without assistance.
- The cutover runbook exists and has been followed once on a disposable machine.
- Full quality gate passes.

## Out of scope

The real cutover itself — that is an owner decision, taken after this evidence
exists. Etsy. Multi-company. Anything not required to run this one store.
