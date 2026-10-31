import {
  calculateBookDepreciation,
  parseMinorUnit,
  roundRatioHalfUp,
  type BookDepreciationCalculation,
  type BookDepreciationInput
} from "@clearledger/accounting-core";
import {
  Prisma,
  withTenantTransaction,
  type FixedAsset,
  type FixedAssetClass,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";

export type FixedAssetBookMethod = "NONE" | "STRAIGHT_LINE";
export type FixedAssetBookConvention = "FULL_MONTH" | "NEXT_MONTH";
export type FixedAssetLedgerTreatment =
  | "UNDECIDED"
  | "ALREADY_RECORDED"
  | "OPENING_BALANCE"
  | "RECLASSIFICATION_REQUIRED";
export type FixedAssetStatus = "DRAFT" | "SUBMITTED" | "REGISTERED" | "REJECTED" | "CANCELLED";
export type FixedAssetAction = "submit" | "register" | "reject" | "revise" | "cancel";

export interface FixedAssetClassInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly defaultBookMethod: FixedAssetBookMethod;
  readonly defaultBookConvention?: FixedAssetBookConvention | null | undefined;
  readonly defaultUsefulLifeMonths?: number | null | undefined;
  readonly defaultResidualRatioMicros?: string | null | undefined;
  readonly defaultAssetAccountId?: string | null | undefined;
  readonly defaultAccumulatedAccountId?: string | null | undefined;
  readonly defaultDepreciationExpenseId?: string | null | undefined;
  readonly defaultDisposalGainAccountId?: string | null | undefined;
  readonly defaultDisposalLossAccountId?: string | null | undefined;
}

export interface FixedAssetCreateInput {
  readonly fixedAssetClassId: string;
  readonly assetNumber: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly acquiredOn: string;
  readonly inServiceOn: string;
  readonly acquisitionCostMinor: string;
  readonly residualValueMinor?: string | null | undefined;
  readonly openingAccumulatedDepreciationMinor?: string | undefined;
  readonly openingBalanceDate?: string | null | undefined;
  readonly remainingUsefulLifeMonths?: number | null | undefined;
  readonly bookMethod?: FixedAssetBookMethod | undefined;
  readonly bookConvention?: FixedAssetBookConvention | null | undefined;
  readonly usefulLifeMonths?: number | null | undefined;
  readonly ledgerTreatment: FixedAssetLedgerTreatment;
  readonly sourceKind?: "MANUAL_REFERENCE" | undefined;
  readonly sourceReference: string;
  readonly assetAccountId?: string | null | undefined;
  readonly accumulatedDepreciationAccountId?: string | null | undefined;
  readonly depreciationExpenseAccountId?: string | null | undefined;
  readonly disposalGainAccountId?: string | null | undefined;
  readonly disposalLossAccountId?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface FixedAssetPatchInput {
  readonly assetNumber?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly acquiredOn?: string | undefined;
  readonly inServiceOn?: string | undefined;
  readonly acquisitionCostMinor?: string | undefined;
  readonly residualValueMinor?: string | undefined;
  readonly openingAccumulatedDepreciationMinor?: string | undefined;
  readonly openingBalanceDate?: string | null | undefined;
  readonly remainingUsefulLifeMonths?: number | null | undefined;
  readonly bookMethod?: FixedAssetBookMethod | undefined;
  readonly bookConvention?: FixedAssetBookConvention | null | undefined;
  readonly usefulLifeMonths?: number | null | undefined;
  readonly ledgerTreatment?: FixedAssetLedgerTreatment | undefined;
  readonly sourceReference?: string | undefined;
  readonly assetAccountId?: string | null | undefined;
  readonly accumulatedDepreciationAccountId?: string | null | undefined;
  readonly depreciationExpenseAccountId?: string | null | undefined;
  readonly disposalGainAccountId?: string | null | undefined;
  readonly disposalLossAccountId?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

interface AccountMappings {
  readonly assetAccountId: string | null;
  readonly accumulatedDepreciationAccountId: string | null;
  readonly depreciationExpenseAccountId: string | null;
  readonly disposalGainAccountId: string | null;
  readonly disposalLossAccountId: string | null;
}

interface CalculatedAssetValues {
  readonly acquiredOn: Date;
  readonly inServiceOn: Date;
  readonly acquisitionCostMinor: bigint;
  readonly residualValueMinor: bigint;
  readonly residualRatioMicrosSnapshot: bigint | null;
  readonly openingAccumulatedDepreciationMinor: bigint;
  readonly openingBalanceDate: Date | null;
  readonly remainingUsefulLifeMonths: number | null;
  readonly bookMethod: FixedAssetBookMethod;
  readonly bookConvention: FixedAssetBookConvention | null;
  readonly usefulLifeMonths: number | null;
  readonly calculation: BookDepreciationCalculation;
}

const residualRatioScale = 1_000_000n;
const maximumUsefulLifeMonths = 1_200;

const nonPostingCapabilities = {
  financialPosting: false,
  registerOnly: true,
  depreciationPosting: "DISABLED_PENDING_POLICY",
  disposal: "DISABLED_PENDING_POLICY",
  cca: "NOT_INCLUDED"
} as const;

export class FixedAssetService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listClasses(context: OrganizationContext, includeArchived = false) {
    await this.authorization.assert(context, "fixed-assets:read", "FixedAssetClass");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.fixedAssetClass.findMany({
        where: {
          organizationId: context.organizationId,
          ...(includeArchived ? {} : { isArchived: false })
        },
        orderBy: [{ isArchived: "asc" }, { name: "asc" }],
        take: 200
      })
    );
    return rows.map(fixedAssetClassDto);
  }

  public async getClass(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "fixed-assets:read", "FixedAssetClass", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.fixedAssetClass.findFirst({
        where: { id, organizationId: context.organizationId }
      })
    );
    if (!row)
      throw new AppError("FIXED_ASSET_CLASS_NOT_FOUND", "Fixed-asset class was not found.", 404);
    return fixedAssetClassDto(row);
  }

  public async createClass(
    context: OrganizationContext,
    input: FixedAssetClassInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "fixed-assets:configure", "FixedAssetClass");
    const calculated = calculateClassInput(input);
    try {
      return await runIdempotent(
        this.prisma,
        context,
        "fixed-asset-class.create",
        idempotencyKey,
        input,
        async (tx) => {
          await assertWorkflowEnabled(tx, context.organizationId);
          await validateAccountMappings(tx, context.organizationId, calculated.mappings);
          const row = await tx.fixedAssetClass.create({
            data: {
              organizationId: context.organizationId,
              code: requiredText(input.code, "class code"),
              name: requiredText(input.name, "class name"),
              description: nullableText(input.description),
              defaultBookMethod: input.defaultBookMethod,
              defaultBookConvention: calculated.defaultBookConvention,
              defaultUsefulLifeMonths: calculated.defaultUsefulLifeMonths,
              defaultResidualRatioMicros: calculated.defaultResidualRatioMicros,
              defaultAssetAccountId: calculated.mappings.assetAccountId,
              defaultAccumulatedAccountId: calculated.mappings.accumulatedDepreciationAccountId,
              defaultDepreciationExpenseId: calculated.mappings.depreciationExpenseAccountId,
              defaultDisposalGainAccountId: calculated.mappings.disposalGainAccountId,
              defaultDisposalLossAccountId: calculated.mappings.disposalLossAccountId,
              createdByUserId: context.user.id,
              updatedByUserId: context.user.id
            }
          });
          await audit(tx, context, "FIXED_ASSET_CLASS_CREATED", "FixedAssetClass", row.id, {
            code: row.code,
            defaultBookMethod: row.defaultBookMethod,
            financialPosting: false
          });
          return {
            statusCode: 201,
            body: { fixedAssetClass: fixedAssetClassDto(row) },
            resourceId: row.id
          };
        }
      );
    } catch (error) {
      translateClassDuplicate(error);
    }
  }

  public async updateClass(
    context: OrganizationContext,
    id: string,
    version: number,
    input: FixedAssetClassInput
  ) {
    await this.authorization.assert(context, "fixed-assets:configure", "FixedAssetClass", id);
    const calculated = calculateClassInput(input);
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await assertWorkflowEnabled(tx, context.organizationId);
        await validateAccountMappings(tx, context.organizationId, calculated.mappings);
        const changed = await tx.fixedAssetClass.updateMany({
          where: {
            id,
            organizationId: context.organizationId,
            version,
            isArchived: false
          },
          data: {
            code: requiredText(input.code, "class code"),
            name: requiredText(input.name, "class name"),
            description: nullableText(input.description),
            defaultBookMethod: input.defaultBookMethod,
            defaultBookConvention: calculated.defaultBookConvention,
            defaultUsefulLifeMonths: calculated.defaultUsefulLifeMonths,
            defaultResidualRatioMicros: calculated.defaultResidualRatioMicros,
            defaultAssetAccountId: calculated.mappings.assetAccountId,
            defaultAccumulatedAccountId: calculated.mappings.accumulatedDepreciationAccountId,
            defaultDepreciationExpenseId: calculated.mappings.depreciationExpenseAccountId,
            defaultDisposalGainAccountId: calculated.mappings.disposalGainAccountId,
            defaultDisposalLossAccountId: calculated.mappings.disposalLossAccountId,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1)
          throw new AppError(
            "STALE_FIXED_ASSET_CLASS",
            "Only the current active fixed-asset class can be changed.",
            409
          );
        const row = await tx.fixedAssetClass.findUniqueOrThrow({ where: { id } });
        await audit(tx, context, "FIXED_ASSET_CLASS_UPDATED", "FixedAssetClass", id, {
          financialPosting: false
        });
        return fixedAssetClassDto(row);
      });
    } catch (error) {
      translateClassDuplicate(error);
    }
  }

  public async archiveClass(
    context: OrganizationContext,
    id: string,
    version: number,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "fixed-assets:configure", "FixedAssetClass", id);
    return runIdempotent(
      this.prisma,
      context,
      "fixed-asset-class.archive",
      idempotencyKey,
      { id, version },
      async (tx) => {
        await assertWorkflowEnabled(tx, context.organizationId);
        const changed = await tx.fixedAssetClass.updateMany({
          where: {
            id,
            organizationId: context.organizationId,
            version,
            isArchived: false
          },
          data: {
            isArchived: true,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1)
          throw new AppError(
            "STALE_FIXED_ASSET_CLASS",
            "Fixed-asset class changed or is already archived.",
            409
          );
        const row = await tx.fixedAssetClass.findUniqueOrThrow({ where: { id } });
        await audit(tx, context, "FIXED_ASSET_CLASS_ARCHIVED", "FixedAssetClass", id, {
          financialPosting: false
        });
        return {
          statusCode: 200,
          body: { fixedAssetClass: fixedAssetClassDto(row) },
          resourceId: row.id
        };
      }
    );
  }

  public async list(
    context: OrganizationContext,
    filters: {
      readonly status?: FixedAssetStatus | undefined;
      readonly fixedAssetClassId?: string | undefined;
    } = {}
  ) {
    await this.authorization.assert(context, "fixed-assets:read", "FixedAsset");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.fixedAsset.findMany({
        where: {
          organizationId: context.organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.fixedAssetClassId ? { fixedAssetClassId: filters.fixedAssetClassId } : {})
        },
        include: { fixedAssetClass: { select: { code: true, name: true } } },
        orderBy: [{ status: "asc" }, { inServiceOn: "desc" }, { assetNumber: "asc" }],
        take: 200
      })
    );
    return rows.map((row) => ({
      ...fixedAssetDto(row),
      classCode: row.fixedAssetClass.code,
      className: row.fixedAssetClass.name
    }));
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "fixed-assets:read", "FixedAsset", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.fixedAsset.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { fixedAssetClass: { select: { code: true, name: true } } }
      })
    );
    if (!row) throw new AppError("FIXED_ASSET_NOT_FOUND", "Fixed asset was not found.", 404);
    return {
      ...fixedAssetDto(row),
      classCode: row.fixedAssetClass.code,
      className: row.fixedAssetClass.name
    };
  }

  public async create(
    context: OrganizationContext,
    input: FixedAssetCreateInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "fixed-assets:manage", "FixedAsset");
    try {
      return await runIdempotent(
        this.prisma,
        context,
        "fixed-asset.create",
        idempotencyKey,
        input,
        async (tx) => {
          await assertWorkflowEnabled(tx, context.organizationId);
          const organization = await tx.organization.findFirst({
            where: { id: context.organizationId },
            select: { currency: true }
          });
          if (!organization || organization.currency !== "CAD")
            throw new AppError(
              "FIXED_ASSET_CURRENCY_UNSUPPORTED",
              "This fixed-asset register currently supports CAD organizations only.",
              422
            );
          const assetClass = await tx.fixedAssetClass.findFirst({
            where: {
              id: input.fixedAssetClassId,
              organizationId: context.organizationId,
              isArchived: false
            }
          });
          if (!assetClass)
            throw new AppError(
              "FIXED_ASSET_CLASS_NOT_FOUND",
              "An active fixed-asset class is required.",
              404
            );

          const mappings = creationMappings(input, assetClass);
          await validateAccountMappings(tx, context.organizationId, mappings);
          const values = calculateCreationValues(input, assetClass);
          const row = await tx.fixedAsset.create({
            data: {
              organizationId: context.organizationId,
              fixedAssetClassId: assetClass.id,
              classVersionSnapshot: assetClass.version,
              assetNumber: requiredText(input.assetNumber, "asset number"),
              name: requiredText(input.name, "asset name"),
              description: nullableText(input.description),
              acquiredOn: values.acquiredOn,
              inServiceOn: values.inServiceOn,
              currency: organization.currency,
              acquisitionCostMinor: values.acquisitionCostMinor,
              residualValueMinor: values.residualValueMinor,
              residualRatioMicrosSnapshot: values.residualRatioMicrosSnapshot,
              openingAccumulatedDepreciationMinor: values.openingAccumulatedDepreciationMinor,
              openingBalanceDate: values.openingBalanceDate,
              remainingUsefulLifeMonths: values.remainingUsefulLifeMonths,
              bookMethod: values.bookMethod,
              bookConvention: values.bookConvention,
              usefulLifeMonths: values.usefulLifeMonths,
              ledgerTreatment: input.ledgerTreatment,
              sourceKind: assertManualSource(input.sourceKind),
              sourceReference: requiredText(input.sourceReference, "source reference"),
              ...mappings,
              serialNumber: nullableText(input.serialNumber),
              location: nullableText(input.location),
              notes: nullableText(input.notes),
              createdByUserId: context.user.id,
              updatedByUserId: context.user.id
            }
          });
          await audit(tx, context, "FIXED_ASSET_CREATED", "FixedAsset", row.id, {
            fixedAssetClassId: assetClass.id,
            classVersionSnapshot: assetClass.version,
            bookMethod: row.bookMethod,
            calculationVersion: values.calculation.calculationVersion,
            inputHash: values.calculation.inputHash,
            financialPosting: false
          });
          return {
            statusCode: 201,
            body: { fixedAsset: fixedAssetDto(row) },
            resourceId: row.id
          };
        }
      );
    } catch (error) {
      translateAssetDuplicate(error);
    }
  }

  public async update(
    context: OrganizationContext,
    id: string,
    version: number,
    input: FixedAssetPatchInput
  ) {
    await this.authorization.assert(context, "fixed-assets:manage", "FixedAsset", id);
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await assertWorkflowEnabled(tx, context.organizationId);
        const current = await tx.fixedAsset.findFirst({
          where: { id, organizationId: context.organizationId }
        });
        if (!current || current.status !== "DRAFT" || current.version !== version)
          throw new AppError(
            "STALE_FIXED_ASSET",
            "Only the current fixed-asset draft can be changed.",
            409
          );

        const mappings = patchMappings(input, current);
        await validateAccountMappings(tx, context.organizationId, mappings);
        const values = calculatePatchedValues(input, current);
        const changed = await tx.fixedAsset.updateMany({
          where: {
            id,
            organizationId: context.organizationId,
            status: "DRAFT",
            version
          },
          data: {
            assetNumber:
              input.assetNumber === undefined
                ? current.assetNumber
                : requiredText(input.assetNumber, "asset number"),
            name: input.name === undefined ? current.name : requiredText(input.name, "asset name"),
            description:
              input.description === undefined
                ? current.description
                : nullableText(input.description),
            acquiredOn: values.acquiredOn,
            inServiceOn: values.inServiceOn,
            acquisitionCostMinor: values.acquisitionCostMinor,
            residualValueMinor: values.residualValueMinor,
            residualRatioMicrosSnapshot: values.residualRatioMicrosSnapshot,
            openingAccumulatedDepreciationMinor: values.openingAccumulatedDepreciationMinor,
            openingBalanceDate: values.openingBalanceDate,
            remainingUsefulLifeMonths: values.remainingUsefulLifeMonths,
            bookMethod: values.bookMethod,
            bookConvention: values.bookConvention,
            usefulLifeMonths: values.usefulLifeMonths,
            ledgerTreatment: input.ledgerTreatment ?? current.ledgerTreatment,
            sourceReference:
              input.sourceReference === undefined
                ? current.sourceReference
                : requiredText(input.sourceReference, "source reference"),
            ...mappings,
            serialNumber:
              input.serialNumber === undefined
                ? current.serialNumber
                : nullableText(input.serialNumber),
            location:
              input.location === undefined ? current.location : nullableText(input.location),
            notes: input.notes === undefined ? current.notes : nullableText(input.notes),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1)
          throw new AppError(
            "STALE_FIXED_ASSET",
            "Only the current fixed-asset draft can be changed.",
            409
          );
        const row = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
        await audit(tx, context, "FIXED_ASSET_UPDATED", "FixedAsset", id, {
          calculationVersion: values.calculation.calculationVersion,
          inputHash: values.calculation.inputHash,
          financialPosting: false
        });
        return fixedAssetDto(row);
      });
    } catch (error) {
      translateAssetDuplicate(error);
    }
  }

  public async transition(
    context: OrganizationContext,
    id: string,
    version: number,
    action: FixedAssetAction,
    reason: string | null,
    idempotencyKey?: string
  ) {
    const permission =
      action === "register" || action === "reject" || action === "revise"
        ? "fixed-assets:approve"
        : "fixed-assets:manage";
    await this.authorization.assert(context, permission, "FixedAsset", id);
    if (["reject", "revise", "cancel"].includes(action) && !reason?.trim())
      throw new AppError(
        "FIXED_ASSET_REASON_REQUIRED",
        "A reason is required for this action.",
        422
      );
    const transition = fixedAssetTransition(action);

    return runIdempotent(
      this.prisma,
      context,
      `fixed-asset.${action}`,
      idempotencyKey,
      { id, version, action, reason },
      async (tx) => {
        await assertWorkflowEnabled(tx, context.organizationId);
        const current = await tx.fixedAsset.findFirst({
          where: { id, organizationId: context.organizationId }
        });
        if (!current || current.version !== version || !transition.from.includes(current.status)) {
          throw new AppError(
            "FIXED_ASSET_TRANSITION_INVALID",
            "Fixed asset changed or cannot perform that action.",
            409
          );
        }
        if (action === "submit" || action === "register") {
          await validateAccountMappings(tx, context.organizationId, mappingsFromAsset(current));
          calculateFromAsset(current);
        }
        if (action === "register" && current.ledgerTreatment === "UNDECIDED")
          throw new AppError(
            "FIXED_ASSET_LEDGER_TREATMENT_REQUIRED",
            "Choose how the acquisition is represented in the ledger before registration.",
            422
          );

        const now = new Date();
        const changed = await tx.fixedAsset.updateMany({
          where: {
            id,
            organizationId: context.organizationId,
            status: { in: transition.from },
            version
          },
          data: {
            status: transition.to,
            ...(action === "submit" ? { submittedAt: now } : {}),
            ...(action === "register"
              ? {
                  registeredAt: now,
                  registeredByUserId: context.user.id,
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
                  registeredAt: null,
                  registeredByUserId: null,
                  rejectedAt: null,
                  rejectedByUserId: null,
                  cancelledAt: null,
                  cancelledByUserId: null,
                  decisionNote: reason!.trim()
                }
              : {}),
            ...(action === "cancel"
              ? {
                  cancelledAt: now,
                  cancelledByUserId: context.user.id,
                  decisionNote: reason!.trim()
                }
              : {}),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1)
          throw new AppError(
            "FIXED_ASSET_TRANSITION_INVALID",
            "Fixed asset changed or cannot perform that action.",
            409
          );
        const row = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
        await audit(tx, context, `FIXED_ASSET_${transition.to}`, "FixedAsset", id, {
          previousStatus: current.status,
          reason: reason?.trim() ?? null,
          registerOnly: transition.to === "REGISTERED",
          financialPosting: false
        });
        return {
          statusCode: 200,
          body: { fixedAsset: fixedAssetDto(row) },
          resourceId: row.id
        };
      }
    );
  }

  public async preview(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "fixed-assets:read", "FixedAsset", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.fixedAsset.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!row) throw new AppError("FIXED_ASSET_NOT_FOUND", "Fixed asset was not found.", 404);
      const calculation = calculateFromAsset(row);
      return {
        fixedAssetId: row.id,
        status: row.status,
        financialState: "NON_POSTING",
        capabilities: nonPostingCapabilities,
        accountMappingWarnings: accountMappingWarnings(row),
        calculation: depreciationCalculationDto(calculation)
      };
    });
  }
}

function calculateClassInput(input: FixedAssetClassInput) {
  const defaultBookMethod: unknown = input.defaultBookMethod;
  requiredText(input.code, "class code");
  requiredText(input.name, "class name");
  const ratio =
    input.defaultResidualRatioMicros === null || input.defaultResidualRatioMicros === undefined
      ? null
      : parseMinorUnit(input.defaultResidualRatioMicros, "defaultResidualRatioMicros");
  if (ratio !== null && (ratio < 0n || ratio > residualRatioScale))
    throw new AppError(
      "FIXED_ASSET_RESIDUAL_RATIO_INVALID",
      "Default residual ratio must be between zero and one million micros.",
      422
    );

  let defaultBookConvention: FixedAssetBookConvention | null;
  let defaultUsefulLifeMonths: number | null;
  let defaultResidualRatioMicros: bigint | null;
  if (defaultBookMethod === "NONE") {
    if (input.defaultBookConvention !== null && input.defaultBookConvention !== undefined)
      throw invalidClassDefaults("NONE classes cannot have a depreciation convention.");
    if (input.defaultUsefulLifeMonths !== null && input.defaultUsefulLifeMonths !== undefined)
      throw invalidClassDefaults("NONE classes cannot have a useful life.");
    if (ratio !== null)
      throw invalidClassDefaults("NONE classes cannot have a default residual ratio.");
    defaultBookConvention = null;
    defaultUsefulLifeMonths = null;
    defaultResidualRatioMicros = null;
  } else if (defaultBookMethod === "STRAIGHT_LINE") {
    if (
      input.defaultBookConvention !== "FULL_MONTH" &&
      input.defaultBookConvention !== "NEXT_MONTH"
    )
      throw invalidClassDefaults("Straight-line classes require a supported convention.");
    assertUsefulLife(input.defaultUsefulLifeMonths, "defaultUsefulLifeMonths");
    defaultBookConvention = input.defaultBookConvention;
    defaultUsefulLifeMonths = input.defaultUsefulLifeMonths;
    defaultResidualRatioMicros = ratio;
  } else {
    throw invalidClassDefaults("Fixed-asset class method is not supported.");
  }

  return {
    defaultBookConvention,
    defaultUsefulLifeMonths,
    defaultResidualRatioMicros,
    mappings: classMappings(input)
  };
}

function calculateCreationValues(
  input: FixedAssetCreateInput,
  assetClass: FixedAssetClass
): CalculatedAssetValues {
  const acquisitionCostMinor = parseMinorUnit(input.acquisitionCostMinor, "acquisitionCostMinor");
  const openingAccumulatedDepreciationMinor = parseMinorUnit(
    input.openingAccumulatedDepreciationMinor ?? "0",
    "openingAccumulatedDepreciationMinor"
  );
  const bookMethod = input.bookMethod ?? assetClass.defaultBookMethod;
  const bookConvention =
    input.bookConvention === undefined ? assetClass.defaultBookConvention : input.bookConvention;
  const usefulLifeMonths =
    input.usefulLifeMonths === undefined
      ? assetClass.defaultUsefulLifeMonths
      : input.usefulLifeMonths;

  let residualValueMinor: bigint;
  let residualRatioMicrosSnapshot: bigint | null;
  if (input.residualValueMinor !== null && input.residualValueMinor !== undefined) {
    residualValueMinor = parseMinorUnit(input.residualValueMinor, "residualValueMinor");
    residualRatioMicrosSnapshot = null;
  } else if (bookMethod === "NONE") {
    residualValueMinor = acquisitionCostMinor - openingAccumulatedDepreciationMinor;
    residualRatioMicrosSnapshot = null;
  } else {
    const ratio = assetClass.defaultResidualRatioMicros ?? 0n;
    residualValueMinor = roundRatioHalfUp(acquisitionCostMinor * ratio, residualRatioScale);
    residualRatioMicrosSnapshot = ratio;
  }

  return calculateAssetValues({
    acquiredOn: input.acquiredOn,
    inServiceOn: input.inServiceOn,
    acquisitionCostMinor,
    residualValueMinor,
    residualRatioMicrosSnapshot,
    openingAccumulatedDepreciationMinor,
    openingBalanceDate: input.openingBalanceDate ?? null,
    remainingUsefulLifeMonths: input.remainingUsefulLifeMonths ?? null,
    bookMethod,
    bookConvention,
    usefulLifeMonths
  });
}

function calculatePatchedValues(
  input: FixedAssetPatchInput,
  current: FixedAsset
): CalculatedAssetValues {
  return calculateAssetValues({
    acquiredOn: input.acquiredOn ?? serializeDate(current.acquiredOn),
    inServiceOn: input.inServiceOn ?? serializeDate(current.inServiceOn),
    acquisitionCostMinor:
      input.acquisitionCostMinor === undefined
        ? current.acquisitionCostMinor
        : parseMinorUnit(input.acquisitionCostMinor, "acquisitionCostMinor"),
    residualValueMinor:
      input.residualValueMinor === undefined
        ? current.residualValueMinor
        : parseMinorUnit(input.residualValueMinor, "residualValueMinor"),
    residualRatioMicrosSnapshot:
      input.residualValueMinor === undefined ? current.residualRatioMicrosSnapshot : null,
    openingAccumulatedDepreciationMinor:
      input.openingAccumulatedDepreciationMinor === undefined
        ? current.openingAccumulatedDepreciationMinor
        : parseMinorUnit(
            input.openingAccumulatedDepreciationMinor,
            "openingAccumulatedDepreciationMinor"
          ),
    openingBalanceDate:
      input.openingBalanceDate === undefined
        ? current.openingBalanceDate
          ? serializeDate(current.openingBalanceDate).slice(0, 10)
          : null
        : input.openingBalanceDate,
    remainingUsefulLifeMonths:
      input.remainingUsefulLifeMonths === undefined
        ? current.remainingUsefulLifeMonths
        : input.remainingUsefulLifeMonths,
    bookMethod: input.bookMethod ?? current.bookMethod,
    bookConvention:
      input.bookConvention === undefined ? current.bookConvention : input.bookConvention,
    usefulLifeMonths:
      input.usefulLifeMonths === undefined ? current.usefulLifeMonths : input.usefulLifeMonths
  });
}

function calculateAssetValues(input: {
  readonly acquiredOn: string;
  readonly inServiceOn: string;
  readonly acquisitionCostMinor: bigint;
  readonly residualValueMinor: bigint;
  readonly residualRatioMicrosSnapshot: bigint | null;
  readonly openingAccumulatedDepreciationMinor: bigint;
  readonly openingBalanceDate: string | null;
  readonly remainingUsefulLifeMonths: number | null;
  readonly bookMethod: FixedAssetBookMethod;
  readonly bookConvention: FixedAssetBookConvention | null;
  readonly usefulLifeMonths: number | null;
}): CalculatedAssetValues {
  const acquiredOn = parseDate(input.acquiredOn, "acquiredOn");
  const inServiceOn = parseDate(input.inServiceOn, "inServiceOn");
  if (acquiredOn > inServiceOn)
    throw new AppError(
      "FIXED_ASSET_DATE_INVALID",
      "Acquisition date cannot follow the in-service date.",
      422
    );

  const calculation = calculateBookDepreciation(
    calculationInput({
      ...input,
      inServiceOn: serializeDate(inServiceOn).slice(0, 10)
    })
  );
  return {
    acquiredOn,
    inServiceOn,
    acquisitionCostMinor: input.acquisitionCostMinor,
    residualValueMinor: input.residualValueMinor,
    residualRatioMicrosSnapshot: input.residualRatioMicrosSnapshot,
    openingAccumulatedDepreciationMinor: input.openingAccumulatedDepreciationMinor,
    openingBalanceDate: input.openingBalanceDate
      ? parseDate(input.openingBalanceDate, "openingBalanceDate")
      : null,
    remainingUsefulLifeMonths: input.remainingUsefulLifeMonths,
    bookMethod: input.bookMethod,
    bookConvention: input.bookConvention,
    usefulLifeMonths: input.usefulLifeMonths,
    calculation
  };
}

function calculationInput(input: {
  readonly acquisitionCostMinor: bigint;
  readonly residualValueMinor: bigint;
  readonly openingAccumulatedDepreciationMinor: bigint;
  readonly inServiceOn: string;
  readonly openingBalanceDate: string | null;
  readonly remainingUsefulLifeMonths: number | null;
  readonly bookMethod: FixedAssetBookMethod;
  readonly bookConvention: FixedAssetBookConvention | null;
  readonly usefulLifeMonths: number | null;
}): BookDepreciationInput {
  if (input.bookMethod === "NONE") {
    return {
      method: "NONE",
      costMinor: input.acquisitionCostMinor,
      residualValueMinor: input.residualValueMinor,
      openingAccumulatedDepreciationMinor: input.openingAccumulatedDepreciationMinor,
      inServiceDate: input.inServiceOn
    };
  }
  if (input.bookConvention === null || input.usefulLifeMonths === null)
    throw new AppError(
      "FIXED_ASSET_DEPRECIATION_CONFIGURATION_INVALID",
      "Straight-line assets require a convention and useful life.",
      422
    );
  return {
    method: "STRAIGHT_LINE",
    convention: input.bookConvention,
    usefulLifeMonths: input.usefulLifeMonths,
    costMinor: input.acquisitionCostMinor,
    residualValueMinor: input.residualValueMinor,
    openingAccumulatedDepreciationMinor: input.openingAccumulatedDepreciationMinor,
    inServiceDate: input.inServiceOn,
    openingBalanceDate: input.openingBalanceDate,
    remainingUsefulLifeMonths: input.remainingUsefulLifeMonths
  };
}

function calculateFromAsset(asset: FixedAsset): BookDepreciationCalculation {
  return calculateBookDepreciation(
    calculationInput({
      acquisitionCostMinor: asset.acquisitionCostMinor,
      residualValueMinor: asset.residualValueMinor,
      openingAccumulatedDepreciationMinor: asset.openingAccumulatedDepreciationMinor,
      inServiceOn: serializeDate(asset.inServiceOn).slice(0, 10),
      openingBalanceDate: asset.openingBalanceDate
        ? serializeDate(asset.openingBalanceDate).slice(0, 10)
        : null,
      remainingUsefulLifeMonths: asset.remainingUsefulLifeMonths,
      bookMethod: asset.bookMethod,
      bookConvention: asset.bookConvention,
      usefulLifeMonths: asset.usefulLifeMonths
    })
  );
}

function creationMappings(
  input: FixedAssetCreateInput,
  assetClass: FixedAssetClass
): AccountMappings {
  return {
    assetAccountId:
      input.assetAccountId === undefined ? assetClass.defaultAssetAccountId : input.assetAccountId,
    accumulatedDepreciationAccountId:
      input.accumulatedDepreciationAccountId === undefined
        ? assetClass.defaultAccumulatedAccountId
        : input.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId:
      input.depreciationExpenseAccountId === undefined
        ? assetClass.defaultDepreciationExpenseId
        : input.depreciationExpenseAccountId,
    disposalGainAccountId:
      input.disposalGainAccountId === undefined
        ? assetClass.defaultDisposalGainAccountId
        : input.disposalGainAccountId,
    disposalLossAccountId:
      input.disposalLossAccountId === undefined
        ? assetClass.defaultDisposalLossAccountId
        : input.disposalLossAccountId
  };
}

function patchMappings(input: FixedAssetPatchInput, asset: FixedAsset): AccountMappings {
  return {
    assetAccountId:
      input.assetAccountId === undefined ? asset.assetAccountId : input.assetAccountId,
    accumulatedDepreciationAccountId:
      input.accumulatedDepreciationAccountId === undefined
        ? asset.accumulatedDepreciationAccountId
        : input.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId:
      input.depreciationExpenseAccountId === undefined
        ? asset.depreciationExpenseAccountId
        : input.depreciationExpenseAccountId,
    disposalGainAccountId:
      input.disposalGainAccountId === undefined
        ? asset.disposalGainAccountId
        : input.disposalGainAccountId,
    disposalLossAccountId:
      input.disposalLossAccountId === undefined
        ? asset.disposalLossAccountId
        : input.disposalLossAccountId
  };
}

function classMappings(input: FixedAssetClassInput): AccountMappings {
  return {
    assetAccountId: input.defaultAssetAccountId ?? null,
    accumulatedDepreciationAccountId: input.defaultAccumulatedAccountId ?? null,
    depreciationExpenseAccountId: input.defaultDepreciationExpenseId ?? null,
    disposalGainAccountId: input.defaultDisposalGainAccountId ?? null,
    disposalLossAccountId: input.defaultDisposalLossAccountId ?? null
  };
}

function mappingsFromAsset(asset: FixedAsset): AccountMappings {
  return {
    assetAccountId: asset.assetAccountId,
    accumulatedDepreciationAccountId: asset.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: asset.depreciationExpenseAccountId,
    disposalGainAccountId: asset.disposalGainAccountId,
    disposalLossAccountId: asset.disposalLossAccountId
  };
}

async function validateAccountMappings(
  tx: Prisma.TransactionClient,
  organizationId: string,
  mappings: AccountMappings
) {
  const requirements = [
    {
      id: mappings.assetAccountId,
      field: "assetAccountId",
      types: ["ASSET"]
    },
    {
      id: mappings.accumulatedDepreciationAccountId,
      field: "accumulatedDepreciationAccountId",
      types: ["CONTRA_ASSET"]
    },
    {
      id: mappings.depreciationExpenseAccountId,
      field: "depreciationExpenseAccountId",
      types: ["EXPENSE"]
    },
    {
      id: mappings.disposalGainAccountId,
      field: "disposalGainAccountId",
      types: ["REVENUE"]
    },
    {
      id: mappings.disposalLossAccountId,
      field: "disposalLossAccountId",
      types: ["EXPENSE"]
    }
  ] as const;
  const ids = [
    ...new Set(requirements.flatMap((requirement) => (requirement.id ? [requirement.id] : [])))
  ];
  if (!ids.length) return;
  const accounts = await tx.account.findMany({
    where: {
      organizationId,
      id: { in: ids },
      isArchived: false
    },
    select: { id: true, type: true }
  });
  const byId = new Map(accounts.map((account) => [account.id, account.type]));
  for (const requirement of requirements) {
    if (!requirement.id) continue;
    const type = byId.get(requirement.id);
    if (!type || !requirement.types.includes(type as never))
      throw new AppError(
        "FIXED_ASSET_ACCOUNT_MAPPING_INVALID",
        `${requirement.field} must reference an active ${requirement.types.join(" or ")} account in this organization.`,
        422
      );
  }
}

async function assertWorkflowEnabled(tx: Prisma.TransactionClient, organizationId: string) {
  const preferences = await tx.workflowPreferences.findUnique({
    where: { organizationId }
  });
  if (!preferences?.fixedAssetRegisterEnabled)
    throw new AppError(
      "FIXED_ASSET_REGISTER_DISABLED",
      "Enable the fixed-asset register in Company settings first.",
      409
    );
}

function fixedAssetTransition(action: FixedAssetAction): {
  readonly from: FixedAssetStatus[];
  readonly to: FixedAssetStatus;
} {
  switch (action) {
    case "submit":
      return { from: ["DRAFT"], to: "SUBMITTED" };
    case "register":
      return { from: ["SUBMITTED"], to: "REGISTERED" };
    case "reject":
      return { from: ["SUBMITTED"], to: "REJECTED" };
    case "revise":
      return { from: ["REJECTED"], to: "DRAFT" };
    case "cancel":
      return { from: ["DRAFT", "SUBMITTED", "REJECTED"], to: "CANCELLED" };
  }
}

function fixedAssetClassDto(row: FixedAssetClass) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isArchived: row.isArchived,
    defaultBookMethod: row.defaultBookMethod,
    defaultBookConvention: row.defaultBookConvention,
    defaultUsefulLifeMonths: row.defaultUsefulLifeMonths,
    defaultResidualRatioMicros: row.defaultResidualRatioMicros?.toString() ?? null,
    defaultAssetAccountId: row.defaultAssetAccountId,
    defaultAccumulatedAccountId: row.defaultAccumulatedAccountId,
    defaultDepreciationExpenseId: row.defaultDepreciationExpenseId,
    defaultDisposalGainAccountId: row.defaultDisposalGainAccountId,
    defaultDisposalLossAccountId: row.defaultDisposalLossAccountId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    financialState: "NON_POSTING",
    capabilities: nonPostingCapabilities
  };
}

function fixedAssetDto(row: FixedAsset) {
  return {
    id: row.id,
    fixedAssetClassId: row.fixedAssetClassId,
    classVersionSnapshot: row.classVersionSnapshot,
    assetNumber: row.assetNumber,
    name: row.name,
    description: row.description,
    status: row.status,
    acquiredOn: serializeDate(row.acquiredOn),
    inServiceOn: serializeDate(row.inServiceOn),
    currency: row.currency,
    acquisitionCostMinor: row.acquisitionCostMinor.toString(),
    residualValueMinor: row.residualValueMinor.toString(),
    residualRatioMicrosSnapshot: row.residualRatioMicrosSnapshot?.toString() ?? null,
    openingAccumulatedDepreciationMinor: row.openingAccumulatedDepreciationMinor.toString(),
    openingBalanceDate: row.openingBalanceDate ? serializeDate(row.openingBalanceDate) : null,
    remainingUsefulLifeMonths: row.remainingUsefulLifeMonths,
    bookMethod: row.bookMethod,
    bookConvention: row.bookConvention,
    usefulLifeMonths: row.usefulLifeMonths,
    ledgerTreatment: row.ledgerTreatment,
    sourceKind: row.sourceKind,
    sourceReference: row.sourceReference,
    assetAccountId: row.assetAccountId,
    accumulatedDepreciationAccountId: row.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: row.depreciationExpenseAccountId,
    disposalGainAccountId: row.disposalGainAccountId,
    disposalLossAccountId: row.disposalLossAccountId,
    serialNumber: row.serialNumber,
    location: row.location,
    notes: row.notes,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    registeredAt: row.registeredAt?.toISOString() ?? null,
    registeredByUserId: row.registeredByUserId,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectedByUserId: row.rejectedByUserId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByUserId: row.cancelledByUserId,
    decisionNote: row.decisionNote,
    version: row.version,
    financialState: "NON_POSTING",
    capabilities: nonPostingCapabilities
  };
}

function depreciationCalculationDto(calculation: BookDepreciationCalculation) {
  return {
    calculationVersion: calculation.calculationVersion,
    inputHash: calculation.inputHash,
    method: calculation.method,
    convention: calculation.convention,
    costMinor: calculation.costMinor.toString(),
    residualValueMinor: calculation.residualValueMinor.toString(),
    depreciableBasisMinor: calculation.depreciableBasisMinor.toString(),
    openingAccumulatedDepreciationMinor: calculation.openingAccumulatedDepreciationMinor.toString(),
    openingNetBookValueMinor: calculation.openingNetBookValueMinor.toString(),
    remainingDepreciableMinor: calculation.remainingDepreciableMinor.toString(),
    firstDepreciationPeriod: calculation.firstDepreciationPeriod,
    finalDepreciationPeriod: calculation.finalDepreciationPeriod,
    finalAccumulatedDepreciationMinor: calculation.finalAccumulatedDepreciationMinor.toString(),
    finalNetBookValueMinor: calculation.finalNetBookValueMinor.toString(),
    schedule: calculation.schedule.map((line) => ({
      sequence: line.sequence,
      period: line.period,
      depreciationMinor: line.depreciationMinor.toString(),
      accumulatedDepreciationMinor: line.accumulatedDepreciationMinor.toString(),
      netBookValueMinor: line.netBookValueMinor.toString()
    }))
  };
}

function accountMappingWarnings(asset: FixedAsset): string[] {
  const warnings: string[] = [];
  if (!asset.assetAccountId) warnings.push("ASSET_ACCOUNT_NOT_MAPPED");
  if (asset.bookMethod === "STRAIGHT_LINE" && !asset.accumulatedDepreciationAccountId)
    warnings.push("ACCUMULATED_DEPRECIATION_ACCOUNT_NOT_MAPPED");
  if (asset.bookMethod === "STRAIGHT_LINE" && !asset.depreciationExpenseAccountId)
    warnings.push("DEPRECIATION_EXPENSE_ACCOUNT_NOT_MAPPED");
  return warnings;
}

function assertManualSource(value: unknown): "MANUAL_REFERENCE" {
  if (value !== undefined && value !== "MANUAL_REFERENCE")
    throw new AppError(
      "FIXED_ASSET_SOURCE_UNSUPPORTED",
      "This register slice supports manual source references only.",
      422
    );
  return "MANUAL_REFERENCE";
}

function assertUsefulLife(value: unknown, fieldName: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximumUsefulLifeMonths
  )
    throw new AppError(
      "FIXED_ASSET_USEFUL_LIFE_INVALID",
      `${fieldName} must be a positive whole month count no greater than ${maximumUsefulLifeMonths.toString()}.`,
      422
    );
}

function requiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized)
    throw new AppError("FIXED_ASSET_TEXT_REQUIRED", `${fieldName} is required.`, 422);
  return normalized;
}

function nullableText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function invalidClassDefaults(message: string): AppError {
  return new AppError("FIXED_ASSET_CLASS_DEFAULTS_INVALID", message, 422);
}

function translateClassDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new AppError(
      "FIXED_ASSET_CLASS_CODE_DUPLICATE",
      "Fixed-asset class code already exists.",
      409
    );
  throw error;
}

function translateAssetDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new AppError("FIXED_ASSET_NUMBER_DUPLICATE", "Fixed-asset number already exists.", 409);
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
