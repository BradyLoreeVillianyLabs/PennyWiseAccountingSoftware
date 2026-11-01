import { describe, expect, it } from "vitest";
import {
  InMemoryCurrencyRegistry,
  allocateMinorUnits,
  convertBalancedComponents,
  convertMinorUnits,
  formatCurrencyAmount,
  makeExactRate,
  parseCurrencyAmount,
  parseExactRate
} from "./currency.js";

const registry = new InMemoryCurrencyRegistry();

describe("exact currency arithmetic", () => {
  it("converts minor units with currency exponents and no floating point", () => {
    const usd = registry.get("USD");
    const cad = registry.get("CAD");
    expect(convertMinorUnits(10_000n, usd, cad, parseExactRate("1.35"))).toBe(13_500n);
    expect(convertMinorUnits(1n, usd, cad, parseExactRate("1.005"))).toBe(1n);
    expect(convertMinorUnits(1n, usd, cad, parseExactRate("1.015"))).toBe(1n);
  });

  it("handles zero-decimal and three-decimal currencies", () => {
    const jpy = registry.get("JPY");
    const cad = registry.get("CAD");
    const kwd = registry.get("KWD");
    expect(convertMinorUnits(100n, jpy, cad, makeExactRate(1n, 2n))).toBe(5_000n);
    expect(convertMinorUnits(1_000n, kwd, cad, makeExactRate(3n, 1n))).toBe(300n);
  });

  it("parses and formats amounts using the currency exponent", () => {
    expect(parseCurrencyAmount("100.25", registry.get("CAD"))).toBe(10_025n);
    expect(formatCurrencyAmount(-10_025n, registry.get("USD"))).toBe("-100.25");
    expect(parseCurrencyAmount("125", registry.get("JPY"))).toBe(125n);
    expect(formatCurrencyAmount(1_234n, registry.get("KWD"))).toBe("1.234");
    expect(() => parseCurrencyAmount("1.001", registry.get("CAD"))).toThrow(
      "no more than 2 decimal"
    );
  });

  it("reduces decimal rates to immutable exact rationals", () => {
    expect(parseExactRate("1.3500")).toEqual({ numerator: 27n, denominator: 20n });
    expect(() => parseExactRate("0")).toThrow("positive decimal rate");
  });

  it("allocates residuals by largest remainder and preserves total", () => {
    expect(allocateMinorUnits(10n, [{ weight: 1n }, { weight: 1n }, { weight: 1n }])).toEqual([
      4n,
      3n,
      3n
    ]);
    expect(allocateMinorUnits(-10n, [{ weight: 1n }, { weight: 1n }, { weight: 1n }])).toEqual([
      -4n,
      -3n,
      -3n
    ]);
    expect(
      allocateMinorUnits(100n, [
        { key: "a", weight: 3n },
        { key: "b", weight: 1n }
      ])
    ).toEqual([75n, 25n]);
  });

  it("converts balanced journal components without a rounding residue", () => {
    const converted = convertBalancedComponents(
      [1n, 1n, 1n, -3n],
      registry.get("USD"),
      registry.get("CAD"),
      parseExactRate("1.50")
    );
    expect(converted).toEqual([2n, 2n, 1n, -5n]);
    expect(converted.reduce((sum, amount) => sum + amount, 0n)).toBe(0n);
  });

  it("preserves balanced totals across deterministic allocation fixtures", () => {
    for (let total = 2n; total <= 250n; total += 1n) {
      const first = total / 3n;
      const second = total / 5n;
      const third = total - first - second;
      const converted = convertBalancedComponents(
        [first, second, third, -total],
        registry.get("USD"),
        registry.get("CAD"),
        parseExactRate("1.37625")
      );
      expect(converted.reduce((sum, amount) => sum + amount, 0n)).toBe(0n);
      expect(
        convertBalancedComponents(
          [first, second, third, -total],
          registry.get("USD"),
          registry.get("CAD"),
          parseExactRate("1.37625")
        )
      ).toEqual(converted);
    }
  });
});
