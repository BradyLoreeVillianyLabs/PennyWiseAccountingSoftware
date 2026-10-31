const BETA_RUNTIME_SECRET_NAMES = [
  "WEBHOOK_SECRET_ENCRYPTION_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_ACCOUNT_ENCRYPTION_SECRET"
] as const;

const MINIMUM_BETA_RUNTIME_SECRET_LENGTH = 32;

export function isClearLedgerBetaRuntime(environment: NodeJS.ProcessEnv): boolean {
  return environment.CLEARLEDGER_BETA_RUNTIME === "true";
}

export function requiresRuntimeDatabaseRoleVerification(environment: NodeJS.ProcessEnv): boolean {
  return environment.NODE_ENV === "production" || isClearLedgerBetaRuntime(environment);
}

export interface RuntimeCapabilities {
  readonly betaRuntime: boolean;
  readonly emailDelivery: boolean;
  readonly hostedPayments: boolean;
}

export function runtimeCapabilities(
  environment: NodeJS.ProcessEnv,
  configured: {
    readonly emailProvider: boolean;
    /** The beta must opt in separately after a real OAuth mailbox path is configured. */
    readonly betaEmailDeliveryApproved?: boolean;
    readonly paymentProvider: boolean;
  }
): RuntimeCapabilities {
  const betaRuntime = isClearLedgerBetaRuntime(environment);
  return {
    betaRuntime,
    emailDelivery:
      configured.emailProvider && (!betaRuntime || configured.betaEmailDeliveryApproved === true),
    hostedPayments: !betaRuntime && configured.paymentProvider
  };
}

export function assertBetaRuntimeSecrets(environment: NodeJS.ProcessEnv): void {
  if (!isClearLedgerBetaRuntime(environment)) return;

  const invalidNames = BETA_RUNTIME_SECRET_NAMES.filter(
    (name) => (environment[name]?.trim().length ?? 0) < MINIMUM_BETA_RUNTIME_SECRET_LENGTH
  );

  if (invalidNames.length > 0) {
    throw new Error(
      `PennyWise Accounting beta runtime requires independent secrets of at least ${MINIMUM_BETA_RUNTIME_SECRET_LENGTH.toString()} characters: ${invalidNames.join(", ")}.`
    );
  }
}
