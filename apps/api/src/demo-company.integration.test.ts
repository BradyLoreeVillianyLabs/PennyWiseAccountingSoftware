import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { demoCompanyAvailableForEnvironment } from "./services/demo-company-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "demo-company-owner@example.test";

function headers(email = owner, organizationId?: string, idempotencyKey?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
  };
}

async function createDemo(email = owner, key = randomUUID()) {
  return app.inject({
    method: "POST",
    url: "/v1/demo-company",
    headers: headers(email, undefined, key),
    payload: { templateKey: "canadian-service" }
  });
}

type DemoResponse = {
  demoCompany: {
    organizationId: string;
    displayName: string;
    created: boolean;
    reused: boolean;
    fictional: boolean;
    setupComplete: boolean;
    enabledCurrencies: string[];
    counts: {
      accounts: number;
      customers: number;
      vendors: number;
      products: number;
      bankAccounts: number;
      postedInvoices: number;
      draftInvoices: number;
      postedBills: number;
      postedJournals: number;
    };
    journalsBalanced: boolean;
  };
};

beforeAll(async () => {
  await prisma.$connect();
  await app.ready();
});

beforeEach(async () => resetDatabase(prisma));

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("fictional demo company", () => {
  it("is structurally disabled in production and available to test/local shares", () => {
    expect(demoCompanyAvailableForEnvironment("production")).toBe(false);
    expect(demoCompanyAvailableForEnvironment(" Production ")).toBe(false);
    expect(demoCompanyAvailableForEnvironment("test")).toBe(true);
    expect(demoCompanyAvailableForEnvironment(undefined)).toBe(true);
  });

  it("reports capability while requiring a verified interactive identity and idempotency key", async () => {
    const capability = await app.inject({
      method: "GET",
      url: "/v1/demo-company/capabilities"
    });
    expect(capability.statusCode).toBe(200);
    expect(capability.json()).toEqual({
      demoCompany: {
        available: true,
        templateKey: "canadian-service",
        fixtureVersion: 1,
        onePerUser: true,
        requiresIdempotencyKey: true,
        fictionalDataOnly: true
      }
    });

    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/demo-company",
      headers: { "idempotency-key": randomUUID() },
      payload: {}
    });
    expect(anonymous.statusCode).toBe(401);

    const missingKey = await app.inject({
      method: "POST",
      url: "/v1/demo-company",
      headers: headers(),
      payload: {}
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json<{ error: { code: string } }>().error.code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED"
    );

    const unverified = await app.inject({
      method: "POST",
      url: "/v1/demo-company",
      headers: {
        ...headers(owner, undefined, randomUUID()),
        "x-clearledger-email-verified": "false"
      },
      payload: {}
    });
    expect(unverified.statusCode).toBe(403);
  });

  it("creates a fully configured, obviously fictional CAD-first company through domain services", async () => {
    const response = await createDemo();
    expect(response.statusCode, response.body).toBe(201);
    const demo = response.json<DemoResponse>().demoCompany;
    expect(demo).toMatchObject({
      displayName: "Maple & Moss Demo Studio — Fictional",
      created: true,
      reused: false,
      fictional: true,
      setupComplete: true,
      enabledCurrencies: ["CAD", "USD"],
      counts: {
        customers: 10,
        vendors: 6,
        products: 20,
        bankAccounts: 1,
        postedInvoices: 7,
        draftInvoices: 1,
        totalInvoices: 12,
        paidInvoices: 3,
        partialInvoices: 1,
        postedBills: 6,
        totalBills: 9,
        paidBills: 3,
        customerContacts: 9,
        customerActivities: 9,
        timeEntries: 3,
        postedJournals: 28,
        payments: 4,
        billPayments: 3,
        payrollWorkers: 5,
        payrollRuns: 1,
        projects: 3
      },
      journalsBalanced: true
    });
    expect(demo.counts.accounts).toBeGreaterThanOrEqual(16);

    const [organization, settings, ownerMembership, journals, taxCode] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: demo.organizationId } }),
      prisma.organizationSettings.findUniqueOrThrow({
        where: { organizationId: demo.organizationId }
      }),
      prisma.membership.findFirstOrThrow({
        where: { organizationId: demo.organizationId, user: { email: owner } }
      }),
      prisma.journal.findMany({
        where: { organizationId: demo.organizationId, status: "POSTED" },
        include: { lines: true }
      }),
      prisma.taxCode.findUniqueOrThrow({
        where: {
          organizationId_code: { organizationId: demo.organizationId, code: "DEMO-GST" }
        }
      })
    ]);
    expect(organization.legalName).toContain("FICTIONAL DEMO");
    expect(organization.currency.trim()).toBe("CAD");
    expect(settings.setupCompletedAt).not.toBeNull();
    expect(settings.multiCurrencyEnabled).toBe(true);
    expect(ownerMembership).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    expect(taxCode.name).toContain("fictional fixture");
    expect(journals.length).toBeGreaterThanOrEqual(28);
    for (const journal of journals) {
      const debits = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
      const credits = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
      expect(debits).toBe(credits);
      expect(debits).toBeGreaterThan(0n);
    }
    const postedInvoice = await prisma.invoice.findFirstOrThrow({
      where: {
        organizationId: demo.organizationId,
        status: "POSTED",
        internalNotes: "CLEARLEDGER_DEMO_FIXTURE_V1_POSTED_INVOICE"
      }
    });
    const postedBill = await prisma.bill.findFirstOrThrow({
      where: {
        organizationId: demo.organizationId,
        status: "POSTED",
        vendorInvoiceNumber: "DEMO-BILL-001"
      }
    });
    expect(postedInvoice.grandTotalMinor).toBe(178_500n);
    expect(postedInvoice.taxTotalMinor).toBe(8_500n);
    expect(postedBill.grandTotalMinor).toBe(33_600n);
    expect(postedBill.recoverableTaxMinor).toBe(1_600n);
  });

  it("serializes two service instances, reuses one tenant, and isolates every user's fixture", async () => {
    const secondPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const secondApp = buildApp({ prisma: secondPrisma });
    await secondPrisma.$connect();
    await secondApp.ready();
    const [firstConcurrent, secondConcurrent] = await (async () => {
      try {
        return await Promise.all([
          createDemo(owner, "concurrent-demo-key-0001"),
          secondApp.inject({
            method: "POST",
            url: "/v1/demo-company",
            headers: headers(owner, undefined, "concurrent-demo-key-0002"),
            payload: { templateKey: "canadian-service" }
          })
        ]);
      } finally {
        await secondApp.close();
        await secondPrisma.$disconnect();
      }
    })();
    expect(
      [firstConcurrent.statusCode, secondConcurrent.statusCode].sort(),
      `${firstConcurrent.body}\n${secondConcurrent.body}`
    ).toEqual([200, 201]);
    const firstId = firstConcurrent.json<DemoResponse>().demoCompany.organizationId;
    expect(secondConcurrent.json<DemoResponse>().demoCompany.organizationId).toBe(firstId);

    const replay = await createDemo(owner, "a-different-repeat-key");
    expect(replay.statusCode, replay.body).toBe(200);
    const replayed = replay.json<DemoResponse>().demoCompany;
    expect(replayed).toMatchObject({
      organizationId: firstId,
      created: false,
      reused: true,
      journalsBalanced: true,
      counts: {
        customers: 10,
        vendors: 6,
        products: 20,
        bankAccounts: 1,
        postedInvoices: 7,
        draftInvoices: 1,
        totalInvoices: 12,
        paidInvoices: 3,
        partialInvoices: 1,
        postedBills: 6,
        totalBills: 9,
        paidBills: 3,
        customerContacts: 9,
        customerActivities: 9,
        timeEntries: 3,
        postedJournals: 28,
        payments: 4,
        billPayments: 3,
        payrollWorkers: 5,
        payrollRuns: 1,
        projects: 3
      }
    });
    expect(await prisma.organization.count({ where: { displayName: replayed.displayName } })).toBe(
      1
    );
    expect(
      await prisma.auditEvent.count({
        where: { organizationId: firstId, action: "DEMO_COMPANY_SEEDED" }
      })
    ).toBe(1);

    await prisma.organization.update({
      where: { id: firstId },
      data: { displayName: "Renamed fictional demo company" }
    });
    const renamedReplay = await createDemo(owner, "rename-safe-repeat-key");
    expect(renamedReplay.statusCode, renamedReplay.body).toBe(200);
    expect(renamedReplay.json<DemoResponse>().demoCompany).toMatchObject({
      organizationId: firstId,
      displayName: "Renamed fictional demo company",
      reused: true
    });

    const otherEmail = "other-demo-owner@example.test";
    const denied = await app.inject({
      method: "GET",
      url: "/v1/organizations/current",
      headers: headers(otherEmail, firstId)
    });
    expect(denied.statusCode).toBe(404);

    const other = await createDemo(otherEmail);
    expect(other.statusCode, other.body).toBe(201);
    const otherId = other.json<DemoResponse>().demoCompany.organizationId;
    expect(otherId).not.toBe(firstId);
    expect(await prisma.organization.count()).toBe(2);
    expect(await prisma.membership.count()).toBe(4);
    // Two full fixture seeds plus concurrency/replay checks exceed the default
    // 30 seconds on Windows. Keep all assertions and give this scenario its own
    // bounded integration budget; product performance checks remain separate.
  }, 90_000);
});
