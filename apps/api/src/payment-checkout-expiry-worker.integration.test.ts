import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PaymentCheckoutExpiryWorker } from "./services/payment-checkout-expiry-worker.js";
import type { PaymentProviderAdapter } from "./services/payment-provider.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const identityProtector = {
  protect: (value: string) => value,
  reveal: (value: string) => value
};

describe("PaymentCheckoutExpiryWorker database boundary", () => {
  beforeAll(async () => prisma.$connect());
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => prisma.$disconnect());

  it("sweeps only the selected tenant through the payment-webhook RLS mode", async () => {
    const first = await createExpiredCheckout("first");
    const second = await createExpiredCheckout("second");
    const cancelled: string[] = [];
    const provider = {
      cancelHostedCheckout: (
        accountId: string,
        providerSessionId: string,
        idempotencyKey: string
      ) => {
        cancelled.push(`${accountId}:${providerSessionId}:${idempotencyKey}`);
        return Promise.resolve();
      }
    } as unknown as PaymentProviderAdapter;
    const now = new Date("2026-09-11T20:00:00.000Z");
    const worker = new PaymentCheckoutExpiryWorker(
      prisma,
      provider,
      "SQUARE",
      identityProtector,
      () => now
    );

    await expect(worker.sweep(first.organizationId, first.userId)).resolves.toEqual({
      claimed: 1,
      cancelled: 1,
      failed: 0,
      skipped: 0
    });
    expect(cancelled).toEqual([
      `square-token:${first.providerSessionId}:checkout-expiry:${first.sessionId}`
    ]);
    expect(
      await prisma.paymentCheckoutSession.findUniqueOrThrow({ where: { id: first.sessionId } })
    ).toMatchObject({ cancelledAt: now, cancellationAttempts: 1 });
    expect(
      await prisma.paymentCheckoutSession.findUniqueOrThrow({ where: { id: second.sessionId } })
    ).toMatchObject({ cancelledAt: null, cancellationAttempts: 0 });
  });

  it("keeps a failed provider cancellation leased and stores only a safe error code", async () => {
    const checkout = await createExpiredCheckout("failure");
    const now = new Date("2026-09-11T20:00:00.000Z");
    const provider = {
      cancelHostedCheckout: () =>
        Promise.reject(new Error("access token must never reach the database"))
    } as unknown as PaymentProviderAdapter;
    const worker = new PaymentCheckoutExpiryWorker(
      prisma,
      provider,
      "SQUARE",
      identityProtector,
      () => now,
      5_000
    );

    await expect(worker.sweep(checkout.organizationId, checkout.userId)).resolves.toEqual({
      claimed: 1,
      cancelled: 0,
      failed: 1,
      skipped: 0
    });
    expect(
      await prisma.paymentCheckoutSession.findUniqueOrThrow({ where: { id: checkout.sessionId } })
    ).toMatchObject({
      cancelledAt: null,
      cancellationClaimedAt: now,
      cancellationAttempts: 1,
      cancellationLastError: "PAYMENT_CHECKOUT_CANCELLATION_FAILED"
    });
    const stored = await prisma.paymentCheckoutSession.findUniqueOrThrow({
      where: { id: checkout.sessionId }
    });
    expect(stored.cancellationLastError).not.toContain("access token");
  });
});

async function createExpiredCheckout(label: string) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const invoiceId = randomUUID();
  const accountId = randomUUID();
  const sessionId = randomUUID();
  const providerSessionId = `SQUARE-LINK-${label}`;
  await prisma.user.create({
    data: {
      id: userId,
      email: `${label}-${sessionId}@example.test`,
      displayName: `${label} owner`,
      emailVerifiedAt: new Date()
    }
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      legalName: `${label} legal`,
      displayName: `${label} display`,
      memberships: { create: { userId, role: "OWNER" } }
    }
  });
  await prisma.customer.create({
    data: {
      id: customerId,
      organizationId,
      customerNumber: `C-${label}`,
      displayName: `${label} customer`,
      createdByUserId: userId,
      updatedByUserId: userId
    }
  });
  await prisma.invoice.create({
    data: {
      id: invoiceId,
      organizationId,
      customerId,
      provisionalIdentifier: `invoice-${sessionId}`,
      paymentReference: `TEST-${sessionId.slice(0, 8)}`,
      issueDate: new Date("2026-09-01T00:00:00.000Z"),
      dueDate: new Date("2026-10-01T00:00:00.000Z"),
      paymentTermsDays: 30,
      currency: "CAD",
      status: "DRAFT",
      subtotalMinor: 1000n,
      grandTotalMinor: 1000n,
      baseSubtotalMinor: 1000n,
      baseGrandTotalMinor: 1000n,
      customerNameSnapshot: `${label} customer`,
      organizationSnapshot: { legalName: `${label} legal` },
      createdByUserId: userId,
      updatedByUserId: userId
    }
  });
  await prisma.paymentAccount.create({
    data: {
      id: accountId,
      organizationId,
      provider: "SQUARE",
      providerAccountCiphertext: "square-token",
      status: "CONNECTED",
      chargesEnabled: true,
      payoutsEnabled: true,
      createdByUserId: userId,
      updatedByUserId: userId
    }
  });
  await prisma.paymentCheckoutSession.create({
    data: {
      id: sessionId,
      organizationId,
      invoiceId,
      paymentAccountId: accountId,
      providerSessionId,
      providerCheckoutUrl: `https://square.example.test/${sessionId}`,
      idempotencyKeyHash: sessionId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      requestedAmountMinor: 1000n,
      currency: "CAD",
      expiresAt: new Date("2026-09-11T19:59:00.000Z")
    }
  });
  return { organizationId, userId, sessionId, providerSessionId };
}
