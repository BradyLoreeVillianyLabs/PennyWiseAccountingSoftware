import { createHash, randomUUID } from "node:crypto";
import { AppError } from "@clearledger/shared";
import { hashJson } from "../utils/json.js";
import type {
  BankFeedProviderAccount,
  BankFeedProviderAdapter,
  BankFeedProviderExchangeResult,
  BankFeedProviderLinkInput,
  BankFeedProviderLinkResult,
  BankFeedProviderSyncResult,
  BankFeedProviderTransaction
} from "./bank-feed-provider.js";

const LINK_TTL_MS = 10 * 60 * 1000;

const TEST_ACCOUNTS: readonly BankFeedProviderAccount[] = [
  {
    providerAccountReference: "pwtb-cad-chequing",
    displayName: "PennyWise test chequing",
    maskedAccountReference: "0142",
    currency: "CAD",
    accountKind: "BANK"
  },
  {
    providerAccountReference: "pwtb-cad-credit-card",
    displayName: "PennyWise test credit card",
    maskedAccountReference: "0199",
    currency: "CAD",
    accountKind: "CREDIT_CARD"
  },
  {
    providerAccountReference: "pwtb-usd-chequing",
    displayName: "PennyWise test USD chequing",
    maskedAccountReference: "0207",
    currency: "USD",
    accountKind: "BANK"
  }
];

interface TestLink {
  readonly organizationId: string;
  readonly expiresAt: Date;
  readonly existingAccessToken: string | null;
}

interface TestConnection {
  readonly organizationId: string;
  readonly providerItemReference: string;
  readonly activityDate: string;
}

export interface PennyWiseTestBankFeedAdapterOptions {
  readonly now?: () => Date;
}

/**
 * A deliberately local-only provider for exercising the complete connected
 * bank-feed workflow during development and controlled beta testing. It never
 * contacts a financial institution, accepts credentials, or returns real data.
 */
export class PennyWiseTestBankFeedAdapter implements BankFeedProviderAdapter {
  public readonly providerKey = "PENNYWISE_TEST_BANK";
  public readonly environment = "sandbox" as const;
  public readonly testOnly = true;
  public readonly connectionFlow = "LOCAL_TEST" as const;
  private readonly links = new Map<string, TestLink>();
  private readonly connections = new Map<string, TestConnection>();
  private readonly now: () => Date;

  public constructor(options: PennyWiseTestBankFeedAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  public async createLinkToken(
    input: BankFeedProviderLinkInput
  ): Promise<BankFeedProviderLinkResult> {
    await Promise.resolve();
    const existingAccessToken = input.accessToken?.trim() || null;
    if (existingAccessToken) {
      const existing = this.connections.get(existingAccessToken);
      if (!existing || existing.organizationId !== input.organizationId)
        throw new AppError(
          "BANK_FEED_TEST_CONNECTION_INVALID",
          "The PennyWise test-bank connection is no longer available. Start a new test connection.",
          409
        );
    }
    const expiresAt = new Date(this.now().getTime() + LINK_TTL_MS);
    const linkToken = `pwtb-link-${randomUUID()}`;
    this.links.set(linkToken, {
      organizationId: input.organizationId,
      expiresAt,
      existingAccessToken
    });
    return {
      linkToken,
      expiresAt,
      connectionFlow: this.connectionFlow,
      providerAccounts: cloneAccounts()
    };
  }

  public async exchangePublicToken(publicToken: string): Promise<BankFeedProviderExchangeResult> {
    await Promise.resolve();
    const link = this.links.get(publicToken);
    this.links.delete(publicToken);
    if (!link || link.expiresAt.getTime() <= this.now().getTime())
      throw new AppError(
        "BANK_FEED_TEST_LINK_EXPIRED",
        "The PennyWise test-bank selection expired. Start the test connection again.",
        409
      );

    const accessToken = link.existingAccessToken ?? `pwtb-access-${randomUUID()}`;
    let connection = this.connections.get(accessToken);
    if (!connection) {
      connection = {
        organizationId: link.organizationId,
        providerItemReference: `pwtb-item-${randomUUID()}`,
        activityDate: dateOnly(this.now())
      };
      this.connections.set(accessToken, connection);
    }
    return {
      accessToken,
      providerItemReference: connection.providerItemReference,
      institutionReference: "pennywise-test-bank",
      institutionName: "PennyWise test bank"
    };
  }

  public async listAccounts(accessToken: string): Promise<readonly BankFeedProviderAccount[]> {
    await Promise.resolve();
    this.requireConnection(accessToken);
    return cloneAccounts();
  }

  public async sync(input: {
    readonly accessToken: string;
    readonly cursor: string | null;
  }): Promise<BankFeedProviderSyncResult> {
    await Promise.resolve();
    const connection = this.requireConnection(input.accessToken);
    if (input.cursor === null)
      return {
        nextCursor: "pwtb-cursor-1",
        added: testTransactions(connection),
        modified: [],
        removed: [],
        providerRequestReference: `pwtb-sync-${randomUUID()}`
      };
    if (input.cursor === "pwtb-cursor-1")
      return {
        nextCursor: "pwtb-cursor-1",
        added: [],
        modified: [],
        removed: [],
        providerRequestReference: `pwtb-sync-${randomUUID()}`
      };
    throw new AppError(
      "BANK_FEED_TEST_CURSOR_INVALID",
      "The PennyWise test-bank activity cursor is invalid. Disconnect and reconnect the test bank.",
      409
    );
  }

  public async disconnect(accessToken: string): Promise<void> {
    await Promise.resolve();
    this.connections.delete(accessToken);
  }

  private requireConnection(accessToken: string): TestConnection {
    const connection = this.connections.get(accessToken);
    if (!connection)
      throw new AppError(
        "BANK_FEED_TEST_CONNECTION_INVALID",
        "The PennyWise test-bank connection is no longer available. Start a new test connection.",
        409
      );
    return connection;
  }
}

/**
 * Explicit opt-in is intentional. A production process must fail at startup
 * instead of quietly exposing a synthetic financial workflow.
 */
export function pennyWiseTestBankFeedAdapterFromEnvironment(
  environment: NodeJS.ProcessEnv
): PennyWiseTestBankFeedAdapter | undefined {
  if (environment.BANK_FEED_PROVIDER?.trim().toUpperCase() !== "PENNYWISE_TEST_BANK")
    return undefined;
  if (environment.NODE_ENV?.trim().toLowerCase() === "production")
    throw new Error("PENNYWISE_TEST_BANK is available only outside production.");
  if (environment.PENNYWISE_ENABLE_TEST_BANK?.trim().toLowerCase() !== "true")
    throw new Error(
      "PENNYWISE_TEST_BANK requires PENNYWISE_ENABLE_TEST_BANK=true as an explicit local test opt-in."
    );
  return new PennyWiseTestBankFeedAdapter();
}

function cloneAccounts(): BankFeedProviderAccount[] {
  return TEST_ACCOUNTS.map((account) => ({ ...account }));
}

function testTransactions(connection: TestConnection): BankFeedProviderTransaction[] {
  return [
    testTransaction(connection, {
      id: "customer-payment",
      accountReference: "pwtb-cad-chequing",
      description: "PennyWise test activity - customer payment",
      amountMinor: 125_000n,
      direction: "CREDIT",
      currency: "CAD"
    }),
    testTransaction(connection, {
      id: "software-expense",
      accountReference: "pwtb-cad-chequing",
      description: "PennyWise test activity - software expense",
      amountMinor: 2_500n,
      direction: "DEBIT",
      currency: "CAD"
    }),
    testTransaction(connection, {
      id: "card-supply",
      accountReference: "pwtb-cad-credit-card",
      description: "PennyWise test activity - office supplies",
      amountMinor: 4_890n,
      direction: "DEBIT",
      currency: "CAD"
    })
  ];
}

function testTransaction(
  connection: TestConnection,
  input: {
    readonly id: string;
    readonly accountReference: string;
    readonly description: string;
    readonly amountMinor: bigint;
    readonly direction: "DEBIT" | "CREDIT";
    readonly currency: string;
  }
): BankFeedProviderTransaction {
  const providerTransactionId = `pwtb-${input.id}`;
  const raw = {
    provider: "PENNYWISE_TEST_BANK",
    providerItemReference: connection.providerItemReference,
    providerTransactionId,
    providerAccountReference: input.accountReference,
    postingDate: connection.activityDate,
    description: input.description,
    amountMinor: input.amountMinor.toString(),
    direction: input.direction,
    currency: input.currency
  };
  return {
    providerTransactionId,
    providerAccountReference: input.accountReference,
    postingDate: connection.activityDate,
    transactionDate: connection.activityDate,
    description: input.description,
    payee: null,
    memo: "Simulated PennyWise test-bank activity. No financial institution is connected.",
    amountMinor: input.amountMinor,
    direction: input.direction,
    currency: input.currency,
    balanceMinor: null,
    rawFingerprint: createHash("sha256")
      .update(
        `${connection.providerItemReference}:${input.accountReference}:${providerTransactionId}`
      )
      .digest("hex"),
    payloadHash: hashJson(raw)
  };
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
