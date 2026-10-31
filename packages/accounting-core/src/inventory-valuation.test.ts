import { describe, expect, it } from "vitest";
import {
  applyInbound,
  applyOutbound,
  averageUnitCostMicros,
  maximumInventoryQuantityMicros,
  maximumInventoryValueMinor,
  outboundValueMinor,
  receiptValueMinor
} from "./inventory-valuation.js";

describe("perpetual weighted-average inventory valuation", () => {
  it("calculates first and mixed-cost receipts without floating point", () => {
    const first = applyInbound({ quantityMicros: 0n, valueMinor: 0n }, 10_000_000n, 1_000n);
    const second = applyInbound(first, 10_000_000n, 2_000n);
    expect(second).toEqual({ quantityMicros: 20_000_000n, valueMinor: 3_000n });
    expect(averageUnitCostMicros(second)).toBe(150_000_000n);
  });

  it("allocates partial cost half-up and exhausts every residual cent on the final sale", () => {
    const start = { quantityMicros: 3_000_000n, valueMinor: 100n };
    const first = applyOutbound(start, 1_000_000n);
    const second = applyOutbound(first, 1_000_000n);
    const final = applyOutbound(second, 1_000_000n);
    expect([first.outboundValueMinor, second.outboundValueMinor, final.outboundValueMinor]).toEqual(
      [33n, 34n, 33n]
    );
    expect(final).toMatchObject({ quantityMicros: 0n, valueMinor: 0n });
  });

  it("handles fractional quantities, zero positions, and maximum supported values", () => {
    expect(receiptValueMinor(500_000n, 101n)).toBe(51n);
    expect(averageUnitCostMicros({ quantityMicros: 0n, valueMinor: 0n })).toBe(0n);
    expect(
      outboundValueMinor(
        {
          quantityMicros: maximumInventoryQuantityMicros,
          valueMinor: maximumInventoryValueMinor
        },
        maximumInventoryQuantityMicros
      )
    ).toBe(maximumInventoryValueMinor);
  });

  it("rejects zero, negative, excessive, and oversold positions", () => {
    expect(() => receiptValueMinor(0n, 100n)).toThrow(/positive/i);
    expect(() => receiptValueMinor(-1n, 100n)).toThrow(/positive/i);
    expect(() => receiptValueMinor(maximumInventoryQuantityMicros + 1n, 100n)).toThrow(/range/i);
    expect(() =>
      outboundValueMinor({ quantityMicros: 1_000_000n, valueMinor: 100n }, 2_000_000n)
    ).toThrow(/negative/i);
  });

  it("preserves value across generated receipt and depletion sequences", () => {
    for (let seed = 1n; seed <= 200n; seed += 1n) {
      const firstQuantity = ((seed % 13n) + 1n) * 250_000n;
      const secondQuantity = ((seed % 17n) + 1n) * 125_000n;
      const firstValue = receiptValueMinor(firstQuantity, seed % 2_000n);
      const secondValue = receiptValueMinor(secondQuantity, (seed * 37n) % 3_000n);
      const received = applyInbound(
        applyInbound({ quantityMicros: 0n, valueMinor: 0n }, firstQuantity, firstValue),
        secondQuantity,
        secondValue
      );
      const partialQuantity = received.quantityMicros / 3n;
      const partial = applyOutbound(received, partialQuantity);
      const final = applyOutbound(partial, partial.quantityMicros);
      expect(partial.outboundValueMinor + final.outboundValueMinor).toBe(received.valueMinor);
      expect(final.quantityMicros).toBe(0n);
      expect(final.valueMinor).toBe(0n);
    }
  });
});
