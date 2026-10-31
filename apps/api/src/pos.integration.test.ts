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
const owner = "pos-owner@example.test";

function headers(organizationId?: string, companyId?: string, key?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": owner,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(companyId ? { "x-clearledger-company-id": companyId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

async function api(
  method: "GET" | "POST" | "PATCH",
  url: string,
  organizationId?: string,
  companyId?: string,
  payload?: InjectOptions["payload"],
  key?: string
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, companyId, key),
    ...(payload === undefined ? {} : { payload })
  });
}

async function fixture() {
  const created = await api("POST", "/v1/organizations", undefined, undefined, {
    legalName: "POS Ltd",
    displayName: "POS"
  });
  expect(created.statusCode).toBe(201);
  const organizationId = created.json<{ organization: { id: string } }>().organization.id;
  const setup = await api("GET", "/v1/setup", organizationId);
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await api("PATCH", "/v1/setup/profile", organizationId, undefined, {
        version,
        legalName: "POS Ltd",
        displayName: "POS",
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
        undefined,
        {},
        randomUUID()
      )
    ).statusCode
  ).toBe(201);
  expect((await api("POST", "/v1/setup/fiscal-year/initialize", organizationId)).statusCode).toBe(
    200
  );
  const account = async (code: string, type: "ASSET" | "REVENUE") => {
    const response = await api("POST", "/v1/accounts", organizationId, undefined, {
      code,
      name: code,
      type,
      isControl: false
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ account: { id: string } }>().account.id;
  };
  const [cash, income] = await Promise.all([account("1010", "ASSET"), account("4010", "REVENUE")]);
  const company = await prisma.company.findFirstOrThrow({ where: { organizationId } });
  const location = (
    await api("POST", "/v1/inventory/locations", organizationId, company.id, {
      code: "POS-MAIN",
      name: "POS main",
      isDefault: true
    })
  ).json<{ location: { id: string } }>().location.id;
  const product = (
    await api("POST", "/v1/products", organizationId, company.id, {
      sku: "POS-ITEM",
      name: "POS item",
      itemType: "SERVICE",
      salesPriceMinor: "100",
      incomeAccountId: income
    })
  ).json<{ product: { id: string } }>().product.id;
  return { organizationId, companyId: company.id, cash, location, product };
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

describe("POS online cash vertical slice", () => {
  it("publishes the bounded cart, split-tender, and receipt interaction contract", async () => {
    const f = await fixture();
    const capabilities = await api("GET", "/v1/pos/capabilities", f.organizationId, f.companyId);
    expect(capabilities.statusCode, capabilities.body).toBe(200);
    expect(
      capabilities.json<{
        capabilities: {
          cart: { multiLine: boolean; maxLines: number; quantityDecimals: number };
          tenders: {
            split: boolean;
            maxTenders: number;
            change: boolean;
            changeTenderTypes: string[];
          };
          receipts: {
            receiptNumber: boolean;
            invoiceDocument: boolean;
            browserPrint: boolean;
            devicePrinting: boolean;
            externalDelivery: boolean;
          };
        };
      }>().capabilities
    ).toMatchObject({
      cart: { multiLine: true, maxLines: 100, quantityDecimals: 6 },
      tenders: { split: true, maxTenders: 10, change: true, changeTenderTypes: ["CASH"] },
      receipts: {
        receiptNumber: true,
        invoiceDocument: true,
        browserPrint: true,
        devicePrinting: false,
        externalDelivery: false
      }
    });
  });

  it("posts a multi-line sale with split cash and manual tenders", async () => {
    const f = await fixture();
    const register = await api("POST", "/v1/pos/registers", f.organizationId, f.companyId, {
      companyId: f.companyId,
      inventoryLocationId: f.location,
      cashAccountId: f.cash,
      code: "R-SPLIT",
      name: "Split tender counter"
    });
    expect(register.statusCode, register.body).toBe(201);
    const registerId = register.json<{ register: { id: string } }>().register.id;
    const shift = await api("POST", "/v1/pos/shifts/open", f.organizationId, f.companyId, {
      registerId,
      businessDate: "2026-08-07",
      openingFloatMinor: "0"
    });
    expect(shift.statusCode, shift.body).toBe(201);
    const shiftId = shift.json<{ shift: { id: string } }>().shift.id;
    const payload = {
      registerId,
      shiftId,
      businessDate: "2026-08-07",
      lines: [
        { productItemId: f.product, quantity: "1", unitPriceMinor: "100" },
        { productItemId: f.product, quantity: "1", unitPriceMinor: "100" }
      ],
      tenders: [
        { type: "CASH", amountReceivedMinor: "100" },
        { type: "MANUAL", amountReceivedMinor: "100", reference: "gift-card-100" }
      ]
    } as const;
    const sale = await api(
      "POST",
      "/v1/pos/sales",
      f.organizationId,
      f.companyId,
      payload,
      randomUUID()
    );
    expect(sale.statusCode, sale.body).toBe(201);
    expect(
      sale.json<{
        sale: {
          grandTotalMinor: string;
          lines: unknown[];
          tenders: { type: string; appliedAmountMinor: string; changeMinor: string }[];
        };
      }>().sale
    ).toMatchObject({
      grandTotalMinor: "200",
      lines: [{}, {}],
      tenders: [
        { type: "CASH", appliedAmountMinor: "100", changeMinor: "0" },
        { type: "MANUAL", appliedAmountMinor: "100", changeMinor: "0" }
      ]
    });
    expect(
      await prisma.posCashEvent.count({
        where: { organizationId: f.organizationId, shiftId, eventType: "SALE" }
      })
    ).toBe(1);
    const manualOverpay = await api(
      "POST",
      "/v1/pos/sales",
      f.organizationId,
      f.companyId,
      {
        registerId,
        shiftId,
        businessDate: "2026-08-07",
        lines: [{ productItemId: f.product, quantity: "1", unitPriceMinor: "100" }],
        tenders: [{ type: "MANUAL", amountReceivedMinor: "150", reference: "manual-overpay" }]
      },
      randomUUID()
    );
    expect(manualOverpay.statusCode, manualOverpay.body).toBe(422);
    expect(manualOverpay.json<{ error: { code: string } }>().error.code).toBe(
      "POS_CHANGE_CASH_ONLY"
    );
  });

  it("previews, posts idempotently, and reconciles a cash sale", async () => {
    const f = await fixture();
    const register = await api("POST", "/v1/pos/registers", f.organizationId, f.companyId, {
      companyId: f.companyId,
      inventoryLocationId: f.location,
      cashAccountId: f.cash,
      code: "R1",
      name: "Front counter"
    });
    expect(register.statusCode, register.body).toBe(201);
    const registerId = register.json<{ register: { id: string } }>().register.id;
    const shift = await api("POST", "/v1/pos/shifts/open", f.organizationId, f.companyId, {
      registerId,
      businessDate: "2026-08-07",
      openingFloatMinor: "0"
    });
    expect(shift.statusCode, shift.body).toBe(201);
    const shiftId = shift.json<{ shift: { id: string } }>().shift.id;
    const preview = await api("POST", "/v1/pos/preview", f.organizationId, f.companyId, {
      registerId,
      shiftId,
      businessDate: "2026-08-07",
      lines: [{ productItemId: f.product, quantity: "1", unitPriceMinor: "100" }]
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<{ totals: { grandTotalMinor: string } }>().totals.grandTotalMinor).toBe(
      "100"
    );
    const key = randomUUID();
    const salePayload = {
      registerId,
      shiftId,
      businessDate: "2026-08-07",
      lines: [{ productItemId: f.product, quantity: "1", unitPriceMinor: "100" }],
      tenders: [{ type: "CASH", amountReceivedMinor: "150" }]
    };
    const sale = await api(
      "POST",
      "/v1/pos/sales",
      f.organizationId,
      f.companyId,
      salePayload,
      key
    );
    expect(sale.statusCode, sale.body).toBe(201);
    const first = sale.json<{
      sale: { id: string; status: string; grandTotalMinor: string; invoiceId: string };
    }>().sale;
    expect(first.status).toBe("COMPLETED");
    expect(first.grandTotalMinor).toBe("100");
    const retry = await api(
      "POST",
      "/v1/pos/sales",
      f.organizationId,
      f.companyId,
      salePayload,
      key
    );
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json<{ sale: { id: string } }>().sale.id).toBe(first.id);
    const saleView = await api("GET", `/v1/pos/sales/${first.id}`, f.organizationId, f.companyId);
    expect(saleView.statusCode, saleView.body).toBe(200);
    const saleLineId = saleView.json<{ sale: { lines: { id: string }[] } }>().sale.lines[0]?.id;
    expect(saleLineId).toBeTruthy();
    const returnPayload = {
      returnDate: "2026-08-07",
      reason: "Customer return",
      refund: true,
      lines: [{ saleLineId }]
    };
    const returnKey = randomUUID();
    const returned = await api(
      "POST",
      `/v1/pos/sales/${first.id}/returns`,
      f.organizationId,
      f.companyId,
      returnPayload,
      returnKey
    );
    expect(returned.statusCode, returned.body).toBe(201);
    const completedReturn = returned.json<{
      return: { id: string; status: string; totalMinor: string };
    }>().return;
    expect(completedReturn).toMatchObject({ status: "COMPLETED", totalMinor: "100" });
    const returnRetry = await api(
      "POST",
      `/v1/pos/sales/${first.id}/returns`,
      f.organizationId,
      f.companyId,
      returnPayload,
      returnKey
    );
    expect(returnRetry.statusCode, returnRetry.body).toBe(201);
    expect(returnRetry.json<{ return: { id: string } }>().return.id).toBe(completedReturn.id);
    const returnMismatch = await api(
      "POST",
      `/v1/pos/sales/${first.id}/returns`,
      f.organizationId,
      f.companyId,
      { ...returnPayload, reason: "Different reason" },
      returnKey
    );
    expect(returnMismatch.statusCode, returnMismatch.body).toBe(409);
    expect(
      await prisma.posCashEvent.count({
        where: { organizationId: f.organizationId, saleId: first.id, eventType: "REFUND" }
      })
    ).toBe(1);
    const close = await api(
      "POST",
      `/v1/pos/shifts/${shiftId}/close`,
      f.organizationId,
      f.companyId,
      { countedCashMinor: "0" }
    );
    expect(close.statusCode, close.body).toBe(200);
    expect(close.json<{ shift: { status: string; varianceMinor: string } }>().shift).toMatchObject({
      status: "CLOSED",
      varianceMinor: "0"
    });
    const reconciliation = await api(
      "GET",
      `/v1/pos/shifts/${shiftId}/reconciliation`,
      f.organizationId,
      f.companyId
    );
    expect(reconciliation.statusCode).toBe(200);
    expect(
      reconciliation.json<{ completedSales: number; salesTotalMinor: string }>().completedSales
    ).toBe(1);
    expect(
      reconciliation.json<{ completedSales: number; salesTotalMinor: string }>().salesTotalMinor
    ).toBe("100");
  });

  it("records a cash refund from an open compatible shift after the original shift closes", async () => {
    const f = await fixture();
    const register = await api("POST", "/v1/pos/registers", f.organizationId, f.companyId, {
      companyId: f.companyId,
      inventoryLocationId: f.location,
      cashAccountId: f.cash,
      code: "R2",
      name: "Returns counter"
    });
    expect(register.statusCode, register.body).toBe(201);
    const registerId = register.json<{ register: { id: string } }>().register.id;
    const originalShift = await api("POST", "/v1/pos/shifts/open", f.organizationId, f.companyId, {
      registerId,
      businessDate: "2026-08-07",
      openingFloatMinor: "0"
    });
    expect(originalShift.statusCode, originalShift.body).toBe(201);
    const originalShiftId = originalShift.json<{ shift: { id: string } }>().shift.id;
    const salePayload = {
      registerId,
      shiftId: originalShiftId,
      businessDate: "2026-08-07",
      lines: [{ productItemId: f.product, quantity: "1", unitPriceMinor: "100" }],
      tenders: [{ type: "CASH", amountReceivedMinor: "100" }]
    };
    const sale = await api(
      "POST",
      "/v1/pos/sales",
      f.organizationId,
      f.companyId,
      salePayload,
      randomUUID()
    );
    expect(sale.statusCode, sale.body).toBe(201);
    const saleId = sale.json<{ sale: { id: string } }>().sale.id;
    const saleView = await api("GET", `/v1/pos/sales/${saleId}`, f.organizationId, f.companyId);
    expect(saleView.statusCode, saleView.body).toBe(200);
    const saleLineId = saleView.json<{ sale: { lines: { id: string }[] } }>().sale.lines[0]?.id;
    expect(saleLineId).toBeTruthy();
    const originalClose = await api(
      "POST",
      `/v1/pos/shifts/${originalShiftId}/close`,
      f.organizationId,
      f.companyId,
      { countedCashMinor: "100" }
    );
    expect(originalClose.statusCode, originalClose.body).toBe(200);
    const originalOpeningFloat = await prisma.posCashEvent.findFirstOrThrow({
      where: {
        organizationId: f.organizationId,
        shiftId: originalShiftId,
        eventType: "OPENING_FLOAT"
      }
    });
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    await expect(
      prisma.posCashEvent.create({
        data: {
          organizationId: f.organizationId,
          companyId: f.companyId,
          shiftId: originalShiftId,
          saleId,
          eventType: "REFUND",
          amountMinor: -100n,
          reason: "Attempted late cash refund",
          createdByUserId: ownerUser.id
        }
      })
    ).rejects.toThrow(/open shift/i);
    await expect(
      prisma.posCashEvent.update({
        where: { id: originalOpeningFloat.id },
        data: { reason: "Attempted history edit" }
      })
    ).rejects.toThrow(/append-only/i);

    const noOpenShiftReturn = await api(
      "POST",
      `/v1/pos/sales/${saleId}/returns`,
      f.organizationId,
      f.companyId,
      {
        returnDate: "2026-08-08",
        reason: "Return after cash close",
        refund: true,
        lines: [{ saleLineId }]
      },
      randomUUID()
    );
    expect(noOpenShiftReturn.statusCode, noOpenShiftReturn.body).toBe(409);
    expect(noOpenShiftReturn.json<{ error: { code: string } }>().error.code).toBe(
      "POS_REFUND_SHIFT_REQUIRED"
    );
    expect(await prisma.posReturn.count({ where: { saleId } })).toBe(0);

    const refundShift = await api("POST", "/v1/pos/shifts/open", f.organizationId, f.companyId, {
      registerId,
      businessDate: "2026-08-08",
      openingFloatMinor: "200"
    });
    expect(refundShift.statusCode, refundShift.body).toBe(201);
    const refundShiftId = refundShift.json<{ shift: { id: string } }>().shift.id;
    const returned = await api(
      "POST",
      `/v1/pos/sales/${saleId}/returns`,
      f.organizationId,
      f.companyId,
      {
        returnDate: "2026-08-08",
        reason: "Return after cash close",
        refund: true,
        refundShiftId,
        lines: [{ saleLineId }]
      },
      randomUUID()
    );
    expect(returned.statusCode, returned.body).toBe(201);
    expect(returned.json<{ return: { refundShiftId: string | null } }>().return.refundShiftId).toBe(
      refundShiftId
    );
    expect(
      await prisma.posCashEvent.count({
        where: {
          organizationId: f.organizationId,
          saleId,
          shiftId: refundShiftId,
          eventType: "REFUND",
          amountMinor: -100n
        }
      })
    ).toBe(1);
    expect(
      await prisma.posCashEvent.count({
        where: {
          organizationId: f.organizationId,
          saleId,
          shiftId: originalShiftId,
          eventType: "REFUND"
        }
      })
    ).toBe(0);
    const refundClose = await api(
      "POST",
      `/v1/pos/shifts/${refundShiftId}/close`,
      f.organizationId,
      f.companyId,
      { countedCashMinor: "100" }
    );
    expect(refundClose.statusCode, refundClose.body).toBe(200);
  });
});
