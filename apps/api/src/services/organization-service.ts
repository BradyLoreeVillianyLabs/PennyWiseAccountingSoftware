import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  withRuntimeTransaction,
  withTenantTransaction,
  withOrganizationBootstrapTransaction,
  type PrismaClient
} from "@clearledger/db";
import type { AuditOrigin, AuthenticatedIdentity, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { serializeDate } from "../utils/dates.js";
import { trialCompanyAuditAction } from "./company-service.js";
import { runIdempotent } from "./idempotency-service.js";

export interface CreateOrganizationInput {
  readonly legalName: string;
  readonly displayName: string;
  readonly currency: string;
  readonly timezone: string;
}

interface EnsureOrganizationOptions {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly lifecycle?: "DISPOSABLE_TRIAL" | undefined;
}

interface OrganizationSelection {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly role: OrganizationContext["role"];
  readonly displayName: string;
  readonly companyId?: string;
}

export interface TrialCompanyLifecycleResult {
  readonly organization: {
    readonly id: string;
    readonly legalName: string;
    readonly displayName: string;
    readonly currency: string;
    readonly timezone: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly company: {
    readonly id: string;
    readonly membershipId: string;
    readonly legalName: string;
    readonly displayName: string;
    readonly status: string;
    readonly baseCurrency: string;
    readonly timezone: string;
    readonly locale: string;
    readonly setupStatus: string;
    readonly isDefault: boolean;
    readonly isTrial: true;
    readonly active: true;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly created: boolean;
  readonly replayed: boolean;
}

export class OrganizationService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async createOrganization(
    actor: AuthenticatedIdentity,
    input: CreateOrganizationInput,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    const result = await this.bootstrapOrganization(actor, input, requestId, auditOrigin, {
      organizationId: randomUUID(),
      membershipId: randomUUID()
    });
    return result.organization;
  }

  /**
   * Creates one blank, user-owned trial workspace with a marked default
   * company. The deterministic identifiers and idempotency record make a lost
   * response safe to retry without creating another tenant or book.
   */
  public async createTrialOrganization(
    actor: AuthenticatedIdentity,
    input: CreateOrganizationInput,
    idempotencyKey: string | undefined,
    requestId: string,
    auditOrigin: AuditOrigin
  ): Promise<TrialCompanyLifecycleResult> {
    if (actor.authenticationMethod === "API_KEY") {
      throw new AppError(
        "API_KEY_ORGANIZATION_CREATE_UNSUPPORTED",
        "API credentials cannot create trial organizations.",
        403
      );
    }
    const normalizedInput = normalizeTrialOrganizationInput(input);
    const organizationId = stableUuid(`clearledger:trial-company:v1:${actor.id}`);
    const membershipId = stableUuid(`clearledger:trial-company-membership:v1:${actor.id}`);
    const ensured = await this.ensureTrialOrganization(
      actor,
      normalizedInput,
      requestId,
      auditOrigin,
      { organizationId, membershipId, lifecycle: "DISPOSABLE_TRIAL" }
    );
    const context: OrganizationContext = {
      requestId,
      user: actor,
      organizationId,
      membershipId: ensured.membershipId,
      role: "OWNER",
      sessionId: actor.sessionId,
      recentAuthAt: actor.recentAuthAt,
      mfaAuthenticated: actor.mfaAuthenticated,
      authenticationMethod: actor.authenticationMethod,
      ...(actor.apiCredentialId !== undefined ? { apiCredentialId: actor.apiCredentialId } : {}),
      ...(actor.apiCredentialScopes !== undefined
        ? { apiCredentialScopes: actor.apiCredentialScopes }
        : {}),
      ...(actor.oauthAccessTokenId !== undefined
        ? { oauthAccessTokenId: actor.oauthAccessTokenId }
        : {}),
      ...(actor.oauthScopes !== undefined ? { oauthScopes: actor.oauthScopes } : {}),
      auditOrigin
    };
    const result = await runIdempotent(
      this.prisma,
      context,
      "organization.trial-company.create",
      idempotencyKey,
      normalizedInput,
      async (tx) => {
        const organization = await tx.organization.findUnique({ where: { id: organizationId } });
        const companyMembership = await tx.companyMembership.findFirst({
          where: {
            organizationId,
            userId: actor.id,
            status: "ACTIVE",
            company: { status: "ACTIVE", isDefault: true }
          },
          include: { company: true }
        });
        if (!organization) {
          throw new AppError(
            "TRIAL_COMPANY_CONFLICT",
            "The reserved trial workspace is not a disposable trial company.",
            409
          );
        }
        if (!companyMembership) {
          throw new AppError(
            "TRIAL_COMPANY_DISPOSED",
            "The original trial company was archived. Create another trial company from the existing workspace instead.",
            409
          );
        }
        const marker = await tx.auditEvent.findFirst({
          where: {
            organizationId,
            action: trialCompanyAuditAction,
            targetType: "Company",
            targetId: companyMembership.companyId
          },
          select: { id: true }
        });
        if (!marker) {
          throw new AppError(
            "TRIAL_COMPANY_CONFLICT",
            "The reserved trial workspace is not a disposable trial company.",
            409
          );
        }
        if (!trialInputMatches(organization, companyMembership.company, normalizedInput)) {
          throw new AppError(
            "TRIAL_COMPANY_ALREADY_EXISTS",
            "A disposable trial company already exists with different setup details. Use the existing trial or archive it before starting another.",
            409
          );
        }
        return {
          statusCode: ensured.created ? 201 : 200,
          body: {
            organization: this.organizationDto(organization),
            company: this.trialCompanyDto(companyMembership.company, companyMembership.id),
            created: ensured.created
          },
          resourceId: organizationId
        };
      }
    );
    return { ...result.body, replayed: result.replayed === true };
  }

  /**
   * Ensures a caller-owned organization at deterministic identifiers.
   *
   * This is intentionally separate from normal organization creation. It lets a
   * gated fixture workflow resume after interruption without creating duplicate
   * tenants, while retaining the same RLS-protected bootstrap path.
   */
  public async ensureOrganization(
    actor: AuthenticatedIdentity,
    input: CreateOrganizationInput,
    requestId: string,
    auditOrigin: AuditOrigin,
    options: EnsureOrganizationOptions
  ) {
    if (!actor.emailVerifiedAt) {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verified email ownership is required.",
        403
      );
    }
    if (actor.authenticationMethod === "OIDC" && !actor.mfaAuthenticated) {
      throw new AppError("MFA_REQUIRED", "Multi-factor authentication is required.", 403);
    }

    // A tenant read can only see this membership after the RLS access locator
    // exists. Checking before bootstrap avoids PostgreSQL's ON CONFLICT path,
    // which cannot safely inspect a pre-membership Organization under RLS.
    const existing = await withTenantTransaction(
      this.prisma,
      { organizationId: options.organizationId, actorUserId: actor.id },
      (tx) =>
        tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: options.organizationId,
              userId: actor.id
            }
          },
          include: { organization: true }
        })
    );
    if (existing) {
      if (existing.role !== "OWNER" || existing.status !== "ACTIVE")
        throw new AppError(
          "ORGANIZATION_BOOTSTRAP_CONFLICT",
          "The deterministic organization identifier is already assigned.",
          409
        );
      return {
        organization: this.organizationDto(existing.organization),
        membershipId: existing.id,
        created: false
      };
    }

    return this.bootstrapOrganization(actor, input, requestId, auditOrigin, options);
  }

  private async bootstrapOrganization(
    actor: AuthenticatedIdentity,
    input: CreateOrganizationInput,
    requestId: string,
    auditOrigin: AuditOrigin,
    options: EnsureOrganizationOptions
  ) {
    if (!actor.emailVerifiedAt) {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verified email ownership is required.",
        403
      );
    }
    if (actor.authenticationMethod === "OIDC" && !actor.mfaAuthenticated) {
      throw new AppError("MFA_REQUIRED", "Multi-factor authentication is required.", 403);
    }

    const { organizationId, membershipId } = options;
    return withOrganizationBootstrapTransaction(
      this.prisma,
      { organizationId, actorUserId: actor.id },
      async (tx) => {
        // Prisma adds RETURNING to create(), which also evaluates each table's
        // SELECT policy. During bootstrap the membership access locator does
        // not exist until after the OWNER membership trigger runs, so those
        // otherwise valid inserts would fail closed under RLS. Keep the two
        // writes inside this short bootstrap transaction, omit RETURNING, and
        // read them normally only after the locator has been created.
        await tx.$executeRaw`
          INSERT INTO "Organization" (
            "id", "legalName", "displayName", "currency", "timezone", "createdAt", "updatedAt"
          ) VALUES (
            ${organizationId}::uuid,
            ${input.legalName},
            ${input.displayName},
            ${input.currency},
            ${input.timezone},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `;
        await tx.$executeRaw`
          INSERT INTO "Membership" (
            "id", "organizationId", "userId", "role", "status",
            "activatedAt", "createdAt", "updatedAt"
          ) VALUES (
            ${membershipId}::uuid,
            ${organizationId}::uuid,
            ${actor.id}::uuid,
            'OWNER'::"MembershipRole",
            'ACTIVE'::"MembershipStatus",
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `;
        const membership = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId, userId: actor.id } }
        });
        if (!membership || membership.role !== "OWNER" || membership.status !== "ACTIVE")
          throw new AppError(
            "ORGANIZATION_BOOTSTRAP_CONFLICT",
            "The deterministic organization identifier is already assigned.",
            409
          );
        await tx.organizationSettings.upsert({
          where: { organizationId },
          create: { organizationId, baseCurrency: input.currency, timeZone: input.timezone },
          update: {}
        });
        await tx.$executeRaw`
          INSERT INTO "OrganizationCurrency" ("organizationId", "currencyCode", "exponent", "enabled", "updatedAt")
          VALUES (${organizationId}::uuid, ${input.currency}, 2, true, CURRENT_TIMESTAMP)
          ON CONFLICT ("organizationId", "currencyCode") DO NOTHING
        `;
        await tx.$executeRaw`
          INSERT INTO "FxPolicy" ("organizationId", "updatedAt")
          VALUES (${organizationId}::uuid, CURRENT_TIMESTAMP)
          ON CONFLICT ("organizationId") DO NOTHING
        `;
        const company = await tx.company.create({
          data: {
            organizationId,
            legalName: input.legalName,
            displayName: input.displayName,
            baseCurrency: input.currency,
            timezone: input.timezone,
            locale: "en-CA",
            setupStatus: "INCOMPLETE",
            isDefault: true,
            createdByUserId: actor.id
          }
        });
        await tx.companyMembership.create({
          data: {
            organizationId,
            companyId: company.id,
            userId: actor.id,
            role: "OWNER",
            status: "ACTIVE"
          }
        });
        const workflowPreferences = await tx.workflowPreferences.upsert({
          where: { organizationId },
          create: { organizationId },
          update: {}
        });
        await tx.businessDefaults.upsert({
          where: { organizationId },
          create: { organizationId },
          update: {}
        });
        await tx.setupStepState.createMany({
          data: (
            [
              "BUSINESS_PROFILE",
              "FISCAL_CURRENCY",
              "TAX_REGISTRATION",
              "INDUSTRY_PRESET",
              "CHART_REVIEW",
              "OPENING_BALANCES",
              "BRANDING_DEFAULTS",
              "FINAL_REVIEW"
            ] as const
          ).map((step) => ({ organizationId, step })),
          skipDuplicates: true
        });
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: organizationId }
        });

        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actor.id,
            action: "ORGANIZATION_CREATED",
            targetType: "Organization",
            targetId: organizationId,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              legalName: organization.legalName,
              displayName: organization.displayName,
              currency: organization.currency
            })
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actor.id,
            action: "COMPANY_CREATED",
            targetType: "Company",
            targetId: company.id,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {
              legalName: company.legalName,
              displayName: company.displayName,
              isDefault: true,
              ...(options.lifecycle ? { lifecycle: options.lifecycle } : {})
            })
          }
        });
        if (options.lifecycle === "DISPOSABLE_TRIAL") {
          await tx.auditEvent.create({
            data: {
              organizationId,
              actorUserId: actor.id,
              action: trialCompanyAuditAction,
              targetType: "Company",
              targetId: company.id,
              requestId,
              metadata: withAuditOrigin(auditOrigin, {
                lifecycle: options.lifecycle,
                copiedFromCompany: false,
                initialCompany: true
              })
            }
          });
        }
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actor.id,
            action: "WORKFLOW_PREFERENCES_INITIALIZED",
            targetType: "WorkflowPreferences",
            targetId: workflowPreferences.id,
            requestId,
            metadata: withAuditOrigin(auditOrigin, { profileKey: "SOLO_SERVICE" })
          }
        });

        return {
          organization: this.organizationDto(organization),
          membershipId: membership.id,
          created: true
        };
      }
    );
  }

  public async listOrganizations(
    identity: AuthenticatedIdentity
  ): Promise<readonly OrganizationSelection[]> {
    if (identity.authenticationMethod === "API_KEY" && identity.activeOrganizationId) {
      return withTenantTransaction(
        this.prisma,
        { organizationId: identity.activeOrganizationId, actorUserId: identity.id },
        async (tx) => {
          const membership = await tx.membership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: identity.activeOrganizationId!,
                userId: identity.id
              }
            },
            include: { organization: true }
          });
          if (!membership || membership.status !== "ACTIVE") return [];
          return [
            {
              organizationId: membership.organizationId,
              membershipId: membership.id,
              role: membership.role,
              displayName: membership.organization.displayName
            }
          ];
        }
      );
    }
    return withRuntimeTransaction(this.prisma, identity.id, async (tx) => {
      return tx.$queryRaw<OrganizationSelection[]>`SELECT * FROM list_actor_organizations()`;
    });
  }

  public async getCurrentOrganization(context: OrganizationContext) {
    const organization = await withTenantTransaction(
      this.prisma,
      { organizationId: context.organizationId, actorUserId: context.user.id },
      (tx) => tx.organization.findUnique({ where: { id: context.organizationId } })
    );

    if (!organization) {
      throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
    }
    return this.organizationDto(organization);
  }

  public async switchOrganization(
    identity: AuthenticatedIdentity,
    organizationId: string,
    requestId: string,
    auditOrigin: AuditOrigin
  ): Promise<OrganizationSelection> {
    if (identity.authenticationMethod === "API_KEY") {
      throw new AppError(
        "API_KEY_ORGANIZATION_SWITCH_UNSUPPORTED",
        "API credentials are permanently scoped to one organization.",
        403
      );
    }
    const result = await withTenantTransaction(
      this.prisma,
      { organizationId, actorUserId: identity.id },
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId, userId: identity.id } },
          include: { organization: true }
        });
        if (!membership || membership.status !== "ACTIVE") {
          return null;
        }

        const defaultCompanyMembership = await tx.companyMembership.findFirst({
          where: {
            organizationId,
            userId: identity.id,
            status: "ACTIVE",
            company: { status: "ACTIVE", isDefault: true }
          },
          include: { company: true }
        });

        const context: OrganizationContext = {
          requestId,
          user: identity,
          organizationId,
          membershipId: membership.id,
          role: defaultCompanyMembership?.role ?? membership.role,
          sessionId: identity.sessionId,
          ...(defaultCompanyMembership
            ? {
                companyId: defaultCompanyMembership.companyId,
                companyMembershipId: defaultCompanyMembership.id
              }
            : {}),
          recentAuthAt: identity.recentAuthAt,
          mfaAuthenticated: identity.mfaAuthenticated,
          authenticationMethod: identity.authenticationMethod,
          auditOrigin
        };
        await this.authorization.assert(
          context,
          "organizations:switch",
          "Organization",
          organizationId
        );

        if (identity.sessionId) {
          await tx.session.updateMany({
            where: { id: identity.sessionId, userId: identity.id, revokedAt: null },
            data: {
              activeOrganizationId: organizationId,
              activeCompanyId: defaultCompanyMembership?.companyId ?? null
            }
          });
        }
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: identity.id,
            action: "ORGANIZATION_SWITCHED",
            targetType: "Organization",
            targetId: organizationId,
            requestId,
            metadata: withAuditOrigin(auditOrigin, {})
          }
        });
        await tx.authenticationAuditEvent.createMany({
          data: {
            organizationId,
            actorUserId: identity.id,
            targetUserId: identity.id,
            sessionId: identity.sessionId,
            action: "ORGANIZATION_SWITCHED",
            outcome: "SUCCESS",
            requestId,
            ipAddress: auditOrigin.ipAddress,
            userAgent: auditOrigin.userAgent
          }
        });
        return {
          organizationId,
          membershipId: membership.id,
          role: defaultCompanyMembership?.role ?? membership.role,
          displayName: membership.organization.displayName,
          ...(defaultCompanyMembership ? { companyId: defaultCompanyMembership.companyId } : {})
        };
      }
    );

    if (!result) {
      throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
    }
    return result;
  }

  private async ensureTrialOrganization(
    actor: AuthenticatedIdentity,
    input: CreateOrganizationInput,
    requestId: string,
    auditOrigin: AuditOrigin,
    options: EnsureOrganizationOptions
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.ensureOrganization(actor, input, requestId, auditOrigin, options);
      } catch (error) {
        if (!isUniqueConstraintError(error) || attempt === 2) throw error;
      }
    }
    throw new AppError(
      "TRIAL_COMPANY_CREATE_RETRY_EXHAUSTED",
      "The trial company could not be created safely. Retry the request with the same idempotency key.",
      409
    );
  }

  private trialCompanyDto(
    company: {
      id: string;
      legalName: string;
      displayName: string;
      status: string;
      baseCurrency: string;
      timezone: string;
      locale: string;
      setupStatus: string;
      isDefault: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    membershipId: string
  ): TrialCompanyLifecycleResult["company"] {
    return {
      id: company.id,
      membershipId,
      legalName: company.legalName,
      displayName: company.displayName,
      status: company.status,
      baseCurrency: company.baseCurrency,
      timezone: company.timezone,
      locale: company.locale,
      setupStatus: company.setupStatus,
      isDefault: company.isDefault,
      isTrial: true,
      active: true,
      createdAt: serializeDate(company.createdAt),
      updatedAt: serializeDate(company.updatedAt)
    };
  }

  private organizationDto(organization: {
    id: string;
    legalName: string;
    displayName: string;
    currency: string;
    timezone: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: organization.id,
      legalName: organization.legalName,
      displayName: organization.displayName,
      currency: organization.currency,
      timezone: organization.timezone,
      createdAt: serializeDate(organization.createdAt),
      updatedAt: serializeDate(organization.updatedAt)
    };
  }
}

function normalizeTrialOrganizationInput(input: CreateOrganizationInput): CreateOrganizationInput {
  const legalName = input.legalName.trim();
  const displayName = input.displayName.trim();
  const timezone = input.timezone.trim();
  if (!legalName || !displayName || !timezone) {
    throw new AppError(
      "TRIAL_COMPANY_FIELD_REQUIRED",
      "A legal name, display name, and timezone are required for a trial company.",
      400
    );
  }
  if (input.currency !== "CAD") {
    throw new AppError(
      "TRIAL_COMPANY_CURRENCY_UNSUPPORTED",
      "Trial companies currently support CAD only.",
      400
    );
  }
  return { legalName, displayName, currency: "CAD", timezone };
}

function trialInputMatches(
  organization: {
    readonly legalName: string;
    readonly displayName: string;
    readonly currency: string;
    readonly timezone: string;
  },
  company: {
    readonly legalName: string;
    readonly displayName: string;
    readonly baseCurrency: string;
    readonly timezone: string;
  },
  input: CreateOrganizationInput
): boolean {
  return (
    organization.legalName === input.legalName &&
    organization.displayName === input.displayName &&
    organization.currency === input.currency &&
    organization.timezone === input.timezone &&
    company.legalName === input.legalName &&
    company.displayName === input.displayName &&
    company.baseCurrency === input.currency &&
    company.timezone === input.timezone
  );
}

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
