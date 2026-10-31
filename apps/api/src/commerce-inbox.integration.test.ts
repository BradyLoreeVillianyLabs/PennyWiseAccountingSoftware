import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { ConnectorAdapter } from "./services/connector-runtime-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const adapter: ConnectorAdapter = {
  providerKey: "FIXTURE",
  validateCredentials: () => Promise.resolve(),
  checkHealth: () => Promise.resolve("HEALTHY")
};
const etsyAdapter: ConnectorAdapter = {
  providerKey: "ETSY",
  validateCredentials: () => Promise.resolve(),
  checkHealth: () => Promise.resolve("HEALTHY")
};
const app = buildApp({ prisma, connectorAdapters: [adapter, etsyAdapter] });
const owner = "commerce-inbox-owner@example.test";
const headers = (organizationId?: string) => ({
  "x-clearledger-user-email": owner,
  "x-clearledger-user-name": "Commerce Inbox Owner",
  ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
});

describe("MCFX-17 commerce inbox", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("deduplicates raw events and keeps normalization non-posting", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Inbox Ltd", displayName: "Inbox" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const draft = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: { providerKey: "FIXTURE", displayName: "Fixture", mapping: {} }
    });
    const installationId = draft.json<{ connector: { id: string } }>().connector.id;
    const payload = {
      installationId,
      providerKey: "FIXTURE",
      shopExternalId: "shop-1",
      externalEventId: "event-1",
      resourceType: "ORDER",
      resourceId: "order-1",
      eventType: "order.updated",
      sourceCurrency: "USD",
      rawPayload: { total: "100.00", currency: "USD" }
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json<{ replayed: boolean }>().replayed).toBe(true);
    const eventId = first.json<{ event: { id: string; version: number } }>().event.id;
    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/commerce/inbox/${eventId}/review`,
      headers: headers(organizationId),
      payload: {
        version: 1,
        status: "NORMALIZED",
        normalizedPayload: {
          schemaVersion: 1,
          provider: "FIXTURE",
          transactionKind: "ORDER",
          externalId: "order-1",
          currencies: { source: "USD", payment: null, settlement: null },
          issues: [],
          amountMinor: "10000"
        }
      }
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json<{ event: { status: string; version: number } }>().event).toMatchObject({
      status: "NORMALIZED",
      version: 2
    });
    const changedVersion = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload: { ...payload, eventVersion: "2", rawPayload: { total: "101.00", currency: "USD" } }
    });
    expect(changedVersion.statusCode, changedVersion.body).toBe(201);

    const identityCollision = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload: { ...payload, rawPayload: { total: "999.00", currency: "USD" } }
    });
    expect(identityCollision.statusCode, identityCollision.body).toBe(409);
    expect(identityCollision.json<{ integrityConflict: boolean }>().integrityConflict).toBe(true);
    expect(
      await prisma.connectorConflict.count({
        where: { organizationId, kind: "EVENT_IDENTITY_COLLISION", status: "OPEN" }
      })
    ).toBe(1);
    const concurrentPayload = {
      ...payload,
      externalEventId: "event-concurrent",
      eventVersion: "1"
    };
    const concurrent = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/organizations/current/commerce/inbox",
        headers: headers(organizationId),
        payload: concurrentPayload
      }),
      app.inject({
        method: "POST",
        url: "/v1/organizations/current/commerce/inbox",
        headers: headers(organizationId),
        payload: concurrentPayload
      })
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(await prisma.commerceInboxEvent.count({ where: { organizationId } })).toBe(3);
    await expect(
      prisma.commerceInboxEvent.update({
        where: { id: eventId },
        data: { rawPayload: { total: "tampered" } }
      })
    ).rejects.toThrow(/raw evidence is immutable/i);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("deduplicates an Etsy poll followed by a webhook without losing webhook evidence", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Etsy Inbox Ltd", displayName: "Etsy Inbox" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const connector = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: { providerKey: "ETSY", displayName: "Etsy fixture", mapping: {} }
    });
    const installationId = connector.json<{ connector: { id: string } }>().connector.id;
    const eventVersion = "2026-08-01T12:00:00.000Z";
    const receipt = { receipt_id: 13579, grandtotal: { amount: 12625, divisor: 100 } };

    const polled = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload: {
        installationId,
        providerKey: "ETSY",
        shopExternalId: "24681012",
        externalEventId: `poll:receipt:13579:${eventVersion}`,
        resourceType: "ORDER",
        resourceId: "13579",
        eventType: "order.paid",
        eventVersion,
        rawPayload: receipt
      }
    });
    const webhook = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload: {
        installationId,
        providerKey: "ETSY",
        shopExternalId: "24681012",
        externalEventId: `poll:receipt:13579:${eventVersion}`,
        resourceType: "ORDER",
        resourceId: "13579",
        eventType: "order.paid",
        eventVersion,
        rawPayload: { webhook: { id: "etsy-delivery-101" }, receipt }
      }
    });

    expect(polled.statusCode, polled.body).toBe(201);
    expect(webhook.statusCode, webhook.body).toBe(200);
    expect(webhook.json<{ replayed: boolean; integrityConflict?: boolean }>()).toMatchObject({
      replayed: true
    });
    expect(webhook.body).not.toContain("integrityConflict");
    expect(await prisma.commerceInboxEvent.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
    const stored = await prisma.commerceInboxEvent.findFirstOrThrow({ where: { organizationId } });
    expect(stored.rawPayload).toMatchObject(receipt);
  });

  it("recognizes a legacy Etsy webhook identity when polling catches up later", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Legacy Etsy Ltd", displayName: "Legacy Etsy" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const connector = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: { providerKey: "ETSY", displayName: "Legacy Etsy fixture", mapping: {} }
    });
    const installationId = connector.json<{ connector: { id: string } }>().connector.id;
    const eventVersion = "2026-08-01T12:00:00.000Z";
    const receipt = { receipt_id: 24680, grandtotal: { amount: 5000, divisor: 100 } };
    const webhook = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload: {
        installationId,
        providerKey: "ETSY",
        shopExternalId: "24681012",
        externalEventId: "webhook:legacy-etsy-delivery",
        resourceType: "ORDER",
        resourceId: "24680",
        eventType: "order.paid",
        eventVersion,
        rawPayload: { webhook: { id: "legacy-etsy-delivery" }, receipt }
      }
    });
    const poll = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox",
      headers: headers(organizationId),
      payload: {
        installationId,
        providerKey: "ETSY",
        shopExternalId: "24681012",
        externalEventId: `poll:receipt:24680:${eventVersion}`,
        resourceType: "ORDER",
        resourceId: "24680",
        eventType: "order.paid",
        eventVersion,
        rawPayload: receipt
      }
    });

    expect(webhook.statusCode, webhook.body).toBe(201);
    expect(poll.statusCode, poll.body).toBe(200);
    expect(poll.json<{ replayed: boolean; integrityConflict?: boolean }>()).toMatchObject({
      replayed: true
    });
    expect(poll.body).not.toContain("integrityConflict");
    expect(await prisma.commerceInboxEvent.count({ where: { organizationId } })).toBe(1);
  });

  it("enables only the released CAD/USD pair independently of commerce adapters", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Currency Ltd", displayName: "Currency" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const current = await app.inject({
      method: "GET",
      url: "/v1/settings/multi-currency",
      headers: headers(organizationId)
    });
    expect(current.statusCode).toBe(200);
    const currentSettings = current.json<{
      multiCurrency: { version: number };
    }>().multiCurrency;
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/settings/multi-currency",
      headers: headers(organizationId),
      payload: {
        version: currentSettings.version,
        enabled: true,
        rateMode: "MANUAL",
        currencies: ["CAD", "USD"]
      }
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const enabled = saved.json<{
      multiCurrency: { version: number; enabled: boolean };
    }>().multiCurrency;
    expect(enabled.enabled).toBe(true);
    const unsupported = await app.inject({
      method: "PUT",
      url: "/v1/settings/multi-currency",
      headers: headers(organizationId),
      payload: {
        version: enabled.version,
        enabled: true,
        rateMode: "MANUAL",
        currencies: ["CAD", "USD", "EUR"]
      }
    });
    expect(unsupported.statusCode, unsupported.body).toBe(422);
    expect(unsupported.json<{ error: { code: string } }>().error.code).toBe(
      "CURRENCY_NOT_RELEASED"
    );
    const unchanged = await app.inject({
      method: "GET",
      url: "/v1/settings/multi-currency",
      headers: headers(organizationId)
    });
    expect(unchanged.json<{ multiCurrency: { enabled: boolean } }>().multiCurrency.enabled).toBe(
      true
    );
  });
});
