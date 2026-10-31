import { createHmac } from "node:crypto";
import { AppError } from "@clearledger/shared";
import { describe, expect, it } from "vitest";
import { StripePaymentProviderAdapter } from "./stripe-payment-provider.js";

const webhookSecret = "whsec_phase6_unit_test";
const adapter = new StripePaymentProviderAdapter({
  mode: "test",
  secretKey: "sk_test_" + "phase6_unit_test",
  webhookSecret
});

describe("StripePaymentProviderAdapter webhook normalization", () => {
  it("does not normalize a pending refund as a successful refund", () => {
    const webhook = signedRefund("pending");
    let caught: unknown;
    try {
      adapter.verifyWebhook(webhook.body, webhook.signature);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    if (!(caught instanceof AppError)) throw caught;
    expect(caught).toMatchObject({ code: "PAYMENT_WEBHOOK_IGNORED", statusCode: 202 });
  });

  it("normalizes only a confirmed refund update as successful", () => {
    const webhook = signedRefund("succeeded");
    expect(adapter.verifyWebhook(webhook.body, webhook.signature)).toMatchObject({
      eventType: "refund_succeeded",
      providerRefundId: "re_phase6",
      providerPaymentId: "pi_phase6",
      amountMinor: 1050n,
      currency: "CAD"
    });
  });
});

function signedRefund(status: "pending" | "succeeded") {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      id: `evt_refund_${status}`,
      object: "event",
      account: "acct_phase6",
      api_version: "2026-06-24.dahlia",
      created: timestamp,
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "refund.updated",
      data: {
        object: {
          id: "re_phase6",
          object: "refund",
          amount: 1050,
          currency: "cad",
          payment_intent: "pi_phase6",
          status
        }
      }
    })
  );
  const digest = createHmac("sha256", webhookSecret)
    .update(`${timestamp.toString()}.${body.toString("utf8")}`)
    .digest("hex");
  return { body, signature: `t=${timestamp.toString()},v1=${digest}` };
}
