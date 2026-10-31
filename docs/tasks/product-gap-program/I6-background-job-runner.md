# I6 — A background job runner the product can rely on

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `apps/api/src/index.ts`
- New files under `apps/api/src/jobs/*`
- `payment-outbox-worker.ts`
- `payment-service.ts`, around `816-832`
- `webhook-service.ts`
- `invoice-document-service.ts` and `estimate-email-service.ts` (delivery retries)
- `packages/db/prisma/schema.prisma`, plus a migration for job leases and runs
- `apps/web/app.js`, `apps/web/index.html` (the Automations panel)

**Closes:** G8, R2, R3. Also prepares R6.
**Effort:** L
**Depends on:** nothing.

## Context

- **Nothing runs on a timer.** `index.ts` starts only the HTTP server.
- **Failed payment webhooks are never retried.** _(Corrected in review.)_
  - With `NODE_ENV=production`, webhook processing is deferred with `setImmediate`. A
    failure is caught and left on the durable webhook and outbox rows "for replay"
    (`payment-service.ts:812-828`).
  - With any other `NODE_ENV`, it runs inline in the request. Installed builds set
    `NODE_ENV=development` (`launcher.cjs:724`), so they take the inline path.
  - The replay path, `PaymentOutboxWorker.processPendingWebhookEvents`
    (`payment-outbox-worker.ts:37`), is called **only from tests**
    (`phase4-sales.integration.test.ts:706, 1024, 1088`). A deferred failure therefore
    stays pending for as long as the app runs.
- **Queued payment-receipt emails have no worker either.**
  `PaymentOutboxWorker.processPendingReceiptEmails` (`payment-outbox-worker.ts:78`) is also
  called only from tests.
- **Outbound webhooks never go out on their own.** Signed outbound webhooks are delivered
  only when something calls `POST /v1/organizations/current/webhooks/dispatch`
  (`app.ts:2000`), and nothing does.
- **Payroll due drafts are manual.** They exist only as a route (`app.ts:6230`).
- **Upcoming features need a runner:** recurring invoices (I7) and reminders (I8).
- **Installed copies only run while the owner's app is open.** The runner must catch up on
  launch, and say honestly when it runs.

## Tasks

1. **Job framework:**
   - **Registry.** Named jobs, each with an interval, a maximum batch size, and
     per-organization scope.
   - **Tenant context.** Work runs inside the tenant context. Before choosing a pattern,
     inspect how verified provider deliveries run with a **null system actor**.
     Cross-tenant access outside the established system-role pattern is forbidden.
   - **Leases.** A lease row keyed by job name and organization, with an expiry, so a job
     runs once even when two API processes share a database.
   - **Run log.** Started, finished, counts, and error code.
   - **Retries.** Exponential backoff, and a dead letter after N attempts.
   - _(Added in review)_ **Library choice.** pg-boss was considered. It creates its own
     schema at start unless `migrate: false` is set, which conflicts with the restricted
     runtime database role. A small lease table created by a Prisma migration fits the
     existing RLS and migration discipline better. Record the choice in an ADR.
2. **Register these jobs:**
   - Payment-webhook retry, wrapping `PaymentOutboxWorker`.
   - Outbound webhook dispatch.
   - Retry of retryable invoice and estimate email deliveries, and sending of pending
     payment-receipt emails (`processPendingReceiptEmails`).
   - Payroll due drafts, **only** when the organization has enabled payroll automation.
     Keep the existing DRAFT-only semantics.
   - Reserve registry identifiers for I7 and I8, visibly unavailable until implemented.
     Do not run no-op jobs or record them as successful work.
   - Reuse the B2 checkout-expiry worker where applicable; its scheduler, tenant
     discovery, fencing, and recovery still need integration.
3. **Startup catch-up.** Expose liveness while recovery runs, but keep dependent payment readiness
   closed until recovery completes. Then run jobs on their intervals.
4. **Settings → Automations**, for owners and admins:
   - Show each job's last run, next run, and recent failures.
   - "Run now", and a pause toggle per job per organization.
   - Truthful copy for installed builds: "Automations run while PennyWise is open on this
     computer."
5. **Controls:**
   - A `JOBS_ENABLED=false` environment kill switch, for tests and debugging.
   - Graceful shutdown: extend the existing SIGINT/SIGTERM handlers (`index.ts:123-134`) to
     stop the runner and release leases.

## Constraints

- **Jobs never post except through the services a user action uses,** with the same
  idempotency-key derivation.
- **Every job action is audited,** with the system actor and the job run id.
- **Closed periods:** jobs respect them. Services already enforce this; add a test.
- **Resources:** bounded batches, no busy loops, and no Redis or other new infrastructure.
- **OS scope:** no OS-level wake or scheduled task without separate owner authorization.

## Acceptance criteria

- **Webhook retry:** make `processWebhookEvent` fail once. The runner retries, and the
  payment is applied **exactly once** (integration test).
- **Lease safety:** two API processes against one database run each job once per interval.
- **Outbound webhooks:** a queued webhook is delivered by the runner without the dispatch
  route being called.
- **Automations panel:** it shows real run data, Run now works, and pause is respected.
- **Shutdown:** shutting down releases leases (test).
- **Kill switch:** with `JOBS_ENABLED=false`, no job runs.

## Out of scope

- The I7 and I8 job bodies.
- Distributed queues.
- Waking a sleeping PC.

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
