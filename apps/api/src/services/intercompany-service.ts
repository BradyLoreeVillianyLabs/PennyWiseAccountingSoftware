import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { AuditOrigin, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";

export interface CreateIntercompanyInput {
  readonly fromCompanyId: string;
  readonly toCompanyId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly effectiveDate: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly description: string;
}

export type IntercompanyTransition = "DRAFT" | "PROPOSED" | "APPROVED" | "REJECTED";

export interface CreateConsolidationGroupInput {
  readonly name: string;
  readonly baseCurrency: string;
  readonly companyIds: readonly string[];
}

export class IntercompanyService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listTransactions(context: OrganizationContext) {
    await this.authorization.assert(context, "intercompany:read", "IntercompanyTransaction");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.intercompanyTransaction.findMany({
        where: { organizationId: context.organizationId },
        include: { fromCompany: true, toCompany: true },
        orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }]
      });
      return rows.map((row) => ({
        id: row.id,
        status: row.status,
        fromCompany: { id: row.fromCompany.id, displayName: row.fromCompany.displayName },
        toCompany: { id: row.toCompany.id, displayName: row.toCompany.displayName },
        amountMinor: row.amountMinor.toString(),
        currency: row.currency.trim(),
        effectiveDate: serializeDate(row.effectiveDate),
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        description: row.description,
        balanceEvidence: row.balanceEvidence,
        fromJournalId: row.fromJournalId,
        toJournalId: row.toJournalId,
        createdAt: serializeDate(row.createdAt),
        updatedAt: serializeDate(row.updatedAt)
      }));
    });
  }

  public async createTransaction(
    context: OrganizationContext,
    input: CreateIntercompanyInput,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "intercompany:manage", "IntercompanyTransaction");
    if (input.fromCompanyId === input.toCompanyId) {
      throw new AppError(
        "INTERCOMPANY_COMPANIES_MUST_DIFFER",
        "Choose two different companies.",
        422
      );
    }
    let amountMinor: bigint;
    try {
      amountMinor = BigInt(input.amountMinor);
    } catch {
      throw new AppError(
        "INTERCOMPANY_AMOUNT_INVALID",
        "Amount must be a positive integer in minor units.",
        422
      );
    }
    if (amountMinor <= 0n) {
      throw new AppError("INTERCOMPANY_AMOUNT_INVALID", "Amount must be positive.", 422);
    }
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new AppError(
        "INTERCOMPANY_CURRENCY_INVALID",
        "Currency must be a three-letter code.",
        422
      );
    }

    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const companies = await tx.company.findMany({
          where: {
            organizationId: context.organizationId,
            id: { in: [input.fromCompanyId, input.toCompanyId] },
            status: "ACTIVE"
          }
        });
        if (companies.length !== 2) {
          throw new AppError(
            "COMPANY_NOT_FOUND",
            "Both companies must be active members of this workspace.",
            404
          );
        }
        if (context.companyId !== input.fromCompanyId && context.companyId !== input.toCompanyId) {
          throw new AppError(
            "COMPANY_CONTEXT_REQUIRED",
            "Select one of the participating companies first.",
            409
          );
        }
        const row = await tx.intercompanyTransaction.create({
          data: {
            organizationId: context.organizationId,
            fromCompanyId: input.fromCompanyId,
            toCompanyId: input.toCompanyId,
            amountMinor,
            currency,
            effectiveDate: parseDate(input.effectiveDate, "effectiveDate"),
            sourceType: input.sourceType.trim(),
            sourceId: input.sourceId.trim(),
            description: input.description.trim(),
            createdByUserId: context.user.id
          },
          include: { fromCompany: true, toCompany: true }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "INTERCOMPANY_TRANSACTION_CREATED",
            targetType: "IntercompanyTransaction",
            targetId: row.id,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              fromCompanyId: row.fromCompanyId,
              toCompanyId: row.toCompanyId,
              amountMinor: amountMinor.toString(),
              currency
            })
          }
        });
        return {
          id: row.id,
          status: row.status,
          fromCompanyId: row.fromCompanyId,
          toCompanyId: row.toCompanyId,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency.trim(),
          effectiveDate: serializeDate(row.effectiveDate),
          description: row.description,
          postingRequired: true,
          postingCreated: false
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(
          "INTERCOMPANY_SOURCE_ALREADY_EXISTS",
          "This source transaction is already recorded.",
          409
        );
      }
      throw error;
    }
  }

  public async transition(
    context: OrganizationContext,
    transactionId: string,
    status: IntercompanyTransition,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(
      context,
      "intercompany:manage",
      "IntercompanyTransaction",
      transactionId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.intercompanyTransaction.findFirst({
        where: { id: transactionId, organizationId: context.organizationId }
      });
      if (!existing)
        throw new AppError(
          "INTERCOMPANY_NOT_FOUND",
          "Intercompany transaction was not found.",
          404
        );
      if (status === "DRAFT" && existing.status !== "DRAFT") {
        throw new AppError(
          "INTERCOMPANY_INVALID_TRANSITION",
          "A reviewed transaction cannot return to draft.",
          409
        );
      }
      if (status === "APPROVED" && existing.status !== "PROPOSED") {
        throw new AppError(
          "INTERCOMPANY_INVALID_TRANSITION",
          "Only proposed transactions can be approved.",
          409
        );
      }
      if (status === "PROPOSED" && existing.status !== "DRAFT") {
        throw new AppError("INTERCOMPANY_INVALID_TRANSITION", "Only drafts can be proposed.", 409);
      }
      if (status === "REJECTED" && !["DRAFT", "PROPOSED", "APPROVED"].includes(existing.status)) {
        throw new AppError(
          "INTERCOMPANY_INVALID_TRANSITION",
          "This transaction is no longer reviewable.",
          409
        );
      }
      const updated = await tx.intercompanyTransaction.update({
        where: { id: existing.id },
        data: {
          status,
          approvedByUserId: status === "APPROVED" ? context.user.id : existing.approvedByUserId
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "INTERCOMPANY_TRANSACTION_STATUS_CHANGED",
          targetType: "IntercompanyTransaction",
          targetId: existing.id,
          requestId,
          metadata: withAuditOrigin(auditOrigin, { previousStatus: existing.status, status })
        }
      });
      return {
        id: updated.id,
        status: updated.status,
        postingRequired: true,
        postingCreated: false
      };
    });
  }

  public async listConsolidationGroups(context: OrganizationContext) {
    await this.authorization.assert(context, "consolidation:read", "ConsolidationGroup");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const groups = await tx.consolidationGroup.findMany({
        where: { organizationId: context.organizationId },
        include: { members: { include: { company: true }, where: { active: true } } },
        orderBy: { name: "asc" }
      });
      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        status: group.status,
        baseCurrency: group.baseCurrency.trim(),
        configurationRequired: group.members.some(
          (member) => member.eliminationPolicy === "CONFIGURATION_REQUIRED"
        ),
        members: group.members.map((member) => ({
          companyId: member.companyId,
          displayName: member.company.displayName,
          eliminationPolicy: member.eliminationPolicy
        }))
      }));
    });
  }

  public async createConsolidationGroup(
    context: OrganizationContext,
    input: CreateConsolidationGroupInput,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "consolidation:manage", "ConsolidationGroup");
    if (input.companyIds.length < 2 || new Set(input.companyIds).size !== input.companyIds.length) {
      throw new AppError(
        "CONSOLIDATION_COMPANIES_REQUIRED",
        "Select at least two different companies.",
        422
      );
    }
    const baseCurrency = input.baseCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(baseCurrency)) {
      throw new AppError(
        "CONSOLIDATION_CURRENCY_INVALID",
        "Currency must be a three-letter code.",
        422
      );
    }
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const companies = await tx.company.findMany({
        where: {
          organizationId: context.organizationId,
          id: { in: [...input.companyIds] },
          status: "ACTIVE"
        }
      });
      if (companies.length !== input.companyIds.length) {
        throw new AppError("COMPANY_NOT_FOUND", "Every consolidation member must be active.", 404);
      }
      const group = await tx.consolidationGroup.create({
        data: {
          organizationId: context.organizationId,
          name: input.name.trim(),
          baseCurrency,
          createdByUserId: context.user.id,
          members: {
            create: input.companyIds.map((companyId) => ({
              organizationId: context.organizationId,
              companyId,
              eliminationPolicy: "CONFIGURATION_REQUIRED"
            }))
          }
        },
        include: { members: true }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "CONSOLIDATION_GROUP_CREATED",
          targetType: "ConsolidationGroup",
          targetId: group.id,
          requestId,
          metadata: withAuditOrigin(auditOrigin, { companyIds: input.companyIds, baseCurrency })
        }
      });
      return {
        id: group.id,
        name: group.name,
        status: group.status,
        baseCurrency: group.baseCurrency.trim(),
        memberCount: group.members.length,
        configurationRequired: true,
        postingsCreated: 0
      };
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
