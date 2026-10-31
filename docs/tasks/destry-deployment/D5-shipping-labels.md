# D5 — Shipping labels on the operator's own carrier accounts

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/COMMERCE_PROVIDER_SETUP.md` — the established provider-credential pattern
4. `packages/db/prisma/schema.prisma` — `ConnectorInstallation`
   (`credentialCiphertext`, `credentialVersion`), and the D2 address model
5. `docs/SECURITY_AND_COMPLIANCE.md`
6. The primary API documentation for each carrier being implemented
7. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — add a shipping entry

## Exact intention

Let an operator buy and print a shipping label from the sale they are already
looking at, on their own carrier account, and record what it cost in the books.

Carrier choice varies by operator and by location: a Canadian business ships Canada
Post, a US business ships USPS or FedEx, and some use more than one and choose per
parcel. So this is a multi-carrier adapter behind one interface, not an integration
with a favourite.

**PennyWise never buys the postage.** Each operator connects their own Canada Post,
USPS or FedEx account and labels bill directly to it. This is not a preference: the
product's stated boundary is that it "does not collect, transfer, or refund money,"
and reselling postage would put PennyWise in the money path, holding balances and
refunding voids. Bring-your-own-account also matches how commerce credentials
already work, and gives each operator their own negotiated rates.

The label itself comes back from the carrier as PDF or ZPL. PennyWise prints it; it
does not draw it.

## Boundary conditions

- Credentials are operator-supplied and encrypted with the existing
  `CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET` pattern. Never logged, never exported,
  never included in a backup that leaves the machine unencrypted.
- No live call without credentials. Build the adapter boundary, fixtures, mocks and
  tests, and document the exact environment variables required. A fixture must
  never be presented as a live capability.
- Buying a label spends the operator's money. It requires explicit confirmation
  showing carrier, service, and quoted cost. Never automatic, never batched without
  per-parcel confirmation.
- Label purchase is idempotent per shipment. A retry after a timeout must not buy
  two labels. Where the carrier supports it, use their idempotency mechanism; where
  it does not, reconcile before retrying.
- Voids are carrier-governed and time-limited. Record the attempt and the carrier's
  answer; never assume a void succeeded.
- PennyWise does not classify goods, calculate duty, or advise on customs
  treatment. It transmits operator-supplied HS codes and origin from D2, and says
  so.
- Shipping cost posts through existing expense workflows. No new posting mechanism.

## Build order

1. **Carrier adapter interface.** One interface covering: validate credentials,
   validate an address, quote available services for a parcel, buy a label, void a
   label, fetch tracking. Model the vocabulary neutrally — service levels, parcel
   dimensions, weights — and translate per carrier. Get this shape right before
   implementing any carrier; everything after depends on it.
2. **Shipment model.** `CarrierAccount` (per organization, per carrier, encrypted
   credentials, active flag), `Shipment`, `ShipmentParcel`, `ShipmentLabel`
   (document reference, format), `TrackingEvent`. Link a shipment to its sale and to
   the inventory movement that relieved the stock.
3. **Fixture carrier.** A complete fake carrier implementing the interface, with
   recorded fixtures for quote, buy, void, track, and every documented failure mode.
   Every subsequent carrier is tested against the same suite. This is what makes the
   work verifiable without credentials.
4. **First real carrier.** Implement one — Canada Post for this deployment — against
   its primary documentation, in a sandbox or test account. Record in the research
   matrix what the API actually does, including its failure modes and rate limits.
5. **Label printing.** Store the returned label as a document; print through the
   browser to the operator's printer. Support both PDF and, where the carrier offers
   it, ZPL for thermal printers. Let the operator set a default label format and
   size once, in settings, rather than choosing per label.
6. **Customs for cross-border.** Where origin and destination countries differ,
   require HS code, origin and declared value per line from D2, refuse clearly when
   they are missing, and transmit them in the carrier's customs structure. Present
   the declared values for review before purchase; the operator is the declarant.
7. **Second and third carriers.** USPS and FedEx against the same interface and the
   same fixture suite. Each gets its own research-matrix record.

## Acceptance

- The fixture carrier passes the full adapter suite including every failure mode.
- One real carrier quotes, buys, prints, voids and tracks against a sandbox account,
  with credentials supplied through the encrypted store and never logged.
- A duplicate purchase attempt after a simulated timeout yields one label.
- A cross-border shipment missing HS code or origin refuses with a specific message
  and buys nothing.
- Purchased label cost posts as an expense linked to the shipment and its sale.
- Adding the second carrier requires no change to the interface.
- Full quality gate passes, including `corepack pnpm test:research` with the new
  shipping entry.

## Out of scope

PennyWise holding postage balances, reselling postage, or refunding it. Rate
shopping across carriers as an automated decision. Returns labels. Third-party
aggregators — if one is later chosen, it implements this same interface. Duty
calculation or landed-cost quoting.
