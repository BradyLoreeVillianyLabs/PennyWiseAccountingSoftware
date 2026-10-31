import { Prisma } from "@clearledger/db";
import { describe, expect, it, vi } from "vitest";
import { allocateTaxAdjustment, calculateTax } from "./tax-calculation-service.js";

const transactionDate = new Date("2026-08-03T00:00:00.000Z");

function taxCodeFixture(
  calculationMode: "EXCLUSIVE" | "INCLUSIVE",
  components: readonly {
    rate: string;
    recoverablePercent?: string;
    payableAccountId?: string | null;
    recoverableAccountId?: string | null;
  }[],
  treatment: "STANDARD" | "ZERO_RATED" | "EXEMPT" = "STANDARD"
) {
  return {
    id: "tax-code",
    code: "GST-HST",
    name: "GST/HST",
    versions: [
      {
        id: "tax-version",
        version: 3,
        treatment,
        calculationMode,
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        effectiveTo: null,
        sourceName: "CRA",
        sourceUrl: "https://www.canada.ca/",
        sourceRetrievedAt: new Date("2026-07-01T12:00:00.000Z"),
        components: components.map((component, index) => ({
          name: `Tax ${String(index + 1)}`,
          jurisdiction: "CA",
          rate: new Prisma.Decimal(component.rate),
          recoverablePercent: new Prisma.Decimal(component.recoverablePercent ?? "1"),
          payableAccountId:
            component.payableAccountId === undefined
              ? "payable-account"
              : component.payableAccountId,
          recoverableAccountId:
            component.recoverableAccountId === undefined
              ? "recoverable-account"
              : component.recoverableAccountId
        }))
      }
    ]
  };
}

function transactionClient(
  taxCode: ReturnType<typeof taxCodeFixture> | null,
  validAccountIds: readonly string[] = ["recoverable-account", "payable-account"]
) {
  return {
    taxCode: { findFirst: vi.fn().mockResolvedValue(taxCode) },
    account: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            validAccountIds.filter((id) => where.id.in.includes(id)).map((id) => ({ id }))
          )
        )
    }
  };
}

describe("central tax calculation", () => {
  it("returns an intentional zero-tax result without consulting a provider", async () => {
    const tx = transactionClient(null);
    const result = await calculateTax(tx as never, {
      organizationId: "organization",
      taxDate: transactionDate,
      taxCodeId: null,
      amountMinor: 12_345n,
      purpose: "SALE",
      currency: "cad"
    });

    expect(result).toMatchObject({
      taxableBaseMinor: 12_345n,
      taxTotalMinor: 0n,
      taxCodeVersionId: null,
      snapshot: null
    });
    expect(tx.taxCode.findFirst).not.toHaveBeenCalled();
  });

  it("calculates exclusive sales tax with immutable source evidence", async () => {
    const tx = transactionClient(taxCodeFixture("EXCLUSIVE", [{ rate: "0.05" }]));
    const result = await calculateTax(tx as never, {
      organizationId: "organization",
      taxDate: transactionDate,
      taxCodeId: "tax-code",
      amountMinor: 10_000n,
      purpose: "SALE",
      jurisdiction: "ca",
      currency: "CAD",
      documentId: "invoice",
      lineId: "line"
    });

    expect(result.taxableBaseMinor).toBe(10_000n);
    expect(result.taxTotalMinor).toBe(500n);
    expect(result.recoverableTaxMinor).toBe(0n);
    expect(result.components[0]).toMatchObject({ totalMinor: 500n, recoverableMinor: 0n });
    expect(result.snapshot).toMatchObject({
      engine: "CLEARLEDGER_NATIVE",
      purpose: "SALE",
      code: "GST-HST",
      jurisdiction: "CA",
      taxTotalMinor: "500",
      source: { name: "CRA" }
    });
    expect(tx.account.findMany).toHaveBeenCalledOnce();
  });

  it("allocates inclusive component rounding to the final component", async () => {
    const tx = transactionClient(taxCodeFixture("INCLUSIVE", [{ rate: "0.05" }, { rate: "0.08" }]));
    const result = await calculateTax(tx as never, {
      organizationId: "organization",
      taxDate: transactionDate,
      taxCodeId: "tax-code",
      amountMinor: 11_300n,
      purpose: "SALE"
    });

    expect(result.taxableBaseMinor).toBe(10_000n);
    expect(result.taxTotalMinor).toBe(1_300n);
    expect(result.components.map((component) => component.totalMinor)).toEqual([500n, 800n]);
    expect(result.components.reduce((sum, component) => sum + component.totalMinor, 0n)).toBe(
      result.taxTotalMinor
    );
  });

  it("calculates recoverable purchase tax and validates tenant-owned asset accounts", async () => {
    const tx = transactionClient(
      taxCodeFixture("EXCLUSIVE", [
        {
          rate: "0.05",
          recoverablePercent: "0.5",
          recoverableAccountId: "recoverable-account"
        }
      ])
    );
    const result = await calculateTax(tx as never, {
      organizationId: "organization",
      taxDate: transactionDate,
      taxCodeId: "tax-code",
      amountMinor: 10_000n,
      purpose: "PURCHASE"
    });

    expect(result).toMatchObject({
      taxTotalMinor: 500n,
      recoverableTaxMinor: 250n,
      nonRecoverableTaxMinor: 250n
    });
    expect(tx.account.findMany).toHaveBeenCalledOnce();
  });

  it.each([
    ["ZERO_RATED", "EXCLUSIVE"],
    ["EXEMPT", "INCLUSIVE"]
  ] as const)("does not calculate tax for %s treatment in %s mode", (treatment, mode) =>
    calculateTax(transactionClient(taxCodeFixture(mode, [{ rate: "0.13" }], treatment)) as never, {
      organizationId: "organization",
      taxDate: transactionDate,
      taxCodeId: "tax-code",
      amountMinor: 10_000n,
      purpose: "SALE"
    }).then((result) => {
      expect(result.taxableBaseMinor).toBe(10_000n);
      expect(result.taxTotalMinor).toBe(0n);
      expect(result.roundingAdjustmentMinor).toBe(0n);
      expect(result.components[0]).toMatchObject({ totalMinor: 0n, recoverableMinor: 0n });
      expect(result.snapshot).toMatchObject({ treatment, taxTotalMinor: "0" });
    })
  );

  it("fails closed when a taxable sale has no payable control account", async () => {
    const tx = transactionClient(
      taxCodeFixture("EXCLUSIVE", [{ rate: "0.05", payableAccountId: null }])
    );

    await expect(
      calculateTax(tx as never, {
        organizationId: "organization",
        taxDate: transactionDate,
        taxCodeId: "tax-code",
        amountMinor: 10_000n,
        purpose: "SALE"
      })
    ).rejects.toMatchObject({ code: "TAX_PAYABLE_ACCOUNT_REQUIRED" });
  });

  it("fails closed for an invalid tax date", async () => {
    const tx = transactionClient(null);

    await expect(
      calculateTax(tx as never, {
        organizationId: "organization",
        taxDate: new Date("not-a-date"),
        taxCodeId: null,
        amountMinor: 10_000n,
        purpose: "SALE"
      })
    ).rejects.toMatchObject({ code: "TAX_DATE_INVALID" });
  });

  it("fails closed when the requested jurisdiction is not represented by the code", async () => {
    const tx = transactionClient(taxCodeFixture("EXCLUSIVE", [{ rate: "0.05" }]));

    await expect(
      calculateTax(tx as never, {
        organizationId: "organization",
        taxDate: transactionDate,
        taxCodeId: "tax-code",
        amountMinor: 10_000n,
        purpose: "SALE",
        jurisdiction: "US"
      })
    ).rejects.toMatchObject({ code: "TAX_JURISDICTION_MISMATCH" });
  });

  it("fails closed when a recoverable account is not an active organization asset", async () => {
    const tx = transactionClient(
      taxCodeFixture("EXCLUSIVE", [{ rate: "0.05", recoverablePercent: "1" }]),
      []
    );

    await expect(
      calculateTax(tx as never, {
        organizationId: "organization",
        taxDate: transactionDate,
        taxCodeId: "tax-code",
        amountMinor: 10_000n,
        purpose: "PURCHASE"
      })
    ).rejects.toMatchObject({ code: "RECOVERABLE_TAX_ACCOUNT_INVALID" });
  });

  it("allocates a partial sales credit from original tax evidence without recalculation", () => {
    const result = allocateTaxAdjustment({
      sourceNetMinor: 10_000n,
      sourceTaxTotalMinor: 1_300n,
      sourceRecoverableTaxMinor: 0n,
      sourceTotalMinor: 11_300n,
      allocationTotalMinor: 3_390n,
      purpose: "CREDIT",
      sourceSnapshot: {
        engine: "CLEARLEDGER_NATIVE",
        engineVersion: "1",
        purpose: "SALE",
        taxableBaseMinor: "10000",
        taxTotalMinor: "1300",
        recoverableTaxMinor: "0",
        nonRecoverableTaxMinor: "1300",
        components: [
          { name: "GST", amountMinor: "500", totalMinor: "500" },
          { name: "PST", amountMinor: "800", totalMinor: "800" }
        ]
      }
    });

    expect(result).toMatchObject({
      netMinor: 3_000n,
      taxTotalMinor: 390n,
      recoverableTaxMinor: 0n,
      nonRecoverableTaxMinor: 390n
    });
    expect(result.snapshot).toMatchObject({
      purpose: "CREDIT",
      taxableBaseMinor: "3000",
      taxTotalMinor: "390",
      allocation: {
        engine: "CLEARLEDGER_NATIVE",
        method: "ORIGINAL_TAX_PROPORTIONAL"
      },
      components: [
        { amountMinor: "150", totalMinor: "150" },
        { amountMinor: "240", totalMinor: "240" }
      ]
    });
  });

  it("preserves exact recoverable and non-recoverable component totals for purchase credits", () => {
    const result = allocateTaxAdjustment({
      sourceNetMinor: 10_000n,
      sourceTaxTotalMinor: 1_300n,
      sourceRecoverableTaxMinor: 650n,
      sourceTotalMinor: 11_300n,
      allocationTotalMinor: 5_650n,
      purpose: "CREDIT",
      sourceSnapshot: {
        components: [
          {
            name: "Tax A",
            totalMinor: "500",
            recoverableMinor: "500",
            nonRecoverableMinor: "0"
          },
          {
            name: "Tax B",
            totalMinor: "800",
            recoverableMinor: "150",
            nonRecoverableMinor: "650"
          }
        ]
      }
    });

    expect(result).toMatchObject({
      netMinor: 5_000n,
      taxTotalMinor: 650n,
      recoverableTaxMinor: 325n,
      nonRecoverableTaxMinor: 325n
    });
    const snapshot = result.snapshot as {
      components: readonly {
        totalMinor: string;
        recoverableMinor: string;
        nonRecoverableMinor: string;
      }[];
    };
    expect(
      snapshot.components.reduce((sum, component) => sum + BigInt(component.totalMinor), 0n)
    ).toBe(650n);
    expect(
      snapshot.components.reduce((sum, component) => sum + BigInt(component.recoverableMinor), 0n)
    ).toBe(325n);
    for (const component of snapshot.components)
      expect(BigInt(component.totalMinor)).toBe(
        BigInt(component.recoverableMinor) + BigInt(component.nonRecoverableMinor)
      );
  });
});
