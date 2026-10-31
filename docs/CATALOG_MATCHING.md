# Multi-channel catalog matching

ClearLedger keeps the channel's product and variant IDs, raw SKU, title,
description, identifiers, and variant signature as immutable source evidence.
Matching is scoped to the organization and connector installation. A SKU from
two stores is therefore not treated as the same identity by accident.

## Review hierarchy

The existing catalog review service ranks evidence in this order:

1. stable external product/variant identity already linked by the connector;
2. an explicitly approved source SKU alias;
3. exact GTIN or manufacturer part number;
4. source-aware exact SKU (with source case semantics preserved);
5. an explicitly approved anchored prefix/suffix rule;
6. bounded nearest-SKU, title, and description suggestions.

Approved aliases and patterns are stored inside the server-managed connector
mapping namespaces. They require the integration and product permissions,
validate the target, preserve an approval actor/time, and are never accepted
through the generic connector mapping editor. Prefix/suffix rules are
structured rather than arbitrary substring matching and use a deterministic
base-SKU extraction function.

Every candidate includes `algorithmVersion`, `matchMethod`, decision state,
matched words, conflicts, and a best/second-candidate margin. The states are
`AUTO_MATCH_CANDIDATE`, `SUGGESTED`, `AMBIGUOUS`, and `UNMATCHED`. The first
state means the evidence is deterministic, not that posting is authorized:
`autoConfirmEligible` remains false and a user must explicitly approve the
candidate. A duplicate identifier, variant/pack conflict, or close score
margin remains ambiguous and cannot reach the ledger.

Tax calculation and accounting posting remain downstream domain operations.
Source tax values remain visible evidence; fuzzy product text cannot choose a
tax code, account, inventory asset, or journal destination.
