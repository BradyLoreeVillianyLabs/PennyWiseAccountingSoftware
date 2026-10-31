import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { hashJson } from "../utils/json.js";
import { AesPaymentAccountProtector, type PaymentAccountProtector } from "./payment-provider.js";
import type {
  BankFeedProviderAccount,
  BankFeedProviderAdapter,
  BankFeedProviderSyncResult,
  BankFeedProviderTransaction
} from "./bank-feed-provider.js";
import { environmentValueOrDefault } from "../environment.js";

type Tx = Prisma.TransactionClient;

export interface BankFeedServiceOptions {
  readonly adapter?: BankFeedProviderAdapter | undefined;
  readonly credentialProtector?: PaymentAccountProtector | undefined;
  readonly betaRuntime?: boolean | undefined;
  readonly betaSandboxApproved?: boolean | undefined;
  readonly productionApproved?: boolean | undefined;
}

export interface BankFeedConnectInput {
  readonly publicToken: string;
  /** Present only when replacing consent for an existing connection. */
  readonly bankFeedItemId?: string | undefined;
  readonly mappings: readonly {
    readonly bankAccountId: string;
    readonly providerAccountReference: string;
  }[];
}

/**
 * Durable feed service. It only creates reviewable imported transactions; it
 * never creates journals, matches, payments, or reconciliations. The provider
 * adapter is intentionally optional, so an unconfigured build fails closed
 * while manual CSV/OFX/QFX imports remain fully available.
 */
export class BankFeedService {
  private readonly authorization: AuthorizationService;
  private readonly protector: PaymentAccountProtector;
  private readonly betaRuntime: boolean;
  private readonly betaSandboxApproved: boolean;
  private readonly productionApproved: boolean;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly options: BankFeedServiceOptions = {}
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.protector =
      options.credentialProtector ??
      new AesPaymentAccountProtector(
        environmentValueOrDefault(
          process.env.BANK_FEED_CREDENTIAL_ENCRYPTION_SECRET,
          "development-bank-feed-credential-secret"
        )
      );
    this.betaRuntime = options.betaRuntime === true;
    this.betaSandboxApproved = options.betaSandboxApproved === true;
    this.productionApproved = options.productionApproved === true;
  }

  public providerStatus() {
    const adapter = this.options.adapter;
    const connectionFlow = adapter?.connectionFlow ?? "HOSTED_CONSENT";
    return {
      configured: Boolean(adapter),
      providerKey: adapter?.providerKey ?? null,
      environment: adapter?.environment ?? null,
      connectionFlow: adapter ? connectionFlow : null,
      testOnly: adapter?.testOnly === true,
      connectEnabled: this.providerEnabled(),
      supportsHostedConsent: connectionFlow === "HOSTED_CONSENT",
      supportedCurrencies: ["CAD", "USD"],
      automaticPosting: false,
      manualFallback: ["CSV", "OFX", "QFX"],
      boundary: this.providerEnabled()
        ? "Connected activity is imported for review. PennyWise never posts, matches, or reconciles it automatically."
        : this.providerGateMessage()
    };
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "bank-reports:read", "BankFeedItem");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const items = await tx.bankFeedItem.findMany({
        where: { organizationId: context.organizationId },
        include: {
          accountMappings: {
            include: { bankAccount: true },
            orderBy: { createdAt: "asc" }
          },
          syncs: { orderBy: { startedAt: "desc" }, take: 1 }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      return items.map(feedItemDto);
    });
  }

  public async createLinkToken(context: OrganizationContext, itemId?: string) {
    await this.authorization.assert(context, "bank-feeds:manage", "BankFeedItem", itemId);
    const adapter = this.requireAdapter();
    let accessToken: string | undefined;
    if (itemId) {
      const item = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.bankFeedItem.findFirst({ where: { id: itemId, organizationId: context.organizationId } })
      );
      if (!item) throw new AppError("BANK_FEED_NOT_FOUND", "Connected bank was not found.", 404);
      if (item.status === "DISCONNECTED")
        throw new AppError(
          "BANK_FEED_DISCONNECTED",
          "This bank was disconnected. Start a new secure connection instead.",
          409
        );
      accessToken = this.revealCredential(item.credentialCiphertext);
    }
    const result = await adapter.createLinkToken({
      organizationId: context.organizationId,
      userId: context.user.id,
      ...(accessToken ? { accessToken } : {})
    });
    return {
      ...result,
      connectionFlow: result.connectionFlow ?? adapter.connectionFlow ?? "HOSTED_CONSENT"
    };
  }

  public async connect(context: OrganizationContext, input: BankFeedConnectInput) {
    await this.authorization.assert(context, "bank-feeds:manage", "BankFeedItem");
    const adapter = this.requireAdapter();
    validateConnectInput(input);
    const exchanged = await adapter.exchangePublicToken(input.publicToken.trim());
    const providerAccounts = await adapter.listAccounts(exchanged.accessToken);
    const selected = selectProviderAccounts(providerAccounts, input.mappings);
    const now = new Date();
    const ciphertext = this.protector.protect(exchanged.accessToken);

    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const bankAccountIds = selected.map((mapping) => mapping.bankAccountId);
        const bankAccounts = await tx.bankAccount.findMany({
          where: {
            organizationId: context.organizationId,
            id: { in: bankAccountIds },
            isActive: true
          }
        });
        if (bankAccounts.length !== bankAccountIds.length)
          throw new AppError(
            "BANK_FEED_ACCOUNT_INVALID",
            "Choose active PennyWise financial accounts before connecting the bank.",
            422
          );
        for (const mapping of selected) {
          const bankAccount = bankAccounts.find((entry) => entry.id === mapping.bankAccountId)!;
          if (bankAccount.currency !== mapping.provider.currency)
            throw new AppError(
              "BANK_FEED_CURRENCY_MISMATCH",
              `${bankAccount.displayName} uses ${bankAccount.currency}; the connected account uses ${mapping.provider.currency}.`,
              422
            );
          if (bankAccount.accountKind !== mapping.provider.accountKind)
            throw new AppError(
              "BANK_FEED_ACCOUNT_KIND_MISMATCH",
              `${bankAccount.displayName} must be linked to a ${mapping.provider.accountKind === "BANK" ? "bank" : "credit-card"} source.`,
              422
            );
        }

        const occupied = await tx.bankFeedAccountMapping.findMany({
          where: { organizationId: context.organizationId, bankAccountId: { in: bankAccountIds } },
          select: { bankAccountId: true, bankFeedItemId: true }
        });
        const existingForProviderReference = await tx.bankFeedItem.findFirst({
          where: {
            organizationId: context.organizationId,
            providerKey: adapter.providerKey,
            providerItemReference: exchanged.providerItemReference
          }
        });
        const requestedExisting = input.bankFeedItemId
          ? await tx.bankFeedItem.findFirst({
              where: {
                id: input.bankFeedItemId,
                organizationId: context.organizationId,
                providerKey: adapter.providerKey
              }
            })
          : null;
        if (input.bankFeedItemId && !requestedExisting)
          throw new AppError(
            "BANK_FEED_NOT_FOUND",
            "Connected bank was not found. Start a new secure connection instead.",
            404
          );
        if (
          requestedExisting &&
          existingForProviderReference &&
          requestedExisting.id !== existingForProviderReference.id
        )
          throw new AppError(
            "BANK_FEED_ALREADY_CONNECTED",
            "This secure bank connection is already linked to another PennyWise connection.",
            409
          );
        const existing = requestedExisting ?? existingForProviderReference;
        if (occupied.some((mapping) => mapping.bankFeedItemId !== existing?.id))
          throw new AppError(
            "BANK_FEED_ACCOUNT_ALREADY_CONNECTED",
            "A selected PennyWise financial account is already connected. Disconnect it before changing banks.",
            409
          );

        const item = existing
          ? await tx.bankFeedItem.update({
              where: { id: existing.id },
              data: {
                providerItemReference: exchanged.providerItemReference,
                credentialCiphertext: ciphertext,
                credentialVersion: { increment: 1 },
                institutionReference: exchanged.institutionReference ?? null,
                institutionName: exchanged.institutionName ?? null,
                consentedAt: now,
                status: "READY",
                lastErrorRedacted: null,
                updatedByUserId: context.user.id
              }
            })
          : await tx.bankFeedItem.create({
              data: {
                organizationId: context.organizationId,
                providerKey: adapter.providerKey,
                providerItemReference: exchanged.providerItemReference,
                credentialCiphertext: ciphertext,
                institutionReference: exchanged.institutionReference ?? null,
                institutionName: exchanged.institutionName ?? null,
                consentedAt: now,
                status: "READY",
                createdByUserId: context.user.id,
                updatedByUserId: context.user.id
              }
            });
        await tx.bankFeedAccountMapping.deleteMany({ where: { bankFeedItemId: item.id } });
        await tx.bankFeedAccountMapping.createMany({
          data: selected.map((mapping) => ({
            organizationId: context.organizationId,
            bankFeedItemId: item.id,
            bankAccountId: mapping.bankAccountId,
            providerAccountReference: mapping.provider.providerAccountReference,
            displayName: mapping.provider.displayName,
            maskedAccountReference: mapping.provider.maskedAccountReference,
            currency: mapping.provider.currency,
            active: true
          }))
        });
        await audit(
          tx,
          context,
          existing ? "BANK_FEED_RECONNECTED" : "BANK_FEED_CONNECTED",
          item.id,
          {
            providerKey: adapter.providerKey,
            mappedAccountCount: selected.length,
            environment: adapter.environment
          }
        );
        await outbox(tx, context.organizationId, "bank-feed.connected", item.id, {
          providerKey: adapter.providerKey,
          mappedAccountCount: selected.length
        });
        return feedItemDto(
          await tx.bankFeedItem.findUniqueOrThrow({
            where: { id: item.id },
            include: { accountMappings: { include: { bankAccount: true } }, syncs: { take: 1 } }
          })
        );
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isUniqueConflict(error))
        throw new AppError(
          "BANK_FEED_ALREADY_CONNECTED",
          "This bank connection is already present. Refresh the banking page before retrying.",
          409
        );
      throw error;
    }
  }

  /**
   * Flinks returns a loginId, whereas Plaid supplies account metadata directly
   * in its browser callback. This preview lets the browser show the same
   * mapping confirmation for either hosted-consent provider without saving an
   * unconfirmed bank connection.
   */
  public async previewConnection(context: OrganizationContext, publicToken: string) {
    await this.authorization.assert(context, "bank-feeds:manage", "BankFeedItem");
    const adapter = this.requireAdapter();
    if (!publicToken.trim() || publicToken.length > 4_000)
      throw new AppError(
        "BANK_FEED_PUBLIC_TOKEN_INVALID",
        "Bank authorization could not be verified.",
        422
      );
    const exchanged = await adapter.exchangePublicToken(publicToken.trim());
    return { providerAccounts: await adapter.listAccounts(exchanged.accessToken) };
  }

  public async sync(context: OrganizationContext, itemId: string) {
    await this.authorization.assert(context, "bank-feeds:manage", "BankFeedItem", itemId);
    const adapter = this.requireAdapter();
    let started: {
      item: { readonly id: string; readonly lastCursor: string | null };
      sync: { readonly id: string };
      accessToken: string;
    };
    try {
      started = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const item = await tx.bankFeedItem.findFirst({
          where: { id: itemId, organizationId: context.organizationId },
          include: { accountMappings: { where: { active: true } } }
        });
        if (!item) throw new AppError("BANK_FEED_NOT_FOUND", "Connected bank was not found.", 404);
        if (item.status === "DISCONNECTED")
          throw new AppError(
            "BANK_FEED_DISCONNECTED",
            "Reconnect this bank before syncing it.",
            409
          );
        if (item.status === "CONSENT_EXPIRED")
          throw new AppError(
            "BANK_FEED_CONSENT_EXPIRED",
            "Your bank needs you to reconnect it before PennyWise can refresh activity.",
            409
          );
        if (item.accountMappings.length === 0)
          throw new AppError(
            "BANK_FEED_MAPPING_REQUIRED",
            "Map at least one PennyWise financial account before syncing.",
            422
          );
        const sync = await tx.bankFeedSync.create({
          data: {
            organizationId: context.organizationId,
            bankFeedItemId: item.id,
            cursorBefore: item.lastCursor,
            triggeredByUserId: context.user.id
          }
        });
        return {
          item: { id: item.id, lastCursor: item.lastCursor },
          sync: { id: sync.id },
          accessToken: this.revealCredential(item.credentialCiphertext)
        };
      });
    } catch (error) {
      if (isUniqueConflict(error))
        throw new AppError(
          "BANK_FEED_SYNC_IN_PROGRESS",
          "This bank is already being refreshed. Wait for that review import to finish.",
          409
        );
      throw error;
    }

    let providerResult: BankFeedProviderSyncResult;
    try {
      providerResult = await adapter.sync({
        accessToken: started.accessToken,
        cursor: started.item.lastCursor
      });
    } catch (error) {
      await this.failSync(context, started.item.id, started.sync.id, error);
      throw error;
    }

    try {
      return await this.applySync(context, started.item.id, started.sync.id, providerResult);
    } catch (error) {
      await this.failSync(context, started.item.id, started.sync.id, error);
      throw error;
    }
  }

  public async disconnect(context: OrganizationContext, itemId: string) {
    await this.authorization.assert(context, "bank-feeds:manage", "BankFeedItem", itemId);
    const adapter = this.requireAdapter();
    const item = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bankFeedItem.findFirst({ where: { id: itemId, organizationId: context.organizationId } })
    );
    if (!item) throw new AppError("BANK_FEED_NOT_FOUND", "Connected bank was not found.", 404);
    if (item.status !== "DISCONNECTED")
      await adapter.disconnect(this.revealCredential(item.credentialCiphertext));
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.bankFeedItem.update({
        where: { id: item.id },
        data: {
          credentialCiphertext: "REVOKED",
          credentialVersion: { increment: 1 },
          status: "DISCONNECTED",
          lastErrorRedacted: null,
          updatedByUserId: context.user.id
        }
      });
      await tx.bankFeedAccountMapping.deleteMany({ where: { bankFeedItemId: item.id } });
      await audit(tx, context, "BANK_FEED_DISCONNECTED", item.id, {
        providerKey: item.providerKey
      });
      await outbox(tx, context.organizationId, "bank-feed.disconnected", item.id, {
        providerKey: item.providerKey
      });
      return feedItemDto({ ...updated, accountMappings: [], syncs: [] });
    });
  }

  private async applySync(
    context: OrganizationContext,
    itemId: string,
    syncId: string,
    result: BankFeedProviderSyncResult
  ) {
    validateProviderResult(result);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const item = await tx.bankFeedItem.findFirst({
        where: {
          id: itemId,
          organizationId: context.organizationId,
          status: { not: "DISCONNECTED" }
        },
        include: { accountMappings: { where: { active: true }, include: { bankAccount: true } } }
      });
      const sync = await tx.bankFeedSync.findFirst({
        where: { id: syncId, organizationId: context.organizationId, bankFeedItemId: itemId }
      });
      if (!item || !sync || sync.status !== "RUNNING")
        throw new AppError(
          "BANK_FEED_SYNC_STALE",
          "The bank connection changed while activity was being refreshed. Retry the sync.",
          409
        );

      const mappedAccountByProviderId = new Map(
        item.accountMappings.map((mapping) => [mapping.providerAccountReference, mapping])
      );
      const observations = [...result.added, ...result.modified];
      const providerIds = [
        ...new Set(observations.map((transaction) => transaction.providerTransactionId))
      ];
      const existingRows = providerIds.length
        ? await tx.bankImportedTransaction.findMany({
            where: {
              organizationId: context.organizationId,
              bankFeedItemId: item.id,
              providerTransactionId: { in: providerIds }
            }
          })
        : [];
      const existingByProviderId = new Map(
        existingRows.map((row) => [row.providerTransactionId, row])
      );
      const createdByBankAccount = new Map<string, BankFeedProviderTransaction[]>();
      const updates: Array<{ existingId: string; transaction: BankFeedProviderTransaction }> = [];
      let skippedUnmappedCount = 0;

      for (const transaction of observations) {
        const mapping = mappedAccountByProviderId.get(transaction.providerAccountReference);
        if (!mapping) {
          skippedUnmappedCount += 1;
          continue;
        }
        validateTransactionForMapping(transaction, mapping.bankAccount.currency);
        const existing = existingByProviderId.get(transaction.providerTransactionId);
        if (!existing) {
          const grouped = createdByBankAccount.get(mapping.bankAccountId) ?? [];
          grouped.push(transaction);
          createdByBankAccount.set(mapping.bankAccountId, grouped);
          continue;
        }
        if (existing.bankAccountId !== mapping.bankAccountId)
          throw new AppError(
            "BANK_FEED_TRANSACTION_ACCOUNT_CONFLICT",
            "The provider moved a transaction to a different account. Review the bank connection before continuing.",
            409
          );
        if (existing.providerPayloadHash !== transaction.payloadHash)
          throw new AppError(
            "BANK_FEED_TRANSACTION_CHANGE_REVIEW_REQUIRED",
            "A bank transaction changed at the provider. PennyWise kept the source evidence and books unchanged; review the source before retrying.",
            409
          );
        if (
          existing.providerPayloadHash === transaction.payloadHash &&
          existing.feedTransactionState === "ACTIVE"
        )
          continue;
        updates.push({ existingId: existing.id, transaction });
      }

      let addedCount = 0;
      for (const [bankAccountId, transactions] of createdByBankAccount) {
        const normalizedRows = transactions.map((transaction, index) =>
          feedRowJson(transaction, index + 1)
        );
        const fileSize = Buffer.byteLength(JSON.stringify(normalizedRows), "utf8");
        if (fileSize > 5_242_880)
          throw new AppError(
            "BANK_FEED_BATCH_TOO_LARGE",
            "The bank returned too much activity for one safe review batch. Retry after the provider narrows the result.",
            503
          );
        const batch = await tx.bankImportBatch.create({
          data: {
            organizationId: context.organizationId,
            bankAccountId,
            bankFeedSyncId: sync.id,
            format: "FEED",
            originalFileName: `${item.providerKey.toLowerCase()}-feed-${sync.id}.json`,
            fileHash: hashJson({
              itemId: item.id,
              syncId: sync.id,
              bankAccountId,
              transactions: transactions.map((entry) => entry.providerTransactionId)
            }),
            fileSize,
            mapping: {
              source: "BANK_FEED",
              providerKey: item.providerKey,
              bankFeedItemId: item.id,
              syncId: sync.id
            },
            normalizedRows,
            rowCount: transactions.length,
            probableDuplicates: 0,
            status: "COMMITTED",
            committedAt: new Date(),
            committedByUserId: context.user.id,
            createdByUserId: context.user.id
          }
        });
        for (const [index, transaction] of transactions.entries()) {
          await tx.bankImportedTransaction.create({
            data: {
              organizationId: context.organizationId,
              bankAccountId,
              importBatchId: batch.id,
              bankFeedItemId: item.id,
              sourceRowNumber: index + 1,
              sourceRowIdentifier: transaction.providerTransactionId,
              providerTransactionId: transaction.providerTransactionId,
              postingDate: day(transaction.postingDate),
              transactionDate: transaction.transactionDate
                ? day(transaction.transactionDate)
                : null,
              description: transaction.description,
              normalizedDescription: normalizeDescription(transaction.description),
              payee: transaction.payee,
              memo: transaction.memo,
              amountMinor: transaction.amountMinor,
              direction: transaction.direction,
              currency: transaction.currency,
              balanceMinor: transaction.balanceMinor,
              rawFingerprint: transaction.rawFingerprint,
              providerPayloadHash: transaction.payloadHash,
              feedTransactionState: "ACTIVE",
              feedLastObservedAt: new Date(),
              duplicateStatus: "NONE"
            }
          });
          addedCount += 1;
        }
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            lastImportAt: new Date(),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
      }

      for (const update of updates) {
        await tx.bankImportedTransaction.update({
          where: { id: update.existingId },
          data: {
            providerPayloadHash: update.transaction.payloadHash,
            feedTransactionState: "ACTIVE",
            feedLastObservedAt: new Date(),
            version: { increment: 1 }
          }
        });
      }

      let removedCount = 0;
      for (const removal of result.removed) {
        const mapping = mappedAccountByProviderId.get(removal.providerAccountReference);
        if (!mapping) {
          skippedUnmappedCount += 1;
          continue;
        }
        const affected = await tx.bankImportedTransaction.updateMany({
          where: {
            organizationId: context.organizationId,
            bankFeedItemId: item.id,
            bankAccountId: mapping.bankAccountId,
            providerTransactionId: removal.providerTransactionId,
            feedTransactionState: { not: "REMOVED" }
          },
          data: {
            feedTransactionState: "REMOVED",
            feedLastObservedAt: new Date(),
            version: { increment: 1 }
          }
        });
        removedCount += affected.count;
      }

      const completedAt = new Date();
      const itemUpdated = await tx.bankFeedItem.update({
        where: { id: item.id },
        data: {
          status: "READY",
          lastCursor: result.nextCursor,
          lastSyncAt: completedAt,
          lastErrorRedacted: null,
          updatedByUserId: context.user.id
        }
      });
      const synced = await tx.bankFeedSync.update({
        where: { id: sync.id },
        data: {
          status: "SUCCEEDED",
          cursorAfter: result.nextCursor,
          addedCount,
          modifiedCount: updates.length,
          removedCount,
          skippedUnmappedCount,
          providerRequestReference: result.providerRequestReference ?? null,
          completedAt
        }
      });
      await audit(tx, context, "BANK_FEED_SYNCED", item.id, {
        syncId: sync.id,
        addedCount,
        modifiedCount: updates.length,
        removedCount,
        skippedUnmappedCount
      });
      await outbox(tx, context.organizationId, "bank-feed.sync.completed", item.id, {
        syncId: sync.id,
        addedCount,
        modifiedCount: updates.length,
        removedCount,
        skippedUnmappedCount
      });
      return {
        bankFeed: feedItemDto({
          ...itemUpdated,
          accountMappings: item.accountMappings,
          syncs: [synced]
        }),
        sync: syncDto(synced)
      };
    });
  }

  private async failSync(
    context: OrganizationContext,
    itemId: string,
    syncId: string,
    error: unknown
  ): Promise<void> {
    const code = error instanceof AppError ? error.code : "BANK_FEED_PROVIDER_UNAVAILABLE";
    const consentExpired = code === "BANK_FEED_CONSENT_EXPIRED";
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.bankFeedSync.updateMany({
        where: { id: syncId, organizationId: context.organizationId, status: "RUNNING" },
        data: { status: "FAILED", errorRedacted: safeFailureMessage(code), completedAt: new Date() }
      });
      await tx.bankFeedItem.updateMany({
        // A user may disconnect while a provider request is in flight. Do not
        // resurrect or degrade that intentionally revoked connection when the
        // in-flight request later fails.
        where: {
          id: itemId,
          organizationId: context.organizationId,
          status: { not: "DISCONNECTED" }
        },
        data: {
          status: consentExpired ? "CONSENT_EXPIRED" : "DEGRADED",
          lastErrorRedacted: safeFailureMessage(code),
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "BANK_FEED_SYNC_FAILED", itemId, { code });
    });
  }

  private requireAdapter(): BankFeedProviderAdapter {
    if (!this.options.adapter)
      throw new AppError(
        "BANK_FEED_PROVIDER_NOT_CONFIGURED",
        "Connected bank feeds are not configured. CSV, OFX, and QFX imports remain available.",
        503
      );
    if (!this.providerEnabled())
      throw new AppError("BANK_FEED_PROVIDER_GATE_CLOSED", this.providerGateMessage(), 503);
    return this.options.adapter;
  }

  private providerEnabled(): boolean {
    const adapter = this.options.adapter;
    if (!adapter) return false;
    if (adapter.testOnly && adapter.environment !== "sandbox") return false;
    if (this.betaRuntime) return adapter.environment === "sandbox" && this.betaSandboxApproved;
    if (adapter.environment === "production") return this.productionApproved;
    return true;
  }

  private providerGateMessage(): string {
    const adapter = this.options.adapter;
    if (!adapter)
      return "Connected bank feeds are not configured. CSV, OFX, and QFX imports remain available.";
    if (this.betaRuntime)
      return "Connected bank feeds remain disabled in the beta unless a separately approved sandbox provider is present. CSV, OFX, and QFX imports remain available.";
    if (adapter.environment === "production")
      return "Production bank feeds require recorded provider, security, legal, and owner approval before activation. CSV, OFX, and QFX imports remain available.";
    return "Connected bank feeds are not enabled for this runtime. CSV, OFX, and QFX imports remain available.";
  }

  private revealCredential(ciphertext: string): string {
    if (!ciphertext || ciphertext === "REVOKED")
      throw new AppError(
        "BANK_FEED_CREDENTIAL_UNAVAILABLE",
        "The secure bank connection no longer has a usable authorization. Reconnect the bank.",
        409
      );
    try {
      return this.protector.reveal(ciphertext);
    } catch {
      throw new AppError(
        "BANK_FEED_CREDENTIAL_UNAVAILABLE",
        "The secure bank connection cannot be read. Reconnect the bank.",
        409
      );
    }
  }
}

function validateConnectInput(input: BankFeedConnectInput): void {
  if (!input.publicToken.trim() || input.publicToken.length > 4_000)
    throw new AppError(
      "BANK_FEED_PUBLIC_TOKEN_INVALID",
      "Bank authorization could not be verified.",
      422
    );
  if (input.mappings.length === 0 || input.mappings.length > 20)
    throw new AppError(
      "BANK_FEED_MAPPING_REQUIRED",
      "Select one or more bank accounts to connect.",
      422
    );
  if (
    input.mappings.some(
      (mapping) => !mapping.bankAccountId.trim() || !mapping.providerAccountReference.trim()
    )
  )
    throw new AppError("BANK_FEED_MAPPING_INVALID", "A selected bank account is invalid.", 422);
  if (
    new Set(input.mappings.map((mapping) => mapping.bankAccountId)).size !== input.mappings.length
  )
    throw new AppError("BANK_FEED_MAPPING_DUPLICATE", "Choose each PennyWise account once.", 422);
  if (
    new Set(input.mappings.map((mapping) => mapping.providerAccountReference)).size !==
    input.mappings.length
  )
    throw new AppError("BANK_FEED_MAPPING_DUPLICATE", "Choose each provider account once.", 422);
}

function selectProviderAccounts(
  accounts: readonly BankFeedProviderAccount[],
  mappings: readonly { readonly bankAccountId: string; readonly providerAccountReference: string }[]
) {
  return mappings.map((mapping) => {
    const provider = accounts.find(
      (account) => account.providerAccountReference === mapping.providerAccountReference
    );
    if (!provider)
      throw new AppError(
        "BANK_FEED_PROVIDER_ACCOUNT_INVALID",
        "The selected account was not returned by the secure bank connection.",
        422
      );
    if (!/^(CAD|USD)$/.test(provider.currency))
      throw new AppError(
        "BANK_FEED_CURRENCY_NOT_RELEASED",
        "Only CAD and USD connected accounts are available in this release.",
        422
      );
    return { ...mapping, provider };
  });
}

function validateProviderResult(result: BankFeedProviderSyncResult): void {
  if (!result.nextCursor.trim() || result.nextCursor.length > 20_000)
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      "The bank-feed provider returned an invalid checkpoint. No bank activity was changed.",
      502
    );
  const all = [...result.added, ...result.modified];
  const identitySet = new Set<string>();
  for (const transaction of all) {
    const key = `${transaction.providerAccountReference}\u0000${transaction.providerTransactionId}`;
    if (identitySet.has(key))
      throw new AppError(
        "BANK_FEED_DUPLICATE_TRANSACTION",
        "The bank-feed provider returned duplicate transaction identities. No bank activity was changed.",
        502
      );
    identitySet.add(key);
  }
}

function validateTransactionForMapping(
  transaction: BankFeedProviderTransaction,
  expectedCurrency: string
): void {
  if (!/^(CAD|USD)$/.test(transaction.currency) || transaction.currency !== expectedCurrency)
    throw new AppError(
      "BANK_FEED_CURRENCY_MISMATCH",
      "The connected transaction currency does not match its PennyWise financial account.",
      409
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(transaction.postingDate) ||
    (transaction.transactionDate !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(transaction.transactionDate)) ||
    transaction.amountMinor <= 0n ||
    !transaction.providerTransactionId.trim() ||
    !transaction.description.trim() ||
    !/^[a-f0-9]{64}$/.test(transaction.rawFingerprint) ||
    !/^[a-f0-9]{64}$/.test(transaction.payloadHash)
  )
    throw new AppError(
      "BANK_FEED_PROVIDER_INVALID_RESPONSE",
      "The bank-feed provider returned invalid transaction data. No bank activity was changed.",
      502
    );
}

function feedRowJson(transaction: BankFeedProviderTransaction, sourceRowNumber: number) {
  return {
    sourceRowNumber,
    sourceRowIdentifier: transaction.providerTransactionId,
    providerTransactionId: transaction.providerTransactionId,
    postingDate: transaction.postingDate,
    transactionDate: transaction.transactionDate,
    description: transaction.description,
    normalizedDescription: normalizeDescription(transaction.description),
    payee: transaction.payee,
    memo: transaction.memo,
    amountMinor: transaction.amountMinor.toString(),
    direction: transaction.direction,
    currency: transaction.currency,
    balanceMinor: transaction.balanceMinor?.toString() ?? null,
    rawFingerprint: transaction.rawFingerprint,
    duplicateStatus: "NONE",
    probableDuplicateOfId: null
  };
}

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function normalizeDescription(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 1_000);
}

function feedItemDto(value: {
  readonly id: string;
  readonly providerKey: string;
  readonly institutionName: string | null;
  readonly status: string;
  readonly consentedAt: Date;
  readonly consentExpiresAt: Date | null;
  readonly lastSyncAt: Date | null;
  readonly lastErrorRedacted: string | null;
  readonly accountMappings: readonly {
    readonly id: string;
    readonly providerAccountReference: string;
    readonly displayName: string;
    readonly maskedAccountReference: string | null;
    readonly currency: string;
    readonly active: boolean;
    readonly bankAccount: {
      readonly id: string;
      readonly displayName: string;
      readonly maskedAccountReference: string;
    };
  }[];
  readonly syncs: readonly {
    readonly id: string;
    readonly status: string;
    readonly addedCount: number;
    readonly modifiedCount: number;
    readonly removedCount: number;
    readonly skippedUnmappedCount: number;
    readonly startedAt: Date;
    readonly completedAt: Date | null;
    readonly errorRedacted: string | null;
  }[];
}) {
  return {
    id: value.id,
    providerKey: value.providerKey,
    institutionName: value.institutionName,
    status: value.status,
    consentedAt: value.consentedAt.toISOString(),
    consentExpiresAt: value.consentExpiresAt?.toISOString() ?? null,
    lastSyncAt: value.lastSyncAt?.toISOString() ?? null,
    lastError: value.lastErrorRedacted,
    mappings: value.accountMappings.map((mapping) => ({
      id: mapping.id,
      providerAccountReference: mapping.providerAccountReference,
      displayName: mapping.displayName,
      maskedAccountReference: mapping.maskedAccountReference,
      currency: mapping.currency,
      active: mapping.active,
      bankAccount: {
        id: mapping.bankAccount.id,
        displayName: mapping.bankAccount.displayName,
        maskedAccountReference: mapping.bankAccount.maskedAccountReference
      }
    })),
    latestSync: value.syncs[0] ? syncDto(value.syncs[0]) : null
  };
}

function syncDto(value: {
  readonly id: string;
  readonly status: string;
  readonly addedCount: number;
  readonly modifiedCount: number;
  readonly removedCount: number;
  readonly skippedUnmappedCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly errorRedacted: string | null;
}) {
  return {
    id: value.id,
    status: value.status,
    addedCount: value.addedCount,
    modifiedCount: value.modifiedCount,
    removedCount: value.removedCount,
    skippedUnmappedCount: value.skippedUnmappedCount,
    startedAt: value.startedAt.toISOString(),
    completedAt: value.completedAt?.toISOString() ?? null,
    error: value.errorRedacted
  };
}

function safeFailureMessage(code: string): string {
  if (code === "BANK_FEED_CONSENT_EXPIRED")
    return "Bank consent needs to be refreshed before activity can be synchronized.";
  if (code === "BANK_FEED_SYNC_RESTART_REQUIRED")
    return "The bank changed activity while it was being read; retry from the saved checkpoint.";
  if (code === "BANK_FEED_TRANSACTION_CHANGE_REVIEW_REQUIRED")
    return "A previously reviewed transaction changed at the provider and needs review.";
  return "The connected bank could not be synchronized. No partial activity was added.";
}

async function audit(
  tx: Tx,
  context: OrganizationContext,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType: "BankFeedItem",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

async function outbox(
  tx: Tx,
  organizationId: string,
  eventType: string,
  aggregateId: string,
  payload: Prisma.InputJsonObject
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      organizationId,
      eventType,
      aggregateType: "BankFeed",
      aggregateId,
      payload
    }
  });
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
