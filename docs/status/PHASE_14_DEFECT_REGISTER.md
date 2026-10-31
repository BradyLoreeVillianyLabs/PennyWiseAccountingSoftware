# Phase 14 Defect Register

## Resolved

| Severity | Finding                                                                                                                    | Disposition                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | Dynamic results and errors were not consistently announced to assistive technology.                                        | Resolved with live result regions, assertive errors, error focus, named tables, column scopes, and textarea keyboard focus styling.                                                       |
| Medium   | The local development identity adapter did not forward the selected organization ID to tenant-scoped API calls.            | Resolved by forwarding the selected organization header for local-only identity requests.                                                                                                 |
| Medium   | Customer, product, and receivables UI mappings did not match API contracts.                                                | Resolved with contract-aligned active filters and `subledgerBalanceMinor` display.                                                                                                        |
| Medium   | Applying an account preset left bank, purchase, inventory, or payment controls with stale account options.                 | Resolved by refreshing every account-dependent workspace; browser E2E covers the bank-account selector after preset application.                                                          |
| Medium   | Inventory quantity reads could leak Prisma `bigint` fields and fail JSON serialization.                                    | Resolved with an explicit exact-string DTO and an integration regression test.                                                                                                            |
| Medium   | The trial-balance report performed account-by-account ledger scans and exceeded its p95 target under the capacity fixture. | Resolved with a single tenant-scoped aggregate and a forward RLS policy optimization that preserves mandatory organization and membership checks. Fresh-database report p95 is `9.25 ms`. |
| Medium   | Browser matrix and production-like capacity evidence were incomplete.                                                      | Resolved with five-engine Playwright workflow coverage and a PostgreSQL-backed capacity profile.                                                                                          |
| Low      | Browser coverage only asserted payment and reconciliation controls rather than completing their financial workflow.        | Resolved with a five-engine, database-backed payment allocation, bank-deposit match, and zero-difference reconciliation completion journey.                                               |
| Low      | The static web verifier expected an obsolete narrow preset-refresh sequence.                                               | Resolved to require the full account-dependent refresh sequence.                                                                                                                          |

## Remaining Release Activities

| Category   | Activity                                                                                                                              | Owner                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| UAT        | Execute and sign off the controlled-beta scripts, including assistive technology, keyboard-only, and 200% zoom scenarios.             | Product owner and beta users |
| Operations | Configure production OIDC, managed PostgreSQL/RLS role separation, storage, email, malware scanning, monitoring, alerts, and backups. | Deployment owner             |
| Governance | Review legal, privacy, retention, and public notices before general availability.                                                     | Legal and privacy owners     |

No release blocker or high-severity defect from the historical Phase 14 scope remains
open. The statement in the original 2026-07-25 register that Phase 15 had not started is
superseded: subsequent phases and the public-beta completion program are recorded in
`CURRENT_PHASE.md`, `PUBLIC_BETA_RELEASE_EVIDENCE_2026-08-03.md`, and
`../tasks/OWNER_REQUEST_LEDGER_2026-08-03.md`. Final post-merge verification and human
UAT remain release activities; this register does not claim that the final public-beta
archive has passed them.
