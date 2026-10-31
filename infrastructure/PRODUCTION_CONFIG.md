# Production configuration contract

The API already fails closed when production OIDC, storage, scanning, email,
payment, webhook-rate-limit, request-rate-limit, and constrained database
adapters are not injected. `scripts/verify-production-config.mjs` provides the
deployment gate for the remaining environment and owner-evidence contract.

Run it from a deployment environment with `NODE_ENV=production`:

```powershell
node scripts/verify-production-config.mjs
```

The check validates required non-secret names, HTTPS origins, live payment mode,
Canadian `ca-central-1` data-region declaration, adapter readiness, and ISO
timestamps for the backup/restore drill, security review, and legal/privacy
review. It also requires the secret internal analytics key used only by the
thresholded, organization-anonymous funnel endpoint. It never prints secret
values.

`PRODUCTION_ADAPTERS_READY=true` is an attestation, not a substitute for
configuration. Set it only after the actual managed storage, malware scanner,
email, payment, shared rate limiter, OIDC/MFA, database pooler/RLS, monitoring,
and backup controls pass their runbooks.

Health endpoints:

- `GET /health` is a process liveness check.
- `GET /ready` verifies database reachability and returns HTTP 503 when the
  database is unavailable. It does not expose credentials or tenant data.
- `GET /internal/product-events/funnel` requires the internal analytics key
  and returns only event counts and organization counts at or above the
  five-event threshold. It never returns organization ids or event payloads.

External owners must still complete provider sandbox/live smoke tests, backup
restore evidence, incident/rollback drills, penetration/security review, and
legal/privacy approval before general availability.
