import { beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const captureOrder = vi.fn();
const getOrder = vi.fn();
const getCapturedPayment = vi.fn();
const refundCapturedPayment = vi.fn();
const getRefund = vi.fn();

vi.mock("@paypal/paypal-server-sdk", () => ({
  // A plain constructor function, not a class — nothing here needs any real behavior,
  // since paypal-payment-provider.ts only ever passes the constructed instance straight
  // through to OrdersController/PaymentsController, which are mocked separately below.
  Client: function Client() {
    return {};
  },
  Environment: { Sandbox: "Sandbox", Production: "Production" },
  OrderStatus: {
    Created: "CREATED",
    Saved: "SAVED",
    Approved: "APPROVED",
    Voided: "VOIDED",
    Completed: "COMPLETED",
    PayerActionRequired: "PAYER_ACTION_REQUIRED"
  },
  OrdersController: class {
    createOrder = createOrder;
    captureOrder = captureOrder;
    getOrder = getOrder;
  },
  PaymentsController: class {
    getCapturedPayment = getCapturedPayment;
    refundCapturedPayment = refundCapturedPayment;
    getRefund = getRefund;
  }
}));

const { PayPalPaymentProviderAdapter } = await import("./paypal-payment-provider.js");

const config = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  partnerMerchantId: "PARTNERMERCHANTID1",
  partnerAttributionId: "PennyWise_Test_BN",
  webhookId: "WEBHOOK-ID-1",
  mode: "test" as const
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("PayPalPaymentProviderAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createOrder.mockReset();
    captureOrder.mockReset();
    getOrder.mockReset();
    getCapturedPayment.mockReset();
    refundCapturedPayment.mockReset();
    getRefund.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  function mockOAuthToken() {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: "test-access-token", expires_in: 32400 })
    );
  }

  it("createConnectedAccount returns a deterministic, org-scoped tracking id with no network call", async () => {
    const adapter = new PayPalPaymentProviderAdapter(config);
    const id = await adapter.createConnectedAccount({
      organizationId: "org-1",
      contactEmail: "owner@example.com",
      displayName: "Destry Workwear",
      country: "CA",
      idempotencyKey: "idem-key-0123456789"
    });
    expect(id).toBe("org_org-1_idem-key-0123456");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createOnboardingLink fetches a fresh OAuth token, posts a partner referral, and returns the action_url", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        links: [
          {
            rel: "self",
            href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/abc"
          },
          { rel: "action_url", href: "https://sandbox.paypal.com/onboard?token=abc" }
        ]
      })
    );
    const adapter = new PayPalPaymentProviderAdapter(config);
    const url = await adapter.createOnboardingLink(
      "org_org-1_idem-key-012345",
      "https://app.example/return"
    );
    expect(url).toBe("https://sandbox.paypal.com/onboard?token=abc");

    const [tokenCall, referralCall] = fetchMock.mock.calls;
    expect(tokenCall![0]).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(referralCall![0]).toBe("https://api-m.sandbox.paypal.com/v2/customer/partner-referrals");
    const referralBody = JSON.parse((referralCall![1] as { body: string }).body) as {
      tracking_id: string;
    };
    expect(referralBody.tracking_id).toBe("org_org-1_idem-key-012345");
    expect((referralCall![1] as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer test-access-token"
    );
  });

  it("createOnboardingLink refuses to proceed when PayPal's response has no action_url", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ links: [{ rel: "self", href: "https://x" }] }));
    const adapter = new PayPalPaymentProviderAdapter(config);
    await expect(
      adapter.createOnboardingLink("track-1", "https://app.example/return")
    ).rejects.toThrow(/did not return an onboarding action URL/);
  });

  it("retrieveAccount reports every unmet requirement for an incompletely onboarded seller", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: false,
        primary_email_confirmed: true,
        oauth_third_party: []
      })
    );
    const adapter = new PayPalPaymentProviderAdapter(config);
    const status = await adapter.retrieveAccount("track-1");
    expect(status.chargesEnabled).toBe(false);
    expect(status.payoutsEnabled).toBe(false);
    expect(status.requirementsDue).toEqual([
      "PAYMENTS_RECEIVABLE_NOT_ENABLED",
      "THIRD_PARTY_PERMISSIONS_MISSING"
    ]);
  });

  it("retrieveAccount reports fully enabled once every requirement is met", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    const adapter = new PayPalPaymentProviderAdapter(config);
    const status = await adapter.retrieveAccount("track-1");
    expect(status).toEqual({
      providerAccountId: "SELLERMERCHANTID1",
      chargesEnabled: true,
      payoutsEnabled: true,
      requirementsDue: []
    });
  });

  it("retrieveAccount treats a 404 (no referral found yet) as onboarding-incomplete, not an error", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404));
    const adapter = new PayPalPaymentProviderAdapter(config);
    const status = await adapter.retrieveAccount("track-never-started");
    expect(status).toEqual({
      chargesEnabled: false,
      payoutsEnabled: false,
      requirementsDue: ["ONBOARDING_INCOMPLETE"]
    });
  });

  it("createHostedCheckout resolves the real merchant id first, then creates an order routed to it", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    createOrder.mockResolvedValueOnce({
      result: {
        id: "ORDER123",
        status: "CREATED",
        links: [
          { rel: "payer-action", href: "https://sandbox.paypal.com/checkoutnow?token=ORDER123" }
        ]
      }
    });
    const adapter = new PayPalPaymentProviderAdapter(config);
    const session = await adapter.createHostedCheckout({
      connectedAccountId: "track-1",
      idempotencyKey: "idem-checkout-1",
      amountMinor: 12345n,
      currency: "cad",
      customerEmail: null,
      metadata: {},
      expiresAt: new Date("2026-09-08T00:00:00.000Z"),
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel"
    });
    expect(session.providerSessionId).toBe("ORDER123");
    expect(session.url).toBe("https://sandbox.paypal.com/checkoutnow?token=ORDER123");
    const orderRequest = createOrder.mock.calls[0]![0] as {
      body: {
        purchaseUnits: readonly {
          amount: { value: string };
          payee: { merchantId: string };
          customId: string;
        }[];
      };
    };
    expect(orderRequest.body.purchaseUnits[0]!.amount.value).toBe("123.45");
    expect(orderRequest.body.purchaseUnits[0]!.payee.merchantId).toBe("SELLERMERCHANTID1");
    // customId carries our own connectedAccountId (not PayPal's merchant id, and not the
    // idempotency key) — it's the one field the real Capture/Refund webhook resources
    // carry through, so this is how a webhook resolves which account it belongs to.
    expect(orderRequest.body.purchaseUnits[0]!.customId).toBe("track-1");
  });

  it("createHostedCheckout refuses an account that has not finished onboarding", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404));
    const adapter = new PayPalPaymentProviderAdapter(config);
    await expect(
      adapter.createHostedCheckout({
        connectedAccountId: "track-never-started",
        idempotencyKey: "idem-1",
        amountMinor: 100n,
        currency: "CAD",
        customerEmail: null,
        metadata: {},
        expiresAt: new Date(),
        successUrl: "https://app.example/success",
        cancelUrl: "https://app.example/cancel"
      })
    ).rejects.toThrow(/has not finished onboarding/);
  });

  it("retrievePaymentStatus maps a completed capture to SUCCEEDED with its own amount and currency", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "ORDER123",
        status: "COMPLETED",
        amount: { currency_code: "CAD", value: "123.45" }
      })
    );
    const adapter = new PayPalPaymentProviderAdapter(config);
    const status = await adapter.retrievePaymentStatus("track-1", "ORDER123");
    expect(status).toEqual({ status: "SUCCEEDED", amountMinor: 12345n, currency: "CAD" });
  });

  it("retrievePaymentStatus maps PAYER_ACTION_REQUIRED to PENDING", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "ORDER124",
        status: "PAYER_ACTION_REQUIRED",
        amount: { currency_code: "CAD", value: "50.00" }
      })
    );
    const adapter = new PayPalPaymentProviderAdapter(config);
    const status = await adapter.retrievePaymentStatus("track-1", "ORDER124");
    expect(status.status).toBe("PROCESSING");
  });

  it("createRefund reads the original capture's own currency rather than assuming CAD", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "CAPTURE1", amount: { currency_code: "USD", value: "100.00" } })
    );
    refundCapturedPayment.mockResolvedValueOnce({
      result: { id: "REFUND1", status: "COMPLETED" }
    });
    const adapter = new PayPalPaymentProviderAdapter(config);
    const refund = await adapter.createRefund({
      connectedAccountId: "track-1",
      providerPaymentId: "CAPTURE1",
      amountMinor: 5000n,
      idempotencyKey: "idem-refund-1"
    });
    expect(refund).toEqual({ providerRefundId: "REFUND1", status: "SUCCEEDED" });
    expect(fetchMock.mock.calls[3]![0]).toContain("/v2/payments/captures/CAPTURE1");
    const refundRequest = refundCapturedPayment.mock.calls[0]![0] as {
      body: { amount: { currencyCode: string; value: string } };
    };
    expect(refundRequest.body.amount.currencyCode).toBe("USD");
    expect(refundRequest.body.amount.value).toBe("50.00");
  });

  it("createRefund refuses to guess when PayPal's capture response has no currency", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "CAPTURE1", amount: {} }));
    const adapter = new PayPalPaymentProviderAdapter(config);
    await expect(
      adapter.createRefund({
        connectedAccountId: "track-1",
        providerPaymentId: "CAPTURE1",
        amountMinor: 5000n,
        idempotencyKey: "idem-refund-2"
      })
    ).rejects.toThrow(/invalid currency/);
  });

  it("retrieveRefundStatus reports a pending refund with its own amount and currency", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        merchant_id: "SELLERMERCHANTID1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_third_party: ["PAYMENT"]
      })
    );
    getRefund.mockResolvedValueOnce({
      result: { id: "REFUND1", status: "PENDING", amount: { currencyCode: "CAD", value: "50.00" } }
    });
    const adapter = new PayPalPaymentProviderAdapter(config);
    const status = await adapter.retrieveRefundStatus("track-1", "REFUND1");
    expect(status).toEqual({ status: "PENDING", amountMinor: 5000n, currency: "CAD" });
  });

  it("verifyWebhook rejects missing headers through the async contract", async () => {
    const adapter = new PayPalPaymentProviderAdapter(config);
    await expect(adapter.verifyWebhook(Buffer.from("{}"), {})).rejects.toThrow(
      /webhook headers are missing/
    );
  });

  it("verifyWebhookAsync rejects an event PayPal itself reports as an invalid signature", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ verification_status: "FAILURE" }));
    const adapter = new PayPalPaymentProviderAdapter(config);
    await expect(
      adapter.verifyWebhookAsync(
        Buffer.from(JSON.stringify({ id: "WH-1", event_type: "x", resource: {} })),
        {
          transmissionId: "t-1",
          transmissionTime: "2026-09-08T00:00:00Z",
          certUrl: "https://api.sandbox.paypal.com/cert",
          transmissionSig: "sig",
          authAlgo: "SHA256withRSA"
        }
      )
    ).rejects.toThrow(/signature is invalid/);
  });

  it("verifyWebhookAsync normalizes a completed capture into the shared event shape", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ verification_status: "SUCCESS" }));
    const adapter = new PayPalPaymentProviderAdapter(config);
    const rawBody = Buffer.from(
      JSON.stringify({
        id: "WH-EVT-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        create_time: "2026-09-08T12:00:00Z",
        resource: {
          id: "CAPTURE1",
          custom_id: "track-1",
          amount: { currency_code: "CAD", value: "123.45" }
        }
      })
    );
    const event = await adapter.verifyWebhookAsync(rawBody, {
      transmissionId: "t-1",
      transmissionTime: "2026-09-08T00:00:00Z",
      certUrl: "https://api.sandbox.paypal.com/cert",
      transmissionSig: "sig",
      authAlgo: "SHA256withRSA"
    });
    expect(event).toEqual({
      eventId: "WH-EVT-1",
      eventType: "payment_succeeded",
      connectedAccountId: "track-1",
      providerPaymentId: "CAPTURE1",
      amountMinor: 12345n,
      feeMinor: 0n,
      currency: "CAD",
      methodCategory: "OTHER",
      occurredAt: new Date("2026-09-08T12:00:00Z")
    });
  });

  it("verifyWebhookAsync resolves a refund webhook's original capture from its 'up' link", async () => {
    mockOAuthToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ verification_status: "SUCCESS" }));
    const adapter = new PayPalPaymentProviderAdapter(config);
    const rawBody = Buffer.from(
      JSON.stringify({
        id: "WH-EVT-2",
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        create_time: "2026-09-08T12:05:00Z",
        resource: {
          id: "REFUND1",
          custom_id: "track-1",
          amount: { currency_code: "CAD", value: "50.00" },
          links: [
            {
              rel: "up",
              href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE1?fields=id"
            }
          ]
        }
      })
    );
    const event = await adapter.verifyWebhookAsync(rawBody, {
      transmissionId: "t-2",
      transmissionTime: "2026-09-08T00:00:00Z",
      certUrl: "https://api.sandbox.paypal.com/cert",
      transmissionSig: "sig",
      authAlgo: "SHA256withRSA"
    });
    expect(event.providerPaymentId).toBe("CAPTURE1");
    expect(event.providerRefundId).toBe("REFUND1");
    expect(event.connectedAccountId).toBe("track-1");
    expect(event.eventType).toBe("refund_succeeded");
  });

  it("rejects construction without every required credential", () => {
    expect(() => new PayPalPaymentProviderAdapter({ ...config, webhookId: "" })).toThrow(
      /webhook ID/
    );
    expect(() => new PayPalPaymentProviderAdapter({ ...config, partnerMerchantId: "" })).toThrow(
      /partner merchant ID/
    );
  });
});
