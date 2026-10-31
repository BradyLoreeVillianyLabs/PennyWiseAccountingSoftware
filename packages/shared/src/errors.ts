export interface ErrorDetails {
  readonly [key: string]: unknown;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: ErrorDetails | undefined;

  public constructor(code: string, message: string, statusCode = 400, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function assertFound<T>(value: T | null | undefined, code: string, message: string): T {
  if (value === null || value === undefined) {
    throw new AppError(code, message, 404);
  }

  return value;
}
