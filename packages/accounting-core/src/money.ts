import { AppError } from "@clearledger/shared";

export type MinorUnit = bigint;

const integerPattern = /^-?\d+$/;
const minPostgresBigInt = -9223372036854775808n;
const maxPostgresBigInt = 9223372036854775807n;

export function parseMinorUnit(value: unknown, fieldName = "amount"): MinorUnit {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value !== "string" || !integerPattern.test(value)) {
    throw new AppError(
      "INVALID_MINOR_UNIT",
      `${fieldName} must be an integer minor-unit string.`,
      400,
      { fieldName }
    );
  }

  const minorUnit = BigInt(value);

  if (minorUnit < minPostgresBigInt || minorUnit > maxPostgresBigInt) {
    throw new AppError("MINOR_UNIT_OUT_OF_RANGE", `${fieldName} exceeds database range.`, 400, {
      fieldName,
      min: minPostgresBigInt.toString(),
      max: maxPostgresBigInt.toString()
    });
  }

  return minorUnit;
}

export function serializeMinorUnit(value: MinorUnit): string {
  return value.toString();
}

export function sumMinorUnits(values: readonly MinorUnit[]): MinorUnit {
  return values.reduce<MinorUnit>((total, value) => total + value, 0n);
}

const quantityScale = 1_000_000n;

export function parseQuantityMicros(value: unknown, fieldName = "quantity"): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value.trim())) {
    throw new AppError(
      "INVALID_QUANTITY",
      `${fieldName} must be a positive decimal quantity.`,
      400,
      {
        fieldName
      }
    );
  }
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const micros = BigInt(whole) * quantityScale + BigInt(fraction.padEnd(6, "0"));
  if (micros <= 0n || micros > maxPostgresBigInt) {
    throw new AppError(
      "QUANTITY_OUT_OF_RANGE",
      `${fieldName} is outside the supported range.`,
      400,
      {
        fieldName
      }
    );
  }
  return micros;
}

export function serializeQuantityMicros(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / quantityScale;
  const fraction = (absolute % quantityScale).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

export function roundRatioHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n)
    throw new AppError(
      "INVALID_ROUNDING_DENOMINATOR",
      "Rounding denominator must be positive.",
      500
    );
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  return sign * (quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

export function multiplyMinorByQuantity(unitPriceMinor: bigint, quantityMicros: bigint): bigint {
  return roundRatioHalfUp(unitPriceMinor * quantityMicros, quantityScale);
}

export function parseDecimalMillionths(value: string, fieldName = "rate"): bigint {
  if (!/^(?:0|1)(?:\.\d{1,6})?$/.test(value)) {
    throw new AppError("INVALID_RATE", `${fieldName} must be a decimal between zero and one.`, 400);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * quantityScale + BigInt(fraction.padEnd(6, "0"));
}
