import { describe, expect, it, vi } from "vitest";
import {
  BankOfCanadaRateService,
  FetchBankOfCanadaRateHttpClient,
  bankOfCanadaFxUsdCadEndpoint,
  type BankOfCanadaRateHttpClient
} from "./bank-of-canada-rate-service.js";

const validProviderRequest = `${bankOfCanadaFxUsdCadEndpoint}?start_date=2026-07-27&end_date=2026-08-02`;

describe("BankOfCanadaRateService", () => {
  it("uses a fixed seven-day Valet request and returns the latest exact observation", async () => {
    const getJson = vi.fn(() =>
      Promise.resolve({
        observations: [
          { d: "2026-07-31", FXUSDCAD: { v: "1.3600" } },
          { d: "2026-08-03", FXUSDCAD: { v: "9.9999" } },
          { d: "2026-08-01", FXUSDCAD: { v: "1.3750" } }
        ]
      })
    );
    const service = new BankOfCanadaRateService(
      { getJson } satisfies BankOfCanadaRateHttpClient,
      () => new Date("2026-08-02T15:30:00.000Z")
    );

    await expect(service.suggestUsdCad("2026-08-02")).resolves.toMatchObject({
      provider: "Bank of Canada",
      providerService: "Valet API",
      series: "FXUSDCAD",
      transactionCurrency: "USD",
      baseCurrency: "CAD",
      requestedDate: "2026-08-02",
      lookupStartDate: "2026-07-27",
      lookupEndDate: "2026-08-02",
      observationDate: "2026-08-01",
      value: "1.3750",
      rate: "1.3750",
      numerator: "11",
      denominator: "8",
      sourceReference:
        "Bank of Canada Valet FXUSDCAD; observed 2026-08-01; requested 2026-08-02; retrieved 2026-08-02",
      retrievedAt: "2026-08-02T15:30:00.000Z",
      indicative: true,
      persisted: false,
      accountingEntriesCreated: 0
    });
    expect(getJson).toHaveBeenCalledOnce();
    expect(getJson).toHaveBeenCalledWith(
      `${bankOfCanadaFxUsdCadEndpoint}?start_date=2026-07-27&end_date=2026-08-02`
    );
  });

  it("reports that a valid but empty observation window has no suggestion", async () => {
    const service = new BankOfCanadaRateService({
      getJson() {
        return Promise.resolve({ observations: [] });
      }
    });
    await expect(service.suggestUsdCad("2026-08-02")).rejects.toMatchObject({
      code: "FX_RATE_SUGGESTION_UNAVAILABLE",
      statusCode: 404
    });
  });

  it("does not pass an invalid provider value through as an accounting rate", async () => {
    const service = new BankOfCanadaRateService({
      getJson() {
        return Promise.resolve({
          observations: [{ d: "2026-08-01", FXUSDCAD: { v: "0" } }]
        });
      }
    });
    await expect(service.suggestUsdCad("2026-08-02")).rejects.toMatchObject({
      code: "FX_RATE_PROVIDER_RESPONSE_INVALID",
      statusCode: 502
    });
  });

  it("rejects invalid dates before calling the provider", async () => {
    const getJson = vi.fn(() => Promise.resolve({ observations: [] }));
    const service = new BankOfCanadaRateService({ getJson });
    await expect(service.suggestUsdCad("2026-02-30")).rejects.toMatchObject({
      code: "INVALID_DATE",
      statusCode: 400
    });
    expect(getJson).not.toHaveBeenCalled();
  });
});

describe("FetchBankOfCanadaRateHttpClient", () => {
  it("uses GET with JSON accept, an abort timeout, and redirects disabled", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;
    const fetchImplementation: typeof fetch = (input, init) => {
      receivedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      receivedInit = init;
      return Promise.resolve(new Response('{"observations":[]}'));
    };
    const client = new FetchBankOfCanadaRateHttpClient(fetchImplementation, 1_000);

    await expect(client.getJson(validProviderRequest)).resolves.toEqual({
      observations: []
    });
    expect(receivedUrl).toBe(validProviderRequest);
    expect(receivedInit).toMatchObject({
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual"
    });
    expect(receivedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects redirects instead of following them", async () => {
    const fetchImplementation: typeof fetch = () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.invalid" }
        })
      );
    const client = new FetchBankOfCanadaRateHttpClient(fetchImplementation);

    await expect(client.getJson(validProviderRequest)).rejects.toMatchObject({
      code: "FX_RATE_PROVIDER_REDIRECT_REJECTED",
      statusCode: 502
    });
  });

  it("rejects a host or path outside the fixed official endpoint before fetch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = new FetchBankOfCanadaRateHttpClient(fetchImplementation);

    await expect(
      client.getJson(
        "https://example.invalid/valet/observations/FXUSDCAD/json?start_date=2026-07-27&end_date=2026-08-02"
      )
    ).rejects.toMatchObject({
      code: "FX_RATE_PROVIDER_URL_REJECTED",
      statusCode: 500
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
