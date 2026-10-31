# R1 — Optional hosted relay: design and decision package only

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`. Documentation only:
`docs/RELAY_SERVICE_DESIGN.md`, a new ADR, and `docs/THREAT_MODEL.md` additions.
**Closes:** the design half of G2 and G19, and capabilities 13–15 in
`COMPETITOR-MATRIX.md`
**Effort:** M, for the design only. **No service is built.**
**Depends on:** decision D-11. The P1 spike findings are useful input.

## Context

Several things customers value from competitors need something reachable on the internet:

- a customer portal where clients view, approve and pay (Jobber Client Hub, and the
  FreshBooks and Zoho portals);
- public invoice and estimate pages, and remote signing (P2);
- provider webhooks delivered in real time, where I9 polls today;
- "invoice viewed" status;
- phone access away from the office (P1 option C).

PennyWise's advantage is that the books live on the owner's computer. A relay must not
quietly turn it into a cloud ledger.

## Tasks (design)

1. **Minimal scope.** Define exactly what the relay would hold:

   - rendered document snapshots, which are encrypted and expire;
   - pay-link redirects;
   - a webhook inbox that the desktop pulls from;
   - optionally, an end-to-end encrypted tunnel for P1.

   It never holds the ledger.

2. **Data and privacy:**

   - data minimization and retention;
   - encryption, including whether the relay can read content;
   - where the data is hosted (Canada);
   - PIPEDA, and Quebec's privacy law (Law 25), for customer personal information;
   - breach notification duties.

   Have counsel confirm.

3. **Security:** extend the threat model to cover the relay, account takeover, token
   leakage, and abuse such as phishing pages hosted on the relay domain.
4. **Operations:** uptime target, monitoring, support, incident response, and the cost per
   active business per month at 10, 100 and 1,000 businesses.
5. **Business:** pricing options, whether it's included or an add-on, and how it fits the
   "no forced cloud" positioning.
6. **Go/no-go criteria, and a phased plan.** Phase 1 would be public invoice pages and pay
   links; later phases would add the portal, signing and phone access.

## Acceptance criteria

- `RELAY_SERVICE_DESIGN.md`, the ADR and the threat-model additions are delivered.
- The owner records a decision (D-11): build, defer, or reject.
- No code, infrastructure or accounts are created.

## Out of scope

- Implementation.
- Vendor selection contracts.
- Domain purchase.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
