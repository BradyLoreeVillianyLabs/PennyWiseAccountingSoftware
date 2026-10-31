import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import {
  DevelopmentEmailProvider,
  InvoiceDocumentService,
  type DocumentStorage,
  type EmailProvider
} from "./services/invoice-document-service.js";
import type { OrganizationContext } from "@clearledger/shared";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

class MemoryStorage implements DocumentStorage {
  private readonly values = new Map<string, Buffer>();

  public put(key: string, data: Buffer): Promise<void> {
    if (!this.values.has(key)) this.values.set(key, Buffer.from(data));
    return Promise.resolve();
  }

  public get(key: string): Promise<Buffer> {
    const value = this.values.get(key);
    if (!value) throw new Error(`Missing test storage key ${key}`);
    return Promise.resolve(Buffer.from(value));
  }
}

class FlakyEmailProvider implements EmailProvider {
  public attempts = 0;

  public send(): Promise<{ readonly providerMessageId: string }> {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error("temporary provider failure");
    return Promise.resolve({ providerMessageId: `flaky-${this.attempts.toString()}` });
  }
}

const storage = new MemoryStorage();
const emailProvider = new DevelopmentEmailProvider();
const app = buildApp({ prisma, documentStorage: storage, emailProvider });
const owner = "phase5-owner@example.test";

function headers(organizationId?: string, email = owner, key?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

async function createOrganization(email = owner) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(undefined, email),
    payload: { legalName: "Phase Five Ltd", displayName: "Phase Five" }
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
          legalName: "Phase Five Ltd",
          displayName: "Phase Five",
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
        headers: headers(organizationId, owner, randomUUID()),
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

async function invoiceFixture(organizationId: string) {
  const accounts = (
    await app.inject({ method: "GET", url: "/v1/accounts", headers: headers(organizationId) })
  ).json<{
    accounts: Array<{ id: string; systemPurpose: string | null }>;
  }>().accounts;
  const revenue = accounts.find((account) => account.systemPurpose === "professional-services")!;
  const customer = (
    await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "C-001",
        displayName: "<Buyer> & Co",
        email: "buyer@example.test",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    })
  ).json<{ customer: { id: string } }>().customer;
  const product = (
    await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: headers(organizationId),
      payload: {
        sku: "SERVICE-001",
        name: "Consulting",
        itemType: "SERVICE",
        salesPriceMinor: "1000",
        incomeAccountId: revenue.id
      }
    })
  ).json<{ product: { id: string } }>().product;
  const draft = (
    await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId),
      payload: {
        customerId: customer.id,
        issueDate: "2026-03-15",
        customerFacingNotes: "<script>internal? no</script>",
        internalNotes: "Private reviewer note",
        terms: "Pay promptly.",
        lines: [
          {
            productItemId: product.id,
            quantity: "1",
            unitPriceMinor: "1000",
            description: "<b>unsafe description</b>"
          }
        ]
      }
    })
  ).json<{ invoice: { id: string; version: number } }>().invoice;
  return { customer, product, draft };
}

beforeAll(async () => {
  await prisma.$connect();
  await app.ready();
});
beforeEach(async () => resetDatabase(prisma));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Phase 5 database-backed invoice documents", () => {
  it("snapshots render data, generates reproducible PDFs, and binds idempotency payloads", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const templates = await app.inject({
      method: "GET",
      url: "/v1/invoice-templates",
      headers: headers(organizationId)
    });
    expect(templates.statusCode).toBe(200);
    const templateResult = templates.json<{
      templates: Array<{ key: string; defaultConfiguration: Record<string, unknown> }>;
    }>();
    expect(templateResult.templates).toHaveLength(8);
    const selected = templateResult.templates[0]!;
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/organizations/current/invoice-template",
      headers: headers(organizationId),
      payload: {
        templateKey: selected.key,
        configuration: { ...selected.defaultConfiguration, primaryColor: "#1f4e79" }
      }
    });
    expect(saved.statusCode).toBe(200);
    const fixture = await invoiceFixture(organizationId);
    const attachment = await app.inject({
      method: "POST",
      url: `/v1/invoices/${fixture.draft.id}/attachments`,
      headers: {
        ...headers(organizationId),
        "content-type": "text/plain",
        "x-file-name": "note.txt"
      },
      payload: Buffer.from("customer attachment")
    });
    if (attachment.statusCode !== 201)
      throw new Error(`Attachment failed: ${String(attachment.statusCode)} ${attachment.body}`);
    const attachmentId = attachment.json<{ attachment: { id: string } }>().attachment.id;
    const posted = await app.inject({
      method: "POST",
      url: `/v1/invoices/${fixture.draft.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: fixture.draft.version }
    });
    expect(posted.statusCode).toBe(201);
    const postedInvoice = posted.json<{
      invoice: { renderDataHash: string; templateKey: string };
    }>().invoice;
    expect(postedInvoice.templateKey).toBe(selected.key);
    expect(postedInvoice.renderDataHash).toMatch(/^[0-9a-f]{64}$/);
    const pdfKey = randomUUID();
    const pdfResponses = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/invoices/${fixture.draft.id}/pdf`,
          headers: headers(organizationId, owner, pdfKey),
          payload: {}
        })
      )
    );
    expect(pdfResponses.map((response) => response.statusCode).sort()).toEqual([201, 201]);
    expect(await prisma.invoicePdfArtifact.count({ where: { organizationId } })).toBe(1);
    const pdf = await app.inject({
      method: "GET",
      url: `/v1/invoices/${fixture.draft.id}/pdf`,
      headers: headers(organizationId)
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["cache-control"]).toBe("private, no-store");
    expect(pdf.body.slice(0, 8)).toContain("%PDF-1.7");
    const preview = await app.inject({
      method: "GET",
      url: `/v1/invoices/${fixture.draft.id}/preview`,
      headers: headers(organizationId)
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain("&lt;script&gt;");
    expect(preview.body).not.toContain("Private reviewer note");
    expect(
      await prisma.invoiceAttachment.findUniqueOrThrow({ where: { id: attachmentId } })
    ).toMatchObject({ scanStatus: "CLEAN", fileName: "note.txt" });
  });

  it("queues duplicate sends once, records events, and isolates public links", async () => {
    const organizationId = await createOrganization();
    const otherOrganizationId = await createOrganization("phase5-other@example.test");
    await configure(organizationId);
    const fixture = await invoiceFixture(organizationId);
    const attachment = await app.inject({
      method: "POST",
      url: `/v1/invoices/${fixture.draft.id}/attachments`,
      headers: {
        ...headers(organizationId),
        "content-type": "text/plain",
        "x-file-name": "public.txt"
      },
      payload: Buffer.from("customer attachment")
    });
    expect(attachment.statusCode).toBe(201);
    const posted = await app.inject({
      method: "POST",
      url: `/v1/invoices/${fixture.draft.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: fixture.draft.version }
    });
    expect(posted.statusCode).toBe(201);
    const sendKey = randomUUID();
    const sends = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/invoices/${fixture.draft.id}/send`,
          headers: headers(organizationId, owner, sendKey),
          payload: { recipientEmail: "buyer@example.test", subject: "Invoice" }
        })
      )
    );
    if (sends.some((response) => response.statusCode !== 202))
      throw new Error(
        sends.map((response) => `${String(response.statusCode)} ${response.body}`).join(" | ")
      );
    const deliveryId = sends[0].json<{ delivery: { id: string } }>().delivery.id;
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
    const flakyProvider = new FlakyEmailProvider();
    const dispatchService = new InvoiceDocumentService(prisma, storage, flakyProvider);
    await expect(
      dispatchService.dispatchDelivery(dispatchContext, deliveryId)
    ).rejects.toMatchObject({
      code: "INVOICE_EMAIL_FAILED",
      statusCode: 502
    });
    expect(
      await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    ).toMatchObject({ status: "FAILED", attempts: 1 });
    await dispatchService.dispatchDelivery(dispatchContext, deliveryId);
    expect(
      await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    ).toMatchObject({ status: "SENT", attempts: 2 });
    expect(flakyProvider.attempts).toBe(2);
    expect(await prisma.invoiceDeliveryEvent.count({ where: { deliveryId } })).toBe(3);
    expect(await prisma.invoiceDelivery.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.invoiceDeliveryEvent.count({ where: { organizationId } })).toBe(3);
    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/invoices/${fixture.draft.id}/send`,
      headers: headers(organizationId, owner, sendKey),
      payload: { recipientEmail: "other@example.test", subject: "Invoice" }
    });
    expect(mismatch.statusCode).toBe(409);
    const linkResponse = await app.inject({
      method: "POST",
      url: `/v1/invoices/${fixture.draft.id}/public-link`,
      headers: headers(organizationId),
      payload: {}
    });
    expect(linkResponse.statusCode).toBe(201);
    const issued = linkResponse.json<{
      link: { link: { id: string }; token: string; publicUrl: string };
    }>().link;
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await prisma.publicInvoiceLink.findUniqueOrThrow({
      where: { id: issued.link.id }
    });
    expect(stored.tokenHash).not.toBe(issued.token);
    const publicView = await app.inject({ method: "GET", url: issued.publicUrl });
    expect(publicView.statusCode).toBe(200);
    expect(publicView.headers["x-robots-tag"]).toContain("noindex");
    expect(publicView.headers["cache-control"]).toBe("private, no-store");
    expect(publicView.body).not.toContain("Private reviewer note");
    const publicPdf = await app.inject({ method: "GET", url: `${issued.publicUrl}/pdf` });
    expect(publicPdf.statusCode).toBe(200);
    const publicAttachment = await app.inject({
      method: "GET",
      url: `${issued.publicUrl}/attachments/${attachment.json<{ attachment: { id: string } }>().attachment.id}`
    });
    expect(publicAttachment.statusCode).toBe(200);
    expect(publicAttachment.body).toBe("customer attachment");
    const otherAccess = await app.inject({
      method: "GET",
      url: `/v1/invoices/${fixture.draft.id}/pdf`,
      headers: headers(otherOrganizationId, "phase5-other@example.test")
    });
    expect(otherAccess.statusCode).toBe(404);
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/invoices/${fixture.draft.id}/public-links/${issued.link.id}/revoke`,
      headers: headers(organizationId),
      payload: {}
    });
    expect(revoked.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: issued.publicUrl })).statusCode).toBe(404);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId, action: { startsWith: "PUBLIC_INVOICE" } }
      })
    ).toBeGreaterThanOrEqual(3);
  });
});
