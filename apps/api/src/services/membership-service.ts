import {
  Prisma,
  withInvitationAcceptanceTransaction,
  withRuntimeTransaction,
  withTenantTransaction,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type {
  AuditOrigin,
  AuthenticatedIdentity,
  MembershipRole,
  OrganizationContext
} from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";
import { serializeDate } from "../utils/dates.js";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export interface CreateInvitationInput {
  readonly email: string;
  readonly role: MembershipRole;
}

export class MembershipService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listMembers(context: OrganizationContext) {
    await this.authorization.assert(context, "members:read", "Membership");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { organizationId: context.organizationId },
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
        activatedAt: serializeDate(membership.activatedAt),
        revokedAt: membership.revokedAt ? serializeDate(membership.revokedAt) : null
      }));
    });
  }

  public async createInvitation(context: OrganizationContext, input: CreateInvitationInput) {
    await this.authorization.assert(context, "members:invite", "OrganizationInvitation");
    if (context.role === "ADMIN" && input.role === "OWNER") {
      await this.auditLifecycleDenial(
        context,
        "INVITATION_CREATION_DENIED",
        "OrganizationInvitation",
        null,
        { reason: "ADMIN_CANNOT_ASSIGN_OWNER", requestedRole: input.role }
      );
      throw new AppError(
        "ROLE_ASSIGNMENT_FORBIDDEN",
        "Administrators cannot assign organization ownership.",
        403
      );
    }
    const email = normalizeEmail(input.email);
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);

    try {
      const invitation = await withTenantTransaction(
        this.prisma,
        dbContext(context),
        async (tx) => {
          const existingUser = await tx.user.findUnique({ where: { email } });
          if (existingUser) {
            const existingMembership = await tx.membership.findUnique({
              where: {
                organizationId_userId: {
                  organizationId: context.organizationId,
                  userId: existingUser.id
                }
              }
            });
            if (existingMembership?.status === "ACTIVE") {
              throw new AppError(
                "MEMBERSHIP_ALREADY_ACTIVE",
                "This user is already a member.",
                409
              );
            }
          }

          const created = await tx.organizationInvitation.create({
            data: {
              organizationId: context.organizationId,
              email,
              role: input.role,
              tokenHash,
              expiresAt: new Date(Date.now() + invitationLifetimeMs),
              createdByUserId: context.user.id
            }
          });
          await writeAudit(tx, context, {
            action: "INVITATION_CREATED",
            targetType: "OrganizationInvitation",
            targetId: created.id,
            metadata: { email, role: created.role, expiresAt: created.expiresAt.toISOString() }
          });
          return created;
        }
      );

      return { invitation: invitationDto(invitation), token };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          "INVITATION_ALREADY_PENDING",
          "A pending invitation already exists.",
          409
        );
      }
      throw error;
    }
  }

  public async acceptInvitation(
    identity: AuthenticatedIdentity,
    token: string,
    requestId: string,
    auditOrigin: AuditOrigin
  ) {
    if (!identity.emailVerifiedAt) {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verified email ownership is required.",
        403
      );
    }
    const tokenHash = hashOpaqueToken(token);
    const organizationId = await withRuntimeTransaction(this.prisma, identity.id, async (tx) => {
      const rows = await tx.$queryRaw<readonly { organizationId: string | null }[]>`
        SELECT resolve_invitation_organization(${tokenHash}) AS "organizationId"
      `;
      return rows[0]?.organizationId ?? null;
    });
    if (!organizationId) {
      throw new AppError("INVITATION_INVALID", "The invitation is invalid.", 404);
    }

    const outcome = await withInvitationAcceptanceTransaction(
      this.prisma,
      { organizationId, actorUserId: identity.id },
      tokenHash,
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "OrganizationInvitation" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
        const invitation = await tx.organizationInvitation.findUnique({ where: { tokenHash } });
        if (!invitation) {
          return { error: "INVALID" as const };
        }
        const acceptanceContext = contextFromIdentity(
          identity,
          organizationId,
          requestId,
          auditOrigin
        );
        if (invitation.status !== "PENDING") {
          await writeAudit(tx, acceptanceContext, {
            action: "INVITATION_ACCEPTANCE_DENIED",
            targetType: "OrganizationInvitation",
            targetId: invitation.id,
            metadata: { reason: "NOT_PENDING", status: invitation.status }
          });
          return { error: "USED" as const };
        }
        if (invitation.expiresAt <= new Date()) {
          await tx.organizationInvitation.update({
            where: { id: invitation.id },
            data: { status: "EXPIRED" }
          });
          await writeAudit(tx, acceptanceContext, {
            action: "INVITATION_EXPIRED",
            targetType: "OrganizationInvitation",
            targetId: invitation.id,
            metadata: { email: invitation.email }
          });
          return { error: "EXPIRED" as const };
        }
        if (invitation.email !== normalizeEmail(identity.email)) {
          await writeAudit(tx, acceptanceContext, {
            action: "INVITATION_ACCEPTANCE_DENIED",
            targetType: "OrganizationInvitation",
            targetId: invitation.id,
            metadata: { reason: "EMAIL_MISMATCH" }
          });
          return { error: "EMAIL_MISMATCH" as const };
        }

        const existing = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId, userId: identity.id } }
        });
        const membership = existing
          ? await tx.membership.update({
              where: { id: existing.id },
              data: {
                role: invitation.role,
                status: "ACTIVE",
                activatedAt: new Date(),
                revokedAt: null,
                revokedByUserId: null
              }
            })
          : await tx.membership.create({
              data: { organizationId, userId: identity.id, role: invitation.role }
            });
        await tx.organizationInvitation.update({
          where: { id: invitation.id },
          data: {
            status: "ACCEPTED",
            acceptedAt: new Date(),
            acceptedByUserId: identity.id
          }
        });
        if (identity.sessionId) {
          await tx.session.updateMany({
            where: { id: identity.sessionId, userId: identity.id, revokedAt: null },
            data: { activeOrganizationId: organizationId }
          });
        }
        await writeAudit(tx, acceptanceContext, {
          action: "INVITATION_ACCEPTED",
          targetType: "OrganizationInvitation",
          targetId: invitation.id,
          metadata: { membershipId: membership.id, role: membership.role }
        });
        await writeAudit(tx, acceptanceContext, {
          action: "MEMBERSHIP_ACTIVATED",
          targetType: "Membership",
          targetId: membership.id,
          metadata: { role: membership.role, invitationId: invitation.id }
        });
        return { membership };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    if ("error" in outcome) {
      const errors = {
        INVALID: ["INVITATION_INVALID", "The invitation is invalid.", 404],
        USED: ["INVITATION_ALREADY_USED", "The invitation has already been used or revoked.", 409],
        EXPIRED: ["INVITATION_EXPIRED", "The invitation has expired.", 410],
        EMAIL_MISMATCH: [
          "INVITATION_EMAIL_MISMATCH",
          "The invitation belongs to another email address.",
          403
        ]
      } as const;
      const [code, message, status] = errors[outcome.error];
      throw new AppError(code, message, status);
    }
    return membershipDto(outcome.membership);
  }

  public async revokeInvitation(context: OrganizationContext, invitationId: string) {
    await this.authorization.assert(
      context,
      "members:invite",
      "OrganizationInvitation",
      invitationId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const invitation = await tx.organizationInvitation.findFirst({
        where: { id: invitationId, organizationId: context.organizationId }
      });
      if (!invitation) {
        throw new AppError("INVITATION_NOT_FOUND", "Invitation was not found.", 404);
      }
      if (invitation.status !== "PENDING") {
        throw new AppError(
          "INVITATION_NOT_PENDING",
          "Only pending invitations can be revoked.",
          409
        );
      }
      const revoked = await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: context.user.id }
      });
      await writeAudit(tx, context, {
        action: "INVITATION_REVOKED",
        targetType: "OrganizationInvitation",
        targetId: revoked.id,
        metadata: { email: revoked.email, role: revoked.role }
      });
      return invitationDto(revoked);
    });
  }

  public async changeRole(
    context: OrganizationContext,
    membershipId: string,
    role: MembershipRole
  ) {
    await this.authorization.assert(context, "members:roles", "Membership", membershipId);
    try {
      const result = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { id: membershipId, organizationId: context.organizationId }
        });
        if (!membership || membership.status !== "ACTIVE") {
          throw new AppError("MEMBERSHIP_NOT_FOUND", "Membership was not found.", 404);
        }
        const denialReason = this.roleChangeDenial(
          context,
          membership.userId,
          membership.role,
          role
        );
        if (denialReason) {
          await writeAudit(tx, context, {
            action: "MEMBER_ROLE_CHANGE_DENIED",
            targetType: "Membership",
            targetId: membership.id,
            metadata: { reason: denialReason, currentRole: membership.role, requestedRole: role }
          });
          return { error: denialReason };
        }
        const updated = await tx.membership.update({
          where: { id: membership.id },
          data: { role }
        });
        const revokedSessions = await tx.session.updateMany({
          where: { userId: membership.userId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: "MEMBERSHIP_ROLE_CHANGED" }
        });
        await tx.authenticationAuditEvent.createMany({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            targetUserId: membership.userId,
            action: "SESSIONS_REVOKED_AFTER_ROLE_CHANGE",
            outcome: "SUCCESS",
            requestId: context.requestId,
            ipAddress: context.auditOrigin.ipAddress,
            userAgent: context.auditOrigin.userAgent,
            metadata: { revokedSessionCount: revokedSessions.count }
          }
        });
        await writeAudit(tx, context, {
          action: "MEMBER_ROLE_CHANGED",
          targetType: "Membership",
          targetId: updated.id,
          metadata: {
            before: { role: membership.role },
            after: { role: updated.role },
            revokedSessionCount: revokedSessions.count
          }
        });
        return { membership: updated };
      });
      if ("error" in result) {
        throw new AppError(
          "ROLE_CHANGE_FORBIDDEN",
          "The requested role change is not allowed.",
          403,
          {
            reason: result.error
          }
        );
      }
      return membershipDto(result.membership);
    } catch (error) {
      if (isFinalOwnerDatabaseError(error)) {
        throw new AppError(
          "FINAL_OWNER_REQUIRED",
          "An organization must retain an active owner.",
          409
        );
      }
      throw error;
    }
  }

  public async revokeMembership(context: OrganizationContext, membershipId: string) {
    await this.authorization.assert(context, "members:revoke", "Membership", membershipId);
    if (membershipId === context.membershipId) {
      await this.auditLifecycleDenial(
        context,
        "MEMBERSHIP_REVOCATION_DENIED",
        "Membership",
        membershipId,
        { reason: "SELF_REVOCATION" }
      );
      throw new AppError(
        "SELF_REVOCATION_FORBIDDEN",
        "You cannot revoke your own membership.",
        403
      );
    }
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { id: membershipId, organizationId: context.organizationId }
        });
        if (!membership || membership.status !== "ACTIVE") {
          throw new AppError("MEMBERSHIP_NOT_FOUND", "Membership was not found.", 404);
        }
        if (context.role === "ADMIN" && membership.role === "OWNER") {
          await writeAudit(tx, context, {
            action: "MEMBERSHIP_REVOCATION_DENIED",
            targetType: "Membership",
            targetId: membership.id,
            metadata: { reason: "ADMIN_CANNOT_REVOKE_OWNER" }
          });
          return { error: "ADMIN_CANNOT_REVOKE_OWNER" as const };
        }
        const revoked = await tx.membership.update({
          where: { id: membership.id },
          data: {
            status: "REVOKED",
            revokedAt: new Date(),
            revokedByUserId: context.user.id
          }
        });
        await tx.session.updateMany({
          where: { userId: membership.userId, activeOrganizationId: context.organizationId },
          data: { activeOrganizationId: null }
        });
        await writeAudit(tx, context, {
          action: "MEMBERSHIP_REVOKED",
          targetType: "Membership",
          targetId: revoked.id,
          metadata: { userId: revoked.userId, role: revoked.role }
        });
        return { membership: revoked };
      }).then((result) => {
        if ("error" in result) {
          throw new AppError(
            "MEMBERSHIP_REVOCATION_FORBIDDEN",
            "The membership cannot be revoked.",
            403
          );
        }
        return membershipDto(result.membership);
      });
    } catch (error) {
      if (isFinalOwnerDatabaseError(error)) {
        throw new AppError(
          "FINAL_OWNER_REQUIRED",
          "An organization must retain an active owner.",
          409
        );
      }
      throw error;
    }
  }

  private roleChangeDenial(
    context: OrganizationContext,
    targetUserId: string,
    currentRole: MembershipRole,
    requestedRole: MembershipRole
  ): string | null {
    if (targetUserId === context.user.id) {
      return roleRank(requestedRole) > roleRank(context.role)
        ? "SELF_ESCALATION"
        : "SELF_ROLE_CHANGE";
    }
    if (context.role === "ADMIN" && (currentRole === "OWNER" || requestedRole === "OWNER")) {
      return "ADMIN_OWNER_CHANGE";
    }
    if (roleRank(requestedRole) > roleRank(context.role)) {
      return "ROLE_ABOVE_ACTOR";
    }
    return null;
  }

  private async auditLifecycleDenial(
    context: OrganizationContext,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata: Prisma.InputJsonObject
  ): Promise<void> {
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action,
          targetType,
          targetId,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, metadata)
        }
      })
    );
  }
}

function contextFromIdentity(
  identity: AuthenticatedIdentity,
  organizationId: string,
  requestId: string,
  auditOrigin: AuditOrigin
): OrganizationContext {
  return {
    requestId,
    user: identity,
    organizationId,
    membershipId: "invitation-acceptance",
    role: "READ_ONLY",
    sessionId: identity.sessionId,
    recentAuthAt: identity.recentAuthAt,
    mfaAuthenticated: identity.mfaAuthenticated,
    authenticationMethod: identity.authenticationMethod,
    auditOrigin
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function writeAudit(
  tx: RuntimeTransaction,
  context: OrganizationContext,
  input: {
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly metadata: Prisma.InputJsonObject;
  }
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, input.metadata)
    }
  });
}

function membershipDto(membership: {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: "ACTIVE" | "REVOKED";
  activatedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    activatedAt: serializeDate(membership.activatedAt),
    revokedAt: membership.revokedAt ? serializeDate(membership.revokedAt) : null,
    createdAt: serializeDate(membership.createdAt),
    updatedAt: serializeDate(membership.updatedAt)
  };
}

function invitationDto(invitation: {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRole;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: serializeDate(invitation.expiresAt),
    acceptedAt: invitation.acceptedAt ? serializeDate(invitation.acceptedAt) : null,
    revokedAt: invitation.revokedAt ? serializeDate(invitation.revokedAt) : null,
    createdAt: serializeDate(invitation.createdAt)
  };
}

function roleRank(role: MembershipRole): number {
  const ranks: Record<MembershipRole, number> = {
    OWNER: 100,
    ADMIN: 80,
    ACCOUNTANT: 60,
    BOOKKEEPER: 50,
    SALES: 30,
    PURCHASES: 30,
    INVENTORY: 30,
    READ_ONLY: 10
  };
  return ranks[role];
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isFinalOwnerDatabaseError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("retain at least one active owner");
}
