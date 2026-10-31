import { randomUUID } from "node:crypto";
import {
  PrismaClient,
  verifyRuntimeDatabaseRole,
  withRuntimeTransaction,
  type MembershipRole,
  type RuntimeTransaction
} from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { DevelopmentIdentityAdapter } from "./auth/dev-identity.js";
import { hashOpaqueToken } from "./auth/security.js";
import type {
  OidcAuthorizationInput,
  OidcProvider,
  VerifiedOidcIdentity
} from "./auth/oidc-provider.js";
import { SessionIdentityAdapter, SessionService, sessionCookie } from "./auth/session-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const developmentApp = buildApp({ prisma });
const sessions = new SessionService(prisma);
const sessionApp = buildApp({ prisma, identityAdapter: new SessionIdentityAdapter(sessions) });
let oidcProvider: MockOidcProvider;
let oidcApp: ReturnType<typeof buildApp>;

interface InvitationResult {
  readonly invitation: { readonly id: string };
  readonly token: string;
}

describe("Phase 2 identity, membership, and tenant isolation", () => {
  beforeAll(async () => {
    oidcProvider = new MockOidcProvider();
    oidcApp = buildApp({
      prisma,
      identityAdapter: new SessionIdentityAdapter(sessions),
      oidcProvider
    });
    await prisma.$connect();
    await Promise.all([developmentApp.ready(), sessionApp.ready(), oidcApp.ready()]);
  });

  beforeEach(async () => {
    oidcProvider.reset();
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await Promise.all([developmentApp.close(), sessionApp.close(), oidcApp.close()]);
    await prisma.$disconnect();
  });

  it("rejects unauthenticated, expired, and revoked sessions", async () => {
    expect((await sessionApp.inject({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(
      401
    );

    const user = await createVerifiedUser("session-state@example.test");
    const expired = await prisma.session.create({
      data: {
        tokenHash: hashOpaqueToken("expired-token"),
        userId: user.id,
        issuedAt: new Date(Date.now() - 60 * 60 * 1000),
        lastSeenAt: new Date(Date.now() - 30 * 60 * 1000),
        idleExpiresAt: new Date(Date.now() - 1_000),
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        recentAuthAt: new Date(Date.now() - 60 * 60 * 1000)
      }
    });
    const expiredResponse = await sessionApp.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { authorization: "Bearer expired-token" }
    });
    expect(expiredResponse.statusCode).toBe(401);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: expired.id } })).revokedAt
    ).not.toBeNull();

    const revokedSession = await createSession(user.id);
    await prisma.session.update({
      where: { id: revokedSession.id },
      data: { revokedAt: new Date(), revocationReason: "ADMIN_REVOKED" }
    });
    const revokedResponse = await sessionApp.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: cookiePair(revokedSession.token, revokedSession.absoluteExpiresAt) }
    });
    expect(revokedResponse.statusCode).toBe(401);
  });

  it("rejects unverified email identities and the development adapter in production", async () => {
    const unverified = await developmentApp.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: devHeaders("unverified@example.test", undefined, {
        "x-clearledger-email-verified": "false"
      }),
      payload: organizationPayload("Unverified Co")
    });
    expect(unverified.statusCode).toBe(403);
    expect(unverified.json<{ error: { code: string } }>().error.code).toBe(
      "EMAIL_VERIFICATION_REQUIRED"
    );

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        buildApp({ prisma, identityAdapter: new DevelopmentIdentityAdapter(prisma) })
      ).toThrow("cannot run in production");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("completes OIDC sign-in, rotates renewal, signs out, and never exposes provider tokens", async () => {
    oidcProvider.identity = providerIdentity("oidc-user@example.test", "subject-sign-in");
    const state = await startOidcFlow("/v1/auth/sign-in");
    const callback = await oidcApp.inject({
      method: "GET",
      url: `/v1/auth/callback?code=provider-code&state=${encodeURIComponent(state)}`
    });
    expect(callback.statusCode).toBe(302);
    const cookie = extractCookie(callback.headers["set-cookie"]);
    expect(callback.body).not.toContain("provider-code");
    expect(callback.headers).not.toHaveProperty("authorization");

    const authenticated = await oidcApp.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie }
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.body).not.toContain("access_token");
    expect(authenticated.body).not.toContain("id_token");

    const signedInUser = await prisma.user.findUniqueOrThrow({
      where: { email: "oidc-user@example.test" }
    });
    const otherSession = await createSession(signedInUser.id);
    const sessionsResponse = await oidcApp.inject({
      method: "GET",
      url: "/v1/auth/sessions",
      headers: { cookie }
    });
    expect(sessionsResponse.statusCode).toBe(200);
    expect(sessionsResponse.json<{ sessions: unknown[] }>().sessions).toHaveLength(2);
    const revokeOther = await oidcApp.inject({
      method: "POST",
      url: `/v1/auth/sessions/${otherSession.id}/revoke`,
      headers: browserHeaders(cookie)
    });
    expect(revokeOther.statusCode).toBe(200);
    expect(
      (
        await oidcApp.inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: cookiePair(otherSession.token, otherSession.absoluteExpiresAt) }
        })
      ).statusCode
    ).toBe(401);

    const renewed = await oidcApp.inject({
      method: "POST",
      url: "/v1/auth/session/renew",
      headers: browserHeaders(cookie)
    });
    expect(renewed.statusCode).toBe(200);
    const renewedCookie = extractCookie(renewed.headers["set-cookie"]);
    expect(renewedCookie).not.toBe(cookie);

    const signedOut = await oidcApp.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: browserHeaders(renewedCookie)
    });
    expect(signedOut.statusCode).toBe(200);
    expect(
      (
        await oidcApp.inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: renewedCookie }
        })
      ).statusCode
    ).toBe(401);
    expect(await prisma.authenticationAuditEvent.count({ where: { action: "LOGOUT" } })).toBe(1);
  });

  it("enforces single-use OIDC state and provider-backed account recovery revocation", async () => {
    oidcProvider.identity = providerIdentity("recover@example.test", "subject-recover");
    const firstState = await startOidcFlow("/v1/auth/sign-in");
    const first = await oidcApp.inject({
      method: "GET",
      url: `/v1/auth/callback?code=first&state=${encodeURIComponent(firstState)}`
    });
    const oldCookie = extractCookie(first.headers["set-cookie"]);
    expect(
      (
        await oidcApp.inject({
          method: "GET",
          url: `/v1/auth/callback?code=reuse&state=${encodeURIComponent(firstState)}`
        })
      ).statusCode
    ).toBe(401);

    const recoveryState = await startOidcFlow("/v1/auth/recover?loginHint=recover@example.test");
    const recovered = await oidcApp.inject({
      method: "GET",
      url: `/v1/auth/callback?code=recovery&state=${encodeURIComponent(recoveryState)}`
    });
    expect(recovered.statusCode).toBe(302);
    const recoveredCookie = extractCookie(recovered.headers["set-cookie"]);
    expect(
      (
        await oidcApp.inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: oldCookie }
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await oidcApp.inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: recoveredCookie }
        })
      ).statusCode
    ).toBe(200);
    expect(
      await prisma.authenticationAuditEvent.count({
        where: { action: "ACCOUNT_RECOVERY_COMPLETED" }
      })
    ).toBe(1);
  });

  it("requires provider-confirmed MFA before an OIDC user creates an organization", async () => {
    oidcProvider.identity = {
      ...providerIdentity("no-mfa@example.test", "subject-no-mfa"),
      mfaAuthenticated: false
    };
    const state = await startOidcFlow("/v1/auth/sign-in");
    const callback = await oidcApp.inject({
      method: "GET",
      url: `/v1/auth/callback?code=no-mfa&state=${encodeURIComponent(state)}`
    });
    const cookie = extractCookie(callback.headers["set-cookie"]);
    const response = await oidcApp.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: browserHeaders(cookie),
      payload: organizationPayload("MFA Required Co")
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("MFA_REQUIRED");
  });

  it("requires MFA for finance-capable OIDC roles before tenant access", async () => {
    const organizationId = await createOrganization("mfa-owner@example.test", "MFA Access Co");
    const invite = await createInvitation(
      organizationId,
      "mfa-owner@example.test",
      "mfa-accountant@example.test",
      "ACCOUNTANT"
    );
    await acceptInvitation("mfa-accountant@example.test", invite.token);
    const accountant = await prisma.user.findUniqueOrThrow({
      where: { email: "mfa-accountant@example.test" }
    });
    const session = await createSession(accountant.id, organizationId, false);

    const response = await sessionApp.inject({
      method: "GET",
      url: "/v1/organizations/current",
      headers: browserHeaders(cookiePair(session.token, session.absoluteExpiresAt))
    });
    expect(response.statusCode).toBe(403);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId, action: "AUTHORIZATION_DENIED" }
      })
    ).toBe(1);
  });

  it("requires recent authentication for membership administration and audits denial", async () => {
    const organizationId = await createOrganization("stale-owner@example.test", "Recent Auth Co");
    const response = await developmentApp.inject({
      method: "POST",
      url: "/v1/organizations/current/invitations",
      headers: devHeaders("stale-owner@example.test", organizationId, {
        "x-clearledger-recent-auth-at": new Date(Date.now() - 60 * 60 * 1000).toISOString()
      }),
      payload: { email: "new-member@example.test", role: "BOOKKEEPER" }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "RECENT_AUTHENTICATION_REQUIRED"
    );
    const denial = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId, action: "AUTHORIZATION_DENIED" }
    });
    expect(denial.metadata).toMatchObject({
      permission: "members:invite",
      reason: "RECENT_AUTH_REQUIRED"
    });
  });

  it("binds invitations to verified email and enforces expiration and single use", async () => {
    const organizationId = await createOrganization("invite-owner@example.test", "Invitation Co");
    const wrongEmailInvite = await createInvitation(
      organizationId,
      "invite-owner@example.test",
      "intended@example.test",
      "BOOKKEEPER"
    );
    const wrongEmail = await acceptInvitation("wrong@example.test", wrongEmailInvite.token);
    expect(wrongEmail.statusCode).toBe(403);

    const accepted = await acceptInvitation("intended@example.test", wrongEmailInvite.token);
    expect(accepted.statusCode).toBe(200);
    const reused = await acceptInvitation("intended@example.test", wrongEmailInvite.token);
    expect(reused.statusCode).toBe(409);

    const expiring = await createInvitation(
      organizationId,
      "invite-owner@example.test",
      "expired@example.test",
      "READ_ONLY"
    );
    await prisma.organizationInvitation.update({
      where: { id: expiring.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) }
    });
    const expired = await acceptInvitation("expired@example.test", expiring.token);
    expect(expired.statusCode).toBe(410);
    expect(
      (
        await prisma.organizationInvitation.findUniqueOrThrow({
          where: { id: expiring.invitation.id }
        })
      ).status
    ).toBe("EXPIRED");
    expect(await prisma.auditEvent.count({ where: { action: "INVITATION_EXPIRED" } })).toBe(1);
  });

  it("allows exactly one simultaneous acceptance of an invitation", async () => {
    const organizationId = await createOrganization(
      "race-owner@example.test",
      "Invitation Race Co"
    );
    const invitation = await createInvitation(
      organizationId,
      "race-owner@example.test",
      "race-member@example.test",
      "BOOKKEEPER"
    );
    const user = await createVerifiedUser("race-member@example.test");
    const session = await createSession(user.id);
    const request = () =>
      sessionApp.inject({
        method: "POST",
        url: "/v1/invitations/accept",
        headers: browserHeaders(cookiePair(session.token, session.absoluteExpiresAt)),
        payload: { token: invitation.token }
      });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(
      await prisma.membership.count({
        where: { organizationId, userId: user.id, status: "ACTIVE" }
      })
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { targetId: invitation.invitation.id, action: "INVITATION_ACCEPTED" }
      })
    ).toBe(1);
  });

  it("stores only invitation token hashes and records lifecycle audit events", async () => {
    const organizationId = await createOrganization("hash-owner@example.test", "Token Hash Co");
    const result = await createInvitation(
      organizationId,
      "hash-owner@example.test",
      "hash-member@example.test",
      "ACCOUNTANT"
    );
    const stored = await prisma.organizationInvitation.findUniqueOrThrow({
      where: { id: result.invitation.id }
    });
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).not.toBe(result.token);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "INVITATION_CREATED", targetId: result.invitation.id }
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(result.token);
    const revoked = await developmentApp.inject({
      method: "POST",
      url: `/v1/organizations/current/invitations/${result.invitation.id}/revoke`,
      headers: devHeaders("hash-owner@example.test", organizationId),
      payload: {}
    });
    expect(revoked.statusCode).toBe(200);
    expect((await acceptInvitation("hash-member@example.test", result.token)).statusCode).toBe(409);
    expect(
      await prisma.auditEvent.count({
        where: { action: "INVITATION_REVOKED", targetId: result.invitation.id }
      })
    ).toBe(1);
  });

  it("blocks self-escalation and preserves the existing role with a denial audit", async () => {
    const organizationId = await createOrganization("role-owner@example.test", "Role Co");
    const result = await createInvitation(
      organizationId,
      "role-owner@example.test",
      "admin@example.test",
      "ADMIN"
    );
    const accepted = await acceptInvitation("admin@example.test", result.token);
    const membershipId = accepted.json<{ membership: { id: string } }>().membership.id;
    const escalation = await developmentApp.inject({
      method: "PATCH",
      url: `/v1/organizations/current/members/${membershipId}/role`,
      headers: devHeaders("admin@example.test", organizationId),
      payload: { role: "OWNER" }
    });
    expect(escalation.statusCode).toBe(403);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).role).toBe(
      "ADMIN"
    );
    expect(
      await prisma.auditEvent.count({
        where: { action: "MEMBER_ROLE_CHANGE_DENIED", targetId: membershipId }
      })
    ).toBe(1);
  });

  it("audits forbidden owner assignment and revokes sessions after an authorized role change", async () => {
    const organizationId = await createOrganization("lifecycle-owner@example.test", "Lifecycle Co");
    const invite = await createInvitation(
      organizationId,
      "lifecycle-owner@example.test",
      "lifecycle-admin@example.test",
      "ADMIN"
    );
    const accepted = await acceptInvitation("lifecycle-admin@example.test", invite.token);
    const membershipId = accepted.json<{ membership: { id: string } }>().membership.id;
    const administrator = await prisma.user.findUniqueOrThrow({
      where: { email: "lifecycle-admin@example.test" }
    });
    const session = await createSession(administrator.id, organizationId);

    const forbiddenInvite = await developmentApp.inject({
      method: "POST",
      url: "/v1/organizations/current/invitations",
      headers: devHeaders("lifecycle-admin@example.test", organizationId),
      payload: { email: "new-owner@example.test", role: "OWNER" }
    });
    expect(forbiddenInvite.statusCode).toBe(403);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId, action: "INVITATION_CREATION_DENIED" }
      })
    ).toBe(1);

    const roleChange = await developmentApp.inject({
      method: "PATCH",
      url: `/v1/organizations/current/members/${membershipId}/role`,
      headers: devHeaders("lifecycle-owner@example.test", organizationId),
      payload: { role: "ACCOUNTANT" }
    });
    expect(roleChange.statusCode).toBe(200);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revocationReason
    ).toBe("MEMBERSHIP_ROLE_CHANGED");
    expect(
      await prisma.authenticationAuditEvent.count({
        where: { organizationId, action: "SESSIONS_REVOKED_AFTER_ROLE_CHANGE" }
      })
    ).toBe(1);
  });

  it("protects the final owner in PostgreSQL and under simultaneous demotions", async () => {
    const organizationId = await createOrganization("owner-one@example.test", "Owner Guard Co");
    const original = await membershipFor(organizationId, "owner-one@example.test");
    await expect(
      prisma.membership.update({ where: { id: original.id }, data: { role: "ADMIN" } })
    ).rejects.toThrow("retain at least one active owner");

    const invite = await createInvitation(
      organizationId,
      "owner-one@example.test",
      "owner-two@example.test",
      "OWNER"
    );
    await acceptInvitation("owner-two@example.test", invite.token);
    const second = await membershipFor(organizationId, "owner-two@example.test");
    const results = await Promise.allSettled([
      prisma.membership.update({ where: { id: second.id }, data: { role: "ADMIN" } }),
      prisma.membership.update({ where: { id: original.id }, data: { role: "ADMIN" } })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.membership.count({
        where: { organizationId, role: "OWNER", status: "ACTIVE" }
      })
    ).toBe(1);
  });

  it("removes organization access immediately after membership revocation", async () => {
    const organizationId = await createOrganization("revoke-owner@example.test", "Revocation Co");
    const invite = await createInvitation(
      organizationId,
      "revoke-owner@example.test",
      "revoked-member@example.test",
      "BOOKKEEPER"
    );
    await acceptInvitation("revoked-member@example.test", invite.token);
    const member = await membershipFor(organizationId, "revoked-member@example.test");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "revoked-member@example.test" }
    });
    const session = await createSession(user.id, organizationId);
    const cookie = cookiePair(session.token, session.absoluteExpiresAt);
    expect(
      (
        await sessionApp.inject({
          method: "GET",
          url: "/v1/organizations/current",
          headers: { cookie }
        })
      ).statusCode
    ).toBe(200);

    const revoked = await developmentApp.inject({
      method: "POST",
      url: `/v1/organizations/current/members/${member.id}/revoke`,
      headers: devHeaders("revoke-owner@example.test", organizationId),
      payload: {}
    });
    expect(revoked.statusCode).toBe(200);
    const after = await sessionApp.inject({
      method: "GET",
      url: "/v1/organizations/current",
      headers: { cookie }
    });
    expect(after.statusCode).toBe(409);
  });

  it("switches organizations only through active membership and audits the selection", async () => {
    const email = "switch-owner@example.test";
    const firstOrganizationId = await createOrganization(email, "First Organization");
    const secondOrganizationId = await createOrganization(email, "Second Organization");
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const session = await createSession(user.id, firstOrganizationId);
    const cookie = cookiePair(session.token, session.absoluteExpiresAt);
    const switched = await sessionApp.inject({
      method: "POST",
      url: "/v1/organizations/switch",
      headers: browserHeaders(cookie),
      payload: { organizationId: secondOrganizationId }
    });
    expect(switched.statusCode).toBe(200);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).activeOrganizationId
    ).toBe(secondOrganizationId);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId: secondOrganizationId, action: "ORGANIZATION_SWITCHED" }
      })
    ).toBe(1);
  });

  it("rejects cross-tenant membership identifier substitution", async () => {
    const organizationA = await createOrganization("tenant-a-owner@example.test", "Tenant A");
    const organizationB = await createOrganization("tenant-b-owner@example.test", "Tenant B");
    const target = await membershipFor(organizationB, "tenant-b-owner@example.test");
    const response = await developmentApp.inject({
      method: "PATCH",
      url: `/v1/organizations/current/members/${target.id}/role`,
      headers: devHeaders("tenant-a-owner@example.test", organizationA),
      payload: { role: "ADMIN" }
    });
    expect(response.statusCode).toBe(404);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: target.id } })).role).toBe(
      "OWNER"
    );
  });

  it("fails RLS closed without context and isolates correct and incorrect tenant context", async () => {
    const organizationA = await createOrganization("rls-a@example.test", "RLS A");
    const organizationB = await createOrganization("rls-b@example.test", "RLS B");
    const ownerA = await prisma.user.findUniqueOrThrow({ where: { email: "rls-a@example.test" } });
    await prisma.account.create({
      data: { organizationId: organizationA, code: "1000", name: "A Cash", type: "ASSET" }
    });
    await prisma.account.create({
      data: { organizationId: organizationB, code: "1000", name: "B Cash", type: "ASSET" }
    });

    expect(await runtimeAccountCount(null, ownerA.id)).toBe(0);
    expect(await runtimeAccountCount("not-a-uuid", ownerA.id)).toBe(0);
    expect(await runtimeAccountCount(organizationA, ownerA.id)).toBe(1);
    expect(await runtimeAccountCount(organizationB, ownerA.id)).toBe(0);
    await expect(runtimeCreateAccount(organizationA, organizationB, ownerA.id)).rejects.toThrow();

    expect(await prisma.account.count()).toBe(2);
    const runtimeRole = await prisma.$queryRaw<
      readonly {
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolreplication: boolean;
        rolsuper: boolean;
      }[]
    >`
      SELECT rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole, rolinherit,
             rolreplication, rolsuper
      FROM pg_roles WHERE rolname = 'clearledger_runtime'
    `;
    expect(runtimeRole[0]).toEqual({
      rolbypassrls: false,
      rolcanlogin: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolsuper: false
    });
  });

  it("confines organization bootstrap grants to a newly inserted tenant", async () => {
    const organizationId = await createOrganization("bootstrap-owner@example.test", "Bootstrap Co");
    const outsider = await createVerifiedUser("bootstrap-outsider@example.test");

    expect(await runtimeBootstrapProbe(organizationId, outsider.id)).toEqual({
      selected: 0,
      updated: 0,
      companyUpdated: 0,
      settingsUpdated: 0,
      workflowPreferencesUpdated: 0
    });
    await expect(runtimeBootstrapOwnerInsert(organizationId, outsider.id)).rejects.toThrow();
    expect(
      await prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId: outsider.id } }
      })
    ).toBeNull();
    await expect(prisma.$queryRaw<readonly { count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "OrganizationBootstrapGrant"
    `).resolves.toEqual([{ count: 0n }]);
  });

  it("rejects migration credentials and accepts a constrained production login", async () => {
    await expect(verifyRuntimeDatabaseRole(prisma)).rejects.toThrow(
      "unprivileged NOINHERIT member"
    );
    await prisma.$executeRawUnsafe('DROP ROLE IF EXISTS "clearledger_app_verify"');
    await prisma.$executeRawUnsafe(`
      CREATE ROLE clearledger_app_verify
        LOGIN PASSWORD 'clearledger_verify_only'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
    `);
    await prisma.$executeRawUnsafe("GRANT clearledger_runtime TO clearledger_app_verify");

    const restrictedUrl = new URL(databaseUrl);
    restrictedUrl.username = "clearledger_app_verify";
    restrictedUrl.password = "clearledger_verify_only";
    const restricted = new PrismaClient({
      datasources: { db: { url: restrictedUrl.toString() } }
    });
    try {
      await expect(verifyRuntimeDatabaseRole(restricted)).resolves.toBeUndefined();
    } finally {
      await restricted.$disconnect();
      await prisma.$executeRawUnsafe('DROP ROLE "clearledger_app_verify"');
    }
  });

  it("does not leak transaction-local tenant context through the connection pool", async () => {
    const organizationA = await createOrganization("pool-a@example.test", "Pool A");
    const organizationB = await createOrganization("pool-b@example.test", "Pool B");
    const actorA = await prisma.user.findUniqueOrThrow({ where: { email: "pool-a@example.test" } });
    const actorB = await prisma.user.findUniqueOrThrow({ where: { email: "pool-b@example.test" } });
    await prisma.account.create({
      data: { organizationId: organizationA, code: "A", name: "A", type: "ASSET" }
    });
    await prisma.account.create({
      data: { organizationId: organizationB, code: "B", name: "B", type: "ASSET" }
    });

    expect(await runtimeAccountCount(organizationA, actorA.id)).toBe(1);
    expect(await runtimeAccountCount(null, actorA.id)).toBe(0);
    expect(await runtimeAccountCount(organizationB, actorB.id)).toBe(1);
    expect(await runtimeAccountCount(null, actorB.id)).toBe(0);
  });

  it("keeps authentication audit records append-only in PostgreSQL", async () => {
    const user = await createVerifiedUser("audit-auth@example.test");
    const event = await prisma.authenticationAuditEvent.create({
      data: { actorUserId: user.id, action: "LOGIN", outcome: "SUCCESS" }
    });
    await expect(
      prisma.authenticationAuditEvent.update({
        where: { id: event.id },
        data: { outcome: "CHANGED" }
      })
    ).rejects.toThrow("append-only");
    await expect(
      prisma.authenticationAuditEvent.delete({ where: { id: event.id } })
    ).rejects.toThrow("append-only");
  });

  it("completes the minimal OIDC organization and membership flow end to end", async () => {
    oidcProvider.identity = providerIdentity("flow-owner@example.test", "flow-owner");
    const ownerState = await startOidcFlow("/v1/auth/sign-in");
    const ownerCallback = await oidcApp.inject({
      method: "GET",
      url: `/v1/auth/callback?code=owner&state=${encodeURIComponent(ownerState)}`
    });
    const ownerCookie = extractCookie(ownerCallback.headers["set-cookie"]);
    const created = await oidcApp.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: browserHeaders(ownerCookie),
      payload: organizationPayload("End To End Co")
    });
    expect(created.statusCode, created.body).toBe(201);
    const organizationId = created.json<{ organization: { id: string } }>().organization.id;

    expect(
      (
        await oidcApp.inject({
          method: "POST",
          url: "/v1/organizations/switch",
          headers: { cookie: ownerCookie },
          payload: { organizationId }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await oidcApp.inject({
          method: "POST",
          url: "/v1/organizations/switch",
          headers: browserHeaders(ownerCookie),
          payload: { organizationId }
        })
      ).statusCode
    ).toBe(200);

    const invitationResponse = await oidcApp.inject({
      method: "POST",
      url: "/v1/organizations/current/invitations",
      headers: browserHeaders(ownerCookie),
      payload: { email: "flow-member@example.test", role: "BOOKKEEPER" }
    });
    expect(invitationResponse.statusCode).toBe(201);
    const invitation = invitationResponse.json<InvitationResult>();

    oidcProvider.identity = providerIdentity("flow-member@example.test", "flow-member");
    const memberState = await startOidcFlow("/v1/auth/sign-in");
    const memberCallback = await oidcApp.inject({
      method: "GET",
      url: `/v1/auth/callback?code=member&state=${encodeURIComponent(memberState)}`
    });
    const memberCookie = extractCookie(memberCallback.headers["set-cookie"]);
    const accepted = await oidcApp.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: browserHeaders(memberCookie),
      payload: { token: invitation.token }
    });
    expect(accepted.statusCode).toBe(200);
    const membershipId = accepted.json<{ membership: { id: string } }>().membership.id;

    const members = await oidcApp.inject({
      method: "GET",
      url: "/v1/organizations/current/members",
      headers: { cookie: ownerCookie }
    });
    expect(members.statusCode).toBe(200);
    expect(members.json<{ members: unknown[] }>().members).toHaveLength(2);
    expect(
      (
        await oidcApp.inject({
          method: "PATCH",
          url: `/v1/organizations/current/members/${membershipId}/role`,
          headers: browserHeaders(ownerCookie),
          payload: { role: "ACCOUNTANT" }
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await oidcApp.inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: memberCookie }
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await oidcApp.inject({
          method: "POST",
          url: `/v1/organizations/current/members/${membershipId}/revoke`,
          headers: browserHeaders(ownerCookie),
          payload: {}
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await oidcApp.inject({
          method: "POST",
          url: "/v1/auth/sign-out",
          headers: browserHeaders(ownerCookie),
          payload: {}
        })
      ).statusCode
    ).toBe(200);
  });
});

async function createOrganization(email: string, displayName: string): Promise<string> {
  const response = await developmentApp.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: devHeaders(email),
    payload: organizationPayload(displayName)
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

function organizationPayload(displayName: string) {
  return { legalName: `${displayName} Legal`, displayName };
}

async function createInvitation(
  organizationId: string,
  ownerEmail: string,
  email: string,
  role: MembershipRole
): Promise<InvitationResult> {
  const response = await developmentApp.inject({
    method: "POST",
    url: "/v1/organizations/current/invitations",
    headers: devHeaders(ownerEmail, organizationId),
    payload: { email, role }
  });
  expect(response.statusCode).toBe(201);
  return response.json<InvitationResult>();
}

function acceptInvitation(email: string, token: string) {
  return developmentApp.inject({
    method: "POST",
    url: "/v1/invitations/accept",
    headers: devHeaders(email),
    payload: { token }
  });
}

async function membershipFor(organizationId: string, email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return prisma.membership.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId, userId: user.id } }
  });
}

async function createVerifiedUser(email: string) {
  return prisma.user.create({
    data: { email, emailVerifiedAt: new Date(), displayName: email }
  });
}

async function createSession(
  userId: string,
  activeOrganizationId: string | null = null,
  mfaAuthenticated = true
) {
  return withRuntimeTransaction(prisma, userId, (tx) =>
    sessions.createSession(tx, userId, new Date(), mfaAuthenticated, activeOrganizationId)
  );
}

function devHeaders(email: string, organizationId?: string, extra: Record<string, string> = {}) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...extra
  };
}

function browserHeaders(cookie: string) {
  return { cookie, origin: "http://localhost:3000" };
}

function cookiePair(token: string, expiresAt: Date): string {
  return sessionCookie(token, expiresAt).split(";", 1)[0]!;
}

function extractCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0]!;
}

async function startOidcFlow(path: string): Promise<string> {
  const response = await oidcApp.inject({ method: "GET", url: path });
  expect(response.statusCode).toBe(302);
  const location = response.headers.location;
  if (!location) throw new Error("Expected an OIDC redirect.");
  return new URL(location).searchParams.get("state")!;
}

async function runtimeAccountCount(organizationId: string | null, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${actorUserId}, true)`;
    return tx.account.count();
  });
}

async function runtimeCreateAccount(
  contextOrganizationId: string,
  recordOrganizationId: string,
  actorUserId: string
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${contextOrganizationId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${actorUserId}, true)`;
    return tx.account.create({
      data: {
        organizationId: recordOrganizationId,
        code: "CROSS",
        name: "Cross tenant",
        type: "ASSET"
      }
    });
  });
}

async function runtimeBootstrapProbe(organizationId: string, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    await setRuntimeContext(tx, organizationId, actorUserId, "organization_bootstrap");
    const selected = await tx.organization.count({ where: { id: organizationId } });
    const updated = await tx.organization.updateMany({
      where: { id: organizationId },
      data: { displayName: "Unauthorized bootstrap update" }
    });
    const companyUpdated = await tx.company.updateMany({
      where: { organizationId },
      data: { displayName: "Unauthorized bootstrap company update" }
    });
    const settingsUpdated = await tx.organizationSettings.updateMany({
      where: { organizationId },
      data: { businessType: "UNAUTHORIZED_BOOTSTRAP" }
    });
    const workflowPreferencesUpdated = await tx.workflowPreferences.updateMany({
      where: { organizationId },
      data: { profileKey: "UNAUTHORIZED_BOOTSTRAP" }
    });
    return {
      selected,
      updated: updated.count,
      companyUpdated: companyUpdated.count,
      settingsUpdated: settingsUpdated.count,
      workflowPreferencesUpdated: workflowPreferencesUpdated.count
    };
  });
}

async function runtimeBootstrapOwnerInsert(organizationId: string, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    await setRuntimeContext(tx, organizationId, actorUserId, "organization_bootstrap");
    return tx.membership.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: actorUserId,
        role: "OWNER",
        status: "ACTIVE"
      }
    });
  });
}

async function setRuntimeContext(
  tx: RuntimeTransaction,
  organizationId: string,
  actorUserId: string,
  accessMode: string
) {
  await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${actorUserId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.access_mode', ${accessMode}, true)`;
  await tx.$executeRaw`SELECT set_config('app.invitation_token_hash', '', true)`;
}

function providerIdentity(email: string, subject: string): VerifiedOidcIdentity {
  return {
    issuer: "https://identity.example.test",
    subject,
    email,
    emailVerified: true,
    displayName: email,
    authenticatedAt: new Date(),
    mfaAuthenticated: true
  };
}

class MockOidcProvider implements OidcProvider {
  public readonly issuer = "https://identity.example.test";
  public identity = providerIdentity("default@example.test", "default-subject");
  public lastAuthorization: OidcAuthorizationInput | null = null;

  public authorizationUrl(input: OidcAuthorizationInput): Promise<string> {
    this.lastAuthorization = input;
    return Promise.resolve(
      `https://identity.example.test/authorize?state=${encodeURIComponent(input.state)}`
    );
  }

  public exchangeCode(): Promise<VerifiedOidcIdentity> {
    return Promise.resolve(this.identity);
  }

  public endSessionUrl(returnTo: string): Promise<string> {
    return Promise.resolve(
      `https://identity.example.test/logout?returnTo=${encodeURIComponent(returnTo)}`
    );
  }

  public reset(): void {
    this.identity = providerIdentity("default@example.test", "default-subject");
    this.lastAuthorization = null;
  }
}
