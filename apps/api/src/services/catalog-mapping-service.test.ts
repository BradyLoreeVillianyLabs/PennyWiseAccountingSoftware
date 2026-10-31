import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hasValidGtinCheckDigit,
  normalizeCatalogIdentifier,
  normalizeSourceScopedSku,
  normalizeVariantSignature,
  rankCatalogCandidates,
  extractApprovedSkuPattern
} from "./catalog-mapping-service.js";

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(resolve(here, "catalog-mapping-service.ts"), "utf8");
const catalogAutomationSource = readFileSync(
  resolve(here, "catalog-automation-service.ts"),
  "utf8"
);
const appSource = readFileSync(resolve(here, "../app.ts"), "utf8");
const dataMigrationSource = readFileSync(resolve(here, "data-migration-service.ts"), "utf8");
const commerceDemoSource = readFileSync(resolve(here, "commerce-demo-service.ts"), "utf8");
const migrationSource = readFileSync(
  resolve(
    here,
    "../../../../packages/db/prisma/migrations/20260803010000_catalog_inventory_sync_foundation/migration.sql"
  ),
  "utf8"
);
const searchMigrationSource = readFileSync(
  resolve(
    here,
    "../../../../packages/db/prisma/migrations/20260804040000_catalog_matching_search_indexes/migration.sql"
  ),
  "utf8"
);
const searchRollbackSource = readFileSync(
  resolve(
    here,
    "../../../../packages/db/prisma/migrations/20260804040000_catalog_matching_search_indexes/down.sql"
  ),
  "utf8"
);
const catalogReviewUiSource = readFileSync(resolve(here, "../../../web/app.js"), "utf8");

describe("catalog mapping foundation", () => {
  it("normalizes external identifiers and variant signatures deterministically", () => {
    expect(normalizeCatalogIdentifier("  abc- 001 / ca ")).toBe("ABC001CA");
    expect(normalizeCatalogIdentifier("---")).toBeNull();
    expect(normalizeVariantSignature({ Size: " Large ", colour: "Blue", ignored: "---" })).toEqual({
      json: { COLOUR: "BLUE", SIZE: "LARGE" },
      normalized: "COLOUR=BLUE|SIZE=LARGE"
    });
  });

  it("validates standard GTIN check digits without rewriting other barcode evidence", () => {
    expect(hasValidGtinCheckDigit("036000291452")).toBe(true);
    expect(hasValidGtinCheckDigit("036000291453")).toBe(false);
    expect(hasValidGtinCheckDigit("00012345678905")).toBe(true);
    expect(hasValidGtinCheckDigit("00012345678906")).toBe(false);
    expect(hasValidGtinCheckDigit("BOX-001-A")).toBe(true);
  });

  it("preserves source SKU punctuation, case, and leading zeros", () => {
    expect(normalizeSourceScopedSku("  amz-001-A ", "AMAZON")).toBe("amz-001-A");
    expect(normalizeSourceScopedSku("  woo-001 ", "WOOCOMMERCE")).toBe("WOO-001");
    expect(extractApprovedSkuPattern("STORE-ABC123-CA", { prefix: "STORE-", suffix: "-CA" })).toBe(
      "ABC123"
    );
    expect(extractApprovedSkuPattern("STORE-ABC123-CA", { prefix: "STORE-" })).toBe("ABC123-CA");
    expect(extractApprovedSkuPattern("ABC123-FBA", { suffix: "-FBA" })).toBe("ABC123");
    expect(extractApprovedSkuPattern("ABC123-FBA", { suffix: "-fba", caseSensitive: false })).toBe(
      "ABC123"
    );
  });

  it("ranks exact identifiers before normalized SKU and fuzzy name-only suggestions", () => {
    const observed = {
      normalizedName: "blue trail shoe",
      normalizedDescription: null,
      normalizedSku: "SHOE42",
      normalizedGtin: "00012345678905",
      normalizedManufacturer: "ACME",
      normalizedManufacturerPartNumber: "TRAIL42"
    };
    const locals = [
      {
        id: "fuzzy",
        name: "Blue trail shoes",
        description: null,
        normalizedSku: null,
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      {
        id: "sku",
        name: "Unrelated",
        description: null,
        normalizedSku: "SHOE42",
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      {
        id: "mpn",
        name: "Unrelated",
        description: null,
        normalizedSku: null,
        normalizedGtin: null,
        normalizedManufacturer: "ACME",
        normalizedManufacturerPartNumber: "TRAIL42"
      },
      {
        id: "gtin",
        name: "Unrelated",
        description: null,
        normalizedSku: null,
        normalizedGtin: "00012345678905",
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      }
    ];
    const first = rankCatalogCandidates(observed, locals);
    const second = rankCatalogCandidates(observed, [...locals].reverse());
    expect(first).toEqual(second);
    expect(first.map((candidate) => candidate.productItemId)).toEqual([
      "gtin",
      "mpn",
      "sku",
      "fuzzy"
    ]);
    expect(first.map((candidate) => candidate.score)).toEqual([
      100000,
      98000,
      90000,
      expect.any(Number)
    ]);
    expect(first.map((candidate) => candidate.reason.autoConfirmEligible)).toEqual([
      false,
      false,
      false,
      false
    ]);
    expect(first.map((candidate) => candidate.reason.version)).toEqual([2, 2, 2, 2]);
    expect(first.find((candidate) => candidate.productItemId === "sku")?.reason.matches).toContain(
      "NORMALIZED_SKU"
    );
    expect(
      first.find((candidate) => candidate.productItemId === "sku")?.reason.deterministicMatch
    ).toBe(true);
    expect(first.find((candidate) => candidate.productItemId === "sku")?.reason.decisionState).toBe(
      "AUTO_MATCH_CANDIDATE"
    );
    expect(Object.keys(first[0]!.reason).sort()).toEqual(
      [
        "algorithmVersion",
        "autoConfirmEligible",
        "compositeSimilarityBasisPoints",
        "conflicts",
        "decisionState",
        "deterministicMatch",
        "descriptionSimilarityBasisPoints",
        "matchMethod",
        "matchedTokens",
        "matches",
        "nameSimilarityBasisPoints",
        "skuSimilarityBasisPoints",
        "suggestionMarginBasisPoints",
        "version"
      ].sort()
    );
  });

  it("does not treat an invalid standard GTIN as durable exact-match evidence", () => {
    const ranked = rankCatalogCandidates(
      {
        normalizedName: "blue trail shoe",
        normalizedDescription: null,
        normalizedSku: null,
        normalizedGtin: "036000291453",
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      [
        {
          id: "invalid-gtin",
          name: "Blue trail shoe",
          description: null,
          normalizedSku: null,
          normalizedGtin: "036000291453",
          normalizedManufacturer: null,
          normalizedManufacturerPartNumber: null
        }
      ]
    );
    expect(ranked[0]?.score).toBeLessThan(100000);
    expect(ranked[0]?.reason.matches).not.toContain("EXACT_GTIN");
    expect(ranked[0]?.reason.deterministicMatch).toBe(false);
  });

  it("explains deterministic nearest SKU, name, and parent-description evidence", () => {
    const observed = {
      normalizedName: "alpine trail boot",
      normalizedDescription: "waterproof leather boot with brass speed hooks",
      normalizedSku: "BOOT1000",
      normalizedGtin: null,
      normalizedManufacturer: null,
      normalizedManufacturerPartNumber: null
    };
    const locals = [
      {
        id: "description-near",
        name: "Completely different title",
        description: "Waterproof leather footwear with brass speed hooks",
        normalizedSku: null,
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      {
        id: "name-near",
        name: "Alpine trail boots",
        description: null,
        normalizedSku: null,
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      {
        id: "sku-near",
        name: "Unrelated",
        description: null,
        normalizedSku: "BOOT1001",
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      }
    ];

    const ranked = rankCatalogCandidates(observed, locals);
    expect(ranked).toEqual(rankCatalogCandidates(observed, [...locals].reverse()));
    const reasons = Object.fromEntries(
      ranked.map((candidate) => [candidate.productItemId, candidate.reason])
    );
    expect(reasons["sku-near"]?.matches).toContain("SKU_SIMILARITY");
    expect(reasons["sku-near"]?.skuSimilarityBasisPoints ?? 0).toBeGreaterThan(0);
    expect(reasons["name-near"]?.matches).toContain("NAME_SIMILARITY");
    expect(reasons["name-near"]?.nameSimilarityBasisPoints ?? 0).toBeGreaterThan(0);
    expect(reasons["description-near"]?.matches).toContain("DESCRIPTION_SIMILARITY");
    expect(reasons["description-near"]?.descriptionSimilarityBasisPoints ?? 0).toBeGreaterThan(0);
    expect(reasons["name-near"]?.skuSimilarityBasisPoints).toBeNull();
    expect(ranked.every((candidate) => candidate.score < 90_000)).toBe(true);
    expect(ranked.map((candidate) => candidate.reason.autoConfirmEligible)).toEqual(
      ranked.map(() => false)
    );
  });

  it("uses the local product ID as the deterministic final tie-breaker", () => {
    const observed = {
      normalizedName: "same candidate name",
      normalizedDescription: null,
      normalizedSku: null,
      normalizedGtin: null,
      normalizedManufacturer: null,
      normalizedManufacturerPartNumber: null
    };
    const tied = ["product-z", "product-a"].map((id) => ({
      id,
      name: "Same candidate name",
      description: null,
      normalizedSku: null,
      normalizedGtin: null,
      normalizedManufacturer: null,
      normalizedManufacturerPartNumber: null
    }));

    expect(
      rankCatalogCandidates(observed, tied).map((candidate) => candidate.productItemId)
    ).toEqual(["product-a", "product-z"]);
  });

  it("reports meaningful title tokens, conflicts, and close-score ambiguity", () => {
    const observed = {
      normalizedName: "Stainless steel bottle 20 oz blue",
      normalizedDescription: "Reusable bottle",
      normalizedSku: null,
      normalizedGtin: "0001112223334",
      normalizedManufacturer: null,
      normalizedManufacturerPartNumber: null,
      variantSignature: { COLOR: "BLUE", SIZE: "20 OZ" }
    };
    const ranked = rankCatalogCandidates(observed, [
      {
        id: "red",
        name: "Stainless steel bottle 20 oz red",
        description: "Reusable bottle",
        sku: null,
        normalizedSku: null,
        normalizedGtin: "0001112223335",
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      {
        id: "blue",
        name: "Stainless steel bottle 20 oz blue",
        description: "Reusable bottle",
        sku: null,
        normalizedSku: null,
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      }
    ]);
    expect(ranked[0]?.reason.matchedTokens).toContain("bottle");
    expect(ranked.some((candidate) => candidate.reason.conflicts.includes("GTIN_CONFLICT"))).toBe(
      false
    );
    expect(ranked[0]?.reason.algorithmVersion).toBe("catalog-match-v3");
  });

  it("keeps every service lookup tenant-predicated and delegates explicit item creation", () => {
    expect(serviceSource).toContain("organizationId: context.organizationId");
    expect(serviceSource).toContain(
      "where: { id: catalogVariantId, organizationId: context.organizationId }"
    );
    expect(serviceSource).toContain(
      "where: { id: candidateId, organizationId: context.organizationId"
    );
    expect(serviceSource).toContain("this.products.create(context");
  });

  it("database-enforces forced RLS and one concurrent confirmation per external variant", () => {
    const tenantTables = [
      "ExternalCatalogProduct",
      "ExternalCatalogVariant",
      "CatalogMatchCandidate",
      "CatalogMatchDecision",
      "CatalogImageReference",
      "InventorySyncPolicy",
      "InventorySyncObservation",
      "InventorySyncConflict"
    ];
    for (const table of tenantTables) expect(migrationSource).toContain(`'${table}'`);
    expect(migrationSource).toContain("ALTER TABLE %I FORCE ROW LEVEL SECURITY");
    expect(migrationSource).toContain('"organizationId" = app_current_organization_id()');
    expect(migrationSource).toContain(
      'CREATE UNIQUE INDEX "CatalogMatchCandidate_one_confirmed_variant_key"'
    );
    expect(migrationSource).toContain(`WHERE "status" = 'CONFIRMED'`);
    expect(migrationSource).toContain("Catalog match decisions are append-only");
  });

  it("bounds tenant candidate pools and indexes nearest SKU, name, and description search", () => {
    expect(serviceSource).toContain("WITH exact_candidates AS");
    expect(serviceSource).toContain("nearest_sku AS");
    expect(serviceSource).toContain("nearest_name AS");
    expect(serviceSource).toContain("nearest_description AS");
    expect(serviceSource).toContain("const poolLimit = 125");
    expect(serviceSource).toContain("const totalLimit = 500");
    expect(serviceSource).toContain("product: { select: { description: true } }");
    expect(serviceSource).toContain('{ productItemId: "asc" }');
    expect(searchMigrationSource).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(searchMigrationSource).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(searchMigrationSource).toContain("gist_trgm_ops");
    for (const field of ["sku", "name", "description"])
      expect(searchMigrationSource).toContain(`ProductItem_org_active_${field}_trgm_gist_idx`);
    for (const field of ["sku", "name", "description"])
      expect(searchRollbackSource).toContain(
        `DROP INDEX IF EXISTS "ProductItem_org_active_${field}_trgm_gist_idx"`
      );
    expect(searchRollbackSource).toContain(
      "DROP FUNCTION IF EXISTS catalog_normalize_match_text(TEXT)"
    );
  });

  it("automatically generates bounded central suggestions for every catalog ingestion path", () => {
    expect(serviceSource).toContain("const automaticCandidateVariantLimit = 50");
    expect(serviceSource).toContain("const automaticCandidatesPerVariantLimit = 10");
    expect(serviceSource).toContain("persistSuggestedCatalogCandidates(");
    expect(catalogAutomationSource).toContain(
      "this.catalog.suggestCandidatesBatch(context, pageVariantIds)"
    );
    expect(appSource).toContain(
      "const candidateSuggestions = await catalogMapping.suggestCandidatesBatch("
    );
    expect(commerceDemoSource).toContain("this.catalog.upsertObservedCatalog(");
    expect(commerceDemoSource).toContain("this.catalog.suggestCandidatesBatch(");
    expect(commerceDemoSource).not.toContain("skuMappings:");
    expect(serviceSource).toContain("deferredVariantIds");
  });

  it("uses the central matcher for paged spreadsheet review without weakening exact posting", () => {
    expect(dataMigrationSource).toContain("nearestLocalCatalogSuggestions(");
    expect(dataMigrationSource).toContain('type === "PRODUCTS" ? Boolean(row.values.name)');
    expect(dataMigrationSource).toContain("normalizedSku: normalizeCatalogIdentifier(sku)");
    expect(dataMigrationSource).toContain("authoritative: false");
    expect(dataMigrationSource).toContain("autoConfirmEligible: false");
    expect(dataMigrationSource).toContain('"CREATE_IMPORT_REVIEW"');
    expect(dataMigrationSource).toContain('"EXACT_SKU_REQUIRED_FOR_INVENTORY_POSTING"');
    expect(dataMigrationSource).toContain("spreadsheetSuggestionRowLimit = 25");
    expect(dataMigrationSource).toContain("nextOffset:");
    expect(appSource).toContain('app.get("/v1/imports/:importBatchId/item-match-suggestions"');
    expect(dataMigrationSource).toContain(
      "where: { organizationId: context.organizationId, sku, active: true }"
    );
    expect(dataMigrationSource).toContain("const product = await this.productBySku(context");
  });

  it("feeds only confirmed matches into connector mappings and preserves mapping conflicts", () => {
    expect(serviceSource).toContain("synchronizeConfirmedCatalogMapping(");
    expect(serviceSource).toContain("catalogSkuMappings");
    expect(serviceSource).toContain("catalogVariantMappings");
    expect(serviceSource).toContain("catalogProductMappings");
    expect(serviceSource).toContain('"CATALOG_ITEM_MAPPING_CONFLICT"');
    expect(serviceSource).toContain('"CATALOG_SKU_MAPPING_CONFLICT"');
    expect(serviceSource).toContain('"CATALOG_VARIANT_MAPPING_CONFLICT"');
    expect(serviceSource).toContain('"CATALOG_PRODUCT_MAPPING_CONFLICT"');
    expect(serviceSource).toContain("connectorConflict.upsert");
    expect(serviceSource).toContain("mappingVersion: { increment: 1 }");
    expect(serviceSource).toContain("explicitHumanDecision: true");
  });

  it("keeps approved aliases and pattern rules inside the audited confirmation boundary", () => {
    expect(serviceSource).toContain("approveSkuAlias(");
    expect(serviceSource).toContain("approveSkuPattern(");
    expect(serviceSource).toContain('"CATALOG_SKU_ALIAS_APPROVED"');
    expect(serviceSource).toContain('"CATALOG_SKU_PATTERN_APPROVED"');
    expect(serviceSource).toContain('"CATALOG_SKU_PATTERN_COLLISION"');
    expect(serviceSource).toContain("catalogSkuAliases");
    expect(serviceSource).toContain("catalogSkuPatternRules");
    expect(appSource).toContain("/catalog/sku-aliases");
    expect(appSource).toContain("/catalog/sku-patterns");
  });

  it("preserves resolved version 1 reasons and keeps them display-compatible", () => {
    expect(serviceSource).toContain('current.status === "SUGGESTED"');
    expect(serviceSource).toContain("return rows.map(candidateDto)");
    expect(catalogReviewUiSource).toContain("catalogReasonCodes(candidate.reason)");
    expect(catalogReviewUiSource).toContain("Array.isArray(evidence.matches)");
    expect(catalogReviewUiSource).toContain('reason === "NAME_SIMILARITY_ONLY"');
    expect(catalogReviewUiSource).toContain("evidence.nameSimilarityBasisPoints");
  });

  it("keeps review and provider writes non-posting and delegates local movement authority", () => {
    expect(serviceSource).not.toMatch(
      /\.(journal|journalLine|inventoryMovement)\.(create|update|upsert)/
    );
    expect(serviceSource).toContain("new InventoryService");
    expect(serviceSource).toContain("this.inventory.adjust(");
    expect(serviceSource).toContain('eventType: "catalog.inventory-write-requested"');
    expect(serviceSource).toContain("createsFinancialEntries: false");
    expect(serviceSource).toContain("createsInventoryMovements: false");
    expect(serviceSource).toContain("accountingEntriesCreated: 0");
  });
});
