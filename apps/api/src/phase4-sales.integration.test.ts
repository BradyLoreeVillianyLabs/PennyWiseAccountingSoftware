import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { PaymentProviderAdapter } from "./services/payment-provider.js";
import { PaymentService } from "./services/payment-service.js";
import {
  DevelopmentReceiptEmailProvider,
  PaymentOutboxWorker
} from "./services/payment-outbox-worker.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase4-owner@example.test";

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
    payload: { legalName: "Phase Four Ltd", displayName: "Phase Four" }
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
          legalName: "Phase Four Ltd",
          displayName: "Phase Four",
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
    accounts: Array<{ id: string; systemPurpose: string | null; code: string; name: string }>;
  }>().accounts;
}

async function customer(organizationId: string, number = "C-001", email = owner) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: headers(organizationId, email),
    payload: {
      customerNumber: number,
      displayName: "Northern Customer",
      email: "customer@example.test",
      defaultPaymentTermsDays: 30,
      defaultCurrency: "CAD"
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ customer: { id: string; version: number } }>().customer;
}

async function taxCode(
  organizationId: string,
  payableAccountId: string,
  email = owner,
  treatment: "STANDARD" | "ZERO_RATED" | "EXEMPT" = "STANDARD"
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/setup/tax-codes/versions",
    headers: headers(organizationId, email),
    payload: {
      code: "GST",
      name: "GST",
      treatment,
      calculationMode: "EXCLUSIVE",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      sourceName: "Owner verified test configuration",
      sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
      components: [
        {
          name: "GST",
          jurisdiction: "CA",
          rate: treatment === "EXEMPT" ? "0.000000" : "0.050000",
          recoverablePercent: "1.000000",
          payableAccountId,
          recoverableAccountId: null
        }
      ]
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ taxCodeVersion: { taxCodeId: string } }>().taxCodeVersion.taxCodeId;
}

async function product(
  organizationId: string,
  incomeAccountId: string,
  taxCodeId: string,
  email = owner
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/products",
    headers: headers(organizationId, email),
    payload: {
      sku: "SERVICE-001",
      name: "Consulting",
      itemType: "SERVICE",
      salesPriceMinor: "1000",
      incomeAccountId,
      defaultTaxCodeId: taxCodeId
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ product: { id: string; version: number } }>().product;
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

describe("Phase 4 sales and invoice accounting", () => {
  it("allocates race-safe customer numbers when the number is omitted", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const responses = await Promise.all(
      ["First automatic customer", "Second automatic customer"].map((displayName) =>
        app.inject({
          method: "POST",
          url: "/v1/customers",
          headers: headers(organizationId),
          payload: {
            displayName,
            defaultPaymentTermsDays: 30,
            defaultCurrency: "CAD"
          }
        })
      )
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 201]);
    expect(
      responses
        .map((response) => response.json<{ customer: { customerNumber: string } }>().customer)
        .map((customer) => customer.customerNumber)
        .sort()
    ).toEqual(["CUST-0001", "CUST-0002"]);
  });

  it("isolates customers and products and rejects duplicate organization identifiers", async () => {
    const first = await createOrganization();
    const second = await createOrganization("phase4-other@example.test");
    await configure(first);
    const chart = await accounts(first);
    const taxPayable = chart.find((account) => account.systemPurpose === "tax-payable")!;
    const revenue = chart.find((account) => account.systemPurpose === "professional-services")!;
    const tax = await taxCode(first, taxPayable.id);
    const created = await customer(first);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/customers",
          headers: headers(first),
          payload: {
            customerNumber: "C-001",
            displayName: "Duplicate",
            defaultPaymentTermsDays: 30,
            defaultCurrency: "CAD"
          }
        })
      ).statusCode
    ).toBe(409);
    const item = await product(first, revenue.id, tax);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/customers/${created.id}`,
          headers: headers(second, "phase4-other@example.test")
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/products/${item.id}`,
          headers: headers(second, "phase4-other@example.test")
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/products",
          headers: headers(first),
          payload: {
            sku: "SERVICE-001",
            name: "Duplicate",
            itemType: "SERVICE",
            salesPriceMinor: "1",
            incomeAccountId: revenue.id,
            defaultTaxCodeId: tax
          }
        })
      ).statusCode
    ).toBe(409);
    const inventory = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: headers(first),
      payload: {
        sku: "INV-001",
        name: "Inventory placeholder",
        itemType: "INVENTORY_PRODUCT",
        salesPriceMinor: "1000",
        incomeAccountId: revenue.id,
        expenseAccountId: revenue.id,
        inventoryAssetAccountId: chart.find((account) => account.systemPurpose === "cash")!.id
      }
    });
    expect(inventory.statusCode).toBe(422);
  });

  it("calculates, posts, snapshots, and idempotently replays an invoice", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const tax = await taxCode(
      organizationId,
      chart.find((account) => account.systemPurpose === "tax-payable")!.id
    );
    const item = await product(
      organizationId,
      chart.find((account) => account.systemPurpose === "professional-services")!.id,
      tax
    );
    const buyer = await customer(organizationId);
    const draftResponse = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId),
      payload: {
        customerId: buyer.id,
        issueDate: "2026-03-15",
        lines: [
          { productItemId: item.id, quantity: "2", unitPriceMinor: "1000", discountMinor: "100" }
        ]
      }
    });
    expect(draftResponse.statusCode).toBe(201);
    const draft = draftResponse.json<{
      invoice: {
        id: string;
        version: number;
        grandTotalMinor: string;
        taxTotalMinor: string;
        status: string;
      };
    }>().invoice;
    expect(draft.status).toBe("DRAFT");
    expect(draft.grandTotalMinor).toBe("1995");
    expect(draft.taxTotalMinor).toBe("95");
    expect((await prisma.journal.count({ where: { organizationId } })).toString()).toBe("0");
    const key = randomUUID();
    const unauthorizedPost = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/post`,
      headers: headers(organizationId, "not-a-member@example.test", randomUUID()),
      payload: { version: draft.version }
    });
    expect([403, 404]).toContain(unauthorizedPost.statusCode);
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/invoices/${draft.id}/post`,
          headers: headers(organizationId, owner, key),
          payload: { version: draft.version }
        })
      )
    );
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 201]);
    expect(await prisma.journal.count({ where: { organizationId, sourceType: "invoice" } })).toBe(
      1
    );
    const posted = (first.statusCode === 201 ? first : second).json<{
      invoice: {
        invoiceNumber: string;
        journalId: string;
        status: string;
        grandTotalMinor: string;
        customerNameSnapshot: string;
      };
    }>().invoice;
    expect(posted.invoiceNumber).toBe("INV-0001");
    expect(posted.status).toBe("POSTED");
    const journal = await prisma.journal.findUniqueOrThrow({
      where: { id: posted.journalId },
      include: { lines: true }
    });
    expect(journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(
      journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n)
    );
    const updatedCustomer = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${buyer.id}`,
      headers: headers(organizationId),
      payload: { version: buyer.version, displayName: "Changed later" }
    });
    expect(updatedCustomer.statusCode).toBe(200);
    const fetched = await app.inject({
      method: "GET",
      url: `/v1/invoices/${draft.id}`,
      headers: headers(organizationId)
    });
    expect(fetched.statusCode).toBe(200);
    expect(
      fetched.json<{ invoice: { customerNameSnapshot: string } }>().invoice.customerNameSnapshot
    ).toBe("Northern Customer");
    const impactResponse = await app.inject({
      method: "GET",
      url: `/v1/invoices/${draft.id}/books-impact`,
      headers: headers(organizationId)
    });
    expect(impactResponse.statusCode).toBe(200);
    const impact = impactResponse.json<{
      impact: {
        journalId: string;
        totals: {
          receivablesDebitMinor: string;
          revenueCreditMinor: string;
          taxPayableCreditMinor: string;
          debitsMinor: string;
          creditsMinor: string;
        };
      };
    }>().impact;
    expect(impact.journalId).toBe(posted.journalId);
    expect(impact.totals.receivablesDebitMinor).toBe("1995");
    expect(impact.totals.revenueCreditMinor).toBe("1900");
    expect(impact.totals.taxPayableCreditMinor).toBe("95");
    expect(impact.totals.debitsMinor).toBe(impact.totals.creditsMinor);
    await expect(
      prisma.invoice.update({ where: { id: draft.id }, data: { grandTotalMinor: 1n } })
    ).rejects.toThrow(/immutable/i);
    const differentPayload = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/post`,
      headers: headers(organizationId, owner, key),
      payload: { version: draft.version, effectiveDate: "2026-03-16" }
    });
    expect(differentPayload.statusCode).toBe(409);
    expect(differentPayload.json<{ error: { code: string } }>().error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED"
    );
    const current = await app.inject({
      method: "GET",
      url: `/v1/invoices/${draft.id}`,
      headers: headers(organizationId)
    });
    const currentInvoice = current.json<{ invoice: { version: number } }>().invoice;
    const [voidFirst, voidSecond] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/invoices/${draft.id}/void`,
        headers: headers(organizationId, owner, randomUUID()),
        payload: { version: currentInvoice.version, reason: "Customer cancellation" }
      }),
      app.inject({
        method: "POST",
        url: `/v1/invoices/${draft.id}/void`,
        headers: headers(organizationId, owner, randomUUID()),
        payload: { version: currentInvoice.version, reason: "Customer cancellation" }
      })
    ]);
    expect([voidFirst.statusCode, voidSecond.statusCode].sort()).toEqual([200, 409]);
    expect(
      await prisma.journal.count({ where: { organizationId, reversedJournalId: posted.journalId } })
    ).toBe(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/invoices/${draft.id}`,
          headers: headers(organizationId)
        })
      ).json<{ invoice: { status: string } }>().invoice.status
    ).toBe("VOIDED");
  });

  it("finalizes a draft through the one-step idempotent action", async () => {
    const organizationId = await createOrganization("finalize-owner@example.test");
    await configure(organizationId, "finalize-owner@example.test");
    const chart = await accounts(organizationId, "finalize-owner@example.test");
    const tax = await taxCode(
      organizationId,
      chart.find((account) => account.systemPurpose === "tax-payable")!.id,
      "finalize-owner@example.test",
      "ZERO_RATED"
    );
    const item = await product(
      organizationId,
      chart.find((account) => account.systemPurpose === "professional-services")!.id,
      tax,
      "finalize-owner@example.test"
    );
    const buyer = await customer(organizationId, "FINAL-001", "finalize-owner@example.test");
    const draftResponse = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId, "finalize-owner@example.test"),
      payload: {
        customerId: buyer.id,
        issueDate: "2026-04-01",
        dueDate: "2026-05-01",
        paymentTermsDays: 30,
        customerFacingNotes: "Thank you",
        terms: "Net 30",
        lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: "5000" }]
      }
    });
    expect(draftResponse.statusCode).toBe(201);
    const draft = draftResponse.json<{ invoice: { id: string; version: number } }>().invoice;
    const key = randomUUID();
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/invoices/${draft.id}/finalize`,
          headers: headers(organizationId, "finalize-owner@example.test", key),
          payload: { version: draft.version }
        })
      )
    );
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 201]);
    expect(await prisma.journal.count({ where: { organizationId, sourceType: "invoice" } })).toBe(
      1
    );
    const replay = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/finalize`,
      headers: headers(organizationId, "finalize-owner@example.test", key),
      payload: { version: draft.version }
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ invoice: { status: string } }>().invoice.status).toBe("POSTED");
  });

  it.each(["ZERO_RATED", "EXEMPT"] as const)(
    "preserves %s tax treatment without creating tax amounts",
    async (treatment) => {
      const organizationId = await createOrganization();
      await configure(organizationId);
      const chart = await accounts(organizationId);
      const tax = await taxCode(
        organizationId,
        chart.find((account) => account.systemPurpose === "tax-payable")!.id,
        owner,
        treatment
      );
      const item = await product(
        organizationId,
        chart.find((account) => account.systemPurpose === "professional-services")!.id,
        tax
      );
      const buyer = await customer(organizationId);
      const response = await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: headers(organizationId),
        payload: {
          customerId: buyer.id,
          issueDate: "2026-03-15",
          lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: "1000" }]
        }
      });
      expect(response.statusCode).toBe(201);
      const invoice = response.json<{ invoice: { id: string; taxTotalMinor: string } }>().invoice;
      expect(invoice.taxTotalMinor).toBe("0");
      const line = await prisma.invoiceLine.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(line.taxTotalMinor).toBe(0n);
      expect(line.taxSnapshot).toMatchObject({ treatment, taxTotalMinor: "0" });
    }
  );

  it("allocates invoice numbers concurrently and rejects posting in a closed period", async () => {
    const email = "number-owner@example.test";
    const organizationId = await createOrganization(email);
    await configure(organizationId, email);
    const chart = await accounts(organizationId, email);
    const tax = await taxCode(
      organizationId,
      chart.find((account) => account.systemPurpose === "tax-payable")!.id,
      email
    );
    const item = await product(
      organizationId,
      chart.find((account) => account.systemPurpose === "professional-services")!.id,
      tax,
      email
    );
    const buyer = await customer(organizationId, "C-NUM", email);
    const drafts = await Promise.all(
      ["1", "2"].map((amount) =>
        app.inject({
          method: "POST",
          url: "/v1/invoices",
          headers: headers(organizationId, email),
          payload: {
            customerId: buyer.id,
            issueDate: "2026-03-15",
            lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: amount }]
          }
        })
      )
    );
    expect(drafts.map((response) => response.statusCode)).toEqual([201, 201]);
    const draftData = drafts.map(
      (response) => response.json<{ invoice: { id: string; version: number } }>().invoice
    );
    const postings = await Promise.all(
      draftData.map((invoice) =>
        app.inject({
          method: "POST",
          url: `/v1/invoices/${invoice.id}/post`,
          headers: headers(organizationId, email, randomUUID()),
          payload: { version: invoice.version }
        })
      )
    );
    if (postings.some((response) => response.statusCode !== 201))
      throw new Error(
        postings.map((response) => `${String(response.statusCode)} ${response.body}`).join(" | ")
      );
    expect(postings.map((response) => response.statusCode).sort()).toEqual([201, 201]);
    const numbers = postings
      .map(
        (response) => response.json<{ invoice: { invoiceNumber: string } }>().invoice.invoiceNumber
      )
      .sort();
    expect(numbers).toEqual(["INV-0001", "INV-0002"]);
    const periods = (
      await app.inject({
        method: "GET",
        url: "/v1/fiscal-periods",
        headers: headers(organizationId, email)
      })
    ).json<{ periods: Array<{ id: string; status: string }> }>().periods;
    const openPeriod = periods.find((period) => period.status === "OPEN");
    expect(openPeriod).toBeDefined();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/fiscal-periods/${openPeriod!.id}/close`,
          headers: headers(organizationId, email),
          payload: { reason: "Phase 4 concurrency test" }
        })
      ).statusCode
    ).toBe(200);
    const closedDraft = (
      await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: headers(organizationId, email),
        payload: {
          customerId: buyer.id,
          issueDate: "2026-03-20",
          lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: "100" }]
        }
      })
    ).json<{ invoice: { id: string; version: number } }>().invoice;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/invoices/${closedDraft.id}/post`,
          headers: headers(organizationId, email, randomUUID()),
          payload: { version: closedDraft.version }
        })
      ).statusCode
    ).toBe(409);
  });

  it("prevents excess credits, preserves the original, and reconciles AR", async () => {
    const organizationId = await createOrganization("credit-owner@example.test");
    await configure(organizationId, "credit-owner@example.test");
    const email = "credit-owner@example.test";
    const chart = await accounts(organizationId, email);
    const tax = await taxCode(
      organizationId,
      chart.find((account) => account.systemPurpose === "tax-payable")!.id,
      email
    );
    const item = await product(
      organizationId,
      chart.find((account) => account.systemPurpose === "professional-services")!.id,
      tax,
      email
    );
    const buyer = await customer(organizationId, "C-CR", email);
    const draft = (
      await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: headers(organizationId, "credit-owner@example.test"),
        payload: {
          customerId: buyer.id,
          issueDate: "2026-03-15",
          lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: "1000" }]
        }
      })
    ).json<{ invoice: { id: string; version: number } }>().invoice;
    const posted = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/post`,
      headers: headers(organizationId, "credit-owner@example.test", randomUUID()),
      payload: { version: draft.version }
    });
    if (posted.statusCode !== 201)
      throw new Error(`Invoice post failed: ${String(posted.statusCode)} ${posted.body}`);
    const full = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/credit-notes`,
      headers: headers(organizationId, "credit-owner@example.test"),
      payload: { issueDate: "2026-03-16", reason: "Full return", fullCredit: true }
    });
    expect(full.statusCode).toBe(201);
    const note = full.json<{
      creditNote: { id: string; version: number; grandTotalMinor: string };
    }>().creditNote;
    expect(note.grandTotalMinor).toBe("1050");
    const postedNote = await app.inject({
      method: "POST",
      url: `/v1/credit-notes/${note.id}/post`,
      headers: headers(organizationId, "credit-owner@example.test", randomUUID()),
      payload: { version: note.version }
    });
    expect(postedNote.statusCode).toBe(201);
    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/credit-notes`,
      headers: headers(organizationId, "credit-owner@example.test"),
      payload: { issueDate: "2026-03-17", reason: "Too much", fullCredit: true }
    });
    expect(duplicate.statusCode).toBe(409);
    const reconciliation = await app.inject({
      method: "GET",
      url: "/v1/receivables/reconciliation",
      headers: headers(organizationId, "credit-owner@example.test")
    });
    expect(reconciliation.statusCode).toBe(200);
    expect(
      reconciliation.json<{ reconciliation: { isReconciled: boolean; differenceMinor: string } }>()
        .reconciliation
    ).toMatchObject({ isReconciled: true, differenceMinor: "0" });
  });

  it("posts an idempotent manual payment with immutable allocation and reconciles AR", async () => {
    const email = "payment-owner@example.test";
    const organizationId = await createOrganization(email);
    await configure(organizationId, email);
    const chart = await accounts(organizationId, email);
    const tax = await taxCode(
      organizationId,
      chart.find((account) => account.systemPurpose === "tax-payable")!.id,
      email
    );
    const item = await product(
      organizationId,
      chart.find((account) => account.systemPurpose === "professional-services")!.id,
      tax,
      email
    );
    const buyer = await customer(organizationId, "C-PAY", email);
    const draftResponse = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId, email),
      payload: {
        customerId: buyer.id,
        issueDate: "2026-03-15",
        lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: "1000" }]
      }
    });
    const draft = draftResponse.json<{ invoice: { id: string; version: number } }>().invoice;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/invoices/${draft.id}/post`,
          headers: headers(organizationId, email, randomUUID()),
          payload: { version: draft.version }
        })
      ).statusCode
    ).toBe(201);
    const payload = {
      customerId: buyer.id,
      receivingAccountId: chart.find((account) => account.systemPurpose === "cash")!.id,
      paymentDate: "2026-03-16",
      amountMinor: "1100",
      methodCategory: "CHEQUE",
      allocations: [{ invoiceId: draft.id, amountMinor: "1050" }]
    };
    const key = randomUUID();
    const [first, replay] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: "/v1/payments/manual",
          headers: headers(organizationId, email, key),
          payload
        })
      )
    );
    expect([first.statusCode, replay.statusCode]).toEqual([201, 201]);
    expect(await prisma.payment.count({ where: { organizationId } })).toBe(1);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { organizationId },
      include: { allocations: true, journal: { include: { lines: true } } }
    });
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.allocations).toHaveLength(1);
    expect(payment.journal!.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(
      payment.journal!.lines.reduce((sum, line) => sum + line.creditMinor, 0n)
    );
    expect(
      await prisma.paymentReceipt.count({ where: { organizationId, paymentId: payment.id } })
    ).toBe(1);
    const resendKey = randomUUID();
    const [resendFirst, resendReplay] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/payments/${payment.id}/receipt/resend`,
          headers: headers(organizationId, email, resendKey),
          payload: {}
        })
      )
    );
    expect([resendFirst.statusCode, resendReplay.statusCode]).toEqual([202, 202]);
    expect(
      await prisma.outboxEvent.count({
        where: { organizationId, eventType: "payment.receipt-email-requested" }
      })
    ).toBe(1);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    const receiptEmail = new DevelopmentReceiptEmailProvider();
    const receiptWorker = new PaymentOutboxWorker(prisma, new PaymentService(prisma), receiptEmail);
    expect(await receiptWorker.processPendingReceiptEmails(organizationId, owner.id)).toBe(1);
    expect(receiptEmail.sent).toHaveLength(1);
    expect(receiptEmail.sent[0]?.recipientEmail).toBe("customer@example.test");
    expect(receiptEmail.sent[0]?.receiptNumber).toMatch(/^RCT-\d{12}$/);
    expect(await receiptWorker.processPendingReceiptEmails(organizationId, owner.id)).toBe(0);
    const invoiceLine = await prisma.invoiceLine.findFirstOrThrow({
      where: { invoiceId: draft.id, organizationId },
      select: { id: true }
    });
    const creditDraftResponse = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/credit-notes`,
      headers: headers(organizationId, email),
      payload: {
        issueDate: "2026-03-17",
        reason: "Refunded service portion",
        lines: [{ invoiceLineId: invoiceLine.id, amountMinor: "50" }]
      }
    });
    expect(creditDraftResponse.statusCode).toBe(201);
    const creditDraft = creditDraftResponse.json<{ creditNote: { id: string; version: number } }>()
      .creditNote;
    const creditPostResponse = await app.inject({
      method: "POST",
      url: `/v1/credit-notes/${creditDraft.id}/post`,
      headers: headers(organizationId, email, randomUUID()),
      payload: { version: creditDraft.version }
    });
    expect(creditPostResponse.statusCode).toBe(201);
    const refundKey = randomUUID();
    const [refundFirst, refundReplay] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/payments/${payment.id}/refunds`,
          headers: headers(organizationId, email, refundKey),
          payload: {
            amountMinor: "50",
            reason: "Returning unapplied credit",
            treatment: "UNAPPLIED_PAYMENT"
          }
        })
      )
    );
    expect([refundFirst.statusCode, refundReplay.statusCode]).toEqual([201, 201]);
    const refunded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(refunded).toMatchObject({
      status: "PARTIALLY_REFUNDED",
      refundedMinor: 50n,
      unappliedMinor: 0n
    });
    expect(
      await prisma.paymentRefund.count({
        where: { organizationId, paymentId: payment.id, status: "SUCCEEDED" }
      })
    ).toBe(1);
    const creditRefund = await app.inject({
      method: "POST",
      url: `/v1/payments/${payment.id}/refunds`,
      headers: headers(organizationId, email, randomUUID()),
      payload: {
        amountMinor: "50",
        reason: "Refunding credited service",
        treatment: "CREDIT_NOTE_AND_REFUND",
        creditNoteId: creditDraft.id
      }
    });
    expect(creditRefund.statusCode).toBe(201);
    await expect(
      prisma.paymentRefund.create({
        data: {
          organizationId,
          paymentId: payment.id,
          creditNoteId: creditDraft.id,
          amountMinor: 1n,
          currency: "CAD",
          status: "SUCCEEDED",
          treatment: "CREDIT_NOTE_AND_REFUND",
          reason: "Must not exceed the posted credit note",
          requestedByUserId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id
        }
      })
    ).rejects.toThrow(/exceeds the credited amount/i);
    const paymentDetail = await app.inject({
      method: "GET",
      url: `/v1/payments/${payment.id}`,
      headers: headers(organizationId, email)
    });
    expect(paymentDetail.statusCode).toBe(200);
    expect(
      paymentDetail.json<{ payment: { refunds: readonly unknown[] } }>().payment.refunds
    ).toHaveLength(2);
    await expect(
      prisma.paymentAllocation.delete({ where: { id: payment.allocations[0]!.id } })
    ).rejects.toThrow(/immutable/i);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/receivables/reconciliation",
          headers: headers(organizationId, email)
        })
      ).json<{ reconciliation: { isReconciled: boolean } }>().reconciliation.isReconciled
    ).toBe(true);
  });

  it("creates one hosted checkout and applies a signed webhook exactly once", async () => {
    const email = "hosted-payment-owner@example.test";
    const organizationId = await createOrganization(email);
    await configure(organizationId, email);
    const chart = await accounts(organizationId, email);
    const tax = await taxCode(
      organizationId,
      chart.find((account) => account.systemPurpose === "tax-payable")!.id,
      email
    );
    const item = await product(
      organizationId,
      chart.find((account) => account.systemPurpose === "professional-services")!.id,
      tax,
      email
    );
    const buyer = await customer(organizationId, "C-HOSTED", email);
    const draft = (
      await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: headers(organizationId, email),
        payload: {
          customerId: buyer.id,
          issueDate: "2026-03-15",
          lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: "1000" }]
        }
      })
    ).json<{ invoice: { id: string; version: number } }>().invoice;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/invoices/${draft.id}/post`,
          headers: headers(organizationId, email, randomUUID()),
          payload: { version: draft.version }
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/payment-settings",
          headers: headers(organizationId, email),
          payload: {
            clearingAccountId: chart.find((account) => account.systemPurpose === "cash")!.id,
            feeExpenseAccountId: chart.find(
              (account) => account.systemPurpose === "general-expense"
            )!.id,
            allowPartialPayments: true,
            minimumPartialMinor: "100"
          }
        })
      ).statusCode
    ).toBe(200);
    const connected = await app.inject({
      method: "POST",
      url: "/v1/payment-account/connect",
      headers: headers(organizationId, email),
      payload: { returnUrl: "https://app.example.test/payments/return" }
    });
    expect(connected.statusCode).toBe(201);
    const onboardingUrl = connected.json<{ onboardingUrl: string }>().onboardingUrl;
    const connectedAccountId = new URL(onboardingUrl).searchParams.get("stripe_account")!;
    const disconnected = await app.inject({
      method: "POST",
      url: "/v1/payment-account/disconnect",
      headers: headers(organizationId, email),
      payload: {}
    });
    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json<{ paymentAccount: { status: string } }>().paymentAccount.status).toBe(
      "DISCONNECTED"
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/payment-account/connect",
          headers: headers(organizationId, email),
          payload: { returnUrl: "https://app.example.test/payments/return" }
        })
      ).statusCode
    ).toBe(201);
    const link = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/public-link`,
      headers: headers(organizationId, email),
      payload: {}
    });
    expect(link.statusCode).toBe(201);
    const publicUrl = link.json<{ link: { publicUrl: string } }>().link.publicUrl;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${publicUrl}/checkout-sessions`,
          headers: { "idempotency-key": randomUUID() },
          payload: { partialAmountMinor: "99" }
        })
      ).statusCode
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${publicUrl}/checkout-sessions`,
          headers: { "idempotency-key": randomUUID() },
          payload: { partialAmountMinor: "1051" }
        })
      ).statusCode
    ).toBe(422);
    const key = randomUUID();
    const [checkoutFirst, checkoutReplay] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `${publicUrl}/checkout-sessions`,
          headers: { "idempotency-key": key },
          payload: {}
        })
      )
    );
    expect([checkoutFirst.statusCode, checkoutReplay.statusCode]).toEqual([201, 201]);
    expect(await prisma.paymentCheckoutSession.count({ where: { organizationId } })).toBe(1);
    const checkout = await prisma.paymentCheckoutSession.findFirstOrThrow({
      where: { organizationId }
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const timestampString = String(timestamp);
    const webhook = (
      amountMinor: string,
      options: {
        eventId?: string;
        eventType?:
          | "payment_intent.succeeded"
          | "charge.dispute.created"
          | "charge.dispute.updated";
        disputeId?: string;
        disputeStatus?: string;
      } = {}
    ) => {
      const payload = JSON.stringify({
        id: options.eventId ?? "evt_test_hosted_payment",
        type: options.eventType ?? "payment_intent.succeeded",
        created_at: "2026-03-16T12:00:00.000Z",
        data: {
          connected_account_id: connectedAccountId,
          checkout_session_id: checkout.providerSessionId,
          payment_id: "pi_test_hosted_payment",
          amount_minor: amountMinor,
          fee_minor: "50",
          currency: "CAD",
          ...(options.disputeId ? { dispute_id: options.disputeId } : {}),
          ...(options.disputeStatus ? { dispute_status: options.disputeStatus } : {})
        }
      });
      const signature = `t=${timestampString},v1=${createHmac("sha256", "development-payment-webhook-secret").update(`t=${timestampString}.${payload}`).digest("hex")}`;
      return app.inject({
        method: "POST",
        url: "/v1/webhooks/payments/stripe",
        headers: {
          "content-type": "application/stripe-test-webhook",
          "stripe-signature": signature
        },
        payload: Buffer.from(payload)
      });
    };
    const invalidSignature = await app.inject({
      method: "POST",
      url: "/v1/webhooks/payments/stripe",
      headers: {
        "content-type": "application/stripe-test-webhook",
        "stripe-signature": `t=${timestampString},v1=${"0".repeat(64)}`
      },
      payload: Buffer.from("{}")
    });
    expect(invalidSignature.statusCode).toBe(401);
    const staleTimestamp = String(timestamp - 301);
    const stalePayload = Buffer.from("{}");
    const staleSignature = `t=${staleTimestamp},v1=${createHmac(
      "sha256",
      "development-payment-webhook-secret"
    )
      .update(`t=${staleTimestamp}.${stalePayload.toString("utf8")}`)
      .digest("hex")}`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/webhooks/payments/stripe",
          headers: {
            "content-type": "application/stripe-test-webhook",
            "stripe-signature": staleSignature
          },
          payload: stalePayload
        })
      ).statusCode
    ).toBe(401);
    const pendingReturn = await app.inject({
      method: "GET",
      url: `${publicUrl}?payment=success`
    });
    expect(pendingReturn.statusCode).toBe(200);
    expect(pendingReturn.body).toContain("Payment verification pending");
    expect(pendingReturn.body).not.toContain("Payment confirmed");
    const failed = await webhook("1049");
    expect(failed.statusCode, failed.body).toBe(422);
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(
      await new PaymentOutboxWorker(prisma, new PaymentService(prisma)).processPendingWebhookEvents(
        organizationId,
        ownerUser.id
      )
    ).toBe(1);
    expect(
      await prisma.outboxEvent.findFirstOrThrow({
        where: { organizationId, eventType: "payment.webhook-received" }
      })
    ).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(
      await prisma.paymentWebhookEvent.findFirstOrThrow({
        where: { organizationId, providerEventId: "evt_test_hosted_payment" }
      })
    ).toMatchObject({ status: "FAILED", processingError: "PAYMENT_WEBHOOK_INVALID" });
    const first = await webhook("1050");
    const replay = await webhook("1050");
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ duplicate: boolean }>().duplicate).toBe(true);
    await expect(
      new PaymentService(prisma).processWebhookEvent(
        organizationId,
        ownerUser.id,
        (
          await prisma.paymentWebhookEvent.findFirstOrThrow({
            where: { organizationId, providerEventId: "evt_test_hosted_payment" }
          })
        ).id
      )
    ).resolves.toMatchObject({ duplicate: true });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { organizationId },
      include: { journal: { include: { lines: true } } }
    });
    expect(payment).toMatchObject({
      amountMinor: 1050n,
      feeMinor: 50n,
      netMinor: 1000n,
      status: "SUCCEEDED"
    });
    const paypalConfiguredApp = buildApp({ prisma, paymentProviderKind: "PAYPAL" });
    try {
      await paypalConfiguredApp.ready();
      const mismatchedRefund = await paypalConfiguredApp.inject({
        method: "POST",
        url: `/v1/payments/${payment.id}/refunds`,
        headers: headers(organizationId, email, randomUUID()),
        payload: {
          amountMinor: "1",
          reason: "Provider migration safety check",
          treatment: "CUSTOMER_CREDIT"
        }
      });
      expect(mismatchedRefund.statusCode).toBe(409);
      expect(mismatchedRefund.json<{ error: { code: string } }>().error.code).toBe(
        "PAYMENT_REFUND_PROVIDER_MISMATCH"
      );
      expect(await prisma.paymentRefund.count({ where: { paymentId: payment.id } })).toBe(0);
    } finally {
      await paypalConfiguredApp.close();
    }
    await expect(
      prisma.payment.update({ where: { id: payment.id }, data: { feeMinor: 51n } })
    ).rejects.toThrow(/immutable/i);
    await expect(prisma.payment.delete({ where: { id: payment.id } })).rejects.toThrow(
      /immutable/i
    );
    await expect(
      prisma.paymentCheckoutSession.delete({ where: { id: checkout.id } })
    ).rejects.toThrow(/append-only/i);
    expect(payment.journal!.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(
      payment.journal!.lines.reduce((sum, line) => sum + line.creditMinor, 0n)
    );
    expect(await prisma.paymentWebhookEvent.count({ where: { organizationId } })).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: {
          organizationId,
          eventType: "payment.webhook-received",
          aggregateType: "PaymentWebhookEvent"
        }
      })
    ).toBe(1);
    expect(
      await new PaymentOutboxWorker(prisma, new PaymentService(prisma)).processPendingWebhookEvents(
        organizationId,
        ownerUser.id
      )
    ).toBe(1);
    expect(
      await prisma.outboxEvent.findFirstOrThrow({
        where: { organizationId, eventType: "payment.webhook-received" }
      })
    ).toMatchObject({ status: "DISPATCHED", attempts: 2 });
    expect(
      await prisma.paymentReceipt.count({ where: { organizationId, paymentId: payment.id } })
    ).toBe(1);
    const receipt = await prisma.paymentReceipt.findFirstOrThrow({
      where: { organizationId, paymentId: payment.id }
    });
    const publicReceipt = await app.inject({
      method: "GET",
      url: `${publicUrl}/receipts/${receipt.receiptNumber}`
    });
    expect(publicReceipt.statusCode).toBe(200);
    expect(publicReceipt.json()).not.toHaveProperty("receipt.renderData.paymentId");
    expect(publicReceipt.body).not.toContain("pi_test_hosted_payment");
    const printableReceipt = await app.inject({
      method: "GET",
      url: `${publicUrl}/receipts/${receipt.receiptNumber}/print`
    });
    expect(printableReceipt.statusCode).toBe(200);
    expect(printableReceipt.headers["content-type"]).toContain("text/html");
    expect(printableReceipt.body).toContain(receipt.receiptNumber);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${publicUrl}/receipts/RCT-000000000000`
        })
      ).statusCode
    ).toBe(404);
    const disputeUpdate = await webhook("1050", {
      eventId: "evt_test_dispute_update",
      eventType: "charge.dispute.updated",
      disputeId: "dp_test_hosted_payment"
    });
    const disputeCreate = await webhook("1050", {
      eventId: "evt_test_dispute_create",
      eventType: "charge.dispute.created",
      disputeId: "dp_test_hosted_payment"
    });
    const disputeReplay = await webhook("1050", {
      eventId: "evt_test_dispute_create",
      eventType: "charge.dispute.created",
      disputeId: "dp_test_hosted_payment"
    });
    expect([disputeUpdate.statusCode, disputeCreate.statusCode, disputeReplay.statusCode]).toEqual([
      200, 200, 200
    ]);
    expect(disputeReplay.json<{ duplicate: boolean }>().duplicate).toBe(true);
    const dispute = await prisma.paymentDispute.findFirstOrThrow({
      where: { organizationId, providerDisputeId: "dp_test_hosted_payment" }
    });
    expect(dispute).toMatchObject({
      paymentId: payment.id,
      status: "REVIEW_REQUIRED",
      amountMinor: 1050n
    });
    const resolved = await app.inject({
      method: "PATCH",
      url: `/v1/payment-disputes/${dispute.id}`,
      headers: headers(organizationId, email),
      payload: { status: "LOST" }
    });
    expect(resolved.statusCode).toBe(200);
    expect(
      resolved.json<{ dispute: { status: string; resolvedAt: string | null } }>().dispute
    ).toMatchObject({
      status: "LOST"
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/payment-disputes/${dispute.id}`,
          headers: headers(organizationId, email),
          payload: { status: "UNDER_REVIEW" }
        })
      ).statusCode
    ).toBe(409);
    const lateProviderUpdate = await webhook("1050", {
      eventId: "evt_test_dispute_late_update",
      eventType: "charge.dispute.updated",
      disputeId: "dp_test_hosted_payment",
      disputeStatus: "under_review"
    });
    expect(lateProviderUpdate.statusCode).toBe(200);
    expect(
      (
        await prisma.paymentDispute.findFirstOrThrow({
          where: { organizationId, providerDisputeId: "dp_test_hosted_payment" }
        })
      ).status
    ).toBe("LOST");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "DISPUTED"
    );
    const publicStatus = await app.inject({ method: "GET", url: `${publicUrl}/payment-status` });
    expect(publicStatus.statusCode).toBe(200);
    expect(publicStatus.json<{ payments: readonly Record<string, unknown>[] }>().payments).toEqual([
      {
        amountMinor: "1050",
        refundedMinor: "0",
        status: "DISPUTED",
        methodCategory: "CARD"
      }
    ]);
    const confirmedReturn = await app.inject({
      method: "GET",
      url: `${publicUrl}?payment=success`
    });
    expect(confirmedReturn.statusCode).toBe(200);
    expect(confirmedReturn.body).toContain("Payment confirmed");
    expect(confirmedReturn.body).not.toContain("Payment verification pending");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${publicUrl}/checkout-sessions`,
          headers: { "idempotency-key": randomUUID() },
          payload: {}
        })
      ).statusCode
    ).toBe(409);
    const otherOrganizationId = await createOrganization("payment-other-owner@example.test");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/payments/${payment.id}`,
          headers: headers(otherOrganizationId, "payment-other-owner@example.test")
        })
      ).statusCode
    ).toBe(404);
  });

  it("requests a PayPal-style capture only from a token-bound POST and leaves posting to a webhook", async () => {
    const email = "paypal-capture-owner@example.test";
    const organizationId = await createOrganization(email);
    await configure(organizationId, email);
    const chart = await accounts(organizationId, email);
    const tax = await taxCode(
      organizationId,
      chart.find((account) => account.systemPurpose === "tax-payable")!.id,
      email
    );
    const item = await product(
      organizationId,
      chart.find((account) => account.systemPurpose === "professional-services")!.id,
      tax,
      email
    );
    const buyer = await customer(organizationId, "C-PAYPAL-CAPTURE", email);
    const draft = (
      await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: headers(organizationId, email),
        payload: {
          customerId: buyer.id,
          issueDate: "2026-03-15",
          lines: [{ productItemId: item.id, quantity: "1", unitPriceMinor: "1000" }]
        }
      })
    ).json<{ invoice: { id: string; version: number } }>().invoice;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/invoices/${draft.id}/post`,
          headers: headers(organizationId, email, randomUUID()),
          payload: { version: draft.version }
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/payment-settings",
          headers: headers(organizationId, email),
          payload: {
            clearingAccountId: chart.find((account) => account.systemPurpose === "cash")!.id,
            feeExpenseAccountId: chart.find(
              (account) => account.systemPurpose === "general-expense"
            )!.id,
            allowPartialPayments: false,
            minimumPartialMinor: "100"
          }
        })
      ).statusCode
    ).toBe(200);

    const captures: Array<{
      connectedAccountId: string;
      providerSessionId: string;
      idempotencyKey: string;
    }> = [];
    const paypalAdapter: PaymentProviderAdapter = {
      createConnectedAccount: () => Promise.resolve("paypal-connected-account"),
      createOnboardingLink: () => Promise.resolve("https://paypal.example.test/onboarding"),
      retrieveAccount: () =>
        Promise.resolve({ chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] }),
      createHostedCheckout: (input) =>
        Promise.resolve({
          providerSessionId: "PAYPAL-ORDER-TEST-1",
          url: "https://paypal.example.test/checkout/PAYPAL-ORDER-TEST-1",
          expiresAt: input.expiresAt
        }),
      captureHostedCheckout: (connectedAccountId, providerSessionId, idempotencyKey) => {
        captures.push({ connectedAccountId, providerSessionId, idempotencyKey });
        return Promise.resolve();
      },
      retrievePaymentStatus: () =>
        Promise.resolve({ status: "PROCESSING", amountMinor: 0n, currency: "CAD" }),
      verifyWebhook: () => {
        throw new Error("Webhook posting is intentionally outside this return-flow test.");
      },
      createRefund: () => Promise.resolve({ providerRefundId: "refund", status: "PENDING" }),
      retrieveRefundStatus: () =>
        Promise.resolve({ status: "PENDING", amountMinor: 0n, currency: "CAD" }),
      retrieveFeeAndSettlementMetadata: () =>
        Promise.resolve({
          feeMinor: 0n,
          netMinor: 0n,
          settlementId: null,
          settlementAvailableAt: null
        })
    };
    const paypalApp = buildApp({
      prisma,
      paymentProvider: paypalAdapter,
      paymentProviderKind: "PAYPAL",
      paymentAccountProtector: { protect: (value) => value, reveal: (value) => value }
    });
    try {
      await paypalApp.ready();
      const paypalConnected = await paypalApp.inject({
        method: "POST",
        url: "/v1/payment-account/connect",
        headers: headers(organizationId, email),
        payload: { returnUrl: "https://app.example.test/payments/return" }
      });
      expect(paypalConnected.statusCode).toBe(201);
      const link = await app.inject({
        method: "POST",
        url: `/v1/invoices/${draft.id}/public-link`,
        headers: headers(organizationId, email),
        payload: {}
      });
      expect(link.statusCode).toBe(201);
      const publicUrl = link.json<{ link: { publicUrl: string } }>().link.publicUrl;
      const checkoutResponse = await paypalApp.inject({
        method: "POST",
        url: `${publicUrl}/checkout-sessions`,
        headers: { "idempotency-key": randomUUID() },
        payload: {}
      });
      expect(checkoutResponse.statusCode).toBe(201);
      const checkout = checkoutResponse.json<{
        checkoutSession: { checkoutSessionId: string };
      }>().checkoutSession;
      const returnPage = await paypalApp.inject({
        method: "GET",
        url: `${publicUrl}?payment=success&checkout=${checkout.checkoutSessionId}`
      });
      expect(returnPage.statusCode).toBe(200);
      expect(returnPage.body).toContain("Complete payment");
      expect(returnPage.body).toContain(`/checkout-sessions/${checkout.checkoutSessionId}/capture`);

      const capture = await paypalApp.inject({
        method: "POST",
        url: `${publicUrl}/checkout-sessions/${checkout.checkoutSessionId}/capture`
      });
      expect(capture.statusCode).toBe(202);
      expect(capture.json<{ capture: { status: string } }>().capture.status).toBe(
        "CAPTURE_REQUESTED"
      );
      expect(captures).toEqual([
        {
          connectedAccountId: "paypal-connected-account",
          providerSessionId: "PAYPAL-ORDER-TEST-1",
          idempotencyKey: `capture:${checkout.checkoutSessionId}`
        }
      ]);
      expect(await prisma.payment.count({ where: { organizationId } })).toBe(0);
      expect(
        await prisma.paymentCheckoutSession.findUniqueOrThrow({
          where: { id: checkout.checkoutSessionId }
        })
      ).toMatchObject({ completedAt: null });

      const browserReturn = await paypalApp.inject({
        method: "POST",
        url: `${publicUrl}/checkout-sessions/${checkout.checkoutSessionId}/capture`,
        headers: { accept: "text/html" }
      });
      expect(browserReturn.statusCode).toBe(303);
      expect(browserReturn.headers.location).toContain("capture=requested");
      expect(captures).toHaveLength(2);
      expect(captures[1]).toEqual(captures[0]);

      const mismatchedCheckout = await paypalApp.inject({
        method: "POST",
        url: `${publicUrl}/checkout-sessions/${randomUUID()}/capture`
      });
      expect(mismatchedCheckout.statusCode).toBe(404);
      expect(captures).toHaveLength(2);
    } finally {
      await paypalApp.close();
    }
  });
});
