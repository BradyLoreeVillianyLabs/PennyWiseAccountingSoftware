import { AppError } from "@clearledger/shared";

export interface WebhookRateLimiter {
  check(key: string): Promise<void>;
}

/** Development-only fixed-window limiter. Production must provide a shared implementation. */
export class DevelopmentWebhookRateLimiter implements WebhookRateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStartedAt: number }>();

  public constructor(
    private readonly limit = 120,
    private readonly windowMilliseconds = 60_000
  ) {}

  public check(key: string): Promise<void> {
    const now = Date.now();
    const current = this.attempts.get(key);
    if (!current || now - current.windowStartedAt >= this.windowMilliseconds) {
      this.attempts.set(key, { count: 1, windowStartedAt: now });
      return Promise.resolve();
    }
    if (current.count >= this.limit)
      return Promise.reject(
        new AppError("PAYMENT_WEBHOOK_RATE_LIMITED", "Too many webhook requests.", 429)
      );
    current.count += 1;
    return Promise.resolve();
  }
}
