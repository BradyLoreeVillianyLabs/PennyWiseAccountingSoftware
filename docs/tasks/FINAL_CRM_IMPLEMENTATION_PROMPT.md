# Final CRM implementation prompt for Codex

Status: refined for development submission 2026-08-06

## Objective

Extend the CRM and calendar work already present in the repository into a practical, configurable implementation for ClearLedger. The deliverable should help users manage clients, contacts, meetings, follow-ups, notes, and operational activity in a way that supports accountants, service businesses, project-based organizations, and other industries.

The calendar should be flexible enough to represent the kinds of events users routinely need to track or review, including appointments, job starts, follow-ups, reminders, milestones, client meetings, onboarding events, and other business activities.

## Product intent

This is not a generic sales CRM or a disconnected social platform. It is a business-relationship and scheduling layer that lives inside ClearLedger and is tightly connected to customers, projects, invoices, bills, and the existing accounting context.

## What to build

Implement the following core capabilities:

- client and contact management
- notes and activity history for each client or contact
- meetings, appointments, reminders, and follow-up tasks
- a configurable calendar with multiple event types and categories
- custom labels, statuses, and grouping options for industry-specific workflows
- links from calendar events to clients, contacts, projects, invoices, bills, and other relevant business records where appropriate
- a timeline view that shows client activity and calendar events together

## Implementation guidance

Use the existing ClearLedger repository as the source of truth. Do not start over from scratch. Extend and improve the pieces already in place, especially the current implementation in:

- apps/api/src/services/calendar-service.ts
- apps/api/src/services/customer-service.ts
- packages/db/prisma/schema.prisma
- apps/api/src/app.ts
- apps/web/app.js

Extend the existing customer, calendar, audit, and permission patterns rather than creating a separate CRM subsystem. Keep the implementation bounded and practical. The first release should be flexible without becoming overbuilt.

## Required behavior

- Users can create and manage clients and contacts.
- Users can create meetings, appointments, reminders, notes, and follow-up tasks.
- Users can record client activity and view it in a timeline.
- The calendar supports configurable event types, categories, labels, and statuses.
- Calendar events can be linked to clients and related business records where appropriate.
- The system remains tenant-scoped, authorization-aware, and auditable.
- CRM and calendar actions must not create accounting entries unless they are explicitly part of an existing accounting workflow.

## Scope boundaries

Do not add:

- a generic social network
- marketing automation
- lead scoring
- AI-generated workflow recommendations
- a standalone CRM platform disconnected from accounting and project workflows

## Acceptance criteria

1. Users can create and manage clients and contacts.
2. Users can create meetings, reminders, notes, and follow-up tasks.
3. Calendar events support configurable categories, labels, and statuses.
4. Users can create calendar events for a wide variety of foreseeable business needs.
5. Calendar events can be linked to clients and related business records where appropriate.
6. Authorization and tenant isolation remain intact.
7. The implementation is testable and does not bypass accounting rules.
8. Focused tests cover the new core behavior without broad or redundant coverage.

## Implementation instructions for the agent

- Start from the existing customer and calendar services and improve what is already there.
- Reuse tenant-scoping, permissions, audit patterns, and existing customer/accounting data.
- Design the first version to be flexible and configurable without overbuilding.
- Make the calendar extensible enough to support industry-specific workflows.
- Update the relevant API, web experience, and documentation surfaces.
- Run formatting, type checks, and the smallest useful set of focused tests before finishing.
- Do not claim completion without fresh verification evidence.

## Final execution prompt

Implement a flexible CRM and calendar layer for ClearLedger by extending and improving the work already present in the repository. Support client management, contacts, meetings, follow-ups, notes, and configurable calendar events. Make the calendar customizable enough to represent the events users could foreseeably need to track or review, including appointments, job starts, follow-ups, reminders, milestones, and other operational events. Reuse existing customer, calendar, authorization, tenant-isolation, and audit infrastructure. Keep the workflow accounting-safe and configurable, and do not allow CRM or calendar actions to bypass existing accounting rules. Update the API and web experience, add only focused tests for the core behavior, and verify the result with concrete evidence.

## Execution record

Implemented on 2026-08-06. The implementation extends `Customer`, adds tenant-scoped
contacts and append-only activity, extends `ProjectWorkItem` with configurable CRM
metadata and custom statuses, and surfaces the combined timeline in the existing
Projects and planning workspace. See `docs/CRM_AND_CALENDAR.md` for the operator
workflow and verification evidence.
