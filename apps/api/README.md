# API Application

This folder contains the ledger and Phase 2 identity/tenancy API.

Implemented responsibilities:

- OIDC authorization-code authentication with PKCE, discovery, JWKS validation, and verified email;
- hashed, idle/absolute-limited sessions with rotation and revocation;
- a localhost development identity adapter that is rejected in production;
- invitation, membership, role-change, organization-switching, and security audit workflows;
- centralized default-deny permissions and recent-authentication checks;
- transaction-local actor/organization context under the `clearledger_runtime` PostgreSQL role;
- account creation, listing, patching, archival, and control-account protections;
- fiscal-period creation, listing, close, and reopen workflows;
- idempotent journal posting and reversal;
- append-only audit events and transactional outbox records;
- trial balance and general ledger reports from posted journal lines;
- OpenAPI document at `GET /openapi.json`.
- a gated `GET /v1/demo-company/capabilities` contract and idempotent
  `POST /v1/demo-company` fixture workflow for one obviously fictional,
  isolated Canadian service company per interactive user.

Controllers validate transport concerns and delegate to domain services. Accounting calculations stay in `packages/accounting-core`.

Production startup validates that `DATABASE_URL` authenticates as a dedicated `NOINHERIT` login with no elevated PostgreSQL capabilities or public-table ownership. That login must be granted membership in the migration-created `clearledger_runtime` role. OIDC production variables are listed in `.env.example`.

The fictional demo-company creator is available only outside production,
including controlled local shares. Production never registers its write route.
The capability route remains read-only and reports `available: false` in
production. The create request requires `Idempotency-Key`; repeated requests
reuse the same fixture organization instead of creating tenant litter. Creation
does not switch the caller's active organization; the client must validate the
completion response and explicitly switch.
