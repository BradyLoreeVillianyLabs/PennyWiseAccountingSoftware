import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error("TEST_DATABASE_URL is required for UI-summary integration tests.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "ui-summary-owner@example.test";

function headers(organizationId?: string, email = owner) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function api(
  method: "GET" | "POST" | "PATCH",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  email = owner,
  idempotencyKey?: string
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: {
      ...headers(organizationId, email),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
    },
    ...(payload === undefined ? {} : { payload })
  });
}

async function organization(email = owner) {
  const created = await api(
    "POST",
    "/v1/organizations",
    undefined,
    { legalName: "UI Summary Ltd", displayName: "UI Summary", timezone: "America/Edmonton" },
    email
  );
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ organization: { id: string } }>().organization.id;
  const setup = await api("GET", "/v1/setup", id, undefined, email);
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await api(
        "PATCH",
        "/v1/setup/profile",
        id,
        {
          version,
          legalName: "UI Summary Ltd",
          displayName: "UI Summary",
          locale: "en-CA",
          timeZone: "America/Edmonton",
          baseCurrency: "CAD",
          fiscalYearEndMonth: 12,
          fiscalYearEndDay: 31,
          accountingStartDate: "2026-01-01"
        },
        email
      )
    ).statusCode
  ).toBe(200);
  expect(
    (await api("POST", "/v1/setup/presets/general-service/apply", id, {}, email, randomUUID()))
      .statusCode
  ).toBe(201);
  expect((await api("POST", "/v1/setup/fiscal-year/initialize", id, {}, email)).statusCode).toBe(
    200
  );
  return id;
}

async function seedPostedCashSale(organizationId: string) {
  const chartResponse = await api("GET", "/v1/accounts", organizationId);
  expect(chartResponse.statusCode, chartResponse.body).toBe(200);
  const accounts = chartResponse.json<{
    accounts: Array<{ id: string; systemPurpose: string | null }>;
  }>().accounts;
  const cash = accounts.find((account) => account.systemPurpose === "cash")!;
  const sales = accounts.find((account) => account.systemPurpose === "sales")!;
  const response = await app.inject({
    method: "POST",
    url: "/v1/journals",
    headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
    payload: {
      description: "UI summary fixed report comparison",
      effectiveDate: "2026-03-12",
      sourceType: "UI_SUMMARY_FIXTURE",
      sourceId: randomUUID(),
      postingKey: `ui-summary:${randomUUID()}`,
      lines: [
        { accountId: cash.id, debitMinor: "25000", creditMinor: "0" },
        { accountId: sales.id, debitMinor: "0", creditMinor: "25000" }
      ]
    }
  });
  expect(response.statusCode, response.body).toBe(201);
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

describe("UI summary read-only API", () => {
  it("matches existing reports, stays tenant-scoped, and rejects a non-member", async () => {
    const organizationId = await organization();
    await seedPostedCashSale(organizationId);

    const [
      summaryResponse,
      profitResponse,
      bankingResponse,
      receivablesResponse,
      payablesResponse,
      cashFlowResponse,
      salesLandingResponse,
      expenseLandingResponse,
      bankingLandingResponse,
      contactsLandingResponse,
      taxesLandingResponse,
      taxReportResponse
    ] = await Promise.all([
      api("GET", "/v1/ui/home-summary?asOf=2026-03-31", organizationId),
      api(
        "GET",
        "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31&basis=ACCRUAL",
        organizationId
      ),
      api(
        "GET",
        "/v1/reports/banking?from=2026-03-01&to=2026-03-31&asOf=2026-03-31",
        organizationId
      ),
      api("GET", "/v1/reports/receivables?asOf=2026-03-31", organizationId),
      api("GET", "/v1/reports/payables?asOf=2026-03-31", organizationId),
      api("GET", "/v1/reports/cash-flow?from=2026-03-02&to=2026-03-31", organizationId),
      api("GET", "/v1/ui/landing/sales?asOf=2026-03-31", organizationId),
      api("GET", "/v1/ui/landing/expenses?asOf=2026-03-31", organizationId),
      api("GET", "/v1/ui/landing/banking?asOf=2026-03-31", organizationId),
      api("GET", "/v1/ui/landing/contacts?asOf=2026-03-31", organizationId),
      api("GET", "/v1/ui/landing/taxes?asOf=2026-03-31", organizationId),
      api("GET", "/v1/reports/tax?from=2026-03-01&to=2026-03-31", organizationId)
    ]);
    expect(summaryResponse.statusCode, summaryResponse.body).toBe(200);
    const summary = summaryResponse.json<{
      summary: {
        cashOnHandMinor: string;
        moneyIn30d: { amountMinor: string };
        moneyOut30d: { amountMinor: string };
        profitMtd: { amountMinor: string };
        incomeExpense12Months: Array<{ from: string; to: string; incomeMinor: string }>;
        receivablesAging: Record<string, string>;
        payablesAging: Record<string, string>;
      };
    }>().summary;
    expect(summary.profitMtd.amountMinor).toBe(
      profitResponse.json<{ report: { netIncomeMinor: string } }>().report.netIncomeMinor
    );
    expect(summary.cashOnHandMinor).toBe(
      bankingResponse
        .json<{ report: { accountBalances: Array<{ balanceMinor: string }> } }>()
        .report.accountBalances.reduce((sum, row) => sum + BigInt(row.balanceMinor), 0n)
        .toString()
    );
    expect(summary.receivablesAging).toEqual(
      receivablesResponse.json<{ report: { aging: Record<string, string> } }>().report.aging
    );
    expect(summary.payablesAging).toEqual(
      payablesResponse.json<{ report: { aging: Record<string, string> } }>().report.aging
    );
    expect(
      summary.incomeExpense12Months.find((row) => row.from === "2026-03-01")?.incomeMinor
    ).toBe(
      profitResponse.json<{ report: { totalRevenueMinor: string } }>().report.totalRevenueMinor
    );
    const cashFlow = cashFlowResponse.json<{
      report: { detail: Array<{ cashChangeMinor: string }> };
    }>().report;
    expect(summary.moneyIn30d.amountMinor).toBe(
      cashFlow.detail
        .reduce((sum, row) => {
          const amount = BigInt(row.cashChangeMinor);
          return amount > 0n ? sum + amount : sum;
        }, 0n)
        .toString()
    );
    expect(summary.moneyOut30d.amountMinor).toBe(
      cashFlow.detail
        .reduce((sum, row) => {
          const amount = BigInt(row.cashChangeMinor);
          return amount < 0n ? sum - amount : sum;
        }, 0n)
        .toString()
    );
    expect(
      salesLandingResponse.json<{ landing: { kpis: { netSales30dMinor: string } } }>().landing.kpis
        .netSales30dMinor
    ).toBe(
      profitResponse.json<{ report: { totalRevenueMinor: string } }>().report.totalRevenueMinor
    );
    expect(
      expenseLandingResponse.json<{ landing: { kpis: { spent30dMinor: string } } }>().landing.kpis
        .spent30dMinor
    ).toBe(
      profitResponse.json<{ report: { totalExpenseMinor: string } }>().report.totalExpenseMinor
    );
    expect(
      bankingLandingResponse.json<{ landing: { kpis: { cashMinor: string } } }>().landing.kpis
        .cashMinor
    ).toBe(summary.cashOnHandMinor);
    expect(
      contactsLandingResponse.json<{
        landing: { kpis: { customersOwingMinor: string; vendorsOwedMinor: string } };
      }>().landing.kpis
    ).toMatchObject({
      customersOwingMinor: receivablesResponse.json<{ report: { subledgerBalanceMinor: string } }>()
        .report.subledgerBalanceMinor,
      vendorsOwedMinor: payablesResponse.json<{ report: { subledgerBalanceMinor: string } }>()
        .report.subledgerBalanceMinor
    });
    expect(
      taxesLandingResponse.json<{ landing: { kpis: { estimatedTaxPositionMinor: string } } }>()
        .landing.kpis.estimatedTaxPositionMinor
    ).toBe(
      taxReportResponse.json<{ report: { netTaxPositionMinor: string } }>().report
        .netTaxPositionMinor
    );

    const otherOrganizationId = await organization();
    const otherSummary = await api(
      "GET",
      "/v1/ui/home-summary?asOf=2026-03-31",
      otherOrganizationId
    );
    expect(otherSummary.statusCode, otherSummary.body).toBe(200);
    expect(
      otherSummary.json<{ summary: { cashOnHandMinor: string } }>().summary.cashOnHandMinor
    ).toBe("0");

    const forbidden = await api(
      "GET",
      "/v1/ui/home-summary?asOf=2026-03-31",
      organizationId,
      undefined,
      "outside@example.test"
    );
    expect(forbidden.statusCode).toBe(404);
  });

  it("validates landing modules and returns only configured tax due dates", async () => {
    const organizationId = await organization();
    const landings = await Promise.all(
      ["sales", "expenses", "banking", "contacts", "taxes"].map((module) =>
        api("GET", `/v1/ui/landing/${module}?asOf=2026-03-31`, organizationId)
      )
    );
    const invalidLanding = await api(
      "GET",
      "/v1/ui/landing/payroll?asOf=2026-03-31",
      organizationId
    );
    const calendar = await api("GET", "/v1/ui/tax-calendar?asOf=2026-03-31", organizationId);
    const queue = await api("GET", "/v1/ui/attention-queue?asOf=2026-03-31", organizationId);
    for (const landing of landings) {
      expect(landing.statusCode, landing.body).toBe(200);
      expect(landing.headers["cache-control"]).toBe("private, no-store");
    }
    expect(invalidLanding.statusCode).toBe(400);
    expect(calendar.statusCode, calendar.body).toBe(200);
    expect(
      calendar.json<{ calendar: { gstHstAvailability: string } }>().calendar.gstHstAvailability
    ).toBe("filing-frequency-not-configured");
    expect(queue.json<{ queue: { items: unknown[] } }>().queue.items).toHaveLength(0);
    expect(queue.headers["cache-control"]).toBe("private, no-store");
  });
});
