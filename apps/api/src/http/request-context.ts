import { withRuntimeTransaction, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { AuditOrigin, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import type { FastifyRequest } from "fastify";
import type { IdentityAdapter } from "../auth/identity-adapter.js";
import { AuthorizationService } from "../auth/permissions.js";

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function auditOriginFromRequest(request: FastifyRequest): AuditOrigin {
  const userAgent = headerValue(request, "user-agent")?.trim() || null;
  const ipAddress = request.ip.trim() || null;

  return {
    ipAddress,
    userAgent
  };
}

export async function requireIdentity(request: FastifyRequest, identityAdapter: IdentityAdapter) {
  const identity = await identityAdapter.authenticate(request);
  if (!identity.emailVerifiedAt) {
    throw new AppError("EMAIL_VERIFICATION_REQUIRED", "Verified email ownership is required.", 403);
  }
  return identity;
}

export async function requireOrganizationContext(
  request: FastifyRequest,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter
): Promise<OrganizationContext> {
  const user = await requireIdentity(request, identityAdapter);
  const organizationId = user.activeOrganizationId;

  if (!organizationId) {
    throw new AppError(
      "ORGANIZATION_CONTEXT_REQUIRED",
      "Select an organization before performing this action.",
      409
    );
  }

  const delegatedScopes = user.apiCredentialScopes ?? user.oauthScopes;
  if (delegatedScopes && !delegatedScopes.includes("organizations:access")) {
    throw new AppError(
      "API_SCOPE_REQUIRED",
      "The API credential does not include organization access.",
      403
    );
  }

  const membership = await withTenantTransaction(
    prisma,
    { organizationId, actorUserId: user.id },
    (tx) =>
      tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: user.id
          }
        }
      })
  );

  if (!membership || membership.status !== "ACTIVE") {
    if (user.sessionId) {
      await withRuntimeTransaction(prisma, user.id, (tx) =>
        tx.session.updateMany({
          where: { id: user.sessionId!, userId: user.id },
          data: { activeOrganizationId: null }
        })
      );
    }

    throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
  }

  // Organization membership remains the tenant gate. A company membership is
  // the narrower legal-entity gate and is resolved only after the tenant is
  // authenticated, so a caller can never select a company from another
  // organization by sending an identifier in a header or session.
  const companyMemberships = await withTenantTransaction(
    prisma,
    { organizationId, actorUserId: user.id },
    (tx) =>
      tx.companyMembership.findMany({
        where: { organizationId, userId: user.id, status: "ACTIVE" },
        include: { company: true },
        orderBy: { createdAt: "asc" }
      })
  );
  const requestedCompanyId = user.activeCompanyId?.trim() || null;
  const selectedCompanyMembership = requestedCompanyId
    ? companyMemberships.find(
        (candidate) =>
          candidate.companyId === requestedCompanyId && candidate.company.status === "ACTIVE"
      )
    : (companyMemberships.find(
        (candidate) => candidate.company.isDefault && candidate.company.status === "ACTIVE"
      ) ?? companyMemberships.find((candidate) => candidate.company.status === "ACTIVE"));

  if (requestedCompanyId && !selectedCompanyMembership) {
    throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
  }

  if (
    user.sessionId &&
    selectedCompanyMembership &&
    selectedCompanyMembership.companyId !== user.activeCompanyId
  ) {
    await withRuntimeTransaction(prisma, user.id, (tx) =>
      tx.session.updateMany({
        where: { id: user.sessionId!, userId: user.id, revokedAt: null },
        data: { activeCompanyId: selectedCompanyMembership.companyId }
      })
    );
  }

  const context: OrganizationContext = {
    requestId: request.id,
    user,
    organizationId,
    membershipId: membership.id,
    role: selectedCompanyMembership?.role ?? membership.role,
    ...(selectedCompanyMembership
      ? {
          companyId: selectedCompanyMembership.companyId,
          companyMembershipId: selectedCompanyMembership.id
        }
      : {}),
    sessionId: user.sessionId,
    recentAuthAt: user.recentAuthAt,
    mfaAuthenticated: user.mfaAuthenticated,
    authenticationMethod: user.authenticationMethod,
    ...(user.apiCredentialId !== undefined ? { apiCredentialId: user.apiCredentialId } : {}),
    ...(user.apiCredentialScopes !== undefined
      ? { apiCredentialScopes: user.apiCredentialScopes }
      : {}),
    ...(user.oauthAccessTokenId !== undefined
      ? { oauthAccessTokenId: user.oauthAccessTokenId }
      : {}),
    ...(user.oauthScopes !== undefined ? { oauthScopes: user.oauthScopes } : {}),
    auditOrigin: auditOriginFromRequest(request)
  };
  await new AuthorizationService(prisma).assertIdentityAssurance(context);
  return context;
}
