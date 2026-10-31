import { describe, expect, it } from "vitest";
import {
  CanadaPostAdapter,
  FixtureCarrier,
  type CarrierHttpRequest,
  type CarrierHttpResponse,
  type CarrierShipmentRequest
} from "./carrier-adapter.js";

const request: CarrierShipmentRequest = {
  purchaseKey: "shipment:fixture-1",
  origin: {
    name: "Destry Workwear",
    line1: "1 Main Street",
    city: "Edmonton",
    postalCode: "T5J 1N3",
    countryCode: "CA"
  },
  destination: {
    name: "Test Customer",
    line1: "2 Main Street",
    city: "Calgary",
    postalCode: "T2P 1J9",
    countryCode: "CA"
  },
  parcels: [
    {
      parcelNumber: 1,
      weightGrams: 1200,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      labelFormat: "PDF"
    }
  ]
};

describe("fixture carrier adapter contract", () => {
  it("quotes, buys, reconciles an ambiguous timeout, prints, voids, and tracks", async () => {
    const carrier = new FixtureCarrier({ mode: "TIMEOUT_AFTER_PERSIST" });
    const credentials = { apiKey: "fixture-key" };
    const quote = await carrier.quote(credentials, "TEST", request);
    expect(quote).toMatchObject({
      serviceCode: "FIXTURE-GROUND",
      costMinor: "1150",
      currency: "CAD"
    });
    await expect(carrier.buyLabel(credentials, "TEST", request)).rejects.toMatchObject({
      code: "FIXTURE_PURCHASE_TIMEOUT",
      ambiguous: true
    });
    const reconciled = await carrier.reconcilePurchase(credentials, "TEST", request.purchaseKey);
    expect(reconciled?.providerShipmentId).toBe(`fixture-shipment-${request.purchaseKey}`);
    expect(reconciled?.labels[0].mediaType).toBe("application/pdf");
    expect(carrier.counters.buyLabel).toBe(1);
    expect(carrier.counters.reconcile).toBe(1);
    const voided = await carrier.voidLabel(credentials, "TEST", reconciled!.providerShipmentId);
    expect(voided.status).toBe("ACCEPTED");
    const tracking = await carrier.track(credentials, "TEST", reconciled!.trackingNumber!);
    expect(tracking.events.map((event) => event.status)).toEqual(["ACCEPTED", "IN_TRANSIT"]);
  });

  it.each([
    ["INVALID_CREDENTIALS", "FIXTURE_CREDENTIALS_INVALID", "validate"],
    ["QUOTE_FAILURE", "FIXTURE_QUOTE_FAILED", "quote"],
    ["PURCHASE_FAILURE", "FIXTURE_PURCHASE_FAILED", "buy"],
    ["VOID_REJECTED", "", "void"],
    ["TRACK_FAILURE", "FIXTURE_TRACK_FAILED", "track"]
  ] as const)("records the %s failure mode", async (mode, code, operation) => {
    const carrier = new FixtureCarrier({ mode });
    const credentials = { apiKey: "fixture-key" };
    if (operation === "validate")
      await expect(carrier.validateCredentials(credentials, "TEST")).rejects.toMatchObject({
        code
      });
    if (operation === "quote")
      await expect(carrier.quote(credentials, "TEST", request)).rejects.toMatchObject({ code });
    if (operation === "buy")
      await expect(carrier.buyLabel(credentials, "TEST", request)).rejects.toMatchObject({ code });
    if (operation === "void") {
      const bought = await new FixtureCarrier().buyLabel(credentials, "TEST", request);
      await expect(
        carrier.voidLabel(credentials, "TEST", bought.providerShipmentId)
      ).resolves.toMatchObject({ status: "REJECTED" });
    }
    if (operation === "track")
      await expect(carrier.track(credentials, "TEST", "FIX-1")).rejects.toMatchObject({ code });
  });

  it("supports ZPL labels without changing the interface", async () => {
    const carrier = new FixtureCarrier();
    const result = await carrier.buyLabel({ apiKey: "fixture-key" }, "TEST", {
      ...request,
      purchaseKey: "shipment:zpl",
      parcels: [{ ...request.parcels[0], labelFormat: "ZPL" }]
    });
    expect(result.labels[0]).toMatchObject({ format: "ZPL", mediaType: "application/zpl" });
    expect(result.labels[0].data.toString("utf8")).toContain("^XA");
  });
});

describe("Canada Post adapter boundary", () => {
  it("fails closed without credentials and never sends a live request", async () => {
    let calls = 0;
    const carrier = new CanadaPostAdapter({
      httpClient: {
        request: (): Promise<CarrierHttpResponse> => {
          calls += 1;
          return Promise.resolve({ status: 200, body: {} });
        }
      }
    });
    await expect(carrier.validateCredentials({}, "TEST")).rejects.toMatchObject({
      code: "SHIPPING_CREDENTIALS_REQUIRED"
    });
    expect(calls).toBe(0);
  });

  it("uses OAuth bearer requests and translates a documented rating response", async () => {
    const calls: CarrierHttpRequest[] = [];
    const httpClient = {
      request: (input: CarrierHttpRequest): Promise<CarrierHttpResponse> => {
        calls.push(input);
        if (input.url.endsWith("/oauth2/token"))
          return Promise.resolve({ status: 200, body: { access_token: "token-for-test" } });
        return Promise.resolve({
          status: 200,
          body: {
            prices: [
              {
                serviceCode: "DOM.EP",
                serviceName: "Expedited Parcel",
                due: "12.50",
                currency: "CAD"
              }
            ]
          }
        });
      }
    };
    const carrier = new CanadaPostAdapter({ httpClient, testBaseUrl: "https://example.test" });
    const quote = await carrier.quote(
      { clientId: "client", clientSecret: "secret" },
      "TEST",
      request
    );
    expect(quote).toMatchObject({ serviceCode: "DOM.EP", costMinor: "1250", currency: "CAD" });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers?.authorization).toBe("Bearer token-for-test");
    expect(JSON.stringify(calls)).not.toContain('"clientSecret"');
  });
});
