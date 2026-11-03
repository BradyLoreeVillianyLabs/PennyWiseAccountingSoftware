import { describe, expect, it } from "vitest";
import { validatePaymentInstructionUrl } from "./services/payment-instruction-service.js";

describe("payment instruction safety", () => {
  it("accepts public https payment links without fetching them", () => {
    expect(() =>
      validatePaymentInstructionUrl("https://pay.example.test/invoice/123")
    ).not.toThrow();
  });

  it.each([
    "http://pay.example.test/invoice/123",
    "https://localhost/pay",
    "https://127.0.0.1/pay",
    "https://192.168.1.25/pay",
    "https://10.0.0.4/pay",
    "https://[::1]/pay"
  ])("rejects unsafe payment URL %s", (url) => {
    expect(() => validatePaymentInstructionUrl(url)).toThrow(
      "Payment links must use https and a public host."
    );
  });
});
