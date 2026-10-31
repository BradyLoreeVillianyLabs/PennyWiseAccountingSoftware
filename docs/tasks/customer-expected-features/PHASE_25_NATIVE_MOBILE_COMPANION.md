# Phase 25 Codex Task — Native Mobile Companion

This phase is deliberately conditional. Execute only after Phase 24 acceptance,
at least 20 active organizations have used the Phase 18 PWA for 60 days,
measured evidence shows the PWA cannot satisfy high-value field workflows, the
owner approves the supported platforms, and the owner explicitly authorizes
Phase 25.

## Objective

Build the smallest native companion that resolves proven PWA limitations. It
must use the same public/domain APIs and contain no independent accounting
engine.

## Pre-build evidence gate

Before writing application code, produce and obtain owner approval for a short
decision record containing:

- affected personas and top failed PWA tasks;
- usage, support, reliability, camera/upload, notification, and offline data;
- platform split and accessibility needs;
- native capability required for each task;
- cost of improving the PWA instead;
- initial platform(s), feature list, security model, and maintenance budget.

If the evidence does not justify native development, improve the PWA, record the
decision, and stop this phase without creating native scaffolding.

## Allowed initial scope

- OIDC sign-in and organization switching.
- Receipt/document camera capture and upload queue.
- Time timer/manual entry, mileage draft, project/customer lookup.
- Review/approval queues permitted by the user's organization role.
- Invoice/estimate status lookup and secure share action.
- Push notifications for assigned approvals, failed uploads, consent expiry, and
  user-configured reminders.
- Offline encrypted drafts and queued uploads with visible sync/conflict state.

## Safety and architecture

- Use Phase 22 versioned APIs and scopes. Do not connect to PostgreSQL or embed
  posting, tax, inventory valuation, entitlement, or reconciliation logic.
- Never post, approve, send, allocate, refund, or change permissions offline.
- Store tokens in platform secure storage; use PKCE, short-lived access,
  revocation, device registration, remote sign-out, screen privacy, and minimal
  telemetry.
- Cache the minimum data needed; encrypt sensitive drafts; exclude reports,
  payment pages, and broad ledgers; wipe on sign-out/revocation/organization
  removal.
- Meet platform accessibility guidance and define supported OS versions,
  release signing, dependency response, privacy declarations, and store-review
  operations.

## Efficiency constraints

Prefer one cross-platform codebase only if it satisfies camera, secure storage,
accessibility, background upload, and release requirements. Build the
owner-approved smallest platform first. Do not chase desktop feature parity.

## Tests and acceptance

- API contract tests shared with web, device-token/session lifecycle, RLS,
  organization switching, and revoked-access tests.
- Offline draft, encrypted storage, upload retry/deduplication, low storage,
  permission denial, background interruption, and conflict tests.
- Real-device camera, notification, accessibility, performance, and supported
  OS matrix.
- Mobile application security review and store privacy-data verification.
- E2E proving capture/time/review workflows affect the books only through the
  existing server-side services and exactly once.

Acceptance requires measurable improvement over the PWA on the approved tasks,
no client-side accounting authority, and a sustainable signed release process.

Write the Phase 25 completion report, update current phase, and stop.
