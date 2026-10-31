import { parseMinorUnit } from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";

export interface CustomerDepositInput {
  readonly requestNumber: string;
  readonly customerId: string;
  readonly estimateId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly classification: "REFUNDABLE_DEPOSIT" | "ADVANCE_PAYMENT";
  readonly requestDate: string;
  readonly dueDate?: string | null | undefined;
  readonly amountMinor: string;
  readonly currency: "CAD";
  readonly purpose: string;
  readonly customerMessage?: string | null | undefined;
}

export type CustomerDepositAction = "submit" | "approve" | "reject" | "revise" | "cancel";
export type CustomerDepositStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";

const nonPostingCapabilities = {
  financialPosting: false,
  depositReceipt: "DISABLED_PENDING_POLICY",
  application: "DISABLED_PENDING_POLICY",
  refund: "DISABLED_PENDING_POLICY",
  taxRecognition: "DISABLED_PENDING_POLICY"
} as const;

export class CustomerDepositService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext, status?: CustomerDepositStatus) {
    await this.authorization.assert(context, "customer-deposits:read", "CustomerDepositRequest");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.customerDepositRequest.findMany({
        where: {
          organizationId: context.organizationId,
          ...(status ? { status } : {})
        },
        include: {
          customer: { select: { displayName: true } },
          estimate: { select: { estimateNumber: true, provisionalIdentifier: true } },
          project: { select: { projectNumber: true, name: true } }
        },
        orderBy: [{ requestDate: "desc" }, { requestNumber: "asc" }],
        take: 200
      })
    );
    return rows.map((row) => ({
      ...depositDto(row),
      customerName: row.customer.displayName,
      estimateReference:
        row.estimate?.estimateNumber ?? row.estimate?.provisionalIdentifier ?? null,
      projectReference: row.project ? `${row.project.projectNumber} ${row.project.name}` : null
    }));
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(
      context,
      "customer-deposits:read",
      "CustomerDepositRequest",
      id
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.customerDepositRequest.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          customer: { select: { displayName: true } },
          estimate: {
            select: {
              estimateNumber: true,
              provisionalIdentifier: true,
              grandTotalMinor: true,
              status: true
            }
          },
          project: { select: { projectNumber: true, name: true, status: true } }
        }
      });
      if (!row)
        throw new AppError(
          "CUSTOMER_DEPOSIT_REQUEST_NOT_FOUND",
          "Deposit request was not found.",
          404
        );
      return {
        ...depositDto(row),
        customerName: row.customer.displayName,
        estimateReference:
          row.estimate?.estimateNumber ?? row.estimate?.provisionalIdentifier ?? null,
        projectReference: row.project ? `${row.project.projectNumber} ${row.project.name}` : null
      };
    });
  }

  public async create(
    context: OrganizationContext,
    input: CustomerDepositInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "customer-deposits:manage", "CustomerDepositRequest");
    const calculated = calculateInput(input);
    try {
      return await runIdempotent(
        this.prisma,
        context,
        "customer-deposit-request.create",
        idempotencyKey,
        input,
        async (tx) => {
          await assertWorkflowEnabled(tx, context.organizationId);
          await validateReferences(tx, context.organizationId, input, calculated.amountMinor);
          const row = await tx.customerDepositRequest.create({
            data: {
              organizationId: context.organizationId,
              requestNumber: input.requestNumber.trim(),
              customerId: input.customerId,
              estimateId: input.estimateId ?? null,
              projectId: input.projectId ?? null,
              classification: input.classification,
              requestDate: calculated.requestDate,
              dueDate: calculated.dueDate,
              amountMinor: calculated.amountMinor,
              currency: input.currency,
              purpose: input.purpose.trim(),
              customerMessage: input.customerMessage?.trim() || null,
              createdByUserId: context.user.id,
              updatedByUserId: context.user.id
            }
          });
          await audit(
            tx,
            context,
            "CUSTOMER_DEPOSIT_REQUEST_CREATED",
            "CustomerDepositRequest",
            row.id,
            {
              classification: row.classification,
              financialPosting: false
            }
          );
          return {
            statusCode: 201,
            body: { depositRequest: depositDto(row) },
            resourceId: row.id
          };
        }
      );
    } catch (error) {
      translateDuplicate(error);
    }
  }

  public async update(
    context: OrganizationContext,
    id: string,
    version: number,
    input: CustomerDepositInput
  ) {
    await this.authorization.assert(
      context,
      "customer-deposits:manage",
      "CustomerDepositRequest",
      id
    );
    const calculated = calculateInput(input);
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await assertWorkflowEnabled(tx, context.organizationId);
        await validateReferences(tx, context.organizationId, input, calculated.amountMinor);
        const changed = await tx.customerDepositRequest.updateMany({
          where: {
            id,
            organizationId: context.organizationId,
            status: "DRAFT",
            version
          },
          data: {
            requestNumber: input.requestNumber.trim(),
            customerId: input.customerId,
            estimateId: input.estimateId ?? null,
            projectId: input.projectId ?? null,
            classification: input.classification,
            requestDate: calculated.requestDate,
            dueDate: calculated.dueDate,
            amountMinor: calculated.amountMinor,
            currency: input.currency,
            purpose: input.purpose.trim(),
            customerMessage: input.customerMessage?.trim() || null,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1)
          throw new AppError(
            "STALE_CUSTOMER_DEPOSIT_REQUEST",
            "Only the current deposit-request draft can be changed.",
            409
          );
        const row = await tx.customerDepositRequest.findUniqueOrThrow({ where: { id } });
        await audit(tx, context, "CUSTOMER_DEPOSIT_REQUEST_UPDATED", "CustomerDepositRequest", id, {
          financialPosting: false
        });
        return depositDto(row);
      });
    } catch (error) {
      translateDuplicate(error);
    }
  }

  public async transition(
    context: OrganizationContext,
    id: string,
    version: number,
    action: CustomerDepositAction,
    reason: string | null,
    idempotencyKey?: string
  ) {
    const permission =
      action === "approve" || action === "reject" || action === "revise"
        ? "customer-deposits:approve"
        : "customer-deposits:manage";
    await this.authorization.assert(context, permission, "CustomerDepositRequest", id);
    if (["reject", "revise", "cancel"].includes(action) && !reason?.trim())
      throw new AppError(
        "CUSTOMER_DEPOSIT_REASON_REQUIRED",
        "A reason is required for this action.",
        422
      );
    const transition = depositTransition(action);
    return runIdempotent(
      this.prisma,
      context,
      `customer-deposit-request.${action}`,
      idempotencyKey,
      { id, version, action, reason },
      async (tx) => {
        await assertWorkflowEnabled(tx, context.organizationId);
        const now = new Date();
        const changed = await tx.customerDepositRequest.updateMany({
          where: {
            id,
            organizationId: context.organizationId,
            status: { in: transition.from },
            version
          },
          data: {
            status: transition.to,
            ...(action === "submit" ? { submittedAt: now } : {}),
            ...(action === "approve"
              ? {
                  approvedAt: now,
                  approvedByUserId: context.user.id,
                  decisionNote: reason?.trim() || null
                }
              : {}),
            ...(action === "reject"
              ? {
                  rejectedAt: now,
                  rejectedByUserId: context.user.id,
                  decisionNote: reason!.trim()
                }
              : {}),
            ...(action === "revise"
              ? {
                  submittedAt: null,
                  approvedAt: null,
                  approvedByUserId: null,
                  rejectedAt: null,
                  rejectedByUserId: null,
                  decisionNote: reason!.trim()
                }
              : {}),
            ...(action === "cancel" ? { decisionNote: reason!.trim() } : {}),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1)
          throw new AppError(
            "CUSTOMER_DEPOSIT_TRANSITION_INVALID",
            "Deposit request changed or cannot perform that action.",
            409
          );
        const row = await tx.customerDepositRequest.findUniqueOrThrow({ where: { id } });
        await audit(
          tx,
          context,
          `CUSTOMER_DEPOSIT_REQUEST_${transition.to}`,
          "CustomerDepositRequest",
          id,
          {
            reason: reason?.trim() ?? null,
            financialPosting: false
          }
        );
        return {
          statusCode: 200,
          body: { depositRequest: depositDto(row) },
          resourceId: row.id
        };
      }
    );
  }
}

function calculateInput(input: CustomerDepositInput) {
  const requestDate = parseDate(input.requestDate, "requestDate");
  const dueDate = input.dueDate ? parseDate(input.dueDate, "dueDate") : null;
  if (dueDate && dueDate < requestDate)
    throw new AppError(
      "CUSTOMER_DEPOSIT_DATE_INVALID",
      "Deposit due date cannot precede the request date.",
      422
    );
  const amountMinor = parseMinorUnit(input.amountMinor, "amountMinor");
  if (amountMinor <= 0n)
    throw new AppError(
      "CUSTOMER_DEPOSIT_AMOUNT_INVALID",
      "Deposit request amount must be positive.",
      422
    );
  return { requestDate, dueDate, amountMinor };
}

async function validateReferences(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: CustomerDepositInput,
  amountMinor: bigint
) {
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, organizationId, active: true },
    select: { id: true }
  });
  if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Active customer was not found.", 404);
  if (input.estimateId) {
    const estimate = await tx.estimate.findFirst({
      where: {
        id: input.estimateId,
        organizationId,
        status: { in: ["SENT", "VIEWED", "ACCEPTED"] }
      },
      select: { customerId: true, grandTotalMinor: true }
    });
    if (!estimate)
      throw new AppError(
        "CUSTOMER_DEPOSIT_ESTIMATE_INVALID",
        "A sent, viewed, or accepted estimate is required.",
        422
      );
    if (estimate.customerId !== input.customerId)
      throw new AppError(
        "CUSTOMER_DEPOSIT_CUSTOMER_MISMATCH",
        "The estimate belongs to a different customer.",
        422
      );
    if (amountMinor > estimate.grandTotalMinor)
      throw new AppError(
        "CUSTOMER_DEPOSIT_EXCEEDS_ESTIMATE",
        "Deposit request cannot exceed the linked estimate total.",
        422
      );
  }
  if (input.projectId) {
    const project = await tx.project.findFirst({
      where: {
        id: input.projectId,
        organizationId,
        status: { not: "ARCHIVED" }
      },
      select: { customerId: true }
    });
    if (!project)
      throw new AppError("CUSTOMER_DEPOSIT_PROJECT_INVALID", "An active project is required.", 422);
    if (project.customerId !== input.customerId)
      throw new AppError(
        "CUSTOMER_DEPOSIT_CUSTOMER_MISMATCH",
        "The project belongs to a different customer.",
        422
      );
  }
}

async function assertWorkflowEnabled(tx: Prisma.TransactionClient, organizationId: string) {
  const preferences = await tx.workflowPreferences.findUnique({ where: { organizationId } });
  if (!preferences?.customerDepositsEnabled)
    throw new AppError(
      "CUSTOMER_DEPOSITS_DISABLED",
      "Enable customer deposit requests in Company settings first.",
      409
    );
}

function depositTransition(action: CustomerDepositAction): {
  from: CustomerDepositStatus[];
  to: CustomerDepositStatus;
} {
  switch (action) {
    case "submit":
      return { from: ["DRAFT"], to: "SUBMITTED" };
    case "approve":
      return { from: ["SUBMITTED"], to: "APPROVED" };
    case "reject":
      return { from: ["SUBMITTED"], to: "REJECTED" };
    case "revise":
      return { from: ["REJECTED", "APPROVED"], to: "DRAFT" };
    case "cancel":
      return {
        from: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"],
        to: "CANCELLED"
      };
  }
}

function depositDto(row: {
  id: string;
  requestNumber: string;
  customerId: string;
  estimateId: string | null;
  projectId: string | null;
  classification: string;
  requestDate: Date;
  dueDate: Date | null;
  amountMinor: bigint;
  currency: string;
  purpose: string;
  customerMessage: string | null;
  status: string;
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
    customerId: row.customerId,
    estimateId: row.estimateId,
    projectId: row.projectId,
    classification: row.classification,
    requestDate: serializeDate(row.requestDate),
    dueDate: row.dueDate ? serializeDate(row.dueDate) : null,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    purpose: row.purpose,
    customerMessage: row.customerMessage,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByUserId: row.approvedByUserId,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectedByUserId: row.rejectedByUserId,
    decisionNote: row.decisionNote,
    version: row.version,
    financialState: "NON_POSTING",
    capabilities: nonPostingCapabilities
  };
}

function translateDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new AppError(
      "CUSTOMER_DEPOSIT_REQUEST_NUMBER_DUPLICATE",
      "Deposit request number already exists.",
      409
    );
  throw error;
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
