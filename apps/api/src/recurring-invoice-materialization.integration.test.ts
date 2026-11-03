import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "recurring-owner@example.test";

function headers(organizationId: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Recurring owner",
    "x-clearledger-organization-id": organizationId
  };
}

async function setupOrganization() {
  const created = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { "x-clearledger-user-email": owner },
    payload: { legalName: "Recurring invoices Ltd", displayName: "Recurring invoices" }
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
          legalName: "Recurring invoices Ltd",
          displayName: "Recurring invoices",
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
        headers: { ...headers(organizationId), "idempotency-key": "recurring-preset" },
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

describe("recurring invoice materialization", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma), 30_000);
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  }, 30_000);

  it("creates one draft per due occurrence and records history", async () => {
    const organizationId = await setupOrganization();
    const accounts = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: headers(organizationId)
    });
    const sales = accounts
      .json<{ accounts: Array<{ id: string; systemPurpose: string | null }> }>()
      .accounts.find((account) => account.systemPurpose === "sales");
    expect(sales).toBeDefined();
    const customer = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        displayName: "Recurring customer",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    });
    expect(customer.statusCode).toBe(201);
    const customerId = customer.json<{ customer: { id: string } }>().customer.id;
    const firstOccurrenceStartAt = new Date(Date.now() - 60_000).toISOString();
    const schedule = await app.inject({
      method: "POST",
      url: "/v1/recurring-schedules",
      headers: headers(organizationId),
      payload: {
        scheduleType: "INVOICE",
        customerId,
        frequency: "MONTH",
        interval: 1,
        timeZone: "America/Edmonton",
        startAt: firstOccurrenceStartAt,
        missedOccurrencePolicy: "EVERY",
        invoiceMode: "DRAFT",
        template: {
          currency: "CAD",
          paymentTermsDays: 30,
          lines: [
            {
              description: "Recurring service",
              quantity: "1",
              unitPriceMinor: "1000",
              discountMinor: "0",
              incomeAccountId: sales!.id
            }
          ]
        }
      }
    });
    expect(schedule.statusCode).toBe(201);
    const firstScheduleId = schedule.json<{ schedule: { id: string } }>().schedule.id;
    const runner = (
      app as typeof app & { automationRunner: { start(): Promise<void>; stop(): Promise<void> } }
    ).automationRunner;
    await runner.start();
    try {
      const first = await app.inject({
        method: "POST",
        url: "/v1/organizations/current/automations/recurring-invoice-generation/run",
        headers: headers(organizationId),
        payload: {}
      });
      expect(first.statusCode).toBe(202);
      const concurrent = await Promise.all([
        app.inject({
          method: "POST",
          url: "/v1/organizations/current/automations/recurring-invoice-generation/run",
          headers: headers(organizationId),
          payload: {}
        }),
        app.inject({
          method: "POST",
          url: "/v1/organizations/current/automations/recurring-invoice-generation/run",
          headers: headers(organizationId),
          payload: {}
        })
      ]);
      expect(concurrent.every((response) => response.statusCode === 202)).toBe(true);
      const invoices = await app.inject({
        method: "GET",
        url: "/v1/invoices",
        headers: headers(organizationId)
      });
      expect(invoices.statusCode).toBe(200);
      expect(
        invoices.json<{ invoices: Array<{ status: string; recurrenceIdempotencyKey?: string }> }>()
          .invoices
      ).toHaveLength(1);
      const listed = await app.inject({
        method: "GET",
        url: "/v1/recurring-schedules",
        headers: headers(organizationId)
      });
      const saved = listed.json<{
        schedules: Array<{ history: Array<{ status: string; outcome: string | null }> }>;
      }>().schedules[0];
      expect(saved.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "SUCCEEDED", outcome: "DRAFT_CREATED" })
        ])
      );

      const sendSchedule = await app.inject({
        method: "POST",
        url: "/v1/recurring-schedules",
        headers: headers(organizationId),
        payload: {
          scheduleType: "INVOICE",
          customerId,
          frequency: "MONTH",
          interval: 1,
          timeZone: "America/Edmonton",
          startAt: firstOccurrenceStartAt,
          invoiceMode: "SEND",
          template: {
            currency: "CAD",
            lines: [
              {
                description: "Email-gated service",
                quantity: "1",
                unitPriceMinor: "1000",
                discountMinor: "0",
                incomeAccountId: sales!.id
              }
            ]
          }
        }
      });
      expect(sendSchedule.statusCode).toBe(201);
      const sendRun = await app.inject({
        method: "POST",
        url: "/v1/organizations/current/automations/recurring-invoice-generation/run",
        headers: headers(organizationId),
        payload: {}
      });
      expect(sendRun.statusCode).toBe(202);
      const afterSend = await app.inject({
        method: "GET",
        url: "/v1/invoices",
        headers: headers(organizationId)
      });
      expect(afterSend.json<{ invoices: Array<{ status: string }> }>().invoices).toHaveLength(2);
      const sendHistory = (
        await app.inject({
          method: "GET",
          url: "/v1/recurring-schedules",
          headers: headers(organizationId)
        })
      )
        .json<{
          schedules: Array<{
            id: string;
            history: Array<{ status: string; outcome: string | null }>;
          }>;
        }>()
        .schedules.find((entry) => entry.id !== firstScheduleId);
      expect(sendHistory?.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "SUCCEEDED", outcome: "DRAFT_EMAIL_UNAVAILABLE" })
        ])
      );
    } finally {
      await runner.stop();
    }
  }, 30_000);
});
