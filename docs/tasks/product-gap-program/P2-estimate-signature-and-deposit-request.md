# P2 — Signed estimate approval, with a deposit request on acceptance

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files, likely:**

- `apps/api/src/services/estimate-service.ts`, `contract-service.ts`
- `apps/api/src/app.ts`: the public estimate routes, around `2239-2262`
- The estimate renderer, `packages/db/prisma/schema.prisma` plus a migration
- `apps/web/app.js`, `apps/web/index.html`

**Closes:** G15 (and capability 10 in `COMPETITOR-MATRIX.md`)
**Effort:** M
**Depends on:** I2, which provides the composer patterns. P3 turns the deposit request into
posting money; until P3 lands, the request stays non-posting.

## Context

- **Competitors capture signatures.**
  - Jobber can require a signature when a client approves a quote.
  - Square sends contracts with e-signatures, and requests deposits.
  - FreshBooks offers proposals with e-signature on its Plus plan.
- **PennyWise records acceptance without a signature.** Estimates already have secure
  customer links with expiry and revocation, versioned acceptance, and conversion
  (`CURRENT_PHASE.md`, Phase 17; public routes `app.ts:2239-2262`). But neither
  `estimate-service.ts` nor `contract-service.ts` captures a signature; contracts support
  templates, create, update and "mark ready".
- **Installed builds can't share links.** Their public links are loopback-only (G2), so a
  remote customer can't open them yet.
- **Legal status.** In Canada, electronic signatures are generally valid under PIPEDA
  Part 2 and provincial electronic-commerce acts, with exceptions (secondary sources in
  `VERIFICATION-LEDGER.md`).

## Tasks

1. **Acceptance evidence:**
   - the signer's typed full name;
   - an optional drawn signature, with a typed alternative (WCAG 2.5.7: no drag-only
     input);
   - a consent statement;
   - a timestamp;
   - the SHA-256 of the exact estimate snapshot, reusing the existing render-data hash;
   - minimal device metadata. Record what's collected in the privacy notes.
2. **Three ways to accept:**
   - **Sign on this device:** the customer signs on the owner's laptop or tablet, on site.
     This works on installed builds today.
   - **Customer link:** sign on the public page, when it's reachable (R1 or P1). On
     installed builds without those, the button explains why it's unavailable.
   - **Approved by email reply:** the owner records the acceptance, attaches the reply as
     evidence, and it is labelled as recorded by the owner, not signed by the customer.
3. **Acceptance certificate:** a PDF page appended to the accepted estimate, listing the
   evidence above. It is downloadable and attached to the estimate.
4. **Deposit request on acceptance** (optional per estimate): a percentage or amount.
   - It creates a deposit request, which is non-posting until P3.
   - It shows "How to pay" (I3).
5. **Contracts:** the same signing flow for `contract-service` documents marked ready.
6. **Decline and changes requested:** capture a reason, notify the owner, keep version
   history.

## Constraints

- **No claim of legal equivalence.** The UI says "signature captured", not "legally
  binding". Help text suggests the owner confirm requirements for their province and
  document type.
- **Signed snapshots are immutable.** Editing an accepted estimate creates a new version
  that needs new acceptance.
- **Signatures are personal information:** minimize, and include them in export and
  retention rules.

## Acceptance criteria

- **E2E, in person:** sign on this device, typed name only, keyboard only → the estimate is
  accepted → the certificate PDF shows the name, time and snapshot hash.
- **Integrity:** editing after acceptance is refused, or forks a new version.
- **Email-reply path:** labelled correctly in the history and on the certificate.
- **Deposit:** a deposit request is created on acceptance, and it is non-posting
  (integration test).
- **Quality:** the X4 checks pass on the signing screen, including a screen-reader pass.

## Out of scope

- Remote signing links on installed builds (R1 or P1).
- Identity verification of the signer.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Quality bar:** meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` §6.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
