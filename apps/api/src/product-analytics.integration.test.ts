import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });

function headers(email: string, organizationId?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function createOrganization(email: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(email),
    payload: { legalName: `${displayName} Ltd`, displayName }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

describe("consented privacy-safe product analytics", () => {
  const owner = "analytics-owner@example.test";

  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("requires per-organization consent, preserves its withdrawal, and stores no event payload", async () => {
    const organizationId = await createOrganization(owner, "Analytics One");
    const initially = await app.inject({
      method: "GET",
      url: "/v1/product-analytics/consent",
      headers: headers(owner, organizationId)
    });
    expect(initially.statusCode).toBe(200);
    expect(initially.json<{ consent: { enabled: boolean } }>().consent.enabled).toBe(false);

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: headers(owner, organizationId),
      payload: {
        clientEventId: randomUUID(),
        eventType: "MIGRATION_PREVIEW_COMPLETED",
        eventVersion: 1
      }
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe(
      "PRODUCT_ANALYTICS_CONSENT_REQUIRED"
    );

    const granted = await app.inject({
      method: "PUT",
      url: "/v1/product-analytics/consent",
      headers: headers(owner, organizationId),
      payload: { enabled: true }
    });
    expect(granted.statusCode).toBe(200);
    expect(
      granted.json<{ consent: { enabled: boolean; consentedAt: string | null } }>().consent
    ).toMatchObject({
      enabled: true
    });

    const rejectedHistoricalEvent = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: headers(owner, organizationId),
      payload: {
        clientEventId: randomUUID(),
        eventType: "MIGRATION_DRY_RUN_COMPLETED",
        eventVersion: 1,
        occurredAt: new Date(Date.now() - 60_000).toISOString()
      }
    });
    expect(rejectedHistoricalEvent.statusCode).toBe(409);
    expect(rejectedHistoricalEvent.json<{ error: { code: string } }>().error.code).toBe(
      "PRODUCT_EVENT_PRECONSENT"
    );

    const clientEventId = randomUUID();
    const rejectedPayload = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: headers(owner, organizationId),
      payload: {
        clientEventId,
        eventType: "MIGRATION_DRY_RUN_COMPLETED",
        eventVersion: 1,
        amountMinor: "99999"
      }
    });
    expect(rejectedPayload.statusCode).toBe(400);

    const event = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: headers(owner, organizationId),
      payload: {
        clientEventId,
        eventType: "MIGRATION_DRY_RUN_COMPLETED",
        eventVersion: 1
      }
    });
    expect(event.statusCode, event.body).toBe(202);
    const stored = await prisma.productEvent.findFirstOrThrow({ where: { organizationId } });
    expect(Object.keys(stored).sort()).toEqual(
      [
        "clientEventId",
        "createdAt",
        "eventType",
        "eventVersion",
        "id",
        "occurredAt",
        "organizationId"
      ].sort()
    );
    const replay = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: headers(owner, organizationId),
      payload: {
        clientEventId,
        eventType: "MIGRATION_DRY_RUN_COMPLETED",
        eventVersion: 1
      }
    });
    expect(replay.statusCode).toBe(202);
    expect(await prisma.productEvent.count({ where: { organizationId, clientEventId } })).toBe(1);

    const withdrawn = await app.inject({
      method: "PUT",
      url: "/v1/product-analytics/consent",
      headers: headers(owner, organizationId),
      payload: { enabled: false }
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(
      withdrawn.json<{ consent: { enabled: boolean; withdrawnAt: string | null } }>().consent
    ).toMatchObject({
      enabled: false
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          organizationId,
          action: {
            in: ["PRODUCT_ANALYTICS_CONSENT_GRANTED", "PRODUCT_ANALYTICS_CONSENT_WITHDRAWN"]
          }
        }
      })
    ).toBe(2);
    expect(await prisma.productEvent.count({ where: { organizationId } })).toBe(0);

    const afterWithdrawal = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: headers(owner, organizationId),
      payload: {
        clientEventId: randomUUID(),
        eventType: "CLOSE_READINESS_VIEWED",
        eventVersion: 1
      }
    });
    expect(afterWithdrawal.statusCode).toBe(409);
  });

  it("keeps consent and events tenant-scoped", async () => {
    const organizationId = await createOrganization(owner, "Analytics One");
    const secondOrganizationId = await createOrganization(owner, "Analytics Two");
    await app.inject({
      method: "PUT",
      url: "/v1/product-analytics/consent",
      headers: headers(owner, organizationId),
      payload: { enabled: true }
    });

    const secondConsent = await app.inject({
      method: "GET",
      url: "/v1/product-analytics/consent",
      headers: headers(owner, secondOrganizationId)
    });
    expect(secondConsent.statusCode).toBe(200);
    expect(secondConsent.json<{ consent: { enabled: boolean } }>().consent.enabled).toBe(false);

    const memberEmail = "analytics-member@example.test";
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/invitations",
      headers: headers(owner, organizationId),
      payload: { email: memberEmail, role: "READ_ONLY" }
    });
    expect(invitation.statusCode).toBe(201);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: headers(memberEmail),
      payload: { token: invitation.json<{ token: string }>().token }
    });
    expect(accepted.statusCode).toBe(200);
    const memberRead = await app.inject({
      method: "GET",
      url: "/v1/product-analytics/consent",
      headers: headers(memberEmail, organizationId)
    });
    expect(memberRead.statusCode).toBe(200);
    expect(memberRead.json<{ consent: { enabled: boolean } }>().consent.enabled).toBe(true);
    const memberWrite = await app.inject({
      method: "PUT",
      url: "/v1/product-analytics/consent",
      headers: headers(memberEmail, organizationId),
      payload: { enabled: false }
    });
    expect(memberWrite.statusCode).toBe(403);

    const intruder = "analytics-intruder@example.test";
    await createOrganization(intruder, "Intruder");
    const denied = await app.inject({
      method: "GET",
      url: "/v1/product-analytics/consent",
      headers: headers(intruder, organizationId)
    });
    // Organization selection intentionally conceals whether an organization
    // exists when the caller is not a member.
    expect(denied.statusCode).toBe(404);
  });
});
