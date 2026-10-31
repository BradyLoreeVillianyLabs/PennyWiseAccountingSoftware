# PennyWise Owner Workspace — Reviewed Implementation Prompt

## Purpose

Build a focused **Owner workspace** for PennyWise Accounting. It must let a small-business owner run the customer-facing side of the business without navigating accountant-oriented screens, while keeping the full accounting workspace available when needed. The result must be trustworthy, compact, accessible, print-ready, tenant-isolated, and usable on desktop and phone.

Work only in the PennyWise beta repository. Do not modify or deploy to QBWooBridge or any production deployment. Use the isolated test database for all destructive integration tests; deploy beta schema changes only after those tests pass.

## Critical review of the original brief

The brief correctly identifies the owner’s jobs to be done—invoice, quote, customer, job, contract, and email—but it needs these safeguards to become shippable:

1. **Legal templates are not legal advice.** Do not claim that a template is legally sufficient, approved, enforceable, or jurisdiction-complete. Do not reproduce CCDC forms or other proprietary forms. Provide editable, plain-language starter documents with source links, a required review acknowledgement, unresolved-field validation, and a visible “obtain local legal advice where appropriate” notice.
2. **Jurisdiction must be explicit.** Alberta guidance is a useful baseline for the beta, not a universal rules engine. Store the selected jurisdiction and display its source and last-reviewed date in every starter-template preview.
3. **OAuth is the correct email connection.** Never ask for a Gmail, Microsoft, or other mailbox password. Use OAuth authorization-code flow with PKCE, least-privilege send scopes, encrypted refresh-token storage, state validation, expiry, reconnect/disconnect, and no credential values in logs or API responses. An administrator must register a Google or Microsoft OAuth client before a live connection can work.
4. **The mail connector is not a claim of delivery.** A connection status must be distinct from invoice/estimate delivery. Do not mark a document sent until a provider-aware delivery adapter has returned an accepted result and delivery audit event.
5. **An owner mode must simplify—not hide data.** It can hide accounting controls from the owner rail, but must preserve role authorization, deep links, records, and a clear “Open accountant workspace” escape hatch.
6. **Invoice appearance requires deterministic output.** Typography controls and image treatments must be constrained, accessible, sanitize all inputs, use the same immutable asset snapshot for browser preview and PDF, and remain legible when printed in grayscale.

## Product outcome

An owner can:

- Open **Owner workspace** and see today’s work, work due soon, unbilled/overdue customer work, and clear next actions.
- Create an invoice, estimate, job, appointment, customer, or contract from a compact action surface.
- Convert a practical estimate into a job and use the same customer and company information to prefill a contract draft.
- Select an editable starter contract, complete the required variables (parties, scope, work location, dates, amount, deposit, payment schedule, change approvals, warranties, insurance, dispute/cancellation notes), save a versioned draft, mark it ready for review, and print it.
- Connect Gmail or Microsoft 365/Outlook only when the instance is configured with a registered OAuth client; otherwise see a precise, non-alarming setup state.
- Design an invoice using promoted Signature, Craft, and Modern presets; choose safe font sizes, colors, spacing, and a print-safe background/watermark treatment; preview, save, and print a matching PDF.

## Architecture and guardrails

### Owner workspace

- Add an `owner-workspace` destination and an Owner / Accountant mode control.
- Default small-business profiles to Owner mode. Persist the preference per organization with optimistic concurrency; do not use it as authorization.
- Owner rail: Owner workspace, Invoices, Estimates, Jobs, Calendar, Contacts, Contracts, Inventory (when enabled), Reports, Integrations, Settings. Keep Settings and Appearance in the bottom utility zone.
- Accountant rail: retain the existing comprehensive navigation. The owner rail must not overlap or crowd the top toolbar at desktop width; labels must remain visible and compact.
- Use existing Customer, Estimate, Invoice, Project, Calendar, and Product services rather than duplicating records.
- Every quick action must be keyboard accessible, visible in task finder, and navigate to a real actionable destination.

### Contracts

- Add tenant-scoped `ContractDocument` and optional `ContractTemplate` persistence, RLS, audit events, indexes, optimistic concurrency, and explicit status transitions: `DRAFT`, `READY_FOR_REVIEW`, `SENT`, `ACCEPTED`, `VOIDED`.
- System templates stay in source control and are not editable in place; organizations may create their own template copies.
- Start with these starter documents:
  - Work authorization and service agreement
  - Estimate acceptance and deposit acknowledgement
  - Change order
- Each document must carry a source label/URL and jurisdiction, preserve a content snapshot, and store field values separately from rendered content.
- Auto-fill only fields supported by existing company/customer/project/estimate data. Leave unknown values visibly unresolved. Never invent legal facts, licence numbers, warranties, payment terms, or cancellation periods.
- Ready-for-review requires an explicit acknowledgement and no required unresolved fields. Printing is allowed from a draft but must be marked “Draft — review before signing.”
- Provide safe HTML preview rendering with output escaping; never inject stored content as raw browser HTML.

### Email connections

- Support `GMAIL` and `MICROSOFT` provider metadata.
- Use authorization-code + PKCE, SHA-256 state storage, short-lived OAuth attempt records, token exchange, encrypted credentials, connection status, and disconnect.
- Use scopes no broader than required for sending:
  - Google: `openid`, `email`, `https://www.googleapis.com/auth/gmail.send`
  - Microsoft: `openid`, `profile`, `offline_access`, `User.Read`, `Mail.Send`
- Use an externally configured public `APP_BASE_URL` and callback path under the application API proxy.
- If the configured client ID/secret/redirect URI is absent, return a safe `EMAIL_PROVIDER_NOT_CONFIGURED` state. Do not silently fall back to password or SMTP collection.
- Keep the first beta release connection-only unless the document delivery dispatcher is made organization-aware and provider acceptance is audited. Do not fake successful email delivery.

### Invoice designer

- Preserve current template keys for backward compatibility. Promote these labels in the interface:
  - Signature → Clean professional
  - Craft → Contractor
  - Modern → Modern
- Add constrained controls: heading size 24–42 pt, body 9–14 pt, table 8–13 pt, notes 8–13 pt; default values must be readable and template-specific.
- Add `none`, `brand-wash`, and `image-watermark` background treatments. Image watermark must use a validated organization-owned asset, low opacity, neutral readable foreground, and a print-safe fallback.
- Add a non-destructive invoice background image upload endpoint that does not replace the company logo. Scan and validate PNG/JPEG/WebP files; bind selected assets to the tenant.
- Apply identical configuration/asset snapshots to HTML preview and deterministic PDF output. Do not allow arbitrary CSS, font URLs, HTML, remote images, or scripts.
- Include explicit Save, Preview, Download PDF, and Print actions. Print must target the rendered document rather than the editor chrome.

## Quality bar and acceptance tests

1. **Tenant isolation:** owner A cannot list, view, create against, update, ready, disconnect, or print a contract/email connection belonging to tenant B. Validate API behavior and direct RLS behavior on the isolated test database.
2. **Authorization:** owner/admin can manage configurations; read-only users can view only the permitted records and cannot change a workflow preference, contract, or connection.
3. **Contract integrity:** fields auto-fill accurately from selected data, required unresolved variables block ready-for-review, stale updates return 409, ready documents do not mutate silently, and previews escape hostile text.
4. **OAuth integrity:** state mismatch, expired attempt, repeated callback, provider error, missing config, and disconnect are covered. Tokens never appear in API payloads, logs, audit metadata, or UI.
5. **Invoice integrity:** invalid sizes/treatments/assets are rejected; preview/PDF share configuration and image checksums; grayscale print remains readable; typography actually changes the rendered result.
6. **Interaction QA:** test owner mode, quick actions, contract draft/ready/print, invoice preset/font/background/save/preview/print, and configured/unconfigured email connection states in Chromium, Firefox, WebKit, and a narrow mobile viewport. Check console errors, failed requests, keyboard use, and 200% zoom.
7. **Release:** run Prisma generate, migration deployment on the isolated database, API targeted tests, broader integration tests, web build, focused Playwright tests, and only then deploy/restart the branded PennyWise beta shares. Record known limitations honestly.

## Public reference material to preserve in product/docs

- Alberta contractor checklist and written-estimate guidance: <https://www.alberta.ca/hiring-contractor>
- Alberta consumer protections: <https://www.alberta.ca/consumer-bill-of-rights>
- Alberta prepaid contracting licence information: <https://www.alberta.ca/prepaid-contracting-licence>
- CCDC document copyright/purchase guidance (do not reproduce forms): <https://www.ccdc.org/?faq=how-do-i-purchase-ccdc-documents>
- Google OAuth scopes: <https://developers.google.com/identity/protocols/oauth2/scopes>
- Gmail send endpoint: <https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send>
- Microsoft authorization-code flow: <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow>
- Microsoft Graph send mail: <https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0>

## Definition of done

Do not declare the work complete solely because screens exist. It is complete when the owner workflow is usable end-to-end with real tenant-scoped persistence, configuration-aware email connection behavior, deterministic invoice output, practical contract safety controls, documented assumptions, and passing automated plus rendered-interface tests.
