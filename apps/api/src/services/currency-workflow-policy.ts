import { Prisma } from "@clearledger/db";
import { AppError } from "@clearledger/shared";

type Tx = Prisma.TransactionClient;

export async function assertDocumentCurrency(
  tx: Tx,
  input: {
    organizationId: string;
    currency: string;
    rateSnapshotId?: string | null | undefined;
    transactionDate: Date;
    allowMissingRate?: boolean | undefined;
  }
) {
  const currency = input.currency.trim().toUpperCase();
  const organization = await tx.organization.findUnique({
    where: { id: input.organizationId },
    select: {
      currency: true,
      settings: { select: { multiCurrencyEnabled: true } }
    }
  });
  if (!organization)
    throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
  const baseCurrency = organization.currency.trim();
  if (currency === baseCurrency) {
    if (input.rateSnapshotId) {
      const rate = await tx.fxRateSnapshot.findFirst({
        where: { id: input.rateSnapshotId, organizationId: input.organizationId }
      });
      if (
        !rate ||
        rate.transactionCurrency.trim() !== baseCurrency ||
        rate.baseCurrency.trim() !== baseCurrency ||
        rate.numerator !== rate.denominator
      )
        throw new AppError(
          "FX_RATE_CURRENCY_MISMATCH",
          "A base-currency document may only reference an exact 1:1 base rate.",
          422
        );
    }
    return { currency, baseCurrency };
  }
  if (!["CAD", "USD"].includes(currency) || !["CAD", "USD"].includes(baseCurrency))
    throw new AppError(
      "CURRENCY_PAIR_NOT_RELEASED",
      "The first multi-currency release supports CAD and USD only.",
      422
    );
  if (!organization.settings?.multiCurrencyEnabled)
    throw new AppError(
      "MULTI_CURRENCY_NOT_ENABLED",
      "Enable CAD/USD multi-currency in settings before using a foreign document.",
      409
    );
  const enabled = await tx.organizationCurrency.findUnique({
    where: {
      organizationId_currencyCode: {
        organizationId: input.organizationId,
        currencyCode: currency
      }
    }
  });
  if (!enabled?.enabled)
    throw new AppError(
      "CURRENCY_NOT_ENABLED",
      `Currency ${currency} is not enabled for this organization.`,
      409
    );
  if (!input.rateSnapshotId) if (input.allowMissingRate) return { currency, baseCurrency };
  if (!input.rateSnapshotId)
    throw new AppError(
      "FX_RATE_REQUIRED",
      "Choose a documented transaction-date rate before saving this foreign document.",
      422
    );
  const rate = await tx.fxRateSnapshot.findFirst({
    where: { id: input.rateSnapshotId, organizationId: input.organizationId }
  });
  if (
    !rate ||
    rate.transactionCurrency.trim() !== currency ||
    rate.baseCurrency.trim() !== baseCurrency ||
    rate.purpose !== "TRANSACTION"
  )
    throw new AppError(
      "FX_RATE_CURRENCY_MISMATCH",
      "The selected transaction rate does not match the document and base currencies.",
      422
    );
  if (
    rate.effectiveAt.toISOString().slice(0, 10) !== input.transactionDate.toISOString().slice(0, 10)
  )
    throw new AppError(
      "FX_RATE_DATE_MISMATCH",
      "The selected transaction rate must be recorded for the document date.",
      422
    );
  return { currency, baseCurrency };
}
