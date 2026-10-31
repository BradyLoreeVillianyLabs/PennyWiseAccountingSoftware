import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate } from "../utils/dates.js";

export type ProjectWorkItemKind =
  | "TASK"
  | "MILESTONE"
  | "REMINDER"
  | "MEETING"
  | "APPOINTMENT"
  | "FOLLOW_UP";
export type ProjectWorkItemStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
export type ProjectWorkItemPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface ProjectWorkItemInput {
  readonly kind: ProjectWorkItemKind;
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly status?: ProjectWorkItemStatus | undefined;
  readonly priority?: ProjectWorkItemPriority | undefined;
  readonly projectId?: string | null | undefined;
  readonly customerId?: string | null | undefined;
  readonly contactId?: string | null | undefined;
  readonly assigneeMembershipId?: string | null | undefined;
  readonly eventType?: string | undefined;
  readonly customStatus?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly label?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly startAt?: string | null | undefined;
  readonly endAt?: string | null | undefined;
  readonly relatedResourceType?: string | null | undefined;
  readonly relatedResourceId?: string | null | undefined;
  readonly startDate?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
}

export interface ProjectWorkItemPatch {
  readonly version: number;
  readonly kind?: ProjectWorkItemKind | undefined;
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly priority?: ProjectWorkItemPriority | undefined;
  readonly projectId?: string | null | undefined;
  readonly customerId?: string | null | undefined;
  readonly contactId?: string | null | undefined;
  readonly assigneeMembershipId?: string | null | undefined;
  readonly eventType?: string | undefined;
  readonly customStatus?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly label?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly startAt?: string | null | undefined;
  readonly endAt?: string | null | undefined;
  readonly relatedResourceType?: string | null | undefined;
  readonly relatedResourceId?: string | null | undefined;
  readonly startDate?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
}

export interface ProjectWorkItemFilters {
  readonly projectId?: string | undefined;
  readonly customerId?: string | undefined;
  readonly contactId?: string | undefined;
  readonly assigneeMembershipId?: string | undefined;
  readonly kind?: ProjectWorkItemKind | undefined;
  readonly status?: ProjectWorkItemStatus | undefined;
  readonly eventType?: string | undefined;
  readonly customStatus?: string | undefined;
  readonly includeArchived?: boolean | undefined;
}

const maximumWorkItems = 500;

export class ProjectWorkItemService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext, filters: ProjectWorkItemFilters = {}) {
    await this.authorization.assert(context, "projects:read", "ProjectWorkItem");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.projectWorkItem.findMany({
        where: {
          organizationId: context.organizationId,
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.customerId ? { customerId: filters.customerId } : {}),
          ...(filters.contactId ? { contactId: filters.contactId } : {}),
          ...(filters.assigneeMembershipId
            ? { assigneeMembershipId: filters.assigneeMembershipId }
            : {}),
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.eventType ? { eventType: filters.eventType } : {}),
          ...(filters.customStatus ? { customStatus: filters.customStatus } : {}),
          ...(filters.includeArchived ? {} : { archivedAt: null })
        },
        include: dependencyInclude,
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: maximumWorkItems + 1
      })
    );
    if (rows.length > maximumWorkItems)
      throw new AppError(
        "PROJECT_WORK_ITEM_RESULT_LIMIT_EXCEEDED",
        `Project work-item requests are limited to ${maximumWorkItems.toString()} records. Narrow the filters.`,
        422
      );
    return rows.map(projectWorkItemDto);
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "projects:read", "ProjectWorkItem", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.projectWorkItem.findFirst({
        where: { id, organizationId: context.organizationId },
        include: dependencyInclude
      })
    );
    if (!row)
      throw new AppError("PROJECT_WORK_ITEM_NOT_FOUND", "Project work item was not found.", 404);
    return projectWorkItemDto(row);
  }

  public async create(context: OrganizationContext, input: ProjectWorkItemInput) {
    await this.authorization.assert(context, "projects:manage", "ProjectWorkItem");
    const values = validatedValues(input);
    validateDescription(input.description);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertReferences(
        tx,
        context.organizationId,
        input.projectId ?? null,
        input.assigneeMembershipId ?? null,
        input.customerId ?? null,
        input.contactId ?? null
      );
      await assertRelatedResource(
        tx,
        context.organizationId,
        input.relatedResourceType ?? null,
        input.relatedResourceId ?? null
      );
      const status = input.status ?? "TODO";
      const row = await tx.projectWorkItem.create({
        data: {
          organizationId: context.organizationId,
          kind: input.kind,
          title: values.title,
          description: input.description ?? null,
          status,
          priority: input.priority ?? "NORMAL",
          projectId: input.projectId ?? null,
          customerId: input.customerId ?? null,
          contactId: input.contactId ?? null,
          assigneeMembershipId: input.assigneeMembershipId ?? null,
          eventType: normalizedEventType(input.eventType, input.kind),
          customStatus: optionalText(input.customStatus, 80),
          category: optionalText(input.category, 80),
          label: optionalText(input.label, 80),
          location: optionalText(input.location, 500),
          startAt: values.startAt,
          endAt: values.endAt,
          relatedResourceType: input.relatedResourceType ?? null,
          relatedResourceId: input.relatedResourceId ?? null,
          startDate: values.startDate,
          dueDate: values.dueDate,
          completedAt: status === "COMPLETED" ? new Date() : null,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        },
        include: dependencyInclude
      });
      await audit(tx, context, "PROJECT_WORK_ITEM_CREATED", row.id, {
        kind: row.kind,
        projectId: row.projectId
      });
      return projectWorkItemDto(row);
    });
  }

  public async update(context: OrganizationContext, id: string, input: ProjectWorkItemPatch) {
    await this.authorization.assert(context, "projects:manage", "ProjectWorkItem", id);
    validateDescription(input.description);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.projectWorkItem.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("PROJECT_WORK_ITEM_NOT_FOUND", "Project work item was not found.", 404);
      assertNotArchived(current.archivedAt);
      const kind = input.kind ?? current.kind;
      const projectId = input.projectId === undefined ? current.projectId : input.projectId;
      const customerId = input.customerId === undefined ? current.customerId : input.customerId;
      const contactId = input.contactId === undefined ? current.contactId : input.contactId;
      const assigneeMembershipId =
        input.assigneeMembershipId === undefined
          ? current.assigneeMembershipId
          : input.assigneeMembershipId;
      const values = validatedValues({
        kind,
        title: input.title ?? current.title,
        startDate:
          input.startDate === undefined
            ? serializeNullableDate(current.startDate)
            : input.startDate,
        dueDate:
          input.dueDate === undefined ? serializeNullableDate(current.dueDate) : input.dueDate,
        startAt:
          input.startAt === undefined ? (current.startAt?.toISOString() ?? null) : input.startAt,
        endAt: input.endAt === undefined ? (current.endAt?.toISOString() ?? null) : input.endAt
      });
      await assertReferences(
        tx,
        context.organizationId,
        projectId,
        assigneeMembershipId,
        customerId,
        contactId
      );
      const relatedResourceType =
        input.relatedResourceType === undefined
          ? current.relatedResourceType
          : input.relatedResourceType;
      const relatedResourceId =
        input.relatedResourceId === undefined ? current.relatedResourceId : input.relatedResourceId;
      await assertRelatedResource(
        tx,
        context.organizationId,
        relatedResourceType,
        relatedResourceId
      );
      const changed = await tx.projectWorkItem.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version: input.version,
          archivedAt: null
        },
        data: {
          ...(input.kind === undefined ? {} : { kind }),
          ...(input.title === undefined ? {} : { title: values.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.projectId === undefined ? {} : { projectId }),
          ...(input.customerId === undefined ? {} : { customerId }),
          ...(input.contactId === undefined ? {} : { contactId }),
          ...(input.assigneeMembershipId === undefined ? {} : { assigneeMembershipId }),
          ...(input.eventType === undefined
            ? {}
            : { eventType: normalizedEventType(input.eventType, kind) }),
          ...(input.customStatus === undefined
            ? {}
            : { customStatus: optionalText(input.customStatus, 80) }),
          ...(input.category === undefined ? {} : { category: optionalText(input.category, 80) }),
          ...(input.label === undefined ? {} : { label: optionalText(input.label, 80) }),
          ...(input.location === undefined ? {} : { location: optionalText(input.location, 500) }),
          ...(input.startAt === undefined ? {} : { startAt: values.startAt }),
          ...(input.endAt === undefined ? {} : { endAt: values.endAt }),
          ...(input.relatedResourceType === undefined ? {} : { relatedResourceType }),
          ...(input.relatedResourceId === undefined ? {} : { relatedResourceId }),
          ...(input.startDate === undefined ? {} : { startDate: values.startDate }),
          ...(input.dueDate === undefined ? {} : { dueDate: values.dueDate }),
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      assertChanged(changed.count);
      const row = await tx.projectWorkItem.findUniqueOrThrow({
        where: { id },
        include: dependencyInclude
      });
      await audit(tx, context, "PROJECT_WORK_ITEM_UPDATED", id, { version: row.version });
      return projectWorkItemDto(row);
    });
  }

  public async setStatus(
    context: OrganizationContext,
    id: string,
    status: ProjectWorkItemStatus,
    version: number
  ) {
    await this.authorization.assert(context, "projects:manage", "ProjectWorkItem", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.projectWorkItem.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("PROJECT_WORK_ITEM_NOT_FOUND", "Project work item was not found.", 404);
      assertNotArchived(current.archivedAt);
      await assertReferences(
        tx,
        context.organizationId,
        current.projectId,
        current.assigneeMembershipId,
        current.customerId,
        current.contactId
      );
      const changed = await tx.projectWorkItem.updateMany({
        where: { id, organizationId: context.organizationId, version, archivedAt: null },
        data: {
          status,
          completedAt: status === "COMPLETED" ? (current.completedAt ?? new Date()) : null,
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      assertChanged(changed.count);
      const row = await tx.projectWorkItem.findUniqueOrThrow({
        where: { id },
        include: dependencyInclude
      });
      await audit(tx, context, "PROJECT_WORK_ITEM_STATUS_CHANGED", id, { status });
      return projectWorkItemDto(row);
    });
  }

  public async archive(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "projects:manage", "ProjectWorkItem", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const changed = await tx.projectWorkItem.updateMany({
        where: { id, organizationId: context.organizationId, version, archivedAt: null },
        data: {
          archivedAt: new Date(),
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      if (changed.count !== 1) {
        const exists = await tx.projectWorkItem.findFirst({
          where: { id, organizationId: context.organizationId },
          select: { id: true }
        });
        if (!exists)
          throw new AppError(
            "PROJECT_WORK_ITEM_NOT_FOUND",
            "Project work item was not found.",
            404
          );
        assertChanged(changed.count);
      }
      const row = await tx.projectWorkItem.findUniqueOrThrow({
        where: { id },
        include: dependencyInclude
      });
      await audit(tx, context, "PROJECT_WORK_ITEM_ARCHIVED", id, {});
      return projectWorkItemDto(row);
    });
  }

  public async addDependency(
    context: OrganizationContext,
    id: string,
    dependsOnItemId: string,
    version: number
  ) {
    await this.authorization.assert(context, "projects:manage", "ProjectWorkItem", id);
    if (id === dependsOnItemId)
      throw new AppError(
        "PROJECT_WORK_ITEM_SELF_DEPENDENCY",
        "A project work item cannot depend on itself.",
        422
      );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await lockTenantWorkItems(tx, context.organizationId);
      const items = await tx.projectWorkItem.findMany({
        where: { organizationId: context.organizationId, id: { in: [id, dependsOnItemId] } }
      });
      const workItem = items.find((item) => item.id === id);
      const dependency = items.find((item) => item.id === dependsOnItemId);
      if (!workItem)
        throw new AppError("PROJECT_WORK_ITEM_NOT_FOUND", "Project work item was not found.", 404);
      if (!dependency)
        throw new AppError(
          "PROJECT_WORK_ITEM_DEPENDENCY_NOT_FOUND",
          "Dependency project work item was not found.",
          404
        );
      assertNotArchived(workItem.archivedAt);
      assertNotArchived(dependency.archivedAt);
      if (workItem.version !== version) assertChanged(0);
      const edges = await tx.projectWorkItemDependency.findMany({
        where: { organizationId: context.organizationId },
        select: { workItemId: true, dependsOnItemId: true }
      });
      if (edges.some((edge) => edge.workItemId === id && edge.dependsOnItemId === dependsOnItemId))
        throw new AppError(
          "PROJECT_WORK_ITEM_DEPENDENCY_EXISTS",
          "This project work-item dependency already exists.",
          409
        );
      if (wouldCreateDependencyCycle(id, dependsOnItemId, edges))
        throw new AppError(
          "PROJECT_WORK_ITEM_DEPENDENCY_CYCLE",
          "This dependency would create a project work-item cycle.",
          422
        );
      await tx.projectWorkItemDependency.create({
        data: {
          organizationId: context.organizationId,
          workItemId: id,
          dependsOnItemId,
          createdByUserId: context.user.id
        }
      });
      const changed = await tx.projectWorkItem.updateMany({
        where: { id, organizationId: context.organizationId, version, archivedAt: null },
        data: { version: { increment: 1 }, updatedByUserId: context.user.id }
      });
      assertChanged(changed.count);
      const row = await tx.projectWorkItem.findUniqueOrThrow({
        where: { id },
        include: dependencyInclude
      });
      await audit(tx, context, "PROJECT_WORK_ITEM_DEPENDENCY_ADDED", id, { dependsOnItemId });
      return projectWorkItemDto(row);
    });
  }

  public async removeDependency(
    context: OrganizationContext,
    id: string,
    dependsOnItemId: string,
    version: number
  ) {
    await this.authorization.assert(context, "projects:manage", "ProjectWorkItem", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await lockTenantWorkItems(tx, context.organizationId);
      const workItem = await tx.projectWorkItem.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!workItem)
        throw new AppError("PROJECT_WORK_ITEM_NOT_FOUND", "Project work item was not found.", 404);
      assertNotArchived(workItem.archivedAt);
      if (workItem.version !== version) assertChanged(0);
      const removed = await tx.projectWorkItemDependency.deleteMany({
        where: { organizationId: context.organizationId, workItemId: id, dependsOnItemId }
      });
      if (removed.count !== 1)
        throw new AppError(
          "PROJECT_WORK_ITEM_DEPENDENCY_NOT_FOUND",
          "Project work-item dependency was not found.",
          404
        );
      const changed = await tx.projectWorkItem.updateMany({
        where: { id, organizationId: context.organizationId, version, archivedAt: null },
        data: { version: { increment: 1 }, updatedByUserId: context.user.id }
      });
      assertChanged(changed.count);
      const row = await tx.projectWorkItem.findUniqueOrThrow({
        where: { id },
        include: dependencyInclude
      });
      await audit(tx, context, "PROJECT_WORK_ITEM_DEPENDENCY_REMOVED", id, { dependsOnItemId });
      return projectWorkItemDto(row);
    });
  }
}

export function validateProjectWorkItemDates(
  kind: ProjectWorkItemKind,
  startDate?: string | null,
  dueDate?: string | null
) {
  const start = workItemDate(startDate, "startDate");
  const due = workItemDate(dueDate, "dueDate");
  if (start && due && due < start)
    throw new AppError(
      "PROJECT_WORK_ITEM_DATE_INVALID",
      "Project work-item dueDate cannot precede startDate.",
      422
    );
  if (kind === "MILESTONE" && (!due || (start && start.getTime() !== due.getTime())))
    throw new AppError(
      "PROJECT_WORK_ITEM_MILESTONE_DATE_INVALID",
      "A milestone requires dueDate, and startDate must be omitted or equal dueDate.",
      422
    );
  return { startDate: start, dueDate: due };
}

export function wouldCreateDependencyCycle(
  workItemId: string,
  dependsOnItemId: string,
  edges: readonly { readonly workItemId: string; readonly dependsOnItemId: string }[]
): boolean {
  if (workItemId === dependsOnItemId) return true;
  const dependencies = new Map<string, string[]>();
  for (const edge of edges) {
    const values = dependencies.get(edge.workItemId) ?? [];
    values.push(edge.dependsOnItemId);
    dependencies.set(edge.workItemId, values);
  }
  const pending = [dependsOnItemId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === workItemId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(dependencies.get(current) ?? []));
  }
  return false;
}

const dependencyInclude = {
  dependencies: { select: { dependsOnItemId: true }, orderBy: { dependsOnItemId: "asc" as const } },
  dependents: { select: { workItemId: true }, orderBy: { workItemId: "asc" as const } }
} as const;

function validatedValues(input: {
  readonly kind: ProjectWorkItemKind;
  readonly title: string;
  readonly startDate?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly startAt?: string | null | undefined;
  readonly endAt?: string | null | undefined;
}) {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 200)
    throw new AppError(
      "PROJECT_WORK_ITEM_TITLE_INVALID",
      "Project work-item title must contain between 1 and 200 characters.",
      422
    );
  const dates = validateProjectWorkItemDates(input.kind, input.startDate, input.dueDate);
  const startAt = workItemDateTime(input.startAt, "startAt");
  const endAt = workItemDateTime(input.endAt, "endAt");
  if (startAt && endAt && endAt < startAt)
    throw new AppError("PROJECT_WORK_ITEM_TIME_INVALID", "endAt cannot precede startAt.", 422);
  return { title, ...dates, startAt, endAt };
}

function normalizedEventType(value: string | null | undefined, fallback: ProjectWorkItemKind) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.trim();
  if (normalized.length > 80)
    throw new AppError(
      "PROJECT_WORK_ITEM_TEXT_INVALID",
      "Event type cannot exceed 80 characters.",
      422
    );
  return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length > maxLength)
    throw new AppError(
      "PROJECT_WORK_ITEM_TEXT_INVALID",
      `Text cannot exceed ${maxLength.toString()} characters.`,
      422
    );
  return normalized || null;
}

function validateDescription(description: string | null | undefined) {
  if (description !== null && description !== undefined && description.length > 10_000)
    throw new AppError(
      "PROJECT_WORK_ITEM_DESCRIPTION_INVALID",
      "Project work-item description cannot exceed 10000 characters.",
      422
    );
}

function workItemDate(value: string | null | undefined, fieldName: string): Date | null {
  if (value === null || value === undefined) return null;
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

function workItemDateTime(value: string | null | undefined, fieldName: string): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new AppError("INVALID_DATE", `${fieldName} must be a valid RFC 3339 timestamp.`, 400, {
      fieldName
    });
  return date;
}

async function assertReferences(
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string | null,
  assigneeMembershipId: string | null,
  customerId: string | null,
  contactId: string | null
) {
  const [project, assignee, customer, contact] = await Promise.all([
    projectId
      ? tx.project.findFirst({
          where: { id: projectId, organizationId },
          select: { status: true, customerId: true }
        })
      : null,
    assigneeMembershipId
      ? tx.membership.findFirst({
          where: { id: assigneeMembershipId, organizationId, status: "ACTIVE" },
          select: { id: true }
        })
      : null,
    customerId
      ? tx.customer.findFirst({
          where: { id: customerId, organizationId, active: true },
          select: { id: true }
        })
      : null,
    contactId
      ? tx.customerContact.findFirst({
          where: { id: contactId, organizationId, active: true },
          select: { customerId: true }
        })
      : null
  ]);
  if (projectId && !project) throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  if (project?.status === "ARCHIVED")
    throw new AppError(
      "PROJECT_ARCHIVED",
      "Archived projects cannot receive project work items.",
      409
    );
  if (assigneeMembershipId && !assignee)
    throw new AppError(
      "PROJECT_WORK_ITEM_ASSIGNEE_INVALID",
      "Assignee must be an active membership in this organization.",
      422
    );
  if (customerId && !customer)
    throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found or is archived.", 404);
  if (contactId && (!customerId || !contact || contact.customerId !== customerId))
    throw new AppError(
      "CUSTOMER_CONTACT_NOT_FOUND",
      "Contact must belong to the selected active customer.",
      422
    );
  if (project?.customerId && customerId && project.customerId !== customerId)
    throw new AppError("PROJECT_CUSTOMER_MISMATCH", "Project and customer must agree.", 422);
}

async function assertRelatedResource(
  tx: Prisma.TransactionClient,
  organizationId: string,
  resourceType: string | null,
  resourceId: string | null
) {
  if (!resourceType && !resourceId) return;
  if (!resourceType || !resourceId)
    throw new AppError(
      "PROJECT_WORK_ITEM_RESOURCE_INVALID",
      "A related resource type and ID are both required.",
      422
    );
  let exists: boolean;
  if (resourceType === "PROJECT")
    exists = Boolean(
      await tx.project.findFirst({
        where: { organizationId, id: resourceId },
        select: { id: true }
      })
    );
  else if (resourceType === "INVOICE")
    exists = Boolean(
      await tx.invoice.findFirst({
        where: { organizationId, id: resourceId },
        select: { id: true }
      })
    );
  else if (resourceType === "ESTIMATE")
    exists = Boolean(
      await tx.estimate.findFirst({
        where: { organizationId, id: resourceId },
        select: { id: true }
      })
    );
  else if (resourceType === "BILL")
    exists = Boolean(
      await tx.bill.findFirst({ where: { organizationId, id: resourceId }, select: { id: true } })
    );
  else
    throw new AppError(
      "PROJECT_WORK_ITEM_RESOURCE_INVALID",
      "Unsupported related resource type.",
      422
    );
  if (!exists)
    throw new AppError(
      "PROJECT_WORK_ITEM_RESOURCE_NOT_FOUND",
      "The related resource was not found for this organization.",
      422
    );
}

async function lockTenantWorkItems(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "ProjectWorkItem"
    WHERE "organizationId" = ${organizationId}::uuid
    ORDER BY "id"
    FOR UPDATE
  `;
}

function assertNotArchived(archivedAt: Date | null) {
  if (archivedAt)
    throw new AppError(
      "PROJECT_WORK_ITEM_ARCHIVED",
      "Archived project work items cannot be changed.",
      409
    );
}

function assertChanged(count: number) {
  if (count !== 1)
    throw new AppError(
      "STALE_PROJECT_WORK_ITEM",
      "Project work item was changed by another request.",
      409
    );
}

function projectWorkItemDto(row: {
  id: string;
  kind: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  projectId: string | null;
  customerId: string | null;
  contactId: string | null;
  assigneeMembershipId: string | null;
  eventType: string;
  customStatus: string | null;
  category: string | null;
  label: string | null;
  location: string | null;
  startAt: Date | null;
  endAt: Date | null;
  relatedResourceType: string | null;
  relatedResourceId: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  version: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  dependencies?: readonly { readonly dependsOnItemId: string }[];
  dependents?: readonly { readonly workItemId: string }[];
}) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    title: row.title,
    description: row.description,
    projectId: row.projectId,
    customerId: row.customerId,
    contactId: row.contactId,
    assigneeMembershipId: row.assigneeMembershipId,
    eventType: row.eventType,
    customStatus: row.customStatus,
    category: row.category,
    label: row.label,
    location: row.location,
    startAt: row.startAt?.toISOString() ?? null,
    endAt: row.endAt?.toISOString() ?? null,
    relatedResourceType: row.relatedResourceType,
    relatedResourceId: row.relatedResourceId,
    startDate: serializeNullableDate(row.startDate),
    dueDate: serializeNullableDate(row.dueDate),
    completedAt: row.completedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    dependencyIds: row.dependencies?.map((dependency) => dependency.dependsOnItemId) ?? [],
    dependentIds: row.dependents?.map((dependent) => dependent.workItemId) ?? []
  };
}

function serializeNullableDate(value: Date | null): string | null {
  return value ? dateOnly(value) : null;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function audit(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType: "ProjectWorkItem",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
