import { PrismaClient, verifyRuntimeDatabaseRole } from "@clearledger/db";
import { buildApp } from "./app.js";
import { AesPaymentAccountProtector } from "./services/payment-provider.js";
import { stripePaymentProviderFromEnvironment } from "./services/stripe-payment-provider.js";
import { paypalPaymentProviderFromEnvironment } from "./services/paypal-payment-provider.js";
import {
  assertBetaRuntimeSecrets,
  isClearLedgerBetaRuntime,
  requiresRuntimeDatabaseRoleVerification
} from "./beta-runtime-config.js";
import { DevelopmentRequestRateLimiter } from "./services/request-rate-limiter.js";

assertBetaRuntimeSecrets(process.env);
const prisma = new PrismaClient();

// `.env.example` documents optional integrations as blank assignments
// (STRIPE_MODE=test with empty keys, empty PLAID_*, empty encryption secrets).
// Treating a present-but-empty variable as "configured" meant a fresh checkout
// could not start the API at all: it tripped the Stripe gate, then the 24-char
// encryption-secret check, then the Plaid gate. A blank value means absent.
// A *partial* configuration is still rejected, exactly as before.
const configured = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};
const configuredOrDefault = (value: string | undefined, fallback: string): string =>
  configured(value) ?? fallback;

if (
  process.env.NODE_ENV === "production" &&
  !configured(process.env.WEBHOOK_SECRET_ENCRYPTION_SECRET)
) {
  throw new Error("WEBHOOK_SECRET_ENCRYPTION_SECRET is required in production.");
}
const stripeConfigured = [
  configured(process.env.STRIPE_MODE),
  configured(process.env.STRIPE_SECRET_KEY),
  configured(process.env.STRIPE_WEBHOOK_SECRET)
].some(Boolean);
const paypalConfigured = [
  configured(process.env.PAYPAL_MODE),
  configured(process.env.PAYPAL_CLIENT_ID),
  configured(process.env.PAYPAL_CLIENT_SECRET),
  configured(process.env.PAYPAL_PARTNER_MERCHANT_ID),
  configured(process.env.PAYPAL_PARTNER_ATTRIBUTION_ID),
  configured(process.env.PAYPAL_WEBHOOK_ID)
].some(Boolean);
const requestedPaymentProvider = (
  configured(process.env.PAYMENT_PROVIDER) ?? "STRIPE"
).toUpperCase();
if (!["STRIPE", "PAYPAL"].includes(requestedPaymentProvider))
  throw new Error("PAYMENT_PROVIDER must be STRIPE or PAYPAL.");
if (
  stripeConfigured &&
  (!configured(process.env.STRIPE_MODE) ||
    !configured(process.env.STRIPE_SECRET_KEY) ||
    !configured(process.env.STRIPE_WEBHOOK_SECRET) ||
    !configured(process.env.PAYMENT_ACCOUNT_ENCRYPTION_SECRET))
) {
  throw new Error(
    "Stripe configuration requires STRIPE_MODE, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and PAYMENT_ACCOUNT_ENCRYPTION_SECRET."
  );
}
if (
  paypalConfigured &&
  (!configured(process.env.PAYPAL_MODE) ||
    !configured(process.env.PAYPAL_CLIENT_ID) ||
    !configured(process.env.PAYPAL_CLIENT_SECRET) ||
    !configured(process.env.PAYPAL_PARTNER_MERCHANT_ID) ||
    !configured(process.env.PAYPAL_PARTNER_ATTRIBUTION_ID) ||
    !configured(process.env.PAYPAL_WEBHOOK_ID) ||
    !configured(process.env.PAYMENT_ACCOUNT_ENCRYPTION_SECRET))
) {
  throw new Error(
    "PayPal configuration requires PAYPAL_MODE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PARTNER_MERCHANT_ID, PAYPAL_PARTNER_ATTRIBUTION_ID, PAYPAL_WEBHOOK_ID, and PAYMENT_ACCOUNT_ENCRYPTION_SECRET."
  );
}
if (requestedPaymentProvider === "PAYPAL" && !paypalConfigured)
  throw new Error("PAYMENT_PROVIDER=PAYPAL requires the complete PayPal configuration.");
const hostedProviderConfigured =
  requestedPaymentProvider === "PAYPAL" ? paypalConfigured : stripeConfigured;
const app = buildApp({
  prisma,
  ...(isClearLedgerBetaRuntime(process.env)
    ? { requestRateLimiter: new DevelopmentRequestRateLimiter() }
    : {}),
  // `??` only falls back on null/undefined, so the empty string shipped in
  // `.env.example` passed straight through and failed the protector's length check.
  webhookSecretProtector: new AesPaymentAccountProtector(
    configuredOrDefault(
      process.env.WEBHOOK_SECRET_ENCRYPTION_SECRET,
      "development-webhook-secret-encryption-key"
    )
  ),
  ...(hostedProviderConfigured
    ? {
        paymentProvider:
          requestedPaymentProvider === "PAYPAL"
            ? paypalPaymentProviderFromEnvironment()
            : stripePaymentProviderFromEnvironment(),
        paymentProviderKind: requestedPaymentProvider as "STRIPE" | "PAYPAL",
        paymentAccountProtector: new AesPaymentAccountProtector(
          process.env.PAYMENT_ACCOUNT_ENCRYPTION_SECRET!
        )
      }
    : {})
});
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "0.0.0.0";

try {
  if (requiresRuntimeDatabaseRoleVerification(process.env)) {
    await verifyRuntimeDatabaseRole(prisma);
  }
  await app.listen({ port, host });
  app.log.info(`PennyWise Accounting API listening on ${host}:${port.toString()}`);
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}

const shutdown = async () => {
  await (
    app as typeof app & { automationRunner: { stop(): Promise<void> } }
  ).automationRunner.stop();
  await app.close();
  await prisma.$disconnect();
};

void (
  app as typeof app & { automationRunner: { start(): Promise<void> } }
).automationRunner.start();

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
