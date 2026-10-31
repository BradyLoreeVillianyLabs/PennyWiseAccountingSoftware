# ADR 009: Recurring invoices materialize through occurrence identity

## Status

Accepted for I7 local automation. Automatic email remains subject to the
existing provider gate; no provider acceptance is implied.

## Decision

Recurring invoice schedules use a durable occurrence row keyed by organization,
schedule, and occurrence timestamp. The occurrence is claimed before work and
records `PROCESSING`, `SUCCEEDED`, `BLOCKED`, `FAILED`, or `SKIPPED`. A unique
recurrence key is also stored on the invoice, so a crash or retry cannot create
two invoices for one occurrence.

Each occurrence recalculates its lines using the occurrence's local calendar
date. The schedule chooses draft, finalize, or send mode. Send mode remains a
draft when email delivery is not enabled. A foreign occurrence with no
transaction-date rate creates a draft carrying `FX_RATE_REQUIRED`; it never
guesses a rate. A locked or missing fiscal period produces a draft or blocked
occurrence with the service's explicit reason.

Missed occurrences default to `EVERY`. The owner may select `LATEST`, which
records older missed dates as skipped rather than silently losing the history.
The schedule API returns the next three dates and recent occurrence history.

## Consequences

The runner is reliable while PennyWise is open and catches up on launch, but a
sleeping or powered-off computer cannot execute work. Email sending is queued
only after a real enabled provider is available. Schedule editing uses the
existing invoice composer fields as the template source and still requires
review before saving.
