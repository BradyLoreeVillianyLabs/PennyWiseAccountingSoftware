import {
  allocateMinorUnits,
  parseDecimalMillionths,
  roundRatioHalfUp
} from "@clearledger/accounting-core";
import { Prisma } from "@clearledger/db";
import { AppError } from "@clearledger/shared";

const rateScale = 1_000_000n;

export type TaxTransactionPurpose = "SALE" | "PURCHASE" | "REFUND" | "CREDIT" | "ADJUSTMENT";

export interface TaxCalculationRequest {
  readonly organizationId: string;
  readonly taxDate: Date;
  readonly taxCodeId: string | null;
  readonly amountMinor: bigint;
  readonly purpose: TaxTransactionPurpose;
  readonly jurisdiction?: string | null | undefined;
  readonly currency?: string | undefined;
  readonly documentId?: string | null | undefined;
  readonly lineId?: string | null | undefined;
}

export interface CentralTaxComponentCalculation {
  readonly name: string;
  readonly jurisdiction: string;
  readonly rate: string;
  readonly payableAccountId: string | null;
  readonly recoverablePercent: string;
  readonly recoverableAccountId: string | null;
  readonly totalMinor: bigint;
  readonly recoverableMinor: bigint;
  readonly nonRecoverableMinor: bigint;
}

export interface CentralTaxCalculation {
  readonly calculationMode: "EXCLUSIVE" | "INCLUSIVE";
  readonly taxableBaseMinor: bigint;
  readonly taxTotalMinor: bigint;
  readonly recoverableTaxMinor: bigint;
  readonly nonRecoverableTaxMinor: bigint;
  readonly roundingAdjustmentMinor: bigint;
  readonly taxCodeVersionId: string | null;
  readonly snapshot: Prisma.InputJsonObject | null;
  readonly components: readonly CentralTaxComponentCalculation[];
}

export interface TaxAdjustmentAllocationRequest {
  readonly sourceNetMinor: bigint;
  readonly sourceTaxTotalMinor: bigint;
  readonly sourceRecoverableTaxMinor: bigint;
  readonly sourceTotalMinor: bigint;
  readonly allocationTotalMinor: bigint;
  readonly purpose: "CREDIT" | "REFUND" | "ADJUSTMENT";
  readonly sourceSnapshot: Prisma.JsonValue | Prisma.InputJsonValue | null;
}

export interface TaxAdjustmentAllocation {
  readonly netMinor: bigint;
  readonly taxTotalMinor: bigint;
  readonly recoverableTaxMinor: bigint;
  readonly nonRecoverableTaxMinor: bigint;
  readonly snapshot: Prisma.InputJsonValue | null;
}

/**
 * The single native tax-calculation boundary for transaction workflows.
 *
 * This service resolves one effective-dated tax-code version, performs exact
 * integer rounding, and returns an immutable evidence snapshot. Provider-backed
 * tax engines can implement this contract later without changing invoice, bill,
 * expense, banking, or commerce callers.
 */
export async function calculateTax(
  tx: Prisma.TransactionClient,
  request: TaxCalculationRequest
): Promise<CentralTaxCalculation> {
  if (!(request.taxDate instanceof Date) || Number.isNaN(request.taxDate.getTime()))
    throw new AppError("TAX_DATE_INVALID", "Tax date must be a valid calendar date.", 422);
  if (!request.taxCodeId) return zeroTax(request.amountMinor);

  const taxCode = await tx.taxCode.findFirst({
    where: {
      id: request.taxCodeId,
      organizationId: request.organizationId,
      active: true
    },
    include: {
      versions: {
        where: {
          effectiveFrom: { lte: request.taxDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: request.taxDate } }]
        },
        orderBy: { version: "desc" },
        take: 1,
        include: {
          // Component allocation can absorb an inclusive-rounding residue. A
          // stable order makes that evidence deterministic across query plans.
          components: { orderBy: [{ jurisdiction: "asc" }, { name: "asc" }, { id: "asc" }] }
        }
      }
    }
  });
  if (!taxCode) throw new AppError("TAX_CODE_NOT_FOUND", "Active tax code was not found.", 422);
  const version = taxCode.versions[0];
  if (!version)
    throw new AppError(
      "TAX_CODE_NOT_EFFECTIVE",
      "Tax code has no effective version for the transaction date.",
      422
    );

  const requestedJurisdiction = request.jurisdiction?.trim().toUpperCase() || null;
  if (
    requestedJurisdiction &&
    !version.components.some(
      (component) => component.jurisdiction.trim().toUpperCase() === requestedJurisdiction
    )
  )
    throw new AppError(
      "TAX_JURISDICTION_MISMATCH",
      "The selected tax code has no component for the requested jurisdiction.",
      422
    );

  const isTaxable = version.treatment === "STANDARD";
  const rates = version.components.map((component) =>
    parseDecimalMillionths(component.rate.toFixed(6), "tax rate")
  );
  const totalRate = isTaxable ? rates.reduce((sum, rate) => sum + rate, 0n) : 0n;
  const taxableBaseMinor =
    version.calculationMode === "INCLUSIVE" && totalRate > 0n
      ? roundRatioHalfUp(request.amountMinor * rateScale, rateScale + totalRate)
      : request.amountMinor;
  const initiallyRounded = version.components.map((_component, index) =>
    isTaxable ? roundRatioHalfUp(taxableBaseMinor * rates[index]!, rateScale) : 0n
  );
  const initiallyRoundedTotal = initiallyRounded.reduce((sum, amount) => sum + amount, 0n);
  const taxTotalMinor =
    isTaxable && version.calculationMode === "INCLUSIVE"
      ? request.amountMinor - taxableBaseMinor
      : isTaxable
        ? initiallyRoundedTotal
        : 0n;
  const roundingAdjustmentMinor = taxTotalMinor - initiallyRoundedTotal;
  if (version.calculationMode === "INCLUSIVE" && initiallyRounded.length > 0) {
    const last = initiallyRounded.length - 1;
    initiallyRounded[last] = initiallyRounded[last]! + roundingAdjustmentMinor;
  }

  const components = version.components.map((component, index) => {
    const totalMinor = initiallyRounded[index]!;
    const recoverableRate =
      request.purpose === "PURCHASE"
        ? parseDecimalMillionths(component.recoverablePercent.toFixed(6), "recoverablePercent")
        : 0n;
    const recoverableMinor = roundRatioHalfUp(totalMinor * recoverableRate, rateScale);
    if (recoverableMinor > 0n && !component.recoverableAccountId)
      throw new AppError(
        "RECOVERABLE_TAX_ACCOUNT_REQUIRED",
        "Recoverable tax requires a configured asset account.",
        422
      );
    return {
      name: component.name,
      jurisdiction: component.jurisdiction,
      rate: component.rate.toFixed(6),
      payableAccountId: component.payableAccountId,
      recoverablePercent: component.recoverablePercent.toFixed(6),
      recoverableAccountId: component.recoverableAccountId,
      totalMinor,
      recoverableMinor,
      nonRecoverableMinor: totalMinor - recoverableMinor
    } satisfies CentralTaxComponentCalculation;
  });

  if (request.purpose === "PURCHASE")
    await assertRecoverableAccounts(tx, request.organizationId, components);
  if (request.purpose === "SALE" && taxTotalMinor !== 0n)
    await assertPayableAccounts(tx, request.organizationId, components);

  const recoverableTaxMinor = components.reduce(
    (sum, component) => sum + component.recoverableMinor,
    0n
  );
  const nonRecoverableTaxMinor = taxTotalMinor - recoverableTaxMinor;
  return {
    calculationMode: version.calculationMode,
    taxableBaseMinor,
    taxTotalMinor,
    recoverableTaxMinor,
    nonRecoverableTaxMinor,
    roundingAdjustmentMinor,
    taxCodeVersionId: version.id,
    snapshot: {
      engine: "CLEARLEDGER_NATIVE",
      engineVersion: "1",
      authority: "CONFIGURED_EFFECTIVE_RATE",
      purpose: request.purpose,
      jurisdiction: requestedJurisdiction,
      currency: request.currency?.trim().toUpperCase() ?? null,
      documentId: request.documentId ?? null,
      lineId: request.lineId ?? null,
      code: taxCode.code,
      name: taxCode.name,
      treatment: version.treatment,
      calculationMode: version.calculationMode,
      version: version.version.toString(),
      effectiveFrom: version.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: version.effectiveTo?.toISOString().slice(0, 10) ?? null,
      source: {
        name: version.sourceName,
        url: version.sourceUrl,
        retrievedAt: version.sourceRetrievedAt.toISOString()
      },
      taxableBaseMinor: taxableBaseMinor.toString(),
      taxTotalMinor: taxTotalMinor.toString(),
      recoverableTaxMinor: recoverableTaxMinor.toString(),
      nonRecoverableTaxMinor: nonRecoverableTaxMinor.toString(),
      roundingAdjustmentMinor: roundingAdjustmentMinor.toString(),
      components: components.map((component) => ({
        name: component.name,
        jurisdiction: component.jurisdiction,
        rate: component.rate,
        payableAccountId: component.payableAccountId,
        recoverablePercent: component.recoverablePercent,
        recoverableAccountId: component.recoverableAccountId,
        amountMinor: component.totalMinor.toString(),
        totalMinor: component.totalMinor.toString(),
        recoverableMinor: component.recoverableMinor.toString(),
        nonRecoverableMinor: component.nonRecoverableMinor.toString()
      }))
    },
    components
  };
}

/**
 * Central exact allocation boundary for credits, refunds, and adjustments that
 * must preserve an original effective-dated tax decision instead of recalculating
 * the transaction using today's configuration.
 */
export function allocateTaxAdjustment(
  request: TaxAdjustmentAllocationRequest
): TaxAdjustmentAllocation {
  if (
    request.sourceTotalMinor <= 0n ||
    request.allocationTotalMinor <= 0n ||
    request.allocationTotalMinor > request.sourceTotalMinor ||
    request.sourceNetMinor < 0n ||
    request.sourceTaxTotalMinor < 0n ||
    request.sourceNetMinor + request.sourceTaxTotalMinor !== request.sourceTotalMinor ||
    request.sourceRecoverableTaxMinor < 0n ||
    request.sourceRecoverableTaxMinor > request.sourceTaxTotalMinor
  )
    throw new AppError(
      "TAX_ADJUSTMENT_SOURCE_INVALID",
      "Tax adjustment source totals are invalid.",
      422
    );

  const netMinor = roundRatioHalfUp(
    request.sourceNetMinor * request.allocationTotalMinor,
    request.sourceTotalMinor
  );
  const taxTotalMinor = request.allocationTotalMinor - netMinor;
  const recoverableTaxMinor =
    request.sourceTaxTotalMinor === 0n
      ? 0n
      : roundRatioHalfUp(
          request.sourceRecoverableTaxMinor * taxTotalMinor,
          request.sourceTaxTotalMinor
        );
  const nonRecoverableTaxMinor = taxTotalMinor - recoverableTaxMinor;
  if (recoverableTaxMinor < 0n || nonRecoverableTaxMinor < 0n)
    throw new AppError(
      "TAX_ADJUSTMENT_ALLOCATION_INVALID",
      "Tax adjustment allocation produced invalid tax totals.",
      422
    );

  return {
    netMinor,
    taxTotalMinor,
    recoverableTaxMinor,
    nonRecoverableTaxMinor,
    snapshot: adjustmentSnapshot(request, {
      netMinor,
      taxTotalMinor,
      recoverableTaxMinor,
      nonRecoverableTaxMinor
    })
  };
}

function zeroTax(amountMinor: bigint): CentralTaxCalculation {
  return {
    calculationMode: "EXCLUSIVE",
    taxableBaseMinor: amountMinor,
    taxTotalMinor: 0n,
    recoverableTaxMinor: 0n,
    nonRecoverableTaxMinor: 0n,
    roundingAdjustmentMinor: 0n,
    taxCodeVersionId: null,
    snapshot: null,
    components: []
  };
}

async function assertRecoverableAccounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  components: readonly CentralTaxComponentCalculation[]
) {
  const accountIds = [
    ...new Set(
      components
        .filter((component) => component.recoverableMinor > 0n)
        .map((component) => component.recoverableAccountId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (accountIds.length === 0) return;
  const validAccounts = await tx.account.findMany({
    where: {
      id: { in: accountIds },
      organizationId,
      type: "ASSET",
      isArchived: false
    },
    select: { id: true }
  });
  if (validAccounts.length !== accountIds.length)
    throw new AppError(
      "RECOVERABLE_TAX_ACCOUNT_INVALID",
      "Recoverable tax account must be an active organization asset account.",
      422
    );
}

async function assertPayableAccounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  components: readonly CentralTaxComponentCalculation[]
) {
  const accountIds = [
    ...new Set(
      components
        .filter((component) => component.totalMinor !== 0n)
        .map((component) => component.payableAccountId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const componentsMissingAccounts = components.some(
    (component) => component.totalMinor !== 0n && !component.payableAccountId
  );
  if (componentsMissingAccounts)
    throw new AppError(
      "TAX_PAYABLE_ACCOUNT_REQUIRED",
      "Tax payable requires a configured liability control account.",
      422
    );
  if (accountIds.length === 0) return;
  const validAccounts = await tx.account.findMany({
    where: {
      id: { in: accountIds },
      organizationId,
      type: "LIABILITY",
      isControl: true,
      isArchived: false
    },
    select: { id: true }
  });
  if (validAccounts.length !== accountIds.length)
    throw new AppError(
      "TAX_PAYABLE_ACCOUNT_INVALID",
      "Tax payable account must be an active organization liability control account.",
      422
    );
}

function adjustmentSnapshot(
  request: TaxAdjustmentAllocationRequest,
  allocated: Omit<TaxAdjustmentAllocation, "snapshot">
): Prisma.InputJsonValue | null {
  const snapshot = request.sourceSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const source = snapshot as Prisma.InputJsonObject & {
    components?: readonly Record<string, Prisma.JsonValue>[];
  };
  const components = source.components ?? [];
  const sourceTotals = components.map(componentTaxTotal);
  const sourceRecoverable = components.map(componentRecoverableTotal);
  const sourceNonRecoverable = sourceTotals.map(
    (total, index) => total - sourceRecoverable[index]!
  );
  const allocatedRecoverable = exactComponentAllocation(
    allocated.recoverableTaxMinor,
    sourceRecoverable
  );
  const allocatedNonRecoverable = exactComponentAllocation(
    allocated.nonRecoverableTaxMinor,
    sourceNonRecoverable
  );

  return {
    ...source,
    purpose: request.purpose,
    taxableBaseMinor: allocated.netMinor.toString(),
    taxTotalMinor: allocated.taxTotalMinor.toString(),
    recoverableTaxMinor: allocated.recoverableTaxMinor.toString(),
    nonRecoverableTaxMinor: allocated.nonRecoverableTaxMinor.toString(),
    allocation: {
      engine: "CLEARLEDGER_NATIVE",
      engineVersion: "1",
      method: "ORIGINAL_TAX_PROPORTIONAL",
      sourceTotalMinor: request.sourceTotalMinor.toString(),
      allocatedTotalMinor: request.allocationTotalMinor.toString()
    },
    components: components.map((component, index) => {
      const recoverableMinor = allocatedRecoverable[index] ?? 0n;
      const nonRecoverableMinor = allocatedNonRecoverable[index] ?? 0n;
      const totalMinor = recoverableMinor + nonRecoverableMinor;
      return {
        ...component,
        amountMinor: totalMinor.toString(),
        totalMinor: totalMinor.toString(),
        recoverableMinor: recoverableMinor.toString(),
        nonRecoverableMinor: nonRecoverableMinor.toString()
      };
    })
  };
}

function componentTaxTotal(component: Record<string, Prisma.JsonValue>): bigint {
  const value = component.totalMinor ?? component.amountMinor;
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function componentRecoverableTotal(component: Record<string, Prisma.JsonValue>): bigint {
  const value = component.recoverableMinor;
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function exactComponentAllocation(total: bigint, weights: readonly bigint[]): readonly bigint[] {
  if (weights.length === 0) return [];
  if (total === 0n) return weights.map(() => 0n);
  if (weights.every((weight) => weight === 0n)) {
    const fallback = weights.map(() => 0n);
    fallback[fallback.length - 1] = total;
    return fallback;
  }
  return allocateMinorUnits(
    total,
    weights.map((weight) => ({ weight }))
  );
}
