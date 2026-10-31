# U3 — Security, team and developer settings

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Files:** `apps/web/app.js`, `apps/web/index.html`, `apps/web/styles.css`
**Closes:** the security, team and developer rows in `ASSESSMENT.md` section 3, and the UI
half of R3
**Effort:** M
**Depends on:** nothing. Outbound webhook delivery itself needs I6.

## Context — routes with no UI

- **Sessions:** `GET /v1/auth/sessions`, `POST /v1/auth/sessions/:id/revoke`.
- **Team:** `POST /v1/organizations/current/invitations/:id/revoke`.
- **API credentials:** list, create, revoke, rotate
  (`/v1/organizations/current/api-credentials…`).
- **OAuth clients:** list, create, revoke, rotate
  (`/v1/organizations/current/oauth-clients…`).
- **Outbound webhooks:** list, create, rotate, disable, enable, deliveries, replay
  (`/v1/organizations/current/webhooks…`). `dispatch` is handled by the I6 runner, not by a
  button.
- **Migration runs:** list, detail, transition (`/v1/migration-runs…`). Check whether the
  Switching Centre should show them.

**Deliberately excluded (protocol or provider endpoints, not UI gaps):**

- `/v1/auth/sign-in|recover|reauthenticate|callback`, `/v1/auth/session/renew`
- `/v1/oauth/authorize|token`
- `/v1/webhooks/payments/*`
- `/v1/email-connections/callback`
- `/v1/commercial/*` (billing control plane; confirm with the owner)

## Tasks

1. **"Signed-in devices"** under the user's profile: the current session plus others, each
   with its last activity. Revoke one, or all others.
2. **Team:** show pending invitations with **Revoke**.
3. **Developer settings,** behind an "Advanced" disclosure and visible to owners and admins
   only:
   - **API credentials:** a scopes picker and an expiry.
     - The secret is shown **once**, with copy and an explicit warning.
     - Rotation says clearly whether an overlap window exists, per the service contract.
     - Revocation requires confirmation.
   - **OAuth clients:** exact redirect URIs, a one-time client secret, rotation and
     revocation.
   - **Webhook endpoints:**
     - Choose event types. The signing secret is shown once, and can be rotated.
     - Disable and enable an endpoint.
     - A delivery log with status, attempts and last error, plus **Replay** for a
       dead-lettered delivery.
4. **Migration runs:** a read-only history in the Switching Centre, with the transitions
   the service permits.

## Constraints

- **Reauthentication:** required to create or rotate secrets, where `permissions.ts` or the
  session service requires it.
- **Secrets:** never re-displayed, never logged, and never exported.
- **Auditing:** every create, rotate and revoke is audited. The service already does this;
  make sure the UI never bypasses it.

## Acceptance criteria

- **API credential (e2e):** create one → call a scoped endpoint from the test with the
  secret → revoke it → the next call returns 401.
- **Webhooks (e2e):** create an endpoint → trigger an event → the delivery appears (with
  I6) → replay a failed delivery against a local receiver.
- **Sessions:** revoking a session ends that browser context's access.
- **Invitations:** a revoked invitation token can no longer be accepted.

## Out of scope

- Custom roles and effective-permission preview. These are QuickBooks-gap items that
  deserve their own prompt.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
