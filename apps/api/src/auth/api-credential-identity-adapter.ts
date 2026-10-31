import type { AuthenticatedIdentity } from "@clearledger/shared";
import type { FastifyRequest } from "fastify";
import type { ApiCredentialService } from "../services/api-credential-service.js";
import { readApiCredentialToken } from "../services/api-credential-service.js";
import type { IdentityAdapter } from "./identity-adapter.js";
import { requestHeader } from "./identity-adapter.js";

export class ApiCredentialIdentityAdapter implements IdentityAdapter {
  public readonly kind: IdentityAdapter["kind"];

  public constructor(
    private readonly delegate: IdentityAdapter,
    private readonly credentials: ApiCredentialService
  ) {
    this.kind = delegate.kind;
  }

  public authenticate(request: FastifyRequest): Promise<AuthenticatedIdentity> {
    const token = readApiCredentialToken(request);
    return token
      ? this.credentials.authenticate(token, {
          requestId: request.id,
          auditOrigin: {
            ipAddress: request.ip.trim() || null,
            userAgent: requestHeader(request, "user-agent")?.trim() || null
          }
        })
      : this.delegate.authenticate(request);
  }
}
