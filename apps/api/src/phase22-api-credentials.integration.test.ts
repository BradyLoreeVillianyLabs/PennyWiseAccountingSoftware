import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase22-owner@example.test";

function headers(organizationId?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Phase 22 Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

describe("Phase 22 API credentials", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates a scoped secret once, enforces scopes, isolates its organization, and supports rotation/revocation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Phase 22 Ltd", displayName: "Phase 22" }
    });
    expect(created.statusCode).toBe(201);
    const organizationId = created.json<{ organization: { id: string } }>().organization.id;

    const credentialResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/api-credentials",
      headers: { ...headers(organizationId), "idempotency-key": "phase22-create-1" },
      payload: { name: "CRM read-only", scopes: ["customers:read"] }
    });
    expect(credentialResponse.statusCode).toBe(201);
    const credentialBody = credentialResponse.json<{
      credential: { id: string; scopes: string[]; status: string };
      secret: string;
      replayed: boolean;
    }>();
    expect(credentialBody.secret).toMatch(/^cl_live_/);
    expect(credentialBody.credential.scopes).toContain("organizations:access");
    expect(credentialBody.replayed).toBe(false);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/api-credentials",
      headers: { ...headers(organizationId), "idempotency-key": "phase22-create-1" },
      payload: { name: "CRM read-only", scopes: ["customers:read"] }
    });
    expect(replay.statusCode).toBe(200);
    expect(
      replay.json<{ secret: string | null; credential: { id: string }; replayed: boolean }>().secret
    ).toBe(null);
    expect(replay.json<{ credential: { id: string } }>().credential.id).toBe(
      credentialBody.credential.id
    );

    const bearer = { authorization: `Bearer ${credentialBody.secret}` };
    const current = await app.inject({
      method: "GET",
      url: "/v1/organizations/current",
      headers: bearer
    });
    expect(current.statusCode).toBe(200);
    expect(current.json<{ organization: { id: string } }>().organization.id).toBe(organizationId);
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/sessions", headers: bearer })).statusCode
    ).toBe(403);

    const customerList = await app.inject({ method: "GET", url: "/v1/customers", headers: bearer });
    expect(customerList.statusCode).toBe(200);
    const customerCreate = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: bearer,
      payload: {
        customerNumber: "C-022",
        displayName: "Scope denied",
        email: "scope-denied@example.test",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    });
    expect(customerCreate.statusCode).toBe(403);

    const rotated = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/api-credentials/${credentialBody.credential.id}/rotate`,
      headers: { ...headers(organizationId), "idempotency-key": "phase22-rotate-1" }
    });
    expect(rotated.statusCode).toBe(201);
    const rotatedBody = rotated.json<{ credential: { id: string }; secret: string }>();
    expect(rotatedBody.secret).toMatch(/^cl_live_/);
    expect(rotatedBody.credential.id).not.toBe(credentialBody.credential.id);
    expect(
      (await app.inject({ method: "GET", url: "/v1/organizations/current", headers: bearer }))
        .statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/organizations/current",
          headers: { authorization: `Bearer ${rotatedBody.secret}` }
        })
      ).statusCode
    ).toBe(200);

    const revoked = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/api-credentials/${rotatedBody.credential.id}/revoke`,
      headers: headers(organizationId)
    });
    expect(revoked.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/organizations/current",
          headers: { authorization: `Bearer ${rotatedBody.secret}` }
        })
      ).statusCode
    ).toBe(401);
    expect(await prisma.apiCredential.count({ where: { organizationId } })).toBe(2);
    expect(
      await prisma.outboxEvent.count({
        where: {
          organizationId,
          eventType: { in: ["api.credential.created", "api.credential.rotated"] }
        }
      })
    ).toBe(2);
    expect(
      await prisma.authenticationAuditEvent.count({
        where: { organizationId, action: "API_CREDENTIAL_AUTHENTICATION", outcome: "SUCCESS" }
      })
    ).toBeGreaterThan(0);
  });
});
