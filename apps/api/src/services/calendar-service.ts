import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { parseDate } from "../utils/dates.js";

const maximumCalendarDays = 366;
const maximumRowsPerSource = 1_000;

export type CalendarEventKind =
  | "PROJECT_START"
  | "PROJECT_END"
  | "WORK_ITEM_START"
  | "WORK_ITEM_DUE"
  | "WORK_ITEM_MILESTONE"
  | "INVOICE_DUE"
  | "BILL_DUE";
export type CalendarEventAuthority = "PLANNED" | "DRAFT" | "APPROVED" | "POSTED";

export interface CalendarRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface CalendarEvent {
  readonly id: string;
  readonly kind: CalendarEventKind;
  readonly date: string;
  readonly title: string;
  readonly financial: boolean;
  readonly authority: CalendarEventAuthority;
  readonly sourceStatus: string;
  readonly eventType?: string | null;
  readonly customStatus?: string | null;
  readonly category?: string | null;
  readonly label?: string | null;
  readonly location?: string | null;
  /** User-entered appointment or task detail, safe for the calendar inspector. */
  readonly description?: string | null;
  /** Display values keep record IDs out of the user-facing calendar. */
  readonly customerName?: string | null;
  readonly contactName?: string | null;
  readonly projectName?: string | null;
  readonly assigneeName?: string | null;
  readonly customerId?: string | null;
  readonly contactId?: string | null;
  readonly startAt?: string | null;
  readonly endAt?: string | null;
  readonly relatedResourceType?: string | null;
  readonly relatedResourceId?: string | null;
  /** Only timed planning records can be moved from the calendar. Financial dates never can. */
  readonly canReschedule: boolean;
  /** Optimistic-concurrency version for an editable planning record, never displayed to users. */
  readonly version: number | null;
  readonly amountMinor: string | null;
  readonly currency: string | null;
  readonly source: {
    readonly type: "PROJECT" | "PROJECT_WORK_ITEM" | "INVOICE" | "BILL";
    readonly id: string;
    readonly href: string;
    readonly reference: string;
  };
}

export interface CalendarResult {
  readonly range: { readonly startDate: string; readonly endDate: string };
  readonly events: readonly CalendarEvent[];
  readonly mode: "READ_ONLY";
  readonly accountingEntriesCreated: 0;
}

/**
 * Tenant-scoped calendar projection. It only reads authoritative source records;
 * no projection is persisted and no financial record is changed.
 */
export class CalendarService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext, range: CalendarRange): Promise<CalendarResult> {
    await this.authorization.assert(context, "reports:read", "Calendar");
    const dates = validateCalendarRange(range);
    const endExclusive = new Date(dates.end);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const rows = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [projects, workItems, invoices, bills] = await Promise.all([
        tx.project.findMany({
          where: {
            organizationId: context.organizationId,
            status: { not: "ARCHIVED" },
            OR: [
              { startDate: { gte: dates.start, lte: dates.end } },
              { endDate: { gte: dates.start, lte: dates.end } }
            ]
          },
          select: {
            id: true,
            projectNumber: true,
            name: true,
            status: true,
            startDate: true,
            endDate: true
          },
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
          take: maximumRowsPerSource + 1
        }),
        tx.projectWorkItem.findMany({
          where: {
            organizationId: context.organizationId,
            archivedAt: null,
            OR: [
              { startDate: { gte: dates.start, lte: dates.end } },
              { dueDate: { gte: dates.start, lte: dates.end } },
              { startAt: { gte: dates.start, lt: endExclusive } },
              { endAt: { gte: dates.start, lt: endExclusive } }
            ]
          },
          select: {
            id: true,
            kind: true,
            title: true,
            description: true,
            status: true,
            projectId: true,
            startDate: true,
            dueDate: true,
            startAt: true,
            endAt: true,
            version: true,
            eventType: true,
            customStatus: true,
            category: true,
            label: true,
            location: true,
            customerId: true,
            contactId: true,
            assigneeMembershipId: true,
            relatedResourceType: true,
            relatedResourceId: true,
            customer: { select: { displayName: true } },
            contact: { select: { name: true } },
            project: { select: { projectNumber: true, name: true } },
            assigneeMembership: { select: { user: { select: { displayName: true, email: true } } } }
          },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
          take: maximumRowsPerSource + 1
        }),
        tx.invoice.findMany({
          where: {
            organizationId: context.organizationId,
            status: { not: "VOIDED" },
            dueDate: { gte: dates.start, lte: dates.end }
          },
          select: {
            id: true,
            invoiceNumber: true,
            provisionalIdentifier: true,
            customerNameSnapshot: true,
            status: true,
            dueDate: true,
            currency: true,
            grandTotalMinor: true
          },
          orderBy: [{ dueDate: "asc" }, { id: "asc" }],
          take: maximumRowsPerSource + 1
        }),
        tx.bill.findMany({
          where: {
            organizationId: context.organizationId,
            status: { not: "VOIDED" },
            dueDate: { gte: dates.start, lte: dates.end }
          },
          select: {
            id: true,
            vendorInvoiceNumber: true,
            vendorNameSnapshot: true,
            status: true,
            dueDate: true,
            currency: true,
            grandTotalMinor: true
          },
          orderBy: [{ dueDate: "asc" }, { id: "asc" }],
          take: maximumRowsPerSource + 1
        })
      ]);
      assertSourceLimit("projects", projects.length);
      assertSourceLimit("project work items", workItems.length);
      assertSourceLimit("invoices", invoices.length);
      assertSourceLimit("bills", bills.length);
      return { projects, workItems, invoices, bills };
    });

    return {
      range: { startDate: dateOnly(dates.start), endDate: dateOnly(dates.end) },
      events: calendarEvents(rows)
        .filter((event) => event.date >= dateOnly(dates.start) && event.date <= dateOnly(dates.end))
        .sort(calendarEventOrder),
      mode: "READ_ONLY",
      accountingEntriesCreated: 0
    };
  }
}

export function validateCalendarRange(range: CalendarRange): {
  readonly start: Date;
  readonly end: Date;
} {
  const start = calendarDate(range.startDate, "startDate");
  const end = calendarDate(range.endDate, "endDate");
  if (end < start)
    throw new AppError("CALENDAR_RANGE_INVALID", "Calendar endDate cannot precede startDate.", 422);
  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > maximumCalendarDays)
    throw new AppError(
      "CALENDAR_RANGE_TOO_LARGE",
      `Calendar requests are limited to ${maximumCalendarDays.toString()} days.`,
      422
    );
  return { start, end };
}

type CalendarRows = {
  readonly projects: readonly {
    id: string;
    projectNumber: string;
    name: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
  }[];
  readonly workItems: readonly {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    status: string;
    projectId: string | null;
    startDate: Date | null;
    dueDate: Date | null;
    startAt: Date | null;
    endAt: Date | null;
    version: number;
    eventType: string;
    customStatus: string | null;
    category: string | null;
    label: string | null;
    location: string | null;
    customerId: string | null;
    contactId: string | null;
    assigneeMembershipId: string | null;
    relatedResourceType: string | null;
    relatedResourceId: string | null;
    customer: { displayName: string } | null;
    contact: { name: string } | null;
    project: { projectNumber: string; name: string } | null;
    assigneeMembership: { user: { displayName: string | null; email: string } } | null;
  }[];
  readonly invoices: readonly {
    id: string;
    invoiceNumber: string | null;
    provisionalIdentifier: string;
    customerNameSnapshot: string;
    status: string;
    dueDate: Date;
    currency: string;
    grandTotalMinor: bigint;
  }[];
  readonly bills: readonly {
    id: string;
    vendorInvoiceNumber: string;
    vendorNameSnapshot: string | null;
    status: string;
    dueDate: Date;
    currency: string;
    grandTotalMinor: bigint;
  }[];
};

export function calendarEvents(rows: CalendarRows): CalendarEvent[] {
  return [
    ...rows.projects.flatMap((project) => [
      ...(project.startDate
        ? [
            projectEvent(
              project,
              "PROJECT_START",
              project.startDate,
              `Project starts: ${project.name}`
            )
          ]
        : []),
      ...(project.endDate
        ? [projectEvent(project, "PROJECT_END", project.endDate, `Project ends: ${project.name}`)]
        : [])
    ]),
    ...rows.workItems.flatMap(workItemEvents),
    ...rows.invoices.map((invoice) => ({
      id: `invoice:${invoice.id}:due`,
      kind: "INVOICE_DUE" as const,
      date: dateOnly(invoice.dueDate),
      title: `Invoice due: ${invoice.invoiceNumber ?? invoice.provisionalIdentifier}`,
      financial: true,
      authority: financialAuthority(invoice.status),
      sourceStatus: invoice.status,
      canReschedule: false,
      version: null,
      amountMinor: invoice.grandTotalMinor.toString(),
      currency: invoice.currency.trim().toUpperCase(),
      source: {
        type: "INVOICE" as const,
        id: invoice.id,
        href: `/invoices/${invoice.id}`,
        reference: invoice.invoiceNumber ?? invoice.provisionalIdentifier
      }
    })),
    ...rows.bills.map((bill) => ({
      id: `bill:${bill.id}:due`,
      kind: "BILL_DUE" as const,
      date: dateOnly(bill.dueDate),
      title: `Bill due: ${bill.vendorInvoiceNumber}`,
      financial: true,
      authority: financialAuthority(bill.status),
      sourceStatus: bill.status,
      canReschedule: false,
      version: null,
      amountMinor: bill.grandTotalMinor.toString(),
      currency: bill.currency.trim().toUpperCase(),
      source: {
        type: "BILL" as const,
        id: bill.id,
        href: `/bills/${bill.id}`,
        reference: bill.vendorInvoiceNumber
      }
    }))
  ];
}

function workItemEvents(workItem: CalendarRows["workItems"][number]): CalendarEvent[] {
  if (workItem.kind === "MILESTONE") {
    if (!workItem.dueDate) return [];
    return [
      workItemEvent(
        workItem,
        "WORK_ITEM_MILESTONE",
        workItem.dueDate,
        `Milestone: ${workItem.title}`
      )
    ];
  }
  // A timed CRM item is one appointment with a duration, not two unrelated calendar rows.
  // Date-only work continues to expose distinct start and due markers.
  if (workItem.startAt) {
    return [
      workItemEvent(
        workItem,
        "WORK_ITEM_START",
        workItem.startAt,
        `${workItem.eventType || workItem.kind}: ${workItem.title}`
      )
    ];
  }
  return [
    ...(workItem.startDate
      ? [
          workItemEvent(
            workItem,
            "WORK_ITEM_START",
            workItem.startDate,
            `${workItem.eventType || workItem.kind}: ${workItem.title}`
          )
        ]
      : []),
    ...(workItem.endAt
      ? [
          workItemEvent(
            workItem,
            "WORK_ITEM_DUE",
            workItem.endAt,
            `${workItem.eventType || workItem.kind} ends: ${workItem.title}`
          )
        ]
      : workItem.dueDate
        ? [
            workItemEvent(
              workItem,
              "WORK_ITEM_DUE",
              workItem.dueDate,
              `${workItem.eventType || workItem.kind} due: ${workItem.title}`
            )
          ]
        : [])
  ];
}

function workItemEvent(
  workItem: CalendarRows["workItems"][number],
  kind: "WORK_ITEM_START" | "WORK_ITEM_DUE" | "WORK_ITEM_MILESTONE",
  date: Date,
  title: string
): CalendarEvent {
  const suffix =
    kind === "WORK_ITEM_START" ? "start" : kind === "WORK_ITEM_DUE" ? "due" : "milestone";
  return {
    id: `project-work-item:${workItem.id}:${suffix}`,
    kind,
    date: dateOnly(date),
    title,
    financial: false,
    authority: "PLANNED",
    sourceStatus: workItem.status,
    eventType: workItem.eventType,
    customStatus: workItem.customStatus,
    category: workItem.category,
    label: workItem.label,
    location: workItem.location,
    description: workItem.description,
    customerName: workItem.customer?.displayName ?? null,
    contactName: workItem.contact?.name ?? null,
    projectName: workItem.project
      ? `${workItem.project.projectNumber} — ${workItem.project.name}`
      : null,
    assigneeName:
      workItem.assigneeMembership?.user.displayName ??
      workItem.assigneeMembership?.user.email ??
      null,
    customerId: workItem.customerId,
    contactId: workItem.contactId,
    startAt: workItem.startAt?.toISOString() ?? null,
    endAt: workItem.endAt?.toISOString() ?? null,
    relatedResourceType: workItem.relatedResourceType,
    relatedResourceId: workItem.relatedResourceId,
    canReschedule: Boolean(workItem.startAt),
    version: workItem.version,
    amountMinor: null,
    currency: null,
    source: {
      type: "PROJECT_WORK_ITEM",
      id: workItem.id,
      href: `/project-work-items/${workItem.id}`,
      reference: workItem.title
    }
  };
}

function projectEvent(
  project: CalendarRows["projects"][number],
  kind: "PROJECT_START" | "PROJECT_END",
  date: Date,
  title: string
): CalendarEvent {
  return {
    id: `project:${project.id}:${kind === "PROJECT_START" ? "start" : "end"}`,
    kind,
    date: dateOnly(date),
    title,
    financial: false,
    authority: "PLANNED",
    sourceStatus: project.status,
    canReschedule: false,
    version: null,
    amountMinor: null,
    currency: null,
    source: {
      type: "PROJECT",
      id: project.id,
      href: `/projects/${project.id}`,
      reference: project.projectNumber
    }
  };
}

function financialAuthority(status: string): CalendarEventAuthority {
  if (status === "DRAFT") return "DRAFT";
  if (status === "APPROVED") return "APPROVED";
  return "POSTED";
}

function calendarDate(value: string, fieldName: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new AppError("INVALID_DATE", `${fieldName} must be a YYYY-MM-DD date.`, 400, {
      fieldName
    });
  const date = parseDate(value, fieldName);
  if (dateOnly(date) !== value)
    throw new AppError("INVALID_DATE", `${fieldName} must be a valid calendar date.`, 400, {
      fieldName
    });
  return date;
}

function assertSourceLimit(source: string, count: number): void {
  if (count > maximumRowsPerSource)
    throw new AppError(
      "CALENDAR_RESULT_LIMIT_EXCEEDED",
      `Too many ${source} fall within this range. Narrow the calendar range.`,
      422
    );
}

function calendarEventOrder(left: CalendarEvent, right: CalendarEvent): number {
  return left.date.localeCompare(right.date) || left.id.localeCompare(right.id);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
