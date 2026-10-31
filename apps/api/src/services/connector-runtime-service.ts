import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  withCommerceWebhookTransaction,
  withConnectorWebhookLookupTransaction,
  withTenantTransaction,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { AesPaymentAccountProtector, type PaymentAccountProtector } from "./payment-provider.js";
import { withAuditOrigin } from "../utils/audit.js";
import type {
  ConnectorAdapter,
  ConnectorHealthResult,
  ConnectorValidationResult
} from "./connectors/commerce-connector-types.js";
import { environmentValueOrDefault } from "../environment.js";

export type { ConnectorAdapter } from "./connectors/commerce-connector-types.js";

export interface ConnectorDraftInput {
  readonly providerKey: string;
  readonly displayName: string;
  readonly mapping: Record<string, unknown>;
}

export interface ConnectorCheckpointInput {
  readonly scope: string;
  readonly checkpoint: Record<string, unknown>;
}

export interface ConnectorConflictInput {
  readonly externalRef: string;
  readonly kind: string;
  readonly detail: Record<string, unknown>;
}

export interface ConnectorConnectionSnapshot {
  readonly installationId: string;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly providerKey: string;
  readonly externalAccountId: string | null;
  readonly credentialVersion: number;
  readonly credentials: Readonly<Record<string, unknown>>;
  readonly mapping: Readonly<Record<string, unknown>>;
  readonly mappingVersion: number;
  readonly backfillStartAt: Date | null;
  readonly backfillEndAt: Date | null;
  readonly lastSyncAt: Date | null;
  readonly adapter: ConnectorAdapter;
}

const serverOwnedCatalogMappingKeys = [
  "catalogVariantMappings",
  "catalogProductMappings",
  "catalogSkuMappings",
  "catalogSkuAliases",
  "catalogSkuPatternRules"
] as const;

export class ConnectorRuntimeService {
  private readonly authorization: AuthorizationService;
  private readonly adapters: ReadonlyMap<string, ConnectorAdapter>;

  public constructor(
    private readonly prisma: PrismaClient,
    adapters: readonly ConnectorAdapter[] = [],
    private readonly protector: PaymentAccountProtector = new AesPaymentAccountProtector(
      environmentValueOrDefault(
        process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET,
        "development-connector-credential-secret"
      )
    )
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.adapters = new Map(
      adapters.map((adapter) => [adapter.providerKey.trim().toUpperCase(), adapter])
    );
  }

  public providers() {
    return [...this.adapters.values()].map((adapter) => ({
      providerKey: adapter.providerKey,
      displayName:
        adapter.providerKey === "WOOCOMMERCE"
          ? "WooCommerce"
          : adapter.providerKey === "ETSY"
            ? "Etsy"
            : adapter.providerKey,
      supportsOAuth: "beginOAuth" in adapter,
      supportsWebhooks: "verifyWebhook" in adapter,
      postingMode: "SHADOW_REVIEW"
    }));
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "integrations:read", "ConnectorInstallation");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      (await tx.connectorInstallation.findMany({ orderBy: { createdAt: "desc" } })).map(toDto)
    );
  }

  public async createDraft(context: OrganizationContext, input: ConnectorDraftInput) {
    await this.authorization.assert(context, "integrations:manage", "ConnectorInstallation");
    const adapter = this.adapter(input.providerKey);
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120)
      throw new AppError("CONNECTOR_NAME_INVALID", "Connector name is invalid.", 422);
    assertNoServerOwnedCatalogMappings(input.mapping);
    assertTaxRemittanceMapping(input.mapping);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const id = randomUUID();
      const installation = await tx.connectorInstallation.create({
        data: {
          id,
          organizationId: context.organizationId,
          createdByUserId: context.user.id,
          providerKey: adapter.providerKey,
          webhookLookupHash: connectorWebhookLookupHash(adapter.providerKey, id),
          displayName,
          mapping: input.mapping as Prisma.InputJsonObject
        }
      });
      await this.audit(tx, context, "CONNECTOR_DRAFT_CREATED", installation.id, {
        providerKey: adapter.providerKey
      });
      return toDto(installation);
    });
  }

  public async connect(
    context: OrganizationContext,
    installationId: string,
    credentials: Record<string, unknown>,
    backfillStartAt: Date | undefined,
    backfillEndAt: Date | undefined
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    assertBackfillBounds(backfillStartAt, backfillEndAt);
    const current = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const installation = await tx.connectorInstallation.findFirst({
        where: { id: installationId }
      });
      if (!installation) throw new AppError("CONNECTOR_NOT_FOUND", "Connector was not found.", 404);
      return installation;
    });
    const adapter = this.adapter(current.providerKey);
    const validation = normalizeValidationResult(await adapter.validateCredentials(credentials));
    return this.commitValidatedConnection(
      context,
      installationId,
      current.credentialVersion,
      validation.credentials ?? credentials,
      validation,
      backfillStartAt,
      backfillEndAt
    );
  }

  public async checkHealth(context: OrganizationContext, installationId: string) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    const snapshot = await this.loadConnection(context, installationId, false, false);
    try {
      const rawResult = await snapshot.adapter.checkHealth(snapshot.credentials);
      const result: ConnectorHealthResult =
        typeof rawResult === "string" ? { healthStatus: rawResult } : rawResult;
      const protectedCredentials = result.credentials
        ? this.protector.protect(JSON.stringify(result.credentials))
        : null;
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const updated = await tx.connectorInstallation.updateMany({
          where: { id: installationId, credentialVersion: snapshot.credentialVersion },
          data: {
            healthStatus: result.healthStatus,
            status: "READY",
            externalAccountId: result.externalAccountId ?? snapshot.externalAccountId,
            lastHealthAt: new Date(),
            lastErrorRedacted: null,
            ...(protectedCredentials
              ? {
                  credentialCiphertext: protectedCredentials,
                  credentialVersion: { increment: 1 }
                }
              : {})
          }
        });
        if (updated.count !== 1)
          throw new AppError(
            "STALE_CONNECTOR",
            "The connector changed; retry the health check.",
            409
          );
        await this.writeLog(
          tx,
          context,
          installationId,
          "INFO",
          "connector.health",
          "Connector health check completed.",
          result.detail
        );
        const installation = await tx.connectorInstallation.findUniqueOrThrow({
          where: { id: installationId }
        });
        return toDto(installation);
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "STALE_CONNECTOR") throw error;
      return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const installation = await tx.connectorInstallation.update({
          where: { id: installationId },
          data: {
            healthStatus: "FAILED",
            lastHealthAt: new Date(),
            lastErrorRedacted: "Connector health check failed."
          }
        });
        await this.writeLog(
          tx,
          context,
          installationId,
          "ERROR",
          "connector.health",
          "Connector health check failed."
        );
        return toDto(installation);
      });
    }
  }

  public async commitValidatedConnection(
    context: OrganizationContext,
    installationId: string,
    expectedCredentialVersion: number,
    credentials: Readonly<Record<string, unknown>>,
    validation: ConnectorValidationResult,
    backfillStartAt?: Date,
    backfillEndAt?: Date
  ) {
    const ciphertext = this.protector.protect(JSON.stringify(credentials));
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const current = await tx.connectorInstallation.findFirst({ where: { id: installationId } });
        if (!current) throw new AppError("CONNECTOR_NOT_FOUND", "Connector was not found.", 404);
        const updated = await tx.connectorInstallation.updateMany({
          where: { id: installationId, credentialVersion: expectedCredentialVersion },
          data: {
            credentialCiphertext: ciphertext,
            credentialVersion: { increment: 1 },
            externalAccountId: validation.externalAccountId ?? current.externalAccountId,
            displayName: validation.displayName?.trim().slice(0, 120) || current.displayName,
            consentedAt: new Date(),
            consentedByUserId: context.user.id,
            backfillStartAt: backfillStartAt ?? current.backfillStartAt,
            backfillEndAt: backfillEndAt ?? current.backfillEndAt,
            status: "READY",
            healthStatus: "HEALTHY",
            lastHealthAt: new Date(),
            lastErrorRedacted: null
          }
        });
        if (updated.count !== 1)
          throw new AppError("STALE_CONNECTOR", "The connector changed; reconnect and retry.", 409);
        const installation = await tx.connectorInstallation.findUniqueOrThrow({
          where: { id: installationId }
        });
        await this.writeLog(
          tx,
          context,
          installationId,
          "INFO",
          "connector.connected",
          "Connector credentials validated and stored."
        );
        await this.audit(tx, context, "CONNECTOR_CONNECTED", installationId, {
          providerKey: current.providerKey,
          credentialVersion: installation.credentialVersion,
          externalAccountId: installation.externalAccountId
        });
        return toDto(installation);
      });
    } catch (error) {
      if (isUniqueConflict(error))
        throw new AppError(
          "CONNECTOR_ACCOUNT_ALREADY_CONNECTED",
          "This store or shop is already connected to the organization.",
          409
        );
      throw error;
    }
  }

  public async storePendingCredentials(
    context: OrganizationContext,
    installationId: string,
    credentials: Readonly<Record<string, unknown>>
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    const ciphertext = this.protector.protect(JSON.stringify(credentials));
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await this.assertInstallation(tx, context, installationId);
      const installation = await tx.connectorInstallation.update({
        where: { id: installationId },
        data: {
          credentialCiphertext: ciphertext,
          credentialVersion: { increment: 1 },
          status: "DRAFT",
          healthStatus: "UNKNOWN",
          lastErrorRedacted: null
        }
      });
      await this.writeLog(
        tx,
        context,
        installationId,
        "INFO",
        "connector.authorization.started",
        "Connector authorization started."
      );
      return {
        providerKey: current.providerKey,
        credentialVersion: installation.credentialVersion
      };
    });
  }

  public async loadInstallationAdapter(context: OrganizationContext, installationId: string) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    const current = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.connectorInstallation.findFirst({ where: { id: installationId } })
    );
    if (!current) throw new AppError("CONNECTOR_NOT_FOUND", "Connector was not found.", 404);
    return {
      adapter: this.adapter(current.providerKey),
      providerKey: current.providerKey,
      credentialVersion: current.credentialVersion
    };
  }

  public async loadConnection(
    context: OrganizationContext,
    installationId: string,
    manage = true,
    requireReady = true
  ): Promise<ConnectorConnectionSnapshot> {
    await this.authorization.assert(
      context,
      manage ? "integrations:manage" : "integrations:read",
      "ConnectorInstallation",
      installationId
    );
    const current = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.connectorInstallation.findFirst({ where: { id: installationId } })
    );
    if (!current) throw new AppError("CONNECTOR_NOT_FOUND", "Connector was not found.", 404);
    if (!current.credentialCiphertext || (requireReady && current.status !== "READY"))
      throw new AppError("CONNECTOR_NOT_READY", "Connector is not ready to synchronize.", 409);
    return snapshotFromRow(current, this.adapter(current.providerKey), this.protector);
  }

  public async loadWebhookConnection(
    providerKey: string,
    installationId: string
  ): Promise<ConnectorConnectionSnapshot> {
    const normalizedProvider = providerKey.trim().toUpperCase();
    const lookupHash = connectorWebhookLookupHash(normalizedProvider, installationId);
    const current = await withConnectorWebhookLookupTransaction(this.prisma, lookupHash, (tx) =>
      tx.connectorInstallation.findFirst({
        where: {
          id: installationId,
          providerKey: normalizedProvider,
          webhookLookupHash: lookupHash,
          status: "READY"
        }
      })
    );
    if (!current?.credentialCiphertext)
      throw new AppError("COMMERCE_WEBHOOK_INVALID", "Webhook verification failed.", 400);
    return snapshotFromRow(current, this.adapter(current.providerKey), this.protector);
  }

  public async rotateCredentials(
    context: OrganizationContext,
    snapshot: ConnectorConnectionSnapshot,
    credentials: Readonly<Record<string, unknown>>
  ): Promise<void> {
    const ciphertext = this.protector.protect(JSON.stringify(credentials));
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.connectorInstallation.updateMany({
        where: {
          id: snapshot.installationId,
          credentialVersion: snapshot.credentialVersion
        },
        data: { credentialCiphertext: ciphertext, credentialVersion: { increment: 1 } }
      });
      if (result.count !== 1)
        throw new AppError("STALE_CONNECTOR", "The connector changed during token rotation.", 409);
    });
  }

  public async updateWebhookSecret(
    context: OrganizationContext,
    installationId: string,
    signingSecret: string
  ) {
    const snapshot = await this.loadConnection(context, installationId, true, false);
    await this.rotateCredentials(context, snapshot, {
      ...snapshot.credentials,
      webhookSecret: signingSecret
    });
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const installation = await tx.connectorInstallation.update({
        where: { id: installationId },
        data: { webhookStatus: "NOT_CONFIGURED" }
      });
      await this.writeLog(
        tx,
        context,
        installationId,
        "INFO",
        "connector.webhook.secret.updated",
        "Webhook signing secret updated."
      );
      return toDto(installation);
    });
  }

  public async rotateWebhookCredentials(
    snapshot: ConnectorConnectionSnapshot,
    credentials: Readonly<Record<string, unknown>>
  ): Promise<void> {
    const ciphertext = this.protector.protect(JSON.stringify(credentials));
    await withCommerceWebhookTransaction(
      this.prisma,
      { organizationId: snapshot.organizationId, actorUserId: snapshot.actorUserId },
      async (tx) => {
        const result = await tx.connectorInstallation.updateMany({
          where: { id: snapshot.installationId, credentialVersion: snapshot.credentialVersion },
          data: { credentialCiphertext: ciphertext, credentialVersion: { increment: 1 } }
        });
        if (result.count !== 1)
          throw new AppError("COMMERCE_WEBHOOK_INVALID", "Webhook verification failed.", 400);
      }
    );
  }

  public async updateMapping(
    context: OrganizationContext,
    installationId: string,
    version: number,
    mapping: Record<string, unknown>
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    assertNoServerOwnedCatalogMappings(mapping);
    assertTaxRemittanceMapping(mapping);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await this.assertInstallation(tx, context, installationId);
      const nextMapping = preserveServerOwnedCatalogMappings(current.mapping, mapping);
      const updated = await tx.connectorInstallation.updateMany({
        where: { id: installationId, mappingVersion: version },
        data: {
          mapping: nextMapping,
          mappingVersion: { increment: 1 }
        }
      });
      if (updated.count !== 1)
        throw new AppError("STALE_CONNECTOR_MAPPING", "The connector mapping changed.", 409);
      const installation = await tx.connectorInstallation.findUniqueOrThrow({
        where: { id: installationId }
      });
      await this.audit(tx, context, "CONNECTOR_MAPPING_UPDATED", installationId, {
        mappingVersion: installation.mappingVersion
      });
      return toDto(installation);
    });
  }

  public async changeStatus(
    context: OrganizationContext,
    installationId: string,
    action: "PAUSE" | "RESUME" | "DISCONNECT"
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await this.assertInstallation(tx, context, installationId);
      if (action === "RESUME" && !current.credentialCiphertext)
        throw new AppError("CONNECTOR_NOT_READY", "Reconnect this connector first.", 409);
      const installation = await tx.connectorInstallation.update({
        where: { id: installationId },
        data:
          action === "DISCONNECT"
            ? {
                status: "DISCONNECTED",
                healthStatus: "UNKNOWN",
                credentialCiphertext: null,
                syncLeaseTokenHash: null,
                syncLeaseExpiresAt: null,
                webhookStatus: "NOT_CONFIGURED"
              }
            : {
                status: action === "PAUSE" ? "PAUSED" : "READY",
                ...(action === "RESUME" ? { lastErrorRedacted: null } : {})
              }
      });
      await this.writeLog(
        tx,
        context,
        installationId,
        "INFO",
        `connector.${action.toLowerCase()}`,
        action === "DISCONNECT"
          ? "Connector credentials removed. Imported evidence was retained."
          : action === "PAUSE"
            ? "Connector synchronization paused."
            : "Connector synchronization resumed."
      );
      await this.audit(tx, context, `CONNECTOR_${action}`, installationId, {});
      return toDto(installation);
    });
  }

  public async acquireSyncLease(context: OrganizationContext, installationId: string) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    const token = randomUUID();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 2 * 60_000);
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.connectorInstallation.updateMany({
        where: {
          id: installationId,
          status: "READY",
          OR: [{ syncLeaseExpiresAt: null }, { syncLeaseExpiresAt: { lt: new Date() } }]
        },
        data: { syncLeaseTokenHash: tokenHash, syncLeaseExpiresAt: expiresAt }
      });
      if (result.count !== 1)
        throw new AppError(
          "CONNECTOR_SYNC_ALREADY_RUNNING",
          "A synchronization is already running or the connector is paused.",
          409
        );
    });
    return { token, tokenHash, expiresAt };
  }

  public async finishSync(
    context: OrganizationContext,
    installationId: string,
    leaseTokenHash: string,
    result: {
      success: boolean;
      complete: boolean;
      imported: number;
      replayed: number;
      completedThrough?: Date;
      error?: string;
      checkpoint?: ConnectorCheckpointInput;
    }
  ): Promise<void> {
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.connectorInstallation.updateMany({
        where: { id: installationId, syncLeaseTokenHash: leaseTokenHash },
        data: {
          syncLeaseTokenHash: null,
          syncLeaseExpiresAt: null,
          ...(result.success
            ? {
                ...(result.complete && result.completedThrough
                  ? { lastSyncAt: result.completedThrough }
                  : {}),
                healthStatus: "HEALTHY",
                lastErrorRedacted: null
              }
            : {
                healthStatus: "DEGRADED",
                lastErrorRedacted: result.error ?? "Connector synchronization failed."
              })
        }
      });
      if (updated.count !== 1) return;
      if (result.success && result.checkpoint) {
        assertConnectorScope(result.checkpoint.scope);
        const checkpoint = redactConnectorValue(
          result.checkpoint.checkpoint
        ) as Prisma.InputJsonObject;
        await tx.connectorCheckpoint.upsert({
          where: {
            installationId_scope: {
              installationId,
              scope: result.checkpoint.scope
            }
          },
          create: {
            organizationId: context.organizationId,
            installationId,
            scope: result.checkpoint.scope,
            checkpoint,
            lastSuccessAt: new Date()
          },
          update: { checkpoint, lastSuccessAt: new Date() }
        });
      }
      const completed = result.success && result.complete;
      await this.writeLog(
        tx,
        context,
        installationId,
        result.success ? "INFO" : "ERROR",
        completed
          ? "connector.sync.completed"
          : result.success
            ? "connector.sync.paused"
            : "connector.sync.failed",
        result.success
          ? completed
            ? "Connector synchronization completed."
            : "Connector synchronization paused with more provider pages remaining."
          : "Connector synchronization failed.",
        { imported: result.imported, replayed: result.replayed, complete: result.complete }
      );
    });
  }

  public async releaseSyncLease(
    context: OrganizationContext,
    installationId: string,
    leaseTokenHash: string
  ): Promise<void> {
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.connectorInstallation.updateMany({
        where: { id: installationId, syncLeaseTokenHash: leaseTokenHash },
        data: { syncLeaseTokenHash: null, syncLeaseExpiresAt: null }
      });
    });
  }

  public async markWebhook(
    snapshot: ConnectorConnectionSnapshot,
    status: "ACTIVE" | "DEGRADED" | "FAILED",
    eventCount: number
  ): Promise<void> {
    await withCommerceWebhookTransaction(
      this.prisma,
      { organizationId: snapshot.organizationId, actorUserId: snapshot.actorUserId },
      async (tx) => {
        await tx.connectorInstallation.update({
          where: { id: snapshot.installationId },
          data: {
            webhookStatus: status,
            ...(status === "ACTIVE" ? { lastWebhookAt: new Date() } : {})
          }
        });
        await tx.connectorLog.create({
          data: {
            organizationId: snapshot.organizationId,
            installationId: snapshot.installationId,
            level: status === "ACTIVE" ? "INFO" : "WARN",
            eventType: "connector.webhook",
            message:
              status === "ACTIVE"
                ? "Verified commerce webhook received."
                : "Commerce webhook requires attention.",
            redactedMetadata: { eventCount }
          }
        });
      }
    );
  }

  public async setWebhookRegistration(
    context: OrganizationContext,
    installationId: string,
    status: "ACTIVE" | "NOT_CONFIGURED"
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertInstallation(tx, context, installationId);
      const installation = await tx.connectorInstallation.update({
        where: { id: installationId },
        data: { webhookStatus: status }
      });
      return toDto(installation);
    });
  }

  /**
   * Connector adapters use these tenant-scoped state operations so replay and
   * recovery do not need direct Prisma access or provider-specific tables.
   */
  public async saveCheckpoint(
    context: OrganizationContext,
    installationId: string,
    input: ConnectorCheckpointInput
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    assertConnectorScope(input.scope);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertInstallation(tx, context, installationId);
      const checkpoint = await tx.connectorCheckpoint.upsert({
        where: { installationId_scope: { installationId, scope: input.scope } },
        create: {
          organizationId: context.organizationId,
          installationId,
          scope: input.scope,
          checkpoint: redactConnectorValue(input.checkpoint) as Prisma.InputJsonObject,
          lastSuccessAt: new Date()
        },
        update: {
          checkpoint: redactConnectorValue(input.checkpoint) as Prisma.InputJsonObject,
          lastSuccessAt: new Date()
        }
      });
      await this.writeLog(
        tx,
        context,
        installationId,
        "INFO",
        "connector.checkpoint",
        "Connector checkpoint saved."
      );
      return checkpointDto(checkpoint);
    });
  }

  public async getCheckpoint(context: OrganizationContext, installationId: string, scope: string) {
    await this.authorization.assert(
      context,
      "integrations:read",
      "ConnectorInstallation",
      installationId
    );
    assertConnectorScope(scope);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertInstallation(tx, context, installationId);
      const checkpoint = await tx.connectorCheckpoint.findUnique({
        where: { installationId_scope: { installationId, scope } }
      });
      return checkpoint ? checkpointDto(checkpoint) : null;
    });
  }

  public async openConflict(
    context: OrganizationContext,
    installationId: string,
    input: ConnectorConflictInput
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    assertConflictFields(input);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertInstallation(tx, context, installationId);
      const conflict = await tx.connectorConflict.upsert({
        where: {
          installationId_externalRef_kind: {
            installationId,
            externalRef: input.externalRef,
            kind: input.kind
          }
        },
        create: {
          organizationId: context.organizationId,
          installationId,
          externalRef: input.externalRef,
          kind: input.kind,
          detailRedacted: redactConnectorValue(input.detail) as Prisma.InputJsonObject,
          status: "OPEN"
        },
        update: {
          detailRedacted: redactConnectorValue(input.detail) as Prisma.InputJsonObject,
          status: "OPEN",
          resolvedAt: null,
          resolvedByUserId: null
        }
      });
      await this.writeLog(
        tx,
        context,
        installationId,
        "WARN",
        "connector.conflict",
        "Connector conflict requires review."
      );
      return conflictDto(conflict);
    });
  }

  public async listConflicts(context: OrganizationContext, installationId: string) {
    await this.authorization.assert(
      context,
      "integrations:read",
      "ConnectorInstallation",
      installationId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertInstallation(tx, context, installationId);
      return (
        await tx.connectorConflict.findMany({
          where: { installationId },
          orderBy: { createdAt: "desc" }
        })
      ).map(conflictDto);
    });
  }

  public async resolveConflict(
    context: OrganizationContext,
    installationId: string,
    conflictId: string
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertInstallation(tx, context, installationId);
      const current = await tx.connectorConflict.findFirst({
        where: { id: conflictId, installationId }
      });
      if (!current)
        throw new AppError(
          "CONNECTOR_CONFLICT_NOT_FOUND",
          "Connector conflict was not found.",
          404
        );
      const conflict = await tx.connectorConflict.update({
        where: { id: conflictId },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByUserId: context.user.id }
      });
      await this.writeLog(
        tx,
        context,
        installationId,
        "INFO",
        "connector.conflict.resolved",
        "Connector conflict resolved."
      );
      return conflictDto(conflict);
    });
  }

  public async listLogs(context: OrganizationContext, installationId: string, limit = 100) {
    await this.authorization.assert(
      context,
      "integrations:read",
      "ConnectorInstallation",
      installationId
    );
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertInstallation(tx, context, installationId);
      return tx.connectorLog.findMany({
        where: { installationId },
        orderBy: { createdAt: "desc" },
        take: boundedLimit,
        select: {
          id: true,
          level: true,
          eventType: true,
          message: true,
          redactedMetadata: true,
          requestId: true,
          createdAt: true
        }
      });
    });
  }

  private async assertInstallation(
    tx: RuntimeTransaction,
    context: OrganizationContext,
    installationId: string
  ) {
    const installation = await tx.connectorInstallation.findFirst({
      where: { id: installationId }
    });
    if (!installation || installation.organizationId !== context.organizationId)
      throw new AppError("CONNECTOR_NOT_FOUND", "Connector was not found.", 404);
    return installation;
  }

  private async writeLog(
    tx: RuntimeTransaction,
    context: OrganizationContext,
    installationId: string,
    level: string,
    eventType: string,
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) {
    await tx.connectorLog.create({
      data: {
        organizationId: context.organizationId,
        installationId,
        level,
        eventType,
        message,
        ...(metadata
          ? {
              redactedMetadata: redactConnectorValue(metadata) as Prisma.InputJsonObject
            }
          : {}),
        requestId: context.requestId
      }
    });
  }

  private adapter(providerKey: string): ConnectorAdapter {
    const adapter = this.adapters.get(providerKey.trim().toUpperCase());
    if (!adapter)
      throw new AppError(
        "CONNECTOR_PROVIDER_UNAVAILABLE",
        "Connector provider is not approved.",
        422
      );
    return adapter;
  }

  private async audit(
    tx: RuntimeTransaction,
    context: OrganizationContext,
    action: string,
    targetId: string,
    metadata: object
  ) {
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        action,
        targetType: "ConnectorInstallation",
        targetId,
        requestId: context.requestId,
        metadata: withAuditOrigin(context, metadata)
      }
    });
  }
}

function assertBackfillBounds(start: Date | undefined, end: Date | undefined): void {
  if (!start && !end) return;
  if (
    !start ||
    !end ||
    start >= end ||
    end > new Date() ||
    end.getTime() - start.getTime() > 90 * 24 * 60 * 60_000
  )
    throw new AppError(
      "CONNECTOR_BACKFILL_INVALID",
      "Backfill must be a completed range of 90 days or less.",
      422
    );
}
function parseCredentials(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    throw new AppError(
      "CONNECTOR_CREDENTIAL_INVALID",
      "Connector credential storage is invalid.",
      500
    );
  return parsed as Record<string, unknown>;
}

function normalizeValidationResult(
  value: ConnectorValidationResult | undefined
): ConnectorValidationResult {
  return value ?? {};
}

function snapshotFromRow(
  row: {
    id: string;
    organizationId: string;
    createdByUserId: string;
    providerKey: string;
    externalAccountId: string | null;
    credentialCiphertext: string | null;
    credentialVersion: number;
    mapping: Prisma.JsonValue;
    mappingVersion: number;
    backfillStartAt: Date | null;
    backfillEndAt: Date | null;
    lastSyncAt: Date | null;
  },
  adapter: ConnectorAdapter,
  protector: PaymentAccountProtector
): ConnectorConnectionSnapshot {
  if (!row.credentialCiphertext)
    throw new AppError("CONNECTOR_NOT_READY", "Connector credentials are unavailable.", 409);
  const mapping =
    row.mapping && typeof row.mapping === "object" && !Array.isArray(row.mapping)
      ? (row.mapping as Readonly<Record<string, unknown>>)
      : {};
  return {
    installationId: row.id,
    organizationId: row.organizationId,
    actorUserId: row.createdByUserId,
    providerKey: row.providerKey,
    externalAccountId: row.externalAccountId,
    credentialVersion: row.credentialVersion,
    credentials: parseCredentials(protector.reveal(row.credentialCiphertext)),
    mapping,
    mappingVersion: row.mappingVersion,
    backfillStartAt: row.backfillStartAt,
    backfillEndAt: row.backfillEndAt,
    lastSyncAt: row.lastSyncAt,
    adapter
  };
}

function connectorWebhookLookupHash(providerKey: string, installationId: string): string {
  return createHash("sha256")
    .update(`${providerKey.trim().toUpperCase()}:${installationId}`)
    .digest("hex");
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function assertConnectorScope(value: string): void {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(value.trim()))
    throw new AppError("CONNECTOR_SCOPE_INVALID", "Connector checkpoint scope is invalid.", 422);
}

function assertConflictFields(input: ConnectorConflictInput): void {
  if (
    input.externalRef.length < 1 ||
    input.externalRef.length > 200 ||
    input.externalRef.includes(String.fromCharCode(0)) ||
    !/^[A-Za-z0-9_.:-]{1,80}$/.test(input.kind)
  )
    throw new AppError(
      "CONNECTOR_CONFLICT_INVALID",
      "Connector conflict identity is invalid.",
      422
    );
}

function assertNoServerOwnedCatalogMappings(mapping: Readonly<Record<string, unknown>>): void {
  const reservedKeys = serverOwnedCatalogMappingKeys.filter((key) =>
    Object.prototype.hasOwnProperty.call(mapping, key)
  );
  if (!reservedKeys.length) return;
  throw new AppError(
    "CONNECTOR_MAPPING_RESERVED",
    "Catalog confirmation mappings are server-managed. Approve product matches through catalog review.",
    422,
    { reservedKeys }
  );
}

function assertTaxRemittanceMapping(mapping: Readonly<Record<string, unknown>>): void {
  const responsibility = mapping.taxRemittanceResponsibility;
  if (
    responsibility !== undefined &&
    responsibility !== "SELLER" &&
    responsibility !== "MARKETPLACE" &&
    responsibility !== "REVIEW_REQUIRED"
  )
    throw new AppError(
      "CONNECTOR_TAX_REMITTANCE_INVALID",
      "Choose seller, marketplace, or review-required tax remittance treatment.",
      422
    );
  const taxMappings = mapping.taxMappings;
  if (
    taxMappings !== undefined &&
    (!taxMappings || typeof taxMappings !== "object" || Array.isArray(taxMappings))
  )
    throw new AppError(
      "CONNECTOR_TAX_MAPPING_INVALID",
      "Tax mappings must be a list of provider tax rates and PennyWise Accounting tax codes.",
      422
    );
  if (
    taxMappings &&
    Object.entries(taxMappings as Record<string, unknown>).some(
      ([source, destination]) =>
        !source.trim() ||
        source.length > 200 ||
        typeof destination !== "string" ||
        !destination.trim() ||
        destination.length > 200
    )
  )
    throw new AppError(
      "CONNECTOR_TAX_MAPPING_INVALID",
      "Every tax mapping needs a provider rate and a PennyWise Accounting tax code.",
      422
    );
  const remittanceMappings = mapping.taxRemittanceMappings;
  if (
    remittanceMappings !== undefined &&
    (!remittanceMappings ||
      typeof remittanceMappings !== "object" ||
      Array.isArray(remittanceMappings))
  )
    throw new AppError(
      "CONNECTOR_TAX_REMITTANCE_INVALID",
      "Per-tax remittance mappings must be a list of provider tax rates and seller or marketplace responsibility.",
      422
    );
  if (
    remittanceMappings &&
    Object.entries(remittanceMappings as Record<string, unknown>).some(
      ([source, destination]) =>
        !source.trim() ||
        source.length > 200 ||
        !["SELLER", "MARKETPLACE", "REVIEW_REQUIRED"].includes(String(destination))
    )
  )
    throw new AppError(
      "CONNECTOR_TAX_REMITTANCE_INVALID",
      "Every per-tax remittance mapping must be SELLER, MARKETPLACE, or REVIEW_REQUIRED.",
      422
    );
}

function preserveServerOwnedCatalogMappings(
  currentValue: Prisma.JsonValue,
  requested: Readonly<Record<string, unknown>>
): Prisma.InputJsonObject {
  const current =
    currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
      ? (currentValue as Readonly<Record<string, Prisma.JsonValue>>)
      : {};
  const preserved = Object.fromEntries(
    serverOwnedCatalogMappingKeys.flatMap((key) =>
      Object.prototype.hasOwnProperty.call(current, key) ? [[key, current[key]] as const] : []
    )
  );
  return { ...requested, ...preserved } as Prisma.InputJsonObject;
}

function redactConnectorValue(value: unknown, key = ""): unknown {
  if (isSensitiveConnectorKey(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactConnectorValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactConnectorValue(entryValue, entryKey)
      ])
    );
  }
  return value;
}

function isSensitiveConnectorKey(key: string): boolean {
  return /token|secret|password|authorization|api[_-]?key|credential|private[_-]?key/i.test(key);
}

function checkpointDto(row: {
  id: string;
  scope: string;
  checkpoint: Prisma.JsonValue;
  lastSuccessAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    scope: row.scope,
    checkpoint: row.checkpoint,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString()
  };
}

function conflictDto(row: {
  id: string;
  externalRef: string;
  kind: string;
  status: string;
  detailRedacted: Prisma.JsonValue;
  resolvedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    externalRef: row.externalRef,
    kind: row.kind,
    status: row.status,
    detail: row.detailRedacted,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}
function toDto(row: {
  id: string;
  providerKey: string;
  externalAccountId: string | null;
  displayName: string;
  status: string;
  healthStatus: string;
  credentialVersion: number;
  mapping: Prisma.JsonValue;
  mappingVersion: number;
  backfillStartAt: Date | null;
  backfillEndAt: Date | null;
  consentedAt: Date | null;
  lastHealthAt: Date | null;
  lastSyncAt: Date | null;
  lastWebhookAt: Date | null;
  webhookStatus: string;
  lastErrorRedacted: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    providerKey: row.providerKey,
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    status: row.status,
    healthStatus: row.healthStatus,
    credentialVersion: row.credentialVersion,
    mapping: row.mapping,
    mappingVersion: row.mappingVersion,
    backfillStartAt: row.backfillStartAt?.toISOString() ?? null,
    backfillEndAt: row.backfillEndAt?.toISOString() ?? null,
    consentedAt: row.consentedAt?.toISOString() ?? null,
    lastHealthAt: row.lastHealthAt?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastWebhookAt: row.lastWebhookAt?.toISOString() ?? null,
    webhookStatus: row.webhookStatus,
    lastErrorRedacted: row.lastErrorRedacted,
    createdAt: row.createdAt.toISOString()
  };
}
function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
