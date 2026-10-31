import { createHash } from "node:crypto";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import sharp from "sharp";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { inspectImageBytes } from "./logo-service.js";
import type { IngestedCatalogImageEvidence } from "./catalog-image-ingestion-service.js";
import type { DocumentStorage } from "./invoice-render-service.js";

export const maximumProductImageBytes = 5_242_880;
export const maximumProductImageDimension = 4096;
export const maximumProductImagePixels = 16_777_216;
export const productImageThumbnailMaxDimension = 1600;

type ProductImageSourceKind = "CATALOG" | "MANUAL";

export class ProductImageService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async uploadManual(
    context: OrganizationContext,
    productItemId: string,
    data: Buffer,
    declaredMediaType: string
  ) {
    await this.authorization.assert(context, "products:manage", "ProductImageAsset", productItemId);
    const source = inspectProductImage(data, declaredMediaType);
    const thumbnail = await this.makeThumbnail(data);
    return this.storeAsset(context, {
      productItemId,
      sourceKind: "MANUAL",
      sourceUrlHash: source.sha256,
      catalogImageId: null,
      thumbnail,
      auditAction: "PRODUCT_IMAGE_MANUAL_UPLOADED"
    });
  }

  public async read(context: OrganizationContext, productItemId: string) {
    await this.authorization.assert(context, "products:read", "ProductImageAsset", productItemId);
    const asset = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.productImageAsset.findFirst({
        where: { organizationId: context.organizationId, productItemId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      })
    );
    if (!asset)
      throw new AppError("PRODUCT_IMAGE_NOT_FOUND", "This product does not have an image.", 404);
    return { asset: assetDto(asset), data: await this.storage.get(asset.storageKey) };
  }

  /**
   * Returns true when an approved catalog image already has a local thumbnail
   * for every confirmed local product it can serve. This permits a retry after
   * a database failure without downloading the provider image again.
   */
  public async hasStoredCatalogImage(
    context: OrganizationContext,
    imageId: string,
    version: number
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const image = await tx.catalogImageReference.findFirst({
        where: { id: imageId, organizationId: context.organizationId, version, status: "APPROVED" },
        select: { id: true, urlHash: true, catalogProductId: true, catalogVariantId: true }
      });
      if (!image) return false;
      const candidates = await confirmedProductIds(tx, context.organizationId, image);
      if (!candidates.length) return false;
      const assets = await tx.productImageAsset.findMany({
        where: {
          organizationId: context.organizationId,
          productItemId: { in: candidates },
          sourceUrlHash: image.urlHash,
          sourceKind: "CATALOG"
        },
        select: { productItemId: true }
      });
      return new Set(assets.map((asset) => asset.productItemId)).size === candidates.length;
    });
  }

  public async markStoredCatalogImageIngested(
    context: OrganizationContext,
    imageId: string,
    version: number
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "CatalogImageReference",
      imageId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const image = await tx.catalogImageReference.findFirst({
        where: { id: imageId, organizationId: context.organizationId, version, status: "APPROVED" }
      });
      if (!image)
        throw new AppError(
          "CATALOG_IMAGE_NOT_APPROVED",
          "Only the current approved image version can be ingested.",
          409
        );
      const candidates = await confirmedProductIds(tx, context.organizationId, image);
      const assets = await tx.productImageAsset.findMany({
        where: {
          organizationId: context.organizationId,
          productItemId: { in: candidates },
          sourceUrlHash: image.urlHash,
          sourceKind: "CATALOG"
        }
      });
      if (
        !candidates.length ||
        new Set(assets.map((asset) => asset.productItemId)).size !== candidates.length
      )
        throw new AppError(
          "CATALOG_IMAGE_ASSET_MISSING",
          "The existing catalog thumbnail is incomplete and must be re-ingested.",
          409
        );
      for (const productItemId of candidates)
        await tx.productItem.update({
          where: { id: productItemId },
          data: { productImageReference: localProductImageReference(productItemId) }
        });
      const changed = await tx.catalogImageReference.updateMany({
        where: { id: imageId, organizationId: context.organizationId, version, status: "APPROVED" },
        data: {
          status: "INGESTED",
          safeMetadata: imageMetadata(image.safeMetadata, { idempotentReplay: true }),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new AppError("STALE_CATALOG_IMAGE", "Image was changed.", 409);
      const row = await tx.catalogImageReference.findFirstOrThrow({
        where: { id: imageId, organizationId: context.organizationId }
      });
      await audit(tx, context, "CATALOG_IMAGE_INGESTED", imageId, {
        sourceUrlHash: image.urlHash,
        idempotentReplay: true,
        matchingAuthority: false,
        accountingEntriesCreated: 0
      });
      return { image: catalogImageDto(row), assets: assets.map(assetDto) };
    });
  }

  /** Store one approved provider image against every confirmed local product. */
  public async storeApprovedCatalogImage(
    context: OrganizationContext,
    imageId: string,
    version: number,
    evidence: IngestedCatalogImageEvidence
  ) {
    await this.authorization.assert(
      context,
      "integrations:manage",
      "CatalogImageReference",
      imageId
    );
    const thumbnail = await this.makeThumbnail(evidence.sourceBytes);
    const image = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.catalogImageReference.findFirst({
        where: { id: imageId, organizationId: context.organizationId, version, status: "APPROVED" }
      })
    );
    if (!image)
      throw new AppError(
        "CATALOG_IMAGE_NOT_APPROVED",
        "Only the current approved image version can be ingested.",
        409
      );
    const candidates = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      confirmedProductIds(tx, context.organizationId, image)
    );
    if (!candidates.length)
      throw new AppError(
        "CATALOG_IMAGE_PRODUCT_MAPPING_REQUIRED",
        "Confirm a local product mapping before ingesting its catalog image.",
        422
      );
    const existing = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.productImageAsset.findMany({
        where: {
          organizationId: context.organizationId,
          productItemId: { in: candidates },
          sourceUrlHash: image.urlHash,
          sourceKind: "CATALOG"
        },
        select: { productItemId: true }
      })
    );
    const existingIds = new Set(existing.map((asset) => asset.productItemId));
    for (const productItemId of candidates) {
      if (existingIds.has(productItemId)) continue;
      await this.storage.put(
        catalogStorageKey(context.organizationId, productItemId, image.urlHash),
        thumbnail.data,
        thumbnail.mediaType
      );
    }
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.catalogImageReference.findFirst({
        where: { id: imageId, organizationId: context.organizationId, version, status: "APPROVED" }
      });
      if (!current)
        throw new AppError(
          "STALE_CATALOG_IMAGE",
          "The approved image changed while it was ingested.",
          409
        );
      const assets = [];
      for (const productItemId of candidates) {
        const asset = await tx.productImageAsset.upsert({
          where: {
            organizationId_productItemId_sourceUrlHash: {
              organizationId: context.organizationId,
              productItemId,
              sourceUrlHash: current.urlHash
            }
          },
          create: {
            organizationId: context.organizationId,
            productItemId,
            catalogImageId: current.id,
            sourceKind: "CATALOG",
            sourceUrlHash: current.urlHash,
            storageKey: catalogStorageKey(context.organizationId, productItemId, current.urlHash),
            mediaType: thumbnail.mediaType,
            byteSize: thumbnail.data.length,
            width: thumbnail.width,
            height: thumbnail.height,
            checksum: thumbnail.checksum,
            createdByUserId: context.user.id
          },
          update: {}
        });
        assets.push(asset);
        await tx.productItem.update({
          where: { id: productItemId },
          data: { productImageReference: localProductImageReference(productItemId) }
        });
      }
      const changed = await tx.catalogImageReference.updateMany({
        where: { id: imageId, organizationId: context.organizationId, version, status: "APPROVED" },
        data: {
          status: "INGESTED",
          contentTypeHint: evidence.mediaType,
          byteLengthHint: BigInt(evidence.byteLength),
          width: evidence.width,
          height: evidence.height,
          safeMetadata: imageMetadata(current.safeMetadata, {
            mediaType: evidence.mediaType,
            byteLength: evidence.byteLength,
            width: evidence.width,
            height: evidence.height,
            sha256: evidence.sha256,
            thumbnailChecksum: thumbnail.checksum,
            thumbnailWidth: thumbnail.width,
            thumbnailHeight: thumbnail.height
          }),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new AppError("STALE_CATALOG_IMAGE", "Image was changed.", 409);
      const row = await tx.catalogImageReference.findFirstOrThrow({
        where: { id: imageId, organizationId: context.organizationId }
      });
      await audit(tx, context, "CATALOG_IMAGE_INGESTED", imageId, {
        sourceUrlHash: current.urlHash,
        sha256: evidence.sha256,
        thumbnailChecksum: thumbnail.checksum,
        productItemIds: candidates,
        matchingAuthority: false,
        accountingEntriesCreated: 0
      });
      return { image: catalogImageDto(row), assets: assets.map(assetDto) };
    });
  }

  private async storeAsset(
    context: OrganizationContext,
    input: {
      readonly productItemId: string;
      readonly sourceKind: ProductImageSourceKind;
      readonly sourceUrlHash: string;
      readonly catalogImageId: string | null;
      readonly thumbnail: Thumbnail;
      readonly auditAction: string;
    }
  ) {
    const product = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.productItem.findFirst({
        where: { id: input.productItemId, organizationId: context.organizationId },
        select: { id: true }
      })
    );
    if (!product) throw new AppError("PRODUCT_NOT_FOUND", "Product or service was not found.", 404);
    const storageKey = manualStorageKey(
      context.organizationId,
      input.productItemId,
      input.sourceUrlHash
    );
    const existing = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.productImageAsset.findUnique({
        where: {
          organizationId_productItemId_sourceUrlHash: {
            organizationId: context.organizationId,
            productItemId: input.productItemId,
            sourceUrlHash: input.sourceUrlHash
          }
        }
      })
    );
    if (existing) {
      await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.productItem.update({
          where: { id: input.productItemId },
          data: { productImageReference: localProductImageReference(input.productItemId) }
        })
      );
      return { asset: assetDto(existing), replayed: true };
    }
    await this.storage.put(storageKey, input.thumbnail.data, input.thumbnail.mediaType);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const asset = await tx.productImageAsset.upsert({
        where: {
          organizationId_productItemId_sourceUrlHash: {
            organizationId: context.organizationId,
            productItemId: input.productItemId,
            sourceUrlHash: input.sourceUrlHash
          }
        },
        create: {
          organizationId: context.organizationId,
          productItemId: input.productItemId,
          catalogImageId: input.catalogImageId,
          sourceKind: input.sourceKind,
          sourceUrlHash: input.sourceUrlHash,
          storageKey,
          mediaType: input.thumbnail.mediaType,
          byteSize: input.thumbnail.data.length,
          width: input.thumbnail.width,
          height: input.thumbnail.height,
          checksum: input.thumbnail.checksum,
          createdByUserId: context.user.id
        },
        update: {}
      });
      await tx.productItem.update({
        where: { id: input.productItemId },
        data: { productImageReference: localProductImageReference(input.productItemId) }
      });
      await audit(tx, context, input.auditAction, asset.id, {
        productItemId: input.productItemId,
        sourceKind: input.sourceKind,
        sourceUrlHash: input.sourceUrlHash,
        checksum: asset.checksum,
        byteSize: asset.byteSize
      });
      return { asset: assetDto(asset), replayed: false };
    });
  }

  private async makeThumbnail(data: Buffer): Promise<Thumbnail> {
    let output: Buffer;
    try {
      output = await sharp(data)
        .resize({
          width: productImageThumbnailMaxDimension,
          height: productImageThumbnailMaxDimension,
          fit: "inside",
          withoutEnlargement: true
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      throw new AppError(
        "PRODUCT_IMAGE_CONTENT_INVALID",
        "The product image could not be rendered as a thumbnail.",
        422
      );
    }
    const inspected = inspectImageBytes(output);
    return {
      data: output,
      mediaType: "image/jpeg",
      width: inspected.width,
      height: inspected.height,
      checksum: sha256(output)
    };
  }
}

interface Thumbnail {
  readonly data: Buffer;
  readonly mediaType: "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly checksum: string;
}

function inspectProductImage(data: Buffer, declaredMediaType: string) {
  if (data.length === 0 || data.length > maximumProductImageBytes)
    throw new AppError("PRODUCT_IMAGE_SIZE_INVALID", "Product images may not exceed 5 MiB.", 422);
  let inspected: ReturnType<typeof inspectImageBytes>;
  try {
    inspected = inspectImageBytes(data);
  } catch {
    throw new AppError(
      "PRODUCT_IMAGE_CONTENT_INVALID",
      "Product image bytes do not match a supported image type.",
      422
    );
  }
  if (
    inspected.width <= 0 ||
    inspected.height <= 0 ||
    inspected.width > maximumProductImageDimension ||
    inspected.height > maximumProductImageDimension ||
    inspected.width * inspected.height > maximumProductImagePixels
  )
    throw new AppError(
      "PRODUCT_IMAGE_DIMENSIONS_INVALID",
      "Product image dimensions exceed the safe pixel limit.",
      422
    );
  const declared = declaredMediaType.split(";", 1)[0]?.trim().toLowerCase();
  if (!declared || declared !== inspected.mediaType)
    throw new AppError(
      "PRODUCT_IMAGE_TYPE_MISMATCH",
      "Product image bytes do not match the declared content type.",
      422
    );
  return { ...inspected, sha256: sha256(data) };
}

async function confirmedProductIds(
  tx: Prisma.TransactionClient,
  organizationId: string,
  image: { readonly catalogProductId: string; readonly catalogVariantId: string | null }
) {
  const candidates = await tx.catalogMatchCandidate.findMany({
    where: {
      organizationId,
      status: "CONFIRMED",
      ...(image.catalogVariantId
        ? { catalogVariantId: image.catalogVariantId }
        : { variant: { catalogProductId: image.catalogProductId } })
    },
    select: { productItemId: true }
  });
  return [...new Set(candidates.map((candidate) => candidate.productItemId))];
}

function imageMetadata(current: Prisma.JsonValue, additions: Record<string, unknown>) {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...additions } as Prisma.InputJsonObject;
}

function catalogStorageKey(organizationId: string, productItemId: string, sourceUrlHash: string) {
  return `${organizationId}/product-images/${productItemId}/catalog-${sourceUrlHash}.jpg`;
}

function manualStorageKey(organizationId: string, productItemId: string, sourceHash: string) {
  return `${organizationId}/product-images/${productItemId}/manual-${sourceHash}.jpg`;
}

export function localProductImageReference(productItemId: string) {
  return `/v1/products/${productItemId}/image`;
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function assetDto(asset: {
  id: string;
  productItemId: string;
  sourceKind: string;
  sourceUrlHash: string;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  checksum: string;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    productItemId: asset.productItemId,
    sourceKind: asset.sourceKind,
    sourceUrlHash: asset.sourceUrlHash,
    mediaType: asset.mediaType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    checksum: asset.checksum,
    createdAt: asset.createdAt.toISOString(),
    reference: localProductImageReference(asset.productItemId)
  };
}

function catalogImageDto(row: unknown) {
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

async function audit(
  tx: Prisma.TransactionClient,
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
      targetType: action.startsWith("CATALOG_") ? "CatalogImageReference" : "ProductImageAsset",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
