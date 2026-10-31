import { describe, expect, it } from "vitest";
import { AppError } from "@clearledger/shared";
import { buildApp, productionLogRedactionPaths } from "./app.js";

describe("Phase 13 HTTP security hardening", () => {
  it("redacts credential, token, signature, body, and session-cookie log paths", () => {
    expect(productionLogRedactionPaths).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-export-token",
        "req.headers.stripe-signature",
        "req.body",
        "res.headers.set-cookie"
      ])
    );
  });

  it("sets security headers and accepts only bounded correlation identifiers", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
        headers: { "x-request-id": "security-check_1" }
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-request-id"]).toBe("security-check_1");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["content-security-policy"]).toContain("default-src 'none'");

      const unsafe = await app.inject({
        method: "GET",
        url: "/health",
        headers: { "x-request-id": "contains a space" }
      });
      expect(unsafe.headers["x-request-id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    } finally {
      await app.close();
    }
  });

  it("rejects cookie-authenticated state changes without an allowed origin", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { cookie: "clearledger_session=test" },
        payload: { legalName: "Blocked", displayName: "Blocked" }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("CSRF_ORIGIN_INVALID");
    } finally {
      await app.close();
    }
  });

  it("enforces injected production-style rate limits before expensive auth work", async () => {
    const app = buildApp({
      requestRateLimiter: {
        check: () =>
          Promise.reject(
            new AppError("REQUEST_RATE_LIMITED", "Too many requests. Try again later.", 429)
          )
      }
    });
    await app.ready();
    try {
      const response = await app.inject({ method: "GET", url: "/v1/auth/sign-in" });
      expect(response.statusCode).toBe(429);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("REQUEST_RATE_LIMITED");
    } finally {
      await app.close();
    }
  });

  it("keys cookie-authenticated limits from the session token, not unrelated cookies", async () => {
    const keys: string[] = [];
    const app = buildApp({
      requestRateLimiter: {
        check: ({ key }) => {
          keys.push(key);
          return Promise.resolve();
        }
      }
    });
    await app.ready();
    try {
      await app.inject({
        method: "GET",
        url: "/v1/auth/sign-in",
        headers: { cookie: "clearledger_session=stable; arbitrary=first" }
      });
      await app.inject({
        method: "GET",
        url: "/v1/auth/sign-in",
        headers: { cookie: "arbitrary=second; clearledger_session=stable" }
      });
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
    } finally {
      await app.close();
    }
  });
});
