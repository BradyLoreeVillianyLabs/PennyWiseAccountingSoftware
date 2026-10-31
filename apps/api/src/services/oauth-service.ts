import { randomUUID } from "node:crypto";
import {
  Prisma,
  withRuntimeTransaction,
  withTenantTransaction,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type { AuditOrigin, AuthenticatedIdentity, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService, hasPermission } from "../auth/permissions.js";
import { createOpaqueToken, createPkceChallenge, hashOpaqueToken } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";
import { hashJson } from "../utils/json.js";

const accessTokenPrefix = "cl_oat_";
const refreshTokenPrefix = "cl_ort_";
const clientIdPrefix = "cl_app_";
const clientSecretPrefix = "cl_app_secret_";
const authorizationCodeLifetimeMs = 5 * 60_000;
const accessTokenLifetimeMs = 60 * 60_000;
const refreshTokenLifetimeMs = 30 * 24 * 60 * 60_000;
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

export interface OAuthClientInput {
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
}

export interface OAuthAuthorizationInput {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly state?: string | undefined;
  readonly consent: boolean;
}

export interface OAuthTokenInput {
  readonly grantType: "authorization_code" | "refresh_token";
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code?: string | undefined;
  readonly redirectUri?: string | undefined;
  readonly codeVerifier?: string | undefined;
  readonly refreshToken?: string | undefined;
}

export class OAuthService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listClients(context: OrganizationContext) {
    await this.authorization.assert(context, "integrations:read", "OAuthClient");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      (
        await tx.oAuthClient.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { createdAt: "desc" }
        })
      ).map(clientDto)
    );
  }

  public async createClient(
    context: OrganizationContext,
    input: OAuthClientInput,
    idempotencyKey: string
  ) {
    await this.authorization.assert(context, "integrations:manage", "OAuthClient");
    const key = idempotencyKey.trim();
    if (!key)
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    const name = input.name.trim();
    if (!name || name.length > 120)
      throw new AppError("OAUTH_CLIENT_NAME_INVALID", "OAuth client name is invalid.", 422);
    const redirectUris = normalizeRedirectUris(input.redirectUris);
    const allowedScopes = normalizeScopes(input.allowedScopes);
    const creationKeyHash = hashOpaqueToken(key);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const replay = await tx.oAuthClient.findUnique({
        where: {
          organizationId_creationKeyHash: {
            organizationId: context.organizationId,
            creationKeyHash
          }
        }
      });
      if (replay)
        return {
          statusCode: 200,
          body: { client: clientDto(replay), clientSecret: null, replayed: true }
        };
      const clientSecret = clientSecretPrefix + createOpaqueToken(32);
      const client = await tx.oAuthClient.create({
        data: {
          organizationId: context.organizationId,
          createdByUserId: context.user.id,
          name,
          clientId: clientIdPrefix + createOpaqueToken(18),
          clientSecretHash: hashOpaqueToken(clientSecret),
          creationKeyHash,
          redirectUris,
          allowedScopes
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "oauth.client.created",
          aggregateType: "OAuthClient",
          aggregateId: client.id,
          payload: { clientId: client.clientId, allowedScopes }
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "OAUTH_CLIENT_CREATED",
          targetType: "OAuthClient",
          targetId: client.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { name, redirectUris, allowedScopes })
        }
      });
      return {
        statusCode: 201,
        body: { client: clientDto(client), clientSecret, replayed: false }
      };
    });
  }

  public async revokeClient(context: OrganizationContext, clientId: string) {
    await this.authorization.assert(context, "integrations:manage", "OAuthClient", clientId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const client = await tx.oAuthClient.findFirst({
        where: { id: clientId, organizationId: context.organizationId, status: "ACTIVE" }
      });
      if (!client) throw new AppError("OAUTH_CLIENT_NOT_FOUND", "OAuth client was not found.", 404);
      const now = new Date();
      await tx.oAuthClient.update({
        where: { id: client.id },
        data: { status: "REVOKED", revokedAt: now }
      });
      await tx.oAuthAccessToken.updateMany({
        where: { organizationId: context.organizationId, clientId: client.id, revokedAt: null },
        data: { revokedAt: now }
      });
      await tx.oAuthRefreshToken.updateMany({
        where: { organizationId: context.organizationId, clientId: client.id, revokedAt: null },
        data: { revokedAt: now }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "OAUTH_CLIENT_REVOKED",
          targetType: "OAuthClient",
          targetId: client.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { clientId: client.clientId })
        }
      });
      return { revoked: true, clientId: client.id };
    });
  }

  public async rotateClient(
    context: OrganizationContext,
    clientId: string,
    idempotencyKey: string
  ) {
    await this.authorization.assert(context, "integrations:manage", "OAuthClient", clientId);
    const key = idempotencyKey.trim();
    if (!key)
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    const requestHash = hashJson({ clientId });
    const replay = await this.readRotationReplay(context, key, requestHash);
    if (replay) return replay;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await withTenantTransaction(
          this.prisma,
          dbContext(context),
          async (tx) => {
            const idempotency = await tx.idempotencyRecord.create({
              data: {
                organizationId: context.organizationId,
                operation: "oauth-client-secret-rotate",
                key,
                requestHash
              }
            });
            const client = await tx.oAuthClient.findFirst({
              where: { id: clientId, organizationId: context.organizationId, status: "ACTIVE" }
            });
            if (!client)
              throw new AppError("OAUTH_CLIENT_NOT_FOUND", "OAuth client was not found.", 404);
            const clientSecret = clientSecretPrefix + createOpaqueToken(32);
            const rotated = await tx.oAuthClient.update({
              where: { id: client.id },
              data: { clientSecretHash: hashOpaqueToken(clientSecret) }
            });
            await tx.outboxEvent.create({
              data: {
                organizationId: context.organizationId,
                eventType: "oauth.client.secret_rotated",
                aggregateType: "OAuthClient",
                aggregateId: client.id,
                payload: { clientId: client.clientId }
              }
            });
            await tx.auditEvent.create({
              data: {
                organizationId: context.organizationId,
                actorUserId: context.user.id,
                action: "OAUTH_CLIENT_SECRET_ROTATED",
                targetType: "OAuthClient",
                targetId: client.id,
                requestId: context.requestId,
                metadata: withAuditOrigin(context, { clientId: client.clientId })
              }
            });
            await tx.idempotencyRecord.update({
              where: { id: idempotency.id },
              data: {
                responseStatus: 201,
                responseBody: { clientId: client.id },
                resourceId: client.id
              }
            });
            return {
              statusCode: 201,
              body: { client: clientDto(rotated), clientSecret, replayed: false }
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error) {
        if (!isIdempotencyConflict(error) || attempt === 2) throw error;
        const retry = await this.readRotationReplay(context, key, requestHash);
        if (retry) return retry;
      }
    }
    throw new AppError(
      "IDEMPOTENCY_RETRY_EXHAUSTED",
      "The OAuth client secret rotation could not be committed safely.",
      409
    );
  }

  public async authorize(context: OrganizationContext, input: OAuthAuthorizationInput) {
    await this.authorization.assert(context, "integrations:manage", "OAuthAuthorization");
    if (!input.consent)
      throw new AppError("OAUTH_CONSENT_REQUIRED", "Organization consent is required.", 422);
    const requestedScopes = normalizeScopes(input.scopes);
    if (!isPkceVerifier(input.codeChallenge))
      throw new AppError("OAUTH_PKCE_INVALID", "PKCE S256 code challenge is invalid.", 422);
    const state = input.state?.trim();
    if (state && state.length > 512)
      throw new AppError("OAUTH_STATE_INVALID", "OAuth state is invalid.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const client = await tx.oAuthClient.findFirst({
        where: {
          organizationId: context.organizationId,
          clientId: input.clientId,
          status: "ACTIVE"
        }
      });
      if (!client) throw new AppError("OAUTH_CLIENT_NOT_FOUND", "OAuth client was not found.", 404);
      const redirectUri = validateRegisteredRedirectUri(input.redirectUri, client.redirectUris);
      if (requestedScopes.some((scope) => !client.allowedScopes.includes(scope)))
        throw new AppError("OAUTH_SCOPE_INVALID", "Requested OAuth scope was not approved.", 403);
      const code = createOpaqueToken(32);
      const authorizationCode = await tx.oAuthAuthorizationCode.create({
        data: {
          organizationId: context.organizationId,
          clientId: client.id,
          userId: context.user.id,
          codeHash: hashOpaqueToken(code),
          redirectUri,
          scopes: requestedScopes,
          codeChallenge: input.codeChallenge,
          expiresAt: new Date(Date.now() + authorizationCodeLifetimeMs)
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "OAUTH_ORGANIZATION_CONSENT_GRANTED",
          targetType: "OAuthClient",
          targetId: client.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { clientId: client.clientId, scopes: requestedScopes })
        }
      });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      if (state) callback.searchParams.set("state", state);
      return { authorizationCodeId: authorizationCode.id, redirectUri: callback.toString() };
    });
  }

  public async issueToken(
    input: OAuthTokenInput,
    requestContext: { requestId: string; auditOrigin: AuditOrigin }
  ) {
    const client = await this.authenticateClient(input.clientId, input.clientSecret);
    if (input.grantType === "authorization_code")
      return this.exchangeAuthorizationCode(client, input, requestContext);
    return this.exchangeRefreshToken(client, input, requestContext);
  }

  public async authenticateAccessToken(
    token: string,
    requestContext?: { readonly requestId: string; readonly auditOrigin: AuditOrigin }
  ): Promise<AuthenticatedIdentity> {
    if (!token.startsWith(accessTokenPrefix))
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    const tokenHash = hashOpaqueToken(token);
    const candidate = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.access_mode', 'oauth_access_token', true)`;
      await tx.$executeRaw`SELECT set_config('app.oauth_access_token_hash', ${tokenHash}, true)`;
      return tx.oAuthAccessToken.findUnique({ where: { tokenHash } });
    });
    const now = new Date();
    if (!candidate || candidate.revokedAt || candidate.expiresAt <= now)
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    const identity = await withTenantTransaction(
      this.prisma,
      { organizationId: candidate.organizationId, actorUserId: candidate.userId },
      async (tx) => {
        const [tokenRecord, client, user, membership] = await Promise.all([
          tx.oAuthAccessToken.findUnique({ where: { id: candidate.id } }),
          tx.oAuthClient.findUnique({ where: { id: candidate.clientId } }),
          tx.user.findUnique({ where: { id: candidate.userId } }),
          tx.membership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: candidate.organizationId,
                userId: candidate.userId
              }
            }
          })
        ]);
        if (
          !tokenRecord ||
          tokenRecord.revokedAt ||
          tokenRecord.expiresAt <= now ||
          !client ||
          client.status !== "ACTIVE" ||
          !user ||
          user.status !== "ACTIVE" ||
          !user.emailVerifiedAt ||
          !membership ||
          membership.status !== "ACTIVE"
        )
          return null;
        await tx.oAuthAccessToken.update({
          where: { id: tokenRecord.id },
          data: { lastUsedAt: now }
        });
        if (requestContext) {
          await tx.authenticationAuditEvent.create({
            data: {
              organizationId: candidate.organizationId,
              actorUserId: user.id,
              targetUserId: user.id,
              action: "OAUTH_ACCESS_TOKEN_AUTHENTICATION",
              outcome: "SUCCESS",
              requestId: requestContext.requestId,
              ipAddress: requestContext.auditOrigin.ipAddress,
              userAgent: requestContext.auditOrigin.userAgent,
              metadata: { clientId: client.clientId, accessTokenId: tokenRecord.id }
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
          authenticationMethod: "OAUTH" as const,
          oauthAccessTokenId: tokenRecord.id,
          oauthScopes: tokenRecord.scopes
        };
      }
    );
    if (!identity)
      throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    return identity;
  }

  private async authenticateClient(clientId: string, clientSecret: string) {
    if (!clientId.startsWith(clientIdPrefix) || !clientSecret.startsWith(clientSecretPrefix))
      throw new AppError(
        "OAUTH_CLIENT_AUTHENTICATION_FAILED",
        "OAuth client authentication failed.",
        401
      );
    const secretHash = hashOpaqueToken(clientSecret);
    const client = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.access_mode', 'oauth_client', true)`;
      await tx.$executeRaw`SELECT set_config('app.oauth_client_id', ${clientId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.oauth_client_secret_hash', ${secretHash}, true)`;
      return tx.oAuthClient.findFirst({ where: { clientId, clientSecretHash: secretHash } });
    });
    if (!client || client.status !== "ACTIVE")
      throw new AppError(
        "OAUTH_CLIENT_AUTHENTICATION_FAILED",
        "OAuth client authentication failed.",
        401
      );
    return client;
  }

  private async readRotationReplay(context: OrganizationContext, key: string, requestHash: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const record = await tx.idempotencyRecord.findUnique({
        where: {
          organizationId_operation_key: {
            organizationId: context.organizationId,
            operation: "oauth-client-secret-rotate",
            key
          }
        }
      });
      if (!record) return undefined;
      if (record.requestHash !== requestHash)
        throw new AppError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency-Key was already used for a different request.",
          409
        );
      if (!record.resourceId || record.responseStatus === null)
        throw new AppError(
          "IDEMPOTENCY_IN_PROGRESS",
          "The original request is still in progress.",
          409
        );
      const client = await tx.oAuthClient.findFirst({
        where: { id: record.resourceId, organizationId: context.organizationId }
      });
      if (!client) throw new AppError("OAUTH_CLIENT_NOT_FOUND", "OAuth client was not found.", 404);
      return {
        statusCode: 200,
        body: { client: clientDto(client), clientSecret: null, replayed: true }
      };
    });
  }

  private async exchangeAuthorizationCode(
    client: { id: string; organizationId: string },
    input: OAuthTokenInput,
    requestContext: { requestId: string; auditOrigin: AuditOrigin }
  ) {
    if (!input.code || !input.codeVerifier || !input.redirectUri)
      throw new AppError(
        "OAUTH_TOKEN_REQUEST_INVALID",
        "OAuth authorization-code request is invalid.",
        400
      );
    const codeHash = hashOpaqueToken(input.code);
    const code = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.access_mode', 'oauth_code', true)`;
      await tx.$executeRaw`SELECT set_config('app.oauth_authorization_code_hash', ${codeHash}, true)`;
      return tx.oAuthAuthorizationCode.findUnique({ where: { codeHash } });
    });
    if (!code || code.clientId !== client.id || code.organizationId !== client.organizationId)
      throw new AppError("OAUTH_CODE_INVALID", "OAuth authorization code is invalid.", 401);
    if (
      code.expiresAt <= new Date() ||
      code.consumedAt ||
      createPkceChallenge(input.codeVerifier) !== code.codeChallenge
    )
      throw new AppError("OAUTH_CODE_INVALID", "OAuth authorization code is invalid.", 401);
    if (input.redirectUri !== code.redirectUri)
      throw new AppError("OAUTH_REDIRECT_URI_INVALID", "OAuth redirect URI is invalid.", 401);
    return this.issueTokenPair(client, code.userId, code.scopes, requestContext, async (tx) => {
      const claimed = await tx.oAuthAuthorizationCode.updateMany({
        where: { id: code.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
      });
      if (claimed.count !== 1)
        throw new AppError("OAUTH_CODE_INVALID", "OAuth authorization code is invalid.", 401);
    });
  }

  private async exchangeRefreshToken(
    client: { id: string; organizationId: string },
    input: OAuthTokenInput,
    requestContext: { requestId: string; auditOrigin: AuditOrigin }
  ) {
    if (!input.refreshToken?.startsWith(refreshTokenPrefix))
      throw new AppError(
        "OAUTH_TOKEN_REQUEST_INVALID",
        "OAuth refresh-token request is invalid.",
        400
      );
    const tokenHash = hashOpaqueToken(input.refreshToken);
    const refresh = await withRuntimeTransaction(this.prisma, null, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.access_mode', 'oauth_refresh_token', true)`;
      await tx.$executeRaw`SELECT set_config('app.oauth_refresh_token_hash', ${tokenHash}, true)`;
      return tx.oAuthRefreshToken.findUnique({ where: { tokenHash } });
    });
    if (
      !refresh ||
      refresh.clientId !== client.id ||
      refresh.organizationId !== client.organizationId
    )
      throw new AppError("OAUTH_REFRESH_TOKEN_INVALID", "OAuth refresh token is invalid.", 401);
    if (refresh.expiresAt <= new Date() || refresh.revokedAt || refresh.replacedAt)
      throw new AppError("OAUTH_REFRESH_TOKEN_INVALID", "OAuth refresh token is invalid.", 401);
    return this.issueTokenPair(
      client,
      refresh.userId,
      refresh.scopes,
      requestContext,
      async (tx) => {
        const rotated = await tx.oAuthRefreshToken.updateMany({
          where: {
            id: refresh.id,
            revokedAt: null,
            replacedAt: null,
            expiresAt: { gt: new Date() }
          },
          data: { replacedAt: new Date() }
        });
        if (rotated.count !== 1)
          throw new AppError("OAUTH_REFRESH_TOKEN_INVALID", "OAuth refresh token is invalid.", 401);
      },
      refresh.familyId
    );
  }

  private async issueTokenPair(
    client: { id: string; organizationId: string },
    userId: string,
    scopes: string[],
    requestContext: { requestId: string; auditOrigin: AuditOrigin },
    claim: (tx: RuntimeTransaction) => Promise<void>,
    familyId: string = randomUUID()
  ) {
    const accessToken = accessTokenPrefix + createOpaqueToken(32);
    const refreshToken = refreshTokenPrefix + createOpaqueToken(32);
    const now = new Date();
    return withTenantTransaction(
      this.prisma,
      { organizationId: client.organizationId, actorUserId: userId },
      async (tx) => {
        await claim(tx);
        const [access, refresh] = await Promise.all([
          tx.oAuthAccessToken.create({
            data: {
              organizationId: client.organizationId,
              clientId: client.id,
              userId,
              tokenHash: hashOpaqueToken(accessToken),
              scopes,
              expiresAt: new Date(now.getTime() + accessTokenLifetimeMs)
            }
          }),
          tx.oAuthRefreshToken.create({
            data: {
              organizationId: client.organizationId,
              clientId: client.id,
              userId,
              tokenHash: hashOpaqueToken(refreshToken),
              familyId,
              scopes,
              expiresAt: new Date(now.getTime() + refreshTokenLifetimeMs)
            }
          })
        ]);
        await tx.auditEvent.create({
          data: {
            organizationId: client.organizationId,
            actorUserId: userId,
            action: "OAUTH_TOKEN_ISSUED",
            targetType: "OAuthClient",
            targetId: client.id,
            requestId: requestContext.requestId,
            metadata: {
              ipAddress: requestContext.auditOrigin.ipAddress,
              userAgent: requestContext.auditOrigin.userAgent,
              scopes,
              accessTokenId: access.id,
              refreshTokenId: refresh.id
            }
          }
        });
        return {
          access_token: accessToken,
          token_type: "Bearer" as const,
          expires_in: Math.floor(accessTokenLifetimeMs / 1000),
          refresh_token: refreshToken,
          scope: scopes.join(" ")
        };
      }
    );
  }
}

export function readOAuthAccessToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token.startsWith(accessTokenPrefix) ? token : undefined;
}

function normalizeScopes(values: readonly string[]): string[] {
  const scopes = [...new Set(["organizations:access", ...values.map((value) => value.trim())])];
  if (
    scopes.length > 20 ||
    scopes.some((scope) => !scope || !hasPermission("OWNER", scope) || blockedScopes.has(scope))
  )
    throw new AppError("OAUTH_SCOPE_INVALID", "OAuth scopes are invalid.", 422);
  return scopes;
}

function normalizeRedirectUris(values: readonly string[]): string[] {
  const uris = [...new Set(values.map(validateRedirectUri))];
  if (uris.length === 0 || uris.length > 10)
    throw new AppError("OAUTH_REDIRECT_URI_INVALID", "OAuth redirect URIs are invalid.", 422);
  return uris;
}

function validateRegisteredRedirectUri(value: string, registered: readonly string[]): string {
  const uri = validateRedirectUri(value);
  if (!registered.includes(uri))
    throw new AppError("OAUTH_REDIRECT_URI_INVALID", "OAuth redirect URI is not registered.", 422);
  return uri;
}

function validateRedirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError("OAUTH_REDIRECT_URI_INVALID", "OAuth redirect URI is invalid.", 422);
  }
  const localhost =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:"))
    throw new AppError("OAUTH_REDIRECT_URI_INVALID", "OAuth redirect URI must use HTTPS.", 422);
  if (url.username || url.password || url.hash)
    throw new AppError("OAUTH_REDIRECT_URI_INVALID", "OAuth redirect URI is invalid.", 422);
  return url.toString();
}

function isPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function clientDto(client: {
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  allowedScopes: string[];
  status: string;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: client.id,
    name: client.name,
    clientId: client.clientId,
    redirectUris: client.redirectUris,
    allowedScopes: client.allowedScopes,
    status: client.status,
    revokedAt: client.revokedAt?.toISOString() ?? null,
    createdAt: client.createdAt.toISOString()
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function isIdempotencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2002" || error.code === "P2034";
}
