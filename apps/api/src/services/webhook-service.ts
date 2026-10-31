import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  Prisma,
  withTenantTransaction,
  type PrismaClient,
  type WebhookDelivery,
  type WebhookEndpoint
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { createOpaqueToken, hashOpaqueToken } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";

export const supportedWebhookApiVersion = "2026-07-01";
const webhookSecretPrefix = "whsec_";
const maximumAttempts = 8;
const automaticDisableAfterFailures = 3;

export interface WebhookSecretProtector {
  protect(value: string): string;
  reveal(value: string): string;
}

export interface WebhookHttpClient {
  send(input: {
    readonly url: string;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<{ readonly status: number }>;
}

export class FetchWebhookHttpClient implements WebhookHttpClient {
  public async send(input: {
    readonly url: string;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<{ readonly status: number }> {
    const response = await fetch(input.url, {
      method: "POST",
      body: input.body,
      headers: input.headers,
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    return { status: response.status };
  }
}

export interface WebhookEndpointInput {
  readonly name: string;
  readonly url: string;
  readonly eventTypes: readonly string[];
}

export class WebhookService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly secretProtector: WebhookSecretProtector,
    private readonly httpClient: WebhookHttpClient = new FetchWebhookHttpClient()
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listEndpoints(context: OrganizationContext) {
    await this.authorization.assert(context, "webhooks:read", "WebhookEndpoint");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const endpoints = await tx.webhookEndpoint.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: "desc" }
      });
      return endpoints.map(endpointDto);
    });
  }

  public async createEndpoint(
    context: OrganizationContext,
    input: WebhookEndpointInput,
    idempotencyKey: string
  ) {
    await this.authorization.assert(context, "webhooks:manage", "WebhookEndpoint");
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey)
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    const name = input.name.trim();
    if (!name || name.length > 120)
      throw new AppError("WEBHOOK_NAME_INVALID", "Webhook endpoint name is invalid.", 422);
    const url = validateWebhookUrl(input.url);
    const eventTypes = normalizeEventTypes(input.eventTypes);
    const creationKeyHash = hashOpaqueToken(normalizedKey);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const replay = await tx.webhookEndpoint.findUnique({
        where: {
          organizationId_creationKeyHash: {
            organizationId: context.organizationId,
            creationKeyHash
          }
        }
      });
      if (replay) {
        return {
          statusCode: 200,
          body: { endpoint: endpointDto(replay), secret: null, replayed: true },
          resourceId: replay.id
        };
      }

      const secret = webhookSecretPrefix + createOpaqueToken(32);
      const endpoint = await tx.webhookEndpoint.create({
        data: {
          organizationId: context.organizationId,
          createdByUserId: context.user.id,
          name,
          url,
          keyPrefix: secret.slice(0, 20),
          secretCiphertext: this.secretProtector.protect(secret),
          creationKeyHash,
          eventTypes: [...eventTypes]
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "webhook.endpoint.created",
          aggregateType: "WebhookEndpoint",
          aggregateId: endpoint.id,
          payload: { endpointId: endpoint.id, eventTypes: [...eventTypes] }
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "WEBHOOK_ENDPOINT_CREATED",
          targetType: "WebhookEndpoint",
          targetId: endpoint.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { name, url, eventTypes: [...eventTypes] })
        }
      });
      return {
        statusCode: 201,
        body: { endpoint: endpointDto(endpoint), secret, replayed: false },
        resourceId: endpoint.id
      };
    });
  }

  public async rotateEndpoint(
    context: OrganizationContext,
    endpointId: string,
    idempotencyKey: string
  ) {
    await this.authorization.assert(context, "webhooks:manage", "WebhookEndpoint", endpointId);
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey)
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    const creationKeyHash = hashOpaqueToken(normalizedKey);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const replay = await tx.webhookEndpoint.findUnique({
        where: {
          organizationId_creationKeyHash: {
            organizationId: context.organizationId,
            creationKeyHash
          }
        }
      });
      if (replay) {
        return {
          statusCode: 200,
          body: { endpoint: endpointDto(replay), secret: null, replayed: true },
          resourceId: replay.id
        };
      }
      const current = await tx.webhookEndpoint.findFirst({
        where: { id: endpointId, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("WEBHOOK_ENDPOINT_NOT_FOUND", "Webhook endpoint was not found.", 404);
      const secret = webhookSecretPrefix + createOpaqueToken(32);
      const replacement = await tx.webhookEndpoint.update({
        where: { id: current.id },
        data: {
          secretCiphertext: this.secretProtector.protect(secret),
          keyPrefix: secret.slice(0, 20),
          creationKeyHash
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "webhook.endpoint.rotated",
          aggregateType: "WebhookEndpoint",
          aggregateId: current.id,
          payload: { endpointId: current.id }
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "WEBHOOK_ENDPOINT_ROTATED",
          targetType: "WebhookEndpoint",
          targetId: current.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {})
        }
      });
      return {
        statusCode: 201,
        body: { endpoint: endpointDto(replacement), secret, replayed: false },
        resourceId: replacement.id
      };
    });
  }

  public async disableEndpoint(context: OrganizationContext, endpointId: string, reason?: string) {
    await this.authorization.assert(context, "webhooks:manage", "WebhookEndpoint", endpointId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({
        where: { id: endpointId, organizationId: context.organizationId }
      });
      if (!endpoint)
        throw new AppError("WEBHOOK_ENDPOINT_NOT_FOUND", "Webhook endpoint was not found.", 404);
      const updated = await tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          status: "DISABLED",
          disabledAt: new Date(),
          disabledReason:
            reason?.trim().slice(0, 500) || "Disabled by an organization administrator."
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "WEBHOOK_ENDPOINT_DISABLED",
          targetType: "WebhookEndpoint",
          targetId: endpoint.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { reason: updated.disabledReason })
        }
      });
      return endpointDto(updated);
    });
  }

  public async enableEndpoint(context: OrganizationContext, endpointId: string) {
    await this.authorization.assert(context, "webhooks:manage", "WebhookEndpoint", endpointId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({
        where: { id: endpointId, organizationId: context.organizationId }
      });
      if (!endpoint)
        throw new AppError("WEBHOOK_ENDPOINT_NOT_FOUND", "Webhook endpoint was not found.", 404);
      const updated = await tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { status: "ACTIVE", disabledAt: null, disabledReason: null, consecutiveFailures: 0 }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "WEBHOOK_ENDPOINT_ENABLED",
          targetType: "WebhookEndpoint",
          targetId: endpoint.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {})
        }
      });
      return endpointDto(updated);
    });
  }

  public async listDeliveries(context: OrganizationContext, endpointId: string, limit = 100) {
    await this.authorization.assert(context, "webhooks:read", "WebhookEndpoint", endpointId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({
        where: { id: endpointId, organizationId: context.organizationId },
        select: { id: true }
      });
      if (!endpoint)
        throw new AppError("WEBHOOK_ENDPOINT_NOT_FOUND", "Webhook endpoint was not found.", 404);
      const deliveries = await tx.webhookDelivery.findMany({
        where: { organizationId: context.organizationId, endpointId },
        orderBy: { createdAt: "desc" },
        take: Math.min(Math.max(limit, 1), 100)
      });
      return deliveries.map(deliveryDto);
    });
  }

  public async replayDelivery(
    context: OrganizationContext,
    endpointId: string,
    deliveryId: string
  ) {
    await this.authorization.assert(context, "webhooks:manage", "WebhookEndpoint", endpointId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const delivery = await tx.webhookDelivery.findFirst({
        where: { id: deliveryId, endpointId, organizationId: context.organizationId }
      });
      if (!delivery)
        throw new AppError("WEBHOOK_DELIVERY_NOT_FOUND", "Webhook delivery was not found.", 404);
      if (delivery.status !== "DEAD_LETTER" && delivery.status !== "FAILED")
        throw new AppError(
          "WEBHOOK_DELIVERY_NOT_REPLAYABLE",
          "Only failed deliveries can be replayed.",
          409
        );
      const updated = await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "WEBHOOK_DELIVERY_REPLAYED",
          targetType: "WebhookDelivery",
          targetId: delivery.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { endpointId, eventId: delivery.eventId })
        }
      });
      return deliveryDto(updated);
    });
  }

  /** Claims committed outbox events and creates one idempotent delivery per matching endpoint. */
  public async fanOutPendingOutbox(context: OrganizationContext, limit = 20): Promise<number> {
    await this.authorization.assert(context, "webhooks:manage", "WebhookEndpoint");
    const jobs = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      let createdDeliveries = 0;
      const rows = await tx.$queryRaw<readonly OutboxRow[]>`
        SELECT "id", "eventType", "aggregateType", "aggregateId", "payload", "occurredAt"
        FROM "OutboxEvent"
        WHERE "organizationId" = ${context.organizationId}::uuid
          AND "status" = 'PENDING'
        ORDER BY "occurredAt" ASC, "id" ASC
        LIMIT ${Math.min(Math.max(limit, 1), 100)}
        FOR UPDATE SKIP LOCKED
      `;
      for (const row of rows) {
        const endpoints = await tx.webhookEndpoint.findMany({
          where: {
            organizationId: context.organizationId,
            status: "ACTIVE",
            OR: [{ eventTypes: { has: row.eventType } }, { eventTypes: { has: "*" } }]
          }
        });
        for (const endpoint of endpoints) {
          const result = await tx.webhookDelivery.createMany({
            data: [
              {
                organizationId: context.organizationId,
                endpointId: endpoint.id,
                outboxEventId: row.id,
                eventId: row.id,
                eventType: row.eventType,
                apiVersion: endpoint.apiVersion,
                payload: webhookEnvelope(row, endpoint.apiVersion)
              }
            ],
            skipDuplicates: true
          });
          createdDeliveries += result.count;
        }
        await tx.outboxEvent.update({
          where: { id: row.id },
          data: { status: "DISPATCHED", attempts: { increment: 1 }, dispatchedAt: new Date() }
        });
      }
      return createdDeliveries;
    });
    return jobs;
  }

  /** Sends due deliveries in FIFO order per endpoint. No accounting writes occur here. */
  public async processPendingDeliveries(context: OrganizationContext, limit = 20): Promise<number> {
    await this.authorization.assert(context, "webhooks:manage", "WebhookEndpoint");
    const jobs = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.$queryRaw<readonly { id: string }[]>`
        SELECT current_delivery."id"
        FROM "WebhookDelivery" AS current_delivery
        WHERE current_delivery."organizationId" = ${context.organizationId}::uuid
          AND current_delivery."status" IN ('PENDING', 'FAILED')
          AND (current_delivery."nextAttemptAt" IS NULL OR current_delivery."nextAttemptAt" <= CURRENT_TIMESTAMP)
          AND NOT EXISTS (
            SELECT 1
            FROM "WebhookDelivery" AS older_delivery
            WHERE older_delivery."organizationId" = current_delivery."organizationId"
              AND older_delivery."endpointId" = current_delivery."endpointId"
              AND older_delivery."status" IN ('PENDING', 'SENDING', 'FAILED', 'DEAD_LETTER')
              AND (older_delivery."createdAt" < current_delivery."createdAt"
                OR (older_delivery."createdAt" = current_delivery."createdAt" AND older_delivery."id" < current_delivery."id"))
          )
        ORDER BY current_delivery."endpointId" ASC, current_delivery."createdAt" ASC, current_delivery."id" ASC
        LIMIT ${Math.min(Math.max(limit, 1), 100)}
        FOR UPDATE SKIP LOCKED
      `;
      for (const row of rows)
        await tx.webhookDelivery.update({
          where: { id: row.id },
          data: { status: "SENDING", attempts: { increment: 1 } }
        });
      return rows.map((row) => row.id);
    });

    for (const id of jobs) await this.sendDelivery(context, id);
    return jobs.length;
  }

  private async sendDelivery(context: OrganizationContext, deliveryId: string): Promise<void> {
    const delivery = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.webhookDelivery.findFirst({
        where: { id: deliveryId, organizationId: context.organizationId },
        include: { endpoint: true }
      })
    );
    if (!delivery) return;
    if (delivery.endpoint.status !== "ACTIVE") {
      await this.markDeliveryFailed(
        context,
        delivery,
        "Webhook endpoint is disabled.",
        null,
        false
      );
      return;
    }
    try {
      await assertResolvedUrlSafe(delivery.endpoint.url);
      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const secret = this.secretProtector.reveal(delivery.endpoint.secretCiphertext);
      const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      const response = await this.httpClient.send({
        url: delivery.endpoint.url,
        body,
        headers: {
          "content-type": "application/json",
          "user-agent": `PennyWise-Accounting-Webhooks/${delivery.apiVersion}`,
          "x-clearledger-event-id": delivery.eventId,
          "x-clearledger-event-type": delivery.eventType,
          "x-clearledger-event-version": delivery.apiVersion,
          "x-clearledger-delivery-id": delivery.id,
          "x-clearledger-signature": `t=${timestamp},v1=${signature}`
        }
      });
      if (response.status >= 200 && response.status < 300) {
        await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
          await tx.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: "DELIVERED", deliveredAt: new Date(), lastHttpStatus: response.status }
          });
          await tx.webhookEndpoint.update({
            where: { id: delivery.endpointId },
            data: { consecutiveFailures: 0, lastDeliveryAt: new Date() }
          });
        });
        return;
      }
      await this.markDeliveryFailed(
        context,
        delivery,
        `Webhook endpoint returned HTTP ${String(response.status)}.`,
        response.status,
        response.status >= 500 || response.status === 429
      );
    } catch (error) {
      await this.markDeliveryFailed(
        context,
        delivery,
        error instanceof Error ? error.message.slice(0, 500) : "Webhook delivery failed.",
        null,
        true
      );
    }
  }

  private async markDeliveryFailed(
    context: OrganizationContext,
    delivery: WebhookDelivery & { endpoint: WebhookEndpoint },
    reason: string,
    httpStatus: number | null,
    retryable: boolean
  ): Promise<void> {
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const nextAttempt =
        retryable && delivery.attempts < maximumAttempts
          ? addBackoff(new Date(), delivery.attempts)
          : null;
      const terminal = !retryable || delivery.attempts >= maximumAttempts;
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: terminal ? "DEAD_LETTER" : "FAILED",
          nextAttemptAt: nextAttempt,
          lastHttpStatus: httpStatus,
          lastError: reason
        }
      });
      const failures = delivery.endpoint.consecutiveFailures + 1;
      const disable = !retryable || failures >= automaticDisableAfterFailures;
      if (disable) {
        await tx.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: {
            status: "DISABLED",
            disabledAt: new Date(),
            disabledReason: reason,
            consecutiveFailures: failures
          }
        });
      } else {
        await tx.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: { consecutiveFailures: failures }
        });
      }
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: terminal ? "WEBHOOK_DELIVERY_DEAD_LETTERED" : "WEBHOOK_DELIVERY_FAILED",
          targetType: "WebhookDelivery",
          targetId: delivery.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            endpointId: delivery.endpointId,
            eventId: delivery.eventId,
            httpStatus,
            retryable,
            ...(terminal ? { terminal: true } : {})
          })
        }
      });
    });
  }
}

interface OutboxRow {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Prisma.JsonValue;
  occurredAt: Date;
}

function webhookEnvelope(row: OutboxRow, apiVersion: string): Prisma.InputJsonValue {
  return {
    id: row.id,
    type: row.eventType,
    version: apiVersion,
    occurred_at: row.occurredAt.toISOString(),
    data: redactWebhookData(row.payload)
  };
}

function redactWebhookData(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value.map((item) => redactWebhookData(item));
  if (value && typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(organizationId|secret|token|password|ciphertext)$/i.test(key)) continue;
      result[key] = redactWebhookData(item as Prisma.JsonValue);
    }
    return result;
  }
  return value as Prisma.InputJsonValue;
}

function validateWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError("WEBHOOK_URL_INVALID", "Webhook URL is invalid.", 422);
  }
  const localDevelopment = process.env.NODE_ENV !== "production" && isLocalHost(url.hostname);
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:"))
    throw new AppError("WEBHOOK_URL_INVALID", "Webhook URL must use HTTPS.", 422);
  if (url.username || url.password || url.hash || url.search)
    throw new AppError(
      "WEBHOOK_URL_INVALID",
      "Webhook URL cannot contain credentials or query data.",
      422
    );
  if (process.env.NODE_ENV === "production" && isLocalHost(url.hostname))
    throw new AppError("WEBHOOK_URL_INVALID", "Webhook URL cannot target a local address.", 422);
  return url.toString();
}

async function assertResolvedUrlSafe(value: string): Promise<void> {
  const url = new URL(value);
  if (process.env.NODE_ENV !== "production") return;
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.some((entry) => isPrivateAddress(entry.address)))
    throw new AppError("WEBHOOK_URL_INVALID", "Webhook URL resolves to a private address.", 422);
}

function normalizeEventTypes(values: readonly string[]): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (
    normalized.length === 0 ||
    normalized.length > 50 ||
    normalized.some((value) => value.length > 160)
  )
    throw new AppError("WEBHOOK_EVENT_TYPES_INVALID", "Webhook event types are invalid.", 422);
  return normalized;
}

function endpointDto(endpoint: {
  id: string;
  name: string;
  url: string;
  keyPrefix: string;
  eventTypes: string[];
  apiVersion: string;
  status: string;
  disabledAt: Date | null;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    keyPrefix: endpoint.keyPrefix,
    eventTypes: endpoint.eventTypes,
    apiVersion: endpoint.apiVersion,
    status: endpoint.status,
    disabledAt: endpoint.disabledAt?.toISOString() ?? null,
    disabledReason: endpoint.disabledReason,
    consecutiveFailures: endpoint.consecutiveFailures,
    lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
    createdAt: endpoint.createdAt.toISOString()
  };
}

function deliveryDto(delivery: {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  apiVersion: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    apiVersion: delivery.apiVersion,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    lastHttpStatus: delivery.lastHttpStatus,
    lastError: delivery.lastError,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString()
  };
}

function addBackoff(now: Date, attempts: number): Date {
  const delay = Math.min(60 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delay);
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return true;
}
