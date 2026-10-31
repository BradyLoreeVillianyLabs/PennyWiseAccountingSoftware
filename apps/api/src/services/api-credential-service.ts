import { withRuntimeTransaction, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { AuditOrigin, AuthenticatedIdentity, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import type { FastifyRequest } from "fastify";
import { AuthorizationService, hasPermission } from "../auth/permissions.js";
import { requestHeader } from "../auth/identity-adapter.js";
import { createOpaqueToken, hashOpaqueToken } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";

const apiCredentialPrefix = "cl_live_";
const defaultLifetimeMs = 90 * 24 * 60 * 60 * 1000;
const maximumLifetimeMs = 365 * 24 * 60 * 60 * 1000;
const blockedScopes = new Set([
  "integrations:read",
  "integrations:manage",
  "webhooks:manage",
  "organizations:switch",
  "organizations:close",
  "journals:post",
  "journals:reverse",
  "manual-journals:post",
  "periods:close",
  "periods:reopen",
  "payments:configure",
  "payments:connect",
  "payments:disconnect",
  "payments:record",
  "payments:allocate",
  "payments:refund",
  "payments:refund-approve",
  "bills:post",
  "bills:pay",
  "bank-reconciliations:reopen",
  "data-imports:financial",
  "data-imports:approve",
  "organization-exports:create",
  "organization-exports:download"
]);

export interface ApiCredentialInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: Date | undefined;
}

export class ApiCredentialService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "integrations:read", "ApiCredential");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const credentials = await tx.apiCredential.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: "desc" }
      });
      return credentials.map(credentialDto);
    });
  }

  public async create(
    context: OrganizationContext,
    input: ApiCredentialInput,
    idempotencyKey: string
  ) {
    await this.authorization.assert(context, "integrations:manage", "ApiCredential");
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey) {
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    }
    const name = input.name.trim();
    if (!name || name.length > 120) {
      throw new AppError("API_CREDENTIAL_NAME_INVALID", "Credential name is invalid.", 422);
    }
    const scopes = normalizeScopes(input.scopes);
    const expiresAt = normalizeExpiry(input.expiresAt);
    const creationKeyHash = hashOpaqueToken(normalizedKey);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const replay = await tx.apiCredential.findUnique({
        where: {
          organizationId_creationKeyHash: {
            organizationId: context.organizationId,
            creationKeyHash
          }
        }
      });
      if (replay) {
        return {
          statusCode: 200,
          body: { credential: credentialDto(replay), secret: null, replayed: true },
          resourceId: replay.id
        };
      }

      const secret = apiCredentialPrefix + createOpaqueToken(32);
      const credential = await tx.apiCredential.create({
        data: {
          organizationId: context.organizationId,
          createdByUserId: context.user.id,
          name,
          keyPrefix: secret.slice(0, 20),
          secretHash: hashOpaqueToken(secret),
          creationKeyHash,
          scopes,
          expiresAt
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "api.credential.created",
          aggregateType: "ApiCredential",
          aggregateId: credential.id,
          payload: { credentialId: credential.id, scopes }
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "API_CREDENTIAL_CREATED",
          targetType: "ApiCredential",
          targetId: credential.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { name, scopes, expiresAt: expiresAt.toISOString() })
        }
      });
      return {
        statusCode: 201,
        body: { credential: credentialDto(credential), secret, replayed: false },
        resourceId: credential.id
      };
    });
  }

  public async revoke(context: OrganizationContext, credentialId: string) {
    await this.authorization.assert(context, "integrations:manage", "ApiCredential", credentialId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.apiCredential.updateMany({
        where: { id: credentialId, organizationId: context.organizationId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() }
      });
      if (result.count !== 1) {
        throw new AppError("API_CREDENTIAL_NOT_FOUND", "Credential was not found.", 404);
      }
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "API_CREDENTIAL_REVOKED",
          targetType: "ApiCredential",
          targetId: credentialId,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {})
        }
      });
      return { revoked: true, credentialId };
    });
  }

  public async rotate(context: OrganizationContext, credentialId: string, idempotencyKey: string) {
    await this.authorization.assert(context, "integrations:manage", "ApiCredential", credentialId);
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey) {
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    }
    const creationKeyHash = hashOpaqueToken(normalizedKey);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const replay = await tx.apiCredential.findUnique({
        where: {
          organizationId_creationKeyHash: {
            organizationId: context.organizationId,
            creationKeyHash
          }
        }
      });
      if (replay) {
        return {
          statusCode: 200,
          body: { credential: credentialDto(replay), secret: null, replayed: true },
          resourceId: replay.id
        };
      }
      const current = await tx.apiCredential.findFirst({
        where: { id: credentialId, organizationId: context.organizationId, status: "ACTIVE" }
      });
      if (!current) {
        throw new AppError("API_CREDENTIAL_NOT_FOUND", "Credential was not found.", 404);
      }
      const secret = apiCredentialPrefix + createOpaqueToken(32);
      const now = new Date();
      await tx.apiCredential.update({
        where: { id: current.id },
        data: { status: "REVOKED", revokedAt: now }
      });
      const replacement = await tx.apiCredential.create({
        data: {
          organizationId: context.organizationId,
          createdByUserId: context.user.id,
          name: current.name,
          keyPrefix: secret.slice(0, 20),
          secretHash: hashOpaqueToken(secret),
          creationKeyHash,
          scopes: current.scopes,
          expiresAt: current.expiresAt
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "api.credential.rotated",
          aggregateType: "ApiCredential",
          aggregateId: replacement.id,
          payload: { credentialId: replacement.id, replacedCredentialId: current.id }
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "API_CREDENTIAL_ROTATED",
          targetType: "ApiCredential",
          targetId: replacement.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { replacedCredentialId: current.id })
        }
      });
      return {
        statusCode: 201,
        body: { credential: credentialDto(replacement), secret, replayed: false },
        resourceId: replacement.id
      };
    });
  }

  public async authenticate(
    token: string,
    requestContext?: { readonly requestId: string; readonly auditOrigin: AuditOrigin }
  ): Promise<AuthenticatedIdentity> {
    if (!token.startsWith(apiCredentialPrefix)) {
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    }
    const secretHash = hashOpaqueToken(token);
    const candidate = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.access_mode', 'api_credential', true)`;
      await tx.$executeRaw`SELECT set_config('app.api_credential_secret_hash', ${secretHash}, true)`;
      return tx.apiCredential.findUnique({ where: { secretHash } });
    });
    const now = new Date();
    if (
      !candidate ||
      candidate.status !== "ACTIVE" ||
      (candidate.expiresAt && candidate.expiresAt <= now)
    ) {
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    }

    const identity = await withTenantTransaction(
      this.prisma,
      { organizationId: candidate.organizationId, actorUserId: candidate.createdByUserId },
      async (tx) => {
        const [credential, user, membership] = await Promise.all([
          tx.apiCredential.findUnique({ where: { id: candidate.id } }),
          tx.user.findUnique({ where: { id: candidate.createdByUserId } }),
          tx.membership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: candidate.organizationId,
                userId: candidate.createdByUserId
              }
            }
          })
        ]);
        if (
          !credential ||
          credential.status !== "ACTIVE" ||
          (credential.expiresAt && credential.expiresAt <= now) ||
          !user ||
          user.status !== "ACTIVE" ||
          !user.emailVerifiedAt ||
          !membership ||
          membership.status !== "ACTIVE"
        ) {
          return null;
        }
        await tx.apiCredential.update({ where: { id: credential.id }, data: { lastUsedAt: now } });
        if (requestContext) {
          await tx.authenticationAuditEvent.create({
            data: {
              organizationId: candidate.organizationId,
              actorUserId: user.id,
              targetUserId: user.id,
              action: "API_CREDENTIAL_AUTHENTICATION",
              outcome: "SUCCESS",
              requestId: requestContext.requestId,
              ipAddress: requestContext.auditOrigin.ipAddress,
              userAgent: requestContext.auditOrigin.userAgent,
              metadata: { credentialId: credential.id }
            }
          });
        }
        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          emailVerifiedAt: user.emailVerifiedAt,
          sessionId: null,
          activeOrganizationId: candidate.organizationId,
          recentAuthAt: new Date(0),
          mfaAuthenticated: false,
          authenticationMethod: "API_KEY" as const,
          apiCredentialId: credential.id,
          apiCredentialScopes: credential.scopes
        };
      }
    );
    if (!identity) {
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    }
    return identity;
  }
}

export function isApiCredentialToken(request: FastifyRequest): boolean {
  return readApiCredentialToken(request) !== undefined;
}

export function readApiCredentialToken(request: FastifyRequest): string | undefined {
  const authorization = requestHeader(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token.startsWith(apiCredentialPrefix) ? token : undefined;
}

function normalizeScopes(values: readonly string[]): string[] {
  const scopes = [...new Set(["organizations:access", ...values.map((value) => value.trim())])];
  if (scopes.length > 20) {
    throw new AppError("API_SCOPES_INVALID", "Too many credential scopes were requested.", 422);
  }
  for (const scope of scopes) {
    if (!scope || !hasPermission("OWNER", scope) || blockedScopes.has(scope)) {
      throw new AppError("API_SCOPES_INVALID", `Unsupported credential scope: ${scope}.`, 422);
    }
  }
  return scopes;
}

function normalizeExpiry(value: Date | undefined): Date {
  const expiresAt = value ?? new Date(Date.now() + defaultLifetimeMs);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new AppError("API_EXPIRY_INVALID", "Credential expiry must be in the future.", 422);
  }
  if (expiresAt.getTime() > Date.now() + maximumLifetimeMs) {
    throw new AppError("API_EXPIRY_INVALID", "Credential expiry cannot exceed one year.", 422);
  }
  return expiresAt;
}

function credentialDto(credential: {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: credential.id,
    name: credential.name,
    keyPrefix: credential.keyPrefix,
    scopes: credential.scopes,
    status:
      credential.status === "ACTIVE" && credential.expiresAt && credential.expiresAt <= new Date()
        ? "EXPIRED"
        : credential.status,
    expiresAt: credential.expiresAt?.toISOString() ?? null,
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    createdAt: credential.createdAt.toISOString()
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
