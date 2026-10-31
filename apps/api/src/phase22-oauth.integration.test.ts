import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPkceChallenge } from "./auth/security.js";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase22-oauth-owner@example.test";

function headers(organizationId?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Phase 22 OAuth Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

function tokenPayload(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

describe("Phase 22 OAuth installations", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("requires consent and PKCE, exchanges a one-time code, rotates refresh tokens, scopes access, and revokes issued tokens", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "OAuth Test Ltd", displayName: "OAuth Test" }
    });
    expect(organization.statusCode).toBe(201);
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;

    const clientResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/oauth-clients",
      headers: { ...headers(organizationId), "idempotency-key": "oauth-client-create-1" },
      payload: {
        name: "Example CRM",
        redirectUris: ["http://127.0.0.1:9123/oauth/callback"],
        allowedScopes: ["customers:read"]
      }
    });
    expect(clientResponse.statusCode).toBe(201);
    const client = clientResponse.json<{
      client: { id: string; clientId: string; allowedScopes: string[] };
      clientSecret: string;
      replayed: boolean;
    }>();
    expect(client.clientSecret).toMatch(/^cl_app_secret_/);
    expect(client.client.allowedScopes).toContain("organizations:access");
    expect(client.replayed).toBe(false);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/oauth-clients",
      headers: { ...headers(organizationId), "idempotency-key": "oauth-client-create-1" },
      payload: {
        name: "Example CRM",
        redirectUris: ["http://127.0.0.1:9123/oauth/callback"],
        allowedScopes: ["customers:read"]
      }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ clientSecret: string | null; replayed: boolean }>().clientSecret).toBe(
      null
    );

    const verifier = "phase22-oauth-code-verifier-abcdefghijklmnopqrstuvwxyz";
    const authorized = await app.inject({
      method: "POST",
      url: "/v1/oauth/authorize",
      headers: headers(organizationId),
      payload: {
        clientId: client.client.clientId,
        redirectUri: "http://127.0.0.1:9123/oauth/callback",
        scopes: ["customers:read"],
        codeChallenge: createPkceChallenge(verifier),
        state: "opaque-application-state",
        consent: true
      }
    });
    expect(authorized.statusCode).toBe(200);
    const callback = new URL(
      authorized.json<{ authorization: { redirectUri: string } }>().authorization.redirectUri
    );
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(callback.searchParams.get("state")).toBe("opaque-application-state");

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/v1/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: tokenPayload({
        grant_type: "authorization_code",
        client_id: client.client.clientId,
        client_secret: client.clientSecret,
        code: code!,
        redirect_uri: "http://127.0.0.1:9123/oauth/callback",
        code_verifier: verifier
      })
    });
    expect(tokenResponse.statusCode).toBe(200);
    const tokens = tokenResponse.json<{
      access_token: string;
      refresh_token: string;
      scope: string;
    }>();
    expect(tokens.access_token).toMatch(/^cl_oat_/);
    expect(tokens.refresh_token).toMatch(/^cl_ort_/);
    expect(tokens.scope).toContain("customers:read");

    const bearer = { authorization: `Bearer ${tokens.access_token}` };
    expect(
      (await app.inject({ method: "GET", url: "/v1/organizations/current", headers: bearer }))
        .statusCode
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/customers", headers: bearer })).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/customers",
          headers: bearer,
          payload: {
            customerNumber: "OAUTH-001",
            displayName: "Scope denied",
            email: "scope-denied@example.test",
            defaultPaymentTermsDays: 30,
            defaultCurrency: "CAD"
          }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/organizations/current/oauth-clients",
          headers: bearer
        })
      ).statusCode
    ).toBe(403);

    const rotation = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/oauth-clients/${client.client.id}/rotate`,
      headers: { ...headers(organizationId), "idempotency-key": "oauth-client-rotate-1" }
    });
    expect(rotation.statusCode).toBe(201);
    const rotatedClient = rotation.json<{
      client: { id: string; clientId: string };
      clientSecret: string;
      replayed: boolean;
    }>();
    expect(rotatedClient.client.id).toBe(client.client.id);
    expect(rotatedClient.client.clientId).toBe(client.client.clientId);
    expect(rotatedClient.clientSecret).toMatch(/^cl_app_secret_/);
    expect(rotatedClient.clientSecret).not.toBe(client.clientSecret);
    const rotationReplay = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/oauth-clients/${client.client.id}/rotate`,
      headers: { ...headers(organizationId), "idempotency-key": "oauth-client-rotate-1" }
    });
    expect(rotationReplay.statusCode).toBe(200);
    expect(
      rotationReplay.json<{ clientSecret: string | null; replayed: boolean }>().clientSecret
    ).toBe(null);
    expect(rotationReplay.json<{ replayed: boolean }>().replayed).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/oauth/token",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          payload: tokenPayload({
            grant_type: "refresh_token",
            client_id: client.client.clientId,
            client_secret: client.clientSecret,
            refresh_token: tokens.refresh_token
          })
        })
      ).statusCode
    ).toBe(401);

    const refresh = await app.inject({
      method: "POST",
      url: "/v1/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: tokenPayload({
        grant_type: "refresh_token",
        client_id: client.client.clientId,
        client_secret: rotatedClient.clientSecret,
        refresh_token: tokens.refresh_token
      })
    });
    expect(refresh.statusCode).toBe(200);
    const refreshed = refresh.json<{ access_token: string; refresh_token: string }>();
    expect(refreshed.access_token).toMatch(/^cl_oat_/);
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/oauth/token",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          payload: tokenPayload({
            grant_type: "refresh_token",
            client_id: client.client.clientId,
            client_secret: rotatedClient.clientSecret,
            refresh_token: tokens.refresh_token
          })
        })
      ).statusCode
    ).toBe(401);

    const revoked = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/oauth-clients/${client.client.id}/revoke`,
      headers: headers(organizationId)
    });
    expect(revoked.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/organizations/current",
          headers: { authorization: `Bearer ${refreshed.access_token}` }
        })
      ).statusCode
    ).toBe(401);
    expect(await prisma.oAuthAuthorizationCode.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.oAuthAccessToken.count({ where: { organizationId } })).toBe(2);
    expect(await prisma.oAuthRefreshToken.count({ where: { organizationId } })).toBe(2);
    expect(
      await prisma.outboxEvent.count({
        where: { organizationId, eventType: "oauth.client.secret_rotated" }
      })
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId, action: "OAUTH_CLIENT_SECRET_ROTATED" }
      })
    ).toBe(1);
  });

  it("rejects dangerous delegated scopes and an authorization request without explicit consent", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "OAuth Boundaries Ltd", displayName: "OAuth Boundaries" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/organizations/current/oauth-clients",
          headers: { ...headers(organizationId), "idempotency-key": "oauth-dangerous-scope" },
          payload: {
            name: "Unsafe integration",
            redirectUris: ["http://127.0.0.1:9123/oauth/callback"],
            allowedScopes: ["integrations:manage"]
          }
        })
      ).statusCode
    ).toBe(422);

    const safeClient = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/oauth-clients",
      headers: { ...headers(organizationId), "idempotency-key": "oauth-safe-client" },
      payload: {
        name: "Safe integration",
        redirectUris: ["http://127.0.0.1:9123/oauth/callback"],
        allowedScopes: ["customers:read"]
      }
    });
    expect(safeClient.statusCode).toBe(201);
    const clientId = safeClient.json<{ client: { clientId: string } }>().client.clientId;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/oauth/authorize",
          headers: headers(organizationId),
          payload: {
            clientId,
            redirectUri: "http://127.0.0.1:9123/oauth/callback",
            scopes: ["customers:read"],
            codeChallenge: "a".repeat(43),
            consent: false
          }
        })
      ).statusCode
    ).toBe(400);
  });
});
