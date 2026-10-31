import { AppError } from "@clearledger/shared";

export const multiCurrencyReleaseMessage =
  "The first multi-currency release supports CAD and USD only.";

export function assertMultiCurrencyPostingReleased(
  transactionCurrency: string,
  baseCurrency: string
): void {
  const pair = new Set([
    transactionCurrency.trim().toUpperCase(),
    baseCurrency.trim().toUpperCase()
  ]);
  if (pair.size === 1) return;
  if (pair.size === 2 && pair.has("CAD") && pair.has("USD")) return;
  throw new AppError("CURRENCY_PAIR_NOT_RELEASED", multiCurrencyReleaseMessage, 409);
}

export function rejectMultiCurrencyRevaluation(): never {
  throw new AppError(
    "MULTI_CURRENCY_REVALUATION_NOT_RELEASED",
    "Foreign-currency revaluation is disabled until monetary-position, closing-rate, reversal, and close-control acceptance tests pass.",
    409
  );
}
