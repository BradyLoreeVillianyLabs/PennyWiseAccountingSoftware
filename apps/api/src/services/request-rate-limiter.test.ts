import { describe, expect, it } from "vitest";
import { DevelopmentRequestRateLimiter } from "./request-rate-limiter.js";

describe("DevelopmentRequestRateLimiter", () => {
  it("partitions limits by scope and caller key", async () => {
    const limiter = new DevelopmentRequestRateLimiter();
    const policy = { limit: 1, windowMilliseconds: 60_000 };
    await limiter.check({ scope: "exports", key: "actor-a", ...policy });
    await expect(
      limiter.check({ scope: "exports", key: "actor-a", ...policy })
    ).rejects.toMatchObject({
      code: "REQUEST_RATE_LIMITED",
      statusCode: 429
    });
    await expect(
      limiter.check({ scope: "exports", key: "actor-b", ...policy })
    ).resolves.toBeUndefined();
    await expect(
      limiter.check({ scope: "imports", key: "actor-a", ...policy })
    ).resolves.toBeUndefined();
  });
});
