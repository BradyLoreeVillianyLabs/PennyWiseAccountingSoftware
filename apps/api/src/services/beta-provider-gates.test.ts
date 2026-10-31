import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { EstimateEmailService } from "./estimate-email-service.js";
import { InvoiceDocumentService, type DocumentStorage } from "./invoice-document-service.js";
import type { PaymentProviderAdapter } from "./payment-provider.js";
import { PaymentService } from "./payment-service.js";

const prisma = {} as PrismaClient;
const context = {} as OrganizationContext;
const storage: DocumentStorage = {
  put: () => Promise.resolve(),
  get: () => Promise.resolve(Buffer.alloc(0))
};
const protector = {
  protect: (value: string) => value,
  reveal: (value: string) => value
};

describe("public beta provider gates", () => {
  it("rejects invoice and estimate email queueing before writing a delivery", async () => {
    const invoiceDocuments = new InvoiceDocumentService(
      prisma,
      storage,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    const estimateEmail = new EstimateEmailService(prisma, undefined, true);

    await expect(
      invoiceDocuments.queueSend(
        context,
        "invoice-id",
        { recipientEmail: "buyer@example.test" },
        "key"
      )
    ).rejects.toMatchObject({ code: "BETA_EMAIL_DELIVERY_DISABLED", statusCode: 409 });
    await expect(
      estimateEmail.queueSend(
        context,
        "estimate-id",
        { recipientEmail: "buyer@example.test" },
        "key"
      )
    ).rejects.toMatchObject({ code: "BETA_EMAIL_DELIVERY_DISABLED", statusCode: 409 });
  });

  it("rejects hosted payment connection, checkout, and webhooks while preserving manual paths", async () => {
    const payments = new PaymentService(prisma, providerAdapter, protector, true);

    await expect(
      payments.connectAccount(context, "https://example.test/return")
    ).rejects.toMatchObject({ code: "BETA_HOSTED_PAYMENTS_DISABLED", statusCode: 409 });
    await expect(
      payments.createPublicCheckout("opaque-token", {}, "idempotency-key-1234")
    ).rejects.toMatchObject({ code: "BETA_HOSTED_PAYMENTS_DISABLED", statusCode: 409 });
    await expect(
      payments.capturePublicCheckout("opaque-token", "00000000-0000-4000-8000-000000000001")
    ).rejects.toMatchObject({ code: "BETA_HOSTED_PAYMENTS_DISABLED", statusCode: 409 });
    await expect(
      payments.processStripeWebhook(Buffer.from("{}"), "signature")
    ).rejects.toMatchObject({ code: "BETA_HOSTED_PAYMENTS_DISABLED", statusCode: 409 });
  });

  it("rejects receipt email queueing before writing an outbox event", async () => {
    const payments = new PaymentService(prisma, providerAdapter, protector, true);

    await expect(
      payments.resendReceipt(context, "payment-id", "idempotency-key-1234")
    ).rejects.toMatchObject({ code: "BETA_EMAIL_DELIVERY_DISABLED", statusCode: 409 });
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
    throw new Error("The beta gate must run before the provider adapter.");
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
