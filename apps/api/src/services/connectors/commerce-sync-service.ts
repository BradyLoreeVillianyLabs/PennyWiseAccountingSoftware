import { randomUUID } from "node:crypto";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import {
  CommerceInboxService,
  type CommerceInboxEventInput,
  type CommerceInboxIngestionSource
} from "../commerce-inbox-service.js";
import {
  ConnectorRuntimeService,
  type ConnectorConnectionSnapshot
} from "../connector-runtime-service.js";
import type {
  CommerceConnectorAdapter,
  CommerceConnectorEvent,
  EtsyOAuthCompleteInput,
  EtsyOAuthStartInput
} from "./commerce-connector-types.js";
import { isCommerceConnectorAdapter } from "./commerce-connector-types.js";

export interface CommerceSyncInput {
  readonly from?: Date;
  readonly to?: Date;
  readonly maxPages?: number;
  readonly pageSize?: number;
  readonly scope?: "ORDERS" | "SETTLEMENTS" | "ALL";
  readonly continuationToken?: string;
}

type CommerceSyncScope = "ORDERS" | "SETTLEMENTS";
type RequestedCommerceSyncScope = CommerceSyncScope | "ALL";

interface CommerceSyncPlan {
  readonly runId: string;
  readonly providerKey: string;
  readonly from: Date;
  readonly to: Date;
  readonly requestedScope: RequestedCommerceSyncScope;
  readonly scopes: readonly CommerceSyncScope[];
  readonly pageSize: number;
}

interface CommerceScopeProgress {
  readonly cursor: Readonly<Record<string, unknown>> | null;
  readonly hasMore: boolean;
  readonly rateLimit: Readonly<Record<string, unknown>> | null;
}

const syncPlanCheckpointScope = "commerce:sync-plan";

export class CommerceSyncService {
  public constructor(
    private readonly runtime: ConnectorRuntimeService,
    private readonly inbox: CommerceInboxService
  ) {}

  public providerCatalog() {
    return this.runtime.providers().map((provider) => ({
      ...provider,
      ...(provider.providerKey === "WOOCOMMERCE"
        ? {
            description:
              "Import orders and catalog data, review SKU mappings, and synchronize approved exact stock quantities through WooCommerce core.",
            connectionMethod:
              "Store URL plus a WooCommerce REST API key; read-only supports review and read/write is required for stock writes",
            webhookSetup:
              "PennyWise Accounting can register order webhooks when the key has read/write permission.",
            externalApproval:
              "Store owner authorization only; no paid plugin or adapter approval is required."
          }
        : provider.providerKey === "ETSY"
          ? {
              description:
                "Poll Etsy receipts, listings, variants, images, and exact stock; approved policies can write listing inventory.",
              connectionMethod:
                "Etsy OAuth with shops_r, listings_r, listings_w, and transactions_r scopes",
              webhookSetup:
                "Order events may use the Webhook Portal; catalog and inventory discovery always use polling.",
              externalApproval:
                "An Etsy app is required; broad multi-seller distribution requires Etsy Commercial Access review.",
              trademarkNotice:
                "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc."
            }
          : {})
    }));
  }

  public async sync(
    context: OrganizationContext,
    installationId: string,
    input: CommerceSyncInput
  ) {
    let snapshot = await this.runtime.loadConnection(context, installationId, true, true);
    const adapter = commerceAdapter(snapshot);
    const now = new Date();
    const maxPages = Math.max(1, Math.min(10, Math.trunc(input.maxPages ?? 3)));
    const newWindow = input.continuationToken ? null : syncWindow(snapshot, input, now);
    if (newWindow) assertSyncRange(newWindow.from, newWindow.to, now);
    const lease = await this.runtime.acquireSyncLease(context, installationId);
    let planStarted = false;
    let imported = 0;
    let replayed = 0;
    let conflicts = 0;
    let pages = 0;
    try {
      const plan = input.continuationToken
        ? continuationPlan(
            await this.runtime.getCheckpoint(context, installationId, syncPlanCheckpointScope),
            input.continuationToken,
            snapshot.providerKey,
            input.pageSize
          )
        : newSyncPlan(snapshot, input, newWindow!);
      if (!input.continuationToken)
        await this.runtime.saveCheckpoint(context, installationId, {
          scope: syncPlanCheckpointScope,
          checkpoint: syncPlanCheckpoint(plan, false, plan.scopes)
        });
      planStarted = true;

      const progress = new Map<CommerceSyncScope, CommerceScopeProgress>();
      for (const scope of plan.scopes) {
        const checkpointScope = `commerce:${scope.toLowerCase()}`;
        const storedCheckpoint = await this.runtime.getCheckpoint(
          context,
          installationId,
          checkpointScope
        );
        progress.set(scope, scopeProgress(storedCheckpoint?.checkpoint, plan));
      }

      const scopeResults: Array<Record<string, unknown>> = [];
      for (const scope of plan.scopes) {
        let current = progress.get(scope)!;
        let scopePages = 0;
        while (current.hasMore && pages < maxPages) {
          const page = await adapter.syncPage(snapshot.credentials, {
            from: plan.from,
            to: plan.to,
            cursor: current.cursor,
            pageSize: plan.pageSize,
            scope,
            mapping: snapshot.mapping
          });
          if (
            page.hasMore &&
            (page.events.length === 0 ||
              !page.nextCursor ||
              cursorsEqual(current.cursor, page.nextCursor))
          )
            throw new AppError(
              "CONNECTOR_CURSOR_STALLED",
              "The provider cursor did not make progress.",
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
          const ingested = await this.inbox.ingestBatch(
            context,
            page.events.map((event) => inboxInput(snapshot, event, "SYNC"))
          );
          for (const result of ingested) {
            if (result.statusCode === 201) imported += 1;
            else if (result.statusCode === 409) conflicts += 1;
            else replayed += 1;
          }
          scopePages += 1;
          pages += 1;
          current = {
            cursor: page.hasMore ? page.nextCursor : null,
            hasMore: page.hasMore,
            rateLimit: page.rateLimit ?? null
          };
          progress.set(scope, current);
          await this.runtime.saveCheckpoint(context, installationId, {
            scope: `commerce:${scope.toLowerCase()}`,
            checkpoint: {
              version: 1,
              runId: plan.runId,
              windowStart: plan.from.toISOString(),
              windowEnd: plan.to.toISOString(),
              cursor: current.cursor,
              hasMore: current.hasMore,
              rateLimit: page.rateLimit ?? null
            }
          });
        }
        scopeResults.push({
          scope,
          pages: scopePages,
          complete: !current.hasMore,
          rateLimit: current.rateLimit
        });
      }
      const remainingScopes = plan.scopes.filter((scope) => progress.get(scope)!.hasMore);
      const complete = remainingScopes.length === 0;
      const completedThrough =
        snapshot.lastSyncAt && snapshot.lastSyncAt > plan.to ? snapshot.lastSyncAt : plan.to;
      await this.runtime.finishSync(context, installationId, lease.tokenHash, {
        success: true,
        complete,
        ...(complete ? { completedThrough } : {}),
        imported,
        replayed,
        checkpoint: {
          scope: syncPlanCheckpointScope,
          checkpoint: syncPlanCheckpoint(plan, complete, remainingScopes)
        }
      });
      return {
        installationId,
        providerKey: snapshot.providerKey,
        window: { from: plan.from.toISOString(), to: plan.to.toISOString() },
        imported,
        replayed,
        conflicts,
        pages,
        complete,
        hasMore: !complete,
        continuation: complete
          ? null
          : {
              token: plan.runId,
              remainingScopes,
              requestedScope: plan.requestedScope,
              pageSize: plan.pageSize,
              window: { from: plan.from.toISOString(), to: plan.to.toISOString() }
            },
        scopes: scopeResults,
        postingMode: "SHADOW_REVIEW",
        accountingEntriesCreated: 0
      };
    } catch (error) {
      if (planStarted)
        await this.runtime.finishSync(context, installationId, lease.tokenHash, {
          success: false,
          complete: false,
          imported,
          replayed,
          error: "Connector synchronization failed."
        });
      else await this.runtime.releaseSyncLease(context, installationId, lease.tokenHash);
      throw error;
    }
  }

  public async registerWebhooks(
    context: OrganizationContext,
    installationId: string,
    deliveryUrl: string
  ) {
    const snapshot = await this.runtime.loadConnection(context, installationId, true, true);
    const adapter = commerceAdapter(snapshot);
    if (!adapter.registerWebhooks)
      throw new AppError(
        "CONNECTOR_WEBHOOK_MANUAL_SETUP_REQUIRED",
        "This provider requires webhook setup in its developer portal.",
        409
      );
    const result = await adapter.registerWebhooks(snapshot.credentials, { deliveryUrl });
    await this.runtime.setWebhookRegistration(context, installationId, result.status);
    return { ...result, deliveryUrl };
  }

  public async beginEtsyOAuth(
    context: OrganizationContext,
    installationId: string,
    input: EtsyOAuthStartInput
  ) {
    const installation = await this.runtime.loadInstallationAdapter(context, installationId);
    if (installation.providerKey !== "ETSY" || !("beginOAuth" in installation.adapter))
      throw new AppError("CONNECTOR_PROVIDER_MISMATCH", "This is not an Etsy connector.", 409);
    const adapter = installation.adapter as CommerceConnectorAdapter;
    if (!adapter.beginOAuth)
      throw new AppError("CONNECTOR_OAUTH_UNAVAILABLE", "OAuth is unavailable.", 409);
    const authorization = await adapter.beginOAuth(input);
    const pending = await this.runtime.storePendingCredentials(
      context,
      installationId,
      authorization.pendingCredentials
    );
    return {
      authorizationUrl: authorization.authorizationUrl,
      expiresAt: authorization.expiresAt.toISOString(),
      credentialVersion: pending.credentialVersion
    };
  }

  public async completeEtsyOAuth(
    context: OrganizationContext,
    installationId: string,
    input: EtsyOAuthCompleteInput
  ) {
    const snapshot = await this.runtime.loadConnection(context, installationId, true, false);
    const adapter = commerceAdapter(snapshot);
    if (snapshot.providerKey !== "ETSY" || !adapter.completeOAuth)
      throw new AppError("CONNECTOR_PROVIDER_MISMATCH", "This is not an Etsy connector.", 409);
    const validation = await adapter.completeOAuth(snapshot.credentials, input);
    const now = new Date();
    return this.runtime.commitValidatedConnection(
      context,
      installationId,
      snapshot.credentialVersion,
      validation.credentials ?? snapshot.credentials,
      validation,
      new Date(now.getTime() - 30 * 24 * 60 * 60_000),
      now
    );
  }

  public async webhook(
    providerKey: string,
    installationId: string,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    now = new Date()
  ) {
    const snapshot = await this.runtime.loadWebhookConnection(providerKey, installationId);
    const adapter = commerceAdapter(snapshot);
    const verified = await adapter.verifyWebhook(snapshot.credentials, {
      rawBody,
      headers,
      now,
      mapping: snapshot.mapping,
      mappingVersion: snapshot.mappingVersion
    });
    if (verified.ping) return { accepted: true, ping: true, imported: 0, replayed: 0 };
    if (verified.updatedCredentials)
      await this.runtime.rotateWebhookCredentials(snapshot, verified.updatedCredentials);
    const context = webhookContext(snapshot);
    const results = await this.inbox.ingestVerifiedWebhook(
      context,
      verified.events.map((event) =>
        inboxInput(snapshot, event, "WEBHOOK", providerDeliveryId(headers))
      )
    );
    const imported = results.filter((result) => result.statusCode === 201).length;
    const replayed = results.filter((result) => result.statusCode === 200).length;
    const conflicts = results.filter((result) => result.statusCode === 409).length;
    await this.runtime.markWebhook(snapshot, "ACTIVE", verified.events.length);
    return { accepted: true, imported, replayed, conflicts };
  }
}

function commerceAdapter(snapshot: ConnectorConnectionSnapshot): CommerceConnectorAdapter {
  if (!isCommerceConnectorAdapter(snapshot.adapter))
    throw new AppError(
      "CONNECTOR_SYNC_UNAVAILABLE",
      "This connector does not support commerce synchronization.",
      409
    );
  return snapshot.adapter;
}

function syncScopes(
  providerKey: string,
  requested: RequestedCommerceSyncScope
): readonly CommerceSyncScope[] {
  if (requested !== "ALL") return [requested];
  return providerKey === "ETSY" ? ["ORDERS", "SETTLEMENTS"] : ["ORDERS"];
}

function syncWindow(
  snapshot: ConnectorConnectionSnapshot,
  input: CommerceSyncInput,
  now: Date
): { from: Date; to: Date } {
  const initialSync = !snapshot.lastSyncAt;
  const to = input.to ?? (initialSync ? snapshot.backfillEndAt : null) ?? now;
  const from =
    input.from ??
    (initialSync ? snapshot.backfillStartAt : null) ??
    (snapshot.lastSyncAt
      ? new Date(snapshot.lastSyncAt.getTime() - 5 * 60_000)
      : new Date(to.getTime() - 30 * 24 * 60 * 60_000));
  if (
    initialSync &&
    ((snapshot.backfillStartAt && from < snapshot.backfillStartAt) ||
      (snapshot.backfillEndAt && to > snapshot.backfillEndAt))
  )
    throw new AppError(
      "CONNECTOR_SYNC_OUTSIDE_CONSENT",
      "The first synchronization must remain within the connected backfill range.",
      422
    );
  return { from, to };
}

function newSyncPlan(
  snapshot: ConnectorConnectionSnapshot,
  input: CommerceSyncInput,
  window: { from: Date; to: Date }
): CommerceSyncPlan {
  const requestedScope = input.scope ?? "ALL";
  return {
    runId: randomUUID(),
    providerKey: snapshot.providerKey,
    from: window.from,
    to: window.to,
    requestedScope,
    scopes: syncScopes(snapshot.providerKey, requestedScope),
    pageSize: Math.max(1, Math.min(100, Math.trunc(input.pageSize ?? 50)))
  };
}

function continuationPlan(
  storedCheckpoint: { checkpoint: unknown } | null,
  continuationToken: string,
  providerKey: string,
  requestedPageSize: number | undefined
): CommerceSyncPlan {
  const checkpoint = asRecord(storedCheckpoint?.checkpoint);
  const runId = stringValue(checkpoint?.runId);
  const from = dateValue(checkpoint?.windowStart);
  const to = dateValue(checkpoint?.windowEnd);
  const requestedScope = requestedScopeValue(checkpoint?.requestedScope);
  const scopes = scopeValues(checkpoint?.scopes);
  const pageSize = integerValue(checkpoint?.pageSize);
  if (
    checkpoint?.version !== 1 ||
    checkpoint.complete !== false ||
    !runId ||
    runId !== continuationToken ||
    checkpoint.providerKey !== providerKey ||
    !from ||
    !to ||
    !requestedScope ||
    scopes.length === 0 ||
    !pageSize ||
    (requestedPageSize !== undefined && requestedPageSize !== pageSize)
  )
    throw new AppError(
      "CONNECTOR_SYNC_CONTINUATION_INVALID",
      "The synchronization continuation is unavailable or no longer current. Start a new synchronization.",
      409
    );
  return { runId, providerKey, from, to, requestedScope, scopes, pageSize };
}

function syncPlanCheckpoint(
  plan: CommerceSyncPlan,
  complete: boolean,
  remainingScopes: readonly CommerceSyncScope[]
): Record<string, unknown> {
  return {
    version: 1,
    runId: plan.runId,
    providerKey: plan.providerKey,
    windowStart: plan.from.toISOString(),
    windowEnd: plan.to.toISOString(),
    requestedScope: plan.requestedScope,
    scopes: plan.scopes,
    pageSize: plan.pageSize,
    complete,
    remainingScopes
  };
}

function scopeProgress(checkpointValue: unknown, plan: CommerceSyncPlan): CommerceScopeProgress {
  const checkpoint = asRecord(checkpointValue);
  if (
    checkpoint?.version !== 1 ||
    checkpoint.runId !== plan.runId ||
    checkpoint.windowStart !== plan.from.toISOString() ||
    checkpoint.windowEnd !== plan.to.toISOString() ||
    typeof checkpoint.hasMore !== "boolean"
  )
    return { cursor: null, hasMore: true, rateLimit: null };
  return {
    cursor: checkpoint.hasMore ? asRecord(checkpoint.cursor) : null,
    hasMore: checkpoint.hasMore,
    rateLimit: asRecord(checkpoint.rateLimit)
  };
}

function cursorsEqual(
  left: Readonly<Record<string, unknown>> | null,
  right: Readonly<Record<string, unknown>>
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : null;
}

function requestedScopeValue(value: unknown): RequestedCommerceSyncScope | null {
  return value === "ORDERS" || value === "SETTLEMENTS" || value === "ALL" ? value : null;
}

function scopeValues(value: unknown): readonly CommerceSyncScope[] {
  if (!Array.isArray(value)) return [];
  const scopes = value.filter(
    (scope): scope is CommerceSyncScope => scope === "ORDERS" || scope === "SETTLEMENTS"
  );
  return scopes.length === value.length ? scopes : [];
}

function assertSyncRange(from: Date, to: Date, now: Date): void {
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from >= to ||
    to.getTime() > now.getTime() + 60_000 ||
    to.getTime() - from.getTime() > 90 * 24 * 60 * 60_000
  )
    throw new AppError(
      "CONNECTOR_SYNC_RANGE_INVALID",
      "Synchronization must use a completed range of 90 days or less.",
      422
    );
}

function inboxInput(
  snapshot: ConnectorConnectionSnapshot,
  event: CommerceConnectorEvent,
  ingestionSource: CommerceInboxIngestionSource = "SYNC",
  providerDeliveryId?: string
): CommerceInboxEventInput {
  return {
    installationId: snapshot.installationId,
    providerKey: snapshot.providerKey,
    shopExternalId: event.shopExternalId,
    externalEventId: event.externalEventId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    occurredAt: event.occurredAt,
    sourceCurrency: event.sourceCurrency,
    paymentCurrency: event.paymentCurrency,
    settlementCurrency: event.settlementCurrency,
    rawPayload: event.rawPayload,
    normalizedPayload: event.normalizedPayload as unknown as Record<string, unknown>,
    normalizedSchemaVersion: event.normalizedPayload.schemaVersion,
    normalizationIssues: event.normalizationIssues,
    mappingVersion: snapshot.mappingVersion,
    ingestionSource,
    ...(providerDeliveryId ? { providerDeliveryId } : {})
  };
}

function providerDeliveryId(
  headers: Readonly<Record<string, string | undefined>>
): string | undefined {
  const value =
    headers["webhook-id"] ?? headers["x-wc-webhook-delivery-id"] ?? headers["x-wc-webhook-id"];
  const normalized = value?.trim();
  return normalized || undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function webhookContext(snapshot: ConnectorConnectionSnapshot): OrganizationContext {
  return {
    requestId: `commerce-webhook:${snapshot.installationId}`,
    user: {
      id: snapshot.actorUserId,
      email: "commerce-webhook@system.invalid",
      displayName: "Commerce connector",
      emailVerifiedAt: null
    },
    organizationId: snapshot.organizationId,
    membershipId: snapshot.installationId,
    role: "OWNER",
    sessionId: null,
    recentAuthAt: new Date(),
    mfaAuthenticated: false,
    authenticationMethod: "DEVELOPMENT",
    auditOrigin: { ipAddress: null, userAgent: "commerce-provider-webhook" }
  };
}
