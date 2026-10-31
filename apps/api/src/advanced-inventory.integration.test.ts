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
const owner = "advanced-inventory-owner@example.test";

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

async function fixture() {
  const organizationResponse = await api("POST", "/v1/organizations", undefined, {
    legalName: "Advanced Inventory Ltd",
    displayName: "Advanced Inventory"
  });
  const organizationId = organizationResponse.json<{ organization: { id: string } }>().organization
    .id;
  const setup = await api("GET", "/v1/setup", organizationId);
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await api("PATCH", "/v1/setup/profile", organizationId, {
        version,
        legalName: "Advanced Inventory Ltd",
        displayName: "Advanced Inventory",
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
    (await api("POST", "/v1/setup/presets/general-service/apply", organizationId, {}, randomUUID()))
      .statusCode
  ).toBe(201);
  expect(
    (await api("POST", "/v1/setup/fiscal-year/initialize", organizationId, {})).statusCode
  ).toBe(200);
  const account = async (code: string, type: "ASSET" | "EXPENSE" | "REVENUE") =>
    (
      await api("POST", "/v1/accounts", organizationId, {
        code,
        name: code,
        type,
        isControl: false
      })
    ).json<{ account: { id: string } }>().account.id;
  const [asset, clearing, cogs, loss, gain, income] = await Promise.all([
    account("1400", "ASSET"),
    account("1410", "ASSET"),
    account("5000", "EXPENSE"),
    account("5100", "EXPENSE"),
    account("4900", "REVENUE"),
    account("4999", "REVENUE")
  ]);
  const main = (
    await api("POST", "/v1/inventory/locations", organizationId, {
      code: "MAIN",
      name: "Main",
      isDefault: true
    })
  ).json<{ location: { id: string } }>().location.id;
  const secondary = (
    await api("POST", "/v1/inventory/locations", organizationId, {
      code: "SECOND",
      name: "Secondary"
    })
  ).json<{ location: { id: string } }>().location.id;
  const product = (
    await api("POST", "/v1/products", organizationId, {
      sku: "ADV-WIDGET",
      name: "Advanced widget",
      itemType: "INVENTORY_PRODUCT",
      salesPriceMinor: "250",
      purchaseCostMinor: "100",
      incomeAccountId: income,
      inventoryAssetAccountId: asset,
      costOfGoodsSoldAccountId: cogs,
      purchaseClearingAccountId: clearing,
      adjustmentGainAccountId: gain,
      inventoryLossAccountId: loss,
      defaultLocationId: main,
      reorderPointMicros: "2000000",
      preferredStockMicros: "5000000",
      unitOfMeasure: "each"
    })
  ).json<{ product: { id: string } }>().product.id;
  return { organizationId, main, secondary, product };
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

describe("advanced inventory vertical slice", () => {
  it("supports bins, statuses, reservations, and idempotent release", async () => {
    const f = await fixture();
    expect(
      (
        await api("POST", "/v1/inventory/bins", f.organizationId, {
          locationId: f.main,
          code: "A-01",
          name: "Aisle 1"
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await api("POST", "/v1/inventory/statuses", f.organizationId, {
          code: "QUARANTINE",
          name: "Quarantine",
          sellable: false,
          allocatable: false
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await api(
          "POST",
          "/v1/inventory/adjustments",
          f.organizationId,
          {
            productItemId: f.product,
            locationId: f.main,
            direction: "IN",
            quantity: "5",
            unitCostMinor: "100",
            adjustmentKind: "OPENING",
            effectiveDate: "2026-02-01",
            reason: "Opening"
          },
          randomUUID()
        )
      ).statusCode
    ).toBe(201);
    const sourceId = randomUUID();
    const key = randomUUID();
    const reserve = await api(
      "POST",
      "/v1/inventory/reservations",
      f.organizationId,
      {
        productItemId: f.product,
        locationId: f.main,
        quantity: "2",
        sourceType: "order",
        sourceId
      },
      key
    );
    expect(reserve.statusCode).toBe(201);
    expect(reserve.json<{ availableQuantityMicros: string }>().availableQuantityMicros).toBe(
      "3000000"
    );
    const replay = await api(
      "POST",
      "/v1/inventory/reservations",
      f.organizationId,
      {
        productItemId: f.product,
        locationId: f.main,
        quantity: "2",
        sourceType: "order",
        sourceId
      },
      key
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ reservation: { id: string } }>().reservation.id).toBe(
      reserve.json<{ reservation: { id: string } }>().reservation.id
    );
    const reservationId = reserve.json<{ reservation: { id: string } }>().reservation.id;
    expect(
      (await api("POST", `/v1/inventory/reservations/${reservationId}/release`, f.organizationId))
        .statusCode
    ).toBe(200);
  });

  it("ships and receives a transfer order, then posts a count variance", async () => {
    const f = await fixture();
    expect(
      (
        await api(
          "POST",
          "/v1/inventory/adjustments",
          f.organizationId,
          {
            productItemId: f.product,
            locationId: f.main,
            direction: "IN",
            quantity: "4",
            unitCostMinor: "100",
            adjustmentKind: "OPENING",
            effectiveDate: "2026-02-01",
            reason: "Opening"
          },
          randomUUID()
        )
      ).statusCode
    ).toBe(201);
    const transfer = await api(
      "POST",
      "/v1/inventory/transfer-orders",
      f.organizationId,
      {
        fromLocationId: f.main,
        toLocationId: f.secondary,
        lines: [{ productItemId: f.product, quantity: "2" }]
      },
      randomUUID()
    );
    expect(transfer.statusCode).toBe(201);
    const transferId = transfer.json<{ transfer: { id: string } }>().transfer.id;
    const approved = await api(
      "POST",
      `/v1/inventory/transfer-orders/${transferId}/approve`,
      f.organizationId,
      { effectiveDate: "2026-02-02" },
      randomUUID()
    );
    expect(approved.statusCode, approved.body).toBe(200);
    const shipped = await api(
      "POST",
      `/v1/inventory/transfer-orders/${transferId}/ship`,
      f.organizationId,
      { effectiveDate: "2026-02-02" },
      randomUUID()
    );
    expect(shipped.statusCode, shipped.body).toBe(200);
    const received = await api(
      "POST",
      `/v1/inventory/transfer-orders/${transferId}/receive`,
      f.organizationId,
      { effectiveDate: "2026-02-03" },
      randomUUID()
    );
    expect(received.statusCode, received.body).toBe(200);
    const quantities = (await api("GET", "/v1/inventory/quantities", f.organizationId)).json<{
      quantities: Array<{ locationId: string; quantityOnHandMicros: string }>;
    }>().quantities;
    expect(quantities.find((row) => row.locationId === f.main)?.quantityOnHandMicros).toBe(
      "2000000"
    );
    expect(quantities.find((row) => row.locationId === f.secondary)?.quantityOnHandMicros).toBe(
      "2000000"
    );
    const count = await api(
      "POST",
      "/v1/inventory/counts",
      f.organizationId,
      { locationId: f.main, blind: true },
      randomUUID()
    );
    expect(count.statusCode).toBe(201);
    const countBody = count.json<{ count: { id: string; lines: Array<{ id: string }> } }>().count;
    const line = countBody.lines.find(Boolean)!;
    expect(
      (
        await api("PATCH", `/v1/inventory/count-lines/${line.id}`, f.organizationId, {
          counted: "1"
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await api(
          "POST",
          `/v1/inventory/counts/${countBody.id}/approve`,
          f.organizationId,
          { effectiveDate: "2026-02-04" },
          randomUUID()
        )
      ).statusCode
    ).toBe(201);
  });

  it("registers collision-safe barcode aliases and renders a preview-only label", async () => {
    const f = await fixture();
    const registered = await api("POST", "/v1/inventory/barcodes", f.organizationId, {
      productItemId: f.product,
      code: "00-1234",
      symbology: "CODE128",
      source: "beta-scanner",
      isPrimary: true
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const barcode = registered.json<{ barcode: { id: string; normalizedCode: string } }>().barcode;
    expect(barcode.normalizedCode).toBe("001234");
    const duplicate = await api("POST", "/v1/inventory/barcodes", f.organizationId, {
      productItemId: f.product,
      code: "001234",
      symbology: "CODE128"
    });
    expect(duplicate.statusCode).toBe(409);
    const resolved = await api("POST", "/v1/inventory/scans/resolve", f.organizationId, {
      code: "00 1234",
      captureMode: "CAMERA",
      symbology: "CODE128"
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(
      resolved.json<{ scan: { evidence: string; cameraProtocol: string } }>().scan
    ).toMatchObject({
      evidence: "BARCODE_ALIAS",
      cameraProtocol: "RESOLVE_PAYLOAD_V1"
    });
    const template = await api("POST", "/v1/inventory/label-templates", f.organizationId, {
      name: "Shelf label",
      symbology: "CODE128",
      widthMmMicros: "10000000",
      heightMmMicros: "5000000",
      fields: ["SKU", "NAME", "BARCODE"],
      isDefault: true
    });
    expect(template.statusCode, template.body).toBe(201);
    const templateId = template.json<{ template: { id: string } }>().template.id;
    const preview = await api(
      "POST",
      `/v1/inventory/label-templates/${templateId}/preview`,
      f.organizationId,
      { productItemId: f.product, barcodeId: barcode.id }
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(
      preview.json<{ preview: { sideEffect: string; printerAdapter: string } }>().preview
    ).toMatchObject({
      sideEffect: "PREVIEW_ONLY",
      printerAdapter: "NOT_CONFIGURED"
    });
    const capabilities = await api("GET", "/v1/inventory/capabilities", f.organizationId);
    expect(capabilities.statusCode).toBe(200);
    expect(
      capabilities.json<{ capabilities: { costing: { fifo: string } } }>().capabilities.costing.fifo
    ).toBe("SCAFFOLD_ONLY");
  });
});
