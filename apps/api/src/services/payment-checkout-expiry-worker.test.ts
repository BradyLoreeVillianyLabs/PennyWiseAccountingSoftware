import type { PrismaClient } from "@clearledger/db";
import { describe, expect, it } from "vitest";
import { PaymentCheckoutExpiryWorker } from "./payment-checkout-expiry-worker.js";
import type { PaymentProviderAdapter } from "./payment-provider.js";

const organizationId = "00000000-0000-0000-0000-000000000001";
const actorUserId = "00000000-0000-0000-0000-000000000002";

describe("PaymentCheckoutExpiryWorker", () => {
  it("cancels an expired checkout and records the provider-side cancellation", async () => {
    const now = new Date("2026-09-11T20:00:00.000Z");
    const database = new FakePrisma([session({ expiresAt: new Date("2026-09-11T19:59:00.000Z") })]);
    const calls: string[] = [];
    const worker = new PaymentCheckoutExpiryWorker(
      database.asPrisma(),
      provider({
        cancelHostedCheckout: (accountId, providerSessionId, idempotencyKey) => {
          calls.push(`${accountId}:${providerSessionId}:${idempotencyKey}`);
          return Promise.resolve();
        }
      }),
      "SQUARE",
      identityProtector,
      () => now
    );

    const result = await worker.sweep(organizationId, actorUserId);

    expect(result).toEqual({ claimed: 1, cancelled: 1, failed: 0, skipped: 0 });
    expect(calls).toEqual(["square-token:SQUARE-LINK-1:checkout-expiry:checkout-1"]);
    expect(database.read("checkout-1")).toMatchObject({
      cancelledAt: now,
      cancellationClaimedAt: null,
      cancellationAttempts: 1,
      cancellationLastError: null
    });
  });

  it("records a provider failure and retries it after the lease on a later process run", async () => {
    let now = new Date("2026-09-11T20:00:00.000Z");
    const database = new FakePrisma([session({ expiresAt: new Date("2026-09-11T19:59:00.000Z") })]);
    let attempts = 0;
    const worker = new PaymentCheckoutExpiryWorker(
      database.asPrisma(),
      provider({
        cancelHostedCheckout: () => {
          attempts++;
          if (attempts === 1)
            return Promise.reject(new Error("provider details must not be persisted"));
          return Promise.resolve();
        }
      }),
      "SQUARE",
      identityProtector,
      () => now,
      5_000
    );

    const first = await worker.sweep(organizationId, actorUserId);
    expect(first).toEqual({ claimed: 1, cancelled: 0, failed: 1, skipped: 0 });
    expect(database.read("checkout-1")).toMatchObject({
      cancelledAt: null,
      cancellationClaimedAt: now,
      cancellationAttempts: 1,
      cancellationLastError: "PAYMENT_CHECKOUT_CANCELLATION_FAILED"
    });

    now = new Date(now.getTime() + 5_001);
    const second = await worker.sweep(organizationId, actorUserId);
    expect(second).toEqual({ claimed: 1, cancelled: 1, failed: 0, skipped: 0 });
    expect(database.read("checkout-1")).toMatchObject({
      cancelledAt: now,
      cancellationClaimedAt: null,
      cancellationAttempts: 2,
      cancellationLastError: null
    });
  });

  it("does not allow a second process to claim a live cancellation lease", async () => {
    const now = new Date("2026-09-11T20:00:00.000Z");
    const database = new FakePrisma([session({ expiresAt: new Date("2026-09-11T19:59:00.000Z") })]);
    let releaseProvider!: () => void;
    const providerCallStarted = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const firstWorker = new PaymentCheckoutExpiryWorker(
      database.asPrisma(),
      provider({
        cancelHostedCheckout: () => providerCallStarted
      }),
      "SQUARE",
      identityProtector,
      () => now
    );
    const firstSweep = firstWorker.sweep(organizationId, actorUserId);
    await Promise.resolve();

    const secondWorker = new PaymentCheckoutExpiryWorker(
      database.asPrisma(),
      provider({ cancelHostedCheckout: () => Promise.resolve() }),
      "SQUARE",
      identityProtector,
      () => now
    );
    expect(await secondWorker.sweep(organizationId, actorUserId)).toEqual({
      claimed: 0,
      cancelled: 0,
      failed: 0,
      skipped: 0
    });
    releaseProvider();
    expect(await firstSweep).toEqual({ claimed: 1, cancelled: 1, failed: 0, skipped: 0 });
  });

  it("fails closed when the selected provider has no cancellation operation", async () => {
    const now = new Date("2026-09-11T20:00:00.000Z");
    const database = new FakePrisma([session({ expiresAt: new Date("2026-09-11T19:59:00.000Z") })]);
    const result = await new PaymentCheckoutExpiryWorker(
      database.asPrisma(),
      provider({}),
      "SQUARE",
      identityProtector,
      () => now
    ).sweep(organizationId, actorUserId);

    expect(result).toEqual({ claimed: 1, cancelled: 0, failed: 1, skipped: 0 });
    expect(database.read("checkout-1")).toMatchObject({
      cancelledAt: null,
      cancellationLastError: "PAYMENT_CHECKOUT_CANCELLATION_UNSUPPORTED"
    });
  });
});

const identityProtector = {
  protect: (value: string) => value,
  reveal: (value: string) => value
};

function provider(
  cancellation: Pick<PaymentProviderAdapter, "cancelHostedCheckout">
): PaymentProviderAdapter {
  return cancellation as unknown as PaymentProviderAdapter;
}

function session(overrides: Partial<FakeSession>): FakeSession {
  return {
    id: "checkout-1",
    organizationId,
    paymentAccountId: "account-1",
    providerSessionId: "SQUARE-LINK-1",
    providerAccountCiphertext: "square-token",
    expiresAt: new Date("2026-09-11T19:59:00.000Z"),
    completedAt: null,
    cancelledAt: null,
    cancellationClaimedAt: null,
    cancellationAttempts: 0,
    cancellationLastError: null,
    ...overrides
  };
}

interface FakeSession {
  id: string;
  organizationId: string;
  paymentAccountId: string;
  providerSessionId: string;
  providerAccountCiphertext: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationClaimedAt: Date | null;
  cancellationAttempts: number;
  cancellationLastError: string | null;
}

class FakePrisma {
  private readonly sessions: FakeSession[];
  public readonly paymentCheckoutSession = {} as {
    updateMany: (input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };

  public constructor(sessions: FakeSession[]) {
    this.sessions = sessions;
    this.paymentCheckoutSession.updateMany = ({
      where,
      data
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const matching = this.sessions.filter((candidate) => matches(candidate, where));
      for (const candidate of matching) {
        for (const [key, value] of Object.entries(data)) {
          if (isIncrement(value))
            candidate[key as keyof FakeSession] = ((candidate[key as keyof FakeSession] as number) +
              value.increment) as never;
          else candidate[key as keyof FakeSession] = value as never;
        }
      }
      return Promise.resolve({ count: matching.length });
    };
  }

  public $transaction<T>(work: (tx: this) => Promise<T>): Promise<T> {
    return work(this);
  }

  public $executeRawUnsafe(): Promise<number> {
    return Promise.resolve(0);
  }

  public $executeRaw(): Promise<number> {
    return Promise.resolve(0);
  }

  public $queryRaw(
    _strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<
    readonly Pick<
      FakeSession,
      "id" | "paymentAccountId" | "providerSessionId" | "providerAccountCiphertext"
    >[]
  > {
    const claimedAt = values[2] as Date;
    const claimBefore = values[3] as Date;
    return Promise.resolve(
      this.sessions
        .filter(
          (candidate) =>
            candidate.expiresAt <= claimedAt &&
            !candidate.completedAt &&
            !candidate.cancelledAt &&
            (!candidate.cancellationClaimedAt || candidate.cancellationClaimedAt <= claimBefore)
        )
        .map(({ id, paymentAccountId, providerSessionId, providerAccountCiphertext }) => ({
          id,
          paymentAccountId,
          providerSessionId,
          providerAccountCiphertext
        }))
    );
  }

  public read(id: string): FakeSession {
    return this.sessions.find((candidate) => candidate.id === id)!;
  }

  public asPrisma(): PrismaClient {
    return this as unknown as PrismaClient;
  }
}

function matches(candidate: FakeSession, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = candidate[key as keyof FakeSession];
    if (value instanceof Date && actual instanceof Date)
      return value.getTime() === actual.getTime();
    return actual === value;
  });
}

function isIncrement(value: unknown): value is { increment: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "increment" in value &&
    typeof value.increment === "number"
  );
}
