import {
  Prisma,
  withTenantTransaction,
  type PrismaClient,
  type CommercialStatus
} from "@clearledger/db";
import {
  assertCommercialTransition,
  entitlementsFor,
  type OrganizationContext
} from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

export interface CommercialSubscriptionInput {
  readonly planCode: string;
  readonly entitlements: readonly string[];
  readonly provider?: string | null | undefined;
  readonly providerCustomerId?: string | null | undefined;
  readonly providerSubscriptionId?: string | null | undefined;
  readonly currentPeriodEnd?: string | null | undefined;
}

export class CommercialService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async get(context: OrganizationContext) {
    await this.authorization.assert(context, "commercial:read", "CommercialSubscription");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const subscription = await tx.commercialSubscription.findUnique({
        where: { organizationId: context.organizationId }
      });
      return subscription ? commercialDto(subscription) : null;
    });
  }

  public async provision(context: OrganizationContext, input: CommercialSubscriptionInput) {
    await this.authorization.assert(context, "commercial:manage", "CommercialSubscription");
    const planCode = input.planCode.trim();
    if (!planCode) throw new AppError("COMMERCIAL_PLAN_REQUIRED", "Plan code is required.", 422);
    const periodEnd = input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null;
    if (periodEnd && Number.isNaN(periodEnd.getTime()))
      throw new AppError("COMMERCIAL_PERIOD_INVALID", "Billing period end is invalid.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const subscription = await tx.commercialSubscription.upsert({
        where: { organizationId: context.organizationId },
        create: {
          organizationId: context.organizationId,
          planCode,
          entitlements: [...new Set(input.entitlements)],
          provider: input.provider ?? null,
          providerCustomerId: input.providerCustomerId ?? null,
          providerSubscriptionId: input.providerSubscriptionId ?? null,
          currentPeriodEnd: periodEnd,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        },
        update: {
          planCode,
          entitlements: [...new Set(input.entitlements)],
          provider: input.provider ?? null,
          providerCustomerId: input.providerCustomerId ?? null,
          providerSubscriptionId: input.providerSubscriptionId ?? null,
          currentPeriodEnd: periodEnd,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      await audit(
        tx,
        context,
        "COMMERCIAL_SUBSCRIPTION_PROVISIONED",
        "CommercialSubscription",
        subscription.id,
        {
          planCode,
          provider: input.provider ?? null
        }
      );
      return commercialDto(subscription);
    });
  }

  public async transition(context: OrganizationContext, next: CommercialStatus, version: number) {
    await this.authorization.assert(context, "commercial:manage", "CommercialSubscription");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.commercialSubscription.findUnique({
        where: { organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError(
          "COMMERCIAL_SUBSCRIPTION_NOT_FOUND",
          "Commercial subscription is not configured.",
          404
        );
      try {
        assertCommercialTransition(current.status, next);
      } catch (error) {
        throw new AppError(
          "COMMERCIAL_TRANSITION_INVALID",
          error instanceof Error ? error.message : "Commercial status transition is invalid.",
          409
        );
      }
      const updated = await tx.commercialSubscription.updateMany({
        where: { organizationId: context.organizationId, version },
        data: { status: next, version: { increment: 1 }, updatedByUserId: context.user.id }
      });
      if (updated.count !== 1)
        throw new AppError(
          "STALE_COMMERCIAL_SUBSCRIPTION",
          "Subscription was changed by another request.",
          409
        );
      await audit(
        tx,
        context,
        `COMMERCIAL_STATUS_${next}`,
        "CommercialSubscription",
        current.id,
        {}
      );
      return tx.commercialSubscription
        .findUniqueOrThrow({ where: { id: current.id } })
        .then(commercialDto);
    });
  }

  public async recordEvent(
    context: OrganizationContext,
    input: {
      provider: string;
      providerEventId: string;
      eventType: string;
      payload: Prisma.InputJsonValue;
    }
  ) {
    await this.authorization.assert(context, "commercial:manage", "CommercialEvent");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.commercialEvent.findUnique({
        where: {
          organizationId_provider_providerEventId: {
            organizationId: context.organizationId,
            provider: input.provider,
            providerEventId: input.providerEventId
          }
        }
      });
      if (existing) return commercialEventDto(existing);
      const event = await tx.commercialEvent.create({
        data: {
          organizationId: context.organizationId,
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          payload: input.payload
        }
      });
      await audit(tx, context, "COMMERCIAL_EVENT_RECEIVED", "CommercialEvent", event.id, {
        provider: input.provider,
        eventType: input.eventType
      });
      return commercialEventDto(event);
    });
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function commercialDto(row: {
  id: string;
  planCode: string;
  entitlements: Prisma.JsonValue;
  status: CommercialStatus;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  version: number;
}) {
  const entitlements = Array.isArray(row.entitlements)
    ? row.entitlements.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: row.id,
    planCode: row.planCode,
    status: row.status,
    entitlements: entitlementsFor(row.status, entitlements),
    configuredEntitlements: entitlements,
    provider: row.provider,
    providerCustomerId: row.providerCustomerId,
    providerSubscriptionId: row.providerSubscriptionId,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    version: row.version
  };
}

function commercialEventDto(row: {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  status: string;
  receivedAt: Date;
  processedAt: Date | null;
}) {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.providerEventId,
    eventType: row.eventType,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType,
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
