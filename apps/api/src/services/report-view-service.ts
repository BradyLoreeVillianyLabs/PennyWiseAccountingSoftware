import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { z } from "zod";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

const reportNameSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, "Invalid report name.");
const configurationSchema = z
  .record(z.string().max(80), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 32_768, "Saved view is too large.");

export interface ReportViewInput {
  readonly reportName: string;
  readonly name: string;
  readonly configuration: Record<string, unknown>;
  readonly shared?: boolean | undefined;
  readonly isDefault?: boolean | undefined;
}

export class ReportViewService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext, reportName: string) {
    await this.authorization.assert(context, "reports:read", "ReportView");
    const report = reportNameSchema.parse(reportName);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const views = await tx.reportView.findMany({
        where: {
          organizationId: context.organizationId,
          reportName: report,
          OR: [{ userId: context.user.id }, { shared: true }]
        },
        orderBy: [{ isDefault: "desc" }, { shared: "desc" }, { name: "asc" }]
      });
      return { views: views.map((view) => viewDto(view, context.user.id)) };
    });
  }

  public async create(context: OrganizationContext, input: ReportViewInput) {
    await this.authorization.assert(context, "reports:read", "ReportView");
    const parsed = parseInput(input);
    assertSharingAllowed(context, parsed.shared);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (parsed.isDefault) await clearDefault(tx, context, parsed.reportName);
      try {
        const view = await tx.reportView.create({
          data: {
            organizationId: context.organizationId,
            userId: context.user.id,
            reportName: parsed.reportName,
            name: parsed.name,
            configuration: parsed.configuration as Prisma.InputJsonValue,
            shared: parsed.shared,
            isDefault: parsed.isDefault
          }
        });
        await audit(tx, context, "REPORT_VIEW_CREATED", view.id, {
          reportName: view.reportName,
          shared: view.shared,
          isDefault: view.isDefault
        });
        return { view: viewDto(view, context.user.id) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(
            "REPORT_VIEW_NAME_EXISTS",
            "A saved view with that name already exists.",
            409
          );
        }
        throw error;
      }
    });
  }

  public async update(
    context: OrganizationContext,
    viewId: string,
    input: Omit<ReportViewInput, "reportName"> & { readonly reportName?: string | undefined }
  ) {
    await this.authorization.assert(context, "reports:read", "ReportView", viewId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.reportView.findFirst({
        where: { id: viewId, organizationId: context.organizationId, userId: context.user.id }
      });
      if (!current) throw new AppError("REPORT_VIEW_NOT_FOUND", "Saved view was not found.", 404);
      const parsed = parseInput({ ...input, reportName: input.reportName ?? current.reportName });
      if (parsed.reportName !== current.reportName) {
        throw new AppError(
          "REPORT_VIEW_REPORT_IMMUTABLE",
          "A saved view cannot change reports.",
          422
        );
      }
      assertSharingAllowed(context, parsed.shared);
      if (parsed.isDefault) await clearDefault(tx, context, current.reportName, viewId);
      const view = await tx.reportView.update({
        where: { id: current.id },
        data: {
          name: parsed.name,
          configuration: parsed.configuration as Prisma.InputJsonValue,
          shared: parsed.shared,
          isDefault: parsed.isDefault
        }
      });
      await audit(tx, context, "REPORT_VIEW_UPDATED", view.id, {
        reportName: view.reportName,
        shared: view.shared,
        isDefault: view.isDefault
      });
      return { view: viewDto(view, context.user.id) };
    });
  }

  public async remove(context: OrganizationContext, viewId: string) {
    await this.authorization.assert(context, "reports:read", "ReportView", viewId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.reportView.findFirst({
        where: { id: viewId, organizationId: context.organizationId, userId: context.user.id }
      });
      if (!current) throw new AppError("REPORT_VIEW_NOT_FOUND", "Saved view was not found.", 404);
      await tx.reportView.delete({ where: { id: current.id } });
      await audit(tx, context, "REPORT_VIEW_DELETED", current.id, {
        reportName: current.reportName
      });
      return { deleted: true };
    });
  }
}

function parseInput(input: ReportViewInput) {
  const reportName = reportNameSchema.parse(input.reportName);
  const name = z.string().trim().min(1).max(120).parse(input.name);
  const configuration = configurationSchema.parse(input.configuration);
  return {
    reportName,
    name,
    configuration,
    shared: input.shared === true,
    isDefault: input.isDefault === true
  };
}

function assertSharingAllowed(context: OrganizationContext, shared: boolean) {
  if (shared && !["OWNER", "ADMIN", "ACCOUNTANT"].includes(context.role)) {
    throw new AppError("REPORT_VIEW_SHARE_FORBIDDEN", "Your role cannot share report views.", 403);
  }
}

async function clearDefault(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  reportName: string,
  exceptId?: string
) {
  await tx.reportView.updateMany({
    where: {
      organizationId: context.organizationId,
      userId: context.user.id,
      reportName,
      isDefault: true,
      ...(exceptId ? { NOT: { id: exceptId } } : {})
    },
    data: { isDefault: false }
  });
}

function viewDto(
  view: {
    id: string;
    reportName: string;
    name: string;
    configuration: Prisma.JsonValue;
    shared: boolean;
    isDefault: boolean;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
  },
  currentUserId: string
) {
  return {
    id: view.id,
    reportName: view.reportName,
    name: view.name,
    configuration: view.configuration,
    shared: view.shared,
    isDefault: view.isDefault,
    ownedByCurrentUser: view.userId === currentUserId,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString()
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
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
      targetType: "ReportView",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
