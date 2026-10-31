import {
  multiplyMinorByQuantity,
  parseMinorUnit,
  parseQuantityMicros
} from "@clearledger/accounting-core";
import { Prisma } from "@clearledger/db";
import { AppError } from "@clearledger/shared";
import { calculateTax } from "./tax-calculation-service.js";

export interface PurchaseLineInput {
  readonly description: string;
  readonly quantity: string;
  readonly unitCostMinor: string;
  readonly discountMinor?: string | undefined;
  readonly accountId: string;
  readonly productItemId?: string | null | undefined;
  readonly taxCodeId?: string | null | undefined;
}

export interface PurchaseTaxComponent {
  readonly name: string;
  readonly jurisdiction: string;
  readonly rate: string;
  readonly recoverablePercent: string;
  readonly recoverableAccountId: string | null;
  readonly totalMinor: bigint;
  readonly recoverableMinor: bigint;
  readonly nonRecoverableMinor: bigint;
}

export interface CalculatedPurchaseLine {
  readonly description: string;
  readonly quantityMicros: bigint;
  readonly unitCostMinor: bigint;
  readonly grossAmountMinor: bigint;
  readonly discountMinor: bigint;
  readonly netAmountMinor: bigint;
  readonly recoverableTaxMinor: bigint;
  readonly nonRecoverableTaxMinor: bigint;
  readonly taxTotalMinor: bigint;
  readonly totalMinor: bigint;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly taxCodeId: string | null;
  readonly taxCodeVersionId: string | null;
  readonly taxSnapshot: Prisma.InputJsonObject | null;
  readonly inventoryPlaceholder: boolean;
  readonly productItemId: string | null;
  readonly taxComponents: readonly PurchaseTaxComponent[];
}

export async function calculatePurchaseLine(
  tx: Prisma.TransactionClient,
  organizationId: string,
  date: Date,
  input: PurchaseLineInput
): Promise<CalculatedPurchaseLine> {
  const quantityMicros = parseQuantityMicros(input.quantity);
  const unitCostMinor = parseMinorUnit(input.unitCostMinor, "unitCostMinor");
  const discountMinor = parseMinorUnit(input.discountMinor ?? "0", "discountMinor");
  if (unitCostMinor < 0n || discountMinor < 0n)
    throw new AppError("INVALID_PURCHASE_AMOUNT", "Purchase amounts cannot be negative.", 422);
  const grossAmountMinor = multiplyMinorByQuantity(unitCostMinor, quantityMicros);
  if (discountMinor > grossAmountMinor)
    throw new AppError("DISCOUNT_EXCEEDS_LINE", "Discount cannot exceed the line amount.", 422);
  const amountBeforeTax = grossAmountMinor - discountMinor;
  const product = input.productItemId
    ? await tx.productItem.findFirst({
        where: { id: input.productItemId, organizationId, active: true }
      })
    : null;
  if (input.productItemId && !product)
    throw new AppError("PRODUCT_NOT_FOUND", "Active purchase product was not found.", 422);
  if (product && product.itemType !== "INVENTORY_PRODUCT")
    throw new AppError(
      "PURCHASE_PRODUCT_INVALID",
      "Only inventory products can be attached to purchase lines.",
      422
    );
  if (product && !product.purchaseClearingAccountId)
    throw new AppError(
      "INVENTORY_CONFIGURATION_INCOMPLETE",
      "Inventory purchase clearing is not configured.",
      422
    );
  const accountId = product?.purchaseClearingAccountId ?? input.accountId;
  if (product && input.accountId !== accountId)
    throw new AppError(
      "INVENTORY_CLEARING_ACCOUNT_REQUIRED",
      "Inventory purchase lines must use the product purchase-clearing account.",
      422
    );
  const account = await tx.account.findFirst({
    where: { id: accountId, organizationId, isArchived: false }
  });
  if (!account || !["EXPENSE", "ASSET"].includes(account.type))
    throw new AppError(
      "PURCHASE_ACCOUNT_INVALID",
      "An active organization expense or asset account is required.",
      422
    );
  if (account.isControl)
    throw new AppError(
      "CONTROL_ACCOUNT_LINE_FORBIDDEN",
      "Purchase lines cannot post directly to a control account.",
      422
    );

  const tax = await calculateTax(tx, {
    organizationId,
    taxDate: date,
    taxCodeId: input.taxCodeId ?? null,
    amountMinor: amountBeforeTax,
    purpose: "PURCHASE"
  });
  const netAmountMinor =
    tax.calculationMode === "INCLUSIVE" ? tax.taxableBaseMinor : amountBeforeTax;
  const totalMinor =
    tax.calculationMode === "INCLUSIVE" ? amountBeforeTax : amountBeforeTax + tax.taxTotalMinor;

  return {
    description: input.description.trim(),
    quantityMicros,
    unitCostMinor,
    grossAmountMinor,
    discountMinor,
    netAmountMinor,
    recoverableTaxMinor: tax.recoverableTaxMinor,
    nonRecoverableTaxMinor: tax.nonRecoverableTaxMinor,
    taxTotalMinor: tax.taxTotalMinor,
    totalMinor,
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    taxCodeId: input.taxCodeId ?? null,
    taxCodeVersionId: tax.taxCodeVersionId,
    taxSnapshot: tax.snapshot,
    inventoryPlaceholder: account.systemPurpose === "inventory",
    productItemId: product?.id ?? null,
    taxComponents: tax.components.map((component) => ({
      name: component.name,
      jurisdiction: component.jurisdiction,
      rate: component.rate,
      recoverablePercent: component.recoverablePercent,
      recoverableAccountId: component.recoverableAccountId,
      totalMinor: component.totalMinor,
      recoverableMinor: component.recoverableMinor,
      nonRecoverableMinor: component.nonRecoverableMinor
    }))
  };
}
