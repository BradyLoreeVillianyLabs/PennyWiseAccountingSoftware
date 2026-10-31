import { AppError } from "@clearledger/shared";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string, fieldName: string): Date {
  const normalized = dateOnlyPattern.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(
      "INVALID_DATE",
      `${fieldName} must be an RFC 3339 or YYYY-MM-DD date.`,
      400,
      {
        fieldName
      }
    );
  }

  return date;
}

export function serializeDate(date: Date): string {
  return date.toISOString();
}
