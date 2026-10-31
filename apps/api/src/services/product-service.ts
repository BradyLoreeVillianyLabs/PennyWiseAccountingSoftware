import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { serializeDate } from "../utils/dates.js";
import { hasValidGtinCheckDigit } from "./product-identity.js";

export interface ProductInput {
  readonly sku?: string | null | undefined;
  /** Raw barcode/GTIN evidence; normalization is maintained by the database trigger. */
  readonly gtin?: string | null | undefined;
  readonly manufacturer?: string | null | undefined;
  readonly manufacturerPartNumber?: string | null | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly itemType:
    | "SERVICE"
    | "NON_INVENTORY_PRODUCT"
    | "INVENTORY_PRODUCT"
    | "DISCOUNT"
    | "SHIPPING";
  readonly salesPriceMinor: string;
  readonly purchaseCostMinor?: string | null | undefined;
  readonly incomeAccountId: string;
  readonly expenseAccountId?: string | null | undefined;
  readonly inventoryAssetAccountId?: string | null | undefined;
  readonly costOfGoodsSoldAccountId?: string | null | undefined;
  readonly purchaseClearingAccountId?: string | null | undefined;
  readonly adjustmentGainAccountId?: string | null | undefined;
  readonly inventoryLossAccountId?: string | null | undefined;
  readonly defaultLocationId?: string | null | undefined;
  readonly reorderPointMicros?: string | undefined;
  readonly safetyStockMicros?: string | undefined;
  readonly preferredStockMicros?: string | undefined;
  readonly leadTimeDays?: number | undefined;
  readonly orderMultipleMicros?: string | undefined;
  readonly minimumOrderMicros?: string | undefined;
  /** Only moving weighted average is production-supported in this release. */
  readonly inventoryCostingMethod?: "WEIGHTED_AVERAGE" | undefined;
  readonly preferredVendorId?: string | null | undefined;
  readonly defaultTaxCodeId?: string | null | undefined;
  readonly unitOfMeasure?: string | null | undefined;
  readonly productImageReference?: string | null | undefined;
  /** Operator-supplied tariff reference; PennyWise never classifies goods. */
  readonly hsTariffCode?: string | null | undefined;
  readonly countryOfOrigin?: string | null | undefined;
}
type ProductRow = Prisma.ProductItemGetPayload<{ include: { incomeAccount: true } }>;

export type ProductPatch = { readonly version: number } & {
  [Key in keyof ProductInput]?: ProductInput[Key] | undefined;
};

export class ProductService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext, active?: boolean) {
    await this.authorization.assert(context, "products:read", "ProductItem");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.productItem.findMany({
        where: {
          organizationId: context.organizationId,
          ...(active === undefined ? {} : { active })
        },
        include: { incomeAccount: true },
        orderBy: [{ name: "asc" }, { sku: "asc" }],
        take: 100
      });
      return rows.map(productDto);
    });
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "products:read", "ProductItem", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.productItem.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { incomeAccount: true }
      })
    );
    if (!row) throw new AppError("PRODUCT_NOT_FOUND", "Product or service was not found.", 404);
    return productDto(row);
  }

  public async customsReadiness(context: OrganizationContext) {
    await this.authorization.assert(context, "products:read", "ProductItem");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const products = await tx.productItem.findMany({
        where: {
          organizationId: context.organizationId,
          active: true,
          OR: [{ hsTariffCode: null }, { countryOfOrigin: null }]
        },
        orderBy: [{ name: "asc" }, { sku: "asc" }],
        select: {
          id: true,
          sku: true,
          name: true,
          itemType: true,
          hsTariffCode: true,
          countryOfOrigin: true
        },
        take: 500
      });
      return {
        purpose:
          "HS tariff code and country of origin are operator-supplied shipping references. PennyWise does not classify goods, determine duty, or provide tariff advice.",
        products: products.map((product) => ({
          ...product,
          missingHsTariffCode: !product.hsTariffCode,
          missingCountryOfOrigin: !product.countryOfOrigin
        })),
        summary: {
          productsMissingEither: products.length,
          productsMissingHsTariffCode: products.filter((product) => !product.hsTariffCode).length,
          productsMissingCountryOfOrigin: products.filter((product) => !product.countryOfOrigin)
            .length
        }
      };
    });
  }

  public async create(context: OrganizationContext, input: ProductInput) {
    await this.authorization.assert(context, "products:manage", "ProductItem");
    assertProductIdentifierValidity(input);
    assertProductCustomsAttributes(input);
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const accounts = await this.validateReferences(
          tx,
          context.organizationId,
          context.companyId,
          input
        );
        const row = await tx.productItem.create({
          data: {
            ...productData(context, input),
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "PRODUCT_CREATED", row.id, {
          itemType: row.itemType,
          incomeAccountId: accounts.income.id
        });
        return productDto({ ...row, incomeAccount: accounts.income });
      });
    } catch (error) {
      if (isUnique(error)) throw new AppError("PRODUCT_SKU_EXISTS", "SKU is already in use.", 409);
      throw error;
    }
  }

  public async update(context: OrganizationContext, id: string, input: ProductPatch) {
    await this.authorization.assert(context, "products:manage", "ProductItem", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.productItem.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("PRODUCT_NOT_FOUND", "Product or service was not found.", 404);
      const merged = { ...current, ...input } as ProductInput;
      assertProductIdentifierValidity(merged);
      assertProductCustomsAttributes(merged);
      if (
        input.inventoryCostingMethod !== undefined &&
        input.inventoryCostingMethod !== current.inventoryCostingMethod
      ) {
        const movementCount = await tx.inventoryMovement.count({
          where: { productItemId: id, organizationId: context.organizationId }
        });
        if (movementCount > 0)
          throw new AppError(
            "INVENTORY_COSTING_LOCKED",
            "Costing method cannot change after inventory movements exist; use controlled revaluation.",
            409
          );
      }
      const accounts = await this.validateReferences(
        tx,
        context.organizationId,
        context.companyId,
        merged
      );
      const result = await tx.productItem.updateMany({
        where: { id, organizationId: context.organizationId, version: input.version },
        data: {
          ...productData(context, merged),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError("STALE_PRODUCT", "Product was changed by another request.", 409);
      const row = await tx.productItem.findUniqueOrThrow({
        where: { id },
        include: { incomeAccount: true }
      });
      await audit(tx, context, "PRODUCT_UPDATED", id, {
        changed: Object.keys(input).filter((key) => key !== "version")
      });
      return productDto({ ...row, incomeAccount: accounts.income });
    });
  }

  public async archive(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "products:manage", "ProductItem", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.productItem.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: { active: false, updatedByUserId: context.user.id, version: { increment: 1 } }
      });
      if (result.count !== 1)
        throw new AppError("STALE_PRODUCT", "Product was changed by another request.", 409);
      const row = await tx.productItem.findUniqueOrThrow({
        where: { id },
        include: { incomeAccount: true }
      });
      await audit(tx, context, "PRODUCT_ARCHIVED", id, {});
      return productDto(row);
    });
  }

  private async validateReferences(
    tx: Prisma.TransactionClient,
    organizationId: string,
    companyId: string | null | undefined,
    input: ProductInput
  ) {
    const ids = [
      ...new Set(
        [
          input.incomeAccountId,
          input.expenseAccountId,
          input.inventoryAssetAccountId,
          input.costOfGoodsSoldAccountId,
          input.purchaseClearingAccountId,
          input.adjustmentGainAccountId,
          input.inventoryLossAccountId
        ].filter(Boolean) as string[]
      )
    ];
    const rows = await tx.account.findMany({ where: { organizationId, id: { in: ids } } });
    if (rows.length !== ids.length)
      throw new AppError(
        "ACCOUNT_NOT_FOUND",
        "Product accounts must belong to this organization.",
        422
      );
    const income = rows.find((row) => row.id === input.incomeAccountId)!;
    if (
      income.isArchived ||
      !["REVENUE", "CONTRA_REVENUE"].includes(income.type) ||
      income.isControl
    )
      throw new AppError(
        "INVALID_INCOME_ACCOUNT",
        "Income account must be an active non-control revenue account.",
        422
      );
    if (
      input.itemType === "INVENTORY_PRODUCT" &&
      (!input.inventoryAssetAccountId ||
        !input.costOfGoodsSoldAccountId ||
        !input.purchaseClearingAccountId ||
        !input.adjustmentGainAccountId ||
        !input.inventoryLossAccountId ||
        !input.defaultLocationId)
    )
      throw new AppError(
        "INVENTORY_ACCOUNTS_REQUIRED",
        "Inventory items require asset, cost-of-goods, clearing, gain, loss, and default-location configuration.",
        422
      );
    if (input.expenseAccountId && rows.find((row) => row.id === input.expenseAccountId)!.isArchived)
      throw new AppError("ACCOUNT_ARCHIVED", "Expense account is archived.", 422);
    if (
      input.inventoryAssetAccountId &&
      rows.find((row) => row.id === input.inventoryAssetAccountId)!.isArchived
    )
      throw new AppError("ACCOUNT_ARCHIVED", "Inventory asset account is archived.", 422);
    if (input.itemType === "INVENTORY_PRODUCT") {
      assertAccount(rows, input.inventoryAssetAccountId!, ["ASSET"], "inventory asset");
      assertAccount(rows, input.purchaseClearingAccountId!, ["ASSET"], "purchase clearing");
      assertAccount(rows, input.costOfGoodsSoldAccountId!, ["EXPENSE"], "cost of goods sold");
      assertAccount(rows, input.inventoryLossAccountId!, ["EXPENSE"], "inventory loss");
      assertAccount(
        rows,
        input.adjustmentGainAccountId!,
        ["REVENUE", "CONTRA_REVENUE"],
        "inventory adjustment gain"
      );
      const location = await tx.inventoryLocation.findFirst({
        where: {
          id: input.defaultLocationId!,
          organizationId,
          ...(companyId ? { companyId } : {}),
          isActive: true
        }
      });
      if (!location)
        throw new AppError(
          "INVENTORY_LOCATION_NOT_FOUND",
          "The default inventory location must be active and belong to this organization.",
          422
        );
    }
    if (input.preferredVendorId) {
      const vendor = await tx.vendor.findFirst({
        where: { id: input.preferredVendorId, organizationId, isActive: true }
      });
      if (!vendor)
        throw new AppError(
          "VENDOR_NOT_FOUND",
          "The preferred vendor must be active and belong to this organization.",
          422
        );
    }
    if (input.defaultTaxCodeId) {
      const taxCode = await tx.taxCode.findFirst({
        where: { id: input.defaultTaxCodeId, organizationId, active: true }
      });
      if (!taxCode) throw new AppError("TAX_CODE_NOT_FOUND", "Active tax code was not found.", 422);
    }
    return { income };
  }
}

function assertProductIdentifierValidity(input: ProductInput) {
  if (!hasValidGtinCheckDigit(input.gtin))
    throw new AppError(
      "PRODUCT_GTIN_CHECK_DIGIT_INVALID",
      "A numeric 8, 12, 13, or 14 digit GTIN must have a valid check digit.",
      422
    );
}

function assertProductCustomsAttributes(input: ProductInput) {
  if (input.hsTariffCode != null && !/^\d{4,12}$/.test(input.hsTariffCode.trim()))
    throw new AppError(
      "PRODUCT_HS_TARIFF_CODE_INVALID",
      "hsTariffCode must contain 4 to 12 digits supplied by the operator.",
      422
    );
  if (input.countryOfOrigin != null && !/^[A-Za-z]{2}$/.test(input.countryOfOrigin.trim()))
    throw new AppError(
      "PRODUCT_COUNTRY_OF_ORIGIN_INVALID",
      "countryOfOrigin must be an ISO 3166-1 alpha-2 country code.",
      422
    );
}

function productData(context: OrganizationContext, input: ProductInput) {
  return {
    organizationId: context.organizationId,
    companyId: context.companyId ?? null,
    sku: input.sku ?? null,
    gtin: input.gtin ?? null,
    manufacturer: input.manufacturer ?? null,
    manufacturerPartNumber: input.manufacturerPartNumber ?? null,
    name: input.name,
    description: input.description ?? null,
    itemType: input.itemType,
    salesPriceMinor: BigInt(input.salesPriceMinor),
    purchaseCostMinor: input.purchaseCostMinor == null ? null : BigInt(input.purchaseCostMinor),
    incomeAccountId: input.incomeAccountId,
    expenseAccountId: input.expenseAccountId ?? null,
    inventoryAssetAccountId: input.inventoryAssetAccountId ?? null,
    costOfGoodsSoldAccountId: input.costOfGoodsSoldAccountId ?? null,
    purchaseClearingAccountId: input.purchaseClearingAccountId ?? null,
    adjustmentGainAccountId: input.adjustmentGainAccountId ?? null,
    inventoryLossAccountId: input.inventoryLossAccountId ?? null,
    defaultLocationId: input.defaultLocationId ?? null,
    reorderPointMicros: BigInt(input.reorderPointMicros ?? "0"),
    safetyStockMicros: BigInt(input.safetyStockMicros ?? "0"),
    preferredStockMicros: BigInt(input.preferredStockMicros ?? "0"),
    leadTimeDays: input.leadTimeDays ?? 0,
    orderMultipleMicros: BigInt(input.orderMultipleMicros ?? "0"),
    minimumOrderMicros: BigInt(input.minimumOrderMicros ?? "0"),
    inventoryCostingMethod: input.inventoryCostingMethod ?? "WEIGHTED_AVERAGE",
    preferredVendorId: input.preferredVendorId ?? null,
    defaultTaxCodeId: input.defaultTaxCodeId ?? null,
    unitOfMeasure: input.unitOfMeasure ?? null,
    productImageReference: input.productImageReference ?? null,
    hsTariffCode: input.hsTariffCode?.trim() || null,
    countryOfOrigin: input.countryOfOrigin?.trim().toUpperCase() || null
  };
}
function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
function productDto(row: ProductRow) {
  return {
    ...row,
    salesPriceMinor: row.salesPriceMinor.toString(),
    purchaseCostMinor: row.purchaseCostMinor?.toString() ?? null,
    reorderPointMicros: row.reorderPointMicros.toString(),
    safetyStockMicros: row.safetyStockMicros.toString(),
    preferredStockMicros: row.preferredStockMicros.toString(),
    orderMultipleMicros: row.orderMultipleMicros.toString(),
    minimumOrderMicros: row.minimumOrderMicros.toString(),
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
    incomeAccount: {
      id: row.incomeAccount.id,
      code: row.incomeAccount.code,
      name: row.incomeAccount.name
    }
  };
}
function assertAccount(
  rows: readonly { id: string; type: string; isArchived: boolean; isControl: boolean }[],
  id: string,
  allowedTypes: readonly string[],
  label: string
) {
  const account = rows.find((row) => row.id === id);
  if (!account || account.isArchived || account.isControl || !allowedTypes.includes(account.type))
    throw new AppError(
      "INVENTORY_ACCOUNT_INVALID",
      `The ${label} account must be active, non-control, and have an appropriate type.`,
      422
    );
}
function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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
      targetType: "ProductItem",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
