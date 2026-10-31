import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { AttachmentScanner } from "./services/invoice-document-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase7-owner@example.test";

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
    payload: { legalName: "Phase Seven Ltd", displayName: "Phase Seven" }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configure(organizationId: string, email = owner) {
  const state = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId, email)
  });
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/setup/profile",
        headers: headers(organizationId, email),
        payload: {
          version,
          legalName: "Phase Seven Ltd",
          displayName: "Phase Seven",
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
        headers: headers(organizationId, email, randomUUID()),
        payload: {}
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/fiscal-year/initialize",
        headers: headers(organizationId, email),
        payload: {}
      })
    ).statusCode
  ).toBe(200);
}

async function accounts(organizationId: string, email = owner) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId, email)
  });
  return response.json<{
    accounts: Array<{
      id: string;
      type: string;
      systemPurpose: string | null;
      isControl: boolean;
    }>;
  }>().accounts;
}

async function createTax(
  organizationId: string,
  payableAccountId: string,
  recoverableAccountId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/setup/tax-codes/versions",
    headers: headers(organizationId),
    payload: {
      code: "GST",
      name: "GST",
      treatment: "STANDARD",
      calculationMode: "EXCLUSIVE",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      sourceName: "Test configuration",
      sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
      components: [
        {
          name: "GST",
          jurisdiction: "CA",
          rate: "0.050000",
          recoverablePercent: "1.000000",
          payableAccountId,
          recoverableAccountId
        }
      ]
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ taxCodeVersion: { taxCodeId: string } }>().taxCodeVersion.taxCodeId;
}

async function vendor(organizationId: string, number = "V-001", email = owner) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/vendors",
    headers: headers(organizationId, email),
    payload: {
      vendorNumber: number,
      legalName: "Prairie Supply Ltd",
      displayName: "Prairie Supply",
      defaultPaymentTermsDays: 30
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ vendor: { id: string; version: number } }>().vendor;
}

async function addMember(organizationId: string, email: string, role: string) {
  const invitation = await app.inject({
    method: "POST",
    url: "/v1/organizations/current/invitations",
    headers: headers(organizationId),
    payload: { email, role }
  });
  expect(invitation.statusCode).toBe(201);
  const token = invitation.json<{ token: string }>().token;
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/invitations/accept",
        headers: headers(undefined, email),
        payload: { token }
      })
    ).statusCode
  ).toBe(200);
}

async function bill(
  organizationId: string,
  vendorId: string,
  accountId: string,
  taxCodeId?: string,
  invoiceNumber = "SUP-001"
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/bills",
    headers: headers(organizationId),
    payload: {
      vendorId,
      vendorInvoiceNumber: invoiceNumber,
      issueDate: "2026-02-01",
      lines: [
        {
          description: "Materials",
          quantity: "2.5",
          unitCostMinor: "1000",
          discountMinor: "100",
          accountId,
          taxCodeId
        }
      ]
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{
    bill: {
      id: string;
      version: number;
      status: string;
      grandTotalMinor: string;
      recoverableTaxMinor: string;
      lines: Array<{ id: string; totalMinor: string }>;
    };
  }>().bill;
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

describe("Phase 7 purchasing and accounts payable", () => {
  it("isolates, versions, archives, and protects unique vendor records", async () => {
    const first = await createOrganization();
    const second = await createOrganization("phase7-other@example.test");
    const created = await vendor(first);
    expect(await vendor(first, "V-001").catch(() => null)).toBeNull();
    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/vendors/${created.id}`,
      headers: headers(first),
      payload: { version: created.version + 1, displayName: "Changed" }
    });
    expect(stale.statusCode).toBe(409);
    const hidden = await app.inject({
      method: "PATCH",
      url: `/v1/vendors/${created.id}`,
      headers: headers(second, "phase7-other@example.test"),
      payload: { version: created.version, displayName: "Cross tenant" }
    });
    expect(hidden.statusCode).toBe(409);
    const archived = await app.inject({
      method: "POST",
      url: `/v1/vendors/${created.id}/archive`,
      headers: headers(first),
      payload: { version: created.version }
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<{ vendor: { isActive: boolean } }>().vendor.isActive).toBe(false);
  });

  it("keeps drafts off-ledger and posts exact balanced recoverable-tax journals idempotently", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const expense = chart.find((row) => row.type === "EXPENSE" && !row.isControl)!;
    const taxPayable = chart.find((row) => row.systemPurpose === "tax-payable")!;
    const taxRecoverable = chart.find((row) => row.systemPurpose === "tax-recoverable")!;
    const tax = await createTax(organizationId, taxPayable.id, taxRecoverable.id);
    const supplier = await vendor(organizationId);
    const draft = await bill(organizationId, supplier.id, expense.id, tax);
    expect(draft.status).toBe("DRAFT");
    expect(draft.grandTotalMinor).toBe("2520");
    expect(draft.recoverableTaxMinor).toBe("120");
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);

    const key = randomUUID();
    const [first, concurrent] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/bills/${draft.id}/post`,
        headers: headers(organizationId, owner, key),
        payload: { version: draft.version }
      }),
      app.inject({
        method: "POST",
        url: `/v1/bills/${draft.id}/post`,
        headers: headers(organizationId, owner, key),
        payload: { version: draft.version }
      })
    ]);
    expect([first.statusCode, concurrent.statusCode].sort()).toEqual([201, 201]);
    const posted = await prisma.bill.findUniqueOrThrow({ where: { id: draft.id } });
    const journal = await prisma.journal.findUniqueOrThrow({
      where: { id: posted.journalId! },
      include: { lines: true }
    });
    expect(journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(2520n);
    expect(journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n)).toBe(2520n);
    expect(journal.lines.find((line) => line.accountId === taxRecoverable.id)?.debitMinor).toBe(
      120n
    );
    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/post`,
      headers: headers(organizationId, owner, key),
      payload: { version: draft.version + 1 }
    });
    expect(mismatch.statusCode).toBe(409);
    await expect(
      prisma.bill.update({ where: { id: draft.id }, data: { vendorInvoiceNumber: "MUTATED" } })
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.bill.update({ where: { id: draft.id }, data: { amountPaidMinor: 1n } })
    ).rejects.toThrow(/allocations/i);
  });

  it("rejects duplicate bills, closed periods, unauthorized posting, and cross-tenant accounts", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const other = await createOrganization("phase7-other@example.test");
    await configure(other, "phase7-other@example.test");
    const chart = await accounts(organizationId);
    const otherChart = await accounts(other, "phase7-other@example.test");
    const supplier = await vendor(organizationId);
    const expense = chart.find((row) => row.type === "EXPENSE" && !row.isControl)!;
    const draft = await bill(organizationId, supplier.id, expense.id);
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/bills",
      headers: headers(organizationId),
      payload: {
        vendorId: supplier.id,
        vendorInvoiceNumber: "SUP-001",
        issueDate: "2026-02-01",
        lines: [
          { description: "Duplicate", quantity: "1", unitCostMinor: "1", accountId: expense.id }
        ]
      }
    });
    expect(duplicate.statusCode).toBe(409);
    const crossTenant = await app.inject({
      method: "POST",
      url: "/v1/bills",
      headers: headers(organizationId),
      payload: {
        vendorId: supplier.id,
        vendorInvoiceNumber: "SUP-002",
        issueDate: "2026-02-01",
        lines: [
          {
            description: "Cross tenant",
            quantity: "1",
            unitCostMinor: "1",
            accountId: otherChart.find((row) => row.type === "EXPENSE")!.id
          }
        ]
      }
    });
    expect(crossTenant.statusCode).toBe(422);
    await addMember(organizationId, "phase7-reader@example.test", "READ_ONLY");
    const unauthorized = await app.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/post`,
      headers: headers(organizationId, "phase7-reader@example.test", randomUUID()),
      payload: { version: draft.version }
    });
    expect(unauthorized.statusCode).toBe(403);
    await prisma.fiscalPeriod.updateMany({
      where: { organizationId, startDate: { lte: new Date("2026-02-01") } },
      data: { status: "CLOSED" }
    });
    const closed = await app.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: draft.version }
    });
    expect(closed.statusCode).toBe(409);
  });

  it("serializes partial and concurrent payments, reverses exactly, and reconciles AP", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const expense = chart.find((row) => row.type === "EXPENSE" && !row.isControl)!;
    const cash = chart.find((row) => row.systemPurpose === "cash")!;
    const supplier = await vendor(organizationId);
    const first = await bill(organizationId, supplier.id, expense.id, undefined, "SUP-101");
    const second = await bill(organizationId, supplier.id, expense.id, undefined, "SUP-102");
    for (const draft of [first, second])
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/bills/${draft.id}/post`,
            headers: headers(organizationId, owner, randomUUID()),
            payload: { version: draft.version }
          })
        ).statusCode
      ).toBe(201);
    const paymentPayload = {
      vendorId: supplier.id,
      paymentDate: "2026-02-10",
      amountMinor: "3000",
      method: "ELECTRONIC_TRANSFER",
      payingAccountId: cash.id,
      reference: "PAY-101",
      allocations: [
        { billId: first.id, amountMinor: "2000" },
        { billId: second.id, amountMinor: "1000" }
      ]
    };
    const paid = await app.inject({
      method: "POST",
      url: "/v1/bill-payments",
      headers: headers(organizationId, owner, randomUUID()),
      payload: paymentPayload
    });
    expect(paid.statusCode).toBe(201);
    const third = await bill(organizationId, supplier.id, expense.id, undefined, "SUP-103");
    await app.inject({
      method: "POST",
      url: `/v1/bills/${third.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: third.version }
    });
    const paymentId = paid.json<{ payment: { id: string } }>().payment.id;
    await expect(
      prisma.billPaymentAllocation.create({
        data: {
          organizationId,
          billPaymentId: paymentId,
          billId: third.id,
          amountMinor: 1n
        }
      })
    ).rejects.toThrow(/exceed/i);
    const excessive = await app.inject({
      method: "POST",
      url: "/v1/bill-payments",
      headers: headers(organizationId, owner, randomUUID()),
      payload: { ...paymentPayload, reference: "PAY-EXCESS" }
    });
    expect(excessive.statusCode).toBe(409);
    const reversed = await app.inject({
      method: "POST",
      url: `/v1/bill-payments/${paymentId}/reverse`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { effectiveDate: "2026-02-11", reason: "Test correction" }
    });
    expect(reversed.statusCode, reversed.body).toBe(200);
    const payables = await app.inject({
      method: "GET",
      url: "/v1/payables/aging?asOf=2026-03-31",
      headers: headers(organizationId)
    });
    expect(payables.statusCode).toBe(200);
    expect(payables.json<{ payables: { reconciled: boolean } }>().payables.reconciled).toBe(true);
  });

  it("allows only one of simultaneous overpaying payments and one simultaneous reversal", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const expense = chart.find((row) => row.type === "EXPENSE" && !row.isControl)!;
    const cash = chart.find((row) => row.systemPurpose === "cash")!;
    const supplier = await vendor(organizationId);
    const draft = await bill(organizationId, supplier.id, expense.id);
    await app.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: draft.version }
    });
    const payment = (reference: string) =>
      app.inject({
        method: "POST",
        url: "/v1/bill-payments",
        headers: headers(organizationId, owner, randomUUID()),
        payload: {
          vendorId: supplier.id,
          paymentDate: "2026-02-10",
          amountMinor: "2000",
          method: "ELECTRONIC_TRANSFER",
          payingAccountId: cash.id,
          reference,
          allocations: [{ billId: draft.id, amountMinor: "2000" }]
        }
      });
    const attempts = await Promise.all([payment("CONCURRENT-A"), payment("CONCURRENT-B")]);
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const successful = attempts.find((response) => response.statusCode === 201)!;
    const paymentId = successful.json<{ payment: { id: string } }>().payment.id;
    const reverse = () =>
      app.inject({
        method: "POST",
        url: `/v1/bill-payments/${paymentId}/reverse`,
        headers: headers(organizationId, owner, randomUUID()),
        payload: { effectiveDate: "2026-02-11", reason: "Concurrent correction" }
      });
    const reversals = await Promise.all([reverse(), reverse()]);
    expect(
      reversals.map((response) => response.statusCode).sort(),
      reversals.map((response) => response.body).join("\n")
    ).toEqual([200, 409]);
    expect(
      await prisma.journal.count({
        where: { organizationId, reversedJournalId: { not: null }, sourceId: paymentId }
      })
    ).toBe(1);
  });

  it("records exact immediate expenses, warns on duplicate references, and reverses by new journal", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const expenseAccount = chart.find((row) => row.type === "EXPENSE" && !row.isControl)!;
    const cash = chart.find((row) => row.systemPurpose === "cash")!;
    const payload = {
      reference: "RECEIPT-7",
      expenseDate: "2026-02-12",
      method: "CASH",
      payingAccountId: cash.id,
      lines: [
        {
          description: "Office supplies",
          quantity: "3",
          unitCostMinor: "499",
          accountId: expenseAccount.id
        }
      ]
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/immediate-expenses",
      headers: headers(organizationId, owner, randomUUID()),
      payload
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<{ duplicateReferenceWarning: boolean }>().duplicateReferenceWarning).toBe(
      false
    );
    const second = await app.inject({
      method: "POST",
      url: "/v1/immediate-expenses",
      headers: headers(organizationId, owner, randomUUID()),
      payload
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ duplicateReferenceWarning: boolean }>().duplicateReferenceWarning).toBe(
      true
    );
    const expense = first.json<{ expense: { id: string; journalId: string } }>().expense;
    const sourceLine = await prisma.immediateExpenseLine.findFirstOrThrow({
      where: { immediateExpenseId: expense.id }
    });
    await expect(
      prisma.immediateExpenseLine.create({
        data: {
          organizationId,
          immediateExpenseId: expense.id,
          lineNumber: 2,
          description: "Late line",
          quantityMicros: 1_000_000n,
          unitCostMinor: 1n,
          netAmountMinor: 1n,
          totalMinor: 1n,
          accountId: sourceLine.accountId
        }
      })
    ).rejects.toThrow(/diverge/i);
    const reversed = await app.inject({
      method: "POST",
      url: `/v1/immediate-expenses/${expense.id}/reverse`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { effectiveDate: "2026-02-13", reason: "Entered twice" }
    });
    expect(reversed.statusCode, reversed.body).toBe(200);
    const journals = await prisma.journal.findMany({
      where: {
        organizationId,
        OR: [{ id: expense.journalId }, { reversedJournalId: expense.journalId }]
      },
      include: { lines: true }
    });
    expect(journals).toHaveLength(2);
    expect(
      journals.flatMap((journal) => journal.lines).reduce((sum, line) => sum + line.debitMinor, 0n)
    ).toBe(
      journals.flatMap((journal) => journal.lines).reduce((sum, line) => sum + line.creditMinor, 0n)
    );
  });

  it("posts and applies partial vendor credits without changing original bill history", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const expense = chart.find((row) => row.type === "EXPENSE" && !row.isControl)!;
    const supplier = await vendor(organizationId);
    const draft = await bill(organizationId, supplier.id, expense.id);
    await app.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: draft.version }
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/vendor-credits",
      headers: headers(organizationId),
      payload: {
        vendorId: supplier.id,
        vendorCreditNumber: "VC-001",
        issueDate: "2026-02-15",
        reason: "Returned materials",
        lines: [{ billLineId: draft.lines[0]!.id, amountMinor: "500" }]
      }
    });
    expect(created.statusCode).toBe(201);
    const credit = created.json<{ vendorCredit: { id: string; version: number } }>().vendorCredit;
    const posted = await app.inject({
      method: "POST",
      url: `/v1/vendor-credits/${credit.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: credit.version }
    });
    expect(posted.statusCode, posted.body).toBe(201);
    const applied = await app.inject({
      method: "POST",
      url: `/v1/vendor-credits/${credit.id}/apply`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { allocations: [{ billId: draft.id, amountMinor: "500" }] }
    });
    expect(applied.statusCode).toBe(200);
    const source = await prisma.bill.findUniqueOrThrow({ where: { id: draft.id } });
    expect(source.grandTotalMinor).toBe(2400n);
    expect(source.creditedMinor).toBe(500n);
    expect(await prisma.journal.count({ where: { sourceType: "vendor_credit" } })).toBe(1);
  });

  it("accepts verified attachments and rejects spoofed, malicious, and cross-tenant reads", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const other = await createOrganization("phase7-other@example.test");
    const chart = await accounts(organizationId);
    const supplier = await vendor(organizationId);
    const draft = await bill(
      organizationId,
      supplier.id,
      chart.find((row) => row.type === "EXPENSE" && !row.isControl)!.id
    );
    const pdf = Buffer.from("%PDF-1.4\nphase7 receipt\n%%EOF");
    const uploaded = await app.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/attachments`,
      headers: {
        ...headers(organizationId),
        "content-type": "application/pdf",
        "x-file-name": "receipt.pdf"
      },
      payload: pdf
    });
    expect(uploaded.statusCode).toBe(201);
    const attachmentId = uploaded.json<{ attachment: { id: string } }>().attachment.id;
    const download = await app.inject({
      method: "GET",
      url: `/v1/purchase-attachments/${attachmentId}`,
      headers: headers(organizationId)
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    const hidden = await app.inject({
      method: "GET",
      url: `/v1/purchase-attachments/${attachmentId}`,
      headers: headers(other, "phase7-other@example.test")
    });
    expect(hidden.statusCode).toBe(404);
    const spoofed = await app.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/attachments`,
      headers: {
        ...headers(organizationId),
        "content-type": "application/pdf",
        "x-file-name": "fake.pdf"
      },
      payload: Buffer.from("MZ executable")
    });
    expect(spoofed.statusCode).toBe(422);
  });
});

describe("Phase 7 attachment scanner adapter", () => {
  it("rejects content when the malware adapter rejects it", async () => {
    const rejectingScanner: AttachmentScanner = { scan: () => Promise.resolve("REJECTED") };
    const isolatedApp = buildApp({ prisma, attachmentScanner: rejectingScanner });
    await isolatedApp.ready();
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const supplier = await vendor(organizationId);
    const draft = await bill(
      organizationId,
      supplier.id,
      chart.find((row) => row.type === "EXPENSE" && !row.isControl)!.id
    );
    const response = await isolatedApp.inject({
      method: "POST",
      url: `/v1/bills/${draft.id}/attachments`,
      headers: {
        ...headers(organizationId),
        "content-type": "application/pdf",
        "x-file-name": "receipt.pdf"
      },
      payload: Buffer.from("%PDF-1.4\nsafe shape")
    });
    expect(response.statusCode).toBe(422);
    await isolatedApp.close();
  });
});
