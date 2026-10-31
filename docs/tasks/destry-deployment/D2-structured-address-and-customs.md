# D2 — Structured addresses and customs attributes

Authorized implementation task as of 2026-09-01. D2 is the sole active phase in
`docs/status/CURRENT_PHASE.md`; D3–D6 remain planning artifacts until separately
authorized.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `packages/db/prisma/schema.prisma` — `Customer`, `ProductItem`, `Organization`
4. `docs/ARCHITECTURE.md`
5. `docs/MIGRATION_AND_PORTABILITY.md`
6. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — contacts and inventory entries

## Exact intention

`Customer.billingAddress` and `Customer.serviceAddress` are `Json?`. An
unstructured blob is adequate for printing an address on an invoice and useless
for everything that comes after: a carrier will reject a malformed address, a
customs form needs specific fields in specific formats, and nothing can validate a
shape that has no schema.

This phase replaces the blob with a real address model and adds the two product
attributes that cross-border shipping requires. It ships no user-visible feature on
its own. It exists so that D4 and D5 are possible at all, and it is deliberately
sequenced early because retrofitting an address model after live orders and a
populated catalog is materially harder than doing it now.

Destry Workwear is a Canadian seller shipping Canadian-made apparel to customers in
Canada and the United States, so the cross-border case is the normal case, not an
edge case.

## Boundary conditions

- Existing address data must migrate without loss. Where an existing blob cannot be
  parsed confidently, preserve the original verbatim alongside the structured form
  and mark it for review rather than guessing.
- The migration must be reversible. Provide `down.sql`.
- An address is validated for _structure_, not for deliverability. Carrier address
  verification is D5 and must not be assumed here.
- Country and subdivision use ISO codes — ISO 3166-1 alpha-2 and 3166-2. Do not
  invent an internal vocabulary.
- HS codes are operator-supplied reference data. PennyWise does not classify goods,
  determine duty, or advise on tariff treatment, and the UI must say so plainly.
- Persisted money stays bigint minor units.

## Build order

1. **Address model.** A structured postal address: recipient name, organization,
   two street lines, city, subdivision code, postal code, ISO country, plus phone
   and email where a carrier needs them. Model it so one customer can hold several
   addresses with roles — billing, shipping, service — and a default per role.
2. **Validation.** Per-country structural rules for at minimum CA and US: postal
   code format, required subdivision, required fields. Reject malformed input at
   the API boundary with a message naming the offending field. Keep the rule set in
   one place so more countries are additive.
3. **Migration.** Backfill from the existing `Json?` columns. Parse what parses,
   preserve what does not, and produce a report the operator can work through.
   Nothing is silently dropped or invented.
4. **Product customs attributes.** Add HS tariff code and country of origin to
   `ProductItem`, both optional, both surfaced in the product editor with an
   explanation of what they are for. Add a report listing products missing either,
   so the gap is visible before it blocks a shipment rather than after.
5. **Export and import.** Include the new fields in organization export v3 and in
   the spreadsheet import paths, so the data is portable and can be populated in
   bulk rather than one product at a time.

## Acceptance

- No `Json` address column remains in use for customer addresses.
- Structural validation rejects malformed CA and US addresses at the API boundary
  with a field-level message, and accepts every valid form of both.
- The migration round-trips: `down.sql` restores the prior shape, verified by
  `corepack pnpm db:rollback:verify`.
- Unparseable legacy addresses are preserved and listed for review, never lost.
- Products missing HS code or origin are reportable.
- Full quality gate passes, including PostgreSQL integration tests and
  `corepack pnpm test:research`.

## Out of scope

Carrier address verification. Duty or tax calculation of any kind. Tariff
classification advice. Any shipping or label work — that is D5.
