import { parseExactRate } from "@clearledger/accounting-core";
import { AppError } from "@clearledger/shared";

export const bankOfCanadaFxUsdCadEndpoint =
  "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";

const providerName = "Bank of Canada";
const seriesName = "FXUSDCAD";
const defaultTimeoutMilliseconds = 5_000;
const maximumResponseBytes = 1_048_576;

export interface BankOfCanadaRateHttpClient {
  getJson(url: string): Promise<unknown>;
}

export class FetchBankOfCanadaRateHttpClient implements BankOfCanadaRateHttpClient {
  public constructor(
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
    private readonly timeoutMilliseconds = defaultTimeoutMilliseconds
  ) {}

  public async getJson(url: string): Promise<unknown> {
    assertAllowedRequestUrl(url);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "GET",
        headers: {
          accept: "application/json"
        },
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMilliseconds)
      });
    } catch {
      throw new AppError(
        "FX_RATE_PROVIDER_UNAVAILABLE",
        "The Bank of Canada rate service could not be reached. Enter the rate manually or try again later.",
        503
      );
    }

    if (response.status >= 300 && response.status < 400) {
      throw new AppError(
        "FX_RATE_PROVIDER_REDIRECT_REJECTED",
        "The Bank of Canada rate service returned an unexpected redirect.",
        502
      );
    }
    if (!response.ok) {
      throw new AppError(
        "FX_RATE_PROVIDER_UNAVAILABLE",
        "The Bank of Canada rate service did not return a successful response. Enter the rate manually or try again later.",
        502,
        { providerStatus: response.status }
      );
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maximumResponseBytes) {
      throw invalidProviderResponse();
    }
    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new AppError(
        "FX_RATE_PROVIDER_UNAVAILABLE",
        "The Bank of Canada rate response could not be read before the timeout. Enter the rate manually or try again later.",
        503
      );
    }
    if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
      throw invalidProviderResponse();
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw invalidProviderResponse();
    }
  }
}

export interface BankOfCanadaRateSuggestion {
  readonly provider: "Bank of Canada";
  readonly providerService: "Valet API";
  readonly series: "FXUSDCAD";
  readonly transactionCurrency: "USD";
  readonly baseCurrency: "CAD";
  readonly requestedDate: string;
  readonly lookupStartDate: string;
  readonly lookupEndDate: string;
  readonly observationDate: string;
  readonly value: string;
  readonly rate: string;
  readonly numerator: string;
  readonly denominator: string;
  readonly sourceUrl: string;
  readonly sourceReference: string;
  readonly retrievedAt: string;
  readonly indicative: true;
  readonly persisted: false;
  readonly accountingEntriesCreated: 0;
  readonly disclaimer: string;
}

export class BankOfCanadaRateService {
  public constructor(
    private readonly httpClient: BankOfCanadaRateHttpClient = new FetchBankOfCanadaRateHttpClient(),
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async suggestUsdCad(requestedDate: string): Promise<BankOfCanadaRateSuggestion> {
    const endDate = parseCalendarDate(requestedDate, "date");
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 6);
    const lookupStartDate = calendarDate(startDate);
    const lookupEndDate = calendarDate(endDate);
    const sourceUrl = buildRequestUrl(lookupStartDate, lookupEndDate);
    const payload = await this.httpClient.getJson(sourceUrl);
    const observations = readObservations(payload)
      .filter(
        (observation) => observation.date >= lookupStartDate && observation.date <= lookupEndDate
      )
      .sort((left, right) => right.date.localeCompare(left.date));
    const observation = observations[0];
    if (!observation) {
      throw new AppError(
        "FX_RATE_SUGGESTION_UNAVAILABLE",
        `No ${seriesName} observation was published in the seven-day window ending ${lookupEndDate}. Enter the rate manually or choose another date.`,
        404
      );
    }

    let exactRate: ReturnType<typeof parseExactRate>;
    try {
      if (!/^\d{1,8}(?:\.\d{1,12})?$/.test(observation.value)) {
        throw invalidProviderResponse();
      }
      exactRate = parseExactRate(observation.value, `${seriesName} observation`);
    } catch {
      throw invalidProviderResponse();
    }
    const retrievedAt = this.clock().toISOString();
    return Object.freeze({
      provider: providerName,
      providerService: "Valet API",
      series: seriesName,
      transactionCurrency: "USD",
      baseCurrency: "CAD",
      requestedDate: lookupEndDate,
      lookupStartDate,
      lookupEndDate,
      observationDate: observation.date,
      value: observation.value,
      rate: observation.value,
      numerator: exactRate.numerator.toString(),
      denominator: exactRate.denominator.toString(),
      sourceUrl,
      sourceReference: `${providerName} Valet ${seriesName}; observed ${observation.date}; requested ${lookupEndDate}; retrieved ${retrievedAt.slice(0, 10)}`,
      retrievedAt,
      indicative: true,
      persisted: false,
      accountingEntriesCreated: 0,
      disclaimer:
        "Indicative Bank of Canada daily exchange-rate observation. Review the rate, effective date, purpose, and source before explicitly saving a manual immutable snapshot."
    });
  }
}

function buildRequestUrl(startDate: string, endDate: string): string {
  const query = new URLSearchParams({
    start_date: startDate,
    end_date: endDate
  });
  return `${bankOfCanadaFxUsdCadEndpoint}?${query.toString()}`;
}

function assertAllowedRequestUrl(value: string): void {
  let requestUrl: URL;
  try {
    requestUrl = new URL(value);
  } catch {
    throw rejectedProviderUrl();
  }
  const endpoint = new URL(bankOfCanadaFxUsdCadEndpoint);
  const keys = [...requestUrl.searchParams.keys()].sort();
  if (
    requestUrl.protocol !== endpoint.protocol ||
    requestUrl.hostname !== endpoint.hostname ||
    requestUrl.port !== endpoint.port ||
    requestUrl.pathname !== endpoint.pathname ||
    requestUrl.username !== "" ||
    requestUrl.password !== "" ||
    requestUrl.hash !== "" ||
    keys.length !== 2 ||
    keys[0] !== "end_date" ||
    keys[1] !== "start_date"
  ) {
    throw rejectedProviderUrl();
  }
  const startValue = requestUrl.searchParams.get("start_date");
  const endValue = requestUrl.searchParams.get("end_date");
  try {
    if (!startValue || !endValue) throw rejectedProviderUrl();
    const startDate = parseCalendarDate(startValue, "start_date");
    const endDate = parseCalendarDate(endValue, "end_date");
    if (endDate.getTime() - startDate.getTime() !== 6 * 24 * 60 * 60 * 1_000) {
      throw rejectedProviderUrl();
    }
  } catch {
    throw rejectedProviderUrl();
  }
}

function readObservations(payload: unknown): { date: string; value: string }[] {
  if (!isRecord(payload) || !Array.isArray(payload.observations)) {
    throw invalidProviderResponse();
  }
  const observations: { date: string; value: string }[] = [];
  for (const candidate of payload.observations) {
    if (!isRecord(candidate) || typeof candidate.d !== "string") {
      throw invalidProviderResponse();
    }
    let date: Date;
    try {
      date = parseCalendarDate(candidate.d, "provider observation date");
    } catch {
      throw invalidProviderResponse();
    }
    const series = candidate[seriesName];
    if (!isRecord(series) || typeof series.v !== "string") {
      throw invalidProviderResponse();
    }
    observations.push({ date: calendarDate(date), value: series.v });
  }
  return observations;
}

function parseCalendarDate(value: string, fieldName: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError("INVALID_DATE", `${fieldName} must use YYYY-MM-DD.`, 400, { fieldName });
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || calendarDate(parsed) !== value) {
    throw new AppError("INVALID_DATE", `${fieldName} must be a real calendar date.`, 400, {
      fieldName
    });
  }
  return parsed;
}

function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidProviderResponse(): AppError {
  return new AppError(
    "FX_RATE_PROVIDER_RESPONSE_INVALID",
    "The Bank of Canada rate service returned an invalid response. Enter the rate manually or try again later.",
    502
  );
}

function rejectedProviderUrl(): AppError {
  return new AppError(
    "FX_RATE_PROVIDER_URL_REJECTED",
    "The exchange-rate provider request did not match the fixed Bank of Canada endpoint.",
    500
  );
}
