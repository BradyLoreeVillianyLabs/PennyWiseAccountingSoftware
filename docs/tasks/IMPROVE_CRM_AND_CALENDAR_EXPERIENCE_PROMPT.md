# Improve CRM-like client activity and calendar experience

Status: created 2026-08-06

## Role

Act as a workflow-product implementation team with:

- product manager
- client-service specialist
- backend engineer
- frontend engineer
- QA engineer
- security engineer

## Objective

Make ClearLedger’s client and calendar experience feel like a practical relationship-management layer for accountants, service businesses, and project-driven teams without turning it into a generic CRM platform.

## Why this matters

Users need a place to manage clients, contacts, meetings, follow-ups, notes, and operational reminders. The current repo already has customer and calendar foundations, but the experience needs to feel more complete and more usable than a basic records screen.

## Repository context to use

Extend the existing customer, calendar, audit, and permission patterns already present in the repository.

## Requirements

Implement the following experience upgrades:

1. Clear client and contact records with activity history.
2. Meetings, reminders, follow-ups, and notes that can be attached to client records.
3. Configurable event categories and statuses.
4. Calendar views that can represent operational and business events beyond invoices and bills.
5. Links from calendar events to clients, projects, invoices, bills, or other relevant records where appropriate.
6. A calm, useful experience that feels organized rather than overloaded.

## UX principles to exceed competitors

The experience should feel better than generic CRM products by being:

- more directly connected to accounting and operational records
- more flexible without being bloated
- easier to trust because it respects permissions and auditability
- better suited to the accountant or advisor workflow

## Acceptance criteria

1. Users can create and manage clients and contacts.
2. Users can create and view activity, notes, meetings, reminders, and follow-ups.
3. Calendar events support configurable categories and statuses.
4. The workflow remains tenant-scoped and auditable.
5. Focused tests cover client creation, activity logging, and calendar event creation.

## Implementation instructions

- Reuse the existing customer and calendar infrastructure rather than creating a disconnected system.
- Keep the design bounded and practical, not broad or marketing-driven.
- Focus on clarity, actionability, and workflow support over feature sprawl.
- Verify the result with concrete evidence and avoid claiming completion without fresh checks.
