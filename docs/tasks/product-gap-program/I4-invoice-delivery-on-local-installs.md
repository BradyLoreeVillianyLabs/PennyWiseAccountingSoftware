# I4 — Invoice email that works on an installed build

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `apps/api/src/services/email-connection-service.ts`, lines `121-145`
- `smtp-email-provider.ts`
- `invoice-document-service.ts`, lines `311`, `404-413`
- `estimate-email-service.ts`
- `apps/api/src/app.ts`: the email wiring around `494-516`
- `distribution/windows-native/launcher.cjs`, lines `722-741`
- `apps/web/app.js`, lines `9433-9482`
- `apps/web/index.html`

**Closes:** G1, G5
**Effort:** M
**Depends on:** **B2-3** (SMTP integration and verified test-send). Build on it; don't
re-implement SMTP. Task 4, "send from my email app", does **not** need B2-3 and may ship
first.

## Context

- **Email is off on every installed copy.**
  - The installed build sets `CLEARLEDGER_BETA_RUNTIME=true` and never sets
    `EMAIL_DELIVERY_MODE` (`launcher.cjs:722-741`).
  - `emailDeliveryRuntimeFromEnvironment` returns `DISABLED` when the mode is absent. In
    beta runtime it also requires `PENNYWISE_BETA_EMAIL_DELIVERY_APPROVED=true`
    (`email-connection-service.ts:128-138`).
  - As a result, every installed copy falls back to "download the PDF and send it
    yourself" (`invoice-document-service.ts:404-413`; `app.js:9433-9441`).
  - The owner cannot change this without editing environment variables.
- **The send action is a bare prompt.** When email is available, it is a
  `window.prompt("Recipient email")` (`app.js:9442`): no prefill from the customer, no
  subject or message, no CC to self, and no preview.
- **Manual sends leave no trace.** "Did I send this?" can't be answered, and delivery
  history renders as pipe-joined text (`app.js:9479-9481`).
- **Decision note.** Beta email was disabled on purpose. Task 1 changes that boundary. The
  completion report must state that the owner approved the change, and `CURRENT_PHASE.md`
  and the decisions log must be updated.

## Tasks

1. **Owner-enabled email, with no environment editing.**
   - Replace the environment-only approval with a per-organization "Send email from
     PennyWise" setting.
   - It becomes available only when all three hold: the credential protector is available;
     the owner has saved an SMTP connection (B2-3); and a verified test-send has succeeded.
   - Keep an environment **kill switch** that forces delivery off (fail closed).
   - Make the launcher expose the SMTP capability so the setting can take effect. Ship no
     credentials.
2. **Choose the sign-in method by provider.** _(Rewritten in review: password SMTP no
   longer works for Microsoft personal accounts, and is ending for Microsoft 365.)_
   - **Gmail and Google Workspace:** SMTP with an app password, which requires 2-Step
     Verification.
     - Workspace ended plain-password SMTP on 14 March 2025.
     - Admins can block app passwords; say so in the form.
   - **Outlook.com, Hotmail and Live (personal Microsoft accounts):**
     - Microsoft's support page says basic authentication is being removed from
       Outlook.com, and directs users to modern authentication. It offers no
       app-password route.
     - Third-party reports date the cutoff to 16 September 2024.
     - Use the existing **connected-mailbox OAuth** provider
       (`connected-mailbox-email-provider.ts`, Microsoft Graph `Mail.Send`).
   - **Microsoft 365 work accounts:**
     - Microsoft has moved this date several times. A Microsoft Q&A answer cites
       1 March 2026. Microsoft's January 2026 update, as reported, makes password SMTP off by
       default from the end of December 2026, with final removal to be announced in 2027.
     - **Don't design around a date:** treat Microsoft password SMTP as unavailable.
     - Use connected-mailbox OAuth.
     - Offer SMTP only with a warning that it may stop working.
   - **iCloud, Yahoo, Fastmail, internet-provider mailboxes and generic SMTP:** use
     app-specific passwords where the provider requires them.
   - **Form details:**
     - Prefill host, port and TLS mode.
     - Link to each provider's help page.
     - Verify every preset against current primary docs, and record the retrieval date in
       the research matrix.
   - **Add `AUTH LOGIN`** to the SMTP client. Today it supports only `AUTH PLAIN`
     (`smtp-email-provider.ts:190, 397-400`), and some servers advertise only `LOGIN`.
   - **External gates — record them, don't fake them:**
     - Microsoft: a multitenant app registration needs **publisher verification** before
       users in other organizations can consent to it.
     - Google: `gmail.send` is a **sensitive scope** that needs Google's verification (no
       third-party security assessment).
     - Until those exist, installed builds offer SMTP for Google and the other providers.
       Microsoft shows "Connect with Microsoft — not yet available" rather than a form that
       will fail.
3. **Send dialog** (a real modal, reused for estimates and receipts where the routes exist):
   - **To:** prefilled from the customer's email; multiple recipients allowed and
     validated.
   - **CC me:** on by default.
   - **Subject and message:** from an editable template with merge fields `{customer_name}`,
     `{invoice_number}`, `{amount_due}`, `{due_date}`, `{business_name}` and
     `{payment_instructions}`. The last one comes from I3 when present.
   - **Attachment:** the PDF.
   - **Preview**, then **Send**.
   - **"Save as my default"** for template edits.
4. **"Send from my own email app"** fallback, shown when email is disabled or when the owner
   prefers it:
   - Download the PDF.
   - Copy the prepared subject and body to the clipboard.
   - Open a `mailto:` link with the subject and body. State plainly that the PDF must be
     attached by hand.
   - Record a **MANUAL** delivery event: "Marked as sent by <user> on <date> via own email".
   - Also provide an explicit **"Mark as sent"** action.
5. **Delivery history as a proper list** on the invoice: recipients, state, timestamps and
   attempts. Include **Resend**: `POST /v1/invoices/:id/resend` exists but has no UI.

## Constraints

- **Credentials:** never store plaintext SMTP passwords. Redact them in logs and exports.
- **Sending controls:** rate-limit sends, and use an idempotency key per send.
- **Truthful delivery states:**
  - The states are QUEUED, SENT, FAILED and MANUAL.
  - MANUAL must never display as "delivered by PennyWise".
  - SENT means the SMTP server accepted the message, not that it was read.
- **No tracking pixels, and no read receipts.**

## Acceptance criteria

- **Installed-build conditions** (`CLEARLEDGER_BETA_RUNTIME=true`, no email variables):
  - The owner configures SMTP against a **local test SMTP server**, the test-send passes,
    and the owner enables email and sends an invoice.
  - The server receives one message with the PDF attached and the merge fields filled
    correctly.
- With the kill switch set, sending is refused and the UI offers the fallback.
- A manual send creates a MANUAL event that is visible in history.
- The customer's email is prefilled, and multiple recipients are validated.
- A double-clicked Send delivers exactly once.

## Out of scope

- OAuth mailbox APIs (Gmail API, Graph).
- Bulk send.
- SMS.

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
