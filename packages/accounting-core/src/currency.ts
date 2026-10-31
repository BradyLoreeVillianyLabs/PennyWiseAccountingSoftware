import { AppError } from "@clearledger/shared";
import { MinorUnit, parseMinorUnit, roundRatioHalfUp } from "./money.js";

/** ISO 4217-style code. The registry is intentionally extensible by migration. */
export type CurrencyCode = string;

export interface CurrencyDefinition {
  readonly code: CurrencyCode;
  /** Number of decimal places in one major unit. */
  readonly exponent: number;
  readonly name: string;
}

export const defaultCurrencyDefinitions: readonly CurrencyDefinition[] = [
  { code: "CAD", exponent: 2, name: "Canadian dollar" },
  { code: "USD", exponent: 2, name: "United States dollar" },
  { code: "EUR", exponent: 2, name: "Euro" },
  { code: "GBP", exponent: 2, name: "Pound sterling" },
  { code: "AUD", exponent: 2, name: "Australian dollar" },
  { code: "CHF", exponent: 2, name: "Swiss franc" },
  { code: "JPY", exponent: 0, name: "Japanese yen" },
  { code: "KWD", exponent: 3, name: "Kuwaiti dinar" }
] as const;

export type ExactRate = Readonly<{
  /** Numerator and denominator express base major units per transaction major unit. */
  numerator: bigint;
  denominator: bigint;
}>;

export interface CurrencyRegistry {
  get(code: CurrencyCode): CurrencyDefinition;
  has(code: CurrencyCode): boolean;
}

export class InMemoryCurrencyRegistry implements CurrencyRegistry {
  private readonly definitions: ReadonlyMap<string, CurrencyDefinition>;

  public constructor(definitions: readonly CurrencyDefinition[] = defaultCurrencyDefinitions) {
    const entries = definitions.map((definition) => {
      validateCurrencyDefinition(definition);
      return [definition.code, definition] as const;
    });
    this.definitions = new Map(entries);
  }

  public get(code: CurrencyCode): CurrencyDefinition {
    const definition = this.definitions.get(code.toUpperCase());
    if (!definition) {
      throw new AppError("UNSUPPORTED_CURRENCY", `Currency ${code} is not enabled.`, 400, {
        code
      });
    }
    return definition;
  }

  public has(code: CurrencyCode): boolean {
    return this.definitions.has(code.toUpperCase());
  }
}

export function validateCurrencyDefinition(definition: CurrencyDefinition): void {
  if (!/^[A-Z]{3}$/.test(definition.code) || definition.code !== definition.code.toUpperCase()) {
    throw new AppError(
      "INVALID_CURRENCY_CODE",
      "Currency code must be an uppercase ISO-style code.",
      400
    );
  }
  if (
    !Number.isInteger(definition.exponent) ||
    definition.exponent < 0 ||
    definition.exponent > 9
  ) {
    throw new AppError(
      "INVALID_CURRENCY_EXPONENT",
      "Currency exponent must be an integer from 0 through 9.",
      400,
      {
        code: definition.code
      }
    );
  }
  if (!definition.name.trim()) {
    throw new AppError("INVALID_CURRENCY_NAME", "Currency name is required.", 400, {
      code: definition.code
    });
  }
}

export function makeExactRate(numerator: bigint, denominator: bigint): ExactRate {
  if (numerator <= 0n || denominator <= 0n) {
    throw new AppError(
      "INVALID_EXCHANGE_RATE",
      "Exchange-rate numerator and denominator must be positive.",
      400
    );
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

/** Parse a non-negative decimal without converting through a JavaScript number. */
export function parseExactRate(value: string, fieldName = "rate"): ExactRate {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || /^0+(?:\.0+)?$/.test(trimmed)) {
    throw new AppError(
      "INVALID_EXCHANGE_RATE",
      `${fieldName} must be a positive decimal rate.`,
      400,
      {
        fieldName
      }
    );
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const scale = 10n ** BigInt(fraction.length);
  return makeExactRate(BigInt(whole) * scale + BigInt(fraction || "0"), scale);
}

export function convertMinorUnits(
  transactionMinor: MinorUnit,
  transactionCurrency: CurrencyDefinition,
  baseCurrency: CurrencyDefinition,
  rate: ExactRate
): MinorUnit {
  const numerator = transactionMinor * rate.numerator * 10n ** BigInt(baseCurrency.exponent);
  const denominator = rate.denominator * 10n ** BigInt(transactionCurrency.exponent);
  return parseMinorUnit(roundRatioHalfUp(numerator, denominator), "baseAmountMinor");
}

/**
 * Parse a major-unit decimal using the currency exponent without ever passing
 * through a JavaScript number.
 */
export function parseCurrencyAmount(
  value: string,
  currency: CurrencyDefinition,
  fieldName = "amount"
): MinorUnit {
  const trimmed = value.trim();
  const pattern =
    currency.exponent === 0
      ? /^-?\d+$/
      : new RegExp(`^-?\\d+(?:\\.\\d{1,${String(currency.exponent)}})?$`);
  if (!pattern.test(trimmed)) {
    throw new AppError(
      "INVALID_CURRENCY_AMOUNT",
      `${fieldName} must use no more than ${String(currency.exponent)} decimal place${currency.exponent === 1 ? "" : "s"} for ${currency.code}.`,
      400,
      { fieldName, currency: currency.code, exponent: currency.exponent }
    );
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scale = 10n ** BigInt(currency.exponent);
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(currency.exponent, "0") || "0");
  return parseMinorUnit(negative ? -minor : minor, fieldName);
}

export function formatCurrencyAmount(value: MinorUnit, currency: CurrencyDefinition): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(currency.exponent);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(currency.exponent, "0");
  return `${negative ? "-" : ""}${whole.toString()}${currency.exponent === 0 ? "" : `.${fraction}`}`;
}

export interface AllocationWeight {
  readonly weight: bigint;
  readonly key?: string;
}

/**
 * Allocate a total by integer weights. Any residual minor units are assigned by
 * largest remainder, then stable input order. This is deterministic for retries
 * and does not create an artificial FX rounding account.
 */
export function allocateMinorUnits(
  total: MinorUnit,
  weights: readonly AllocationWeight[]
): MinorUnit[] {
  if (weights.length === 0 || weights.some(({ weight }) => weight < 0n)) {
    throw new AppError(
      "INVALID_ALLOCATION_WEIGHTS",
      "Allocation weights must be non-negative and non-empty.",
      400
    );
  }
  const denominator = weights.reduce((sum, { weight }) => sum + weight, 0n);
  if (denominator <= 0n) {
    throw new AppError(
      "INVALID_ALLOCATION_WEIGHTS",
      "At least one allocation weight must be positive.",
      400
    );
  }
  const sign = total < 0n ? -1n : 1n;
  const absoluteTotal = total < 0n ? -total : total;
  const rows = weights.map(({ weight }, index) => {
    const product = absoluteTotal * weight;
    return { index, quotient: product / denominator, remainder: product % denominator };
  });
  const allocated = rows.map(({ quotient }) => quotient);
  let residual = absoluteTotal - allocated.reduce((sum, value) => sum + value, 0n);
  const order = [...rows].sort((left, right) =>
    right.remainder > left.remainder
      ? 1
      : right.remainder < left.remainder
        ? -1
        : left.index - right.index
  );
  for (const row of order) {
    if (residual === 0n) break;
    allocated[row.index] = (allocated[row.index] ?? 0n) + 1n;
    residual -= 1n;
  }
  return allocated.map((value) => sign * value);
}

/**
 * Convert a balanced set of signed transaction-currency components into base
 * currency. Positive values are debits and negative values are credits.
 *
 * Both sides are allocated independently to the one converted control total,
 * so journal balance is exact even when individually rounded lines would
 * differ by a minor unit.
 */
export function convertBalancedComponents(
  transactionComponents: readonly MinorUnit[],
  transactionCurrency: CurrencyDefinition,
  baseCurrency: CurrencyDefinition,
  rate: ExactRate
): MinorUnit[] {
  if (transactionComponents.length < 2) {
    throw new AppError(
      "INVALID_FX_COMPONENTS",
      "At least two transaction-currency components are required.",
      400
    );
  }
  const transactionTotal = transactionComponents.reduce((sum, value) => sum + value, 0n);
  if (transactionTotal !== 0n) {
    throw new AppError(
      "UNBALANCED_FX_COMPONENTS",
      "Transaction-currency components must balance before conversion.",
      422,
      { transactionTotal: transactionTotal.toString() }
    );
  }
  const debitTotal = transactionComponents
    .filter((value) => value > 0n)
    .reduce((sum, value) => sum + value, 0n);
  if (debitTotal <= 0n) {
    throw new AppError(
      "INVALID_FX_COMPONENTS",
      "Transaction-currency components require debit and credit values.",
      422
    );
  }
  const baseControlTotal = convertMinorUnits(debitTotal, transactionCurrency, baseCurrency, rate);
  const debitIndexes = transactionComponents
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value > 0n);
  const creditIndexes = transactionComponents
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value < 0n);
  const debitAllocations = allocateMinorUnits(
    baseControlTotal,
    debitIndexes.map(({ value }) => ({ weight: value }))
  );
  const creditAllocations = allocateMinorUnits(
    baseControlTotal,
    creditIndexes.map(({ value }) => ({ weight: -value }))
  );
  const converted = transactionComponents.map(() => 0n);
  debitIndexes.forEach(({ index }, allocationIndex) => {
    converted[index] = debitAllocations[allocationIndex]!;
  });
  creditIndexes.forEach(({ index }, allocationIndex) => {
    converted[index] = -creditAllocations[allocationIndex]!;
  });
  converted.forEach((value, index) => {
    parseMinorUnit(value, `baseComponents[${String(index)}]`);
  });
  return converted;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}
