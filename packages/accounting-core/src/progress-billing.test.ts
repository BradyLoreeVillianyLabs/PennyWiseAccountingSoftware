import { describe, expect, it } from "vitest";
import { calculateProgressBillingPlan } from "./progress-billing.js";

describe("progress billing schedule calculation", () => {
  it("allocates percentages deterministically and leaves exact rounding to the final balance", () => {
    const result = calculateProgressBillingPlan(
      [
        { id: "line-a", lineNumber: 1, netMinor: 10_001n, taxMinor: 500n },
        { id: "line-b", lineNumber: 2, netMinor: 20_002n, taxMinor: 2_600n }
      ],
      [
        { name: "Start", basis: "PERCENT_OF_ESTIMATE", ratioMicros: 333_333n },
        { name: "Midpoint", basis: "FIXED_SUBTOTAL", fixedSubtotalMinor: 5_000n },
        { name: "Completion", basis: "REMAINING_BALANCE" }
      ]
    );

    expect(result.milestones.map((item) => item.plannedNetMinor)).toEqual([
      10_001n,
      5_000n,
      15_002n
    ]);
    expect(
      result.milestones
        .flatMap((item) => item.allocations)
        .reduce((sum, allocation) => sum + allocation.plannedNetMinor, 0n)
    ).toBe(30_003n);
    expect(result.milestones.reduce((sum, item) => sum + item.estimatedTaxMinor, 0n)).toBe(3_100n);
    expect(result.estimateTotalMinor).toBe(33_103n);
  });

  it("uses stable line order to distribute one-cent remainders", () => {
    const result = calculateProgressBillingPlan(
      [
        { id: "later", lineNumber: 2, netMinor: 1n, taxMinor: 0n },
        { id: "earlier", lineNumber: 1, netMinor: 1n, taxMinor: 0n },
        { id: "last", lineNumber: 3, netMinor: 1n, taxMinor: 0n }
      ],
      [
        { name: "First cent", basis: "FIXED_SUBTOTAL", fixedSubtotalMinor: 1n },
        { name: "Rest", basis: "REMAINING_BALANCE" }
      ]
    );
    expect(result.milestones[0]?.allocations).toEqual([
      {
        estimateLineId: "earlier",
        plannedNetMinor: 1n,
        estimatedTaxMinor: 0n,
        estimatedTotalMinor: 1n
      }
    ]);
  });

  it("rejects schedules without one final remaining-balance milestone", () => {
    expect(() =>
      calculateProgressBillingPlan(
        [{ id: "line", lineNumber: 1, netMinor: 100n, taxMinor: 5n }],
        [{ name: "Everything", basis: "PERCENT_OF_ESTIMATE", ratioMicros: 1_000_000n }]
      )
    ).toThrow(/remaining-balance/i);
  });

  it("rejects an early milestone that exhausts the estimate", () => {
    expect(() =>
      calculateProgressBillingPlan(
        [{ id: "line", lineNumber: 1, netMinor: 100n, taxMinor: 5n }],
        [
          { name: "Too much", basis: "FIXED_SUBTOTAL", fixedSubtotalMinor: 100n },
          { name: "Final", basis: "REMAINING_BALANCE" }
        ]
      )
    ).toThrow(/leave a positive remaining amount/i);
  });
});
