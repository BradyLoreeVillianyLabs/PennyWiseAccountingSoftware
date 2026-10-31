import {
  withRuntimeTransaction,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type { AuditOrigin, AuthenticatedIdentity } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import type { FastifyRequest } from "fastify";
import type { IdentityAdapter } from "./identity-adapter.js";
import { requestHeader } from "./identity-adapter.js";
import { createOpaqueToken, hashOpaqueToken } from "./security.js";

const sessionCookieName = "clearledger_session";
const idleLifetimeMs = 15 * 60 * 1000;
const absoluteLifetimeMs = 8 * 60 * 60 * 1000;

export interface CreatedSession {
  readonly id: string;
  readonly token: string;
  readonly absoluteExpiresAt: Date;
}

interface SessionRequestContext {
  readonly requestId: string;
  readonly auditOrigin: AuditOrigin;
}

export class SessionService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createSession(
    tx: RuntimeTransaction,
    userId: string,
    recentAuthAt: Date,
    mfaAuthenticated: boolean,
    activeOrganizationId: string | null = null,
    activeCompanyId: string | null = null
  ): Promise<CreatedSession> {
    const token = createOpaqueToken();
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + absoluteLifetimeMs);
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + idleLifetimeMs, absoluteExpiresAt.getTime())
    );
    const session = await tx.session.create({
      data: {
        tokenHash: hashOpaqueToken(token),
        userId,
        activeOrganizationId,
        activeCompanyId,
        idleExpiresAt,
        absoluteExpiresAt,
        recentAuthAt,
        mfaAuthenticated
      }
    });

    return { id: session.id, token, absoluteExpiresAt };
  }

  public async authenticate(
    token: string | undefined,
    context: SessionRequestContext
  ): Promise<AuthenticatedIdentity> {
    if (!token) {
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    }

    const result = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      const session = await tx.session.findUnique({
        where: { tokenHash: hashOpaqueToken(token) },
        include: { user: true }
      });

      if (!session) {
        await this.writeAuthenticationEvent(tx, context, {
          action: "SESSION_AUTHENTICATION",
          outcome: "INVALID"
        });
        return { error: "INVALID" as const };
      }

      await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${session.userId}, true)`;
      const now = new Date();
      const expired = session.idleExpiresAt <= now || session.absoluteExpiresAt <= now;
      const disabled = session.user.status !== "ACTIVE";

      if (session.revokedAt || expired || disabled) {
        if (!session.revokedAt) {
          await tx.session.update({
            where: { id: session.id },
            data: {
              revokedAt: now,
              revocationReason: expired ? "SESSION_EXPIRED" : "ACCOUNT_DISABLED"
            }
          });
        }
        await this.writeAuthenticationEvent(tx, context, {
          actorUserId: session.userId,
          targetUserId: session.userId,
          sessionId: session.id,
          action: "SESSION_AUTHENTICATION",
          outcome: session.revokedAt ? "REVOKED" : expired ? "EXPIRED" : "ACCOUNT_DISABLED"
        });
        return { error: session.revokedAt ? ("REVOKED" as const) : ("EXPIRED" as const) };
      }

      if (!session.user.emailVerifiedAt) {
        return { error: "EMAIL_UNVERIFIED" as const };
      }

      const idleExpiresAt = new Date(
        Math.min(now.getTime() + idleLifetimeMs, session.absoluteExpiresAt.getTime())
      );
      await tx.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, idleExpiresAt }
      });

      return {
        identity: {
          id: session.user.id,
          email: session.user.email,
          displayName: session.user.displayName,
          emailVerifiedAt: session.user.emailVerifiedAt,
          sessionId: session.id,
          activeOrganizationId: session.activeOrganizationId,
          activeCompanyId: session.activeCompanyId,
          recentAuthAt: session.recentAuthAt,
          mfaAuthenticated: session.mfaAuthenticated,
          authenticationMethod: "OIDC" as const
        }
      };
    });

    if ("identity" in result) {
      return result.identity;
    }

    if (result.error === "EMAIL_UNVERIFIED") {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verified email ownership is required.",
        403
      );
    }
    throw new AppError("SESSION_INVALID", "The session is expired, revoked, or invalid.", 401);
  }

  public async renew(identity: AuthenticatedIdentity): Promise<CreatedSession> {
    if (!identity.sessionId) {
      throw new AppError("SESSION_REQUIRED", "A production session is required.", 400);
    }

    const token = createOpaqueToken();
    return withRuntimeTransaction(this.prisma, identity.id, async (tx) => {
      const session = await tx.session.findFirst({
        where: { id: identity.sessionId!, userId: identity.id, revokedAt: null }
      });
      const now = new Date();
      if (!session || session.absoluteExpiresAt <= now || session.idleExpiresAt <= now) {
        throw new AppError("SESSION_INVALID", "The session is expired, revoked, or invalid.", 401);
      }

      const idleExpiresAt = new Date(
        Math.min(now.getTime() + idleLifetimeMs, session.absoluteExpiresAt.getTime())
      );
      await tx.session.update({
        where: { id: session.id },
        data: { tokenHash: hashOpaqueToken(token), lastSeenAt: now, idleExpiresAt }
      });
      return { id: session.id, token, absoluteExpiresAt: session.absoluteExpiresAt };
    });
  }

  public async list(identity: AuthenticatedIdentity) {
    return withRuntimeTransaction(this.prisma, identity.id, async (tx) => {
      const records = await tx.session.findMany({
        where: { userId: identity.id },
        orderBy: { issuedAt: "desc" },
        take: 50
      });
      return records.map((session) => ({
        id: session.id,
        issuedAt: session.issuedAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.absoluteExpiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString() ?? null,
        isCurrent: session.id === identity.sessionId
      }));
    });
  }

  public async revokeById(
    identity: AuthenticatedIdentity,
    sessionId: string,
    context: SessionRequestContext
  ): Promise<void> {
    const revoked = await withRuntimeTransaction(this.prisma, identity.id, async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sessionId, userId: identity.id, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: "USER_SESSION_REVOCATION" }
      });
      if (result.count === 1) {
        await this.writeAuthenticationEvent(tx, context, {
          actorUserId: identity.id,
          targetUserId: identity.id,
          sessionId,
          action: "SESSION_REVOKED",
          outcome: "SUCCESS"
        });
      }
      return result.count;
    });
    if (revoked !== 1) {
      throw new AppError("SESSION_NOT_FOUND", "Session was not found or was already revoked.", 404);
    }
  }

  public async revoke(
    identity: AuthenticatedIdentity,
    context: SessionRequestContext,
    reason = "USER_SIGN_OUT"
  ): Promise<void> {
    if (!identity.sessionId) {
      return;
    }
    await withRuntimeTransaction(this.prisma, identity.id, async (tx) => {
      await tx.session.updateMany({
        where: { id: identity.sessionId!, userId: identity.id, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: reason }
      });
      await this.writeAuthenticationEvent(tx, context, {
        actorUserId: identity.id,
        targetUserId: identity.id,
        sessionId: identity.sessionId,
        action: reason === "USER_SIGN_OUT" ? "LOGOUT" : "SESSION_REVOKED",
        outcome: "SUCCESS"
      });
    });
  }

  private async writeAuthenticationEvent(
    tx: RuntimeTransaction,
    context: SessionRequestContext,
    input: {
      readonly actorUserId?: string | undefined;
      readonly targetUserId?: string | undefined;
      readonly sessionId?: string | null | undefined;
      readonly action: string;
      readonly outcome: string;
    }
  ): Promise<void> {
    await tx.authenticationAuditEvent.createMany({
      data: {
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        sessionId: input.sessionId ?? null,
        action: input.action,
        outcome: input.outcome,
        requestId: context.requestId,
        ipAddress: context.auditOrigin.ipAddress,
        userAgent: context.auditOrigin.userAgent
      }
    });
  }
}

export class SessionIdentityAdapter implements IdentityAdapter {
  public readonly kind = "OIDC" as const;

  public constructor(private readonly sessions: SessionService) {}

  public authenticate(request: FastifyRequest): Promise<AuthenticatedIdentity> {
    return this.sessions.authenticate(readSessionToken(request), {
      requestId: request.id,
      auditOrigin: {
        ipAddress: request.ip.trim() || null,
        userAgent: requestHeader(request, "user-agent")?.trim() || null
      }
    });
  }
}

export function readSessionToken(request: FastifyRequest): string | undefined {
  const authorization = requestHeader(request, "authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || undefined;
  }

  const cookieHeader = requestHeader(request, "cookie");
  if (!cookieHeader) {
    return undefined;
  }
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === sessionCookieName) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return undefined;
}

export function sessionCookie(token: string, absoluteExpiresAt: Date): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Priority=High${secure}; Expires=${absoluteExpiresAt.toUTCString()}`;
}

export function expiredSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Priority=High${secure}; Max-Age=0`;
}
