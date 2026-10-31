import { describe, expect, it, vi } from "vitest";
import { calculateLine } from "./invoice-calculation.js";

vi.mock("./tax-calculation-service.js", () => ({
  calculateTax: vi.fn(() => ({
    calculationMode: "EXCLUSIVE" as const,
    taxableBaseMinor: 0n,
    taxTotalMinor: 0n,
    recoverableTaxMinor: 0n,
    nonRecoverableTaxMinor: 0n,
    taxCodeId: null,
    taxCodeVersionId: null,
    snapshot: null,
    components: []
  }))
}));

const salesAccount = { id: "sales-account", type: "REVENUE" };
const shippingAccount = { id: "shipping-account", type: "REVENUE" };

/**
 * A store order's shipping charge is created as a line with no product item, so
 * income resolution fell through to the account carrying `systemPurpose: "sales"`
 * and every shipping amount landed in general sales — it could not be reported
 * separately. `incomeAccountId` lets the caller route that line, while a line
 * with a product keeps its product's own account as authoritative.
 */
function transactionStub(accounts: readonly { id: string; type: string }[]) {
  return {
    productItem: {
      findFirst: vi.fn(() => null)
    },
    account: {
      findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === "string")
          return accounts.find((account) => account.id === where.id) ?? null;
        if (where.systemPurpose === "sales") return salesAccount;
        return null;
      })
    }
  } as never;
}

const issueDate = new Date("2026-02-01T00:00:00.000Z");

describe("invoice line income account resolution", () => {
  it("uses the sales account when a product-less line names no income account", async () => {
    const line = await calculateLine(transactionStub([salesAccount]), "org", issueDate, {
      quantity: "1",
      unitPriceMinor: "1500",
      description: "Shipping: Standard"
    });
    expect(line.incomeAccountId).toBe("sales-account");
  });

  it("routes a product-less line to the income account it names", async () => {
    const line = await calculateLine(
      transactionStub([salesAccount, shippingAccount]),
      "org",
      issueDate,
      {
        quantity: "1",
        unitPriceMinor: "1500",
        description: "Shipping: Standard",
        incomeAccountId: "shipping-account"
      }
    );
    expect(line.incomeAccountId).toBe("shipping-account");
  });

  it("falls back to the sales account when the named account does not resolve", async () => {
    // An organization that has not been given a shipping revenue account must
    // keep posting exactly as it did before, not fail to invoice.
    const line = await calculateLine(transactionStub([salesAccount]), "org", issueDate, {
      quantity: "1",
      unitPriceMinor: "1500",
      description: "Shipping: Standard",
      incomeAccountId: "missing-account"
    });
    expect(line.incomeAccountId).toBe("sales-account");
  });
});
