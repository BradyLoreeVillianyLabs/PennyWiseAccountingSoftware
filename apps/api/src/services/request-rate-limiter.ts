import { AppError } from "@clearledger/shared";

export interface RequestRateLimitInput {
  readonly scope: string;
  readonly key: string;
  readonly limit: number;
  readonly windowMilliseconds: number;
}

export interface RequestRateLimiter {
  check(input: RequestRateLimitInput): Promise<void>;
}

/** Local-only limiter. Production must inject a shared, tenant-safe implementation. */
export class DevelopmentRequestRateLimiter implements RequestRateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStartedAt: number }>();

  public check(input: RequestRateLimitInput): Promise<void> {
    const now = Date.now();
    const bucket = `${input.scope}:${input.key}`;
    const current = this.attempts.get(bucket);
    if (!current || now - current.windowStartedAt >= input.windowMilliseconds) {
      this.attempts.set(bucket, { count: 1, windowStartedAt: now });
      return Promise.resolve();
    }
    if (current.count >= input.limit)
      return Promise.reject(
        new AppError("REQUEST_RATE_LIMITED", "Too many requests. Try again later.", 429)
      );
    current.count += 1;
    return Promise.resolve();
  }
}
