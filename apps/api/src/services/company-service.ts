import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { AuditOrigin, MembershipRole, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";

/**
 * A schema-free, transactional lifecycle marker until the shared schema lane
 * can add a first-class Company lifecycle field. It is written only by the
 * service and is deliberately queried with the owning organization scope.
 */
export const trialCompanyAuditAction = "COMPANY_TRIAL_CREATED" as const;

export interface CreateCompanyInput {
  readonly legalName: string;
  readonly displayName: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly fiscalYearEndMonth?: number | null | undefined;
  readonly fiscalYearEndDay?: number | null | undefined;
}

export interface UpdateCompanyInput {
  readonly legalName?: string | undefined;
  readonly displayName?: string | undefined;
  readonly baseCurrency?: string | undefined;
  readonly timezone?: string | undefined;
  readonly locale?: string | undefined;
}

export class CompanyService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "organizations:access", "Company");
    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId: context.companyId
      },
      async (tx) => {
        const memberships = await tx.companyMembership.findMany({
          where: {
            organizationId: context.organizationId,
            userId: context.user.id,
            status: "ACTIVE"
          },
          include: { company: true },
          orderBy: { createdAt: "asc" }
        });
        const activeMemberships = memberships.filter(({ company }) => company.status === "ACTIVE");
        const trialCompanyIds = await this.trialCompanyIds(
          tx,
          context.organizationId,
          activeMemberships.map(({ company }) => company.id)
        );
        return activeMemberships.map(({ id, role, company }) => ({
          id: company.id,
          membershipId: id,
          role,
          legalName: company.legalName,
          displayName: company.displayName,
          status: company.status,
          baseCurrency: company.baseCurrency,
          timezone: company.timezone,
          locale: company.locale,
          setupStatus: company.setupStatus,
          isDefault: company.isDefault,
          isTrial: trialCompanyIds.has(company.id),
          active: company.id === context.companyId,
          createdAt: serializeDate(company.createdAt),
          updatedAt: serializeDate(company.updatedAt)
        }));
      }
    );
  }

  public async current(context: OrganizationContext) {
    if (!context.companyId) return null;
    await this.authorization.assert(context, "organizations:access", "Company", context.companyId);
    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId: context.companyId
      },
      async (tx) => {
        const company = await tx.company.findFirst({
          where: {
            id: context.companyId!,
            organizationId: context.organizationId,
            status: "ACTIVE"
          }
        });
        if (!company) return null;
        return this.dto(
          company,
          true,
          await this.isTrialCompany(tx, context.organizationId, company.id)
        );
      }
    );
  }

  public async create(
    context: OrganizationContext,
    input: CreateCompanyInput,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "companies:manage", "Company");
    const normalizedInput = normalizeCreateCompanyInput(input);
    const { displayName, legalName, baseCurrency } = normalizedInput;

    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId: context.companyId
      },
      async (tx) => {
        const duplicate = await tx.company.findFirst({
          where: {
            organizationId: context.organizationId,
            displayName,
            status: { not: "ARCHIVED" }
          }
        });
        if (duplicate) {
          throw new AppError(
            "COMPANY_NAME_CONFLICT",
            "A company with that display name already exists.",
            409
          );
        }
        const company = await tx.company.create({
          data: {
            organizationId: context.organizationId,
            legalName,
            displayName,
            baseCurrency,
            timezone: normalizedInput.timezone,
            locale: normalizedInput.locale,
            fiscalYearEndMonth: normalizedInput.fiscalYearEndMonth,
            fiscalYearEndDay: normalizedInput.fiscalYearEndDay,
            setupStatus: "INCOMPLETE",
            isDefault: false,
            createdByUserId: context.user.id
          }
        });
        const membership = await tx.companyMembership.create({
          data: {
            organizationId: context.organizationId,
            companyId: company.id,
            userId: context.user.id,
            role: "OWNER",
            status: "ACTIVE"
          }
        });
        let copiedAccountCount = 0;
        if (context.companyId) {
          const sourceAccounts = await tx.account.findMany({
            where: { organizationId: context.organizationId, companyId: context.companyId },
            select: {
              code: true,
              name: true,
              type: true,
              subtype: true,
              isControl: true,
              isArchived: true,
              systemPurpose: true,
              normalBalance: true,
              presetKey: true,
              presetVersion: true
            }
          });
          if (sourceAccounts.length) {
            // The request remains authorized against the source company, but the
            // copied rows belong to the newly-created company. Switch the
            // transaction's company RLS context for this bounded write only.
            await tx.$executeRaw`SELECT set_config('app.company_id', ${company.id}, true)`;
            const copied = await tx.account.createMany({
              data: sourceAccounts.map((account) => ({
                organizationId: context.organizationId,
                companyId: company.id,
                ...account
              }))
            });
            copiedAccountCount = copied.count;
            await tx.$executeRaw`SELECT set_config('app.company_id', ${context.companyId ?? ""}, true)`;
          }
        }
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "COMPANY_CREATED",
            targetType: "Company",
            targetId: company.id,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              legalName,
              displayName,
              baseCurrency,
              sourceCompanyId: context.companyId ?? null,
              copiedAccountCount
            })
          }
        });
        return { ...this.dto(company, false), membershipId: membership.id, copiedAccountCount };
      }
    );
  }

  /**
   * Creates a genuinely blank, explicitly marked trial company. It never
   * copies the selected company's chart or records, and retries return the
   * same company through the standard tenant-scoped idempotency record.
   */
  public async createTrial(
    context: OrganizationContext,
    input: CreateCompanyInput,
    idempotencyKey: string | undefined,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "companies:manage", "Company");
    const normalizedInput = normalizeCreateCompanyInput(input);
    const result = await runIdempotent(
      this.prisma,
      context,
      "company.trial.create",
      idempotencyKey,
      normalizedInput,
      async (tx) => {
        const duplicate = await tx.company.findFirst({
          where: {
            organizationId: context.organizationId,
            displayName: normalizedInput.displayName,
            status: { not: "ARCHIVED" }
          }
        });
        if (duplicate) {
          throw new AppError(
            "COMPANY_NAME_CONFLICT",
            "A company with that display name already exists.",
            409
          );
        }

        const company = await tx.company.create({
          data: {
            organizationId: context.organizationId,
            legalName: normalizedInput.legalName,
            displayName: normalizedInput.displayName,
            baseCurrency: normalizedInput.baseCurrency,
            timezone: normalizedInput.timezone,
            locale: normalizedInput.locale,
            fiscalYearEndMonth: normalizedInput.fiscalYearEndMonth,
            fiscalYearEndDay: normalizedInput.fiscalYearEndDay,
            setupStatus: "INCOMPLETE",
            isDefault: false,
            createdByUserId: context.user.id
          }
        });
        const membership = await tx.companyMembership.create({
          data: {
            organizationId: context.organizationId,
            companyId: company.id,
            userId: context.user.id,
            role: "OWNER",
            status: "ACTIVE"
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "COMPANY_CREATED",
            targetType: "Company",
            targetId: company.id,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              legalName: company.legalName,
              displayName: company.displayName,
              baseCurrency: company.baseCurrency,
              sourceCompanyId: null,
              copiedAccountCount: 0,
              lifecycle: "DISPOSABLE_TRIAL"
            })
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: trialCompanyAuditAction,
            targetType: "Company",
            targetId: company.id,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              lifecycle: "DISPOSABLE_TRIAL",
              copiedFromCompany: false
            })
          }
        });
        const trialCompany = {
          ...this.dto(company, false, true),
          membershipId: membership.id,
          copiedAccountCount: 0
        };
        return {
          statusCode: 201,
          body: { company: trialCompany },
          resourceId: company.id
        };
      }
    );
    return { ...result.body.company, replayed: result.replayed === true };
  }

  public async switch(
    context: OrganizationContext,
    companyId: string,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "organizations:access", "Company", companyId);
    const result = await withTenantTransaction(
      this.prisma,
      { organizationId: context.organizationId, actorUserId: context.user.id, companyId },
      async (tx) => {
        const membership = await tx.companyMembership.findFirst({
          where: {
            organizationId: context.organizationId,
            companyId,
            userId: context.user.id,
            status: "ACTIVE",
            company: { status: "ACTIVE" }
          },
          include: { company: true }
        });
        if (!membership) return null;
        if (context.sessionId) {
          await tx.session.updateMany({
            where: { id: context.sessionId, userId: context.user.id, revokedAt: null },
            data: { activeCompanyId: companyId }
          });
        }
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "COMPANY_SWITCHED",
            targetType: "Company",
            targetId: companyId,
            requestId,
            metadata: withAuditOrigin(auditOrigin, { previousCompanyId: context.companyId ?? null })
          }
        });
        return {
          ...this.dto(
            membership.company,
            true,
            await this.isTrialCompany(tx, context.organizationId, companyId)
          ),
          membershipId: membership.id,
          role: membership.role
        };
      }
    );
    if (!result)
      throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
    return result;
  }

  public async update(
    context: OrganizationContext,
    companyId: string,
    input: UpdateCompanyInput,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "companies:manage", "Company", companyId);

    const data = {
      ...(input.legalName === undefined ? {} : { legalName: input.legalName.trim() }),
      ...(input.displayName === undefined ? {} : { displayName: input.displayName.trim() }),
      ...(input.baseCurrency === undefined
        ? {}
        : { baseCurrency: input.baseCurrency.trim().toUpperCase() }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone.trim() }),
      ...(input.locale === undefined ? {} : { locale: input.locale.trim() })
    };
    if (Object.values(data).some((value) => !value)) {
      throw new AppError("COMPANY_FIELD_REQUIRED", "Company fields cannot be blank.", 400);
    }
    if (data.baseCurrency && !/^[A-Z]{3}$/.test(data.baseCurrency)) {
      throw new AppError(
        "COMPANY_CURRENCY_INVALID",
        "Base currency must be a three-letter code.",
        400
      );
    }

    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId
      },
      async (tx) => {
        const company = await tx.company.findFirst({
          where: {
            id: companyId,
            organizationId: context.organizationId,
            status: "ACTIVE",
            memberships: { some: { userId: context.user.id, status: "ACTIVE" } }
          }
        });
        if (!company) {
          throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
        }
        if (data.displayName && data.displayName !== company.displayName) {
          const duplicate = await tx.company.findFirst({
            where: {
              organizationId: context.organizationId,
              displayName: data.displayName,
              status: { not: "ARCHIVED" },
              id: { not: companyId }
            }
          });
          if (duplicate) {
            throw new AppError(
              "COMPANY_NAME_CONFLICT",
              "A company with that display name already exists.",
              409
            );
          }
        }
        const updated = await tx.company.update({ where: { id: companyId }, data });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "COMPANY_UPDATED",
            targetType: "Company",
            targetId: companyId,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              changedFields: Object.keys(data),
              previousDisplayName: company.displayName,
              displayName: updated.displayName
            })
          }
        });
        return this.dto(
          updated,
          updated.id === context.companyId,
          await this.isTrialCompany(tx, context.organizationId, companyId)
        );
      }
    );
  }

  /**
   * Removes a company from active workspaces by archiving it, never by deleting
   * accounting data. A marked trial may be the only active company; a posted
   * non-trial company is protected from this delete action.
   */
  public async delete(
    context: OrganizationContext,
    companyId: string,
    confirmation: string,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "companies:manage", "Company", companyId);
    const normalizedConfirmation = confirmation.trim();
    if (!normalizedConfirmation) {
      throw new AppError(
        "COMPANY_DELETE_CONFIRMATION_REQUIRED",
        "Type the company display name to confirm removal.",
        400
      );
    }

    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId
      },
      async (tx) => {
        const company = await tx.company.findFirst({
          where: { id: companyId, organizationId: context.organizationId, status: "ACTIVE" }
        });
        if (!company) {
          throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
        }
        if (company.displayName !== normalizedConfirmation) {
          throw new AppError(
            "COMPANY_DELETE_CONFIRMATION_MISMATCH",
            "The confirmation text must exactly match the company display name.",
            409
          );
        }

        const actorMembership = await tx.companyMembership.findFirst({
          where: {
            organizationId: context.organizationId,
            companyId,
            userId: context.user.id,
            status: "ACTIVE"
          }
        });
        if (!actorMembership) {
          throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
        }
        await this.authorization.assert(
          {
            ...context,
            role: actorMembership.role,
            companyId,
            companyMembershipId: actorMembership.id
          },
          "companies:manage",
          "Company",
          companyId
        );

        // Serialize company removal against another owner removing the final
        // active company at the same time.
        const activeCompanies = await tx.$queryRaw<ReadonlyArray<{ id: string }>>`
          SELECT "id"
          FROM "Company"
          WHERE "organizationId" = ${context.organizationId}::uuid
            AND "status" = 'ACTIVE'::"CompanyStatus"
          FOR UPDATE
        `;
        const isTrial = await this.isTrialCompany(tx, context.organizationId, companyId);
        const postedJournalCount = await tx.journal.count({
          where: {
            organizationId: context.organizationId,
            companyId,
            status: "POSTED"
          }
        });
        if (!isTrial && postedJournalCount > 0) {
          throw new AppError(
            "COMPANY_POSTED_BOOKS_PROTECTED",
            "A company with posted books cannot be removed through the delete action. Use the retained company and a formal closure workflow.",
            409
          );
        }
        if (activeCompanies.length <= 1 && !isTrial) {
          throw new AppError(
            "COMPANY_LAST_ACTIVE",
            "Keep at least one active company in the workspace. Create another company before removing this one.",
            409
          );
        }

        const replacement =
          activeCompanies.length <= 1
            ? null
            : await tx.company.findFirst({
                where: {
                  organizationId: context.organizationId,
                  status: "ACTIVE",
                  id: { not: companyId },
                  memberships: { some: { userId: context.user.id, status: "ACTIVE" } }
                },
                orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
              });
        if (activeCompanies.length > 1 && !replacement) {
          throw new AppError(
            "COMPANY_REPLACEMENT_REQUIRED",
            "The company cannot be removed because you do not have access to another active company.",
            409
          );
        }

        await tx.company.update({
          where: { id: companyId },
          data: { status: "ARCHIVED", isDefault: false }
        });
        await tx.companyMembership.updateMany({
          where: { organizationId: context.organizationId, companyId, status: "ACTIVE" },
          data: { status: "REVOKED" }
        });
        if (company.isDefault && replacement) {
          await tx.company.update({
            where: { id: replacement.id },
            data: { isDefault: true }
          });
        }
        if (context.sessionId && context.companyId === companyId) {
          await tx.session.updateMany({
            where: { id: context.sessionId, userId: context.user.id, revokedAt: null },
            data: { activeCompanyId: replacement?.id ?? null }
          });
        }
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "COMPANY_ARCHIVED",
            targetType: "Company",
            targetId: companyId,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              displayName: company.displayName,
              replacementCompanyId: replacement?.id ?? null,
              lifecycle: isTrial ? "DISPOSABLE_TRIAL" : "STANDARD",
              removalKind: "ARCHIVE",
              reason: "User confirmed company removal from profile"
            })
          }
        });
        return {
          company: {
            ...this.dto({ ...company, status: "ARCHIVED" }, false, isTrial),
            archived: true
          },
          replacementCompanyId: replacement?.id ?? null
        };
      }
    );
  }

  public async listMembers(context: OrganizationContext, companyId: string) {
    await this.authorization.assert(context, "members:read", "CompanyMembership", companyId);
    return withTenantTransaction(
      this.prisma,
      { organizationId: context.organizationId, actorUserId: context.user.id, companyId },
      async (tx) => {
        const actorMembership = await tx.companyMembership.findFirst({
          where: {
            organizationId: context.organizationId,
            companyId,
            userId: context.user.id,
            status: "ACTIVE"
          }
        });
        if (!actorMembership)
          throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
        const memberships = await tx.companyMembership.findMany({
          where: { organizationId: context.organizationId, companyId },
          include: { user: true },
          orderBy: [{ status: "asc" }, { createdAt: "asc" }]
        });
        return memberships.map((membership) => ({
          id: membership.id,
          userId: membership.userId,
          email: membership.user.email,
          displayName: membership.user.displayName,
          role: membership.role,
          status: membership.status,
          createdAt: serializeDate(membership.createdAt),
          updatedAt: serializeDate(membership.updatedAt)
        }));
      }
    );
  }

  public async setMemberRole(
    context: OrganizationContext,
    companyId: string,
    userId: string,
    role: MembershipRole,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    await this.authorization.assert(context, "companies:manage", "CompanyMembership", companyId);
    if (role === "OWNER" && context.role !== "OWNER") {
      throw new AppError(
        "ROLE_ASSIGNMENT_FORBIDDEN",
        "Only a company owner can assign ownership.",
        403
      );
    }
    return withTenantTransaction(
      this.prisma,
      { organizationId: context.organizationId, actorUserId: context.user.id, companyId },
      async (tx) => {
        const company = await tx.company.findFirst({
          where: { id: companyId, organizationId: context.organizationId, status: "ACTIVE" }
        });
        if (!company)
          throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
        const actorCompanyMembership = await tx.companyMembership.findFirst({
          where: {
            organizationId: context.organizationId,
            companyId,
            userId: context.user.id,
            status: "ACTIVE"
          }
        });
        if (!actorCompanyMembership) {
          throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
        }
        const organizationMembership = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId: context.organizationId, userId } }
        });
        if (!organizationMembership || organizationMembership.status !== "ACTIVE") {
          throw new AppError(
            "MEMBERSHIP_NOT_FOUND",
            "The user is not an active workspace member.",
            404
          );
        }
        const current = await tx.companyMembership.findUnique({
          where: { companyId_userId: { companyId, userId } }
        });
        if (current?.role === "OWNER" && role !== "OWNER") {
          const ownerCount = await tx.companyMembership.count({
            where: { companyId, role: "OWNER", status: "ACTIVE" }
          });
          if (ownerCount <= 1) {
            throw new AppError(
              "COMPANY_OWNER_REQUIRED",
              "A company must retain at least one owner.",
              409
            );
          }
        }
        const membership = await tx.companyMembership.upsert({
          where: { companyId_userId: { companyId, userId } },
          create: {
            organizationId: context.organizationId,
            companyId,
            userId,
            role,
            status: "ACTIVE"
          },
          update: { role, status: "ACTIVE" }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: current ? "COMPANY_MEMBER_ROLE_CHANGED" : "COMPANY_MEMBER_ADDED",
            targetType: "CompanyMembership",
            targetId: membership.id,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              companyId,
              userId,
              previousRole: current?.role ?? null,
              role
            })
          }
        });
        return {
          id: membership.id,
          companyId,
          userId,
          role: membership.role,
          status: membership.status
        };
      }
    );
  }

  private dto(
    company: {
      id: string;
      legalName: string;
      displayName: string;
      status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
      baseCurrency: string;
      timezone: string;
      locale: string;
      setupStatus: string;
      isDefault: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    active: boolean,
    isTrial = false
  ) {
    return {
      id: company.id,
      legalName: company.legalName,
      displayName: company.displayName,
      status: company.status,
      baseCurrency: company.baseCurrency,
      timezone: company.timezone,
      locale: company.locale,
      setupStatus: company.setupStatus,
      isDefault: company.isDefault,
      isTrial,
      active,
      createdAt: serializeDate(company.createdAt),
      updatedAt: serializeDate(company.updatedAt)
    };
  }

  private async isTrialCompany(
    tx: Prisma.TransactionClient,
    organizationId: string,
    companyId: string
  ): Promise<boolean> {
    const marker = await tx.auditEvent.findFirst({
      where: {
        organizationId,
        action: trialCompanyAuditAction,
        targetType: "Company",
        targetId: companyId
      },
      select: { id: true }
    });
    return marker !== null;
  }

  private async trialCompanyIds(
    tx: Prisma.TransactionClient,
    organizationId: string,
    companyIds: readonly string[]
  ): Promise<ReadonlySet<string>> {
    if (!companyIds.length) return new Set();
    const markers = await tx.auditEvent.findMany({
      where: {
        organizationId,
        action: trialCompanyAuditAction,
        targetType: "Company",
        targetId: { in: [...companyIds] }
      },
      select: { targetId: true }
    });
    return new Set(
      markers.flatMap((marker) => (marker.targetId === null ? [] : [marker.targetId]))
    );
  }
}

interface NormalizedCreateCompanyInput {
  readonly legalName: string;
  readonly displayName: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly fiscalYearEndMonth: number | null;
  readonly fiscalYearEndDay: number | null;
}

function normalizeCreateCompanyInput(input: CreateCompanyInput): NormalizedCreateCompanyInput {
  const displayName = input.displayName.trim();
  const legalName = input.legalName.trim();
  if (!displayName || !legalName) {
    throw new AppError("COMPANY_NAME_REQUIRED", "A legal and display name are required.", 400);
  }
  const baseCurrency = input.baseCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(baseCurrency)) {
    throw new AppError(
      "COMPANY_CURRENCY_INVALID",
      "Base currency must be a three-letter code.",
      400
    );
  }
  const fiscalYearEndMonth = input.fiscalYearEndMonth ?? null;
  const fiscalYearEndDay = input.fiscalYearEndDay ?? null;
  if (
    (fiscalYearEndMonth !== null &&
      (!Number.isInteger(fiscalYearEndMonth) ||
        fiscalYearEndMonth < 1 ||
        fiscalYearEndMonth > 12)) ||
    (fiscalYearEndDay !== null &&
      (!Number.isInteger(fiscalYearEndDay) || fiscalYearEndDay < 1 || fiscalYearEndDay > 31))
  ) {
    throw new AppError(
      "COMPANY_FISCAL_YEAR_END_INVALID",
      "Fiscal year-end month and day must be valid calendar values.",
      400
    );
  }
  return {
    legalName,
    displayName,
    baseCurrency,
    timezone: input.timezone.trim() || "America/Edmonton",
    locale: input.locale.trim() || "en-CA",
    fiscalYearEndMonth,
    fiscalYearEndDay
  };
}
