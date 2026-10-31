import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@clearledger/shared";
import {
  FetchBankFeedHttpClient,
  PlaidBankFeedAdapter,
  plaidBankFeedAdapterFromEnvironment,
  type BankFeedHttpClient
} from "./plaid-bank-feed-adapter.js";

type JsonRecord = Record<string, unknown>;

class RecordingHttpClient implements BankFeedHttpClient {
  public readonly calls: Array<{ url: string; body: JsonRecord }> = [];

  public constructor(
    private readonly respond: (url: string, body: JsonRecord) => Promise<JsonRecord> | JsonRecord
  ) {}

  public post(url: string, body: JsonRecord): Promise<JsonRecord> {
    this.calls.push({ url, body });
    return Promise.resolve(this.respond(url, body));
  }
}

describe("PlaidBankFeedAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a Canada/US Transactions Link token without collecting banking credentials", async () => {
    const http = new RecordingHttpClient(() => ({
      link_token: "link-sandbox-token",
      expiration: "2026-12-31T00:00:00.000Z"
    }));
    const adapter = new PlaidBankFeedAdapter(
      {
        clientId: "plaid-client-id",
        secret: "plaid-server-secret",
        environment: "sandbox",
        webhookUrl: "https://beta.example.test/api/v1/bank-feed-webhooks/plaid",
        redirectUri: "https://beta.example.test/banking"
      },
      http
    );

    const token = await adapter.createLinkToken({
      organizationId: "org-1",
      userId: "user-1"
    });

    expect(token).toMatchObject({ linkToken: "link-sandbox-token" });
    expect(http.calls).toEqual([
      {
        url: "https://sandbox.plaid.com/link/token/create",
        body: {
          client_id: "plaid-client-id",
          secret: "plaid-server-secret",
          user: { client_user_id: "pennywise:org-1:user-1" },
          client_name: "PennyWise Accounting",
          products: ["transactions"],
          country_codes: ["CA", "US"],
          language: "en",
          webhook: "https://beta.example.test/api/v1/bank-feed-webhooks/plaid",
          redirect_uri: "https://beta.example.test/banking"
        }
      }
    ]);
    expect(JSON.stringify(http.calls[0]?.body)).not.toMatch(/password|username|credential/i);
  });

  it("paginates provider deltas and preserves exact debit, credit, and removal evidence", async () => {
    const http = new RecordingHttpClient((url, body) => {
      if (!url.endsWith("/transactions/sync")) throw new Error(`Unexpected request ${url}`);
      if (!body.cursor)
        return {
          request_id: "request-page-1",
          added: [
            {
              transaction_id: "transaction-debit",
              account_id: "account-1",
              date: "2026-08-01",
              authorized_date: "2026-07-31",
              name: "Office supplies",
              merchant_name: "Office Depot",
              original_description: "CARD OFFICE DEPOT",
              amount: 12.34,
              iso_currency_code: "CAD"
            }
          ],
          modified: [],
          removed: [],
          next_cursor: "cursor-page-1",
          has_more: true
        };
      return {
        request_id: "request-page-2",
        added: [],
        modified: [
          {
            transaction_id: "transaction-credit",
            account_id: "account-1",
            date: "2026-08-02",
            name: "Customer refund",
            amount: "-2.50",
            iso_currency_code: "CAD"
          }
        ],
        removed: [{ transaction_id: "transaction-removed", account_id: "account-1" }],
        next_cursor: "cursor-final",
        has_more: false
      };
    });
    const adapter = new PlaidBankFeedAdapter(
      { clientId: "client", secret: "secret", environment: "sandbox" },
      http
    );

    const result = await adapter.sync({ accessToken: "access-token", cursor: null });

    expect(http.calls.map((call) => call.body.cursor ?? null)).toEqual([null, "cursor-page-1"]);
    expect(result).toMatchObject({
      nextCursor: "cursor-final",
      providerRequestReference: "request-page-2",
      removed: [
        { providerTransactionId: "transaction-removed", providerAccountReference: "account-1" }
      ]
    });
    expect(result.added[0]).toMatchObject({
      providerTransactionId: "transaction-debit",
      postingDate: "2026-08-01",
      transactionDate: "2026-07-31",
      description: "Office supplies",
      payee: "Office Depot",
      amountMinor: 1234n,
      direction: "DEBIT",
      currency: "CAD"
    });
    expect(result.modified[0]).toMatchObject({
      providerTransactionId: "transaction-credit",
      amountMinor: 250n,
      direction: "CREDIT",
      currency: "CAD"
    });
    expect(result.added[0]?.rawFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.added[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps consent loss to a safe reconnect request and validates public configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
      )
    );
    await expect(
      new FetchBankFeedHttpClient().post("https://sandbox.plaid.com/transactions/sync", {})
    ).rejects.toMatchObject({
      code: "BANK_FEED_CONSENT_EXPIRED",
      statusCode: 409
    } satisfies Partial<AppError>);

    expect(() =>
      plaidBankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "PLAID",
        PLAID_CLIENT_ID: "client",
        PLAID_SECRET: "secret",
        PLAID_ENV: "sandbox",
        BANK_FEED_WEBHOOK_URL: "http://not-secure.example.test"
      })
    ).toThrow(/BANK_FEED_WEBHOOK_URL must be an absolute HTTPS URL/);
  });
});
