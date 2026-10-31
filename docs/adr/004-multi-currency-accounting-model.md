# ADR 004: Transaction-Level Multi-Currency Accounting Model

## Status

Accepted for the owner-authorized CAD/USD release on 2026-07-30 and released
under the owner test-evidence rule on 2026-08-02. Production use requires the
organization owner to confirm its functional currency and accounting/tax
settings. A qualified-accountant signature is recommended but is no longer a
ClearLedger product gate. This status does not represent or fabricate
professional approval.

## Context

ClearLedger’s existing ledger is CAD-only at the presentation boundary, while
the approved product direction includes WooCommerce/Etsy sales and future
multi-currency operations. A currency feature that stores only a converted
amount would destroy invoice evidence, create non-reproducible reports, and
make realized versus unrealized FX impossible to audit.

## Decision

Use a dual-amount ledger model. Every applicable source and posted line retains
the original transaction currency/minor amount and an immutable base-currency
minor snapshot. Conversion uses a versioned exponent registry and exact rational
rate snapshots. The base ledger remains the source of truth for statements and
tax reports; transaction amounts are the auditable document evidence.

Monetary positions are explicitly registered and revalued. Foreign cash uses
deterministic receipt-date FIFO carrying-value relief. Revaluation creates
linked unrealized FX journals and an automatic next-period reversal. Backdated
activity makes the affected run stale and blocks close until rerun. Non-monetary
items use their original carrying basis. Unsupported foreign loan/financing
positions fail closed.

The core is provider-independent. WooCommerce and Etsy are separate shadow
ingestion/reconciliation adapters with independent release gates. No connector
may post financial entries without deterministic reconciliation, passing
provider-specific golden tests, and live provider evidence.

Migration policy is forward-only for adopted data. Down SQL is disposable-test
only; after foreign-currency evidence exists, rollback means disablement,
forward repair, or restore, never dropping evidence.

## Consequences

- Existing CAD organizations backfill safely as same-currency records.
- Reporting must distinguish transaction-currency display from base-currency
  totals and disclose the rate snapshot.
- More schema and test coverage are required for rates, exponents, positions,
  revaluation, and allocation residuals.
- Connector launch can be delayed without withholding the accounting core.
- Foreign credit notes, refunds, settlement reversals, direct foreign bank
  categorization, and foreign-bank transfers remain fail-closed until their
  linked position-correction models are implemented.
- The organization owner is accountable for functional-currency, tax,
  rate-source, FIFO, correction, and close-policy settings. Accountant/CPA
  review is recommended but not a mandatory software release gate.

See `docs/tasks/MCFX_00_ACCOUNTING_DECISION_PACKET.md` and the approved
implementation prompts for phase-level acceptance criteria. The superseding
owner evidence decision is recorded in
`docs/OWNER_ACCOUNTING_EVIDENCE_ACCEPTANCE.md`.
