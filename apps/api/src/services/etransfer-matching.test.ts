import { describe, expect, it } from "vitest";
import { suggestDepositInvoices, type DepositInvoiceCandidate } from "./etransfer-matching.js";

const invoice = (
  id: string,
  amount = 1000n,
  customerId = "customer-a"
): DepositInvoiceCandidate => ({
  id,
  customerId,
  customerName: "Alex Tremblay",
  payerAliases: [],
  reference: `INV-${id}`,
  outstandingMinor: amount
});
const deposit = (amountMinor = 1000n, message = "", sender: string | null = null) => ({
  amountMinor,
  message,
  sender
});

describe("e-Transfer invoice suggestions", () => {
  it("ranks an exact reference and amount above an amount-only match", () => {
    const result = suggestDepositInvoices(deposit(1000n, "Payment INV-2"), [
      invoice("1"),
      invoice("2")
    ]);
    expect(result[0]).toMatchObject({
      invoiceIds: ["2"],
      confidence: "HIGH",
      requiresConfirmation: true
    });
    expect(result[1]).toMatchObject({ confidence: "LOW" });
  });
  it("flags a reference with the wrong amount and never suggests high confidence", () => {
    expect(suggestDepositInvoices(deposit(999n, "INV-1"), [invoice("1")])[0]).toMatchObject({
      confidence: "LOW",
      amountMatches: false
    });
    expect(suggestDepositInvoices(deposit(999n, "INV-1"), [invoice("1")])[0]?.reasons).toContain(
      "reference-amount-mismatch"
    );
  });
  it("requires an unambiguous amount for a sender-only high confidence match", () => {
    const payment = deposit(1000n, "", " Alex Tremblay ");
    expect(suggestDepositInvoices(payment, [invoice("1")])[0]?.confidence).toBe("HIGH");
    expect(
      suggestDepositInvoices(payment, [invoice("1"), invoice("2")]).every(
        (item) => item.confidence === "MEDIUM"
      )
    ).toBe(true);
  });
  it("uses an explicitly supplied payer alias", () => {
    expect(
      suggestDepositInvoices(deposit(1000n, "", "AP Office"), [
        { ...invoice("1"), payerAliases: ["AP Office"] }
      ])[0]?.confidence
    ).toBe("HIGH");
  });
  it("does not match reference prefixes or empty sender names", () => {
    expect(suggestDepositInvoices(deposit(999n, "INV-123"), [invoice("12")])).toEqual([]);
    expect(suggestDepositInvoices(deposit(), [invoice("1")])[0]?.confidence).toBe("LOW");
  });
  it("combines invoices only within one customer and requires the exact total", () => {
    const result = suggestDepositInvoices(deposit(1000n, "INV-1 INV-2"), [
      invoice("1", 400n),
      invoice("2", 600n),
      invoice("3", 600n, "customer-b")
    ]);
    expect(result.find((item) => item.invoiceIds.length === 2)).toMatchObject({
      invoiceIds: ["1", "2"],
      confidence: "HIGH"
    });
    expect(result.some((item) => item.invoiceIds.includes("3"))).toBe(false);
  });
  it("ignores nonpositive balances and outflows while retaining exact large amounts", () => {
    expect(suggestDepositInvoices(deposit(-1n), [invoice("1")])).toEqual([]);
    expect(suggestDepositInvoices(deposit(), [invoice("1", 0n)])).toEqual([]);
    const large = 9007199254740993123n;
    expect(
      suggestDepositInvoices(deposit(large, "INV-1"), [invoice("1", large)])[0]?.confidence
    ).toBe("HIGH");
  });
});
