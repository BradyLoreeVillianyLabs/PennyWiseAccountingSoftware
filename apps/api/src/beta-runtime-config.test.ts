import { describe, expect, it } from "vitest";
import {
  assertBetaRuntimeSecrets,
  isClearLedgerBetaRuntime,
  requiresRuntimeDatabaseRoleVerification,
  runtimeCapabilities
} from "./beta-runtime-config.js";

const validSecrets = {
  CLEARLEDGER_BETA_RUNTIME: "true",
  WEBHOOK_SECRET_ENCRYPTION_SECRET: "w".repeat(32),
  CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET: "c".repeat(32),
  PAYMENT_WEBHOOK_SECRET: "p".repeat(32),
  PAYMENT_ACCOUNT_ENCRYPTION_SECRET: "a".repeat(32)
};

describe("assertBetaRuntimeSecrets", () => {
  it("does not change ordinary development startup", () => {
    expect(() => assertBetaRuntimeSecrets({})).not.toThrow();
  });

  it("accepts an explicitly protected beta runtime", () => {
    expect(() => assertBetaRuntimeSecrets(validSecrets)).not.toThrow();
  });

  it.each([
    "WEBHOOK_SECRET_ENCRYPTION_SECRET",
    "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
    "PAYMENT_WEBHOOK_SECRET",
    "PAYMENT_ACCOUNT_ENCRYPTION_SECRET"
  ] as const)("rejects a missing or short %s", (name) => {
    expect(() => assertBetaRuntimeSecrets({ ...validSecrets, [name]: "too-short" })).toThrow(name);
  });
});

describe("runtimeCapabilities", () => {
  it("fails hosted payment and email delivery capabilities closed in the beta", () => {
    expect(isClearLedgerBetaRuntime(validSecrets)).toBe(true);
    expect(
      runtimeCapabilities(validSecrets, { emailProvider: true, paymentProvider: true })
    ).toEqual({ betaRuntime: true, emailDelivery: false, hostedPayments: false });
  });

  it("reports only explicitly configured provider capabilities outside the beta", () => {
    expect(runtimeCapabilities({}, { emailProvider: true, paymentProvider: false })).toEqual({
      betaRuntime: false,
      emailDelivery: true,
      hostedPayments: false
    });
  });

  it("allows beta email only after the explicit protected-mailbox approval", () => {
    expect(
      runtimeCapabilities(validSecrets, {
        emailProvider: true,
        betaEmailDeliveryApproved: true,
        paymentProvider: true
      })
    ).toEqual({ betaRuntime: true, emailDelivery: true, hostedPayments: false });
  });
});

describe("requiresRuntimeDatabaseRoleVerification", () => {
  it("requires the constrained database login in production and the packaged beta", () => {
    expect(requiresRuntimeDatabaseRoleVerification({ NODE_ENV: "production" })).toBe(true);
    expect(requiresRuntimeDatabaseRoleVerification({ CLEARLEDGER_BETA_RUNTIME: "true" })).toBe(
      true
    );
  });

  it("leaves ordinary local development unchanged", () => {
    expect(requiresRuntimeDatabaseRoleVerification({ NODE_ENV: "development" })).toBe(false);
  });
});
