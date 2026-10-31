import { withRuntimeTransaction, type PrismaClient } from "@clearledger/db";
import type { AuthenticatedIdentity } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import type { FastifyRequest } from "fastify";
import type { IdentityAdapter } from "./identity-adapter.js";
import { requestHeader } from "./identity-adapter.js";
import { normalizeEmail } from "./security.js";

export class DevelopmentIdentityAdapter implements IdentityAdapter {
  public readonly kind = "DEVELOPMENT" as const;

  public constructor(private readonly prisma: PrismaClient) {}

  public async authenticate(request: FastifyRequest): Promise<AuthenticatedIdentity> {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(
        "AUTH_ADAPTER_UNAVAILABLE",
        "The development identity adapter is disabled in production.",
        500
      );
    }

    const emailHeader = requestHeader(request, "x-clearledger-user-email");
    const email = emailHeader ? normalizeEmail(emailHeader) : undefined;
    const displayName = requestHeader(request, "x-clearledger-user-name")?.trim() ?? null;

    if (!email) {
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    }

    const verified = requestHeader(request, "x-clearledger-email-verified") !== "false";
    const emailVerifiedAt = verified ? new Date() : null;
    // The database also enforces a normalized-email expression index. A
    // targeted Prisma upsert can race on that index before its email conflict
    // target is considered when two local requests authenticate together.
    // A target-free skip followed by the ordinary unique update handles every
    // database uniqueness guard without weakening normalized-email identity.
    const user = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      await tx.user.createMany({
        data: [{ email, displayName, emailVerifiedAt }],
        skipDuplicates: true
      });
      return tx.user.update({
        where: { email },
        data: { displayName, emailVerifiedAt }
      });
    });

    const recentAuthHeader = requestHeader(request, "x-clearledger-recent-auth-at");
    const recentAuthAt = recentAuthHeader ? new Date(recentAuthHeader) : new Date();

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerifiedAt: user.emailVerifiedAt,
      sessionId: null,
      activeOrganizationId: requestHeader(request, "x-clearledger-organization-id")?.trim() ?? null,
      activeCompanyId: requestHeader(request, "x-clearledger-company-id")?.trim() ?? null,
      recentAuthAt: Number.isNaN(recentAuthAt.getTime()) ? new Date(0) : recentAuthAt,
      mfaAuthenticated: requestHeader(request, "x-clearledger-mfa-authenticated") !== "false",
      authenticationMethod: "DEVELOPMENT"
    };
  }
}
