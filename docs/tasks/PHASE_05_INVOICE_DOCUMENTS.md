# Phase 5: Invoice Documents

Execute Phase 5 only. Do not begin payments, vendors, bills, banking, inventory, or dashboard work.

## Scope

- Versioned, constrained invoice templates and organization configuration.
- Immutable posted-invoice render snapshots.
- Safe HTML preview and deterministic server-side PDF generation.
- Object-storage adapter boundary with organization-isolated keys.
- Asynchronous email queueing, provider delivery state, retry, failure, resend, and audit events.
- Opaque, hashed, expiring and revocable public invoice links with secure headers.
- Optional customer-facing attachments with allow-listed types, byte checks, size limits, scanner adapter, and issued-invoice immutability.
- Permission-checked internal routes and token-scoped public routes.

## Required gates

- All eight templates render and preserve required identity and totals.
- Customer and item changes cannot alter an issued invoice render snapshot.
- PDF output is deterministic for identical render input and has integrity metadata.
- Email delivery is idempotent, asynchronous through the outbox, retryable, and auditable.
- Public links store only token hashes, enforce expiry/revocation/rate limits, and cannot cross tenants or expose internal notes.
- Hostile text is escaped; arbitrary HTML, JavaScript, CSS, and executable attachments are rejected.
- Verification must include formatting, linting, type checking, Prisma validation/generation, clean migrations, unit tests, integration tests, build, and rollback verification.

## Exit rule

Stop after the Phase 5 completion report. Phase 6 requires separate owner approval and an explicit task.
