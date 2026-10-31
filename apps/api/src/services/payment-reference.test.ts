import { describe, expect, it } from "vitest";
import { assertSafePaymentReference } from "./payment-reference.js";

describe("payment reference safety", () => {
  it("allows processor and masked references", () => {
    expect(() => assertSafePaymentReference("pm_3M2G9K21dA9Z")).not.toThrow();
    expect(() => assertSafePaymentReference("terminal receipt •••• 4242")).not.toThrow();
  });

  it("rejects raw PAN and explicitly labelled credential fields", () => {
    expect(() => assertSafePaymentReference("4242 4242 4242 4242")).toThrow("Raw card credentials");
    expect(() => assertSafePaymentReference("CVV 123")).toThrow("Raw card credentials");
  });
});
