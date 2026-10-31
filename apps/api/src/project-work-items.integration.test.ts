import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { OrganizationContext } from "@clearledger/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CalendarService } from "./services/calendar-service.js";
import { ProjectWorkItemService } from "./services/project-work-item-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

describe("project work-item tenancy and non-posting workflows", () => {
  beforeAll(async () => prisma.$connect());
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => prisma.$disconnect());

  it("isolates tenants, enforces permissions, and rejects invalid project or assignee references", async () => {
    const tenantA = await setupTenant("tenant-a");
    const tenantB = await setupTenant("tenant-b");
    const service = new ProjectWorkItemService(prisma);
    const otherTenantItem = await service.create(tenantB.context, {
      kind: "REMINDER",
      title: "Tenant B only",
      dueDate: "2026-08-10"
    });

    await expect(service.get(tenantA.context, otherTenantItem.id)).rejects.toMatchObject({
      code: "PROJECT_WORK_ITEM_NOT_FOUND"
    });
    expect(await service.list(tenantA.context)).toEqual([]);
    await expect(
      service.create({ ...tenantA.context, role: "READ_ONLY" }, { kind: "TASK", title: "Denied" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.create(tenantA.context, {
        kind: "TASK",
        title: "Cross-tenant project",
        projectId: tenantB.projectId
      })
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(
      service.create(tenantA.context, {
        kind: "TASK",
        title: "Cross-tenant assignee",
        assigneeMembershipId: tenantB.context.membershipId
      })
    ).rejects.toMatchObject({ code: "PROJECT_WORK_ITEM_ASSIGNEE_INVALID" });

    const inactiveUser = await prisma.user.create({
      data: { email: "inactive@example.test", displayName: "Inactive", emailVerifiedAt: new Date() }
    });
    const inactive = await prisma.membership.create({
      data: {
        organizationId: tenantA.context.organizationId,
        userId: inactiveUser.id,
        role: "SALES",
        status: "REVOKED",
        revokedAt: new Date()
      }
    });
    await expect(
      service.create(tenantA.context, {
        kind: "TASK",
        title: "Inactive assignee",
        assigneeMembershipId: inactive.id
      })
    ).rejects.toMatchObject({ code: "PROJECT_WORK_ITEM_ASSIGNEE_INVALID" });

    await prisma.project.update({ where: { id: tenantA.projectId }, data: { status: "ARCHIVED" } });
    await expect(
      service.create(tenantA.context, {
        kind: "TASK",
        title: "Archived project",
        projectId: tenantA.projectId
      })
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
  });

  it("uses optimistic versions so only one concurrent edit succeeds", async () => {
    const tenant = await setupTenant("concurrency");
    const service = new ProjectWorkItemService(prisma);
    const item = await service.create(tenant.context, {
      kind: "TASK",
      title: "Original",
      projectId: tenant.projectId,
      assigneeMembershipId: tenant.context.membershipId,
      startDate: "2026-08-03",
      dueDate: "2026-08-04"
    });

    const attempts = await Promise.allSettled([
      service.update(tenant.context, item.id, { version: item.version, title: "First edit" }),
      service.update(tenant.context, item.id, { version: item.version, title: "Second edit" })
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejection).toMatchObject({ reason: { code: "STALE_PROJECT_WORK_ITEM" } });
    expect((await service.get(tenant.context, item.id)).version).toBe(2);
  });

  it("serializes dependency changes and rejects self, cross-tenant, and transitive cycles", async () => {
    const tenant = await setupTenant("dependencies");
    const otherTenant = await setupTenant("other-dependency");
    const service = new ProjectWorkItemService(prisma);
    const a = await service.create(tenant.context, { kind: "TASK", title: "A" });
    const b = await service.create(tenant.context, { kind: "TASK", title: "B" });
    const c = await service.create(tenant.context, { kind: "TASK", title: "C" });
    const outside = await service.create(otherTenant.context, { kind: "TASK", title: "Outside" });

    await expect(
      service.addDependency(tenant.context, a.id, a.id, a.version)
    ).rejects.toMatchObject({
      code: "PROJECT_WORK_ITEM_SELF_DEPENDENCY"
    });
    await expect(
      service.addDependency(tenant.context, a.id, outside.id, a.version)
    ).rejects.toMatchObject({ code: "PROJECT_WORK_ITEM_DEPENDENCY_NOT_FOUND" });
    const aWithDependency = await service.addDependency(tenant.context, a.id, b.id, a.version);
    await service.addDependency(tenant.context, b.id, c.id, b.version);
    await expect(
      service.addDependency(tenant.context, c.id, a.id, c.version)
    ).rejects.toMatchObject({ code: "PROJECT_WORK_ITEM_DEPENDENCY_CYCLE" });
    expect(aWithDependency.dependencyIds).toEqual([b.id]);
    expect(await prisma.projectWorkItemDependency.count()).toBe(2);
  });

  it("audits completion and archive while creating no accounting, tax, or inventory postings", async () => {
    const tenant = await setupTenant("non-posting");
    const service = new ProjectWorkItemService(prisma);
    const calendar = new CalendarService(prisma);
    const reminder = await service.create(tenant.context, {
      kind: "REMINDER",
      title: "Unlinked reminder",
      dueDate: "2026-08-05"
    });
    const milestone = await service.create(tenant.context, {
      kind: "MILESTONE",
      title: "Delivery",
      projectId: tenant.projectId,
      dueDate: "2026-08-06"
    });
    const completed = await service.setStatus(
      tenant.context,
      reminder.id,
      "COMPLETED",
      reminder.version
    );
    expect(completed.completedAt).not.toBeNull();
    const archived = await service.archive(tenant.context, milestone.id, milestone.version);
    expect(archived.archivedAt).not.toBeNull();

    const projection = await calendar.list(tenant.context, {
      startDate: "2026-08-01",
      endDate: "2026-08-31"
    });
    expect(projection.events.map((event) => event.id)).toEqual([
      `project-work-item:${reminder.id}:due`
    ]);
    expect(projection.accountingEntriesCreated).toBe(0);
    expect(
      await prisma.auditEvent.count({ where: { organizationId: tenant.context.organizationId } })
    ).toBe(4);
    expect(
      await prisma.journal.count({ where: { organizationId: tenant.context.organizationId } })
    ).toBe(0);
    expect(
      await prisma.inventoryMovement.count({
        where: { organizationId: tenant.context.organizationId }
      })
    ).toBe(0);
    expect(
      await prisma.invoice.count({ where: { organizationId: tenant.context.organizationId } })
    ).toBe(0);
    expect(
      await prisma.bill.count({ where: { organizationId: tenant.context.organizationId } })
    ).toBe(0);
  });
});

async function setupTenant(suffix: string) {
  const user = await prisma.user.create({
    data: {
      email: `${suffix}@example.test`,
      displayName: suffix,
      emailVerifiedAt: new Date()
    }
  });
  const { organization, membership } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { legalName: `${suffix} Ltd`, displayName: suffix }
    });
    const membership = await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER", status: "ACTIVE" }
    });
    return { organization, membership };
  });
  const customer = await prisma.customer.create({
    data: {
      organizationId: organization.id,
      customerNumber: `C-${suffix}`,
      displayName: `${suffix} customer`,
      createdByUserId: user.id,
      updatedByUserId: user.id
    }
  });
  const project = await prisma.project.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      projectNumber: `P-${suffix}`,
      name: `${suffix} project`,
      createdByUserId: user.id,
      updatedByUserId: user.id
    }
  });
  const context: OrganizationContext = {
    requestId: `request-${suffix}`,
    organizationId: organization.id,
    membershipId: membership.id,
    role: "OWNER",
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerifiedAt: user.emailVerifiedAt
    },
    sessionId: `session-${suffix}`,
    recentAuthAt: new Date(),
    mfaAuthenticated: false,
    authenticationMethod: "DEVELOPMENT",
    auditOrigin: { ipAddress: null, userAgent: null }
  };
  return { context, projectId: project.id };
}
