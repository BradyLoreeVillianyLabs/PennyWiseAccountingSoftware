import { AppError } from "@clearledger/shared";
import { roundRatioHalfUp } from "./money.js";

const ratioScale = 1_000_000n;

export type ProgressBillingBasis = "PERCENT_OF_ESTIMATE" | "FIXED_SUBTOTAL" | "REMAINING_BALANCE";

export interface ProgressEstimateLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly netMinor: bigint;
  readonly taxMinor: bigint;
}

export interface ProgressMilestoneInput {
  readonly name: string;
  readonly basis: ProgressBillingBasis;
  readonly ratioMicros?: bigint | null | undefined;
  readonly fixedSubtotalMinor?: bigint | null | undefined;
}

export interface ProgressMilestoneAllocation {
  readonly estimateLineId: string;
  readonly plannedNetMinor: bigint;
  readonly estimatedTaxMinor: bigint;
  readonly estimatedTotalMinor: bigint;
}

export interface CalculatedProgressMilestone {
  readonly sequence: number;
  readonly name: string;
  readonly basis: ProgressBillingBasis;
  readonly ratioMicros: bigint | null;
  readonly fixedSubtotalMinor: bigint | null;
  readonly plannedNetMinor: bigint;
  readonly estimatedTaxMinor: bigint;
  readonly estimatedTotalMinor: bigint;
  readonly allocations: readonly ProgressMilestoneAllocation[];
}

export interface CalculatedProgressPlan {
  readonly estimateNetMinor: bigint;
  readonly estimateTaxMinor: bigint;
  readonly estimateTotalMinor: bigint;
  readonly milestones: readonly CalculatedProgressMilestone[];
}

export function calculateProgressBillingPlan(
  estimateLines: readonly ProgressEstimateLine[],
  milestoneInputs: readonly ProgressMilestoneInput[]
): CalculatedProgressPlan {
  validateInputs(estimateLines, milestoneInputs);
  const orderedLines = [...estimateLines].sort(
    (left, right) => left.lineNumber - right.lineNumber || left.id.localeCompare(right.id)
  );
  const estimateNetMinor = orderedLines.reduce((sum, line) => sum + line.netMinor, 0n);
  const estimateTaxMinor = orderedLines.reduce((sum, line) => sum + line.taxMinor, 0n);
  const remaining = orderedLines.map((line) => ({
    ...line,
    remainingNetMinor: line.netMinor,
    remainingTaxMinor: line.taxMinor
  }));

  const milestones = milestoneInputs.map((input, index) => {
    const remainingNetTotal = remaining.reduce((sum, line) => sum + line.remainingNetMinor, 0n);
    const targetNetMinor =
      input.basis === "REMAINING_BALANCE"
        ? remainingNetTotal
        : input.basis === "PERCENT_OF_ESTIMATE"
          ? roundRatioHalfUp(estimateNetMinor * input.ratioMicros!, ratioScale)
          : input.fixedSubtotalMinor!;
    if (
      targetNetMinor <= 0n ||
      targetNetMinor > remainingNetTotal ||
      (input.basis !== "REMAINING_BALANCE" && targetNetMinor === remainingNetTotal)
    )
      throw new AppError(
        "PROGRESS_MILESTONE_AMOUNT_INVALID",
        "Each milestone before the final balance must leave a positive remaining amount.",
        422
      );

    const allocatedNet = allocateByLargestRemainder(
      targetNetMinor,
      remaining.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        weight: line.remainingNetMinor
      }))
    );
    const allocations: ProgressMilestoneAllocation[] = [];
    for (const line of remaining) {
      const plannedNetMinor = allocatedNet.get(line.id) ?? 0n;
      const estimatedTaxMinor =
        input.basis === "REMAINING_BALANCE"
          ? line.remainingTaxMinor
          : line.remainingNetMinor === 0n
            ? 0n
            : minBigInt(
                line.remainingTaxMinor,
                roundRatioHalfUp(line.remainingTaxMinor * plannedNetMinor, line.remainingNetMinor)
              );
      line.remainingNetMinor -= plannedNetMinor;
      line.remainingTaxMinor -= estimatedTaxMinor;
      if (plannedNetMinor > 0n || estimatedTaxMinor > 0n)
        allocations.push({
          estimateLineId: line.id,
          plannedNetMinor,
          estimatedTaxMinor,
          estimatedTotalMinor: plannedNetMinor + estimatedTaxMinor
        });
    }
    const estimatedTaxMinor = allocations.reduce(
      (sum, allocation) => sum + allocation.estimatedTaxMinor,
      0n
    );
    return {
      sequence: index + 1,
      name: input.name.trim(),
      basis: input.basis,
      ratioMicros: input.ratioMicros ?? null,
      fixedSubtotalMinor: input.fixedSubtotalMinor ?? null,
      plannedNetMinor: targetNetMinor,
      estimatedTaxMinor,
      estimatedTotalMinor: targetNetMinor + estimatedTaxMinor,
      allocations
    };
  });

  const plannedNetMinor = milestones.reduce(
    (sum, milestone) => sum + milestone.plannedNetMinor,
    0n
  );
  const plannedTaxMinor = milestones.reduce(
    (sum, milestone) => sum + milestone.estimatedTaxMinor,
    0n
  );
  if (plannedNetMinor !== estimateNetMinor || plannedTaxMinor !== estimateTaxMinor)
    throw new AppError(
      "PROGRESS_PLAN_RECONCILIATION_FAILED",
      "The progress schedule did not reconcile to the estimate.",
      500
    );
  return {
    estimateNetMinor,
    estimateTaxMinor,
    estimateTotalMinor: estimateNetMinor + estimateTaxMinor,
    milestones
  };
}

function validateInputs(
  estimateLines: readonly ProgressEstimateLine[],
  milestones: readonly ProgressMilestoneInput[]
) {
  if (!estimateLines.length)
    throw new AppError("PROGRESS_ESTIMATE_EMPTY", "The estimate has no billable lines.", 422);
  if (
    estimateLines.some(
      (line) =>
        !line.id ||
        !Number.isInteger(line.lineNumber) ||
        line.lineNumber <= 0 ||
        line.netMinor < 0n ||
        line.taxMinor < 0n
    ) ||
    estimateLines.reduce((sum, line) => sum + line.netMinor, 0n) <= 0n
  )
    throw new AppError(
      "PROGRESS_ESTIMATE_INVALID",
      "Estimate line amounts are invalid for progress billing.",
      422
    );
  if (!milestones.length)
    throw new AppError(
      "PROGRESS_MILESTONES_REQUIRED",
      "At least one progress milestone is required.",
      422
    );
  if (
    milestones.at(-1)?.basis !== "REMAINING_BALANCE" ||
    milestones.filter((item) => item.basis === "REMAINING_BALANCE").length !== 1
  )
    throw new AppError(
      "PROGRESS_FINAL_BALANCE_REQUIRED",
      "The final milestone must be the only remaining-balance milestone.",
      422
    );
  for (const milestone of milestones) {
    if (!milestone.name.trim())
      throw new AppError(
        "PROGRESS_MILESTONE_NAME_REQUIRED",
        "Every milestone requires a name.",
        422
      );
    if (
      milestone.basis === "PERCENT_OF_ESTIMATE" &&
      (!milestone.ratioMicros ||
        milestone.ratioMicros <= 0n ||
        milestone.ratioMicros > ratioScale ||
        milestone.fixedSubtotalMinor != null)
    )
      throw new AppError(
        "PROGRESS_MILESTONE_BASIS_INVALID",
        "Percentage milestones require a percentage up to 100%.",
        422
      );
    if (
      milestone.basis === "FIXED_SUBTOTAL" &&
      (!milestone.fixedSubtotalMinor ||
        milestone.fixedSubtotalMinor <= 0n ||
        milestone.ratioMicros != null)
    )
      throw new AppError(
        "PROGRESS_MILESTONE_BASIS_INVALID",
        "Fixed milestones require a positive subtotal.",
        422
      );
    if (
      milestone.basis === "REMAINING_BALANCE" &&
      (milestone.ratioMicros != null || milestone.fixedSubtotalMinor != null)
    )
      throw new AppError(
        "PROGRESS_MILESTONE_BASIS_INVALID",
        "The remaining-balance milestone cannot specify an amount or percentage.",
        422
      );
  }
}

function allocateByLargestRemainder(
  total: bigint,
  entries: readonly { id: string; lineNumber: number; weight: bigint }[]
) {
  const weightTotal = entries.reduce((sum, entry) => sum + entry.weight, 0n);
  if (weightTotal <= 0n)
    throw new AppError(
      "PROGRESS_ALLOCATION_INVALID",
      "The remaining estimate amount cannot be allocated.",
      422
    );
  const allocations = new Map<string, bigint>();
  const remainders = entries.map((entry) => {
    const numerator = total * entry.weight;
    const amount = numerator / weightTotal;
    allocations.set(entry.id, amount);
    return { ...entry, remainder: numerator % weightTotal };
  });
  let unallocated = total - [...allocations.values()].reduce((sum, amount) => sum + amount, 0n);
  remainders.sort(
    (left, right) =>
      compareBigInt(right.remainder, left.remainder) ||
      left.lineNumber - right.lineNumber ||
      left.id.localeCompare(right.id)
  );
  for (const entry of remainders) {
    if (unallocated === 0n) break;
    allocations.set(entry.id, (allocations.get(entry.id) ?? 0n) + 1n);
    unallocated -= 1n;
  }
  return allocations;
}

function compareBigInt(left: bigint, right: bigint) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}
