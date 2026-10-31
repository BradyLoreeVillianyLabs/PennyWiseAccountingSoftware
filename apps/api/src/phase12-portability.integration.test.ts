import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, withTenantTransaction } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { DocumentStorage } from "./services/invoice-render-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

class MemoryStorage implements DocumentStorage {
  public readonly values = new Map<string, Buffer>();
  public put(key: string, data: Buffer): Promise<void> {
    this.values.set(key, Buffer.from(data));
    return Promise.resolve();
  }
  public get(key: string): Promise<Buffer> {
    const value = this.values.get(key);
    if (!value) return Promise.reject(new Error(`Missing ${key}`));
    return Promise.resolve(Buffer.from(value));
  }
}

const storage = new MemoryStorage();
const app = buildApp({ prisma, documentStorage: storage });
const owner = "phase12-owner@example.test";

function headers(organizationId?: string, email = owner, extra: Record<string, string> = {}) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...extra
  };
}

async function api(
  method: "GET" | "POST" | "PUT",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  email = owner,
  extra: Record<string, string> = {}
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, email, extra),
    ...(payload === undefined ? {} : { payload })
  });
}

async function fixture(email = owner, accountingStartDate?: string) {
  const response = await api(
    "POST",
    "/v1/organizations",
    undefined,
    { legalName: "Portable Ltd", displayName: "Portable" },
    email
  );
  const organizationId = response.json<{ organization: { id: string } }>().organization.id;
  if (accountingStartDate)
    await prisma.organizationSettings.update({
      where: { organizationId },
      data: { accountingStartDate: new Date(`${accountingStartDate}T00:00:00.000Z`) }
    });
  await api("POST", "/v1/setup/presets/general-service/apply", organizationId, {}, email, {
    "idempotency-key": randomUUID()
  });
  await api(
    "POST",
    "/v1/fiscal-periods",
    organizationId,
    {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31"
    },
    email
  );
  return organizationId;
}

async function createAccount(
  organizationId: string,
  code: string,
  type: "ASSET" | "EXPENSE" | "REVENUE",
  companyId?: string
) {
  const response = await api(
    "POST",
    "/v1/accounts",
    organizationId,
    {
      code,
      name: `Migration ${code}`,
      type,
      isControl: false
    },
    owner,
    companyId ? { "x-clearledger-company-id": companyId } : {}
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

async function inventoryFixture(organizationId: string) {
  const [asset, clearing, cogs, loss, gain] = await Promise.all([
    createAccount(organizationId, "1301", "ASSET"),
    createAccount(organizationId, "1311", "ASSET"),
    createAccount(organizationId, "5001", "EXPENSE"),
    createAccount(organizationId, "5101", "EXPENSE"),
    createAccount(organizationId, "4901", "REVENUE")
  ]);
  const accountList = await api("GET", "/v1/accounts", organizationId);
  const existingIncome = accountList
    .json<{ accounts: Array<{ id: string; code: string }> }>()
    .accounts.find((account) => account.code === "4100");
  const incomeId = existingIncome?.id ?? (await createAccount(organizationId, "4100", "REVENUE"));
  const locationResponse = await api("POST", "/v1/inventory/locations", organizationId, {
    code: "MAIN",
    name: "Main migration location",
    isDefault: true
  });
  expect(locationResponse.statusCode, locationResponse.body).toBe(201);
  const locationId = locationResponse.json<{ location: { id: string } }>().location.id;
  const productResponse = await api("POST", "/v1/products", organizationId, {
    sku: "MIG-WIDGET",
    name: "Migration widget",
    itemType: "INVENTORY_PRODUCT",
    salesPriceMinor: "250",
    purchaseCostMinor: "125",
    incomeAccountId: incomeId,
    inventoryAssetAccountId: asset,
    costOfGoodsSoldAccountId: cogs,
    purchaseClearingAccountId: clearing,
    adjustmentGainAccountId: gain,
    inventoryLossAccountId: loss,
    defaultLocationId: locationId,
    unitOfMeasure: "each"
  });
  expect(productResponse.statusCode, productResponse.body).toBe(201);
  return productResponse.json<{ product: { id: string } }>().product.id;
}

async function upload(
  organizationId: string,
  type: string,
  csv: string,
  email = owner,
  fileName = "migration.csv",
  sourceSystem = "OTHER",
  companyId?: string
) {
  return api(
    "POST",
    `/v1/imports/upload?importType=${encodeURIComponent(type)}&sourceSystem=${encodeURIComponent(sourceSystem)}`,
    organizationId,
    Buffer.from(csv),
    email,
    {
      "content-type": "text/csv",
      "x-file-name": fileName,
      ...(companyId ? { "x-clearledger-company-id": companyId } : {})
    }
  );
}

async function stageAndCommit(
  organizationId: string,
  type: string,
  csv: string,
  sourceSystem = "OTHER"
) {
  const uploaded = await upload(organizationId, type, csv, owner, "migration.csv", sourceSystem);
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const id = uploaded.json<{ batch: { id: string } }>().batch.id;
  const preview = await api("POST", `/v1/imports/${id}/preview`, organizationId, {
    mapping: {}
  });
  expect(preview.statusCode, preview.body).toBe(200);
  expect((await api("POST", `/v1/imports/${id}/dry-run`, organizationId)).statusCode).toBe(200);
  const committed = await api("POST", `/v1/imports/${id}/commit`, organizationId);
  expect(committed.statusCode, committed.body).toBe(200);
  return { id, committed };
}

async function readyExport(organizationId: string, includeAttachments = false, email = owner) {
  const requested = await api("POST", "/v1/exports", organizationId, { includeAttachments }, email);
  expect(requested.statusCode, requested.body).toBe(202);
  const result = requested.json<{ job: { id: string }; downloadToken: string }>();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await api(
      "GET",
      `/v1/exports/${result.job.id}`,
      organizationId,
      undefined,
      email
    );
    const job = status.json<{ job: { status: string } }>().job;
    if (job.status === "READY") return result;
    if (job.status === "FAILED") throw new Error(status.body);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Export did not become ready.");
}

function findSensitivePortableKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value))
    return value.flatMap((entry, index) =>
      findSensitivePortableKeys(entry, `${path}[${String(index)}]`)
    );
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(/(password|secret|token|authorization|api[_-]?key|credential|private[_-]?key|ciphertext|lookuphash|creationkeyhash|codehash|storagekey)/i.test(
      key
    )
      ? [`${path}.${key}`]
      : []),
    ...findSensitivePortableKeys(entry, `${path}.${key}`)
  ]);
}

beforeAll(async () => {
  await app.ready();
});
beforeEach(async () => {
  storage.values.clear();
  await resetDatabase(prisma);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Phase 12 migration and portability", () => {
  it("lists resumable import batches by company and import type", async () => {
    const organizationId = await fixture();
    const uploaded = await upload(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-RESUME,Resume Customer\n",
      owner,
      "quickbooks-customers.csv",
      "QUICKBOOKS_DESKTOP"
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const batch = uploaded.json<{ batch: { id: string } }>().batch;

    const customers = await api("GET", "/v1/imports?importType=CUSTOMERS&limit=10", organizationId);
    expect(customers.statusCode, customers.body).toBe(200);
    expect(customers.json<{ batches: readonly Record<string, unknown>[] }>().batches).toEqual([
      expect.objectContaining({
        id: batch.id,
        importType: "CUSTOMERS",
        sourceSystem: "QUICKBOOKS_DESKTOP",
        sourceFilename: "quickbooks-customers.csv",
        status: "UPLOADED",
        rowCount: 1
      })
    ]);

    const vendors = await api("GET", "/v1/imports?importType=VENDORS&limit=10", organizationId);
    expect(vendors.statusCode, vendors.body).toBe(200);
    expect(vendors.json<{ batches: readonly unknown[] }>().batches).toEqual([]);
  });

  it("persists strict source-system context without changing books before commit", async () => {
    const organizationId = await fixture();
    const csv = "customer_number,display_name\nQBO-100,Source-aware customer\n";
    const journalCountBefore = await prisma.journal.count({ where: { organizationId } });
    const uploaded = await upload(
      organizationId,
      "CUSTOMERS",
      csv,
      owner,
      "quickbooks-customers.csv",
      "QUICKBOOKS_ONLINE"
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const batch = uploaded.json<{
      batch: { id: string; sourceSystem: string; status: string };
    }>().batch;
    expect(batch).toMatchObject({
      sourceSystem: "QUICKBOOKS_ONLINE",
      status: "UPLOADED"
    });

    const persisted = await prisma.dataImportBatch.findUniqueOrThrow({
      where: { id: batch.id }
    });
    expect(persisted.sourceSystem).toBe("QUICKBOOKS_ONLINE");
    await expect(
      prisma.dataImportBatch.update({
        where: { id: batch.id },
        data: { sourceSystem: "XERO" }
      })
    ).rejects.toThrow(/source evidence is immutable/i);
    const uploadAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId, action: "DATA_IMPORT_UPLOADED", targetId: batch.id }
    });
    expect(uploadAudit.metadata).toMatchObject({ sourceSystem: "QUICKBOOKS_ONLINE" });

    const status = await api("GET", `/v1/imports/${batch.id}`, organizationId);
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json<{ batch: { sourceSystem: string } }>().batch.sourceSystem).toBe(
      "QUICKBOOKS_ONLINE"
    );
    expect(
      (
        await api("POST", `/v1/imports/${batch.id}/preview`, organizationId, {
          mapping: {}
        })
      ).statusCode
    ).toBe(200);
    expect((await api("POST", `/v1/imports/${batch.id}/dry-run`, organizationId)).statusCode).toBe(
      200
    );
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(journalCountBefore);

    const sameSourceReplay = await upload(
      organizationId,
      "CUSTOMERS",
      csv,
      owner,
      "same-content-from-quickbooks.csv",
      "QUICKBOOKS_ONLINE"
    );
    expect(sameSourceReplay.statusCode, sameSourceReplay.body).toBe(201);
    expect(
      sameSourceReplay.json<{ batch: { id: string; sourceSystem: string } }>().batch
    ).toMatchObject({ id: batch.id, sourceSystem: "QUICKBOOKS_ONLINE" });

    const sourceMismatch = await upload(
      organizationId,
      "CUSTOMERS",
      csv,
      owner,
      "same-content-from-xero.csv",
      "XERO"
    );
    expect(sourceMismatch.statusCode, sourceMismatch.body).toBe(409);
    expect(sourceMismatch.json<{ error: { code: string } }>().error.code).toBe(
      "IMPORT_SOURCE_MISMATCH"
    );
    expect(await prisma.dataImportBatch.count({ where: { organizationId } })).toBe(1);

    const quickBooksDesktopMismatch = await upload(
      organizationId,
      "CUSTOMERS",
      csv,
      owner,
      "same-content-from-quickbooks-desktop.csv",
      "QUICKBOOKS_DESKTOP"
    );
    expect(quickBooksDesktopMismatch.statusCode, quickBooksDesktopMismatch.body).toBe(409);
    expect(quickBooksDesktopMismatch.json<{ error: { code: string } }>().error.code).toBe(
      "IMPORT_SOURCE_MISMATCH"
    );

    const invalid = await upload(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nINVALID-1,Invalid source\n",
      owner,
      "invalid-source.csv",
      "UNLISTED_LEDGER"
    );
    expect(invalid.statusCode, invalid.body).toBe(400);
    expect(invalid.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.dataImportBatch.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(journalCountBefore);
  });

  it("requires matching source controls before acknowledging financial imports", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-CONTROL,Source control customer\n"
    );
    const uploaded = await upload(
      organizationId,
      "OUTSTANDING_INVOICES",
      "customer_number,issue_date,due_date,amount_minor,description,external_id\nC-CONTROL,2026-02-01,2026-03-01,12345,Source control invoice,CONTROL-1\n"
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const batchId = uploaded.json<{ batch: { id: string } }>().batch.id;
    expect(
      (await api("POST", `/v1/imports/${batchId}/preview`, organizationId, { mapping: {} }))
        .statusCode
    ).toBe(200);
    expect((await api("POST", `/v1/imports/${batchId}/dry-run`, organizationId)).statusCode).toBe(
      200
    );
    const committed = await api("POST", `/v1/imports/${batchId}/commit`, organizationId);
    expect(committed.statusCode, committed.body).toBe(200);

    const missingControls = await api("POST", `/v1/imports/${batchId}/acknowledge`, organizationId);
    expect(missingControls.statusCode, missingControls.body).toBe(409);
    expect(missingControls.json<{ error: { code: string } }>().error.code).toBe(
      "IMPORT_SOURCE_CONTROLS_REQUIRED"
    );

    const mismatched = await api("PUT", `/v1/imports/${batchId}/source-controls`, organizationId, {
      sourceReportName: "QuickBooks Desktop A/R aging",
      sourceReportDate: "2026-03-01",
      sourceBalanceMinor: "99999"
    });
    expect(mismatched.statusCode, mismatched.body).toBe(200);
    expect(
      mismatched.json<{
        batch: { reconciliation: { sourceControlStatus: string; sourceBalanceMinor: string } };
      }>().batch.reconciliation
    ).toMatchObject({ sourceControlStatus: "MISMATCH", sourceBalanceMinor: "99999" });

    const rejectedMismatch = await api(
      "POST",
      `/v1/imports/${batchId}/acknowledge`,
      organizationId
    );
    expect(rejectedMismatch.statusCode, rejectedMismatch.body).toBe(409);
    expect(rejectedMismatch.json<{ error: { code: string } }>().error.code).toBe(
      "IMPORT_SOURCE_CONTROLS_REQUIRED"
    );

    const pennyWiseBalance = mismatched.json<{
      batch: { reconciliation: { pennyWiseBalanceMinor: string } };
    }>().batch.reconciliation.pennyWiseBalanceMinor;
    const matching = await api("PUT", `/v1/imports/${batchId}/source-controls`, organizationId, {
      sourceReportName: "QuickBooks Desktop A/R aging",
      sourceReportDate: "2026-03-01",
      sourceBalanceMinor: pennyWiseBalance
    });
    expect(matching.statusCode, matching.body).toBe(200);
    expect(
      matching.json<{ batch: { reconciliation: { sourceControlStatus: string } } }>().batch
        .reconciliation.sourceControlStatus
    ).toBe("MATCH");

    const acknowledged = await api("POST", `/v1/imports/${batchId}/acknowledge`, organizationId);
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    expect(acknowledged.json<{ batch: { status: string } }>().batch.status).toBe("RECONCILED");
  });

  it("resumes a retryable financial batch without reposting completed invoices", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-RETRY-1,First retry customer\nC-RETRY-2,Second retry customer\n"
    );
    const uploaded = await upload(
      organizationId,
      "OUTSTANDING_INVOICES",
      [
        "customer_number,issue_date,due_date,amount_minor,description,external_id",
        "C-RETRY-1,2026-02-01,2026-03-01,100,First retry invoice,RETRY-1",
        "C-RETRY-2,2026-02-01,2026-03-01,200,Second retry invoice,RETRY-2"
      ].join("\n") + "\n"
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const batchId = uploaded.json<{ batch: { id: string } }>().batch.id;
    expect(
      (await api("POST", `/v1/imports/${batchId}/preview`, organizationId, { mapping: {} }))
        .statusCode
    ).toBe(200);
    expect((await api("POST", `/v1/imports/${batchId}/dry-run`, organizationId)).statusCode).toBe(
      200
    );

    const secondCustomer = await prisma.customer.findFirstOrThrow({
      where: { organizationId, customerNumber: "C-RETRY-2" }
    });
    await prisma.customer.update({ where: { id: secondCustomer.id }, data: { active: false } });
    const failedCommit = await api("POST", `/v1/imports/${batchId}/commit`, organizationId);
    expect(failedCommit.statusCode, failedCommit.body).toBe(422);
    expect(failedCommit.json<{ error: { code: string } }>().error.code).toBe(
      "IMPORT_CUSTOMER_NOT_FOUND"
    );

    const retryable = await prisma.dataImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: { orderBy: { rowNumber: "asc" } } }
    });
    expect(retryable.status).toBe("RETRYABLE");
    expect(retryable.rows.map((row) => row.status)).toEqual(["IMPORTED", "VALID"]);
    const firstInvoiceAfterFailure = await prisma.invoice.findFirstOrThrow({
      where: { organizationId, status: "POSTED", internalNotes: { contains: "RETRY-1" } }
    });
    expect(await prisma.invoice.count({ where: { organizationId, status: "POSTED" } })).toBe(1);

    await prisma.customer.update({ where: { id: secondCustomer.id }, data: { active: true } });
    const resumed = await api("POST", `/v1/imports/${batchId}/resume`, organizationId);
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json<{ batch: { status: string } }>().batch.status).toBe("COMMITTED");
    expect(await prisma.invoice.count({ where: { organizationId, status: "POSTED" } })).toBe(2);
    expect(
      await prisma.invoice.findUnique({ where: { id: firstInvoiceAfterFailure.id } })
    ).not.toBeNull();
    expect(await prisma.dataImportRow.count({ where: { batchId, status: "IMPORTED" } })).toBe(2);
  });

  it("exposes deterministic commit attempt history for a financial import", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-ATTEMPT,Attempt history customer\n"
    );
    const uploaded = await upload(
      organizationId,
      "OUTSTANDING_INVOICES",
      "customer_number,issue_date,due_date,amount_minor,description,external_id\nC-ATTEMPT,2026-02-01,2026-03-01,500,Attempt history invoice,ATTEMPT-1\n"
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const batchId = uploaded.json<{ batch: { id: string } }>().batch.id;
    await api("POST", `/v1/imports/${batchId}/preview`, organizationId, { mapping: {} });
    await api("POST", `/v1/imports/${batchId}/dry-run`, organizationId);
    expect((await api("POST", `/v1/imports/${batchId}/commit`, organizationId)).statusCode).toBe(
      200
    );

    const attempts = await api("GET", `/v1/imports/${batchId}/attempts`, organizationId);
    expect(attempts.statusCode, attempts.body).toBe(200);
    const history = attempts.json<{
      attempts: Array<{
        unitKey: string;
        operation: string;
        idempotencyKey: string;
        status: string;
        attemptNumber: number;
        resourceType: string;
        resourceId: string;
      }>;
    }>().attempts;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      operation: "outstanding-invoice",
      status: "SUCCEEDED",
      attemptNumber: 1,
      resourceType: "Invoice"
    });
    expect(history[0]!.idempotencyKey).toBe(`migration:${batchId}:unit:${history[0]!.unitKey}`);
    expect(history[0]!.resourceId).toMatch(/[0-9a-f-]{36}/i);

    expect((await api("POST", `/v1/imports/${batchId}/commit`, organizationId)).statusCode).toBe(
      200
    );
    const repeated = await api("GET", `/v1/imports/${batchId}/attempts`, organizationId);
    expect(repeated.json<{ attempts: unknown[] }>().attempts).toHaveLength(1);
  });

  it("rejects concurrent source-system mismatches without weakening same-source replay", async () => {
    const organizationId = await fixture();
    const sameSourceCsv = "customer_number,display_name\nC-105,Concurrent same source\n";
    const sameSource = await Promise.all([
      upload(
        organizationId,
        "CUSTOMERS",
        sameSourceCsv,
        owner,
        "qbo-customers-a.csv",
        "QUICKBOOKS_ONLINE"
      ),
      upload(
        organizationId,
        "CUSTOMERS",
        sameSourceCsv,
        owner,
        "qbo-customers-b.csv",
        "QUICKBOOKS_ONLINE"
      )
    ]);
    expect(sameSource.every((response) => response.statusCode === 201)).toBe(true);
    expect(sameSource[0].json<{ batch: { id: string } }>().batch.id).toBe(
      sameSource[1].json<{ batch: { id: string } }>().batch.id
    );

    const mismatchedCsv = "customer_number,display_name\nC-106,Concurrent mismatch\n";
    const requestedSources = ["QUICKBOOKS_ONLINE", "XERO"] as const;
    const mismatched = await Promise.all(
      requestedSources.map((sourceSystem) =>
        upload(
          organizationId,
          "CUSTOMERS",
          mismatchedCsv,
          owner,
          `${sourceSystem.toLowerCase()}-customers.csv`,
          sourceSystem
        )
      )
    );
    expect(mismatched.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const winningIndex = mismatched.findIndex((response) => response.statusCode === 201);
    const losingIndex = mismatched.findIndex((response) => response.statusCode === 409);
    expect(winningIndex).toBeGreaterThanOrEqual(0);
    expect(losingIndex).toBeGreaterThanOrEqual(0);
    expect(
      mismatched[winningIndex]!.json<{ batch: { sourceSystem: string } }>().batch.sourceSystem
    ).toBe(requestedSources[winningIndex]);
    expect(mismatched[losingIndex]!.json<{ error: { code: string } }>().error.code).toBe(
      "IMPORT_SOURCE_MISMATCH"
    );

    const checksum = createHash("sha256").update(Buffer.from(mismatchedCsv)).digest("hex");
    const company = await prisma.company.findFirstOrThrow({
      where: { organizationId, isDefault: true }
    });
    const persisted = await prisma.dataImportBatch.findUniqueOrThrow({
      where: {
        organizationId_companyId_importType_checksum: {
          organizationId,
          companyId: company.id,
          importType: "CUSTOMERS",
          checksum
        }
      }
    });
    expect(persisted.sourceSystem).toBe(requestedSources[winningIndex]);
  });

  it("stages valid master data, keeps dry runs non-persistent, and replays identical files", async () => {
    const organizationId = await fixture();
    const csv =
      "Customer,Company,Email\nC-100,North Star Ltd,books@example.test\nC-101,South Star Ltd,\n";
    const first = await upload(organizationId, "CUSTOMERS", csv);
    const second = await upload(organizationId, "CUSTOMERS", csv);
    const id = first.json<{ batch: { id: string } }>().batch.id;
    expect(second.json<{ batch: { id: string } }>().batch.id).toBe(id);
    const concurrentCsv = "customer_number,display_name\nC-102,Concurrent upload\n";
    const concurrent = await Promise.all([
      upload(organizationId, "CUSTOMERS", concurrentCsv),
      upload(organizationId, "CUSTOMERS", concurrentCsv)
    ]);
    expect(concurrent.every((response) => response.statusCode === 201)).toBe(true);
    expect(concurrent[0].json<{ batch: { id: string } }>().batch.id).toBe(
      concurrent[1].json<{ batch: { id: string } }>().batch.id
    );
    expect(
      (
        await api("POST", `/v1/imports/${id}/preview`, organizationId, {
          mapping: { customer_number: "Customer", display_name: "Company" }
        })
      ).statusCode
    ).toBe(200);
    expect((await api("POST", `/v1/imports/${id}/dry-run`, organizationId)).statusCode).toBe(200);
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(0);
    expect((await api("POST", `/v1/imports/${id}/commit`, organizationId)).statusCode).toBe(200);
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(2);
    expect((await api("POST", `/v1/imports/${id}/commit`, organizationId)).statusCode).toBe(200);
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(2);
    const acknowledged = await api("POST", `/v1/imports/${id}/acknowledge`, organizationId);
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    expect(acknowledged.json<{ batch: { status: string } }>().batch.status).toBe("RECONCILED");
    await expect(
      prisma.dataImportBatch.update({
        where: { id },
        data: { reconciliation: { fabricatedDifferenceMinor: "0" } }
      })
    ).rejects.toThrow(/immutable/i);
    await stageAndCommit(
      organizationId,
      "VENDORS",
      "vendor_number,legal_name,display_name\nV-100,North Supply Ltd,North Supply\n"
    );
    await stageAndCommit(
      organizationId,
      "PRODUCTS",
      "sku,name,item_type,sales_price_minor,income_account_code\nSVC-100,Migration service,SERVICE,1299,4100\n"
    );
    expect(await prisma.vendor.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.productItem.count({ where: { organizationId, sku: "SVC-100" } })).toBe(1);
  });

  it("scopes account and product migration dependencies to the selected company", async () => {
    const organizationId = await fixture();
    const firstCompany = await prisma.company.findFirstOrThrow({
      where: { organizationId, isDefault: true }
    });

    // This product belongs only to company A. Company B must not be able to
    // satisfy an inventory import dependency with it.
    await inventoryFixture(organizationId);

    const secondCompanyResponse = await api(
      "POST",
      "/v1/organizations/current/companies",
      organizationId,
      { legalName: "Migration Company B Ltd.", displayName: "Migration Company B" },
      owner,
      { "x-clearledger-company-id": firstCompany.id }
    );
    expect(secondCompanyResponse.statusCode, secondCompanyResponse.body).toBe(201);
    const secondCompany = secondCompanyResponse.json<{ company: { id: string } }>().company;

    // This account is created after company B, so it exists only in company A.
    await createAccount(organizationId, "9902", "EXPENSE", firstCompany.id);

    const accountImport = await upload(
      organizationId,
      "CHART_OF_ACCOUNTS",
      "code,name,type\n9902,Company A account,EXPENSE\n",
      owner,
      "company-b-account.csv",
      "OTHER",
      secondCompany.id
    );
    expect(accountImport.statusCode, accountImport.body).toBe(201);
    const accountBatchId = accountImport.json<{ batch: { id: string } }>().batch.id;
    expect(
      (
        await api(
          "POST",
          `/v1/imports/${accountBatchId}/preview`,
          organizationId,
          { mapping: {} },
          owner,
          { "x-clearledger-company-id": secondCompany.id }
        )
      ).statusCode
    ).toBe(200);
    expect(
      (
        await api(
          "POST",
          `/v1/imports/${accountBatchId}/dry-run`,
          organizationId,
          undefined,
          owner,
          { "x-clearledger-company-id": secondCompany.id }
        )
      ).statusCode
    ).toBe(200);
    const accountCommit = await api(
      "POST",
      `/v1/imports/${accountBatchId}/commit`,
      organizationId,
      undefined,
      owner,
      { "x-clearledger-company-id": secondCompany.id }
    );
    expect(accountCommit.statusCode, accountCommit.body).toBe(200);
    const secondCompanyAccounts = await api(
      "GET",
      "/v1/accounts",
      organizationId,
      undefined,
      owner,
      { "x-clearledger-company-id": secondCompany.id }
    );
    expect(
      secondCompanyAccounts
        .json<{ accounts: Array<{ companyId: string; code: string }> }>()
        .accounts.some(
          (account) => account.companyId === secondCompany.id && account.code === "9902"
        )
    ).toBe(true);

    const productDuplicateImport = await upload(
      organizationId,
      "PRODUCTS",
      "sku,name,item_type,sales_price_minor,income_account_code\nMIG-WIDGET,Company B service,SERVICE,125,4100\n",
      owner,
      "company-b-product.csv",
      "OTHER",
      secondCompany.id
    );
    expect(productDuplicateImport.statusCode, productDuplicateImport.body).toBe(201);
    const productDuplicateBatchId = productDuplicateImport.json<{ batch: { id: string } }>().batch
      .id;
    expect(
      (
        await api(
          "POST",
          `/v1/imports/${productDuplicateBatchId}/preview`,
          organizationId,
          { mapping: {} },
          owner,
          { "x-clearledger-company-id": secondCompany.id }
        )
      ).statusCode
    ).toBe(200);
    expect(
      (
        await api(
          "POST",
          `/v1/imports/${productDuplicateBatchId}/dry-run`,
          organizationId,
          undefined,
          owner,
          { "x-clearledger-company-id": secondCompany.id }
        )
      ).statusCode
    ).toBe(200);

    const productImport = await upload(
      organizationId,
      "INVENTORY_OPENING",
      "sku,quantity,unit_cost_minor,effective_date\nMIG-WIDGET,1,125,2026-01-01\n",
      owner,
      "company-b-inventory.csv",
      "OTHER",
      secondCompany.id
    );
    expect(productImport.statusCode, productImport.body).toBe(201);
    const productBatchId = productImport.json<{ batch: { id: string } }>().batch.id;
    expect(
      (
        await api(
          "POST",
          `/v1/imports/${productBatchId}/preview`,
          organizationId,
          { mapping: {} },
          owner,
          { "x-clearledger-company-id": secondCompany.id }
        )
      ).statusCode
    ).toBe(200);
    const productDryRun = await api(
      "POST",
      `/v1/imports/${productBatchId}/dry-run`,
      organizationId,
      undefined,
      owner,
      { "x-clearledger-company-id": secondCompany.id }
    );
    expect(productDryRun.statusCode, productDryRun.body).toBe(422);
    expect(productDryRun.json<{ error: { code: string } }>().error.code).toBe(
      "IMPORT_PRODUCT_NOT_FOUND"
    );
  });

  it("pages non-authoritative product match suggestions through the central matcher", async () => {
    const organizationId = await fixture();
    const income = await prisma.account.findFirstOrThrow({
      where: { organizationId, code: "4100" }
    });
    const local = await api("POST", "/v1/products", organizationId, {
      sku: "MATCH-BASE",
      name: "Executive advisory package",
      description: "Monthly planning and reporting service",
      itemType: "SERVICE",
      salesPriceMinor: "1299",
      incomeAccountId: income.id
    });
    expect(local.statusCode, local.body).toBe(201);
    const localProductId = local.json<{ product: { id: string } }>().product.id;
    const csv = [
      "sku,name,item_type,sales_price_minor,income_account_code,description",
      ...Array.from(
        { length: 26 },
        (_, index) =>
          `MATCH-${String(index + 1).padStart(3, "0")},Executive advisory package,SERVICE,1299,4100,Monthly planning and reporting service`
      )
    ].join("\n");
    const uploaded = await upload(organizationId, "PRODUCTS", `${csv}\n`);
    const id = uploaded.json<{ batch: { id: string } }>().batch.id;
    const preview = await api("POST", `/v1/imports/${id}/preview`, organizationId, {
      mapping: {}
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const firstPage = preview.json<{
      batch: {
        itemMatchSuggestions: {
          authoritative: boolean;
          autoConfirmEligible: boolean;
          evaluatedRowCount: number;
          deferredRowCount: number;
          nextOffset: number | null;
          rows: Array<{ candidates: Array<{ productItemId: string }> }>;
        };
      };
    }>().batch.itemMatchSuggestions;
    expect(firstPage).toMatchObject({
      authoritative: false,
      autoConfirmEligible: false,
      evaluatedRowCount: 25,
      deferredRowCount: 1,
      nextOffset: 25
    });
    expect(firstPage.rows[0]?.candidates[0]?.productItemId).toBe(localProductId);

    const next = await api(
      "GET",
      `/v1/imports/${id}/item-match-suggestions?offset=25&limit=25`,
      organizationId
    );
    expect(next.statusCode, next.body).toBe(200);
    expect(
      next.json<{
        itemMatchSuggestions: {
          offset: number;
          evaluatedRowCount: number;
          deferredRowCount: number;
          hasMore: boolean;
          nextOffset: number | null;
          rows: Array<{ candidates: Array<{ productItemId: string }> }>;
        };
      }>().itemMatchSuggestions
    ).toMatchObject({
      offset: 25,
      evaluatedRowCount: 1,
      deferredRowCount: 0,
      hasMore: false,
      nextOffset: null,
      rows: [{ candidates: [{ productItemId: localProductId }] }]
    });
  });

  it("reports exact malformed and duplicate rows and refuses commit", async () => {
    const organizationId = await fixture();
    const uploaded = await upload(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-1,First\nC-1,\nC-2,\n"
    );
    const id = uploaded.json<{ batch: { id: string } }>().batch.id;
    const preview = await api("POST", `/v1/imports/${id}/preview`, organizationId, {
      mapping: {}
    });
    const rows = preview.json<{
      batch: { rows: Array<{ rowNumber: number; status: string }> };
    }>().batch.rows;
    expect(rows.map((row) => [row.rowNumber, row.status])).toEqual([
      [2, "VALID"],
      [3, "INVALID"],
      [4, "INVALID"]
    ]);
    const errors = await api("GET", `/v1/imports/${id}/errors.csv`, organizationId);
    expect(errors.body).toContain("3");
    expect(errors.body).toContain("duplicate");
    expect(errors.body).toContain("display_name");
    const previewAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId, action: "DATA_IMPORT_PREVIEWED", targetId: id },
      orderBy: { createdAt: "desc" }
    });
    expect(previewAudit.metadata).toMatchObject({ validRows: 1, errorCount: 3 });
    expect((await api("POST", `/v1/imports/${id}/dry-run`, organizationId)).statusCode).toBe(409);
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(0);
  });

  it("enforces import and export initial states directly in PostgreSQL", async () => {
    const organizationId = await fixture();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const company = await prisma.company.findFirstOrThrow({
      where: { organizationId, isDefault: true }
    });
    const checksum = createHash("sha256").update(randomUUID()).digest("hex");
    await expect(
      prisma.dataImportBatch.create({
        data: {
          organizationId,
          companyId: company.id,
          importType: "CUSTOMERS",
          status: "PREVIEWED",
          sourceFilename: "fabricated.csv",
          storageKey: `imports/${organizationId}/fabricated/${checksum}/source.csv`,
          mediaType: "text/csv",
          byteSize: 1,
          checksum,
          createdByUserId: user.id
        }
      })
    ).rejects.toThrow(/initial state/i);
    await expect(
      prisma.organizationExportJob.create({
        data: {
          organizationId,
          status: "PROCESSING",
          includeAttachments: false,
          schemaVersion: 1,
          downloadTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
          expiresAt: new Date(Date.now() + 60_000),
          requestedByUserId: user.id
        }
      })
    ).rejects.toThrow(/initial state/i);
  });

  it("rejects a migration file that does not pass malware scanning", async () => {
    const organizationId = await fixture();
    const rejectingApp = buildApp({
      prisma,
      documentStorage: storage,
      attachmentScanner: {
        scan: () => Promise.resolve("REJECTED")
      }
    });
    await rejectingApp.ready();
    try {
      const response = await rejectingApp.inject({
        method: "POST",
        url: "/v1/imports/upload?importType=CUSTOMERS",
        headers: headers(organizationId, owner, {
          "content-type": "text/csv",
          "x-file-name": "blocked.csv"
        }),
        payload: Buffer.from("customer_number,display_name\nC-1,Blocked\n")
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "IMPORT_MALWARE_REJECTED"
      );
      expect(await prisma.dataImportBatch.count({ where: { organizationId } })).toBe(0);
    } finally {
      await rejectingApp.close();
    }
  });

  it("imports outstanding AR and AP through domain posters and reconciles controls", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-1,Migration Customer\n"
    );
    await stageAndCommit(
      organizationId,
      "VENDORS",
      "vendor_number,legal_name,display_name\nV-1,Migration Vendor Ltd,Migration Vendor\n"
    );
    const accounts = await prisma.account.findMany({ where: { organizationId } });
    const expense = accounts.find((account) => account.type === "EXPENSE")!;
    const invoice = await stageAndCommit(
      organizationId,
      "OUTSTANDING_INVOICES",
      "customer_number,issue_date,due_date,amount_minor,description,external_id\nC-1,2026-02-01,2026-03-01,12345,Opening invoice,QBO-I-1\n",
      "QUICKBOOKS_ONLINE"
    );
    const bill = await stageAndCommit(
      organizationId,
      "OUTSTANDING_BILLS",
      `vendor_number,vendor_invoice_number,issue_date,due_date,amount_minor,expense_account_code,description,external_id\nV-1,QBO-B-1,2026-02-02,2026-03-02,6789,${expense.code},Opening bill,QBO-B-1\n`
    );
    expect(
      invoice.committed.json<{
        batch: { reconciliation: { receivablesDifferenceMinor: string } };
      }>().batch.reconciliation.receivablesDifferenceMinor
    ).toBe("0");
    expect(
      bill.committed.json<{ batch: { reconciliation: { payablesDifferenceMinor: string } } }>()
        .batch.reconciliation.payablesDifferenceMinor
    ).toBe("0");
    expect(await prisma.invoice.count({ where: { organizationId, status: "POSTED" } })).toBe(1);
    expect(await prisma.bill.count({ where: { organizationId, status: "POSTED" } })).toBe(1);
  });

  it("imports QuickBooks Desktop multi-line invoices with aliases and source evidence", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nQB-CUSTOMER,Desktop customer\n"
    );
    await stageAndCommit(
      organizationId,
      "PRODUCTS",
      "sku,name,item_type,sales_price_minor,income_account_code\nQB-SVC,Desktop service,SERVICE,1500,4100\nQB-ADDON,Desktop add-on,SERVICE,2500,4100\n"
    );
    const csv = [
      "Customer Name,Invoice Date,Due Date,Invoice Number,Item Name,Qty,Rate,Line Amount,Tax Amount,Discount,Memo,Terms",
      "QB-CUSTOMER,2026-02-05,2026-03-07,QBD-INV-100,QB-SVC,2,1500,3000,0,100,Service work,Net 30",
      "QB-CUSTOMER,2026-02-05,2026-03-07,QBD-INV-100,QB-ADDON,1,2500,2500,0,0,Additional work,Net 30"
    ].join("\n");
    const uploaded = await upload(
      organizationId,
      "OUTSTANDING_INVOICES",
      `${csv}\n`,
      owner,
      "quickbooks-desktop-invoices.csv",
      "QUICKBOOKS_DESKTOP"
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const id = uploaded.json<{ batch: { id: string; sourceSystem: string } }>().batch.id;
    expect(uploaded.json<{ batch: { sourceSystem: string } }>().batch.sourceSystem).toBe(
      "QUICKBOOKS_DESKTOP"
    );
    const preview = await api("POST", `/v1/imports/${id}/preview`, organizationId, {
      mapping: {}
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect((await api("POST", `/v1/imports/${id}/dry-run`, organizationId)).statusCode).toBe(200);
    const committed = await api("POST", `/v1/imports/${id}/commit`, organizationId);
    expect(committed.statusCode, committed.body).toBe(200);
    expect(
      committed.json<{
        batch: { reconciliation: { receivablesDifferenceMinor: string }; rows: unknown[] };
      }>().batch.reconciliation.receivablesDifferenceMinor
    ).toBe("0");
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { organizationId, status: "POSTED" },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines.map((line) => line.productItemId)).toEqual(
      expect.arrayContaining([expect.any(String), expect.any(String)])
    );
    expect(invoice.lines.map((line) => line.quantityMicros.toString())).toEqual([
      "2000000",
      "1000000"
    ]);
    expect(invoice.lines.map((line) => line.discountMinor.toString())).toEqual(["100", "0"]);
    expect(invoice.grandTotalMinor.toString()).toBe("5400");
    const rows = await prisma.dataImportRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: "asc" }
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.createdResourceId === invoice.id)).toBe(true);
    expect(rows[0]?.mappedData).toMatchObject({
      external_id: "QBD-INV-100",
      sku: "QB-SVC",
      tax_amount_minor: "0",
      discount_amount_minor: "100"
    });
  });

  it("imports multi-line bills with source aliases, discounts, and line provenance", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "VENDORS",
      "vendor_number,display_name,legal_name\nXERO-VENDOR,Migration supplier,Migration supplier Ltd\n"
    );
    const expense = (
      await prisma.account.findFirstOrThrow({
        where: { organizationId, type: "EXPENSE", isControl: false, isArchived: false }
      })
    ).code;
    const csv = [
      "Supplier Name,Bill Number,Bill Date,Due Date,Item,Qty,Rate,Line Amount,Discount,Account Code,Memo,Payment Terms",
      `XERO-VENDOR,AP-100,2026-02-05,2026-03-07,Hosting,2,1500,3000,100,${expense},Hosting services,Net 30`,
      `XERO-VENDOR,AP-100,2026-02-05,2026-03-07,Support,1,2500,2500,0,${expense},Support services,Net 30`
    ].join("\n");
    const uploaded = await upload(
      organizationId,
      "OUTSTANDING_BILLS",
      `${csv}\n`,
      owner,
      "xero-bills.csv",
      "XERO"
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const id = uploaded.json<{ batch: { id: string } }>().batch.id;
    expect(
      (await api("POST", `/v1/imports/${id}/preview`, organizationId, { mapping: {} })).statusCode
    ).toBe(200);
    expect((await api("POST", `/v1/imports/${id}/dry-run`, organizationId)).statusCode).toBe(200);
    const committed = await api("POST", `/v1/imports/${id}/commit`, organizationId);
    expect(committed.statusCode, committed.body).toBe(200);
    const bill = await prisma.bill.findFirstOrThrow({
      where: { organizationId, status: "POSTED" },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });
    expect(bill.lines).toHaveLength(2);
    expect(bill.lines.map((line) => line.quantityMicros.toString())).toEqual([
      "2000000",
      "1000000"
    ]);
    expect(bill.lines.map((line) => line.discountMinor.toString())).toEqual(["100", "0"]);
    expect(bill.grandTotalMinor.toString()).toBe("5400");
    const rows = await prisma.dataImportRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: "asc" }
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.createdResourceId === bill.id)).toBe(true);
  });

  it("rolls back an entire atomic master batch and prevents simultaneous duplicate commits", async () => {
    const organizationId = await fixture();
    const semanticallyInvalid = await upload(
      organizationId,
      "CHART_OF_ACCOUNTS",
      "code,name,type\n8999,Invalid type,NOT_AN_ACCOUNT\n"
    );
    const invalidId = semanticallyInvalid.json<{ batch: { id: string } }>().batch.id;
    await api("POST", `/v1/imports/${invalidId}/preview`, organizationId, { mapping: {} });
    expect((await api("POST", `/v1/imports/${invalidId}/dry-run`, organizationId)).statusCode).toBe(
      422
    );

    const uploaded = await upload(
      organizationId,
      "CHART_OF_ACCOUNTS",
      "code,name,type\n9000,Would otherwise persist,EXPENSE\n9001,Created after dry run,EXPENSE\n"
    );
    const id = uploaded.json<{ batch: { id: string } }>().batch.id;
    expect(
      (
        await api("POST", `/v1/imports/${id}/preview`, organizationId, {
          mapping: {}
        })
      ).statusCode
    ).toBe(200);
    expect((await api("POST", `/v1/imports/${id}/dry-run`, organizationId)).statusCode).toBe(200);
    await createAccount(organizationId, "9001", "EXPENSE");
    const failed = await api("POST", `/v1/imports/${id}/commit`, organizationId);
    expect(failed.statusCode, failed.body).toBe(409);
    expect(await prisma.account.count({ where: { organizationId, code: "9000" } })).toBe(0);
    expect(await prisma.account.count({ where: { organizationId, code: "9001" } })).toBe(1);
    const failedBatch = await prisma.dataImportBatch.findUniqueOrThrow({
      where: { id },
      include: { rows: true }
    });
    expect(failedBatch.status).toBe("FAILED");
    expect(failedBatch.rows.every((row) => row.status === "VALID")).toBe(true);

    const retry = await upload(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nCONCURRENT-1,Concurrent customer\n"
    );
    const retryId = retry.json<{ batch: { id: string } }>().batch.id;
    await api("POST", `/v1/imports/${retryId}/preview`, organizationId, { mapping: {} });
    await api("POST", `/v1/imports/${retryId}/dry-run`, organizationId);
    const results = await Promise.all([
      api("POST", `/v1/imports/${retryId}/commit`, organizationId),
      api("POST", `/v1/imports/${retryId}/commit`, organizationId)
    ]);
    expect(results.every((response) => [200, 409].includes(response.statusCode))).toBe(true);
    expect(results.some((response) => response.statusCode === 200)).toBe(true);
    expect(
      await prisma.customer.count({
        where: { organizationId, customerNumber: "CONCURRENT-1" }
      })
    ).toBe(1);

    const compensation = await upload(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nCOMP-1,Compensation state\n"
    );
    const compensationId = compensation.json<{ batch: { id: string } }>().batch.id;
    await api("POST", `/v1/imports/${compensationId}/preview`, organizationId, { mapping: {} });
    await api("POST", `/v1/imports/${compensationId}/dry-run`, organizationId);
    await prisma.dataImportBatch.update({
      where: { id: compensationId },
      data: { status: "COMMITTING" }
    });
    await prisma.dataImportBatch.update({
      where: { id: compensationId },
      data: {
        status: "COMPENSATION_REQUIRED",
        errorReport: { code: "TEST_FAILURE", strategy: "Linked compensation required." }
      }
    });
    await expect(
      prisma.dataImportBatch.update({
        where: { id: compensationId },
        data: { status: "RECONCILED", acknowledgedAt: new Date() }
      })
    ).rejects.toThrow(/immutable|transition/i);
  });

  it("validates cross-file dependencies and reconciles opening balances exactly", async () => {
    const organizationId = await fixture(owner, "2026-01-01");
    const dependency = await upload(
      organizationId,
      "OUTSTANDING_INVOICES",
      "customer_number,issue_date,due_date,amount_minor,description\nMISSING,2026-02-01,2026-03-01,100,Missing customer\n"
    );
    const dependencyId = dependency.json<{ batch: { id: string } }>().batch.id;
    await api("POST", `/v1/imports/${dependencyId}/preview`, organizationId, { mapping: {} });
    const rejected = await api("POST", `/v1/imports/${dependencyId}/dry-run`, organizationId);
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);

    const opening = await stageAndCommit(
      organizationId,
      "OPENING_BALANCES",
      "account_code,debit_minor,credit_minor,effective_date,note\n1000,12345,0,2026-01-01,Opening cash\n3000,0,12345,2026-01-01,Opening equity\n"
    );
    expect(
      opening.committed.json<{
        batch: { reconciliation: { openingTrialBalanceDifferenceMinor: string } };
      }>().batch.reconciliation.openingTrialBalanceDifferenceMinor
    ).toBe("0");
    const posted = await prisma.openingBalanceDraft.findFirstOrThrow({
      where: { organizationId }
    });
    expect(posted.status).toBe("POSTED");
    const importedRow = await prisma.dataImportRow.findFirstOrThrow({
      where: { batchId: opening.id }
    });
    await expect(
      prisma.dataImportRow.update({
        where: { id: importedRow.id },
        data: { createdResourceId: randomUUID() }
      })
    ).rejects.toThrow(/immutable/i);
  });

  it("reconciles imported inventory quantities and values to the posted control account", async () => {
    const organizationId = await fixture();
    const productId = await inventoryFixture(organizationId);
    const inventory = await stageAndCommit(
      organizationId,
      "INVENTORY_OPENING",
      "sku,quantity,unit_cost_minor,effective_date,external_id\nMIG-WIDGET,3,125,2026-02-01,QBO-ITEM-1\n"
    );
    const reconciliation = inventory.committed.json<{
      batch: {
        reconciliation: { inventoryDifferenceMinor: string; inventoryReconciled: boolean };
      };
    }>().batch.reconciliation;
    expect(reconciliation).toMatchObject({
      inventoryDifferenceMinor: "0",
      inventoryReconciled: true
    });
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: productId }
    });
    expect(balance.quantityOnHandMicros).toBe(3_000_000n);
    expect(balance.valueOnHandMinor).toBe(375n);
    const suggestions = await api(
      "GET",
      `/v1/imports/${inventory.id}/item-match-suggestions?limit=1`,
      organizationId
    );
    expect(suggestions.statusCode, suggestions.body).toBe(200);
    expect(
      suggestions.json<{
        itemMatchSuggestions: {
          authoritative: boolean;
          importBoundary: string;
          rows: Array<{
            candidates: Array<{ productItemId: string; reason: { matches: string[] } }>;
          }>;
        };
      }>().itemMatchSuggestions
    ).toMatchObject({
      authoritative: false,
      importBoundary: "EXACT_SKU_REQUIRED_FOR_INVENTORY_POSTING",
      rows: [
        {
          candidates: [
            {
              productItemId: productId
            }
          ]
        }
      ]
    });
    const firstInventoryCandidate = suggestions.json<{
      itemMatchSuggestions: {
        rows: Array<{ candidates: Array<{ reason: { matches: string[] } }> }>;
      };
    }>().itemMatchSuggestions.rows[0]?.candidates[0];
    expect(firstInventoryCandidate?.reason.matches).toContain("NORMALIZED_SKU");
  });

  it("retains opening credits as explicit non-posting history instead of fabricating allocations", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-CREDIT,Credit customer\n"
    );
    await stageAndCommit(
      organizationId,
      "VENDORS",
      "vendor_number,legal_name,display_name\nV-CREDIT,Credit Vendor Ltd,Credit Vendor\n"
    );
    const customerCredit = await stageAndCommit(
      organizationId,
      "CUSTOMER_CREDITS",
      "customer_number,amount_minor,effective_date,external_id\nC-CREDIT,550,2026-01-01,QBO-CC-1\n"
    );
    await stageAndCommit(
      organizationId,
      "VENDOR_CREDITS",
      "vendor_number,amount_minor,effective_date,external_id\nV-CREDIT,725,2026-01-01,QBO-VC-1\n"
    );
    expect(
      customerCredit.committed.json<{
        batch: { reconciliation: { nonPostingHistoricalRows: number } };
      }>().batch.reconciliation.nonPostingHistoricalRows
    ).toBe(1);
    expect(
      await prisma.historicalImportRecord.count({
        where: {
          organizationId,
          recordType: {
            in: ["CUSTOMER_OPENING_CREDIT_UNPOSTED", "VENDOR_OPENING_CREDIT_UNPOSTED"]
          }
        }
      })
    ).toBe(2);
    expect(await prisma.payment.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.vendorCredit.count({ where: { organizationId } })).toBe(0);
  });

  it("isolates batches and exports a secret-free integrity-checked portable archive", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-1,Export Customer\n"
    );
    await prisma.paymentAccount.create({
      data: {
        organizationId,
        provider: "STRIPE",
        providerAccountCiphertext: "never-export-this",
        providerAccountLookupHash: createHash("sha256").update(randomUUID()).digest("hex"),
        status: "CONNECTED",
        connectedAt: new Date(),
        createdByUserId: randomUUID(),
        updatedByUserId: randomUUID()
      }
    });
    const actorUserId = (await prisma.user.findUniqueOrThrow({ where: { email: owner } })).id;
    await prisma.vendor.create({
      data: {
        organizationId,
        vendorNumber: "V-PORTABLE",
        legalName: "Portable Supplier Ltd",
        displayName: "Portable Supplier",
        businessIdentifier: "CUSTOMER-OWNED-VENDOR-ID-789",
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId
      }
    });
    await prisma.taxRegistration.create({
      data: {
        organizationId,
        registrationType: "GST_HST",
        jurisdiction: "CA",
        registrationNumber: "CUSTOMER-OWNED-TAX-ID-123",
        registered: true,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z")
      }
    });
    await prisma.payrollWorker.create({
      data: {
        organizationId,
        workerNumber: "P-PORTABLE",
        kind: "EMPLOYEE",
        displayName: "Payroll portability worker",
        governmentIdCiphertext: "never-export-government-ciphertext",
        governmentIdKeyVersion: "key-v1",
        governmentIdLastFour: "1234",
        bankAccountCiphertext: "never-export-bank-ciphertext",
        bankAccountKeyVersion: "key-v2",
        bankAccountLastFour: "5678",
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId
      }
    });
    await prisma.webhookEndpoint.create({
      data: {
        organizationId,
        createdByUserId: actorUserId,
        name: "Portable endpoint",
        url: "https://user:pass@hooks.example.test/path?access_token=never-export-url-token#secret",
        keyPrefix: "cl_test",
        secretCiphertext: "never-export-webhook-secret",
        creationKeyHash: createHash("sha256").update(randomUUID()).digest("hex"),
        eventTypes: ["invoice.posted"]
      }
    });
    await prisma.connectorInstallation.create({
      data: {
        organizationId,
        createdByUserId: actorUserId,
        providerKey: "PORTABILITY_TEST",
        displayName: "Portable connector",
        credentialCiphertext: "never-export-connector-credential",
        webhookLookupHash: createHash("sha256").update(randomUUID()).digest("hex"),
        syncLeaseTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        syncLeaseExpiresAt: new Date("2026-12-31T23:59:59.000Z"),
        mapping: {
          safeMode: "review-only",
          nestedSecret: "never-export-nested-secret",
          apiKey: "never-export-nested-api-key",
          authorization: "Bearer never-export-nested-authorization",
          credentials: { private_key: "never-export-nested-private-key" },
          endpointUrl:
            "https://api-user:api-pass@provider.example.test/orders?api_token=never-export-nested-url-token"
        }
      }
    });
    const otherEmail = "phase12-other@example.test";
    const otherId = await fixture(otherEmail);
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } });
    const batch = await prisma.dataImportBatch.findFirstOrThrow({ where: { organizationId } });
    expect(
      (await api("GET", `/v1/imports/${batch.id}`, otherId, undefined, otherEmail)).statusCode
    ).toBe(404);
    expect(
      await withTenantTransaction(
        prisma,
        { organizationId: otherId, actorUserId: otherUser.id },
        (tx) => tx.dataImportBatch.findUnique({ where: { id: batch.id } })
      )
    ).toBeNull();

    const exported = await readyExport(organizationId);
    const download = await api(
      "GET",
      `/v1/exports/${exported.job.id}/download`,
      organizationId,
      undefined,
      owner,
      { "x-export-token": exported.downloadToken }
    );
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).not.toContain("never-export-this");
    expect(
      await prisma.outboxEvent.count({
        where: {
          organizationId,
          aggregateId: exported.job.id,
          eventType: "organization.export.requested",
          status: "DISPATCHED"
        }
      })
    ).toBe(1);
    const archive = JSON.parse(download.body) as {
      manifest: {
        schemaVersion: number;
        files: Array<{ path: string; sha256: string; recordCount: number }>;
        tableCoverage: Array<{
          table: string;
          path: string;
          recordCount: number;
          includedColumns: string[];
          excludedSensitiveColumns: string[];
        }>;
        completeness: {
          status: string;
          attachmentsRequested: boolean;
          allPortableOrganizationModelsIncluded: boolean;
          missingOrCorruptAttachmentCount: number;
        };
        restoreSupport: string;
      };
      files: Record<string, unknown>;
    };
    expect(archive.manifest.schemaVersion).toBe(3);
    expect(archive.manifest.files.length).toBeGreaterThan(100);
    expect(archive.manifest.restoreSupport).toBe("EXTERNAL_READABLE_NO_IN_PRODUCT_FULL_RESTORE");
    expect(archive.manifest.completeness).toEqual({
      status: "COMPLETE",
      attachmentsRequested: false,
      allPortableOrganizationModelsIncluded: true,
      missingOrCorruptAttachmentCount: 0
    });
    const databaseTables = await prisma.$queryRaw<readonly { tableName: string }[]>`
      SELECT DISTINCT columns.table_name::text AS "tableName"
        FROM information_schema.columns AS columns
        JOIN information_schema.tables AS tables
          ON tables.table_schema = columns.table_schema
         AND tables.table_name = columns.table_name
       WHERE columns.table_schema = 'public'
         AND columns.column_name = 'organizationId'
         AND tables.table_type = 'BASE TABLE'
       ORDER BY 1
    `;
    const nonPortableSecurityLocatorTables = new Set([
      "InvitationTokenLocator",
      "MembershipAccessLocator",
      "OrganizationBootstrapGrant"
    ]);
    expect(archive.manifest.tableCoverage.map((table) => table.table)).toEqual(
      databaseTables
        .map((table) => table.tableName)
        .filter((table) => !nonPortableSecurityLocatorTables.has(table))
    );
    for (const table of archive.manifest.tableCoverage) {
      const quotedTable = `"${table.table.replaceAll('"', '""')}"`;
      const databaseCount = await prisma.$queryRawUnsafe<readonly { recordCount: bigint }[]>(
        `SELECT count(*)::bigint AS "recordCount" FROM ${quotedTable} WHERE "organizationId" = $1::uuid`,
        organizationId
      );
      const postSnapshotAuditEvents = table.table === "AuditEvent" ? 2 : 0;
      expect(Number(databaseCount[0]!.recordCount) - table.recordCount, table.table).toBe(
        postSnapshotAuditEvents
      );
      expect(Array.isArray(archive.files[table.path]), table.path).toBe(true);
      expect((archive.files[table.path] as unknown[]).length, table.path).toBe(table.recordCount);
      for (const row of archive.files[table.path] as Array<{ organizationId?: unknown }>)
        expect(row.organizationId, table.path).toBe(organizationId);
    }
    const paths = new Set(archive.manifest.files.map((file) => file.path));
    for (const required of [
      "data/organization.json",
      "data/memberships.json",
      "data/attachment-manifest.json",
      "data/tables/WorkflowPreferences.json",
      "data/tables/SetupStepState.json",
      "data/tables/OpeningBalanceDraft.json",
      "data/tables/Estimate.json",
      "data/tables/RecurringSchedule.json",
      "data/tables/Communication.json",
      "data/tables/Project.json",
      "data/tables/ProjectWorkItem.json",
      "data/tables/ProjectWorkItemDependency.json",
      "data/tables/ProjectTimeEntry.json",
      "data/tables/MileageLog.json",
      "data/tables/CaptureReview.json",
      "data/tables/CaptureReviewConversion.json",
      "data/tables/BudgetPlan.json",
      "data/tables/BudgetLine.json",
      "data/tables/CashForecastAssumption.json",
      "data/tables/PurchaseRequest.json",
      "data/tables/PurchaseRequestLine.json",
      "data/tables/CustomerDepositRequest.json",
      "data/tables/ProgressBillingPlan.json",
      "data/tables/ProgressBillingMilestone.json",
      "data/tables/ProgressBillingAllocation.json",
      "data/tables/FixedAssetClass.json",
      "data/tables/FixedAsset.json",
      "data/tables/ConnectorInstallation.json",
      "data/tables/ExternalCatalogProduct.json",
      "data/tables/ExternalCatalogVariant.json",
      "data/tables/CatalogMatchCandidate.json",
      "data/tables/CatalogMatchDecision.json",
      "data/tables/CatalogImageReference.json",
      "data/tables/InventorySyncPolicy.json",
      "data/tables/InventorySyncObservation.json",
      "data/tables/InventorySyncConflict.json",
      "data/tables/ConnectorCheckpoint.json",
      "data/tables/ConnectorConflict.json",
      "data/tables/ConnectorLog.json",
      "data/tables/CommerceInboxEvent.json",
      "data/tables/DataImportBatch.json",
      "data/tables/DataImportRow.json",
      "data/tables/HistoricalImportRecord.json",
      "data/tables/MigrationRun.json",
      "data/tables/MigrationRunEntry.json",
      "data/tables/InventoryLocation.json",
      "data/tables/InventoryBalance.json",
      "data/tables/InventoryMovement.json"
    ])
      expect(paths.has(required), required).toBe(true);
    expect(download.body).not.toContain(otherId);
    expect(download.body).not.toContain("never-export-this");
    expect(download.body).not.toContain("never-export-government-ciphertext");
    expect(download.body).not.toContain("never-export-bank-ciphertext");
    expect(download.body).not.toContain("never-export-webhook-secret");
    expect(download.body).not.toContain("never-export-connector-credential");
    expect(download.body).not.toContain("never-export-nested-secret");
    expect(download.body).not.toContain("never-export-nested-api-key");
    expect(download.body).not.toContain("never-export-nested-authorization");
    expect(download.body).not.toContain("never-export-nested-private-key");
    expect(download.body).not.toContain("never-export-url-token");
    expect(download.body).not.toContain("never-export-nested-url-token");
    expect(download.body).not.toContain("user:pass@");
    expect(download.body).not.toContain("api-user:api-pass@");
    expect(download.body).toContain("CUSTOMER-OWNED-VENDOR-ID-789");
    expect(download.body).toContain("CUSTOMER-OWNED-TAX-ID-123");
    expect(download.body).toContain("review-only");
    expect(download.body).toContain("https://hooks.example.test/path");
    expect(download.body).toContain("https://provider.example.test/orders");
    expect(archive.manifest.tableCoverage.map((table) => table.table)).not.toEqual(
      expect.arrayContaining([...nonPortableSecurityLocatorTables])
    );
    for (const [path, value] of Object.entries(archive.files)) {
      if (!path.startsWith("data/")) continue;
      expect(findSensitivePortableKeys(value), path).toEqual([]);
    }
    for (const file of archive.manifest.files) {
      expect(
        createHash("sha256").update(JSON.stringify(archive.files[file.path])).digest("hex")
      ).toBe(file.sha256);
    }
    expect(
      (
        await api(
          "GET",
          `/v1/exports/${exported.job.id}/download`,
          organizationId,
          undefined,
          owner,
          { "x-export-token": "x".repeat(43) }
        )
      ).statusCode
    ).toBe(403);
    expect(
      (
        await api(
          "GET",
          `/v1/exports/${exported.job.id}/download`,
          organizationId,
          undefined,
          owner,
          {
            "x-export-token": exported.downloadToken,
            "x-clearledger-recent-auth-at": "2026-01-01T00:00:00.000Z"
          }
        )
      ).statusCode
    ).toBe(403);
    const storedJob = await prisma.organizationExportJob.findUniqueOrThrow({
      where: { id: exported.job.id }
    });
    await expect(
      prisma.organizationExportJob.update({
        where: { id: storedJob.id },
        data: { checksum: "0".repeat(64) }
      })
    ).rejects.toThrow(/immutable/i);
    const originalArchive = storage.values.get(storedJob.storageKey!)!;
    storage.values.set(storedJob.storageKey!, Buffer.from("tampered archive"));
    expect(
      (
        await api(
          "GET",
          `/v1/exports/${exported.job.id}/download`,
          organizationId,
          undefined,
          owner,
          { "x-export-token": exported.downloadToken }
        )
      ).statusCode
    ).toBe(500);
    storage.values.set(storedJob.storageKey!, originalArchive);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(storedJob.expiresAt.getTime() + 1));
    try {
      expect(
        (
          await api(
            "GET",
            `/v1/exports/${exported.job.id}/download`,
            organizationId,
            undefined,
            owner,
            { "x-export-token": exported.downloadToken }
          )
        ).statusCode
      ).toBe(410);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sanitizes attachment paths and enforces export, owner, retention, and legal-hold closure", async () => {
    const organizationId = await fixture();
    await stageAndCommit(
      organizationId,
      "CUSTOMERS",
      "customer_number,display_name\nC-1,Attachment Customer\n"
    );
    const customer = await prisma.customer.findFirstOrThrow({ where: { organizationId } });
    const createdInvoice = await api("POST", "/v1/invoices", organizationId, {
      customerId: customer.id,
      issueDate: "2026-02-01",
      dueDate: "2026-03-01",
      currency: "CAD",
      lines: [{ description: "Draft attachment invoice", quantity: "1", unitPriceMinor: "100" }]
    });
    expect(createdInvoice.statusCode, createdInvoice.body).toBe(201);
    const invoice = createdInvoice.json<{ invoice: { id: string } }>().invoice;
    const bytes = Buffer.from("safe attachment");
    storage.values.set("unsafe-source", bytes);
    const attachment = {
      organizationId,
      invoiceId: invoice.id,
      storageKey: "unsafe-source",
      mediaType: "text/plain",
      byteSize: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      scanStatus: "CLEAN" as const,
      createdByUserId: randomUUID()
    };
    await expect(
      prisma.invoiceAttachment.create({
        data: { ...attachment, fileName: "../../escape.txt" }
      })
    ).rejects.toThrow();
    await prisma.invoiceAttachment.create({
      data: { ...attachment, fileName: "report final.txt" }
    });
    const rejectedBytes = Buffer.from("rejected attachment must not export");
    storage.values.set("rejected-source", rejectedBytes);
    await prisma.invoiceAttachment.create({
      data: {
        ...attachment,
        storageKey: "rejected-source",
        fileName: "rejected.txt",
        byteSize: rejectedBytes.length,
        checksum: createHash("sha256").update(rejectedBytes).digest("hex"),
        scanStatus: "REJECTED"
      }
    });
    await prisma.invoiceAttachment.create({
      data: {
        ...attachment,
        storageKey: "missing-source",
        fileName: "missing.txt"
      }
    });
    const incompleteRequest = await api("POST", "/v1/exports", organizationId, {
      includeAttachments: true
    });
    expect(incompleteRequest.statusCode, incompleteRequest.body).toBe(202);
    const incompleteJobId = incompleteRequest.json<{ job: { id: string } }>().job.id;
    let incompleteStatus = "PENDING";
    for (let attempt = 0; attempt < 100 && incompleteStatus !== "FAILED"; attempt += 1) {
      const status = await api("GET", `/v1/exports/${incompleteJobId}`, organizationId);
      incompleteStatus = status.json<{ job: { status: string } }>().job.status;
      if (incompleteStatus !== "FAILED") await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(incompleteStatus).toBe("FAILED");
    expect(
      (await prisma.organizationExportJob.findUniqueOrThrow({ where: { id: incompleteJobId } }))
        .errorMessage
    ).toMatch(/missing|checksum/i);
    await prisma.invoiceAttachment.deleteMany({ where: { storageKey: "missing-source" } });

    const exported = await readyExport(organizationId, true);
    const download = await api(
      "GET",
      `/v1/exports/${exported.job.id}/download`,
      organizationId,
      undefined,
      owner,
      { "x-export-token": exported.downloadToken }
    );
    const archive = JSON.parse(download.body) as {
      manifest: {
        files: Array<{ path: string }>;
        attachmentResults: Array<{ path: string; status: string; reason: string | null }>;
      };
    };
    expect(archive.manifest.files.some((file) => file.path.includes("attachments/"))).toBe(true);
    expect(archive.manifest.files.some((file) => file.path.includes(".."))).toBe(false);
    expect(
      archive.manifest.attachmentResults.some(
        (result) => result.path.endsWith("-rejected.txt") && result.status === "EXCLUDED"
      )
    ).toBe(true);
    expect(archive.manifest.attachmentResults.some((result) => result.status === "FAILED")).toBe(
      false
    );
    expect(download.body).not.toContain(rejectedBytes.toString("base64"));
    expect(
      (JSON.parse(download.body) as { manifest: { completeness: { status: string } } }).manifest
        .completeness.status
    ).toBe("COMPLETE");

    const readOnly = "phase12-readonly@example.test";
    const user = await prisma.user.create({
      data: { email: readOnly, displayName: readOnly, emailVerifiedAt: new Date() }
    });
    await prisma.membership.create({
      data: { organizationId, userId: user.id, role: "READ_ONLY" }
    });
    expect(
      (await api("POST", "/v1/exports", organizationId, { includeAttachments: false }, readOnly))
        .statusCode
    ).toBe(403);
    expect(
      (
        await api(
          "POST",
          "/v1/organization-closure",
          organizationId,
          {
            reason: "Unauthorized",
            exportJobId: exported.job.id,
            legalHold: false
          },
          readOnly
        )
      ).statusCode
    ).toBe(403);
    const missing = await api("POST", "/v1/organization-closure", organizationId, {
      reason: "Need export",
      legalHold: false
    });
    const missingId = missing.json<{ closure: { id: string } }>().closure.id;
    expect(
      (await api("POST", `/v1/organization-closure/${missingId}/finalize`, organizationId))
        .statusCode
    ).toBe(409);
    const attachmentFreeExport = await readyExport(organizationId, false);
    const attachmentFreeClosure = await api("POST", "/v1/organization-closure", organizationId, {
      reason: "Metadata-only archive is not a full closure backup",
      exportJobId: attachmentFreeExport.job.id,
      legalHold: false
    });
    expect(
      (
        await api(
          "POST",
          `/v1/organization-closure/${attachmentFreeClosure.json<{ closure: { id: string } }>().closure.id}/finalize`,
          organizationId
        )
      ).statusCode
    ).toBe(409);
    const held = await api("POST", "/v1/organization-closure", organizationId, {
      reason: "Litigation hold",
      exportJobId: exported.job.id,
      legalHold: true
    });
    const heldId = held.json<{ closure: { id: string } }>().closure.id;
    expect(
      (await api("POST", `/v1/organization-closure/${heldId}/finalize`, organizationId)).statusCode
    ).toBe(409);
    const closure = await api("POST", "/v1/organization-closure", organizationId, {
      reason: "Owner requested closure",
      exportJobId: exported.job.id,
      legalHold: false
    });
    const closureId = closure.json<{ closure: { id: string } }>().closure.id;
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const session = await prisma.session.create({
      data: {
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        userId: ownerUser.id,
        activeOrganizationId: organizationId,
        idleExpiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() + 120_000),
        recentAuthAt: new Date(),
        mfaAuthenticated: true
      }
    });
    const paymentAccount = await prisma.paymentAccount.create({
      data: {
        organizationId,
        provider: "STRIPE",
        providerAccountCiphertext: "closure-test-ciphertext",
        providerAccountLookupHash: createHash("sha256").update(randomUUID()).digest("hex"),
        status: "CONNECTED",
        chargesEnabled: true,
        payoutsEnabled: true,
        connectedAt: new Date(),
        createdByUserId: ownerUser.id,
        updatedByUserId: ownerUser.id
      }
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
        return tx.$queryRaw`
          SELECT phase12_revoke_organization_sessions(${organizationId}::uuid)
        `;
      })
    ).rejects.toThrow(/not authorized/i);
    const storedClosureExport = await prisma.organizationExportJob.findUniqueOrThrow({
      where: { id: exported.job.id }
    });
    const intactClosureArchive = storage.values.get(storedClosureExport.storageKey!)!;
    storage.values.set(storedClosureExport.storageKey!, Buffer.from("corrupt closure archive"));
    expect(
      (await api("POST", `/v1/organization-closure/${closureId}/finalize`, organizationId))
        .statusCode
    ).toBe(409);
    storage.values.set(storedClosureExport.storageKey!, intactClosureArchive);
    const finalized = await api(
      "POST",
      `/v1/organization-closure/${closureId}/finalize`,
      organizationId
    );
    expect(finalized.statusCode, finalized.body).toBe(200);
    const result = finalized.json<{
      closure: { status: string; scheduledDeletionAt: string | null };
    }>().closure;
    expect(result.status).toBe("RETENTION_SCHEDULED");
    expect(typeof result.scheduledDeletionAt).toBe("string");
    expect(await prisma.organization.count({ where: { id: organizationId } })).toBe(1);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt
    ).not.toBeNull();
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revocationReason
    ).toBe("ORGANIZATION_CLOSURE");
    expect(
      await prisma.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccount.id } })
    ).toMatchObject({
      status: "DISCONNECTED",
      chargesEnabled: false,
      payoutsEnabled: false
    });
    expect(
      await prisma.auditEvent.count({
        where: { organizationId, action: "ORGANIZATION_RETENTION_SCHEDULED" }
      })
    ).toBe(1);
    await expect(
      prisma.organizationClosureRequest.update({
        where: { id: closureId },
        data: { scheduledDeletionAt: new Date(0) }
      })
    ).rejects.toThrow(/immutable/i);
    expect(
      (await api("POST", `/v1/organization-closure/${closureId}/finalize`, organizationId))
        .statusCode
    ).toBe(200);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId, action: "ORGANIZATION_RETENTION_SCHEDULED" }
      })
    ).toBe(1);
  });
});
