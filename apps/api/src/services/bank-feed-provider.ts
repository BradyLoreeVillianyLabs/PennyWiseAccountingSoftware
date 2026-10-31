/**
 * Provider-neutral connected-bank contract. Every provider implementation must
 * use hosted consent; PennyWise never accepts an online-banking credential.
 */
export interface BankFeedProviderAccount {
  readonly providerAccountReference: string;
  readonly displayName: string;
  readonly maskedAccountReference: string | null;
  readonly currency: string;
  readonly accountKind: "BANK" | "CREDIT_CARD";
}

export interface BankFeedProviderTransaction {
  readonly providerTransactionId: string;
  readonly providerAccountReference: string;
  readonly postingDate: string;
  readonly transactionDate: string | null;
  readonly description: string;
  readonly payee: string | null;
  readonly memo: string | null;
  readonly amountMinor: bigint;
  readonly direction: "DEBIT" | "CREDIT";
  readonly currency: string;
  readonly balanceMinor: bigint | null;
  /** Immutable provider-identity fingerprint, not a hash of mutable details. */
  readonly rawFingerprint: string;
  /** Hash of the latest provider payload used to detect semantic changes. */
  readonly payloadHash: string;
}

export interface BankFeedProviderRemoval {
  readonly providerTransactionId: string;
  readonly providerAccountReference: string;
}

export interface BankFeedProviderSyncResult {
  readonly nextCursor: string;
  readonly added: readonly BankFeedProviderTransaction[];
  readonly modified: readonly BankFeedProviderTransaction[];
  readonly removed: readonly BankFeedProviderRemoval[];
  readonly providerRequestReference?: string | undefined;
}

export interface BankFeedProviderLinkInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly accessToken?: string | undefined;
}

/**
 * A hosted provider normally opens its own consent window. The local test
 * provider is deliberately different: it returns only simulated accounts and
 * never asks for a financial-institution credential.
 */
export type BankFeedProviderConnectionFlow = "HOSTED_CONSENT" | "LOCAL_TEST";

export interface BankFeedProviderLinkResult {
  readonly linkToken: string;
  readonly expiresAt: Date;
  readonly connectionFlow?: BankFeedProviderConnectionFlow | undefined;
  /**
   * Some hosted-consent providers publish a complete widget URL rather than a
   * JavaScript SDK token. This is deliberately optional so a provider secret
   * is never sent to the browser; the URL contains only the short-lived token
   * returned by createLinkToken.
   */
  readonly hostedUrl?: string | undefined;
  /** Present only for a local test provider; never real financial accounts. */
  readonly providerAccounts?: readonly BankFeedProviderAccount[] | undefined;
}

export interface BankFeedProviderExchangeResult {
  readonly accessToken: string;
  readonly providerItemReference: string;
  readonly institutionReference?: string | null | undefined;
  readonly institutionName?: string | null | undefined;
}

export interface BankFeedProviderAdapter {
  readonly providerKey: string;
  readonly environment: "sandbox" | "development" | "production";
  /** Local test adapters must never be enabled by a production runtime. */
  readonly testOnly?: boolean | undefined;
  readonly connectionFlow?: BankFeedProviderConnectionFlow | undefined;
  createLinkToken(input: BankFeedProviderLinkInput): Promise<BankFeedProviderLinkResult>;
  exchangePublicToken(publicToken: string): Promise<BankFeedProviderExchangeResult>;
  listAccounts(accessToken: string): Promise<readonly BankFeedProviderAccount[]>;
  sync(input: {
    readonly accessToken: string;
    readonly cursor: string | null;
  }): Promise<BankFeedProviderSyncResult>;
  disconnect(accessToken: string): Promise<void>;
}
