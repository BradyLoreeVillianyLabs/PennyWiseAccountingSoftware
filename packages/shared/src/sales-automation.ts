import { AppError } from "./errors.js";

export const estimateStatuses = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
  "CONVERTED"
] as const;

export type EstimateStatus = (typeof estimateStatuses)[number];

const estimateTransitions: Readonly<Record<EstimateStatus, readonly EstimateStatus[]>> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"],
  VIEWED: ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["CONVERTED", "CANCELLED"],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
  CONVERTED: []
};

export function canTransitionEstimate(current: EstimateStatus, next: EstimateStatus): boolean {
  return estimateTransitions[current].includes(next);
}

export function assertEstimateTransition(current: EstimateStatus, next: EstimateStatus): void {
  if (!canTransitionEstimate(current, next)) {
    throw new AppError(
      "ESTIMATE_INVALID_TRANSITION",
      `An estimate cannot move from ${current} to ${next}.`,
      409,
      { current, next }
    );
  }
}

export type RecurrenceFrequency = "WEEK" | "MONTH" | "YEAR";

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly dayOfMonth?: number;
  readonly timeZone: string;
}

export function nextRecurrenceDate(
  previous: Date,
  rule: RecurrenceRule,
  calendar = new Date(previous.getTime())
): Date {
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 120) {
    throw new AppError("RECURRENCE_INTERVAL_INVALID", "Recurrence interval must be 1–120.", 400);
  }
  if (!rule.timeZone || !Intl.supportedValuesOf("timeZone").includes(rule.timeZone)) {
    throw new AppError("RECURRENCE_TIMEZONE_INVALID", "Recurrence timezone is not supported.", 400);
  }

  const next = new Date(calendar.getTime());
  if (rule.frequency === "WEEK") next.setUTCDate(next.getUTCDate() + 7 * rule.interval);
  if (rule.frequency === "MONTH") {
    const requestedDay = rule.dayOfMonth ?? previous.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + rule.interval);
    const lastDay = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
    ).getUTCDate();
    next.setUTCDate(Math.min(requestedDay, lastDay));
  }
  if (rule.frequency === "YEAR") {
    next.setUTCFullYear(next.getUTCFullYear() + rule.interval);
  }
  return next;
}

export function estimateConversionIdempotencyKey(estimateId: string, version: number): string {
  if (!estimateId || !Number.isInteger(version) || version < 1) {
    throw new AppError(
      "ESTIMATE_CONVERSION_KEY_INVALID",
      "Estimate conversion identity is invalid.",
      400
    );
  }
  return `estimate-conversion:${estimateId}:v${String(version)}`;
}

export function recurrenceRunIdempotencyKey(scheduleId: string, runAt: Date): string {
  return `recurring-run:${scheduleId}:${runAt.toISOString()}`;
}
