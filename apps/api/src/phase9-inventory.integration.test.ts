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
const owner = "phase9-owner@example.test";

function headers(organizationId?: string, key?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": owner,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

async function api(
  method: "GET" | "POST" | "PATCH",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  key?: string
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, key),
    ...(payload === undefined ? {} : { payload })
  });
}

async function organization() {
  const created = await api("POST", "/v1/organizations", undefined, {
    legalName: "Phase Nine Ltd",
    displayName: "Phase Nine"
  });
  expect(created.statusCode).toBe(201);
  const id = created.json<{ organization: { id: string } }>().organization.id;
  const setup = await api("GET", "/v1/setup", id);
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await api("PATCH", "/v1/setup/profile", id, {
        version,
        legalName: "Phase Nine Ltd",
        displayName: "Phase Nine",
        locale: "en-CA",
        timeZone: "America/Edmonton",
        baseCurrency: "CAD",
        fiscalYearEndMonth: 12,
        fiscalYearEndDay: 31,
        accountingStartDate: "2026-01-01"
      })
    ).statusCode
  ).toBe(200);
  expect(
    (await api("POST", "/v1/setup/presets/general-service/apply", id, {}, randomUUID())).statusCode
  ).toBe(201);
  expect((await api("POST", "/v1/setup/fiscal-year/initialize", id, {})).statusCode).toBe(200);
  return id;
}

async function account(
  organizationId: string,
  code: string,
  type: "ASSET" | "EXPENSE" | "REVENUE"
) {
  const response = await api("POST", "/v1/accounts", organizationId, {
    code,
    name: code,
    type,
    isControl: false
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

async function inventoryFixture() {
  const organizationId = await organization();
  const [asset, clearing, cogs, loss, gain, income] = await Promise.all([
    account(organizationId, "1400", "ASSET"),
    account(organizationId, "1410", "ASSET"),
    account(organizationId, "5000", "EXPENSE"),
    account(organizationId, "5100", "EXPENSE"),
    account(organizationId, "4900", "REVENUE"),
    account(organizationId, "4999", "REVENUE")
  ]);
  const locationResponse = await api("POST", "/v1/inventory/locations", organizationId, {
    code: "MAIN",
    name: "Main warehouse",
    isDefault: true
  });
  expect(locationResponse.statusCode, locationResponse.body).toBe(201);
  const locationId = locationResponse.json<{ location: { id: string } }>().location.id;
  const productResponse = await api("POST", "/v1/products", organizationId, {
    sku: "WIDGET",
    name: "Widget",
    itemType: "INVENTORY_PRODUCT",
    salesPriceMinor: "250",
    purchaseCostMinor: "100",
    incomeAccountId: income,
    inventoryAssetAccountId: asset,
    costOfGoodsSoldAccountId: cogs,
    purchaseClearingAccountId: clearing,
    adjustmentGainAccountId: gain,
    inventoryLossAccountId: loss,
    defaultLocationId: locationId,
    reorderPointMicros: "2000000",
    unitOfMeasure: "each"
  });
  expect(productResponse.statusCode, productResponse.body).toBe(201);
  const productId = productResponse.json<{ product: { id: string } }>().product.id;
  return {
    organizationId,
    locationId,
    productId,
    accounts: { asset, clearing, cogs, loss, gain, income }
  };
}

async function adjust(
  fixture: Awaited<ReturnType<typeof inventoryFixture>>,
  direction: "IN" | "OUT",
  quantity: string,
  unitCostMinor?: string,
  key = randomUUID()
) {
  return api(
    "POST",
    "/v1/inventory/adjustments",
    fixture.organizationId,
    {
      productItemId: fixture.productId,
      locationId: fixture.locationId,
      direction,
      quantity,
      ...(unitCostMinor ? { unitCostMinor } : {}),
      adjustmentKind: direction === "IN" ? "OPENING" : "COUNT_CORRECTION",
      effectiveDate: "2026-02-01",
      reason: "Count verified"
    },
    key
  );
}

async function customer(organizationId: string) {
  const response = await api("POST", "/v1/customers", organizationId, {
    customerNumber: "C-001",
    displayName: "Inventory Customer",
    defaultPaymentTermsDays: 30,
    defaultCurrency: "CAD"
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ customer: { id: string } }>().customer.id;
}

async function invoice(fixture: Awaited<ReturnType<typeof inventoryFixture>>, quantity: string) {
  const customerId = await customer(fixture.organizationId);
  const draft = await api("POST", "/v1/invoices", fixture.organizationId, {
    customerId,
    issueDate: "2026-02-02",
    currency: "CAD",
    lines: [{ productItemId: fixture.productId, quantity }]
  });
  expect(draft.statusCode, draft.body).toBe(201);
  return draft.json<{ invoice: { id: string; version: number } }>().invoice;
}

async function postedBill(fixture: Awaited<ReturnType<typeof inventoryFixture>>) {
  const vendorResponse = await api("POST", "/v1/vendors", fixture.organizationId, {
    vendorNumber: "V-001",
    legalName: "Inventory Supply Ltd",
    displayName: "Inventory Supply"
  });
  expect(vendorResponse.statusCode, vendorResponse.body).toBe(201);
  const vendorId = vendorResponse.json<{ vendor: { id: string } }>().vendor.id;
  const draftResponse = await api("POST", "/v1/bills", fixture.organizationId, {
    vendorId,
    vendorInvoiceNumber: "INV-001",
    issueDate: "2026-02-01",
    lines: [
      {
        description: "Widgets",
        quantity: "4",
        unitCostMinor: "125",
        accountId: fixture.accounts.clearing,
        productItemId: fixture.productId
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
    fixture.organizationId,
    { version: draft.version },
    randomUUID()
  );
  expect(posted.statusCode, posted.body).toBe(201);
  return draft.lines[0]!.id;
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

describe("Phase 9 perpetual inventory", () => {
  it("accepts one valid account reused across compatible inventory roles", async () => {
    const organizationId = await organization();
    const [asset, expense, revenue] = await Promise.all([
      account(organizationId, "1420", "ASSET"),
      account(organizationId, "5200", "EXPENSE"),
      account(organizationId, "4920", "REVENUE")
    ]);
    const locationResponse = await api("POST", "/v1/inventory/locations", organizationId, {
      code: "SHARED",
      name: "Shared-account warehouse",
      isDefault: true
    });
    expect(locationResponse.statusCode, locationResponse.body).toBe(201);

    const response = await api("POST", "/v1/products", organizationId, {
      sku: "SHARED-ACCOUNTS",
      name: "Shared account inventory item",
      itemType: "INVENTORY_PRODUCT",
      salesPriceMinor: "250",
      purchaseCostMinor: "100",
      incomeAccountId: revenue,
      inventoryAssetAccountId: asset,
      purchaseClearingAccountId: asset,
      costOfGoodsSoldAccountId: expense,
      inventoryLossAccountId: expense,
      adjustmentGainAccountId: revenue,
      defaultLocationId: locationResponse.json<{ location: { id: string } }>().location.id,
      unitOfMeasure: "each"
    });

    expect(response.statusCode, response.body).toBe(201);
  });

  it("posts exact weighted-average depletion with a balanced COGS journal", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "3", "100")).statusCode).toBe(201);
    expect((await adjust(fixture, "IN", "2", "250")).statusCode).toBe(201);
    const draft = await invoice(fixture, "2");
    const posted = await api(
      "POST",
      `/v1/invoices/${draft.id}/post`,
      fixture.organizationId,
      { version: draft.version },
      randomUUID()
    );
    expect(posted.statusCode, posted.body).toBe(201);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: fixture.productId, locationId: fixture.locationId }
    });
    expect(balance.quantityOnHandMicros).toBe(3_000_000n);
    expect(balance.valueOnHandMinor).toBe(480n);
    expect(balance.averageUnitCostMicros).toBe(160_000_000n);
    const sale = await prisma.inventoryMovement.findFirstOrThrow({
      where: { productItemId: fixture.productId, movementType: "SALE" },
      include: { journal: { include: { lines: true } } }
    });
    expect(sale.totalValueMinor).toBe(-320n);
    expect(sale.journal?.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(320n);
    expect(sale.journal?.lines.reduce((sum, line) => sum + line.creditMinor, 0n)).toBe(320n);
    const costReport = await api(
      "GET",
      "/v1/inventory/reports/cost-of-goods",
      fixture.organizationId
    );
    expect(costReport.statusCode, costReport.body).toBe(200);
    expect(
      costReport.json<{ costOfGoods: { totalCostOfGoodsMinor: string } }>().costOfGoods
        .totalCostOfGoodsMinor
    ).toBe("320");
  });

  it("serializes inventory quantities as exact strings without leaking Prisma bigint fields", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "2", "100")).statusCode).toBe(201);
    const response = await api("GET", "/v1/inventory/quantities", fixture.organizationId);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ quantities: Array<Record<string, unknown>> }>().quantities).toEqual([
      expect.objectContaining({
        productItemId: fixture.productId,
        locationId: fixture.locationId,
        quantityOnHandMicros: "2000000",
        quantityAvailableMicros: "2000000",
        valueOnHandMinor: "200",
        averageUnitCostMicros: "100000000"
      })
    ]);
  });

  it("rolls back the invoice and every journal when stock is insufficient", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "1", "100")).statusCode).toBe(201);
    const draft = await invoice(fixture, "2");
    const journalCount = await prisma.journal.count();
    const posted = await api(
      "POST",
      `/v1/invoices/${draft.id}/post`,
      fixture.organizationId,
      { version: draft.version },
      randomUUID()
    );
    expect(posted.statusCode).toBe(422);
    expect(posted.json<{ error: { code: string } }>().error.code).toBe("INSUFFICIENT_INVENTORY");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "DRAFT"
    );
    expect(await prisma.journal.count()).toBe(journalCount);
    expect(await prisma.inventoryMovement.count({ where: { movementType: "SALE" } })).toBe(0);
  });

  it("serializes concurrent invoice depletion and prevents overselling the last unit", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "1", "100")).statusCode).toBe(201);
    const customerId = await customer(fixture.organizationId);
    const drafts = await Promise.all(
      Array.from({ length: 2 }, async () => {
        const response = await api("POST", "/v1/invoices", fixture.organizationId, {
          customerId,
          issueDate: "2026-02-02",
          currency: "CAD",
          lines: [{ productItemId: fixture.productId, quantity: "1" }]
        });
        expect(response.statusCode, response.body).toBe(201);
        return response.json<{ invoice: { id: string; version: number } }>().invoice;
      })
    );
    const results = await Promise.all(
      drafts.map((draft) =>
        api(
          "POST",
          `/v1/invoices/${draft.id}/post`,
          fixture.organizationId,
          { version: draft.version },
          randomUUID()
        )
      )
    );
    expect(
      results.map((result) => result.statusCode).sort(),
      results.map((result) => result.body).join("\n")
    ).toEqual([201, 422]);
    expect(
      results.find((result) => result.statusCode === 422)!.json<{ error: { code: string } }>().error
        .code
    ).toBe("INSUFFICIENT_INVENTORY");
    expect(await prisma.inventoryMovement.count({ where: { movementType: "SALE" } })).toBe(1);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: fixture.productId }
    });
    expect(balance.quantityOnHandMicros).toBe(0n);
    expect(balance.valueOnHandMinor).toBe(0n);
  });

  it("preserves exact quantity and value across a two-location transfer", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "5", "101")).statusCode).toBe(201);
    const other = await api("POST", "/v1/inventory/locations", fixture.organizationId, {
      code: "SECOND",
      name: "Second warehouse"
    });
    const secondId = other.json<{ location: { id: string } }>().location.id;
    const response = await api(
      "POST",
      "/v1/inventory/transfers",
      fixture.organizationId,
      {
        productItemId: fixture.productId,
        fromLocationId: fixture.locationId,
        toLocationId: secondId,
        quantity: "1.5",
        effectiveDate: "2026-02-03"
      },
      randomUUID()
    );
    expect(response.statusCode, response.body).toBe(201);
    const movements = await prisma.inventoryMovement.findMany({
      where: { movementType: { in: ["TRANSFER_IN", "TRANSFER_OUT"] } }
    });
    expect(movements).toHaveLength(2);
    expect(movements.reduce((sum, movement) => sum + movement.quantityMicros, 0n)).toBe(0n);
    expect(movements.reduce((sum, movement) => sum + movement.totalValueMinor, 0n)).toBe(0n);
    expect(movements.every((movement) => movement.journalId === null)).toBe(true);
  });

  it("deduplicates simultaneous adjustment requests by idempotency key", async () => {
    const fixture = await inventoryFixture();
    const key = randomUUID();
    const [first, second] = await Promise.all([
      adjust(fixture, "IN", "4", "125", key),
      adjust(fixture, "IN", "4", "125", key)
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(
      await prisma.inventoryMovement.count({
        where: { productItemId: fixture.productId, movementType: "OPENING_QUANTITY" }
      })
    ).toBe(1);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: fixture.productId }
    });
    expect(balance.quantityOnHandMicros).toBe(4_000_000n);
    expect(balance.valueOnHandMinor).toBe(500n);
  });

  it("rejects direct mutation and projection tampering in PostgreSQL", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "2", "100")).statusCode).toBe(201);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { productItemId: fixture.productId }
    });
    await expect(
      prisma.inventoryMovement.update({
        where: { id: movement.id },
        data: { totalValueMinor: 999n }
      })
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.inventoryBalance.updateMany({
          where: { productItemId: fixture.productId },
          data: { valueOnHandMinor: 999n }
        });
      })
    ).rejects.toThrow(/does not reconcile/);
  });

  it("reconciles movement valuation to control accounts and detects a ledger discrepancy", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "2", "100")).statusCode).toBe(201);
    const reconciled = await api(
      "GET",
      "/v1/inventory/reports/control-reconciliation",
      fixture.organizationId
    );
    expect(reconciled.statusCode, reconciled.body).toBe(200);
    expect(
      reconciled.json<{
        reconciliation: {
          totalInventoryValueMinor: string;
          totalLedgerBalanceMinor: string;
          differenceMinor: string;
          isReconciled: boolean;
        };
      }>().reconciliation
    ).toMatchObject({
      totalInventoryValueMinor: "200",
      totalLedgerBalanceMinor: "200",
      differenceMinor: "0",
      isReconciled: true
    });

    const unrelatedLedgerEntry = await api(
      "POST",
      "/v1/journals",
      fixture.organizationId,
      {
        description: "Deliberate reconciliation discrepancy",
        effectiveDate: "2026-02-02",
        sourceType: "RECONCILIATION_TEST",
        sourceId: randomUUID(),
        postingKey: `reconciliation-test:${randomUUID()}`,
        lines: [
          { accountId: fixture.accounts.asset, debitMinor: "1", creditMinor: "0" },
          { accountId: fixture.accounts.gain, debitMinor: "0", creditMinor: "1" }
        ]
      },
      randomUUID()
    );
    expect(unrelatedLedgerEntry.statusCode, unrelatedLedgerEntry.body).toBe(201);
    const discrepant = await api(
      "GET",
      "/v1/inventory/reports/control-reconciliation",
      fixture.organizationId
    );
    expect(
      discrepant.json<{
        reconciliation: { differenceMinor: string; isReconciled: boolean };
      }>().reconciliation
    ).toMatchObject({ differenceMinor: "1", isReconciled: false });
  });

  it("rejects cross-tenant inventory configuration in PostgreSQL", async () => {
    const first = await inventoryFixture();
    const secondOrganizationId = await organization();
    const foreignLocation = await api("POST", "/v1/inventory/locations", secondOrganizationId, {
      code: "FOREIGN",
      name: "Foreign",
      isDefault: true
    });
    const foreignId = foreignLocation.json<{ location: { id: string } }>().location.id;
    await expect(
      prisma.productItem.update({
        where: { id: first.productId },
        data: { defaultLocationId: foreignId }
      })
    ).rejects.toThrow(/default location tenant mismatch/);
  });

  it("capitalizes only received quantities and caps partial receipts at the bill", async () => {
    const fixture = await inventoryFixture();
    const billLineId = await postedBill(fixture);
    const first = await api(
      "POST",
      "/v1/inventory/purchase-receipts",
      fixture.organizationId,
      {
        billLineId,
        quantity: "1.5",
        receivedDate: "2026-02-04"
      },
      randomUUID()
    );
    expect(first.statusCode, first.body).toBe(201);
    const second = await api(
      "POST",
      "/v1/inventory/purchase-receipts",
      fixture.organizationId,
      {
        billLineId,
        quantity: "2.5",
        receivedDate: "2026-02-05"
      },
      randomUUID()
    );
    expect(second.statusCode, second.body).toBe(201);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: fixture.productId }
    });
    expect(balance.quantityOnHandMicros).toBe(4_000_000n);
    expect(balance.valueOnHandMinor).toBe(500n);
    const excess = await api(
      "POST",
      "/v1/inventory/purchase-receipts",
      fixture.organizationId,
      {
        billLineId,
        quantity: "0.000001",
        receivedDate: "2026-02-05"
      },
      randomUUID()
    );
    expect(excess.statusCode).toBe(422);
  });

  it("voids an inventory invoice by exact movement and journal reversal", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "5", "101")).statusCode).toBe(201);
    const draft = await invoice(fixture, "2");
    const postedResponse = await api(
      "POST",
      `/v1/invoices/${draft.id}/post`,
      fixture.organizationId,
      { version: draft.version },
      randomUUID()
    );
    const posted = postedResponse.json<{ invoice: { version: number } }>().invoice;
    const voided = await api(
      "POST",
      `/v1/invoices/${draft.id}/void`,
      fixture.organizationId,
      {
        version: posted.version,
        effectiveDate: "2026-02-06",
        reason: "Customer order cancelled"
      },
      randomUUID()
    );
    expect(voided.statusCode, voided.body).toBe(200);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: fixture.productId }
    });
    expect(balance.quantityOnHandMicros).toBe(5_000_000n);
    expect(balance.valueOnHandMinor).toBe(505n);
    const sale = await prisma.inventoryMovement.findFirstOrThrow({
      where: { movementType: "SALE" }
    });
    const reversal = await prisma.inventoryMovement.findFirstOrThrow({
      where: { reversalOfMovementId: sale.id }
    });
    expect(reversal.quantityMicros).toBe(-sale.quantityMicros);
    expect(reversal.totalValueMinor).toBe(-sale.totalValueMinor);
  });

  it("records restocked and written-off customer returns against posted credits", async () => {
    const fixture = await inventoryFixture();
    expect((await adjust(fixture, "IN", "5", "100")).statusCode).toBe(201);
    const draft = await invoice(fixture, "2");
    const postedResponse = await api(
      "POST",
      `/v1/invoices/${draft.id}/post`,
      fixture.organizationId,
      { version: draft.version },
      randomUUID()
    );
    const posted = postedResponse.json<{
      invoice: { lines: Array<{ id: string }> };
    }>().invoice;
    for (const [index, disposition] of ["RESTOCK", "WRITE_OFF"].entries()) {
      const returnDate = `2026-02-0${String(3 + index)}`;
      const creditDraftResponse = await api(
        "POST",
        `/v1/invoices/${draft.id}/credit-notes`,
        fixture.organizationId,
        {
          issueDate: returnDate,
          reason: "Goods returned",
          fullCredit: false,
          lines: [{ invoiceLineId: posted.lines[0]!.id, quantity: "1" }]
        }
      );
      expect(creditDraftResponse.statusCode, creditDraftResponse.body).toBe(201);
      const creditDraft = creditDraftResponse.json<{
        creditNote: { id: string; version: number; lines: Array<{ id: string }> };
      }>().creditNote;
      const creditPost = await api(
        "POST",
        `/v1/credit-notes/${creditDraft.id}/post`,
        fixture.organizationId,
        { version: creditDraft.version },
        randomUUID()
      );
      expect(creditPost.statusCode, creditPost.body).toBe(201);
      const returned = await api(
        "POST",
        "/v1/inventory/customer-returns",
        fixture.organizationId,
        {
          creditNoteLineId: creditDraft.lines[0]!.id,
          quantity: "1",
          disposition,
          returnDate,
          reason: disposition === "RESTOCK" ? "Unopened" : "Damaged"
        },
        randomUUID()
      );
      expect(returned.statusCode, returned.body).toBe(201);
    }
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: fixture.productId }
    });
    expect(balance.quantityOnHandMicros).toBe(4_000_000n);
    expect(balance.valueOnHandMinor).toBe(400n);
    expect(
      await prisma.inventoryMovement.count({ where: { movementType: "CUSTOMER_RETURN" } })
    ).toBe(2);
    expect(await prisma.inventoryMovement.count({ where: { movementType: "WRITE_OFF" } })).toBe(1);
  });

  it("depletes received stock for a posted vendor credit and caps cumulative returns", async () => {
    const fixture = await inventoryFixture();
    const billLineId = await postedBill(fixture);
    expect(
      (
        await api(
          "POST",
          "/v1/inventory/purchase-receipts",
          fixture.organizationId,
          { billLineId, quantity: "4", receivedDate: "2026-02-02" },
          randomUUID()
        )
      ).statusCode
    ).toBe(201);
    const billLine = await prisma.billLine.findUniqueOrThrow({
      where: { id: billLineId },
      include: { bill: true }
    });
    const creditDraftResponse = await api("POST", "/v1/vendor-credits", fixture.organizationId, {
      vendorId: billLine.bill.vendorId,
      vendorCreditNumber: "VC-001",
      issueDate: "2026-02-03",
      reason: "Returned goods",
      lines: [{ billLineId, amountMinor: "250" }]
    });
    expect(creditDraftResponse.statusCode, creditDraftResponse.body).toBe(201);
    const creditDraft = creditDraftResponse.json<{
      vendorCredit: { id: string; version: number; lines: Array<{ id: string }> };
    }>().vendorCredit;
    const creditPost = await api(
      "POST",
      `/v1/vendor-credits/${creditDraft.id}/post`,
      fixture.organizationId,
      { version: creditDraft.version },
      randomUUID()
    );
    expect(creditPost.statusCode, creditPost.body).toBe(201);
    const returned = await api(
      "POST",
      "/v1/inventory/vendor-returns",
      fixture.organizationId,
      {
        vendorCreditLineId: creditDraft.lines[0]!.id,
        quantity: "2",
        returnDate: "2026-02-04",
        reason: "Defective batch"
      },
      randomUUID()
    );
    expect(returned.statusCode, returned.body).toBe(201);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { productItemId: fixture.productId }
    });
    expect(balance.quantityOnHandMicros).toBe(2_000_000n);
    expect(balance.valueOnHandMinor).toBe(250n);
    const excessive = await api(
      "POST",
      "/v1/inventory/vendor-returns",
      fixture.organizationId,
      {
        vendorCreditLineId: creditDraft.lines[0]!.id,
        quantity: "3",
        returnDate: "2026-02-04",
        reason: "Too many"
      },
      randomUUID()
    );
    expect(excessive.statusCode).toBe(422);
  });

  it("serializes inventory posting against fiscal-period close", async () => {
    const fixture = await inventoryFixture();
    const periodsResponse = await api("GET", "/v1/fiscal-periods", fixture.organizationId);
    const period = periodsResponse
      .json<{ periods: Array<{ id: string; status: string }> }>()
      .periods.find((item) => item.status === "OPEN")!;
    const [posting, closing] = await Promise.all([
      adjust(fixture, "IN", "1", "100", randomUUID()),
      api("POST", `/v1/fiscal-periods/${period.id}/close`, fixture.organizationId, {
        reason: "Month closed"
      })
    ]);
    expect(closing.statusCode, closing.body).toBe(200);
    expect([201, 409]).toContain(posting.statusCode);
    const afterClose = await adjust(fixture, "IN", "1", "100", randomUUID());
    expect(afterClose.statusCode).toBe(409);
    expect(afterClose.json<{ error: { code: string } }>().error.code).toBe("PERIOD_LOCKED");
  });

  it("allows only one concurrent organization-scoped location code", async () => {
    const organizationId = await organization();
    const [first, second] = await Promise.all([
      api("POST", "/v1/inventory/locations", organizationId, {
        code: "DUPLICATE",
        name: "First"
      }),
      api("POST", "/v1/inventory/locations", organizationId, {
        code: "DUPLICATE",
        name: "Second"
      })
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    expect(
      await prisma.inventoryLocation.count({ where: { organizationId, code: "DUPLICATE" } })
    ).toBe(1);
  });
});
