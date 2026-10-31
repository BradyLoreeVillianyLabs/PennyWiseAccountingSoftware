import { describe, expect, it } from "vitest";
import { buildThirteenWeekForecast } from "./cash-forecast.js";
import { assertCommercialTransition, entitlementsFor } from "./commercial-lifecycle.js";
import { validateMigrationManifest } from "./migration-contract.js";

describe("Phases 19–21 provider-neutral contracts", () => {
  it("builds a deterministic 13-week cash forecast", () => {
    const weeks = Array.from(
      { length: 13 },
      (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`
    );
    const forecast = buildThirteenWeekForecast(
      1000n,
      weeks,
      weeks.map((_, index) =>
        index === 0
          ? [{ label: "Invoice", amountMinor: 500n, confidence: "PROJECTED" as const }]
          : []
      )
    );
    expect(forecast).toHaveLength(13);
    expect(forecast[0]?.closingMinor).toBe(1500n);
    expect(forecast[1]?.openingMinor).toBe(1500n);
  });

  it("shows an overdraft instead of blocking the cash forecast", () => {
    const weeks = Array.from({ length: 13 }, (_, index) => `2026-09-${String(index + 1)}`);
    const forecast = buildThirteenWeekForecast(
      -250n,
      weeks,
      weeks.map(() => [])
    );
    expect(forecast[0]?.openingMinor).toBe(-250n);
    expect(forecast[12]?.closingMinor).toBe(-250n);
  });

  it("requires explicit unsupported migration evidence and preserves dependency order", () => {
    expect(() =>
      validateMigrationManifest([
        { entity: "customers", source: "qbo", rowCount: 1, supported: true },
        { entity: "accounts", source: "qbo", rowCount: 1, supported: true }
      ])
    ).toThrow(/dependency order/i);
    expect(() =>
      validateMigrationManifest([
        { entity: "accounts", source: "legacy", rowCount: 0, supported: false }
      ])
    ).toThrow(/explicit reason/i);
  });

  it("keeps commercial entitlements separate from ledger access", () => {
    expect(() => assertCommercialTransition("ENDED", "ACTIVE")).toThrow();
    expect(entitlementsFor("GRACE", ["invoices:create"])).toEqual([]);
    expect(entitlementsFor("ACTIVE", ["invoices:create", "invoices:create"])).toEqual([
      "invoices:create"
    ]);
  });
});
