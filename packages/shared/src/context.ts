export const membershipRoles = [
  "OWNER",
  "ADMIN",
  "ACCOUNTANT",
  "BOOKKEEPER",
  "SALES",
  "PURCHASES",
  "INVENTORY",
  "READ_ONLY"
] as const;

export type MembershipRole = (typeof membershipRoles)[number];

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly emailVerifiedAt: Date | null;
}

export interface AuthenticatedIdentity extends AuthenticatedUser {
  readonly sessionId: string | null;
  readonly activeOrganizationId: string | null;
  /** The selected legal company inside the active workspace, when available. */
  readonly activeCompanyId?: string | null;
  readonly recentAuthAt: Date;
  readonly mfaAuthenticated: boolean;
  readonly authenticationMethod: "OIDC" | "DEVELOPMENT" | "API_KEY" | "OAUTH";
  readonly apiCredentialId?: string | null;
  readonly apiCredentialScopes?: readonly string[];
  readonly oauthAccessTokenId?: string | null;
  readonly oauthScopes?: readonly string[];
}

export interface AuditOrigin {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface OrganizationContext {
  readonly requestId: string;
  readonly user: AuthenticatedUser;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly role: MembershipRole;
  /**
   * Company context is optional while legacy organization data is being
   * backfilled. Company-aware services must reject a missing value before
   * creating or posting company-owned records.
   */
  readonly companyId?: string | null;
  readonly companyMembershipId?: string | null;
  readonly sessionId: string | null;
  readonly recentAuthAt: Date;
  readonly mfaAuthenticated: boolean;
  readonly authenticationMethod: "OIDC" | "DEVELOPMENT" | "API_KEY" | "OAUTH";
  readonly apiCredentialId?: string | null;
  readonly apiCredentialScopes?: readonly string[];
  readonly oauthAccessTokenId?: string | null;
  readonly oauthScopes?: readonly string[];
  readonly auditOrigin: AuditOrigin;
}
