import { describe, expect, it } from "vitest";
import { AppError } from "@clearledger/shared";
import {
  FlinksBankFeedAdapter,
  flinksBankFeedAdapterFromEnvironment,
  type FlinksHttpClient,
  type FlinksHttpRequest,
  type FlinksHttpResponse
} from "./flinks-bank-feed-adapter.js";

class RecordingHttpClient implements FlinksHttpClient {
  public readonly calls: FlinksHttpRequest[] = [];

  public constructor(
    private readonly respond: (
      input: FlinksHttpRequest
    ) => FlinksHttpResponse | Promise<FlinksHttpResponse>
  ) {}

  public request(input: FlinksHttpRequest): Promise<FlinksHttpResponse> {
    this.calls.push(input);
    return Promise.resolve(this.respond(input));
  }
}

const config = {
  instance: "toolbox",
  customerId: "customer-id",
  secretKey: "flinks-secret-key",
  apiKey: "flinks-api-key",
  environment: "sandbox" as const,
  apiBaseUrl: "https://flinks-api.example.test",
  iframeBaseUrl: "https://flinks-iframe.example.test"
};

describe("FlinksBankFeedAdapter", () => {
  it("creates a hosted sandbox Connect URL without sending PennyWise identity or banking credentials", async () => {
    const http = new RecordingHttpClient(() => ({
      status: 200,
      body: { HttpStatusCode: 200, Token: "short-lived-authorize-token" }
    }));
    const adapter = new FlinksBankFeedAdapter(config, { http });

    const link = await adapter.createLinkToken({ organizationId: "org-1", userId: "user-1" });

    expect(link).toMatchObject({
      linkToken: "short-lived-authorize-token",
      connectionFlow: "HOSTED_CONSENT"
    });
    expect(link.hostedUrl).toBe(
      "https://flinks-iframe.example.test/v2/?authorizeToken=short-lived-authorize-token&demo=true"
    );
    expect(http.calls).toEqual([
      {
        method: "POST",
        url: "https://flinks-api.example.test/v3/customer-id/BankingServices/GenerateAuthorizeToken",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "flinks-auth-key": "flinks-secret-key"
        }
      }
    ]);
    expect(JSON.stringify(http.calls)).not.toMatch(/org-1|user-1|password|username/i);
  });

  it("uses cached Flinks authorization and maps account and transaction evidence without account identity", async () => {
    const http = new RecordingHttpClient((request) => {
      if (request.url.endsWith("/GenerateAuthorizeToken"))
        return { status: 200, body: { Token: "authorize-token" } };
      if (request.url.endsWith("/Authorize")) {
        expect(request.body).toEqual({ LoginId: "login-123", MostRecentCached: true });
        expect(request.headers["flinks-auth-key"]).toBe("authorize-token");
        return {
          status: 200,
          body: {
            RequestId: "request-123",
            Institution: "FlinksCapital",
            InstitutionId: 14
          }
        };
      }
      if (request.url.endsWith("/GetAccountsSummary"))
        return {
          status: 200,
          body: {
            Accounts: [
              {
                Id: "account-chequing",
                Title: "Main chequing",
                LastFourDigits: "0142",
                Type: "Chequing",
                Currency: "CAD"
              },
              {
                Id: "account-card",
                Title: "Operating card",
                AccountNumber: "123456789099",
                Type: "CreditCard",
                Currency: "USD"
              }
            ]
          }
        };
      if (request.url.endsWith("/GetAccountsDetail"))
        return {
          status: 200,
          body: {
            Accounts: [
              {
                Id: "account-chequing",
                Currency: "CAD",
                Transactions: [
                  {
                    Id: "debit-1",
                    Date: "2026-09-10",
                    Description: "Office supplies",
                    Code: "POS",
                    Debit: 12.34,
                    Credit: 0,
                    Balance: 500.1
                  },
                  {
                    Id: "credit-1",
                    Date: "2026-09-09T10:00:00.000Z",
                    Description: "Customer receipt",
                    Debit: 0,
                    Credit: "105.00",
                    Balance: "605.10"
                  }
                ]
              }
            ]
          }
        };
      throw new Error(`Unexpected Flinks request: ${request.url}`);
    });
    const adapter = new FlinksBankFeedAdapter(config, { http });
    const exchanged = await adapter.exchangePublicToken("login-123");

    expect(exchanged.providerItemReference).toMatch(/^flinks-[a-f0-9]{32}$/);
    expect(exchanged.providerItemReference).not.toContain("login-123");
    expect(exchanged.accessToken).not.toContain("password");

    const accounts = await adapter.listAccounts(exchanged.accessToken);
    expect(accounts).toEqual([
      {
        providerAccountReference: "account-chequing",
        displayName: "Main chequing",
        maskedAccountReference: "0142",
        currency: "CAD",
        accountKind: "BANK"
      },
      {
        providerAccountReference: "account-card",
        displayName: "Operating card",
        maskedAccountReference: "9099",
        currency: "USD",
        accountKind: "CREDIT_CARD"
      }
    ]);

    const sync = await adapter.sync({ accessToken: exchanged.accessToken, cursor: null });
    expect(sync.nextCursor).toMatch(/^flinks-[a-f0-9]{64}$/);
    expect(sync).toMatchObject({
      providerRequestReference: "request-123",
      removed: []
    });
    expect(sync.added).toMatchObject([
      {
        providerTransactionId: "account-chequing:debit-1",
        amountMinor: 1234n,
        direction: "DEBIT",
        balanceMinor: 50010n,
        currency: "CAD"
      },
      {
        providerTransactionId: "account-chequing:credit-1",
        postingDate: "2026-09-09",
        amountMinor: 10500n,
        direction: "CREDIT",
        balanceMinor: 60510n,
        currency: "CAD"
      }
    ]);
    const detailCall = http.calls.find((call) => call.url.endsWith("/GetAccountsDetail"));
    expect(detailCall?.body).toEqual({
      RequestId: "request-123",
      WithAccountIdentity: false,
      WithKYC: false,
      WithTransactions: true,
      DaysOfTransactions: "Days90"
    });
    expect(detailCall?.headers["x-api-key"]).toBe("flinks-api-key");
  });

  it("polls an asynchronous account summary and maps expired consent to a reconnect request", async () => {
    let summaryPolls = 0;
    const waits: number[] = [];
    const http = new RecordingHttpClient((request) => {
      if (request.url.endsWith("/GenerateAuthorizeToken"))
        return { status: 200, body: { Token: "token" } };
      if (request.url.endsWith("/Authorize"))
        return { status: 200, body: { RequestId: "request-id" } };
      if (request.url.endsWith("/GetAccountsSummary")) {
        summaryPolls += 1;
        return { status: 202, body: { FlinksCode: "OPERATION_PENDING", RequestId: "request-id" } };
      }
      if (request.url.endsWith("/GetAccountsSummaryAsync/request-id"))
        return {
          status: 200,
          body: {
            Accounts: [
              {
                Id: "account-1",
                Title: "Chequing",
                Type: "Chequing",
                Currency: "CAD"
              }
            ]
          }
        };
      throw new Error(`Unexpected Flinks request: ${request.url}`);
    });
    const adapter = new FlinksBankFeedAdapter(config, {
      http,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      }
    });
    const exchange = await adapter.exchangePublicToken("login-async");

    await expect(adapter.listAccounts(exchange.accessToken)).resolves.toHaveLength(1);
    expect(summaryPolls).toBe(1);
    expect(waits).toEqual([10_000]);

    const expired = new FlinksBankFeedAdapter(config, {
      http: new RecordingHttpClient((request) => {
        if (request.url.endsWith("/GenerateAuthorizeToken"))
          return { status: 200, body: { Token: "token" } };
        return { status: 401, body: { FlinksCode: "SESSION_EXPIRED" } };
      })
    });
    await expect(expired.listAccounts(exchange.accessToken)).rejects.toMatchObject({
      code: "BANK_FEED_CONSENT_EXPIRED",
      statusCode: 409
    } satisfies Partial<AppError>);
  });

  it("fails closed for missing or misplaced Flinks configuration", () => {
    expect(() =>
      flinksBankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "FLINKS",
        FLINKS_ENV: "sandbox",
        FLINKS_INSTANCE: "toolbox"
      })
    ).toThrow("Flinks requires");
    expect(() =>
      flinksBankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "PLAID",
        FLINKS_ENV: "sandbox"
      })
    ).toThrow("must be FLINKS");
  });
});
