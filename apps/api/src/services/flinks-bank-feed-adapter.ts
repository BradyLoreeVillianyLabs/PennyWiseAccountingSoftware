import { createHash } from "node:crypto";
import { AppError } from "@clearledger/shared";
import { hashJson } from "../utils/json.js";
import type {
  BankFeedProviderAccount,
  BankFeedProviderAdapter,
  BankFeedProviderExchangeResult,
  BankFeedProviderLinkInput,
  BankFeedProviderLinkResult,
  BankFeedProviderSyncResult,
  BankFeedProviderTransaction
} from "./bank-feed-provider.js";

type JsonRecord = Record<string, unknown>;

const AUTHORIZE_TOKEN_TTL_MS = 15 * 60_000;
const ASYNC_POLL_INTERVAL_MS = 10_000;
const ASYNC_POLL_MAX_ATTEMPTS = 180;

export interface FlinksHttpRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: JsonRecord | undefined;
}

export interface FlinksHttpResponse {
  readonly status: number;
  readonly body: JsonRecord;
}

export interface FlinksHttpClient {
  request(input: FlinksHttpRequest): Promise<FlinksHttpResponse>;
}

export interface FlinksBankFeedConfig {
  readonly instance: string;
  readonly customerId: string;
  /** Server-only key used exclusively to issue a short-lived authorize token. */
  readonly secretKey: string;
  /** Server-only application key used only by Flinks data and deletion endpoints. */
  readonly apiKey: string;
  readonly environment: "sandbox" | "development" | "production";
  readonly apiBaseUrl?: string | undefined;
  readonly iframeBaseUrl?: string | undefined;
}

export interface FlinksBankFeedAdapterOptions {
  readonly http?: FlinksHttpClient | undefined;
  readonly now?: (() => Date) | undefined;
  readonly sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

/** Native fetch transport kept small enough to replace with a local emulator in tests. */
export class FetchFlinksHttpClient implements FlinksHttpClient {
  public async request(input: FlinksHttpRequest): Promise<FlinksHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        signal: controller.signal
      });
      const raw = await response.text();
      let body: JsonRecord = {};
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (isRecord(parsed)) body = parsed;
        } catch {
          // The adapter maps an unstructured provider response below without
          // exposing its contents to a user or application log.
        }
      }
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "BANK_FEED_PROVIDER_UNAVAILABLE",
        "The bank-feed provider is temporarily unavailable. No bank activity was changed.",
        503
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Flinks Connect adapter.
 *
 * The browser receives only a short-lived authorize token and displays the
 * provider-hosted iframe. It returns a loginId to this API after consent; the
 * API keeps that loginId encrypted through BankFeedService and uses cached
 * /Authorize sessions for every account-list and sync request. PennyWise never
 * receives a bank username, password, MFA answer, or raw account number.
 */
export class FlinksBankFeedAdapter implements BankFeedProviderAdapter {
  public readonly providerKey = "FLINKS";
  public readonly connectionFlow = "HOSTED_CONSENT" as const;
  private readonly apiBaseUrl: string;
  private readonly iframeBaseUrl: string;
  private readonly http: FlinksHttpClient;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  public constructor(
    private readonly config: FlinksBankFeedConfig,
    options: FlinksBankFeedAdapterOptions = {}
  ) {
    assertConfig(config);
    this.apiBaseUrl = normalizeOrigin(
      config.apiBaseUrl ?? `https://${config.instance}-api.private.fin.ag`,
      "FLINKS_API_BASE_URL"
    );
    this.iframeBaseUrl = normalizeOrigin(
      config.iframeBaseUrl ?? `https://${config.instance}-iframe.private.fin.ag`,
      "FLINKS_IFRAME_BASE_URL"
    );
    this.http = options.http ?? new FetchFlinksHttpClient();
    this.now = options.now ?? (() => new Date());
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  public get environment(): "sandbox" | "development" | "production" {
    return this.config.environment;
  }

  public async createLinkToken(
    input: BankFeedProviderLinkInput
  ): Promise<BankFeedProviderLinkResult> {
    // Organization and user identifiers deliberately do not leave PennyWise:
    // Flinks Connect is the consent surface and its authorize token is not a
    // user profile or bank credential.
    void input;
    const token = await this.generateAuthorizeToken();
    return {
      linkToken: token,
      expiresAt: new Date(this.now().getTime() + AUTHORIZE_TOKEN_TTL_MS),
      connectionFlow: this.connectionFlow,
      hostedUrl: this.hostedConnectUrl(token)
    };
  }

  public exchangePublicToken(publicToken: string): Promise<BankFeedProviderExchangeResult> {
    const loginId = requiredOpaqueIdentifier(publicToken, "login identifier");
    // Do not persist Flinks' loginId in a public provider-reference column.
    // BankFeedService encrypts accessToken before storage; the item reference is
    // a stable one-way correlation value only.
    return Promise.resolve({
      accessToken: JSON.stringify({ version: 1, loginId }),
      providerItemReference: `flinks-${createHash("sha256").update(loginId).digest("hex").slice(0, 32)}`
    });
  }

  public async listAccounts(accessToken: string): Promise<readonly BankFeedProviderAccount[]> {
    const credential = parseCredential(accessToken);
    const session = await this.authorizeCached(credential.loginId);
    const summary = await this.fetchData("GetAccountsSummary", session.requestId, {
      RequestId: session.requestId,
      WithBalance: true
    });
    return records(summary.Accounts, "accounts").map(toProviderAccount);
  }

  public async sync(input: {
    readonly accessToken: string;
    readonly cursor: string | null;
  }): Promise<BankFeedProviderSyncResult> {
    void input.cursor;
    const credential = parseCredential(input.accessToken);
    const session = await this.authorizeCached(credential.loginId);
    // Fetch only fields required for reviewable accounting imports. In
    // particular, holder identity and account identity are intentionally not
    // requested by PennyWise.
    const detail = await this.fetchData("GetAccountsDetail", session.requestId, {
      RequestId: session.requestId,
      WithAccountIdentity: false,
      WithKYC: false,
      WithTransactions: true,
      DaysOfTransactions: "Days90"
    });
    const accounts = records(detail.Accounts, "accounts");
    const added = accounts.flatMap(toProviderTransactions);
    return {
      nextCursor: `flinks-${hashJson(
        accounts.map((account) => ({
          id: requiredText(account.Id, "account identifier"),
          transactions: records(account.Transactions ?? [], "transactions").map((transaction) =>
            requiredText(transaction.Id, "transaction identifier")
          )
        }))
      )}`,
      added,
      modified: [],
      // Flinks returns a full current observation, not a durable delta log.
      // Absence must never be interpreted as a provider removal.
      removed: [],
      providerRequestReference: session.requestId
    };
  }

  public async disconnect(accessToken: string): Promise<void> {
    const credential = parseCredential(accessToken);
    const response = await this.request(
      "DELETE",
      `DeleteCard/${encodeURIComponent(credential.loginId)}`,
      {
        "x-api-key": this.config.apiKey
      }
    );
    this.requireSuccess(response);
  }

  private async authorizeCached(loginId: string): Promise<{
    readonly requestId: string;
  }> {
    const authorizeToken = await this.generateAuthorizeToken();
    const response = await this.request(
      "POST",
      "Authorize",
      { "flinks-auth-key": authorizeToken },
      { LoginId: loginId, MostRecentCached: true }
    );
    this.requireSuccess(response);
    return { requestId: requiredText(response.body.RequestId, "request identifier") };
  }

  private async generateAuthorizeToken(): Promise<string> {
    const response = await this.request("POST", "GenerateAuthorizeToken", {
      "flinks-auth-key": this.config.secretKey
    });
    this.requireSuccess(response);
    return requiredText(response.body.Token, "authorize token");
  }

  private async fetchData(
    endpoint: "GetAccountsSummary" | "GetAccountsDetail",
    requestId: string,
    body: JsonRecord
  ): Promise<JsonRecord> {
    const response = await this.request(
      "POST",
      endpoint,
      { "x-api-key": this.config.apiKey },
      body
    );
    if (response.status === 200) return response.body;
    if (response.status !== 202) this.throwFlinksError(response);

    const asyncEndpoint = `${endpoint}Async/${encodeURIComponent(requestId)}`;
    for (let attempt = 0; attempt < ASYNC_POLL_MAX_ATTEMPTS; attempt += 1) {
      await this.sleep(ASYNC_POLL_INTERVAL_MS);
      const next = await this.request("GET", asyncEndpoint, { "x-api-key": this.config.apiKey });
      if (next.status === 200) return next.body;
      if (next.status !== 202) this.throwFlinksError(next);
    }
    throw new AppError(
      "BANK_FEED_PROVIDER_PROCESSING",
      "The bank is still preparing activity. Try the secure connection again shortly; no bank activity was changed.",
      503
    );
  }

  private hostedConnectUrl(token: string): string {
    const url = new URL("/v2/", this.iframeBaseUrl);
    url.searchParams.set("authorizeToken", token);
    // Flinks documents this parameter only for its public toolbox sandbox. It
    // must never be sent to an operator's development or production instance.
    if (this.config.environment === "sandbox") url.searchParams.set("demo", "true");
    return url.toString();
  }

  private async request(
    method: FlinksHttpRequest["method"],
    path: string,
    headers: Readonly<Record<string, string>>,
    body?: JsonRecord
  ): Promise<FlinksHttpResponse> {
    return this.http.request({
      method,
      url: `${this.apiBaseUrl}/v3/${encodeURIComponent(this.config.customerId)}/BankingServices/${path}`,
      headers: { accept: "application/json", "content-type": "application/json", ...headers },
      ...(body ? { body } : {})
    });
  }

  private requireSuccess(response: FlinksHttpResponse): void {
    if (response.status >= 200 && response.status < 300) return;
    this.throwFlinksError(response);
  }

  private throwFlinksError(response: FlinksHttpResponse): never {
    const code = optionalText(response.body.FlinksCode)?.toUpperCase();
    if (
      code === "SESSION_EXPIRED" ||
      code === "SESSION_NONEXISTENT" ||
      code === "INVALID_LOGIN" ||
      code === "UNAUTHORIZED"
    )
      throw new AppError(
        "BANK_FEED_CONSENT_EXPIRED",
        "Your bank needs you to reconnect it before PennyWise can refresh activity. No bank activity was changed.",
        409
      );
    if (code === "TOO_MANY_REQUESTS" || code === "T00_MANY_REQUESTS")
      throw new AppError(
        "BANK_FEED_RATE_LIMITED",
        "The bank-feed provider asked PennyWise to retry later. No bank activity was changed.",
        503
      );
    throw new AppError(
      "BANK_FEED_PROVIDER_ERROR",
      "The bank-feed provider could not complete the request. No bank activity was changed.",
      response.status >= 500 ? 503 : 422
    );
  }
}

export function flinksBankFeedAdapterFromEnvironment(
  environment: NodeJS.ProcessEnv
): FlinksBankFeedAdapter | undefined {
  const provider = environment.BANK_FEED_PROVIDER?.trim().toUpperCase();
  const flinksVariables = [
    environment.FLINKS_ENV,
    environment.FLINKS_INSTANCE,
    environment.FLINKS_CUSTOMER_ID,
    environment.FLINKS_SECRET_KEY,
    environment.FLINKS_API_KEY,
    environment.FLINKS_API_BASE_URL,
    environment.FLINKS_IFRAME_BASE_URL
  ];
  const configured = flinksVariables.some((value) => Boolean(value?.trim()));
  if (!provider && !configured) return undefined;
  if (provider !== "FLINKS")
    throw new Error("BANK_FEED_PROVIDER must be FLINKS when Flinks configuration is present.");
  const instance = environment.FLINKS_INSTANCE?.trim();
  const customerId = environment.FLINKS_CUSTOMER_ID?.trim();
  const secretKey = environment.FLINKS_SECRET_KEY?.trim();
  const apiKey = environment.FLINKS_API_KEY?.trim();
  const mode = environment.FLINKS_ENV?.trim().toLowerCase();
  if (!instance || !customerId || !secretKey || !apiKey || !mode)
    throw new Error(
      "Flinks requires FLINKS_ENV, FLINKS_INSTANCE, FLINKS_CUSTOMER_ID, FLINKS_SECRET_KEY, and FLINKS_API_KEY."
    );
  if (!isFlinksEnvironment(mode))
    throw new Error("FLINKS_ENV must be sandbox, development, or production.");
  const apiBaseUrl = optionalHttpsOrigin(environment.FLINKS_API_BASE_URL, "FLINKS_API_BASE_URL");
  const iframeBaseUrl = optionalHttpsOrigin(
    environment.FLINKS_IFRAME_BASE_URL,
    "FLINKS_IFRAME_BASE_URL"
  );
  return new FlinksBankFeedAdapter({
    instance,
    customerId,
    secretKey,
    apiKey,
    environment: mode,
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(iframeBaseUrl ? { iframeBaseUrl } : {})
  });
}

function toProviderAccount(account: JsonRecord): BankFeedProviderAccount {
  const accountNumber =
    optionalText(account.LastFourDigits) ?? lastFour(optionalText(account.AccountNumber));
  return {
    providerAccountReference: requiredText(account.Id, "account identifier"),
    displayName: optionalText(account.Title) ?? "Connected account",
    maskedAccountReference: accountNumber,
    currency: requiredCurrency(account.Currency),
    accountKind: accountKind(account.Type)
  };
}

function toProviderTransactions(account: JsonRecord): BankFeedProviderTransaction[] {
  const providerAccountReference = requiredText(account.Id, "account identifier");
  const currency = requiredCurrency(account.Currency);
  return records(account.Transactions ?? [], "transactions").map((transaction) => {
    const transactionId = requiredText(transaction.Id, "transaction identifier");
    const debit = optionalMinorUnits(transaction.Debit, "debit amount") ?? 0n;
    const credit = optionalMinorUnits(transaction.Credit, "credit amount") ?? 0n;
    if ((debit > 0n && credit > 0n) || (debit === 0n && credit === 0n))
      throw new AppError(
        "BANK_FEED_PROVIDER_INVALID_RESPONSE",
        "The bank-feed provider returned an invalid transaction amount.",
        502
      );
    const amountMinor = debit || credit;
    const source = { account: providerAccountReference, transaction };
    return {
      providerTransactionId: `${providerAccountReference}:${transactionId}`,
      providerAccountReference,
      postingDate: requiredDate(transaction.Date, "transaction date"),
      transactionDate: optionalDate(transaction.Date),
      description: optionalText(transaction.Description) ?? "Bank transaction",
      payee: null,
      memo: optionalText(transaction.Code),
      amountMinor,
      direction: debit > 0n ? "DEBIT" : "CREDIT",
      currency,
      balanceMinor: optionalMinorUnits(transaction.Balance, "balance"),
      rawFingerprint: createHash("sha256")
        .update(`flinks:${providerAccountReference}:${transactionId}`)
        .digest("hex"),
      payloadHash: hashJson(source)
    };
  });
}

function parseCredential(value: string): { readonly loginId: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1)
      throw new Error("Flinks credential version is invalid.");
    return { loginId: requiredOpaqueIdentifier(parsed.loginId, "login identifier") };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "BANK_FEED_CREDENTIAL_INVALID",
      "The bank connection credential cannot be read. Reconnect the bank before syncing.",
      409
    );
  }
}

function requiredOpaqueIdentifier(value: unknown, label: string): string {
  const result = requiredText(value, label);
  if (!/^[a-z0-9._-]+$/i.test(result) || result.length > 200)
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned an invalid ${label}.`,
      502
    );
  return result;
}

function requiredText(value: unknown, label: string): string {
  const result = optionalText(value);
  if (!result)
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned an invalid ${label}.`,
      502
    );
  return result;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredCurrency(value: unknown): string {
  const currency = optionalText(value)?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency))
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      "The bank-feed provider returned an invalid account currency.",
      502
    );
  return currency;
}

function accountKind(value: unknown): "BANK" | "CREDIT_CARD" {
  return optionalText(value)?.toLowerCase().includes("credit") ? "CREDIT_CARD" : "BANK";
}

function requiredDate(value: unknown, label: string): string {
  const date = optionalDate(value);
  if (!date)
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned an invalid ${label}.`,
      502
    );
  return date;
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1]! : null;
}

function optionalMinorUnits(value: unknown, label: string): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned an invalid ${label}.`,
      502
    );
  const [whole = "", fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry)))
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned invalid ${label}.`,
      502
    );
  return value as JsonRecord[];
}

function lastFour(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertConfig(config: FlinksBankFeedConfig): void {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(config.instance))
    throw new Error("FLINKS_INSTANCE must be a hostname-safe instance name.");
  for (const [name, value] of [
    ["FLINKS_CUSTOMER_ID", config.customerId],
    ["FLINKS_SECRET_KEY", config.secretKey],
    ["FLINKS_API_KEY", config.apiKey]
  ] as const) {
    if (!value.trim() || value.length > 512) throw new Error(`${name} is required.`);
  }
}

function isFlinksEnvironment(value: string): value is FlinksBankFeedConfig["environment"] {
  return value === "sandbox" || value === "development" || value === "production";
}

function optionalHttpsOrigin(value: string | undefined, name: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? normalizeOrigin(trimmed, name) : undefined;
}

function normalizeOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS origin.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error(
      `${name} must be an absolute HTTPS origin without credentials, path, query, or fragment.`
    );
  return url.origin;
}
