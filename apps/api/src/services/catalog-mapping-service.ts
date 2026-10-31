import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  RuntimePrisma,
  withTenantTransaction,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { ProductService, type ProductInput } from "./product-service.js";
import { InventoryService } from "./inventory-service.js";
import {
  hasValidGtinCheckDigit,
  normalizeProductIdentifier as normalizeCatalogIdentifier
} from "./product-identity.js";
import { CatalogImageIngestionService } from "./catalog-image-ingestion-service.js";
import type { ProductImageService } from "./product-image-service.js";

export { hasValidGtinCheckDigit, normalizeCatalogIdentifier };

export interface ObservedCatalogImageInput {
  readonly externalImageId: string;
  readonly remoteUrl: string;
  readonly contentTypeHint?: string | null | undefined;
  readonly byteLengthHint?: string | null | undefined;
  readonly width?: number | null | undefined;
  readonly height?: number | null | undefined;
  readonly position?: number | undefined;
  readonly safeMetadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ObservedCatalogVariantInput {
  readonly externalVariantId: string;
  readonly externalReferenceAliases?: readonly string[] | undefined;
  readonly name: string;
  readonly sku?: string | null | undefined;
  readonly gtin?: string | null | undefined;
  readonly manufacturer?: string | null | undefined;
  readonly manufacturerPartNumber?: string | null | undefined;
  readonly variantSignature?: Readonly<Record<string, string>> | undefined;
  readonly sourceStatus?: string | null | undefined;
  readonly providerUpdatedAt?: Date | null | undefined;
  readonly images?: readonly ObservedCatalogImageInput[] | undefined;
}

export interface ObservedCatalogProductInput {
  readonly externalProductId: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly sourceStatus?: string | null | undefined;
  readonly sourceUrl?: string | null | undefined;
  readonly providerUpdatedAt?: Date | null | undefined;
  readonly images?: readonly ObservedCatalogImageInput[] | undefined;
  readonly variants: readonly ObservedCatalogVariantInput[];
}

export interface CatalogRankObserved {
  readonly normalizedName: string;
  readonly normalizedDescription: string | null;
  readonly normalizedSku: string | null;
  /** Raw source SKU retained for source-specific case and punctuation rules. */
  readonly sourceSku?: string | null;
  /** Connector provider used to select the source SKU policy. */
  readonly sourceProviderKey?: string | null;
  readonly normalizedGtin: string | null;
  readonly normalizedManufacturer: string | null;
  readonly normalizedManufacturerPartNumber: string | null;
  readonly variantSignature?: Readonly<Record<string, string>> | null;
}

export interface CatalogRankLocal {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly sku?: string | null;
  readonly normalizedSku: string | null;
  readonly normalizedGtin: string | null;
  readonly normalizedManufacturer: string | null;
  readonly normalizedManufacturerPartNumber: string | null;
  readonly variantSignature?: Readonly<Record<string, string>> | null;
}

export type CatalogMatchEvidenceCode =
  | "EXACT_GTIN"
  | "EXACT_MANUFACTURER_PART_NUMBER"
  | "NORMALIZED_SKU"
  | "SKU_SIMILARITY"
  | "NAME_SIMILARITY"
  | "DESCRIPTION_SIMILARITY";

export type CatalogMatchDecisionState =
  | "AUTO_MATCH_CANDIDATE"
  | "SUGGESTED"
  | "AMBIGUOUS"
  | "UNMATCHED";

export interface CatalogMatchReasonV2 {
  readonly [key: string]: Prisma.InputJsonValue | null;
  readonly version: 2;
  readonly matches: readonly CatalogMatchEvidenceCode[];
  readonly skuSimilarityBasisPoints: number | null;
  readonly nameSimilarityBasisPoints: number | null;
  readonly descriptionSimilarityBasisPoints: number | null;
  readonly compositeSimilarityBasisPoints: number;
  readonly autoConfirmEligible: false;
  /** Stable matcher implementation identifier for reproducible review evidence. */
  readonly algorithmVersion: "catalog-match-v3";
  readonly decisionState: CatalogMatchDecisionState;
  readonly deterministicMatch: boolean;
  readonly matchedTokens: readonly string[];
  readonly conflicts: readonly string[];
  readonly suggestionMarginBasisPoints: number | null;
  readonly matchMethod:
    | "EXACT_IDENTIFIER"
    | "NORMALIZED_SKU"
    | "APPROVED_ALIAS"
    | "APPROVED_PATTERN"
    | "FUZZY";
  readonly quantityMultiplierMicros?: string | null;
}

export interface RankedCatalogCandidate {
  readonly productItemId: string;
  readonly score: number;
  readonly reason: CatalogMatchReasonV2;
}

export interface CatalogReviewSuggestion extends RankedCatalogCandidate {
  readonly productItem: {
    readonly id: string;
    readonly name: string;
    readonly sku: string | null;
    readonly description: string | null;
  };
}

export interface CatalogCandidateBatchResult {
  readonly evaluatedVariantIds: readonly string[];
  readonly deferredVariantIds: readonly string[];
  readonly candidateCount: number;
  readonly maxVariants: number;
  readonly candidatesPerVariant: number;
}

/**
 * Shared configuration for a deliberate catalog-to-inventory onboarding run.
 * Product identity, description, and media are always derived from the stored
 * channel evidence rather than supplied by a bulk client payload.
 */
export interface CatalogBulkCreateLocalProductsInput
  extends Omit<
    ProductInput,
    | "name"
    | "sku"
    | "gtin"
    | "manufacturer"
    | "manufacturerPartNumber"
    | "description"
    | "productImageReference"
  > {
  readonly catalogVariantIds: readonly string[];
  readonly attachFirstIngestedImage: boolean;
  /** Explicitly elected by the reviewer; fuzzy suggestions never set this. */
  readonly confirmMappings: boolean;
}

export interface CatalogSkuAliasApprovalInput {
  readonly installationId: string;
  readonly sourceSku: string;
  readonly productItemId: string;
  readonly quantityMultiplierMicros?: string | undefined;
  readonly unitOfMeasure?: string | undefined;
  readonly reason?: string | undefined;
}

export interface CatalogSkuPatternApprovalInput {
  readonly installationId: string;
  readonly name: string;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  readonly caseSensitive?: boolean | undefined;
  readonly priority?: number | undefined;
  readonly quantityMultiplierMicros?: string | undefined;
  readonly examples?: readonly string[] | undefined;
  readonly reason?: string | undefined;
}

const automaticCandidateVariantLimit = 50;
const automaticCandidatesPerVariantLimit = 10;
const bulkCatalogProductCreateLimit = 100;

export interface InventorySyncPolicyInput {
  readonly installationId: string;
  readonly catalogVariantId: string;
  readonly productItemId: string;
  readonly locationId: string;
  readonly sourceOfTruth: "LOCAL" | "CHANNEL" | "MANUAL_REVIEW";
  readonly desiredQuantityMicros?: string | null;
  readonly enabled: boolean;
  readonly version?: number;
}

export interface InventorySyncObservationInput {
  readonly externalObservationId: string;
  readonly observedQuantityMicros: string;
  readonly desiredQuantityMicros?: string | null;
  readonly providerObservedAt?: Date | null;
  readonly safeMetadata?: Readonly<Record<string, unknown>>;
}

export class CatalogMappingService {
  private readonly authorization: AuthorizationService;
  private readonly products: ProductService;
  private readonly inventory: InventoryService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly imageIngestion = new CatalogImageIngestionService(),
    private readonly productImages?: ProductImageService
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.products = new ProductService(prisma);
    this.inventory = new InventoryService(prisma);
  }

  public async listCatalog(
    context: OrganizationContext,
    filters: { readonly installationId?: string; readonly limit?: number } = {}
  ) {
    await this.authorization.assert(context, "integrations:read", "ExternalCatalogProduct");
    const limit = Math.max(1, Math.min(200, filters.limit ?? 100));
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.externalCatalogProduct.findMany({
        where: {
          organizationId: context.organizationId,
          ...(filters.installationId ? { installationId: filters.installationId } : {})
        },
        include: {
          images: { orderBy: [{ position: "asc" }, { id: "asc" }] },
          variants: {
            include: {
              images: { orderBy: [{ position: "asc" }, { id: "asc" }] },
              candidates: {
                include: { productItem: { select: { id: true, sku: true, name: true } } },
                orderBy: [
                  { status: "asc" },
                  { score: "desc" },
                  { productItemId: "asc" },
                  { id: "asc" }
                ]
              },
              inventorySyncPolicies: true
            },
            orderBy: [{ name: "asc" }, { id: "asc" }]
          }
        },
        orderBy: [{ lastObservedAt: "desc" }, { id: "asc" }],
        take: limit
      });
      return rows.map(catalogProductDto);
    });
  }

  public async listCandidates(context: OrganizationContext, catalogVariantId: string) {
    await this.authorization.assert(context, "integrations:read", "CatalogMatchCandidate");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const variant = await tx.externalCatalogVariant.findFirst({
        where: { id: catalogVariantId, organizationId: context.organizationId }
      });
      if (!variant)
        throw new AppError("CATALOG_VARIANT_NOT_FOUND", "Catalog variant was not found.", 404);
      const rows = await tx.catalogMatchCandidate.findMany({
        where: { organizationId: context.organizationId, catalogVariantId },
        include: { productItem: { select: { id: true, sku: true, name: true, active: true } } },
        orderBy: [{ score: "desc" }, { productItemId: "asc" }, { id: "asc" }]
      });
      return rows.map(candidateDto);
    });
  }

  public async listInventoryState(
    context: OrganizationContext,
    filters: {
      readonly installationId?: string;
      readonly status?: "OPEN" | "RESOLVED" | "IGNORED";
    } = {}
  ) {
    await this.authorization.assert(context, "inventory:read", "InventorySyncPolicy");
    await this.authorization.assert(context, "integrations:read", "InventorySyncObservation");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const policies = await tx.inventorySyncPolicy.findMany({
        where: {
          organizationId: context.organizationId,
          ...(filters.installationId ? { installationId: filters.installationId } : {})
        },
        include: {
          installation: { select: { providerKey: true, displayName: true } },
          variant: {
            include: { product: { select: { externalProductId: true, name: true } } }
          },
          productItem: { select: { id: true, sku: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
          observations: { orderBy: { observedAt: "desc" }, take: 10 },
          conflicts: {
            ...(filters.status ? { where: { status: filters.status } } : {}),
            orderBy: { createdAt: "desc" },
            take: 50
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }]
      });
      const operations = await tx.outboxEvent.findMany({
        where: {
          organizationId: context.organizationId,
          eventType: "catalog.inventory-write-requested",
          ...(filters.installationId
            ? { payload: { path: ["installationId"], equals: filters.installationId } }
            : {})
        },
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
        take: 200
      });
      return {
        policies: policies.map(policyStateDto),
        operations: operations.map(inventoryOperationDto),
        accountingEntriesCreated: 0
      };
    });
  }

  public async upsertObservedCatalog(
    context: OrganizationContext,
    installationId: string,
    input: ObservedCatalogProductInput
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      installationId
    );
    const normalized = normalizeObservedProduct(input);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await requireInstallation(tx, context.organizationId, installationId);
      const product = await upsertObservedProduct(
        tx,
        context.organizationId,
        installationId,
        normalized
      );
      const variants = [];
      for (const variantInput of normalized.variants) {
        const variant = await upsertObservedVariant(
          tx,
          context.organizationId,
          installationId,
          product.id,
          variantInput
        );
        await upsertImages(tx, context.organizationId, product.id, variant.id, variantInput.images);
        variants.push(variant);
      }
      await upsertImages(tx, context.organizationId, product.id, null, normalized.images);
      await audit(tx, context, "EXTERNAL_CATALOG_OBSERVED", product.id, {
        installationId,
        externalProductId: normalized.externalProductId,
        variantCount: variants.length,
        createsFinancialEntries: false,
        createsInventoryMovements: false
      });
      return { product, variants };
    });
  }

  public async suggestCandidates(
    context: OrganizationContext,
    catalogVariantId: string,
    options: { readonly useDatabaseSimilarity?: boolean; readonly limit?: number } = {}
  ) {
    await this.authorization.assert(context, "products:read", "ProductItem");
    await this.authorization.assert(context, "integrations:read", "ExternalCatalogVariant");
    const limit = Math.max(1, Math.min(100, options.limit ?? 25));
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      (
        await persistSuggestedCatalogCandidates(
          tx,
          context.organizationId,
          catalogVariantId,
          limit,
          options.useDatabaseSimilarity !== false
        )
      ).map(candidateDto)
    );
  }

  /**
   * Generates review-only candidates for a bounded set of newly observed
   * variants. Provider polling can therefore offer immediate suggestions
   * without turning a large catalog page into unbounded matching work.
   */
  public async suggestCandidatesBatch(
    context: OrganizationContext,
    catalogVariantIds: readonly string[],
    options: {
      readonly maxVariants?: number;
      readonly candidatesPerVariant?: number;
    } = {}
  ): Promise<CatalogCandidateBatchResult> {
    await this.authorization.assert(context, "products:read", "ProductItem");
    await this.authorization.assert(context, "integrations:read", "ExternalCatalogVariant");
    const maxVariants = Math.max(
      1,
      Math.min(
        automaticCandidateVariantLimit,
        options.maxVariants ?? automaticCandidateVariantLimit
      )
    );
    const candidatesPerVariant = Math.max(
      1,
      Math.min(
        automaticCandidatesPerVariantLimit,
        options.candidatesPerVariant ?? automaticCandidatesPerVariantLimit
      )
    );
    const uniqueVariantIds = [...new Set(catalogVariantIds)];
    const evaluatedVariantIds = uniqueVariantIds.slice(0, maxVariants);
    const deferredVariantIds = uniqueVariantIds.slice(maxVariants);
    const candidateCount = await withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        let count = 0;
        for (const catalogVariantId of evaluatedVariantIds)
          count += (
            await persistSuggestedCatalogCandidates(
              tx,
              context.organizationId,
              catalogVariantId,
              candidatesPerVariant,
              true
            )
          ).length;
        return count;
      }
    );
    return {
      evaluatedVariantIds,
      deferredVariantIds,
      candidateCount,
      maxVariants,
      candidatesPerVariant
    };
  }

  public async confirmCandidate(
    context: OrganizationContext,
    candidateId: string,
    version: number,
    reason?: string
  ) {
    await this.authorization.assert(context, "integrations:manage", "CatalogMatchCandidate");
    await this.authorization.assert(context, "products:manage", "ProductItem");
    return this.transitionCandidate(context, candidateId, version, "CONFIRMED", reason);
  }

  public async rejectCandidate(
    context: OrganizationContext,
    candidateId: string,
    version: number,
    reason?: string
  ) {
    await this.authorization.assert(context, "integrations:manage", "CatalogMatchCandidate");
    return this.transitionCandidate(context, candidateId, version, "REJECTED", reason);
  }

  /**
   * Saves an explicitly approved, source-scoped alias in the existing
   * connector mapping document.  It is intentionally not exposed through the
   * generic connector mapping endpoint and never confirms a candidate or posts
   * accounting entries by itself.
   */
  public async approveSkuAlias(context: OrganizationContext, input: CatalogSkuAliasApprovalInput) {
    await this.authorization.assert(context, "integrations:manage", "ConnectorInstallation");
    await this.authorization.assert(context, "products:manage", "ProductItem", input.productItemId);
    const sourceSku = validateApprovedSkuAlias(input.sourceSku);
    const quantityMultiplierMicros = validateQuantityMultiplier(input.quantityMultiplierMicros);
    const unitOfMeasure = optionalText(input.unitOfMeasure, 40);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const installation = await requireInstallation(
        tx,
        context.organizationId,
        input.installationId
      );
      const product = await tx.productItem.findFirst({
        where: { id: input.productItemId, organizationId: context.organizationId, active: true },
        select: { id: true, sku: true, name: true }
      });
      if (!product)
        throw new AppError(
          "PRODUCT_NOT_FOUND",
          "The target product was not found or is inactive.",
          404
        );
      const mapping = connectorMappingObject(installation.mapping);
      const aliases = nestedConnectorMappings(mapping.catalogSkuAliases) ?? {};
      const policy = catalogSourceIdentifierPolicy(installation.providerKey);
      const matchingEntries = Object.entries(aliases).filter(
        ([key]) =>
          normalizeSourceScopedSku(key, policy) === normalizeSourceScopedSku(sourceSku, policy)
      );
      const matchingTargets = new Set<string>();
      for (const [, existing] of matchingEntries) {
        const existingObject = jsonObject(existing, "catalog SKU alias");
        if (typeof existingObject.productItemId !== "string")
          throw new AppError(
            "CATALOG_SKU_ALIAS_INVALID",
            "Stored SKU alias target is invalid.",
            409
          );
        matchingTargets.add(existingObject.productItemId);
      }
      if (matchingTargets.size > 1)
        throw new AppError(
          "CATALOG_SKU_ALIAS_CONFLICT",
          "Conflicting approved aliases already use this source SKU spelling.",
          409
        );
      if (matchingTargets.size === 1 && !matchingTargets.has(product.id))
        throw new AppError(
          "CATALOG_SKU_ALIAS_CONFLICT",
          "This source SKU is already approved for a different PennyWise Accounting product.",
          409
        );
      const now = new Date().toISOString();
      const alias = {
        productItemId: product.id,
        quantityMultiplierMicros,
        unitOfMeasure,
        approvedAt: now,
        approvedByUserId: context.user.id,
        reason: optionalText(input.reason, 500)
      } satisfies Record<string, Prisma.InputJsonValue | null>;
      await updateCatalogConnectorMapping(tx, context, installation, {
        ...mapping,
        catalogSkuAliases: {
          ...Object.fromEntries(
            Object.entries(aliases).filter(
              ([key]) =>
                normalizeSourceScopedSku(key, policy) !==
                normalizeSourceScopedSku(sourceSku, policy)
            )
          ),
          [sourceSku]: alias
        }
      });
      await audit(tx, context, "CATALOG_SKU_ALIAS_APPROVED", installation.id, {
        installationId: installation.id,
        sourceSku,
        productItemId: product.id,
        quantityMultiplierMicros,
        unitOfMeasure
      });
      return { installationId: installation.id, sourceSku, ...alias, product };
    });
  }

  public async approveSkuPattern(
    context: OrganizationContext,
    input: CatalogSkuPatternApprovalInput
  ) {
    await this.authorization.assert(context, "integrations:manage", "ConnectorInstallation");
    await this.authorization.assert(context, "products:manage", "ProductItem");
    const rule = normalizeApprovedSkuPattern(input);
    const quantityMultiplierMicros = validateQuantityMultiplier(input.quantityMultiplierMicros);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const installation = await requireInstallation(
        tx,
        context.organizationId,
        input.installationId
      );
      const policy = catalogSourceIdentifierPolicy(installation.providerKey);
      const examples = input.examples?.map((example) => validateApprovedSkuAlias(example)) ?? [];
      if (
        examples.some(
          (example) =>
            !extractApprovedSkuPattern(example, {
              prefix: rule.prefix,
              suffix: rule.suffix,
              caseSensitive: rule.caseSensitive
            })
        )
      )
        throw new AppError(
          "CATALOG_SKU_PATTERN_EXAMPLE_INVALID",
          "Every pattern example must match its anchored prefix or suffix.",
          422
        );
      const [observedVariants, localProducts] = await Promise.all([
        tx.externalCatalogVariant.findMany({
          where: {
            organizationId: context.organizationId,
            installationId: installation.id,
            sku: { not: null }
          },
          select: { sku: true },
          take: 2_000
        }),
        tx.productItem.findMany({
          where: { organizationId: context.organizationId, active: true, sku: { not: null } },
          select: { id: true, sku: true },
          take: 2_000
        })
      ]);
      let testedCount = 0;
      let matchedCount = 0;
      let collisionCount = 0;
      for (const observedVariant of observedVariants) {
        const extracted = extractApprovedSkuPattern(observedVariant.sku, rule);
        if (!extracted) continue;
        testedCount += 1;
        const matches = localProducts.filter(
          (product) =>
            normalizeSourceScopedSku(product.sku, {
              providerKey: policy.providerKey,
              skuCaseSensitive: rule.caseSensitive
            }) ===
            normalizeSourceScopedSku(extracted, {
              providerKey: policy.providerKey,
              skuCaseSensitive: rule.caseSensitive
            })
        );
        if (matches.length === 1) matchedCount += 1;
        if (matches.length > 1) collisionCount += 1;
      }
      if (collisionCount > 0)
        throw new AppError(
          "CATALOG_SKU_PATTERN_COLLISION",
          "The pattern would resolve more than one active product for existing catalog rows.",
          409,
          { testedCount, matchedCount, collisionCount }
        );
      const mapping = connectorMappingObject(installation.mapping);
      const storedRules = mapping.catalogSkuPatternRules;
      if (storedRules !== undefined && !Array.isArray(storedRules))
        throw new AppError(
          "CATALOG_PATTERN_MAPPING_INVALID",
          "Stored pattern rules are invalid and must be repaired before adding a rule.",
          409
        );
      const rawRules = Array.isArray(storedRules) ? storedRules : [];
      const id = randomUUID();
      const now = new Date().toISOString();
      const storedRule = {
        id,
        ...rule,
        quantityMultiplierMicros,
        examples,
        preview: { testedCount, matchedCount, collisionCount },
        enabled: true,
        approvedAt: now,
        approvedByUserId: context.user.id,
        reason: optionalText(input.reason, 500)
      } satisfies Record<string, Prisma.InputJsonValue | null>;
      await updateCatalogConnectorMapping(tx, context, installation, {
        ...mapping,
        catalogSkuPatternRules: [...rawRules, storedRule]
      });
      await audit(tx, context, "CATALOG_SKU_PATTERN_APPROVED", installation.id, {
        installationId: installation.id,
        ruleId: id,
        name: rule.name,
        prefix: rule.prefix,
        suffix: rule.suffix,
        caseSensitive: rule.caseSensitive,
        priority: rule.priority,
        quantityMultiplierMicros
      });
      return { installationId: installation.id, ...storedRule };
    });
  }

  public async createLocalProductFromObserved(
    context: OrganizationContext,
    catalogVariantId: string,
    input: Omit<ProductInput, "name" | "sku"> & {
      readonly name?: string | undefined;
      readonly sku?: string | null | undefined;
    }
  ) {
    await this.authorization.assert(context, "integrations:manage", "ExternalCatalogVariant");
    const variant = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.externalCatalogVariant.findFirst({
        where: { id: catalogVariantId, organizationId: context.organizationId },
        include: {
          product: { select: { description: true } },
          installation: { select: { providerKey: true } }
        }
      })
    );
    if (!variant)
      throw new AppError("CATALOG_VARIANT_NOT_FOUND", "Catalog variant was not found.", 404);
    const product = await this.products.create(context, {
      ...input,
      name: input.name?.trim() || variant.name,
      sku: input.sku === undefined ? variant.sku : input.sku,
      description:
        input.description === undefined ? variant.product.description : input.description,
      gtin:
        input.gtin === undefined && hasValidGtinCheckDigit(variant.gtin)
          ? variant.gtin
          : input.gtin,
      manufacturer: input.manufacturer === undefined ? variant.manufacturer : input.manufacturer,
      manufacturerPartNumber:
        input.manufacturerPartNumber === undefined
          ? variant.manufacturerPartNumber
          : input.manufacturerPartNumber
    });
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const local = await tx.productItem.findFirstOrThrow({
        where: { id: product.id, organizationId: context.organizationId },
        select: localCandidateSelect
      });
      const candidate = scoreCatalogCandidate(catalogRankObserved(variant), local);
      await tx.catalogMatchCandidate.upsert({
        where: {
          catalogVariantId_productItemId: {
            catalogVariantId,
            productItemId: product.id
          }
        },
        create: {
          organizationId: context.organizationId,
          catalogVariantId,
          productItemId: product.id,
          score: candidate.score,
          reason: localProductCreationReason(candidate.reason)
        },
        update: {}
      });
      await audit(tx, context, "LOCAL_PRODUCT_CREATED_FROM_CATALOG", product.id, {
        catalogVariantId,
        matchStatus: "SUGGESTED",
        createsFinancialEntries: false,
        createsInventoryMovements: false
      });
    });
    return product;
  }

  /**
   * Creates a bounded, reviewer-selected set of local inventory item
   * definitions. The source catalog is evidence only: no on-hand quantity,
   * inventory movement, journal, or tax entry is created here. A caller can
   * make a second, explicit choice to confirm the source-to-new-item mapping.
   *
   * Results are intentionally per-row. A bad SKU or a pre-existing mapping
   * cannot erase the useful reviewed work for the other selected variants.
   */
  public async bulkCreateLocalProductsFromObserved(
    context: OrganizationContext,
    input: CatalogBulkCreateLocalProductsInput
  ) {
    await this.authorization.assert(context, "integrations:manage", "ExternalCatalogVariant");
    await this.authorization.assert(context, "products:manage", "ProductItem");
    if (input.itemType !== "INVENTORY_PRODUCT")
      throw new AppError(
        "CATALOG_BULK_ITEM_TYPE_INVALID",
        "Bulk catalog onboarding creates inventory products only.",
        422
      );
    const catalogVariantIds = [...new Set(input.catalogVariantIds)].slice(
      0,
      bulkCatalogProductCreateLimit
    );
    const observed = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.externalCatalogVariant.findMany({
        where: { organizationId: context.organizationId, id: { in: catalogVariantIds } },
        include: {
          product: {
            select: {
              images: { orderBy: [{ position: "asc" }, { id: "asc" }] }
            }
          },
          images: { orderBy: [{ position: "asc" }, { id: "asc" }] },
          candidates: {
            include: { productItem: { select: { id: true, sku: true, name: true, active: true } } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          }
        }
      })
    );
    const variants = new Map(observed.map((variant) => [variant.id, variant]));
    const results: Array<{
      catalogVariantId: string;
      status:
        | "CREATED"
        | "CREATED_REVIEW_REQUIRED"
        | "ALREADY_CREATED"
        | "ALREADY_MAPPED"
        | "NOT_CREATED";
      product?: { id: string; sku: string | null; name: string };
      mappingStatus?: "SUGGESTED" | "CONFIRMED";
      imageAttached?: boolean;
      code?: string;
      message?: string;
    }> = [];
    for (const catalogVariantId of catalogVariantIds) {
      const variant = variants.get(catalogVariantId);
      if (!variant) {
        results.push({
          catalogVariantId,
          status: "NOT_CREATED",
          code: "CATALOG_VARIANT_NOT_FOUND",
          message: "The selected channel variation is no longer available. Refresh the catalog."
        });
        continue;
      }
      const confirmed = variant.candidates.find((candidate) => candidate.status === "CONFIRMED");
      if (confirmed) {
        results.push({
          catalogVariantId,
          status: "ALREADY_MAPPED",
          product: confirmed.productItem,
          mappingStatus: "CONFIRMED",
          message: "This channel variation already has an approved PennyWise Accounting item."
        });
        continue;
      }
      const existing = variant.candidates.find(
        (candidate) =>
          candidate.productItem.active && isLocalProductCreationReason(candidate.reason)
      );
      if (existing) {
        const confirmedExisting = await this.confirmExistingBulkCandidate(
          context,
          existing,
          input.confirmMappings
        );
        results.push(confirmedExisting);
        continue;
      }
      const imageReference = input.attachFirstIngestedImage
        ? firstIngestedCatalogImageReference(variant)
        : null;
      try {
        const product = await this.createLocalProductFromObserved(context, catalogVariantId, {
          itemType: input.itemType,
          salesPriceMinor: input.salesPriceMinor,
          ...(input.purchaseCostMinor !== undefined
            ? { purchaseCostMinor: input.purchaseCostMinor }
            : {}),
          incomeAccountId: input.incomeAccountId,
          inventoryAssetAccountId: input.inventoryAssetAccountId,
          costOfGoodsSoldAccountId: input.costOfGoodsSoldAccountId,
          purchaseClearingAccountId: input.purchaseClearingAccountId,
          adjustmentGainAccountId: input.adjustmentGainAccountId,
          inventoryLossAccountId: input.inventoryLossAccountId,
          defaultLocationId: input.defaultLocationId,
          reorderPointMicros: input.reorderPointMicros,
          safetyStockMicros: input.safetyStockMicros,
          preferredStockMicros: input.preferredStockMicros,
          leadTimeDays: input.leadTimeDays,
          orderMultipleMicros: input.orderMultipleMicros,
          minimumOrderMicros: input.minimumOrderMicros,
          inventoryCostingMethod: input.inventoryCostingMethod,
          ...(input.preferredVendorId !== undefined
            ? { preferredVendorId: input.preferredVendorId }
            : {}),
          ...(input.defaultTaxCodeId !== undefined
            ? { defaultTaxCodeId: input.defaultTaxCodeId }
            : {}),
          ...(input.unitOfMeasure !== undefined ? { unitOfMeasure: input.unitOfMeasure } : {}),
          ...(input.hsTariffCode !== undefined ? { hsTariffCode: input.hsTariffCode } : {}),
          ...(input.countryOfOrigin !== undefined
            ? { countryOfOrigin: input.countryOfOrigin }
            : {}),
          ...(imageReference ? { productImageReference: imageReference } : {})
        });
        const candidate = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
          tx.catalogMatchCandidate.findFirstOrThrow({
            where: {
              organizationId: context.organizationId,
              catalogVariantId,
              productItemId: product.id
            }
          })
        );
        if (!input.confirmMappings) {
          results.push({
            catalogVariantId,
            status: "CREATED",
            product: { id: product.id, sku: product.sku, name: product.name },
            mappingStatus: "SUGGESTED",
            imageAttached: Boolean(imageReference)
          });
          continue;
        }
        try {
          await this.confirmCandidate(
            context,
            candidate.id,
            candidate.version,
            "Explicit bulk catalog onboarding decision."
          );
          results.push({
            catalogVariantId,
            status: "CREATED",
            product: { id: product.id, sku: product.sku, name: product.name },
            mappingStatus: "CONFIRMED",
            imageAttached: Boolean(imageReference)
          });
        } catch (error) {
          results.push({
            catalogVariantId,
            status: "CREATED_REVIEW_REQUIRED",
            product: { id: product.id, sku: product.sku, name: product.name },
            mappingStatus: "SUGGESTED",
            imageAttached: Boolean(imageReference),
            ...catalogBulkError(error)
          });
        }
      } catch (error) {
        results.push({ catalogVariantId, status: "NOT_CREATED", ...catalogBulkError(error) });
      }
    }
    const summary = {
      created: results.filter((result) => result.status === "CREATED").length,
      reviewRequired: results.filter((result) => result.status === "CREATED_REVIEW_REQUIRED")
        .length,
      alreadyCreated: results.filter((result) => result.status === "ALREADY_CREATED").length,
      alreadyMapped: results.filter((result) => result.status === "ALREADY_MAPPED").length,
      notCreated: results.filter((result) => result.status === "NOT_CREATED").length
    };
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      audit(tx, context, "LOCAL_PRODUCTS_BULK_CREATED_FROM_CATALOG", randomUUID(), {
        requestedVariantCount: catalogVariantIds.length,
        confirmMappings: input.confirmMappings,
        attachFirstIngestedImage: input.attachFirstIngestedImage,
        summary,
        createsFinancialEntries: false,
        createsInventoryMovements: false
      })
    );
    return {
      results,
      summary,
      accountingEntriesCreated: 0,
      inventoryMovementsCreated: 0
    };
  }

  private async confirmExistingBulkCandidate(
    context: OrganizationContext,
    candidate: {
      id: string;
      version: number;
      status: string;
      catalogVariantId: string;
      productItem: { id: string; sku: string | null; name: string; active: boolean };
    },
    confirmMappings: boolean
  ) {
    if (!confirmMappings || candidate.status === "CONFIRMED")
      return {
        catalogVariantId: candidate.catalogVariantId,
        status: "ALREADY_CREATED" as const,
        product: candidate.productItem,
        mappingStatus:
          candidate.status === "CONFIRMED" ? ("CONFIRMED" as const) : ("SUGGESTED" as const),
        message:
          candidate.status === "CONFIRMED"
            ? "This item and source mapping were already created."
            : "This item was already created from this source and is waiting for mapping approval."
      };
    try {
      await this.confirmCandidate(
        context,
        candidate.id,
        candidate.version,
        "Explicit bulk catalog onboarding decision."
      );
      return {
        catalogVariantId: candidate.catalogVariantId,
        status: "ALREADY_CREATED" as const,
        product: candidate.productItem,
        mappingStatus: "CONFIRMED" as const,
        message: "The existing item was explicitly approved for this source."
      };
    } catch (error) {
      return {
        catalogVariantId: candidate.catalogVariantId,
        status: "CREATED_REVIEW_REQUIRED" as const,
        product: candidate.productItem,
        mappingStatus: "SUGGESTED" as const,
        ...catalogBulkError(error)
      };
    }
  }

  public async configureInventorySyncPolicy(
    context: OrganizationContext,
    input: InventorySyncPolicyInput
  ) {
    await this.authorization.assert(context, "inventory:configure", "InventorySyncPolicy");
    await this.authorization.assert(
      context,
      "integrations:manage",
      "ConnectorInstallation",
      input.installationId
    );
    if (input.enabled && input.sourceOfTruth === "MANUAL_REVIEW")
      throw new AppError(
        "INVENTORY_SYNC_POLICY_INVALID",
        "Manual-review inventory policies cannot be enabled for synchronization.",
        422
      );
    const desired = optionalBigInt(input.desiredQuantityMicros, "desired quantity");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const confirmed = await tx.catalogMatchCandidate.findFirst({
        where: {
          organizationId: context.organizationId,
          catalogVariantId: input.catalogVariantId,
          productItemId: input.productItemId,
          status: "CONFIRMED",
          variant: { installationId: input.installationId },
          productItem: { active: true, itemType: "INVENTORY_PRODUCT" }
        }
      });
      const location = await tx.inventoryLocation.findFirst({
        where: { organizationId: context.organizationId, id: input.locationId, isActive: true }
      });
      if (!confirmed || !location)
        throw new AppError(
          "INVENTORY_SYNC_MAPPING_INVALID",
          "Inventory sync requires a confirmed item match and active tenant location.",
          422
        );
      const current = await tx.inventorySyncPolicy.findUnique({
        where: {
          installationId_catalogVariantId_locationId: {
            installationId: input.installationId,
            catalogVariantId: input.catalogVariantId,
            locationId: input.locationId
          }
        }
      });
      if (!current) {
        const created = await tx.inventorySyncPolicy.create({
          data: {
            organizationId: context.organizationId,
            installationId: input.installationId,
            catalogVariantId: input.catalogVariantId,
            productItemId: input.productItemId,
            locationId: input.locationId,
            sourceOfTruth: input.sourceOfTruth,
            desiredQuantityMicros: desired,
            enabled: input.enabled,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "INVENTORY_SYNC_POLICY_CREATED", created.id, policyAudit(created));
        return inventoryPolicyDto(created);
      }
      if (input.version === undefined)
        throw new AppError("INVENTORY_SYNC_VERSION_REQUIRED", "Policy version is required.", 409);
      const updated = await tx.inventorySyncPolicy.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          version: input.version
        },
        data: {
          productItemId: input.productItemId,
          sourceOfTruth: input.sourceOfTruth,
          desiredQuantityMicros: desired,
          enabled: input.enabled,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1)
        throw new AppError("STALE_INVENTORY_SYNC_POLICY", "Policy was changed.", 409);
      const row = await tx.inventorySyncPolicy.findFirstOrThrow({
        where: { id: current.id, organizationId: context.organizationId }
      });
      await audit(tx, context, "INVENTORY_SYNC_POLICY_UPDATED", row.id, policyAudit(row));
      return inventoryPolicyDto(row);
    });
  }

  public async recordInventoryObservation(
    context: OrganizationContext,
    policyId: string,
    input: InventorySyncObservationInput
  ) {
    await this.authorization.assert(context, "integrations:manage", "InventorySyncObservation");
    const externalObservationId = requiredIdentifier(
      input.externalObservationId,
      "external observation ID"
    );
    const observed = requiredBigInt(input.observedQuantityMicros, "observed quantity");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const policy = await tx.inventorySyncPolicy.findFirst({
        where: { id: policyId, organizationId: context.organizationId }
      });
      if (!policy)
        throw new AppError("INVENTORY_SYNC_POLICY_NOT_FOUND", "Policy was not found.", 404);
      const desired =
        optionalBigInt(input.desiredQuantityMicros, "desired quantity") ??
        policy.desiredQuantityMicros;
      const safeMetadata = sanitizeMetadata(input.safeMetadata ?? {});
      const evidenceHash = hashJson({
        externalObservationId,
        observed: observed.toString(),
        desired: desired?.toString() ?? null,
        providerObservedAt: input.providerObservedAt?.toISOString() ?? null,
        safeMetadata
      });
      const existing = await tx.inventorySyncObservation.findUnique({
        where: { policyId_externalObservationId: { policyId, externalObservationId } },
        include: { conflicts: true }
      });
      if (existing) {
        if (
          existing.organizationId !== context.organizationId ||
          existing.evidenceHash !== evidenceHash
        )
          throw new AppError(
            "INVENTORY_OBSERVATION_ID_REUSED",
            "Observation ID was already used with different evidence.",
            409
          );
        return {
          observation: inventoryObservationDto(existing),
          conflict: existing.conflicts[0] ? inventoryConflictDto(existing.conflicts[0]) : null,
          replayed: true,
          accountingEntriesCreated: 0
        };
      }
      const observation = await tx.inventorySyncObservation.create({
        data: {
          organizationId: context.organizationId,
          policyId,
          externalObservationId,
          sourceOfTruthSnapshot: policy.sourceOfTruth,
          observedQuantityMicros: observed,
          desiredQuantityMicros: desired,
          providerObservedAt: input.providerObservedAt ?? null,
          evidenceHash,
          safeMetadata
        }
      });
      const conflict =
        desired !== null && desired !== observed
          ? await tx.inventorySyncConflict.create({
              data: {
                organizationId: context.organizationId,
                policyId,
                observationId: observation.id,
                observedQuantityMicros: observed,
                desiredQuantityMicros: desired,
                differenceMicros: desired - observed,
                reason: {
                  code: "EXACT_QUANTITY_MISMATCH",
                  sourceOfTruth: policy.sourceOfTruth,
                  createsInventoryMovement: false
                }
              }
            })
          : null;
      await audit(tx, context, "INVENTORY_SYNC_OBSERVATION_RECORDED", observation.id, {
        policyId,
        conflictId: conflict?.id ?? null,
        createsFinancialEntries: false,
        createsInventoryMovements: false
      });
      return {
        observation: inventoryObservationDto(observation),
        conflict: conflict ? inventoryConflictDto(conflict) : null,
        replayed: false,
        accountingEntriesCreated: 0
      };
    });
  }

  public async recordVariantProviderObservation(
    context: OrganizationContext,
    catalogVariantId: string,
    externalObservationId: string,
    observedQuantityMicros: string,
    providerObservedAt: Date | null,
    safeMetadata: Readonly<Record<string, unknown>> = {}
  ) {
    const policies = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.inventorySyncPolicy.findMany({
        where: {
          organizationId: context.organizationId,
          catalogVariantId,
          enabled: true
        }
      })
    );
    const results = [];
    for (const policy of policies) {
      const balance = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.inventoryBalance.findUnique({
          where: {
            productItemId_locationId: {
              productItemId: policy.productItemId,
              locationId: policy.locationId
            }
          }
        })
      );
      results.push(
        await this.recordInventoryObservation(context, policy.id, {
          externalObservationId: externalObservationId.slice(0, 200),
          observedQuantityMicros,
          desiredQuantityMicros:
            policy.sourceOfTruth === "MANUAL_REVIEW"
              ? (policy.desiredQuantityMicros?.toString() ?? null)
              : (balance?.quantityOnHandMicros ?? 0n).toString(),
          providerObservedAt,
          safeMetadata
        })
      );
    }
    return results;
  }

  public async approveImage(context: OrganizationContext, imageId: string, version: number) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "CatalogImageReference",
      imageId
    );
    const image = await this.imageWithInstallation(context, imageId);
    await this.imageIngestion.validateBoundary(imageBoundary(image));
    return this.transitionImage(context, imageId, version, "APPROVED", null);
  }

  public async rejectImage(
    context: OrganizationContext,
    imageId: string,
    version: number,
    reason?: string
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "CatalogImageReference",
      imageId
    );
    return this.transitionImage(context, imageId, version, "REJECTED", reason?.trim() || null);
  }

  public async ingestApprovedImage(context: OrganizationContext, imageId: string, version: number) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "CatalogImageReference",
      imageId
    );
    const image = await this.imageWithInstallation(context, imageId);
    if (image.status !== "APPROVED" || image.version !== version)
      throw new AppError(
        "CATALOG_IMAGE_NOT_APPROVED",
        "Only the current approved image version can be ingested.",
        409
      );
    if (!this.productImages)
      throw new AppError(
        "CATALOG_IMAGE_STORAGE_UNAVAILABLE",
        "Product image storage is not configured for catalog ingestion.",
        503
      );
    if (await this.productImages.hasStoredCatalogImage(context, imageId, version))
      return this.productImages.markStoredCatalogImageIngested(context, imageId, version);
    const evidence = await this.imageIngestion.ingest(imageBoundary(image));
    return this.productImages.storeApprovedCatalogImage(context, imageId, version, evidence);
  }

  public async ignoreInventoryConflict(
    context: OrganizationContext,
    conflictId: string,
    version: number,
    reason: string
  ) {
    await this.authorization.assert(
      context,
      "inventory:configure",
      "InventorySyncConflict",
      conflictId
    );
    return this.finishConflict(context, conflictId, version, "IGNORED", reason, {
      resolution: "EXPLICIT_IGNORE",
      accountingEntriesCreated: 0
    });
  }

  public async enqueueLocalInventoryPush(
    context: OrganizationContext,
    conflictId: string,
    version: number
  ) {
    await this.authorization.assert(
      context,
      "inventory:configure",
      "InventorySyncConflict",
      conflictId
    );
    await this.authorization.assert(context, "integrations:manage", "ConnectorInstallation");
    return withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        const conflict = await tx.inventorySyncConflict.findFirst({
          where: {
            id: conflictId,
            organizationId: context.organizationId,
            status: "OPEN",
            version
          },
          include: {
            observation: true,
            policy: { include: { variant: { include: { product: true } } } }
          }
        });
        if (!conflict)
          throw new AppError("STALE_INVENTORY_SYNC_CONFLICT", "Conflict was changed.", 409);
        if (conflict.policy.sourceOfTruth !== "LOCAL" || !conflict.policy.enabled)
          throw new AppError(
            "INVENTORY_SYNC_POLICY_INVALID",
            "Only an enabled local-source policy can push stock to a channel.",
            422
          );
        const balance = await tx.inventoryBalance.findUnique({
          where: {
            productItemId_locationId: {
              productItemId: conflict.policy.productItemId,
              locationId: conflict.policy.locationId
            }
          }
        });
        const quantityMicros = (balance?.quantityOnHandMicros ?? 0n).toString();
        const desiredHash = hashJson({
          policyId: conflict.policyId,
          policyVersion: conflict.policy.version,
          productItemId: conflict.policy.productItemId,
          locationId: conflict.policy.locationId,
          quantityMicros
        });
        const pending = await tx.outboxEvent.findFirst({
          where: {
            organizationId: context.organizationId,
            eventType: "catalog.inventory-write-requested",
            aggregateType: "InventorySyncConflict",
            aggregateId: conflict.id,
            status: { in: ["PENDING", "FAILED"] }
          },
          orderBy: { occurredAt: "desc" }
        });
        if (pending) return { operation: inventoryOperationDto(pending), replayed: true };
        const idempotencyKey = hashJson({
          conflictId: conflict.id,
          conflictVersion: conflict.version,
          desiredHash,
          observedHash: conflict.observation.evidenceHash
        });
        const operation = await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "catalog.inventory-write-requested",
            aggregateType: "InventorySyncConflict",
            aggregateId: conflict.id,
            payload: {
              version: 1,
              policyId: conflict.policyId,
              conflictId: conflict.id,
              conflictVersion: conflict.version,
              installationId: conflict.policy.installationId,
              externalProductId: conflict.policy.variant.product.externalProductId,
              externalVariantId: conflict.policy.variant.externalVariantId,
              quantityMicros,
              expectedQuantityMicros: conflict.observedQuantityMicros.toString(),
              desiredHash,
              observedHash: conflict.observation.evidenceHash,
              idempotencyKey,
              accountingEntriesCreated: 0
            }
          }
        });
        await tx.inventorySyncPolicy.updateMany({
          where: {
            id: conflict.policyId,
            organizationId: context.organizationId,
            version: conflict.policy.version
          },
          data: {
            desiredQuantityMicros: BigInt(quantityMicros),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await audit(tx, context, "INVENTORY_SYNC_OPERATION_QUEUED", operation.id, {
          conflictId: conflict.id,
          desiredHash,
          observedHash: conflict.observation.evidenceHash,
          accountingEntriesCreated: 0
        });
        return { operation: inventoryOperationDto(operation), replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async retryInventoryOperation(context: OrganizationContext, operationId: string) {
    await this.authorization.assert(context, "integrations:manage", "OutboxEvent", operationId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.outboxEvent.updateMany({
        where: {
          id: operationId,
          organizationId: context.organizationId,
          eventType: "catalog.inventory-write-requested",
          status: "FAILED",
          attempts: { lt: 5 }
        },
        data: { status: "PENDING", dispatchedAt: null }
      });
      if (result.count !== 1)
        throw new AppError(
          "INVENTORY_SYNC_OPERATION_NOT_RETRYABLE",
          "The inventory operation is not retryable.",
          409
        );
      const operation = await tx.outboxEvent.findFirstOrThrow({
        where: { id: operationId, organizationId: context.organizationId }
      });
      await audit(tx, context, "INVENTORY_SYNC_OPERATION_RETRIED", operationId, {
        attempts: operation.attempts,
        accountingEntriesCreated: 0
      });
      return inventoryOperationDto(operation);
    });
  }

  public async adoptChannelInventory(
    context: OrganizationContext,
    conflictId: string,
    version: number,
    input: {
      readonly effectiveDate: string;
      readonly reason: string;
      readonly unitCostMinor?: string;
      readonly idempotencyKey?: string;
    }
  ) {
    await this.authorization.assert(
      context,
      "inventory:configure",
      "InventorySyncConflict",
      conflictId
    );
    const snapshot = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const conflict = await tx.inventorySyncConflict.findFirst({
        where: { id: conflictId, organizationId: context.organizationId, status: "OPEN", version },
        include: { policy: true }
      });
      if (!conflict)
        throw new AppError("STALE_INVENTORY_SYNC_CONFLICT", "Conflict was changed.", 409);
      if (conflict.policy.sourceOfTruth !== "CHANNEL")
        throw new AppError(
          "INVENTORY_SYNC_POLICY_INVALID",
          "Only a channel-source policy can adopt channel stock locally.",
          422
        );
      const balance = await tx.inventoryBalance.findUnique({
        where: {
          productItemId_locationId: {
            productItemId: conflict.policy.productItemId,
            locationId: conflict.policy.locationId
          }
        }
      });
      return { conflict, current: balance?.quantityOnHandMicros ?? 0n };
    });
    const delta = snapshot.conflict.observedQuantityMicros - snapshot.current;
    let movement: unknown = null;
    if (delta !== 0n) {
      movement = await this.inventory.adjust(
        context,
        {
          productItemId: snapshot.conflict.policy.productItemId,
          locationId: snapshot.conflict.policy.locationId,
          direction: delta > 0n ? "IN" : "OUT",
          quantity: microsToDecimal(delta < 0n ? -delta : delta),
          ...(delta > 0n ? { unitCostMinor: input.unitCostMinor } : {}),
          adjustmentKind: "COUNT_CORRECTION",
          effectiveDate: input.effectiveDate,
          reason: input.reason
        },
        input.idempotencyKey
      );
    }
    const conflict = await this.finishConflict(
      context,
      conflictId,
      version,
      "RESOLVED",
      input.reason,
      {
        resolution: "CHANNEL_ADOPTED_LOCALLY",
        inventoryMovementCreated: delta !== 0n
      }
    );
    return { conflict, movement };
  }

  public async completeProviderInventoryOperation(
    context: OrganizationContext,
    operationId: string,
    input: { readonly observedQuantityMicros: string; readonly externalOperationId: string | null }
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const operation = await tx.outboxEvent.findFirst({
        where: {
          id: operationId,
          organizationId: context.organizationId,
          eventType: "catalog.inventory-write-requested"
        }
      });
      if (!operation || !operation.aggregateId)
        throw new AppError("INVENTORY_SYNC_OPERATION_NOT_FOUND", "Operation was not found.", 404);
      const payload = jsonObject(operation.payload, "inventory operation");
      const conflictVersion = jsonInteger(payload.conflictVersion, "conflict version");
      const changed = await tx.inventorySyncConflict.updateMany({
        where: {
          id: operation.aggregateId,
          organizationId: context.organizationId,
          status: "OPEN",
          version: conflictVersion
        },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedByUserId: context.user.id,
          version: { increment: 1 },
          reason: {
            code: "PROVIDER_WRITE_CONFIRMED",
            externalOperationId: input.externalOperationId,
            observedQuantityMicros: input.observedQuantityMicros,
            desiredHash: payload.desiredHash,
            observedHash: payload.observedHash,
            accountingEntriesCreated: 0
          }
        }
      });
      if (changed.count !== 1)
        throw new AppError("STALE_INVENTORY_SYNC_CONFLICT", "Conflict was changed.", 409);
      await tx.outboxEvent.updateMany({
        where: { id: operationId, organizationId: context.organizationId },
        data: { status: "DISPATCHED", dispatchedAt: new Date() }
      });
      const conflict = await tx.inventorySyncConflict.findFirstOrThrow({
        where: { id: operation.aggregateId, organizationId: context.organizationId }
      });
      await audit(tx, context, "INVENTORY_SYNC_OPERATION_COMPLETED", operationId, {
        conflictId: conflict.id,
        externalOperationId: input.externalOperationId,
        accountingEntriesCreated: 0
      });
      return inventoryConflictDto(conflict);
    });
  }

  private async imageWithInstallation(context: OrganizationContext, imageId: string) {
    const image = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.catalogImageReference.findFirst({
        where: { id: imageId, organizationId: context.organizationId },
        include: {
          product: {
            include: {
              installation: { select: { providerKey: true, externalAccountId: true } }
            }
          }
        }
      })
    );
    if (!image) throw new AppError("CATALOG_IMAGE_NOT_FOUND", "Catalog image was not found.", 404);
    return image;
  }

  private async transitionImage(
    context: OrganizationContext,
    imageId: string,
    version: number,
    status: "APPROVED" | "REJECTED" | "INGESTED",
    reason: string | null
  ) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw new AppError("CATALOG_IMAGE_VERSION_INVALID", "Image version is invalid.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.catalogImageReference.findFirst({
        where: { id: imageId, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("CATALOG_IMAGE_NOT_FOUND", "Catalog image was not found.", 404);
      const allowed =
        status === "APPROVED"
          ? current.status === "OBSERVED"
          : status === "INGESTED"
            ? current.status === "APPROVED"
            : current.status !== "INGESTED";
      if (!allowed)
        throw new AppError(
          "CATALOG_IMAGE_TRANSITION_INVALID",
          "Image status cannot be changed.",
          409
        );
      const metadata = sanitizeMetadata({
        ...(current.safeMetadata &&
        typeof current.safeMetadata === "object" &&
        !Array.isArray(current.safeMetadata)
          ? current.safeMetadata
          : {}),
        ...(reason ? { rejectionReason: reason.slice(0, 500) } : {})
      });
      const changed = await tx.catalogImageReference.updateMany({
        where: { id: imageId, organizationId: context.organizationId, version },
        data: {
          status,
          safeMetadata: metadata,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new AppError("STALE_CATALOG_IMAGE", "Image was changed.", 409);
      const row = await tx.catalogImageReference.findFirstOrThrow({
        where: { id: imageId, organizationId: context.organizationId }
      });
      await audit(tx, context, `CATALOG_IMAGE_${status}`, imageId, {
        status,
        matchingAuthority: false,
        accountingEntriesCreated: 0
      });
      return catalogImageDto(row);
    });
  }

  private async finishConflict(
    context: OrganizationContext,
    conflictId: string,
    version: number,
    status: "RESOLVED" | "IGNORED",
    reason: string,
    evidence: Record<string, unknown>
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.inventorySyncConflict.findFirst({
        where: { id: conflictId, organizationId: context.organizationId, status: "OPEN" }
      });
      if (!current)
        throw new AppError("INVENTORY_SYNC_CONFLICT_NOT_FOUND", "Conflict was not found.", 404);
      const changed = await tx.inventorySyncConflict.updateMany({
        where: { id: conflictId, organizationId: context.organizationId, status: "OPEN", version },
        data: {
          status,
          resolvedAt: new Date(),
          resolvedByUserId: context.user.id,
          reason: sanitizeMetadata({
            original: current.reason,
            reason: reason.slice(0, 1000),
            ...evidence
          }),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError("STALE_INVENTORY_SYNC_CONFLICT", "Conflict was changed.", 409);
      const row = await tx.inventorySyncConflict.findFirstOrThrow({
        where: { id: conflictId, organizationId: context.organizationId }
      });
      await audit(tx, context, `INVENTORY_SYNC_CONFLICT_${status}`, conflictId, {
        reason: reason.slice(0, 1000),
        ...sanitizeMetadata(evidence)
      });
      return inventoryConflictDto(row);
    });
  }

  private async transitionCandidate(
    context: OrganizationContext,
    candidateId: string,
    version: number,
    toStatus: "CONFIRMED" | "REJECTED",
    reason?: string
  ) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw new AppError("CATALOG_MATCH_VERSION_INVALID", "Candidate version is invalid.", 422);
    try {
      const outcome = await withTenantTransaction(
        this.prisma,
        dbContext(context),
        async (tx) => {
          const current = await tx.catalogMatchCandidate.findFirst({
            where: { id: candidateId, organizationId: context.organizationId },
            include: {
              variant: {
                select: {
                  installationId: true,
                  externalVariantId: true,
                  externalReferenceAliases: true,
                  sku: true,
                  product: {
                    select: {
                      externalProductId: true,
                      _count: { select: { variants: true } }
                    }
                  }
                }
              }
            }
          });
          if (!current)
            throw new AppError("CATALOG_MATCH_NOT_FOUND", "Match candidate was not found.", 404);
          const connectorMapping = await synchronizeConfirmedCatalogMapping(
            tx,
            context,
            current,
            toStatus
          );
          if (connectorMapping.conflict)
            return {
              kind: "MAPPING_CONFLICT" as const,
              conflictId: connectorMapping.conflictId,
              sourceReference: connectorMapping.sourceReference,
              mappingType: connectorMapping.mappingType,
              existingMappingSource: connectorMapping.existingMappingSource
            };
          if (current.status === toStatus)
            return {
              kind: "CANDIDATE" as const,
              candidate: await tx.catalogMatchCandidate.findFirstOrThrow({
                where: { id: candidateId, organizationId: context.organizationId }
              })
            };
          const updated = await tx.catalogMatchCandidate.updateMany({
            where: { id: candidateId, organizationId: context.organizationId, version },
            data: {
              status: toStatus,
              resolvedAt: new Date(),
              resolvedByUserId: context.user.id,
              version: { increment: 1 }
            }
          });
          if (updated.count !== 1)
            throw new AppError("STALE_CATALOG_MATCH", "Match candidate was changed.", 409);
          const row = await tx.catalogMatchCandidate.findFirstOrThrow({
            where: { id: candidateId, organizationId: context.organizationId }
          });
          await tx.catalogMatchDecision.create({
            data: {
              organizationId: context.organizationId,
              candidateId,
              fromStatus: current.status,
              toStatus,
              candidateVersion: row.version,
              actorUserId: context.user.id,
              reason: reason?.trim() || null,
              evidence: {
                score: current.score,
                candidateReason: current.reason,
                explicitHumanDecision: true
              }
            }
          });
          await audit(tx, context, `CATALOG_MATCH_${toStatus}`, candidateId, {
            catalogVariantId: row.catalogVariantId,
            productItemId: row.productItemId,
            fromStatus: current.status,
            toStatus,
            version: row.version
          });
          return { kind: "CANDIDATE" as const, candidate: row };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      if (outcome.kind === "MAPPING_CONFLICT")
        throw new AppError(
          "CATALOG_ITEM_MAPPING_CONFLICT",
          "This source item identifier already maps to another local product. Resolve the connector conflict before confirming this match.",
          409,
          {
            conflictId: outcome.conflictId,
            sourceReference: outcome.sourceReference,
            mappingType: outcome.mappingType,
            existingMappingSource: outcome.existingMappingSource,
            candidateId
          }
        );
      return outcome.candidate;
    } catch (error) {
      if (isUnique(error) && toStatus === "CONFIRMED")
        throw new AppError(
          "CATALOG_VARIANT_ALREADY_CONFIRMED",
          "This external variant already has a confirmed local product.",
          409
        );
      if (isSerializationFailure(error))
        throw new AppError("CATALOG_MATCH_RETRY", "Concurrent match update; retry.", 409);
      throw error;
    }
  }
}

async function synchronizeConfirmedCatalogMapping(
  tx: RuntimeTransaction,
  context: OrganizationContext,
  candidate: {
    id: string;
    productItemId: string;
    catalogVariantId: string;
    variant: {
      installationId: string;
      externalVariantId: string;
      externalReferenceAliases: Prisma.JsonValue;
      sku: string | null;
      product: {
        externalProductId: string;
        _count: { variants: number };
      };
    };
  },
  toStatus: "CONFIRMED" | "REJECTED"
): Promise<
  | { readonly conflict: false }
  | {
      readonly conflict: true;
      readonly conflictId: string;
      readonly sourceReference: string;
      readonly mappingType: CatalogMappingBridge["mappingType"];
      readonly existingMappingSource: string;
    }
> {
  const installation = await tx.connectorInstallation.findFirst({
    where: {
      id: candidate.variant.installationId,
      organizationId: context.organizationId
    }
  });
  if (!installation)
    throw new AppError("CONNECTOR_NOT_FOUND", "Connector installation was not found.", 404);
  const mapping = connectorMappingObject(installation.mapping);
  const bridges = catalogMappingBridges(candidate.variant);

  if (toStatus === "REJECTED") {
    let nextMapping = mapping;
    let changed = false;
    for (const bridge of bridges) {
      const confirmedMappings = nestedConnectorMappings(nextMapping[bridge.confirmedKey]);
      if (confirmedMappings?.[bridge.externalRef] !== candidate.productItemId) continue;
      nextMapping = {
        ...nextMapping,
        [bridge.confirmedKey]: Object.fromEntries(
          Object.entries(confirmedMappings).filter(([key]) => key !== bridge.externalRef)
        )
      };
      changed = true;
    }
    if (changed) {
      await updateCatalogConnectorMapping(tx, context, installation, {
        ...nextMapping
      });
      await audit(tx, context, "CATALOG_MATCH_CONNECTOR_MAPPING_REMOVED", candidate.id, {
        installationId: installation.id,
        catalogVariantId: candidate.catalogVariantId,
        removedReferenceCount: bridges.length,
        productItemId: candidate.productItemId
      });
    }
    await resolveCatalogMappingConflicts(tx, context, installation.id, bridges);
    return { conflict: false };
  }

  const conflicts = bridges.flatMap((bridge) => {
    const manualMappings = nestedConnectorMappings(mapping[bridge.manualKey]);
    const confirmedMappings = nestedConnectorMappings(mapping[bridge.confirmedKey]);
    const invalidManualContainer =
      mapping[bridge.manualKey] !== undefined && manualMappings === null;
    const invalidConfirmedContainer =
      mapping[bridge.confirmedKey] !== undefined && confirmedMappings === null;
    const manualTarget = manualMappings?.[bridge.externalRef];
    const confirmedTarget = confirmedMappings?.[bridge.externalRef];
    const manualConflict =
      manualTarget !== undefined &&
      (typeof manualTarget !== "string" || manualTarget !== candidate.productItemId);
    const confirmedConflict =
      confirmedTarget !== undefined &&
      (typeof confirmedTarget !== "string" || confirmedTarget !== candidate.productItemId);
    const existingMappingSource = invalidManualContainer
      ? `${bridge.manualKey} (invalid)`
      : invalidConfirmedContainer
        ? `${bridge.confirmedKey} (invalid)`
        : manualConflict
          ? bridge.manualKey
          : confirmedConflict
            ? bridge.confirmedKey
            : null;
    return existingMappingSource ? [{ bridge, existingMappingSource }] : [];
  });
  if (conflicts.length > 0) {
    const persistedConflicts = [];
    for (const { bridge, existingMappingSource } of conflicts) {
      const detail = {
        message: `A confirmed catalog match would overwrite a different connector ${bridge.mappingType} mapping.`,
        catalogVariantId: candidate.catalogVariantId,
        candidateId: candidate.id,
        requestedProductItemId: candidate.productItemId,
        mappingType: bridge.mappingType,
        existingMappingSource
      };
      persistedConflicts.push({
        bridge,
        existingMappingSource,
        conflict: await tx.connectorConflict.upsert({
          where: {
            installationId_externalRef_kind: {
              installationId: installation.id,
              externalRef: bridge.externalRef,
              kind: bridge.conflictKind
            }
          },
          create: {
            organizationId: context.organizationId,
            installationId: installation.id,
            externalRef: bridge.externalRef,
            kind: bridge.conflictKind,
            detailRedacted: detail
          },
          update: {
            status: "OPEN",
            resolvedAt: null,
            resolvedByUserId: null,
            detailRedacted: detail
          }
        })
      });
    }
    const first = persistedConflicts[0]!;
    await audit(tx, context, "CATALOG_MATCH_CONFIRMATION_BLOCKED", candidate.id, {
      installationId: installation.id,
      catalogVariantId: candidate.catalogVariantId,
      conflictIds: persistedConflicts.map((entry) => entry.conflict.id),
      sourceReference: first.bridge.externalRef,
      mappingType: first.bridge.mappingType,
      existingMappingSource: first.existingMappingSource
    });
    return {
      conflict: true,
      conflictId: first.conflict.id,
      sourceReference: first.bridge.externalRef,
      mappingType: first.bridge.mappingType,
      existingMappingSource: first.existingMappingSource
    };
  }

  let nextMapping = mapping;
  let changed = false;
  for (const bridge of bridges) {
    const confirmedMappings = nestedConnectorMappings(nextMapping[bridge.confirmedKey]) ?? {};
    if (confirmedMappings[bridge.externalRef] === candidate.productItemId) continue;
    nextMapping = {
      ...nextMapping,
      [bridge.confirmedKey]: {
        ...confirmedMappings,
        [bridge.externalRef]: candidate.productItemId
      }
    };
    changed = true;
  }
  if (changed) {
    await updateCatalogConnectorMapping(tx, context, installation, nextMapping);
    await audit(tx, context, "CATALOG_MATCH_CONNECTOR_MAPPING_SYNCED", candidate.id, {
      installationId: installation.id,
      catalogVariantId: candidate.catalogVariantId,
      mappedReferences: bridges.map((bridge) => ({
        mappingType: bridge.mappingType,
        externalRef: bridge.externalRef
      })),
      productItemId: candidate.productItemId
    });
  }
  await resolveCatalogMappingConflicts(tx, context, installation.id, bridges);
  return { conflict: false };
}

type CatalogMappingKey =
  | "variantMappings"
  | "catalogVariantMappings"
  | "productMappings"
  | "catalogProductMappings"
  | "skuMappings"
  | "catalogSkuMappings";

interface CatalogMappingBridge {
  readonly mappingType: "VARIANT_ID" | "PRODUCT_ID" | "SKU";
  readonly externalRef: string;
  readonly manualKey: CatalogMappingKey;
  readonly confirmedKey: CatalogMappingKey;
  readonly conflictKind:
    | "CATALOG_VARIANT_MAPPING_CONFLICT"
    | "CATALOG_PRODUCT_MAPPING_CONFLICT"
    | "CATALOG_SKU_MAPPING_CONFLICT";
}

function catalogMappingBridges(variant: {
  externalVariantId: string;
  externalReferenceAliases: Prisma.JsonValue;
  sku: string | null;
  product: { externalProductId: string; _count: { variants: number } };
}): readonly CatalogMappingBridge[] {
  const aliases = externalReferenceAliases(variant.externalReferenceAliases);
  const variantReferences = [...new Set([variant.externalVariantId, ...aliases])];
  const bridges: CatalogMappingBridge[] = variantReferences.map((externalRef) => ({
    mappingType: "VARIANT_ID",
    externalRef,
    manualKey: "variantMappings",
    confirmedKey: "catalogVariantMappings",
    conflictKind: "CATALOG_VARIANT_MAPPING_CONFLICT"
  }));
  if (variant.product._count.variants === 1)
    bridges.push({
      mappingType: "PRODUCT_ID",
      externalRef: variant.product.externalProductId,
      manualKey: "productMappings",
      confirmedKey: "catalogProductMappings",
      conflictKind: "CATALOG_PRODUCT_MAPPING_CONFLICT"
    });
  const sourceSku = variant.sku?.trim();
  if (sourceSku)
    bridges.push({
      mappingType: "SKU",
      externalRef: sourceSku,
      manualKey: "skuMappings",
      confirmedKey: "catalogSkuMappings",
      conflictKind: "CATALOG_SKU_MAPPING_CONFLICT"
    });
  return bridges;
}

async function updateCatalogConnectorMapping(
  tx: RuntimeTransaction,
  context: OrganizationContext,
  installation: { id: string; mappingVersion: number },
  mapping: Record<string, Prisma.JsonValue>
) {
  const updated = await tx.connectorInstallation.updateMany({
    where: {
      id: installation.id,
      organizationId: context.organizationId,
      mappingVersion: installation.mappingVersion
    },
    data: {
      mapping,
      mappingVersion: { increment: 1 }
    }
  });
  if (updated.count !== 1)
    throw new AppError(
      "STALE_CONNECTOR_MAPPING",
      "The connector mapping changed while the catalog match was being confirmed.",
      409
    );
}

async function resolveCatalogMappingConflicts(
  tx: RuntimeTransaction,
  context: OrganizationContext,
  installationId: string,
  bridges: readonly CatalogMappingBridge[]
) {
  for (const bridge of bridges)
    await tx.connectorConflict.updateMany({
      where: {
        organizationId: context.organizationId,
        installationId,
        externalRef: bridge.externalRef,
        kind: bridge.conflictKind,
        status: "OPEN"
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedByUserId: context.user.id
      }
    });
}

function connectorMappingObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(
      "CATALOG_CONNECTOR_MAPPING_INVALID",
      "The connector mapping is invalid and must be repaired before confirming item matches.",
      409
    );
  return value as Record<string, Prisma.JsonValue>;
}

function nestedConnectorMappings(
  value: Prisma.JsonValue | undefined
): Record<string, Prisma.JsonValue> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

function externalReferenceAliases(value: Prisma.JsonValue): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 200)
  )
    throw new AppError(
      "CATALOG_REFERENCE_ALIASES_INVALID",
      "Stored catalog reference aliases are invalid and must be refreshed.",
      409
    );
  return value.filter((entry): entry is string => typeof entry === "string");
}

function validateApprovedSkuAlias(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 200 || normalized.includes(String.fromCharCode(0)))
    throw new AppError("CATALOG_SKU_ALIAS_INVALID", "The approved source SKU is invalid.", 422);
  return normalized;
}

function validateQuantityMultiplier(value: string | null | undefined): string {
  const normalized = value?.trim() || "1000000";
  if (!/^[1-9]\d{0,17}$/.test(normalized))
    throw new AppError(
      "CATALOG_QUANTITY_MULTIPLIER_INVALID",
      "Quantity multipliers must be a positive integer number of micros.",
      422
    );
  return normalized;
}

function normalizeApprovedSkuPattern(input: CatalogSkuPatternApprovalInput) {
  const name = input.name.normalize("NFKC").trim();
  const prefix = input.prefix?.normalize("NFKC").trim() || null;
  const suffix = input.suffix?.normalize("NFKC").trim() || null;
  if (!name || name.length > 120 || (!prefix && !suffix))
    throw new AppError(
      "CATALOG_SKU_PATTERN_INVALID",
      "A pattern needs a name and an anchored prefix or suffix.",
      422
    );
  for (const value of [prefix, suffix])
    if (value && !/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,79}$/.test(value))
      throw new AppError(
        "CATALOG_SKU_PATTERN_INVALID",
        "Patterns may use only safe anchored prefix or suffix text.",
        422
      );
  const priority = input.priority ?? 100;
  if (!Number.isInteger(priority) || priority < 0 || priority > 10_000)
    throw new AppError("CATALOG_SKU_PATTERN_INVALID", "Pattern priority is invalid.", 422);
  return {
    name,
    prefix,
    suffix,
    caseSensitive: input.caseSensitive !== false,
    priority
  };
}

export interface CatalogSourceIdentifierPolicy {
  readonly providerKey: string;
  readonly skuCaseSensitive: boolean;
}

/**
 * Source policy is deliberately centralized.  The stored source SKU is never
 * rewritten; this value is only used for comparison and indexed candidate
 * retrieval.  Unknown providers default to case-sensitive semantics because
 * treating distinct source identifiers as equal is the unsafe failure mode.
 */
export function catalogSourceIdentifierPolicy(
  providerKey: string | null | undefined
): CatalogSourceIdentifierPolicy {
  const normalized = providerKey?.trim().toUpperCase() ?? "";
  const caseInsensitive = new Set(["WOOCOMMERCE", "WAVE", "FRESHBOOKS", "ZOHO_BOOKS"]);
  return {
    providerKey: normalized || "UNKNOWN",
    skuCaseSensitive: !caseInsensitive.has(normalized)
  };
}

export function normalizeSourceScopedSku(
  value: string | null | undefined,
  policyOrProvider?: CatalogSourceIdentifierPolicy | string | null
): string | null {
  if (value == null) return null;
  const policy =
    typeof policyOrProvider === "object" && policyOrProvider !== null
      ? policyOrProvider
      : catalogSourceIdentifierPolicy(policyOrProvider);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return null;
  return policy.skuCaseSensitive ? normalized : normalized.toLocaleUpperCase("en-CA");
}

export function extractApprovedSkuPattern(
  sourceSku: string | null | undefined,
  rule: {
    readonly prefix?: string | null;
    readonly suffix?: string | null;
    readonly caseSensitive?: boolean;
  }
): string | null {
  const source = sourceSku?.normalize("NFKC").trim();
  if (!source) return null;
  const prefix = rule.prefix?.normalize("NFKC").trim() ?? "";
  const suffix = rule.suffix?.normalize("NFKC").trim() ?? "";
  if (!prefix && !suffix) return null;
  const compare =
    rule.caseSensitive === false
      ? (value: string) => value.toUpperCase()
      : (value: string) => value;
  const comparableSource = compare(source);
  const comparablePrefix = compare(prefix);
  const comparableSuffix = compare(suffix);
  if (prefix && !comparableSource.startsWith(comparablePrefix)) return null;
  if (suffix && !comparableSource.endsWith(comparableSuffix)) return null;
  const start = prefix.length;
  const end = source.length - suffix.length;
  if (end <= start) return null;
  const base = source.slice(start, end).trim();
  return base || null;
}

function sourceSkuEquals(observed: CatalogRankObserved, local: CatalogRankLocal): boolean {
  const observedSku = normalizeSourceScopedSku(
    observed.sourceSku,
    catalogSourceIdentifierPolicy(observed.sourceProviderKey)
  );
  const localSku = normalizeSourceScopedSku(
    local.sku,
    catalogSourceIdentifierPolicy(observed.sourceProviderKey)
  );
  if (observedSku && localSku) return observedSku === localSku;
  return Boolean(observed.normalizedSku && observed.normalizedSku === local.normalizedSku);
}

export function normalizeVariantSignature(
  signature: Readonly<Record<string, string>> | undefined
): { json: Record<string, string>; normalized: string } {
  const entries = Object.entries(signature ?? {})
    .map(
      ([key, value]) =>
        [normalizeCatalogIdentifier(key), normalizeCatalogIdentifier(value)] as const
    )
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    );
  return {
    json: Object.fromEntries(entries),
    normalized: entries.map((entry) => entry.join("=")).join("|")
  };
}

export function normalizeExternalReferenceAliases(
  aliases: readonly string[] | undefined,
  externalVariantId: string
): readonly string[] {
  if ((aliases?.length ?? 0) > 20)
    throw new AppError(
      "CATALOG_REFERENCE_ALIAS_LIMIT",
      "A catalog variant may have at most 20 external reference aliases.",
      422
    );
  return [...new Set((aliases ?? []).map((alias) => requiredIdentifier(alias, "reference alias")))]
    .filter((alias) => alias !== externalVariantId)
    .sort((left, right) => left.localeCompare(right));
}

export function rankCatalogCandidates(
  observed: CatalogRankObserved,
  locals: readonly CatalogRankLocal[]
): RankedCatalogCandidate[] {
  const ranked = locals
    .map((local) => scoreCatalogCandidate(observed, local))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.productItemId.localeCompare(right.productItemId)
    );
  const bestScore = ranked[0]?.score ?? null;
  const secondScore = ranked[1]?.score ?? null;
  const margin = bestScore === null || secondScore === null ? null : bestScore - secondScore;
  return ranked.map((candidate, index) => {
    const candidateMargin = index === 0 ? margin : null;
    const deterministic = candidate.reason.deterministicMatch;
    const ambiguous = candidateMargin !== null && candidateMargin < 1_500 && ranked.length > 1;
    const decisionState: CatalogMatchDecisionState = deterministic
      ? ambiguous
        ? "AMBIGUOUS"
        : "AUTO_MATCH_CANDIDATE"
      : ambiguous
        ? "AMBIGUOUS"
        : "SUGGESTED";
    return {
      ...candidate,
      reason: {
        ...candidate.reason,
        decisionState,
        suggestionMarginBasisPoints: candidateMargin
      }
    };
  });
}

/** Reuses the catalog matcher without persisting or confirming a candidate. */
export async function nearestLocalCatalogSuggestions(
  tx: RuntimeTransaction,
  organizationId: string,
  observed: CatalogRankObserved,
  limit = 5
): Promise<readonly CatalogReviewSuggestion[]> {
  const boundedLimit = Math.max(1, Math.min(10, limit));
  const locals = await databaseSimilarityCandidates(tx, organizationId, observed);
  const localById = new Map(locals.map((local) => [local.id, local]));
  return rankCatalogCandidates(observed, locals)
    .slice(0, boundedLimit)
    .map((candidate) => {
      const local = localById.get(candidate.productItemId)!;
      return {
        ...candidate,
        productItem: {
          id: local.id,
          name: local.name,
          sku: local.sku ?? null,
          description: local.description
        }
      };
    });
}

function scoreCatalogCandidate(
  observed: CatalogRankObserved,
  local: CatalogRankLocal
): RankedCatalogCandidate {
  const matches: CatalogMatchEvidenceCode[] = [];
  const conflicts = catalogMatchConflicts(observed, local);
  const gtin = Boolean(
    observed.normalizedGtin &&
      observed.normalizedGtin === local.normalizedGtin &&
      hasValidGtinCheckDigit(observed.normalizedGtin)
  );
  const manufacturerPart = Boolean(
    observed.normalizedManufacturer &&
      observed.normalizedManufacturerPartNumber &&
      observed.normalizedManufacturer === local.normalizedManufacturer &&
      observed.normalizedManufacturerPartNumber === local.normalizedManufacturerPartNumber
  );
  const sku = sourceSkuEquals(observed, local);
  if (gtin) matches.push("EXACT_GTIN");
  if (manufacturerPart) matches.push("EXACT_MANUFACTURER_PART_NUMBER");
  if (sku) matches.push("NORMALIZED_SKU");
  const skuSimilarityBasisPoints = deterministicSimilarityBasisPoints(
    observed.normalizedSku,
    local.normalizedSku
  );
  const nameSimilarityBasisPoints = deterministicSimilarityBasisPoints(
    normalizeCatalogMatchText(observed.normalizedName, 500),
    normalizeCatalogMatchText(local.name, 500)
  );
  const descriptionSimilarityBasisPoints = deterministicSimilarityBasisPoints(
    normalizeCatalogMatchText(observed.normalizedDescription, 4_000),
    normalizeCatalogMatchText(local.description, 4_000)
  );
  const compositeSimilarityBasisPoints = weightedCompositeBasisPoints([
    { score: skuSimilarityBasisPoints, weight: 45 },
    { score: nameSimilarityBasisPoints, weight: 35 },
    { score: descriptionSimilarityBasisPoints, weight: 20 }
  ]);
  if (!sku && skuSimilarityBasisPoints !== null && skuSimilarityBasisPoints > 0)
    matches.push("SKU_SIMILARITY");
  if (nameSimilarityBasisPoints !== null && nameSimilarityBasisPoints > 0)
    matches.push("NAME_SIMILARITY");
  if (descriptionSimilarityBasisPoints !== null && descriptionSimilarityBasisPoints > 0)
    matches.push("DESCRIPTION_SIMILARITY");
  const score =
    conflicts.length > 0
      ? 0
      : gtin
        ? 100000
        : manufacturerPart
          ? 98000
          : sku
            ? 90000
            : Math.min(79999, compositeSimilarityBasisPoints * 8);
  const deterministicMatch = gtin || manufacturerPart || sku;
  const matchMethod =
    gtin || manufacturerPart ? "EXACT_IDENTIFIER" : sku ? "NORMALIZED_SKU" : "FUZZY";
  return {
    productItemId: local.id,
    score,
    reason: {
      version: 2,
      matches,
      skuSimilarityBasisPoints,
      nameSimilarityBasisPoints,
      descriptionSimilarityBasisPoints,
      compositeSimilarityBasisPoints,
      autoConfirmEligible: false,
      algorithmVersion: "catalog-match-v3",
      decisionState: deterministicMatch ? "AUTO_MATCH_CANDIDATE" : "SUGGESTED",
      deterministicMatch,
      matchedTokens: catalogMatchedTokens(observed, local),
      conflicts,
      suggestionMarginBasisPoints: null,
      matchMethod
    }
  };
}

function catalogMatchConflicts(
  observed: CatalogRankObserved,
  local: CatalogRankLocal
): readonly string[] {
  const conflicts: string[] = [];
  if (
    observed.normalizedGtin &&
    local.normalizedGtin &&
    observed.normalizedGtin !== local.normalizedGtin
  )
    conflicts.push("GTIN_CONFLICT");
  if (
    observed.normalizedManufacturerPartNumber &&
    local.normalizedManufacturerPartNumber &&
    observed.normalizedManufacturerPartNumber !== local.normalizedManufacturerPartNumber
  )
    conflicts.push("MANUFACTURER_PART_NUMBER_CONFLICT");
  const observedAttributes = observed.variantSignature ?? {};
  const localAttributes = inferCatalogAttributes(`${local.name} ${local.sku ?? ""}`);
  for (const [key, value] of Object.entries(observedAttributes)) {
    const comparable = normalizeCatalogMatchText(value, 120);
    const localValue = localAttributes[normalizeCatalogAttributeKey(key)];
    if (comparable && localValue && comparable !== localValue)
      conflicts.push(`${normalizeCatalogAttributeKey(key).toUpperCase()}_CONFLICT`);
  }
  const observedPack = extractPackQuantity(
    `${observed.normalizedName} ${observed.sourceSku ?? ""}`
  );
  const localPack = extractPackQuantity(`${local.name} ${local.sku ?? ""}`);
  if (observedPack !== null && localPack !== null && observedPack !== localPack)
    conflicts.push("PACKAGING_QUANTITY_CONFLICT");
  return [...new Set(conflicts)].sort();
}

function catalogMatchedTokens(
  observed: CatalogRankObserved,
  local: CatalogRankLocal
): readonly string[] {
  const observedTokens = new Set([
    ...meaningfulCatalogTokens(observed.normalizedName),
    ...meaningfulCatalogTokens(observed.normalizedDescription)
  ]);
  const localTokens = new Set([
    ...meaningfulCatalogTokens(local.name),
    ...meaningfulCatalogTokens(local.description)
  ]);
  return [...observedTokens].filter((token) => localTokens.has(token)).sort();
}

function meaningfulCatalogTokens(value: string | null | undefined): readonly string[] {
  const stopWords = new Set(["and", "the", "with", "for", "from", "this", "that"]);
  return (normalizeCatalogMatchText(value, 4_000) ?? "")
    .split(" ")
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function normalizeCatalogAttributeKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, "");
}

function inferCatalogAttributes(value: string): Record<string, string> {
  const normalized = normalizeCatalogMatchText(value, 500) ?? "";
  const result: Record<string, string> = {};
  for (const key of ["size", "colour", "color", "material", "model", "style"]) {
    const token = new RegExp(`\\b${key}\\s*[:=-]?\\s+([a-z0-9][a-z0-9._/-]*)`, "i").exec(
      normalized
    );
    if (token?.[1]) result[normalizeCatalogAttributeKey(key)] = token[1].toLowerCase();
  }
  return result;
}

function extractPackQuantity(value: string): number | null {
  const normalized = normalizeCatalogMatchText(value, 500) ?? "";
  const match = /(?:^|\s|[-_/])(?:pack|pk|case|ct|count)\s*(\d+)(?:$|\s|[-_/])/i.exec(normalized);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function deterministicSimilarityBasisPoints(
  left: string | null,
  right: string | null
): number | null {
  if (!left || !right) return null;
  if (left === right) return 10_000;
  const a = trigrams(left);
  const b = trigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  const denominator = a.size + b.size;
  return Math.floor((20_000 * shared + denominator / 2) / denominator);
}

function weightedCompositeBasisPoints(
  components: readonly { readonly score: number | null; readonly weight: number }[]
): number {
  const available = components.filter(
    (component): component is { score: number; weight: number } => component.score !== null
  );
  const totalWeight = available.reduce((total, component) => total + component.weight, 0);
  if (!totalWeight) return 0;
  const weightedScore = available.reduce(
    (total, component) => total + component.score * component.weight,
    0
  );
  return Math.floor((weightedScore + totalWeight / 2) / totalWeight);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  return new Set(
    Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) =>
      padded.slice(index, index + 3)
    )
  );
}

function normalizeCatalogName(value: string): string {
  return normalizeCatalogMatchText(value, 500) ?? "";
}

function normalizeCatalogMatchText(
  value: string | null | undefined,
  maximumLength: number
): string | null {
  if (value == null) return null;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
  return normalized || null;
}

function normalizeObservedProduct(input: ObservedCatalogProductInput) {
  const externalProductId = requiredIdentifier(input.externalProductId, "external product ID");
  const name = requiredName(input.name, "product name");
  const variants = input.variants.map((variant) => {
    const signature = normalizeVariantSignature(variant.variantSignature);
    const variantName = requiredName(variant.name, "variant name");
    const externalVariantId = requiredIdentifier(variant.externalVariantId, "external variant ID");
    const normalizedSku = normalizeCatalogIdentifier(variant.sku);
    const normalizedGtin = normalizeCatalogIdentifier(variant.gtin);
    const normalizedManufacturer = normalizeCatalogIdentifier(variant.manufacturer);
    const normalizedManufacturerPartNumber = normalizeCatalogIdentifier(
      variant.manufacturerPartNumber
    );
    return {
      externalVariantId,
      externalReferenceAliases: normalizeExternalReferenceAliases(
        variant.externalReferenceAliases,
        externalVariantId
      ),
      name: variantName,
      normalizedName: normalizeCatalogName(variantName),
      sku: optionalText(variant.sku, 200),
      normalizedSku,
      gtin: optionalText(variant.gtin, 32),
      normalizedGtin,
      manufacturer: optionalText(variant.manufacturer, 200),
      normalizedManufacturer,
      manufacturerPartNumber: optionalText(variant.manufacturerPartNumber, 200),
      normalizedManufacturerPartNumber,
      variantSignature: signature.json,
      normalizedVariantSignature: signature.normalized,
      sourceStatus: optionalText(variant.sourceStatus, 80),
      providerUpdatedAt: validDate(variant.providerUpdatedAt, "variant provider update"),
      images: normalizeImages(variant.images)
    };
  });
  if (!variants.length)
    throw new AppError(
      "CATALOG_VARIANT_REQUIRED",
      "At least one catalog variant is required.",
      422
    );
  const variantIds = new Set(variants.map((variant) => variant.externalVariantId));
  if (variantIds.size !== variants.length)
    throw new AppError("CATALOG_VARIANT_DUPLICATE", "External variant IDs must be unique.", 422);
  return {
    externalProductId,
    name,
    normalizedName: normalizeCatalogName(name),
    description: optionalText(input.description, 20_000),
    sourceStatus: optionalText(input.sourceStatus, 80),
    sourceUrl: input.sourceUrl ? sanitizeRemoteUrl(input.sourceUrl) : null,
    providerUpdatedAt: validDate(input.providerUpdatedAt, "product provider update"),
    images: normalizeImages(input.images),
    variants
  };
}

function normalizeImages(images: readonly ObservedCatalogImageInput[] | undefined) {
  return (images ?? []).map((image) => {
    const remoteUrl = sanitizeRemoteUrl(image.remoteUrl);
    return {
      externalImageId: requiredIdentifier(image.externalImageId, "external image ID"),
      remoteUrl,
      urlHash: createHash("sha256").update(remoteUrl).digest("hex"),
      contentTypeHint: optionalText(image.contentTypeHint, 120),
      byteLengthHint: optionalBigInt(image.byteLengthHint, "image byte length"),
      width: positiveInteger(image.width, "image width"),
      height: positiveInteger(image.height, "image height"),
      position:
        image.position === undefined ? 0 : nonnegativeInteger(image.position, "image position"),
      safeMetadata: sanitizeMetadata(image.safeMetadata ?? {})
    };
  });
}

async function upsertObservedProduct(
  tx: RuntimeTransaction,
  organizationId: string,
  installationId: string,
  input: ReturnType<typeof normalizeObservedProduct>
) {
  const sourceHash = hashJson({ ...input, images: undefined, variants: undefined });
  const current = await tx.externalCatalogProduct.findUnique({
    where: {
      installationId_externalProductId: {
        installationId,
        externalProductId: input.externalProductId
      }
    }
  });
  if (!current)
    return tx.externalCatalogProduct.create({
      data: {
        organizationId,
        installationId,
        externalProductId: input.externalProductId,
        name: input.name,
        normalizedName: input.normalizedName,
        description: input.description,
        sourceStatus: input.sourceStatus,
        sourceUrl: input.sourceUrl,
        sourceHash,
        providerUpdatedAt: input.providerUpdatedAt
      }
    });
  if (current.organizationId !== organizationId)
    throw new AppError("CATALOG_PRODUCT_NOT_FOUND", "Catalog product was not found.", 404);
  return tx.externalCatalogProduct.update({
    where: { id: current.id },
    data: {
      name: input.name,
      normalizedName: input.normalizedName,
      description: input.description,
      sourceStatus: input.sourceStatus,
      sourceUrl: input.sourceUrl,
      sourceHash,
      providerUpdatedAt: input.providerUpdatedAt,
      lastObservedAt: new Date(),
      ...(current.sourceHash === sourceHash ? {} : { version: { increment: 1 } })
    }
  });
}

async function upsertObservedVariant(
  tx: RuntimeTransaction,
  organizationId: string,
  installationId: string,
  catalogProductId: string,
  input: ReturnType<typeof normalizeObservedProduct>["variants"][number]
) {
  const sourceHash = hashJson({ ...input, images: undefined });
  const current = await tx.externalCatalogVariant.findUnique({
    where: {
      installationId_externalVariantId: {
        installationId,
        externalVariantId: input.externalVariantId
      }
    }
  });
  const data = {
    catalogProductId,
    name: input.name,
    normalizedName: input.normalizedName,
    sku: input.sku,
    normalizedSku: input.normalizedSku,
    gtin: input.gtin,
    normalizedGtin: input.normalizedGtin,
    manufacturer: input.manufacturer,
    normalizedManufacturer: input.normalizedManufacturer,
    manufacturerPartNumber: input.manufacturerPartNumber,
    normalizedManufacturerPartNumber: input.normalizedManufacturerPartNumber,
    variantSignature: input.variantSignature,
    normalizedVariantSignature: input.normalizedVariantSignature,
    externalReferenceAliases: input.externalReferenceAliases,
    sourceStatus: input.sourceStatus,
    sourceHash,
    providerUpdatedAt: input.providerUpdatedAt
  };
  if (!current)
    return tx.externalCatalogVariant.create({
      data: { organizationId, installationId, externalVariantId: input.externalVariantId, ...data }
    });
  if (current.organizationId !== organizationId)
    throw new AppError("CATALOG_VARIANT_NOT_FOUND", "Catalog variant was not found.", 404);
  return tx.externalCatalogVariant.update({
    where: { id: current.id },
    data: {
      ...data,
      lastObservedAt: new Date(),
      ...(current.sourceHash === sourceHash ? {} : { version: { increment: 1 } })
    }
  });
}

async function upsertImages(
  tx: RuntimeTransaction,
  organizationId: string,
  catalogProductId: string,
  catalogVariantId: string | null,
  images: ReturnType<typeof normalizeImages>
) {
  for (const image of images) {
    const current = await tx.catalogImageReference.findUnique({
      where: {
        catalogProductId_externalImageId: {
          catalogProductId,
          externalImageId: image.externalImageId
        }
      }
    });
    if (!current) {
      await tx.catalogImageReference.create({
        data: { organizationId, catalogProductId, catalogVariantId, ...image }
      });
    } else if (current.organizationId === organizationId) {
      const changed =
        current.urlHash !== image.urlHash ||
        current.catalogVariantId !== catalogVariantId ||
        current.contentTypeHint !== image.contentTypeHint;
      await tx.catalogImageReference.update({
        where: { id: current.id },
        data: {
          catalogVariantId,
          ...image,
          lastObservedAt: new Date(),
          ...(changed ? { status: "OBSERVED", version: { increment: 1 } } : {})
        }
      });
    }
  }
}

async function databaseSimilarityCandidates(
  tx: RuntimeTransaction,
  organizationId: string,
  observed: CatalogRankObserved
): Promise<CatalogRankLocal[]> {
  const normalizedName = normalizeCatalogMatchText(observed.normalizedName, 500) ?? "";
  const normalizedDescription = normalizeCatalogMatchText(observed.normalizedDescription, 4_000);
  const poolLimit = 125;
  const totalLimit = 500;
  return tx.$queryRaw<CatalogRankLocal[]>(RuntimePrisma.sql`
    WITH exact_candidates AS (
      SELECT
        "id", "name", "description", "sku", "normalizedSku", "normalizedGtin",
        "normalizedManufacturer", "normalizedManufacturerPartNumber", 0 AS "poolPriority"
      FROM "ProductItem"
      WHERE "organizationId" = ${organizationId}::uuid
        AND "active" = true
        AND (
          (${observed.normalizedGtin}::text IS NOT NULL
            AND "normalizedGtin" = ${observed.normalizedGtin})
          OR (${observed.normalizedManufacturer}::text IS NOT NULL
            AND ${observed.normalizedManufacturerPartNumber}::text IS NOT NULL
            AND "normalizedManufacturer" = ${observed.normalizedManufacturer}
            AND "normalizedManufacturerPartNumber" = ${observed.normalizedManufacturerPartNumber})
          OR (${observed.normalizedSku}::text IS NOT NULL
            AND "normalizedSku" = ${observed.normalizedSku})
        )
      ORDER BY "id" ASC
      LIMIT ${poolLimit}
    ), nearest_sku AS (
      SELECT
        "id", "name", "description", "sku", "normalizedSku", "normalizedGtin",
        "normalizedManufacturer", "normalizedManufacturerPartNumber", 1 AS "poolPriority"
      FROM "ProductItem"
      WHERE "organizationId" = ${organizationId}::uuid
        AND "active" = true
        AND ${observed.normalizedSku}::text IS NOT NULL
        AND "normalizedSku" IS NOT NULL
      ORDER BY "normalizedSku" <-> ${observed.normalizedSku}, "id" ASC
      LIMIT ${poolLimit}
    ), nearest_name AS (
      SELECT
        "id", "name", "description", "sku", "normalizedSku", "normalizedGtin",
        "normalizedManufacturer", "normalizedManufacturerPartNumber", 2 AS "poolPriority"
      FROM "ProductItem"
      WHERE "organizationId" = ${organizationId}::uuid
        AND "active" = true
      ORDER BY catalog_normalize_match_text("name") <-> ${normalizedName}, "id" ASC
      LIMIT ${poolLimit}
    ), nearest_description AS (
      SELECT
        "id", "name", "description", "sku", "normalizedSku", "normalizedGtin",
        "normalizedManufacturer", "normalizedManufacturerPartNumber", 3 AS "poolPriority"
      FROM "ProductItem"
      WHERE "organizationId" = ${organizationId}::uuid
        AND "active" = true
        AND ${normalizedDescription}::text IS NOT NULL
        AND catalog_normalize_match_text("description") IS NOT NULL
      ORDER BY catalog_normalize_match_text("description") <-> ${normalizedDescription}, "id" ASC
      LIMIT ${poolLimit}
    ), pooled AS (
      SELECT * FROM exact_candidates
      UNION ALL SELECT * FROM nearest_sku
      UNION ALL SELECT * FROM nearest_name
      UNION ALL SELECT * FROM nearest_description
    ), deduplicated AS (
      SELECT DISTINCT ON ("id") *
      FROM pooled
      ORDER BY "id" ASC, "poolPriority" ASC
    )
    SELECT
      "id", "name", "description", "sku", "normalizedSku", "normalizedGtin",
      "normalizedManufacturer", "normalizedManufacturerPartNumber"
    FROM deduplicated
    ORDER BY "poolPriority" ASC, "id" ASC
    LIMIT ${totalLimit}
  `);
}

async function persistSuggestedCatalogCandidates(
  tx: RuntimeTransaction,
  organizationId: string,
  catalogVariantId: string,
  limit: number,
  useDatabaseSimilarity: boolean
) {
  const variant = await tx.externalCatalogVariant.findFirst({
    where: { id: catalogVariantId, organizationId },
    include: {
      product: { select: { description: true } },
      installation: { select: { providerKey: true, mapping: true } }
    }
  });
  if (!variant)
    throw new AppError("CATALOG_VARIANT_NOT_FOUND", "Catalog variant was not found.", 404);
  const observed = catalogRankObserved(variant);
  const approved = await approvedCatalogCandidates(tx, organizationId, variant, observed);
  const locals = useDatabaseSimilarity
    ? await databaseSimilarityCandidates(tx, organizationId, observed)
    : await tx.productItem.findMany({
        where: { organizationId, active: true },
        select: localCandidateSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 500
      });
  const ranked = approved.length
    ? approved.slice(0, limit)
    : rankCatalogCandidates(observed, locals).slice(0, limit);
  for (const candidate of ranked) {
    const current = await tx.catalogMatchCandidate.findUnique({
      where: {
        catalogVariantId_productItemId: {
          catalogVariantId,
          productItemId: candidate.productItemId
        }
      }
    });
    if (!current) {
      await tx.catalogMatchCandidate.create({
        data: {
          organizationId,
          catalogVariantId,
          productItemId: candidate.productItemId,
          score: candidate.score,
          reason: candidate.reason
        }
      });
    } else if (
      current.organizationId === organizationId &&
      current.status === "SUGGESTED" &&
      (current.score !== candidate.score ||
        canonicalJson(current.reason) !== canonicalJson(candidate.reason))
    ) {
      await tx.catalogMatchCandidate.updateMany({
        where: {
          id: current.id,
          organizationId,
          status: "SUGGESTED",
          version: current.version
        },
        data: {
          score: candidate.score,
          reason: candidate.reason,
          version: { increment: 1 }
        }
      });
    }
  }
  return tx.catalogMatchCandidate.findMany({
    where: {
      organizationId,
      catalogVariantId,
      productItemId: { in: ranked.map((candidate) => candidate.productItemId) }
    },
    include: { productItem: { select: { id: true, sku: true, name: true, active: true } } },
    orderBy: [{ score: "desc" }, { productItemId: "asc" }, { id: "asc" }]
  });
}

async function approvedCatalogCandidates(
  tx: RuntimeTransaction,
  organizationId: string,
  variant: {
    sku: string | null;
    installation: { providerKey: string; mapping: Prisma.JsonValue };
  },
  observed: CatalogRankObserved
): Promise<readonly RankedCatalogCandidate[]> {
  const sourceSku = observed.sourceSku;
  if (!sourceSku) return [];
  const mapping = connectorMappingObject(variant.installation.mapping);
  const policy = catalogSourceIdentifierPolicy(variant.installation.providerKey);
  const aliases = mapping.catalogSkuAliases;
  if (aliases !== undefined && (!aliases || typeof aliases !== "object" || Array.isArray(aliases)))
    throw new AppError("CATALOG_SKU_ALIAS_INVALID", "Stored SKU aliases are invalid.", 409);
  if (aliases && typeof aliases === "object" && !Array.isArray(aliases)) {
    const aliasEntries = Object.entries(aliases)
      .filter(
        ([key]) =>
          normalizeSourceScopedSku(key, policy) === normalizeSourceScopedSku(sourceSku, policy)
      )
      .sort(([left], [right]) => left.localeCompare(right));
    if (aliasEntries.length > 0) {
      const parsedAliases = aliasEntries.map(([key, value]) => {
        const alias = jsonObject(value!, "catalog SKU alias");
        if (typeof alias.productItemId !== "string")
          throw new AppError(
            "CATALOG_SKU_ALIAS_INVALID",
            "Stored SKU alias target is invalid.",
            409
          );
        return {
          key,
          productItemId: alias.productItemId,
          quantityMultiplierMicros:
            typeof alias.quantityMultiplierMicros === "string"
              ? alias.quantityMultiplierMicros
              : null,
          unitOfMeasure: typeof alias.unitOfMeasure === "string" ? alias.unitOfMeasure : null
        };
      });
      const semanticAliases = new Set(
        parsedAliases.map((alias) =>
          JSON.stringify([alias.productItemId, alias.quantityMultiplierMicros, alias.unitOfMeasure])
        )
      );
      const productItemIds = [...new Set(parsedAliases.map((alias) => alias.productItemId))];
      const locals = await tx.productItem.findMany({
        where: { id: { in: productItemIds }, organizationId, active: true },
        select: localCandidateSelect,
        orderBy: { id: "asc" }
      });
      if (locals.length > 0) {
        const primaryAlias = parsedAliases[0]!;
        const ambiguityConflict = semanticAliases.size > 1 ? "ALIAS_COLLISION" : null;
        return locals.map((local) =>
          deterministicCatalogCandidate(
            observed,
            local,
            "APPROVED_ALIAS",
            primaryAlias.quantityMultiplierMicros,
            ambiguityConflict
          )
        );
      }
    }
  }
  const rawRules = mapping.catalogSkuPatternRules;
  if (rawRules !== undefined && !Array.isArray(rawRules))
    throw new AppError(
      "CATALOG_PATTERN_MAPPING_INVALID",
      "Stored SKU pattern rules are invalid.",
      409
    );
  const rules = (Array.isArray(rawRules) ? rawRules : [])
    .map((entry) => jsonObject(entry, "catalog SKU pattern rule"))
    .filter((rule) => rule.enabled !== false)
    .sort(
      (left, right) =>
        (typeof left.priority === "number" ? left.priority : 100) -
          (typeof right.priority === "number" ? right.priority : 100) ||
        (typeof left.id === "string" ? left.id : "").localeCompare(
          typeof right.id === "string" ? right.id : ""
        )
    );
  for (const rule of rules) {
    const extracted = extractApprovedSkuPattern(sourceSku, {
      prefix: typeof rule.prefix === "string" ? rule.prefix : null,
      suffix: typeof rule.suffix === "string" ? rule.suffix : null,
      caseSensitive: rule.caseSensitive !== false
    });
    if (!extracted) continue;
    const caseSensitive = rule.caseSensitive !== false;
    const locals = await tx.productItem.findMany({
      where: {
        organizationId,
        active: true,
        sku: caseSensitive ? { equals: extracted } : { equals: extracted, mode: "insensitive" }
      },
      select: localCandidateSelect,
      orderBy: [{ id: "asc" }]
    });
    const matches = locals.filter(
      (local) =>
        normalizeSourceScopedSku(local.sku, {
          providerKey: policy.providerKey,
          skuCaseSensitive: rule.caseSensitive !== false
        }) ===
        normalizeSourceScopedSku(extracted, {
          providerKey: policy.providerKey,
          skuCaseSensitive: rule.caseSensitive !== false
        })
    );
    if (matches.length > 0)
      return matches.map((local) =>
        deterministicCatalogCandidate(
          observed,
          local,
          "APPROVED_PATTERN",
          typeof rule.quantityMultiplierMicros === "string" ? rule.quantityMultiplierMicros : null,
          matches.length > 1 ? "PATTERN_COLLISION" : null
        )
      );
  }
  return [];
}

function deterministicCatalogCandidate(
  observed: CatalogRankObserved,
  local: CatalogRankLocal,
  matchMethod: "APPROVED_ALIAS" | "APPROVED_PATTERN",
  quantityMultiplierMicros: string | null,
  ambiguityConflict: "ALIAS_COLLISION" | "PATTERN_COLLISION" | null = null
): RankedCatalogCandidate {
  const base = scoreCatalogCandidate(observed, local);
  const blocked = Boolean(ambiguityConflict) || base.reason.conflicts.length > 0;
  return {
    ...base,
    score: blocked ? 94_000 : 99_500,
    reason: {
      ...base.reason,
      algorithmVersion: "catalog-match-v3",
      decisionState: blocked ? "AMBIGUOUS" : "AUTO_MATCH_CANDIDATE",
      deterministicMatch: !blocked,
      matchMethod,
      quantityMultiplierMicros,
      conflicts: blocked
        ? [
            ...new Set([
              ...base.reason.conflicts,
              ...(ambiguityConflict ? [ambiguityConflict] : [])
            ])
          ]
        : base.reason.conflicts,
      autoConfirmEligible: false
    }
  };
}

function localProductCreationReason(reason: CatalogMatchReasonV2): Prisma.InputJsonObject {
  return {
    ...reason,
    creation: "LOCAL_PRODUCT_CREATED_FROM_CATALOG"
  };
}

function isLocalProductCreationReason(reason: Prisma.JsonValue): boolean {
  return Boolean(
    reason &&
      typeof reason === "object" &&
      !Array.isArray(reason) &&
      (reason as Record<string, unknown>).creation === "LOCAL_PRODUCT_CREATED_FROM_CATALOG"
  );
}

function firstIngestedCatalogImageReference(variant: {
  readonly images: readonly {
    readonly status: string;
    readonly remoteUrl: string;
    readonly position: number;
    readonly id: string;
  }[];
  readonly product: {
    readonly images: readonly {
      readonly status: string;
      readonly remoteUrl: string;
      readonly position: number;
      readonly id: string;
    }[];
  };
}): string | null {
  return (
    [...variant.images, ...variant.product.images]
      .filter((image) => image.status === "INGESTED")
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0]
      ?.remoteUrl ?? null
  );
}

function catalogBulkError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return {
    code: "CATALOG_BULK_CREATE_FAILED",
    message: "This item could not be created. Correct its product configuration and try it again."
  };
}

const localCandidateSelect = {
  id: true,
  name: true,
  description: true,
  sku: true,
  normalizedSku: true,
  normalizedGtin: true,
  normalizedManufacturer: true,
  normalizedManufacturerPartNumber: true
} as const;

function catalogRankObserved(variant: {
  normalizedName: string;
  sku?: string | null;
  normalizedSku: string | null;
  normalizedGtin: string | null;
  normalizedManufacturer: string | null;
  normalizedManufacturerPartNumber: string | null;
  variantSignature?: Prisma.JsonValue;
  product: { description: string | null };
  installation?: { providerKey: string };
}): CatalogRankObserved {
  const signature =
    variant.variantSignature &&
    typeof variant.variantSignature === "object" &&
    !Array.isArray(variant.variantSignature)
      ? Object.fromEntries(
          Object.entries(variant.variantSignature).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : null;
  return {
    normalizedName: variant.normalizedName,
    normalizedDescription: normalizeCatalogMatchText(variant.product.description, 4_000),
    sourceSku: variant.sku ?? null,
    sourceProviderKey: variant.installation?.providerKey ?? null,
    normalizedSku: variant.normalizedSku,
    normalizedGtin: variant.normalizedGtin,
    normalizedManufacturer: variant.normalizedManufacturer,
    normalizedManufacturerPartNumber: variant.normalizedManufacturerPartNumber,
    variantSignature: signature
  };
}

async function requireInstallation(
  tx: RuntimeTransaction,
  organizationId: string,
  installationId: string
) {
  const installation = await tx.connectorInstallation.findFirst({
    where: { id: installationId, organizationId }
  });
  if (!installation)
    throw new AppError("CONNECTOR_NOT_FOUND", "Connector installation was not found.", 404);
  return installation;
}

async function audit(
  tx: RuntimeTransaction,
  context: OrganizationContext,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType: "CatalogMapping",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

function policyAudit(policy: {
  sourceOfTruth: string;
  enabled: boolean;
  desiredQuantityMicros: bigint | null;
}) {
  return {
    sourceOfTruth: policy.sourceOfTruth,
    enabled: policy.enabled,
    desiredQuantityMicros: policy.desiredQuantityMicros?.toString() ?? null,
    createsInventoryMovement: false
  };
}

function catalogProductDto(row: unknown) {
  return toJsonSafe(row);
}

function candidateDto(row: unknown) {
  return toJsonSafe(row);
}

function inventoryPolicyDto(row: unknown) {
  return toJsonSafe(row);
}

function inventoryObservationDto(row: unknown) {
  return toJsonSafe(row);
}

function inventoryConflictDto(row: unknown) {
  return toJsonSafe(row);
}

function policyStateDto(row: unknown) {
  return toJsonSafe(row);
}

function catalogImageDto(row: unknown) {
  return toJsonSafe(row);
}

function inventoryOperationDto(row: {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Prisma.JsonValue;
  status: string;
  attempts: number;
  occurredAt: Date;
  dispatchedAt: Date | null;
}) {
  return toJsonSafe(row);
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>).map(([key, entry]) => [
        key,
        toJsonSafe(entry)
      ])
    );
  return value;
}

function imageBoundary(image: {
  remoteUrl: string;
  product: {
    installation: { providerKey: string; externalAccountId: string | null };
  };
}) {
  return {
    remoteUrl: image.remoteUrl,
    providerKey: image.product.installation.providerKey,
    connectorExternalAccountId: image.product.installation.externalAccountId
  };
}

function microsToDecimal(value: bigint): string {
  const units = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${units.toString()}.${fraction}` : units.toString();
}

function jsonObject(value: Prisma.JsonValue, label: string): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVENTORY_SYNC_OPERATION_INVALID", `${label} is invalid.`, 409);
  return value as Record<string, Prisma.JsonValue>;
}

function jsonInteger(value: Prisma.JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new AppError("INVENTORY_SYNC_OPERATION_INVALID", `${label} is invalid.`, 409);
  return value;
}

function sanitizeRemoteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("CATALOG_IMAGE_URL_INVALID", "Catalog URL is invalid.", 422);
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new AppError("CATALOG_IMAGE_URL_INVALID", "Catalog URLs must use public HTTPS.", 422);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/token|secret|signature|credential|authorization|api.?key/i.test(key))
      url.searchParams.delete(key);
  if (url.toString().length > 2048)
    throw new AppError("CATALOG_IMAGE_URL_INVALID", "Catalog URL is too long.", 422);
  return url.toString();
}

function sanitizeMetadata(value: Readonly<Record<string, unknown>>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !/secret|token|password|credential|authorization|api.?key|cookie/i.test(key)
      )
      .map(([key, entry]) => [key, sanitizeJson(entry)])
  );
}

function sanitizeJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeJson);
  if (value && typeof value === "object")
    return sanitizeMetadata(value as Readonly<Record<string, unknown>>);
  return "[REDACTED]";
}

function requiredIdentifier(value: string, label: string): string {
  const result = value.trim();
  if (!result || result.length > 200)
    throw new AppError("CATALOG_IDENTIFIER_INVALID", `${label} is invalid.`, 422);
  return result;
}

function requiredName(value: string, label: string): string {
  const result = value.trim();
  if (!result || result.length > 500)
    throw new AppError("CATALOG_NAME_INVALID", `${label} is invalid.`, 422);
  return result;
}

function optionalText(value: string | null | undefined, maximum: number): string | null {
  if (value == null) return null;
  const result = value.trim();
  if (result.length > maximum)
    throw new AppError("CATALOG_FIELD_INVALID", "Catalog field is too long.", 422);
  return result || null;
}

function validDate(value: Date | null | undefined, label: string): Date | null {
  if (value == null) return null;
  if (Number.isNaN(value.getTime()))
    throw new AppError("CATALOG_DATE_INVALID", `${label} is invalid.`, 422);
  return value;
}

function requiredBigInt(value: string, label: string): bigint {
  try {
    if (!/^-?\d+$/.test(value)) throw new Error("invalid");
    const exact = BigInt(value);
    if (exact < -9_223_372_036_854_775_808n || exact > 9_223_372_036_854_775_807n)
      throw new Error("out of range");
    return exact;
  } catch {
    throw new AppError("EXACT_QUANTITY_INVALID", `${label} must be an exact integer.`, 422);
  }
}

function optionalBigInt(value: string | null | undefined, label: string): bigint | null {
  return value == null ? null : requiredBigInt(value, label);
}

function positiveInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new AppError("CATALOG_IMAGE_METADATA_INVALID", `${label} is invalid.`, 422);
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new AppError("CATALOG_IMAGE_METADATA_INVALID", `${label} is invalid.`, 422);
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
