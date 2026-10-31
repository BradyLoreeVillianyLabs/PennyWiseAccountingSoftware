import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type {
  EmailConnectionRuntimeConfig,
  EmailOAuthHttpClient
} from "./services/email-connection-service.js";
import { ConnectedMailboxEmailProvider } from "./services/connected-mailbox-email-provider.js";
import type { EmailMessage } from "./services/invoice-document-service.js";
import { AesPaymentAccountProtector } from "./services/payment-provider.js";
import { SmtpTransport, type SmtpConnectionInput } from "./services/smtp-email-provider.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const owner = "contracts-owner@example.test";
const runtimeConfig: EmailConnectionRuntimeConfig = {
  applicationUrl: null,
  providers: {
    GMAIL: {
      provider: "GMAIL",
      clientId: "gmail-client-id",
      clientSecret: "gmail-client-secret",
      authorizationEndpoint: "https://accounts.example.test/authorize",
      tokenEndpoint: "https://accounts.example.test/token",
      identityEndpoint: "https://mail.example.test/profile",
      redirectUri:
        "https://pennywise.example.test/api/v1/email-connections/callback?provider=GMAIL",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
      authorizationParameters: { access_type: "offline", prompt: "consent" }
    }
  }
};
const oauthHttpClient: EmailOAuthHttpClient = {
  exchangeToken(input) {
    expect(input.code).toBe("provider-code");
    expect(input.codeVerifier.length).toBeGreaterThan(40);
    return Promise.resolve({
      status: 200,
      body: {
        access_token: "opaque-access-token",
        refresh_token: "opaque-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/gmail.send"
      }
    });
  }
};
const smtpDeliveries: Array<{
  input: { host: string; port: number; tlsMode: string; fromAddress: string };
  recipient: string;
  subject: string;
}> = [];
const smtpTransport = {
  send(input: SmtpConnectionInput, message: EmailMessage) {
    smtpDeliveries.push({
      input: {
        host: input.host,
        port: input.port,
        tlsMode: input.tlsMode,
        fromAddress: input.fromAddress
      },
      recipient: message.to,
      subject: message.subject
    });
    return Promise.resolve({ providerMessageId: `smtp-fixture-${String(smtpDeliveries.length)}` });
  }
} as unknown as SmtpTransport;
const app = buildApp({
  prisma,
  emailConnectionConfig: runtimeConfig,
  emailConnectionCredentialProtector: new AesPaymentAccountProtector(
    "integration-test-email-connection-secret-2026"
  ),
  emailOAuthHttpClient: oauthHttpClient,
  emailDeliveryRuntime: { mode: "SMTP", enabled: true, reason: "ready" },
  smtpTransport
});

function headers(organizationId?: string, email = owner) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function createOrganization(email = owner) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(undefined, email),
    payload: { legalName: "Reliable Contracting Ltd", displayName: "Reliable Contracting" }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

beforeAll(async () => {
  await prisma.$connect();
  await app.ready();
});

beforeEach(async () => {
  smtpDeliveries.length = 0;
  await resetDatabase(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("contract documents and mailbox authorization", () => {
  it("keeps starter contracts tenant-scoped, review-gated, and immutable after ready", async () => {
    const organizationId = await createOrganization();
    const templates = await app.inject({
      method: "GET",
      url: "/v1/contracts/templates",
      headers: headers(organizationId)
    });
    expect(templates.statusCode).toBe(200);
    expect(
      templates.json<{ starters: Array<{ key: string; sourceUrl: string }> }>().starters
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "work-authorization",
          sourceUrl: "https://www.alberta.ca/hiring-contractor"
        })
      ])
    );

    const created = await app.inject({
      method: "POST",
      url: "/v1/contracts",
      headers: headers(organizationId),
      payload: { starterKey: "work-authorization", variableValues: {} }
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json<{ contract: ContractDocument }>().contract;
    expect(draft.status).toBe("DRAFT");
    expect(draft.renderedText).toContain("DRAFT");
    expect(draft.unresolvedVariables).toEqual(
      expect.arrayContaining(["Customer", "Work location", "Scope of work"])
    );

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/contracts/${draft.id}/ready`,
      headers: headers(organizationId),
      payload: { version: draft.version, legalReviewAcknowledged: true }
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe(
      "CONTRACT_VARIABLES_UNRESOLVED"
    );

    const completeValues = Object.fromEntries(
      draft.variableSchema
        .filter((definition) => definition.required)
        .map((definition) => [
          definition.key,
          definition.kind === "date"
            ? "2026-08-12"
            : definition.kind === "money"
              ? "1,250.00 CAD"
              : `${definition.label} confirmed`
        ])
    );
    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/contracts/${draft.id}`,
      headers: headers(organizationId),
      payload: { version: draft.version, variableValues: completeValues }
    });
    expect(updated.statusCode).toBe(200);
    const completeDraft = updated.json<{ contract: ContractDocument }>().contract;
    expect(completeDraft.unresolvedVariables).toEqual([]);

    const ready = await app.inject({
      method: "POST",
      url: `/v1/contracts/${draft.id}/ready`,
      headers: headers(organizationId),
      payload: { version: completeDraft.version, legalReviewAcknowledged: true }
    });
    expect(ready.statusCode).toBe(200);
    const readyContract = ready.json<{ contract: ContractDocument }>().contract;
    expect(readyContract.status).toBe("READY_FOR_REVIEW");
    expect(readyContract.legalReviewAcknowledgedAt).not.toBeNull();

    const immutable = await app.inject({
      method: "PATCH",
      url: `/v1/contracts/${draft.id}`,
      headers: headers(organizationId),
      payload: { version: readyContract.version, title: "Should not change" }
    });
    expect(immutable.statusCode).toBe(422);

    const secondOrganizationId = await createOrganization();
    const hidden = await app.inject({
      method: "GET",
      url: `/v1/contracts/${draft.id}`,
      headers: headers(secondOrganizationId)
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("uses OAuth state and PKCE, encrypts mailbox tokens, and removes them on disconnect", async () => {
    const organizationId = await createOrganization();
    const listed = await app.inject({
      method: "GET",
      url: "/v1/email-connections",
      headers: headers(organizationId)
    });
    expect(listed.statusCode).toBe(200);
    const providers = listed.json<{ providers: Array<{ provider: string; configured: boolean }> }>()
      .providers;
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "GMAIL", configured: true }),
        expect.objectContaining({ provider: "MICROSOFT", configured: false })
      ])
    );

    const started = await app.inject({
      method: "POST",
      url: "/v1/email-connections/GMAIL/authorize",
      headers: headers(organizationId),
      payload: {}
    });
    expect(started.statusCode).toBe(200);
    const authorization = started.json<{ authorizationUrl: string }>();
    const authorizationUrl = new URL(authorization.authorizationUrl);
    expect(authorizationUrl.hostname).toBe("accounts.example.test");
    expect(authorizationUrl.searchParams.get("state")).toHaveLength(43);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.authorizationUrl).not.toContain("code_verifier");

    const callback = await app.inject({
      method: "GET",
      url: `/v1/email-connections/callback?provider=GMAIL&state=${encodeURIComponent(authorizationUrl.searchParams.get("state") ?? "")}&code=provider-code`,
      headers: headers(organizationId)
    });
    expect(callback.statusCode).toBe(200);
    const connection = callback.json<{ connection: { id: string; status: string } }>().connection;
    expect(connection.status).toBe("CONNECTED");

    const stored = await prisma.emailConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId, provider: "GMAIL" } }
    });
    expect(stored.credentialCiphertext).not.toContain("opaque-access-token");
    expect(stored.credentialCiphertext).not.toContain("opaque-refresh-token");
    expect(stored.isDefaultSender).toBe(true);

    await prisma.emailConnection.update({
      where: { id: connection.id },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) }
    });
    const emailRequests: Array<{ url: string; body?: string }> = [];
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const mailbox = new ConnectedMailboxEmailProvider(
      prisma,
      runtimeConfig,
      new AesPaymentAccountProtector("integration-test-email-connection-secret-2026"),
      {
        request(input) {
          emailRequests.push({ url: input.url, body: input.body });
          if (input.url === "https://accounts.example.test/token") {
            return Promise.resolve({
              status: 200,
              body: {
                access_token: "fresh-access-token",
                refresh_token: "rotated-refresh-token",
                token_type: "Bearer",
                expires_in: 3600
              }
            });
          }
          return Promise.resolve({ status: 200, body: { id: "gmail-provider-message" } });
        }
      }
    );
    await expect(
      mailbox.send({
        organizationId,
        actorUserId: ownerUser.id,
        requestId: "email-connection-delivery-test",
        to: "buyer@example.test",
        subject: "Invoice 1001",
        message: "Your invoice is attached.",
        pdf: Buffer.from("pdf bytes")
      })
    ).resolves.toEqual({ providerMessageId: "gmail-provider-message" });
    expect(emailRequests.map((request) => request.url)).toEqual([
      "https://accounts.example.test/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ]);
    expect(emailRequests[1]?.body).toContain('"raw"');
    expect(
      (
        await prisma.emailConnection.findUniqueOrThrow({
          where: { organizationId_provider: { organizationId, provider: "GMAIL" } }
        })
      ).credentialCiphertext
    ).not.toContain("fresh-access-token");

    const defaulted = await app.inject({
      method: "POST",
      url: `/v1/email-connections/${connection.id}/default`,
      headers: headers(organizationId),
      payload: {}
    });
    expect(defaulted.statusCode).toBe(200);
    expect(
      defaulted.json<{ connection: { isDefaultSender: boolean } }>().connection.isDefaultSender
    ).toBe(true);

    const reused = await app.inject({
      method: "GET",
      url: `/v1/email-connections/callback?provider=GMAIL&state=${encodeURIComponent(authorizationUrl.searchParams.get("state") ?? "")}&code=provider-code`,
      headers: headers(organizationId)
    });
    expect(reused.statusCode).toBe(400);

    const secondOrganizationId = await createOrganization();
    const crossTenantDisconnect = await app.inject({
      method: "POST",
      url: `/v1/email-connections/${connection.id}/disconnect`,
      headers: headers(secondOrganizationId),
      payload: {}
    });
    expect(crossTenantDisconnect.statusCode).toBe(404);

    const disconnected = await app.inject({
      method: "POST",
      url: `/v1/email-connections/${connection.id}/disconnect`,
      headers: headers(organizationId),
      payload: {}
    });
    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json<{ connection: { status: string } }>().connection.status).toBe(
      "DISCONNECTED"
    );
    expect(
      (
        await prisma.emailConnection.findUniqueOrThrow({
          where: { organizationId_provider: { organizationId, provider: "GMAIL" } }
        })
      ).credentialCiphertext
    ).toBeNull();
  });

  it("tests and encrypts SMTP before saving it, then dispatches through the selected relay", async () => {
    const organizationId = await createOrganization();
    const configured = await app.inject({
      method: "POST",
      url: "/v1/email-connections/smtp",
      headers: headers(organizationId),
      payload: {
        host: "mail.fixture.test",
        port: 587,
        tlsMode: "STARTTLS",
        username: "fixture-user",
        password: "fixture-password",
        fromAddress: "sender@example.test",
        testRecipient: "owner@example.test"
      }
    });
    expect(configured.statusCode).toBe(201);
    expect(configured.json<{ testMessageId: string }>().testMessageId).toBe("smtp-fixture-1");
    expect(smtpDeliveries[0]).toEqual({
      input: {
        host: "mail.fixture.test",
        port: 587,
        tlsMode: "STARTTLS",
        fromAddress: "sender@example.test"
      },
      recipient: "owner@example.test",
      subject: "ClearLedger SMTP connection test"
    });
    const stored = await prisma.emailConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId, provider: "SMTP" } }
    });
    expect(stored.status).toBe("CONNECTED");
    expect(stored.isDefaultSender).toBe(true);
    expect(stored.credentialCiphertext).not.toContain("fixture-password");

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const mailbox = new ConnectedMailboxEmailProvider(
      prisma,
      runtimeConfig,
      new AesPaymentAccountProtector("integration-test-email-connection-secret-2026"),
      undefined,
      smtpTransport
    );
    await expect(
      mailbox.send({
        organizationId,
        actorUserId: ownerUser.id,
        requestId: "smtp-invoice-delivery-test",
        to: "buyer@example.test",
        subject: "Invoice 1002",
        message: "Your invoice is attached."
      })
    ).resolves.toEqual({ providerMessageId: "smtp-fixture-2" });
    expect(smtpDeliveries[1]).toMatchObject({
      recipient: "buyer@example.test",
      subject: "Invoice 1002",
      input: { host: "mail.fixture.test", tlsMode: "STARTTLS" }
    });
  });
});

interface ContractVariable {
  key: string;
  label: string;
  required: boolean;
  kind: "text" | "date" | "money";
}

interface ContractDocument {
  id: string;
  status: string;
  isDefaultSender: boolean;
  version: number;
  variableSchema: ContractVariable[];
  unresolvedVariables: string[];
  renderedText: string;
  legalReviewAcknowledgedAt: string | null;
}
