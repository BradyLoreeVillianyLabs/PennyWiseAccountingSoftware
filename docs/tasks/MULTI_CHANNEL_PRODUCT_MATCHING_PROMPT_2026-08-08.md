# Multi-channel product matching implementation record

This task extends ClearLedger's existing `CatalogMappingService` and connector
review workflow. It keeps the immutable external catalog records, tenant-scoped
connector mappings, explicit human confirmation, and existing tax/accounting
posting boundaries as the source of truth.

The implementation adds explainable, versioned matching evidence: source-aware
SKU comparison, matched title/description tokens, hard variant and packaging
conflicts, deterministic decision states, and a best-candidate margin. These
signals are review evidence only; fuzzy evidence never confirms a mapping or
posts a ledger entry. Confirmed mappings continue to synchronize only through
the existing audited connector mapping path.

Approved aliases and prefix/suffix rules remain source-scoped configuration and
must be validated, collision-checked, audited, and explicitly confirmed before
they can affect future imports. Imported values remain immutable source
evidence, while the central tax engine is called only after a product/variant
has been resolved by the existing accounting workflow.

Verification for this task must include the focused catalog matcher tests,
connector/inventory integration tests, formatting, lint, type checking, build,
and the repository release gate. Do not claim a fuzzy match is certain and do
not bypass posting or tax-domain services.
