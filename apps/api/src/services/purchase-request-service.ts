import {
  multiplyMinorByQuantity,
  parseMinorUnit,
  parseQuantityMicros
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";

export interface PurchaseRequestInput {
  readonly requestNumber: string;
  readonly vendorId?: string | null | undefined;
  readonly requestedDate: string;
  readonly neededByDate?: string | null | undefined;
  readonly purpose: string;
  readonly lines: readonly {
    readonly description: string;
    readonly quantity: string;
    readonly unitCostMinor: string;
    readonly accountId?: string | null | undefined;
  }[];
}

export class PurchaseRequestService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(
    context: OrganizationContext,
    status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED"
  ) {
    await this.authorization.assert(context, "purchase-requests:read", "PurchaseRequest");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.purchaseRequest.findMany({
        where: {
          organizationId: context.organizationId,
          ...(status ? { status } : {})
        },
        include: { vendor: { select: { displayName: true } }, _count: { select: { lines: true } } },
        orderBy: [{ requestedDate: "desc" }, { requestNumber: "asc" }],
        take: 200
      })
    );
    return rows.map((row) => ({
      ...requestDto(row),
      vendorName: row.vendor?.displayName ?? null,
      lineCount: row._count.lines
    }));
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "purchase-requests:read", "PurchaseRequest", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.purchaseRequest.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          vendor: { select: { displayName: true } },
          lines: {
            include: { account: { select: { code: true, name: true } } },
            orderBy: { lineNumber: "asc" }
          }
        }
      })
    );
    if (!row)
      throw new AppError("PURCHASE_REQUEST_NOT_FOUND", "Purchase request was not found.", 404);
    return {
      ...requestDto(row),
      vendorName: row.vendor?.displayName ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        description: line.description,
        quantityMicros: line.quantityMicros.toString(),
        unitCostMinor: line.unitCostMinor.toString(),
        totalMinor: line.totalMinor.toString(),
        accountId: line.accountId,
        accountCode: line.account?.code ?? null,
        accountName: line.account?.name ?? null
      }))
    };
  }

  public async create(context: OrganizationContext, input: PurchaseRequestInput) {
    await this.authorization.assert(context, "purchase-requests:create", "PurchaseRequest");
    const calculated = calculate(input);
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await assertPurchaseRequestsEnabled(tx, context.organizationId);
        await validateReferences(tx, context.organizationId, input);
        const row = await tx.purchaseRequest.create({
          data: {
            organizationId: context.organizationId,
            requestNumber: input.requestNumber.trim(),
            vendorId: input.vendorId ?? null,
            requestedDate: calculated.requestedDate,
            neededByDate: calculated.neededByDate,
            purpose: input.purpose.trim(),
            totalMinor: calculated.totalMinor,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id,
            lines: {
              create: calculated.lines.map((line, index) => ({
                lineNumber: index + 1,
                ...line
              }))
            }
          }
        });
        await audit(tx, context, "PURCHASE_REQUEST_CREATED", "PurchaseRequest", row.id, {
          totalMinor: row.totalMinor.toString()
        });
        return requestDto(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new AppError(
          "PURCHASE_REQUEST_NUMBER_DUPLICATE",
          "Purchase request number already exists.",
          409
        );
      throw error;
    }
  }

  public async update(
    context: OrganizationContext,
    id: string,
    version: number,
    input: PurchaseRequestInput
  ) {
    await this.authorization.assert(context, "purchase-requests:create", "PurchaseRequest", id);
    const calculated = calculate(input);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertPurchaseRequestsEnabled(tx, context.organizationId);
      await validateReferences(tx, context.organizationId, input);
      const claimed = await tx.purchaseRequest.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          status: "DRAFT",
          version
        },
        data: {
          requestNumber: input.requestNumber.trim(),
          vendorId: input.vendorId ?? null,
          requestedDate: calculated.requestedDate,
          neededByDate: calculated.neededByDate,
          purpose: input.purpose.trim(),
          totalMinor: calculated.totalMinor,
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      if (claimed.count !== 1)
        throw new AppError(
          "STALE_PURCHASE_REQUEST",
          "Only the current purchase request draft can be changed.",
          409
        );
      await tx.purchaseRequestLine.deleteMany({
        where: { organizationId: context.organizationId, purchaseRequestId: id }
      });
      await tx.purchaseRequestLine.createMany({
        data: calculated.lines.map((line, index) => ({
          organizationId: context.organizationId,
          purchaseRequestId: id,
          lineNumber: index + 1,
          ...line
        }))
      });
      const row = await tx.purchaseRequest.findUniqueOrThrow({ where: { id } });
      await audit(tx, context, "PURCHASE_REQUEST_UPDATED", "PurchaseRequest", id, {});
      return requestDto(row);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new AppError(
          "PURCHASE_REQUEST_NUMBER_DUPLICATE",
          "Purchase request number already exists.",
          409
        );
      throw error;
    });
  }

  public async transition(
    context: OrganizationContext,
    id: string,
    version: number,
    action: "submit" | "approve" | "reject" | "cancel",
    decisionNote?: string | null
  ) {
    const permission =
      action === "approve" || action === "reject"
        ? "purchase-requests:approve"
        : "purchase-requests:create";
    await this.authorization.assert(context, permission, "PurchaseRequest", id);
    const transitions = {
      submit: { from: ["DRAFT"], to: "SUBMITTED" },
      approve: { from: ["SUBMITTED"], to: "APPROVED" },
      reject: { from: ["SUBMITTED"], to: "REJECTED" },
      cancel: { from: ["DRAFT", "SUBMITTED", "APPROVED"], to: "CANCELLED" }
    } as const;
    const transition = transitions[action];
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.purchaseRequest.findFirst({
        where: { id, organizationId: context.organizationId },
        select: {
          status: true,
          version: true,
          totalMinor: true,
          createdByUserId: true
        }
      });
      if (!current)
        throw new AppError("PURCHASE_REQUEST_NOT_FOUND", "Purchase request was not found.", 404);
      const preferences = await tx.workflowPreferences.findUnique({
        where: { organizationId: context.organizationId },
        select: {
          purchaseRequestsEnabled: true,
          purchaseApprovalThresholdMinor: true,
          requireSeparatePurchaseApprover: true
        }
      });
      if (action === "submit" && !preferences?.purchaseRequestsEnabled)
        throw new AppError(
          "PURCHASE_REQUESTS_DISABLED",
          "Enable purchase requests in Company settings before submitting.",
          409
        );
      if (
        action === "approve" &&
        preferences?.requireSeparatePurchaseApprover &&
        current.createdByUserId === context.user.id
      )
        throw new AppError(
          "SEPARATE_PURCHASE_APPROVER_REQUIRED",
          "This request must be approved by a different authorized user.",
          409
        );
      const automaticallyApproved =
        action === "submit" &&
        preferences !== null &&
        preferences.purchaseApprovalThresholdMinor > 0n &&
        current.totalMinor < preferences.purchaseApprovalThresholdMinor;
      const targetStatus = automaticallyApproved ? "APPROVED" : transition.to;
      const now = new Date();
      const result = await tx.purchaseRequest.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version,
          status: { in: [...transition.from] }
        },
        data: {
          status: targetStatus,
          ...(action === "submit" ? { submittedAt: now } : {}),
          ...(automaticallyApproved
            ? {
                approvedAt: now,
                approvedByUserId: null,
                decisionNote: "Automatically approved below the configured threshold."
              }
            : {}),
          ...(action === "approve"
            ? {
                approvedAt: now,
                approvedByUserId: context.user.id,
                decisionNote: decisionNote ?? null
              }
            : {}),
          ...(action === "reject"
            ? {
                rejectedAt: now,
                rejectedByUserId: context.user.id,
                decisionNote: decisionNote ?? null
              }
            : {}),
          ...(action === "cancel" ? { decisionNote: decisionNote ?? null } : {}),
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      if (result.count !== 1)
        throw new AppError(
          "PURCHASE_REQUEST_TRANSITION_INVALID",
          "Purchase request changed or cannot perform that action.",
          409
        );
      await audit(tx, context, `PURCHASE_REQUEST_${targetStatus}`, "PurchaseRequest", id, {
        ...(decisionNote ? { decisionNote } : {}),
        ...(automaticallyApproved
          ? {
              automaticApproval: true,
              thresholdMinor: preferences.purchaseApprovalThresholdMinor.toString()
            }
          : {})
      });
      return requestDto(await tx.purchaseRequest.findUniqueOrThrow({ where: { id } }));
    });
  }
}

async function assertPurchaseRequestsEnabled(tx: Prisma.TransactionClient, organizationId: string) {
  const preferences = await tx.workflowPreferences.findUnique({
    where: { organizationId },
    select: { purchaseRequestsEnabled: true }
  });
  if (!preferences?.purchaseRequestsEnabled)
    throw new AppError(
      "PURCHASE_REQUESTS_DISABLED",
      "Enable purchase requests in Company settings first.",
      409
    );
}

function calculate(input: PurchaseRequestInput) {
  const requestedDate = parseDate(input.requestedDate, "requestedDate");
  const neededByDate = input.neededByDate ? parseDate(input.neededByDate, "neededByDate") : null;
  if (neededByDate && neededByDate < requestedDate)
    throw new AppError(
      "PURCHASE_REQUEST_DATE_INVALID",
      "Needed-by date cannot precede the request date.",
      422
    );
  const lines = input.lines.map((line) => {
    const quantityMicros = parseQuantityMicros(line.quantity, "quantity");
    const unitCostMinor = parseMinorUnit(line.unitCostMinor, "unitCostMinor");
    if (quantityMicros <= 0n || unitCostMinor < 0n)
      throw new AppError(
        "PURCHASE_REQUEST_LINE_INVALID",
        "Purchase request quantities must be positive and costs cannot be negative.",
        422
      );
    return {
      description: line.description.trim(),
      quantityMicros,
      unitCostMinor,
      totalMinor: multiplyMinorByQuantity(unitCostMinor, quantityMicros),
      accountId: line.accountId ?? null
    };
  });
  return {
    requestedDate,
    neededByDate,
    lines,
    totalMinor: lines.reduce((sum, line) => sum + line.totalMinor, 0n)
  };
}

async function validateReferences(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: PurchaseRequestInput
) {
  if (input.vendorId) {
    const vendor = await tx.vendor.findFirst({
      where: { id: input.vendorId, organizationId, isActive: true },
      select: { id: true }
    });
    if (!vendor) throw new AppError("VENDOR_NOT_FOUND", "Active vendor was not found.", 404);
  }
  const accountIds = [
    ...new Set(input.lines.flatMap((line) => (line.accountId ? [line.accountId] : [])))
  ];
  if (accountIds.length) {
    const accounts = await tx.account.findMany({
      where: {
        organizationId,
        id: { in: accountIds },
        type: { in: ["ASSET", "EXPENSE"] },
        isArchived: false,
        isControl: false
      },
      select: { id: true }
    });
    if (accounts.length !== accountIds.length)
      throw new AppError(
        "PURCHASE_REQUEST_ACCOUNT_INVALID",
        "Purchase request accounts must be active non-control asset or expense accounts.",
        422
      );
  }
}

function requestDto(row: {
  id: string;
  requestNumber: string;
  vendorId: string | null;
  requestedDate: Date;
  neededByDate: Date | null;
  purpose: string;
  status: string;
  totalMinor: bigint;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  rejectedAt: Date | null;
  rejectedByUserId: string | null;
  decisionNote: string | null;
  version: number;
}) {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    vendorId: row.vendorId,
    requestedDate: serializeDate(row.requestedDate),
    neededByDate: row.neededByDate ? serializeDate(row.neededByDate) : null,
    purpose: row.purpose,
    status: row.status,
    totalMinor: row.totalMinor.toString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByUserId: row.approvedByUserId,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectedByUserId: row.rejectedByUserId,
    decisionNote: row.decisionNote,
    version: row.version
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
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType,
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
