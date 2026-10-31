import type { AuthenticatedIdentity } from "@clearledger/shared";
import type { FastifyRequest } from "fastify";
import { readOAuthAccessToken, type OAuthService } from "../services/oauth-service.js";
import type { IdentityAdapter } from "./identity-adapter.js";
import { requestHeader } from "./identity-adapter.js";

export class OAuthIdentityAdapter implements IdentityAdapter {
  public readonly kind: IdentityAdapter["kind"];

  public constructor(
    private readonly delegate: IdentityAdapter,
    private readonly oauth: OAuthService
  ) {
    this.kind = delegate.kind;
  }

  public authenticate(request: FastifyRequest): Promise<AuthenticatedIdentity> {
    const token = readOAuthAccessToken(requestHeader(request, "authorization"));
    return token
      ? this.oauth.authenticateAccessToken(token, {
          requestId: request.id,
          auditOrigin: {
            ipAddress: request.ip.trim() || null,
            userAgent: requestHeader(request, "user-agent")?.trim() || null
          }
        })
      : this.delegate.authenticate(request);
  }
}
