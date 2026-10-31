import { describe, expect, it } from "vitest";
import { AppError } from "@clearledger/shared";
import { buildApp } from "./app.js";
import { buildOpenApiDocument, publicApiVersion } from "./openapi.js";
import type { PaymentProviderAdapter, PaymentWebhookInput } from "./services/payment-provider.js";

describe("OpenAPI document", () => {
  it("publishes the versioned supported integration surface", () => {
    const document = buildOpenApiDocument();
    const paths = Object.keys(document.paths);

    expect(document.info.title).toBe("PennyWise Accounting Public API");
    expect(document.info.version).toBe(publicApiVersion);
    expect(paths).toContain("/v1/journals");
    expect(paths).toContain("/v1/reports/trial-balance");
    expect(paths).toContain("/v1/auth/sign-in");
    expect(paths).toContain("/v1/invitations/accept");
    expect(paths).toContain("/v1/invoices");
    expect(paths).toContain("/v1/customers");
    expect(paths).toContain("/v1/products");
    expect(paths).toContain("/v1/invoice-templates");
    expect(paths).toContain("/v1/invoices/{invoiceId}/preview");
    expect(paths).toContain("/v1/invoices/{invoiceId}/pdf");
    expect(paths).toContain("/v1/invoices/{invoiceId}/send");
    expect(paths).toContain("/v1/email-connections");
    expect(paths).toContain("/v1/email-connections/smtp");
    expect(paths).toContain("/v1/invoices/{invoiceId}/public-link");
    expect(paths).toContain("/public/invoices/{token}");
    expect(paths).toContain("/public/invoices/{token}/pdf");
    expect(paths).toContain("/public/invoices/{token}/attachments/{attachmentId}");
    expect(paths).toContain("/v1/payments");
    expect(paths).toContain("/v1/payments/manual");
    expect(paths).toContain("/v1/payments/{paymentId}/refunds");
    expect(paths).toContain("/v1/payment-accounts");
    expect(paths).toContain("/v1/payment-accounts/own");
    expect(paths).toContain("/v1/payment-links/poll");
    expect(paths).toContain("/v1/invoices/{invoiceId}/payment-links");
    expect(paths).toContain("/v1/calendar/events");
    expect(paths).toContain("/v1/project-work-items");
    expect(paths).toContain("/v1/project-work-items/{workItemId}");
    expect(paths).toContain("/v1/project-work-items/{workItemId}/dependencies");
    expect(paths).toContain("/public/invoices/{token}/checkout-sessions");
    expect(paths).toContain(
      "/public/invoices/{token}/checkout-sessions/{checkoutSessionId}/capture"
    );
    expect(paths).toContain("/v1/organizations/current/oauth-clients");
    expect(paths).toContain("/v1/oauth/token");
    expect(paths).toContain("/v1/organizations/current/webhooks");
  });

  it("serves the contract with the matching API version header", async () => {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/openapi.json" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-clearledger-api-version"]).toBe(publicApiVersion);
      expect(response.json<{ info: { version: string } }>().info.version).toBe(publicApiVersion);
    } finally {
      await app.close();
    }
  });

  it("preserves the exact PayPal payload bytes before provider signature verification", async () => {
    let receivedBody: Buffer | undefined;
    let receivedHeaders: PaymentWebhookInput;
    const paymentProvider: PaymentProviderAdapter = {
      createConnectedAccount: () => Promise.resolve("paypal-account"),
      createOnboardingLink: () => Promise.resolve("https://paypal.example.test/onboard"),
      retrieveAccount: () =>
        Promise.resolve({ chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] }),
      createHostedCheckout: (input) =>
        Promise.resolve({
          providerSessionId: "order-test",
          url: "https://paypal.example.test/checkout/order-test",
          expiresAt: input.expiresAt
        }),
      retrievePaymentStatus: () =>
        Promise.resolve({ status: "PROCESSING", amountMinor: 0n, currency: "CAD" }),
      verifyWebhook: (rawBody, headers) => {
        receivedBody = rawBody;
        receivedHeaders = headers;
        throw new AppError(
          "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
          "Fixture rejects this signature after receiving the exact raw body.",
          401
        );
      },
      createRefund: () => Promise.resolve({ providerRefundId: "refund-test", status: "PENDING" }),
      retrieveRefundStatus: () =>
        Promise.resolve({ status: "PENDING", amountMinor: 0n, currency: "CAD" }),
      retrieveFeeAndSettlementMetadata: () =>
        Promise.resolve({
          feeMinor: 0n,
          netMinor: 0n,
          settlementId: null,
          settlementAvailableAt: null
        })
    };
    const app = buildApp({ paymentProvider, paymentProviderKind: "PAYPAL" });
    const payload = '{"id":"WH-test","event_type":"PAYMENT.CAPTURE.COMPLETED"}';
    try {
      await app.ready();
      const response = await app.inject({
        method: "POST",
        url: "/v1/webhooks/payments/paypal",
        headers: {
          "content-type": "application/json",
          "paypal-transmission-id": "transmission-test",
          "paypal-transmission-time": "2026-09-11T18:00:00Z",
          "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
          "paypal-transmission-sig": "fixture-signature",
          "paypal-auth-algo": "SHA256withRSA"
        },
        payload
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "PAYMENT_WEBHOOK_SIGNATURE_INVALID"
      );
      expect(receivedBody?.toString("utf8")).toBe(payload);
      expect(receivedHeaders).toMatchObject({
        "paypal-transmission-id": "transmission-test",
        "paypal-transmission-time": "2026-09-11T18:00:00Z",
        "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
        "paypal-transmission-sig": "fixture-signature",
        "paypal-auth-algo": "SHA256withRSA"
      });
    } finally {
      await app.close();
    }
  });
});
