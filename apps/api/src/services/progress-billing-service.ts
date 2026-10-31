import {
  calculateProgressBillingPlan,
  parseMinorUnit,
  type CalculatedProgressPlan
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";

export interface ProgressBillingInput {
  readonly planNumber: string;
  readonly projectId?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly milestones: readonly {
    readonly name: string;
    readonly customerDescription?: string | null | undefined;
    readonly dueDate?: string | null | undefined;
    readonly basis: "PERCENT_OF_ESTIMATE" | "FIXED_SUBTOTAL" | "REMAINING_BALANCE";
    readonly ratioMicros?: string | null | undefined;
    readonly fixedSubtotalMinor?: string | null | undefined;
  }[];
}

export type ProgressBillingAction = "submit" | "approve" | "reject" | "revise" | "cancel";
export type ProgressBillingStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";

const nonPostingCapabilities = {
  financialPosting: false,
  invoiceGeneration: "DISABLED_PENDING_POLICY",
  taxRecognition: "DISABLED_PENDING_POLICY",
  depositApplication: "DISABLED_PENDING_POLICY"
} as const;

export class ProgressBillingService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(
    context: OrganizationContext,
    filters: {
      status?: ProgressBillingStatus | undefined;
      estimateId?: string | undefined;
      projectId?: string | undefined;
    }
  ) {
    await this.authorization.assert(context, "progress-billing:read", "ProgressBillingPlan");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.progressBillingPlan.findMany({
        where: {
          organizationId: context.organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.estimateId ? { estimateId: filters.estimateId } : {}),
          ...(filters.projectId ? { projectId: filters.projectId } : {})
        },
        include: {
          estimate: {
            select: {
              estimateNumber: true,
              provisionalIdentifier: true,
              customerNameSnapshot: true
            }
          },
          project: { select: { projectNumber: true, name: true } },
          _count: { select: { milestones: true } }
        },
        orderBy: [{ createdAt: "desc" }, { planNumber: "asc" }],
        take: 200
      })
    );
    return rows.map((row) => ({
      ...planDto(row),
      estimateReference: row.estimate.estimateNumber ?? row.estimate.provisionalIdentifier,
      customerName: row.estimate.customerNameSnapshot,
      projectReference: row.project ? `${row.project.projectNumber} ${row.project.name}` : null,
      milestoneCount: row._count.milestones
    }));
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "progress-billing:read", "ProgressBillingPlan", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.progressBillingPlan.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          estimate: {
            select: {
              estimateNumber: true,
              provisionalIdentifier: true,
              customerNameSnapshot: true,
              status: true,
              version: true
            }
          },
          project: { select: { projectNumber: true, name: true } },
          milestones: {
            include: {
              allocations: {
                include: {
                  estimateLine: { select: { lineNumber: true, description: true } }
                },
                orderBy: { estimateLine: { lineNumber: "asc" } }
              }
            },
            orderBy: { sequence: "asc" }
          }
        }
      });
      if (!row)
        throw new AppError(
          "PROGRESS_BILLING_PLAN_NOT_FOUND",
          "Progress billing plan was not found.",
          404
        );
      return {
        ...planDto(row),
        estimateReference: row.estimate.estimateNumber ?? row.estimate.provisionalIdentifier,
        customerName: row.estimate.customerNameSnapshot,
        projectReference: row.project ? `${row.project.projectNumber} ${row.project.name}` : null,
        estimateCurrentStatus: row.estimate.status,
        estimateCurrentVersion: row.estimate.version,
        milestones: row.milestones.map((milestone) => ({
          ...milestoneDto(milestone),
          allocations: milestone.allocations.map((allocation) => ({
            estimateLineId: allocation.estimateLineId,
            estimateLineNumber: allocation.estimateLine.lineNumber,
            estimateLineDescription: allocation.estimateLine.description,
            plannedNetMinor: allocation.plannedNetMinor.toString(),
            estimatedTaxMinor: allocation.estimatedTaxMinor.toString(),
            estimatedTotalMinor: allocation.estimatedTotalMinor.toString()
          }))
        }))
      };
    });
  }

  public async create(
    context: OrganizationContext,
    estimateId: string,
    input: ProgressBillingInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "progress-billing:manage", "ProgressBillingPlan");
    try {
      return await runIdempotent(
        this.prisma,
        context,
        "progress-billing-plan.create",
        idempotencyKey,
        { estimateId, input },
        async (tx) => {
          await assertWorkflowEnabled(tx, context.organizationId);
          const estimate = await loadEligibleEstimate(tx, context.organizationId, estimateId);
          await validateProject(tx, context.organizationId, input.projectId, estimate.customerId);
          const calculation = calculate(estimate.lines, input);
          const row = await createPlan(tx, context, estimate, input, calculation);
          await audit(tx, context, "PROGRESS_BILLING_PLAN_CREATED", "ProgressBillingPlan", row.id, {
            estimateId,
            milestoneCount: input.milestones.length,
            financialPosting: false
          });
          return {
            statusCode: 201,
            body: { progressBillingPlan: planDto(row) },
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
    input: ProgressBillingInput
  ) {
    await this.authorization.assert(context, "progress-billing:manage", "ProgressBillingPlan", id);
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await assertWorkflowEnabled(tx, context.organizationId);
        const current = await tx.progressBillingPlan.findFirst({
          where: { id, organizationId: context.organizationId },
          select: { estimateId: true }
        });
        if (!current)
          throw new AppError(
            "PROGRESS_BILLING_PLAN_NOT_FOUND",
            "Progress billing plan was not found.",
            404
          );
        const estimate = await loadEligibleEstimate(tx, context.organizationId, current.estimateId);
        await validateProject(tx, context.organizationId, input.projectId, estimate.customerId);
        const calculation = calculate(estimate.lines, input);
        const changed = await tx.progressBillingPlan.updateMany({
          where: {
            id,
            organizationId: context.organizationId,
            status: "DRAFT",
            version
          },
          data: {
            planNumber: input.planNumber.trim(),
            projectId: input.projectId ?? null,
            estimateVersionSnapshot: estimate.version,
            currency: estimate.currency,
            estimateSubtotalSnapshotMinor: calculation.estimateNetMinor,
            estimateTaxSnapshotMinor: calculation.estimateTaxMinor,
            estimateTotalSnapshotMinor: calculation.estimateTotalMinor,
            notes: input.notes?.trim() || null,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1)
          throw new AppError(
            "STALE_PROGRESS_BILLING_PLAN",
            "Only the current progress-plan draft can be changed.",
            409
          );
        await tx.progressBillingMilestone.deleteMany({
          where: { organizationId: context.organizationId, progressBillingPlanId: id }
        });
        await createMilestones(tx, context.organizationId, id, input, calculation);
        const row = await tx.progressBillingPlan.findUniqueOrThrow({ where: { id } });
        await audit(tx, context, "PROGRESS_BILLING_PLAN_UPDATED", "ProgressBillingPlan", id, {
          milestoneCount: input.milestones.length,
          financialPosting: false
        });
        return planDto(row);
      });
    } catch (error) {
      translateDuplicate(error);
    }
  }

  public async transition(
    context: OrganizationContext,
    id: string,
    version: number,
    action: ProgressBillingAction,
    reason: string | null,
    idempotencyKey?: string
  ) {
    const permission =
      action === "approve" || action === "reject" || action === "revise"
        ? "progress-billing:approve"
        : "progress-billing:manage";
    await this.authorization.assert(context, permission, "ProgressBillingPlan", id);
    if (["reject", "revise", "cancel"].includes(action) && !reason?.trim())
      throw new AppError(
        "PROGRESS_BILLING_REASON_REQUIRED",
        "A reason is required for this action.",
        422
      );
    const transition = progressTransition(action);
    try {
      return await runIdempotent(
        this.prisma,
        context,
        `progress-billing-plan.${action}`,
        idempotencyKey,
        { id, version, action, reason },
        async (tx) => {
          await assertWorkflowEnabled(tx, context.organizationId);
          const plan = await tx.progressBillingPlan.findFirst({
            where: { id, organizationId: context.organizationId },
            select: {
              estimateId: true,
              estimateVersionSnapshot: true
            }
          });
          if (!plan)
            throw new AppError(
              "PROGRESS_BILLING_PLAN_NOT_FOUND",
              "Progress billing plan was not found.",
              404
            );
          if (action === "submit") {
            const estimate = await tx.estimate.findFirst({
              where: {
                id: plan.estimateId,
                organizationId: context.organizationId,
                status: "ACCEPTED"
              },
              select: { version: true }
            });
            if (!estimate || estimate.version !== plan.estimateVersionSnapshot)
              throw new AppError(
                "PROGRESS_ESTIMATE_CHANGED",
                "The accepted estimate changed; refresh the progress plan before submitting.",
                409
              );
          }
          const now = new Date();
          const changed = await tx.progressBillingPlan.updateMany({
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
              "PROGRESS_BILLING_TRANSITION_INVALID",
              "Progress billing plan changed or cannot perform that action.",
              409
            );
          const row = await tx.progressBillingPlan.findUniqueOrThrow({ where: { id } });
          await audit(
            tx,
            context,
            `PROGRESS_BILLING_PLAN_${transition.to}`,
            "ProgressBillingPlan",
            id,
            {
              reason: reason?.trim() ?? null,
              financialPosting: false
            }
          );
          return {
            statusCode: 200,
            body: { progressBillingPlan: planDto(row) },
            resourceId: row.id
          };
        }
      );
    } catch (error) {
      translateDuplicate(error);
    }
  }
}

async function loadEligibleEstimate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  estimateId: string
) {
  const estimate = await tx.estimate.findFirst({
    where: {
      id: estimateId,
      organizationId,
      status: "ACCEPTED"
    },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      convertedInvoice: { select: { id: true } }
    }
  });
  if (!estimate || estimate.convertedInvoice)
    throw new AppError(
      "PROGRESS_ESTIMATE_INVALID",
      "An accepted, unconverted estimate is required.",
      422
    );
  if (estimate.currency !== "CAD")
    throw new AppError(
      "PROGRESS_CURRENCY_UNSUPPORTED",
      "Progress billing currently supports CAD estimates only.",
      422
    );
  return estimate;
}

async function validateProject(
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string | null | undefined,
  customerId: string
) {
  if (!projectId) return;
  const project = await tx.project.findFirst({
    where: {
      id: projectId,
      organizationId,
      status: { not: "ARCHIVED" },
      billingMethod: { not: "NON_BILLABLE" }
    },
    select: { customerId: true }
  });
  if (!project)
    throw new AppError("PROGRESS_PROJECT_INVALID", "An active billable project is required.", 422);
  if (project.customerId !== customerId)
    throw new AppError(
      "PROGRESS_PROJECT_CUSTOMER_MISMATCH",
      "The project and estimate belong to different customers.",
      422
    );
}

function calculate(
  estimateLines: readonly {
    id: string;
    lineNumber: number;
    netAmountMinor: bigint;
    taxTotalMinor: bigint;
  }[],
  input: ProgressBillingInput
) {
  return calculateProgressBillingPlan(
    estimateLines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      netMinor: line.netAmountMinor,
      taxMinor: line.taxTotalMinor
    })),
    input.milestones.map((milestone) => ({
      name: milestone.name,
      basis: milestone.basis,
      ...(milestone.ratioMicros == null
        ? {}
        : { ratioMicros: parseMinorUnit(milestone.ratioMicros, "ratioMicros") }),
      ...(milestone.fixedSubtotalMinor == null
        ? {}
        : {
            fixedSubtotalMinor: parseMinorUnit(milestone.fixedSubtotalMinor, "fixedSubtotalMinor")
          })
    }))
  );
}

async function createPlan(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  estimate: {
    id: string;
    version: number;
    currency: string;
  },
  input: ProgressBillingInput,
  calculation: CalculatedProgressPlan
) {
  const row = await tx.progressBillingPlan.create({
    data: {
      organizationId: context.organizationId,
      planNumber: input.planNumber.trim(),
      estimateId: estimate.id,
      projectId: input.projectId ?? null,
      estimateVersionSnapshot: estimate.version,
      currency: estimate.currency,
      estimateSubtotalSnapshotMinor: calculation.estimateNetMinor,
      estimateTaxSnapshotMinor: calculation.estimateTaxMinor,
      estimateTotalSnapshotMinor: calculation.estimateTotalMinor,
      notes: input.notes?.trim() || null,
      createdByUserId: context.user.id,
      updatedByUserId: context.user.id
    }
  });
  await createMilestones(tx, context.organizationId, row.id, input, calculation);
  return row;
}

async function createMilestones(
  tx: Prisma.TransactionClient,
  organizationId: string,
  planId: string,
  input: ProgressBillingInput,
  calculation: CalculatedProgressPlan
) {
  for (const calculated of calculation.milestones) {
    const source = input.milestones[calculated.sequence - 1]!;
    const milestone = await tx.progressBillingMilestone.create({
      data: {
        organizationId,
        progressBillingPlanId: planId,
        sequence: calculated.sequence,
        name: calculated.name,
        customerDescription: source.customerDescription?.trim() || null,
        dueDate: source.dueDate ? parseDate(source.dueDate, "dueDate") : null,
        basis: calculated.basis,
        ratioMicros: calculated.ratioMicros,
        fixedSubtotalMinor: calculated.fixedSubtotalMinor,
        plannedNetMinor: calculated.plannedNetMinor,
        estimatedTaxMinor: calculated.estimatedTaxMinor,
        estimatedTotalMinor: calculated.estimatedTotalMinor
      }
    });
    if (calculated.allocations.length)
      await tx.progressBillingAllocation.createMany({
        data: calculated.allocations.map((allocation) => ({
          organizationId,
          progressBillingMilestoneId: milestone.id,
          estimateLineId: allocation.estimateLineId,
          plannedNetMinor: allocation.plannedNetMinor,
          estimatedTaxMinor: allocation.estimatedTaxMinor,
          estimatedTotalMinor: allocation.estimatedTotalMinor
        }))
      });
  }
}

async function assertWorkflowEnabled(tx: Prisma.TransactionClient, organizationId: string) {
  const preferences = await tx.workflowPreferences.findUnique({ where: { organizationId } });
  if (!preferences?.progressBillingEnabled)
    throw new AppError(
      "PROGRESS_BILLING_DISABLED",
      "Enable progress billing in Company settings first.",
      409
    );
}

function progressTransition(action: ProgressBillingAction): {
  from: ProgressBillingStatus[];
  to: ProgressBillingStatus;
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

function planDto(row: {
  id: string;
  planNumber: string;
  estimateId: string;
  projectId: string | null;
  status: string;
  estimateVersionSnapshot: number;
  currency: string;
  estimateSubtotalSnapshotMinor: bigint;
  estimateTaxSnapshotMinor: bigint;
  estimateTotalSnapshotMinor: bigint;
  notes: string | null;
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
    planNumber: row.planNumber,
    estimateId: row.estimateId,
    projectId: row.projectId,
    status: row.status,
    estimateVersionSnapshot: row.estimateVersionSnapshot,
    currency: row.currency,
    estimateSubtotalSnapshotMinor: row.estimateSubtotalSnapshotMinor.toString(),
    estimateTaxSnapshotMinor: row.estimateTaxSnapshotMinor.toString(),
    estimateTotalSnapshotMinor: row.estimateTotalSnapshotMinor.toString(),
    notes: row.notes,
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

function milestoneDto(row: {
  id: string;
  sequence: number;
  name: string;
  customerDescription: string | null;
  dueDate: Date | null;
  basis: string;
  ratioMicros: bigint | null;
  fixedSubtotalMinor: bigint | null;
  plannedNetMinor: bigint;
  estimatedTaxMinor: bigint;
  estimatedTotalMinor: bigint;
}) {
  return {
    id: row.id,
    sequence: row.sequence,
    name: row.name,
    customerDescription: row.customerDescription,
    dueDate: row.dueDate ? serializeDate(row.dueDate) : null,
    basis: row.basis,
    ratioMicros: row.ratioMicros?.toString() ?? null,
    fixedSubtotalMinor: row.fixedSubtotalMinor?.toString() ?? null,
    plannedNetMinor: row.plannedNetMinor.toString(),
    estimatedTaxMinor: row.estimatedTaxMinor.toString(),
    estimatedTotalMinor: row.estimatedTotalMinor.toString()
  };
}

function translateDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new AppError(
      "PROGRESS_BILLING_PLAN_CONFLICT",
      "The plan number already exists or this estimate already has an active progress plan.",
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
