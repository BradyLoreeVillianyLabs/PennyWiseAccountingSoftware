import type { Prisma } from "@clearledger/db";
import type { AuditOrigin, OrganizationContext } from "@clearledger/shared";

type AuditSource = AuditOrigin | Pick<OrganizationContext, "auditOrigin">;

export function withAuditOrigin(
  source: AuditSource,
  metadata: Prisma.InputJsonObject
): Prisma.InputJsonObject {
  const auditOrigin = "auditOrigin" in source ? source.auditOrigin : source;

  return {
    ...metadata,
    auditOrigin: {
      ipAddress: auditOrigin.ipAddress,
      userAgent: auditOrigin.userAgent
    }
  };
}
