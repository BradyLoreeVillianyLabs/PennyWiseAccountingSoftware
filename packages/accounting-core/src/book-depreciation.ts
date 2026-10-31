import { createHash } from "node:crypto";
import { AppError } from "@clearledger/shared";

export const bookDepreciationCalculationVersion = "book-straight-line-v1" as const;
export const maximumBookDepreciationMonths = 1_200;

const maximumBookValueMinor = 9_223_372_036_854_775_807n;

export type BookDepreciationMethod = "NONE" | "STRAIGHT_LINE";
export type BookDepreciationConvention = "FULL_MONTH" | "NEXT_MONTH";

interface BookDepreciationInputBase {
  readonly costMinor: bigint;
  readonly residualValueMinor: bigint;
  readonly openingAccumulatedDepreciationMinor: bigint;
  readonly inServiceDate: string;
}

export interface NoBookDepreciationInput extends BookDepreciationInputBase {
  readonly method: "NONE";
  readonly convention?: null | undefined;
  readonly usefulLifeMonths?: null | undefined;
  readonly openingBalanceDate?: null | undefined;
  readonly remainingUsefulLifeMonths?: null | undefined;
}

export interface StraightLineBookDepreciationInput extends BookDepreciationInputBase {
  readonly method: "STRAIGHT_LINE";
  readonly convention: BookDepreciationConvention;
  readonly usefulLifeMonths: number;
  readonly openingBalanceDate?: string | null | undefined;
  readonly remainingUsefulLifeMonths?: number | null | undefined;
}

export type BookDepreciationInput = NoBookDepreciationInput | StraightLineBookDepreciationInput;

export interface BookDepreciationScheduleLine {
  readonly sequence: number;
  readonly period: string;
  readonly depreciationMinor: bigint;
  readonly accumulatedDepreciationMinor: bigint;
  readonly netBookValueMinor: bigint;
}

export interface BookDepreciationCalculation {
  readonly calculationVersion: typeof bookDepreciationCalculationVersion;
  readonly inputHash: string;
  readonly method: BookDepreciationMethod;
  readonly convention: BookDepreciationConvention | null;
  readonly costMinor: bigint;
  readonly residualValueMinor: bigint;
  readonly depreciableBasisMinor: bigint;
  readonly openingAccumulatedDepreciationMinor: bigint;
  readonly openingNetBookValueMinor: bigint;
  readonly remainingDepreciableMinor: bigint;
  readonly firstDepreciationPeriod: string | null;
  readonly finalDepreciationPeriod: string | null;
  readonly finalAccumulatedDepreciationMinor: bigint;
  readonly finalNetBookValueMinor: bigint;
  readonly schedule: readonly BookDepreciationScheduleLine[];
}

interface NormalizedBookDepreciationInput {
  readonly method: BookDepreciationMethod;
  readonly convention: BookDepreciationConvention | null;
  readonly costMinor: bigint;
  readonly residualValueMinor: bigint;
  readonly openingAccumulatedDepreciationMinor: bigint;
  readonly inServiceDate: string;
  readonly usefulLifeMonths: number | null;
  readonly openingBalanceDate: string | null;
  readonly remainingUsefulLifeMonths: number | null;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly comparisonValue: number;
}

interface YearMonth {
  readonly year: number;
  readonly month: number;
}

export function calculateBookDepreciation(
  input: BookDepreciationInput
): BookDepreciationCalculation {
  const normalized = normalizeAndValidateInput(input);
  const depreciableBasisMinor = normalized.costMinor - normalized.residualValueMinor;
  const remainingDepreciableMinor =
    depreciableBasisMinor - normalized.openingAccumulatedDepreciationMinor;
  const openingNetBookValueMinor =
    normalized.costMinor - normalized.openingAccumulatedDepreciationMinor;
  const inputHash = hashNormalizedInput(normalized);

  if (normalized.method === "NONE") {
    return {
      calculationVersion: bookDepreciationCalculationVersion,
      inputHash,
      method: normalized.method,
      convention: null,
      costMinor: normalized.costMinor,
      residualValueMinor: normalized.residualValueMinor,
      depreciableBasisMinor,
      openingAccumulatedDepreciationMinor: normalized.openingAccumulatedDepreciationMinor,
      openingNetBookValueMinor,
      remainingDepreciableMinor,
      firstDepreciationPeriod: null,
      finalDepreciationPeriod: null,
      finalAccumulatedDepreciationMinor: normalized.openingAccumulatedDepreciationMinor,
      finalNetBookValueMinor: openingNetBookValueMinor,
      schedule: []
    };
  }

  if (remainingDepreciableMinor === 0n) {
    return {
      calculationVersion: bookDepreciationCalculationVersion,
      inputHash,
      method: normalized.method,
      convention: normalized.convention,
      costMinor: normalized.costMinor,
      residualValueMinor: normalized.residualValueMinor,
      depreciableBasisMinor,
      openingAccumulatedDepreciationMinor: normalized.openingAccumulatedDepreciationMinor,
      openingNetBookValueMinor,
      remainingDepreciableMinor,
      firstDepreciationPeriod: null,
      finalDepreciationPeriod: null,
      finalAccumulatedDepreciationMinor: normalized.openingAccumulatedDepreciationMinor,
      finalNetBookValueMinor: normalized.residualValueMinor,
      schedule: []
    };
  }

  const allocationMonths = normalized.remainingUsefulLifeMonths ?? normalized.usefulLifeMonths;
  if (allocationMonths === null)
    throw internalDepreciationError("Depreciation allocation months were not validated.");

  const firstMonth = firstDepreciationMonth(normalized);
  addMonths(firstMonth, allocationMonths - 1);

  const monthlyBaseMinor = remainingDepreciableMinor / BigInt(allocationMonths);
  const earliestPeriodRemainderCount = Number(remainingDepreciableMinor % BigInt(allocationMonths));
  const schedule: BookDepreciationScheduleLine[] = [];
  let accumulatedDepreciationMinor = normalized.openingAccumulatedDepreciationMinor;

  for (let index = 0; index < allocationMonths; index += 1) {
    const depreciationMinor = monthlyBaseMinor + (index < earliestPeriodRemainderCount ? 1n : 0n);
    accumulatedDepreciationMinor += depreciationMinor;
    schedule.push({
      sequence: index + 1,
      period: serializeYearMonth(addMonths(firstMonth, index)),
      depreciationMinor,
      accumulatedDepreciationMinor,
      netBookValueMinor: normalized.costMinor - accumulatedDepreciationMinor
    });
  }

  const finalLine = schedule.at(-1);
  if (
    !finalLine ||
    finalLine.accumulatedDepreciationMinor !==
      normalized.costMinor - normalized.residualValueMinor ||
    finalLine.netBookValueMinor !== normalized.residualValueMinor
  ) {
    throw internalDepreciationError("Depreciation schedule did not reconcile to residual value.");
  }

  return {
    calculationVersion: bookDepreciationCalculationVersion,
    inputHash,
    method: normalized.method,
    convention: normalized.convention,
    costMinor: normalized.costMinor,
    residualValueMinor: normalized.residualValueMinor,
    depreciableBasisMinor,
    openingAccumulatedDepreciationMinor: normalized.openingAccumulatedDepreciationMinor,
    openingNetBookValueMinor,
    remainingDepreciableMinor,
    firstDepreciationPeriod: schedule[0]?.period ?? null,
    finalDepreciationPeriod: finalLine.period,
    finalAccumulatedDepreciationMinor: finalLine.accumulatedDepreciationMinor,
    finalNetBookValueMinor: finalLine.netBookValueMinor,
    schedule
  };
}

function normalizeAndValidateInput(input: BookDepreciationInput): NormalizedBookDepreciationInput {
  const method: unknown = input.method;
  const convention: unknown = input.convention;
  const usefulLifeMonths: unknown = input.usefulLifeMonths;
  const openingBalanceDateValue: unknown = input.openingBalanceDate;
  const remainingUsefulLifeMonthsValue: unknown = input.remainingUsefulLifeMonths;

  assertBigInt(input.costMinor, "costMinor");
  assertBigInt(input.residualValueMinor, "residualValueMinor");
  assertBigInt(input.openingAccumulatedDepreciationMinor, "openingAccumulatedDepreciationMinor");

  if (input.costMinor <= 0n || input.costMinor > maximumBookValueMinor)
    throw depreciationError(
      "BOOK_DEPRECIATION_COST_INVALID",
      "Asset cost must be positive and within the supported minor-unit range."
    );
  if (input.residualValueMinor < 0n || input.residualValueMinor > input.costMinor)
    throw depreciationError(
      "BOOK_DEPRECIATION_RESIDUAL_INVALID",
      "Residual value must be between zero and asset cost."
    );

  const depreciableBasisMinor = input.costMinor - input.residualValueMinor;
  if (
    input.openingAccumulatedDepreciationMinor < 0n ||
    input.openingAccumulatedDepreciationMinor > depreciableBasisMinor
  ) {
    throw depreciationError(
      "BOOK_DEPRECIATION_OPENING_ACCUMULATED_INVALID",
      "Opening accumulated depreciation must be between zero and depreciable basis."
    );
  }

  const inServiceDate = parseCalendarDate(input.inServiceDate, "inServiceDate");

  if (method === "NONE") {
    if (convention !== null && convention !== undefined) {
      throw depreciationError(
        "BOOK_DEPRECIATION_CONFIGURATION_INVALID",
        "A non-depreciating asset cannot specify a depreciation convention."
      );
    }
    if (usefulLifeMonths !== null && usefulLifeMonths !== undefined) {
      throw depreciationError(
        "BOOK_DEPRECIATION_CONFIGURATION_INVALID",
        "A non-depreciating asset cannot specify a useful life."
      );
    }
    if (
      (openingBalanceDateValue !== null && openingBalanceDateValue !== undefined) ||
      (remainingUsefulLifeMonthsValue !== null && remainingUsefulLifeMonthsValue !== undefined)
    ) {
      throw depreciationError(
        "BOOK_DEPRECIATION_CONFIGURATION_INVALID",
        "A non-depreciating asset cannot specify a remaining depreciation schedule."
      );
    }
    if (input.openingAccumulatedDepreciationMinor !== depreciableBasisMinor)
      throw depreciationError(
        "BOOK_DEPRECIATION_NONE_BALANCE_INVALID",
        "A non-depreciating asset must already have net book value equal to residual value."
      );

    return {
      method,
      convention: null,
      costMinor: input.costMinor,
      residualValueMinor: input.residualValueMinor,
      openingAccumulatedDepreciationMinor: input.openingAccumulatedDepreciationMinor,
      inServiceDate: serializeCalendarDate(inServiceDate),
      usefulLifeMonths: null,
      openingBalanceDate: null,
      remainingUsefulLifeMonths: null
    };
  }

  if (method !== "STRAIGHT_LINE")
    throw depreciationError(
      "BOOK_DEPRECIATION_METHOD_INVALID",
      "Book depreciation method is not supported."
    );
  if (convention !== "FULL_MONTH" && convention !== "NEXT_MONTH")
    throw depreciationError(
      "BOOK_DEPRECIATION_CONVENTION_INVALID",
      "Book depreciation convention is not supported."
    );
  assertMonthCount(usefulLifeMonths, "usefulLifeMonths");

  const hasOpeningBalanceDate =
    openingBalanceDateValue !== null && openingBalanceDateValue !== undefined;
  const hasRemainingLife =
    remainingUsefulLifeMonthsValue !== null && remainingUsefulLifeMonthsValue !== undefined;

  if (hasOpeningBalanceDate !== hasRemainingLife)
    throw depreciationError(
      "BOOK_DEPRECIATION_OPENING_SCHEDULE_INVALID",
      "Opening balance date and remaining useful life must be provided together."
    );
  if (input.openingAccumulatedDepreciationMinor > 0n && !hasOpeningBalanceDate)
    throw depreciationError(
      "BOOK_DEPRECIATION_OPENING_SCHEDULE_REQUIRED",
      "Opening accumulated depreciation requires an opening balance date and remaining useful life."
    );

  let normalizedOpeningBalanceDate: string | null = null;
  let normalizedRemainingUsefulLifeMonths: number | null = null;
  if (hasOpeningBalanceDate && hasRemainingLife) {
    const openingBalanceDate = parseCalendarDate(openingBalanceDateValue, "openingBalanceDate");
    if (openingBalanceDate.comparisonValue < inServiceDate.comparisonValue)
      throw depreciationError(
        "BOOK_DEPRECIATION_OPENING_DATE_INVALID",
        "Opening balance date cannot precede the in-service date."
      );
    assertMonthCount(remainingUsefulLifeMonthsValue, "remainingUsefulLifeMonths");
    if (remainingUsefulLifeMonthsValue > usefulLifeMonths)
      throw depreciationError(
        "BOOK_DEPRECIATION_REMAINING_LIFE_INVALID",
        "Remaining useful life cannot exceed total useful life."
      );
    normalizedOpeningBalanceDate = serializeCalendarDate(openingBalanceDate);
    normalizedRemainingUsefulLifeMonths = remainingUsefulLifeMonthsValue;
  }

  return {
    method,
    convention,
    costMinor: input.costMinor,
    residualValueMinor: input.residualValueMinor,
    openingAccumulatedDepreciationMinor: input.openingAccumulatedDepreciationMinor,
    inServiceDate: serializeCalendarDate(inServiceDate),
    usefulLifeMonths,
    openingBalanceDate: normalizedOpeningBalanceDate,
    remainingUsefulLifeMonths: normalizedRemainingUsefulLifeMonths
  };
}

function firstDepreciationMonth(input: NormalizedBookDepreciationInput): YearMonth {
  if (input.openingBalanceDate) {
    return addMonths(
      toYearMonth(parseCalendarDate(input.openingBalanceDate, "openingBalanceDate")),
      1
    );
  }

  const inServiceMonth = toYearMonth(parseCalendarDate(input.inServiceDate, "inServiceDate"));
  return input.convention === "NEXT_MONTH" ? addMonths(inServiceMonth, 1) : inServiceMonth;
}

function hashNormalizedInput(input: NormalizedBookDepreciationInput): string {
  const canonicalInput = JSON.stringify({
    calculationVersion: bookDepreciationCalculationVersion,
    method: input.method,
    convention: input.convention,
    costMinor: input.costMinor.toString(),
    residualValueMinor: input.residualValueMinor.toString(),
    openingAccumulatedDepreciationMinor: input.openingAccumulatedDepreciationMinor.toString(),
    inServiceDate: input.inServiceDate,
    usefulLifeMonths: input.usefulLifeMonths,
    openingBalanceDate: input.openingBalanceDate,
    remainingUsefulLifeMonths: input.remainingUsefulLifeMonths
  });
  return createHash("sha256").update(canonicalInput, "utf8").digest("hex");
}

function assertBigInt(value: unknown, fieldName: string): asserts value is bigint {
  if (typeof value !== "bigint")
    throw depreciationError(
      "BOOK_DEPRECIATION_VALUE_INVALID",
      `${fieldName} must be an integer minor-unit BigInt.`
    );
}

function assertMonthCount(value: unknown, fieldName: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximumBookDepreciationMonths
  ) {
    throw depreciationError(
      "BOOK_DEPRECIATION_LIFE_INVALID",
      `${fieldName} must be a positive whole month count no greater than ${maximumBookDepreciationMonths.toString()}.`
    );
  }
}

function parseCalendarDate(value: unknown, fieldName: string): CalendarDate {
  if (typeof value !== "string") throw invalidDate(fieldName);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw invalidDate(fieldName);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9_999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw invalidDate(fieldName);
  }

  return {
    year,
    month,
    day,
    comparisonValue: year * 10_000 + month * 100 + day
  };
}

function invalidDate(fieldName: string): AppError {
  return depreciationError(
    "BOOK_DEPRECIATION_DATE_INVALID",
    `${fieldName} must be a valid YYYY-MM-DD calendar date.`
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function serializeCalendarDate(date: CalendarDate): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month
    .toString()
    .padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

function toYearMonth(date: CalendarDate): YearMonth {
  return { year: date.year, month: date.month };
}

function addMonths(value: YearMonth, increment: number): YearMonth {
  const zeroBasedMonth = value.year * 12 + (value.month - 1) + increment;
  const year = Math.floor(zeroBasedMonth / 12);
  const month = (zeroBasedMonth % 12) + 1;
  if (year < 1 || year > 9_999)
    throw depreciationError(
      "BOOK_DEPRECIATION_PERIOD_OUT_OF_RANGE",
      "Depreciation schedule exceeds the supported calendar range."
    );
  return { year, month };
}

function serializeYearMonth(value: YearMonth): string {
  return `${value.year.toString().padStart(4, "0")}-${value.month.toString().padStart(2, "0")}`;
}

function depreciationError(code: string, message: string): AppError {
  return new AppError(code, message, 422);
}

function internalDepreciationError(message: string): AppError {
  return new AppError("BOOK_DEPRECIATION_INTERNAL_ERROR", message, 500);
}
