import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

export const productEventTypes = [
  "ACTIVATION_CHECKLIST_VIEWED",
  "ACTIVATION_STEP_OPENED",
  "ACTIVATION_STEP_COMPLETED",
  "INVOICE_DRAFT_CREATED",
  "INVOICE_PREVIEW_VIEWED",
  "INVOICE_SENT",
  "BANKING_REVIEW_OPENED",
  "BANK_IMPORT_COMPLETED",
  "RECONCILIATION_COMPLETED",
  "MIGRATION_PREVIEW_COMPLETED",
  "MIGRATION_DRY_RUN_COMPLETED",
  "MIGRATION_REVIEW_COMPLETED",
  "MIGRATION_RECONCILIATION_ACKNOWLEDGED",
  "CLOSE_READINESS_VIEWED",
  "INVOICE_DELIVERY_REQUESTED",
  "GUIDED_TOUR_TASK_OPENED",
  "GUIDED_TOUR_COMPLETED",
  "ESTIMATE_DRAFT_CREATED",
  "ESTIMATE_PREVIEW_VIEWED",
  "SUPPORT_DIAGNOSTICS_DOWNLOADED",
  "HELP_ARTICLE_OPENED",
  "THEME_CHANGED",
  "DISPLAY_PREFERENCE_CHANGED",
  "PRODUCT_ANALYTICS_OPTED_IN",
  "SETUP_COMPLETED"
] as const;

export type ProductEventType = (typeof productEventTypes)[number];

const allowedEventTypes = new Set<string>(productEventTypes);

export interface ProductEventInput {
  readonly clientEventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt?: string | undefined;
}

export function normalizeProductEvent(input: ProductEventInput) {
  if (!allowedEventTypes.has(input.eventType)) {
    throw new AppError("PRODUCT_EVENT_UNSUPPORTED", "This product event is not supported.", 400);
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AppError("PRODUCT_EVENT_DATE_INVALID", "The product event date is invalid.", 400);
  }
  const maximumAge = Date.now() + 5 * 60 * 1000;
  const minimumAge = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (occurredAt.getTime() < minimumAge || occurredAt.getTime() > maximumAge) {
    throw new AppError(
      "PRODUCT_EVENT_DATE_OUT_OF_RANGE",
      "The product event date is out of range.",
      400
    );
  }
  return {
    clientEventId: input.clientEventId,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    occurredAt
  };
}

export class ProductAnalyticsService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async record(context: OrganizationContext, input: ProductEventInput) {
    const normalized = normalizeProductEvent(input);
    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId: context.companyId
      },
      async (tx) => {
        const consent = await tx.productAnalyticsConsent.findUnique({
          where: { organizationId: context.organizationId }
        });
        if (!consent?.enabled) {
          throw new AppError(
            "PRODUCT_ANALYTICS_CONSENT_REQUIRED",
            "Privacy-minimized workflow telemetry is disabled for this organization.",
            409
          );
        }
        if (!consent.consentedAt || normalized.occurredAt < consent.consentedAt) {
          throw new AppError(
            "PRODUCT_EVENT_PRECONSENT",
            "Workflow telemetry from before consent cannot be recorded.",
            409
          );
        }
        // Product events are immutable. `createMany` with `skipDuplicates`
        // compiles to an insert that does not mutate an already-recorded
        // event, while preserving client-event idempotency under retries.
        await tx.productEvent.createMany({
          data: {
            organizationId: context.organizationId,
            clientEventId: normalized.clientEventId,
            eventType: normalized.eventType,
            eventVersion: normalized.eventVersion,
            occurredAt: normalized.occurredAt
          },
          skipDuplicates: true
        });
        return tx.productEvent.findUniqueOrThrow({
          where: {
            organizationId_clientEventId: {
              organizationId: context.organizationId,
              clientEventId: normalized.clientEventId
            }
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async consent(context: OrganizationContext) {
    return withTenantTransaction(this.prisma, databaseContext(context), async (tx) => {
      const consent = await tx.productAnalyticsConsent.findUnique({
        where: { organizationId: context.organizationId }
      });
      return consentDto(consent);
    });
  }

  public async setConsent(context: OrganizationContext, enabled: boolean) {
    await this.authorization.assert(context, "settings:write", "ProductAnalyticsConsent");
    return withTenantTransaction(
      this.prisma,
      databaseContext(context),
      async (tx) => {
        const now = new Date();
        const consent = await tx.productAnalyticsConsent.upsert({
          where: { organizationId: context.organizationId },
          create: {
            organizationId: context.organizationId,
            enabled,
            consentedAt: enabled ? now : null,
            withdrawnAt: enabled ? null : now
          },
          update: {
            enabled,
            ...(enabled ? { consentedAt: now } : {}),
            withdrawnAt: enabled ? null : now
          }
        });
        if (!enabled) {
          // Product telemetry is not accounting evidence. Withdrawal erases the
          // organization's previously consented telemetry in the same transaction.
          await tx.productEvent.deleteMany({ where: { organizationId: context.organizationId } });
        }
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: enabled
              ? "PRODUCT_ANALYTICS_CONSENT_GRANTED"
              : "PRODUCT_ANALYTICS_CONSENT_WITHDRAWN",
            targetType: "ProductAnalyticsConsent",
            targetId: consent.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, { enabled })
          }
        });
        return consentDto(consent);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async summary(context: OrganizationContext) {
    await this.authorization.assert(context, "product-analytics:read", "ProductEvent");
    const rows = await withTenantTransaction(this.prisma, databaseContext(context), (tx) =>
      tx.productEvent.groupBy({
        by: ["eventType"],
        where: { organizationId: context.organizationId },
        _count: { _all: true },
        orderBy: { eventType: "asc" }
      })
    );
    return {
      threshold: 5,
      events: rows
        .filter((row) => row._count._all >= 5)
        .map((row) => ({ eventType: row.eventType, count: row._count._all }))
    };
  }
}

function databaseContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function consentDto(
  consent: {
    enabled: boolean;
    consentedAt: Date | null;
    withdrawnAt: Date | null;
  } | null
) {
  return {
    enabled: consent?.enabled === true,
    consentedAt: consent?.consentedAt?.toISOString() ?? null,
    withdrawnAt: consent?.withdrawnAt?.toISOString() ?? null
  };
}
