import { createHash, randomBytes } from "node:crypto";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import type { PaymentAccountProtector } from "./payment-provider.js";
import {
  protectSmtpConnection,
  SmtpEmailProvider,
  SmtpTransport,
  type SmtpConnectionInput
} from "./smtp-email-provider.js";
import { withAuditOrigin } from "../utils/audit.js";

export const emailConnectionProviders = ["GMAIL", "MICROSOFT", "SMTP"] as const;
export type EmailConnectionProvider = (typeof emailConnectionProviders)[number];
export const oauthEmailConnectionProviders = ["GMAIL", "MICROSOFT"] as const;
export type OAuthEmailConnectionProvider = (typeof oauthEmailConnectionProviders)[number];

export type EmailDeliveryMode = "DISABLED" | "CONNECTED_MAILBOX" | "SMTP";

export interface EmailDeliveryRuntime {
  readonly mode: EmailDeliveryMode;
  readonly enabled: boolean;
  readonly reason:
    | "disabled"
    | "invalid-mode"
    | "beta-approval-required"
    | "oauth-provider-not-configured"
    | "credential-encryption-unavailable"
    | "ready";
}

export interface EmailProviderRuntimeConfig {
  readonly provider: OAuthEmailConnectionProvider;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly identityEndpoint: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly authorizationParameters?: Readonly<Record<string, string>>;
}

export interface EmailConnectionRuntimeConfig {
  readonly providers: Readonly<
    Partial<Record<OAuthEmailConnectionProvider, EmailProviderRuntimeConfig>>
  >;
  readonly applicationUrl: string | null;
}

export interface EmailOAuthHttpClient {
  exchangeToken(input: {
    readonly tokenEndpoint: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }): Promise<{ readonly status: number; readonly body: unknown }>;
  fetchProfile?(input: {
    readonly provider: OAuthEmailConnectionProvider;
    readonly identityEndpoint: string;
    readonly accessToken: string;
  }): Promise<{ readonly status: number; readonly body: unknown }>;
}

export class FetchEmailOAuthHttpClient implements EmailOAuthHttpClient {
  public async exchangeToken(input: {
    readonly tokenEndpoint: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri
    });
    const response = await fetch(input.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }

  public async fetchProfile(input: {
    readonly provider: OAuthEmailConnectionProvider;
    readonly identityEndpoint: string;
    readonly accessToken: string;
  }) {
    const response = await fetch(input.identityEndpoint, {
      headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }
}

export function emailDeliveryRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv,
  input: {
    readonly providerConfigured: boolean;
    readonly credentialEncryptionAvailable: boolean;
  }
): EmailDeliveryRuntime {
  const configuredMode = env.EMAIL_DELIVERY_MODE?.trim().toLowerCase() ?? "disabled";
  const betaRuntime = env.CLEARLEDGER_BETA_RUNTIME === "true";
  if (!["disabled", "connected-mailbox", "smtp"].includes(configuredMode)) {
    return { mode: "DISABLED", enabled: false, reason: "invalid-mode" };
  }
  if (configuredMode === "disabled")
    return { mode: "DISABLED", enabled: false, reason: "disabled" };
  const mode: Exclude<EmailDeliveryMode, "DISABLED"> =
    configuredMode === "smtp" ? "SMTP" : "CONNECTED_MAILBOX";
  if (betaRuntime && env.PENNYWISE_BETA_EMAIL_DELIVERY_APPROVED !== "true")
    return { mode, enabled: false, reason: "beta-approval-required" };
  if (!input.credentialEncryptionAvailable)
    return { mode, enabled: false, reason: "credential-encryption-unavailable" };
  if (mode === "SMTP") return { mode, enabled: true, reason: "ready" };
  if (!input.providerConfigured)
    return { mode, enabled: false, reason: "oauth-provider-not-configured" };
  return { mode, enabled: true, reason: "ready" };
}

export function emailConnectionConfigFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): EmailConnectionRuntimeConfig {
  const applicationUrl = normalizeApplicationUrl(env.APP_BASE_URL);
  const gmail = providerFromEnvironment(
    env,
    {
      provider: "GMAIL",
      clientId: "EMAIL_GMAIL_CLIENT_ID",
      clientSecret: "EMAIL_GMAIL_CLIENT_SECRET",
      redirectUri: "EMAIL_GMAIL_REDIRECT_URI",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      identityEndpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
      authorizationParameters: { access_type: "offline", prompt: "consent" }
    },
    applicationUrl
  );
  const microsoftTenant = env.EMAIL_MICROSOFT_TENANT_ID?.trim() || "common";
  const microsoft = providerFromEnvironment(
    env,
    {
      provider: "MICROSOFT",
      clientId: "EMAIL_MICROSOFT_CLIENT_ID",
      clientSecret: "EMAIL_MICROSOFT_CLIENT_SECRET",
      redirectUri: "EMAIL_MICROSOFT_REDIRECT_URI",
      authorizationEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant)}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant)}/oauth2/v2.0/token`,
      identityEndpoint:
        "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",
      scopes: ["openid", "profile", "offline_access", "User.Read", "Mail.Send"]
    },
    applicationUrl
  );
  return {
    providers: {
      ...(gmail ? { GMAIL: gmail } : {}),
      ...(microsoft ? { MICROSOFT: microsoft } : {})
    },
    applicationUrl
  };
}

export class EmailConnectionService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly config: EmailConnectionRuntimeConfig,
    private readonly protector: PaymentAccountProtector | undefined,
    private readonly httpClient: EmailOAuthHttpClient = new FetchEmailOAuthHttpClient(),
    private readonly deliveryRuntime: EmailDeliveryRuntime = {
      mode: "DISABLED",
      enabled: false,
      reason: "disabled"
    },
    private readonly smtpTransport: SmtpTransport = new SmtpTransport()
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "email-connections:read", "EmailConnection");
    const connections = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.emailConnection.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { provider: "asc" }
      })
    );
    const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));
    return {
      delivery: this.deliveryRuntime,
      providers: emailConnectionProviders.map((provider) => ({
        provider,
        configured:
          provider === "SMTP"
            ? Boolean(this.protector)
            : Boolean(this.providerConfig(provider) && this.protector),
        connection: byProvider.get(provider) ? publicConnection(byProvider.get(provider)!) : null
      }))
    };
  }

  public async beginAuthorization(
    context: OrganizationContext,
    provider: OAuthEmailConnectionProvider
  ) {
    await this.authorization.assert(context, "email-connections:manage", "EmailConnection");
    const config = this.requireConfiguredProvider(provider);
    const protector = this.requireProtector();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const connection = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.emailOAuthAttempt.deleteMany({
        where: {
          organizationId: context.organizationId,
          provider,
          userId: context.user.id,
          expiresAt: { lt: new Date() }
        }
      });
      await tx.emailOAuthAttempt.create({
        data: {
          organizationId: context.organizationId,
          provider,
          userId: context.user.id,
          stateHash: sha256(state),
          codeVerifierCiphertext: protector.protect(codeVerifier),
          redirectUri: config.redirectUri,
          expiresAt
        }
      });
      const current = await tx.emailConnection.findUnique({
        where: { organizationId_provider: { organizationId: context.organizationId, provider } }
      });
      const record = current
        ? await tx.emailConnection.update({
            where: { id: current.id },
            data: {
              status: current.status === "CONNECTED" ? "CONNECTED" : "PENDING",
              lastErrorCode: null,
              updatedByUserId: context.user.id
            }
          })
        : await tx.emailConnection.create({
            data: {
              organizationId: context.organizationId,
              provider,
              status: "PENDING",
              updatedByUserId: context.user.id
            }
          });
      await audit(tx, context, "EMAIL_CONNECTION_AUTHORIZATION_STARTED", record.id, { provider });
      return publicConnection(record);
    });
    const url = new URL(config.authorizationEndpoint);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", sha256Base64Url(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
    for (const [key, value] of Object.entries(config.authorizationParameters ?? {}))
      url.searchParams.set(key, value);
    return {
      provider,
      authorizationUrl: url.toString(),
      expiresAt: expiresAt.toISOString(),
      connection
    };
  }

  public async completeAuthorization(
    context: OrganizationContext,
    input: {
      readonly provider: OAuthEmailConnectionProvider;
      readonly state: string;
      readonly code?: string | undefined;
      readonly error?: string | undefined;
    }
  ) {
    await this.authorization.assert(context, "email-connections:manage", "EmailConnection");
    const config = this.requireConfiguredProvider(input.provider);
    const protector = this.requireProtector();
    const attempt = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.emailOAuthAttempt.findFirst({
        where: {
          organizationId: context.organizationId,
          provider: input.provider,
          userId: context.user.id,
          stateHash: sha256(input.state),
          consumedAt: null
        }
      });
      if (!current || current.expiresAt <= new Date())
        throw new AppError(
          "EMAIL_OAUTH_STATE_INVALID",
          "This email connection request expired or is not valid. Start again from Integrations.",
          400
        );
      const consumed = await tx.emailOAuthAttempt.updateMany({
        where: { id: current.id, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1)
        throw new AppError(
          "EMAIL_OAUTH_STATE_CONSUMED",
          "This email connection request was already completed. Start a new request.",
          409
        );
      return current;
    });
    if (input.error) {
      const connection = await this.recordProviderError(
        context,
        input.provider,
        "EMAIL_OAUTH_PROVIDER_DENIED"
      );
      throw new AppError(
        "EMAIL_OAUTH_PROVIDER_DENIED",
        "The email provider did not approve the connection. No mailbox credential was saved.",
        422,
        { provider: input.provider, connectionId: connection.id }
      );
    }
    if (!input.code)
      throw new AppError(
        "EMAIL_OAUTH_CODE_REQUIRED",
        "The email provider did not return an authorization code. Start again from Integrations.",
        400
      );
    let tokenResult: { readonly status: number; readonly body: unknown };
    try {
      tokenResult = await this.httpClient.exchangeToken({
        tokenEndpoint: config.tokenEndpoint,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code: input.code,
        codeVerifier: protector.reveal(attempt.codeVerifierCiphertext),
        redirectUri: attempt.redirectUri
      });
    } catch {
      await this.recordProviderError(context, input.provider, "EMAIL_OAUTH_TOKEN_UNAVAILABLE");
      throw new AppError(
        "EMAIL_OAUTH_TOKEN_UNAVAILABLE",
        "The email provider could not complete the connection. No mailbox credential was saved.",
        502
      );
    }
    const token = parseTokenResponse(tokenResult);
    if (!token) {
      await this.recordProviderError(context, input.provider, "EMAIL_OAUTH_TOKEN_REJECTED");
      throw new AppError(
        "EMAIL_OAUTH_TOKEN_REJECTED",
        "The email provider rejected the connection. No mailbox credential was saved.",
        422
      );
    }
    const identity = await this.resolveMailboxIdentity(input.provider, config, token.accessToken);
    const now = new Date();
    const connection = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.emailConnection.findUnique({
        where: {
          organizationId_provider: {
            organizationId: context.organizationId,
            provider: input.provider
          }
        }
      });
      const defaultConnection = await tx.emailConnection.findFirst({
        where: {
          organizationId: context.organizationId,
          status: "CONNECTED",
          isDefaultSender: true
        },
        select: { id: true }
      });
      const shouldUseAsDefault = existing?.isDefaultSender === true || !defaultConnection;
      const record = await tx.emailConnection.upsert({
        where: {
          organizationId_provider: {
            organizationId: context.organizationId,
            provider: input.provider
          }
        },
        create: {
          organizationId: context.organizationId,
          provider: input.provider,
          status: "CONNECTED",
          senderEmail: identity?.email ?? token.email,
          displayName: identity?.displayName ?? null,
          grantedScopes: token.scopes,
          credentialCiphertext: protector.protect(
            JSON.stringify({
              accessToken: token.accessToken,
              refreshToken: token.refreshToken,
              tokenType: token.tokenType,
              tokenExpiresAt: token.tokenExpiresAt?.toISOString() ?? null
            })
          ),
          tokenExpiresAt: token.tokenExpiresAt,
          lastErrorCode: null,
          connectedAt: now,
          disconnectedAt: null,
          isDefaultSender: shouldUseAsDefault,
          updatedByUserId: context.user.id
        },
        update: {
          status: "CONNECTED",
          senderEmail: identity?.email ?? token.email,
          displayName: identity?.displayName ?? null,
          grantedScopes: token.scopes,
          credentialCiphertext: protector.protect(
            JSON.stringify({
              accessToken: token.accessToken,
              refreshToken: token.refreshToken,
              tokenType: token.tokenType,
              tokenExpiresAt: token.tokenExpiresAt?.toISOString() ?? null
            })
          ),
          credentialVersion: { increment: 1 },
          tokenExpiresAt: token.tokenExpiresAt,
          lastErrorCode: null,
          connectedAt: now,
          disconnectedAt: null,
          isDefaultSender: shouldUseAsDefault,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "EMAIL_CONNECTION_CONNECTED", record.id, {
        provider: input.provider,
        grantedScopeCount: token.scopes.length
      });
      return publicConnection(record);
    });
    return { connection };
  }

  public async disconnect(context: OrganizationContext, connectionId: string) {
    await this.authorization.assert(
      context,
      "email-connections:manage",
      "EmailConnection",
      connectionId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const connection = await tx.emailConnection.findFirst({
        where: { id: connectionId, organizationId: context.organizationId }
      });
      if (!connection)
        throw new AppError("EMAIL_CONNECTION_NOT_FOUND", "Email connection was not found.", 404);
      const disconnected = await tx.emailConnection.update({
        where: { id: connection.id },
        data: {
          status: "DISCONNECTED",
          senderEmail: null,
          displayName: null,
          grantedScopes: [],
          credentialCiphertext: null,
          credentialVersion: { increment: 1 },
          tokenExpiresAt: null,
          isDefaultSender: false,
          lastErrorCode: null,
          disconnectedAt: new Date(),
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "EMAIL_CONNECTION_DISCONNECTED", disconnected.id, {
        provider: disconnected.provider
      });
      return publicConnection(disconnected);
    });
  }

  /**
   * Tests a new SMTP configuration before it is written. A failed test cannot
   * overwrite a working saved relay. Passwords are protected before the test
   * provider reads them and are never included in the returned connection.
   */
  public async configureSmtp(
    context: OrganizationContext,
    input: SmtpConnectionInput & { readonly testRecipient: string }
  ) {
    await this.authorization.assert(context, "email-connections:manage", "EmailConnection");
    this.requireSmtpDeliveryEnabled();
    const protector = this.requireProtector();
    const protectedConnection = protectSmtpConnection(input, protector);
    const testProvider = new SmtpEmailProvider(
      protectedConnection.credentialCiphertext,
      protector,
      this.smtpTransport
    );
    const testDelivery = await testProvider.sendTest(input.testRecipient);
    const now = new Date();
    const connection = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.emailConnection.findUnique({
        where: {
          organizationId_provider: { organizationId: context.organizationId, provider: "SMTP" }
        }
      });
      const defaultConnection = await tx.emailConnection.findFirst({
        where: {
          organizationId: context.organizationId,
          status: "CONNECTED",
          isDefaultSender: true
        },
        select: { id: true }
      });
      const shouldUseAsDefault = existing?.isDefaultSender === true || !defaultConnection;
      const record = await tx.emailConnection.upsert({
        where: {
          organizationId_provider: { organizationId: context.organizationId, provider: "SMTP" }
        },
        create: {
          organizationId: context.organizationId,
          provider: "SMTP",
          status: "CONNECTED",
          senderEmail: protectedConnection.summary.fromAddress,
          displayName: `SMTP ${protectedConnection.summary.host}:${String(protectedConnection.summary.port)}`,
          grantedScopes: [],
          credentialCiphertext: protectedConnection.credentialCiphertext,
          tokenExpiresAt: null,
          lastErrorCode: null,
          connectedAt: now,
          disconnectedAt: null,
          isDefaultSender: shouldUseAsDefault,
          updatedByUserId: context.user.id
        },
        update: {
          status: "CONNECTED",
          senderEmail: protectedConnection.summary.fromAddress,
          displayName: `SMTP ${protectedConnection.summary.host}:${String(protectedConnection.summary.port)}`,
          grantedScopes: [],
          credentialCiphertext: protectedConnection.credentialCiphertext,
          credentialVersion: { increment: 1 },
          tokenExpiresAt: null,
          lastErrorCode: null,
          connectedAt: now,
          disconnectedAt: null,
          isDefaultSender: shouldUseAsDefault,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "SMTP_CONNECTION_TESTED_AND_CONNECTED", record.id, {
        host: protectedConnection.summary.host,
        port: protectedConnection.summary.port,
        tlsMode: protectedConnection.summary.tlsMode,
        fromAddress: protectedConnection.summary.fromAddress
      });
      return publicConnection(record);
    });
    return { connection, testMessageId: testDelivery.providerMessageId };
  }

  public async setDefaultSender(context: OrganizationContext, connectionId: string) {
    await this.authorization.assert(
      context,
      "email-connections:manage",
      "EmailConnection",
      connectionId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const connection = await tx.emailConnection.findFirst({
        where: { id: connectionId, organizationId: context.organizationId }
      });
      if (!connection)
        throw new AppError("EMAIL_CONNECTION_NOT_FOUND", "Email connection was not found.", 404);
      if (connection.status !== "CONNECTED" || !connection.credentialCiphertext)
        throw new AppError(
          "EMAIL_CONNECTION_NOT_READY",
          "Connect this mailbox before selecting it for sending.",
          409
        );
      await tx.emailConnection.updateMany({
        where: { organizationId: context.organizationId, isDefaultSender: true },
        data: { isDefaultSender: false }
      });
      const updated = await tx.emailConnection.update({
        where: { id: connection.id },
        data: { isDefaultSender: true, updatedByUserId: context.user.id }
      });
      await audit(tx, context, "EMAIL_CONNECTION_DEFAULT_SENDER_SET", updated.id, {
        provider: updated.provider
      });
      return publicConnection(updated);
    });
  }

  public callbackReturnUrl(provider: OAuthEmailConnectionProvider, outcome: "connected" | "error") {
    const applicationUrl = this.config.applicationUrl;
    if (!applicationUrl) return null;
    const url = new URL(applicationUrl);
    url.searchParams.set("email-connection", provider);
    url.searchParams.set("email-connection-status", outcome);
    return url.toString();
  }

  private providerConfig(provider: OAuthEmailConnectionProvider) {
    return this.config.providers[provider] ?? null;
  }

  private requireConfiguredProvider(provider: OAuthEmailConnectionProvider) {
    const config = this.providerConfig(provider);
    if (!config)
      throw new AppError(
        "EMAIL_PROVIDER_NOT_CONFIGURED",
        "This email provider has not been configured for this PennyWise environment.",
        503
      );
    return config;
  }

  private requireProtector() {
    if (!this.protector)
      throw new AppError(
        "EMAIL_CONNECTION_ENCRYPTION_UNAVAILABLE",
        "Email connections are disabled until secure credential encryption is configured.",
        503
      );
    return this.protector;
  }

  private requireSmtpDeliveryEnabled(): void {
    if (this.deliveryRuntime.mode === "SMTP" && this.deliveryRuntime.enabled) return;
    throw new AppError(
      "SMTP_DELIVERY_NOT_ENABLED",
      "SMTP test delivery is disabled. Enable EMAIL_DELIVERY_MODE=smtp and configure secure credential encryption before testing this relay.",
      409
    );
  }

  private async resolveMailboxIdentity(
    provider: OAuthEmailConnectionProvider,
    config: EmailProviderRuntimeConfig,
    accessToken: string
  ) {
    if (!this.httpClient.fetchProfile) return null;
    try {
      const result = await this.httpClient.fetchProfile({
        provider,
        identityEndpoint: config.identityEndpoint,
        accessToken
      });
      return parseMailboxIdentity(provider, result);
    } catch {
      // A profile lookup makes the connection easier to recognize in the UI,
      // but it must not discard a valid provider authorization or its token.
      return null;
    }
  }

  private async recordProviderError(
    context: OrganizationContext,
    provider: OAuthEmailConnectionProvider,
    errorCode: string
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.emailConnection.findUnique({
        where: { organizationId_provider: { organizationId: context.organizationId, provider } }
      });
      const record = existing
        ? await tx.emailConnection.update({
            where: { id: existing.id },
            data: {
              status: existing.status === "CONNECTED" ? "CONNECTED" : "ERROR",
              lastErrorCode: errorCode,
              updatedByUserId: context.user.id
            }
          })
        : await tx.emailConnection.create({
            data: {
              organizationId: context.organizationId,
              provider,
              status: "ERROR",
              lastErrorCode: errorCode,
              updatedByUserId: context.user.id
            }
          });
      await audit(tx, context, "EMAIL_CONNECTION_ERROR", record.id, { provider, errorCode });
      return publicConnection(record);
    });
  }
}

function providerFromEnvironment(
  env: NodeJS.ProcessEnv,
  definition: {
    readonly provider: OAuthEmailConnectionProvider;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
    readonly identityEndpoint: string;
    readonly scopes: readonly string[];
    readonly authorizationParameters?: Readonly<Record<string, string>>;
  },
  applicationUrl: string | null
): EmailProviderRuntimeConfig | null {
  const clientId = env[definition.clientId]?.trim();
  const clientSecret = env[definition.clientSecret]?.trim();
  if (!clientId || !clientSecret || !applicationUrl) return null;
  const fallbackCallback = new URL("/api/v1/email-connections/callback", applicationUrl);
  fallbackCallback.searchParams.set("provider", definition.provider);
  return {
    provider: definition.provider,
    clientId,
    clientSecret,
    authorizationEndpoint: definition.authorizationEndpoint,
    tokenEndpoint: definition.tokenEndpoint,
    identityEndpoint: definition.identityEndpoint,
    redirectUri: env[definition.redirectUri]?.trim() || fallbackCallback.toString(),
    scopes: definition.scopes,
    ...(definition.authorizationParameters
      ? { authorizationParameters: definition.authorizationParameters }
      : {})
  };
}

function normalizeApplicationUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseTokenResponse(value: { readonly status: number; readonly body: unknown }) {
  if (value.status < 200 || value.status >= 300 || !value.body || typeof value.body !== "object")
    return null;
  const body = value.body as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!accessToken || !refreshToken) return null;
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in);
  const tokenExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + Math.min(expiresIn, 31_536_000) * 1000)
      : null;
  return {
    accessToken,
    refreshToken,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    email: typeof body.email === "string" ? body.email : null,
    scopes:
      typeof body.scope === "string" ? [...new Set(body.scope.split(/\s+/).filter(Boolean))] : [],
    tokenExpiresAt
  };
}

function parseMailboxIdentity(
  provider: OAuthEmailConnectionProvider,
  value: { readonly status: number; readonly body: unknown }
) {
  if (value.status < 200 || value.status >= 300 || !value.body || typeof value.body !== "object")
    return null;
  const body = value.body as Record<string, unknown>;
  const gmailAddress = typeof body.emailAddress === "string" ? body.emailAddress : null;
  const microsoftAddress =
    typeof body.mail === "string"
      ? body.mail
      : typeof body.userPrincipalName === "string"
        ? body.userPrincipalName
        : null;
  const email = provider === "GMAIL" ? gmailAddress : microsoftAddress;
  if (!email || !email.includes("@")) return null;
  return {
    email,
    displayName: typeof body.displayName === "string" ? body.displayName : null
  };
}

function publicConnection(connection: {
  id: string;
  provider: string;
  status: string;
  senderEmail: string | null;
  displayName: string | null;
  isDefaultSender: boolean;
  grantedScopes: readonly string[];
  tokenExpiresAt: Date | null;
  lastErrorCode: string | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    senderEmail: connection.senderEmail,
    displayName: connection.displayName,
    isDefaultSender: connection.isDefaultSender,
    grantedScopes: connection.grantedScopes,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
    updatedAt: connection.updatedAt.toISOString()
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType: "EmailConnection",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
