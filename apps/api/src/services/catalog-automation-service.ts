import { createHash } from "node:crypto";
import { Prisma, RuntimePrisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { CatalogMappingService } from "./catalog-mapping-service.js";
import { ConnectorRuntimeService } from "./connector-runtime-service.js";
import {
  isCommerceConnectorAdapter,
  type CommerceConnectorAdapter
} from "./connectors/commerce-connector-types.js";

const catalogCheckpointScope = "catalog:products";

export interface CatalogPollInput {
  readonly maxPages?: number;
  readonly pageSize?: number;
  readonly restart?: boolean;
}

export class CatalogAutomationService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly runtime: ConnectorRuntimeService,
    private readonly catalog: CatalogMappingService
  ) {}

  public async poll(
    context: OrganizationContext,
    installationId: string,
    input: CatalogPollInput = {}
  ) {
    let snapshot = await this.runtime.loadConnection(context, installationId, true, true);
    const adapter = commerceAdapter(snapshot.adapter);
    const maxPages = Math.max(1, Math.min(25, Math.trunc(input.maxPages ?? 5)));
    const pageSize = Math.max(1, Math.min(25, Math.trunc(input.pageSize ?? 10)));
    const checkpoint = input.restart
      ? null
      : await this.runtime.getCheckpoint(context, installationId, catalogCheckpointScope);
    let cursor = checkpointCursor(checkpoint?.checkpoint);
    let importedProducts = 0;
    let importedVariants = 0;
    let observations = 0;
    let candidateVariantsEvaluated = 0;
    let candidateVariantsDeferred = 0;
    let candidateSuggestions = 0;
    let pages = 0;
    let hasMore = true;
    while (hasMore && pages < maxPages) {
      const page = await adapter.catalogPage(snapshot.credentials, { cursor, pageSize });
      if (page.hasMore && (!page.nextCursor || cursorsEqual(cursor, page.nextCursor)))
        throw new AppError(
          "CONNECTOR_CURSOR_STALLED",
          "The provider catalog cursor did not make progress.",
          502
        );
      if (page.updatedCredentials) {
        await this.runtime.rotateCredentials(context, snapshot, page.updatedCredentials);
        snapshot = {
          ...snapshot,
          credentials: page.updatedCredentials,
          credentialVersion: snapshot.credentialVersion + 1
        };
      }
      const pageVariantIds: string[] = [];
      for (const product of page.products) {
        const stored = await this.catalog.upsertObservedCatalog(context, installationId, product);
        importedProducts += 1;
        importedVariants += stored.variants.length;
        pageVariantIds.push(...stored.variants.map((variant) => variant.id));
        for (const [index, variantInput] of product.variants.entries()) {
          if (variantInput.observedQuantityMicros == null) continue;
          const variant = stored.variants[index];
          if (!variant || variant.externalVariantId !== variantInput.externalVariantId)
            throw new AppError(
              "CATALOG_VARIANT_ALIGNMENT_FAILED",
              "Catalog variants could not be aligned safely.",
              409
            );
          const observationId = providerObservationId(
            snapshot.providerKey,
            product.externalProductId,
            variantInput.externalVariantId,
            variantInput.observedQuantityMicros,
            variantInput.providerUpdatedAt
          );
          observations += (
            await this.catalog.recordVariantProviderObservation(
              context,
              variant.id,
              observationId,
              variantInput.observedQuantityMicros,
              variantInput.providerUpdatedAt ?? null,
              {
                providerKey: snapshot.providerKey,
                externalProductId: product.externalProductId,
                externalVariantId: variantInput.externalVariantId,
                ...(variantInput.safeMetadata ?? {})
              }
            )
          ).length;
        }
      }
      if (pageVariantIds.length > 0) {
        const suggestions = await this.catalog.suggestCandidatesBatch(context, pageVariantIds);
        candidateVariantsEvaluated += suggestions.evaluatedVariantIds.length;
        candidateVariantsDeferred += suggestions.deferredVariantIds.length;
        candidateSuggestions += suggestions.candidateCount;
      }
      pages += 1;
      cursor = page.hasMore ? page.nextCursor : null;
      hasMore = page.hasMore;
      await this.runtime.saveCheckpoint(context, installationId, {
        scope: catalogCheckpointScope,
        checkpoint: {
          version: 1,
          cursor,
          hasMore,
          rateLimit: page.rateLimit ?? null,
          lastPageAt: new Date().toISOString()
        },
        ...(hasMore ? {} : { lastSuccessAt: new Date() })
      });
    }
    return {
      providerKey: snapshot.providerKey,
      pages,
      importedProducts,
      importedVariants,
      observations,
      candidateVariantsEvaluated,
      candidateVariantsDeferred,
      candidateSuggestions,
      candidateReviewRequired: candidateVariantsDeferred > 0,
      hasMore,
      continuation: hasMore ? { checkpointScope: catalogCheckpointScope, cursor } : null,
      pollingRequired: snapshot.providerKey === "ETSY",
      accountingEntriesCreated: 0
    };
  }

  public async processInventoryOperations(context: OrganizationContext, limit = 10) {
    const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
    const operations = await withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        const rows = await tx.$queryRaw<
          readonly { id: string; payload: Prisma.JsonValue; attempts: number }[]
        >(RuntimePrisma.sql`
          SELECT "id", "payload", "attempts"
          FROM "OutboxEvent"
          WHERE "organizationId" = ${context.organizationId}::uuid
            AND "eventType" = 'catalog.inventory-write-requested'
            AND "attempts" < 5
            AND (
              "status" IN ('PENDING', 'FAILED')
              OR ("status" = 'DISPATCHED' AND "dispatchedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
            )
          ORDER BY "occurredAt" ASC
          LIMIT ${boundedLimit}
          FOR UPDATE SKIP LOCKED
        `);
        for (const row of rows)
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { status: "DISPATCHED", attempts: { increment: 1 }, dispatchedAt: new Date() }
          });
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    let completed = 0;
    let failed = 0;
    for (const operation of operations) {
      try {
        const payload = operationPayload(operation.payload);
        let snapshot = await this.runtime.loadConnection(
          context,
          payload.installationId,
          true,
          true
        );
        const adapter = commerceAdapter(snapshot.adapter);
        const result = await adapter.updateInventory(snapshot.credentials, {
          externalProductId: payload.externalProductId,
          externalVariantId: payload.externalVariantId,
          quantityMicros: payload.quantityMicros,
          ...(payload.expectedQuantityMicros
            ? { expectedQuantityMicros: payload.expectedQuantityMicros }
            : {}),
          idempotencyKey: payload.idempotencyKey
        });
        if (result.updatedCredentials) {
          await this.runtime.rotateCredentials(context, snapshot, result.updatedCredentials);
          snapshot = { ...snapshot, credentials: result.updatedCredentials };
        }
        await this.catalog.recordInventoryObservation(context, payload.policyId, {
          externalObservationId: `operation:${operation.id}`,
          observedQuantityMicros: result.observedQuantityMicros,
          desiredQuantityMicros: payload.quantityMicros,
          providerObservedAt: new Date(),
          safeMetadata: {
            externalOperationId: result.externalOperationId,
            desiredHash: payload.desiredHash,
            previousObservedHash: payload.observedHash,
            ...(result.safeMetadata ?? {})
          }
        });
        await this.catalog.completeProviderInventoryOperation(context, operation.id, {
          observedQuantityMicros: result.observedQuantityMicros,
          externalOperationId: result.externalOperationId
        });
        completed += 1;
      } catch (error) {
        failed += 1;
        await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
          tx.outboxEvent.updateMany({
            where: { id: operation.id, organizationId: context.organizationId },
            data: { status: "FAILED", dispatchedAt: null }
          })
        );
        if (error instanceof AppError && error.statusCode < 500) continue;
      }
    }
    return { claimed: operations.length, completed, failed, accountingEntriesCreated: 0 };
  }
}

function commerceAdapter(adapter: { readonly providerKey: string }): CommerceConnectorAdapter {
  if (!isCommerceConnectorAdapter(adapter as CommerceConnectorAdapter))
    throw new AppError(
      "CONNECTOR_CAPABILITY_UNSUPPORTED",
      "This connector does not support catalog synchronization.",
      422
    );
  return adapter as CommerceConnectorAdapter;
}

function checkpointCursor(
  value: Prisma.JsonValue | undefined
): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cursor = (value as Record<string, unknown>).cursor;
  return cursor && typeof cursor === "object" && !Array.isArray(cursor)
    ? (cursor as Readonly<Record<string, unknown>>)
    : null;
}

function cursorsEqual(
  left: Readonly<Record<string, unknown>> | null,
  right: Readonly<Record<string, unknown>> | null
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function providerObservationId(
  providerKey: string,
  productId: string,
  variantId: string,
  quantityMicros: string,
  providerUpdatedAt: Date | null | undefined
) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        providerKey,
        productId,
        variantId,
        quantityMicros,
        providerUpdatedAt: providerUpdatedAt?.toISOString() ?? null
      })
    )
    .digest("hex");
  return `catalog:${hash}`;
}

function operationPayload(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidOperation();
  const row = value as Record<string, unknown>;
  return {
    policyId: requiredString(row.policyId),
    installationId: requiredString(row.installationId),
    externalProductId: requiredString(row.externalProductId),
    externalVariantId: requiredString(row.externalVariantId),
    quantityMicros: requiredExactInteger(row.quantityMicros),
    expectedQuantityMicros: optionalExactInteger(row.expectedQuantityMicros),
    desiredHash: requiredHash(row.desiredHash),
    observedHash: requiredHash(row.observedHash),
    idempotencyKey: requiredHash(row.idempotencyKey)
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200) throw invalidOperation();
  return value;
}

function requiredExactInteger(value: unknown): string {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) throw invalidOperation();
  return value;
}

function optionalExactInteger(value: unknown): string | null {
  return value === undefined || value === null ? null : requiredExactInteger(value);
}

function requiredHash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw invalidOperation();
  return value;
}

function invalidOperation() {
  return new AppError(
    "INVENTORY_SYNC_OPERATION_INVALID",
    "The queued inventory operation is invalid.",
    409
  );
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
