import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "follow-up-owner@example.test";

function headers(organizationId: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Follow-up owner",
    "x-clearledger-organization-id": organizationId
  };
}

async function setupOrganization() {
  const created = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { "x-clearledger-user-email": owner },
    payload: { legalName: "Follow-up Ltd", displayName: "Follow-up" }
  });
  expect(created.statusCode).toBe(201);
  const organizationId = created.json<{ organization: { id: string } }>().organization.id;
  const setup = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/setup/profile",
        headers: headers(organizationId),
        payload: {
          version,
          legalName: "Follow-up Ltd",
          displayName: "Follow-up",
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
  return organizationId;
}

describe("receivables follow-up and statements", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma), 30_000);
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  }, 30_000);

  it("records a manual reminder and downloads an accurate statement PDF", async () => {
    const organizationId = await setupOrganization();
    const accounts = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: headers(organizationId)
    });
    const sales = accounts
      .json<{ accounts: Array<{ id: string; systemPurpose: string | null }> }>()
      .accounts.find((account) => account.systemPurpose === "professional-services");
    expect(sales).toBeDefined();
    const customer = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        displayName: "Statement customer",
        email: "customer@example.test",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    });
    const customerId = customer.json<{ customer: { id: string } }>().customer.id;
    const product = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: headers(organizationId),
      payload: {
        name: "Follow-up service",
        itemType: "SERVICE",
        salesPriceMinor: "1000",
        incomeAccountId: sales!.id
      }
    });
    const productId = product.json<{ product: { id: string } }>().product.id;
    const draft = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId),
      payload: {
        customerId,
        issueDate: "2026-08-01",
        dueDate: "2026-08-01",
        lines: [{ productItemId: productId, quantity: "1" }]
      }
    });
    expect(draft.statusCode).toBe(201);
    const draftInvoice = draft.json<{ invoice: { id: string; version: number } }>().invoice;
    const posted = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draftInvoice.id}/post`,
      headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
      payload: { version: draftInvoice.version }
    });
    expect(posted.statusCode).toBe(201);

    const overdue = await app.inject({
      method: "GET",
      url: "/v1/receivables/follow-up?asOf=2026-09-11",
      headers: headers(organizationId)
    });
    expect(overdue.statusCode).toBe(200);
    expect(
      overdue.json<{ invoices: Array<{ invoiceId: string; ageDays: number }> }>().invoices
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ invoiceId: draftInvoice.id, ageDays: 41 })])
    );
    const reminder = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draftInvoice.id}/manual-reminder`,
      headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
      payload: {
        recipientEmail: "customer@example.test",
        subject: "Reminder",
        message: "Please pay."
      }
    });
    expect(reminder.statusCode).toBe(201);
    const history = await app.inject({
      method: "GET",
      url: `/v1/invoices/${draftInvoice.id}/delivery-history`,
      headers: headers(organizationId)
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<{ deliveries: Array<{ status: string }> }>().deliveries[0]?.status).toBe(
      "MANUAL"
    );

    const report = await app.inject({
      method: "GET",
      url: `/v1/reports/receivables/customers/${customerId}/statement?from=2026-08-01&to=2026-09-11&type=ACTIVITY`,
      headers: headers(organizationId)
    });
    expect(report.statusCode).toBe(200);
    expect(
      report.json<{ report: { closingBalanceMinor: string } }>().report.closingBalanceMinor
    ).toBe("1000");
    const pdf = await app.inject({
      method: "GET",
      url: `/v1/reports/receivables/customers/${customerId}/statement.pdf?from=2026-08-01&to=2026-09-11&type=OPEN_ITEM`,
      headers: headers(organizationId)
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const current = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}`,
      headers: headers(organizationId)
    });
    const version = current.json<{ customer: { version: number } }>().customer.version;
    const suppressed = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerId}`,
      headers: headers(organizationId),
      payload: { version, reminderDisabled: true }
    });
    expect(suppressed.statusCode).toBe(200);
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draftInvoice.id}/manual-reminder`,
      headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
      payload: { recipientEmail: "customer@example.test" }
    });
    expect(blocked.statusCode).toBe(409);
  }, 30_000);
});
