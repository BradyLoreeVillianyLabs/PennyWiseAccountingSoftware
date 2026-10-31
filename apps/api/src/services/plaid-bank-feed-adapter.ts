import { createHash } from "node:crypto";
import { AppError } from "@clearledger/shared";
import { hashJson } from "../utils/json.js";
import type {
  BankFeedProviderAccount,
  BankFeedProviderAdapter,
  BankFeedProviderExchangeResult,
  BankFeedProviderLinkInput,
  BankFeedProviderRemoval,
  BankFeedProviderSyncResult,
  BankFeedProviderTransaction
} from "./bank-feed-provider.js";

type JsonRecord = Record<string, unknown>;

export interface BankFeedHttpClient {
  post(url: string, body: JsonRecord): Promise<JsonRecord>;
}

export interface PlaidBankFeedConfig {
  readonly clientId: string;
  readonly secret: string;
  readonly environment: "sandbox" | "development" | "production";
  readonly webhookUrl?: string | undefined;
  readonly redirectUri?: string | undefined;
}

export class FetchBankFeedHttpClient implements BankFeedHttpClient {
  public async post(url: string, body: JsonRecord): Promise<JsonRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = (await response.json().catch(() => ({}))) as JsonRecord;
      if (!response.ok) throw plaidError(payload, response.status);
      return payload;
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
 * Plaid's hosted Link is the only user-authentication surface. This adapter
 * holds the application secret server-side and returns only short-lived Link
 * tokens to the browser.
 */
export class PlaidBankFeedAdapter implements BankFeedProviderAdapter {
  public readonly providerKey = "PLAID";

  public constructor(
    private readonly config: PlaidBankFeedConfig,
    private readonly http: BankFeedHttpClient = new FetchBankFeedHttpClient()
  ) {}

  public get environment(): "sandbox" | "development" | "production" {
    return this.config.environment;
  }

  public async createLinkToken(input: BankFeedProviderLinkInput) {
    const response = await this.post("/link/token/create", {
      user: { client_user_id: `pennywise:${input.organizationId}:${input.userId}` },
      client_name: "PennyWise Accounting",
      products: ["transactions"],
      country_codes: ["CA", "US"],
      language: "en",
      ...(this.config.webhookUrl ? { webhook: this.config.webhookUrl } : {}),
      ...(this.config.redirectUri ? { redirect_uri: this.config.redirectUri } : {}),
      ...(input.accessToken ? { access_token: input.accessToken } : {})
    });
    const linkToken = requiredText(response.link_token, "link token");
    const expiration = requiredText(response.expiration, "link-token expiration");
    const expiresAt = new Date(expiration);
    if (Number.isNaN(expiresAt.getTime()))
      throw new AppError(
        "BANK_FEED_PROVIDER_INVALID_RESPONSE",
        "The bank-feed provider returned an invalid Link expiry.",
        502
      );
    return { linkToken, expiresAt };
  }

  public async exchangePublicToken(publicToken: string): Promise<BankFeedProviderExchangeResult> {
    const response = await this.post("/item/public_token/exchange", {
      public_token: publicToken
    });
    return {
      accessToken: requiredText(response.access_token, "access token"),
      providerItemReference: requiredText(response.item_id, "item identifier")
    };
  }

  public async listAccounts(accessToken: string): Promise<readonly BankFeedProviderAccount[]> {
    const response = await this.post("/accounts/get", { access_token: accessToken });
    const accounts = arrayOfRecords(response.accounts, "accounts");
    return accounts.map((account) => {
      const balances = record(account.balances) ?? {};
      const currency = text(
        balances.iso_currency_code ?? balances.unofficial_currency_code
      )?.toUpperCase();
      const kind = text(account.type) === "credit" ? "CREDIT_CARD" : "BANK";
      return {
        providerAccountReference: requiredText(account.account_id, "account identifier"),
        displayName: text(account.name) ?? text(account.official_name) ?? "Connected account",
        maskedAccountReference: text(account.mask),
        currency: currency ?? "",
        accountKind: kind
      };
    });
  }

  public async sync(input: {
    readonly accessToken: string;
    readonly cursor: string | null;
  }): Promise<BankFeedProviderSyncResult> {
    const initialCursor = input.cursor;
    let cursor = input.cursor;
    const added: BankFeedProviderTransaction[] = [];
    const modified: BankFeedProviderTransaction[] = [];
    const removed: BankFeedProviderRemoval[] = [];
    let providerRequestReference: string | undefined;

    for (let page = 0; page < 100; page += 1) {
      const response = await this.post("/transactions/sync", {
        access_token: input.accessToken,
        ...(cursor ? { cursor } : {})
      });
      providerRequestReference = text(response.request_id) ?? providerRequestReference;
      added.push(...arrayOfRecords(response.added, "added transactions").map(toTransaction));
      modified.push(
        ...arrayOfRecords(response.modified, "modified transactions").map(toTransaction)
      );
      removed.push(...arrayOfRecords(response.removed, "removed transactions").map(toRemoval));
      const nextCursor = requiredText(response.next_cursor, "next cursor");
      if (response.has_more !== true)
        return { nextCursor, added, modified, removed, providerRequestReference };
      cursor = nextCursor;
    }

    throw new AppError(
      "BANK_FEED_SYNC_PAGE_LIMIT",
      "The bank-feed response was larger than the configured safety limit. No bank activity was changed.",
      503,
      { restartFromCursor: initialCursor !== null }
    );
  }

  public async disconnect(accessToken: string): Promise<void> {
    await this.post("/item/remove", { access_token: accessToken });
  }

  private post(path: string, body: JsonRecord): Promise<JsonRecord> {
    return this.http.post(`${baseUrl(this.config.environment)}${path}`, {
      client_id: this.config.clientId,
      secret: this.config.secret,
      ...body
    });
  }
}

export function plaidBankFeedAdapterFromEnvironment(
  environment: NodeJS.ProcessEnv
): PlaidBankFeedAdapter | undefined {
  const provider = environment.BANK_FEED_PROVIDER?.trim().toUpperCase();
  const anyPlaidValue = [
    environment.PLAID_CLIENT_ID,
    environment.PLAID_SECRET,
    environment.PLAID_ENV,
    environment.BANK_FEED_PROVIDER
  ].some((value) => Boolean(value?.trim()));
  if (!provider && !anyPlaidValue) return undefined;
  if (provider !== "PLAID")
    throw new Error("BANK_FEED_PROVIDER must be PLAID when bank feeds are configured.");
  const clientId = environment.PLAID_CLIENT_ID?.trim();
  const secret = environment.PLAID_SECRET?.trim();
  const mode = environment.PLAID_ENV?.trim().toLowerCase();
  if (!clientId || !secret || !mode)
    throw new Error("Plaid requires PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV.");
  if (!isPlaidEnvironment(mode))
    throw new Error("PLAID_ENV must be sandbox, development, or production.");
  const webhookUrl = optionalHttpsUrl(environment.BANK_FEED_WEBHOOK_URL, "BANK_FEED_WEBHOOK_URL");
  const redirectUri = optionalHttpsUrl(environment.PLAID_REDIRECT_URI, "PLAID_REDIRECT_URI");
  return new PlaidBankFeedAdapter({
    clientId,
    secret,
    environment: mode,
    ...(webhookUrl ? { webhookUrl } : {}),
    ...(redirectUri ? { redirectUri } : {})
  });
}

function toTransaction(value: JsonRecord): BankFeedProviderTransaction {
  const providerTransactionId = requiredText(value.transaction_id, "transaction identifier");
  const providerAccountReference = requiredText(value.account_id, "transaction account identifier");
  const amountMinor = minorUnits(value.amount);
  if (amountMinor === 0n)
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      "The bank-feed provider returned a zero-value transaction.",
      502
    );
  const currency = text(value.iso_currency_code)?.toUpperCase() ?? "";
  return {
    providerTransactionId,
    providerAccountReference,
    postingDate: requiredDate(value.date, "transaction date"),
    transactionDate: optionalDate(value.authorized_date),
    description: text(value.name) ?? text(value.merchant_name) ?? "Bank transaction",
    payee: text(value.merchant_name),
    memo: text(value.original_description),
    amountMinor: amountMinor < 0n ? -amountMinor : amountMinor,
    // Plaid represents a positive amount as money leaving the account.
    direction: amountMinor < 0n ? "CREDIT" : "DEBIT",
    currency,
    balanceMinor: null,
    rawFingerprint: createHash("sha256")
      .update(`plaid:${providerAccountReference}:${providerTransactionId}`)
      .digest("hex"),
    payloadHash: hashJson(value)
  };
}

function toRemoval(value: JsonRecord): BankFeedProviderRemoval {
  return {
    providerTransactionId: requiredText(value.transaction_id, "removed transaction identifier"),
    providerAccountReference: requiredText(
      value.account_id,
      "removed transaction account identifier"
    )
  };
}

function plaidError(payload: JsonRecord, status: number): AppError {
  const code = text(payload.error_code);
  if (code === "ITEM_LOGIN_REQUIRED" || code === "ITEM_LOCKED")
    return new AppError(
      "BANK_FEED_CONSENT_EXPIRED",
      "Your bank needs you to reconnect it before PennyWise can refresh activity. No bank activity was changed.",
      409
    );
  if (code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")
    return new AppError(
      "BANK_FEED_SYNC_RESTART_REQUIRED",
      "The bank changed activity while it was being read. Retry the sync; no partial activity was added.",
      409
    );
  if (code === "RATE_LIMIT_EXCEEDED")
    return new AppError(
      "BANK_FEED_RATE_LIMITED",
      "The bank-feed provider asked PennyWise to retry later. No bank activity was changed.",
      503
    );
  return new AppError(
    "BANK_FEED_PROVIDER_ERROR",
    "The bank-feed provider could not complete the request. No bank activity was changed.",
    status >= 500 ? 503 : 422
  );
}

function baseUrl(environment: "sandbox" | "development" | "production"): string {
  return `https://${environment}.plaid.com`;
}

function minorUnits(value: unknown): bigint {
  const textValue =
    typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(textValue))
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      "The bank-feed provider returned an invalid transaction amount.",
      502
    );
  const negative = textValue.startsWith("-");
  const [wholeRaw = "", fractionRaw = ""] = (negative ? textValue.slice(1) : textValue).split(".");
  const minor = BigInt(wholeRaw) * 100n + BigInt(fractionRaw.padEnd(2, "0"));
  return negative ? -minor : minor;
}

function arrayOfRecords(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || value.some((entry) => !record(entry)))
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned invalid ${label}.`,
      502
    );
  return value as JsonRecord[];
}

function requiredText(value: unknown, label: string): string {
  const result = text(value);
  if (!result)
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned an invalid ${label}.`,
      502
    );
  return result;
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function requiredDate(value: unknown, label: string): string {
  const result = optionalDate(value);
  if (!result)
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      `The bank-feed provider returned an invalid ${label}.`,
      502
    );
  return result;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPlaidEnvironment(value: string): value is "sandbox" | "development" | "production" {
  return value === "sandbox" || value === "development" || value === "production";
}

function optionalHttpsUrl(value: string | undefined, name: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
    throw new Error(
      `${name} must be an absolute HTTPS URL without embedded credentials or fragments.`
    );
  return parsed.toString();
}
