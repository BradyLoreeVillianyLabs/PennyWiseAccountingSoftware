import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const originalBetaRuntime = process.env.CLEARLEDGER_BETA_RUNTIME;

afterEach(() => {
  if (originalBetaRuntime === undefined) delete process.env.CLEARLEDGER_BETA_RUNTIME;
  else process.env.CLEARLEDGER_BETA_RUNTIME = originalBetaRuntime;
});

describe("packaged beta HTTP security mode", () => {
  it("fails startup closed without an explicitly selected request limiter", () => {
    process.env.CLEARLEDGER_BETA_RUNTIME = "true";
    expect(() => buildApp()).toThrow("Hardened runtime request rate limiter adapter is required");
  });

  it("uses hardened headers and suppresses development error details", async () => {
    process.env.CLEARLEDGER_BETA_RUNTIME = "true";
    const app = buildApp({
      requestRateLimiter: { check: () => Promise.resolve() }
    });
    app.get("/__beta-runtime-error", () => {
      throw new Error("sensitive beta diagnostic");
    });
    await app.ready();
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.headers["strict-transport-security"]).toContain("max-age=63072000");

      const failure = await app.inject({ method: "GET", url: "/__beta-runtime-error" });
      expect(failure.statusCode).toBe(500);
      expect(failure.body).not.toContain("sensitive beta diagnostic");
      expect(failure.json<{ error: { details?: unknown } }>().error.details).toEqual({});
    } finally {
      await app.close();
    }
  });
});
