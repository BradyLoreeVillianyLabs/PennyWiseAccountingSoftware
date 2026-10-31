import { describe, expect, it } from "vitest";
import { DevelopmentWebhookRateLimiter } from "./webhook-rate-limiter.js";

describe("DevelopmentWebhookRateLimiter", () => {
  it("limits one caller without affecting another", async () => {
    const limiter = new DevelopmentWebhookRateLimiter(1, 60_000);
    await limiter.check("first");
    await expect(limiter.check("first")).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_RATE_LIMITED",
      statusCode: 429
    });
    await expect(limiter.check("second")).resolves.toBeUndefined();
  });
});
