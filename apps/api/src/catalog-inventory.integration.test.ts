import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { IdentityAdapter } from "./auth/identity-adapter.js";
import { requestHeader } from "./auth/identity-adapter.js";
import type { ConnectorAdapter } from "./services/connector-runtime-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const adapter: ConnectorAdapter = {
  providerKey: "FIXTURE",
  validateCredentials: () => Promise.resolve(),
  checkHealth: () => Promise.resolve("HEALTHY")
};
const owner = "catalog-inventory-owner@example.test";
let identityUserId = "";
const identityAdapter: IdentityAdapter = {
  kind: "DEVELOPMENT",
  authenticate: (request) =>
    Promise.resolve({
      id: identityUserId,
      email: owner,
      displayName: "Catalog Inventory Owner",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      sessionId: null,
      activeOrganizationId: requestHeader(request, "x-clearledger-organization-id")?.trim() ?? null,
      recentAuthAt: new Date(),
      mfaAuthenticated: true,
      authenticationMethod: "DEVELOPMENT"
    })
};
const app = buildApp({ prisma, connectorAdapters: [adapter], identityAdapter });
const headers = (organizationId?: string) => ({
  "x-clearledger-user-email": owner,
  "x-clearledger-user-name": "Catalog Inventory Owner",
  ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
});

describe("catalog and inventory automation integration", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    identityUserId = (
      await prisma.user.create({
        data: {
          email: owner,
          displayName: "Catalog Inventory Owner",
          emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
        }
      })
    ).id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("isolates tenants, resolves concurrent mapping confirmation, and creates zero journals", async () => {
    const organizationId = await organization("Catalog Fixture Ltd");
    const locationId = await location(organizationId);
    const accounts = {
      incomeAccountId: await account(organizationId, "4900", "REVENUE"),
      inventoryAssetAccountId: await account(organizationId, "1400", "ASSET"),
      costOfGoodsSoldAccountId: await account(organizationId, "5000", "EXPENSE"),
      purchaseClearingAccountId: await account(organizationId, "1410", "ASSET"),
      adjustmentGainAccountId: await account(organizationId, "4910", "REVENUE"),
      inventoryLossAccountId: await account(organizationId, "5100", "EXPENSE")
    };
    const firstProductId = await product(
      organizationId,
      accounts,
      locationId,
      "SKU-EXACT",
      "Blue trail shoe"
    );
    const descriptionProductId = await product(
      organizationId,
      accounts,
      locationId,
      "SKU-OTHER",
      "Unrelated local label",
      "Waterproof leather trail footwear with brass speed hooks"
    );
    const installationId = await connector(organizationId);
    const ingested = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${installationId}/catalog/ingest`,
      headers: headers(organizationId),
      payload: {
        externalProductId: "product-91",
        name: "Blue trail shoe",
        description: "Waterproof leather trail boot with brass speed hooks",
        sourceStatus: "active",
        variants: [
          {
            externalVariantId: "variant-9101",
            name: "Blue trail shoe",
            sku: "SKU-EXACT",
            variantSignature: { Colour: "Blue" }
          }
        ]
      }
    });
    expect(ingested.statusCode, ingested.body).toBe(201);
    expect(
      ingested.json<{
        accountingEntriesCreated: number;
        candidateSuggestions: {
          evaluatedVariantIds: string[];
          deferredVariantIds: string[];
          candidateCount: number;
        };
      }>().accountingEntriesCreated
    ).toBe(0);
    const catalogVariantId = ingested.json<{ catalog: { variants: Array<{ id: string }> } }>()
      .catalog.variants[0]!.id;
    const automaticSuggestions = ingested.json<{
      candidateSuggestions: {
        evaluatedVariantIds: string[];
        deferredVariantIds: string[];
        candidateCount: number;
      };
    }>().candidateSuggestions;
    expect(automaticSuggestions).toMatchObject({
      evaluatedVariantIds: [catalogVariantId],
      deferredVariantIds: []
    });
    expect(automaticSuggestions.candidateCount).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.catalogMatchCandidate.count({ where: { organizationId, catalogVariantId } })
    ).toBeGreaterThanOrEqual(2);
    const suggested = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/catalog/variants/${catalogVariantId}/candidates`,
      headers: headers(organizationId),
      payload: { limit: 10 }
    });
    expect(suggested.statusCode, suggested.body).toBe(200);
    const candidates = suggested.json<{
      candidates: Array<{
        id: string;
        version: number;
        score: number;
        productItemId: string;
        reason: {
          version: number;
          matches: string[];
          skuSimilarityBasisPoints: number | null;
          nameSimilarityBasisPoints: number | null;
          descriptionSimilarityBasisPoints: number | null;
          compositeSimilarityBasisPoints: number;
          autoConfirmEligible: boolean;
        };
      }>;
    }>().candidates;
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.every((candidate) => !candidate.reason.autoConfirmEligible)).toBe(true);
    expect(candidates.map((candidate) => candidate.productItemId)).toEqual(
      [...candidates]
        .sort(
          (left, right) =>
            right.score - left.score || left.productItemId.localeCompare(right.productItemId)
        )
        .map((candidate) => candidate.productItemId)
    );
    const exactCandidate = candidates.find(
      (candidate) => candidate.productItemId === firstProductId
    );
    const descriptionCandidate = candidates.find(
      (candidate) => candidate.productItemId === descriptionProductId
    );
    expect(exactCandidate?.reason.version).toBe(2);
    expect(exactCandidate?.reason.matches).toContain("NORMALIZED_SKU");
    expect(exactCandidate?.reason.skuSimilarityBasisPoints).toBe(10_000);
    expect(exactCandidate?.reason.autoConfirmEligible).toBe(false);
    expect(descriptionCandidate?.reason.version).toBe(2);
    expect(descriptionCandidate?.reason.matches).toContain("DESCRIPTION_SIMILARITY");
    expect(descriptionCandidate?.reason.autoConfirmEligible).toBe(false);
    expect(descriptionCandidate?.reason.descriptionSimilarityBasisPoints ?? 0).toBeGreaterThan(0);
    expect(exactCandidate?.score ?? 0).toBeGreaterThan(descriptionCandidate?.score ?? 0);
    const createdLocal = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/catalog/variants/${catalogVariantId}/create-local-product`,
      headers: headers(organizationId),
      payload: {
        sku: "SKU-CREATED-FROM-OBSERVATION",
        name: "Reviewed trail boot",
        description: "Waterproof leather trail boot with brass speed hooks",
        itemType: "INVENTORY_PRODUCT",
        salesPriceMinor: "1000",
        ...accounts,
        defaultLocationId: locationId
      }
    });
    expect(createdLocal.statusCode, createdLocal.body).toBe(201);
    const createdLocalProductId = createdLocal.json<{ product: { id: string } }>().product.id;
    const createdLocalCandidate = await prisma.catalogMatchCandidate.findFirstOrThrow({
      where: { organizationId, catalogVariantId, productItemId: createdLocalProductId }
    });
    if (
      !createdLocalCandidate.reason ||
      typeof createdLocalCandidate.reason !== "object" ||
      Array.isArray(createdLocalCandidate.reason)
    )
      throw new Error("Expected a canonical catalog-match reason object.");
    const createdReason = createdLocalCandidate.reason as Record<string, unknown>;
    expect(createdReason.version).toBe(2);
    expect(createdReason.matches).toEqual(expect.arrayContaining(["DESCRIPTION_SIMILARITY"]));
    expect(typeof createdReason.skuSimilarityBasisPoints).toBe("number");
    expect(typeof createdReason.nameSimilarityBasisPoints).toBe("number");
    expect(createdReason.descriptionSimilarityBasisPoints).toBe(10_000);
    expect(typeof createdReason.compositeSimilarityBasisPoints).toBe("number");
    expect(createdReason.autoConfirmEligible).toBe(false);
    const attempts = await Promise.all(
      candidates.slice(0, 2).map((candidate) =>
        app.inject({
          method: "POST",
          url: `/v1/organizations/current/catalog/candidates/${candidate.id}/confirm`,
          headers: headers(organizationId),
          payload: { version: candidate.version, reason: "Explicit fixture decision" }
        })
      )
    );
    expect(
      attempts.map((response) => response.statusCode).sort(),
      attempts.map((response) => response.body).join("\n")
    ).toEqual([200, 409]);
    const confirmed = await prisma.catalogMatchCandidate.findFirstOrThrow({
      where: { organizationId, catalogVariantId, status: "CONFIRMED" }
    });
    expect([firstProductId, ...candidates.map((candidate) => candidate.productItemId)]).toContain(
      confirmed.productItemId
    );
    const connectorAfterConfirmation = await prisma.connectorInstallation.findUniqueOrThrow({
      where: { id: installationId }
    });
    expect(connectorAfterConfirmation.mapping).toMatchObject({
      catalogVariantMappings: { "variant-9101": confirmed.productItemId },
      catalogProductMappings: { "product-91": confirmed.productItemId },
      catalogSkuMappings: { "SKU-EXACT": confirmed.productItemId }
    });
    const policy = await app.inject({
      method: "PUT",
      url: "/v1/organizations/current/inventory-sync/policies",
      headers: headers(organizationId),
      payload: {
        installationId,
        catalogVariantId,
        productItemId: confirmed.productItemId,
        locationId,
        sourceOfTruth: "MANUAL_REVIEW",
        desiredQuantityMicros: "0",
        enabled: false
      }
    });
    expect(policy.statusCode, policy.body).toBe(200);
    const policyId = policy.json<{ policy: { id: string } }>().policy.id;
    const observation = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/inventory-sync/policies/${policyId}/observations`,
      headers: headers(organizationId),
      payload: {
        externalObservationId: "fixture-observation-1",
        observedQuantityMicros: "5000000",
        desiredQuantityMicros: "0"
      }
    });
    expect(observation.statusCode, observation.body).toBe(201);
    const conflict = observation.json<{
      conflict: { id: string; version: number; status: string };
    }>().conflict;
    expect(conflict.status).toBe("OPEN");
    const ignored = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/inventory-sync/conflicts/${conflict.id}/resolve`,
      headers: headers(organizationId),
      payload: { action: "IGNORE", version: conflict.version, reason: "Fixture review" }
    });
    expect(ignored.statusCode, ignored.body).toBe(200);
    expect(ignored.json<{ conflict: { status: string } }>().conflict.status).toBe("IGNORED");

    const otherOrganizationId = await organization("Other Catalog Tenant Ltd");
    const isolated = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/catalog",
      headers: headers(otherOrganizationId)
    });
    expect(isolated.statusCode, isolated.body).toBe(200);
    expect(isolated.json<{ products: unknown[] }>().products).toEqual([]);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { organizationId } })).toBe(0);
  });

  it("bulk-creates reviewed channel products with verified media without creating stock, then confirms only on an explicit decision", async () => {
    const organizationId = await organization("Bulk Catalog Onboarding Ltd");
    const locationId = await location(organizationId);
    const accounts = {
      incomeAccountId: await account(organizationId, "4940", "REVENUE"),
      inventoryAssetAccountId: await account(organizationId, "1440", "ASSET"),
      costOfGoodsSoldAccountId: await account(organizationId, "5040", "EXPENSE"),
      purchaseClearingAccountId: await account(organizationId, "1450", "ASSET"),
      adjustmentGainAccountId: await account(organizationId, "4950", "REVENUE"),
      inventoryLossAccountId: await account(organizationId, "5140", "EXPENSE")
    };
    const installationId = await connector(organizationId);
    const ingested = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${installationId}/catalog/ingest`,
      headers: headers(organizationId),
      payload: {
        externalProductId: "woo-bulk-product",
        name: "Source ceramic mug",
        description: "Hand-finished stoneware mug from the reviewed WooCommerce catalog.",
        images: [
          {
            externalImageId: "woo-bulk-image",
            remoteUrl: "https://cdn.example.test/catalog/ceramic-mug.jpg",
            contentTypeHint: "image/jpeg",
            width: 1200,
            height: 1200
          }
        ],
        variants: [
          {
            externalVariantId: "woo-bulk-blue",
            name: "Source ceramic mug - blue",
            sku: "WOO-BULK-BLUE",
            observedQuantityMicros: "3000000"
          },
          {
            externalVariantId: "woo-bulk-green",
            name: "Source ceramic mug - green",
            sku: "WOO-BULK-GREEN",
            observedQuantityMicros: "7000000"
          }
        ]
      }
    });
    expect(ingested.statusCode, ingested.body).toBe(201);
    const catalog = ingested.json<{
      catalog: { id: string; variants: Array<{ id: string }> };
    }>().catalog;
    await prisma.catalogImageReference.updateMany({
      where: { organizationId, catalogProductId: catalog.id },
      data: { status: "INGESTED" }
    });
    const catalogVariantIds = catalog.variants.map((variant) => variant.id);
    const create = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/catalog/bulk-create-local-products",
      headers: headers(organizationId),
      payload: {
        catalogVariantIds,
        itemType: "INVENTORY_PRODUCT",
        salesPriceMinor: "2599",
        ...accounts,
        defaultLocationId: locationId,
        reorderPointMicros: "2000000",
        unitOfMeasure: "each",
        attachFirstIngestedImage: true,
        confirmMappings: false
      }
    });
    expect(create.statusCode, create.body).toBe(200);
    const created = create.json<{
      accountingEntriesCreated: number;
      bulkCreate: {
        summary: Record<string, number>;
        inventoryMovementsCreated: number;
        results: Array<{
          catalogVariantId: string;
          status: string;
          mappingStatus: string;
          imageAttached: boolean;
        }>;
      };
    }>();
    expect(created.accountingEntriesCreated).toBe(0);
    expect(created.bulkCreate.inventoryMovementsCreated).toBe(0);
    expect(created.bulkCreate.summary).toMatchObject({
      created: 2,
      reviewRequired: 0,
      alreadyCreated: 0,
      alreadyMapped: 0,
      notCreated: 0
    });
    expect(created.bulkCreate.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "CREATED",
          mappingStatus: "SUGGESTED",
          imageAttached: true
        })
      ])
    );
    const createdProducts = await prisma.productItem.findMany({
      where: { organizationId, sku: { in: ["WOO-BULK-BLUE", "WOO-BULK-GREEN"] } },
      orderBy: { sku: "asc" }
    });
    expect(createdProducts).toHaveLength(2);
    expect(
      createdProducts.every((product) => product.productImageReference?.startsWith("https://"))
    ).toBe(true);
    expect(
      createdProducts.every((product) => product.description?.includes("reviewed WooCommerce"))
    ).toBe(true);
    expect(await prisma.inventoryMovement.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.inventoryBalance.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);

    const retryWithExplicitApproval = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/catalog/bulk-create-local-products",
      headers: headers(organizationId),
      payload: {
        catalogVariantIds,
        itemType: "INVENTORY_PRODUCT",
        salesPriceMinor: "2599",
        ...accounts,
        defaultLocationId: locationId,
        unitOfMeasure: "each",
        attachFirstIngestedImage: true,
        confirmMappings: true
      }
    });
    expect(retryWithExplicitApproval.statusCode, retryWithExplicitApproval.body).toBe(200);
    expect(
      retryWithExplicitApproval.json<{ bulkCreate: { summary: Record<string, number> } }>()
        .bulkCreate.summary
    ).toMatchObject({ created: 0, alreadyCreated: 2, notCreated: 0 });
    expect(
      await prisma.catalogMatchCandidate.count({
        where: { organizationId, catalogVariantId: { in: catalogVariantIds }, status: "CONFIRMED" }
      })
    ).toBe(2);
    expect(
      await prisma.productItem.count({
        where: { organizationId, sku: { in: ["WOO-BULK-BLUE", "WOO-BULK-GREEN"] } }
      })
    ).toBe(2);
    expect(await prisma.inventoryMovement.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("persists a review conflict instead of overwriting an existing connector SKU mapping", async () => {
    const organizationId = await organization("Catalog Mapping Conflict Ltd");
    const locationId = await location(organizationId);
    const accounts = {
      incomeAccountId: await account(organizationId, "4920", "REVENUE"),
      inventoryAssetAccountId: await account(organizationId, "1420", "ASSET"),
      costOfGoodsSoldAccountId: await account(organizationId, "5020", "EXPENSE"),
      purchaseClearingAccountId: await account(organizationId, "1430", "ASSET"),
      adjustmentGainAccountId: await account(organizationId, "4930", "REVENUE"),
      inventoryLossAccountId: await account(organizationId, "5120", "EXPENSE")
    };
    const existingMappedProductId = await product(
      organizationId,
      accounts,
      locationId,
      "MANUAL-TARGET",
      "Existing manual target"
    );
    const requestedProductId = await product(
      organizationId,
      accounts,
      locationId,
      "SKU-CONFLICT",
      "New exact catalog target"
    );
    const installationId = await connector(organizationId, {
      skuMappings: { "SKU-CONFLICT": existingMappedProductId }
    });
    const ingested = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${installationId}/catalog/ingest`,
      headers: headers(organizationId),
      payload: {
        externalProductId: "product-conflict",
        name: "New exact catalog target",
        variants: [
          {
            externalVariantId: "variant-conflict",
            name: "New exact catalog target",
            sku: "SKU-CONFLICT"
          }
        ]
      }
    });
    expect(ingested.statusCode, ingested.body).toBe(201);
    const catalogVariantId = ingested.json<{
      catalog: { variants: Array<{ id: string }> };
    }>().catalog.variants[0]!.id;
    const candidate = await prisma.catalogMatchCandidate.findFirstOrThrow({
      where: { organizationId, catalogVariantId, productItemId: requestedProductId }
    });

    const confirmation = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/catalog/candidates/${candidate.id}/confirm`,
      headers: headers(organizationId),
      payload: { version: candidate.version, reason: "Should remain reviewable" }
    });
    expect(confirmation.statusCode, confirmation.body).toBe(409);
    const conflictError = confirmation.json<{
      error: { code: string; details: { conflictId: string } };
    }>().error;
    expect(conflictError.code).toBe("CATALOG_ITEM_MAPPING_CONFLICT");
    expect(typeof conflictError.details.conflictId).toBe("string");
    expect(
      await prisma.catalogMatchCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).toMatchObject({ status: "SUGGESTED", version: candidate.version });
    expect(
      await prisma.connectorInstallation.findUniqueOrThrow({ where: { id: installationId } })
    ).toMatchObject({
      mapping: { skuMappings: { "SKU-CONFLICT": existingMappedProductId } }
    });
    expect(
      await prisma.connectorConflict.findFirstOrThrow({
        where: {
          organizationId,
          installationId,
          externalRef: "SKU-CONFLICT",
          kind: "CATALOG_SKU_MAPPING_CONFLICT"
        }
      })
    ).toMatchObject({ status: "OPEN" });

    const noSkuInstallationId = await connector(organizationId);
    const noSkuIngest = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${noSkuInstallationId}/catalog/ingest`,
      headers: headers(organizationId),
      payload: {
        externalProductId: "etsy-listing-no-sku",
        name: "New exact catalog target",
        variants: [
          {
            externalVariantId: "etsy-offering-no-sku",
            externalReferenceAliases: ["etsy-order-product-no-sku"],
            name: "New exact catalog target"
          }
        ]
      }
    });
    expect(noSkuIngest.statusCode, noSkuIngest.body).toBe(201);
    const noSkuVariantId = noSkuIngest.json<{
      catalog: { variants: Array<{ id: string }> };
    }>().catalog.variants[0]!.id;
    const noSkuCandidate = await prisma.catalogMatchCandidate.findFirstOrThrow({
      where: { organizationId, catalogVariantId: noSkuVariantId, productItemId: requestedProductId }
    });
    const noSkuConfirmation = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/catalog/candidates/${noSkuCandidate.id}/confirm`,
      headers: headers(organizationId),
      payload: { version: noSkuCandidate.version, reason: "Confirmed provider identity" }
    });
    expect(noSkuConfirmation.statusCode, noSkuConfirmation.body).toBe(200);
    expect(
      await prisma.connectorInstallation.findUniqueOrThrow({ where: { id: noSkuInstallationId } })
    ).toMatchObject({
      mapping: {
        catalogVariantMappings: {
          "etsy-offering-no-sku": requestedProductId,
          "etsy-order-product-no-sku": requestedProductId
        },
        catalogProductMappings: { "etsy-listing-no-sku": requestedProductId }
      }
    });
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });
});

async function organization(legalName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName, displayName: legalName }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function account(
  organizationId: string,
  code: string,
  type: "ASSET" | "EXPENSE" | "REVENUE"
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    headers: headers(organizationId),
    payload: { code, name: `Catalog ${code}`, type, isControl: false }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

async function location(organizationId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/inventory/locations",
    headers: headers(organizationId),
    payload: { code: "MAIN", name: "Main", isDefault: true }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ location: { id: string } }>().location.id;
}

async function product(
  organizationId: string,
  accounts: {
    incomeAccountId: string;
    inventoryAssetAccountId: string;
    costOfGoodsSoldAccountId: string;
    purchaseClearingAccountId: string;
    adjustmentGainAccountId: string;
    inventoryLossAccountId: string;
  },
  defaultLocationId: string,
  sku: string,
  name: string,
  description?: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/products",
    headers: headers(organizationId),
    payload: {
      sku,
      name,
      ...(description ? { description } : {}),
      itemType: "INVENTORY_PRODUCT",
      salesPriceMinor: "1000",
      ...accounts,
      defaultLocationId
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ product: { id: string } }>().product.id;
}

async function connector(organizationId: string, mapping: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations/current/connectors",
    headers: headers(organizationId),
    payload: { providerKey: "FIXTURE", displayName: "Fixture", mapping }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ connector: { id: string } }>().connector.id;
}
