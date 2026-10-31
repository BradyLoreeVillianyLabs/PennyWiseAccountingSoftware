import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@clearledger/shared";

export interface ConnectorHttpRequest {
  readonly url: string;
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMilliseconds?: number;
  readonly retryLimit?: number;
}

export interface ConnectorHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ConnectorHttpClient {
  request(input: ConnectorHttpRequest): Promise<ConnectorHttpResponse>;
}

export class ConnectorHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly retryAfterSeconds: number | null,
    message = "The provider request failed."
  ) {
    super(message);
    this.name = "ConnectorHttpError";
  }
}

export class FetchConnectorHttpClient implements ConnectorHttpClient {
  public constructor(
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {}

  public async request(input: ConnectorHttpRequest): Promise<ConnectorHttpResponse> {
    const retries = Math.max(0, Math.min(3, input.retryLimit ?? 2));
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImplementation(input.url, {
          method: input.method ?? "GET",
          ...(input.headers ? { headers: input.headers } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          redirect: "manual",
          signal: AbortSignal.timeout(input.timeoutMilliseconds ?? 15_000)
        });
      } catch (error) {
        if (attempt < retries) {
          await this.wait(backoffMilliseconds(attempt, null));
          continue;
        }
        throw new AppError(
          "CONNECTOR_PROVIDER_UNREACHABLE",
          "The provider could not be reached. Check the connection and try again.",
          502,
          { errorName: error instanceof Error ? error.name : "NetworkError" }
        );
      }
      if (response.status >= 300 && response.status < 400)
        throw new AppError(
          "CONNECTOR_REDIRECT_REJECTED",
          "The provider redirected the request. Confirm the exact store URL.",
          422
        );
      const headers = Object.fromEntries(
        [...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value])
      );
      const retryAfter = retryAfterSeconds(headers["retry-after"]);
      if (retryableStatus(response.status) && attempt < retries) {
        await response.body?.cancel();
        await this.wait(backoffMilliseconds(attempt, retryAfter));
        continue;
      }
      const declaredLength = Number(headers["content-length"] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > 5_242_880)
        throw new AppError(
          "CONNECTOR_RESPONSE_TOO_LARGE",
          "The provider response exceeded the safe import limit.",
          502
        );
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 5_242_880)
        throw new AppError(
          "CONNECTOR_RESPONSE_TOO_LARGE",
          "The provider response exceeded the safe import limit.",
          502
        );
      if (!response.ok)
        throw new ConnectorHttpError(
          response.status,
          retryAfter,
          response.status === 401 || response.status === 403
            ? "The provider rejected the connector credentials."
            : response.status === 429
              ? "The provider rate limit was reached. Try again later."
              : "The provider request failed."
        );
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new AppError(
            "CONNECTOR_RESPONSE_INVALID",
            "The provider returned an invalid response.",
            502
          );
        }
      }
      return { status: response.status, headers, body };
    }
    throw new AppError("CONNECTOR_PROVIDER_UNREACHABLE", "The provider could not be reached.", 502);
  }
}

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export const systemHostResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export async function validatePublicHttpsUrl(
  raw: unknown,
  resolver: HostResolver = systemHostResolver,
  errorCode = "CONNECTOR_URL_INVALID"
): Promise<URL> {
  if (typeof raw !== "string" || raw.length > 2048)
    throw new AppError(errorCode, "Enter a valid public HTTPS URL.", 422);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError(errorCode, "Enter a valid public HTTPS URL.", 422);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase()) ||
    url.hostname.toLowerCase().endsWith(".local")
  )
    throw new AppError(errorCode, "Enter a valid public HTTPS URL.", 422);
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolver(url.hostname);
  if (!addresses.length || addresses.some(isPrivateOrReservedAddress))
    throw new AppError(errorCode, "The URL must resolve only to public network addresses.", 422);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export async function validatePublicHttpsResourceUrl(
  raw: unknown,
  resolver: HostResolver = systemHostResolver,
  errorCode = "CONNECTOR_RESOURCE_URL_INVALID"
): Promise<URL> {
  if (typeof raw !== "string" || raw.length > 2048)
    throw new AppError(errorCode, "Enter a valid public HTTPS resource URL.", 422);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError(errorCode, "Enter a valid public HTTPS resource URL.", 422);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase()) ||
    url.hostname.toLowerCase().endsWith(".local")
  )
    throw new AppError(errorCode, "Enter a valid public HTTPS resource URL.", 422);
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolver(url.hostname);
  if (!addresses.length || addresses.some(isPrivateOrReservedAddress))
    throw new AppError(
      errorCode,
      "The resource URL must resolve only to public network addresses.",
      422
    );
  url.hash = "";
  return url;
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  )
    return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  const candidate = mapped ?? address;
  if (isIP(candidate) !== 4) return false;
  const octets = candidate.split(".").map(Number);
  const [a = -1, b = -1] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryAfterSeconds(value: string | undefined): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(60, Number(value));
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : Math.max(0, Math.min(60, Math.ceil((date.getTime() - Date.now()) / 1000)));
}

function backoffMilliseconds(attempt: number, retryAfter: number | null): number {
  if (retryAfter !== null) return retryAfter * 1000;
  return Math.min(2_000, 250 * 2 ** attempt);
}
