import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { DevelopmentEmailProvider } from "./services/invoice-document-service.js";
import { EstimateEmailService } from "./services/estimate-email-service.js";
import type { OrganizationContext } from "@clearledger/shared";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
// Email delivery is deliberately unavailable unless a provider is configured.
// This workflow test exercises a configured, non-production delivery path.
const app = buildApp({ prisma, emailProvider: new DevelopmentEmailProvider() });
const owner = "phase17-owner@example.test";

function headers(organizationId?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Phase 17 Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function createOrganization() {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "Phase 17 Ltd", displayName: "Phase 17" }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configure(organizationId: string) {
  const state = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/setup/profile",
        headers: headers(organizationId),
        payload: {
          version,
          legalName: "Phase 17 Ltd",
          displayName: "Phase 17",
          locale: "en-CA",
          timeZone: "America/Edmonton",
          baseCurrency: "CAD",
          fiscalYearEndMonth: 12,
          fiscalYearEndDay: 31,
          accountingStartDate: "2026-01-01"
        }
      })
    ).statusCode
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/presets/general-service/apply",
        headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
        payload: {}
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/fiscal-year/initialize",
        headers: headers(organizationId),
        payload: {}
      })
    ).statusCode
  ).toBe(200);
}

describe("Phase 17 sales automation", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("keeps estimates non-posting and converts an accepted version exactly once", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const customer = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "C-017",
        displayName: "Estimate Customer",
        email: "customer@example.test",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    });
    expect(customer.statusCode).toBe(201);
    const customerId = customer.json<{ customer: { id: string } }>().customer.id;
    const draft = await app.inject({
      method: "POST",
      url: "/v1/estimates",
      headers: headers(organizationId),
      payload: {
        customerId,
        issueDate: "2026-07-25",
        lines: [{ description: "Consulting", quantity: "1", unitPriceMinor: "1000" }]
      }
    });
    expect(draft.statusCode).toBe(201);
    const estimate = draft.json<{
      estimate: { id: string; estimateNumber: string; version: number; status: string };
    }>().estimate;
    expect(estimate.status).toBe("DRAFT");
    expect(estimate.estimateNumber).toBe("EST-0001");
    const estimatePreview = await app.inject({
      method: "GET",
      url: `/v1/estimates/${estimate.id}/preview`,
      headers: headers(organizationId)
    });
    expect(estimatePreview.statusCode).toBe(200);
    expect(estimatePreview.json<{ html: string }>().html).toContain("Estimate EST-0001");
    expect(estimatePreview.json<{ html: string }>().html).not.toContain("ESTIMATE-DRAFT-");
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
    const accepted = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/send`,
      headers: headers(organizationId),
      payload: { version: estimate.version }
    });
    expect(accepted.statusCode).toBe(200);
    const queuedEmail = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/email`,
      headers: { ...headers(organizationId), "idempotency-key": "phase17-estimate-email-1" },
      payload: { message: "Please review the attached proposal." }
    });
    expect(queuedEmail.statusCode).toBe(202);
    const queuedEmailBody = queuedEmail.json<{
      delivery: { id: string; status: string; recipientEmail: string };
      publicUrl: string;
    }>();
    expect(queuedEmailBody.delivery.status).toBe("QUEUED");
    expect(queuedEmailBody.delivery.recipientEmail).toBe("customer@example.test");
    expect(queuedEmailBody.publicUrl).toContain("/public/estimates/");
    const queuedEmailReplay = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/email`,
      headers: { ...headers(organizationId), "idempotency-key": "phase17-estimate-email-1" },
      payload: { message: "Please review the attached proposal." }
    });
    expect(queuedEmailReplay.statusCode).toBe(202);
    expect(queuedEmailReplay.json<{ delivery: { id: string } }>().delivery.id).toBe(
      queuedEmailBody.delivery.id
    );
    expect(
      await prisma.estimateDelivery.count({ where: { organizationId, estimateId: estimate.id } })
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { organizationId, eventType: "estimate.email.queued" }
      })
    ).toBe(1);
    const ownerRecord = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId: ownerRecord.id } }
    });
    const dispatchContext: OrganizationContext = {
      requestId: randomUUID(),
      user: {
        id: ownerRecord.id,
        email: ownerRecord.email,
        displayName: ownerRecord.displayName,
        emailVerifiedAt: ownerRecord.emailVerifiedAt
      },
      organizationId,
      membershipId: membership.id,
      role: "OWNER",
      sessionId: null,
      recentAuthAt: new Date(),
      mfaAuthenticated: false,
      authenticationMethod: "DEVELOPMENT",
      auditOrigin: { ipAddress: null, userAgent: null }
    };
    const emailProvider = new DevelopmentEmailProvider();
    const estimateEmailService = new EstimateEmailService(prisma, emailProvider);
    const sent = await estimateEmailService.dispatchDelivery(
      dispatchContext,
      queuedEmailBody.delivery.id
    );
    expect(sent.status).toBe("SENT");
    expect(emailProvider.sent[0]?.estimateId).toBe(estimate.id);
    expect(emailProvider.sent[0]?.message).toContain("/public/estimates/");
    const issuedLink = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/public-link`,
      headers: headers(organizationId),
      payload: {}
    });
    expect(issuedLink.statusCode).toBe(201);
    const issued = issuedLink.json<{ link: { publicUrl: string; link: { id: string } } }>().link;
    const publicUrl = issued.publicUrl;
    const publicView = await app.inject({ method: "GET", url: publicUrl });
    expect(publicView.statusCode).toBe(200);
    expect(publicView.headers["cache-control"]).toBe("private, no-store");
    expect(publicView.body).toContain("Accept estimate");
    expect(publicView.body).toContain("Consulting");
    const publicAccept = await app.inject({ method: "POST", url: `${publicUrl}/accept` });
    expect(publicAccept.statusCode).toBe(200);
    expect(publicAccept.body).toContain("has been accepted");
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/public-links/${issued.link.id}/revoke`,
      headers: headers(organizationId)
    });
    expect(revoked.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: publicUrl })).statusCode).toBe(404);
    const acceptedEstimateResponse = await app.inject({
      method: "GET",
      url: `/v1/estimates/${estimate.id}`,
      headers: headers(organizationId)
    });
    expect(acceptedEstimateResponse.statusCode).toBe(200);
    const acceptedEstimate = acceptedEstimateResponse.json<{
      estimate: { version: number; status: string };
    }>().estimate;
    expect(acceptedEstimate.status).toBe("ACCEPTED");
    const converted = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/convert`,
      headers: headers(organizationId),
      payload: { version: acceptedEstimate.version }
    });
    expect(converted.statusCode).toBe(201);
    const invoiceId = converted.json<{ invoiceId: string }>().invoiceId;
    const replay = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/convert`,
      headers: headers(organizationId),
      payload: { version: acceptedEstimate.version }
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ invoiceId: string }>().invoiceId).toBe(invoiceId);
    expect(
      await prisma.invoice.count({ where: { organizationId, sourceEstimateId: estimate.id } })
    ).toBe(1);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("allocates short estimate numbers atomically and protects a custom number after creation", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const customer = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "C-018",
        displayName: "Numbered Estimate Customer",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    });
    const customerId = customer.json<{ customer: { id: string } }>().customer.id;
    const payload = {
      customerId,
      issueDate: "2026-07-25",
      lines: [{ description: "Numbered consulting", quantity: "1", unitPriceMinor: "1000" }]
    };
    const [first, second] = await Promise.all(
      ["estimate-number-1", "estimate-number-2"].map((idempotencyKey) =>
        app.inject({
          method: "POST",
          url: "/v1/estimates",
          headers: { ...headers(organizationId), "idempotency-key": idempotencyKey },
          payload
        })
      )
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(
      [
        first.json<{ estimate: { estimateNumber: string } }>().estimate.estimateNumber,
        second.json<{ estimate: { estimateNumber: string } }>().estimate.estimateNumber
      ].sort()
    ).toEqual(["EST-0001", "EST-0002"]);

    const custom = await app.inject({
      method: "POST",
      url: "/v1/estimates",
      headers: headers(organizationId),
      payload: { ...payload, estimateNumber: "QUOTE-2026-ALPHA" }
    });
    expect(custom.statusCode).toBe(201);
    const customEstimate = custom.json<{
      estimate: { id: string; estimateNumber: string; version: number };
    }>().estimate;
    expect(customEstimate.estimateNumber).toBe("QUOTE-2026-ALPHA");

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/estimates",
      headers: headers(organizationId),
      payload: { ...payload, estimateNumber: "QUOTE-2026-ALPHA" }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe(
      "ESTIMATE_NUMBER_DUPLICATE"
    );

    const updateAttempt = await app.inject({
      method: "PATCH",
      url: `/v1/estimates/${customEstimate.id}`,
      headers: headers(organizationId),
      payload: { ...payload, estimateNumber: "CHANGED", version: customEstimate.version }
    });
    expect(updateAttempt.statusCode).toBe(400);
  });

  it("keeps migration and commercial control-plane state versioned and non-posting", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const created = await app.inject({
      method: "POST",
      url: "/v1/migration-runs",
      headers: headers(organizationId),
      payload: {
        sourceSystem: "legacy-books",
        entries: [
          { entity: "accounts", source: "chart.csv", rowCount: 10, supported: true },
          {
            entity: "historicalArchive",
            source: "archive.zip",
            rowCount: 3,
            supported: false,
            unsupportedReason: "Archive is retained for review only."
          }
        ]
      }
    });
    expect(created.statusCode).toBe(201);
    const run = created.json<{ run: { id: string; version: number; status: string } }>().run;
    expect(run.status).toBe("DRAFT");
    const validated = await app.inject({
      method: "POST",
      url: `/v1/migration-runs/${run.id}/transition`,
      headers: headers(organizationId),
      payload: { status: "VALIDATED", version: run.version }
    });
    expect(validated.statusCode).toBe(200);
    const validatedRun = validated.json<{ run: { version: number } }>().run;
    const running = await app.inject({
      method: "POST",
      url: `/v1/migration-runs/${run.id}/transition`,
      headers: headers(organizationId),
      payload: { status: "RUNNING", version: validatedRun.version }
    });
    expect(running.statusCode).toBe(200);
    const runningRun = running.json<{ run: { version: number } }>().run;
    const completed = await app.inject({
      method: "POST",
      url: `/v1/migration-runs/${run.id}/transition`,
      headers: headers(organizationId),
      payload: { status: "COMPLETED", version: runningRun.version }
    });
    expect(completed.statusCode).toBe(200);

    const provisioned = await app.inject({
      method: "POST",
      url: "/v1/commercial/subscription",
      headers: headers(organizationId),
      payload: { planCode: "starter", entitlements: ["invoices:create", "invoices:create"] }
    });
    expect(provisioned.statusCode).toBe(200);
    const subscription = provisioned.json<{ subscription: { version: number; status: string } }>()
      .subscription;
    expect(subscription.status).toBe("TRIALING");
    const active = await app.inject({
      method: "POST",
      url: "/v1/commercial/subscription/transition",
      headers: headers(organizationId),
      payload: { status: "ACTIVE", version: subscription.version }
    });
    expect(active.statusCode).toBe(200);
    expect(
      active.json<{ subscription: { entitlements: string[] } }>().subscription.entitlements
    ).toEqual(["invoices:create"]);
    const eventPayload = {
      providerEventId: "evt_1",
      eventType: "subscription.updated",
      payload: { status: "active" }
    };
    const firstEvent = await app.inject({
      method: "POST",
      url: "/v1/commercial/events",
      headers: headers(organizationId),
      payload: eventPayload
    });
    const replayEvent = await app.inject({
      method: "POST",
      url: "/v1/commercial/events",
      headers: headers(organizationId),
      payload: eventPayload
    });
    expect(firstEvent.statusCode).toBe(200);
    expect(replayEvent.statusCode).toBe(200);
    expect(replayEvent.json<{ event: { id: string } }>().event.id).toBe(
      firstEvent.json<{ event: { id: string } }>().event.id
    );
    expect(firstEvent.json<{ event: { provider: string } }>().event.provider).toBe("MANUAL");
    const impersonatedProvider = await app.inject({
      method: "POST",
      url: "/v1/commercial/events",
      headers: headers(organizationId),
      payload: { ...eventPayload, provider: "unverified-provider" }
    });
    expect(impersonatedProvider.statusCode).toBe(400);
    const providerSubscription = await app.inject({
      method: "POST",
      url: "/v1/commercial/subscription",
      headers: headers(organizationId),
      payload: {
        planCode: "starter",
        entitlements: [],
        provider: "unverified-provider"
      }
    });
    expect(providerSubscription.statusCode).toBe(400);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });
});
