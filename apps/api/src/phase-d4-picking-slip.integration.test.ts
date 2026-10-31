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
const owner = "phase-d4-owner@example.test";

function headers(organizationId?: string, extra?: Record<string, string>) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "D4 Warehouse Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...extra
  };
}

async function api(
  method: "GET" | "POST" | "PATCH",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  extraHeaders?: Record<string, string>
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, extraHeaders),
    ...(payload === undefined ? {} : { payload })
  });
}

async function createAccount(
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

async function fixture() {
  const organization = await api("POST", "/v1/organizations", undefined, {
    legalName: "D4 Workwear Ltd",
    displayName: "D4 Workwear"
  });
  expect(organization.statusCode, organization.body).toBe(201);
  const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
  const setup = await api("GET", "/v1/setup", organizationId);
  const setupVersion = setup.json<{ setup: { settings: { version: number } } }>().setup.settings
    .version;
  expect(
    (
      await api("PATCH", "/v1/setup/profile", organizationId, {
        version: setupVersion,
        legalName: "D4 Workwear Ltd",
        displayName: "D4 Workwear",
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
  const [asset, clearing, cogs, loss, gain, income] = await Promise.all([
    createAccount(organizationId, "D41400", "ASSET"),
    createAccount(organizationId, "D41410", "ASSET"),
    createAccount(organizationId, "D45000", "EXPENSE"),
    createAccount(organizationId, "D45100", "EXPENSE"),
    createAccount(organizationId, "D44900", "REVENUE"),
    createAccount(organizationId, "D44910", "REVENUE")
  ]);
  const locationResponse = await api("POST", "/v1/inventory/locations", organizationId, {
    code: "D4-MAIN",
    name: "D4 Main Warehouse",
    isDefault: true
  });
  expect(locationResponse.statusCode, locationResponse.body).toBe(201);
  const locationId = locationResponse.json<{ location: { id: string } }>().location.id;
  const productResponse = await api("POST", "/v1/products", organizationId, {
    sku: "D4-SHIRT-8-NAVY",
    name: "Utility shirt",
    itemType: "INVENTORY_PRODUCT",
    salesPriceMinor: "2500",
    purchaseCostMinor: "1000",
    incomeAccountId: income,
    inventoryAssetAccountId: asset,
    costOfGoodsSoldAccountId: cogs,
    purchaseClearingAccountId: clearing,
    adjustmentGainAccountId: gain,
    inventoryLossAccountId: loss,
    defaultLocationId: locationId,
    unitOfMeasure: "each"
  });
  expect(productResponse.statusCode, productResponse.body).toBe(201);
  const productId = productResponse.json<{ product: { id: string } }>().product.id;
  expect(
    (
      await api(
        "POST",
        "/v1/inventory/adjustments",
        organizationId,
        {
          productItemId: productId,
          locationId,
          direction: "IN",
          quantity: "3",
          unitCostMinor: "1000",
          adjustmentKind: "OPENING",
          effectiveDate: "2026-02-01",
          reason: "D4 opening stock"
        },
        { "idempotency-key": randomUUID() }
      )
    ).statusCode
  ).toBe(201);
  const customerResponse = await api("POST", "/v1/customers", organizationId, {
    customerNumber: "D4-CUSTOMER",
    displayName: "D4 Customer",
    defaultCurrency: "CAD"
  });
  expect(customerResponse.statusCode, customerResponse.body).toBe(201);
  const customerId = customerResponse.json<{ customer: { id: string } }>().customer.id;
  const invoiceResponse = await api("POST", "/v1/invoices", organizationId, {
    customerId,
    issueDate: "2026-02-02",
    currency: "CAD",
    lines: [{ productItemId: productId, quantity: "2" }]
  });
  expect(invoiceResponse.statusCode, invoiceResponse.body).toBe(201);
  const draft = invoiceResponse.json<{ invoice: { id: string; version: number } }>().invoice;
  const posted = await api(
    "POST",
    `/v1/invoices/${draft.id}/post`,
    organizationId,
    {
      version: draft.version,
      effectiveDate: "2026-02-02"
    },
    { "idempotency-key": randomUUID() }
  );
  expect(posted.statusCode, posted.body).toBe(201);
  return { organizationId, locationId, productId, invoiceId: draft.id };
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

describe("D4 picking slips", () => {
  it("generates from a posted invoice, prints locally, and reprints the same slip identity", async () => {
    const data = await fixture();
    const created = await api(
      "POST",
      `/v1/invoices/${data.invoiceId}/picking-slip`,
      data.organizationId,
      {}
    );
    expect(created.statusCode, created.body).toBe(201);
    const first = created.json<{
      slip: { id: string; lines: Array<{ barcodeSnapshot: string; binSnapshot: string | null }> };
      generation: { generationNumber: number; pageCount: number };
    }>();
    expect(first.slip.lines).toEqual([
      expect.objectContaining({ barcodeSnapshot: "D4-SHIRT-8-NAVY", binSnapshot: null })
    ]);
    expect(first.generation).toMatchObject({ generationNumber: 1, pageCount: 1 });
    const pdf = await api("GET", `/v1/picking-slips/${first.slip.id}/pdf`, data.organizationId);
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    const reprint = await api(
      "POST",
      `/v1/picking-slips/${first.slip.id}/reprint`,
      data.organizationId,
      {}
    );
    expect(reprint.statusCode, reprint.body).toBe(201);
    const second = reprint.json<{
      slip: { id: string };
      generation: { generationNumber: number };
    }>();
    expect(second.slip.id).toBe(first.slip.id);
    expect(second.generation.generationNumber).toBe(2);
    expect(await prisma.pickingSlipGeneration.count()).toBe(2);
  });

  it("records a short pick as released count review without changing stock", async () => {
    const data = await fixture();
    const created = await api(
      "POST",
      `/v1/invoices/${data.invoiceId}/picking-slip`,
      data.organizationId,
      {}
    );
    const slip = created.json<{ slip: { id: string; lines: Array<{ id: string }> } }>().slip;
    const before = await prisma.inventoryBalance.findUniqueOrThrow({
      where: {
        productItemId_locationId: { productItemId: data.productId, locationId: data.locationId }
      }
    });
    const movementCount = await prisma.inventoryMovement.count();
    const response = await api(
      "POST",
      `/v1/picking-slips/${slip.id}/short-pick`,
      data.organizationId,
      {
        lines: [{ lineId: slip.lines[0]!.id, pickedQuantity: "1" }]
      }
    );
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json<{ slip: { status: string }; countIds: string[] }>()).toMatchObject({
      slip: { status: "SHORT_PICK" },
      countIds: [expect.any(String)]
    });
    const after = await prisma.inventoryBalance.findUniqueOrThrow({
      where: {
        productItemId_locationId: { productItemId: data.productId, locationId: data.locationId }
      }
    });
    expect(after.quantityOnHandMicros).toBe(before.quantityOnHandMicros);
    expect(await prisma.inventoryMovement.count()).toBe(movementCount);
    expect(
      await prisma.inventoryCount.count({ where: { pickingSlipId: slip.id, status: "RELEASED" } })
    ).toBe(1);
  });

  it("accepts a manual image, stores a JPEG thumbnail, and replays by source hash", async () => {
    const data = await fixture();
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const first = await app.inject({
      method: "POST",
      url: `/v1/products/${data.productId}/image`,
      headers: headers(data.organizationId, { "content-type": "image/png" }),
      payload: image
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(
      first.json<{
        asset: { mediaType: string; width: number; height: number };
        replayed: boolean;
      }>().asset
    ).toMatchObject({
      mediaType: "image/jpeg",
      width: 1,
      height: 1
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/products/${data.productId}/image`,
      headers: headers(data.organizationId, { "content-type": "image/png" }),
      payload: image
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json<{ replayed: boolean }>().replayed).toBe(true);
    expect(await prisma.productImageAsset.count()).toBe(1);
  });
});
