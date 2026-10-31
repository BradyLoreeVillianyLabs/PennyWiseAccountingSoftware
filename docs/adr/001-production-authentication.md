# ADR 001: Production Authentication

## Status

Accepted and implemented in Phase 2.

## Context

Phase 1 used a development identity adapter so ledger work could be tested before production identity was authorized. Phase 2 requires an OIDC boundary without introducing custom password storage.

## Decision

- Production authentication uses an OIDC-compatible identity provider through authorization code flow, PKCE, nonce, one-time hashed state, discovery, JWKS signature validation, issuer/audience checks, and verified email claims.
- The local development identity adapter remains development-only and must fail closed in production.
- Sessions use opaque random tokens hashed at rest, a 15-minute idle lifetime, an 8-hour absolute lifetime, rolling activity, controlled token rotation, secure cookie settings, origin-based CSRF checks, and server-side revocation.
- Email verification is required before a user can administer organizations or accept production invitations.
- Invitation acceptance binds the normalized intended email address to the authenticated verified user and audits the invitation, role, organization, actor, and request origin without storing the raw token.
- Account recovery must use provider-backed, time-limited, single-use flows and must invalidate active sessions after recovery.
- MFA is required for OIDC owners, administrators, accountants, and bookkeepers before tenant access, and for any OIDC user creating an organization. Providers communicate MFA through `amr`.
- Membership administration requires authentication within the previous 10 minutes. Reauthentication rotates the session token and must resolve to the same provider-linked user.
- Access revocation must take effect immediately for organization membership removal, role downgrade, account disablement, and session revocation.
- Authentication and authorization events must be audited with actor, organization when applicable, target, action, result, request id, IP address, user agent, and timestamp.

## Implementation

- `IdentityAdapter` isolates production and development identities; production construction rejects the development adapter.
- One normalized issuer/subject pair links to one internal user. Provider access, refresh, and ID tokens are never persisted or returned to the browser.
- Provider-backed recovery revokes all existing sessions before issuing a replacement.
- Role changes revoke the affected user's active sessions; membership revocation clears the affected organization from active sessions and active membership is checked on every tenant request.
- Authentication audit records are append-only and include outcome, actor/target/session where known, request id, IP address, user agent, and timestamp.

## Consequences

- Deployments must configure an approved OIDC provider, recovery endpoint, MFA policy, HTTPS, and edge rate limiting.
- The development identity form and header adapter are local-test facilities only and cannot run when `NODE_ENV=production`.
- No payment, banking, invoicing, inventory, customer, or Phase 3 functionality is authorized by this decision.
