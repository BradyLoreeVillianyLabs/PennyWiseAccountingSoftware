# CRM and calendar layer

ClearLedger now provides a practical client-relationship and scheduling layer inside the existing customer, project, calendar, permission, and audit architecture. It is deliberately not a separate CRM product.

## What users can do

- Maintain multiple contacts for each customer, including role, communication details, preferred channel, and notes.
- Record append-only notes and activity such as calls, emails, meetings, and follow-ups.
- Create planning records for tasks, reminders, meetings, appointments, follow-ups, and milestones.
- Use a custom status alongside the standard workflow status when an industry needs labels such as `Awaiting client`, `Confirmed`, or `Ready for site visit`.
- Add custom event type, category, label, location, start/end time, and optional links to a customer contact or project, invoice, estimate, or bill.
- Review a customer timeline that combines relationship activity with linked planning records.
- See planning records in a professional Day, Week, Month, or Agenda calendar beside project dates and invoice/bill due dates.
- Drag a timed appointment, meeting, follow-up, or other CRM planning item onto a new time slot. The move preserves its duration, uses the company time zone, uses the record's optimistic version check, and creates no accounting entry.
- Select a calendar item to see its schedule, client, contact, job, assignee, location, category, label, description, linked business item, and (when relevant) amount. Internal record IDs, provider/source labels, and authorization implementation details are not shown in the business interface.

## Safety and permissions

Customer contacts and relationship activity require the existing `customers:read` or `customers:manage` permissions. Planning records continue to use `projects:read` and `projects:manage`. Every record is organization-scoped, carries audit evidence, and validates related records within the same organization. Activity history is append-only; contacts and planning records use version checks and archive rather than destructive deletion.

CRM and calendar actions are non-posting. They do not create journals, invoices, bills, inventory movements, payments, or tax entries. To affect accounting, a user must use an existing accounting workflow with its normal review and posting controls.

## API surface

- `GET/POST /v1/customers/:customerId/contacts`
- `PATCH/POST /v1/customer-contacts/:contactId` and `/archive`
- `GET /v1/customers/:customerId/timeline` and `POST /v1/customers/:customerId/activities`
- `GET/POST/PATCH /v1/project-work-items` with CRM links and configurable event metadata
- `GET /v1/calendar/events` for the non-posting projection. Timed planning items include the display details needed by the schedule plus a bounded rescheduling capability; invoice and bill dates are never reschedulable through Calendar.

The related-record fields are intentionally bounded to existing tenant-owned project, invoice, estimate, and bill records. Unsupported or cross-tenant links fail closed.

## UI workflow

Open Projects and planning, select a client in the Clients panel, and manage contacts, activity, and timeline entries there. Use Tasks to create a planning item. Selecting a client loads its active contacts into the work-item form; meetings, appointments, and follow-ups can then be scheduled with optional time, location, category, label, and linked-item context. Open Schedule for a Day, Week, Month, or Agenda view. Timed CRM events appear as duration-aware time blocks; users with planning permission can drag them to a new slot or use the keyboard-accessible date/time editor. Project milestones and financial due dates remain all-day items, and invoice/bill due dates must be changed from their document workflow.

## Interaction reference and acceptance contract

The schedule behavior follows the established interaction model documented by the open-source [FullCalendar project](https://github.com/fullcalendar/fullcalendar): a time-grid Week view, Day/Week/Month/Agenda navigation, selecting an event for details, and drag/drop only for editable events. PennyWise implements that behavior directly in its existing accessible vanilla-JavaScript interface so it can preserve the tenant-scoped project-work-item service, optimistic concurrency, and non-posting boundary. Focused browser coverage verifies timed CRM placement, readable details without backend-source wording, editable planning moves, and read-only financial deadlines.

Calendar range loads are last-request-wins: an older response cannot redraw a newer range or
replace an event while the user is opening it. This keeps date navigation and rescheduling
reliable when project, calendar, and relationship data refresh at the same time.

## Verification

Focused coverage is provided by `apps/api/src/services/calendar-service.test.ts` for deterministic event projection and by `apps/api/src/phase18-projects.integration.test.ts` for tenant-scoped contacts, append-only activity, linked planning events, calendar projection, and the zero-accounting-entry boundary. On 2026-08-06, the PostgreSQL-backed suite passed 31 files and 196 tests, including both Phase 18 CRM tests. The final local gates also passed formatting, lint, typecheck, workspace build, web asset tests, and release-contract verification.
