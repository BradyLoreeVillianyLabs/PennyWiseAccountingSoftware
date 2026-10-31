import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { AppError } from "@clearledger/shared";

export interface OidcAuthorizationInput {
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly loginHint?: string | undefined;
  readonly prompt?: "login" | undefined;
  readonly recovery: boolean;
}

export interface VerifiedOidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly authenticatedAt: Date;
  readonly mfaAuthenticated: boolean;
}

export interface OidcProvider {
  readonly issuer: string;
  authorizationUrl(input: OidcAuthorizationInput): Promise<string>;
  exchangeCode(
    code: string,
    codeVerifier: string,
    expectedNonce: string
  ): Promise<VerifiedOidcIdentity>;
  endSessionUrl(returnTo: string): Promise<string | null>;
}

interface OidcMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly end_session_endpoint?: string | undefined;
}

export interface ProductionOidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string | undefined;
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
  readonly recoveryUrl: string;
}

export class ProductionOidcProvider implements OidcProvider {
  public readonly issuer: string;
  private metadataPromise: Promise<OidcMetadata> | undefined;

  public constructor(private readonly config: ProductionOidcConfig) {
    if (
      ![config.issuer, config.redirectUri, config.postLogoutRedirectUri, config.recoveryUrl].every(
        isHttpsUrl
      )
    ) {
      throw new Error("Production OIDC endpoints and redirects must use HTTPS.");
    }
    this.issuer = normalizeIssuer(config.issuer);
  }

  public async authorizationUrl(input: OidcAuthorizationInput): Promise<string> {
    const metadata = await this.metadata();
    const endpoint = input.recovery ? this.config.recoveryUrl : metadata.authorization_endpoint;
    const url = new URL(endpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (input.loginHint) {
      url.searchParams.set("login_hint", input.loginHint);
    }
    if (input.prompt) {
      url.searchParams.set("prompt", input.prompt);
      url.searchParams.set("max_age", "0");
    }
    return url.toString();
  }

  public async exchangeCode(
    code: string,
    codeVerifier: string,
    expectedNonce: string
  ): Promise<VerifiedOidcIdentity> {
    const metadata = await this.metadata();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code,
      code_verifier: codeVerifier
    });
    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret);
    }

    let response: Response;
    try {
      response = await fetch(metadata.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });
    } catch {
      throw new AppError("OIDC_PROVIDER_UNAVAILABLE", "The identity provider is unavailable.", 503);
    }
    if (!response.ok) {
      throw new AppError("OIDC_CODE_EXCHANGE_FAILED", "The sign-in response was rejected.", 401);
    }

    const tokenResponse = (await response.json()) as { id_token?: unknown };
    if (typeof tokenResponse.id_token !== "string") {
      throw new AppError("OIDC_ID_TOKEN_MISSING", "The sign-in response was invalid.", 401);
    }

    const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(tokenResponse.id_token, jwks, {
        issuer: metadata.issuer,
        audience: this.config.clientId
      }));
    } catch {
      throw new AppError("OIDC_ID_TOKEN_INVALID", "The identity token was invalid.", 401);
    }

    if (payload.nonce !== expectedNonce) {
      throw new AppError(
        "OIDC_NONCE_INVALID",
        "The sign-in response did not match the request.",
        401
      );
    }
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      payload.email_verified !== true
    ) {
      throw new AppError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verified email ownership is required.",
        403
      );
    }

    const authTime = typeof payload.auth_time === "number" ? payload.auth_time * 1000 : Date.now();
    const authenticationMethods = Array.isArray(payload.amr)
      ? payload.amr.filter((value: unknown): value is string => typeof value === "string")
      : [];
    return {
      issuer: normalizeIssuer(String(payload.iss)),
      subject: payload.sub,
      email: payload.email,
      emailVerified: true,
      displayName: typeof payload.name === "string" ? payload.name : null,
      authenticatedAt: new Date(authTime),
      mfaAuthenticated: authenticationMethods.some((method: string) =>
        ["mfa", "otp", "hwk", "swk"].includes(method.toLowerCase())
      )
    };
  }

  public async endSessionUrl(returnTo: string): Promise<string | null> {
    const metadata = await this.metadata();
    if (!metadata.end_session_endpoint) {
      return null;
    }
    const url = new URL(metadata.end_session_endpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("post_logout_redirect_uri", returnTo);
    return url.toString();
  }

  private metadata(): Promise<OidcMetadata> {
    this.metadataPromise ??= this.loadMetadata();
    return this.metadataPromise;
  }

  private async loadMetadata(): Promise<OidcMetadata> {
    let response: Response;
    try {
      response = await fetch(`${this.issuer}/.well-known/openid-configuration`);
    } catch {
      throw new AppError("OIDC_PROVIDER_UNAVAILABLE", "The identity provider is unavailable.", 503);
    }
    if (!response.ok) {
      throw new AppError(
        "OIDC_CONFIGURATION_INVALID",
        "Identity provider configuration failed.",
        500
      );
    }
    const metadata = (await response.json()) as Partial<OidcMetadata>;
    if (
      normalizeIssuer(metadata.issuer ?? "") !== this.issuer ||
      !metadata.authorization_endpoint ||
      !metadata.token_endpoint ||
      !metadata.jwks_uri ||
      ![metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri].every(
        isHttpsUrl
      ) ||
      (metadata.end_session_endpoint !== undefined && !isHttpsUrl(metadata.end_session_endpoint))
    ) {
      throw new AppError(
        "OIDC_CONFIGURATION_INVALID",
        "Identity provider configuration failed.",
        500
      );
    }
    return metadata as OidcMetadata;
  }
}

export function oidcConfigFromEnvironment(): ProductionOidcConfig {
  const issuer = requiredHttpsEnvironment("OIDC_ISSUER");
  const clientId = requiredEnvironment("OIDC_CLIENT_ID");
  const redirectUri = requiredHttpsEnvironment("OIDC_REDIRECT_URI");
  const postLogoutRedirectUri = requiredHttpsEnvironment("OIDC_POST_LOGOUT_REDIRECT_URI");
  const recoveryUrl = requiredHttpsEnvironment("OIDC_RECOVERY_URL");
  return {
    issuer,
    clientId,
    redirectUri,
    postLogoutRedirectUri,
    recoveryUrl,
    ...(process.env.OIDC_CLIENT_SECRET ? { clientSecret: process.env.OIDC_CLIENT_SECRET } : {})
  };
}

function requiredHttpsEnvironment(name: string): string {
  const value = requiredEnvironment(name);
  if (!isHttpsUrl(value)) {
    throw new Error(`${name} must use HTTPS in production.`);
  }
  return value;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when production OIDC authentication is enabled.`);
  }
  return value;
}

function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}
