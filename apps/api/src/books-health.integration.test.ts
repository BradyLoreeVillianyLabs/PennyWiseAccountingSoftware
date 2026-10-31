import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { ConnectorAdapter } from "./services/connector-runtime-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const fixtureAdapter: ConnectorAdapter = {
  providerKey: "FIXTURE",
  validateCredentials: () => Promise.resolve(),
  checkHealth: () => Promise.resolve("HEALTHY")
};
const app = buildApp({ prisma, connectorAdapters: [fixtureAdapter] });
const owner = "books-health-owner@example.test";

interface HealthResponse {
  readonly booksHealth: {
    readonly mode: string;
    readonly accountingEntriesCreated: number;
    readonly summary: { readonly checkedAreas: number };
    readonly findings: readonly {
      readonly id: string;
      readonly category: string;
      readonly count: number;
      readonly target: { readonly workspaceId: string; readonly anchorId: string };
    }[];
  };
}

function headers(organizationId?: string, email = owner, key?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

async function api(
  method: "GET" | "POST",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  email = owner,
  key?: string
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, email, key),
    ...(payload === undefined ? {} : { payload })
  });
}

async function createOrganization(name: string) {
  const response = await api("POST", "/v1/organizations", undefined, {
    legalName: `${name} Ltd`,
    displayName: name
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function preparePrimaryOrganization() {
  const organizationId = await createOrganization("Books Health Primary");
  expect(
    (
      await api(
        "POST",
        "/v1/setup/presets/general-service/apply",
        organizationId,
        {},
        owner,
        randomUUID()
      )
    ).statusCode
  ).toBe(201);
  const periodResponse = await api("POST", "/v1/fiscal-periods", organizationId, {
    name: "Fiscal 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31"
  });
  expect(periodResponse.statusCode, periodResponse.body).toBe(201);
  const periodId = periodResponse.json<{ period: { id: string } }>().period.id;

  const ledgerResponse = await api("POST", "/v1/accounts", organizationId, {
    code: "BH-BANK",
    name: "Books Health Bank",
    type: "ASSET",
    isControl: false
  });
  expect(ledgerResponse.statusCode, ledgerResponse.body).toBe(201);
  const ledgerAccountId = ledgerResponse.json<{ account: { id: string } }>().account.id;
  const revenueResponse = await api("POST", "/v1/accounts", organizationId, {
    code: "BH-REV",
    name: "Books Health Revenue",
    type: "REVENUE",
    isControl: false
  });
  expect(revenueResponse.statusCode, revenueResponse.body).toBe(201);
  const revenueAccountId = revenueResponse.json<{ account: { id: string } }>().account.id;
  const bankResponse = await api("POST", "/v1/bank-accounts", organizationId, {
    displayName: "Books Health Operating",
    accountKind: "BANK",
    maskedAccountReference: "****4000",
    financialInstitutionName: "Fixture Bank",
    currency: "CAD",
    linkedLedgerAccountId: ledgerAccountId,
    openingDate: "2026-01-01"
  });
  expect(bankResponse.statusCode, bankResponse.body).toBe(201);
  const bankAccountId = bankResponse.json<{ bankAccount: { id: string } }>().bankAccount.id;

  const statement =
    "date,description,amount,currency,reference\n2026-04-01,Fixture,10.00,CAD,BH-1\n";
  const previewResponse = await api("POST", "/v1/bank-imports/preview", organizationId, {
    bankAccountId,
    fileName: "books-health.csv",
    format: "CSV",
    contentBase64: Buffer.from(statement).toString("base64")
  });
  expect(previewResponse.statusCode, previewResponse.body).toBe(201);
  const batch = previewResponse.json<{ batch: { id: string; version: number } }>().batch;
  const commitResponse = await api(
    "POST",
    `/v1/bank-imports/${batch.id}/commit`,
    organizationId,
    { version: batch.version },
    owner,
    randomUUID()
  );
  expect(commitResponse.statusCode, commitResponse.body).toBe(201);
  const transaction = commitResponse.json<{
    transactions: Array<{ id: string; version: number }>;
  }>().transactions[0]!;
  const categorizationResponse = await api(
    "POST",
    `/v1/bank-transactions/${transaction.id}/categorize`,
    organizationId,
    { version: transaction.version, lines: [{ accountId: revenueAccountId, amountMinor: "1000" }] },
    owner,
    randomUUID()
  );
  expect(categorizationResponse.statusCode, categorizationResponse.body).toBe(201);
  const reconciliationResponse = await api("POST", "/v1/bank-reconciliations", organizationId, {
    bankAccountId,
    statementStartDate: "2026-04-01",
    statementEndDate: "2026-04-30",
    openingStatementBalanceMinor: "0",
    closingStatementBalanceMinor: "1000",
    importedTransactionIds: [transaction.id]
  });
  expect(reconciliationResponse.statusCode, reconciliationResponse.body).toBe(201);

  const connectorResponse = await api(
    "POST",
    "/v1/organizations/current/connectors",
    organizationId,
    { providerKey: "FIXTURE", displayName: "Books Health Fixture", mapping: {} }
  );
  expect(connectorResponse.statusCode, connectorResponse.body).toBe(201);
  const installationId = connectorResponse.json<{ connector: { id: string } }>().connector.id;
  const commerceResponse = await api(
    "POST",
    "/v1/organizations/current/commerce/inbox",
    organizationId,
    {
      installationId,
      providerKey: "FIXTURE",
      shopExternalId: "primary-shop",
      externalEventId: "mapping-event",
      resourceType: "ORDER",
      resourceId: "order-1",
      eventType: "order.updated",
      sourceCurrency: "CAD",
      rawPayload: { total: "10.00" }
    }
  );
  expect(commerceResponse.statusCode, commerceResponse.body).toBe(201);
  const commerceEventId = commerceResponse.json<{ event: { id: string } }>().event.id;
  await prisma.commerceInboxEvent.update({
    where: { id: commerceEventId },
    data: {
      status: "REVIEW_REQUIRED",
      normalizationIssues: [
        {
          code: "ITEM_MAPPING_REQUIRED",
          message: "Choose an item mapping.",
          severity: "BLOCKING"
        }
      ]
    }
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
  const company = await prisma.company.findFirstOrThrow({
    where: { organizationId, isDefault: true }
  });
  await prisma.dataImportBatch.create({
    data: {
      organizationId,
      companyId: company.id,
      importType: "CUSTOMERS",
      sourceFilename: "switching.csv",
      storageKey: `imports/${organizationId}/${randomUUID()}/source.csv`,
      mediaType: "text/csv",
      byteSize: 1,
      checksum: createHash("sha256").update(randomUUID()).digest("hex"),
      createdByUserId: user.id
    }
  });
  return { organizationId, periodId };
}

async function addMember(organizationId: string, email: string, role: "READ_ONLY" | "SALES") {
  const user = await prisma.user.create({
    data: { email, displayName: email, emailVerifiedAt: new Date() }
  });
  await prisma.membership.create({ data: { organizationId, userId: user.id, role } });
}

async function writeEvidence(organizationId: string) {
  const [journals, audits, outbox, idempotency, dismissals, closeRecords] = await Promise.all([
    prisma.journal.count({ where: { organizationId } }),
    prisma.auditEvent.count({ where: { organizationId } }),
    prisma.outboxEvent.count({ where: { organizationId } }),
    prisma.idempotencyRecord.count({ where: { organizationId } }),
    prisma.reviewItemDismissal.count({ where: { organizationId } }),
    prisma.periodCloseRecord.count({ where: { organizationId } })
  ]);
  return { journals, audits, outbox, idempotency, dismissals, closeRecords };
}

beforeAll(async () => {
  await prisma.$connect();
  await app.ready();
});
beforeEach(async () => resetDatabase(prisma));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Books Health", () => {
  it("aggregates five tenant-scoped areas without writing and enforces dashboard access", async () => {
    const { organizationId } = await preparePrimaryOrganization();
    const otherOrganizationId = await createOrganization("Books Health Other");
    const otherConnector = await api(
      "POST",
      "/v1/organizations/current/connectors",
      otherOrganizationId,
      { providerKey: "FIXTURE", displayName: "Other Fixture", mapping: {} }
    );
    const otherInstallationId = otherConnector.json<{ connector: { id: string } }>().connector.id;
    const otherPayload = {
      installationId: otherInstallationId,
      providerKey: "FIXTURE",
      shopExternalId: "other-shop",
      externalEventId: "other-event",
      resourceType: "ORDER",
      resourceId: "other-order",
      eventType: "order.updated",
      rawPayload: { total: "1.00" }
    };
    expect(
      (
        await api(
          "POST",
          "/v1/organizations/current/commerce/inbox",
          otherOrganizationId,
          otherPayload
        )
      ).statusCode
    ).toBe(201);
    expect(
      (
        await api("POST", "/v1/organizations/current/commerce/inbox", otherOrganizationId, {
          ...otherPayload,
          rawPayload: { total: "9.00" }
        })
      ).statusCode
    ).toBe(409);

    const before = await writeEvidence(organizationId);
    const response = await api("GET", "/v1/books-health?asOf=2026-08-02", organizationId);
    expect(response.statusCode, response.body).toBe(200);
    const health = response.json<HealthResponse>().booksHealth;
    expect(health.mode).toBe("READ_ONLY");
    expect(health.accountingEntriesCreated).toBe(0);
    expect(health.summary.checkedAreas).toBe(5);
    expect(new Set(health.findings.map((finding) => finding.category))).toEqual(
      new Set(["COMMERCE", "BANKING", "IMPORTS", "TAX_SETTINGS", "PERIOD_CLOSE"])
    );
    expect(health.findings.map((finding) => finding.id)).not.toContain("COMMERCE_BLOCKED");
    expect(health.findings.every((finding) => Boolean(finding.target.workspaceId))).toBe(true);
    expect(await writeEvidence(organizationId)).toEqual(before);

    const otherHealth = (
      await api("GET", "/v1/books-health?asOf=2026-08-02", otherOrganizationId)
    ).json<HealthResponse>().booksHealth;
    expect(otherHealth.findings.map((finding) => finding.id)).toContain("COMMERCE_BLOCKED");

    const readOnly = "books-health-read-only@example.test";
    const sales = "books-health-sales@example.test";
    await addMember(organizationId, readOnly, "READ_ONLY");
    await addMember(organizationId, sales, "SALES");
    const readOnlyResponse = await api(
      "GET",
      "/v1/books-health?asOf=2026-08-02",
      organizationId,
      undefined,
      readOnly
    );
    expect(readOnlyResponse.statusCode, readOnlyResponse.body).toBe(200);
    expect(readOnlyResponse.json<HealthResponse>().booksHealth.mode).toBe("READ_ONLY");
    expect(
      (await api("GET", "/v1/books-health?asOf=2026-08-02", organizationId, undefined, sales))
        .statusCode
    ).toBe(403);
  });

  it("keeps transactions in an in-progress reconciliation visible to all close reviews", async () => {
    const { organizationId, periodId } = await preparePrimaryOrganization();
    const response = await api("GET", "/v1/books-health?asOf=2026-08-02", organizationId);
    const bankFinding = response
      .json<HealthResponse>()
      .booksHealth.findings.find((finding) => finding.id === "BANK_REVIEW_REQUIRED");
    expect(bankFinding?.count).toBe(1);

    const closePreview = await api(
      "GET",
      `/v1/fiscal-periods/${periodId}/close-preview`,
      organizationId
    );
    expect(
      closePreview.json<{ checklist: { checks: { unreconciledBankAccounts: number } } }>().checklist
        .checks.unreconciledBankAccounts
    ).toBe(1);
    const reviewQueue = await api(
      "GET",
      "/v1/accountant/review-queue?asOf=2026-08-02",
      organizationId
    );
    expect(
      reviewQueue
        .json<{ queue: { items: Array<{ category: string }> } }>()
        .queue.items.map((item) => item.category)
    ).toContain("UNRECONCILED_ACCOUNT");
  });
});
