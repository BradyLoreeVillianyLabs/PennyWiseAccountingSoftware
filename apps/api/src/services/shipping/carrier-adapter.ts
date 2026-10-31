import { createHash } from "node:crypto";
import { AppError } from "@clearledger/shared";

export type CarrierEnvironment = "TEST" | "PRODUCTION";
export type LabelFormat = "PDF" | "ZPL";

export interface ShippingAddress {
  readonly name: string;
  readonly organization?: string | null | undefined;
  readonly line1: string;
  readonly line2?: string | null | undefined;
  readonly city: string;
  readonly subdivisionCode?: string | null | undefined;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
}

export interface CustomsLine {
  readonly invoiceLineId?: string | null | undefined;
  readonly description: string;
  readonly quantity: string;
  readonly hsTariffCode: string;
  readonly countryOfOrigin: string;
  readonly declaredValueMinor: string;
  readonly declaredCurrency: string;
}

export interface CarrierParcel {
  readonly parcelNumber: number;
  readonly weightGrams: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly packageType?: string | null;
  readonly labelFormat: LabelFormat;
  readonly declaredValueMinor?: string | null;
  readonly declaredCurrency?: string | null;
  readonly customsLines?: readonly CustomsLine[] | null;
}

export interface CarrierShipmentRequest {
  readonly purchaseKey: string;
  readonly origin: ShippingAddress;
  readonly destination: ShippingAddress;
  readonly parcels: readonly CarrierParcel[];
  readonly serviceCode?: string | null;
  readonly serviceName?: string | null;
  readonly customsDeclaration?: Readonly<Record<string, unknown>> | null;
}

export interface CarrierCredentials {
  readonly [key: string]: unknown;
}

export interface CarrierQuote {
  readonly serviceCode: string;
  readonly serviceName: string;
  readonly costMinor: string;
  readonly currency: string;
  readonly expiresAt?: Date | null;
}

export interface CarrierLabel {
  readonly format: LabelFormat;
  readonly mediaType: "application/pdf" | "application/zpl";
  readonly data: Buffer;
  readonly providerLabelId?: string | null;
  readonly parcelNumber?: number | null;
}

export interface CarrierPurchase {
  readonly providerShipmentId: string;
  readonly trackingNumber?: string | null;
  readonly costMinor: string;
  readonly currency: string;
  readonly labels: readonly CarrierLabel[];
}

export interface CarrierVoidResult {
  readonly status: "ACCEPTED" | "REJECTED";
  readonly providerCode?: string | null;
  readonly message?: string | null;
}

export interface CarrierTrackingEvent {
  readonly externalEventId?: string | null;
  readonly status: string;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly occurredAt: Date;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface CarrierTrackingResult {
  readonly events: readonly CarrierTrackingEvent[];
}

export interface CarrierAdapter {
  readonly carrierKey: string;
  validateCredentials(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment
  ): Promise<void>;
  validateAddress(
    credentials: CarrierCredentials,
    address: ShippingAddress,
    direction: "ORIGIN" | "DESTINATION"
  ): Promise<void>;
  quote(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    request: CarrierShipmentRequest
  ): Promise<CarrierQuote>;
  buyLabel(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    request: CarrierShipmentRequest
  ): Promise<CarrierPurchase>;
  reconcilePurchase(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    purchaseKey: string
  ): Promise<CarrierPurchase | null>;
  voidLabel(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    providerShipmentId: string
  ): Promise<CarrierVoidResult>;
  track(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    trackingNumber: string
  ): Promise<CarrierTrackingResult>;
}

export class CarrierOperationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly ambiguous = false
  ) {
    super(message);
    this.name = "CarrierOperationError";
  }
}

export function carrierCredentialsRequired(): never {
  throw new AppError(
    "SHIPPING_CREDENTIALS_REQUIRED",
    "Connect an operator-owned carrier account before making a shipping request.",
    422
  );
}

export interface FixtureCarrierOptions {
  readonly mode?:
    | "NORMAL"
    | "INVALID_CREDENTIALS"
    | "QUOTE_FAILURE"
    | "PURCHASE_FAILURE"
    | "TIMEOUT_AFTER_PERSIST"
    | "VOID_REJECTED"
    | "VOID_AMBIGUOUS"
    | "TRACK_FAILURE";
}

export interface FixtureCarrierCounters {
  validateCredentials: number;
  quote: number;
  buyLabel: number;
  reconcile: number;
  voidLabel: number;
  track: number;
}

/**
 * Deterministic carrier used by unit and integration tests. It deliberately
 * models the ambiguous timeout boundary so the service must reconcile before
 * attempting a second purchase.
 */
export class FixtureCarrier implements CarrierAdapter {
  public readonly carrierKey = "FIXTURE";
  public readonly counters: FixtureCarrierCounters = {
    validateCredentials: 0,
    quote: 0,
    buyLabel: 0,
    reconcile: 0,
    voidLabel: 0,
    track: 0
  };
  private readonly purchases = new Map<string, CarrierPurchase>();
  private readonly timedOutKeys = new Set<string>();

  public constructor(private readonly options: FixtureCarrierOptions = {}) {}

  public validateCredentials(
    credentials: CarrierCredentials,
    environment?: CarrierEnvironment
  ): Promise<void> {
    void environment;
    this.counters.validateCredentials += 1;
    if (this.options.mode === "INVALID_CREDENTIALS" || credentials.apiKey !== "fixture-key")
      return Promise.reject(
        new CarrierOperationError("FIXTURE_CREDENTIALS_INVALID", "Fixture credentials are invalid.")
      );
    return Promise.resolve();
  }

  public validateAddress(
    credentials: CarrierCredentials,
    address: ShippingAddress,
    direction?: "ORIGIN" | "DESTINATION"
  ): Promise<void> {
    void credentials;
    void direction;
    if (
      !address.line1 ||
      !address.city ||
      !address.postalCode ||
      !/^[A-Z]{2}$/.test(address.countryCode)
    )
      return Promise.reject(
        new CarrierOperationError(
          "FIXTURE_ADDRESS_INVALID",
          "The fixture carrier rejected the address."
        )
      );
    return Promise.resolve();
  }

  public async quote(
    credentials: CarrierCredentials,
    _environment: CarrierEnvironment,
    request: CarrierShipmentRequest
  ): Promise<CarrierQuote> {
    this.counters.quote += 1;
    await this.validateCredentials(credentials, "TEST");
    if (this.options.mode === "QUOTE_FAILURE")
      throw new CarrierOperationError(
        "FIXTURE_QUOTE_FAILED",
        "The fixture carrier could not quote this parcel.",
        true
      );
    const parcelWeight = request.parcels.reduce((sum, parcel) => sum + parcel.weightGrams, 0);
    return {
      serviceCode: "FIXTURE-GROUND",
      serviceName: "Fixture Ground",
      costMinor: String(950 + Math.ceil(parcelWeight / 1000) * 100),
      currency: "CAD",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    };
  }

  public async buyLabel(
    credentials: CarrierCredentials,
    _environment: CarrierEnvironment,
    request: CarrierShipmentRequest
  ): Promise<CarrierPurchase> {
    this.counters.buyLabel += 1;
    await this.validateCredentials(credentials, "TEST");
    const existing = this.purchases.get(request.purchaseKey);
    if (existing) return existing;
    if (this.options.mode === "PURCHASE_FAILURE")
      throw new CarrierOperationError(
        "FIXTURE_PURCHASE_FAILED",
        "The fixture carrier rejected the purchase.",
        true
      );
    const purchase = this.makePurchase(request);
    this.purchases.set(request.purchaseKey, purchase);
    if (
      this.options.mode === "TIMEOUT_AFTER_PERSIST" &&
      !this.timedOutKeys.has(request.purchaseKey)
    ) {
      this.timedOutKeys.add(request.purchaseKey);
      throw new CarrierOperationError(
        "FIXTURE_PURCHASE_TIMEOUT",
        "The fixture carrier timed out after recording the purchase.",
        true,
        true
      );
    }
    return purchase;
  }

  public async reconcilePurchase(
    credentials: CarrierCredentials,
    _environment: CarrierEnvironment,
    purchaseKey: string
  ): Promise<CarrierPurchase | null> {
    this.counters.reconcile += 1;
    await this.validateCredentials(credentials, "TEST");
    return this.purchases.get(purchaseKey) ?? null;
  }

  public async voidLabel(
    credentials: CarrierCredentials,
    _environment: CarrierEnvironment,
    providerShipmentId: string
  ): Promise<CarrierVoidResult> {
    this.counters.voidLabel += 1;
    await this.validateCredentials(credentials, "TEST");
    if (this.options.mode === "VOID_AMBIGUOUS")
      throw new CarrierOperationError(
        "FIXTURE_VOID_TIMEOUT",
        "The fixture carrier did not answer the void request.",
        true,
        true
      );
    if (this.options.mode === "VOID_REJECTED")
      return {
        status: "REJECTED",
        providerCode: "FIXTURE_VOID_WINDOW_CLOSED",
        message: "The carrier void window is closed."
      };
    if (!providerShipmentId)
      throw new CarrierOperationError(
        "FIXTURE_SHIPMENT_REQUIRED",
        "A provider shipment is required."
      );
    return {
      status: "ACCEPTED",
      providerCode: "FIXTURE_VOID_ACCEPTED",
      message: "The fixture carrier accepted the void."
    };
  }

  public async track(
    credentials: CarrierCredentials,
    _environment: CarrierEnvironment,
    trackingNumber: string
  ): Promise<CarrierTrackingResult> {
    this.counters.track += 1;
    await this.validateCredentials(credentials, "TEST");
    if (this.options.mode === "TRACK_FAILURE")
      throw new CarrierOperationError(
        "FIXTURE_TRACK_FAILED",
        "The fixture carrier could not fetch tracking.",
        true
      );
    return {
      events: [
        {
          externalEventId: `${trackingNumber}:accepted`,
          status: "ACCEPTED",
          description: "Shipment accepted by carrier.",
          location: "Fixture Depot",
          occurredAt: new Date("2026-09-02T12:00:00.000Z"),
          metadata: { fixture: true }
        },
        {
          externalEventId: `${trackingNumber}:in_transit`,
          status: "IN_TRANSIT",
          description: "Shipment is moving through the network.",
          location: "Fixture Hub",
          occurredAt: new Date("2026-09-02T14:00:00.000Z"),
          metadata: { fixture: true }
        }
      ]
    };
  }

  private makePurchase(request: CarrierShipmentRequest): CarrierPurchase {
    const trackingNumber = `FIX-${createHash("sha256").update(request.purchaseKey).digest("hex").slice(0, 12).toUpperCase()}`;
    return {
      providerShipmentId: `fixture-shipment-${request.purchaseKey}`,
      trackingNumber,
      costMinor: String(
        950 +
          request.parcels.reduce(
            (sum, parcel) => sum + Math.ceil(parcel.weightGrams / 1000) * 100,
            0
          )
      ),
      currency: "CAD",
      labels: request.parcels.map((parcel) =>
        parcel.labelFormat === "ZPL"
          ? {
              format: "ZPL",
              mediaType: "application/zpl",
              data: Buffer.from(`^XA^FO40,40^A0N,40,40^FD${trackingNumber}^FS^XZ\n`, "utf8"),
              providerLabelId: `fixture-label-${String(parcel.parcelNumber)}`,
              parcelNumber: parcel.parcelNumber
            }
          : {
              format: "PDF",
              mediaType: "application/pdf",
              data: Buffer.from("%PDF-1.4\n% fixture shipping label\n", "utf8"),
              providerLabelId: `fixture-label-${String(parcel.parcelNumber)}`,
              parcelNumber: parcel.parcelNumber
            }
      )
    };
  }
}

export interface CarrierHttpRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface CarrierHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface CarrierHttpClient {
  request(request: CarrierHttpRequest): Promise<CarrierHttpResponse>;
}

export class FetchCarrierHttpClient implements CarrierHttpClient {
  public async request(request: CarrierHttpRequest): Promise<CarrierHttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        accept: "application/json",
        ...(request.body ? { "content-type": "application/json" } : {}),
        ...request.headers
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 500);
    }
    return { status: response.status, body };
  }
}

export interface CanadaPostAdapterOptions {
  readonly httpClient?: CarrierHttpClient;
  readonly testBaseUrl?: string;
  readonly productionBaseUrl?: string;
}

/** Canada Post REST/OAuth boundary. It never creates a usable account without credentials. */
export class CanadaPostAdapter implements CarrierAdapter {
  public readonly carrierKey = "CANADA_POST";
  private readonly http: CarrierHttpClient;
  private readonly bases: Record<CarrierEnvironment, string>;

  public constructor(options: CanadaPostAdapterOptions = {}) {
    this.http = options.httpClient ?? new FetchCarrierHttpClient();
    this.bases = {
      TEST: options.testBaseUrl ?? "https://ct.soa-gw.canadapost.ca",
      PRODUCTION: options.productionBaseUrl ?? "https://soa-gw.canadapost.ca"
    };
    for (const base of Object.values(this.bases)) {
      if (new URL(base).protocol !== "https:")
        throw new Error("Canada Post base URLs must use HTTPS.");
    }
  }

  public validateCredentials(
    credentials: CarrierCredentials,
    environment?: CarrierEnvironment
  ): Promise<void> {
    void environment;
    const clientId = textCredential(credentials, "clientId");
    const clientSecret = textCredential(credentials, "clientSecret");
    if (!clientId || !clientSecret)
      return Promise.reject(
        new AppError(
          "SHIPPING_CREDENTIALS_REQUIRED",
          "Connect an operator-owned carrier account before making a shipping request.",
          422
        )
      );
    return Promise.resolve();
  }

  public validateAddress(
    credentials: CarrierCredentials,
    address: ShippingAddress,
    direction?: "ORIGIN" | "DESTINATION"
  ): Promise<void> {
    void credentials;
    void direction;
    validateAddressShape(address, "Canada Post");
    return Promise.resolve();
  }

  public async quote(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    request: CarrierShipmentRequest
  ): Promise<CarrierQuote> {
    const token = await this.accessToken(credentials, environment);
    const response = await this.request(environment, "/rating/v1/prices", token, {
      originPostalCode: request.origin.postalCode,
      destinationPostalCode: request.destination.postalCode,
      destinationCountryCode: request.destination.countryCode,
      parcels: request.parcels.map(parcelForApi)
    });
    const item = firstObject(response, ["prices", "services", "rates"]);
    return {
      serviceCode:
        textValue(item, "serviceCode", "service-code", "code") ?? "CANADA_POST_UNSPECIFIED",
      serviceName: textValue(item, "serviceName", "service-name", "name") ?? "Canada Post service",
      costMinor: moneyValue(item, "due", "price", "total", "cost"),
      currency: textValue(item, "currency", "currencyCode") ?? "CAD"
    };
  }

  public async buyLabel(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    request: CarrierShipmentRequest
  ): Promise<CarrierPurchase> {
    const token = await this.accessToken(credentials, environment);
    const response = await this.request(
      environment,
      "/shipping/v1/shipments",
      token,
      {
        purchaseKey: request.purchaseKey,
        serviceCode: request.serviceCode,
        shipFrom: request.origin,
        shipTo: request.destination,
        parcels: request.parcels.map(parcelForApi),
        customs: request.customsDeclaration ?? undefined
      },
      request.purchaseKey
    );
    return parseCanadaPostPurchase(response, request);
  }

  public async reconcilePurchase(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    purchaseKey: string
  ): Promise<CarrierPurchase | null> {
    const token = await this.accessToken(credentials, environment);
    const response = await this.request(
      environment,
      `/shipping/v1/shipments/by-key/${encodeURIComponent(purchaseKey)}`,
      token,
      undefined,
      purchaseKey,
      true
    );
    if (response === null) return null;
    return parseCanadaPostPurchase(response, {
      purchaseKey,
      origin: emptyAddress(),
      destination: emptyAddress(),
      parcels: [
        {
          parcelNumber: 1,
          weightGrams: 1,
          lengthMm: 1,
          widthMm: 1,
          heightMm: 1,
          labelFormat: "PDF"
        }
      ]
    });
  }

  public async voidLabel(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    providerShipmentId: string
  ): Promise<CarrierVoidResult> {
    const token = await this.accessToken(credentials, environment);
    const response = await this.request(
      environment,
      `/shipping/v1/shipments/${encodeURIComponent(providerShipmentId)}`,
      token,
      undefined,
      undefined,
      false,
      "DELETE"
    );
    return {
      status: response ? "ACCEPTED" : "REJECTED",
      providerCode: response ? "CANADA_POST_VOID_ACCEPTED" : "CANADA_POST_VOID_REJECTED",
      message: response
        ? "Canada Post accepted the void request."
        : "Canada Post rejected the void request."
    };
  }

  public async track(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment,
    trackingNumber: string
  ): Promise<CarrierTrackingResult> {
    const token = await this.accessToken(credentials, environment);
    const body = await this.request(
      environment,
      `/tracking/v1/pins/${encodeURIComponent(trackingNumber)}/summaries`,
      token,
      undefined,
      undefined,
      true
    );
    if (!body) return { events: [] };
    const candidates = arrayValue(body, "events", "trackingEvents", "summaries");
    return {
      events: candidates.map((item, index) => ({
        externalEventId:
          textValue(item, "eventId", "event-id", "id") ?? `${trackingNumber}:${String(index)}`,
        status: textValue(item, "status", "eventType", "event-type") ?? "UNKNOWN",
        description: textValue(item, "description", "eventDescription"),
        location: textValue(item, "location", "eventLocation"),
        occurredAt: dateValue(item, "occurredAt", "eventDate", "event-date")
      }))
    };
  }

  private async accessToken(
    credentials: CarrierCredentials,
    environment: CarrierEnvironment
  ): Promise<string> {
    await this.validateCredentials(credentials, environment);
    const clientId = textCredential(credentials, "clientId")!;
    const clientSecret = textCredential(credentials, "clientSecret")!;
    const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
    const response = await this.http.request({
      method: "POST",
      url: `${this.bases[environment]}/oauth2/token`,
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    if (response.status < 200 || response.status >= 300)
      throw carrierHttpError("CANADA_POST_TOKEN_FAILED", true);
    const token = textValue(response.body, "access_token", "accessToken");
    if (!token)
      throw new CarrierOperationError(
        "CANADA_POST_TOKEN_INVALID",
        "Canada Post did not return an access token.",
        true
      );
    return token;
  }

  private async request(
    environment: CarrierEnvironment,
    path: string,
    token: string,
    body?: unknown,
    idempotencyKey?: string,
    allowNotFound = false,
    method: "GET" | "POST" | "DELETE" = "POST"
  ): Promise<unknown> {
    const response = await this.http.request({
      method,
      url: `${this.bases[environment]}${path}`,
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {})
      },
      ...(body === undefined ? {} : { body })
    });
    if (allowNotFound && response.status === 404) return null;
    if (response.status < 200 || response.status >= 300)
      throw carrierHttpError(`CANADA_POST_${method}_FAILED`, method !== "DELETE");
    return response.body;
  }
}

function validateAddressShape(address: ShippingAddress, carrierName: string): void {
  if (
    !address.name ||
    !address.line1 ||
    !address.city ||
    !address.postalCode ||
    !/^[A-Z]{2}$/.test(address.countryCode)
  )
    throw new CarrierOperationError(
      `${carrierName.toUpperCase().replaceAll(" ", "_")}_ADDRESS_INVALID`,
      `The ${carrierName} address is incomplete.`
    );
}

function textCredential(credentials: CarrierCredentials, key: string): string | null {
  const value = credentials[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function carrierHttpError(code: string, retryable: boolean): CarrierOperationError {
  return new CarrierOperationError(code, "The carrier request failed.", retryable);
}

function parcelForApi(parcel: CarrierParcel) {
  return {
    parcelNumber: parcel.parcelNumber,
    weightGrams: parcel.weightGrams,
    lengthMm: parcel.lengthMm,
    widthMm: parcel.widthMm,
    heightMm: parcel.heightMm,
    labelFormat: parcel.labelFormat,
    declaredValueMinor: parcel.declaredValueMinor ?? undefined,
    declaredCurrency: parcel.declaredCurrency ?? undefined,
    customsLines: parcel.customsLines ?? undefined
  };
}

function parseCanadaPostPurchase(body: unknown, request: CarrierShipmentRequest): CarrierPurchase {
  const root = isRecord(body) ? body : {};
  const providerShipmentId = textValue(root, "shipmentId", "shipment-id", "id");
  if (!providerShipmentId)
    throw new CarrierOperationError(
      "CANADA_POST_PURCHASE_INVALID",
      "Canada Post returned no shipment identifier.",
      true
    );
  const labels = arrayValue(root, "labels", "artifacts").flatMap((item, index) => {
    const data = textValue(item, "data", "content", "base64");
    if (!data) return [];
    const format: LabelFormat = textValue(item, "format", "labelFormat") === "ZPL" ? "ZPL" : "PDF";
    return [
      {
        format,
        mediaType: format === "ZPL" ? ("application/zpl" as const) : ("application/pdf" as const),
        data: Buffer.from(data, "base64"),
        providerLabelId: textValue(item, "labelId", "artifactId", "id") ?? null,
        parcelNumber: Number(textValue(item, "parcelNumber") ?? index + 1)
      }
    ];
  });
  return {
    providerShipmentId,
    trackingNumber: textValue(root, "trackingNumber", "tracking-number", "pin"),
    costMinor: moneyValue(root, "due", "price", "total", "cost"),
    currency: textValue(root, "currency", "currencyCode") ?? "CAD",
    labels: labels.length
      ? labels
      : request.parcels.map((parcel) => ({
          format: parcel.labelFormat,
          mediaType:
            parcel.labelFormat === "ZPL"
              ? ("application/zpl" as const)
              : ("application/pdf" as const),
          data: Buffer.alloc(0),
          parcelNumber: parcel.parcelNumber
        }))
  };
}

function firstObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  for (const key of keys) {
    const values = arrayValue(value, key);
    if (values[0]) return values[0];
  }
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function textValue(value: unknown, ...keys: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

function moneyValue(value: unknown, ...keys: string[]): string {
  const raw = textValue(value, ...keys);
  if (!raw) return "0";
  const numeric = Number(raw.replaceAll(",", ""));
  if (!Number.isFinite(numeric) || numeric < 0)
    throw new CarrierOperationError(
      "CARRIER_PRICE_INVALID",
      "The carrier returned an invalid price."
    );
  return Number.isInteger(numeric) ? String(numeric) : String(Math.round(numeric * 100));
}

function dateValue(value: unknown, ...keys: string[]): Date {
  const raw = textValue(value, ...keys);
  const date = raw ? new Date(raw) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emptyAddress(): ShippingAddress {
  return { name: "", line1: "", city: "", postalCode: "", countryCode: "CA" };
}
