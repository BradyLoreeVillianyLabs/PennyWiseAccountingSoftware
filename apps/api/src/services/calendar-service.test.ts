import type { PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { describe, expect, it } from "vitest";
import { CalendarService, calendarEvents, validateCalendarRange } from "./calendar-service.js";

const context: OrganizationContext = {
  requestId: "calendar-request",
  organizationId: "organization-a",
  membershipId: "membership-a",
  role: "READ_ONLY",
  user: {
    id: "user-a",
    email: "calendar@example.test",
    displayName: "Calendar User",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
  },
  sessionId: "session-a",
  recentAuthAt: new Date("2026-01-01T00:00:00.000Z"),
  mfaAuthenticated: false,
  authenticationMethod: "DEVELOPMENT",
  auditOrigin: { ipAddress: null, userAgent: null }
};

describe("CalendarService", () => {
  it("keeps every source query within the authenticated organization and date range", async () => {
    const calls: Array<{ readonly source: string; readonly args: Record<string, unknown> }> = [];
    const service = new CalendarService(
      fakePrisma(calls, {
        projects: [
          {
            id: "project-a",
            projectNumber: "P-100",
            name: "Tenant A project",
            status: "ACTIVE",
            startDate: new Date("2026-06-05T00:00:00.000Z"),
            endDate: null
          }
        ],
        workItems: [],
        invoices: [],
        bills: []
      })
    );

    const result = await service.list(context, { startDate: "2026-06-01", endDate: "2026-06-30" });

    expect(result.events).toHaveLength(1);
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      const where = call.args.where as { organizationId: string };
      expect(where.organizationId).toBe(context.organizationId);
    }
    expect((calls[2]!.args.where as { dueDate: unknown }).dueDate).toEqual({
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lte: new Date("2026-06-30T00:00:00.000Z")
    });
    expect((calls[0]!.args.where as { status: unknown }).status).toEqual({ not: "ARCHIVED" });
    expect((calls[1]!.args.where as { archivedAt: unknown }).archivedAt).toBeNull();
    expect((calls[2]!.args.where as { status: unknown }).status).toEqual({ not: "VOIDED" });
    expect((calls[3]!.args.where as { status: unknown }).status).toEqual({ not: "VOIDED" });
  });

  it("returns only events that the bounded source queries place in the requested range", async () => {
    const calls: Array<{ readonly source: string; readonly args: Record<string, unknown> }> = [];
    const service = new CalendarService(
      fakePrisma(calls, {
        projects: [],
        workItems: [],
        invoices: [
          invoice("invoice-in-range", "2026-06-15", "POSTED"),
          invoice("invoice-outside", "2026-07-01", "POSTED")
        ],
        bills: []
      })
    );

    const result = await service.list(context, { startDate: "2026-06-01", endDate: "2026-06-30" });

    expect(result.events.map((event) => event.id)).toEqual(["invoice:invoice-in-range:due"]);
    expect(() => validateCalendarRange({ startDate: "2026-01-01", endDate: "2027-01-02" })).toThrow(
      "Calendar requests are limited"
    );
  });

  it("rejects an over-limit work-item source result", async () => {
    const service = new CalendarService(
      fakePrisma([], {
        projects: [],
        workItems: Array.from({ length: 1_001 }, (_, index) =>
          workItem(`task-${index.toString()}`, "TASK", "Task", null, "2026-06-15")
        ),
        invoices: [],
        bills: []
      })
    );

    await expect(
      service.list(context, { startDate: "2026-06-01", endDate: "2026-06-30" })
    ).rejects.toThrow("Too many project work items");
  });

  it("creates stable event identifiers and source links from source record identities", () => {
    const first = calendarEvents({
      projects: [
        {
          id: "project-1",
          projectNumber: "P-001",
          name: "Renamed project",
          status: "ACTIVE",
          startDate: new Date("2026-06-02T00:00:00.000Z"),
          endDate: new Date("2026-06-20T00:00:00.000Z")
        }
      ],
      workItems: [],
      invoices: [invoice("invoice-1", "2026-06-10", "POSTED")],
      bills: [bill("bill-1", "2026-06-12", "APPROVED")]
    });
    const second = calendarEvents({
      projects: [
        {
          id: "project-1",
          projectNumber: "P-001",
          name: "Project renamed again",
          status: "ACTIVE",
          startDate: new Date("2026-06-02T00:00:00.000Z"),
          endDate: new Date("2026-06-20T00:00:00.000Z")
        }
      ],
      workItems: [],
      invoices: [invoice("invoice-1", "2026-06-10", "POSTED")],
      bills: [bill("bill-1", "2026-06-12", "APPROVED")]
    });

    expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
    expect(first.find((event) => event.id === "project:project-1:start")?.source).toEqual({
      type: "PROJECT",
      id: "project-1",
      href: "/projects/project-1",
      reference: "P-001"
    });
  });

  it("marks project dates as planned and financial documents as draft, approved, or posted", () => {
    const events = calendarEvents({
      projects: [
        {
          id: "project-1",
          projectNumber: "P-001",
          name: "Planned work",
          status: "ACTIVE",
          startDate: new Date("2026-06-01T00:00:00.000Z"),
          endDate: null
        }
      ],
      workItems: [],
      invoices: [
        invoice("invoice-draft", "2026-06-02", "DRAFT"),
        invoice("invoice-posted", "2026-06-03", "PAID")
      ],
      bills: [bill("bill-approved", "2026-06-04", "APPROVED")]
    });

    expect(events.map((event) => [event.id, event.authority, event.financial])).toEqual([
      ["project:project-1:start", "PLANNED", false],
      ["invoice:invoice-draft:due", "DRAFT", true],
      ["invoice:invoice-posted:due", "POSTED", true],
      ["bill:bill-approved:due", "APPROVED", true]
    ]);
    expect(events.find((event) => event.id === "invoice:invoice-draft:due")?.amountMinor).toBe(
      "12345"
    );
    expect(events.find((event) => event.id === "invoice:invoice-draft:due")?.currency).toBe("CAD");
    expect(events.find((event) => event.id === "invoice:invoice-draft:due")?.canReschedule).toBe(
      false
    );
    expect(events.find((event) => event.id === "invoice:invoice-draft:due")?.version).toBeNull();
  });

  it("projects task, reminder, and milestone dates as stable planned non-financial events", () => {
    const events = calendarEvents({
      projects: [],
      workItems: [
        workItem("task-1", "TASK", "Prepare package", "2026-06-05", "2026-06-07"),
        workItem("reminder-1", "REMINDER", "Call customer", null, "2026-06-08"),
        workItem("milestone-1", "MILESTONE", "Client sign-off", null, "2026-06-10")
      ],
      invoices: [],
      bills: []
    });

    expect(events.map((event) => event.id)).toEqual([
      "project-work-item:task-1:start",
      "project-work-item:task-1:due",
      "project-work-item:reminder-1:due",
      "project-work-item:milestone-1:milestone"
    ]);
    expect(events.every((event) => event.authority === "PLANNED" && !event.financial)).toBe(true);
    expect(events.at(-1)?.source).toEqual({
      type: "PROJECT_WORK_ITEM",
      id: "milestone-1",
      href: "/project-work-items/milestone-1",
      reference: "Client sign-off"
    });
  });

  it("preserves configurable CRM event metadata without turning planning into accounting", () => {
    const events = calendarEvents({
      projects: [],
      workItems: [
        {
          ...workItem("meeting-1", "MEETING", "Quarterly review", null, null),
          startAt: new Date("2026-06-15T16:00:00.000Z"),
          endAt: new Date("2026-06-15T17:00:00.000Z"),
          eventType: "Client review",
          customStatus: "Awaiting client",
          category: "Onboarding",
          label: "Priority",
          location: "Video call",
          description: "Review the onboarding checklist and confirm next steps.",
          customerId: "customer-1",
          contactId: "contact-1",
          projectId: "project-1",
          assigneeMembershipId: "member-1",
          version: 4,
          relatedResourceType: "PROJECT",
          relatedResourceId: "project-1",
          customer: { displayName: "Bright Design" },
          contact: { name: "Jordan Lee" },
          project: { projectNumber: "P-001", name: "Onboarding" },
          assigneeMembership: {
            user: { displayName: "Avery Planner", email: "avery@example.test" }
          }
        }
      ],
      invoices: [],
      bills: []
    });

    // A timed CRM item is a duration-aware appointment, not separate start and end rows.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "WORK_ITEM_START",
      eventType: "Client review",
      customStatus: "Awaiting client",
      category: "Onboarding",
      label: "Priority",
      location: "Video call",
      customerId: "customer-1",
      contactId: "contact-1",
      relatedResourceType: "PROJECT",
      relatedResourceId: "project-1",
      financial: false,
      authority: "PLANNED",
      canReschedule: true,
      version: 4,
      description: "Review the onboarding checklist and confirm next steps.",
      customerName: "Bright Design",
      contactName: "Jordan Lee",
      projectName: "P-001 — Onboarding",
      assigneeName: "Avery Planner"
    });
    expect(events[0]?.id).toBe("project-work-item:meeting-1:start");
    expect(events[0]?.startAt).toBe("2026-06-15T16:00:00.000Z");
    expect(events[0]?.endAt).toBe("2026-06-15T17:00:00.000Z");
  });
});

function fakePrisma(
  calls: Array<{ readonly source: string; readonly args: Record<string, unknown> }>,
  rows: {
    readonly projects: readonly unknown[];
    readonly workItems: readonly unknown[];
    readonly invoices: readonly unknown[];
    readonly bills: readonly unknown[];
  }
): PrismaClient {
  const tx = {
    $executeRawUnsafe: () => Promise.resolve(0),
    $executeRaw: () => Promise.resolve(0),
    project: {
      findMany: (args: Record<string, unknown>) => {
        calls.push({ source: "project", args });
        return Promise.resolve(rows.projects);
      }
    },
    projectWorkItem: {
      findMany: (args: Record<string, unknown>) => {
        calls.push({ source: "projectWorkItem", args });
        return Promise.resolve(rows.workItems);
      }
    },
    invoice: {
      findMany: (args: Record<string, unknown>) => {
        calls.push({ source: "invoice", args });
        return Promise.resolve(rows.invoices);
      }
    },
    bill: {
      findMany: (args: Record<string, unknown>) => {
        calls.push({ source: "bill", args });
        return Promise.resolve(rows.bills);
      }
    }
  };
  return {
    $transaction: (work: (client: typeof tx) => unknown) => Promise.resolve(work(tx))
  } as unknown as PrismaClient;
}

function workItem(
  id: string,
  kind: string,
  title: string,
  startDate: string | null,
  dueDate: string | null
) {
  return {
    id,
    kind,
    title,
    description: null,
    status: "TODO",
    projectId: null,
    startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`) : null,
    dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null,
    startAt: null,
    endAt: null,
    version: 1,
    eventType: kind,
    customStatus: null,
    category: null,
    label: null,
    location: null,
    customerId: null,
    contactId: null,
    assigneeMembershipId: null,
    relatedResourceType: null,
    relatedResourceId: null,
    customer: null,
    contact: null,
    project: null,
    assigneeMembership: null
  };
}

function invoice(id: string, dueDate: string, status: string) {
  return {
    id,
    invoiceNumber: null,
    provisionalIdentifier: `DRAFT-${id}`,
    customerNameSnapshot: "Customer",
    status,
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    currency: "cad",
    grandTotalMinor: 12_345n
  };
}

function bill(id: string, dueDate: string, status: string) {
  return {
    id,
    vendorInvoiceNumber: `V-${id}`,
    vendorNameSnapshot: "Vendor",
    status,
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    currency: "usd",
    grandTotalMinor: 99_999n
  };
}
