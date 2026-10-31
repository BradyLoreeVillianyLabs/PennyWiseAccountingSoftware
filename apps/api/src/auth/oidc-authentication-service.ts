import {
  AuthenticationFlowPurpose,
  withRuntimeTransaction,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type { AuditOrigin, AuthenticatedIdentity } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import type { OidcProvider, VerifiedOidcIdentity } from "./oidc-provider.js";
import {
  createOpaqueToken,
  createPkceChallenge,
  hashOpaqueToken,
  normalizeEmail
} from "./security.js";
import { SessionService, type CreatedSession } from "./session-service.js";
import { environmentValueOrDefault } from "../environment.js";

const authorizationLifetimeMs = 10 * 60 * 1000;

interface AuthenticationRequestContext {
  readonly requestId: string;
  readonly auditOrigin: AuditOrigin;
}

export interface BeginAuthenticationInput {
  readonly purpose: "SIGN_IN" | "REAUTHENTICATE" | "RECOVERY";
  readonly returnTo?: string | undefined;
  readonly loginHint?: string | undefined;
  readonly identity?: AuthenticatedIdentity | undefined;
}

export interface CompleteAuthenticationResult {
  readonly returnTo: string;
  readonly purpose: "SIGN_IN" | "REAUTHENTICATE" | "RECOVERY";
  readonly session: CreatedSession;
}

export class OidcAuthenticationService {
  private readonly sessions: SessionService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: OidcProvider
  ) {
    this.sessions = new SessionService(prisma);
  }

  public async begin(input: BeginAuthenticationInput): Promise<string> {
    if (input.purpose === "REAUTHENTICATE" && !input.identity?.sessionId) {
      throw new AppError("SESSION_REQUIRED", "A production session is required.", 401);
    }
    const state = createOpaqueToken();
    const nonce = createOpaqueToken();
    const codeVerifier = createOpaqueToken(48);
    const returnTo = validateReturnTo(input.returnTo);
    const loginHint = input.loginHint ? normalizeEmail(input.loginHint) : input.identity?.email;

    await withRuntimeTransaction(this.prisma, input.identity?.id ?? null, async (tx) => {
      await tx.oidcAuthorizationRequest.create({
        data: {
          stateHash: hashOpaqueToken(state),
          issuer: this.provider.issuer,
          nonce,
          codeVerifier,
          purpose: input.purpose,
          returnTo,
          loginHint: loginHint ?? null,
          expectedUserId: input.identity?.id ?? null,
          expectedSessionId: input.identity?.sessionId ?? null,
          expiresAt: new Date(Date.now() + authorizationLifetimeMs)
        }
      });
    });

    return this.provider.authorizationUrl({
      state,
      nonce,
      codeChallenge: createPkceChallenge(codeVerifier),
      loginHint,
      prompt: input.purpose === "REAUTHENTICATE" ? "login" : undefined,
      recovery: input.purpose === "RECOVERY"
    });
  }

  public async complete(
    code: string,
    state: string,
    requestContext: AuthenticationRequestContext
  ): Promise<CompleteAuthenticationResult> {
    const claimed = await this.claimAuthorizationRequest(state, requestContext);
    let providerIdentity: VerifiedOidcIdentity;
    try {
      providerIdentity = await this.provider.exchangeCode(
        code,
        claimed.codeVerifier,
        claimed.nonce
      );
    } catch (error) {
      await this.writeFailureEvent(requestContext, claimed.purpose, "PROVIDER_REJECTED");
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("OIDC_AUTHENTICATION_FAILED", "Sign-in failed.", 401);
    }

    if (!providerIdentity.emailVerified) {
      await this.writeFailureEvent(requestContext, claimed.purpose, "EMAIL_UNVERIFIED");
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verified email ownership is required.",
        403
      );
    }

    const completion = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      const user = await this.linkIdentity(tx, providerIdentity);
      await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${user.id}, true)`;

      if (claimed.expectedUserId && claimed.expectedUserId !== user.id) {
        await this.writeEvent(tx, requestContext, {
          actorUserId: user.id,
          targetUserId: claimed.expectedUserId,
          action: "RECENT_AUTHENTICATION_CONFIRMATION",
          outcome: "IDENTITY_MISMATCH"
        });
        return { error: "IDENTITY_MISMATCH" as const };
      }

      if (claimed.purpose === "RECOVERY") {
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: "ACCOUNT_RECOVERY" }
        });
      }

      let session: CreatedSession;
      if (claimed.purpose === "REAUTHENTICATE") {
        const existing = await tx.session.findFirst({
          where: {
            id: claimed.expectedSessionId ?? "00000000-0000-0000-0000-000000000000",
            userId: user.id,
            revokedAt: null
          }
        });
        if (!existing || existing.absoluteExpiresAt <= new Date()) {
          return { error: "SESSION_INVALID" as const };
        }
        const token = createOpaqueToken();
        await tx.session.update({
          where: { id: existing.id },
          data: {
            tokenHash: hashOpaqueToken(token),
            recentAuthAt: providerIdentity.authenticatedAt,
            mfaAuthenticated: providerIdentity.mfaAuthenticated,
            lastSeenAt: new Date()
          }
        });
        session = { id: existing.id, token, absoluteExpiresAt: existing.absoluteExpiresAt };
      } else {
        session = await this.sessions.createSession(
          tx,
          user.id,
          providerIdentity.authenticatedAt,
          providerIdentity.mfaAuthenticated
        );
      }

      await this.writeEvent(tx, requestContext, {
        actorUserId: user.id,
        targetUserId: user.id,
        sessionId: session.id,
        action:
          claimed.purpose === "REAUTHENTICATE"
            ? "RECENT_AUTHENTICATION_CONFIRMED"
            : claimed.purpose === "RECOVERY"
              ? "ACCOUNT_RECOVERY_COMPLETED"
              : "LOGIN",
        outcome: "SUCCESS"
      });
      return { user, session };
    });

    if ("error" in completion) {
      throw new AppError(
        completion.error === "IDENTITY_MISMATCH"
          ? "REAUTHENTICATION_IDENTITY_MISMATCH"
          : "SESSION_INVALID",
        "Recent authentication could not be confirmed.",
        401
      );
    }

    return {
      returnTo: claimed.returnTo,
      purpose: claimed.purpose,
      session: completion.session
    };
  }

  private async claimAuthorizationRequest(state: string, context: AuthenticationRequestContext) {
    const result = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      const request = await tx.oidcAuthorizationRequest.findUnique({
        where: { stateHash: hashOpaqueToken(state) }
      });
      if (!request || request.issuer !== this.provider.issuer) {
        await this.writeEvent(tx, context, {
          action: "LOGIN",
          outcome: "INVALID_STATE"
        });
        return { error: "INVALID_STATE" as const };
      }
      if (request.consumedAt || request.expiresAt <= new Date()) {
        await this.writeEvent(tx, context, {
          action:
            request.purpose === "REAUTHENTICATE" ? "RECENT_AUTHENTICATION_CONFIRMATION" : "LOGIN",
          outcome: request.consumedAt ? "REUSED_STATE" : "EXPIRED_STATE"
        });
        return { error: "EXPIRED_STATE" as const };
      }
      const claimed = await tx.oidcAuthorizationRequest.updateMany({
        where: { id: request.id, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      if (claimed.count !== 1) {
        return { error: "EXPIRED_STATE" as const };
      }
      return { request };
    });

    if ("error" in result) {
      throw new AppError("OIDC_STATE_INVALID", "The sign-in request is invalid or expired.", 401);
    }
    return result.request;
  }

  private async linkIdentity(tx: RuntimeTransaction, identity: VerifiedOidcIdentity) {
    const email = normalizeEmail(identity.email);
    const existingIdentity = await tx.externalIdentity.findUnique({
      where: {
        providerIssuer_providerSubject: {
          providerIssuer: identity.issuer,
          providerSubject: identity.subject
        }
      },
      include: { user: true }
    });

    if (existingIdentity) {
      const user = await tx.user.update({
        where: { id: existingIdentity.userId },
        data: {
          email,
          displayName: identity.displayName ?? existingIdentity.user.displayName,
          emailVerifiedAt: new Date(),
          status: "ACTIVE"
        }
      });
      await tx.externalIdentity.update({
        where: { id: existingIdentity.id },
        data: { emailAtLink: email, lastAuthenticatedAt: new Date() }
      });
      return user;
    }

    const user = await tx.user.upsert({
      where: { email },
      create: {
        email,
        displayName: identity.displayName,
        emailVerifiedAt: new Date()
      },
      update: {
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        emailVerifiedAt: new Date(),
        status: "ACTIVE"
      }
    });
    await tx.externalIdentity.create({
      data: {
        userId: user.id,
        providerIssuer: identity.issuer,
        providerSubject: identity.subject,
        emailAtLink: email
      }
    });
    return user;
  }

  private async writeFailureEvent(
    context: AuthenticationRequestContext,
    purpose: AuthenticationFlowPurpose,
    outcome: string
  ): Promise<void> {
    await withRuntimeTransaction(this.prisma, null, (tx) =>
      this.writeEvent(tx, context, {
        action: purpose === "REAUTHENTICATE" ? "RECENT_AUTHENTICATION_CONFIRMATION" : "LOGIN",
        outcome
      })
    );
  }

  private async writeEvent(
    tx: RuntimeTransaction,
    context: AuthenticationRequestContext,
    input: {
      readonly actorUserId?: string | undefined;
      readonly targetUserId?: string | undefined;
      readonly sessionId?: string | undefined;
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

function validateReturnTo(returnTo: string | undefined): string {
  const appBaseUrl = new URL(
    environmentValueOrDefault(process.env.APP_BASE_URL, "http://localhost:3000")
  );
  if (!returnTo) {
    return appBaseUrl.toString();
  }
  const candidate = new URL(returnTo, appBaseUrl);
  if (candidate.origin !== appBaseUrl.origin) {
    throw new AppError("RETURN_URL_INVALID", "The return URL is not allowed.", 400);
  }
  return candidate.toString();
}
