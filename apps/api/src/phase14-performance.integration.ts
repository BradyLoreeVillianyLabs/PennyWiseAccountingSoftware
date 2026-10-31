import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient, withTenantTransaction } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { DocumentStorage } from "./services/invoice-render-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const owner = "phase14-performance@example.test";
const fixtureSize = {
  customers: 200,
  vendors: 200,
  documents: 200,
  inventoryProducts: 200,
  journalLines: 2_000,
  bankRows: 1_000,
  invoicePostSamples: 20,
  reportSamples: 10,
  inventorySamples: 10
} as const;

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

interface ChartAccount {
  readonly id: string;
  readonly systemPurpose: string | null;
}

interface CapacityFixture {
  readonly organizationId: string;
  readonly companyId: string;
  readonly bankLedgerAccountId: string;
  readonly expenseAccountId: string;
  readonly revenueAccountId: string;
  readonly serviceProductId: string;
  readonly customerIds: readonly string[];
  readonly inventoryProductIds: readonly string[];
  readonly inventoryLocationId: string;
}

function headers(organizationId?: string, extra: Record<string, string> = {}) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": owner,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...extra
  };
}

async function api(
  method: "GET" | "POST" | "PATCH",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  extra: Record<string, string> = {}
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, extra),
    ...(payload === undefined ? {} : { payload })
  });
}

async function elapsed<T>(
  work: () => Promise<T>
): Promise<{ readonly milliseconds: number; value: T }> {
  const startedAt = performance.now();
  const value = await work();
  return { milliseconds: performance.now() - startedAt, value };
}

function percentile95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

async function p95(
  sampleCount: number,
  work: (index: number) => Promise<void>
): Promise<{ readonly p95: number; readonly samples: readonly number[] }> {
  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const measurement = await elapsed(() => work(index));
    samples.push(measurement.milliseconds);
  }
  return { p95: percentile95(samples), samples };
}

async function createAccount(
  organizationId: string,
  code: string,
  type: "ASSET" | "EXPENSE" | "REVENUE"
): Promise<string> {
  const response = await api("POST", "/v1/accounts", organizationId, {
    code,
    name: `Phase 14 performance ${code}`,
    type,
    isControl: false
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

function accountByPurpose(accounts: readonly ChartAccount[], purpose: string): string {
  const account = accounts.find((candidate) => candidate.systemPurpose === purpose);
  if (!account) throw new Error(`Required preset account is missing: ${purpose}`);
  return account.id;
}

async function createCapacityFixture(): Promise<CapacityFixture> {
  const organizationResponse = await api("POST", "/v1/organizations", undefined, {
    legalName: "Phase Fourteen Performance Ltd",
    displayName: "Phase Fourteen Performance",
    timezone: "America/Edmonton"
  });
  expect(organizationResponse.statusCode, organizationResponse.body).toBe(201);
  const organizationId = organizationResponse.json<{ organization: { id: string } }>().organization
    .id;

  const setup = await api("GET", "/v1/setup", organizationId);
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  const profile = await api("PATCH", "/v1/setup/profile", organizationId, {
    version,
    legalName: "Phase Fourteen Performance Ltd",
    displayName: "Phase Fourteen Performance",
    locale: "en-CA",
    timeZone: "America/Edmonton",
    baseCurrency: "CAD",
    fiscalYearEndMonth: 12,
    fiscalYearEndDay: 31,
    accountingStartDate: "2026-01-01"
  });
  expect(profile.statusCode, profile.body).toBe(200);
  expect(
    (
      await api(
        "POST",
        "/v1/setup/presets/general-service/apply",
        organizationId,
        {},
        { "idempotency-key": randomUUID() }
      )
    ).statusCode
  ).toBe(201);
  expect(
    (await api("POST", "/v1/setup/fiscal-year/initialize", organizationId, {})).statusCode
  ).toBe(200);

  const companiesResponse = await api("GET", "/v1/organizations/current/companies", organizationId);
  expect(companiesResponse.statusCode, companiesResponse.body).toBe(200);
  const companyId = companiesResponse
    .json<{ companies: Array<{ id: string; active: boolean }> }>()
    .companies.find((company) => company.active)?.id;
  if (!companyId) throw new Error("The performance fixture company was not selected.");

  const chartResponse = await api("GET", "/v1/accounts", organizationId);
  expect(chartResponse.statusCode, chartResponse.body).toBe(200);
  const chart = chartResponse.json<{ accounts: ChartAccount[] }>().accounts;
  const revenueAccountId = accountByPurpose(chart, "professional-services");
  const expenseAccountId = accountByPurpose(chart, "general-expense");
  const [
    bankLedgerAccountId,
    inventoryAssetAccountId,
    purchaseClearingAccountId,
    cogsAccountId,
    lossAccountId,
    gainAccountId
  ] = await Promise.all([
    createAccount(organizationId, "PERF-BANK", "ASSET"),
    createAccount(organizationId, "PERF-INVENTORY", "ASSET"),
    createAccount(organizationId, "PERF-CLEARING", "ASSET"),
    createAccount(organizationId, "PERF-COGS", "EXPENSE"),
    createAccount(organizationId, "PERF-LOSS", "EXPENSE"),
    createAccount(organizationId, "PERF-GAIN", "REVENUE")
  ]);

  const serviceProductResponse = await api("POST", "/v1/products", organizationId, {
    sku: "PERF-SERVICE",
    name: "Phase 14 performance service",
    itemType: "SERVICE",
    salesPriceMinor: "1000",
    incomeAccountId: revenueAccountId
  });
  expect(serviceProductResponse.statusCode, serviceProductResponse.body).toBe(201);
  const serviceProductId = serviceProductResponse.json<{ product: { id: string } }>().product.id;
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
  const locationId = randomUUID();
  const customerIds = Array.from({ length: fixtureSize.customers }, () => randomUUID());
  const vendorIds = Array.from({ length: fixtureSize.vendors }, () => randomUUID());
  const inventoryProductIds = Array.from({ length: fixtureSize.inventoryProducts }, () =>
    randomUUID()
  );
  const fixtureDate = new Date("2026-06-15T00:00:00.000Z");

  await withTenantTransaction(
    prisma,
    { organizationId, actorUserId: actor.id },
    async (tx) => {
      await tx.inventoryLocation.create({
        data: {
          id: locationId,
          organizationId,
          companyId,
          code: "PERF-MAIN",
          name: "Performance warehouse",
          isDefault: true,
          createdByUserId: actor.id,
          updatedByUserId: actor.id
        }
      });
      await tx.customer.createMany({
        data: customerIds.map((id, index) => ({
          id,
          organizationId,
          customerNumber: `PERF-C-${String(index + 1).padStart(4, "0")}`,
          displayName: `Performance customer ${String(index + 1)}`,
          defaultPaymentTermsDays: 30,
          defaultCurrency: "CAD",
          createdByUserId: actor.id,
          updatedByUserId: actor.id
        }))
      });
      await tx.vendor.createMany({
        data: vendorIds.map((id, index) => ({
          id,
          organizationId,
          vendorNumber: `PERF-V-${String(index + 1).padStart(4, "0")}`,
          legalName: `Performance vendor ${String(index + 1)} Ltd`,
          displayName: `Performance vendor ${String(index + 1)}`,
          defaultPaymentTermsDays: 30,
          createdByUserId: actor.id,
          updatedByUserId: actor.id
        }))
      });
      await tx.productItem.createMany({
        data: inventoryProductIds.map((id, index) => ({
          id,
          organizationId,
          companyId,
          sku: `PERF-I-${String(index + 1).padStart(4, "0")}`,
          name: `Performance inventory item ${String(index + 1)}`,
          itemType: "INVENTORY_PRODUCT",
          salesPriceMinor: 1_000n,
          purchaseCostMinor: 500n,
          incomeAccountId: revenueAccountId,
          inventoryAssetAccountId,
          costOfGoodsSoldAccountId: cogsAccountId,
          purchaseClearingAccountId,
          adjustmentGainAccountId: gainAccountId,
          inventoryLossAccountId: lossAccountId,
          defaultLocationId: locationId,
          unitOfMeasure: "each",
          createdByUserId: actor.id,
          updatedByUserId: actor.id
        }))
      });
      await tx.inventoryBalance.createMany({
        data: inventoryProductIds.map((productItemId) => ({
          organizationId,
          companyId,
          productItemId,
          locationId,
          quantityOnHandMicros: 0n,
          valueOnHandMinor: 0n,
          averageUnitCostMicros: 0n
        }))
      });
      await tx.invoice.createMany({
        data: customerIds.map((customerId, index) => ({
          organizationId,
          customerId,
          provisionalIdentifier: `PERF-INV-${String(index + 1)}-${randomUUID()}`,
          paymentReference: `PERF-${String(index + 1)}-${randomUUID().slice(0, 8)}`,
          issueDate: fixtureDate,
          dueDate: fixtureDate,
          paymentTermsDays: 30,
          currency: "CAD",
          subtotalMinor: 1_000n,
          grandTotalMinor: 1_000n,
          customerNameSnapshot: `Performance customer ${String(index + 1)}`,
          organizationSnapshot: { legalName: "Phase Fourteen Performance Ltd" },
          createdByUserId: actor.id,
          updatedByUserId: actor.id
        }))
      });
      await tx.bill.createMany({
        data: vendorIds.map((vendorId, index) => ({
          organizationId,
          vendorId,
          vendorInvoiceNumber: `PERF-BILL-${String(index + 1).padStart(4, "0")}`,
          issueDate: fixtureDate,
          dueDate: fixtureDate,
          paymentTermsDays: 30,
          currency: "CAD",
          subtotalMinor: 1_000n,
          grandTotalMinor: 1_000n,
          vendorNameSnapshot: `Performance vendor ${String(index + 1)}`,
          createdByUserId: actor.id,
          updatedByUserId: actor.id
        }))
      });
    },
    { timeout: 60_000 }
  );

  return {
    organizationId,
    companyId,
    bankLedgerAccountId,
    expenseAccountId,
    revenueAccountId,
    serviceProductId,
    customerIds,
    inventoryProductIds,
    inventoryLocationId: locationId
  };
}

async function stockInventory(fixture: CapacityFixture): Promise<void> {
  for (const productItemId of fixture.inventoryProductIds) {
    const response = await api(
      "POST",
      "/v1/inventory/adjustments",
      fixture.organizationId,
      {
        productItemId,
        locationId: fixture.inventoryLocationId,
        direction: "IN",
        quantity: "10",
        unitCostMinor: "500",
        adjustmentKind: "OPENING",
        effectiveDate: "2026-06-15",
        reason: "Phase 14 capacity fixture opening stock"
      },
      { "idempotency-key": randomUUID() }
    );
    expect(response.statusCode, response.body).toBe(201);
  }
}

async function postLargeJournals(fixture: CapacityFixture): Promise<number[]> {
  const linesPerJournal = 500;
  const journalCount = fixtureSize.journalLines / linesPerJournal;
  const samples: number[] = [];
  for (let journalIndex = 0; journalIndex < journalCount; journalIndex += 1) {
    const measurement = await elapsed(() =>
      api(
        "POST",
        "/v1/journals",
        fixture.organizationId,
        {
          description: `Phase 14 capacity journal ${String(journalIndex + 1)}`,
          effectiveDate: "2026-06-15",
          sourceType: "PHASE14_PERFORMANCE",
          sourceId: randomUUID(),
          postingKey: `phase14-performance:${randomUUID()}`,
          lines: Array.from({ length: linesPerJournal / 2 }, () => [
            {
              accountId: fixture.expenseAccountId,
              debitMinor: "100",
              creditMinor: "0"
            },
            {
              accountId: fixture.revenueAccountId,
              debitMinor: "0",
              creditMinor: "100"
            }
          ]).flat()
        },
        { "idempotency-key": randomUUID() }
      )
    );
    expect(measurement.value.statusCode, measurement.value.body).toBe(201);
    samples.push(measurement.milliseconds);
  }
  return samples;
}

async function createInvoicePostSamples(fixture: CapacityFixture) {
  const drafts = [] as Array<{ id: string; version: number }>;
  for (let index = 0; index < fixtureSize.invoicePostSamples; index += 1) {
    const response = await api("POST", "/v1/invoices", fixture.organizationId, {
      customerId: fixture.customerIds[index]!,
      issueDate: "2026-06-16",
      currency: "CAD",
      lines: [{ productItemId: fixture.serviceProductId, quantity: "1" }]
    });
    expect(response.statusCode, response.body).toBe(201);
    drafts.push(response.json<{ invoice: { id: string; version: number } }>().invoice);
  }
  return drafts;
}

function statementCsv(): string {
  const header = "date,description,amount,currency,reference,id";
  const rows = Array.from({ length: fixtureSize.bankRows }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    return `2026-06-${day},Capacity transaction ${String(index + 1)},1.00,CAD,PERF-${String(index + 1)},PERF-${String(index + 1)}`;
  });
  return [header, ...rows].join("\n");
}

async function readyExport(
  organizationId: string
): Promise<{ readonly milliseconds: number; readonly byteSize: number }> {
  const measurement = await elapsed(async () => {
    const requested = await api("POST", "/v1/exports", organizationId, {
      includeAttachments: false
    });
    expect(requested.statusCode, requested.body).toBe(202);
    const requestedJob = requested.json<{ job: { id: string }; downloadToken: string }>();
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const response = await api("GET", `/v1/exports/${requestedJob.job.id}`, organizationId);
      expect(response.statusCode, response.body).toBe(200);
      const job = response.json<{ job: { status: string; byteSize: number | null } }>().job;
      if (job.status === "READY") return job.byteSize ?? 0;
      if (job.status === "FAILED") throw new Error(response.body);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Performance export did not become ready.");
  });
  return { milliseconds: measurement.milliseconds, byteSize: measurement.value };
}

async function assertTenantIndexes(): Promise<void> {
  const indexes = await prisma.$queryRaw<Array<{ tablename: string; indexdef: string }>>`
    SELECT tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('JournalLine', 'Invoice', 'Bill', 'BankImportedTransaction', 'InventoryBalance')
  `;
  for (const table of [
    "JournalLine",
    "Invoice",
    "Bill",
    "BankImportedTransaction",
    "InventoryBalance"
  ]) {
    expect(
      indexes.some(
        (index) => index.tablename === table && index.indexdef.includes("organizationId")
      )
    ).toBe(true);
  }
}

beforeAll(async () => {
  await prisma.$connect();
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

describe("Phase 14 controlled-beta capacity profile", () => {
  it("meets latency budgets with tenant-scoped production-like fixture sizes", async () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const fixture = await createCapacityFixture();
    await stockInventory(fixture);
    const journalPostSamples = await postLargeJournals(fixture);
    const invoiceDrafts = await createInvoicePostSamples(fixture);

    const invoicePosts = await p95(invoiceDrafts.length, async (index) => {
      const draft = invoiceDrafts[index]!;
      const response = await api(
        "POST",
        `/v1/invoices/${draft.id}/post`,
        fixture.organizationId,
        { version: draft.version },
        { "idempotency-key": randomUUID() }
      );
      expect(response.statusCode, response.body).toBe(201);
    });
    // Warm the tenant-scoped report connection/query plan before measuring steady-state
    // latency. The release gate runs after the browser/integration suites, which can leave
    // freshly-created pooled connections to initialize on their first few report requests.
    for (let index = 0; index < Math.min(5, fixtureSize.reportSamples); index += 1) {
      const warmup = await api(
        "GET",
        "/v1/reports/trial-balance?asOf=2026-12-31",
        fixture.organizationId
      );
      expect(warmup.statusCode, warmup.body).toBe(200);
    }
    const reports = await p95(fixtureSize.reportSamples, async () => {
      const response = await api(
        "GET",
        "/v1/reports/trial-balance?asOf=2026-12-31",
        fixture.organizationId
      );
      expect(response.statusCode, response.body).toBe(200);
    });
    const inventoryQueries = await p95(fixtureSize.inventorySamples, async () => {
      const response = await api("GET", "/v1/inventory/quantities", fixture.organizationId);
      expect(response.statusCode, response.body).toBe(200);
    });

    const bankAccountResponse = await api("POST", "/v1/bank-accounts", fixture.organizationId, {
      displayName: "Phase 14 performance bank",
      accountKind: "BANK",
      maskedAccountReference: "****1414",
      financialInstitutionName: "Capacity Credit Union",
      currency: "CAD",
      linkedLedgerAccountId: fixture.bankLedgerAccountId,
      openingDate: "2026-01-01"
    });
    expect(bankAccountResponse.statusCode, bankAccountResponse.body).toBe(201);
    const bankAccountId = bankAccountResponse.json<{ bankAccount: { id: string } }>().bankAccount
      .id;
    const preview = await elapsed(() =>
      api("POST", "/v1/bank-imports/preview", fixture.organizationId, {
        bankAccountId,
        fileName: "phase14-capacity.csv",
        format: "CSV",
        contentBase64: Buffer.from(statementCsv()).toString("base64")
      })
    );
    expect(preview.value.statusCode, preview.value.body).toBe(201);
    const previewedBatch = preview.value.json<{
      batch: { id: string; version: number };
      rows: unknown[];
    }>();
    expect(previewedBatch.rows).toHaveLength(fixtureSize.bankRows);
    const commit = await elapsed(() =>
      api(
        "POST",
        `/v1/bank-imports/${previewedBatch.batch.id}/commit`,
        fixture.organizationId,
        { version: previewedBatch.batch.version },
        { "idempotency-key": randomUUID() }
      )
    );
    expect(commit.value.statusCode, commit.value.body).toBe(201);
    const imported = commit.value.json<{ transactions: Array<{ id: string }> }>().transactions;
    expect(imported).toHaveLength(fixtureSize.bankRows);
    const reconciliationWorkspace = await p95(5, async () => {
      const response = await api(
        "GET",
        `/v1/bank-transactions?bankAccountId=${bankAccountId}&limit=100`,
        fixture.organizationId
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(
        response.json<{ transactions: { items: unknown[] } }>().transactions.items
      ).toHaveLength(100);
    });

    const exported = await readyExport(fixture.organizationId);
    const counts = {
      customers: await prisma.customer.count({ where: { organizationId: fixture.organizationId } }),
      vendors: await prisma.vendor.count({ where: { organizationId: fixture.organizationId } }),
      invoices: await prisma.invoice.count({ where: { organizationId: fixture.organizationId } }),
      bills: await prisma.bill.count({ where: { organizationId: fixture.organizationId } }),
      inventoryProducts: await prisma.productItem.count({
        where: { organizationId: fixture.organizationId, itemType: "INVENTORY_PRODUCT" }
      }),
      journalLines: await prisma.journalLine.count({
        where: { organizationId: fixture.organizationId }
      })
    };
    await assertTenantIndexes();

    const heapGrowthMiB = Math.max(0, process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
    const metrics = {
      fixture: counts,
      milliseconds: {
        invoicePostP95: invoicePosts.p95,
        reportP95: reports.p95,
        inventoryQueryP95: inventoryQueries.p95,
        bankPreview: preview.milliseconds,
        bankCommit: commit.milliseconds,
        reconciliationWorkspaceP95: reconciliationWorkspace.p95,
        export: exported.milliseconds,
        largeJournalPostP95: percentile95(journalPostSamples)
      },
      samples: {
        invoicePost: invoicePosts.samples,
        report: reports.samples,
        inventoryQuery: inventoryQueries.samples,
        reconciliationWorkspace: reconciliationWorkspace.samples,
        largeJournalPost: journalPostSamples
      },
      exportBytes: exported.byteSize,
      heapGrowthMiB
    };
    console.log(`PHASE14_PERFORMANCE_METRICS ${JSON.stringify(metrics)}`);

    expect(counts.customers).toBeGreaterThanOrEqual(fixtureSize.customers);
    expect(counts.vendors).toBeGreaterThanOrEqual(fixtureSize.vendors);
    expect(counts.invoices).toBeGreaterThanOrEqual(
      fixtureSize.documents + fixtureSize.invoicePostSamples
    );
    expect(counts.bills).toBeGreaterThanOrEqual(fixtureSize.documents);
    expect(counts.inventoryProducts).toBeGreaterThanOrEqual(fixtureSize.inventoryProducts);
    expect(counts.journalLines).toBeGreaterThanOrEqual(
      fixtureSize.journalLines + fixtureSize.invoicePostSamples * 2
    );
    expect(invoicePosts.p95).toBeLessThan(2_000);
    expect(reports.p95).toBeLessThan(5_000);
    expect(inventoryQueries.p95).toBeLessThan(2_000);
    expect(preview.milliseconds).toBeLessThan(10_000);
    expect(commit.milliseconds).toBeLessThan(10_000);
    expect(reconciliationWorkspace.p95).toBeLessThan(5_000);
    expect(exported.milliseconds).toBeLessThan(30_000);
    expect(exported.byteSize).toBeGreaterThan(0);
    expect(heapGrowthMiB).toBeLessThan(512);
  });
});
