# Implement CRM and client activity workflow

Status: drafted 2026-08-06

## Role

Act as a world-class delivery team with:

- product manager
- accounting workflow specialist
- backend engineer
- frontend engineer
- QA engineer
- security engineer

Treat this as a bounded, accountant-first implementation, not a generic sales CRM build.

## Objective

Add a lightweight CRM and client-activity layer to ClearLedger that helps bookkeepers and accountants manage client relationships, contacts, appointments, notes, and follow-up activity without turning the product into a sprawling sales platform.

## Why this matters

The current repository already has a strong accounting core and a calendar projection layer, but it does not yet provide a practical relationship-management experience for accountants and bookkeepers. The gap is not a full CRM; it is a focused workflow around customer relationships, reminders, notes, tasks, and engagement history.

## Repository context to use

Use the existing implementation in:

- apps/api/src/services/calendar-service.ts
- apps/api/src/services/customer-service.ts
- packages/db/prisma/schema.prisma
- apps/api/src/app.ts
- apps/web/app.js

The implementation should build on existing customer records, calendar events, audit patterns, and tenant-scoped authorization rather than creating a separate subsystem.

## Product scope

The first release should focus on the most valuable CRM-like capabilities for accounting users:

- link contacts to customers or organizations
- create appointments and reminders
- record notes and follow-up activity
- show a timeline of engagement for a customer
- surface upcoming activities from the calendar view
- keep all activity tied to the customer/accounting context

## Required behavior

- Allow users to create and manage contacts associated with a customer or organization.
- Allow users to create appointments, reminders, notes, and follow-up tasks.
- Provide a customer activity timeline that combines notes, appointments, and related accounting events where appropriate.
- Reuse the existing calendar service for scheduling and visibility.
- Keep the workflow tenant-scoped and authorization-aware.
- Preserve audit evidence for any activity that affects business operations or customer records.
- Do not allow CRM actions to create accounting entries unless they are explicitly part of an existing accounting workflow.

## Scope boundaries

Do not add:

- a full sales pipeline
- marketing automation
- email campaigns
- lead scoring
- AI-generated customer insights
- a standalone CRM product with its own data model disconnected from accounting

## Suggested implementation shape

Use a narrow domain model that can be implemented safely and quickly:

- contact records linked to customers/organizations
- activity records with types such as appointment, note, follow-up, call, email, task
- a timeline view per customer or organization
- a calendar-backed reminder experience

Prefer extending existing customer and calendar capabilities rather than introducing a separate product architecture.

## Acceptance criteria

1. Users can create and view contacts for a customer or organization.
2. Users can create notes and activities tied to the customer context.
3. Activities appear in a timeline and in the calendar where relevant.
4. Authorization and tenant isolation remain intact.
5. The implementation is testable and does not bypass accounting rules.
6. Focused tests cover contact creation, activity creation, calendar visibility, permissions, and audit evidence.

## Implementation instructions for the agent

- Start from the existing customer and calendar services.
- Reuse permissions, tenant-scoping, and audit patterns already present in the repository.
- Keep the first release practical and accountant-focused.
- Use simple, explicit workflows rather than overbuilding a CRM.
- Update relevant API, UI, and documentation surfaces.
- Run formatting, type checks, and focused tests before finishing.
- Do not claim completion without fresh verification evidence.

## Execution prompt

> Implement a lightweight CRM and client-activity layer for ClearLedger by extending the existing customer and calendar architecture. Add contact management, notes, activities, appointments, and a customer timeline without building a separate sales CRM platform. Reuse existing authorization, tenant isolation, audit, and calendar patterns. Keep the workflow accountant-first and accounting-safe, and do not allow CRM actions to bypass existing accounting rules. Update the API and web experience, add focused tests, and verify the result with concrete evidence.
