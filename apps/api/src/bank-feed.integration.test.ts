import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { AppError } from "@clearledger/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type {
  BankFeedProviderAccount,
  BankFeedProviderAdapter,
  BankFeedProviderExchangeResult,
  BankFeedProviderLinkInput,
  BankFeedProviderSyncResult,
  BankFeedProviderTransaction
} from "./services/bank-feed-provider.js";
import { AesPaymentAccountProtector } from "./services/payment-provider.js";
import { hashJson } from "./utils/json.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const adapter = createFixtureBankFeedAdapter();
const app = buildApp({
  prisma,
  bankFeedAdapter: adapter,
  bankFeedCredentialProtector: new AesPaymentAccountProtector(
    "bank-feed-integration-encryption-secret-2026"
  )
});
const owner = "bank-feed-owner@example.test";

describe("connected bank feed workflow", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    adapter.reset();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("uses hosted consent and imports a replay-safe review queue without posting books", async () => {
    const fixture = await createBankFixture();
    const headers = organizationHeaders(fixture.organizationId);

    const status = await app.inject({ method: "GET", url: "/v1/bank-feeds/status", headers });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ bankFeeds: unknown }>().bankFeeds).toMatchObject({
      configured: true,
      providerKey: "PLAID",
      environment: "sandbox",
      connectEnabled: true,
      automaticPosting: false,
      manualFallback: ["CSV", "OFX", "QFX"]
    });

    const link = await app.inject({
      method: "POST",
      url: "/v1/bank-feeds/link-token",
      headers,
      payload: {}
    });
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json<{ bankFeedLink: { linkToken: string } }>().bankFeedLink.linkToken).toBe(
      "link-sandbox-token"
    );
    expect(adapter.linkCalls[0]).toMatchObject({ organizationId: fixture.organizationId });

    const connected = await app.inject({
      method: "POST",
      url: "/v1/bank-feeds/connect",
      headers,
      payload: {
        publicToken: "public-sandbox-token",
        mappings: [
          {
            bankAccountId: fixture.bankAccountId,
            providerAccountReference: adapter.account.providerAccountReference
          }
        ]
      }
    });
    expect(connected.statusCode, connected.body).toBe(201);
    const feed = connected.json<{ bankFeed: { id: string; mappings: unknown[] } }>().bankFeed;
    expect(feed.mappings).toHaveLength(1);
    expect(connected.body).not.toContain(adapter.accessToken);

    adapter.syncResult = {
      nextCursor: "cursor-1",
      added: [providerTransaction("Coffee shop")],
      modified: [],
      removed: []
    };
    const journalCountBeforeSync = await prisma.journal.count({
      where: { organizationId: fixture.organizationId }
    });
    const synced = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    expect(synced.statusCode, synced.body).toBe(200);
    expect(
      synced.json<{ bankFeedSync: { sync: { addedCount: number; modifiedCount: number } } }>()
        .bankFeedSync.sync
    ).toMatchObject({ addedCount: 1, modifiedCount: 0 });

    const imported = await app.inject({
      method: "GET",
      url: "/v1/bank-transactions?limit=10",
      headers
    });
    expect(imported.statusCode).toBe(200);
    const transaction = imported.json<{
      transactions: { items: Array<{ id: string; status: string; description: string }> };
    }>().transactions.items[0]!;
    expect(transaction).toMatchObject({ status: "UNMATCHED", description: "Coffee shop" });
    expect(await prisma.journal.count({ where: { organizationId: fixture.organizationId } })).toBe(
      journalCountBeforeSync
    );
    expect(
      await prisma.bankImportBatch.count({
        where: { organizationId: fixture.organizationId, format: "FEED", status: "COMMITTED" }
      })
    ).toBe(1);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(
      replay.json<{ bankFeedSync: { sync: { addedCount: number; modifiedCount: number } } }>()
        .bankFeedSync.sync
    ).toMatchObject({ addedCount: 0, modifiedCount: 0 });
    const afterReplay = await app.inject({
      method: "GET",
      url: "/v1/bank-transactions?limit=10",
      headers
    });
    expect(
      afterReplay.json<{ transactions: { items: unknown[] } }>().transactions.items
    ).toHaveLength(1);

    const otherOrganizationId = await createOrganization("bank-feed-other@example.test");
    const crossTenant = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers: organizationHeaders(otherOrganizationId, "bank-feed-other@example.test")
    });
    expect(crossTenant.statusCode).toBe(404);
  });

  it("keeps automatic feed rules review-only by default", async () => {
    const fixture = await createBankFixture();
    const headers = organizationHeaders(fixture.organizationId);
    const feed = await connect(fixture.bankAccountId, headers);
    adapter.syncResult = {
      nextCursor: "cursor-automatic-default",
      added: [providerTransaction("Coffee shop")],
      modified: [],
      removed: []
    };

    const synced = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    expect(synced.statusCode, synced.body).toBe(200);
    expect(
      synced.json<{
        bankFeedSync: {
          ruleProcessing: {
            enabled: boolean;
            automaticCategorizedCount: number;
            reviewRequiredCount: number;
          };
        };
      }>().bankFeedSync.ruleProcessing
    ).toEqual({ enabled: false, automaticCategorizedCount: 0, reviewRequiredCount: 1 });

    const imported = await app.inject({
      method: "GET",
      url: "/v1/bank-transactions?limit=10",
      headers
    });
    const transaction = imported.json<{
      transactions: { items: Array<{ status: string; description: string }> };
    }>().transactions.items[0]!;
    expect(transaction).toMatchObject({ status: "UNMATCHED", description: "Coffee shop" });
    expect(await prisma.journal.count({ where: { organizationId: fixture.organizationId } })).toBe(
      0
    );
  });

  it("automatically categorizes one exact scoped feed rule when review is disabled", async () => {
    const fixture = await createBankFixture();
    const headers = organizationHeaders(fixture.organizationId);
    await setBankFeedReviewRequired(fixture.organizationId, false);
    await createBankRule(fixture.organizationId, fixture.bankAccountId, fixture.expenseAccountId, {
      priority: 1,
      descriptionContains: "Coffee shop",
      direction: "DEBIT"
    });
    const feed = await connect(fixture.bankAccountId, headers);
    adapter.syncResult = {
      nextCursor: "cursor-automatic-exact",
      added: [providerTransaction("Coffee shop")],
      modified: [],
      removed: []
    };

    const synced = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    expect(synced.statusCode, synced.body).toBe(200);
    expect(
      synced.json<{
        bankFeedSync: {
          ruleProcessing: {
            enabled: boolean;
            automaticCategorizedCount: number;
            reviewRequiredCount: number;
          };
        };
      }>().bankFeedSync.ruleProcessing
    ).toEqual({ enabled: true, automaticCategorizedCount: 1, reviewRequiredCount: 0 });

    const imported = await app.inject({
      method: "GET",
      url: "/v1/bank-transactions?limit=10",
      headers
    });
    expect(
      imported.json<{ transactions: { items: Array<{ status: string }> } }>().transactions.items[0]
        ?.status
    ).toBe("CATEGORIZED");
    const journal = await prisma.journal.findFirst({
      where: { organizationId: fixture.organizationId },
      include: { lines: true }
    });
    expect(journal).toMatchObject({ baseCurrency: "CAD", status: "POSTED" });
    expect(journal?.lines).toHaveLength(2);
    expect(
      journal?.lines.reduce((balance, line) => balance + line.debitMinor - line.creditMinor, 0n)
    ).toBe(0n);
  });

  it("leaves ambiguous, broad, and invalid rule suggestions in review", async () => {
    const fixture = await createBankFixture();
    const headers = organizationHeaders(fixture.organizationId);
    await setBankFeedReviewRequired(fixture.organizationId, false);
    await createBankRule(fixture.organizationId, fixture.bankAccountId, fixture.expenseAccountId, {
      priority: 1,
      descriptionContains: "Coffee shop",
      direction: "DEBIT"
    });
    await createBankRule(fixture.organizationId, fixture.bankAccountId, fixture.expenseAccountId, {
      priority: 2,
      descriptionContains: "Coffee shop",
      direction: "DEBIT"
    });
    const broadFixture = await createBankFixture();
    const broadHeaders = organizationHeaders(broadFixture.organizationId);
    await setBankFeedReviewRequired(broadFixture.organizationId, false);
    await createBankRule(
      broadFixture.organizationId,
      broadFixture.bankAccountId,
      broadFixture.expenseAccountId,
      { priority: 1, descriptionContains: "Coffee", direction: "DEBIT" }
    );
    const invalidFixture = await createBankFixture();
    const invalidHeaders = organizationHeaders(invalidFixture.organizationId);
    await setBankFeedReviewRequired(invalidFixture.organizationId, false);
    await createBankRule(
      invalidFixture.organizationId,
      invalidFixture.bankAccountId,
      "00000000-0000-4000-8000-000000000000",
      { priority: 1, descriptionContains: "Coffee shop", direction: "DEBIT" }
    );

    const cases = [
      { fixture, headers, cursor: "cursor-ambiguous" },
      { fixture: broadFixture, headers: broadHeaders, cursor: "cursor-broad" },
      { fixture: invalidFixture, headers: invalidHeaders, cursor: "cursor-invalid" }
    ];
    for (const current of cases) {
      const feed = await connect(current.fixture.bankAccountId, current.headers);
      adapter.syncResult = {
        nextCursor: current.cursor,
        added: [providerTransaction("Coffee shop")],
        modified: [],
        removed: []
      };
      const synced = await app.inject({
        method: "POST",
        url: `/v1/bank-feeds/${feed.id}/sync`,
        headers: current.headers
      });
      expect(synced.statusCode, synced.body).toBe(200);
      expect(
        synced.json<{
          bankFeedSync: {
            ruleProcessing: { automaticCategorizedCount: number; reviewRequiredCount: number };
          };
        }>().bankFeedSync.ruleProcessing
      ).toMatchObject({ automaticCategorizedCount: 0, reviewRequiredCount: 1 });
      const imported = await app.inject({
        method: "GET",
        url: "/v1/bank-transactions?limit=10",
        headers: current.headers
      });
      expect(
        imported.json<{ transactions: { items: Array<{ status: string }> } }>().transactions
          .items[0]?.status
      ).toBe("UNMATCHED");
    }
  });

  it("preserves reviewed activity when a provider later changes it and records consent expiry safely", async () => {
    const fixture = await createBankFixture();
    const headers = organizationHeaders(fixture.organizationId);
    const feed = await connect(fixture.bankAccountId, headers);
    adapter.syncResult = {
      nextCursor: "cursor-1",
      added: [providerTransaction("Original supplier")],
      modified: [],
      removed: []
    };
    expect(
      (await app.inject({ method: "POST", url: `/v1/bank-feeds/${feed.id}/sync`, headers }))
        .statusCode
    ).toBe(200);

    const imported = await app.inject({
      method: "GET",
      url: "/v1/bank-transactions?limit=10",
      headers
    });
    const transaction = imported.json<{
      transactions: { items: Array<{ id: string; version: number; amountMinor: string }> };
    }>().transactions.items[0]!;
    const categorized = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${transaction.id}/categorize`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        version: transaction.version,
        lines: [{ accountId: fixture.expenseAccountId, amountMinor: transaction.amountMinor }]
      }
    });
    expect(categorized.statusCode, categorized.body).toBe(201);
    const journalCount = await prisma.journal.count({
      where: { organizationId: fixture.organizationId }
    });

    adapter.syncResult = {
      nextCursor: "cursor-2",
      added: [],
      modified: [providerTransaction("Changed provider description")],
      removed: []
    };
    const changed = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ error: { code: string } }>().error.code).toBe(
      "BANK_FEED_TRANSACTION_CHANGE_REVIEW_REQUIRED"
    );
    expect(await prisma.journal.count({ where: { organizationId: fixture.organizationId } })).toBe(
      journalCount
    );
    const unchanged = await app.inject({
      method: "GET",
      url: "/v1/bank-transactions?limit=10",
      headers
    });
    expect(
      unchanged.json<{ transactions: { items: Array<{ description: string }> } }>().transactions
        .items[0]?.description
    ).toBe("Original supplier");

    adapter.syncError = new AppError("BANK_FEED_CONSENT_EXPIRED", "test only consent expiry", 409);
    const expired = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    expect(expired.statusCode).toBe(409);
    const feeds = await app.inject({ method: "GET", url: "/v1/bank-feeds", headers });
    expect(
      feeds.json<{ bankFeeds: Array<{ status: string; lastError: string }> }>().bankFeeds[0]
    ).toMatchObject({
      status: "CONSENT_EXPIRED",
      lastError: "Bank consent needs to be refreshed before activity can be synchronized."
    });
  });

  it("allows only one in-flight feed refresh for a bank connection", async () => {
    const fixture = await createBankFixture();
    const headers = organizationHeaders(fixture.organizationId);
    const feed = await connect(fixture.bankAccountId, headers);
    const syncStarted = adapter.deferSync();
    const first = app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    await syncStarted;

    const overlapping = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    expect(overlapping.statusCode, overlapping.body).toBe(409);
    expect(overlapping.json<{ error: { code: string } }>().error.code).toBe(
      "BANK_FEED_SYNC_IN_PROGRESS"
    );

    adapter.releaseDeferredSync();
    expect((await first).statusCode).toBe(200);
  });

  it("does not restore a disconnected bank when an in-flight provider refresh fails", async () => {
    const fixture = await createBankFixture();
    const headers = organizationHeaders(fixture.organizationId);
    const feed = await connect(fixture.bankAccountId, headers);
    adapter.syncError = new AppError("BANK_FEED_PROVIDER_UNAVAILABLE", "fixture failure", 503);
    const syncStarted = adapter.deferSync();
    const refreshing = app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/sync`,
      headers
    });
    await syncStarted;

    const disconnected = await app.inject({
      method: "POST",
      url: `/v1/bank-feeds/${feed.id}/disconnect`,
      headers
    });
    expect(disconnected.statusCode, disconnected.body).toBe(200);
    adapter.releaseDeferredSync();
    expect((await refreshing).statusCode).toBe(503);

    const feeds = await app.inject({ method: "GET", url: "/v1/bank-feeds", headers });
    expect(feeds.json<{ bankFeeds: Array<{ status: string }> }>().bankFeeds[0]?.status).toBe(
      "DISCONNECTED"
    );
  });
});

async function createBankFixture() {
  const organizationId = await createOrganization();
  await configureOrganization(organizationId);
  const expenseAccountId = await createLedgerAccount(organizationId, "6400", "EXPENSE");
  const bankLedgerAccountId = await createLedgerAccount(organizationId, "1020", "ASSET");
  const created = await app.inject({
    method: "POST",
    url: "/v1/bank-accounts",
    headers: organizationHeaders(organizationId),
    payload: {
      displayName: "Connected chequing",
      accountKind: "BANK",
      maskedAccountReference: "****1234",
      financialInstitutionName: "Fixture Financial",
      currency: "CAD",
      linkedLedgerAccountId: bankLedgerAccountId,
      openingDate: "2026-01-01"
    }
  });
  expect(created.statusCode, created.body).toBe(201);
  return {
    organizationId,
    expenseAccountId,
    bankAccountId: created.json<{ bankAccount: { id: string } }>().bankAccount.id
  };
}

async function connect(bankAccountId: string, headers: Record<string, string>) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/bank-feeds/connect",
    headers,
    payload: {
      publicToken: "public-sandbox-token",
      mappings: [
        { bankAccountId, providerAccountReference: adapter.account.providerAccountReference }
      ]
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ bankFeed: { id: string } }>().bankFeed;
}

async function setBankFeedReviewRequired(organizationId: string, required: boolean) {
  const headers = organizationHeaders(organizationId);
  const current = await app.inject({
    method: "GET",
    url: "/v1/settings/workflow-preferences",
    headers
  });
  expect(current.statusCode, current.body).toBe(200);
  const preferences = current.json<{
    workflowPreferences: {
      version: number;
      profileKey: string;
      bankFeedReviewRequired: boolean;
      cashPlanningEnabled: boolean;
      purchaseRequestsEnabled: boolean;
      purchaseApprovalThresholdMinor: string;
      requireSeparatePurchaseApprover: boolean;
      customerDepositsEnabled: boolean;
      progressBillingEnabled: boolean;
      fixedAssetRegisterEnabled: boolean;
      payrollSummaryImportEnabled: boolean;
    };
  }>().workflowPreferences;
  const updated = await app.inject({
    method: "PUT",
    url: "/v1/settings/workflow-preferences",
    headers,
    payload: {
      version: preferences.version,
      profileKey: preferences.profileKey,
      bankFeedReviewRequired: required,
      cashPlanningEnabled: preferences.cashPlanningEnabled,
      purchaseRequestsEnabled: preferences.purchaseRequestsEnabled,
      purchaseApprovalThresholdMinor: preferences.purchaseApprovalThresholdMinor,
      requireSeparatePurchaseApprover: preferences.requireSeparatePurchaseApprover,
      customerDepositsEnabled: preferences.customerDepositsEnabled,
      progressBillingEnabled: preferences.progressBillingEnabled,
      fixedAssetRegisterEnabled: preferences.fixedAssetRegisterEnabled,
      payrollSummaryImportEnabled: preferences.payrollSummaryImportEnabled
    }
  });
  expect(updated.statusCode, updated.body).toBe(200);
}

async function createBankRule(
  organizationId: string,
  bankAccountId: string,
  suggestionAccountId: string,
  input: { priority: number; descriptionContains: string; direction: "DEBIT" | "CREDIT" }
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/bank-rules",
    headers: organizationHeaders(organizationId),
    payload: {
      bankAccountId,
      name: `Fixture rule ${String(input.priority)}`,
      priority: input.priority,
      descriptionContains: input.descriptionContains,
      direction: input.direction,
      suggestion: { accountId: suggestionAccountId }
    }
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function createOrganization(email = owner): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: organizationHeaders(undefined, email),
    payload: { legalName: "Feed Test Ltd", displayName: "Feed Test" }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configureOrganization(organizationId: string) {
  const headers = organizationHeaders(organizationId);
  const state = await app.inject({ method: "GET", url: "/v1/setup", headers });
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/setup/profile",
        headers,
        payload: {
          version,
          legalName: "Feed Test Ltd",
          displayName: "Feed Test",
          locale: "en-CA",
          timeZone: "America/Edmonton",
          baseCurrency: "CAD",
          fiscalYearEndMonth: 12,
          fiscalYearEndDay: 31,
          accountingStartDate: "2026-01-01"
        }
      })
    ).statusCode
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/presets/general-service/apply",
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {}
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/fiscal-year/initialize",
        headers,
        payload: {}
      })
    ).statusCode
  ).toBe(200);
}

async function createLedgerAccount(
  organizationId: string,
  code: string,
  type: "ASSET" | "EXPENSE"
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    headers: organizationHeaders(organizationId),
    payload: { code, name: code, type, isControl: false }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

function organizationHeaders(organizationId?: string, email = owner): Record<string, string> {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

function providerTransaction(description: string): BankFeedProviderTransaction {
  const raw = {
    transaction_id: "plaid-transaction-1",
    account_id: adapter.account.providerAccountReference,
    date: "2026-08-01",
    name: description,
    amount: 12.34,
    iso_currency_code: "CAD"
  };
  return {
    providerTransactionId: raw.transaction_id,
    providerAccountReference: raw.account_id,
    postingDate: raw.date,
    transactionDate: null,
    description,
    payee: null,
    memo: null,
    amountMinor: 1234n,
    direction: "DEBIT",
    currency: "CAD",
    balanceMinor: null,
    rawFingerprint: createHash("sha256")
      .update(`plaid:${raw.account_id}:${raw.transaction_id}`)
      .digest("hex"),
    payloadHash: hashJson(raw)
  };
}

function createFixtureBankFeedAdapter() {
  const adapter: BankFeedProviderAdapter & {
    readonly accessToken: string;
    readonly account: BankFeedProviderAccount;
    syncResult: BankFeedProviderSyncResult;
    syncError: Error | null;
    linkCalls: BankFeedProviderLinkInput[];
    syncGate: { promise: Promise<void>; resolve: () => void } | null;
    syncStarted: { promise: Promise<void>; resolve: () => void } | null;
    deferSync(): Promise<void>;
    releaseDeferredSync(): void;
    reset(): void;
  } = {
    providerKey: "PLAID",
    environment: "sandbox",
    accessToken: "access-sandbox-token-private",
    account: {
      providerAccountReference: "plaid-account-1",
      displayName: "Fixture chequing",
      maskedAccountReference: "6789",
      currency: "CAD",
      accountKind: "BANK"
    },
    syncResult: { nextCursor: "cursor-0", added: [], modified: [], removed: [] },
    syncError: null,
    linkCalls: [],
    syncGate: null as { promise: Promise<void>; resolve: () => void } | null,
    syncStarted: null as { promise: Promise<void>; resolve: () => void } | null,
    reset() {
      this.syncResult = { nextCursor: "cursor-0", added: [], modified: [], removed: [] };
      this.syncError = null;
      this.linkCalls = [];
      this.syncGate = null;
      this.syncStarted = null;
    },
    deferSync() {
      let releaseGate: () => void = () => undefined;
      let signalStarted: () => void = () => undefined;
      this.syncGate = {
        promise: new Promise<void>((resolve) => {
          releaseGate = resolve;
        }),
        resolve: releaseGate
      };
      this.syncStarted = {
        promise: new Promise<void>((resolve) => {
          signalStarted = resolve;
        }),
        resolve: signalStarted
      };
      return this.syncStarted.promise;
    },
    releaseDeferredSync() {
      this.syncGate?.resolve();
    },
    createLinkToken(input) {
      this.linkCalls.push(input);
      return Promise.resolve({
        linkToken: "link-sandbox-token",
        expiresAt: new Date("2026-12-31T00:00:00Z")
      });
    },
    exchangePublicToken(): Promise<BankFeedProviderExchangeResult> {
      return Promise.resolve({
        accessToken: this.accessToken,
        providerItemReference: "plaid-item-1",
        institutionReference: "ins_1",
        institutionName: "Fixture Financial"
      });
    },
    listAccounts(): Promise<readonly BankFeedProviderAccount[]> {
      return Promise.resolve([this.account]);
    },
    sync(): Promise<BankFeedProviderSyncResult> {
      this.syncStarted?.resolve();
      const result = () => {
        if (this.syncError) return Promise.reject(this.syncError);
        return Promise.resolve(this.syncResult);
      };
      return this.syncGate ? this.syncGate.promise.then(result) : result();
    },
    disconnect(): Promise<void> {
      return Promise.resolve();
    }
  };
  return adapter;
}
