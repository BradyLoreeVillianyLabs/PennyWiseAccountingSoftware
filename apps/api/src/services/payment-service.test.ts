import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@clearledger/db";
import type { PaymentProviderAdapter } from "./payment-provider.js";
import { PaymentService } from "./payment-service.js";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("PaymentService production configuration", () => {
  it("does not silently enable the test provider in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => new PaymentService({} as PrismaClient)).toThrow(
      "Production payments require an explicitly configured provider adapter"
    );
  });

  it("accepts explicitly injected production dependencies", () => {
    process.env.NODE_ENV = "production";
    expect(
      () =>
        new PaymentService({} as PrismaClient, providerAdapter, {
          protect: (value) => value,
          reveal: (value) => value
        })
    ).not.toThrow();
  });
});

const providerAdapter: PaymentProviderAdapter = {
  createConnectedAccount: () => Promise.resolve("acct_test_provider"),
  createOnboardingLink: () => Promise.resolve("https://provider.example/onboarding"),
  retrieveAccount: () =>
    Promise.resolve({ chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] }),
  createHostedCheckout: (input) =>
    Promise.resolve({
      providerSessionId: "session",
      url: "https://provider.example/checkout",
      expiresAt: input.expiresAt
    }),
  retrievePaymentStatus: () =>
    Promise.resolve({ status: "SUCCEEDED", amountMinor: 100n, currency: "CAD" }),
  verifyWebhook: () => {
    throw new Error("not used");
  },
  createRefund: () => Promise.resolve({ providerRefundId: "refund", status: "SUCCEEDED" }),
  retrieveRefundStatus: () =>
    Promise.resolve({ status: "SUCCEEDED", amountMinor: 100n, currency: "CAD" }),
  retrieveFeeAndSettlementMetadata: () =>
    Promise.resolve({
      feeMinor: 3n,
      netMinor: 97n,
      settlementId: null,
      settlementAvailableAt: null
    })
};
