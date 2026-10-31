# ClearLedger Threat Model

## Scope and Assets

This Phase 13 refresh covers production identity and sessions, tenant data and
RLS, the posted ledger, payments, banking imports, documents, exports, privacy
operations, PostgreSQL backups, CI, and deployment configuration.

Critical assets are tenant financial records and attachments; authentication
sessions, OIDC state, invitation and export tokens; payment-account references
and webhook evidence; audit evidence; database credentials and backups; and CI
artifacts and dependency metadata. Card data and online-banking credentials
are intentionally outside ClearLedger storage.

## Trust Boundaries

- Browsers, public invoice viewers, uploaded files, CSV/OFX data, and webhooks
  are untrusted.
- OIDC discovery, JWKS, payment providers, email, object storage, malware
  scanning, and backup storage are external trusted services with scoped
  credentials.
- API authorization is mandatory; PostgreSQL forced RLS and tenant-composite
  foreign keys independently constrain tenant data.
- The runtime role is a `NOINHERIT`, `NOBYPASSRLS` role. Migration and
  maintenance credentials are separate and must not serve API traffic.
- Production workers consume committed outbox events and use the same tenant
  transaction boundaries; they do not receive broad database access.

## Threats, Controls, and Residual Risk

| Threat                                              | Primary controls                                                                                                                                                                               | Residual risk                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Account takeover, fixation, and credential stuffing | Managed OIDC, PKCE/nonce/state, verified email, MFA for finance roles, hashed rotating sessions, idle/absolute expiry, revocation, recent authentication, scoped auth rate limits              | Provider compromise and account recovery assurance require provider monitoring       |
| Cross-tenant access and IDOR                        | Membership-derived organization context, object ownership filters, forced RLS, tenant-composite keys, pool-context reset, cross-tenant integration tests                                       | Privileged migration credentials remain an operational high-value target             |
| Privilege escalation and insider misuse             | Default-deny permissions, final-owner guard, MFA/recent-auth checks, append-only audit history, access reviews                                                                                 | Owner abuse requires organizational controls and audit review                        |
| Injection, deserialization, and mass assignment     | Zod strict schemas, Prisma parameters, constrained raw SQL, type parsing, no dynamic shell/database identifiers without allowlists                                                             | Future adapters must preserve these boundaries                                       |
| XSS, CSRF, clickjacking, and unsafe redirects       | Escaped render data, CSP, frame denial, origin checks for cookie writes, secure cookies, same-origin return URLs                                                                               | Inline styles are retained only for generated documents/public invoices              |
| File, PDF, archive, and storage attacks             | MIME/byte checks, image dimension checks, active-content rejection, malware-scanner interface, tenant-scoped storage keys, attachment authorization, archive path sanitization                 | Production scanner, renderer sandbox, and object storage are deployment requirements |
| Webhook spoofing, replay, and payment abuse         | Raw-body verification, timestamp/signature checks, provider account lookup hashes, unique provider event IDs, durable outbox, idempotent financial effects, webhook and public-checkout limits | Live provider configuration needs test-account and operational validation            |
| Export exfiltration                                 | Strong permission and recent-auth checks, hash-only expiring download token, archive checksum, no-store responses, safe attachment inclusion, audit events                                     | Authorized users can still export their permitted organization data                  |
| Migration or backup abuse                           | Separate runtime/migration roles, rollback and restore scripts restricted to disposable database names, forward-only production policy, encrypted-backup runbook                               | Managed backup encryption, access control, and PITR are infrastructure-owned         |
| Races and denial of service                         | Database uniqueness/row locks/idempotency, bounded parsers and request bodies, route-aware rate-limit interface, transactions and outbox                                                       | Shared production rate limiter and load tests remain deployment prerequisites        |
| Dependency compromise                               | Frozen lockfile, pinned CI actions, dependency scan, Dependabot configuration                                                                                                                  | Vulnerability feeds and human review still required                                  |

## Review Triggers

Refresh this model before adding a provider integration, new public route,
tenant-owned table, worker, data export, file type, privileged role, migration
class, or production storage/backup provider. Record critical or high findings
in the Phase 13 findings register and block release until they are resolved.
