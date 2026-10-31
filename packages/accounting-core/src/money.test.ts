import { describe, expect, it } from "vitest";
import {
  multiplyMinorByQuantity,
  parseMinorUnit,
  parseQuantityMicros,
  roundRatioHalfUp,
  serializeQuantityMicros
} from "./money.js";

describe("fixed-scale money and quantity arithmetic", () => {
  it("preserves six-decimal quantities without floating point", () => {
    const quantity = parseQuantityMicros("1.000001");
    expect(quantity).toBe(1_000_001n);
    expect(serializeQuantityMicros(quantity)).toBe("1.000001");
    expect(multiplyMinorByQuantity(100n, quantity)).toBe(100n);
  });

  it("rounds signed ratios half up", () => {
    expect(roundRatioHalfUp(5n, 2n)).toBe(3n);
    expect(roundRatioHalfUp(-5n, 2n)).toBe(-3n);
    expect(roundRatioHalfUp(4n, 2n)).toBe(2n);
  });

  it("accepts the maximum supported minor-unit value and rejects overflow", () => {
    expect(parseMinorUnit("9223372036854775807")).toBe(9223372036854775807n);
    expect(() => parseMinorUnit("9223372036854775808")).toThrow("exceeds database range");
  });
});
