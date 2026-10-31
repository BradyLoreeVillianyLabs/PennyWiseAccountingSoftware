import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { serializeDate } from "../utils/dates.js";
import { normalizeProductIdentifier } from "./product-identity.js";

export const INVENTORY_BARCODE_SYMBOLOGIES = [
  "AUTO",
  "CODE128",
  "CODE39",
  "EAN8",
  "EAN13",
  "UPC_A",
  "UPC_E",
  "ITF14",
  "QR",
  "DATA_MATRIX"
] as const;
export type InventoryBarcodeSymbology = (typeof INVENTORY_BARCODE_SYMBOLOGIES)[number];
export const INVENTORY_LABEL_FIELDS = [
  "SKU",
  "NAME",
  "BARCODE",
  "GTIN",
  "MANUFACTURER_PART_NUMBER",
  "PRICE",
  "LOT",
  "SERIAL",
  "LOCATION"
] as const;
export type InventoryLabelField = (typeof INVENTORY_LABEL_FIELDS)[number];
export type InventoryScanCaptureMode = "MANUAL" | "HARDWARE" | "CAMERA";

export interface RegisterBarcodeInput {
  readonly productItemId: string;
  readonly code: string;
  readonly symbology: InventoryBarcodeSymbology;
  readonly source?: string | null | undefined;
  readonly isPrimary?: boolean | undefined;
}

export interface LabelTemplateInput {
  readonly name: string;
  readonly symbology: Exclude<InventoryBarcodeSymbology, "AUTO">;
  readonly widthMmMicros: string;
  readonly heightMmMicros: string;
  readonly fields: readonly InventoryLabelField[];
  readonly isDefault?: boolean | undefined;
}

export interface ScanInput {
  readonly code: string;
  readonly captureMode: InventoryScanCaptureMode;
  readonly symbology?: InventoryBarcodeSymbology | undefined;
}

const capabilityBoundary = {
  barcodeAliases: "SUPPORTED",
  cameraScanProtocol: "READY_FOR_CAMERA_OR_HARDWARE_PAYLOAD",
  labelPreview: "SUPPORTED",
  labelPrinterAdapter: "NOT_CONFIGURED",
  costing: {
    weightedAverage: "SUPPORTED",
    fifo: "SCAFFOLD_ONLY",
    landedCostAllocation: "SCAFFOLD_ONLY"
  },
  assemblies: {
    kitAssembly: "SCAFFOLD_ONLY"
  }
} as const;

export function inventoryCapabilityBoundary() {
  return capabilityBoundary;
}

export function normalizedBarcode(value: string): string {
  const normalized = normalizeProductIdentifier(value);
  if (!normalized) throw new AppError("BARCODE_EMPTY", "Barcode must contain a value.", 422);
  return normalized;
}

export function buildLabelPreview(input: {
  readonly templateId: string;
  readonly templateName: string;
  readonly symbology: string;
  readonly widthMmMicros: bigint;
  readonly heightMmMicros: bigint;
  readonly fields: readonly InventoryLabelField[];
  readonly product: {
    readonly id: string;
    readonly sku: string | null;
    readonly name: string;
    readonly gtin: string | null;
    readonly manufacturerPartNumber: string | null;
    readonly salesPriceMinor: bigint;
  };
  readonly barcode: string | null;
  readonly lot?: string | null | undefined;
  readonly serial?: string | null | undefined;
  readonly location?: string | null | undefined;
}) {
  const values: Record<InventoryLabelField, string> = {
    SKU: input.product.sku ?? "",
    NAME: input.product.name,
    BARCODE: input.barcode ?? input.product.gtin ?? "",
    GTIN: input.product.gtin ?? "",
    MANUFACTURER_PART_NUMBER: input.product.manufacturerPartNumber ?? "",
    PRICE: input.product.salesPriceMinor.toString(),
    LOT: input.lot ?? "",
    SERIAL: input.serial ?? "",
    LOCATION: input.location ?? ""
  };
  return {
    templateId: input.templateId,
    templateName: input.templateName,
    symbology: input.symbology,
    widthMmMicros: input.widthMmMicros.toString(),
    heightMmMicros: input.heightMmMicros.toString(),
    productItemId: input.product.id,
    elements: input.fields.map((field) => ({ field, value: values[field] })),
    printerAdapter: "NOT_CONFIGURED",
    sideEffect: "PREVIEW_ONLY"
  } as const;
}

export class InventoryCatalogControlService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public capabilities(context: OrganizationContext) {
    // Capabilities are descriptive only; no mutable stock or costing state is
    // created by this endpoint.
    return {
      organizationId: context.organizationId,
      ...inventoryCapabilityBoundary()
    };
  }

  public async listBarcodes(context: OrganizationContext, productItemId?: string) {
    await this.authorization.assert(context, "inventory:read", "ProductBarcode");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.productBarcode.findMany({
        where: {
          organizationId: context.organizationId,
          ...(productItemId ? { productItemId } : {}),
          active: true
        },
        orderBy: [{ productItemId: "asc" }, { isPrimary: "desc" }, { code: "asc" }]
      });
      return rows.map(barcodeDto);
    });
  }

  public async registerBarcode(context: OrganizationContext, input: RegisterBarcodeInput) {
    await this.authorization.assert(context, "inventory:configure", "ProductBarcode");
    const normalizedCode = normalizedBarcode(input.code);
    if (!INVENTORY_BARCODE_SYMBOLOGIES.includes(input.symbology))
      throw new AppError("BARCODE_SYMBOLOGY_INVALID", "Barcode symbology is not supported.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const product = await tx.productItem.findFirst({
        where: {
          id: input.productItemId,
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {}),
          active: true
        }
      });
      if (!product) throw new AppError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
      if (input.isPrimary)
        await tx.productBarcode.updateMany({
          where: {
            organizationId: context.organizationId,
            productItemId: product.id,
            active: true
          },
          data: { isPrimary: false }
        });
      try {
        const row = await tx.productBarcode.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            productItemId: product.id,
            code: input.code.trim(),
            normalizedCode,
            symbology: input.symbology,
            source: input.source?.trim() || null,
            isPrimary: input.isPrimary ?? false,
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "INVENTORY_BARCODE_REGISTERED", row.id, {
          productItemId: product.id,
          symbology: row.symbology,
          source: row.source
        });
        return barcodeDto(row);
      } catch (error) {
        if (isUnique(error))
          throw new AppError(
            "BARCODE_EXISTS",
            "This barcode is already assigned in the business.",
            409
          );
        throw error;
      }
    });
  }

  public async deactivateBarcode(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "inventory:configure", "ProductBarcode", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.productBarcode.updateMany({
        where: { id, organizationId: context.organizationId, active: true },
        data: { active: false, isPrimary: false }
      });
      if (result.count !== 1)
        throw new AppError("BARCODE_NOT_FOUND", "Active barcode was not found.", 404);
      await audit(tx, context, "INVENTORY_BARCODE_DEACTIVATED", id, {});
      return { id, active: false };
    });
  }

  public async resolveScan(context: OrganizationContext, input: ScanInput) {
    await this.authorization.assert(context, "inventory:read", "ProductBarcode");
    const normalizedCode = normalizedBarcode(input.code);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const alias = await tx.productBarcode.findFirst({
        where: { organizationId: context.organizationId, normalizedCode, active: true },
        include: { productItem: true }
      });
      if (alias) return scanDto(alias.productItem, alias.code, "BARCODE_ALIAS", input.captureMode);
      const gtinMatches = await tx.productItem.findMany({
        where: {
          organizationId: context.organizationId,
          normalizedGtin: normalizedCode,
          active: true,
          ...(context.companyId ? { companyId: context.companyId } : {})
        },
        take: 2
      });
      if (gtinMatches.length > 1)
        throw new AppError("BARCODE_AMBIGUOUS", "The scanned GTIN matches multiple products.", 409);
      const product = gtinMatches[0];
      if (!product)
        throw new AppError("BARCODE_NOT_FOUND", "No active product matches this scan.", 404);
      return scanDto(product, product.gtin, "PRODUCT_GTIN", input.captureMode);
    });
  }

  public async listLabelTemplates(context: OrganizationContext) {
    await this.authorization.assert(context, "inventory:read", "InventoryLabelTemplate");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      (
        await tx.inventoryLabelTemplate.findMany({
          where: { organizationId: context.organizationId, active: true },
          orderBy: [{ isDefault: "desc" }, { name: "asc" }]
        })
      ).map(labelTemplateDto)
    );
  }

  public async createLabelTemplate(context: OrganizationContext, input: LabelTemplateInput) {
    await this.authorization.assert(context, "inventory:configure", "InventoryLabelTemplate");
    const widthMmMicros = positiveDimension(input.widthMmMicros, "width");
    const heightMmMicros = positiveDimension(input.heightMmMicros, "height");
    const fields = [...new Set(input.fields)];
    if (!fields.length)
      throw new AppError("LABEL_FIELDS_REQUIRED", "At least one label field is required.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (input.isDefault)
        await tx.inventoryLabelTemplate.updateMany({
          where: { organizationId: context.organizationId, active: true },
          data: { isDefault: false, updatedByUserId: context.user.id }
        });
      try {
        const row = await tx.inventoryLabelTemplate.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            name: input.name.trim(),
            symbology: input.symbology,
            widthMmMicros,
            heightMmMicros,
            fields,
            isDefault: input.isDefault ?? false,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "INVENTORY_LABEL_TEMPLATE_CREATED", row.id, {
          symbology: row.symbology,
          fields
        });
        return labelTemplateDto(row);
      } catch (error) {
        if (isUnique(error))
          throw new AppError(
            "LABEL_TEMPLATE_EXISTS",
            "A label template with this name exists.",
            409
          );
        throw error;
      }
    });
  }

  public async previewLabel(
    context: OrganizationContext,
    templateId: string,
    input: {
      readonly productItemId: string;
      readonly barcodeId?: string | undefined;
      readonly lot?: string | null | undefined;
      readonly serial?: string | null | undefined;
      readonly location?: string | null | undefined;
    }
  ) {
    await this.authorization.assert(
      context,
      "inventory:read",
      "InventoryLabelTemplate",
      templateId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [template, product] = await Promise.all([
        tx.inventoryLabelTemplate.findFirst({
          where: { id: templateId, organizationId: context.organizationId, active: true }
        }),
        tx.productItem.findFirst({
          where: { id: input.productItemId, organizationId: context.organizationId, active: true }
        })
      ]);
      if (!template)
        throw new AppError("LABEL_TEMPLATE_NOT_FOUND", "Label template was not found.", 404);
      if (!product) throw new AppError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
      const barcode = input.barcodeId
        ? await tx.productBarcode.findFirst({
            where: {
              id: input.barcodeId,
              organizationId: context.organizationId,
              productItemId: product.id,
              active: true
            }
          })
        : await tx.productBarcode.findFirst({
            where: {
              organizationId: context.organizationId,
              productItemId: product.id,
              active: true,
              isPrimary: true
            }
          });
      return buildLabelPreview({
        templateId: template.id,
        templateName: template.name,
        symbology: template.symbology,
        widthMmMicros: template.widthMmMicros,
        heightMmMicros: template.heightMmMicros,
        fields: template.fields as InventoryLabelField[],
        product,
        barcode: barcode?.code ?? null,
        lot: input.lot,
        serial: input.serial,
        location: input.location
      });
    });
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function positiveDimension(value: string, label: string) {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n)
    throw new AppError(
      "LABEL_DIMENSION_INVALID",
      `Label ${label} must be a positive integer in micrometres.`,
      422
    );
  return BigInt(value);
}

function barcodeDto(row: {
  id: string;
  productItemId: string;
  code: string;
  normalizedCode: string;
  symbology: string;
  source: string | null;
  isPrimary: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function labelTemplateDto(row: {
  id: string;
  name: string;
  symbology: string;
  widthMmMicros: bigint;
  heightMmMicros: bigint;
  fields: Prisma.JsonValue;
  isDefault: boolean;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    widthMmMicros: row.widthMmMicros.toString(),
    heightMmMicros: row.heightMmMicros.toString(),
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function scanDto(
  product: { id: string; sku: string | null; name: string; gtin: string | null },
  matchedCode: string | null,
  evidence: string,
  captureMode: InventoryScanCaptureMode
) {
  return {
    product: { id: product.id, sku: product.sku, name: product.name, gtin: product.gtin },
    matchedCode,
    evidence,
    captureMode,
    cameraProtocol: "RESOLVE_PAYLOAD_V1"
  } as const;
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
      targetType: "InventoryCatalogControl",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
