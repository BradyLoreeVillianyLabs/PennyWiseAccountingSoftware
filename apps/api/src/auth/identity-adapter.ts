import type { AuthenticatedIdentity } from "@clearledger/shared";
import type { FastifyRequest } from "fastify";

export interface IdentityAdapter {
  readonly kind: "OIDC" | "DEVELOPMENT";
  authenticate(request: FastifyRequest): Promise<AuthenticatedIdentity>;
}

export function requestHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
