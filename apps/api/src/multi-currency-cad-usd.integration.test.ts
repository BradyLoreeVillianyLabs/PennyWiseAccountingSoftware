import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "cad-usd-owner@example.test";

function headers(organizationId?: string, idempotencyKey?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": owner,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
  };
}

async function setupOrganization() {
  const created = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "CAD USD Ltd", displayName: "CAD USD" }
  });
  expect(created.statusCode, created.body).toBe(201);
  const organizationId = created.json<{ organization: { id: string } }>().organization.id;
  const setup = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  const profile = await app.inject({
    method: "PATCH",
    url: "/v1/setup/profile",
    headers: headers(organizationId),
    payload: {
      version,
      legalName: "CAD USD Ltd",
      displayName: "CAD USD",
      businessType: "Corporation",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      baseCurrency: "CAD",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      accountingStartDate: "2026-01-01"
    }
  });
  expect(profile.statusCode, profile.body).toBe(200);
  const preset = await app.inject({
    method: "POST",
    url: "/v1/setup/presets/general-service/apply",
    headers: headers(organizationId, randomUUID()),
    payload: {}
  });
  expect(preset.statusCode, preset.body).toBe(201);
  const periods = await app.inject({
    method: "POST",
    url: "/v1/setup/fiscal-year/initialize",
    headers: headers(organizationId),
    payload: {}
  });
  expect(periods.statusCode, periods.body).toBe(200);
  const settingsResponse = await app.inject({
    method: "GET",
    url: "/v1/settings/multi-currency",
    headers: headers(organizationId)
  });
  const settings = settingsResponse.json<{ multiCurrency: { version: number } }>().multiCurrency;
  const enabled = await app.inject({
    method: "PUT",
    url: "/v1/settings/multi-currency",
    headers: headers(organizationId),
    payload: {
      version: settings.version,
      enabled: true,
      rateMode: "MANUAL",
      currencies: ["CAD", "USD"]
    }
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  return organizationId;
}

async function rate(
  organizationId: string,
  date: string,
  value: string,
  purpose: "TRANSACTION" | "CLOSING" | "ACTUAL_SETTLEMENT"
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/settings/multi-currency/rates",
    headers: headers(organizationId),
    payload: {
      transactionCurrency: "USD",
      rate: value,
      effectiveAt: `${date}T12:00:00.000Z`,
      method: "MANUAL",
      purpose,
      sourceReference: `Documented test rate ${date}`
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ rate: { id: string } }>().rate.id;
}

async function chart(organizationId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId)
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{
    accounts: Array<{ id: string; systemPurpose: string | null }>;
  }>().accounts;
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

describe("CAD/USD accounting release", () => {
  it("posts and settles a USD invoice, tracks USD cash, and revalues with reversal", async () => {
    const organizationId = await setupOrganization();
    const invoiceRateId = await rate(organizationId, "2026-02-01", "1.35", "TRANSACTION");
    const settlementRateId = await rate(organizationId, "2026-02-15", "1.37", "ACTUAL_SETTLEMENT");
    const billRateId = await rate(organizationId, "2026-03-01", "1.36", "TRANSACTION");
    const cashSpendRateId = await rate(organizationId, "2026-03-15", "1.34", "ACTUAL_SETTLEMENT");
    const closingRateId = await rate(organizationId, "2026-12-31", "1.36", "CLOSING");
    const accounts = await chart(organizationId);
    const cash = accounts.find((account) => account.systemPurpose === "cash")!;
    const expense = accounts.find((account) => account.systemPurpose === "general-expense")!;
    const bankResponse = await app.inject({
      method: "POST",
      url: "/v1/bank-accounts",
      headers: headers(organizationId),
      payload: {
        displayName: "USD operating account",
        accountKind: "BANK",
        maskedAccountReference: "****1001",
        currency: "USD",
        linkedLedgerAccountId: cash.id,
        openingDate: "2026-01-01"
      }
    });
    expect(bankResponse.statusCode, bankResponse.body).toBe(201);
    const customerResponse = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "USD-001",
        displayName: "US Customer",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "USD"
      }
    });
    expect(customerResponse.statusCode, customerResponse.body).toBe(201);
    const customerId = customerResponse.json<{ customer: { id: string } }>().customer.id;
    const draftResponse = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId),
      payload: {
        customerId,
        issueDate: "2026-02-01",
        dueDate: "2026-03-03",
        currency: "USD",
        fxRateSnapshotId: invoiceRateId,
        lines: [{ description: "Export service", quantity: "1", unitPriceMinor: "10000" }]
      }
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const draft = draftResponse.json<{ invoice: { id: string; version: number } }>().invoice;
    const postedResponse = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/post`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: draft.version }
    });
    expect(postedResponse.statusCode, postedResponse.body).toBe(201);
    const posted = postedResponse.json<{
      invoice: { journalId: string; baseCurrency: string; baseGrandTotalMinor: string };
    }>().invoice;
    expect(posted.baseGrandTotalMinor).toBe("13500");
    expect(posted.baseCurrency).toBe("CAD");
    const opened = await prisma.monetaryPosition.findFirstOrThrow({
      where: { organizationId, sourceType: "invoice", sourceId: draft.id }
    });
    expect(opened.outstandingTransactionMinor).toBe(10_000n);
    expect(opened.carryingBaseMinor).toBe(13_500n);
    const openReceivables = await app.inject({
      method: "GET",
      url: "/v1/receivables/reconciliation",
      headers: headers(organizationId)
    });
    expect(openReceivables.statusCode, openReceivables.body).toBe(200);
    expect(
      openReceivables.json<{
        reconciliation: {
          ledgerBalanceMinor: string;
          subledgerBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
        };
      }>().reconciliation
    ).toMatchObject({
      ledgerBalanceMinor: "13500",
      subledgerBalanceMinor: "13500",
      differenceMinor: "0",
      isReconciled: true
    });
    const openReceivablesReport = await app.inject({
      method: "GET",
      url: "/v1/reports/receivables?asOf=2026-02-10",
      headers: headers(organizationId)
    });
    expect(openReceivablesReport.statusCode, openReceivablesReport.body).toBe(200);
    expect(
      openReceivablesReport.json<{
        report: {
          subledgerBalanceMinor: string;
          controlBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
        };
      }>().report
    ).toMatchObject({
      subledgerBalanceMinor: "13500",
      controlBalanceMinor: "13500",
      differenceMinor: "0",
      isReconciled: true
    });

    const paidResponse = await app.inject({
      method: "POST",
      url: "/v1/payments/manual",
      headers: headers(organizationId, randomUUID()),
      payload: {
        customerId,
        receivingAccountId: cash.id,
        paymentDate: "2026-02-15",
        amountMinor: "10000",
        currency: "USD",
        fxRateSnapshotId: settlementRateId,
        methodCategory: "ELECTRONIC_TRANSFER",
        allocations: [{ invoiceId: draft.id, amountMinor: "10000" }]
      }
    });
    expect(paidResponse.statusCode, paidResponse.body).toBe(201);
    const payment = paidResponse.json<{
      payment: { id: string; allocations: Array<{ realizedFxBaseMinor: string }> };
    }>().payment;
    expect(payment.allocations[0]!.realizedFxBaseMinor).toBe("200");
    const settledInvoice = await prisma.monetaryPosition.findFirstOrThrow({
      where: { organizationId, sourceType: "invoice", sourceId: draft.id }
    });
    expect(settledInvoice.active).toBe(false);
    expect(settledInvoice.outstandingTransactionMinor).toBe(0n);
    expect(settledInvoice.carryingBaseMinor).toBe(0n);
    const settledReceivables = await app.inject({
      method: "GET",
      url: "/v1/receivables/reconciliation",
      headers: headers(organizationId)
    });
    expect(settledReceivables.statusCode, settledReceivables.body).toBe(200);
    expect(
      settledReceivables.json<{
        reconciliation: {
          ledgerBalanceMinor: string;
          subledgerBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
        };
      }>().reconciliation
    ).toMatchObject({
      ledgerBalanceMinor: "0",
      subledgerBalanceMinor: "0",
      differenceMinor: "0",
      isReconciled: true
    });
    const settledReceivablesReport = await app.inject({
      method: "GET",
      url: "/v1/reports/receivables?asOf=2026-02-28",
      headers: headers(organizationId)
    });
    expect(settledReceivablesReport.statusCode, settledReceivablesReport.body).toBe(200);
    expect(
      settledReceivablesReport.json<{
        report: {
          subledgerBalanceMinor: string;
          controlBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
        };
      }>().report
    ).toMatchObject({
      subledgerBalanceMinor: "0",
      controlBalanceMinor: "0",
      differenceMinor: "0",
      isReconciled: true
    });
    const usdCash = await prisma.monetaryPosition.findFirstOrThrow({
      where: { organizationId, sourceType: "foreign_receipt", sourceId: payment.id }
    });
    expect(usdCash.outstandingTransactionMinor).toBe(10_000n);
    expect(usdCash.carryingBaseMinor).toBe(13_700n);

    const vendorResponse = await app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: headers(organizationId),
      payload: {
        vendorNumber: "US-SUPPLIER",
        legalName: "US Supplier LLC",
        displayName: "US Supplier",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "USD"
      }
    });
    expect(vendorResponse.statusCode, vendorResponse.body).toBe(201);
    const vendorId = vendorResponse.json<{ vendor: { id: string } }>().vendor.id;
    const billDraftResponse = await app.inject({
      method: "POST",
      url: "/v1/bills",
      headers: headers(organizationId),
      payload: {
        vendorId,
        vendorInvoiceNumber: "USD-EXPENSE-50",
        issueDate: "2026-03-01",
        currency: "USD",
        fxRateSnapshotId: billRateId,
        lines: [
          {
            description: "USD operating expense",
            quantity: "1",
            unitCostMinor: "5000",
            accountId: expense.id
          }
        ]
      }
    });
    expect(billDraftResponse.statusCode, billDraftResponse.body).toBe(201);
    const bill = billDraftResponse.json<{ bill: { id: string; version: number } }>().bill;
    const billPostResponse = await app.inject({
      method: "POST",
      url: `/v1/bills/${bill.id}/post`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: bill.version }
    });
    expect(billPostResponse.statusCode, billPostResponse.body).toBe(201);
    const billPaymentResponse = await app.inject({
      method: "POST",
      url: "/v1/bill-payments",
      headers: headers(organizationId, randomUUID()),
      payload: {
        vendorId,
        paymentDate: "2026-03-15",
        amountMinor: "5000",
        currency: "USD",
        fxRateSnapshotId: cashSpendRateId,
        method: "ELECTRONIC_TRANSFER",
        payingAccountId: cash.id,
        allocations: [{ billId: bill.id, amountMinor: "5000" }]
      }
    });
    expect(billPaymentResponse.statusCode, billPaymentResponse.body).toBe(201);
    expect(
      billPaymentResponse.json<{
        payment: { allocations: Array<{ realizedFxBaseMinor: string }> };
      }>().payment.allocations[0]!.realizedFxBaseMinor
    ).toBe("100");
    const partlySpentCash = await prisma.monetaryPosition.findUniqueOrThrow({
      where: { id: usdCash.id }
    });
    expect(partlySpentCash.outstandingTransactionMinor).toBe(5_000n);
    expect(partlySpentCash.carryingBaseMinor).toBe(6_850n);
    expect(partlySpentCash.cumulativeRealizedFxMinor).toBe(-150n);
    const nextPeriod = await app.inject({
      method: "POST",
      url: "/v1/fiscal-periods",
      headers: headers(organizationId),
      payload: { name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" }
    });
    expect(nextPeriod.statusCode, nextPeriod.body).toBe(201);

    const previewResponse = await app.inject({
      method: "POST",
      url: "/v1/accounting/fx-revaluation/preview",
      headers: headers(organizationId),
      payload: {
        valuationDate: "2026-12-31",
        rateSnapshotIds: [closingRateId],
        post: false
      }
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json<{
      preview: {
        readyToPost: boolean;
        totalUnrealizedLossMinor: string;
        positions: Array<{ deltaBaseMinor: string }>;
      };
    }>().preview;
    expect(preview.readyToPost).toBe(true);
    expect(preview.totalUnrealizedLossMinor).toBe("50");
    expect(preview.positions[0]!.deltaBaseMinor).toBe("-50");
    const revalued = await app.inject({
      method: "POST",
      url: "/v1/accounting/fx-revaluation/post",
      headers: headers(organizationId),
      payload: {
        valuationDate: "2026-12-31",
        rateSnapshotIds: [closingRateId],
        post: true
      }
    });
    expect(revalued.statusCode, revalued.body).toBe(201);
    const run = revalued.json<{
      run: { status: string; valuationJournalId: string; reversalJournalId: string };
    }>().run;
    expect(run.status).toBe("POSTED");
    expect(run.valuationJournalId).toBeTruthy();
    expect(run.reversalJournalId).toBeTruthy();
    const afterReversal = await prisma.monetaryPosition.findUniqueOrThrow({
      where: { id: usdCash.id }
    });
    expect(afterReversal.carryingBaseMinor).toBe(6_850n);
    expect(
      await prisma.monetaryPositionEvent.count({
        where: { monetaryPositionId: usdCash.id, kind: "REVALUATION_REVERSAL" }
      })
    ).toBe(1);
  });

  it("posts and settles a USD bill with a separately identified realized FX loss", async () => {
    const organizationId = await setupOrganization();
    const billRateId = await rate(organizationId, "2026-04-01", "1.35", "TRANSACTION");
    const settlementRateId = await rate(organizationId, "2026-04-15", "1.37", "ACTUAL_SETTLEMENT");
    const accounts = await chart(organizationId);
    const expense = accounts.find((account) => account.systemPurpose === "general-expense")!;
    const cash = accounts.find((account) => account.systemPurpose === "cash")!;
    const vendorResponse = await app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: headers(organizationId),
      payload: {
        vendorNumber: "US-VENDOR",
        legalName: "US Vendor LLC",
        displayName: "US Vendor",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "USD"
      }
    });
    expect(vendorResponse.statusCode, vendorResponse.body).toBe(201);
    const vendorId = vendorResponse.json<{ vendor: { id: string } }>().vendor.id;
    const draftResponse = await app.inject({
      method: "POST",
      url: "/v1/bills",
      headers: headers(organizationId),
      payload: {
        vendorId,
        vendorInvoiceNumber: "US-100",
        issueDate: "2026-04-01",
        dueDate: "2026-05-01",
        currency: "USD",
        fxRateSnapshotId: billRateId,
        lines: [
          {
            description: "US supplier service",
            quantity: "1",
            unitCostMinor: "10000",
            accountId: expense.id
          }
        ]
      }
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const bill = draftResponse.json<{ bill: { id: string; version: number } }>().bill;
    const posted = await app.inject({
      method: "POST",
      url: `/v1/bills/${bill.id}/post`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: bill.version }
    });
    expect(posted.statusCode, posted.body).toBe(201);
    expect(posted.json<{ bill: { baseGrandTotalMinor: string } }>().bill.baseGrandTotalMinor).toBe(
      "13500"
    );
    const openPayables = await app.inject({
      method: "GET",
      url: "/v1/payables/aging",
      headers: headers(organizationId)
    });
    expect(openPayables.statusCode, openPayables.body).toBe(200);
    expect(
      openPayables.json<{
        payables: {
          subledgerBalanceMinor: string;
          generalLedgerBalanceMinor: string;
          discrepancyMinor: string;
          reconciled: boolean;
        };
      }>().payables
    ).toMatchObject({
      subledgerBalanceMinor: "13500",
      generalLedgerBalanceMinor: "13500",
      discrepancyMinor: "0",
      reconciled: true
    });
    const openPayablesReport = await app.inject({
      method: "GET",
      url: "/v1/reports/payables?asOf=2026-04-10",
      headers: headers(organizationId)
    });
    expect(openPayablesReport.statusCode, openPayablesReport.body).toBe(200);
    expect(
      openPayablesReport.json<{
        report: {
          subledgerBalanceMinor: string;
          controlBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
        };
      }>().report
    ).toMatchObject({
      subledgerBalanceMinor: "13500",
      controlBalanceMinor: "13500",
      differenceMinor: "0",
      isReconciled: true
    });
    const paid = await app.inject({
      method: "POST",
      url: "/v1/bill-payments",
      headers: headers(organizationId, randomUUID()),
      payload: {
        vendorId,
        paymentDate: "2026-04-15",
        amountMinor: "10000",
        currency: "USD",
        fxRateSnapshotId: settlementRateId,
        method: "ELECTRONIC_TRANSFER",
        payingAccountId: cash.id,
        allocations: [{ billId: bill.id, amountMinor: "10000" }]
      }
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const allocation = paid.json<{
      payment: {
        currency: string;
        allocations: Array<{
          carryingBaseRelievedMinor: string;
          settlementBaseMinor: string;
          realizedFxBaseMinor: string;
        }>;
      };
    }>().payment.allocations[0]!;
    expect(allocation.carryingBaseRelievedMinor).toBe("13500");
    expect(allocation.settlementBaseMinor).toBe("13700");
    expect(allocation.realizedFxBaseMinor).toBe("-200");
    const payable = await prisma.monetaryPosition.findFirstOrThrow({
      where: { organizationId, sourceType: "bill", sourceId: bill.id }
    });
    expect(payable.active).toBe(false);
    expect(payable.cumulativeRealizedFxMinor).toBe(-200n);
    const settledPayables = await app.inject({
      method: "GET",
      url: "/v1/payables/aging",
      headers: headers(organizationId)
    });
    expect(settledPayables.statusCode, settledPayables.body).toBe(200);
    expect(
      settledPayables.json<{
        payables: {
          subledgerBalanceMinor: string;
          generalLedgerBalanceMinor: string;
          discrepancyMinor: string;
          reconciled: boolean;
        };
      }>().payables
    ).toMatchObject({
      subledgerBalanceMinor: "0",
      generalLedgerBalanceMinor: "0",
      discrepancyMinor: "0",
      reconciled: true
    });
    const settledPayablesReport = await app.inject({
      method: "GET",
      url: "/v1/reports/payables?asOf=2026-04-30",
      headers: headers(organizationId)
    });
    expect(settledPayablesReport.statusCode, settledPayablesReport.body).toBe(200);
    expect(
      settledPayablesReport.json<{
        report: {
          subledgerBalanceMinor: string;
          controlBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
        };
      }>().report
    ).toMatchObject({
      subledgerBalanceMinor: "0",
      controlBalanceMinor: "0",
      differenceMinor: "0",
      isReconciled: true
    });
  });
});
