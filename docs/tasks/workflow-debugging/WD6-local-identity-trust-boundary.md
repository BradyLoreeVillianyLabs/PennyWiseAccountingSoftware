# WD6 — Packaged local identity: who can act as the owner?

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** api / web (`apps/api/src`, `apps/web/serve.mjs`). Can run beside the native lane.
**Effort:** M
**Severity:** Medium–High if confirmed. Unproven.
**Depends on:** nothing.

## Why (verified code facts)

- The launcher starts the API with `NODE_ENV: "development"` and
  `CLEARLEDGER_BETA_RUNTIME: "true"` (`launcher.cjs:724-728`).
- `buildApp` uses `SessionIdentityAdapter` only when `NODE_ENV === "production"`, and otherwise
  `DevelopmentIdentityAdapter` (`app.ts:498`, `app.ts:534-536`). The comment at `app.ts:525`
  says the packaged beta keeps "its bounded local/share identity" on purpose.
- `DevelopmentIdentityAdapter` (`auth/dev-identity.ts`) authenticates anyone who sends an
  `x-clearledger-user-email` header. It creates that user if they don't exist, and it trusts the
  client-sent `x-clearledger-organization-id`, `x-clearledger-company-id` and
  `x-clearledger-recent-auth-at` headers.
- In `serve.mjs`, `proxyRequest` (`serve.mjs:148`) replaces those headers only when
  `SHARE_IDENTITY_EMAIL` and the share organization are set, which is controlled-share mode. The
  native launcher sets neither. So the proxy forwards the browser's own `x-clearledger-*`
  headers, and it always rewrites `origin` to `appOrigin` (`serve.mjs:177`).
- The API listens on `127.0.0.1:32101` and the web server on `127.0.0.1:32100`.
- At 2026-10-12T18:07:26Z, 14 s after Ready, `launcher.log` recorded `GET /v1/auth/sign-in` → 503. That is `requireOidc` (`app.ts:7042-7046`), "Production sign-in is not configured."

## Questions to answer with tests

Don't assume the answers.

- **Q1.** Can another local process send `x-clearledger-user-email: <owner email>` to `:32101`
  or `:32100` and read or post as the owner? Check whether `docs/THREAT_MODEL.md`, ADR 001 and
  ADR 002 accept that.
- **Q2.** Can a web page open in the owner's browser do the same? Check:
  - **CORS:** does a foreign origin get a successful preflight for custom headers, on the API or
    on the proxy?
  - **DNS rebinding:** does `serve.mjs` validate the `Host` header (`serve.mjs:70` builds the URL
    from it)?
  - **Origin checks:** does the proxy's `origin` rewrite defeat the API's CSRF or Origin checks?
- **Q3.** What else changes because the packaged runtime isn't `production`? For each item,
  state the packaged behaviour and whether it's intended:
  - `demoCompanyAvailableForEnvironment` (`app.ts:1099`);
  - the cookie `Secure` flag (`session-service.ts:305-310`);
  - the `oauth-service.ts:678` branch;
  - the localhost webhook allowance (`webhook-service.ts:589`);
  - the payment guards (`payment-service.ts:103`, `1313`, `1343`, `3275`);
  - the bank-feed test adapter gate (`pennywise-test-bank-feed-adapter.ts:193`).
- **Q4.** What calls `GET /v1/auth/sign-in` in the packaged app, and what does the user see when
  it returns 503? Is it a dead path in local mode?

## Tasks

1. **Write tests that record current behaviour.**
   - Use vitest against `buildApp` with an injected rate limiter, as
     `beta-runtime-security.test.ts` does.
   - Use `node:test` against `serve.mjs`, started on an ephemeral port in front of a stub API.
   - Name every test that shows exposure nobody intended with an `UNINTENDED:` prefix.
2. **Write up the findings** in `docs/status/WD6_LOCAL_IDENTITY_FINDINGS.md`. For each question,
   give a verdict (intended, unintended or unclear), the test that shows it, and the threat-model
   reference.
3. **Stop for an owner decision** if any exposure is unintended.
   - Propose a fix in the findings and draft an ADR under `docs/adr/`. One possible shape:
     - the launcher generates a random local secret at every start and passes it to the API and
       the web server through the environment;
     - the proxy always strips client `x-clearledger-*` headers and adds the secret;
     - the development adapter, in beta runtime, refuses any request without the secret;
     - `serve.mjs` accepts only `127.0.0.1:<port>` and `localhost:<port>` as the `Host`.
   - Don't change authentication or authorization code in this prompt.
4. **Q4 follow-up:** if the UI shows a sign-in path that can't work in local mode, record a small
   follow-up fix in the findings. Don't change the UI here.

## Constraints

- Follow the README's shared rules.
- Send requests only to processes you start on ephemeral ports. Never send them to the owner's
  PennyWise, to any LocalXpose `pennywise*` share, or to any tunnel.
- Write tests and minimal repros only; no exploit tooling.
- Store no real email addresses in fixtures.

## Acceptance criteria

- The findings answer Q1–Q4, each with a test reference.
- No authentication behaviour changes without recorded owner approval.
- `corepack pnpm --filter @clearledger/api test` (or the targeted vitest files) passes, apart from
  intentionally failing `UNINTENDED:` tests. If you mark those as expected failures, explain how
  in the report.
