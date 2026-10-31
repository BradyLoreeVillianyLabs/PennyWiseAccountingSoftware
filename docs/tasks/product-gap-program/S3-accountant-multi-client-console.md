# S3 — The bookkeeper console: many clients, one screen

Commercial-readiness prompt. Prepared, not authorized: record it in
`docs/status/CURRENT_PHASE.md` before starting.

## Why this is the strongest channel

Sources are in `codex-product-gap-pack/MONETIZATION-AND-FEATURE-ASSESSMENT-2026-09-12.md`,
Part 4 and Part 7.

- **This is how the incumbents distribute.** Intuit has **500,000+ ProAdvisors** and gives
  firm-billed accounts **30% off ongoing**. Xero has **250,000** partner accountants and
  bookkeepers.
- **They price per client, cheaply.** Xero sells **Ledger at US$3/month** and **Cashbook at
  US$10/month per client**, available only through partner practices.
- **The firm's own economics dwarf that.** Canadian bookkeeping runs **$300–2,000 per client
  per month**. A $15–25 per-client licence is **1–5%** of what the firm already bills.
- **The firm has a reason to prefer PennyWise:** the client's books stay under the firm's
  control, there are no per-seat charges, and the price doesn't rise every year.

One bookkeeper with forty clients is worth more, and costs far less to reach, than forty
individual owners.

## What exists today

- Multi-organization membership and an organization switcher.
- An accountant workbench, manual-journal drafts, review queues, period close, and audit
  exploration.
- Intercompany and consolidation-group APIs with no UI.
- **No firm concept, no cross-client view, and no per-client licensing.**

## Tasks

1. **Firm (practice) entity.** A practice owns a set of client organizations, has staff
   members with roles, and holds the firm licence from S2.

2. **Client list with real signal**, not just names. Per client:

   - unreconciled bank items;
   - unposted drafts and review-queue depth;
   - period status and whether last period is closed;
   - overdue receivables;
   - last activity;
   - licence state.

   Sortable and filterable, so the firm can work the exceptions.

3. **Fast switching.** Open a client, do the work, return to the console without losing
   filters. Keep the existing per-tab organization behaviour so two clients can be open in
   two tabs safely.

4. **Cross-client actions, done safely.** Batch operations — run a report set, export, close
   a period — execute **per tenant in sequence**, each inside its existing tenant
   transaction, each audited. Never assemble a cross-client query by bypassing row-level
   security.

5. **Per-client licence assignment.** Consume S2 entitlements: assign, release and count
   active clients; refuse the next client clearly when the licence limit is reached.

6. **Client onboarding template.** Apply an account preset, tax configuration, invoice
   branding and workflow profile to a new client in one step, so a firm can stand up a
   client in minutes.

7. **Firm billing record.** Reuse `commercial-service` to record what the firm owes for
   active clients. PennyWise does not need to process that payment to record it.

## Constraints

- **Tenant isolation is the product.** Every cross-client view is composed from per-tenant
  reads. Add explicit tests proving no cross-tenant leakage, including in exports.
- Staff permissions are enforced server-side; a firm role never silently grants more than
  the client's own role model allows.
- Every access to a client's books from the console is audited with the acting user.
- No client data is aggregated into a firm-level store that the client cannot see.

## Acceptance criteria

- With 25 client organizations, the console lists them with accurate per-client signals, and
  first render meets the X2 performance budget.
- Switching to a client and back preserves console state.
- A security test proves a firm staff member without rights to client B cannot read client B
  through any console endpoint.
- Licence limits are enforced at assignment.
- Onboarding a new client from template produces a posting-ready book.
- A batch report run across 10 clients produces 10 audited, per-tenant executions.

## Standard rules

- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.
- Meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` section 6.
- Keep LF endings; rebuild web assets; there is no git, so list every changed file.
