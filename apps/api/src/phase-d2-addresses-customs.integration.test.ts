import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase-d2-owner@example.test";

function headers(organizationId?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": owner,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function createOrganization() {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "D2 Address Ltd", displayName: "D2 Address" }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configureOrganization(organizationId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/setup/presets/general-service/apply",
    headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
    payload: {}
  });
  expect(response.statusCode, response.body).toBe(201);
}

describe("D2 structured addresses and customs attributes", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });

  beforeEach(async () => resetDatabase(prisma));

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("persists role-aware addresses, rejects malformed forms, reports customs gaps, and imports addresses", async () => {
    const organizationId = await createOrganization();
    await configureOrganization(organizationId);

    const created = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "C-D2-001",
        displayName: "Structured Customer",
        addresses: [
          {
            role: "BILLING",
            line1: "100 Billing Way",
            city: "Calgary",
            subdivisionCode: "CA-AB",
            postalCode: "T2P 1J9",
            countryCode: "CA",
            isDefault: true
          },
          {
            role: "SHIPPING",
            line1: "200 Shipping Avenue",
            city: "Seattle",
            subdivisionCode: "US-WA",
            postalCode: "98101-1234",
            countryCode: "US"
          },
          {
            role: "SERVICE",
            line1: "300 Service Road",
            city: "Edmonton",
            subdivisionCode: "AB",
            postalCode: "T5J 0N3",
            countryCode: "CA"
          }
        ]
      }
    });
    expect(created.statusCode, created.body).toBe(201);
    const customer = created.json<{
      customer: {
        id: string;
        addresses: Array<{ role: string; subdivisionCode: string; countryCode: string }>;
        billingAddress: { country: string };
        shippingAddress: { country: string };
      };
    }>().customer;
    expect(customer.addresses.map((address) => address.role)).toEqual([
      "BILLING",
      "SHIPPING",
      "SERVICE"
    ]);
    expect(customer.addresses.find((address) => address.role === "SERVICE")?.subdivisionCode).toBe(
      "CA-AB"
    );
    expect(customer.billingAddress.country).toBe("CA");
    expect(customer.shippingAddress.country).toBe("US");
    expect(
      await prisma.customerAddress.count({
        where: { organizationId, customerId: customer.id }
      })
    ).toBe(3);

    await prisma.customerAddress.create({
      data: {
        organizationId,
        customerId: customer.id,
        role: "BILLING",
        needsReview: true,
        legacyValue: {
          line1: "Legacy value requiring review",
          city: "Calgary",
          postalCode: "90210",
          country: "CA"
        }
      }
    });
    const addressReview = await app.inject({
      method: "GET",
      url: "/v1/customers/reports/address-review",
      headers: headers(organizationId)
    });
    expect(addressReview.statusCode, addressReview.body).toBe(200);
    expect(
      addressReview
        .json<{
          addresses: Array<{
            customer: { customerNumber: string };
            address: { needsReview: boolean };
          }>;
        }>()
        .addresses.some(
          (entry) => entry.customer.customerNumber === "C-D2-001" && entry.address.needsReview
        )
    ).toBe(true);

    const malformed = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "C-D2-BAD",
        displayName: "Malformed Address",
        addresses: [
          {
            role: "BILLING",
            line1: "400 Bad Postal Street",
            city: "Calgary",
            subdivisionCode: "CA-AB",
            postalCode: "90210",
            countryCode: "CA"
          }
        ]
      }
    });
    expect(malformed.statusCode).toBe(400);
    const malformedBody = malformed.json<{
      error: { code: string; details: { issues: Array<{ path: unknown[] }> } };
    }>();
    expect(malformedBody.error.code).toBe("VALIDATION_ERROR");
    expect(malformedBody.error.details.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ["addresses", 0, "postalCode"] })])
    );

    const accounts = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: headers(organizationId)
    });
    const incomeAccount = accounts
      .json<{ accounts: Array<{ id: string; type: string; isControl: boolean }> }>()
      .accounts.find((account) => account.type === "REVENUE" && !account.isControl);
    expect(incomeAccount).toBeDefined();

    const product = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: headers(organizationId),
      payload: {
        sku: "D2-SERVICE-001",
        name: "D2 Reference Product",
        itemType: "SERVICE",
        salesPriceMinor: "1000",
        incomeAccountId: incomeAccount!.id,
        hsTariffCode: "610910"
      }
    });
    expect(product.statusCode, product.body).toBe(201);

    const customs = await app.inject({
      method: "GET",
      url: "/v1/inventory/reports/customs-readiness",
      headers: headers(organizationId)
    });
    expect(customs.statusCode, customs.body).toBe(200);
    expect(
      customs.json<{ products: Array<{ sku: string; missingCountryOfOrigin: boolean }> }>().products
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: "D2-SERVICE-001", missingCountryOfOrigin: true })
      ])
    );

    const imported = await app.inject({
      method: "POST",
      url: "/v1/imports/upload?importType=CUSTOMERS",
      headers: {
        ...headers(organizationId),
        "content-type": "text/csv",
        "x-file-name": "d2-addresses.csv"
      },
      payload: Buffer.from(
        "customer_number,display_name,billing_address_line1,billing_address_city,billing_address_subdivision_code,billing_address_postal_code,billing_address_country_code\n" +
          "C-D2-IMPORT,Imported Customer,1 Import Way,Calgary,CA-AB,T2P 1J9,CA\n"
      )
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const batchId = imported.json<{ batch: { id: string } }>().batch.id;

    const preview = await app.inject({
      method: "POST",
      url: `/v1/imports/${batchId}/preview`,
      headers: headers(organizationId),
      payload: { mapping: {} }
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(
      preview.json<{ batch: { rows: Array<{ status: string }> } }>().batch.rows[0]?.status
    ).toBe("VALID");

    const dryRun = await app.inject({
      method: "POST",
      url: `/v1/imports/${batchId}/dry-run`,
      headers: headers(organizationId)
    });
    expect(dryRun.statusCode, dryRun.body).toBe(200);

    const committed = await app.inject({
      method: "POST",
      url: `/v1/imports/${batchId}/commit`,
      headers: headers(organizationId)
    });
    expect(committed.statusCode, committed.body).toBe(200);
    expect(
      await prisma.customerAddress.count({
        where: {
          organizationId,
          customer: { customerNumber: "C-D2-IMPORT" },
          role: "BILLING",
          countryCode: "CA"
        }
      })
    ).toBe(1);
  });
});
