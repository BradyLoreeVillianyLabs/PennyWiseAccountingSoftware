import { describe, expect, it } from "vitest";
import { bankFeedAdapterFromEnvironment } from "./bank-feed-adapter-config.js";

describe("bank-feed adapter configuration", () => {
  it("selects the local simulator only with its explicit opt-in", () => {
    expect(() =>
      bankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "PENNYWISE_TEST_BANK"
      })
    ).toThrow("PENNYWISE_ENABLE_TEST_BANK=true");

    const adapter = bankFeedAdapterFromEnvironment({
      BANK_FEED_PROVIDER: "PENNYWISE_TEST_BANK",
      PENNYWISE_ENABLE_TEST_BANK: "true",
      NODE_ENV: "test"
    });
    expect(adapter).toMatchObject({
      providerKey: "PENNYWISE_TEST_BANK",
      environment: "sandbox",
      testOnly: true,
      connectionFlow: "LOCAL_TEST"
    });
  });

  it("fails closed for a misplaced opt-in and unknown or incomplete providers", () => {
    expect(() => bankFeedAdapterFromEnvironment({ PENNYWISE_ENABLE_TEST_BANK: "true" })).toThrow(
      "requires BANK_FEED_PROVIDER"
    );

    expect(() => bankFeedAdapterFromEnvironment({ BANK_FEED_PROVIDER: "NOT_A_PROVIDER" })).toThrow(
      "must be PLAID"
    );

    expect(() =>
      bankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "PLAID",
        PLAID_CLIENT_ID: "client",
        PLAID_SECRET: "secret"
      })
    ).toThrow("PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV");

    expect(() =>
      bankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "FLINKS",
        FLINKS_ENV: "sandbox",
        FLINKS_INSTANCE: "toolbox"
      })
    ).toThrow("Flinks requires");
  });

  it("selects Flinks only with a complete, explicit configuration", () => {
    const adapter = bankFeedAdapterFromEnvironment({
      BANK_FEED_PROVIDER: "FLINKS",
      FLINKS_ENV: "sandbox",
      FLINKS_INSTANCE: "toolbox",
      FLINKS_CUSTOMER_ID: "customer-id",
      FLINKS_SECRET_KEY: "secret-key",
      FLINKS_API_KEY: "api-key"
    });
    expect(adapter).toMatchObject({
      providerKey: "FLINKS",
      environment: "sandbox",
      connectionFlow: "HOSTED_CONSENT"
    });
  });

  it("leaves bank feeds unconfigured when no provider is selected", () => {
    expect(bankFeedAdapterFromEnvironment({})).toBeUndefined();
  });
});
