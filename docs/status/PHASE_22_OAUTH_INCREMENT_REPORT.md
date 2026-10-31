# Phase 22 OAuth Installation Increment

Date: 2026-07-26

## Delivered

- Organization-owned OAuth client registrations with one-time client secrets,
  hashed secrets, exact registered redirect URIs, idempotent creation, audit
  records, and outbox events.
- Explicit organization consent route using Authorization Code + S256 PKCE.
  Authorization codes are opaque, hashed, single-use, and expire after five
  minutes.
- Opaque, hashed OAuth access and refresh tokens. Access tokens expire after
  one hour; refresh tokens rotate atomically within a token family and expire
  after thirty days.
- OAuth bearer authentication bound to an active user, membership, client, and
  organization. Delegated scopes are enforced by the shared authorization
  service.
- Client revocation invalidates all issued access and refresh tokens. OAuth
  clients cannot be granted integration administration, webhook control,
  high-risk accounting posting, payments, sensitive imports, or exports.
- OAuth client-secret rotation preserves the public client ID, invalidates the
  replaced secret immediately, records an audit/outbox event, and uses the
  tenant idempotency ledger without persisting a replacement secret. Replays
  return a null secret.
- The OpenAPI v1 document now has an explicit public version and matching
  response header. `DEVELOPER_API_V1.md` defines the supported surface,
  compatibility, opaque identifiers, authentication, scopes, pagination,
  idempotency, limits, and webhook expectations.
- The provider-neutral connector runtime stores credentials only as encrypted
  ciphertext, requires explicit adapter registration, keeps consent and a
  maximum 90-day completed backfill range, and records health/log evidence
  without provider secrets. Production refuses to start an enabled connector
  adapter without an injected protector or deployment-managed encryption
  secret. No provider adapter is enabled by default.
- Connector adapters now have shared tenant-scoped checkpoint persistence,
  redacted conflict open/list/resolve lifecycle, and bounded operational log
  retrieval. Conflict and checkpoint payloads redact credential-like fields
  before persistence.
- PostgreSQL migration and forced RLS policies that permit only tenant work or
  the narrowly scoped hash lookup required for client, code, access-token, and
  refresh-token exchange.

## Local evidence

- `src/phase22-oauth.integration.test.ts` verifies client-secret one-time
  display, consent and PKCE, code exchange, delegated access, scope denial,
  client-secret rotation/replay, old-secret rejection, refresh rotation,
  old-refresh rejection, and revocation.
- `src/phase22-connector-runtime.integration.test.ts` verifies an approved
  test adapter's credential encryption, consent, 90-day backfill bounds,
  health evidence, checkpoint/conflict state, redaction, conflict resolution,
  operational logs, and rejection of an unapproved provider.
- Type checking, API linting, schema validation, build, security checks, and
  focused PostgreSQL integration evidence pass. The full PostgreSQL suite is
  not claimed here because the local command window expired before completion.

## Not a Phase 22 acceptance claim

This is an increment, not a complete Phase 22 acceptance. Provider-specific
connectors, public developer onboarding, published developer documentation,
production shared rate-limiter evidence, and external security/legal review
remain required before broad production release.
