import { AppError } from "@clearledger/shared";
import { describe, expect, it } from "vitest";
import {
  bookDepreciationCalculationVersion,
  calculateBookDepreciation,
  maximumBookDepreciationMonths,
  type BookDepreciationInput
} from "./book-depreciation.js";

describe("deterministic book depreciation", () => {
  it("returns a reconciled empty schedule for a non-depreciating asset", () => {
    const result = calculateBookDepreciation({
      method: "NONE",
      costMinor: 250_000n,
      residualValueMinor: 250_000n,
      openingAccumulatedDepreciationMinor: 0n,
      inServiceDate: "2026-01-15"
    });

    expect(result).toMatchObject({
      calculationVersion: bookDepreciationCalculationVersion,
      method: "NONE",
      convention: null,
      depreciableBasisMinor: 0n,
      remainingDepreciableMinor: 0n,
      openingNetBookValueMinor: 250_000n,
      finalAccumulatedDepreciationMinor: 0n,
      finalNetBookValueMinor: 250_000n,
      firstDepreciationPeriod: null,
      finalDepreciationPeriod: null,
      schedule: []
    });
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allocates remainder cents to the earliest full-month periods", () => {
    const result = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "FULL_MONTH",
      costMinor: 100n,
      residualValueMinor: 0n,
      openingAccumulatedDepreciationMinor: 0n,
      inServiceDate: "2026-01-31",
      usefulLifeMonths: 3
    });

    expect(result.schedule).toEqual([
      {
        sequence: 1,
        period: "2026-01",
        depreciationMinor: 34n,
        accumulatedDepreciationMinor: 34n,
        netBookValueMinor: 66n
      },
      {
        sequence: 2,
        period: "2026-02",
        depreciationMinor: 33n,
        accumulatedDepreciationMinor: 67n,
        netBookValueMinor: 33n
      },
      {
        sequence: 3,
        period: "2026-03",
        depreciationMinor: 33n,
        accumulatedDepreciationMinor: 100n,
        netBookValueMinor: 0n
      }
    ]);
    expect(result.firstDepreciationPeriod).toBe("2026-01");
    expect(result.finalDepreciationPeriod).toBe("2026-03");
    expect(result.finalNetBookValueMinor).toBe(result.residualValueMinor);
  });

  it("starts next-month convention in the following calendar month across year end", () => {
    const result = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "NEXT_MONTH",
      costMinor: 1_203n,
      residualValueMinor: 3n,
      openingAccumulatedDepreciationMinor: 0n,
      inServiceDate: "2026-12-01",
      usefulLifeMonths: 3
    });

    expect(result.schedule.map((line) => line.period)).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(result.schedule.map((line) => line.depreciationMinor)).toEqual([400n, 400n, 400n]);
    expect(result.finalNetBookValueMinor).toBe(3n);
  });

  it("allocates only the remaining basis after an imported opening balance", () => {
    const result = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "FULL_MONTH",
      costMinor: 10_000n,
      residualValueMinor: 1_000n,
      openingAccumulatedDepreciationMinor: 3_005n,
      inServiceDate: "2024-01-10",
      usefulLifeMonths: 12,
      openingBalanceDate: "2026-06-30",
      remainingUsefulLifeMonths: 4
    });

    expect(result.openingNetBookValueMinor).toBe(6_995n);
    expect(result.remainingDepreciableMinor).toBe(5_995n);
    expect(result.schedule.map((line) => line.period)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10"
    ]);
    expect(result.schedule.map((line) => line.depreciationMinor)).toEqual([
      1_499n,
      1_499n,
      1_499n,
      1_498n
    ]);
    expect(result.finalAccumulatedDepreciationMinor).toBe(9_000n);
    expect(result.finalNetBookValueMinor).toBe(1_000n);
  });

  it("returns no future periods for an asset already at residual value", () => {
    const result = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "NEXT_MONTH",
      costMinor: 1_000n,
      residualValueMinor: 100n,
      openingAccumulatedDepreciationMinor: 900n,
      inServiceDate: "2020-01-01",
      usefulLifeMonths: 60,
      openingBalanceDate: "2026-06-30",
      remainingUsefulLifeMonths: 1
    });

    expect(result.remainingDepreciableMinor).toBe(0n);
    expect(result.schedule).toEqual([]);
    expect(result.finalAccumulatedDepreciationMinor).toBe(900n);
    expect(result.finalNetBookValueMinor).toBe(100n);
  });

  it("keeps zero-value trailing months while placing all remainder cents first", () => {
    const result = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "FULL_MONTH",
      costMinor: 3n,
      residualValueMinor: 0n,
      openingAccumulatedDepreciationMinor: 0n,
      inServiceDate: "2026-01-01",
      usefulLifeMonths: 5
    });

    expect(result.schedule.map((line) => line.depreciationMinor)).toEqual([1n, 1n, 1n, 0n, 0n]);
    expect(result.schedule.at(-1)).toMatchObject({
      accumulatedDepreciationMinor: 3n,
      netBookValueMinor: 0n
    });
  });

  it("produces a stable hash for normalized inputs and changes it with calculation inputs", () => {
    const omittedOptionals = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "FULL_MONTH",
      costMinor: 12_000n,
      residualValueMinor: 0n,
      openingAccumulatedDepreciationMinor: 0n,
      inServiceDate: "2024-02-29",
      usefulLifeMonths: 12
    });
    const explicitNulls = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "FULL_MONTH",
      costMinor: 12_000n,
      residualValueMinor: 0n,
      openingAccumulatedDepreciationMinor: 0n,
      inServiceDate: "2024-02-29",
      usefulLifeMonths: 12,
      openingBalanceDate: null,
      remainingUsefulLifeMonths: null
    });
    const changedConvention = calculateBookDepreciation({
      method: "STRAIGHT_LINE",
      convention: "NEXT_MONTH",
      costMinor: 12_000n,
      residualValueMinor: 0n,
      openingAccumulatedDepreciationMinor: 0n,
      inServiceDate: "2024-02-29",
      usefulLifeMonths: 12
    });

    expect(omittedOptionals.inputHash).toBe(explicitNulls.inputHash);
    expect(omittedOptionals.inputHash).toBe(
      "6c0ca1dc54fb3cfddd316fd610cc068fe66ad9db33f899d93579854c6b799542"
    );
    expect(omittedOptionals.inputHash).not.toBe(changedConvention.inputHash);
    expect(omittedOptionals.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reconciles generated straight-line schedules exactly without floating point", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const usefulLifeMonths = (seed % 36) + 1;
      const costMinor = BigInt(seed * 101 + 1);
      const residualValueMinor = BigInt(seed % 17);
      const result = calculateBookDepreciation({
        method: "STRAIGHT_LINE",
        convention: seed % 2 === 0 ? "FULL_MONTH" : "NEXT_MONTH",
        costMinor,
        residualValueMinor,
        openingAccumulatedDepreciationMinor: 0n,
        inServiceDate: "2026-01-15",
        usefulLifeMonths
      });

      const allocated = result.schedule.reduce((total, line) => total + line.depreciationMinor, 0n);
      expect(allocated).toBe(costMinor - residualValueMinor);
      expect(result.finalNetBookValueMinor).toBe(residualValueMinor);
      expect(result.finalAccumulatedDepreciationMinor).toBe(costMinor - residualValueMinor);
      for (let index = 1; index < result.schedule.length; index += 1) {
        expect(result.schedule[index - 1]!.depreciationMinor).toBeGreaterThanOrEqual(
          result.schedule[index]!.depreciationMinor
        );
      }
    }
  });

  it("rejects invalid monetary values and non-BigInt money", () => {
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 0n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 0n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: 12
        }),
      "BOOK_DEPRECIATION_COST_INVALID"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100n,
          residualValueMinor: 101n,
          openingAccumulatedDepreciationMinor: 0n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: 12
        }),
      "BOOK_DEPRECIATION_RESIDUAL_INVALID"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100n,
          residualValueMinor: 25n,
          openingAccumulatedDepreciationMinor: 76n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: 12,
          openingBalanceDate: "2026-01-31",
          remainingUsefulLifeMonths: 1
        }),
      "BOOK_DEPRECIATION_OPENING_ACCUMULATED_INVALID"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 0n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: 12
        } as unknown as BookDepreciationInput),
      "BOOK_DEPRECIATION_VALUE_INVALID"
    );
  });

  it("rejects invalid dates, lives, opening schedules, and calendar overflow", () => {
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 0n,
          inServiceDate: "2023-02-29",
          usefulLifeMonths: 12
        }),
      "BOOK_DEPRECIATION_DATE_INVALID"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 0n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: maximumBookDepreciationMonths + 1
        }),
      "BOOK_DEPRECIATION_LIFE_INVALID"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 10n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: 12
        }),
      "BOOK_DEPRECIATION_OPENING_SCHEDULE_REQUIRED"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 10n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: 12,
          openingBalanceDate: "2025-12-31",
          remainingUsefulLifeMonths: 11
        }),
      "BOOK_DEPRECIATION_OPENING_DATE_INVALID"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "FULL_MONTH",
          costMinor: 100n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 10n,
          inServiceDate: "2026-01-01",
          usefulLifeMonths: 12,
          openingBalanceDate: "2026-01-31",
          remainingUsefulLifeMonths: 13
        }),
      "BOOK_DEPRECIATION_REMAINING_LIFE_INVALID"
    );
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "STRAIGHT_LINE",
          convention: "NEXT_MONTH",
          costMinor: 100n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 0n,
          inServiceDate: "9999-12-31",
          usefulLifeMonths: 1
        }),
      "BOOK_DEPRECIATION_PERIOD_OUT_OF_RANGE"
    );
  });

  it("rejects NONE when carrying value has not already reached residual value", () => {
    expectErrorCode(
      () =>
        calculateBookDepreciation({
          method: "NONE",
          costMinor: 1_000n,
          residualValueMinor: 0n,
          openingAccumulatedDepreciationMinor: 0n,
          inServiceDate: "2026-01-01"
        }),
      "BOOK_DEPRECIATION_NONE_BALANCE_INVALID"
    );
  });
});

function expectErrorCode(work: () => unknown, code: string): void {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}
