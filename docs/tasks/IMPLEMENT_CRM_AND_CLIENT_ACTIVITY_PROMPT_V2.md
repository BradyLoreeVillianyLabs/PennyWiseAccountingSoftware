# Implement CRM and client activity workflow v2

Status: revised for broader but still bounded CRM use 2026-08-06

## Role

Act as a world-class delivery team with:

- product manager
- accounting workflow specialist
- backend engineer
- frontend engineer
- QA engineer
- security engineer

Treat this as a configurable business-relationship system for users of ClearLedger, not as a generic sales CRM or a loosely scoped social platform.

## Objective

Add a flexible CRM layer to ClearLedger that helps organizations manage clients, contacts, meetings, follow-ups, notes, and customer information in a way that can support:

- service businesses
- accountants and bookkeepers
- professional service firms
- project-based work
- sales-style client tracking
- industry-specific workflows

The system should be usable as a client management hub, a meeting/calendar layer, and a configurable relationship tool without becoming a separate full-scale CRM product.

## Why this matters

Users need a practical place to manage business relationships inside the same system where they already manage accounting, projects, invoices, and scheduling. The CRM should help them track who they work with, when they meet, what was discussed, and what needs follow-up.

## Product scope

The first release should support the following core capabilities:

- manage clients and contacts
- store customer information and communication notes
- create meetings, appointments, and reminders
- track follow-up tasks and activity history
- show a timeline of engagement for each client
- support configurable stages, tags, and categories so different industries can adapt the CRM
- surface CRM activities in the calendar and dashboard
- keep the CRM connected to existing customer and accounting context

## Required behavior

- Users can create and manage clients and contacts.
- Users can create meetings, appointments, reminders, and follow-up tasks.
- Users can record notes and activity history against a client or contact.
- The CRM should support configurable fields, categories, and status labels so it can be adapted across industries.
- The system should support both simple contact management and more structured client-tracking flows.
- Activities should be visible in a calendar-like view and in a client timeline.
- The workflow should remain tenant-scoped, authorization-aware, and auditable.
- CRM activity must not create accounting entries unless it is explicitly part of an existing accounting workflow.

## Suggested implementation shape

Use a flexible but bounded domain model:

- client records
- contact records
- activity records with types such as meeting, note, follow-up, call, task, reminder
- configurable status/category/tag fields
- a timeline view per client
- a calendar-backed reminder and scheduling experience

Prefer extending existing customer, calendar, and audit patterns rather than introducing a separate disconnected CRM architecture.

## Scope boundaries

Do not add:

- full marketing automation
- email campaign engines
- lead scoring
- sales forecasting engines
- AI-generated relationship insights
- a standalone CRM product disconnected from accounting and project workflows

## Acceptance criteria

1. Users can create and manage clients and contacts in a shared CRM layer.
2. Users can create meetings, reminders, notes, and follow-up tasks.
3. Activities appear in a calendar and in a client timeline.
4. The CRM supports configurable categories, statuses, or tags for different industries.
5. Authorization and tenant isolation remain intact.
6. The implementation is testable and does not bypass accounting rules.
7. Focused tests cover client creation, contact management, activity creation, calendar visibility, configuration fields, permissions, and audit evidence.

## Implementation instructions for the agent

- Start from existing customer, calendar, and permissions infrastructure.
- Reuse tenant-scoping, audit patterns, and existing customer/accounting data.
- Design the first version to be flexible but not overbuilt.
- Keep the workflow practical for both accountants and general service businesses.
- Update API, web experience, and documentation surfaces.
- Run formatting, type checks, and focused tests before finishing.
- Do not claim completion without fresh verification evidence.

## Execution prompt

> Implement a flexible CRM layer for ClearLedger that supports client management, contacts, meetings, follow-ups, notes, and configurable workflow fields. The system should be usable as a client-management tool, a scheduling hub, and an industry-adaptable relationship layer without becoming a separate full-scale CRM. Reuse existing customer, calendar, authorization, tenant-isolation, and audit infrastructure. Keep the workflow accounting-safe and configurable, and do not allow CRM actions to bypass existing accounting rules. Update the API and web experience, add focused tests, and verify the result with concrete evidence.
