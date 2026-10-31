import { describe, expect, it } from "vitest";
import { AppError } from "@clearledger/shared";
import {
  PennyWiseTestBankFeedAdapter,
  pennyWiseTestBankFeedAdapterFromEnvironment
} from "./pennywise-test-bank-feed-adapter.js";

const now = () => new Date("2026-08-13T12:00:00.000Z");

describe("PennyWise local test-bank adapter", () => {
  it("requires explicit opt-in and rejects production", () => {
    expect(() =>
      pennyWiseTestBankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "PENNYWISE_TEST_BANK",
        NODE_ENV: "development"
      })
    ).toThrow("PENNYWISE_ENABLE_TEST_BANK=true");

    expect(() =>
      pennyWiseTestBankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "PENNYWISE_TEST_BANK",
        PENNYWISE_ENABLE_TEST_BANK: "true",
        NODE_ENV: "production"
      })
    ).toThrow("available only outside production");

    expect(
      pennyWiseTestBankFeedAdapterFromEnvironment({
        BANK_FEED_PROVIDER: "PENNYWISE_TEST_BANK",
        PENNYWISE_ENABLE_TEST_BANK: "true",
        NODE_ENV: "development"
      })
    ).toBeInstanceOf(PennyWiseTestBankFeedAdapter);
  });

  it("issues an opaque one-use token and exposes only safe simulated accounts", async () => {
    const adapter = new PennyWiseTestBankFeedAdapter({ now });
    const link = await adapter.createLinkToken({ organizationId: "org-1", userId: "user-1" });

    expect(link.linkToken).toMatch(/^pwtb-link-/);
    expect(link.linkToken).not.toContain("org-1");
    expect(link.connectionFlow).toBe("LOCAL_TEST");
    expect(link.providerAccounts).toEqual([
      expect.objectContaining({
        providerAccountReference: "pwtb-cad-chequing",
        currency: "CAD",
        accountKind: "BANK"
      }),
      expect.objectContaining({
        providerAccountReference: "pwtb-cad-credit-card",
        currency: "CAD",
        accountKind: "CREDIT_CARD"
      }),
      expect.objectContaining({ currency: "USD", accountKind: "BANK" })
    ]);
    expect(JSON.stringify(link)).not.toMatch(/password|secret|accessToken/i);

    await adapter.exchangePublicToken(link.linkToken);
    await expect(adapter.exchangePublicToken(link.linkToken)).rejects.toMatchObject({
      code: "BANK_FEED_TEST_LINK_EXPIRED"
    });
  });

  it("returns deterministic simulated activity once, then an empty replay", async () => {
    const adapter = new PennyWiseTestBankFeedAdapter({ now });
    const link = await adapter.createLinkToken({ organizationId: "org-1", userId: "user-1" });
    const connection = await adapter.exchangePublicToken(link.linkToken);

    const first = await adapter.sync({ accessToken: connection.accessToken, cursor: null });
    expect(first.nextCursor).toBe("pwtb-cursor-1");
    expect(first.added).toHaveLength(3);
    expect(first.added.map((item) => item.description)).toEqual([
      "PennyWise test activity - customer payment",
      "PennyWise test activity - software expense",
      "PennyWise test activity - office supplies"
    ]);
    expect(first.added.every((item) => item.memo?.includes("No financial institution"))).toBe(true);

    const replay = await adapter.sync({
      accessToken: connection.accessToken,
      cursor: first.nextCursor
    });
    expect(replay.added).toEqual([]);
    expect(replay.modified).toEqual([]);
    expect(replay.removed).toEqual([]);
  });

  it("rejects invalid tokens and cursors and disconnects deterministically", async () => {
    const adapter = new PennyWiseTestBankFeedAdapter({ now });
    await expect(adapter.exchangePublicToken("not-a-test-link")).rejects.toMatchObject({
      code: "BANK_FEED_TEST_LINK_EXPIRED"
    } satisfies Partial<AppError>);

    const link = await adapter.createLinkToken({ organizationId: "org-1", userId: "user-1" });
    const connection = await adapter.exchangePublicToken(link.linkToken);
    await expect(
      adapter.sync({ accessToken: connection.accessToken, cursor: "invalid-cursor" })
    ).rejects.toMatchObject({ code: "BANK_FEED_TEST_CURSOR_INVALID" });

    await adapter.disconnect(connection.accessToken);
    await expect(adapter.listAccounts(connection.accessToken)).rejects.toMatchObject({
      code: "BANK_FEED_TEST_CONNECTION_INVALID"
    });
    await adapter.disconnect(connection.accessToken);
  });
});
