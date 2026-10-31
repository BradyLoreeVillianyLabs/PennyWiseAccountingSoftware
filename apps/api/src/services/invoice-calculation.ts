import {
  multiplyMinorByQuantity,
  parseMinorUnit,
  parseQuantityMicros,
  roundRatioHalfUp,
  serializeQuantityMicros
} from "@clearledger/accounting-core";
import { Prisma } from "@clearledger/db";
import { AppError } from "@clearledger/shared";
import { calculateTax as calculateCentralTax } from "./tax-calculation-service.js";

export interface LineCalculationInput {
  readonly productItemId?: string | null | undefined;
  readonly description?: string | undefined;
  readonly quantity: string;
  readonly unitPriceMinor?: string | undefined;
  readonly discountMinor?: string | undefined;
  readonly taxCodeId?: string | null | undefined;
  /**
   * Routes a line with no product item to a specific revenue account — a store
   * order's shipping charge, for example. Ignored when the line has a product,
   * whose own income account stays authoritative. Omitting it keeps the previous
   * behaviour of falling back to the `sales` account.
   */
  readonly incomeAccountId?: string | null | undefined;
}

export interface CalculatedLine {
  readonly productItemId: string | null;
  readonly sku: string | null;
  readonly description: string;
  readonly quantityMicros: bigint;
  readonly unitPriceMinor: bigint;
  readonly grossAmountMinor: bigint;
  readonly discountMinor: bigint;
  readonly netAmountMinor: bigint;
  readonly taxableAmountMinor: bigint;
  readonly taxTotalMinor: bigint;
  readonly totalMinor: bigint;
  readonly taxCodeId: string | null;
  readonly taxCodeVersionId: string | null;
  readonly taxSnapshot: Prisma.InputJsonObject | null;
  readonly incomeAccountId: string;
  readonly incomeAccountCode: string;
  readonly incomeAccountName: string;
  readonly taxComponents: readonly TaxComponentCalculation[];
}

export interface TaxComponentCalculation {
  readonly name: string;
  readonly jurisdiction: string;
  readonly rate: string;
  readonly payableAccountId: string | null;
  readonly amountMinor: bigint;
}

export async function calculateLine(
  tx: Prisma.TransactionClient,
  organizationId: string,
  issueDate: Date,
  input: LineCalculationInput
): Promise<CalculatedLine> {
  const quantityMicros = parseQuantityMicros(input.quantity);
  const product = input.productItemId
    ? await tx.productItem.findFirst({
        where: { id: input.productItemId, organizationId },
        include: { incomeAccount: true }
      })
    : null;
  if (input.productItemId && !product)
    throw new AppError("PRODUCT_NOT_FOUND", "Product or service was not found.", 422);
  if (product && !product.active)
    throw new AppError("PRODUCT_INACTIVE", "Inactive products cannot be invoiced.", 422);
  const unitPriceMinor =
    input.unitPriceMinor === undefined
      ? (product?.salesPriceMinor ??
        (() => {
          throw new AppError(
            "UNIT_PRICE_REQUIRED",
            "A unit price is required for a manual line.",
            422
          );
        })())
      : parseMinorUnit(input.unitPriceMinor, "unitPriceMinor");
  if (unitPriceMinor < 0n)
    throw new AppError("INVALID_UNIT_PRICE", "Unit price cannot be negative.", 422);
  const discountMinor = parseMinorUnit(input.discountMinor ?? "0", "discountMinor");
  if (discountMinor < 0n)
    throw new AppError("INVALID_DISCOUNT", "Discount cannot be negative.", 422);
  const extended = multiplyMinorByQuantity(unitPriceMinor, quantityMicros);
  const sign = product?.itemType === "DISCOUNT" ? -1n : 1n;
  if (product?.itemType === "DISCOUNT" && discountMinor !== 0n)
    throw new AppError(
      "DISCOUNT_LINE_INVALID",
      "Discount items cannot have a second line discount.",
      422
    );
  if (sign > 0n && discountMinor > extended)
    throw new AppError(
      "DISCOUNT_EXCEEDS_LINE",
      "Line discount cannot exceed the line amount.",
      422
    );
  const grossAmountMinor = sign * extended;
  const afterDiscount = grossAmountMinor - discountMinor;
  const taxCodeId =
    input.taxCodeId === undefined ? (product?.defaultTaxCodeId ?? null) : input.taxCodeId;
  const account =
    product?.incomeAccount ??
    (input.incomeAccountId
      ? await tx.account.findFirst({
          where: { organizationId, id: input.incomeAccountId, isArchived: false }
        })
      : null) ??
    (await tx.account.findFirst({
      where: { organizationId, systemPurpose: "sales", isArchived: false }
    }));
  if (!account || (account.type !== "REVENUE" && account.type !== "CONTRA_REVENUE"))
    throw new AppError("INCOME_ACCOUNT_NOT_FOUND", "An active income account is required.", 422);

  const tax = await calculateCentralTax(tx, {
    organizationId,
    taxDate: issueDate,
    taxCodeId,
    amountMinor: afterDiscount,
    purpose: "SALE"
  });
  const netAmountMinor = tax.calculationMode === "INCLUSIVE" ? tax.taxableBaseMinor : afterDiscount;
  const totalMinor =
    tax.calculationMode === "INCLUSIVE" ? afterDiscount : afterDiscount + tax.taxTotalMinor;
  return {
    productItemId: product?.id ?? null,
    sku: product?.sku ?? null,
    description: input.description?.trim() || product?.name || "Invoice line",
    quantityMicros,
    unitPriceMinor,
    grossAmountMinor,
    discountMinor,
    netAmountMinor,
    taxableAmountMinor: netAmountMinor,
    taxTotalMinor: tax.taxTotalMinor,
    totalMinor,
    taxCodeId,
    taxCodeVersionId: tax.taxCodeVersionId,
    taxSnapshot: tax.snapshot,
    incomeAccountId: account.id,
    incomeAccountCode: account.code,
    incomeAccountName: account.name,
    taxComponents: tax.components.map((component) => ({
      name: component.name,
      jurisdiction: component.jurisdiction,
      rate: component.rate,
      payableAccountId: component.payableAccountId,
      amountMinor: component.totalMinor
    }))
  };
}

export function calculatedLineInput(line: {
  productItemId: string | null;
  description: string;
  quantityMicros: bigint;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  taxCodeId: string | null;
}): LineCalculationInput {
  return {
    productItemId: line.productItemId,
    description: line.description,
    quantity: serializeQuantityMicros(line.quantityMicros),
    unitPriceMinor: line.unitPriceMinor.toString(),
    discountMinor: line.discountMinor.toString(),
    taxCodeId: line.taxCodeId
  };
}

export function prorateAmount(
  amountMinor: bigint,
  quantityMicros: bigint,
  sourceQuantityMicros: bigint
): bigint {
  return roundRatioHalfUp(amountMinor * quantityMicros, sourceQuantityMicros);
}
