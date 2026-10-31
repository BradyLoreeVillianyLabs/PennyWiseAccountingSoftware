# ADR 005: Calendar and Project Work Items Are Non-Posting Source Records

Status: accepted for public-beta implementation  
Date: 2026-08-03

## Context

ClearLedger already stores project start/end dates, invoice due dates, bill due dates,
time entries, progress-billing milestones, and cash-planning assumptions. A calendar
projection exposes project, invoice, and bill dates without creating records. Customers
also expect tasks, milestones, dependencies, reminders, and a visual schedule, but a
generic calendar drag must never silently alter an invoice, bill, journal, tax result,
or inventory movement.

## Decision

Add tenant-scoped project work items as non-posting operational records. A work item has
one of `TASK`, `MILESTONE`, or `REMINDER`; an explicit status; optional project; start
and due dates; optional assignee membership; priority; description; optimistic version;
creator/updater evidence; and archive/completion timestamps. A self-relation records
finish-to-start dependencies. Dependencies must remain inside one organization, cannot
target the same item, and cannot form a cycle.

Dates are organization-local `DATE` values unless the user explicitly creates a timed
reminder in a future increment. This avoids inventing time-zone precision for ordinary
business planning. Moving or resizing an item is a versioned update to that work item
only. The server rejects stale updates, invalid ranges, closed/archived projects, invalid
assignees, dependency cycles, and cross-tenant references.

The unified calendar remains a bounded read projection. It combines:

- project start and end dates;
- work-item start/due dates and milestones;
- invoice and bill due dates with their actual draft/approved/posted authority;
- approved progress-billing milestone dates;
- future filing/remittance obligations only after a first-class authoritative obligation
  model exists.

Every projected event exposes a stable ID, kind, source status, authority, source link,
and whether it is financial. The projection never writes data. A user action opens the
source record; it does not use calendar data as accounting input.

## Interaction and accessibility

The month/week visualization and project timeline share the same server projection and
filters. A semantic agenda table/list with full create, edit, complete, and reorder
controls is always available. Drag and drop is an enhancement; keyboard users receive
explicit date fields and move controls. Status is conveyed by text and icon as well as
colour. At 200 percent zoom and narrow widths, the agenda view becomes the primary
layout rather than a horizontally clipped calendar.

## Consequences

- Planning remains editable and useful without polluting the ledger.
- Formal reports remain posted-authoritative and do not treat deadlines as transactions.
- A later notification worker can consume reminder outbox events without changing this
  source model.
- Progress-billing milestones remain accounting-adjacent source records; the calendar
  links to them but never generates an invoice merely because a date was reached.
- RLS policies, tenant-consistency triggers, foreign-key indexes, audit events,
  concurrency tests, dependency-cycle tests, and rollback SQL are required with the
  migration.
