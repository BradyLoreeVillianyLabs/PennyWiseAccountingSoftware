# Phase 24 Codex Task — French Canada and Quebec Tax Readiness

Execute only after Phase 23 acceptance, professional Canadian tax/legal review
is commissioned, and the owner explicitly authorizes this phase.

## Objective

Support French-speaking Canadian customers and professionally validated Quebec
GST/QST workflows while keeping tax rules effective-dated, explainable, and
correctable.

## Requirements

### Internationalization

- Replace embedded customer-facing text with typed message keys and locale-aware
  formatting. English Canada remains the fallback.
- Deliver complete `fr-CA` UI, email, public estimate/invoice/payment/receipt,
  PDF/print, help, validation, accessibility labels, and legal/consent versions.
- Support organization document language and per-contact communication language
  without translating stored customer-authored content.
- Add translation completeness tooling, pseudo-locale layout tests, and a
  reviewed terminology glossary for accounting and tax.

### Quebec and provincial tax

- Extend effective-dated tax definitions for validated Quebec GST/QST
  registration, components, recoverability, inclusive/exclusive calculation,
  exemptions, zero rating, credits/refunds, and reporting periods.
- Preserve exact component rounding and immutable tax snapshots on posted
  documents. Corrections use the existing reversal/credit workflows.
- Add province-aware setup guidance and a maintained Canadian tax-capability
  matrix. Unsupported situations must be explicit.
- Add filing-ready GST/HST/QST summaries, detailed transaction evidence,
  adjustments, control-account reconciliations, and accountant export packages.
  Clearly label them as preparation tools.
- Record the source, reviewer, effective date, approval, and supersession of each
  tax rule/configuration artifact.

## Non-goals

Do not submit tax returns, communicate with CRA/Revenu Québec filing services,
provide tax advice, infer place-of-supply for ambiguous facts, support
multi-country accounting, or market unreviewed tax behavior as compliant.

## Tests and acceptance

- Golden tests supplied/approved by a Canadian tax professional for Quebec and
  supported province scenarios, including rounding, credits, partial payments,
  refunds, deposits, bad debt/corrections, and period close.
- Tax control reconciliation to posted journals and subledgers.
- Translation completeness, no-key leakage, plural/date/number/currency,
  expansion, PDF pagination, email, screen-reader, and bilingual browser tests.
- Locale-switch and per-contact language tests without changing stored amounts,
  dates, identifiers, or posting results.
- Documentation of unsupported cases and owner sign-off on professional review.

Acceptance requires accounting-identical results across languages, approved
Quebec fixtures, complete French critical journeys, and no implication that
ClearLedger files returns or gives advice.

Write the Phase 24 completion report, update current phase, and stop.
