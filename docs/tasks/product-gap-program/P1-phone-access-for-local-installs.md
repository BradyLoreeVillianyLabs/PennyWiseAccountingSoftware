# P1 — Using PennyWise from a phone: design spike, threat model and prototype

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files, likely:**

- `distribution/windows-native/launcher.cjs`
- `apps/web/serve.mjs`, `apps/web/pwa.js`, `apps/web/service-worker.js`,
  `apps/web/manifest.webmanifest`
- `apps/api/src/auth/*`
- A new ADR, and a new `docs/PHONE_ACCESS.md`

**Closes:** G19 (and part of capability 13 in `COMPETITOR-MATRIX.md`)
**Effort:** M for the spike and prototype. The production build is a later prompt, after
decision D-10.
**Depends on:** X4 Part A. Coordinate with R1.

## Context

- **Competitors all work from a phone.** QuickBooks and Xero mobile apps create invoices
  and capture receipts. Jobber's apps are rated 4.8 (iOS) and 4.7 (Android). The
  invoice-only client does the job on site.
- **The installed build is reachable only from its own computer.** It binds the API and
  web to `127.0.0.1` (`launcher.cjs:726, 751`).
- **A plain LAN address won't work.** Service workers, and therefore an installable PWA,
  require a secure context: HTTPS, with `http://localhost` exempt (MDN). A phone opening
  `http://192.168.x.x` gets no PWA, and would send credentials unencrypted on the local
  network.
- **Native mobile packaging is a gated item** ("Mobile packaging" in
  `docs/tasks/customer-expected-features/GATED_FEATURE_RESOLUTION.md`).

## Tasks (spike, not a shipped feature)

1. **Threat model.** Cover:
   - another device on the same Wi-Fi;
   - a lost or stolen phone;
   - a stale pairing;
   - a malicious local network (café or hotel);
   - Windows firewall prompts;
   - what an attacker gains at each step.
2. **Evaluate the options against the threat model, user effort, and cost:**
   - **A. HTTPS on the LAN:** a per-install certificate and QR-code pairing. Record how a
     phone would trust the certificate on iOS and Android, and what that asks of a
     non-technical owner.
   - **B. A native companion app** talking to the desktop over the LAN with a pinned
     certificate and paired-device tokens. This is the Phase 25 path.
   - **C. The optional relay (R1)** with end-to-end encryption.
   - **D. Capture-only:** send photos or receipts to a mailbox that PennyWise reads. This is
     limited to capture, and can't create invoices.
3. **Write an ADR recommending one option,** including the failure modes and the
   uninstall and revoke story.
4. **Build a prototype of the recommended option** behind a flag that is **off by
   default**. It must:
   - pair a phone;
   - create a draft invoice from it (using the X3 editor at phone width);
   - revoke the phone.
5. **UX flows:** pair, rename, revoke, "I lost my phone", and what the desktop shows while a
   phone is connected.

## Constraints

- **Nothing listens beyond loopback unless the owner turns it on,** and the setting shows
  what it exposes.
- **No credentials over plain HTTP.** Paired-device tokens are revocable and scoped. Every
  pairing and revocation is audited.
- **No app-store submission and no hosted service** in this prompt.

## Acceptance criteria

- The threat model and ADR are reviewed by the owner (decision D-10).
- The prototype, on a real phone on the same network, pairs, creates a draft invoice over an
  encrypted connection, and is revoked. Afterwards the phone can't reach the data.
- With the flag off, a port scan of the PC shows no non-loopback listener.
- The X4 checks pass on the phone-width screens used.

## Out of scope

- Production rollout.
- App-store packaging.
- Offline mutation on the phone.

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
