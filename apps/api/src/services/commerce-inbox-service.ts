import {
  Prisma,
  withCommerceWebhookTransaction,
  withTenantTransaction,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { hashJson } from "../utils/json.js";
import type { CommerceNormalizationIssue } from "./connectors/commerce-connector-types.js";

export type CommerceInboxIngestionSource = "INTERACTIVE" | "SYNC" | "WEBHOOK";

export interface CommerceInboxEventInput {
  readonly installationId: string;
  readonly providerKey: string;
  readonly shopExternalId: string;
  readonly externalEventId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly eventType: string;
  readonly eventVersion?: string | null | undefined;
  readonly occurredAt?: string | null | undefined;
  readonly sourceCurrency?: string | null | undefined;
  readonly paymentCurrency?: string | null | undefined;
  readonly settlementCurrency?: string | null | undefined;
  readonly rawPayload: Record<string, unknown>;
  readonly normalizedPayload?: Record<string, unknown> | null | undefined;
  readonly normalizedSchemaVersion?: number | undefined;
  readonly normalizationIssues?: readonly CommerceNormalizationIssue[] | undefined;
  readonly mappingVersion?: number | undefined;
  readonly ingestionSource?: CommerceInboxIngestionSource | undefined;
  readonly providerDeliveryId?: string | null | undefined;
}

export interface CommerceInboxReviewInput {
  readonly status: "REVIEW_REQUIRED" | "NORMALIZED" | "DEAD_LETTER";
  readonly normalizedPayload?: Record<string, unknown> | null | undefined;
  readonly reviewNote?: string | null | undefined;
}

export class CommerceInboxService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async ingest(context: OrganizationContext, input: CommerceInboxEventInput) {
    await this.authorization.assert(context, "integrations:manage", "CommerceInboxEvent");
    const [result] = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.ingestBatchTransaction(tx, context, [input])
    );
    return result!;
  }

  public async ingestBatch(
    context: OrganizationContext,
    inputs: readonly CommerceInboxEventInput[]
  ) {
    await this.authorization.assert(context, "integrations:manage", "CommerceInboxEvent");
    assertBatchSize(inputs);
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.ingestBatchTransaction(tx, context, inputs)
    );
  }

  public async ingestVerifiedWebhook(
    context: OrganizationContext,
    inputs: readonly CommerceInboxEventInput[]
  ) {
    assertBatchSize(inputs);
    return withCommerceWebhookTransaction(this.prisma, dbContext(context), (tx) =>
      this.ingestBatchTransaction(tx, context, inputs, null)
    );
  }

  private async ingestBatchTransaction(
    tx: RuntimeTransaction,
    context: OrganizationContext,
    inputs: readonly CommerceInboxEventInput[],
    auditActorUserId: string | null = context.user.id
  ) {
    if (inputs.length === 0) return [];
    const installationIds = [...new Set(inputs.map((input) => input.installationId))];
    const installations = await tx.connectorInstallation.findMany({
      where: { id: { in: installationIds }, organizationId: context.organizationId },
      select: { id: true, providerKey: true }
    });
    const providerByInstallation = new Map(
      installations.map((installation) => [installation.id, installation.providerKey])
    );
    if (providerByInstallation.size !== installationIds.length)
      throw new AppError("CONNECTOR_NOT_FOUND", "Connector installation was not found.", 404);
    const ordered = inputs
      .map((input, originalIndex) => {
        validateNormalizedPayload(input);
        const provider = providerByInstallation.get(input.installationId);
        if (provider !== input.providerKey)
          throw new AppError(
            "COMMERCE_PROVIDER_MISMATCH",
            "The event provider does not match the connector installation.",
            409
          );
        const eventVersion = input.eventVersion?.trim() ?? "";
        const externalEventId = input.externalEventId.trim();
        return {
          input,
          originalIndex,
          eventVersion,
          externalEventId,
          replayKey: [
            context.organizationId,
            input.installationId,
            externalEventId,
            eventVersion
          ].join(":"),
          rawPayloadHash: commerceRawPayloadHash(input)
        };
      })
      .sort((left, right) => left.replayKey.localeCompare(right.replayKey));
    const results = new Array<{
      statusCode: number;
      body: { event: ReturnType<typeof toDto>; replayed: boolean; integrityConflict?: boolean };
    }>(inputs.length);
    for (const item of ordered) {
      await tx.$queryRaw`
        SELECT true AS locked
        FROM (
          SELECT pg_advisory_xact_lock(hashtextextended(${item.replayKey}, 0))
        ) AS lock_row
      `;
      let existing = await tx.commerceInboxEvent.findUnique({
        where: {
          organizationId_installationId_externalEventId_eventVersion: {
            organizationId: context.organizationId,
            installationId: item.input.installationId,
            externalEventId: item.externalEventId,
            eventVersion: item.eventVersion
          }
        }
      });
      if (!existing && isEtsyOrderInput(item.input)) {
        existing = await tx.commerceInboxEvent.findFirst({
          where: {
            organizationId: context.organizationId,
            installationId: item.input.installationId,
            providerKey: "ETSY",
            shopExternalId: item.input.shopExternalId.trim(),
            resourceType: item.input.resourceType.trim(),
            resourceId: item.input.resourceId.trim(),
            eventVersion: item.eventVersion,
            externalEventId: { startsWith: "webhook:" }
          },
          orderBy: { createdAt: "asc" }
        });
      }
      if (existing) {
        const existingHash = commerceRawPayloadHash(existing);
        if (existingHash !== item.rawPayloadHash) {
          await tx.connectorConflict.upsert({
            where: {
              installationId_externalRef_kind: {
                installationId: item.input.installationId,
                externalRef: item.externalEventId.slice(0, 200),
                kind: "EVENT_IDENTITY_COLLISION"
              }
            },
            create: {
              organizationId: context.organizationId,
              installationId: item.input.installationId,
              externalRef: item.externalEventId.slice(0, 200),
              kind: "EVENT_IDENTITY_COLLISION",
              detailRedacted: {
                message: "The provider reused an event identity with different content.",
                eventVersion: item.eventVersion,
                storedHash: existingHash,
                receivedHash: item.rawPayloadHash
              }
            },
            update: {
              status: "OPEN",
              resolvedAt: null,
              resolvedByUserId: null,
              detailRedacted: {
                message: "The provider reused an event identity with different content.",
                eventVersion: item.eventVersion,
                storedHash: existingHash,
                receivedHash: item.rawPayloadHash
              }
            }
          });
          await audit(
            tx,
            context,
            auditActorUserId,
            "COMMERCE_INBOX_IDENTITY_CONFLICT",
            existing.id,
            observationAuditMetadata(
              item.input,
              item.externalEventId,
              item.eventVersion,
              auditActorUserId
            )
          );
          results[item.originalIndex] = {
            statusCode: 409,
            body: { event: toDto(existing), replayed: true, integrityConflict: true }
          };
          continue;
        }
        if (
          item.input.normalizedPayload &&
          (item.input.mappingVersion ?? 1) > existing.mappingVersion
        ) {
          const renormalized = await tx.commerceInboxEvent.update({
            where: { id: existing.id },
            data: {
              normalizedPayload: item.input.normalizedPayload as Prisma.InputJsonObject,
              normalizedSchemaVersion: item.input.normalizedSchemaVersion ?? 1,
              normalizationIssues: (item.input.normalizationIssues ??
                []) as unknown as Prisma.InputJsonArray,
              mappingVersion: item.input.mappingVersion ?? 1,
              status: "REVIEW_REQUIRED",
              reviewNote: "Re-normalized using updated connector mappings.",
              version: { increment: 1 }
            }
          });
          await audit(
            tx,
            context,
            auditActorUserId,
            "COMMERCE_INBOX_REPLAYED",
            existing.id,
            observationAuditMetadata(
              item.input,
              item.externalEventId,
              item.eventVersion,
              auditActorUserId
            )
          );
          results[item.originalIndex] = {
            statusCode: 200,
            body: { event: toDto(renormalized), replayed: true }
          };
          continue;
        }
        await audit(
          tx,
          context,
          auditActorUserId,
          "COMMERCE_INBOX_REPLAYED",
          existing.id,
          observationAuditMetadata(
            item.input,
            item.externalEventId,
            item.eventVersion,
            auditActorUserId
          )
        );
        results[item.originalIndex] = {
          statusCode: 200,
          body: { event: toDto(existing), replayed: true }
        };
        continue;
      }
      const event = await tx.commerceInboxEvent.create({
        data: {
          organizationId: context.organizationId,
          installationId: item.input.installationId,
          providerKey: item.input.providerKey,
          shopExternalId: item.input.shopExternalId.trim(),
          externalEventId: item.externalEventId,
          resourceType: item.input.resourceType.trim(),
          resourceId: item.input.resourceId.trim(),
          eventType: item.input.eventType.trim(),
          eventVersion: item.eventVersion,
          occurredAt: item.input.occurredAt ? new Date(item.input.occurredAt) : null,
          sourceCurrency: normalizeOptionalCurrency(item.input.sourceCurrency),
          paymentCurrency: normalizeOptionalCurrency(item.input.paymentCurrency),
          settlementCurrency: normalizeOptionalCurrency(item.input.settlementCurrency),
          rawPayload: item.input.rawPayload as Prisma.InputJsonObject,
          rawPayloadHash: item.rawPayloadHash,
          normalizedPayload: item.input.normalizedPayload
            ? (item.input.normalizedPayload as Prisma.InputJsonObject)
            : Prisma.JsonNull,
          normalizedSchemaVersion: item.input.normalizedSchemaVersion ?? 1,
          normalizationIssues: (item.input.normalizationIssues ??
            []) as unknown as Prisma.InputJsonArray,
          mappingVersion: item.input.mappingVersion ?? 1,
          status: item.input.normalizedPayload ? "REVIEW_REQUIRED" : "RECEIVED"
        }
      });
      await audit(tx, context, auditActorUserId, "COMMERCE_INBOX_RECEIVED", event.id, {
        providerKey: event.providerKey,
        installationId: event.installationId,
        externalEventId: event.externalEventId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        status: event.status,
        ingestionSource: observationSource(item.input, auditActorUserId),
        ...(item.input.providerDeliveryId
          ? { providerDeliveryId: item.input.providerDeliveryId.trim() }
          : {})
      });
      results[item.originalIndex] = {
        statusCode: 201,
        body: { event: toDto(event), replayed: false }
      };
    }
    return results;
  }

  public async list(
    context: OrganizationContext,
    status?: "RECEIVED" | "REVIEW_REQUIRED" | "NORMALIZED" | "DEAD_LETTER",
    limit = 100
  ) {
    await this.authorization.assert(context, "commerce:read", "CommerceInboxEvent");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      (
        await tx.commerceInboxEvent.findMany({
          where: { organizationId: context.organizationId, ...(status ? { status } : {}) },
          orderBy: { createdAt: "desc" },
          take: Math.max(1, Math.min(200, Math.trunc(limit)))
        })
      ).map(toDto)
    );
  }

  public async review(
    context: OrganizationContext,
    id: string,
    version: number,
    input: CommerceInboxReviewInput
  ) {
    await this.authorization.assert(context, "commerce:review", "CommerceInboxEvent", id);
    if (input.normalizedPayload)
      validateNormalizedPayload({
        installationId: "review",
        providerKey:
          typeof input.normalizedPayload.provider === "string"
            ? input.normalizedPayload.provider
            : "INVALID",
        shopExternalId: "review",
        externalEventId: "review",
        resourceType: "REVIEW",
        resourceId: "review",
        eventType: "review",
        rawPayload: {},
        normalizedPayload: input.normalizedPayload
      });
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.commerceInboxEvent.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("COMMERCE_EVENT_NOT_FOUND", "Inbox event was not found.", 404);
      if (
        input.status === "NORMALIZED" &&
        Array.isArray(current.normalizationIssues) &&
        current.normalizationIssues.some(
          (issue) =>
            issue &&
            typeof issue === "object" &&
            (issue as { severity?: unknown }).severity === "BLOCKING"
        )
      )
        throw new AppError(
          "COMMERCE_BLOCKERS_REMAIN",
          "Resolve blocking mappings or reconciliation differences before marking this event reviewed.",
          409
        );
      const updated = await tx.commerceInboxEvent.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: {
          status: input.status,
          ...(input.normalizedPayload
            ? { normalizedPayload: input.normalizedPayload as Prisma.InputJsonObject }
            : {}),
          reviewNote: input.reviewNote ?? null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1 || version < 1)
        throw new AppError(
          "STALE_COMMERCE_EVENT",
          "The inbox event changed or has an invalid version.",
          409
        );
      const event = await tx.commerceInboxEvent.findUniqueOrThrow({ where: { id } });
      await audit(tx, context, context.user.id, "COMMERCE_INBOX_REVIEWED", id, {
        status: input.status,
        mappingVersion: event.mappingVersion
      });
      return toDto(event);
    });
  }
}

type CommerceRawPayloadInput = {
  readonly providerKey: string;
  readonly resourceType: string;
  readonly rawPayload: unknown;
};

function commerceRawPayloadHash(input: CommerceRawPayloadInput): string {
  return hashJson(canonicalCommerceRawPayload(input));
}

function canonicalCommerceRawPayload(input: CommerceRawPayloadInput): unknown {
  if (isEtsyOrderInput(input)) {
    const envelope = asRecord(input.rawPayload);
    const receipt = envelope ? asRecord(envelope.receipt) : null;
    if (envelope && asRecord(envelope.webhook) && receipt) return receipt;
  }
  return input.rawPayload;
}

function isEtsyOrderInput(
  input: Pick<CommerceRawPayloadInput, "providerKey" | "resourceType">
): boolean {
  return input.providerKey === "ETSY" && input.resourceType.trim().toUpperCase() === "ORDER";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function observationSource(
  input: Pick<CommerceInboxEventInput, "ingestionSource">,
  auditActorUserId: string | null
): "INTERACTIVE" | "SYNC" | "VERIFIED_PROVIDER_WEBHOOK" {
  if (auditActorUserId === null || input.ingestionSource === "WEBHOOK")
    return "VERIFIED_PROVIDER_WEBHOOK";
  return input.ingestionSource === "SYNC" ? "SYNC" : "INTERACTIVE";
}

function observationAuditMetadata(
  input: CommerceInboxEventInput,
  externalEventId: string,
  eventVersion: string,
  auditActorUserId: string | null
): Prisma.InputJsonObject {
  return {
    providerKey: input.providerKey,
    installationId: input.installationId,
    shopExternalId: input.shopExternalId,
    externalEventId,
    eventVersion,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ingestionSource: observationSource(input, auditActorUserId),
    ...(input.providerDeliveryId ? { providerDeliveryId: input.providerDeliveryId.trim() } : {})
  };
}

function normalizeOptionalCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function toDto(event: {
  id: string;
  organizationId: string;
  installationId: string;
  providerKey: string;
  shopExternalId: string;
  externalEventId: string;
  resourceType: string;
  resourceId: string;
  eventType: string;
  eventVersion: string;
  occurredAt: Date | null;
  sourceCurrency: string | null;
  paymentCurrency: string | null;
  settlementCurrency: string | null;
  rawPayload: Prisma.JsonValue;
  rawPayloadHash: string | null;
  normalizedPayload: Prisma.JsonValue | null;
  normalizedSchemaVersion: number;
  normalizationIssues: Prisma.JsonValue;
  mappingVersion: number;
  version: number;
  status: string;
  errorCode: string | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...event,
    eventVersion: event.eventVersion || null,
    occurredAt: event.occurredAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

function assertBatchSize(inputs: readonly CommerceInboxEventInput[]): void {
  if (inputs.length > 100)
    throw new AppError(
      "COMMERCE_BATCH_TOO_LARGE",
      "Commerce imports are limited to 100 events per batch.",
      422
    );
}

function validateNormalizedPayload(input: CommerceInboxEventInput): void {
  if (!input.normalizedPayload) return;
  const payload = input.normalizedPayload;
  if (
    payload.schemaVersion !== 1 ||
    payload.provider !== input.providerKey ||
    typeof payload.transactionKind !== "string" ||
    typeof payload.externalId !== "string" ||
    !payload.currencies ||
    typeof payload.currencies !== "object" ||
    !Array.isArray(payload.issues)
  )
    throw new AppError(
      "COMMERCE_NORMALIZATION_INVALID",
      "Normalized commerce data does not match the supported schema.",
      422
    );
  const issues = input.normalizationIssues ?? payload.issues;
  if (
    !Array.isArray(issues) ||
    issues.some(
      (issue) =>
        !issue ||
        typeof issue !== "object" ||
        typeof (issue as { code?: unknown }).code !== "string" ||
        !["INFO", "WARNING", "BLOCKING"].includes(
          String((issue as { severity?: unknown }).severity)
        )
    )
  )
    throw new AppError(
      "COMMERCE_NORMALIZATION_INVALID",
      "Commerce normalization issues are invalid.",
      422
    );
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  actorUserId: string | null,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId,
      action,
      targetType: "CommerceInboxEvent",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context.auditOrigin, metadata)
    }
  });
}
