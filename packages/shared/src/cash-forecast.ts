export interface CashForecastDriver {
  readonly label: string;
  readonly amountMinor: bigint;
  readonly confidence: "ACTUAL" | "PROJECTED" | "ASSUMED";
}

export interface CashForecastWeek {
  readonly weekStart: string;
  readonly openingMinor: bigint;
  readonly inflowsMinor: bigint;
  readonly outflowsMinor: bigint;
  readonly closingMinor: bigint;
  readonly drivers: readonly CashForecastDriver[];
}

export function buildThirteenWeekForecast(
  openingMinor: bigint,
  weekStarts: readonly string[],
  driversByWeek: readonly (readonly CashForecastDriver[])[]
): readonly CashForecastWeek[] {
  if (weekStarts.length !== 13 || driversByWeek.length !== 13)
    throw new Error("A cash forecast must contain exactly 13 weeks.");
  let opening = openingMinor;
  return weekStarts.map((weekStart, index) => {
    const drivers = driversByWeek[index] ?? [];
    const inflowsMinor = drivers
      .filter((driver) => driver.amountMinor >= 0n)
      .reduce((sum, driver) => sum + driver.amountMinor, 0n);
    const outflowsMinor = drivers
      .filter((driver) => driver.amountMinor < 0n)
      .reduce((sum, driver) => sum + -driver.amountMinor, 0n);
    const closingMinor = opening + inflowsMinor - outflowsMinor;
    const week = {
      weekStart,
      openingMinor: opening,
      inflowsMinor,
      outflowsMinor,
      closingMinor,
      drivers
    };
    opening = closingMinor;
    return week;
  });
}
