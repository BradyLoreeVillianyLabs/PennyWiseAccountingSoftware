import { createHmac } from "node:crypto";
import { AesPaymentAccountProtector } from "./services/payment-provider.js";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { WebhookHttpClient, WebhookSecretProtector } from "./services/webhook-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

class RecordingWebhookClient implements WebhookHttpClient {
  public readonly requests: Array<{
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
  }> = [];
  public statuses: number[] = [];

  public send(input: {
    readonly url: string;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<{ readonly status: number }> {
    this.requests.push(input);
    return { status: this.statuses.shift() ?? 204 };
  }
}

const httpClient = new RecordingWebhookClient();
const secretProtector: WebhookSecretProtector = new AesPaymentAccountProtector(
  "phase22-webhook-test-encryption-key"
);
const app = buildApp({
  prisma,
  webhookHttpClient: httpClient,
  webhookSecretProtector: secretProtector
});
const owner = "phase22-webhook-owner@example.test";

function headers(organizationId?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Phase 22 Webhook Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function createOrganization() {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "Webhook Test Ltd", displayName: "Webhook Test" }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function createOutboxEvent(organizationId: string, eventType: string, payload: object) {
  return prisma.outboxEvent.create({
    data: {
      organizationId,
      eventType,
      aggregateType: "WebhookFixture",
      aggregateId: "fixture-1",
      payload,
      status: "PENDING"
    }
  });
}

describe("Phase 22 signed outbound webhooks", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => {
    httpClient.requests.length = 0;
    httpClient.statuses = [];
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates one-time secrets, fans out outbox events, signs deliveries, retries, and preserves event identity", async () => {
    const organizationId = await createOrganization();
    const created = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/webhooks",
      headers: { ...headers(organizationId), "idempotency-key": "webhook-create-1" },
      payload: {
        name: "Test receiver",
        url: "http://127.0.0.1:9123/events",
        eventTypes: ["phase22.fixture"]
      }
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{
      endpoint: { id: string; apiVersion: string };
      secret: string;
      replayed: boolean;
    }>();
    expect(createdBody.secret).toMatch(/^whsec_/);
    expect(createdBody.replayed).toBe(false);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/webhooks",
      headers: { ...headers(organizationId), "idempotency-key": "webhook-create-1" },
      payload: {
        name: "Test receiver",
        url: "http://127.0.0.1:9123/events",
        eventTypes: ["phase22.fixture"]
      }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ secret: string | null }>().secret).toBe(null);

    const event = await createOutboxEvent(organizationId, "phase22.fixture", {
      invoiceId: "public-invoice-1",
      organizationId,
      secret: "must-not-leave"
    });
    const dispatch = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/webhooks/dispatch?limit=10",
      headers: headers(organizationId)
    });
    expect(dispatch.statusCode).toBe(200);
    expect(dispatch.json<{ fannedOut: number; attempted: number }>()).toEqual({
      fannedOut: 1,
      attempted: 1
    });
    expect(httpClient.requests).toHaveLength(1);
    const request = httpClient.requests[0]!;
    const timestamp = request.headers["x-clearledger-signature"]!.match(/^t=(\d+),v1=(.+)$/);
    if (!timestamp) throw new Error("Webhook signature header was malformed.");
    const timestampSeconds = timestamp[1];
    const signatureDigest = timestamp[2];
    if (!timestampSeconds || !signatureDigest) throw new Error("Webhook signature was incomplete.");
    const expected = createHmac("sha256", createdBody.secret)
      .update(`${timestampSeconds}.${request.body}`)
      .digest("hex");
    expect(signatureDigest).toBe(expected);
    const envelope = JSON.parse(request.body) as {
      id: string;
      type: string;
      version: string;
      data: Record<string, unknown>;
    };
    expect(envelope).toMatchObject({
      id: event.id,
      type: "phase22.fixture",
      version: createdBody.endpoint.apiVersion
    });
    expect(envelope.data).toEqual({ invoiceId: "public-invoice-1" });
    expect(request.headers["x-clearledger-event-id"]).toBe(event.id);

    const failedEvent = await createOutboxEvent(organizationId, "phase22.fixture", {
      sequence: "second"
    });
    httpClient.statuses = [503];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/organizations/current/webhooks/dispatch?limit=10",
          headers: headers(organizationId)
        })
      ).statusCode
    ).toBe(200);
    const failedDelivery = await prisma.webhookDelivery.findFirstOrThrow({
      where: { organizationId, eventId: failedEvent.id }
    });
    expect(failedDelivery.status).toBe("FAILED");
    await prisma.webhookDelivery.update({
      where: { id: failedDelivery.id },
      data: { nextAttemptAt: new Date(0) }
    });
    httpClient.statuses = [204];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/organizations/current/webhooks/dispatch?limit=10",
          headers: headers(organizationId)
        })
      ).statusCode
    ).toBe(200);
    const retried = await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: failedDelivery.id }
    });
    expect(retried.status).toBe("DELIVERED");
    expect(retried.attempts).toBe(2);
    expect(httpClient.requests.at(-1)?.headers["x-clearledger-event-id"]).toBe(failedEvent.id);
  });

  it("rotates, disables, isolates, and replays a dead-letter delivery", async () => {
    const organizationId = await createOrganization();
    const created = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/webhooks",
      headers: { ...headers(organizationId), "idempotency-key": "webhook-lifecycle-1" },
      payload: {
        name: "Lifecycle",
        url: "http://127.0.0.1:9123/events",
        eventTypes: ["phase22.lifecycle"]
      }
    });
    const body = created.json<{ endpoint: { id: string }; secret: string }>();
    const rotated = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/webhooks/${body.endpoint.id}/rotate`,
      headers: { ...headers(organizationId), "idempotency-key": "webhook-rotate-1" }
    });
    expect(rotated.statusCode).toBe(201);
    expect(rotated.json<{ secret: string }>().secret).not.toBe(body.secret);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/organizations/current/webhooks/${body.endpoint.id}/disable`,
          headers: headers(organizationId),
          payload: { reason: "maintenance" }
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/organizations/current/webhooks",
          headers: headers(organizationId)
        })
      ).json<{ endpoints: Array<{ status: string; disabledReason: string | null }> }>().endpoints[0]
        ?.disabledReason
    ).toBe("maintenance");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/organizations/current/webhooks/${body.endpoint.id}/enable`,
          headers: headers(organizationId)
        })
      ).statusCode
    ).toBe(200);

    const event = await createOutboxEvent(organizationId, "phase22.lifecycle", {
      value: "dead-letter"
    });
    httpClient.statuses = [400];
    await app.inject({
      method: "POST",
      url: "/v1/organizations/current/webhooks/dispatch?limit=10",
      headers: headers(organizationId)
    });
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({
      where: { organizationId, eventId: event.id }
    });
    expect(delivery.status).toBe("DEAD_LETTER");
    const replay = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/webhooks/${body.endpoint.id}/deliveries/${delivery.id}/replay`,
      headers: headers(organizationId)
    });
    expect(replay.statusCode).toBe(200);
    expect(
      replay.json<{ delivery: { status: string; attempts: number } }>().delivery
    ).toMatchObject({
      status: "PENDING",
      attempts: 0
    });
    const otherId = await createOrganization();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/organizations/current/webhooks",
          headers: headers(otherId)
        })
      ).json<{ endpoints: unknown[] }>().endpoints
    ).toHaveLength(0);
  });
});
