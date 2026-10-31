import { describe, expect, it } from "vitest";
import { PrismaClient } from "@clearledger/db";
import { BankFeedService } from "./bank-feed-service.js";

describe("bank-feed capability boundary", () => {
  it("fails closed without a configured provider while retaining manual imports", () => {
    const service = new BankFeedService(new PrismaClient());
    expect(service.providerStatus()).toEqual({
      configured: false,
      providerKey: null,
      environment: null,
      connectEnabled: false,
      connectionFlow: null,
      testOnly: false,
      supportsHostedConsent: true,
      supportedCurrencies: ["CAD", "USD"],
      automaticPosting: false,
      manualFallback: ["CSV", "OFX", "QFX"],
      boundary:
        "Connected bank feeds are not configured. CSV, OFX, and QFX imports remain available."
    });
  });
});
