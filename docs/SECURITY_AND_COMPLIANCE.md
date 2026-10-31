# Security and Compliance Requirements

This document defines engineering requirements, not legal advice.

## Security objectives

- prevent cross-tenant access;
- protect credentials and financial records;
- preserve integrity of posted accounting data;
- detect and investigate material actions;
- minimize payment-card exposure;
- provide recoverable records;
- support Canadian privacy and recordkeeping obligations.

## Authentication

- modern managed identity or a well-reviewed authentication library;
- MFA for owners, administrators, accountants, and bookkeepers;
- secure password hashing if passwords are supported;
- session rotation after privilege changes;
- short-lived access tokens;
- refresh-token revocation;
- device and session management;
- login-rate limiting;
- account-recovery audit events.

## Authorization

- organization-scoped membership;
- default deny;
- explicit role permissions;
- resource ownership checks;
- no authorization decisions in the frontend alone;
- reauthentication for sensitive operations;
- tests for horizontal and vertical privilege escalation.

## Tenant isolation

Every tenant-owned row must include `organization_id`.

Required protections:

- organization id derived from authenticated membership, not arbitrary request input;
- scoped repository methods;
- composite unique keys including organization id where relevant;
- row-level security considered for defence in depth;
- cross-tenant integration tests.

## Payment security

- hosted payment pages;
- never store PAN or CVV;
- verify webhook signatures;
- retain event id and processing status;
- enforce idempotency;
- reject replayed or stale events according to processor policy;
- redact secrets and sensitive payload fields from logs;
- separate platform and connected-account identifiers;
- support reconciliation of gross, fees, refunds, chargebacks, and net settlement.

## Application controls

- HTTPS only;
- HSTS;
- Content Security Policy;
- CSRF protection;
- secure cookies;
- input validation;
- output encoding;
- SQL injection protection through parameterized access;
- file-type sniffing and allowlists;
- malware scanning;
- image metadata stripping where appropriate;
- upload size limits;
- rate limiting;
- request correlation ids.

## Audit events

Record at minimum:

- login and failed login;
- MFA change;
- user invitation and role change;
- organization setting change;
- bank connection change;
- payment account change;
- invoice send, view, payment, refund, and void;
- bill creation and payment;
- journal posting, reversal, and adjustment;
- period close and reopen;
- data export;
- API key creation and revocation;
- organization deletion request.

Audit events should be append-only and include:

- organization id;
- actor id;
- action;
- target type and id;
- timestamp;
- request id;
- IP and user agent where appropriate;
- before and after metadata with sensitive values redacted;
- reason where required.

## Data protection

- encrypt data in transit and at rest;
- use managed keys where possible;
- separate environments and credentials;
- encrypt backups;
- maintain point-in-time recovery;
- test restoration;
- restrict production access;
- log privileged access;
- use a secrets manager;
- rotate secrets;
- maintain dependency and container scanning.

## Operator-owned shipping credentials

Carrier credentials are organization-scoped secrets. They are supplied by the
operator, encrypted with the `CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET` pattern,
and excluded from DTOs, exports, audit metadata, logs, and backups that are not
encrypted. Production shipping requires a configured high-entropy protection
secret or an approved injected secret store. Label purchasing is an explicit
operator action against the operator's own carrier account; PennyWise does not
hold, transfer, resell, or refund postage money. See
`docs/SHIPPING_CARRIER_OPERATIONS.md` for the operational contract and the
unverified live-provider gate.

## Retention and deletion

- retain accounting records according to approved Canadian policy;
- preserve readable electronic records;
- support legal holds;
- export before closure;
- distinguish account closure from lawful record deletion;
- document attachment retention;
- provide deletion workflows for personal data not subject to financial retention.

## Incident response

Maintain:

- severity classification;
- triage procedure;
- containment actions;
- evidence preservation;
- customer notification workflow;
- regulator notification workflow;
- breach register;
- post-incident review;
- tabletop exercises.

## Pre-release security gates

- threat model reviewed;
- authorization tests pass;
- cross-tenant tests pass;
- dependency scan passes;
- secrets scan passes;
- static analysis passes;
- backup restore tested;
- payment webhook replay tests pass;
- independent penetration test completed before broad public release.

## Phase 13 Operating Evidence

The current repository provides a disposable PostgreSQL backup-restore drill,
pinned CI actions, frozen dependency installation, dependency vulnerability
scanning, and scheduled dependency updates. The complete operating procedures
for privacy requests, breach handling, privileged access review, secret
rotation, vendor review, alert response, and recovery live in
`PRODUCTION_OPERATIONS.md` and `BACKUP_AND_RECOVERY.md`.

Production must use a shared rate-limit implementation, managed encrypted
backup/PITR, isolated worker and render environments, approved object storage,
real malware scanning, and monitored alert delivery. These deployment controls
are not satisfied by development adapters or local Docker services.
