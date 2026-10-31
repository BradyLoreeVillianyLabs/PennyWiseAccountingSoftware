import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  SquareOwnAccountPaymentProvider,
  StripeOwnAccountPaymentProvider
} from "./own-account-payment-provider.js";

interface RecordedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly query: string;
  readonly body: string;
  readonly headers: IncomingMessage["headers"];
}

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("own-account payment provider adapters", () => {
  it("drives Stripe's Payment Link and polling SDK paths against an emulator", async () => {
    const requests: RecordedRequest[] = [];
    const server = await startServer(requests, (request) => {
      if (request.method === "GET" && request.pathname === "/v1/account")
        return response(200, {
          id: "acct_owner_1",
          business_profile: { name: "Northwind Services" }
        });
      if (request.method === "POST" && request.pathname === "/v1/payment_links")
        return response(200, {
          id: "plink_1",
          url: "https://checkout.stripe.test/pay/plink_1",
          currency: "cad"
        });
      if (request.method === "GET" && request.pathname === "/v1/payment_links/plink_1")
        return response(200, { id: "plink_1", active: true, currency: "cad" });
      if (request.method === "GET" && request.pathname === "/v1/checkout/sessions")
        return response(200, {
          object: "list",
          data: [
            {
              id: "cs_1",
              payment_status: "paid",
              payment_intent: "pi_1",
              amount_total: 1250,
              currency: "cad"
            }
          ],
          has_more: false
        });
      if (request.method === "GET" && request.pathname === "/v1/payment_intents/pi_1")
        return response(200, {
          id: "pi_1",
          latest_charge: {
            id: "ch_1",
            balance_transaction: { id: "txn_1", fee: 35 }
          }
        });
      if (request.method === "POST" && request.pathname === "/v1/payment_links/plink_1")
        return response(200, { id: "plink_1", active: false });
      return response(404, {
        error: { message: `Unhandled ${request.method} ${request.pathname}` }
      });
    });
    const provider = new StripeOwnAccountPaymentProvider({
      secretKey: "sk_test_emulator",
      mode: "test",
      apiBase: server.baseUrl
    });

    await expect(provider.testConnection()).resolves.toMatchObject({
      accountId: "acct_owner_1",
      displayName: "Northwind Services"
    });
    await expect(
      provider.createPaymentLink({
        amountMinor: 1250n,
        currency: "CAD",
        invoiceId: "invoice-1",
        invoiceNumber: "INV-1",
        customerEmail: "customer@example.test",
        idempotencyKey: "stripe-emulator-key-1"
      })
    ).resolves.toMatchObject({
      providerLinkId: "plink_1",
      url: "https://checkout.stripe.test/pay/plink_1",
      accountId: "acct_owner_1"
    });
    await expect(provider.retrievePaymentStatus("plink_1")).resolves.toMatchObject({
      status: "SUCCEEDED",
      providerPaymentId: "pi_1",
      amountMinor: 1250n,
      feeMinor: 35n,
      currency: "CAD"
    });
    await provider.deactivatePaymentLink("plink_1");

    const createRequest = requests.find(
      (request) => request.method === "POST" && request.pathname === "/v1/payment_links"
    );
    expect(createRequest?.headers["idempotency-key"]).toBe("stripe-emulator-key-1");
    expect(createRequest?.body).toContain("metadata[invoice_id]=invoice-1");
    expect(requests.some((request) => request.pathname === "/v1/payment_intents/pi_1")).toBe(true);
  });

  it("drives Square's payment-link, payment-list, and delete SDK paths", async () => {
    const requests: RecordedRequest[] = [];
    const server = await startServer(requests, (request) => {
      if (request.method === "GET" && request.pathname === "/v2/locations")
        return response(200, {
          locations: [
            {
              id: "loc_1",
              merchant_id: "merchant_1",
              business_name: "Northwind Services",
              name: "Main"
            }
          ]
        });
      if (request.method === "POST" && request.pathname === "/v2/online-checkout/payment-links")
        return response(200, {
          payment_link: {
            id: "sqplink_1",
            url: "https://squareup.com/checkout/sqplink_1",
            order_id: "order_1"
          }
        });
      if (
        request.method === "GET" &&
        request.pathname === "/v2/online-checkout/payment-links/sqplink_1"
      )
        return response(200, {
          payment_link: { id: "sqplink_1", order_id: "order_1" }
        });
      if (request.method === "GET" && request.pathname === "/v2/payments")
        return response(200, {
          payments: [
            {
              id: "sqpay_1",
              order_id: "order_1",
              status: "COMPLETED",
              amount_money: { amount: "1250", currency: "CAD" },
              processing_fee: [{ amount_money: { amount: "25", currency: "CAD" } }]
            }
          ]
        });
      if (
        request.method === "DELETE" &&
        request.pathname === "/v2/online-checkout/payment-links/sqplink_1"
      )
        return response(200, {});
      return response(404, {
        errors: [{ detail: `Unhandled ${request.method} ${request.pathname}` }]
      });
    });
    const provider = new SquareOwnAccountPaymentProvider({
      accessToken: "EAAA_emulator",
      locationId: "loc_1",
      mode: "test",
      baseUrl: server.baseUrl
    });

    await expect(provider.testConnection()).resolves.toMatchObject({
      accountId: "merchant_1",
      displayName: "Northwind Services",
      locationId: "loc_1"
    });
    await expect(
      provider.createPaymentLink({
        amountMinor: 1250n,
        currency: "CAD",
        invoiceId: "invoice-1",
        invoiceNumber: "INV-1",
        customerEmail: null,
        idempotencyKey: "square-emulator-key-1"
      })
    ).resolves.toMatchObject({
      providerLinkId: "sqplink_1",
      url: "https://squareup.com/checkout/sqplink_1",
      accountId: "merchant_1"
    });
    await expect(provider.retrievePaymentStatus("sqplink_1")).resolves.toMatchObject({
      status: "SUCCEEDED",
      providerPaymentId: "sqpay_1",
      amountMinor: 1250n,
      feeMinor: 25n,
      currency: "CAD"
    });
    await provider.deactivatePaymentLink("sqplink_1");

    expect(
      requests.some(
        (request) =>
          request.method === "POST" && request.pathname === "/v2/online-checkout/payment-links"
      )
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.method === "DELETE" &&
          request.pathname === "/v2/online-checkout/payment-links/sqplink_1"
      )
    ).toBe(true);
  });
});

async function startServer(
  requests: RecordedRequest[],
  handler: (request: RecordedRequest) => { status: number; body: unknown }
): Promise<{ readonly baseUrl: string }> {
  const server = createServer((request, responseStream) => {
    void readBody(request)
      .then((body) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const recorded: RecordedRequest = {
          method: request.method ?? "GET",
          pathname: url.pathname,
          query: url.search,
          body,
          headers: request.headers
        };
        requests.push(recorded);
        const result = handler(recorded);
        responseStream.statusCode = result.status;
        responseStream.setHeader("content-type", "application/json");
        responseStream.end(JSON.stringify(result.body));
      })
      .catch(() => {
        responseStream.statusCode = 500;
        responseStream.end(JSON.stringify({ error: "emulator failure" }));
      });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port.toString()}` };
}

function response(status: number, body: unknown): { status: number; body: unknown } {
  return { status, body };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
