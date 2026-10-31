import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase10-owner@example.test";

function headers(organizationId?: string, email = owner, key?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

async function api(
  method: "GET" | "POST" | "PATCH",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  key?: string,
  email = owner
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, email, key),
    ...(payload === undefined ? {} : { payload })
  });
}

async function organization(email = owner, timezone = "America/Edmonton") {
  const created = await api(
    "POST",
    "/v1/organizations",
    undefined,
    { legalName: "Phase Ten Ltd", displayName: "Phase Ten", timezone },
    undefined,
    email
  );
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ organization: { id: string } }>().organization.id;
  const setup = await api("GET", "/v1/setup", id, undefined, undefined, email);
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await api(
        "PATCH",
        "/v1/setup/profile",
        id,
        {
          version,
          legalName: "Phase Ten Ltd",
          displayName: "Phase Ten",
          locale: "en-CA",
          timeZone: timezone,
          baseCurrency: "CAD",
          fiscalYearEndMonth: 12,
          fiscalYearEndDay: 31,
          accountingStartDate: "2026-01-01"
        },
        undefined,
        email
      )
    ).statusCode
  ).toBe(200);
  expect(
    (await api("POST", "/v1/setup/presets/general-service/apply", id, {}, randomUUID(), email))
      .statusCode
  ).toBe(201);
  expect(
    (await api("POST", "/v1/setup/fiscal-year/initialize", id, {}, undefined, email)).statusCode
  ).toBe(200);
  return id;
}

type ChartAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  systemPurpose: string | null;
  isControl: boolean;
};

async function chart(organizationId: string, email = owner) {
  const response = await api("GET", "/v1/accounts", organizationId, undefined, undefined, email);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ accounts: ChartAccount[] }>().accounts;
}

function purpose(accounts: ChartAccount[], value: string) {
  return accounts.find((account) => account.systemPurpose === value)!;
}

async function postJournal(
  organizationId: string,
  input: {
    description: string;
    effectiveDate: string;
    debitAccountId: string;
    creditAccountId: string;
    amountMinor: string;
  }
) {
  const response = await api(
    "POST",
    "/v1/journals",
    organizationId,
    {
      description: input.description,
      effectiveDate: input.effectiveDate,
      sourceType: "PHASE10_FIXTURE",
      sourceId: randomUUID(),
      postingKey: `phase10:${randomUUID()}`,
      lines: [
        {
          accountId: input.debitAccountId,
          debitMinor: input.amountMinor,
          creditMinor: "0"
        },
        {
          accountId: input.creditAccountId,
          debitMinor: "0",
          creditMinor: input.amountMinor
        }
      ]
    },
    randomUUID()
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ journal: { id: string } }>().journal.id;
}

async function salesFixture(organizationId: string, accounts: ChartAccount[], taxCodeId?: string) {
  const customerResponse = await api("POST", "/v1/customers", organizationId, {
    customerNumber: `C-${randomUUID().slice(0, 8)}`,
    displayName: "Report Customer",
    defaultPaymentTermsDays: 30,
    defaultCurrency: "CAD"
  });
  expect(customerResponse.statusCode, customerResponse.body).toBe(201);
  const customerId = customerResponse.json<{ customer: { id: string } }>().customer.id;
  const productResponse = await api("POST", "/v1/products", organizationId, {
    sku: `S-${randomUUID().slice(0, 8)}`,
    name: "Consulting",
    itemType: "SERVICE",
    salesPriceMinor: "1000",
    incomeAccountId: purpose(accounts, "professional-services").id,
    ...(taxCodeId ? { defaultTaxCodeId: taxCodeId } : {})
  });
  expect(productResponse.statusCode, productResponse.body).toBe(201);
  const productId = productResponse.json<{ product: { id: string } }>().product.id;
  const draftResponse = await api("POST", "/v1/invoices", organizationId, {
    customerId,
    issueDate: "2026-03-15",
    lines: [{ productItemId: productId, quantity: "1" }]
  });
  expect(draftResponse.statusCode, draftResponse.body).toBe(201);
  const draft = draftResponse.json<{
    invoice: { id: string; version: number; lines: Array<{ id: string }> };
  }>().invoice;
  const posted = await api(
    "POST",
    `/v1/invoices/${draft.id}/post`,
    organizationId,
    { version: draft.version },
    randomUUID()
  );
  expect(posted.statusCode, posted.body).toBe(201);
  const invoice = posted.json<{
    invoice: {
      id: string;
      grandTotalMinor: string;
      lines: Array<{ id: string }>;
    };
  }>().invoice;
  return { customerId, productId, invoice };
}

async function vendorFixture(organizationId: string, accounts: ChartAccount[], taxCodeId?: string) {
  const vendorResponse = await api("POST", "/v1/vendors", organizationId, {
    vendorNumber: `V-${randomUUID().slice(0, 8)}`,
    legalName: "Report Supplier Ltd",
    displayName: "Report Supplier"
  });
  expect(vendorResponse.statusCode, vendorResponse.body).toBe(201);
  const vendorId = vendorResponse.json<{ vendor: { id: string } }>().vendor.id;
  const draftResponse = await api("POST", "/v1/bills", organizationId, {
    vendorId,
    vendorInvoiceNumber: `B-${randomUUID().slice(0, 8)}`,
    issueDate: "2026-03-10",
    lines: [
      {
        description: "Professional expense",
        quantity: "1",
        unitCostMinor: "1000",
        accountId: purpose(accounts, "general-expense").id,
        ...(taxCodeId ? { taxCodeId } : {})
      }
    ]
  });
  expect(draftResponse.statusCode, draftResponse.body).toBe(201);
  const draft = draftResponse.json<{
    bill: { id: string; version: number; lines: Array<{ id: string }> };
  }>().bill;
  const posted = await api(
    "POST",
    `/v1/bills/${draft.id}/post`,
    organizationId,
    { version: draft.version },
    randomUUID()
  );
  expect(posted.statusCode, posted.body).toBe(201);
  const bill = posted.json<{
    bill: { id: string; grandTotalMinor: string; lines: Array<{ id: string }> };
  }>().bill;
  return { vendorId, bill };
}

async function taxCode(organizationId: string, accounts: ChartAccount[]) {
  const response = await api("POST", "/v1/setup/tax-codes/versions", organizationId, {
    code: "GST",
    name: "GST",
    treatment: "STANDARD",
    calculationMode: "EXCLUSIVE",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    sourceName: "Independent report fixture",
    sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
    components: [
      {
        name: "GST",
        jurisdiction: "CA",
        rate: "0.050000",
        recoverablePercent: "1.000000",
        payableAccountId: purpose(accounts, "tax-payable").id,
        recoverableAccountId: purpose(accounts, "tax-recoverable").id
      }
    ]
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ taxCodeVersion: { taxCodeId: string } }>().taxCodeVersion.taxCodeId;
}

async function invite(organizationId: string, email: string, role: string) {
  const invitation = await api("POST", "/v1/organizations/current/invitations", organizationId, {
    email,
    role
  });
  expect(invitation.statusCode, invitation.body).toBe(201);
  const token = invitation.json<{ token: string }>().token;
  const accepted = await api(
    "POST",
    "/v1/invitations/accept",
    undefined,
    { token },
    undefined,
    email
  );
  expect(accepted.statusCode, accepted.body).toBe(200);
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

describe("Phase 10 reporting and dashboard", () => {
  it("produces balanced and traceable financial statements from posted journals", async () => {
    const organizationId = await organization();
    const accounts = await chart(organizationId);
    const cash = purpose(accounts, "cash");
    const sales = purpose(accounts, "sales");
    const expense = purpose(accounts, "general-expense");
    await postJournal(organizationId, {
      description: "Known cash sale",
      effectiveDate: "2026-03-01",
      debitAccountId: cash.id,
      creditAccountId: sales.id,
      amountMinor: "1000"
    });
    await postJournal(organizationId, {
      description: "Known cash expense",
      effectiveDate: "2026-03-02",
      debitAccountId: expense.id,
      creditAccountId: cash.id,
      amountMinor: "300"
    });

    const profit = await api(
      "GET",
      "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31&basis=ACCRUAL",
      organizationId
    );
    expect(profit.statusCode, profit.body).toBe(200);
    expect(
      profit.json<{
        report: {
          totalRevenueMinor: string;
          totalExpenseMinor: string;
          netIncomeMinor: string;
          rows: Array<{ drillDownUrl: string }>;
        };
      }>().report
    ).toMatchObject({
      totalRevenueMinor: "1000",
      totalExpenseMinor: "300",
      netIncomeMinor: "700"
    });
    expect(
      profit.json<{ report: { rows: Array<{ drillDownUrl: string }> } }>().report.rows[0]
    ).toHaveProperty("drillDownUrl");

    const balance = await api("GET", "/v1/reports/balance-sheet?asOf=2026-03-31", organizationId);
    expect(balance.statusCode, balance.body).toBe(200);
    expect(
      balance.json<{
        report: {
          totalAssetsMinor: string;
          currentEarningsMinor: string;
          differenceMinor: string;
          isBalanced: boolean;
        };
      }>().report
    ).toMatchObject({
      totalAssetsMinor: "700",
      currentEarningsMinor: "700",
      differenceMinor: "0",
      isBalanced: true
    });
    const trial = await api("GET", "/v1/reports/trial-balance?asOf=2026-03-31", organizationId);
    expect(trial.json<{ trialBalance: { isBalanced: boolean } }>().trialBalance.isBalanced).toBe(
      true
    );
    const cashFlow = await api(
      "GET",
      "/v1/reports/cash-flow?from=2026-03-01&to=2026-03-31",
      organizationId
    );
    expect(
      cashFlow.json<{ report: { netCashChangeMinor: string } }>().report.netCashChangeMinor
    ).toBe("700");
  });

  it("distinguishes cash and accrual profit and reports historical AR with partial payment and credit", async () => {
    const organizationId = await organization();
    const accounts = await chart(organizationId);
    const fixture = await salesFixture(organizationId, accounts);
    const beforeCash = await api(
      "GET",
      "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31&basis=CASH",
      organizationId
    );
    expect(
      beforeCash.json<{ report: { totalRevenueMinor: string } }>().report.totalRevenueMinor
    ).toBe("0");
    const payment = await api(
      "POST",
      "/v1/payments/manual",
      organizationId,
      {
        customerId: fixture.customerId,
        receivingAccountId: purpose(accounts, "cash").id,
        paymentDate: "2026-03-16",
        amountMinor: "300",
        methodCategory: "CHEQUE",
        allocations: [{ invoiceId: fixture.invoice.id, amountMinor: "300" }]
      },
      randomUUID()
    );
    expect(payment.statusCode, payment.body).toBe(201);
    const creditDraft = await api(
      "POST",
      `/v1/invoices/${fixture.invoice.id}/credit-notes`,
      organizationId,
      {
        issueDate: "2026-03-17",
        reason: "Scope reduction",
        lines: [{ invoiceLineId: fixture.invoice.lines[0]!.id, amountMinor: "200" }]
      }
    );
    expect(creditDraft.statusCode, creditDraft.body).toBe(201);
    const credit = creditDraft.json<{ creditNote: { id: string; version: number } }>().creditNote;
    expect(
      (
        await api(
          "POST",
          `/v1/credit-notes/${credit.id}/post`,
          organizationId,
          { version: credit.version },
          randomUUID()
        )
      ).statusCode
    ).toBe(201);
    const accrual = await api(
      "GET",
      "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31&basis=ACCRUAL",
      organizationId
    );
    const cash = await api(
      "GET",
      "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31&basis=CASH",
      organizationId
    );
    expect(accrual.json<{ report: { totalRevenueMinor: string } }>().report.totalRevenueMinor).toBe(
      "800"
    );
    expect(cash.json<{ report: { totalRevenueMinor: string } }>().report.totalRevenueMinor).toBe(
      "300"
    );
    const receivables = await api("GET", "/v1/reports/receivables?asOf=2026-03-31", organizationId);
    expect(
      receivables.json<{
        report: {
          subledgerBalanceMinor: string;
          controlBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
          paymentHistory: unknown[];
        };
      }>().report
    ).toMatchObject({
      subledgerBalanceMinor: "500",
      controlBalanceMinor: "500",
      differenceMinor: "0",
      isReconciled: true
    });
    expect(
      receivables.json<{ report: { paymentHistory: unknown[] } }>().report.paymentHistory
    ).toHaveLength(1);
  });

  it("reports AP aging, partial payments, credits, vendor balances, and history", async () => {
    const organizationId = await organization();
    const accounts = await chart(organizationId);
    const fixture = await vendorFixture(organizationId, accounts);
    const payment = await api(
      "POST",
      "/v1/bill-payments",
      organizationId,
      {
        vendorId: fixture.vendorId,
        paymentDate: "2026-03-16",
        amountMinor: "300",
        method: "CHEQUE",
        payingAccountId: purpose(accounts, "cash").id,
        reference: "P-300",
        allocations: [{ billId: fixture.bill.id, amountMinor: "300" }]
      },
      randomUUID()
    );
    expect(payment.statusCode, payment.body).toBe(201);
    const creditDraft = await api("POST", "/v1/vendor-credits", organizationId, {
      vendorId: fixture.vendorId,
      vendorCreditNumber: "VC-200",
      issueDate: "2026-03-17",
      reason: "Price correction",
      lines: [{ billLineId: fixture.bill.lines[0]!.id, amountMinor: "200" }]
    });
    expect(creditDraft.statusCode, creditDraft.body).toBe(201);
    const credit = creditDraft.json<{ vendorCredit: { id: string; version: number } }>()
      .vendorCredit;
    expect(
      (
        await api(
          "POST",
          `/v1/vendor-credits/${credit.id}/post`,
          organizationId,
          { version: credit.version },
          randomUUID()
        )
      ).statusCode
    ).toBe(201);
    expect(
      (
        await api(
          "POST",
          `/v1/vendor-credits/${credit.id}/apply`,
          organizationId,
          { allocations: [{ billId: fixture.bill.id, amountMinor: "200" }] },
          randomUUID()
        )
      ).statusCode
    ).toBe(200);
    const payables = await api("GET", "/v1/reports/payables?asOf=2026-03-31", organizationId);
    expect(
      payables.json<{
        report: {
          subledgerBalanceMinor: string;
          controlBalanceMinor: string;
          isReconciled: boolean;
          vendorBalances: unknown[];
          paymentHistory: unknown[];
        };
      }>().report
    ).toMatchObject({
      subledgerBalanceMinor: "500",
      controlBalanceMinor: "500",
      isReconciled: true
    });
    expect(
      payables.json<{ report: { vendorBalances: unknown[] } }>().report.vendorBalances
    ).toHaveLength(1);
    expect(
      payables.json<{ report: { paymentHistory: unknown[] } }>().report.paymentHistory
    ).toHaveLength(1);
  });

  it("reconciles tax snapshots to payable and recoverable control activity", async () => {
    const organizationId = await organization();
    const accounts = await chart(organizationId);
    const gst = await taxCode(organizationId, accounts);
    await salesFixture(organizationId, accounts, gst);
    await vendorFixture(organizationId, accounts, gst);
    const report = await api(
      "GET",
      "/v1/reports/tax?from=2026-03-01&to=2026-03-31",
      organizationId
    );
    expect(report.statusCode, report.body).toBe(200);
    expect(
      report.json<{
        report: {
          collectedMinor: string;
          recoverableMinor: string;
          payableControlBalanceMinor: string;
          recoverableControlBalanceMinor: string;
          isReconciled: boolean;
          detail: Array<{ taxCode: string; taxVersion: string; rateSnapshot: unknown }>;
        };
      }>().report
    ).toMatchObject({
      collectedMinor: "50",
      recoverableMinor: "50",
      payableControlBalanceMinor: "50",
      recoverableControlBalanceMinor: "50",
      isReconciled: true
    });
    expect(
      report
        .json<{ report: { detail: Array<{ taxCode: string }> } }>()
        .report.detail.every((row) => row.taxCode === "GST")
    ).toBe(true);
  });

  it("keeps dashboard totals equal to source reports and uses organization-local month boundaries", async () => {
    const organizationId = await organization(owner, "America/Edmonton");
    const accounts = await chart(organizationId);
    await postJournal(organizationId, {
      description: "Month boundary sale",
      effectiveDate: "2026-03-31",
      debitAccountId: purpose(accounts, "cash").id,
      creditAccountId: purpose(accounts, "sales").id,
      amountMinor: "725"
    });
    const dashboard = await api("GET", "/v1/dashboard?asOf=2026-03-31", organizationId);
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    const value = dashboard.json<{
      dashboard: {
        cashMinor: string;
        salesThisMonthMinor: string;
        estimatedProfitMinor: string;
        links: { profit: string };
      };
    }>().dashboard;
    const profit = await api("GET", value.links.profit, organizationId);
    expect(value).toMatchObject({
      cashMinor: "725",
      salesThisMonthMinor: "0",
      estimatedProfitMinor: "725"
    });
    expect(profit.json<{ report: { netIncomeMinor: string } }>().report.netIncomeMinor).toBe(
      value.estimatedProfitMinor
    );
  });

  it("keeps historical reports stable after later postings and enforces date boundaries", async () => {
    const organizationId = await organization();
    const accounts = await chart(organizationId);
    await postJournal(organizationId, {
      description: "March sale",
      effectiveDate: "2026-03-31",
      debitAccountId: purpose(accounts, "cash").id,
      creditAccountId: purpose(accounts, "sales").id,
      amountMinor: "100"
    });
    const url = "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31&basis=ACCRUAL";
    const before = (await api("GET", url, organizationId)).body;
    await postJournal(organizationId, {
      description: "April sale",
      effectiveDate: "2026-04-01",
      debitAccountId: purpose(accounts, "cash").id,
      creditAccountId: purpose(accounts, "sales").id,
      amountMinor: "900"
    });
    expect((await api("GET", url, organizationId)).body).toBe(before);
    expect(
      (
        await api(
          "GET",
          "/v1/reports/profit-and-loss?from=2026-04-01&to=2026-03-01",
          organizationId
        )
      ).statusCode
    ).toBe(400);
  });

  it("enforces tenant isolation and report-specific permissions", async () => {
    const first = await organization();
    const secondOwner = "phase10-second@example.test";
    const second = await organization(secondOwner);
    const firstAccounts = await chart(first);
    await postJournal(first, {
      description: "Private first-tenant sale",
      effectiveDate: "2026-03-01",
      debitAccountId: purpose(firstAccounts, "cash").id,
      creditAccountId: purpose(firstAccounts, "sales").id,
      amountMinor: "999"
    });
    const secondReport = await api(
      "GET",
      "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31",
      second,
      undefined,
      undefined,
      secondOwner
    );
    expect(secondReport.statusCode, secondReport.body).toBe(200);
    expect(
      secondReport.json<{ report: { totalRevenueMinor: string } }>().report.totalRevenueMinor
    ).toBe("0");
    const salesUser = "phase10-sales@example.test";
    await invite(first, salesUser, "SALES");
    expect(
      (
        await api(
          "GET",
          "/v1/reports/profit-and-loss?from=2026-03-01&to=2026-03-31",
          first,
          undefined,
          undefined,
          salesUser
        )
      ).statusCode
    ).toBe(403);
    expect(
      (
        await api(
          "GET",
          "/v1/reports/receivables?asOf=2026-03-31",
          first,
          undefined,
          undefined,
          salesUser
        )
      ).statusCode
    ).toBe(200);
  });

  it("paginates large ledger detail and escapes formula-leading CSV cells", async () => {
    const organizationId = await organization();
    const accounts = await chart(organizationId);
    const cash = purpose(accounts, "cash");
    const sales = purpose(accounts, "sales");
    const lines = Array.from({ length: 120 }, (_unused, index) => ({
      accountId: index % 2 === 0 ? cash.id : sales.id,
      debitMinor: index % 2 === 0 ? "1" : "0",
      creditMinor: index % 2 === 0 ? "0" : "1",
      description: index === 0 ? "=FORMULA()" : `Line ${String(index + 1)}`
    }));
    const posted = await api(
      "POST",
      "/v1/journals",
      organizationId,
      {
        description: "=Potential formula",
        effectiveDate: "2026-03-10",
        sourceType: "PHASE10_LARGE_FIXTURE",
        sourceId: randomUUID(),
        postingKey: `phase10-large:${randomUUID()}`,
        lines
      },
      randomUUID()
    );
    expect(posted.statusCode, posted.body).toBe(201);
    const page = await api(
      "GET",
      "/v1/reports/general-ledger?from=2026-03-01&to=2026-03-31&page=2&pageSize=100",
      organizationId
    );
    expect(page.statusCode, page.body).toBe(200);
    expect(
      page.json<{
        generalLedger: { total: number; page: number; lines: unknown[] };
      }>().generalLedger
    ).toMatchObject({ total: 120, page: 2 });
    expect(page.json<{ generalLedger: { lines: unknown[] } }>().generalLedger.lines).toHaveLength(
      20
    );
    const exported = await api(
      "GET",
      "/v1/reports/exports/journals.csv?from=2026-03-01&to=2026-03-31&asOf=2026-03-31",
      organizationId
    );
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.body).toContain("'=Potential formula");
    expect(
      await prisma.auditEvent.count({ where: { organizationId, action: "REPORT_EXPORTED" } })
    ).toBe(1);
  });
});
