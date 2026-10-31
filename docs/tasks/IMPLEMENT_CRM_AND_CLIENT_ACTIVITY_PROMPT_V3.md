# Implement CRM and client activity workflow v3

Status: revised for configurable calendar and industry flexibility 2026-08-06

## Role

Act as a world-class delivery team with:

- product manager
- accounting workflow specialist
- backend engineer
- frontend engineer
- QA engineer
- security engineer

Treat this as a configurable relationship and scheduling system for ClearLedger that can adapt to many industries and business workflows.

## Objective

Add a flexible CRM and calendar layer to ClearLedger that helps users manage clients, contacts, meetings, follow-ups, notes, and customer information. The calendar must be highly configurable so users can place whatever events they foreseeably need to track and, where appropriate, link those events to business records.

## Why this matters

Users need more than a fixed list of invoice and bill due dates. They need a calendar that can represent service appointments, job starts, follow-ups, reminders, project milestones, client meetings, onboarding events, and other operational activities. The system should be customizable enough for different industries and business models without becoming a disconnected calendar product.

## Product scope

The first release should support:

- clients and contacts
- meetings, appointments, and reminders
- follow-up tasks and notes
- a configurable calendar that can display multiple event types
- custom event categories, labels, and statuses
- calendar events that can be tied to client records, projects, invoices, bills, or other business entities where relevant
- multi-industry flexibility so the same system can serve accountants, service businesses, field workers, and project-based operations

## Required behavior

- Users can create and manage clients and contacts.
- Users can create meetings, appointments, reminders, and follow-up tasks.
- Users can record notes and activity history against a client or contact.
- The calendar must support configurable event types and categories so users can add whatever they need to track.
- The calendar should allow users to define custom labels, statuses, and visual grouping to suit their workflow.
- Calendar events should be able to link to clients, contacts, projects, invoices, bills, or other relevant entities where applicable.
- The calendar should remain tenant-scoped, authorization-aware, and auditable.
- Calendar events must not create accounting entries unless they are explicitly part of an existing accounting workflow.

## Suggested implementation shape

Use a flexible but bounded domain model:

- client records
- contact records
- activity records with types such as meeting, note, follow-up, task, reminder, milestone, custom event
- configurable categories/statuses/tags
- calendar event definitions that can be extended by the user or by configuration
- timeline and calendar views that surface both accounting and non-accounting events

Prefer extending existing customer, calendar, and audit patterns rather than introducing a disconnected CRM/calendar architecture.

## Scope boundaries

Do not add:

- a generic social network
- marketing automation
- lead scoring
- AI-generated workflow recommendations
- a separate standalone CRM platform disconnected from accounting and project workflows

## Acceptance criteria

1. Users can create and manage clients and contacts.
2. Users can create meetings, reminders, notes, and follow-up tasks.
3. Calendar events support configurable categories, labels, and statuses.
4. Users can create calendar events for a wide variety of foreseeable business needs.
5. Calendar events can be linked to clients and related business records where appropriate.
6. Authorization and tenant isolation remain intact.
7. The implementation is testable and does not bypass accounting rules.
8. Focused tests only for the new core behavior; avoid broad or redundant coverage.

## Implementation instructions for the agent

- Start from existing customer, calendar, and permissions infrastructure.
- Reuse tenant-scoping, audit patterns, and existing customer/accounting data.
- Design the first version to be flexible and configurable without overbuilding.
- Make the calendar extensible enough to support industry-specific workflows.
- Update API, web experience, and documentation surfaces.
- Run formatting, type checks, and the smallest useful set of focused tests before finishing.
- Do not claim completion without fresh verification evidence.

## Execution prompt

> Implement a flexible CRM and calendar layer for ClearLedger that supports client management, contacts, meetings, follow-ups, notes, and configurable calendar events. The calendar must be customizable enough to represent whatever events users could foreseeably need to post or track, such as appointments, job starts, follow-ups, reminders, milestones, and other operational events. Reuse existing customer, calendar, authorization, tenant-isolation, and audit infrastructure. Keep the workflow accounting-safe and configurable, and do not allow CRM or calendar actions to bypass existing accounting rules. Update the API and web experience, add only focused tests for the core behavior, and verify the result with concrete evidence.

## Delivery status

Implemented in place on 2026-08-06. The release uses `CustomerContact` and append-only
`CustomerActivity` records plus the existing `ProjectWorkItem` and read-only calendar
projection. It adds configurable event type, custom status, category, label, location,
time, and bounded related-record links without adding a second CRM subsystem or any
accounting posting path. See `docs/CRM_AND_CALENDAR.md` for the operator workflow and
verification evidence.
