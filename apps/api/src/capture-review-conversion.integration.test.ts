import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });

function headers(email: string, organizationId?: string, idempotencyKey?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
  };
}

async function setupOrganization(email: string) {
  const organizationResponse = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(email),
    payload: { legalName: `${email} Ltd`, displayName: email }
  });
  expect(organizationResponse.statusCode).toBe(201);
  const organizationId = organizationResponse.json<{ organization: { id: string } }>().organization
    .id;
  const setupResponse = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(email, organizationId)
  });
  const setupVersion = setupResponse.json<{ setup: { settings: { version: number } } }>().setup
    .settings.version;
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/setup/profile",
        headers: headers(email, organizationId),
        payload: {
          version: setupVersion,
          legalName: `${email} Ltd`,
          displayName: email,
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
        headers: headers(email, organizationId, randomUUID()),
        payload: {}
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/fiscal-year/initialize",
        headers: headers(email, organizationId),
        payload: {}
      })
    ).statusCode
  ).toBe(200);

  const accountResponse = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(email, organizationId)
  });
  const accounts = accountResponse.json<{
    accounts: Array<{
      id: string;
      type: string;
      systemPurpose: string | null;
      isControl: boolean;
      isArchived: boolean;
    }>;
  }>().accounts;
  const expenseAccount = accounts.find(
    (account) => account.type === "EXPENSE" && !account.isControl
  );
  const payingAccount = accounts.find(
    (account) =>
      ["ASSET", "LIABILITY", "EQUITY"].includes(account.type) &&
      account.systemPurpose !== "accounts-receivable" &&
      !account.isArchived
  );
  expect(expenseAccount).toBeDefined();
  expect(payingAccount).toBeDefined();

  const vendorResponse = await app.inject({
    method: "POST",
    url: "/v1/vendors",
    headers: headers(email, organizationId),
    payload: {
      vendorNumber: `V-${randomUUID().slice(0, 8)}`,
      legalName: "Evidence Vendor Ltd",
      displayName: "Evidence Vendor",
      defaultPaymentTermsDays: 30
    }
  });
  expect(vendorResponse.statusCode).toBe(201);
  const vendorId = vendorResponse.json<{ vendor: { id: string } }>().vendor.id;
  return {
    organizationId,
    expenseAccountId: expenseAccount!.id,
    payingAccountId: payingAccount!.id,
    vendorId
  };
}

async function createCapture(email: string, organizationId: string, kind: "BILL" | "RECEIPT") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/capture-reviews",
    headers: headers(email, organizationId),
    payload: {
      kind,
      storageKey: `${organizationId}/captures/${randomUUID()}.pdf`,
      checksum: createHash("sha256").update(randomUUID()).digest("hex"),
      mediaType: "application/pdf",
      byteSize: 256,
      scanStatus: "CLEAN",
      ocrProvider: "provider-fixture",
      ocrVersion: "42",
      extractedData: {
        fileName: "source-evidence.pdf",
        suggestedTotalMinor: "2500",
        localExtraction: {
          schemaVersion: 1,
          engine: { name: "fixture-local", version: "1", networkAccess: "NONE" },
          processingState: "NEEDS_REVIEW"
        }
      }
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ capture: { id: string; version: number; status: string } }>().capture;
}

async function approveCapture(
  email: string,
  organizationId: string,
  capture: { id: string; version: number }
) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/capture-reviews/${capture.id}/review`,
    headers: headers(email, organizationId),
    payload: { status: "APPROVED", version: capture.version, reviewNotes: "Checked against source" }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ capture: { id: string; version: number; status: string } }>().capture;
}

function billConversionPayload(
  version: number,
  vendorId: string,
  expenseAccountId: string,
  invoiceNumber = "EVIDENCE-001"
) {
  return {
    target: "BILL" as const,
    version,
    bill: {
      vendorId,
      vendorInvoiceNumber: invoiceNumber,
      issueDate: "2026-08-03",
      lines: [
        {
          description: "Reviewed purchase",
          quantity: "2",
          unitCostMinor: "1250",
          accountId: expenseAccountId
        }
      ]
    }
  };
}

function expenseConversionPayload(
  version: number,
  vendorId: string,
  expenseAccountId: string,
  payingAccountId: string
) {
  return {
    target: "IMMEDIATE_EXPENSE" as const,
    version,
    expense: {
      vendorId,
      reference: "RECEIPT-001",
      expenseDate: "2026-08-03",
      method: "CREDIT_CARD" as const,
      payingAccountId,
      lines: [
        {
          description: "Reviewed receipt",
          quantity: "1",
          unitCostMinor: "2500",
          accountId: expenseAccountId
        }
      ]
    }
  };
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

describe("capture review conversion", () => {
  it("creates exactly one linked DRAFT Bill, replays safely, and never posts accounting", async () => {
    const email = "capture-bill-owner@example.test";
    const setup = await setupOrganization(email);
    const reviewed = await approveCapture(
      email,
      setup.organizationId,
      await createCapture(email, setup.organizationId, "BILL")
    );
    const payload = billConversionPayload(reviewed.version, setup.vendorId, setup.expenseAccountId);
    const key = randomUUID();
    const converted = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${reviewed.id}/convert`,
      headers: headers(email, setup.organizationId, key),
      payload
    });
    expect(converted.statusCode, converted.body).toBe(201);
    const result = converted.json<{
      conversion: { id: string; targetType: string; targetId: string; billId: string };
      bill: { id: string; status: string; grandTotalMinor: string };
      immediateExpenseDraft: null;
      evidence: {
        captureReviewId: string;
        checksum: string;
        contentPath: string;
        extractionProvenance: {
          engine: { name: string; version: string; networkAccess: string };
          schemaVersion: number;
          processingState: string;
        };
      };
      accountingEntriesCreated: number;
    }>();
    expect(result.bill.status).toBe("DRAFT");
    expect(result.bill.grandTotalMinor).toBe("2500");
    expect(result.conversion.targetType).toBe("BILL");
    expect(result.conversion.targetId).toBe(result.bill.id);
    expect(result.evidence.captureReviewId).toBe(reviewed.id);
    expect(result.evidence.contentPath).toBe(`/v1/capture-reviews/${reviewed.id}/content`);
    expect(result.evidence.extractionProvenance.engine.networkAccess).toBe("NONE");
    expect(result.evidence.extractionProvenance.processingState).toBe("NEEDS_REVIEW");
    expect(result.accountingEntriesCreated).toBe(0);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${reviewed.id}/convert`,
      headers: headers(email, setup.organizationId, key),
      payload
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(converted.json());

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${reviewed.id}/convert`,
      headers: headers(email, setup.organizationId, randomUUID()),
      payload
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe(
      "CAPTURE_ALREADY_CONVERTED"
    );

    expect(await prisma.bill.count({ where: { organizationId: setup.organizationId } })).toBe(1);
    expect(
      await prisma.captureReviewConversion.count({
        where: { organizationId: setup.organizationId, captureReviewId: reviewed.id }
      })
    ).toBe(1);
    expect(
      await prisma.immediateExpense.count({ where: { organizationId: setup.organizationId } })
    ).toBe(0);
    expect(await prisma.journal.count({ where: { organizationId: setup.organizationId } })).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: {
          organizationId: setup.organizationId,
          action: "CAPTURE_REVIEW_CONVERTED",
          targetId: reviewed.id
        }
      })
    ).toBe(1);

    const billDetail = await app.inject({
      method: "GET",
      url: `/v1/bills/${result.bill.id}`,
      headers: headers(email, setup.organizationId)
    });
    expect(billDetail.statusCode).toBe(200);
    expect(
      billDetail.json<{
        bill: { captureConversion: { captureReview: { id: string; checksum: string } } };
      }>().bill.captureConversion.captureReview.id
    ).toBe(reviewed.id);
  });

  it("creates a typed immediate-expense DRAFT without creating a posted expense or journal", async () => {
    const email = "capture-receipt-owner@example.test";
    const setup = await setupOrganization(email);
    const reviewed = await approveCapture(
      email,
      setup.organizationId,
      await createCapture(email, setup.organizationId, "RECEIPT")
    );
    const converted = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${reviewed.id}/convert`,
      headers: headers(email, setup.organizationId, randomUUID()),
      payload: expenseConversionPayload(
        reviewed.version,
        setup.vendorId,
        setup.expenseAccountId,
        setup.payingAccountId
      )
    });
    expect(converted.statusCode, converted.body).toBe(201);
    const result = converted.json<{
      conversion: { targetType: string; targetId: string; immediateExpenseDraftId: string };
      bill: null;
      immediateExpenseDraft: {
        id: string;
        status: string;
        grandTotalMinor: string;
        version: number;
      };
      accountingEntriesCreated: number;
    }>();
    expect(result.bill).toBeNull();
    expect(result.immediateExpenseDraft).toMatchObject({
      status: "DRAFT",
      grandTotalMinor: "2500",
      version: 1
    });
    expect(result.conversion.targetType).toBe("IMMEDIATE_EXPENSE");
    expect(result.conversion.targetId).toBe(result.immediateExpenseDraft.id);
    expect(result.accountingEntriesCreated).toBe(0);
    expect(
      await prisma.immediateExpenseDraft.count({ where: { organizationId: setup.organizationId } })
    ).toBe(1);
    expect(
      await prisma.immediateExpense.count({ where: { organizationId: setup.organizationId } })
    ).toBe(0);
    expect(await prisma.journal.count({ where: { organizationId: setup.organizationId } })).toBe(0);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/immediate-expense-drafts/${result.immediateExpenseDraft.id}`,
      headers: headers(email, setup.organizationId)
    });
    expect(detail.statusCode).toBe(200);
    expect(
      detail.json<{
        immediateExpenseDraft: {
          status: string;
          captureConversion: { captureReview: { id: string } };
        };
      }>().immediateExpenseDraft
    ).toMatchObject({
      status: "DRAFT",
      captureConversion: { captureReview: { id: reviewed.id } }
    });
  });

  it("rejects wrong state, stale version, target mismatch, and cross-tenant access", async () => {
    const email = "capture-guard-owner@example.test";
    const setup = await setupOrganization(email);
    const unreviewed = await createCapture(email, setup.organizationId, "BILL");
    const unapproved = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${unreviewed.id}/convert`,
      headers: headers(email, setup.organizationId, randomUUID()),
      payload: billConversionPayload(unreviewed.version, setup.vendorId, setup.expenseAccountId)
    });
    expect(unapproved.statusCode).toBe(409);
    expect(unapproved.json<{ error: { code: string } }>().error.code).toBe("CAPTURE_NOT_APPROVED");

    const reviewed = await approveCapture(email, setup.organizationId, unreviewed);
    const stale = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${reviewed.id}/convert`,
      headers: headers(email, setup.organizationId, randomUUID()),
      payload: billConversionPayload(reviewed.version + 1, setup.vendorId, setup.expenseAccountId)
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe("STALE_CAPTURE_REVIEW");

    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${reviewed.id}/convert`,
      headers: headers(email, setup.organizationId, randomUUID()),
      payload: expenseConversionPayload(
        reviewed.version,
        setup.vendorId,
        setup.expenseAccountId,
        setup.payingAccountId
      )
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json<{ error: { code: string } }>().error.code).toBe("CAPTURE_TARGET_MISMATCH");

    const otherEmail = "capture-other-owner@example.test";
    const other = await setupOrganization(otherEmail);
    const hidden = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${reviewed.id}/convert`,
      headers: headers(otherEmail, other.organizationId, randomUUID()),
      payload: billConversionPayload(reviewed.version, other.vendorId, other.expenseAccountId)
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json<{ error: { code: string } }>().error.code).toBe("CAPTURE_NOT_FOUND");
    expect(await prisma.bill.count()).toBe(0);
    expect(await prisma.immediateExpenseDraft.count()).toBe(0);
    expect(await prisma.journal.count()).toBe(0);
  });
});
