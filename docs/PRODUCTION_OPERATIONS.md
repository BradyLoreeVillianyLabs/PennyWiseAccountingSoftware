# Production Security, Privacy, and Incident Operations

This document is an engineering operating procedure, not legal advice. Privacy
officer, retention, breach-notification, and contractual requirements require
Canadian legal counsel review before handling production customer data.

## Data Inventory and Retention

| Data class                                                 | Purpose                                           | System control                                          | Retention decision owner |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| Ledger, invoices, bills, payments, tax, and audit evidence | Accounting and statutory records                  | Immutable records, tenant RLS, full export              | Controller and counsel   |
| Users, memberships, sessions, and OIDC audit               | Access control and security investigation         | Hash-only session tokens, revocation, append-only audit | Privacy officer          |
| Attachments, PDFs, logos, imports, and exports             | Customer record support and portability           | Scanner, authorization, checksum, storage isolation     | Records owner            |
| Payment account references and webhook evidence            | Hosted checkout, reconciliation, dispute handling | Encryption, redaction, provider event idempotency       | Finance/security owner   |
| Operational logs and backup archives                       | Incident response and recovery                    | Redaction, access control, encrypted managed storage    | Security owner           |

No engineering default establishes a legal retention period. Before production,
counsel must approve schedules, legal-hold handling, and deletion/anonymization
rules for personal data not required for financial recordkeeping.

## Privacy Requests

The privacy officer records each access, correction, or deletion request in a
restricted case system with requester identity, tenant, scope, due date, legal
hold status, decision, and evidence. Access requests use the authorized,
audited organization export. Corrections follow normal immutable accounting
corrections; they never rewrite posted records. Deletion requests first check
retention and legal hold, then use closure/retention workflows or approved
anonymization procedures. The requester receives a documented response and the
case record retains its approval trail.

## Incidents and Breach Register

The incident commander maintains a restricted breach register containing case
ID, detection time, affected assets and tenants, severity, containment,
evidence locations, legal/privacy assessment, notification decisions and
timestamps, recovery actions, and post-incident owner. Preserve logs, audit
events, snapshots, and provider evidence before changing affected systems.

Severity one or two events include suspected credential theft, cross-tenant
exposure, ledger integrity failure, payment compromise, backup exposure, or
material outage. Contain by revoking sessions, disabling integrations or public
links, rotating scoped credentials, and preserving evidence. Counsel determines
customer and regulator notification obligations; ClearLedger must not claim a
universal notification deadline without that review.

## Monitoring and Access Review

Route-level structured logs must retain correlation ID and security outcome
without tokens, cookies, raw webhook bodies, payment payloads, or attachment
content. Domain audit events provide actor and organization attribution.

Alert on repeated authentication/rate-limit failures, authorization denials,
role and owner changes, RLS-denied database operations, exports, payment-account
changes, refunds above the controller-approved threshold, webhook/outbox
failures, backup/restore failures, and elevated error rates. Review active
owners, administrators, accountants, payment access, migration access, secrets
access, and backup access at least quarterly; remove access immediately when a
person changes roles or leaves.

## Accounting-integrity triage

Do not repair a difference by posting a plug or editing posted history. Record
the organization, company, correlation ID, affected source record, as-of date,
and operator before taking corrective action. Preserve the relevant audit and
outbox evidence first.

| Situation                                   | First safe action                                                                                                                          | Resolution boundary                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stuck import or unmatched source row        | Keep the immutable batch and source checksum; review validation/reconciliation output and retry only with the same idempotency context.    | Correct mapping or source evidence, then use the existing commit/retry workflow. Never create a replacement journal manually.                      |
| Inventory-to-GL difference                  | Run the company/as-of inventory control reconciliation and retain the movement and journal IDs.                                            | Investigate missing/reversed movements or mapped-account configuration; use an authorized adjustment or reversal with evidence.                    |
| Pending payment, refund, or payout mismatch | Preserve provider/webhook evidence and inspect the tenant-scoped payment/reconciliation state.                                             | Replay only the idempotent provider/workflow operation; do not mark a payment settled from a browser result alone.                                 |
| Cash shift variance                         | Close the shift with the counted amount, retain immutable cash events, and require the configured variance approval reason.                | Resolve through the POS variance workflow and its audit trail; never overwrite a cash event or count.                                              |
| Interrupted connector or job                | Pause the installation if input evidence is suspect, record the checkpoint and correlation ID, then resume through its bounded retry path. | Confirm the existing idempotency/outbox record before retrying. Escalate any non-zero accounting or inventory effect from a review-only connector. |

When a company-specific operation is involved, verify the active company in the
server-side request context before investigation or retry. A browser company
selector is never authorization evidence.

## Vendors, Secrets, and Environment Separation

Maintain a vendor/subprocessor register for OIDC, payment, email, object
storage, malware scanning, logging, backup, and hosting providers. Record data
categories, region, contract owner, security review date, and offboarding plan.

Production secrets are stored only in an approved secrets manager, injected at
runtime, scoped per environment, and never printed. Rotate OIDC client secrets,
payment keys/webhook secrets, encryption keys, database passwords, and storage
credentials on a documented schedule and immediately after suspected exposure.
Use a separate, unprivileged runtime database login, migration login, and
maintenance/backup login. Production debugging must remain disabled.
