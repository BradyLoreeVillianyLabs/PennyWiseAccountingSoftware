import { parseMinorUnit, serializeMinorUnit } from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

export const workflowProfileKeys = [
  "INVOICING_ONLY",
  "SOLO_SERVICE",
  "PROJECT_TRADES",
  "BOOKKEEPER_MANAGED",
  "PRODUCT_OPERATIONS"
] as const;
export type WorkflowProfileKey = (typeof workflowProfileKeys)[number];

export interface WorkflowPreferencesInput {
  readonly version: number;
  readonly profileKey: WorkflowProfileKey;
  readonly ownerWorkspaceEnabled?: boolean | undefined;
  readonly bankFeedReviewRequired?: boolean | undefined;
  readonly cashPlanningEnabled: boolean;
  readonly purchaseRequestsEnabled: boolean;
  readonly purchaseApprovalThresholdMinor: string;
  readonly requireSeparatePurchaseApprover: boolean;
  readonly customerDepositsEnabled: boolean;
  readonly progressBillingEnabled: boolean;
  readonly fixedAssetRegisterEnabled: boolean;
  readonly payrollSummaryImportEnabled: boolean;
}

interface WorkflowProfileDefinition {
  readonly key: WorkflowProfileKey;
  readonly label: string;
  readonly description: string;
  readonly ownerWorkspaceEnabled: boolean;
  readonly bankFeedReviewRequired: boolean;
  readonly cashPlanningEnabled: boolean;
  readonly purchaseRequestsEnabled: boolean;
  readonly purchaseApprovalThresholdMinor: bigint;
  readonly requireSeparatePurchaseApprover: boolean;
  readonly customerDepositsEnabled: boolean;
  readonly progressBillingEnabled: boolean;
  readonly fixedAssetRegisterEnabled: boolean;
  readonly payrollSummaryImportEnabled: boolean;
}

const profileDefinitions: Readonly<Record<WorkflowProfileKey, WorkflowProfileDefinition>> = {
  INVOICING_ONLY: profile(
    "INVOICING_ONLY",
    "Just invoicing",
    "A simple workspace for sending invoices, tracking customers, and recording payments.",
    {
      ownerWorkspaceEnabled: false,
      cashPlanningEnabled: false,
      purchaseRequestsEnabled: false,
      customerDepositsEnabled: false,
      progressBillingEnabled: false,
      fixedAssetRegisterEnabled: false
    }
  ),
  SOLO_SERVICE: profile(
    "SOLO_SERVICE",
    "Solo service",
    "A focused invoicing and cash-planning workspace for an owner-operator."
  ),
  PROJECT_TRADES: profile(
    "PROJECT_TRADES",
    "Projects and trades",
    "Adds purchasing, deposits, progress billing, and asset-register workflows.",
    {
      purchaseRequestsEnabled: true,
      customerDepositsEnabled: true,
      progressBillingEnabled: true,
      fixedAssetRegisterEnabled: true
    }
  ),
  BOOKKEEPER_MANAGED: profile(
    "BOOKKEEPER_MANAGED",
    "Bookkeeper managed",
    "Shows the broad review workspace and separates purchase request approval.",
    {
      purchaseRequestsEnabled: true,
      requireSeparatePurchaseApprover: true,
      customerDepositsEnabled: true,
      progressBillingEnabled: true,
      fixedAssetRegisterEnabled: true
    }
  ),
  PRODUCT_OPERATIONS: profile(
    "PRODUCT_OPERATIONS",
    "Product operations",
    "Emphasizes purchase controls, cash planning, fixed assets, and inventory operations.",
    {
      purchaseRequestsEnabled: true,
      fixedAssetRegisterEnabled: true
    }
  )
};

const accountPresetProfiles: Readonly<Record<string, WorkflowProfileKey>> = {
  "general-service": "SOLO_SERVICE",
  "contractor-trades": "PROJECT_TRADES",
  "ranch-agriculture": "PROJECT_TRADES",
  "repair-business": "PROJECT_TRADES",
  "tourism-experiences": "SOLO_SERVICE",
  "small-product-seller": "PRODUCT_OPERATIONS"
};

const immutableSafetyControls = Object.freeze({
  bankImportReviewRequired: true,
  ocrCaptureReviewRequired: true,
  automaticPostingEnabled: false,
  holdbacksEnabled: false,
  payrollSummaryImportAvailable: false
});

export class WorkflowPreferencesService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async get(context: OrganizationContext) {
    await this.authorization.assert(context, "settings:read", "WorkflowPreferences");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const preferences = await ensureWorkflowPreferences(tx, context);
      return responseDto(preferences);
    });
  }

  public async update(context: OrganizationContext, input: WorkflowPreferencesInput) {
    await this.authorization.assert(context, "settings:write", "WorkflowPreferences");
    const purchaseApprovalThresholdMinor = parseMinorUnit(
      input.purchaseApprovalThresholdMinor,
      "purchaseApprovalThresholdMinor"
    );
    if (purchaseApprovalThresholdMinor < 0n) {
      throw new AppError(
        "PURCHASE_APPROVAL_THRESHOLD_INVALID",
        "Purchase approval threshold cannot be negative.",
        422
      );
    }

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await ensureWorkflowPreferences(tx, context);
      const result = await tx.workflowPreferences.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          version: input.version
        },
        data: {
          profileKey: input.profileKey,
          ownerWorkspaceEnabled: input.ownerWorkspaceEnabled ?? current.ownerWorkspaceEnabled,
          bankFeedReviewRequired: input.bankFeedReviewRequired ?? current.bankFeedReviewRequired,
          cashPlanningEnabled: input.cashPlanningEnabled,
          purchaseRequestsEnabled: input.purchaseRequestsEnabled,
          purchaseApprovalThresholdMinor,
          requireSeparatePurchaseApprover: input.requireSeparatePurchaseApprover,
          customerDepositsEnabled: input.customerDepositsEnabled,
          progressBillingEnabled: input.progressBillingEnabled,
          fixedAssetRegisterEnabled: input.fixedAssetRegisterEnabled,
          // Retained in the wire/database contract for backward compatibility only. There is no
          // payroll-summary importer behind this preference, so it must never imply availability.
          payrollSummaryImportEnabled: false,
          customizedAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) {
        throw new AppError(
          "STALE_VERSION",
          "Workflow preferences were changed by another request.",
          409
        );
      }
      const updated = await tx.workflowPreferences.findUniqueOrThrow({
        where: { organizationId: context.organizationId }
      });
      await audit(tx, context, "WORKFLOW_PREFERENCES_UPDATED", updated.id, {
        profileKey: updated.profileKey,
        changedFields: changedFields(current, updated)
      });
      return responseDto(updated);
    });
  }
}

export async function seedWorkflowPreferencesFromAccountPreset(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  sourcePresetKey: string
) {
  const profileKey = accountPresetProfiles[sourcePresetKey];
  if (!profileKey) return ensureDefaultPreferences(tx, context);

  const current = await tx.workflowPreferences.findUnique({
    where: { organizationId: context.organizationId }
  });
  if (current?.customizedAt || current?.sourcePresetKey) return current;

  const defaults = profileDefinitions[profileKey];
  if (!current) {
    const created = await tx.workflowPreferences.create({
      data: {
        organizationId: context.organizationId,
        sourcePresetKey,
        ...databaseDefaults(defaults)
      }
    });
    await audit(tx, context, "WORKFLOW_PREFERENCES_SEEDED", created.id, {
      sourcePresetKey,
      profileKey
    });
    return created;
  }

  const result = await tx.workflowPreferences.updateMany({
    where: {
      id: current.id,
      organizationId: context.organizationId,
      version: current.version,
      customizedAt: null,
      sourcePresetKey: null
    },
    data: {
      sourcePresetKey,
      ...databaseDefaults(defaults),
      version: { increment: 1 }
    }
  });
  const seeded = await tx.workflowPreferences.findUniqueOrThrow({
    where: { organizationId: context.organizationId }
  });
  if (result.count === 1) {
    await audit(tx, context, "WORKFLOW_PREFERENCES_SEEDED", seeded.id, {
      sourcePresetKey,
      profileKey
    });
  }
  return seeded;
}

async function ensureWorkflowPreferences(
  tx: Prisma.TransactionClient,
  context: OrganizationContext
) {
  const existing = await tx.workflowPreferences.findUnique({
    where: { organizationId: context.organizationId }
  });
  if (existing?.customizedAt || existing?.sourcePresetKey) return existing;

  const settings = await tx.organizationSettings.findUnique({
    where: { organizationId: context.organizationId },
    select: { industryPresetKey: true }
  });
  const appliedPreset = settings?.industryPresetKey
    ? settings.industryPresetKey
    : (
        await tx.appliedAccountPreset.findFirst({
          where: { organizationId: context.organizationId },
          select: { presetKey: true },
          orderBy: { appliedAt: "desc" }
        })
      )?.presetKey;
  if (appliedPreset) {
    return seedWorkflowPreferencesFromAccountPreset(tx, context, appliedPreset);
  }
  return existing ?? ensureDefaultPreferences(tx, context);
}

async function ensureDefaultPreferences(
  tx: Prisma.TransactionClient,
  context: OrganizationContext
) {
  const existing = await tx.workflowPreferences.findUnique({
    where: { organizationId: context.organizationId }
  });
  if (existing) return existing;
  const created = await tx.workflowPreferences.create({
    data: {
      organizationId: context.organizationId,
      ...databaseDefaults(profileDefinitions.SOLO_SERVICE)
    }
  });
  await audit(tx, context, "WORKFLOW_PREFERENCES_INITIALIZED", created.id, {
    profileKey: "SOLO_SERVICE"
  });
  return created;
}

function profile(
  key: WorkflowProfileKey,
  label: string,
  description: string,
  overrides: Partial<Omit<WorkflowProfileDefinition, "key" | "label" | "description">> = {}
): WorkflowProfileDefinition {
  return {
    key,
    label,
    description,
    ownerWorkspaceEnabled: true,
    bankFeedReviewRequired: true,
    cashPlanningEnabled: true,
    purchaseRequestsEnabled: false,
    purchaseApprovalThresholdMinor: 0n,
    requireSeparatePurchaseApprover: false,
    customerDepositsEnabled: false,
    progressBillingEnabled: false,
    fixedAssetRegisterEnabled: false,
    payrollSummaryImportEnabled: false,
    ...overrides
  };
}

function databaseDefaults(definition: WorkflowProfileDefinition) {
  return {
    profileKey: definition.key,
    ownerWorkspaceEnabled: definition.ownerWorkspaceEnabled,
    bankFeedReviewRequired: definition.bankFeedReviewRequired,
    cashPlanningEnabled: definition.cashPlanningEnabled,
    purchaseRequestsEnabled: definition.purchaseRequestsEnabled,
    purchaseApprovalThresholdMinor: definition.purchaseApprovalThresholdMinor,
    requireSeparatePurchaseApprover: definition.requireSeparatePurchaseApprover,
    customerDepositsEnabled: definition.customerDepositsEnabled,
    progressBillingEnabled: definition.progressBillingEnabled,
    fixedAssetRegisterEnabled: definition.fixedAssetRegisterEnabled,
    payrollSummaryImportEnabled: definition.payrollSummaryImportEnabled
  };
}

function responseDto(preferences: {
  id: string;
  version: number;
  profileKey: string;
  ownerWorkspaceEnabled: boolean;
  bankFeedReviewRequired: boolean;
  sourcePresetKey: string | null;
  cashPlanningEnabled: boolean;
  purchaseRequestsEnabled: boolean;
  purchaseApprovalThresholdMinor: bigint;
  requireSeparatePurchaseApprover: boolean;
  customerDepositsEnabled: boolean;
  progressBillingEnabled: boolean;
  fixedAssetRegisterEnabled: boolean;
  payrollSummaryImportEnabled: boolean;
  customizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    workflowPreferences: {
      ...preferences,
      payrollSummaryImportEnabled: false,
      purchaseApprovalThresholdMinor: serializeMinorUnit(
        preferences.purchaseApprovalThresholdMinor
      ),
      customizedAt: preferences.customizedAt?.toISOString() ?? null,
      createdAt: preferences.createdAt.toISOString(),
      updatedAt: preferences.updatedAt.toISOString()
    },
    profileDefaults: workflowProfileKeys.map((key) => {
      const definition = profileDefinitions[key];
      return {
        ...definition,
        purchaseApprovalThresholdMinor: serializeMinorUnit(
          definition.purchaseApprovalThresholdMinor
        )
      };
    }),
    safetyControls: immutableSafetyControls
  };
}

function changedFields(
  current: Record<string, unknown>,
  updated: Record<string, unknown>
): string[] {
  return [
    "profileKey",
    "ownerWorkspaceEnabled",
    "bankFeedReviewRequired",
    "cashPlanningEnabled",
    "purchaseRequestsEnabled",
    "purchaseApprovalThresholdMinor",
    "requireSeparatePurchaseApprover",
    "customerDepositsEnabled",
    "progressBillingEnabled",
    "fixedAssetRegisterEnabled",
    "payrollSummaryImportEnabled"
  ].filter((key) => current[key] !== updated[key]);
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
      targetType: "WorkflowPreferences",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
